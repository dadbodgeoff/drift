#!/usr/bin/env python3
"""The scoreboard as a command.

    python3 -I eval/scoreboard/scoreboard.py collect --bin <drift> --repos <dir> --out <dir>
    python3 -I eval/scoreboard/scoreboard.py score --data <dir> [--truth eval/scoreboard/truth] [--out score.json]
    python3 -I eval/scoreboard/scoreboard.py diff <before> <after> [--changed] [--json]

`collect` runs Drift's read-only commands on each sample repository, one process at
a time, under `nice 19` and a timeout, and saves the raw outputs with wall time and
peak memory. `score` computes every number from saved outputs alone. `diff` prints
each number before and after, per repository and in total, with the direction that
is good, and exits 1 only when a number marked as a guard regressed.

Python 3 standard library only. Every number says which audit line it reproduces
(README.md). Nothing here writes inside a sample repository: the fact cache goes to a
scratch directory (DRIFT_CACHE_DIR) or is off (--cache none), and the repository's
`.drift/` is checked after every command.
"""

import argparse
import gzip
import hashlib
import json
import os
import re
import resource  # noqa: F401  (ru_maxrss comes from os.wait4, which returns a resource.struct_rusage)
import shutil
import signal
import sys
import time
from collections import Counter, defaultdict

SCHEMA = 1
REPOS = [
    "epic",
    "juice-shop",
    "cal.com",
    "NodeGoat",
    "full-stack-fastapi-template",
    "plane",
    "pygoat",
]
SHORT = {
    "epic": "epic",
    "juice-shop": "juice",
    "cal.com": "cal",
    "NodeGoat": "nodegoat",
    "full-stack-fastapi-template": "fastapi",
    "plane": "plane",
    "pygoat": "pygoat",
}
PYTHON_REPOS = {"full-stack-fastapi-template", "plane", "pygoat"}
# Repositories whose holes are deliberate (scoreboard number 5).
VULNERABLE = {"juice-shop", "NodeGoat", "pygoat"}
CONCERNS = ["authn", "authz", "errors", "logging", "api", "validation", "config", "data_access", "testing"]
# Preview (secondary) concerns: out of the recipe, the card and departures
# (audit 3, section 0; eval/study/PREREG-R13-practices.md:32-33). The JSON does not say
# which concerns are preview, so the list is here.
PREVIEW = {"logging", "config", "data_access", "testing"}
# Entry kinds the security ratchet counts for no-guard (audit 4, ratchet.rs:65).
REQUEST_KINDS = {"http", "server_action", "graphql", "rpc"}
BIG = 1 << 20  # outputs above 1 MiB are stored gzipped

# --------------------------------------------------------------------------------------
# collect
# --------------------------------------------------------------------------------------

# (name, argv after the binary's --root, output file, options)
#   first:    timed as the first census (empty cache)
#   optional: may not exist in this build (detected by trying)
#   funnel:   DRIFT_FUNNEL points at <repo>/funnel.json for this run
COMMANDS = [
    ("census", ["census"], "census.txt", {"first": True}),
    ("coverage", ["census", "--coverage", "--json"], "coverage.json", {}),
    ("scan", ["scan"], "scan.txt", {}),
    ("census_json", ["census", "--json"], "census.json", {"funnel": True}),
    ("census_why", ["census", "--why", "--json"], "census-why.json", {"optional": True}),
    ("census_from_map", ["census", "--from-map", "--json"], "census-from-map.json", {"optional": True}),
    ("practices_units", ["practices", "--json", "--units"], "practices-units.json", {}),
    ("promote_list", ["practices", "promote", "--list", "--json"], "promote-list.json", {}),
    ("security", ["security", "--json"], "security.json", {}),
    ("map", ["map", "--json"], "map.json", {}),
]
FUNNEL = "funnel.json"
NOT_IN_BUILD = re.compile(r"unexpected argument|unrecognized (subcommand|argument|option)|Found argument|invalid value")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def drift_state(repo):
    """Paths and mtimes under the repository's .drift/ and its top-level entries: a
    command that wrote inside the repository changes this."""
    state = {}
    try:
        for name in os.listdir(repo):
            p = os.path.join(repo, name)
            state[name] = os.lstat(p).st_mtime_ns
    except OSError:
        pass
    top = os.path.join(repo, ".drift")
    for dirpath, dirnames, filenames in os.walk(top):
        for n in dirnames + filenames:
            p = os.path.join(dirpath, n)
            try:
                state[os.path.relpath(p, repo)] = os.lstat(p).st_mtime_ns
            except OSError:
                pass
    return state


def run_one(argv, out_path, err_path, env, timeout):
    """Run one process niced, stdout to a file, with a timeout; return its record."""
    start = time.monotonic()
    with open(out_path, "wb") as out, open(err_path, "wb") as err:
        pid = os.fork()
        if pid == 0:  # child
            try:
                os.nice(19)
                os.dup2(out.fileno(), 1)
                os.dup2(err.fileno(), 2)
                os.setpgid(0, 0)
                os.execve(argv[0], argv, env)
            except BaseException as e:  # noqa: BLE001
                os.write(2, f"exec failed: {e}\n".encode())
            os._exit(127)
        timed_out = False
        status = rusage = None
        while True:
            wpid, status, rusage = os.wait4(pid, os.WNOHANG)
            if wpid == pid:
                break
            if time.monotonic() - start > timeout:
                timed_out = True
                try:
                    os.killpg(pid, signal.SIGKILL)
                except OSError:
                    os.kill(pid, signal.SIGKILL)
                _, status, rusage = os.wait4(pid, 0)
                break
            time.sleep(0.01)
    wall = time.monotonic() - start
    code = os.waitstatus_to_exitcode(status) if status is not None else None
    return {
        "exit": code,
        "timed_out": timed_out,
        "wall_s": round(wall, 3),
        "user_s": round(rusage.ru_utime, 3) if rusage else None,
        "sys_s": round(rusage.ru_stime, 3) if rusage else None,
        "peak_rss_kb": rusage.ru_maxrss if rusage else None,
    }


def clear_outputs(rdir):
    """Remove every file a collect step writes in <out>/<repo>/ (the funnel and run.json
    included), so a step that fails or is skipped leaves nothing from an earlier collect
    for `score` to read as this run's."""
    names = [f for _, _, f, _ in COMMANDS] + [FUNNEL]
    for n in names:
        for stale in (n, n + ".gz", n + ".err"):
            p = os.path.join(rdir, stale)
            if os.path.lexists(p):
                os.remove(p)
    p = os.path.join(rdir, "run.json")
    if os.path.lexists(p):
        os.remove(p)


