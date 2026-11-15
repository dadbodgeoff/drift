#!/usr/bin/env python3
"""Wall time of the hook paths in the coordinator's list that need no build (main binary).

usage: latitems.py OUTFILE REPS repo...
Per repo (work copy from latbench.py, cache re-warmed by `drift scan`), two policies:
 advise = every proposal accepted in advise mode (latbench's policy);
 block  = the same file with every accepted convention switched to block mode.
Per rep: SessionStart; PreToolUse Edit (existing file); PostToolUse after editing README.md
(non-source); PostToolUse after editing a source file; Stop with nothing edited since SessionStart.
Files are replaced by rename, never written in place.
"""
import json, os, shutil, subprocess, sys, time

ME = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r13h-agentproof"
EXE = "/home/user/drift-bin/sec167/drift"
OUT, REPS, REPOS = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
SRC = {"dub": "apps/web/app/api/tags/count/route.ts", "infisical": "backend/src/server/routes/v2/user-router.ts",
       "midday": "apps/api/src/trpc/routers/_app.ts"}
res = open(OUT, "a")


def wait_mem():
    while int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0]) < 4 * 1024 * 1024:
        time.sleep(30)


def measure(cmd, stdin, cwd):
    wait_mem()
    r = subprocess.run([sys.executable, "-I", f"{ME}/scripts/measure.py", "--stdin", stdin, "--cwd", cwd,
                        "--out", f"{ME}/lat/items.out", "--"] + cmd, capture_output=True, text=True, check=True)
    m = json.loads(r.stdout)
    m["out_bytes"] = os.path.getsize(f"{ME}/lat/items.out")
    return m


def hook(event, w, sess, rel=None, tool=None):
    d = {"session_id": sess, "cwd": w, "hook_event_name": event}
    if event == "SessionStart": d["source"] = "startup"
    if tool:
        d["tool_name"] = tool
        d["tool_input"] = {"file_path": f"{w}/{rel}", "old_string": "x", "new_string": "y"}
        if event == "PostToolUse": d["tool_response"] = {"success": True}
    if event == "Stop": d["stop_hook_active"] = False
    p = f"{ME}/lat/items.in"
    json.dump(d, open(p, "w"))
    return measure([EXE, "hook", "claude", event], p, w)


def edit(path, tag):
    keep = path + ".items-keep"
    if not os.path.exists(keep): os.link(path, keep)
    tmp = path + ".items-tmp"
    open(tmp, "wb").write(open(keep, "rb").read() + tag.encode())
    os.replace(tmp, path)


def restore(path):
    keep = path + ".items-keep"
    tmp = path + ".items-tmp"
    os.link(keep, tmp); os.replace(tmp, path); os.remove(keep)


for repo in REPOS:
    w = f"{ME}/lat/work-main/{repo}"
    conv = f"{w}/.drift/conventions.yaml"
    adv = f"{ME}/lat/{repo}-advise.yaml"
    if not os.path.exists(adv): shutil.copy(conv, adv)
    blk = f"{ME}/lat/{repo}-block.yaml"
    open(blk, "w").write(open(adv).read().replace("  mode: advise", "  mode: block"))
    subprocess.run([EXE, "scan"], cwd=w, capture_output=True, check=True)
    for rep in range(REPS):
        for pol, src in (("advise", adv), ("block", blk)):
            tmp = conv + ".tmp"; shutil.copy(src, tmp); os.replace(tmp, conv)
            sess = f"items-{pol}-{rep}-{time.time_ns()}"
            row = lambda name, m: res.write(json.dumps(dict(repo=repo, policy=pol, rep=rep, item=name, **m)) + "\n")
            row("session_start", hook("SessionStart", w, sess))
            row("stop_no_edit", hook("Stop", w, sess))
            row("pre_edit_existing", hook("PreToolUse", w, sess, SRC[repo], "Edit"))
            edit(f"{w}/README.md", f"\nitems {rep} {time.time_ns()}\n")
            row("post_non_source", hook("PostToolUse", w, sess, "README.md", "Edit"))
            restore(f"{w}/README.md")
            edit(f"{w}/{SRC[repo]}", f"\n// items {rep} {time.time_ns()}\n")
            row("post_source", hook("PostToolUse", w, sess, SRC[repo], "Edit"))
            restore(f"{w}/{SRC[repo]}")
            row("stop_after_restore", hook("Stop", w, sess))
            res.flush()
    shutil.copy(adv, conv + ".tmp"); os.replace(conv + ".tmp", conv)
    print("done", repo, flush=True)
