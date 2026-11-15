"""usage: python3 -I mcp_call.py BIN ROOT OUT.json REQUESTS.json
REQUESTS: [{"name": tool, "arguments": {...}}, ...] -> OUT: [result-or-error, ...] in order (one drift mcp session)."""
import json, subprocess, sys
binp, root, out, reqf = sys.argv[1:5]
reqs = json.load(open(reqf))
msgs = [{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "sem11", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"}, {"jsonrpc": "2.0", "id": "list", "method": "tools/list"}]
for i, r in enumerate(reqs, 1):
    msgs.append({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": r})
p = subprocess.run([binp, "--root", root, "mcp"], input="".join(json.dumps(m) + "\n" for m in msgs), capture_output=True, text=True, timeout=7200)
rep = {}
for line in p.stdout.splitlines():
    if line.strip():
        x = json.loads(line); rep[x.get("id")] = x
names = [t["name"] for t in rep.get("list", {}).get("result", {}).get("tools", [])]
res = []
for i in range(1, len(reqs) + 1):
    x = rep.get(i)
    if x is None: res.append({"error": "no reply"}); continue
    if "error" in x: res.append({"error": x["error"]}); continue
    txt = "".join(c.get("text", "") for c in x["result"].get("content", []))
    if x["result"].get("isError"): res.append({"error": txt}); continue
    try: res.append(json.loads(txt))
    except Exception: res.append({"text": txt})
json.dump({"tools": names, "results": res}, open(out, "w"), indent=1)
print(f"{sum(1 for r in res if 'error' not in r)}/{len(res)} ok; tools {names}", file=sys.stderr)
