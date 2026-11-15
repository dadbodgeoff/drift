#!/usr/bin/env python3
"""Before/after benchmark of drift on the dev clones.

usage: bench.py OUTDIR [repo-filter...]
Writes OUTDIR/results.jsonl (one row per measurement) and the census outputs.
"""
import json
import os
import shutil
import subprocess
import sys
import time

D = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
P = f"{D}/perf"
BINS = {"base": f"{P}/bin/drift-base", "main": f"{P}/bin/drift-main"}
OUT = sys.argv[1]
FILTER = sys.argv[2:]
REPS = 5
os.makedirs(OUT, exist_ok=True)
results = open(f"{OUT}/results.jsonl", "a")


def wait_mem():
    # Shared machine: wait while less than 4 GB is available.
    while True:
        avail = int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0])
        if avail >= 4 * 1024 * 1024:
            return
        time.sleep(30)


def measure(cmd, env=None, stdin=None, out=None, cwd=None):
    wait_mem()
    args = [sys.executable, "-I", f"{P}/measure.py"]
    for k, v in (env or {}).items():
        args += ["--env", f"{k}={v}"]
    if stdin:
        args += ["--stdin", stdin]
    if out:
        args += ["--out", out]
    if cwd:
        args += ["--cwd", cwd]
    args += ["--"] + cmd
    r = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def record(**row):
    results.write(json.dumps(row) + "\n")
    results.flush()


def repos():
    for s in ("ts", "py", "py2"):
        for r in sorted(os.listdir(f"{D}/dev-clones/{s}")):
            if FILTER and r not in FILTER:
                continue
            yield s, r


def hook_input(work, rel, session):
    return {
        "session_id": session,
        "cwd": work,
        "hook_event_name": "PostToolUse",
        "tool_name": "Edit",
        "tool_input": {"file_path": f"{work}/{rel}", "old_string": "x", "new_string": "y"},
        "tool_response": {"success": True},
    }


def comment_for(rel):
    return "#" if rel.endswith(".py") else "//"


