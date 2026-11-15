#!/usr/bin/env python3
"""summ.py RUNDIR: min-of-reps tables (markdown) for census and hook rows."""
import json, math, sys, collections, os
R = sys.argv[1]
rows = []
for f in ("census.jsonl", "hook.jsonl"):
    p = os.path.join(R, f)
    if os.path.exists(p):
        rows += [json.loads(l) for l in open(p)]
mins = collections.defaultdict(dict)
ident = {}
for r in rows:
    if r.get("metric") == "identical":
        ident[(r["set"], r["repo"])] = r["value"]; continue
    if "bin" not in r: continue
    k = (r["set"], r["repo"], r["metric"], r["bin"])
    cpu = r["user"] + r["sys"]
    m = mins[k]
    m["wall"] = min(m.get("wall", 1e9), r["wall"]); m["cpu"] = min(m.get("cpu", 1e9), cpu)
    m["rss"] = min(m.get("rss", 1e18), r["rss_kb"] / 1024)
def g(vals):
    vals = [v for v in vals if v > 0]
    return math.exp(sum(map(math.log, vals)) / len(vals)) if vals else float("nan")
repos = sorted({(k[0], k[1]) for k in mins}, key=lambda x: (["ts", "py", "py2"].index(x[0]), x[1].lower()))
metrics = [m for m in ("census_cold", "census_warm", "check_file", "hook", "hook_edit") if any(k[2] == m for k in mins)]
for metric in metrics:
    print(f"\n### {metric}\n")
    print("| repo | CPU s | peak MB | wall s |\n|---|---|---|---|")
    for s, r in repos:
        b = mins.get((s, r, metric, "base")); n = mins.get((s, r, metric, "new"))
        if not b or not n: continue
        cell = lambda x: f"{b[x]:.2f} → {n[x]:.2f} ({n[x]/b[x]:.2f}×)" if x != "rss" else f"{b[x]:.0f} → {n[x]:.0f} ({n[x]/b[x]:.2f}×)"
        print(f"| {s}/{r} | {cell('cpu')} | {cell('rss')} | {cell('wall')} |")
print("\n### Summary (geo-mean ratio new/base, and range)\n")
print("| set | metric | CPU | peak RSS | wall |\n|---|---|---|---|---|")
for lang, sets in (("TS", ("ts",)), ("Python", ("py", "py2"))):
    for metric in metrics:
        rat = collections.defaultdict(list)
        for s, r in repos:
            if s not in sets: continue
            b = mins.get((s, r, metric, "base")); n = mins.get((s, r, metric, "new"))
            if not b or not n: continue
            for x in ("cpu", "rss", "wall"):
                if b[x] > 0.005: rat[x].append(n[x] / b[x])
        if not rat: continue
        f = lambda x: f"{g(rat[x]):.2f}× ({min(rat[x]):.2f}–{max(rat[x]):.2f})"
        print(f"| {lang} ({len(rat['cpu'])}) | {metric} | {f('cpu')} | {f('rss')} | {f('wall')} |")
if ident:
    print(f"\ncensus identical: {sum(ident.values())} of {len(ident)}; differing: {[k for k, v in ident.items() if not v]}")
