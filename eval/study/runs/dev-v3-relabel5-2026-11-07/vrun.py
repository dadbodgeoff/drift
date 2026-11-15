"""Run the frozen verifier (prompt v3) on every relabel5 suggestion-tier card with the headless CLI, as R6 did.

usage: python3 -I vrun.py --model ALIAS --payloads DIR --out DIR [--jobs 3]
  --model     R6's frozen small-model alias, given on the command line (no identifier is stored in this file)
  --payloads  the product's payloads (drift_verify_card, restage.sh): DIR/<repo>.json
  --out       a private directory outside the repository: raw/<repo>__<id>.s<k>.json per sample, verdicts/<repo>.json

Per sample: one fresh `claude -p` process, every tool disabled (`--tools ""`), no MCP servers, no settings, no session
persistence, run in an empty directory; the system prompt is the payload's `system_prompt` (prompt v3, checked
byte-for-byte against its sha256) and the user turn, on stdin, is the payload's `message`. Nothing else is in context.
At most --jobs calls at once. A call that fails (non-zero exit, no JSON result, an error result, or a reply that
Sample::parse would reject) is retried once in a fresh process; every attempt is recorded (exit status, raw reply,
cost, duration, CLI version). The decision is the product's (decide.sh: Sample::parse and decide via drift_verify_card).
Reads no label.
"""
import argparse, hashlib, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPT_SHA = "8298c26d06be051afa59585b136e4d0f122039bdbe67848097656cc28792ee1d"
OK_VERDICTS = {"violation", "exception", "ignore"}


def sample_ok(raw):
    """Mirror of Sample::parse (crates/drift-mine/src/verify.rs), only to decide a retry; decide.sh runs the product's."""
    if not isinstance(raw, str):
        return False
    a, b = raw.find("{"), raw.rfind("}")
    if a < 0 or b <= a:
        return False
    try:
        o = json.loads(raw[a:b + 1])
    except Exception:
        return False
    return isinstance(o, dict) and isinstance(o.get("intended"), bool) and isinstance(o.get("outliers"), list) and all(v in OK_VERDICTS for v in o["outliers"])


def call(model, system, user, cwd):
    t0 = time.time()
    try:
        p = subprocess.run(["claude", "-p", "--model", model, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
                            "--setting-sources", "", "--system-prompt", system, "--output-format", "json"],
                           input=user, capture_output=True, text=True, cwd=cwd, timeout=300)
    except subprocess.TimeoutExpired:
        return {"exit": None, "error": "timeout", "wall_ms": int((time.time() - t0) * 1000)}
    r = {"exit": p.returncode, "wall_ms": int((time.time() - t0) * 1000)}
    try:
        j = json.loads(p.stdout)
    except Exception:
        r["error"] = (p.stdout + p.stderr)[-500:]
        return r
    r.update({"raw": j.get("result"), "is_error": j.get("is_error"), "cost_usd": j.get("total_cost_usd"), "duration_ms": j.get("duration_ms"),
              "models_used": sorted((j.get("modelUsage") or {}).keys())})
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True); ap.add_argument("--payloads", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    if a.jobs > 3:
        sys.exit("at most 3 concurrent calls")
    cli = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()
    cards = [json.loads(l) for l in open(os.path.join(HERE, "verifier", "cards.jsonl"))]
    raw_dir = os.path.join(a.out, "raw"); os.makedirs(raw_dir, exist_ok=True)
    empty = os.path.join(a.out, "empty"); os.makedirs(empty, exist_ok=True)
    pay = {}
    jobs = []
    for c in cards:
        if c["repo"] not in pay:
            pay[c["repo"]] = json.load(open(os.path.join(a.payloads, c["repo"] + ".json")))
        y = pay[c["repo"]][c["id"]]
        if hashlib.sha256(y["system_prompt"].encode()).hexdigest() != PROMPT_SHA:
            sys.exit(f"{c['uid']}: system prompt is not the frozen v3")
        if y["content_hash"] != c["payload"]["content_hash"] or hashlib.sha256(y["message"].encode()).hexdigest() != c["payload"]["message_sha256"]:
            sys.exit(f"{c['uid']}: payload differs from verifier/cards.jsonl")
        for s in range(y["samples"]):
            f = os.path.join(raw_dir, f"{c['repo']}__{c['id']}.s{s}.json")
            if not os.path.exists(f):
                jobs.append((c, s, y, f))

    def run(job):
        c, s, y, f = job
        attempts = []
        for _ in range(2):  # one retry
            r = call(a.model, y["system_prompt"], y["message"], empty)
            attempts.append(r)
            if r.get("exit") == 0 and not r.get("is_error") and sample_ok(r.get("raw")):
                break
        rec = {"uid": c["uid"], "sample": s, "model_alias": a.model, "cli_version": cli, "content_hash": y["content_hash"],
               "attempts": attempts, "reply": attempts[-1].get("raw"), "ok": sample_ok(attempts[-1].get("raw"))}
        with open(f + ".tmp", "w") as fh:
            json.dump(rec, fh)
        os.replace(f + ".tmp", f)
        return rec

    done = 0
    cost = 0.0
    with ThreadPoolExecutor(a.jobs) as ex:
        for rec in ex.map(run, jobs):
            done += 1
            cost += sum(x.get("cost_usd") or 0 for x in rec["attempts"])
            if done % 30 == 0 or done == len(jobs):
                print(f"{done}/{len(jobs)} ${cost:.3f}", flush=True)
    # verdict arrays per repo for decide.sh (every card with all its samples)
    vd = os.path.join(a.out, "verdicts"); os.makedirs(vd, exist_ok=True)
    per = {}
    for c in cards:
        recs = []
        for s in range(3):
            f = os.path.join(raw_dir, f"{c['repo']}__{c['id']}.s{s}.json")
            if os.path.exists(f):
                recs.append(json.load(open(f)))
        if len(recs) != 3:
            continue
        per.setdefault(c["repo"], {})[c["id"]] = {"content_hash": c["payload"]["content_hash"], "verdicts": [r["reply"] if r["reply"] is not None else "" for r in recs]}
    for repo, v in per.items():
        json.dump(v, open(os.path.join(vd, repo + ".json"), "w"), indent=1)
    print(f"verdicts for {sum(len(v) for v in per.values())} cards in {len(per)} repos")


main()