for s, r in repos():
    src = f"{D}/dev-clones/{s}/{r}"
    work = f"{P}/work/{s}/{r}"
    rd = f"{OUT}/{s}/{r}"
    os.makedirs(rd, exist_ok=True)
    print(f"== {s}/{r}", flush=True)
    subprocess.run([f"{P}/mkwork.sh", src, work], check=True)
    # 1. census, cold then warm, interleaved base/main.
    for rep in range(REPS):
        for b, exe in BINS.items():
            cache = f"{P}/cache/{b}/{s}/{r}/census"
            shutil.rmtree(cache, ignore_errors=True)
            os.makedirs(cache)
            env = {"DRIFT_CACHE_DIR": cache}
            cmd = [exe, "--root", src, "census", "--json", "--max", "15"]
            m = measure(cmd, env, out=f"{rd}/census-{b}-cold{rep}.json")
            record(set=s, repo=r, bin=b, metric="census_cold", rep=rep, **m)
            m = measure(cmd, env, out=f"{rd}/census-{b}-warm{rep}.json")
            record(set=s, repo=r, bin=b, metric="census_warm", rep=rep, **m)
    # Representative file: rank-1 proposal's example (main), else base's.
    rel = None
    for b in ("main", "base"):
        try:
            c = json.load(open(f"{rd}/census-{b}-cold0.json"))
        except Exception:
            continue
        for p in c.get("proposals", []):
            path = p.get("example", {}).get("path")
            if path and os.path.isfile(f"{work}/{path}"):
                rel = path
                break
        if rel:
            break
    if rel is None:
        # No proposals: a mid-list source file of the repo's language.
        exts = (".py",) if s != "ts" else (".ts", ".tsx")
        ls = subprocess.run(["git", "-C", work, "ls-files"], capture_output=True,
                            text=True, check=True).stdout.split("\n")
        cand = sorted(f for f in ls if f.endswith(exts) and "test" not in f
                      and os.path.isfile(f"{work}/{f}") and not os.path.islink(f"{work}/{f}"))
        if not cand:
            print(f"   no representative file for {r}", flush=True)
            continue
        rel = cand[len(cand) // 2]
    record(set=s, repo=r, metric="file", path=rel)
    # 2. policy per binary: init, accept all proposals.
    for b, exe in BINS.items():
        pol = f"{P}/policy/{b}/{s}/{r}"
        cache = f"{P}/cache/{b}/{s}/{r}/work"
        env = dict(os.environ, DRIFT_CACHE_DIR=cache)
        if not os.path.isfile(f"{pol}/conventions.yaml"):
            shutil.rmtree(f"{work}/.drift", ignore_errors=True)
            if os.path.exists(f"{work}/drift.lock"):
                os.remove(f"{work}/drift.lock")
            subprocess.run([exe, "--root", work, "init", "--max", "15"], env=env,
                           capture_output=True, check=True)
            import re
            ids = re.findall(r"^- id: (\S+)$",
                             open(f"{work}/.drift/conventions.yaml").read(), re.M)
            if ids:
                subprocess.run([exe, "--root", work, "review", "--accept", ",".join(ids)],
                               env=env, capture_output=True, check=True)
            os.makedirs(pol, exist_ok=True)
            shutil.copy(f"{work}/.drift/conventions.yaml", f"{pol}/conventions.yaml")
            shutil.copy(f"{work}/drift.lock", f"{pol}/drift.lock")
    # 3. check and hook, interleaved.
    orig = f"{work}/{rel}"
    keep = f"{P}/keep-{s}-{r}"
    os.link(orig, keep) if not os.path.exists(keep) else None
    for rep in range(REPS):
        for b, exe in BINS.items():
            pol = f"{P}/policy/{b}/{s}/{r}"
            cache = f"{P}/cache/{b}/{s}/{r}/work"
            shutil.rmtree(f"{work}/.drift", ignore_errors=True)
            os.makedirs(f"{work}/.drift")
            shutil.copy(f"{pol}/conventions.yaml", f"{work}/.drift/conventions.yaml")
            shutil.copy(f"{pol}/drift.lock", f"{work}/drift.lock")
            env = {"DRIFT_CACHE_DIR": cache}
            m = measure([exe, "--root", work, "check", rel], env,
                        out=f"{rd}/check-{b}-{rep}.txt")
            record(set=s, repo=r, bin=b, metric="check_file", rep=rep, **m)
            # Hook on the file as it is.
            hin = f"{rd}/hook-{b}-{rep}.in.json"
            json.dump(hook_input(work, rel, f"perf-{b}-{rep}-a"), open(hin, "w"))
            m = measure([exe, "hook", "claude", "PostToolUse"], env, stdin=hin,
                        out=f"{rd}/hook-{b}-{rep}.out.json", cwd=work)
            record(set=s, repo=r, bin=b, metric="hook_same", rep=rep, **m)
            # Hook after an edit: a new comment line, so the file's hash is new.
            tmp = orig + ".perf-tmp"
            data = open(keep, "rb").read()
            tag = f"\n{comment_for(rel)} drift-perf edit {b} {rep} {time.time_ns()}\n"
            with open(tmp, "wb") as f:
                f.write(data + tag.encode())
            os.replace(tmp, orig)
            json.dump(hook_input(work, rel, f"perf-{b}-{rep}-e"), open(hin, "w"))
            m = measure([exe, "hook", "claude", "PostToolUse"], env, stdin=hin,
                        out=f"{rd}/hookedit-{b}-{rep}.out.json", cwd=work)
            record(set=s, repo=r, bin=b, metric="hook_edit", rep=rep, **m)
            # Restore the original (hardlink), replacing by rename.
            os.link(keep, tmp)
            os.replace(tmp, orig)
    os.remove(keep)
    shutil.rmtree(f"{work}/.drift", ignore_errors=True)
    if os.path.exists(f"{work}/drift.lock"):
        os.remove(f"{work}/drift.lock")
    # #64: how often a hook on an edited file falls back to a full scan.
    wait_mem()
    subprocess.run([sys.executable, "-I", f"{P}/trigger.py", f"{OUT}/trig", "15", f"{s}/{r}"],
                   check=True)
    for b in BINS:
        shutil.rmtree(f"{P}/cache/{b}/{s}/{r}", ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)
