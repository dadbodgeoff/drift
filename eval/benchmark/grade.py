#!/usr/bin/env python3
"""Blind grading for the agent benchmark: packets out, grades in, analysis.

    python3 -I eval/benchmark/grade.py packets --config CONFIG.json --seed SEED \
        --out PACKETS_DIR --key-out KEY.json [--graders g1,g2] [--with-transcript]
    python3 -I eval/benchmark/grade.py join --config CONFIG.json --packets PACKETS_DIR \
        --key KEY.json --grades G1.json G2.json --out ANALYSIS.json [--margin 0.15] [--seed SEED]

`packets` reads every graded run (harness errors are not graded; they are
listed in the key), strips every trace of the arm (RUBRIC.md, "Blinding"),
gives each run an opaque packet id and writes, per grader, the packets in that
grader's own seeded order plus an empty grades file to fill in. The key that
maps packet ids back to (task, arm, run) is written to KEY.json, which must be
outside PACKETS_DIR and is never given to a grader.

`join` checks both graders' files are complete and in range, joins them to the
key, computes agreement between the two graders, and runs the analysis fixed in
PREREG-DRAFT.md §6. Its output is deterministic given the inputs and the seed.
"""

import argparse
import difflib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import benchlib as bl  # noqa: E402
import harness  # noqa: E402

GRADES_SCHEMA = "drift-benchmark-grades/1"
VERDICTS = ("followed", "violated", "na")
ARM_GUESSES = ("none", "plain", "agents-md", "hooks", "cannot-tell")
SCALE = (0, 1, 2, 3)
ALWAYS_STRIPPED_FILES = ("AGENTS.md", "CLAUDE.md", "drift.lock", ".mcp.json")
ALWAYS_STRIPPED_DIRS = (".drift/",)
SUPPRESSION_RE = re.compile(r"drift-ignore", re.IGNORECASE)
TRANSCRIPT_TRACE_RE = re.compile(r"drift|agents\.md|claude\.md|\bhook|conventions\.yaml|project setup", re.IGNORECASE)
TAIL_LINES = 200


# ---------------------------------------------------------------- blinding

def trace_paths(cfg):
    files = set(ALWAYS_STRIPPED_FILES) | {cfg["instructions_file"]}
    dirs = set(ALWAYS_STRIPPED_DIRS)
    for h in cfg["hooks"]["files"]:
        dest = h["dest"][2:] if h["dest"].startswith("./") else h["dest"]
        files.add(dest)
        top = dest.split("/")[0]
        if "/" in dest and top.startswith("."):
            # a hidden configuration directory the hook wiring uses: stripped in every arm
            dirs.add(top + "/")
    return files, dirs


def is_trace_path(path, files, dirs):
    """A file whose presence or content tells the arm. Names without a slash
    (AGENTS.md, CLAUDE.md, ...) match at any depth; directories match at any depth."""
    base = os.path.basename(path)
    if path in files or base in {f for f in files if "/" not in f}:
        return True
    return any(("/" + d) in ("/" + path) for d in dirs)


def split_diff(text):
    """Split a git diff into (path, chunk) per file."""
    chunks, cur, path = [], [], None
    for line in text.splitlines(keepends=True):
        if line.startswith("diff --git "):
            if cur:
                chunks.append((path, "".join(cur)))
            cur = [line]
            m = re.match(r"diff --git a/(.*) b/(.*)\n?$", line)
            path = m.group(2) if m else line.strip()
        else:
            cur.append(line)
    if cur:
        chunks.append((path, "".join(cur)))
    return chunks


def blind_diff(text, cfg, workdir_hint=None):
    """Return (blinded diff, stats). Drops whole files that are arm traces and
    added lines carrying a drift-ignore suppression; replaces the working-copy
    path. Neither removal is marked, since a mark would itself tell the arm."""
    files, dirs = trace_paths(cfg)
    out, stats = [], {"files_dropped": [], "suppression_lines_dropped": 0}
    for path, chunk in split_diff(text):
        if path and is_trace_path(path, files, dirs):
            stats["files_dropped"].append(path)
            continue
        kept = []
        for line in chunk.splitlines(keepends=True):
            if line.startswith("+") and not line.startswith("+++") and SUPPRESSION_RE.search(line):
                stats["suppression_lines_dropped"] += 1
                continue
            kept.append(line)
        out.append("".join(kept))
    blinded = "".join(out)
    if workdir_hint:
        blinded = blinded.replace(workdir_hint, "<workdir>")
    return blinded, stats


