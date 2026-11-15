#!/usr/bin/env python3
"""Run the pinned Python evaluation: clone each repo at its commit, scan it,
compare every import with importlib (oracle.py), mine conventions, check thresholds.

    python3 eval/oracle-py/run.py --drift target/release/drift [--cache DIR] [--only a,b] [--out results.json]

Runs only git and drift; repository code is never executed. Exit code 1 when a
repo breaks a threshold in eval/repos-py.json.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def checkout(cache: Path, repo: dict) -> Path:
    d = cache / "repos" / repo["name"]
    if (d / ".git").is_dir():
        head = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        if head == repo["sha"]:
            return d
    d.mkdir(parents=True, exist_ok=True)
    git = lambda *a: subprocess.run(["git", "-C", d, *a], check=True, stdout=subprocess.DEVNULL)
    if not (d / ".git").is_dir():
        git("init", "-q")
    git("fetch", "-q", "--depth", "1", repo["url"], repo["sha"])
    git("checkout", "-q", "--force", "FETCH_HEAD")
    return d


def run(cmd: list, stdout=None) -> tuple[subprocess.CompletedProcess, float]:
    """Run a command; return (result, seconds)."""
    started = time.monotonic()
    p = subprocess.Popen(cmd, stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = p.communicate()
    secs = time.monotonic() - started
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed ({p.returncode}): {err[:500]}")
    return subprocess.CompletedProcess(cmd, p.returncode, out, err), secs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drift", default=str(HERE.parent.parent / "target" / "release" / "drift"))
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "drift-eval-py"))
    ap.add_argument("--only", default="")
    ap.add_argument("--out")
    a = ap.parse_args()
    drift = str(Path(a.drift).resolve())
    cache = Path(a.cache).resolve()
    only = set(filter(None, a.only.split(",")))
    manifest = json.loads((HERE.parent / "repos-py.json").read_text())
    results, failed = [], False
    for repo in manifest["repos"]:
        if only and repo["name"] not in only:
            continue
        limits = {**manifest["defaults"], **repo}
        work = cache / "out" / repo["name"]
        work.mkdir(parents=True, exist_ok=True)
        row = {"name": repo["name"], "shape": repo["shape"]}
        try:
            d = checkout(cache, repo)
            # Scan under a wrapper process so the peak RSS reported is drift's alone (Linux: KB).
            scan, secs = run([sys.executable, "-c",
                                 "import resource,subprocess,sys;"
                                 "r=subprocess.run(sys.argv[1:],capture_output=True,text=True);"
                                 "sys.stderr.write(r.stderr);"
                                 "print(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss);"
                                 "sys.exit(r.returncode)",
                                 drift, "--root", d, "--no-cache", "scan", "--out", work / "facts.json"])
            facts = json.loads((work / "facts.json").read_text())
            py = [f for f in facts["files"] if f["lang"] == "py"]
            row.update(
                files=len(py),
                all_files=int(re.search(r"scan: (\d+) files", scan.stderr).group(1)),
                scan_s=round(secs, 2),
                peak_mb=round(int(scan.stdout.strip()) / 1024),
                parse_errors=sum(1 for f in py if not f["parse_ok"]),
                entry_points=sum(len(f["entry_points"]) for f in py),
                symbols=sum(len(f["symbols"]) for f in py),
            )
            with open(work / "imports.jsonl", "w") as fh:
                run([drift, "--root", d, "debug", "py-imports"], stdout=fh)
            run([sys.executable, "-I", HERE / "oracle.py", d, work / "imports.jsonl", work / "facts.json",
                 "--samples", "400", "--json", work / "oracle.json"])
            o = json.loads((work / "oracle.json").read_text())
            c = o["imports"]["categories"]
            s = o["symbols"]
            row.update(
                imports=sum(v for k, v in c.items() if "name_" not in k),
                names=sum(v for k, v in c.items() if "name_" in k),
                agree=sum(v for k, v in c.items() if k.startswith("agree") or k.startswith("name_agree")),
                in_repo=c.get("agree", 0) + c.get("name_agree_submodule", 0),
                disagree=sum(v for k, v in c.items() if k.startswith("DISAGREE")),
                gaps=sum(v for k, v in c.items() if k.startswith("GAP")),
                symbol_recall=s["matched"] / s["python_names"] if s["python_names"] else 1.0,
                export_recall=s["exports_matched"] / s["exports_python"] if s["exports_python"] else 1.0,
                parse_disagreements=s["parse_disagree"],
                abstract_disagreements=s["abstract_disagree"],
            )
            census, _ = run([drift, "--root", d, "--no-cache", "census"])
            (work / "census.txt").write_text(census.stdout)
            m = re.search(r"^(\d+) conventions", census.stdout, re.M)
            row["conventions"] = int(m.group(1)) if m else None
            problems = []
            if row["parse_errors"] > limits["max_parse_errors"]:
                problems.append(f"parse errors {row['parse_errors']}")
            if row["disagree"] > limits["max_disagreements"]:
                problems.append(f"disagreements {row['disagree']}")
            if row["gaps"] > limits["max_gaps"]:
                problems.append(f"gaps {row['gaps']}")
            if row["parse_disagreements"] > limits["max_parse_disagreements"]:
                problems.append(f"parse disagreements {row['parse_disagreements']}")
            if row["abstract_disagreements"] > limits["max_abstract_disagreements"]:
                problems.append(f"abstract disagreements {row['abstract_disagreements']}")
            if row["symbol_recall"] < limits["min_symbol_recall"]:
                problems.append(f"symbol recall {row['symbol_recall']:.3f}")
            if row["export_recall"] < limits["min_export_recall"]:
                problems.append(f"export recall {row['export_recall']:.3f}")
            row["status"] = "FAIL: " + ", ".join(problems) if problems else "ok"
            failed |= bool(problems)
        except Exception as e:  # noqa: BLE001
            row["status"] = f"ERROR: {str(e).splitlines()[0]}"
            failed = True
        results.append(row)
        print(f"{row['name']}: {row['status']}", file=sys.stderr)

    fmt = lambda n: f"{n:,}" if isinstance(n, int) else "–"
    print("| Repo | Python files | Scan (all files) | Peak RSS | Import rows | Agree | Disagree | Gaps | Symbol recall | Export recall | Entry points | Conventions | Status |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in results:
        sr = f"{r['symbol_recall'] * 100:.1f}%" if "symbol_recall" in r else "–"
        er = f"{r['export_recall'] * 100:.1f}%" if "export_recall" in r else "–"
        print(f"| {r['name']} | {fmt(r.get('files'))} | {r.get('scan_s', '–')} s ({fmt(r.get('all_files'))}) | {fmt(r.get('peak_mb'))} MB "
              f"| {fmt((r.get('imports') or 0) + (r.get('names') or 0))} | {fmt(r.get('agree'))} | {fmt(r.get('disagree'))} | {fmt(r.get('gaps'))} "
              f"| {sr} | {er} | {fmt(r.get('entry_points'))} | {fmt(r.get('conventions'))} | {r['status']} |")
    if a.out:
        Path(a.out).write_text(json.dumps({"drift": drift, "results": results}, indent=2))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
