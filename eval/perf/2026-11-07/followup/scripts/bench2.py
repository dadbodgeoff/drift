#!/usr/bin/env python3
"""base (main) vs new (perf-fixes-2) on the dev clones, interleaved, min of REPS.

usage: bench2.py OUTDIR census|hook|checkjson [set/repo ...]
census:    census --json --max 15, cold (empty private cache) then warm; identity of the
           output (commit field aside), one file per repo and binary.
hook:      on a hardlinked work copy with every proposal of base's init accepted (the
           same policy for both binaries): check FILE, hook (unchanged), hook+edit.
checkjson: check --format json on N edited files per repo; byte identity.
"""
import json, os, random, re, shutil, subprocess, sys, time
D = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
P = f"{D}/perf2"
BINS = {"base": f"{P}/bin/drift-base", "new": f"{P}/bin/drift-new"}
OUT, MODE = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3:]
REPS = int(os.environ.get("REPS", "5"))
os.makedirs(OUT, exist_ok=True)
res = open(f"{OUT}/{MODE}.jsonl", "a")
FILES = {}
for l in open(f"{P}/files.jsonl"):
    r = json.loads(l); FILES[f"{r['set']}/{r['repo']}"] = r["path"]

def wait_mem():
    while int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0]) < 4 * 1024 * 1024:
        time.sleep(30)