def blind_text(text, roots):
    """Replace every path under the results or working-copy roots."""
    if isinstance(roots, str):
        roots = [roots]
    for root in sorted(set(r for r in roots if r), key=len, reverse=True):
        text = re.sub(re.escape(root) + r"[^\s'\"]*", "<path>", text)
    return text


def blind_transcript(path, roots):
    """Best effort only (README: not relied on for the primary grading): drops
    every transcript line that mentions Drift, an instructions file or a hook."""
    if not os.path.exists(path):
        return "", 0
    kept, dropped = [], 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if TRANSCRIPT_TRACE_RE.search(line):
                dropped += 1
                continue
            kept.append(blind_text(line, roots))
    return "".join(kept), dropped


def tail(path, n=TAIL_LINES):
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    return "".join(lines[-n:])


# ---------------------------------------------------------------- packets

def graded_runs(cfg, tasks):
    """Final results of every run, in run-id order. Harness errors are
    returned separately: they are not graded."""
    good, bad, missing = [], [], []
    for t in tasks:
        for arm in cfg["arms"]:
            for r in range(1, cfg["runs_per_arm"] + 1):
                rid = harness.run_id(cfg, t["id"], arm, r)
                p = os.path.join(cfg["runs_root"], "runs", rid, "result.json")
                if not os.path.exists(p):
                    missing.append({"task": t["id"], "arm": arm, "run": r, "run_id": rid})
                    continue
                with open(p, encoding="utf-8") as f:
                    res = json.load(f)
                res["_dir"] = os.path.join(cfg["runs_root"], "runs", rid, res["final_attempt"])
                (bad if res["status"] == "harness-error" else good).append(res)
    good.sort(key=lambda x: x["run_id"])
    return good, bad, missing


def packet_markdown(pid, task, cfg, blinded, tests, transcript):
    ref = ""
    if task["hidden"].get("reference_diff"):
        p = os.path.join(cfg["tasks_dir"], task["hidden"]["reference_diff"])
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                ref = f.read()
    conv = "\n".join("- **%s** %s (evidence: %s)" % (c["id"], c["text"], ", ".join(c["evidence"]))
                     for c in task["conventions"]) or "- (no convention listed for this task)"
    parts = [
        "# Packet %s\n" % pid,
        "Grade with RUBRIC.md. Fill in this packet's entry in your grades file.\n",
        "## The issue the agent was given\n\n```text\n%s\n```\n" % task["prompt"].rstrip("\n"),
        "## Conventions to check (frozen before any run)\n\n%s\n" % conv,
        "## The real change (reference; one acceptable solution, not the only one)\n\n```diff\n%s```\n" % ref,
        "## The change to grade\n\n```diff\n%s```\n" % (blinded or "(no change)\n"),
    ]
    if tests is not None:
        parts.append("## Repository tests after the change\n\nCommand: `%s`  \nExit code: %s%s\n\n```text\n%s```\n"
                     % (tests["command"], tests["exit_code"], " (timed out)" if tests["timed_out"] else "", tests["tail"]))
    else:
        parts.append("## Repository tests after the change\n\nNo test command for this task.\n")
    if transcript is not None:
        parts.append("## Transcript (lines naming tools or files that would reveal the setup are removed)\n\n```text\n%s```\n" % transcript)
    return "\n".join(parts)


