#!/usr/bin/env python3
"""Replay a repository's history through `drift check --diff-base` and measure how
often Drift is right about new code, per rule kind (roadmap sprint 2 step 6,
scoreboard number 3).

Standard library only. Run it with `python3 -I`. See README.md for the method and
LABELLING.md for the labeller.

    plan    choose a base commit and the first-parent changes after it
    run     learn and accept rules at the base, then check every change's new code
    sample  draw a deterministic, blind sample per rule kind for labelling
    score   per rule kind: true share with a Wilson interval, and who falls under 80%/90%

Nothing here writes outside the paths it is given: the bare clone (synthetic commits
and lazily fetched blobs), one working tree, and the output directory.
"""

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import time

# Files Drift reads (crates/drift-ts, drift-py, package manifests). A change that
# touches none of them cannot produce a report and is not replayed.
SOURCE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py")
SOURCE_NAMES = ("package.json", "pyproject.toml")
SKIP_DIRS = ("node_modules/", "vendor/", "dist/", "build/")

# Policy files a team would have committed at the base. Copied into every replayed
# commit; the fact cache is never copied (each check starts with --no-cache).
POLICY_FILES = (".drift/conventions.yaml", "drift.lock", ".drift/config.yaml",
                ".drift/security.lock", ".gitattributes-drift")

# Disk guards (the machine is shared). Abort before a checkout when either is hit.
MIN_FREE_BYTES = int(2.5 * 1024 ** 3)
MAX_DATA_BYTES = 580 * 1024 ** 2

EXCERPT_CAP = 60          # lines of a unit shown to the labeller
NEXT_TOUCH_FILE_CAP = 25  # later commits touching the file examined per report
DRIFT_TIMEOUT = 600       # seconds per Drift process
GIT_TIMEOUT = 900         # seconds per git process (a checkout may fetch blobs)

LABELS = ("true", "public", "misread")


# ---------------------------------------------------------------- processes

def nice(cmd, timeout):
    return ["nice", "-n", "19", "timeout", "--kill-after=10", str(timeout)] + cmd


def git(repo, *args, timeout=GIT_TIMEOUT, check=True, env=None, text=True):
    e = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
    if env:
        e.update(env)
    p = subprocess.run(nice(["git", "-C", repo] + list(args), timeout),
                       capture_output=True, text=text, env=e,
                       **({"errors": "replace"} if text else {}))
    if check and p.returncode != 0:
        err = p.stderr if text else p.stderr.decode("utf-8", "replace")
        raise RuntimeError("git %s: exit %d: %s" % (" ".join(args[:3]), p.returncode, err.strip()[-800:]))
    return p.stdout


def has_commit(repo, sha):
    e = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_NO_LAZY_FETCH="1")
    return subprocess.run(["git", "-C", repo, "cat-file", "-e", sha + "^{commit}"],
                          capture_output=True, env=e).returncode == 0


def drift(bin_, root, *args, timeout=DRIFT_TIMEOUT):
    """One Drift process, niced, with a timeout. Returns (exit, stdout, stderr, seconds)."""
    t0 = time.time()
    p = subprocess.run(nice([bin_, "--root", root] + list(args), timeout),
                       capture_output=True, text=True, errors="replace",
                       env=dict(os.environ, NO_COLOR="1", GIT_TERMINAL_PROMPT="0"))
    return p.returncode, p.stdout, p.stderr, round(time.time() - t0, 2)


def parse_json(s):
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------- disk guard

def dir_bytes(path):
    total = 0
    for dp, _dn, fn in os.walk(path):
        for f in fn:
            try:
                total += os.lstat(os.path.join(dp, f)).st_blocks * 512
            except OSError:
                pass
    return total


def guard_disk(data_dir, work=None):
    st = os.statvfs("/")
    free = st.f_bavail * st.f_frsize
    used = dir_bytes(data_dir)
    if free < MIN_FREE_BYTES or used > MAX_DATA_BYTES:
        if work and os.path.isdir(work):
            shutil.rmtree(work, ignore_errors=True)
        raise SystemExit("disk guard: free on / %.2f GB, data dir %.0f MB: stopping (work tree removed)"
                         % (free / 1024 ** 3, used / 1024 ** 2))
    return free, used


# ---------------------------------------------------------------- plan

def is_source(path):
    if any(("/" + path).find("/" + d) >= 0 for d in SKIP_DIRS):
        return False
    base = path.rsplit("/", 1)[-1]
    return path.endswith(SOURCE_EXT) or base in SOURCE_NAMES


