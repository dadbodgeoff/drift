#!/usr/bin/env python3
"""rssprof.py CACHE -- cmd...: sample /proc/pid/smaps; print peak total Rss and its breakdown by mapping size class."""
import os, subprocess, sys, time, collections
cache = sys.argv[1]; cmd = sys.argv[3:]
env = dict(os.environ, DRIFT_CACHE_DIR=cache)
p = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
best = (0, None, 0.0); t0 = time.time(); series = []
while p.poll() is None:
    try:
        txt = open(f"/proc/{p.pid}/smaps").read()
    except Exception:
        break
    maps = []; cur = None
    for l in txt.split("\n"):
        f = l.split()
        if not f: continue
        if "-" in f[0] and len(f) >= 5 and ":" not in f[0]:
            a, b = f[0].split("-"); cur = [int(b, 16) - int(a, 16), f[5] if len(f) > 5 else "", 0]; maps.append(cur)
        elif f[0] == "Rss:" and cur is not None:
            cur[2] = int(f[1])
    tot = sum(m[2] for m in maps)
    series.append((round(time.time() - t0, 2), tot // 1024))
    if tot > best[0]: best = (tot, maps, time.time() - t0)
    time.sleep(0.02)
tot, maps, t = best
print(f"peak {tot//1024} MB at {t:.2f}s of {time.time()-t0:.2f}s")
cls = collections.Counter()
for size, name, rss in maps:
    if name: k = name if name.startswith("[") else "file:" + os.path.basename(name)
    elif size >= 60 << 20 and size <= 70 << 20: k = "anon 64MB (malloc arena)"
    else: k = f"anon {size>>20}MB"
    cls[k] += rss
for k, v in cls.most_common(14): print(f"  {v//1024:6d} MB  {k}")
print("series:", series[::max(1, len(series)//25)])
