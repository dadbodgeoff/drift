"""Run the frozen semantic prompt sem-v1 on every payload, 3 samples each, with the headless CLI as the verifier runs did.
usage: python3 -I srun.py --model ALIAS --payloads DIR --out DIR [--jobs 3]
Per sample: a fresh `claude -p` process, no tools, no MCP, no settings, no persistence, empty cwd; system prompt = payload
system_prompt (sha256 checked), user turn = payload message. Retry once when the reply would not parse. Reads no label."""
import argparse, hashlib, json, os, subprocess, sys, time, glob
from concurrent.futures import ThreadPoolExecutor
PROMPT_SHA = "95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752"
KINDS = {"same", "other"}; FLAGS = {"mistake", "look", "legit", "not_violation", "one_off"}

def parse(raw, n, f):
    if not isinstance(raw, str): return None
    a, b = raw.find("{"), raw.rfind("}")
    if a < 0 or b <= a: return None
    try: o = json.loads(raw[a:b + 1])
    except Exception: return None
    if not isinstance(o, dict): return None
    k, x = o.get("kinds"), o.get("outliers")
    if not (isinstance(k, list) and isinstance(x, list) and len(k) == n and len(x) == f): return None
    if not all(v in KINDS for v in k) or not all(v in FLAGS for v in x): return None
    return o

def call(model, system, user, cwd):
    t0 = time.time()
    try:
        p = subprocess.run(["claude", "-p", "--model", model, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
                            "--setting-sources", "", "--system-prompt", system, "--output-format", "json"],
                           input=user, capture_output=True, text=True, cwd=cwd, timeout=300)
    except subprocess.TimeoutExpired:
        return {"exit": None, "error": "timeout", "wall_ms": int((time.time() - t0) * 1000)}
    r = {"exit": p.returncode, "wall_ms": int((time.time() - t0) * 1000)}
    try: j = json.loads(p.stdout)
    except Exception:
        r["error"] = (p.stdout + p.stderr)[-500:]; return r
    u = j.get("usage") or {}
    r.update({"raw": j.get("result"), "is_error": j.get("is_error"), "cost_usd": j.get("total_cost_usd"),
              "tokens": {k: u.get(k) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")},
              "models_used": sorted((j.get("modelUsage") or {}).keys())})
    return r

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--model", required=True); ap.add_argument("--payloads", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--jobs", type=int, default=3); a = ap.parse_args()
    assert a.jobs <= 3
    raw_dir = os.path.join(a.out, "raw"); os.makedirs(raw_dir, exist_ok=True)
    empty = os.path.join(a.out, "empty"); os.makedirs(empty, exist_ok=True)
    jobs = []
    for f in sorted(glob.glob(os.path.join(a.payloads, "*.json"))):
        if f.endswith(".census.json"): continue
        repo = os.path.basename(f)[:-5]
        for y in json.load(open(f))["results"]:
            if "message" not in y: continue
            if hashlib.sha256(y["system_prompt"].encode()).hexdigest() != PROMPT_SHA: sys.exit(f"{repo}/{y['id']}: prompt is not sem-v1")
            n = len(y["members"]); fl = sum(1 for m in y["members"] if m["flagged"])
            for s in range(3):
                out = os.path.join(raw_dir, f"{repo}__{y['id']}.s{s}.json")
                if not os.path.exists(out): jobs.append((repo, y, s, n, fl, out))
    print(f"{len(jobs)} samples to run", flush=True)
    def run(job):
        repo, y, s, n, fl, out = job
        att = []
        for _ in range(2):
            r = call(a.model, y["system_prompt"], y["message"], empty); att.append(r)
            if r.get("exit") == 0 and not r.get("is_error") and parse(r.get("raw"), n, fl) is not None: break
        rec = {"uid": f"{repo}/{y['id']}", "sample": s, "content_hash": y["content_hash"], "attempts": att,
               "reply": att[-1].get("raw"), "ok": parse(att[-1].get("raw"), n, fl) is not None}
        json.dump(rec, open(out + ".tmp", "w")); os.replace(out + ".tmp", out); return rec
    done, cost = 0, 0.0
    with ThreadPoolExecutor(a.jobs) as ex:
        for rec in ex.map(run, jobs):
            done += 1; cost += sum(x.get("cost_usd") or 0 for x in rec["attempts"])
            if done % 30 == 0 or done == len(jobs): print(f"{done}/{len(jobs)} ${cost:.3f}", flush=True)
main()
