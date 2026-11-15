"""Send each card's 3 verifier replies to the product (`drift mcp`, drift_verify_card with id, content_hash and
verdicts), which parses them (Sample::parse), decides (decide: 2 of 3) and caches; then read the cache back.
usage: python3 -I mcp_decide.py BIN ROOT VERDICTS.json OUT.jsonl REPO
Appends one row per card to OUT.jsonl: uid, the tool's reply text, and passes/pass from .drift/verify-cache.json."""
import json, os, subprocess, sys
binp, root, vf, out, repo = sys.argv[1:6]
want = json.load(open(vf))
ids = sorted(want)
msgs = [{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "relabel5", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"}]
for i, cid in enumerate(ids, 1):
    w = want[cid]
    msgs.append({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": "drift_verify_card", "arguments": {"id": cid, "content_hash": w["content_hash"], "verdicts": w["verdicts"]}}})
p = subprocess.run([binp, "--root", root, "mcp"], input="".join(json.dumps(m) + "\n" for m in msgs), capture_output=True, text=True, timeout=3600)
replies = {}
for line in p.stdout.splitlines():
    if line.strip():
        r = json.loads(line); replies[r.get("id")] = r
cache = {}
cf = os.path.join(root, ".drift", "verify-cache.json")
if os.path.exists(cf):
    cache = json.load(open(cf)).get("entries", {})
with open(out, "a") as fh:
    for i, cid in enumerate(ids, 1):
        r = replies.get(i, {})
        txt = "".join(c.get("text", "") for c in r.get("result", {}).get("content", [])) if "result" in r else json.dumps(r.get("error"))
        e = cache.get(cid)
        row = {"uid": f"{repo}/{cid}", "tool_error": bool(r.get("result", {}).get("isError")) or "error" in r, "tool_text": txt,
               "cached": e is not None and e["content_hash"] == want[cid]["content_hash"],
               "passes": e["passes"] if e else None, "samples": len(e["verdicts"]) if e else None, "pass": bool(e and e["pass"] and e["content_hash"] == want[cid]["content_hash"]),
               "sample_passes": None}
        fh.write(json.dumps(row) + "\n")
print(f"{repo}: {sum(1 for c in ids if cache.get(c))}/{len(ids)} cached", file=sys.stderr)
