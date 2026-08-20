"""Shared internals for the probe harness. Not invoked directly."""
import hashlib, json, os, re, statistics, sys, time

def die(msg, code=64):
    print(f"harness: {msg}", file=sys.stderr); sys.exit(code)

def env(k, required=True):
    v = os.environ.get(k)
    if required and not v: die(f"{k} unset - source env.sh first")
    return v

SENTINELS = [s for s in os.environ.get("DRIFT_BETA_REDACT", "").split(":") if s]
def redact(t):
    if not isinstance(t, str): return t
    for s in SENTINELS:
        t = t.replace(s, f"[REDACTED:{hashlib.sha256(s.encode()).hexdigest()[:8]}]")
    return t

def ledger_append(charter, row, name="jsonl"):
    d = env("DRIFT_BETA_LEDGER"); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{charter}.{name}"), "a") as f:
        f.write(json.dumps(row) + "\n")

def artifacts_dir(charter):
    d = os.path.join(env("DRIFT_BETA_ARTIFACTS"), charter)
    os.makedirs(d, exist_ok=True); return d

# ---------------------------------------------------------------- json paths
def jpath(doc, path):
    """`.a.b[0].c` over a parsed document. Returns (found, value)."""
    cur, i = doc, 0
    for part in [p for p in re.split(r"\.(?![^\[]*\])", path.lstrip(".")) if p]:
        m = re.fullmatch(r"([^\[\]]*)((?:\[\d+\])*)", part)
        if not m: return (False, None)
        key, idx = m.group(1), m.group(2)
        if key:
            if not isinstance(cur, dict) or key not in cur: return (False, None)
            cur = cur[key]
        for n in re.findall(r"\[(\d+)\]", idx):
            if not isinstance(cur, list) or int(n) >= len(cur): return (False, None)
            cur = cur[int(n)]
    return (True, cur)

# ---------------------------------------------------------------- assertions
def evaluate(asserts, rc, stdout_text, timed_out):
    """Turn declared oracles into a mechanical verdict. Returns (verdict, [checks])."""
    checks = []
    doc, parse_err = None, None
    if any(a[0].startswith("json") for a in asserts) and stdout_text is not None:
        try: doc = json.loads(stdout_text)
        except Exception as e: parse_err = str(e)

    for kind, arg in asserts:
        if kind == "exit":
            ok, detail = rc == int(arg), f"exit {rc}, expected {arg}"
        elif kind == "exit-any":
            # Most read commands legitimately end in EITHER success OR a documented refusal.
            # Charter 03 proved the cost of ignoring that: 6 of its 9 "failures" were
            # `missing_contract` (exit 3) against an oracle that only allowed 0 - each of which
            # would have escalated an Opus cause-trace to explain correct behaviour.
            allowed = [int(x) for x in str(arg).split(",")]
            ok = rc in allowed
            detail = f"exit {rc}, allowed {allowed}"
        elif kind == "out":
            ok = stdout_text is not None and arg in stdout_text
            detail = f"stdout {'contains' if ok else 'does NOT contain'} {arg!r}"
        elif kind == "refute-out":
            ok = stdout_text is not None and arg not in stdout_text
            detail = f"stdout {'correctly lacks' if ok else 'unexpectedly contains'} {arg!r}"
        elif kind == "out-re":
            ok = stdout_text is not None and re.search(arg, stdout_text) is not None
            detail = f"stdout {'matches' if ok else 'does NOT match'} /{arg}/"
        elif kind == "empty":
            ok = not (stdout_text or "").strip(); detail = "stdout empty" if ok else "stdout not empty"
        elif kind == "json-valid":
            ok = doc is not None; detail = "stdout is valid JSON" if ok else f"stdout is not JSON: {parse_err}"
        elif kind in ("json", "json-exists", "json-len"):
            if doc is None:
                ok, detail = False, f"stdout is not JSON: {parse_err}"
            elif kind == "json-exists":
                found, _ = jpath(doc, arg); ok, detail = found, f"path {arg} {'exists' if found else 'MISSING'}"
            elif kind == "json-len":
                path, n = arg.rsplit("=", 1); found, v = jpath(doc, path)
                ok = found and hasattr(v, "__len__") and len(v) == int(n)
                detail = f"len({path}) = {len(v) if found and hasattr(v,'__len__') else 'n/a'}, expected {n}"
            else:
                path, want = arg.split("=", 1); found, v = jpath(doc, path)
                try: want_v = json.loads(want)
                except Exception: want_v = want
                ok = found and v == want_v
                detail = f"{path} = {json.dumps(v) if found else 'MISSING'}, expected {json.dumps(want_v)}"
        else:
            ok, detail = False, f"unknown assertion {kind}"
        checks.append({"kind": kind, "arg": arg, "ok": bool(ok), "detail": redact(detail)})

    if timed_out: return ("FAIL", checks + [{"kind":"timeout","arg":None,"ok":False,"detail":"probe timed out"}])
    if not checks: return ("UNJUDGED", checks)
    return ("PASS" if all(c["ok"] for c in checks) else "FAIL", checks)

