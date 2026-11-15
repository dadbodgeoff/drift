#!/usr/bin/env python3
"""main (f293f1c) vs head (fix): census --json cold and warm, interleaved, 5 reps,
plus byte-identity of the census output (the `commit` field aside).

usage: fixbench.py OUTDIR
"""
import json
import os
import shutil
import subprocess
import sys
import time

D = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
P = f"{D}/perf"
BINS = {"main": f"{P}/bin/drift-f293", "head": f"{P}/bin/drift-head"}
OUT = sys.argv[1]
REPS = 5
os.makedirs(OUT, exist_ok=True)
res = open(f"{OUT}/results.jsonl", "a")


def wait_mem():
    while int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0]) < 4 * 1024 * 1024:
        time.sleep(30)


def measure(cmd, env, out):
    wait_mem()
    r = subprocess.run([sys.executable, "-I", f"{P}/measure.py", "--env", f"DRIFT_CACHE_DIR={env}",
                        "--out", out, "--"] + cmd, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def body(path):
    d = json.load(open(path))
    d.pop("commit", None)
    return json.dumps(d, sort_keys=True)


for s in ("ts", "py", "py2"):
    for r in sorted(os.listdir(f"{D}/dev-clones/{s}")):
        src = f"{D}/dev-clones/{s}/{r}"
        print(f"== {s}/{r}", flush=True)
        for rep in range(REPS):
            order = list(BINS.items()) if rep % 2 == 0 else list(BINS.items())[::-1]
            for b, exe in order:
                cache = f"{P}/fcache/{b}"
                shutil.rmtree(cache, ignore_errors=True)
                os.makedirs(cache)
                cmd = [exe, "--root", src, "census", "--json", "--max", "15"]
                for metric in ("census_cold", "census_warm"):
                    out = f"{OUT}/{s}-{r}-{b}.json"
                    m = measure(cmd, cache, out)
                    res.write(json.dumps(dict(set=s, repo=r, bin=b, metric=metric, rep=rep, **m)) + "\n")
                    res.flush()
                shutil.rmtree(cache, ignore_errors=True)
        same = body(f"{OUT}/{s}-{r}-main.json") == body(f"{OUT}/{s}-{r}-head.json")
        res.write(json.dumps(dict(set=s, repo=r, metric="identical", value=same)) + "\n")
        res.flush()
        print(f"   identical={same}", flush=True)