def measure(cmd, cache, out=None, stdin=None, cwd=None):
    wait_mem()
    a = [sys.executable, "-I", f"{P}/measure.py", "--env", f"DRIFT_CACHE_DIR={cache}"]
    if out: a += ["--out", out]
    if stdin: a += ["--stdin", stdin]
    if cwd: a += ["--cwd", cwd]
    r = subprocess.run(a + ["--"] + cmd, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

def rec(**row):
    res.write(json.dumps(row) + "\n"); res.flush()

def body(p):
    d = json.load(open(p)); d.pop("commit", None); return json.dumps(d, sort_keys=True)

def repos():
    for s in ("ts", "py", "py2"):
        for r in sorted(os.listdir(f"{D}/dev-clones/{s}")):
            if not ONLY or f"{s}/{r}" in ONLY:
                yield s, r

def order(rep):
    items = list(BINS.items())
    return items if rep % 2 == 0 else items[::-1]

def mkwork(src, work):
    subprocess.run([f"{P}/mkwork.sh", src, work], check=True)

def policy(work, cache):
    shutil.rmtree(f"{work}/.drift", ignore_errors=True)
    if os.path.exists(f"{work}/drift.lock"): os.remove(f"{work}/drift.lock")
    env = dict(os.environ, DRIFT_CACHE_DIR=cache)
    subprocess.run([BINS["base"], "--root", work, "init", "--max", "15"], env=env, capture_output=True, check=True)
    ids = re.findall(r"^- id: (\S+)$", open(f"{work}/.drift/conventions.yaml").read(), re.M)
    if ids:
        subprocess.run([BINS["base"], "--root", work, "review", "--accept", ",".join(ids)], env=env, capture_output=True, check=True)
    return len(ids)

def hook_input(work, rel, session):
    return {"session_id": session, "cwd": work, "hook_event_name": "PostToolUse", "tool_name": "Edit",
            "tool_input": {"file_path": f"{work}/{rel}", "old_string": "x", "new_string": "y"},
            "tool_response": {"success": True}}

def edit(work, rel, keep, tag):
    tmp = f"{work}/{rel}.perf-tmp"
    cm = "#" if rel.endswith(".py") else "//"
    with open(tmp, "wb") as f:
        f.write(open(keep, "rb").read() + f"\n{cm} drift-perf edit {tag}\n".encode())
    os.replace(tmp, f"{work}/{rel}")

def restore(work, rel, keep):
    tmp = f"{work}/{rel}.perf-tmp"
    os.link(keep, tmp); os.replace(tmp, f"{work}/{rel}")

for s, r in repos():
    src = f"{D}/dev-clones/{s}/{r}"
    print(f"== {s}/{r}", flush=True)
    if MODE == "census":
        for rep in range(REPS):
            for b, exe in order(rep):
                cache = f"{P}/bcache/{b}"
                shutil.rmtree(cache, ignore_errors=True); os.makedirs(cache)
                for m in ("census_cold", "census_warm"):
                    out = f"{OUT}/census-{s}-{r}-{b}.json"
                    x = measure([exe, "--root", src, "census", "--json", "--max", "15"], cache, out)
                    rec(set=s, repo=r, bin=b, metric=m, rep=rep, **x)
                shutil.rmtree(cache, ignore_errors=True)
        same = body(f"{OUT}/census-{s}-{r}-base.json") == body(f"{OUT}/census-{s}-{r}-new.json")
        rec(set=s, repo=r, metric="identical", value=same)
        print(f"   identical={same}", flush=True)
        continue
    work = f"{P}/work/{s}/{r}"
    mkwork(src, work)
    caches = {b: f"{P}/bcache/{s}-{r}-{b}" for b in BINS}
    for c in caches.values():
        shutil.rmtree(c, ignore_errors=True); os.makedirs(c)
    n = policy(work, caches["base"])
    if n == 0:
        print("   no proposals", flush=True)
    for b, exe in BINS.items():  # warm each binary's cache (and index) with a full check
        subprocess.run([exe, "--root", work, "check"], env=dict(os.environ, DRIFT_CACHE_DIR=caches[b]), capture_output=True)
    if MODE == "hook":
        rel = FILES.get(f"{s}/{r}")
        keep = f"{P}/keep-{s}-{r}"
        if rel and n and not os.path.exists(keep): os.link(f"{work}/{rel}", keep)
        for rep in range(REPS if rel and n else 0):
            for b, exe in order(rep):
                x = measure([exe, "--root", work, "check", rel], caches[b], out=f"{OUT}/check-{s}-{r}-{b}.txt")
                rec(set=s, repo=r, bin=b, metric="check_file", rep=rep, **x)
                hin = f"{OUT}/hin-{b}.json"
                json.dump(hook_input(work, rel, f"p2-{b}-{rep}-a"), open(hin, "w"))
                x = measure([exe, "hook", "claude", "PostToolUse"], caches[b], stdin=hin, out=f"{OUT}/hook-{s}-{r}-{b}.json", cwd=work)
                rec(set=s, repo=r, bin=b, metric="hook", rep=rep, **x)
                edit(work, rel, keep, f"{b} {rep} {time.time_ns()}")
                json.dump(hook_input(work, rel, f"p2-{b}-{rep}-e"), open(hin, "w"))
                x = measure([exe, "hook", "claude", "PostToolUse"], caches[b], stdin=hin, out=f"{OUT}/hookedit-{s}-{r}-{b}.json", cwd=work)
                rec(set=s, repo=r, bin=b, metric="hook_edit", rep=rep, **x)
                restore(work, rel, keep)
        if os.path.exists(keep): os.remove(keep)
    elif MODE == "checkjson":
        ls = subprocess.run(["git", "-C", work, "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
        exts = (".py",) if s != "ts" else (".ts", ".tsx")
        cand = sorted(f for f in ls if f.endswith(exts) and os.path.isfile(f"{work}/{f}") and not os.path.islink(f"{work}/{f}"))
        rnd = random.Random(f"perf2-{s}-{r}")
        sample = rnd.sample(cand, min(int(os.environ.get("N", "8")), len(cand)))
        if FILES.get(f"{s}/{r}") and FILES[f"{s}/{r}"] not in sample:
            sample.append(FILES[f"{s}/{r}"])
        for i, rel in enumerate(sample):
            keep = f"{P}/keep-cj"
            if os.path.exists(keep): os.remove(keep)
            os.link(f"{work}/{rel}", keep)
            edit(work, rel, keep, f"cj {i}")
            outs = {}
            for b, exe in BINS.items():
                o = f"{OUT}/cj-{s}-{r}-{b}.json"
                wait_mem()
                p = subprocess.run([exe, "--root", work, "check", "--format", "json", rel], env=dict(os.environ, DRIFT_CACHE_DIR=caches[b]), capture_output=True)
                outs[b] = (p.returncode, p.stdout)
                # the whole repo's check after the edit: every file's violations and exemptions
                p = subprocess.run([exe, "--root", work, "check", "--format", "json"], env=dict(os.environ, DRIFT_CACHE_DIR=caches[b]), capture_output=True)
                outs[b + "_all"] = (p.returncode, p.stdout)
                open(f"{OUT}/cjall-{s}-{r}-{b}.json", "wb").write(p.stdout)
                # the hook on the same edit
                hin = f"{OUT}/hin-{b}.json"
                json.dump(hook_input(work, rel, f"cj-{b}-{i}"), open(hin, "w"))
                h = subprocess.run([exe, "hook", "claude", "PostToolUse"], env=dict(os.environ, DRIFT_CACHE_DIR=caches[b]), stdin=open(hin), capture_output=True, cwd=work)
                outs[b + "_hook"] = (h.returncode, h.stdout)
            same = outs["base"] == outs["new"]
            hsame = outs["base_hook"] == outs["new_hook"]
            asame = outs["base_all"] == outs["new_all"]
            allj = json.loads(outs["base_all"][1] or b"{}")
            nv, ne = len(allj.get("violations", [])), len(allj.get("exempt", []))
            rec(set=s, repo=r, metric="check_json", path=rel, identical=same, all_identical=asame, hook_identical=hsame, code=outs["base"][0], bytes=len(outs["base"][1]), all_bytes=len(outs["base_all"][1]), all_violations=nv, all_exempt=ne)
            print(f"   {rel}: file identical={same} repo identical={asame} ({len(outs['base_all'][1])} bytes, {nv} violations, {ne} exempt) hook identical={hsame}", flush=True)
            restore(work, rel, keep); os.remove(keep)
    for c in caches.values():
        shutil.rmtree(c, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)
    st = subprocess.run(["git", "-C", src, "status", "--short"], capture_output=True, text=True).stdout
    print(f"   clone status: {'clean' if not st.strip() else st[:200]}", flush=True)
