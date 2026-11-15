"""usage: export.py RUN_DIR  -> RUN_DIR/{cards,samples,outcomes}.jsonl from the scratch payloads, raw samples and product outcomes.
Payload messages quote repository code and stay in scratch; only their sha256 and the judged members are written."""
import glob, hashlib, json, os, re, sys
W = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1]; os.makedirs(out, exist_ok=True)
cards, samples, outcomes = [], [], []
for f in sorted(glob.glob(f"{W}/payloads/*.json")):
    repo = os.path.basename(f)[:-5]
    for y in json.load(open(f))["results"]:
        if "message" not in y: continue
        uid = f"{repo}/{y['id']}"
        block = y["message"].split("## Members")[0]
        listed = [m.group(1) for m in re.finditer(r"^    outlier:  \S+:\d+ (.+)$", block, re.M)]
        calls = 0
        for s in range(3):
            r = f"{W}/srun/raw/{repo}__{y['id']}.s{s}.json"
            if not os.path.exists(r): continue
            x = json.load(open(r)); calls += len(x["attempts"])
            tok = {}
            for a in x["attempts"]:
                for k, v in (a.get("tokens") or {}).items(): tok[k] = tok.get(k, 0) + (v or 0)
            samples.append({"uid": uid, "sample": s, "content_hash": x["content_hash"], "ok": x["ok"], "attempts": len(x["attempts"]),
                            "reply": x["reply"], "tokens": tok, "cost_usd": round(sum(a.get("cost_usd") or 0 for a in x["attempts"]), 6),
                            "wall_ms": sum(a.get("wall_ms") or 0 for a in x["attempts"])})
        cards.append({"uid": uid, "repo": repo, "id": y["id"], "content_hash": y["content_hash"], "prompt_sha256": y["prompt_sha256"],
                      "message_sha256": hashlib.sha256(y["message"].encode()).hexdigest(), "message_chars": len(y["message"]),
                      "members": [{**m, "key": f"{m['path']}#{m['symbol']}"} for m in y["members"]], "outliers_total": y["outliers_total"],
                      "listed_outlier_symbols": listed if y["outliers_total"] <= 30 else listed, "calls": calls})
for f in sorted(glob.glob(f"{W}/outcomes/*.json")):
    if f.endswith(".init.txt"): continue
    repo = os.path.basename(f)[:-5]
    for r in json.load(open(f))["results"]:
        if "members" in r: outcomes.append({"uid": f"{repo}/{r['id']}", **{k: v for k, v in r.items() if k != "note"}})
        else: outcomes.append({"uid": None, "repo": repo, "error": str(r.get("error") or r.get("text"))[:300]})
for name, rows in [("cards", cards), ("samples", samples), ("outcomes", outcomes)]:
    with open(f"{out}/{name}.jsonl", "w") as fh:
        for r in rows: fh.write(json.dumps(r, sort_keys=True) + "\n")
print(len(cards), "cards", len(samples), "samples", len(outcomes), "outcomes", file=sys.stderr)
