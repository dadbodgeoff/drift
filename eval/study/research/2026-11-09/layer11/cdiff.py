# census diff: before-dir after-dir worktree -> changed cards, with tier and label
import json, sys, os
B, A, WT = sys.argv[1:4]
R = f"{WT}/eval/study/runs"
labels = {}
for p in [f"{R}/dev-v3-relabel5-2026-11-07/{x}/final.jsonl" for x in ("ts","py","py2")] + [f"{R}/dev3-{x}-2026-11-08/final.jsonl" for x in ("ts","py")]:
    for line in open(p):
        r = json.loads(line); labels[r["uid"]] = r["label"] + (":" + r["wrong_because"] if r.get("wrong_because") else "")
folds = json.load(open(f"{WT}/eval/study/folds-r11.json"))["folds"]
fold_of = {r: f["fold"] for f in folds for l in ("ts","py") for r in f[l]}
def load(d, r):
    return {p["id"]: p for p in json.load(open(f"{d}/{r}.json"))["proposals"]}
n = 0
for r in sorted(fold_of):
    if not os.path.exists(f"{A}/{r}.json"): continue
    b, a = load(B, r), load(A, r)
    for i in sorted(set(b) | set(a)):
        pb, pa = b.get(i), a.get(i)
        if pb and pa and (pb["tier"], pb["outliers_total"], pb["summary"], pb["evidence"]["holders"], pb["evidence"]["total"]) == (pa["tier"], pa["outliers_total"], pa["summary"], pa["evidence"]["holders"], pa["evidence"]["total"]):
            continue
        n += 1
        st = "gone" if not pa else "new" if not pb else "changed"
        p = pa or pb
        ev = lambda x: f"{x['evidence']['holders']}/{x['evidence']['total']} out={x['outliers_total']} {x['tier']}" if x else "-"
        print(f"fold {fold_of[r]} {r} {i} {st} [{labels.get(r+'/'+i,'UNLABELLED')}] {ev(pb)} -> {ev(pa)} :: {p['summary'][:150]}")
print(f"{n} changed")
