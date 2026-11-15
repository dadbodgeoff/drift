# Prevalence of H1/H2/H3 on the build folds, aggregates only. usage: prevalence.py <before-dir> <worktree> [<m1-dir> <m2-dir>]
import json, sys, os, collections
B, WT = sys.argv[1], sys.argv[2]
M1 = sys.argv[3] if len(sys.argv) > 3 else None
M2 = sys.argv[4] if len(sys.argv) > 4 else None
folds = json.load(open(f"{WT}/eval/study/folds-r11.json"))["folds"]
fold_of = {}; lang_of = {}
for f in folds:
    for l in ("ts", "py"):
        for r in f[l]: fold_of[r] = f["fold"]; lang_of[r] = l
labels = {}
R = f"{WT}/eval/study/runs"
for p in [f"{R}/dev-v3-relabel5-2026-11-07/{x}/final.jsonl" for x in ("ts","py","py2")] + [f"{R}/dev3-{x}-2026-11-08/final.jsonl" for x in ("ts","py")]:
    for line in open(p):
        r = json.loads(line); labels[r["uid"]] = (r["label"], r.get("wrong_because"))
def area(p):
    s = p.split("/"); k = min(max(len(s) - 1, 1), 2); return "/".join(s[:k])
def scope(role):
    d = role["dir"]; d = "" if d in (".", "**") else d
    pk = role["package"]
    return d if not pk else (pk if not d else f"{pk}/{d}")
def load(d, r, kind):
    p = f"{d}/{kind}/{r}.json"
    return json.load(open(p))["proposals"] if os.path.exists(p) else []
def layering(ps):
    return [p for p in ps if p["rule"].get("type") == "avoids" and p["rule"]["signal"].startswith("import:") and not p["rule"]["signal"].startswith("import:pkg:")]
rolekey = lambda p: json.dumps(p["role"], sort_keys=True)
agg = collections.defaultdict(collections.Counter)
lab = collections.defaultdict(collections.Counter)
for r in sorted(fold_of):
    if lang_of[r] != "ts": continue
    fo = fold_of[r]; A = agg[fo]; T = agg["all"]
    imps = collections.defaultdict(list)
    for line in open(f"{B}/imports/{r}.jsonl"):
        i = json.loads(line); imps[i["file"]].append((i["module"], i["type_only"]))
    allp = layering(load(B, r, "all-json")); shown = {p["id"] for p in layering(load(B, r, "census-json"))}
    # split: one role, >= 2 layering proposals whose two-segment targets share a parent
    byrole = collections.defaultdict(set)
    for p in allp:
        t = p["rule"]["signal"][7:]
        if "/" in t: byrole[rolekey(p)].add(t.split("/")[0])
    parents = collections.Counter()
    for p in allp:
        t = p["rule"]["signal"][7:]
        if "/" in t: parents[(rolekey(p), t.split("/")[0])] += 1
    for X in (A, T):
        X["repos"] += 1
        X["split_roles"] += sum(1 for v in parents.values() if v >= 2)
        X["split_cards"] += sum(v for v in parents.values() if v >= 2)
    for p in allp:
        t = p["rule"]["signal"][7:]; sc = scope(p["role"]); isshown = p["id"] in shown
        outs = [o["path"] for o in p["outliers"]]
        tags = []
        if "/" in t:
            par = t.split("/")[0]
            if not (sc == par or sc.startswith(par + "/")): tags.append("h1_widenable_in_principle")
        cnt = collections.Counter()
        for o in outs:
            for m in {m for (m, ty) in imps.get(o, []) if area(m) == t}: cnt[m] += 1
        ranked = cnt.most_common()
        n = len(outs)
        if ranked:
            top = ranked[0][1]; tie = len(ranked) > 1 and ranked[1][1] == top
            if n >= 3 and top >= 3 and top >= 0.75 * n and not tie: tags.append("h2_strict")
            if n >= 2 and top >= 2 and top > 0.5 * n and not tie: tags.append("h2_loose")
        # H3: files in the role's scope, not outliers, with a type-only import into the target and no value import
        outset = set(outs); h3 = 0
        for f, ims in imps.items():
            if sc and not f.startswith(sc + "/"): continue
            if f in outset: continue
            if any(ty and area(m) == t for m, ty in ims) and not any((not ty) and area(m) == t for m, ty in ims): h3 += 1
        if h3: tags.append("h3_type_only_importers")
        for X in (A, T):
            X["cards"] += 1; X["shown"] += isshown
            X["outliers"] += n
            for g in tags:
                X[g] += 1; X[g + "_shown"] += isshown
            if "h3_type_only_importers" in tags: X["h3_files"] += h3
        if isshown:
            L = labels.get(f"{r}/{p['id']}")
            l = "UNLABELLED" if not L else (L[0] + (":" + L[1] if L[1] else ""))
            for g in tags + ["any"]:
                lab[(fo, g)][l] += 1; lab[("all", g)][l] += 1
print("TS layering proposals (census --all --max 200), per fold. Shown = census --json --max 15.")
keys = ["repos","cards","shown","outliers","split_roles","split_cards","h1_widenable_in_principle","h1_widenable_in_principle_shown","h2_strict","h2_strict_shown","h2_loose","h2_loose_shown","h3_type_only_importers","h3_type_only_importers_shown","h3_files"]
print("fold\t" + "\t".join(keys))
for fo in [1,2,3,4,5,"all"]:
    print(f"{fo}\t" + "\t".join(str(agg[fo][k]) for k in keys))
print("\nLabels of shown cards (relabel5 / dev3), by tag, per fold:")
for (fo, g), c in sorted(lab.items(), key=lambda x: (str(x[0][0]), x[0][1])):
    print(f"  fold {fo} {g}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
