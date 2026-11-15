#!/usr/bin/env python3
"""Hook latency on the pilot's repos and files, pilot binary vs current main binary.

usage: latbench.py OUTDIR REPS repo...

For each repo: two private work copies (hardlinked tree, fresh .git, see mkwork.sh), one per
binary. The pilot binary gets the pilot's own reviewed policy (abv2-pilot/policy/<repo>); the
current binary gets `init` + the same review rule the harness applies (every proposal accepted;
the strict case, see README). Fact cache: the default <root>/.drift/cache, warmed by `drift scan`,
exactly as run.mjs does (no DRIFT_CACHE_DIR, so the per-hook `git ls-files` probe is included).

Workload per rep: for every file the pilot's drift-arm agent changed in that repo (existing
files: a comment line appended; new files: the content the agent wrote), PreToolUse then the
edit (file replaced by rename) then PostToolUse, then the file is restored. Interleaved by binary.
Also: `--version` (bare process start) and a PostToolUse in a directory with no policy.
"""
import json, os, re, shutil, subprocess, sys, time

S = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad"
ME = f"{S}/r13h-agentproof"
PILOT = "/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/abv2-pilot"
BINS = {
    "pilot": "/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/bin/drift-main",
    "main": "/home/user/drift-bin/sec167/drift",
}
OUT, REPS, REPOS = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
res = open(f"{OUT}/hooks.jsonl", "a")
RUN = {"dub": "dub-d-domains-count-quick", "infisical": "infisical-e-split-user-mfa",
       "midday": "midday-f-budgets-session", "immich": "immich-a-memory-duplicate"}


def wait_mem():
    while int(open("/proc/meminfo").read().split("MemAvailable:")[1].split()[0]) < 4 * 1024 * 1024:
        time.sleep(30)


def measure(cmd, stdin=None, cwd=None, out=None):
    wait_mem()
    a = [sys.executable, "-I", f"{ME}/scripts/measure.py"]
    if stdin: a += ["--stdin", stdin]
    if cwd: a += ["--cwd", cwd]
    if out: a += ["--out", out]
    r = subprocess.run(a + ["--"] + cmd, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def rec(**row):
    res.write(json.dumps(row) + "\n"); res.flush()


def hook_input(event, work, rel, sess, tool):
    d = {"session_id": sess, "cwd": work, "hook_event_name": event, "tool_name": tool,
         "tool_input": {"file_path": f"{work}/{rel}", "old_string": "x", "new_string": "y"}}
    if event == "PostToolUse": d["tool_response"] = {"success": True}
    return d


def new_files(repo):
    """Files the pilot agent added, with their final content, from changes.patch."""
    patch = open(f"{PILOT}/runs/{RUN[repo]}__drift__haiku__r1/changes.patch").read()
    out = {}
    for blk in re.split(r"(?m)^diff --git ", patch)[1:]:
        m = re.search(r"(?m)^\+\+\+ b/(.+)$", blk)
        if not m or "new file mode" not in blk.split("@@")[0]: continue
        body = blk.split("@@", 1)[1].split("\n", 1)[1]
        lines = [l[1:] for l in body.split("\n") if l.startswith("+")]
        out[m.group(1)] = "\n".join(lines) + "\n"
    return out


def changed_existing(repo, work):
    patch = open(f"{PILOT}/runs/{RUN[repo]}__drift__haiku__r1/changes.patch").read()
    fs = re.findall(r"(?m)^\+\+\+ b/(.+)$", patch)
    return [f for f in fs if os.path.isfile(f"{work}/{f}")]


for repo in REPOS:
    src = f"{S}/dev-clones/ts/{repo}"
    rd = f"{OUT}/{repo}"; os.makedirs(rd, exist_ok=True)
    works = {}
    for b, exe in BINS.items():
        w = f"{ME}/lat/work-{b}/{repo}"
        subprocess.run([f"{ME}/scripts/mkwork.sh", src, w], check=True)
        if not os.path.isfile(f"{w}/.drift/conventions.yaml"):
            if b == "pilot":
                os.makedirs(f"{w}/.drift", exist_ok=True)
                shutil.copy(f"{PILOT}/policy/{repo}/conventions.yaml", f"{w}/.drift/conventions.yaml")
                shutil.copy(f"{PILOT}/policy/{repo}/drift.lock", f"{w}/drift.lock")
            else:
                subprocess.run([exe, "init"], cwd=w, capture_output=True, check=True)
                ids = re.findall(r"^- id: (\S+)$", open(f"{w}/.drift/conventions.yaml").read(), re.M)
                if ids:
                    subprocess.run([exe, "review", "--accept", ",".join(ids)], cwd=w, capture_output=True, check=True)
            shutil.copy(f"{w}/.drift/conventions.yaml", f"{rd}/conventions-{b}.yaml")
        m = measure([exe, "scan"], cwd=w, out=f"{rd}/scan-{b}.txt")  # warm, as run.mjs
        rec(repo=repo, bin=b, metric="warm_scan_first", **m)
        works[b] = w
    existing = changed_existing(repo, works["main"])
    added = new_files(repo)
    rec(repo=repo, metric="files", existing=existing, added=sorted(added))
    nopol = f"{ME}/lat/nopolicy"; os.makedirs(nopol, exist_ok=True)
    for rep in range(REPS):
        order = list(BINS.items()) if rep % 2 == 0 else list(BINS.items())[::-1]
        for b, exe in order:
            w = works[b]
            rec(repo=repo, bin=b, rep=rep, metric="version", **measure([exe, "--version"]))
            hin = f"{rd}/in-{b}.json"
            json.dump(hook_input("PostToolUse", nopol, "x.ts", "np", "Edit"), open(hin, "w"))
            rec(repo=repo, bin=b, rep=rep, metric="post_nopolicy",
                **measure([exe, "hook", "claude", "PostToolUse"], stdin=hin, cwd=nopol))
            m = measure([exe, "scan"], cwd=w)
            rec(repo=repo, bin=b, rep=rep, metric="warm_scan", **m)
            for rel in existing + sorted(added):
                path = f"{w}/{rel}"
                is_new = rel in added
                sess = f"lat-{b}-{rep}"
                tool = "Write" if is_new else "Edit"
                json.dump(hook_input("PreToolUse", w, rel, sess, tool), open(hin, "w"))
                m = measure([exe, "hook", "claude", "PreToolUse"], stdin=hin, cwd=w, out=f"{rd}/pre-{b}.out")
                rec(repo=repo, bin=b, rep=rep, metric="pre", file=rel, new=is_new,
                    out_bytes=os.path.getsize(f"{rd}/pre-{b}.out"), **m)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                tmp = path + ".lat-tmp"
                if is_new:
                    data = added[rel].encode()
                else:
                    data = open(path, "rb").read() + f"\n// lat edit {b} {rep} {time.time_ns()}\n".encode()
                    keep = f"{ME}/lat/keep"
                    if os.path.exists(keep): os.remove(keep)
                    os.link(path, keep)
                open(tmp, "wb").write(data); os.replace(tmp, path)
                json.dump(hook_input("PostToolUse", w, rel, sess, tool), open(hin, "w"))
                m = measure([exe, "hook", "claude", "PostToolUse"], stdin=hin, cwd=w, out=f"{rd}/post-{b}.out")
                rec(repo=repo, bin=b, rep=rep, metric="post", file=rel, new=is_new,
                    out_bytes=os.path.getsize(f"{rd}/post-{b}.out"), **m)
                if is_new:
                    os.remove(path)
                else:
                    os.link(keep, tmp); os.replace(tmp, path); os.remove(keep)
    print(f"done {repo}", flush=True)