def first_parent_log(repo, rng):
    """[(sha, parent, ctime, subject, [(status, path)])] oldest first, for a range."""
    out = git(repo, "log", "--first-parent", "--reverse", "--no-renames", "-m",
              "--format=%x00%H %P%x01%ct%x01%s", "--name-status", rng)
    commits = []
    for chunk in out.split("\0")[1:]:
        head, _, body = chunk.partition("\n")
        ids, ct, subj = head.split("\x01", 2)
        ids = ids.split()
        files = []
        for line in body.splitlines():
            if "\t" in line:
                st, p = line.split("\t", 1)
                files.append((st[:1], p.split("\t")[-1]))
        if commits and commits[-1][0] == ids[0]:
            continue  # -m repeats merges once per parent; keep the first-parent diff
        commits.append((ids[0], ids[1] if len(ids) > 1 else None, int(ct), subj, files))
    return commits


def cmd_plan(a):
    repo = os.path.abspath(a.repo)
    tip = git(repo, "rev-parse", a.tip + "^{commit}").strip()
    chain = git(repo, "rev-list", "--first-parent", tip).split()
    if a.base_age >= len(chain):
        raise SystemExit("only %d first-parent commits reachable; base-age %d is too deep"
                         % (len(chain), a.base_age))
    base = chain[a.base_age]
    shallow = os.path.exists(os.path.join(repo, "shallow"))
    changes, skipped = [], 0
    for sha, parent, ct, subj, files in first_parent_log(repo, "%s..%s" % (base, tip)):
        if len(changes) >= a.window:
            break
        src = [p for _s, p in files if is_source(p)]
        if not src or parent is None or not has_commit(repo, parent):
            skipped += 1
            continue
        changes.append({"sha": sha, "parent": parent, "time": ct, "subject": subj[:200],
                        "files": len(files), "source_files": len(src), "source_paths": src[:3000],
                        "merge": len(git(repo, "rev-list", "--parents", "-n1", sha).split()) > 2})
    plan = {"repo": repo, "tip": tip, "base": base, "base_age": a.base_age,
            "window": a.window, "changes": changes, "skipped_no_source": skipped,
            "base_subject": git(repo, "log", "-1", "--format=%ci %s", base).strip(),
            "shallow_clone": shallow, "planned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if len(changes) < a.window:
        print("note: only %d source-touching changes after the base (asked for %d)"
              % (len(changes), a.window), file=sys.stderr)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(plan, f, indent=1)
    print("plan: base %s (%s), %d changes, %d skipped for touching no source file -> %s"
          % (base[:10], plan["base_subject"], len(changes), skipped, a.out))


# ---------------------------------------------------------------- policy file

def yaml_blocks(text):
    """The `conventions:` list of .drift/conventions.yaml, read shallowly: per id, the
    scalar keys of the block at any depth (last one wins), enough for provenance."""
    out, cur = {}, None
    for line in text.splitlines():
        s = line.strip()
        if line.startswith("- id:"):
            cur = {"id": s.split(":", 1)[1].strip()}
            out[cur["id"]] = cur
        elif cur is not None and ":" in s and not s.startswith(("-", "#")):
            k, _, v = s.partition(":")
            v = v.strip().strip("'\"")
            if v:
                cur.setdefault(k.strip(), v)
        elif cur is not None and line and not line.startswith(" ") and not line.startswith("-"):
            cur = None
    return out


def set_status_by_hand(path, ids, status="accepted"):
    """Fallback when `drift review --accept` cannot be scripted: set `status:` in each
    named convention's block, as `drift review` writes it."""
    lines = open(path).read().split("\n")
    cur = None
    for i, line in enumerate(lines):
        if line.startswith("- id:"):
            cur = line.split(":", 1)[1].strip()
        elif cur in ids and line.startswith("  status:"):
            lines[i] = "  status: " + status
    open(path, "w").write("\n".join(lines))


def proposed_by(block):
    for k in ("proposed_by", "proposed_from", "channel", "source", "origin"):
        if k in block:
            return "%s:%s" % (k, block[k])
    if "promoted_from_practice" in block:
        return "practice-promote"
    if "promoted_from_hidden" in block:
        return "hidden-promote"
    return "mined"


def family_of(rule_kind):
    rk = rule_kind or ""
    if rk == "practice" or rk.startswith("practice"):
        return "practice"
    if rk.startswith("avoids:import") or "layer" in rk:
        return "layering"
    if rk in ("registered_in", "mirrors_keys", "imports_from"):
        return "wiring"
    return "mined"


def kind_key(family, rule_kind, concern):
    if family == "practice":
        return "practice:%s" % (concern or "?")
    if family == "security":
        return rule_kind
    return rule_kind or family


# ---------------------------------------------------------------- base setup

def accept_at_base(a, w, log):
    """`drift init`, then accept per policy with the tool's own non-interactive forms:
    `drift review --accept <ids>` for mined proposals (`--block` never), and the printed
    `drift practices promote <P-id> --in <place>` for each practice that may be promoted."""
    pol = set(x.strip() for x in a.accept.split(",") if x.strip())
    steps = []
    init_args = ["init", "--no-cache", "--max", str(a.max)] + (["--all"] if "all" in pol else [])
    rc, out, err, sec = drift(a.bin, w, *init_args)
    steps.append({"cmd": "drift " + " ".join(init_args), "exit": rc, "seconds": sec, "stdout_tail": out[-3000:]})
    if rc != 0:
        raise SystemExit("drift init failed at the base: %s" % err[-500:])
    conv_path = os.path.join(w, ".drift", "conventions.yaml")
    blocks = yaml_blocks(open(conv_path).read())
    rc, out, err, _ = drift(a.bin, w, "check", "--no-cache", "--format", "json")
    cj = parse_json(out) or {}
    proposals = [c for c in cj.get("conventions", []) if c.get("status") == "proposed"]
    want = []
    for c in proposals:
        fam = family_of(c.get("rule_kind"))
        if "none" in pol:
            continue
        if ("all" in pol or "mined" in pol or fam in pol
                or ("default" in pol and c.get("tier") == "default")):
            want.append(c["id"])
    hand_written = False
    if want:
        rc, out, err, sec = drift(a.bin, w, "review", "--no-cache", "--accept", ",".join(want))
        steps.append({"cmd": "drift review --accept " + ",".join(want), "exit": rc, "seconds": sec,
                      "stdout_tail": out[-2000:], "stderr_tail": err[-1000:]})
        if rc != 0:
            set_status_by_hand(conv_path, set(want))
            hand_written = True
            log("review --accept exited %d; wrote status: accepted by hand" % rc)
    promoted = []
    if pol & {"all", "practice", "default"}:
        rc, out, err, sec = drift(a.bin, w, "practices", "promote", "--list", "--json", "--no-cache")
        lst = parse_json(out) or {}
        steps.append({"cmd": "drift practices promote --list --json", "exit": rc, "seconds": sec,
                      "candidates": len(lst.get("candidates", []))})
        for cand in lst.get("candidates", []):
            cmd = (cand.get("command") or "").split()
            if len(cmd) < 3 or cmd[:3] != ["drift", "practices", "promote"]:
                continue
            if cand.get("candidate", {}).get("forced") and "forced" not in pol:
                continue
            rc, out, err, sec = drift(a.bin, w, *(cmd[1:] + ["--no-cache"]))
            steps.append({"cmd": " ".join(cmd), "exit": rc, "seconds": sec, "stderr_tail": err[-500:]})
            if rc == 0:
                promoted.append({"command": " ".join(cmd), "concern": cand.get("candidate", {}).get("concern"),
                                 "unit": cand.get("candidate", {}).get("unit"), "place": cand.get("place")})
    # What is accepted now, as `drift check` reads it.
    rc, out, err, _ = drift(a.bin, w, "check", "--no-cache", "--format", "json")
    cj = parse_json(out) or {}
    blocks = yaml_blocks(open(conv_path).read())
    accepted = []
    for c in cj.get("conventions", []):
        b = blocks.get(c["id"], {})
        c = dict(c, proposed_by=proposed_by(b), concern=b.get("concern"),
                 family=family_of(c.get("rule_kind")), summary=b.get("summary"))
        accepted.append(c)
    legacy = sum(1 for v in cj.get("violations", []) if v.get("baselined"))
    return {"steps": steps, "proposals": len(proposals), "accepted_ids": want, "promoted": promoted,
            "conventions": accepted, "hand_written_status": hand_written, "legacy_at_base": legacy}


# ---------------------------------------------------------------- diffs and units

def added_lines(repo, parent, sha, paths=None):
    """{path: set(new-side line numbers added or changed)}, and the paths the change added.
    `paths`: limit the diff to these (the change's source files)."""
    out = git(repo, "diff", "--no-renames", "-U0", "--no-color", parent, sha,
              *((["--"] + list(paths)) if paths else []))
    res, added, cur, from_null = {}, set(), None, False
    for line in out.splitlines():
        if line.startswith("--- "):
            from_null = line.startswith("--- /dev/null")
        elif line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else None
            if cur is not None:
                res.setdefault(cur, set())
                if from_null:
                    added.add(cur)
        elif line.startswith("@@") and cur is not None:
            new = line.split(" ")[2]  # +start,count
            st, _, cnt = new[1:].partition(",")
            st, cnt = int(st), int(cnt) if cnt else 1
            if cnt == 0:
                res[cur].add(max(st, 1))  # pure deletion: the line next to it changed
            res[cur].update(range(st, st + cnt))
    return res, added


def hunks(repo, x, path):
    """Old-side hunks [(start, count, new_count)] of `git diff -U0 x^1 x -- path`."""
    out = git(repo, "diff", "--no-renames", "-U0", "--no-color", x + "^1", x, "--", path)
    hs = []
    for line in out.splitlines():
        if line.startswith("@@"):
            parts = line.split(" ")
            o, n = parts[1][1:], parts[2][1:]
            os_, _, oc = o.partition(",")
            ns, _, nc = n.partition(",")
            hs.append((int(os_), int(oc) if oc else 1, int(nc) if nc else 1))
    return hs


def declaration_starts(facts):
    """Lines where a declaration starts in a file, from `drift facts` (symbols and
    other top-level lists of named items; sinks, calls and imports left out)."""
    starts = set()
    if not isinstance(facts, dict):
        return starts
    for k, v in facts.items():
        if not isinstance(v, list) or any(x in k for x in ("sink", "call", "import", "throw", "env", "read")):
            continue
        for it in v:
            if isinstance(it, dict) and isinstance(it.get("line"), int) and (
                    "name" in it or "symbol" in it):
                starts.add(it["line"])
    return starts


def unit_extent(lines, start, starts):
    """A declaration runs to the line before the next one in its file, and takes in the
    decorators and comments directly above it up to a blank line (docs/wiki/Drift-in-CI.md).
    A reported line that is not a declaration Drift's facts record (an inline route
    registration, say) is a unit of that one line. Returns (start, end, known)."""
    n = len(lines)
    if start <= 0:
        return 1, n, True
    if start not in starts:
        return start, min(start, max(n, start)), False
    later = [s for s in starts if s > start]
    end = (min(later) - 1) if later else n
    s = start
    while s > 1:
        prev = lines[s - 2].strip()
        if prev and prev.startswith(("@", "//", "#", "/*", "*", "*/")):
            s -= 1
        else:
            break
    return s, max(min(end, n), start), True


def show_lines(repo, sha, path):
    try:
        return git(repo, "show", "%s:%s" % (sha, path)).split("\n")
    except RuntimeError:
        return []


class Later:
    """The first-parent commits after the base, for 'next later commit that touched the unit'."""

    def __init__(self, repo, base, tip):
        self.repo = repo
        self.commits = first_parent_log(repo, "%s..%s" % (base, tip))
        self.index = {c[0]: i for i, c in enumerate(self.commits)}
        self.memo = {}

    def next_touch(self, sha, path, s, e):
        i = self.index.get(sha)
        if i is None:
            return None
        seen = 0
        for c in self.commits[i + 1:]:
            st = [x for x, p in c[4] if p == path]
            if not st:
                continue
            seen += 1
            if st[0] == "D":
                return {"sha": c[0], "time": c[2], "subject": c[3][:120], "how": "file deleted"}
            if seen > NEXT_TOUCH_FILE_CAP:
                return {"sha": None, "how": "not found in %d later commits touching the file" % NEXT_TOUCH_FILE_CAP}
            key = (c[0], path)
            if key not in self.memo:
                try:
                    self.memo[key] = hunks(self.repo, c[0], path)
                except RuntimeError:
                    self.memo[key] = None
            hs = self.memo[key]
            if hs is None:
                return {"sha": c[0], "how": "file touched (diff unreadable)"}
            shift = 0
            for os_, oc, nc in hs:
                lo, hi = os_, os_ + max(oc, 1) - 1
                if oc == 0:
                    lo = hi = os_ + 1  # insertion after line os_
                if lo <= e and hi >= s:
                    return {"sha": c[0], "time": c[2], "subject": c[3][:120], "how": "unit lines changed"}
                if hi < s:
                    shift += nc - oc
            s, e = s + shift, e + shift
        return {"sha": None, "how": "not touched again up to the tip"}


# ---------------------------------------------------------------- security rows

SECURITY_SECTIONS = ("added_without_guard", "unguarded_reaching", "guard_gaps", "sinks", "leaks", "now_public")


def locate(item):
    """(path, symbol, line) of a security row, looking one level into nested objects."""
    def pick(d):
        p = d.get("path") or d.get("file")
        sym = d.get("symbol") or d.get("name") or d.get("handler") or ""
        ln = d.get("line") if isinstance(d.get("line"), int) else 0
        return p, sym, ln
    if not isinstance(item, dict):
        return None, "", 0
    p, sym, ln = pick(item)
    if p:
        return p, sym, ln
    for v in item.values():
        for d in (v if isinstance(v, list) else [v]):
            if isinstance(d, dict):
                p, sym, ln = pick(d)
                if p:
                    return p, sym, ln
    return None, "", 0


# ---------------------------------------------------------------- run

def write_policy_commit(w, snap, base_commit, parent_commit, msg, when):
    """Check out `base_commit` exactly (nothing untracked), add the base's policy files,
    and record it as a commit whose parent is `parent_commit`: the commit as it would
    have been had the team committed the policy at the replay base."""
    git(w, "checkout", "-q", "-f", "--detach", base_commit)
    git(w, "clean", "-q", "-ffdx")
    added = []
    for rel in POLICY_FILES:
        src = os.path.join(snap, rel)
        if os.path.isfile(src):
            dst = os.path.join(w, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            added.append(rel)
    if added:
        git(w, "add", "-f", "--", *added)
    tree = git(w, "write-tree").strip()
    env = {"GIT_AUTHOR_NAME": "drift-replay", "GIT_AUTHOR_EMAIL": "replay@invalid",
           "GIT_COMMITTER_NAME": "drift-replay", "GIT_COMMITTER_EMAIL": "replay@invalid",
           "GIT_AUTHOR_DATE": "%d +0000" % when, "GIT_COMMITTER_DATE": "%d +0000" % when}
    args = ["commit-tree", tree, "-m", msg] + (["-p", parent_commit] if parent_commit else [])
    c = git(w, *args, env=env).strip()
    git(w, "checkout", "-q", "-f", "--detach", c)
    return c


def cmd_run(a):
    plan = json.load(open(a.plan))
    repo = plan["repo"]
    data_dir = os.path.abspath(a.data or os.path.dirname(repo))
    out = os.path.abspath(a.out)
    if out.startswith(os.path.abspath("/home/user")):
        raise SystemExit("--out must be outside the checkouts (use the data directory)")
    kinds = set(k.strip() for k in a.kinds.split(",") if k.strip())
    os.makedirs(os.path.join(out, "raw"), exist_ok=True)
    work = os.path.abspath(a.work or os.path.join(data_dir, "work", os.path.basename(repo).removesuffix(".git")))
    logf = open(os.path.join(out, "run.log"), "a")

    def log(msg):
        line = "%s %s" % (time.strftime("%H:%M:%S"), msg)
        print(line, flush=True)
        logf.write(line + "\n")
        logf.flush()

    guard_disk(data_dir)
    if os.path.isdir(work):
        log("removing a stale work tree " + work)
        shutil.rmtree(work)
    git(repo, "worktree", "prune")
    rc, ver, _, _ = drift(a.bin, data_dir, "--version")
    meta = {"plan": os.path.abspath(a.plan), "repo": repo, "bin": os.path.abspath(a.bin),
            "bin_sha256": hashlib.sha256(open(a.bin, "rb").read()).hexdigest(),
            "version": ver.strip(), "kinds": sorted(kinds), "accept": a.accept, "max": a.max,
            "base": plan["base"], "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        log("work tree %s at base %s" % (work, plan["base"][:10]))
        git(repo, "worktree", "add", "-q", "--detach", work, plan["base"])
        guard_disk(data_dir, work)
        git(work, "clean", "-q", "-ffdx")
        base_setup = accept_at_base(a, work, log)
        snap = os.path.join(out, "base-policy")
        shutil.rmtree(snap, ignore_errors=True)
        for rel in POLICY_FILES:
            src = os.path.join(work, rel)
            if os.path.isfile(src):
                os.makedirs(os.path.dirname(os.path.join(snap, rel)), exist_ok=True)
                shutil.copyfile(src, os.path.join(snap, rel))
        meta["base_setup"] = base_setup
        conv = {c["id"]: c for c in base_setup["conventions"]}
        acc = [c for c in base_setup["conventions"] if c.get("status") == "accepted"]
        log("base: %d proposals, %d accepted (%s)" % (
            base_setup["proposals"], len(acc),
            ", ".join("%s %s/%s" % (c["id"], c["family"], c.get("concern") or c.get("rule_kind")) for c in acc) or "none"))
        json.dump(meta, open(os.path.join(out, "run.json"), "w"), indent=1)

        later = Later(repo, plan["base"], plan["tip"])
        rep_f = open(os.path.join(out, "reports.jsonl"), "w")
        ch_f = open(os.path.join(out, "changes.jsonl"), "w")
        totals = {}
        for n, ch in enumerate(plan["changes"]):
            free, used = guard_disk(data_dir, work)
            sha, parent = ch["sha"], ch["parent"]
            rec = {"n": n, "sha": sha, "parent": parent, "subject": ch["subject"]}
            try:
                p2 = write_policy_commit(work, snap, parent, None, "replay: %s + base policy" % parent[:10], ch["time"])
                c2 = write_policy_commit(work, snap, sha, p2, "replay: %s + base policy" % sha[:10], ch["time"])
            except RuntimeError as e:
                rec["error"] = "checkout: %s" % e
                log("change %d %s: %s" % (n, sha[:10], rec["error"][:300]))
                ch_f.write(json.dumps(rec) + "\n")
                continue
            add, added_files = added_lines(repo, parent, sha, ch.get("source_paths"))
            reports = []
            if kinds - {"security"}:
                rc, o, err, sec = drift(a.bin, work, "check", "--no-cache", "--format", "json", "--diff-base", p2)
                open(os.path.join(out, "raw", "%03d-%s.check.json" % (n, sha[:10])), "w").write(o)
                j = parse_json(o)
                rec.update(check_exit=rc, check_seconds=sec)
                if j is None:
                    rec["check_error"] = err.strip()[-600:]
                else:
                    d = j.get("diff") or {}
                    rec["diff"] = {k: v for k, v in d.items() if k not in ("base", "merge_base")}
                    if d.get("policy_changed"):
                        log("change %d: WARNING policy_changed: diff mode fell back to a full report" % n)
                    rec["not_checked"] = len(j.get("unchecked", []))
                    rec["legacy"] = sum(1 for v in j.get("violations", []) if v.get("baselined"))
                    rec["practices_not_checked"] = len(j.get("practices_not_checked", []))
                    rec["stale_practices"] = len(j.get("stale_practices", []))
                    for v in j.get("violations", []):
                        if v.get("baselined"):
                            continue  # legacy debt in drift.lock: counted, the same every change
                        c = conv.get(v.get("id"), {})
                        fam = family_of(c.get("rule_kind"))
                        if fam not in kinds and "all" not in kinds:
                            continue
                        reported = not (v.get("suppressed") or v.get("unsure")
                                        or v.get("suppressed_neighbour"))
                        reports.append({
                            "family": fam, "rule_kind": c.get("rule_kind"), "concern": c.get("concern"),
                            "proposed_by": c.get("proposed_by"), "tier": c.get("tier"),
                            "mode": c.get("effective_mode") or v.get("mode"),
                            "convention": v.get("id"), "path": v.get("path"), "symbol": v.get("symbol"),
                            "line": v.get("line"), "reported": reported,
                            "flags": [k for k in ("baselined", "suppressed", "unsure", "suppressed_neighbour") if v.get(k)],
                            "message": "%s (%s): %s does not follow it.%s" % (
                                v.get("summary"), v.get("evidence"), v.get("symbol"),
                                (" Copy %s." % v["example"]) if v.get("example") else ""),
                            "import": v.get("import")})
            if "security" in kinds or "all" in kinds:
                rc, o, err, sec = drift(a.bin, work, "security", "--no-cache", "--json", "--diff-base", p2)
                open(os.path.join(out, "raw", "%03d-%s.security.json" % (n, sha[:10])), "w").write(o)
                j = parse_json(o)
                rec.update(security_exit=rc, security_seconds=sec)
                if j is None:
                    rec["security_error"] = err.strip()[-600:]
                else:
                    rec["guard_unknown"] = len(j.get("guard_unknown", []))
                    for sect in SECURITY_SECTIONS:
                        for it in j.get(sect, []) or []:
                            p, sym, ln = locate(it)
                            reports.append({
                                "family": "security", "rule_kind": "security:" + sect, "concern": None,
                                "proposed_by": "security-inventory", "tier": None, "mode": "notice",
                                "convention": sect, "path": p, "symbol": sym, "line": ln, "reported": True,
                                "flags": [], "message": "%s: %s" % (sect, json.dumps(it, sort_keys=True)[:600]),
                                "import": None})
            # Where each report sits in the change, and when the team next touched it.
            facts_memo = {}
            for r in reports:
                p = r["path"]
                if not r["reported"]:
                    r.update(kind=kind_key(r["family"], r["rule_kind"], r["concern"]), change=n, sha=sha,
                             parent=parent, repo=os.path.basename(repo).removesuffix(".git"), on_new_code=None)
                    r["id"] = hashlib.sha256(("%s|%s|%s|%s|%s|%s" % (
                        r["repo"], sha, r["convention"], p, r["symbol"], r["line"])).encode()).hexdigest()[:16]
                    rep_f.write(json.dumps(r, sort_keys=True) + "\n")
                    continue
                lines = show_lines(repo, sha, p) if p else []
                if p and p not in facts_memo:
                    _rc, fo, _e, _s = drift(a.bin, work, "facts", "--no-cache", p)
                    facts_memo[p] = declaration_starts(parse_json(fo))
                file_level = (not r["line"]) or (r["symbol"] or "").startswith("(")
                if file_level:
                    s, e, known = 1, len(lines), True
                else:
                    s, e, known = unit_extent(lines, r["line"], facts_memo.get(p, set()))
                a_lines = add.get(p, set())
                touched = sorted(x for x in a_lines if s <= x <= e)
                if p in added_files:
                    age = "new"
                elif file_level:
                    age = "edited" if a_lines else "untouched"
                elif r["line"] in a_lines:
                    age = "new"
                elif touched:
                    age = "edited"
                else:
                    age = "untouched"
                r.update(unit_start=s, unit_end=e, unit_known=known, file_level=file_level, unit_age=age, added_in_unit=len(touched), added_lines=touched[:400],
                         on_new_code=age in ("new", "edited"), file_added=p in added_files)
                r["next_touch"] = later.next_touch(sha, p, s, e) if p and lines else None
                r["kind"] = kind_key(r["family"], r["rule_kind"], r["concern"])
                r.update(change=n, sha=sha, parent=parent, repo=os.path.basename(repo).removesuffix(".git"))
                r["id"] = hashlib.sha256(("%s|%s|%s|%s|%s|%s" % (
                    r["repo"], sha, r["convention"], p, r["symbol"], r["line"])).encode()).hexdigest()[:16]
                rep_f.write(json.dumps(r, sort_keys=True) + "\n")
                if r["reported"]:
                    totals[r["kind"]] = totals.get(r["kind"], 0) + 1
            rec["reports"] = sum(1 for r in reports if r["reported"])
            rec["on_new_code"] = sum(1 for r in reports if r["reported"] and r["on_new_code"])
            rec["free_gb"], rec["data_mb"] = round(free / 1024 ** 3, 2), round(used / 1024 ** 2)
            ch_f.write(json.dumps(rec) + "\n")
            ch_f.flush()
            rep_f.flush()
            log("change %d/%d %s: %d reported (%d on new code)  [%s]" % (
                n + 1, len(plan["changes"]), sha[:10], rec["reports"], rec["on_new_code"], ch["subject"][:60]))
        meta["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta["reports_by_kind"] = totals
        json.dump(meta, open(os.path.join(out, "run.json"), "w"), indent=1)
        log("done: %s" % (json.dumps(totals) or "no reports"))
    finally:
        if not a.keep_work:
            shutil.rmtree(work, ignore_errors=True)
            try:
                git(repo, "worktree", "prune")
            except RuntimeError:
                pass
        guard_disk(data_dir)


# ---------------------------------------------------------------- sample

def cmd_sample(a):
    rows = []
    for d in a.runs:
        meta = json.load(open(os.path.join(d, "run.json")))
        for line in open(os.path.join(d, "reports.jsonl")):
            r = json.loads(line)
            if not r.get("reported"):
                continue
            if not a.include_old and not r.get("on_new_code"):
                continue
            rows.append((meta, d, r))
    # One row per report text: two builds that say the same thing about the same unit
    # are labelled once (the key file keeps both).
    by_kind = {}
    for meta, d, r in rows:
        key = r["kind"] if a.by == "kind" else r["family"]
        by_kind.setdefault(key, []).append((meta, d, r))
    sample, key_rows = [], []
    for kind in sorted(by_kind):
        pool = sorted(by_kind[kind], key=lambda x: hashlib.sha256(
            ("%s|%s" % (a.seed, x[2]["id"])).encode()).hexdigest())
        seen = {}
        for meta, d, r in pool:
            text_key = (r["repo"], r["sha"], r["path"], r["line"], r["message"])
            if text_key in seen:
                key_rows.append({"item": seen[text_key], "run": d, "bin_sha256": meta["bin_sha256"], "report": r["id"]})
                continue
            if len(seen) >= a.per_kind:
                continue
            item = hashlib.sha256(("%s|%s|item" % (a.seed, r["id"])).encode()).hexdigest()[:12]
            seen[text_key] = item
            key_rows.append({"item": item, "run": d, "bin_sha256": meta["bin_sha256"], "report": r["id"]})
            lines = show_lines(meta["repo"], r["sha"], r["path"]) if r.get("path") else []
            s, e = r.get("unit_start", 1), r.get("unit_end", 1)
            # Context: a few lines above, and at least a dozen below a one-line unit.
            x0 = max(1, s - 3)
            x1 = min(len(lines), max(e, s + 12), x0 + EXCERPT_CAP - 1)
            plus = set(r.get("added_lines") or [])
            excerpt = "\n".join("%5d %s%s %s" % (i, ">" if s <= i <= e else " ", "+" if i in plus else " ",
                                                  lines[i - 1]) for i in range(x0, x1 + 1))
            e2 = x1
            sample.append({
                "item": item, "kind": kind, "repo": r["repo"], "commit": r["sha"],
                "file": r["path"], "line": r["line"], "unit": r["symbol"],
                "unit_lines": [s, e], "excerpt_truncated": e > e2, "unit_age": r["unit_age"],
                "report": r["message"], "excerpt": excerpt,
                "later_touch": (r.get("next_touch") or {}).get("how"),
                "later_commit": (r.get("next_touch") or {}).get("sha"),
                "label": "", "note": ""})
    # The labeller's order is shuffled across kinds, so neighbours do not hint the kind.
    sample.sort(key=lambda x: hashlib.sha256(("%s|order|%s" % (a.seed, x["item"])).encode()).hexdigest())
    with open(a.out, "w") as f:
        for s in sample:
            f.write(json.dumps(s, sort_keys=True) + "\n")
    with open(a.out + ".key.jsonl", "w") as f:
        for k in key_rows:
            f.write(json.dumps(k, sort_keys=True) + "\n")
    counts = {}
    for s in sample:
        counts[s["kind"]] = counts.get(s["kind"], 0) + 1
    pool_counts = {k: len(v) for k, v in by_kind.items()}
    print("sample: %d items -> %s (key: %s.key.jsonl)" % (len(sample), a.out, a.out))
    for k in sorted(pool_counts):
        print("  %-40s %4d reports, %3d sampled" % (k, pool_counts[k], counts.get(k, 0)))


# ---------------------------------------------------------------- score

def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


def cmd_score(a):
    stats = {}
    for line in open(a.labels):
        if not line.strip():
            continue
        r = json.loads(line)
        s = stats.setdefault(r.get("kind", "?"), {"reports": 0, "labelled": 0, "true": 0,
                                                  "public": 0, "misread": 0, "unsure": 0})
        s["reports"] += 1
        lab = (r.get("label") or "").strip().lower()
        if lab in LABELS:
            s["labelled"] += 1
            s[lab] += 1
        elif lab:
            s["unsure"] += 1
    rows = []
    for k in sorted(stats):
        s = stats[k]
        lo, hi = wilson(s["true"], s["labelled"])
        share = s["true"] / s["labelled"] if s["labelled"] else None
        s.update(kind=k, true_share=share, wilson_low=lo, wilson_high=hi,
                 under_80=share is not None and share < 0.8, under_90=share is not None and share < 0.9)
        rows.append(s)
    if a.json:
        print(json.dumps(rows, indent=1))
        return
    print("%-38s %7s %8s %5s %6s %7s %6s %7s  %s" % ("kind", "reports", "labelled", "true", "public",
                                                    "misread", "unsure", "share", "95% Wilson"))
    for s in rows:
        sh = "%.0f%%" % (100 * s["true_share"]) if s["true_share"] is not None else "-"
        iv = "%.0f-%.0f%%" % (100 * s["wilson_low"], 100 * s["wilson_high"]) if s["wilson_low"] is not None else "-"
        print("%-38s %7d %8d %5d %6d %7d %6d %7s  %s" % (s["kind"], s["reports"], s["labelled"], s["true"],
                                                     s["public"], s["misread"], s["unsure"], sh, iv))
    print("\nunder 80%% (quiet by default): %s" % (", ".join(s["kind"] for s in rows if s["under_80"]) or "none"))
    print("under 90%% (may not block):     %s" % (", ".join(s["kind"] for s in rows if s["under_90"]) or "none"))
    unl = [s["kind"] for s in rows if s["labelled"] < s["reports"]]
    if unl:
        print("not fully labelled (share is over labelled rows only): %s" % ", ".join(unl))


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="choose the base and the changes to replay")
    p.add_argument("--repo", required=True, help="bare (partial) clone")
    p.add_argument("--tip", default="refs/heads/pinned", help="newest commit (default: refs/heads/pinned)")
    p.add_argument("--base-age", type=int, required=True, help="first-parent commits back from the tip")
    p.add_argument("--window", type=int, required=True, help="source-touching changes to replay after the base")
    p.add_argument("--out", required=True, help="plan file to write")
    p.set_defaults(fn=cmd_plan)

    r = sub.add_parser("run", help="learn and accept at the base, then check each change")
    r.add_argument("--plan", required=True)
    r.add_argument("--bin", required=True, help="the drift binary to measure")
    r.add_argument("--kinds", default="mined,practice,layering,wiring,security",
                   help="families to record: mined, practice, layering, wiring, security, or all")
    r.add_argument("--accept", default="all",
                   help="what to accept at the base: all | default (default tier + practices) | "
                        "mined | practice | layering | none; comma-separated; add 'forced' to promote forced practices")
    r.add_argument("--max", type=int, default=15, help="drift init --max")
    r.add_argument("--out", required=True, help="output directory (outside the checkouts)")
    r.add_argument("--data", help="data directory the disk guard measures (default: the bare clone's directory)")
    r.add_argument("--work", help="work tree path (default: <data>/work/<repo>)")
    r.add_argument("--keep-work", action="store_true", help="do not delete the work tree at the end")
    r.set_defaults(fn=cmd_run)

    s = sub.add_parser("sample", help="deterministic blind sample per rule kind")
    s.add_argument("--runs", required=True, nargs="+", help="run output directories (pooled)")
    s.add_argument("--per-kind", type=int, default=30)
    s.add_argument("--by", choices=("kind", "family"), default="kind")
    s.add_argument("--seed", default="s26")
    s.add_argument("--include-old", action="store_true", help="also reports on units the change did not touch")
    s.add_argument("--out", required=True, help="JSON-lines file for the labeller")
    s.set_defaults(fn=cmd_sample)

    c = sub.add_parser("score", help="true share per rule kind")
    c.add_argument("--labels", required=True)
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_score)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
