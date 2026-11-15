#!/usr/bin/env python3
"""usage: mutate.py FILE OLD NEW TESTFILTER [cargo test args...] -- apply, run, restore"""
import subprocess, sys, os, pathlib
f, old, new, flt = sys.argv[1:5]
extra = sys.argv[5:]
src = open(f).read()
assert src.count(old) == 1, f"pattern count {src.count(old)}"
open(f, "w").write(src.replace(old, new))
try:
    subprocess.run("find crates -name '*.rs' -exec touch -d '+3 hours' {} +", shell=True, check=True)
    env = dict(os.environ, CARGO_PROFILE_DEV_DEBUG="0", CARGO_INCREMENTAL="0", CARGO_TARGET_DIR="/home/user/cargo-shared")
    r = subprocess.run(["cargo", "test", "--locked"] + extra + ["--", flt], env=env, capture_output=True, text=True)
    out = r.stdout + r.stderr
    lines = [l for l in out.splitlines() if l.startswith("test ") or "test result" in l or l.startswith("error")]
    print("\n".join(lines[-12:]))
    print("MUTANT", "KILLED" if r.returncode != 0 and "FAILED" in out else "SURVIVED/ERROR", r.returncode)
finally:
    open(f, "w").write(src)