def store(path):
    """Hash the raw output, gzip it when big; return (stored name, sha256, bytes)."""
    digest = sha256_file(path)
    size = os.path.getsize(path)
    name = os.path.basename(path)
    if size > BIG:
        with open(path, "rb") as src, gzip.open(path + ".gz", "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        os.remove(path)
        name += ".gz"
    return name, digest, size


def collect(args):
    binary = os.path.abspath(args.bin)
    repos_dir = os.path.abspath(args.repos)
    out = os.path.abspath(args.out)
    names = args.only or [r for r in REPOS]
    for r in names:
        if re.search(r"held.?out|hold.?out", r, re.I):
            sys.exit(f"refusing repository name {r!r}")
    os.makedirs(out, exist_ok=True)
    version = None
    try:
        vf = os.path.join(out, ".version")
        rec = run_one([binary, "--version"], vf, vf + ".err", dict(os.environ), 60)
        if rec["exit"] == 0:
            version = open(vf, encoding="utf-8", errors="replace").read().strip()
        os.remove(vf)
        os.remove(vf + ".err")
    except OSError:
        pass
    meta = {
        "schema": SCHEMA,
        "binary": binary,
        "binary_sha256": sha256_file(binary),
        "version": version,
        "repos_dir": repos_dir,
        "cache": args.cache,
        "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "repos": {},
    }
    for repo in names:
        root = os.path.join(repos_dir, repo)
        rdir = os.path.join(out, repo)
        if os.path.isdir(rdir):
            clear_outputs(rdir)
        if not os.path.isdir(root):
            print(f"{repo}: not found under {repos_dir}, skipped", file=sys.stderr)
            continue
        os.makedirs(rdir, exist_ok=True)
        cache = os.path.join(out, ".cache", repo)
        shutil.rmtree(cache, ignore_errors=True)
        env = dict(os.environ)
        env.pop("DRIFT_FUNNEL", None)
        env.pop("DRIFT_EXPERIMENTAL", None)
        env.pop("DRIFT_STUDY_NEIGHBOUR", None)
        if args.cache == "scratch":
            os.makedirs(cache, exist_ok=True)
            env["DRIFT_CACHE_DIR"] = cache
        else:
            env.pop("DRIFT_CACHE_DIR", None)
        before = drift_state(root)
        runs = {}
        t_repo = time.monotonic()
        print(f"{repo}:", file=sys.stderr)
        for name, sub, fname, opt in COMMANDS:
            argv = [binary, "--root", root] + sub
            if args.cache == "none":
                argv.insert(1, "--no-cache")
            e = dict(env)
            stales = [os.path.join(rdir, fname)]
            if opt.get("funnel"):
                e["DRIFT_FUNNEL"] = os.path.join(rdir, FUNNEL)
                stales.append(e["DRIFT_FUNNEL"])
            outp = os.path.join(rdir, fname)
            errp = outp + ".err"
            for stale in stales:
                for p in (stale, stale + ".gz", stale + ".err"):
                    if os.path.lexists(p):
                        os.remove(p)
            rec = run_one(argv, outp, errp, e, args.timeout)
            rec["argv"] = ["<bin>"] + [("<root>" if a == root else a) for a in argv[1:]]
            err = open(errp, encoding="utf-8", errors="replace").read()
            rec["stderr_tail"] = err[-600:]
            if rec["exit"] != 0 and opt.get("optional") and NOT_IN_BUILD.search(err):
                rec["available"] = False
                rec["note"] = "not available in this build"
                os.remove(outp)
            else:
                rec["available"] = rec["exit"] == 0 and not rec["timed_out"]
                stored, digest, size = store(outp)
                rec.update({"file": stored, "sha256": digest, "bytes": size})
            if os.path.getsize(errp) == 0:
                os.remove(errp)
            runs[name] = rec
            print(
                f"  {name:20} exit {rec['exit']}  {rec['wall_s']:8.2f} s  {(rec['peak_rss_kb'] or 0) / 1024:7.0f} MiB"
                + ("  (not in this build)" if rec.get("available") is False and rec.get("note") else ""),
                file=sys.stderr,
            )
            after = drift_state(root)
            if after != before:
                changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
                meta["repos"][repo] = {"runs": runs, "aborted": "the repository changed: " + ", ".join(changed[:10])}
                shutil.rmtree(cache, ignore_errors=True)
                write_json(os.path.join(rdir, "run.json"), meta["repos"][repo])
                write_json(os.path.join(out, "collect.json"), meta)
                sys.exit(f"{repo}: the repository changed during `{name}` ({', '.join(changed[:5])}); stopped. Try --cache none.")
        funnel = os.path.join(rdir, FUNNEL)
        if os.path.exists(funnel):
            if runs["census_json"].get("available"):
                stored, digest, size = store(funnel)
                runs["census_json"]["funnel_file"] = stored
            else:  # written by a census that failed or timed out: not this run's funnel
                os.remove(funnel)
        cache_bytes = dir_bytes(cache) if args.cache == "scratch" else 0
        if not args.keep_cache:
            shutil.rmtree(cache, ignore_errors=True)
        info = {"runs": runs, "wall_s": round(time.monotonic() - t_repo, 3), "cache_bytes": cache_bytes}
        meta["repos"][repo] = info
        write_json(os.path.join(rdir, "run.json"), info)
        print(f"  total {info['wall_s']:.1f} s", file=sys.stderr)
    shutil.rmtree(os.path.join(out, ".cache"), ignore_errors=True) if not args.keep_cache else None
    meta["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_json(os.path.join(out, "collect.json"), meta)
    print(f"wrote {out} ({dir_bytes(out) / 1e6:.1f} MB)", file=sys.stderr)


def dir_bytes(path):
    n = 0
    for dirpath, _, files in os.walk(path):
        for f in files:
            try:
                n += os.lstat(os.path.join(dirpath, f)).st_size
            except OSError:
                pass
    return n


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=1, sort_keys=True)
        f.write("\n")


# --------------------------------------------------------------------------------------
# reading saved outputs
# --------------------------------------------------------------------------------------


def find(rdir, name):
    for n in (name, name + ".gz"):
        p = os.path.join(rdir, n)
        if os.path.exists(p):
            return p
    return None


def read_bytes(rdir, name):
    p = find(rdir, name)
    if p is None:
        return None
    if p.endswith(".gz"):
        with gzip.open(p, "rb") as f:
            return f.read()
    with open(p, "rb") as f:
        return f.read()


def read_json(rdir, name):
    b = read_bytes(rdir, name)
    if b is None or not b.strip():
        return None
    try:
        return json.loads(b)
    except ValueError:
        return None


# --------------------------------------------------------------------------------------
# metrics: key -> (label, good direction, guard, what it reproduces)
#   direction: up | down | same (must not change) | info
# --------------------------------------------------------------------------------------

META = {}


def metric(key, label, direction="info", guard=False, source=""):
    META[key] = {"label": label, "direction": direction, "guard": guard, "source": source}


def define_metrics():
    # entry points (security inventory)
    metric("entry.read", "Entry points read (security inventory)", "up", source="audit 4 §2 counts: 1,914; roadmap §2")
    metric("entry.guard_known", "Entry points whose guard state is known (guarded + no guard)", "up", source="audit 4 §2: 1,737 (91%)")
    metric("entry.guarded", "Entry points guarded", "info", source="audit 4 §2: 1,290")
    metric("entry.no_guard", "Entry points with no guard found", "info", source="audit 4 §2: 447")
    metric("entry.guard_unknown", "Entry points whose guard is unknown (opaque)", "down", source="audit 4 §2: 172")
    metric("entry.local", "Entry points local only", "info", source="audit 4 §2: 5")
    metric("entry.reaching_sink", "Entry points reaching a risky operation", "info", source="audit 4 §2: 153")
    metric("entry.reaching_sink_no_guard", "... of which with no guard", "info", source="audit 4 §2: 62")
    metric("entry.in_map", "Entry points in `drift map`", "up", source="audit 5 §2.5: 952 (inventory 1,914)")
    # security
    metric("sec.findings", "Security baseline findings (all kinds)", "info", source="audit 4 §2 table: 892 (4-count.py)")
    for k in ["no-guard", "unguarded-reaching", "guard-gap", "scope-gap", "risky", "whole-row", "workflow",
              "dependency", "kubernetes", "leak", "no-authorization", "unscoped-key"]:
        metric(f"sec.findings.{k}", f"Security findings: {k}", "info", source="audit 4 §2 (4-count.py)")
    metric("sec.sinks", "Risky operations (sinks)", "info", source="audit 4 §2: 419")
    metric("sec.sinks_fed", "Sinks fed by the caller", "info", source="audit 4 §2: 229")
    metric("sec.reaches", "Reaches (entry -> risky kind)", "info", source="audit 4 §2 reach kinds")
    metric("sec.reaches_fed", "Reaches marked fed", "info", source="audit 4 §2 / S6")
    metric("sec.reach.dynamic_fetch", "Reaches of kind dynamic_fetch", "info", source="audit 4 §2: 49")
    metric("sec.reach.dynamic_fetch_fed", "dynamic_fetch reaches marked fed", "down", source="S6: juice-shop 14 fed, all false")
    metric("sec.reach.dynamic_redirect", "Reaches of kind dynamic_redirect", "info", source="audit 4 §2: 66; plane 44 of 47")
    metric("sec.reach.via_webhook_notify", "Reaches ending at lib/webhook.ts#notify (juice-shop false SSRF)", "down",
           source="audit 4 unit 6 / S6: 23, 14 fed, all false")
    metric("sec.unlisted", "Unlisted handlers (Drift did not list them)", "down", source="audit 4 §2: 207; juice-shop 56 (S6)")
    metric("sec.unlisted_snippets", "Unlisted rows in data/static/codefixes (snippets that never run)", "down",
           source="audit 4 §2 / S6: juice-shop 18")
    metric("sec.sinks_snippets", "Sinks in data/static/codefixes", "down", source="audit 4 §2 / S6: juice-shop 9")
    metric("sec.guard_gaps", "Guard gaps", "info", source="audit 4 §2: 5")
    metric("sec.guard_gap_exceptions", "Guard-gap exceptions", "down", source="audit 4 §2: 8; S5: epic 1 -> 0")
    metric("sec.guard_gap_exceptions_unknown", "Guard-gap exceptions whose guard is unknown", "down", True,
           source="audit 4 gap 4: 0 today; unknown must never fail")
    metric("sec.scope_gaps", "Scope gaps", "info", source="audit 4 §2: 0")
    metric("sec.leaks", "Client leaks", "info", source="audit 4 §2: 0")
    metric("sec.workflow_findings", "Workflow findings", "info", source="audit 5 §2.6: 55")
    metric("sec.unpinned_actions", "Workflow findings: unpinned action", "info", source="audit 5 §2.4: plane 14 of 20 are plane's own (S6)")
    metric("sec.path_traversal_py", "Python path_traversal sinks", "up", source="audit 4 unit 13 / S6 (not built: S15)")
    metric("sec.check_reports", "Security findings `drift check` reports", "up",
           source="audit 4 §2: 0 (no baseline); needs a check run, not collected")
    # practice units
    for c in CONCERNS + ["all"]:
        for a in ["rows", "known", "identified", "none", "unknown"]:
            metric(f"units.{c}.{a}", f"Practice unit rows, {c}: {a}", "info",
                   source="audit 1 §2.2 (all: 12,677 rows, 9,022 known, 2,267 none, 1,388 unknown); audit 3 §2.1 per concern")
        metric(f"units.{c}.distinct", f"Practice units, {c}: distinct path#symbol#line", "info", source="audit 6 §2.2: 10,533 (all)")
        metric(f"units.{c}.distinct_unknown", f"Practice units, {c}: distinct, unknown", "down", source="audit 6 §2.2: 1,280 (all)")
        metric(f"units.{c}.distinct_none", f"Practice units, {c}: distinct, none", "info", source="audit 6 §2.2: 1,705 (all)")
        metric(f"units.{c}.distinct_variant", f"Practice units, {c}: distinct, a variant", "up", source="audit 6 §2.2: 7,548 (all)")
        metric(f"units.{c}.in_candidate_place", f"Practice units, {c}: distinct, in a promotable candidate's place", "up",
               source="audit 6 §2.2: 3,352 (all); audit 3 §2.1 per concern")
    metric("units.authn.unique_symbol", "Authn units, unique path#symbol", "info", source="audit 2 §2.1: 1,441")
    metric("units.authn.unique_symbol_known", "Authn units, unique path#symbol, known", "up", source="audit 2 §2.1: 957")
    metric("units.authz.unique_symbol", "Authz units, unique path#symbol", "info", source="audit 2 §2.1: 917")
    metric("units.authz.unique_symbol_known", "Authz units, unique path#symbol, known", "up", source="audit 2 §2.1: 507")
    metric("units.authn.none_job", "Authn none rows that are background jobs", "down", source="audit 2 §2.3: plane 47 of 51 (S1)")
    metric("units.authn.job", "Authn rows that are background jobs", "down", source="S1: jobs are not sign-in units")
    metric("units.validation.none_parse_with_zod", "Validation none rows in epic route files (S2 target: 12 of 30 validate)", "info",
           source="audit 3 unit 3 (needs reading; this is the none count in epic)")
    metric("units.authz.sides_not_caller", "Authz unknown rows: check_not_proven sides_not_caller_and_resource", "down",
           source="audit 1 §2.2 / S4: plane 102")
    metric("units.unscoped", "Units with an unscoped key (UnitRow.unscoped)", "info", source="S4: expected 0 on all seven")
    metric("units.findings.unscoped_key", "Practice findings: unscoped_key", "info", source="audit 2 §2.5: 0")
    for reason in ["unclassified", "check_not_proven", "body_unreadable", "unresolved", "route_not_matched", "not_followed",
                   "unparsed", "opaque_wrapper", "dynamic", "partly_read"]:
        metric(f"units.unknown_reason.{reason}", f"Unknown rows by reason: {reason}", "down", source="audit 1 §2.2")
    metric("units.has_kind", "Unit rows carrying `kind` (new build)", "info", source="S1")
    metric("units.has_uses", "Unit rows carrying `uses` (new build)", "info", source="S1")
    # promote candidates
    metric("cand.count", "Promote candidates", "up", source="audit 6 §2.2: 77")
    for c in CONCERNS:
        metric(f"cand.{c}", f"Promote candidates: {c}", "info", source="audit 3 §0 / §2.1")
        metric(f"cand.{c}.exceptions", f"Recorded exceptions of {c} candidates", "down", source="audit 3 §2.4 (config 33, logging 31, errors 168, api 14, data_access 22)")
        metric(f"cand.{c}.covered", f"Units under {c} candidates (sum of totals)", "up", source="audit 2 §2.2 / audit 3 §2.1")
    metric("cand.exceptions", "Recorded exceptions, all candidates", "down", source="audit 3 §2.4")
    metric("cand.unknown", "Unknown units inside candidate places", "info", source="promote-list.json")
    metric("cand.zero_exceptions", "Candidates with zero exceptions", "info", source="audit 6 §2.2: 32")
    metric("cand.small", "Candidates with fewer than 15 units", "info", source="audit 6 §2.2: 30")
    metric("cand.python", "Candidates in Python (by the example's extension)", "info", source="audit 6 §2.2: 26")
    metric("cand.preview", "Candidates of a preview concern", "info", source="audit 3 §0: 42 of 77")
    metric("cand.bubble", "Candidates whose way is bubble:framework_default", "down", source="audit 3 G4: 10 of 16 errors")
    metric("cand.passive", "Candidates listed apart as passive (counted in cand.count too; new build)", "info", source="S1")
    metric("cand.mechanism", "Candidates accepting a whole mechanism (new build)", "up", source="S1")
    metric("cand.any_enforcing", "Candidates accepting any enforcing way (new build)", "up", source="S1")
    metric("cand.signin_covered", "Units covered by a promotable sign-in or permission rule", "up",
           source="audit 2 §2.2/2.4: 645 (558 authn + 87 authz); S1 target 1,432")
    metric("cand.signin_covered_distinct", "... distinct units under those candidates' places", "up", source="audit 2 §2.4")
    metric("cand.api_covered", "Response (api) units under a candidate", "up", source="audit 3 §2.1: 241; S1 target 759")
    metric("cand.py_signin_exceptions", "Recorded exceptions of Python sign-in/permission candidates", "down",
           source="audit 9 §3: 58 (scoreboard 4 denominator)")
    metric("cand.exceptions_unknown", "Candidate exceptions whose unit is unknown", "down", True,
           source="rule 'unknown is never a violation'; guard")
    metric("cand.exceptions_unmatched", "Candidate exceptions with no unit row", "info", source="consistency")
    # census
    metric("census.text_sha256", "Plain `drift census` text, sha256", "same", True, source="sprint 2 step 4: byte-identical")
    metric("census.conventions", "Conventions proposed by census", "up", source="audit 6 §2.1 / audit 7 §2.1: 13")
    metric("census.default", "... default tier", "info", source="audit 6 §2.1: 7")
    metric("census.suggestion", "... suggestions", "info", source="audit 6 §2.1: 6")
    metric("census.withheld", "Mined cards withheld by the show policy", "info", source="audit 6 §2.1: 25")
    metric("census.units", "Census units", "info", source="census.txt line 1")
    metric("census.roles", "Census roles", "info", source="census.txt line 1; audit 5 §2.3: 1,523")
    metric("census.layering", "Census proposals avoids:import", "info", source="audit 5 §2.1: 5")
    metric("census.outliers", "Outliers of census proposals", "info", source="census --json")
    metric("census.outliers_unknown", "Census outliers the practice map calls unknown (authn/authz)", "down", True,
           source="audit 6 §2.4: cal.com D-594d38 15 of 15 (scoreboard 6, mined path)")
    metric("census.outliers_unknown_any", "Census outliers unknown for sign-in or for permission", "down",
           source="wider form of the above (cal.com apps/web/app/api/video/recording GET: authn known, authz unknown)")
    # from the map (new build)
    metric("map.entries", "Entries of `census --from-map --json`", "info", source="S10/S11")
    metric("map.proposed", "Proposals from the map (proposed: true)", "up", source="S11: plane ~18, cal.com ~32, others 0")
    metric("map.proposed.layering", "Proposals from the map: layering", "up", source="S11")
    metric("map.proposed.practice", "Proposals from the map: practice", "up", source="S10")
    metric("map.proposed.other", "Proposals from the map: other kinds", "info", source="S10/S11")
    metric("map.same_as_mined", "From-map entries that restate a mined rule", "info", source="S11")
    # funnel
    for s in ["roles", "role_small", "role_mined", "observed", "universal", "wilson", "lift", "drafted", "mined",
              "show_policy", "proposed", "shown"]:
        metric(f"funnel.{s}", f"Funnel stage {s} (DRIFT_FUNNEL)", "info", source="audit 7 §2.2 (78,631 observed; 13 shown)")
    metric("funnel.why.dropped", "Candidates dropped, census --why (new build)", "info", source="S12")
    # timing
    metric("time.census_first_s", "First census wall time, empty cache (s)", "down", source="scoreboard 7")
    metric("time.census_per_100k_s", "First census per 100,000 lines (s)", "down", source="scoreboard 7: bar < 60 s")
    metric("time.collect_s", "collect wall time for the repository (s)", "info", source="this tool")
    metric("time.peak_rss_mib", "Peak memory of any command (MiB)", "down", source="this tool")
    metric("loc", "Lines Drift counts (census --coverage)", "info", source="census --coverage --json")


define_metrics()


# --------------------------------------------------------------------------------------
# score
# --------------------------------------------------------------------------------------


def unknown_guard(e):
    return bool(e.get("opaque") or e.get("unknown") or e.get("guard_unknown"))


def guard_class(e):
    if e.get("local"):
        return "local"
    if e.get("guards"):
        return "guarded"
    if unknown_guard(e):
        return "unknown"
    if e.get("verifies_signature"):
        return "signature"
    if e.get("kind") == "consumer":
        return "consumer"
    return "no_guard"


def ratchet_findings(sec, prac):
    """Re-implementation of ratchet::findings, as audit/4-count.py does (no-guard is an
    upper bound: known_open is not serialised)."""
    F = set()

    def ung(e):
        return (not e.get("local") and e.get("kind") != "consumer" and not e.get("guards")
                and not unknown_guard(e) and not e.get("verifies_signature"))

    for e in sec.get("entry_points", []):
        k = f'{e["path"]}#{e["symbol"]} {e.get("method") or ""} {e.get("route") or ""}'
        if ung(e):
            for x in e.get("reaches", []):
                F.add(("unguarded-reaching", k + x["kind"]))
        if e.get("kind") in REQUEST_KINDS and ung(e) and not e.get("opens"):
            F.add(("no-guard", k))
    for g in sec.get("guard_gaps", []):
        for e in g.get("exceptions", []):
            F.add(("guard-gap", e["path"] + e["symbol"] + str(e.get("route")) + g["guard"]))
    for g in sec.get("scope_gaps", []):
        for e in g.get("exceptions", []):
            F.add(("scope-gap", e["path"] + e["symbol"] + str(g.get("resource"))))
    for s in sec.get("sinks", []):
        F.add(("risky", s["kind"] + s["path"] + s["symbol"]))
    for name, kind in (("whole_rows", "whole-row"), ("workflows", "workflow"), ("dependencies", "dependency"),
                       ("cluster", "kubernetes")):
        for w in sec.get(name, []) or []:
            F.add((kind, json.dumps(w, sort_keys=True)))
    for leak in sec.get("client_leaks", []):
        for c in leak.get("clients", []):
            F.add(("leak", c + str(leak.get("reaches"))))
    for f in sec.get("findings", []) or []:  # a newer build may list findings itself (unscoped-key)
        if isinstance(f, dict) and f.get("kind") in ("unscoped-key", "unscoped_key"):
            F.add(("unscoped-key", json.dumps(f, sort_keys=True)))
    if prac:
        for c in prac.get("concerns", []):
            if c["id"] == "authz":
                for u in c["units"]:
                    if u["assignment"] == "none":
                        F.add(("no-authorization", u["path"] + u["symbol"] + str(u.get("route"))))
    return Counter(k for k, _ in F)


def place_of(cand):
    p = cand.get("place") or {}
    return p.get("package", ""), p.get("dir", ""), p.get("file"), p.get("route")


def in_place(unit, place):
    pkg, d, f, route = place
    if unit.get("package", "") != pkg:
        return False
    path = unit["path"]
    if f:
        return path == f or path.endswith("/" + f) or (pkg and path == pkg + "/" + f)
    if route:
        return (unit.get("route") or "").startswith(route)
    rel = path[len(pkg) + 1:] if pkg else path
    dd = rel.rsplit("/", 1)[0] if "/" in rel else ""
    return d == "" or dd == d or dd.startswith(d + "/")


def exc_key(repo, concern, x):
    return f'{repo}|{concern}|{x.get("path")}|{x.get("symbol")}|{x.get("line")}'


def cand_key(repo, cand):
    pkg, d, f, route = place_of(cand)
    ways = sorted(w.get("key", "") for w in cand.get("ways", []))
    extra = sorted(cand.get("mechanisms") or []) + (["any_enforcing"] if cand.get("any_enforcing") else [])
    return "|".join([repo, cand.get("concern", ""), pkg, d, f or "", route or "", ",".join(ways), ",".join(extra)])


def score_repo(rdir, repo):
    m = {}
    notes = []
    run = read_json(rdir, "run.json") or {}
    runs = run.get("runs", {})

    def available(name):
        r = runs.get(name)
        return None if r is None else r.get("available")

    sec = read_json(rdir, "security.json")
    prac = read_json(rdir, "practices-units.json")
    plist = read_json(rdir, "promote-list.json")
    census_txt = read_bytes(rdir, "census.txt")
    census = read_json(rdir, "census.json")
    funnel = read_json(rdir, "funnel.json")
    why = read_json(rdir, "census-why.json")
    fmap = read_json(rdir, "census-from-map.json")
    mp = read_json(rdir, "map.json")
    cov = read_json(rdir, "coverage.json")

    # ---- entry points and security
    if sec is not None:
        E = sec.get("entry_points", [])
        cls = Counter(guard_class(e) for e in E)
        m["entry.read"] = len(E)
        m["entry.guarded"] = cls["guarded"]
        m["entry.no_guard"] = cls["no_guard"]
        m["entry.guard_unknown"] = cls["unknown"]
        m["entry.local"] = cls["local"]
        m["entry.guard_known"] = cls["guarded"] + cls["no_guard"]
        m["entry.reaching_sink"] = sum(1 for e in E if e.get("reaches"))
        m["entry.reaching_sink_no_guard"] = sum(1 for e in E if e.get("reaches") and guard_class(e) == "no_guard")
        reaches = [x for e in E for x in e.get("reaches", [])]
        m["sec.reaches"] = len(reaches)
        m["sec.reaches_fed"] = sum(1 for x in reaches if x.get("fed"))
        rk = Counter(x["kind"] for x in reaches)
        m["sec.reach.dynamic_fetch"] = rk["dynamic_fetch"]
        m["sec.reach.dynamic_fetch_fed"] = sum(1 for x in reaches if x["kind"] == "dynamic_fetch" and x.get("fed"))
        m["sec.reach.dynamic_redirect"] = rk["dynamic_redirect"]
        m["sec.reach.via_webhook_notify"] = sum(
            1 for x in reaches if (x.get("via") or [""])[-1].startswith("lib/webhook.ts#notify"))
        S = sec.get("sinks", [])
        m["sec.sinks"] = len(S)
        m["sec.sinks_fed"] = sum(1 for s in S if s.get("fed"))
        m["sec.sinks_snippets"] = sum(1 for s in S if "data/static/codefixes/" in s.get("path", ""))
        m["sec.path_traversal_py"] = sum(1 for s in S if s.get("kind") == "path_traversal" and s.get("path", "").endswith(".py"))
        U = sec.get("unlisted", []) or []
        m["sec.unlisted"] = len(U)
        m["sec.unlisted_snippets"] = sum(1 for u in U if "data/static/codefixes/" in u.get("path", ""))
        G = sec.get("guard_gaps", []) or []
        m["sec.guard_gaps"] = len(G)
        m["sec.guard_gap_exceptions"] = sum(len(g.get("exceptions", [])) for g in G)
        by_key = {(e["path"], e["symbol"], e.get("line"), e.get("route")): e for e in E}
        unk = 0
        for g in G:
            for x in g.get("exceptions", []):
                full = by_key.get((x["path"], x["symbol"], x.get("line"), x.get("route")), x)
                if unknown_guard(x) or unknown_guard(full):
                    unk += 1
        m["sec.guard_gap_exceptions_unknown"] = unk
        m["sec.scope_gaps"] = len(sec.get("scope_gaps", []) or [])
        m["sec.leaks"] = len(sec.get("client_leaks", []) or [])
        W = sec.get("workflows", []) or []
        m["sec.workflow_findings"] = len(W)
        m["sec.unpinned_actions"] = sum(1 for w in W if "unpinned" in json.dumps(w))
        F = ratchet_findings(sec, prac)
        m["sec.findings"] = sum(F.values())
        for k in ["no-guard", "unguarded-reaching", "guard-gap", "scope-gap", "risky", "whole-row", "workflow",
                  "dependency", "kubernetes", "leak", "no-authorization", "unscoped-key"]:
            m[f"sec.findings.{k}"] = F[k]
    m["sec.check_reports"] = None
    if mp is not None:
        m["entry.in_map"] = sum(ep.get("count", 0) for p in mp.get("packages", []) for ep in p.get("entry_points", []))

    # ---- practice units
    rows_by = {}  # (concern, path, symbol, line) -> [rows]
    if prac is not None:
        allc = Counter()
        reasons = Counter()
        has_kind = has_uses = 0
        unscoped = 0
        seen_all = 0
        dist_all = Counter()
        for c in prac.get("concerns", []):
            cid = c["id"]
            a = Counter(u["assignment"] for u in c["units"])
            m[f"units.{cid}.rows"] = len(c["units"])
            for k in ["known", "identified", "none", "unknown"]:
                m[f"units.{cid}.{k}"] = a[k]
            allc.update(a)
            seen = {}
            for u in c["units"]:
                rows_by.setdefault((cid, u["path"], u["symbol"], u.get("line")), []).append(u)
                key = (u["path"], u["symbol"], u.get("line"))
                if key not in seen:
                    seen[key] = u
                if u["assignment"] == "unknown":
                    reasons[u.get("reason") or "?"] += 1
                if "kind" in u:
                    has_kind += 1
                if "uses" in u:
                    has_uses += 1
                if u.get("unscoped"):
                    unscoped += 1
            d = Counter("unknown" if u["assignment"] == "unknown" else "none" if u["assignment"] == "none" else "variant"
                        for u in seen.values())
            m[f"units.{cid}.distinct"] = len(seen)
            m[f"units.{cid}.distinct_unknown"] = d["unknown"]
            m[f"units.{cid}.distinct_none"] = d["none"]
            m[f"units.{cid}.distinct_variant"] = d["variant"]
            dist_all.update(d)
            seen_all += len(seen)
            if cid in ("authn", "authz"):
                us = {}
                for u in c["units"]:
                    us.setdefault((u["path"], u["symbol"]), u)
                m[f"units.{cid}.unique_symbol"] = len(us)
                m[f"units.{cid}.unique_symbol_known"] = sum(1 for u in us.values() if u["assignment"] in ("known", "identified"))
            if cid == "authz":
                m["units.authz.sides_not_caller"] = sum(
                    1 for u in c["units"] if u["assignment"] == "unknown"
                    and (u.get("not_proven") or {}).get("obligation") == "sides_not_caller_and_resource")
            if cid == "validation" and repo == "epic":
                m["units.validation.none_parse_with_zod"] = a["none"]
        m["units.all.rows"] = sum(allc.values())
        for k in ["known", "identified", "none", "unknown"]:
            m[f"units.all.{k}"] = allc[k]
        m["units.all.distinct"] = seen_all
        m["units.all.distinct_unknown"] = dist_all["unknown"]
        m["units.all.distinct_none"] = dist_all["none"]
        m["units.all.distinct_variant"] = dist_all["variant"]
        for reason in ["unclassified", "check_not_proven", "body_unreadable", "unresolved", "route_not_matched",
                       "not_followed", "unparsed", "opaque_wrapper", "dynamic", "partly_read"]:
            m[f"units.unknown_reason.{reason}"] = reasons[reason]
        new_rows = has_kind > 0 or has_uses > 0
        m["units.has_kind"] = has_kind
        m["units.has_uses"] = has_uses
        m["units.unscoped"] = unscoped if new_rows else None
        # entry kind of authn rows: the row's own `kind` (new build) or the inventory's
        kinds = {}
        if sec is not None:
            for e in sec.get("entry_points", []):
                kinds[(e["path"], e["symbol"], e.get("line"))] = e.get("kind")
        authn = next((c for c in prac.get("concerns", []) if c["id"] == "authn"), None)
        if authn is not None:
            def kind_of(u):
                return u.get("kind") or kinds.get((u["path"], u["symbol"], u.get("line")))
            m["units.authn.job"] = sum(1 for u in authn["units"] if kind_of(u) == "job")
            m["units.authn.none_job"] = sum(1 for u in authn["units"] if u["assignment"] == "none" and kind_of(u) == "job")
        m["units.findings.unscoped_key"] = sum(1 for f in prac.get("findings", []) or [] if f.get("kind") == "unscoped_key")
        if sec is not None:
            m["sec.findings.unscoped-key"] = m.get("sec.findings.unscoped-key", 0)

    # ---- promote candidates
    cand_keys = []
    exc_keys = []
    if plist is not None:
        # `promote --list --json` lists the candidates code follows by doing nothing apart,
        # under `passive`: they are candidates all the same, so every number below counts
        # them, and `cand.passive` counts them apart. A list with no `passive` key is from
        # an older build: `cand.passive` is None there, and `diff` calls the candidate
        # numbers of such a side not comparable with a side that has the key.
        passive = [x["candidate"] for x in plist.get("passive", []) or []]
        C = [x["candidate"] for x in plist.get("candidates", [])] + passive
        m["cand.count"] = len(C)
        new_cands = prac is not None and (m.get("units.has_kind", 0) > 0 or m.get("units.has_uses", 0) > 0)
        per = Counter(c["concern"] for c in C)
        for cid in CONCERNS:
            m[f"cand.{cid}"] = per[cid]
            m[f"cand.{cid}.exceptions"] = sum(len(c.get("exceptions", [])) for c in C if c["concern"] == cid)
            m[f"cand.{cid}.covered"] = sum(c.get("total", 0) for c in C if c["concern"] == cid)
        m["cand.exceptions"] = sum(len(c.get("exceptions", [])) for c in C)
        m["cand.unknown"] = sum(c.get("unknown", 0) for c in C)
        m["cand.zero_exceptions"] = sum(1 for c in C if not c.get("exceptions"))
        m["cand.small"] = sum(1 for c in C if c.get("total", 0) < 15)
        m["cand.python"] = sum(1 for c in C if ((c.get("example") or {}).get("path") or "").endswith(".py"))
        m["cand.preview"] = sum(1 for c in C if c["concern"] in PREVIEW)
        m["cand.bubble"] = sum(1 for c in C if any(w.get("key", "").startswith("bubble:") for w in c.get("ways", [])))
        m["cand.passive"] = len(passive) if "passive" in plist else None
        m["cand.mechanism"] = sum(1 for c in C if c.get("mechanisms")) if new_cands else None
        m["cand.any_enforcing"] = sum(1 for c in C if c.get("any_enforcing")) if new_cands else None
        sign = [c for c in C if c["concern"] in ("authn", "authz")]
        m["cand.signin_covered"] = sum(c.get("total", 0) for c in sign)
        m["cand.api_covered"] = m["cand.api.covered"]
        m["cand.py_signin_exceptions"] = sum(
            len(c.get("exceptions", [])) for c in sign
            if repo in PYTHON_REPOS and ((c.get("example") or {}).get("path") or "").endswith(".py"))
        # exceptions whose unit is unknown (guard), and units in candidate places
        unk = unmatched = 0
        for c in C:
            for x in c.get("exceptions", []):
                rr = rows_by.get((c["concern"], x["path"], x["symbol"], x.get("line")))
                if rr is None:
                    unmatched += 1
                elif any(r["assignment"] == "unknown" for r in rr):
                    unk += 1
        m["cand.exceptions_unknown"] = unk if prac is not None else None
        m["cand.exceptions_unmatched"] = unmatched if prac is not None else None
        if prac is not None:
            places = defaultdict(list)
            for c in C:
                places[c["concern"]].append(place_of(c))
            tot = 0
            sign_distinct = set()
            for c in prac.get("concerns", []):
                seen = set()
                for u in c["units"]:
                    key = (u["path"], u["symbol"], u.get("line"))
                    if key in seen:
                        continue
                    if any(in_place(u, p) for p in places.get(c["id"], [])):
                        seen.add(key)
                m[f"units.{c['id']}.in_candidate_place"] = len(seen)
                tot += len(seen)
                if c["id"] in ("authn", "authz"):
                    sign_distinct |= {(c["id"],) + k for k in seen}
            m["units.all.in_candidate_place"] = tot
            m["cand.signin_covered_distinct"] = len(sign_distinct)
        cand_keys = [cand_key(repo, c) for c in C]
        exc_keys = sorted({exc_key(repo, c["concern"], x) for c in sign
                           if repo in PYTHON_REPOS and ((c.get("example") or {}).get("path") or "").endswith(".py")
                           for x in c.get("exceptions", [])})

    # ---- census
    if census_txt is not None:
        m["census.text_sha256"] = hashlib.sha256(census_txt).hexdigest()
        first = census_txt.decode("utf-8", "replace").splitlines()[0] if census_txt.strip() else ""
        mm = re.match(r"(\d+) conventions? from (\d+) units in (\d+) roles \((\d+) default tier, (\d+) suggestions?\)", first)
        if mm:
            m["census.conventions"], m["census.units"], m["census.roles"], m["census.default"], m["census.suggestion"] = (
                int(g) for g in mm.groups())
        else:
            notes.append(f"census.txt line 1 not understood: {first[:80]!r}")
        wm = re.search(r"(\d+) mined card\(s\) withheld", census_txt.decode("utf-8", "replace"))
        m["census.withheld"] = int(wm.group(1)) if wm else 0
    census_ids = []
    if census is not None:
        P = census.get("proposals", [])
        census_ids = [p.get("id") for p in P]
        if "census.conventions" not in m:
            m["census.conventions"] = len(P)
        m["census.layering"] = sum(1 for p in P if p.get("rule_kind") == "avoids:import")
        m["census.outliers"] = sum(len(p.get("outliers", [])) for p in P)
        if prac is not None:
            n = n_any = 0
            for p in P:
                for o in p.get("outliers", []):
                    hit = {cid for cid in ("authn", "authz")
                           if any(r["assignment"] == "unknown"
                                  for r in rows_by.get((cid, o.get("path"), o.get("symbol"), o.get("line")), []))}
                    n += "authn" in hit
                    n_any += bool(hit)
            m["census.outliers_unknown"] = n
            m["census.outliers_unknown_any"] = n_any

    # ---- from the map (new build only)
    fm_ids = []
    if fmap is not None:
        entries = from_map_entries(fmap)
        m["map.entries"] = len(entries)
        prop = [e for e in entries if e.get("proposed")]
        m["map.proposed"] = len(prop)
        k = Counter(str(e.get("kind", "?")) for e in prop)
        m["map.proposed.layering"] = sum(v for kk, v in k.items() if "layer" in kk)
        m["map.proposed.practice"] = sum(v for kk, v in k.items() if "practice" in kk)
        m["map.proposed.other"] = sum(v for kk, v in k.items() if "layer" not in kk and "practice" not in kk)
        for kk, v in k.items():
            key = f"map.proposed.kind.{kk}"
            if key not in META:
                metric(key, f"Proposals from the map, kind {kk}", "info", source="census --from-map --json")
            m[key] = v
        m["map.same_as_mined"] = sum(1 for e in entries if e.get("same_rule"))
        fm_ids = [str(e.get("id")) for e in prop]
    elif available("census_from_map") is False:
        for key in ["map.entries", "map.proposed", "map.proposed.layering", "map.proposed.practice", "map.proposed.other",
                    "map.same_as_mined"]:
            m[key] = None
        notes.append("census --from-map --json: not available in this build")

    # ---- funnel
    if funnel is not None:
        st = Counter()
        for row in funnel.get("rows", []):
            st[row.get("stage")] += row.get("n", 0)
        for s in ["roles", "role_small", "role_mined", "observed", "universal", "wilson", "lift", "drafted", "mined",
                  "show_policy", "proposed", "shown"]:
            m[f"funnel.{s}"] = st[s]
    if why is not None:
        m["funnel.why.dropped"] = sum(g.get("dropped", 0) for g in why.get("gates", []))
        for g in why.get("gates", []):
            key = f"funnel.why.gate.{g.get('name')}"
            if key not in META:
                metric(key, f"census --why: dropped at gate {g.get('name')}", "info", source="S12")
            m[key] = g.get("dropped", 0)
        for s, v in (why.get("reached") or {}).items():
            key = f"funnel.why.reached.{s}"
            if key not in META:
                metric(key, f"census --why: reached stage {s}", "info", source="S12")
            m[key] = v
    elif available("census_why") is False:
        m["funnel.why.dropped"] = None
        notes.append("census --why --json: not available in this build")

    # ---- timing
    if cov is not None:
        m["loc"] = cov.get("loc")
    first = runs.get("census")
    if first and first.get("available"):
        m["time.census_first_s"] = first.get("wall_s")
        if m.get("loc"):
            m["time.census_per_100k_s"] = round(first["wall_s"] * 100000 / m["loc"], 2)
    if run.get("wall_s") is not None:
        m["time.collect_s"] = run.get("wall_s")
    rss = [r.get("peak_rss_kb") or 0 for r in runs.values() if r.get("available")]
    if rss:
        m["time.peak_rss_mib"] = round(max(rss) / 1024, 1)

    labels = {"candidates": cand_keys, "census": census_ids, "from_map": fm_ids, "exceptions": exc_keys}
    return m, notes, labels


def failed_commands(rdir):
    """Collect steps of this repository that did not exit 0 within the timeout (crashed,
    timed out, or not run), from run.json; an optional command this build does not have is not a
    failure. None when there is no run.json (outputs saved by hand, as the baseline's)."""
    run = read_json(rdir, "run.json")
    if run is None:
        return None
    runs = run.get("runs", {})
    out = []
    for name, _, _, _ in COMMANDS:
        r = runs.get(name)
        if r is None or (not r.get("available") and not r.get("note")):
            out.append(name)
    return out


def from_map_entries(v):
    if isinstance(v, list):
        return [e for e in v if isinstance(e, dict)]
    if isinstance(v, dict):
        for key in ("entries", "proposals", "from_map", "rules"):
            if isinstance(v.get(key), list):
                return [e for e in v[key] if isinstance(e, dict)]
        for val in v.values():
            if isinstance(val, list) and val and isinstance(val[0], dict) and "proposed" in val[0]:
                return val
    return []


def total(values):
    nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not nums:
        return None
    t = sum(nums)
    return round(t, 3) if isinstance(t, float) else t


def score(args):
    data = os.path.abspath(args.data)
    truth = os.path.abspath(args.truth) if args.truth else os.path.join(os.path.dirname(os.path.abspath(__file__)), "truth")
    repos = [r for r in REPOS if os.path.isdir(os.path.join(data, r))]
    out = {"schema": SCHEMA, "data": data, "repos": {}, "notes": {}, "labels": {}, "failed": {}}
    cmeta = read_json(data, "collect.json")
    if cmeta:
        out["build"] = {k: cmeta.get(k) for k in ("binary", "binary_sha256", "version", "started", "cache")}
    for r in repos:
        m, notes, labels = score_repo(os.path.join(data, r), r)
        out["repos"][r] = m
        out["labels"][r] = labels
        failed = failed_commands(os.path.join(data, r))
        if failed is not None:
            out["failed"][r] = failed
        if notes:
            out["notes"][r] = notes
    keys = sorted({k for m in out["repos"].values() for k in m})
    out["total"] = {k: total(m.get(k) for m in out["repos"].values()) for k in keys if not k.endswith("sha256")}
    t = out["total"]
    timed = [r for r, m in out["repos"].items() if m.get("time.census_first_s") and m.get("loc")]
    t["time.census_per_100k_s"] = rate(out, timed)
    out["timed_repos"] = timed  # the total rate covers these repositories only
    t["time.peak_rss_mib"] = max((m.get("time.peak_rss_mib") or 0 for m in out["repos"].values()), default=None) or None
    out["truth"] = score_truth(truth, out)
    out["scoreboard"] = scoreboard(out)
    out["meta"] = {k: META[k] for k in keys if k in META}
    text = json.dumps(out, indent=1, sort_keys=True) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    print_score(out)


def score_truth(truth, out):
    res = {"dir": truth}
    rules = load_json_file(os.path.join(truth, "rules.json"))
    if rules:
        R = rules["rules"]
        res["rules"] = {
            "total": len(R),
            "audit": dict(Counter(x["state"] for x in R)),
            "after": dict(Counter(x.get("state_after") or "unlabelled" for x in R)),
            "audit_by_audit": {a: dict(Counter(x["state"] for x in R if x["audit"].startswith(a))) for a in ("audit 8", "audit 9")},
            "after_by_audit": {a: dict(Counter(x.get("state_after") or "unlabelled" for x in R if x["audit"].startswith(a)))
                               for a in ("audit 8", "audit 9")},
        }
    props = load_json_file(os.path.join(truth, "proposals.json"))
    if props:
        lab = {p["key"]: p for p in props["candidates"]}
        per = {}
        for lang in ("ts", "py"):
            got = Counter()
            for r, L in out["labels"].items():
                if (r in PYTHON_REPOS) != (lang == "py"):
                    continue
                for k in L["candidates"]:
                    p = lab.get(k)
                    got[(p or {}).get("keep") or "unlabelled"] += 1
            per[lang] = dict(got)
        res["candidates"] = per
        clab = {p["id"]: p for p in props.get("census", [])}
        got = Counter()
        for r, L in out["labels"].items():
            for i in L["census"]:
                got[(clab.get(f"{r}:{i}") or {}).get("keep") or "unlabelled"] += 1
        res["census"] = dict(got)
        flab = {p["id"]: p for p in props.get("from_map", [])}
        got = Counter()
        for r, L in out["labels"].items():
            for i in L["from_map"]:
                got[(flab.get(f"{r}:{i}") or {}).get("keep") or "unlabelled"] += 1
        res["from_map"] = dict(got)
    exc = load_json_file(os.path.join(truth, "exceptions.json"))
    if exc:
        lab = {exc_key(e["repository"], e["concern"], e): e.get("real") for e in exc["exceptions"]}
        got = Counter()
        for r, L in out["labels"].items():
            for k in L.get("exceptions", []):
                v = lab.get(k)
                got["unlabelled" if v is None else "real" if v else "not_real"] += 1
        res["exceptions"] = {"in_data": sum(got.values()), "real": got["real"], "not_real": got["not_real"],
                             "unlabelled": got["unlabelled"], "truth_rows": len(exc["exceptions"])}
    return res


def load_json_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def scoreboard(out):
    t = out["total"]
    tr = out.get("truth", {})
    rules = tr.get("rules") or {}
    cands = tr.get("candidates") or {}
    exc = tr.get("exceptions") or {}

    def keep(d):
        return d.get("yes", 0), sum(d.values()), d.get("unlabelled", 0), d.get("yes_qualified", 0)

    sb = []
    a = rules.get("after", {})
    sb.append({"n": 1, "name": "Real team rules enforceable (of 96)", "automatic": "labels",
               "audit": rules.get("audit", {}).get("E"),
               "after": None if a.get("unlabelled", 0) == rules.get("total") else a.get("E"),
               "unlabelled": a.get("unlabelled"),
               "how": "truth/rules.json: a person sets state_after (E/M/P/N) per rule after the build"})
    ts, py = cands.get("ts", {}), cands.get("py", {})
    def share(d):
        n = sum(v for k, v in d.items() if k != "unlabelled")
        return {"labelled": n, "unlabelled": d.get("unlabelled", 0), "yes": d.get("yes", 0),
                "yes_qualified": d.get("yes_qualified", 0),
                "share_yes": round(d.get("yes", 0) / n, 3) if n else None,
                "share_yes_or_qualified": round((d.get("yes", 0) + d.get("yes_qualified", 0)) / n, 3) if n else None} if d else None

    sb.append({"n": 2, "name": "Share of proposals a team would keep (bar 70%)", "automatic": "labels",
               "candidates_ts": share(cands.get("ts", {})), "candidates_py": share(cands.get("py", {})),
               "census": tr.get("census"), "from_map": tr.get("from_map"),
               "how": "truth/proposals.json: one verdict per candidate key and census id (audits 8 and 9 for the before); "
                      "new candidates and proposals count as unlabelled until a person adds a verdict"})
    sb.append({"n": 3, "name": "Share of reports on new code that are true, per rule kind", "automatic": "no",
               "value": None, "how": "needs full history, a replay and labels (sprint 2 step 6): not computable from these outputs"})
    sb.append({"n": 4, "name": "Recorded exceptions that are real departures (Python sign-in and permissions)",
               "automatic": "denominator yes, numerator labels", "denominator": t.get("cand.py_signin_exceptions"),
               "real": exc.get("real"), "not_real": exc.get("not_real"), "unlabelled": exc.get("unlabelled"),
               "how": "truth/exceptions.json: real true/false per exception (path, symbol, line); new exceptions need one"})
    sb.append({"n": 5, "name": "Known holes of juice-shop, NodeGoat and pygoat that `drift check` reports as new",
               "automatic": "no", "value": None,
               "proxy_inventory_findings": total(out["repos"].get(r, {}).get("sec.findings") for r in VULNERABLE),
               "how": "needs `drift check` on a diff that adds each hole (forbidden here) and a list of the holes"})
    sb.append({"n": 6, "name": "Units a check fails on although Drift could not read them", "automatic": "3 of 4 paths",
               "mined_outliers_unknown": t.get("census.outliers_unknown"),
               "promoted_exceptions_unknown": t.get("cand.exceptions_unknown"),
               "guard_gap_exceptions_unknown": t.get("sec.guard_gap_exceptions_unknown"),
               "diff_added_without_guard_unknown": None,
               "how": "the fourth path (security --diff-base added_without_guard) needs a diff"})
    sb.append({"n": 7, "name": "First census on 100,000 lines (s)", "automatic": "yes",
               "value": t.get("time.census_per_100k_s"),
               "per_repo": {r: m.get("time.census_per_100k_s") for r, m in out["repos"].items()},
               "how": "collect: plain census with an empty cache, wall time / (census --coverage loc / 100,000)"})
    sb.append({"n": 8, "name": "Check after one edited file, 95th percentile", "automatic": "no", "value": None,
               "how": "needs timed `drift check` runs after an edit, on a copy (check is not run by collect)"})
    return sb


def fmt(v):
    if v is None:
        return "n/a"
    if isinstance(v, str):
        return v[:8]
    if isinstance(v, float):
        return f"{v:g}"
    return f"{v:,}"


def print_score(out):
    repos = list(out["repos"])
    print("Scoreboard (roadmap section 3)")
    for s in out["scoreboard"]:
        vals = {k: v for k, v in s.items() if k not in ("n", "name", "how", "automatic", "per_repo")}
        print(f"  {s['n']}. {s['name']} [{s['automatic']}]: " + ", ".join(f"{k}={fmt(v) if not isinstance(v, dict) else v}"
                                                                         for k, v in vals.items()))
    print()
    head = f"{'number':58}" + "".join(f"{SHORT.get(r, r)[:9]:>10}" for r in repos) + f"{'total':>11}"
    print(head)
    groups = defaultdict(list)
    for k in sorted(out["total"].keys() | {k for m in out["repos"].values() for k in m}):
        groups[k.split(".")[0]].append(k)
    for g in groups:
        for k in groups[g]:
            label = k if len(k) <= 57 else k[:54] + "..."
            row = f"{label:58}" + "".join(f"{fmt(out['repos'][r].get(k)):>10}" for r in repos)
            row += f"{fmt(out['total'].get(k)):>11}"
            print(row)
    for r, n in out.get("notes", {}).items():
        for x in n:
            print(f"note: {r}: {x}")
    for r, n in out.get("failed", {}).items():
        if n:
            print(f"failed: {r}: " + ", ".join(n) + " did not exit 0 within the timeout (see run.json)")


# --------------------------------------------------------------------------------------
# diff
# --------------------------------------------------------------------------------------


def load_score(path):
    if os.path.isdir(path):
        p = os.path.join(path, "score.json")
        if os.path.exists(p):
            return load_json_file(p)

        class A:
            pass

        a = A()
        a.data, a.truth, a.out = path, None, None
        import contextlib
        import io

        buf = io.StringIO()
        tmp = os.path.join(path, ".score.tmp.json")
        a.out = tmp
        with contextlib.redirect_stdout(buf):
            score(a)
        s = load_json_file(tmp)
        os.remove(tmp)
        return s
    return load_json_file(path)


# The collect steps each guard number is computed from: a guard with no "after" value
# names them (the ones run.json records as failed, when it is there).
GUARD_NEEDS = {
    "census.text_sha256": ["census"],
    "sec.guard_gap_exceptions_unknown": ["security"],
    "cand.exceptions_unknown": ["promote_list", "practices_units"],
    "census.outliers_unknown": ["census_json", "practices_units"],
}
NOT_COMPARABLE = "not comparable (older build)"


def counts_passive(k):
    """Numbers that count passive candidates, which an older build's promote list did not
    list apart (no `passive` key)."""
    return k.startswith("cand.") or k.endswith(".in_candidate_place")


def passive_split_differs(b, a, repos):
    """Repositories where one side's promote list has a `passive` list and the other's
    has none: their candidate numbers are not comparable."""
    out = []
    for r in repos:
        x, y = b["repos"][r], a["repos"][r]
        if x.get("cand.count") is None or y.get("cand.count") is None:
            continue
        if (x.get("cand.passive") is None) != (y.get("cand.passive") is None):
            out.append(r)
    return out


def guard_missing(a, repos, k, av):
    """One line per repository where guard `k` has no value after: the run cannot say
    whether the guard held, so it fails."""
    lines = []
    for r, y in zip(repos, av):
        if y is not None:
            continue
        need = GUARD_NEEDS.get(k, [])
        failed = (a.get("failed") or {}).get(r)
        named = [n for n in need if n in failed] if failed is not None else []
        cmds = " or ".join("`drift " + " ".join(sub) + "`" for n, sub, _, _ in COMMANDS if n in (named or need))
        how = "failed or timed out" if named else "failed, timed out or was not collected"
        lines.append(f"{r}: {k} has no value after: {cmds or 'its command'} {how} (see <data>/{r}/run.json)")
    return lines


def diff(args):
    b, a = load_score(args.before), load_score(args.after)
    if b is None or a is None:
        sys.exit("diff: each side is a score.json, or a data directory (scored on the fly)")
    repos = [r for r in REPOS if r in b["repos"] and r in a["repos"]]
    meta = dict(b.get("meta", {}))
    meta.update(a.get("meta", {}))
    meta.update({k: v for k, v in META.items()})
    # every guard is judged, even one neither side computed: a guard with no value after fails
    keys = sorted({k for r in repos for k in list(b["repos"][r]) + list(a["repos"][r])} | set(GUARD_NEEDS))
    regressions = []
    missing = []
    split = passive_split_differs(b, a, repos)
    not_comparable = []
    rows = []
    for k in keys:
        md = meta.get(k, {"label": k, "direction": "info", "guard": False})
        bv = [b["repos"][r].get(k) for r in repos]
        av = [a["repos"][r].get(k) for r in repos]
        if k.endswith("sha256"):
            bt = at = None
        else:
            both = [(x, y) for x, y in zip(bv, av) if isinstance(x, (int, float)) and isinstance(y, (int, float))]
            bt = total(x for x, _ in both) if both else total(bv)
            at = total(y for _, y in both) if both else total(av)
            if k == "time.peak_rss_mib":
                bt = max((x for x, _ in both), default=None)
                at = max((y for _, y in both), default=None)
            elif k == "time.census_per_100k_s":
                bt, at = (rate(s, [r for r, (x, y) in zip(repos, zip(bv, av))
                                   if isinstance(x, (int, float)) and isinstance(y, (int, float))]) for s in (b, a))
        changed = bv != av
        if split and counts_passive(k):
            keep = [i for i, r in enumerate(repos) if r not in split]
            verdict = judge(md, [bv[i] for i in keep], [av[i] for i in keep], k)
            if verdict != "worse":
                verdict = NOT_COMPARABLE
            not_comparable.append(k)
        else:
            verdict = judge(md, bv, av, k)
        if md.get("guard"):
            lost = guard_missing(a, repos, k, av)
            if lost:
                verdict = "missing"
                missing.extend(lost)
        if md.get("guard") and verdict == "worse":
            regressions.append(k)
        rows.append((k, md, bv, av, bt, at, changed, verdict))
    # the "unknown does not rise without a matching fall" guard, per repository and concern
    unknown_guard_fail = []
    for r in repos:
        for c in CONCERNS:
            g = lambda s, x: s["repos"][r].get(f"units.{c}.{x}")  # noqa: E731
            if g(b, "unknown") is None or g(a, "unknown") is None:
                continue
            du = g(a, "unknown") - g(b, "unknown")
            known_b = (g(b, "known") or 0) + (g(b, "identified") or 0)
            known_a = (g(a, "known") or 0) + (g(a, "identified") or 0)
            fall = max(0, (g(b, "none") or 0) - (g(a, "none") or 0)) + max(0, known_b - known_a)
            if du > fall:
                unknown_guard_fail.append(f"{r} {c}: unknown +{du}, none/known fell by {fall}")
    if args.json:
        print(json.dumps({"repos": repos, "rows": [
            {"key": k, "label": md.get("label"), "direction": md.get("direction"), "guard": md.get("guard"),
             "before": dict(zip(repos, bv)), "after": dict(zip(repos, av)), "total_before": bt, "total_after": at,
             "verdict": v} for k, md, bv, av, bt, at, ch, v in rows if ch or not args.changed],
            "guard_regressions": regressions, "guard_missing": missing, "unknown_guard": unknown_guard_fail,
            "not_comparable": {"repos": split, "keys": not_comparable}}, indent=1))
    else:
        w = 9
        head = f"{'number':52} {'good':4} " + "".join(f"{SHORT.get(r, r)[:w]:>{2 * w + 3}}" for r in repos) + f"{'total':>{2 * w + 6}}"
        print(head)
        for k, md, bv, av, bt, at, ch, v in rows:
            if args.changed and not ch:
                continue
            mark = {"better": "+", "worse": "-", "same": " ", "changed": "~", "n/a": " ", NOT_COMPARABLE: "?",
                    "missing": "?"}[v]
            if md.get("guard"):
                mark = {"worse": "GUARD!", "missing": "GUARD MISSING", NOT_COMPARABLE: "guard ?"}.get(v, "guard")
            arrow = {"up": "up", "down": "down", "same": "=", "info": ""}[md.get("direction", "info")]
            label = k if len(k) <= 51 else k[:48] + "..."
            cells = "".join(f"{pair(x, y):>{2 * w + 3}}" for x, y in zip(bv, av))
            print(f"{label:52} {arrow:4} {cells}{pair(bt, at):>{2 * w + 6}}  {mark}")
        print()
        if a.get("scoreboard"):
            print("Scoreboard after:")
            for s in a["scoreboard"]:
                vals = {kk: vv for kk, vv in s.items() if kk not in ("n", "name", "how", "automatic", "per_repo")}
                print(f"  {s['n']}. {s['name']}: " + ", ".join(f"{kk}={fmt(vv) if not isinstance(vv, dict) else vv}"
                                                              for kk, vv in vals.items()))
        print()
        for k in regressions:
            md = meta.get(k, {})
            print(f"GUARD REGRESSION: {k} ({md.get('label')}): " + ", ".join(
                f"{r} {fmt(b['repos'][r].get(k))} -> {fmt(a['repos'][r].get(k))}" for r in repos
                if b["repos"][r].get(k) != a["repos"][r].get(k)))
        for x in unknown_guard_fail:
            print(f"GUARD REGRESSION: unknown rose without a matching fall: {x}")
        for x in missing:
            print(f"GUARD MISSING: {x}")
        if split:
            print(f"{NOT_COMPARABLE}: the candidate numbers (cand.*, units.*.in_candidate_place) of "
                  + ", ".join(split) + ": one side's `practices promote --list --json` has no `passive` list,"
                  " so it counted passive candidates another way; marked ?, not a rise or a drop")
        if "census.text_sha256" in regressions:
            print("  the plain census text moved: compare <dir>/<repo>/census.txt of the two data directories"
                  " (diff -u); plain census never lists the map's proposals (only `census --from-map` does)")
        if not regressions and not unknown_guard_fail and not missing:
            print("guards: none regressed")
    sys.exit(1 if regressions or unknown_guard_fail or missing else 0)


def rate(s, repos):
    """First-census seconds per 100,000 lines over these repositories together."""
    secs = sum(s["repos"][r].get("time.census_first_s") or 0 for r in repos)
    loc = sum(s["repos"][r].get("loc") or 0 for r in repos)
    return round(secs * 100000 / loc, 2) if repos and loc else None


def pair(x, y):
    if x == y:
        return fmt(x)
    return f"{fmt(x)}>{fmt(y)}"


def judge(md, bv, av, k):
    d = md.get("direction", "info")
    if all(x is None for x in av) or all(x is None for x in bv):
        return "n/a" if bv == av else "changed"
    if d == "same":
        worse = any(x is not None and y is not None and x != y for x, y in zip(bv, av)) or any(
            x is not None and y is None for x, y in zip(bv, av))
        return "worse" if worse else "same"
    pairs = [(x, y) for x, y in zip(bv, av) if isinstance(x, (int, float)) and isinstance(y, (int, float))]
    if not pairs or all(x == y for x, y in pairs):
        return "same"
    if d == "info":
        return "changed"
    up = d == "up"
    if md.get("guard"):  # a guard regresses when any repository moves the bad way
        bad = any((y < x) if up else (y > x) for x, y in pairs)
        return "worse" if bad else "better"
    s = sum(y - x for x, y in pairs)
    if s == 0:
        return "changed"
    return "better" if (s > 0) == up else "worse"


# --------------------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="run the read-only commands and save raw outputs")
    c.add_argument("--bin", required=True, help="the drift binary")
    c.add_argument("--repos", required=True, help="directory holding the sample repositories")
    c.add_argument("--out", required=True, help="where raw outputs go (one directory per repository)")
    c.add_argument("--only", nargs="*", help="repositories to run (default: all seven)")
    c.add_argument("--timeout", type=float, default=1800.0, help="seconds per command (default 1800)")
    c.add_argument("--cache", choices=["scratch", "none"], default="scratch",
                   help="scratch: fact cache in <out>/.cache (DRIFT_CACHE_DIR), emptied per repository; none: --no-cache")
    c.add_argument("--keep-cache", action="store_true", help="keep <out>/.cache afterwards")
    s = sub.add_parser("score", help="compute every number from saved outputs")
    s.add_argument("--data", required=True)
    s.add_argument("--truth", default=None, help="default: truth/ beside this script")
    s.add_argument("--out", default=None, help="also write the score as JSON here")
    d = sub.add_parser("diff", help="before and after; exits 1 on a guard regression")
    d.add_argument("before", help="score.json or data directory")
    d.add_argument("after", help="score.json or data directory")
    d.add_argument("--changed", action="store_true", help="only numbers that changed")
    d.add_argument("--json", action="store_true")
    args = ap.parse_args()
    {"collect": collect, "score": score, "diff": diff}[args.cmd](args)


if __name__ == "__main__":
    main()
