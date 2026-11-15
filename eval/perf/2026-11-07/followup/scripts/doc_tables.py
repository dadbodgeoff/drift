#!/usr/bin/env python3
"""doc_tables.py RUNDIR: the follow-up section's tables (markdown)."""
import json, math, sys, collections, os
R = sys.argv[1]
rows = []
for f in ("census.jsonl", "hook.jsonl"):
    rows += [json.loads(l) for l in open(os.path.join(R, f))]
mins = collections.defaultdict(dict)
for r in rows:
    if "bin" not in r: continue
    m = mins[(r["set"], r["repo"], r["metric"], r["bin"])]
    for k, v in (("wall", r["wall"]), ("cpu", r["user"] + r["sys"]), ("rss", r["rss_kb"] / 1024)):
        m[k] = min(m.get(k, 1e18), v)
def g(v): return math.exp(sum(map(math.log, v)) / len(v))
def cell(s, r, metric, x):
    b = mins[(s, r, metric, "base")][x]; n = mins[(s, r, metric, "new")][x]
    f = "{:.0f}" if x == "rss" else "{:.2f}"
    return f"{f.format(b)} → {f.format(n)} ({n/b:.2f}×)"
repos = sorted({(k[0], k[1]) for k in mins if k[2] == "census_warm"}, key=lambda x: (["ts", "py", "py2"].index(x[0]), x[1].lower()))
print("| repo | warm CPU s | warm MB | cold CPU s | cold MB |\n|---|---|---|---|---|")
for s, r in repos:
    print(f"| {s}/{r} | {cell(s,r,'census_warm','cpu')} | {cell(s,r,'census_warm','rss')} | {cell(s,r,'census_cold','cpu')} | {cell(s,r,'census_cold','rss')} |")
print("\nSUMMARY\n| set | metric | CPU | peak RSS | wall |\n|---|---|---|---|---|")
for lang, sets in (("TS", ("ts",)), ("Python", ("py", "py2"))):
    for metric, name in (("census_cold", "census cold"), ("census_warm", "census warm"), ("check_file", "check FILE"), ("hook", "hook"), ("hook_edit", "hook+edit")):
        rat = collections.defaultdict(list)
        for (s, r, m, b) in list(mins):
            if s in sets and m == metric and b == "base" and (s, r, m, "new") in mins:
                for x in ("cpu", "rss", "wall"):
                    bb = mins[(s, r, m, "base")][x]
                    if bb > 0.005: rat[x].append(mins[(s, r, m, "new")][x] / bb)
        if rat:
            f = lambda x: f"{g(rat[x]):.2f}×, {min(rat[x]):.2f}–{max(rat[x]):.2f}×"
            print(f"| {lang} ({len(rat['rss'])}) | {name} | {f('cpu')} | {f('rss')} | {f('wall')} |")
print("\nTWENTY NETBOX\n| repo | metric | CPU s | peak MB | wall s |\n|---|---|---|---|---|")
for s, r in (("ts", "twenty"), ("py", "netbox")):
    for metric, name in (("census_cold", "census cold"), ("census_warm", "census warm"), ("check_file", "check FILE"), ("hook", "hook"), ("hook_edit", "hook+edit")):
        print(f"| {s}/{r} | {name} | {cell(s,r,metric,'cpu')} | {cell(s,r,metric,'rss')} | {cell(s,r,metric,'wall')} |")
print("\nHOOK TS\n| repo | hook s | hook+edit s | hook+edit CPU s | hook+edit MB |\n|---|---|---|---|---|")
for s, r in sorted({(k[0], k[1]) for k in mins if k[2] == "hook_edit"}, key=lambda x: (["ts", "py", "py2"].index(x[0]), x[1].lower())):
    print(f"| {s}/{r} | {cell(s,r,'hook','wall')} | {cell(s,r,'hook_edit','wall')} | {cell(s,r,'hook_edit','cpu')} | {cell(s,r,'hook_edit','rss')} |")
