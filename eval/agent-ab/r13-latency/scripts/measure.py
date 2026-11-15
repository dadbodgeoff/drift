#!/usr/bin/env python3
"""Run a command, print wall seconds and peak RSS (KiB) of the child as JSON.

usage: measure.py [--stdin FILE] [--out FILE] [--cwd DIR] [--env K=V ...] -- cmd args...
"""
import json
import os
import sys
import time

args = sys.argv[1:]
stdin_path = out_path = cwd = None
env = dict(os.environ)
while args and args[0] != "--":
    k = args.pop(0)
    if k == "--stdin":
        stdin_path = args.pop(0)
    elif k == "--out":
        out_path = args.pop(0)
    elif k == "--cwd":
        cwd = args.pop(0)
    elif k == "--env":
        kv = args.pop(0)
        a, b = kv.split("=", 1)
        env[a] = b
    else:
        sys.exit(f"unknown flag {k}")
cmd = args[1:]
t0 = time.perf_counter()
pid = os.fork()
if pid == 0:
    if cwd:
        os.chdir(cwd)
    fd_in = os.open(stdin_path or os.devnull, os.O_RDONLY)
    os.dup2(fd_in, 0)
    fd_out = os.open(out_path or os.devnull, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.dup2(fd_out, 1)
    err = os.open((out_path + ".err") if out_path else os.devnull, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.dup2(err, 2)
    os.execvpe(cmd[0], cmd, env)
_, status, ru = os.wait4(pid, 0)
wall = time.perf_counter() - t0
print(json.dumps({
    "wall": round(wall, 4),
    "rss_kb": ru.ru_maxrss,
    "user": round(ru.ru_utime, 3),
    "sys": round(ru.ru_stime, 3),
    "code": os.waitstatus_to_exitcode(status),
}))
