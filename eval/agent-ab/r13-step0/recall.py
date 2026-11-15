#!/usr/bin/env python3
"""How close each recreated unit is to the deleted original (a recall check).

The task repos are public, so a model may have seen the deleted unit in training. Per run:
the line-level similarity (difflib ratio over stripped, non-blank lines) between the lines the
run added and the lines the removal commit deleted, and whether the run reproduced the
original's lines exactly.

usage: python3 -I recall.py <work dir of run.mjs> <out.json>
"""
import difflib, glob, json, os, subprocess, sys

work, out = sys.argv[1], sys.argv[2]


def lines(patch, sign):
    return [l[1:].strip() for l in patch.splitlines()
            if l.startswith(sign) and not l.startswith(sign * 3) and l[1:].strip()]


orig = {}
for d in glob.glob(f"{work}/repos/*/PREPARED"):
    repo = os.path.dirname(d)
    p = json.load(open(d))
    diff = subprocess.run(["git", "-C", repo, "diff", p["commit"], p["base"]], capture_output=True, text=True).stdout
    orig[os.path.basename(repo)] = lines(diff, "+")
rows = []
for d in sorted(glob.glob(f"{work}/runs/*")):
    if not os.path.exists(f"{d}/score.json"):
        continue
    run = os.path.basename(d)
    task, _, tier, rep = run.split("__")
    got = lines(open(f"{d}/changes.patch").read(), "+")
    o = orig[task]
    ratio = difflib.SequenceMatcher(None, o, got, autojunk=False).ratio() if o and got else 0.0
    covered = sum(1 for l in o if l in set(got)) / len(o) if o else 0.0
    rows.append({"run": run.replace("__control__", "__"), "task": task, "tier": tier, "ratio": round(ratio, 3),
                 "original_lines_reproduced": round(covered, 3), "identical": o == got})
json.dump(rows, open(out, "w"), indent=1)
for tier in sorted({r["tier"] for r in rows}):
    rs = [r for r in rows if r["tier"] == tier]
    rs.sort(key=lambda r: r["ratio"])
    med = rs[len(rs) // 2]["ratio"] if rs else None
    print(f"{tier}: n={len(rs)} median similarity {med}, >=0.9: {sum(r['ratio'] >= 0.9 for r in rs)}, identical: {sum(r['identical'] for r in rs)}")
for t in sorted({r["task"] for r in rows}):
    rs = [r["ratio"] for r in rows if r["task"] == t]
    print(f"  {t}: {sorted(rs)}")
