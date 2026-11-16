#!/usr/bin/env python3
"""Hook timing on a release build: plays agent sessions on scratch copies of real repositories.

usage: drive.py DRIFT_EXE WORKDIR OUT.jsonl SESSIONS EDITS REPO_DIR...

For each repository: a private copy, a fresh `drift init`, every proposal accepted (advise),
then SESSIONS sessions of: SessionStart, EDITS x (PreToolUse Edit, the edit itself, PostToolUse
Edit), Stop. Each hook is one process, timed from spawn to exit (wall) and by the hook's own
trace line (`ms`, `path`).
"""
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time

EXE, WORK, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SESSIONS, EDITS = int(sys.argv[4]), int(sys.argv[5])
REPOS = sys.argv[6:]
EXTS = (".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py")
ENV = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "DRIFT_AGENT", "DRIFT_CACHE_DIR")}
out = open(OUT, "a")


def run(args, cwd, **kw):
    return subprocess.run([EXE, *args], cwd=cwd, capture_output=True, text=True, env=ENV, **kw)


def hook(event, payload, cwd, trace):
    if os.path.exists(trace):
        os.remove(trace)
    env = dict(ENV, DRIFT_HOOK_TRACE=trace)
    t0 = time.perf_counter()
    p = subprocess.run([EXE, "hook", "claude", event], input=json.dumps(payload), cwd=cwd,
                       capture_output=True, text=True, env=env)
    wall = (time.perf_counter() - t0) * 1000
    line = {}
    if os.path.exists(trace):
        rows = [json.loads(x) for x in open(trace) if x.strip()]
        line = rows[-1] if rows else {}
    return wall, line, p


for src in REPOS:
    name = os.path.basename(src.rstrip("/"))
    work = os.path.join(WORK, name)
    shutil.rmtree(work, ignore_errors=True)
    subprocess.run(["cp", "-a", src, work], check=True)
    shutil.rmtree(f"{work}/.drift", ignore_errors=True)
    for f in ("drift.lock", "security.lock"):
        if os.path.exists(f"{work}/{f}"):
            os.remove(f"{work}/{f}")
    t0 = time.perf_counter()
    p = run(["init"], work)
    init_s = time.perf_counter() - t0
    if p.returncode != 0:
        print(f"{name}: init failed: {p.stderr[-400:]}")
        continue
    conv = open(f"{work}/.drift/conventions.yaml").read()
    ids = re.findall(r"^\s*-?\s*id:\s*(\S+)", conv, re.M)
    acc = run(["review", "--accept", ",".join(ids)], work) if ids else None
    blk = None
    if os.environ.get("MODE") == "block":
        # One at a time: a refusal (a Python place, a small role, a suggestion) leaves the others.
        for i in ids:
            blk = run(["review", "--block", i], work)
    conv = open(f"{work}/.drift/conventions.yaml").read()
    accepted = conv.count("status: accepted")
    blocking = conv.count("mode: block")
    if blk:
        print(f"   block: {blocking} of {len(ids)} now block", flush=True)
    print(f"== {name}: init {init_s:.1f}s, {len(ids)} proposals, {accepted} accepted"
          + (f" ({acc.stdout.strip()[-120:]} {acc.stderr.strip()[-200:]})" if acc else ""), flush=True)
    ls = subprocess.run(["git", "-C", work, "ls-files"], capture_output=True, text=True).stdout.split("\n")
    files = sorted(f for f in ls if f.endswith(EXTS) and os.path.isfile(f"{work}/{f}")
                   and not os.path.islink(f"{work}/{f}") and "node_modules/" not in f)
    rng = random.Random(name)
    trace = os.path.join(WORK, f"{name}.trace")
    for s in range(SESSIONS):
        sid = f"time-{name}-{s}"
        base = {"session_id": sid, "cwd": work, "transcript_path": os.path.join(WORK, "none.jsonl")}

        def rec(event, wall, line, p, **extra):
            out.write(json.dumps({"repo": name, "session": s, "event": event, "wall_ms": round(wall, 1),
                                  "ms": line.get("ms"), "path": line.get("path"),
                                  "answered": line.get("answered"), "rc": p.returncode,
                                  "accepted": accepted, "blocking": blocking, **extra}) + "\n")
            out.flush()

        w, l, p = hook("SessionStart", dict(base, hook_event_name="SessionStart", source="startup"), work, trace)
        rec("SessionStart", w, l, p, first=(s == 0))
        for rel in rng.sample(files, min(EDITS, len(files))):
            path = f"{work}/{rel}"
            tool = {"tool_name": "Edit", "tool_input": {"file_path": path}}
            w, l, p = hook("PreToolUse", dict(base, hook_event_name="PreToolUse", **tool), work, trace)
            rec("PreToolUse", w, l, p)
            c = "#" if rel.endswith(".py") else "//"
            orig = open(path, "rb").read()
            tmp = path + ".time-tmp"
            with open(tmp, "wb") as f:
                f.write(orig + f"\n{c} hook timing {time.time_ns()}\n".encode())
            os.replace(tmp, path)
            w, l, p = hook("PostToolUse", dict(base, hook_event_name="PostToolUse",
                                               tool_response={"success": True}, **tool), work, trace)
            rec("PostToolUse", w, l, p)
            with open(tmp, "wb") as f:
                f.write(orig)
            os.replace(tmp, path)
        w, l, p = hook("Stop", dict(base, hook_event_name="Stop", stop_hook_active=False), work, trace)
        rec("Stop", w, l, p)
    print(f"   {name}: {SESSIONS} sessions played", flush=True)
