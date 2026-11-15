#!/usr/bin/env python3
"""Hook paths and phase times from DRIFT_HOOK_TRACE (trace build), on two policies.

usage: tracebench.py OUTDIR REPS repo...
Policies: "all" = every proposal of `init` accepted (advise), "all-block" = the same in block
mode, "accept-only" = the pilot's rule rebuilt on this binary: proposals labelled ACCEPT (v3
labels) in block mode, every other proposal rejected (the pilot's own policy files are gone). Workload per rep: SessionStart; for each file the pilot's agent changed and for 15
seeded entry-point files from `drift security --json`: PreToolUse, edit, PostToolUse, restore;
a README.md edit; Stop twice with nothing changed. The untraced main binary runs the same
PostToolUse once per file in rep 0 (overhead check).
"""
import json, os, random, re, shutil, subprocess, sys, time

S = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
ME = f"{S}/r13h-agentproof"
PILOT = "/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/abv2-pilot"
TRACE = f"{ME}/bin/drift-trace"
MAIN = "/home/user/drift-bin/main175/drift"
RUN = {"dub": "dub-d-domains-count-quick", "infisical": "infisical-e-split-user-mfa", "midday": "midday-f-budgets-session"}
OUT, REPS, REPOS = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
wall = open(f"{OUT}/wall.jsonl", "a")


def wait_mem():
    while int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0]) < 4 * 1024 * 1024:
        time.sleep(30)


def hook(exe, event, w, sess, rel=None, tool=None, trace=None):
    d = {"session_id": sess, "cwd": w, "hook_event_name": event}
    if event == "SessionStart": d["source"] = "startup"
    if tool:
        d["tool_name"] = tool
        d["tool_input"] = {"file_path": f"{w}/{rel}", "old_string": "x", "new_string": "y"}
        if event == "PostToolUse": d["tool_response"] = {"success": True}
    if event == "Stop": d["stop_hook_active"] = False
    env = dict(os.environ)
    env.pop("DRIFT_CACHE_DIR", None)
    if trace: env["DRIFT_HOOK_TRACE"] = trace
    wait_mem()
    t = time.perf_counter()
    subprocess.run([exe, "hook", "claude", event], input=json.dumps(d), cwd=w, env=env, capture_output=True, text=True)
    return time.perf_counter() - t


def pilot_files(repo, w):
    # The pilot agent's existing files, as recorded by latbench.py (the pilot scratch is gone).
    for l in open(f"{ME}/lat/out/hooks.jsonl"):
        r = json.loads(l)
        if r.get("metric") == "files" and r["repo"] == repo:
            return [f for f in r["existing"] if os.path.isfile(f"{w}/{f}")]
    return []


def entry_files(repo, w, n=15):
    inv = json.load(open(f"{ME}/sec/{repo}.json"))
    fs = sorted({e["path"] for e in inv["entry_points"] if os.path.isfile(f"{w}/{e['path']}")})
    random.Random(1314).shuffle(fs)
    return sorted(fs[:n])


def edit(path, tag):
    keep = path + ".tb-keep"
    if not os.path.exists(keep): os.link(path, keep)
    tmp = path + ".tb-tmp"
    open(tmp, "wb").write(open(keep, "rb").read() + tag.encode())
    os.replace(tmp, path)


def restore(path):
    keep, tmp = path + ".tb-keep", path + ".tb-tmp"
    os.link(keep, tmp); os.replace(tmp, path); os.remove(keep)


def install(w, conv, lock):
    os.makedirs(f"{w}/.drift", exist_ok=True)
    for src, dst in ((conv, f"{w}/.drift/conventions.yaml"), (lock, f"{w}/drift.lock")):
        shutil.copy(src, dst + ".tmp"); os.replace(dst + ".tmp", dst)


for repo in REPOS:
    src = f"{S}/dev-clones/ts/{repo}"
    w = f"{ME}/lat/tw/{repo}"
    subprocess.run([f"{ME}/scripts/mkwork.sh", src, w], check=True)
    allc = f"{ME}/lat/pol/{repo}/conventions.yaml"
    blk = f"{ME}/lat/pol/{repo}/conventions-block.yaml"
    open(blk, "w").write(open(allc).read().replace("  mode: advise", "  mode: block"))
    pols = {"all": (allc, f"{ME}/lat/pol/{repo}/drift.lock"), "all-block": (blk, f"{ME}/lat/pol/{repo}/drift.lock"),
            "accept-only": (f"{ME}/lat/pol/{repo}/conventions-acceptonly.yaml", f"{ME}/lat/pol/{repo}/drift.lock")}
    files = sorted(set(pilot_files(repo, w)) | set(entry_files(repo, w)))
    for pol, (conv, lock) in pols.items():
        install(w, conv, lock)
        subprocess.run([TRACE, "scan"], cwd=w, capture_output=True)
        tr = f"{OUT}/{repo}-{pol}.jsonl"
        for rep in range(REPS):
            sess = f"tb-{pol}-{rep}-{time.time_ns()}"
            hook(TRACE, "SessionStart", w, sess, trace=tr)
            for rel in files:
                p = f"{w}/{rel}"
                hook(TRACE, "PreToolUse", w, sess, rel, "Edit", trace=tr)
                edit(p, f"\n// tb {rep} {time.time_ns()}\n")
                t = hook(TRACE, "PostToolUse", w, sess, rel, "Edit", trace=tr)
                wall.write(json.dumps(dict(repo=repo, policy=pol, rep=rep, bin="trace", file=rel, wall=t)) + "\n")
                if rep == 0:
                    t = hook(MAIN, "PostToolUse", w, sess + "-m", rel, "Edit")
                    wall.write(json.dumps(dict(repo=repo, policy=pol, rep=rep, bin="main", file=rel, wall=t)) + "\n")
                restore(p)
            edit(f"{w}/README.md", f"\ntb {rep} {time.time_ns()}\n")
            hook(TRACE, "PostToolUse", w, sess, "README.md", "Edit", trace=tr)
            restore(f"{w}/README.md")
            hook(TRACE, "Stop", w, sess, trace=tr)
            hook(TRACE, "Stop", w, sess, trace=tr)
            wall.flush()
        print("done", repo, pol, flush=True)
    shutil.rmtree(w, ignore_errors=True)