def cmd_packets(cfg, tasks, seed, out, key_out, graders, with_transcript):
    out = os.path.abspath(out)
    key_out = os.path.abspath(key_out)
    if key_out.startswith(out + os.sep):
        raise SystemExit("the key must be written outside the packets directory")
    if os.path.exists(out) and os.listdir(out):
        raise SystemExit("%s is not empty" % out)
    by_id = {t["id"]: t for t in tasks}
    good, bad, missing = graded_runs(cfg, tasks)
    key = {"schema": "drift-benchmark-key/1", "seed": seed, "packets": {}, "not_graded": bad and [
        {k: v for k, v in b.items() if not k.startswith("_")} for b in bad] or [], "missing": missing}
    bodies = {}
    for res in good:
        pid = "P" + bl.stable_key(seed, "packet", res["run_id"])[:10]
        t = by_id[res["task"]]
        with open(os.path.join(res["_dir"], "agent.diff"), encoding="utf-8", errors="replace") as f:
            raw = f.read()
        blinded, stats = blind_diff(raw, cfg)
        roots = [cfg["runs_root"], cfg["work_root"], cfg["work_root"] + ".home"]
        blinded = blind_text(blinded, roots)
        tests = None
        if res.get("tests"):
            tests = dict(res["tests"])
            tests["tail"] = blind_text(tail(os.path.join(res["_dir"], "tests.out")) + tail(os.path.join(res["_dir"], "tests.err")), roots)
        transcript = None
        if with_transcript:
            transcript, dropped = blind_transcript(os.path.join(res["_dir"], "transcript.jsonl"), roots)
            stats["transcript_lines_dropped"] = dropped
        bodies[pid] = packet_markdown(pid, t, cfg, blinded, tests, transcript)
        key["packets"][pid] = {"task": res["task"], "arm": res["arm"], "run": res["run"], "run_id": res["run_id"],
                               "status": res["status"], "blinding": stats,
                               "tests_exit_code": (res.get("tests") or {}).get("exit_code"),
                               "wall_s": res.get("wall_s"), "added": res.get("added"), "deleted": res.get("deleted"),
                               "agent_diff": os.path.relpath(os.path.join(res["_dir"], "agent.diff"), cfg["runs_root"])}
    for g in graders:
        gdir = os.path.join(out, g)
        os.makedirs(gdir)
        order = sorted(bodies, key=lambda pid: bl.stable_key(seed, "grader-order", g, pid))
        with open(os.path.join(gdir, "ORDER.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(order) + "\n")
        for pid in order:
            with open(os.path.join(gdir, pid + ".md"), "w", encoding="utf-8") as f:
                f.write(bodies[pid])
        template = {"schema": GRADES_SCHEMA, "grader": g, "grades": []}
        for pid in order:
            task = by_id[key["packets"][pid]["task"]]
            template["grades"].append({
                "packet": pid, "resolves": None,
                "conventions": {c["id"]: None for c in task["conventions"]},
                "other_violations": None, "breakage": None, "scope": None,
                "guess_arm": None, "notes": ""})
        bl.dump_json(os.path.join(gdir, "grades.json"), template)
    os.makedirs(os.path.dirname(key_out), exist_ok=True)
    bl.dump_json(key_out, key)
    print("%d packets for %d graders; %d runs not graded (harness errors), %d not run" % (len(bodies), len(graders), len(bad), len(missing)))
    return 0


# ---------------------------------------------------------------- join

def load_grades(path, key, by_id):
    with open(path, encoding="utf-8") as f:
        g = json.load(f)
    if g.get("schema") != GRADES_SCHEMA:
        raise SystemExit("%s: not a grades file" % path)
    errs, out = [], {}
    for e in g["grades"]:
        pid = e["packet"]
        if pid not in key["packets"]:
            errs.append("%s: unknown packet" % pid)
            continue
        task = by_id[key["packets"][pid]["task"]]
        for field in ("resolves", "breakage", "scope"):
            if e.get(field) not in SCALE:
                errs.append("%s: %s must be 0-3" % (pid, field))
        if not isinstance(e.get("other_violations"), int) or isinstance(e.get("other_violations"), bool) or e["other_violations"] < 0:
            errs.append("%s: other_violations must be a whole number >= 0" % pid)
        want = {c["id"] for c in task["conventions"]}
        have = e.get("conventions") or {}
        if set(have) != want:
            errs.append("%s: conventions must be exactly %s" % (pid, sorted(want)))
        for cid, v in have.items():
            if v not in VERDICTS:
                errs.append("%s: %s must be one of %s" % (pid, cid, "/".join(VERDICTS)))
        if e.get("guess_arm") not in ARM_GUESSES:
            errs.append("%s: guess_arm must be one of %s" % (pid, "/".join(ARM_GUESSES)))
        out[pid] = e
    for pid in key["packets"]:
        if pid not in out:
            errs.append("%s: not graded" % pid)
    if errs:
        raise SystemExit("%s is incomplete or out of range:\n  %s" % (path, "\n  ".join(errs[:40])))
    return g["grader"], out


def run_measures(e):
    v = sum(1 for x in e["conventions"].values() if x == "violated")
    applicable = sum(1 for x in e["conventions"].values() if x != "na")
    return {"V": v, "applicable": applicable, "O": e["other_violations"], "S": 1 if e["resolves"] >= 2 else 0,
            "R": e["resolves"], "B": e["breakage"], "Z": e["scope"]}


def added_lines(diff_text):
    return [l[1:].strip() for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++") and l[1:].strip()]


def similarity(a_lines, b_lines):
    if not a_lines or not b_lines:
        return 0.0
    return difflib.SequenceMatcher(None, a_lines, b_lines, autojunk=False).ratio()


def compare(task_vals, arm_a, arm_b, measure, seed):
    """Paired comparison arm_a minus arm_b over tasks having both."""
    tasks = sorted(t for t in task_vals if arm_a in task_vals[t] and arm_b in task_vals[t]
                   and task_vals[t][arm_a].get(measure) is not None and task_vals[t][arm_b].get(measure) is not None)
    diffs = [task_vals[t][arm_a][measure] - task_vals[t][arm_b][measure] for t in tasks]
    if not diffs:
        return {"n_tasks": 0}
    w = bl.wilcoxon_signed_rank(diffs, exact=True)
    lo, hi = bl.bootstrap_ci(diffs, seed, label="%s-%s-%s" % (arm_a, arm_b, measure))
    return {"n_tasks": len(diffs), "mean_diff": bl.mean(diffs), "median_diff": bl.median(diffs),
            "boot95": [lo, hi], "wilcoxon": w, "tasks_better": sum(1 for d in diffs if d < 0),
            "tasks_worse": sum(1 for d in diffs if d > 0), "tasks_tied": sum(1 for d in diffs if d == 0),
            "per_task": dict(zip(tasks, diffs))}


def cmd_join(cfg, tasks, packets_dir, key_path, grade_paths, out, margin, seed):
    with open(key_path, encoding="utf-8") as f:
        key = json.load(f)
    by_id = {t["id"]: t for t in tasks}
    if len(grade_paths) != 2:
        raise SystemExit("join takes exactly two graders' files")
    (ga, A), (gb, B) = [load_grades(p, key, by_id) for p in grade_paths]
    if ga == gb:
        raise SystemExit("the two grades files are from the same grader")
    pids = sorted(key["packets"])

    # agreement
    agree = {}
    for field in ("resolves", "breakage", "scope"):
        a, b = [A[p][field] for p in pids], [B[p][field] for p in pids]
        agree[field] = {"exact": bl.exact_agreement(a, b), "kappa_quadratic": bl.cohen_kappa(a, b, SCALE, "quadratic")}
    a = [1 if A[p]["resolves"] >= 2 else 0 for p in pids]
    b = [1 if B[p]["resolves"] >= 2 else 0 for p in pids]
    agree["success"] = {"exact": bl.exact_agreement(a, b), "kappa": bl.cohen_kappa(a, b, (0, 1))}
    va, vb = [], []
    for p in pids:
        for cid in sorted(A[p]["conventions"]):
            va.append(A[p]["conventions"][cid])
            vb.append(B[p]["conventions"][cid])
    agree["convention_verdicts"] = {"n": len(va), "exact": bl.exact_agreement(va, vb) if va else None,
                                    "kappa": bl.cohen_kappa(va, vb, VERDICTS) if va else None}
    agree["kappa_bar"] = 0.6
    agree["meets_bar"] = all(x is not None and x == x and x >= 0.6 for x in (
        agree["convention_verdicts"]["kappa"], agree["success"]["kappa"]))

    # blinding check
    blind = {}
    for g, G in ((ga, A), (gb, B)):
        guessed = [p for p in pids if G[p]["guess_arm"] != "cannot-tell"]
        right = sum(1 for p in guessed if G[p]["guess_arm"] == key["packets"][p]["arm"])
        k = len(cfg["arms"])
        blind[g] = {"cannot_tell": len(pids) - len(guessed), "guessed": len(guessed), "right": right,
                    "chance": 1 / k, "p_vs_chance": bl.binom_two_sided_p(right, len(guessed), 1 / k) if guessed else None}

    # run level: mean of the two graders
    runs = {}
    for p in pids:
        ma, mb = run_measures(A[p]), run_measures(B[p])
        info = key["packets"][p]
        m = {k: (ma[k] + mb[k]) / 2 for k in ma}
        m["status"] = info["status"]
        m["tests_pass"] = None if info.get("tests_exit_code") is None else (1 if info["tests_exit_code"] == 0 else 0)
        m["suppressions"] = info["blinding"]["suppression_lines_dropped"]
        m["changed_lines"] = (info.get("added") or 0) + (info.get("deleted") or 0)
        m["wall_s"] = info.get("wall_s")
        runs[p] = (info["task"], info["arm"], info["run"], m)

    # similarity of each run's added lines to the real change (training recall check)
    sim = {}
    for p, (t, arm, r, m) in runs.items():
        ref_rel = by_id[t]["hidden"].get("reference_diff")
        if not ref_rel:
            continue
        with open(os.path.join(cfg["tasks_dir"], ref_rel), encoding="utf-8", errors="replace") as f:
            ref = added_lines(f.read())
        with open(os.path.join(cfg["runs_root"], key["packets"][p]["agent_diff"]), encoding="utf-8", errors="replace") as f:
            mine, _ = blind_diff(f.read(), cfg)
        sim[p] = similarity(added_lines(mine), ref)
        m["similarity"] = sim[p]

    # task x arm: mean over runs
    def task_values(filter_fn=None):
        acc = {}
        for p, (t, arm, r, m) in runs.items():
            if filter_fn and not filter_fn(m):
                continue
            acc.setdefault(t, {}).setdefault(arm, []).append(m)
        tv = {}
        for t, arms in acc.items():
            tv[t] = {}
            for arm, ms in arms.items():
                tv[t][arm] = {"n_runs": len(ms)}
                for k in ("V", "O", "S", "R", "B", "Z", "suppressions", "similarity"):
                    vals = [x[k] for x in ms if x.get(k) is not None]
                    tv[t][arm][k] = bl.mean(vals) if vals else None
                tp = [x["tests_pass"] for x in ms if x["tests_pass"] is not None]
                tv[t][arm]["tests_pass"] = bl.mean(tp) if tp else None
                lines = sum(x["changed_lines"] for x in ms)
                tv[t][arm]["V_per_100_lines"] = 100 * sum(x["V"] for x in ms) / lines if lines else None
        return tv

    tv = task_values()
    primary = compare(tv, "hooks", "none", "V", seed) if {"hooks", "none"} <= set(cfg["arms"]) else {"n_tasks": 0}
    success = compare(tv, "hooks", "none", "S", seed) if primary["n_tasks"] else {"n_tasks": 0}
    if success.get("n_tasks", 0) >= 2:
        diffs = list(success["per_task"].values())
        success["lower_bound_95_one_sided"] = bl.paired_t_lower_bound(diffs, 0.05)
        success["margin"] = margin
        success["non_inferior"] = success["lower_bound_95_one_sided"] > -margin
    h1 = bool(primary.get("n_tasks") and primary["wilcoxon"]["p"] < 0.05 and primary["mean_diff"] < 0)
    secondary_pairs = [("agents-md", "none"), ("plain", "none"), ("hooks", "plain"), ("hooks", "agents-md"), ("agents-md", "plain")]
    secondary = {}
    for a_, b_ in secondary_pairs:
        if a_ in cfg["arms"] and b_ in cfg["arms"]:
            secondary["%s-vs-%s" % (a_, b_)] = compare(tv, a_, b_, "V", seed)
    ps = {k: v["wilcoxon"]["p"] for k, v in secondary.items() if v.get("n_tasks")}
    for k, adj in bl.holm(ps).items():
        secondary[k]["p_holm"] = adj

    # sensitivity
    sens = {}
    tv_ok = task_values(lambda m: m["S"] >= 0.5)
    sens["V_successful_runs_only"] = compare(tv_ok, "hooks", "none", "V", seed)
    tv_done = task_values(lambda m: m["status"] == "ok")
    sens["V_excluding_timeouts_errors_budget"] = compare(tv_done, "hooks", "none", "V", seed)
    sens["V_per_100_changed_lines"] = compare(tv, "hooks", "none", "V_per_100_lines", seed)
    sens["other_violations"] = compare(tv, "hooks", "none", "O", seed)
    for g, G in ((ga, A), (gb, B)):
        one = {}
        for p in pids:
            info = key["packets"][p]
            one.setdefault(info["task"], {}).setdefault(info["arm"], []).append(run_measures(G[p])["V"])
        tv_g = {t: {a_: {"V": bl.mean(v)} for a_, v in arms.items()} for t, arms in one.items()}
        sens["V_grader_%s_only" % g] = compare(tv_g, "hooks", "none", "V", seed)
    low = sorted(t for t in tv if tv[t].get("none", {}).get("similarity") is not None and tv[t]["none"]["similarity"] < 0.5)
    sens["V_low_similarity_tasks"] = compare({t: tv[t] for t in low}, "hooks", "none", "V", seed)

    # descriptive, per arm
    per_arm = {}
    for arm in cfg["arms"]:
        ms = [m for (t, a_, r, m) in runs.values() if a_ == arm]
        statuses = {}
        for m in ms:
            statuses[m["status"]] = statuses.get(m["status"], 0) + 1
        def avg(k):
            vals = [m[k] for m in ms if m.get(k) is not None]
            return bl.mean(vals) if vals else None
        per_arm[arm] = {"runs_graded": len(ms), "status": dict(sorted(statuses.items())),
                        "V_mean": avg("V"), "S_mean": avg("S"), "R_mean": avg("R"), "B_mean": avg("B"),
                        "Z_mean": avg("Z"), "O_mean": avg("O"), "tests_pass_rate": avg("tests_pass"),
                        "suppressions_total": sum(m["suppressions"] for m in ms),
                        "similarity_median": bl.median([m["similarity"] for m in ms if m.get("similarity") is not None]) if ms else None,
                        "wall_s_median": bl.median([m["wall_s"] for m in ms if m.get("wall_s") is not None]) if ms else None}

    lost = sorted(t for t, d in (primary.get("per_task") or {}).items() if d > 0)
    analysis = {
        "schema": "drift-benchmark-analysis/1",
        "graders": [ga, gb], "seed": seed, "packets": len(pids),
        "not_graded": key.get("not_graded", []), "missing": key.get("missing", []),
        "agreement": agree, "blinding": blind,
        "primary": {"hypothesis": "H1: hooks arm has fewer listed-convention violations per task than none", "supported": h1, **primary},
        "co_primary_success": {"hypothesis": "H2: hooks arm task success not lower than none by more than the margin", **success},
        "secondary": secondary, "sensitivity": sens, "per_arm": per_arm,
        "tasks_where_hooks_lost_on_V": lost,
        "task_values": tv,
    }
    bl.dump_json(out, analysis)
    p = primary
    print("agreement: convention verdict kappa %s, success kappa %s (bar 0.6: %s)" % (
        _f(agree["convention_verdicts"]["kappa"]), _f(agree["success"]["kappa"]), "met" if agree["meets_bar"] else "NOT met"))
    if p.get("n_tasks"):
        print("H1 hooks - none, violations per task: mean %.3f over %d tasks, exact Wilcoxon p %.4f: %s"
              % (p["mean_diff"], p["n_tasks"], p["wilcoxon"]["p"], "supported" if h1 else "not supported"))
    if success.get("non_inferior") is not None:
        print("H2 success hooks - none: mean %.3f, one-sided 95%% lower bound %.3f vs margin -%.2f: %s"
              % (success["mean_diff"], success["lower_bound_95_one_sided"], margin, "non-inferior" if success["non_inferior"] else "not shown"))
    print("tasks where hooks lost on violations: %d" % len(lost))
    return 0


def _f(x):
    return "n/a" if x is None or x != x else "%.3f" % x


def main(argv=None):
    ap = argparse.ArgumentParser(description="Blind grading and analysis for the agent benchmark.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("packets")
    p.add_argument("--config", required=True)
    p.add_argument("--dry-run", action="store_true", help="the runs were made with harness.py --dry-run")
    p.add_argument("--seed", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--key-out", required=True)
    p.add_argument("--graders", default="g1,g2")
    p.add_argument("--with-transcript", action="store_true")
    j = sub.add_parser("join")
    j.add_argument("--config", required=True)
    j.add_argument("--dry-run", action="store_true")
    j.add_argument("--packets", required=True)
    j.add_argument("--key", required=True)
    j.add_argument("--grades", nargs=2, required=True)
    j.add_argument("--out", required=True)
    j.add_argument("--margin", type=float, default=0.15)
    j.add_argument("--seed", default=None)
    a = ap.parse_args(argv)
    cfg = harness.load_config(a.config, dry_run=a.dry_run)
    tasks = harness.load_tasks(cfg)
    if a.cmd == "packets":
        graders = [g for g in a.graders.split(",") if g]
        if len(graders) != 2 or len(set(graders)) != 2:
            raise SystemExit("two distinct graders are required")
        return cmd_packets(cfg, tasks, a.seed, a.out, a.key_out, graders, a.with_transcript)
    with open(a.key, encoding="utf-8") as f:
        seed = a.seed or json.load(f)["seed"]
    return cmd_join(cfg, tasks, a.packets, a.key, a.grades, a.out, a.margin, seed)


if __name__ == "__main__":
    sys.exit(main())
