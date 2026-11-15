#!/usr/bin/env python3
"""How often a PostToolUse hook falls back to a full scan, and how often #64 is why.

usage: trigger.py OUTDIR N  -- N sampled source files per repo (seeded), each edited
(a comment line appended, so its hash is new) and run through the instrumented hook.
"""
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time

D = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
P = f"{D}/perf"
EXE = f"{P}/bin/drift-main-instr"
OUT = sys.argv[1]
N = int(sys.argv[2])
ONLY = sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
res = open(f"{OUT}/trigger.jsonl", "a")
EXTS = (".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py")

for s in ("ts", "py", "py2"):
    for r in sorted(os.listdir(f"{D}/dev-clones/{s}")):
        work = f"{P}/work/{s}/{r}"
        if ONLY and f"{s}/{r}" not in ONLY:
            continue
        pol = f"{P}/policy/main/{s}/{r}"
        if not os.path.isfile(f"{pol}/conventions.yaml"):
            continue
        cache = f"{P}/cache/main/{s}/{r}/work"
        accepted = open(f"{pol}/conventions.yaml").read().count("status: accepted")
        shutil.rmtree(f"{work}/.drift", ignore_errors=True)
        os.makedirs(f"{work}/.drift")
        shutil.copy(f"{pol}/conventions.yaml", f"{work}/.drift/conventions.yaml")
        shutil.copy(f"{pol}/drift.lock", f"{work}/drift.lock")
        ls = subprocess.run(["git", "-C", work, "ls-files"], capture_output=True, text=True,
                            check=True).stdout.split("\n")
        files = sorted(f for f in ls if f.endswith(EXTS) and os.path.isfile(f"{work}/{f}")
                       and not os.path.islink(f"{work}/{f}") and "node_modules/" not in f)
        rng = random.Random(f"{s}/{r}")
        sample = rng.sample(files, min(N, len(files)))
        print(f"== {s}/{r} accepted={accepted} files={len(files)}", flush=True)
        for i, rel in enumerate(sample):
            orig = f"{work}/{rel}"
            keep = f"{P}/trigger-keep"
            if os.path.exists(keep):
                os.remove(keep)
            os.link(orig, keep)
            tmp = orig + ".perf-tmp"
            c = "#" if rel.endswith(".py") else "//"
            with open(tmp, "wb") as f:
                f.write(open(keep, "rb").read() + f"\n{c} drift-perf {time.time_ns()}\n".encode())
            os.replace(tmp, orig)
            hin = f"{OUT}/hook.in.json"
            json.dump({"session_id": f"trig-{i}", "cwd": work, "hook_event_name": "PostToolUse",
                       "tool_name": "Edit", "tool_input": {"file_path": orig},
                       "tool_response": {"success": True}}, open(hin, "w"))
            env = dict(os.environ, DRIFT_CACHE_DIR=cache, DRIFT_PERF="1")
            t0 = time.perf_counter()
            p = subprocess.run([EXE, "hook", "claude", "PostToolUse"], stdin=open(hin),
                               capture_output=True, text=True, env=env, cwd=work)
            wall = time.perf_counter() - t0
            err = p.stderr
            m = re.search(r"needs_full_scan (\w+) without64 (\w+)", err)
            sf = re.search(r"scan_file_result (\w+)", err)
            full = "scan_for_file.full" in err
            res.write(json.dumps({
                "set": s, "repo": r, "path": rel, "wall": round(wall, 3),
                "scan_file": sf.group(1) if sf else None,
                "needs_full": m.group(1) == "true" if m else None,
                "without64": m.group(2) == "true" if m else None,
                "full": full, "accepted": accepted, "advice": bool(p.stdout.strip()),
            }) + "\n")
            res.flush()
            os.link(keep, tmp)
            os.replace(tmp, orig)
            os.remove(keep)
        shutil.rmtree(f"{work}/.drift", ignore_errors=True)
        os.remove(f"{work}/drift.lock")