# ---------------------------------------------------------------- statistics
def summarize(samples):
    """Honest summary of a timing sample, including whether it is trustworthy."""
    s = sorted(samples); n = len(s)
    if n == 0: return {}
    med = statistics.median(s)
    mad = statistics.median([abs(x - med) for x in s]) if n > 1 else 0.0
    out = {
        "n": n, "min": s[0], "max": s[-1], "median": med,
        "mean": statistics.fmean(s),
        "p95": s[min(n - 1, int(round(0.95 * (n - 1))))],
        "stdev": statistics.stdev(s) if n > 1 else 0.0,
        "mad": mad,
        "cv": (statistics.stdev(s) / statistics.fmean(s)) if n > 1 and statistics.fmean(s) else 0.0,
    }
    # Outliers by modified z-score (median-based, robust to the very skew we are looking for).
    if mad > 0:
        out["outliers"] = [x for x in samples if abs(0.6745 * (x - med) / mad) > 3.5]
    else:
        out["outliers"] = []
    return out

def drift_signal(samples):
    """Monotonic slowdown across trial order is thermal throttling, not the code being slow.
    Spearman rank correlation between trial index and duration."""
    n = len(samples)
    if n < 8:
        return {"rho": None, "n": n,
                "verdict": f"n={n}: too few trials to separate drift from noise; run >=8 to judge"}
    ranks = {v: i for i, v in enumerate(sorted(range(n), key=lambda i: samples[i]))}
    d2 = sum((i - ranks[i]) ** 2 for i in range(n))
    rho = 1 - (6 * d2) / (n * (n * n - 1))
    # Critical |rho| for p<0.05, two-tailed, by n. Below this, monotonicity is indistinguishable
    # from noise and calling it drift would be the harness inventing a finding.
    crit = {8:0.738, 9:0.700, 10:0.648, 11:0.618, 12:0.587, 13:0.560, 14:0.538, 15:0.521,
            16:0.503, 18:0.472, 20:0.447, 25:0.398, 30:0.362}
    c = crit.get(n) or (crit[min(crit, key=lambda k: abs(k - n))] if n < 30 else 1.96 / (n - 1) ** 0.5)
    if rho >= c and rho > 0.7:  v = "STRONG upward drift - the machine is throttling; these timings are not usable"
    elif rho >= c:              v = "significant upward drift - re-run cold before trusting these timings"
    elif rho <= -c:             v = "significant downward drift - warmup is bleeding into the measured trials"
    else:                       v = "no drift distinguishable from noise"
    return {"rho": round(rho, 3), "n": n, "critical_rho": round(c, 3), "verdict": v}


# ---------------------------------------------------------------- probe ids
def canonical_probe_id(pid):
    """`P-17-02-init` -> `P-17-02`. The id a charter NAMES, from the id an agent RAN.

    Wave 2 produced 281 probes and matched almost none of its charters' named ids, because every
    agent invented a variant suffix. Coverage checking then could not tell a skipped probe from a
    renamed one - charter 20 ran 35 probes and matched zero of its eight. Variants are legitimate
    and useful; they just have to collapse to something the charter can be checked against."""
    import re as _re
    m = _re.match(r"^(P-\d{2}-[0-9a-z]+)", pid or "")
    return m.group(1) if m else pid
