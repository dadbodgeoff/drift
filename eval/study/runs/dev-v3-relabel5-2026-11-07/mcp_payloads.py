"""Ask `drift mcp` (drift_verify_card with only `id`) for the payload of each id, in one server session.
usage: python3 -I mcp_payloads.py BIN ROOT OUT.json ID [ID...]
Writes {id: payload-or-{"error"/"text": ...}}. The server is the product's own MCP path (mcp.rs verify_card)."""
import json, subprocess, sys
binp, root, out, ids = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
msgs = [{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "relabel5", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": "list", "method": "tools/list"}]
for i, cid in enumerate(ids, 1):
    msgs.append({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": "drift_verify_card", "arguments": {"id": cid}}})
p = subprocess.run([binp, "--root", root, "mcp"], input="".join(json.dumps(m) + "\n" for m in msgs), capture_output=True, text=True, timeout=3600)
replies = {}
for line in p.stdout.splitlines():
    if line.strip():
        r = json.loads(line); replies[r.get("id")] = r
names = [t["name"] for t in replies.get("list", {}).get("result", {}).get("tools", [])]
assert "drift_verify_card" in names, ("drift_verify_card not listed", names, p.stderr[-500:])
res = {}
for i, cid in enumerate(ids, 1):
    r = replies.get(i)
    if r is None:
        res[cid] = {"error": "no reply"}; continue
    if "error" in r:
        res[cid] = {"error": r["error"]}; continue
    content = r["result"].get("content", [])
    txt = "".join(c.get("text", "") for c in content)
    if r["result"].get("isError"):
        res[cid] = {"error": txt}; continue
    try:
        res[cid] = json.loads(txt)
    except Exception:
        res[cid] = {"text": txt}
json.dump(res, open(out, "w"), indent=1)
ok = sum(1 for v in res.values() if "message" in v)
print(f"{ok}/{len(ids)} payloads", file=sys.stderr)
