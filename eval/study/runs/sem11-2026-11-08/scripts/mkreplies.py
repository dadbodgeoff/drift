"""usage: mkreplies.py IDS.json REPO RAWDIR PAYLOADS.json -> MCP requests with the 3 replies of each card (only cards with 3 samples)."""
import json, os, sys
ids, repo, raw, pay = sys.argv[1:5]
P = {y["id"]: y for y in json.load(open(pay))["results"] if "message" in y}
out = []
for i in json.load(open(ids)):
    if i not in P: continue
    recs = [os.path.join(raw, f"{repo}__{i}.s{s}.json") for s in range(3)]
    if not all(os.path.exists(r) for r in recs): continue
    R = [json.load(open(r)) for r in recs]
    models = sorted({m for r in R for a in r["attempts"] for m in (a.get("models_used") or [])})
    if len(models) != 1: print(f"{repo}/{i}: models {len(models)}", file=sys.stderr); continue
    out.append({"name": "drift_semantic_card", "arguments": {"id": i, "content_hash": P[i]["content_hash"], "model": models[0], "replies": [r["reply"] if r["reply"] is not None else "" for r in R]}})
print(json.dumps(out))
