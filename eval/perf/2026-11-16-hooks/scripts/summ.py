#!/usr/bin/env python3
"""Summarise drive.py's rows: p50/p95/max per repository and event, wall and the hook's own ms."""
import collections
import json
import sys

rows = [json.loads(x) for x in open(sys.argv[1]) if x.strip()]


def pct(v, q):
    v = sorted(v)
    return v[min(len(v) - 1, int(round(q * (len(v) - 1))))]


g = collections.defaultdict(list)
for r in rows:
    ev = r["event"] + (" (first, cold cache)" if r.get("first") else "")
    g[(r["repo"] + (" (blocking)" if r.get("blocking") else ""), ev)].append(r)
print("| repo | event | n | wall p50 ms | wall p95 ms | wall max ms | hook's own p95 ms | paths taken |")
print("|---|---|---|---|---|---|---|---|")
for (repo, ev), rs in sorted(g.items()):
    w = [r["wall_ms"] for r in rs]
    m = [r["ms"] for r in rs if r["ms"] is not None]
    paths = collections.Counter((r["path"] or "?").split(":")[0] for r in rs)
    print(f"| {repo} | {ev} | {len(rs)} | {pct(w, .5):.0f} | {pct(w, .95):.0f} | {max(w):.0f} | "
          f"{pct(m, .95) if m else '-'} | {', '.join(f'{k} {n}' for k, n in paths.most_common())} |")
bad = [r for r in rows if r["rc"] != 0]
print(f"\nrows: {len(rows)}; non-zero exits: {len(bad)}")
