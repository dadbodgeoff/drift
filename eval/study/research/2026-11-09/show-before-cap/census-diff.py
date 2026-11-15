"""Census diff of the show-before-cap change against F11 on the 54 build clones (folds-r11.json).

usage: python3 -I census-diff.py <scratch> <f11-bin> <p1-bin> <out.json>

Per repo, `census --json` with the product defaults and with `--python-proposals` (the opt-in
view), once with each binary, one drift process at a time, each with a fresh private cache that
is deleted after. Reports, per repo and view, the proposals and the shown ones (shown_by_default)
that are new, lost, or changed (same id, other evidence, outliers, tier or rank-independent text).
"""
import json, os, shutil, subprocess, sys, tempfile

scratch, f11, p1, out = sys.argv[1:5]
wt = os.path.dirname(os.path.abspath(__file__)) + "/../../../../.."
folds = json.load(open(os.path.join(wt, "eval/study/folds-r11.json")))
clones = os.path.join(scratch, "dev-clones")
part = {}
for d in ("ts", "py", "py2", "dev3"):
    for name in os.listdir(os.path.join(clones, d)):
        part[name] = d


def census(binary, root, extra):
    cache = tempfile.mkdtemp(dir=os.path.join(scratch, "recall11"))
    try:
        r = subprocess.run([binary, "--root", root, "census", "--json", *extra],
                           capture_output=True, text=True, env=dict(os.environ, DRIFT_CACHE_DIR=cache))
        if r.returncode != 0:
            raise SystemExit(f"{root}: {r.stderr[:400]}")
        return json.loads(r.stdout)
    finally:
        shutil.rmtree(cache, ignore_errors=True)


def card(p):
    return {"id": p["id"], "tier": p["tier"], "rule_kind": p["rule_kind"], "language": p["language"],
            "shown": p["shown_by_default"], "rank": p["rank"], "summary": p["summary"],
            "evidence": [p["evidence"]["holders"], p["evidence"]["total"]],
            "outliers": [f'{o["path"]}#{o["symbol"]}' for o in p.get("outliers", [])],
            "agents": p.get("agents", {}).get("reason")}


rows = []
for f in folds["folds"]:
    for lang in ("ts", "py"):
        for name in f[lang]:
            root = os.path.join(clones, part[name], name)
            sha = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            for view, extra in (("default", []), ("optin", ["--python-proposals"])):
                a = {p["id"]: card(p) for p in census(f11, root, extra)["proposals"]}
                b = {p["id"]: card(p) for p in census(p1, root, extra)["proposals"]}
                strip = lambda c: {k: v for k, v in c.items() if k not in ("rank", "shown")}
                rows.append({
                    "repo": name, "lang": lang, "fold": f["fold"], "view": view, "sha": sha,
                    "f11": len(a), "p1": len(b),
                    "f11_shown": sum(c["shown"] for c in a.values()),
                    "p1_shown": sum(c["shown"] for c in b.values()),
                    "new": [b[i] for i in b if i not in a],
                    "lost": [a[i] for i in a if i not in b],
                    "changed": [{"id": i, "f11": a[i], "p1": b[i]} for i in a if i in b and strip(a[i]) != strip(b[i])],
                    "unshown": [i for i in a if i in b and a[i]["shown"] and not b[i]["shown"]],
                    "newly_shown": [i for i in a if i in b and b[i]["shown"] and not a[i]["shown"]],
                })
                r = rows[-1]
                print(f'{name:28} {view:7} f11 {r["f11"]:2} ({r["f11_shown"]:2} shown) p1 {r["p1"]:2} ({r["p1_shown"]:2} shown) '
                      f'new {len(r["new"])} lost {len(r["lost"])} changed {len(r["changed"])} unshown {len(r["unshown"])}', flush=True)
json.dump(rows, open(out, "w"), indent=1)
