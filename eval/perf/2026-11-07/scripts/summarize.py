#!/usr/bin/env python3
"""Summarise results.jsonl: median per (repo, bin, metric), ratios, flags."""
import json
import statistics
import sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1])]
fmt = sys.argv[2] if len(sys.argv) > 2 else "text"
files = {(r["set"], r["repo"]): r["path"] for r in rows if r.get("metric") == "file"}
agg = defaultdict(list)
order = []
for r in rows:
    if "wall" not in r:
        continue
    k = (r["set"], r["repo"])
    if k not in order:
        order.append(k)
    agg[(k, r["bin"], r["metric"])].append(r)

METRICS = ["census_cold", "census_warm", "check_file", "hook_same", "hook_edit"]


def med(k, b, m, f):
    v = agg.get((k, b, m))
    if not v:
        return None
    return min(f(x) for x in v)


wall = lambda x: x["wall"]
rss = lambda x: x["rss_kb"] / 1024
cpu = lambda x: x["user"] + x["sys"]
out = []
flags = []
for k in order:
    row = {"set": k[0], "repo": k[1], "file": files.get(k)}
    for m in METRICS:
        for name, f in (("wall", wall), ("rss", rss), ("cpu", cpu)):
            b = med(k, "base", m, f)
            a = med(k, "main", m, f)
            if b is None or a is None:
                continue
            row[f"{m}.{name}.base"] = round(b, 3)
            row[f"{m}.{name}.main"] = round(a, 3)
            ratio = a / b if b > 0 else None
            row[f"{m}.{name}.ratio"] = round(ratio, 2) if ratio else None
            hook = m.startswith("hook") or m == "check_file"
            bar = 1.2 if hook else 1.3
            # Ratios on tiny absolute numbers are noise: ignore below 0.1 s / 20 MB.
            floor = 20 if name == "rss" else 0.1
            if ratio and ratio > bar and a >= floor:
                flags.append((k, m, name, b, a, ratio))
            if hook and name == "wall" and a > 0.5:
                flags.append((k, m, "wall>500ms", b, a, ratio))
    out.append(row)

if fmt == "json":
    json.dump({"rows": out, "flags": [list(f) for f in flags]}, sys.stdout, indent=1)
    sys.exit()

hdr = ("repo", "cold s", "cold MB", "warm s", "warm MB", "check s", "check MB", "hook s", "hook+edit s")
print("| " + " | ".join(hdr) + " |")
print("|" + "---|" * len(hdr))


def cell(r, m, n):
    b, a, x = r.get(f"{m}.{n}.base"), r.get(f"{m}.{n}.main"), r.get(f"{m}.{n}.ratio")
    if b is None:
        return "-"
    p = 0 if n == "rss" else 2
    return f"{b:.{p}f} → {a:.{p}f} ({x:.2f}×)" if x else f"{b:.{p}f} → {a:.{p}f}"


for r in out:
    print("| " + " | ".join([
        f"{r['set']}/{r['repo']}",
        cell(r, "census_cold", "wall"), cell(r, "census_cold", "rss"),
        cell(r, "census_warm", "wall"), cell(r, "census_warm", "rss"),
        cell(r, "check_file", "wall"), cell(r, "check_file", "rss"),
        cell(r, "hook_same", "wall"), cell(r, "hook_edit", "wall"),
    ]) + " |")
print()
print(f"{len(flags)} flags")
for f in flags:
    print(f"  {f[0][0]}/{f[0][1]} {f[1]} {f[2]}: {f[3]:.3f} -> {f[4]:.3f} ({f[5]:.2f}x)" if f[5] else f)
