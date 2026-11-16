"""Shared helpers for the agent benchmark: seeded randomness, the pre-registered
tests and the agreement statistics. Python 3 standard library only.

Everything here is deterministic given its inputs and seed.
"""

import hashlib
import json
import math
import random
from fractions import Fraction


# ---------------------------------------------------------------- randomness

def rng(seed, *labels):
    """A random.Random seeded from a seed string plus labels.

    The same (seed, labels) always gives the same stream, on every platform,
    because the state comes from sha256 of the text, not from Python's hash().
    """
    text = "\x1f".join([str(seed)] + [str(x) for x in labels])
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return random.Random(int(digest, 16))


def stable_key(seed, *labels):
    """A sortable hex key: used to order items in a seeded random way."""
    text = "\x1f".join([str(seed)] + [str(x) for x in labels])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def dump_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------- schema check

_TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "integer": int, "number": (int, float), "null": type(None),
}


def validate(value, schema, path="$"):
    """Check value against the JSON Schema subset tasks/schema.json uses
    (type, const, enum, required, properties, additionalProperties false,
    items, pattern, minLength, minimum). Returns a list of error strings."""
    import re as _re
    errs = []
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        ok = False
        for name in types:
            py = _TYPES[name]
            if isinstance(value, bool) and name in ("integer", "number"):
                continue
            if isinstance(value, py):
                ok = True
        if not ok:
            return ["%s: expected %s" % (path, "/".join(types))]
    if "const" in schema and value != schema["const"]:
        errs.append("%s: expected %r" % (path, schema["const"]))
    if "enum" in schema and value not in schema["enum"]:
        errs.append("%s: not one of %r" % (path, schema["enum"]))
    if isinstance(value, str):
        if "pattern" in schema and not _re.search(schema["pattern"], value):
            errs.append("%s: does not match %s" % (path, schema["pattern"]))
        if len(value) < schema.get("minLength", 0):
            errs.append("%s: too short" % path)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and "minimum" in schema:
        if value < schema["minimum"]:
            errs.append("%s: below %s" % (path, schema["minimum"]))
    if isinstance(value, dict):
        for k in schema.get("required", []):
            if k not in value:
                errs.append("%s: missing %s" % (path, k))
        props = schema.get("properties", {})
        for k, v in value.items():
            if k in props:
                errs += validate(v, props[k], path + "." + k)
            elif schema.get("additionalProperties") is False:
                errs.append("%s: unexpected %s" % (path, k))
    if isinstance(value, list) and "items" in schema:
        for i, v in enumerate(value):
            errs += validate(v, schema["items"], "%s[%d]" % (path, i))
    return errs


# ---------------------------------------------------------------- basic stats

def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float("nan")


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        return float("nan")
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def sd(xs):
    xs = list(xs)
    if len(xs) < 2:
        return float("nan")
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def norm_cdf(z):
    return 0.5 * math.erfc(-z / math.sqrt(2))


def norm_ppf(p):
    """Inverse normal CDF by bisection (accurate to about 1e-10; slow is fine)."""
    lo, hi = -40.0, 40.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if norm_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def t_cdf(t, df):
    """Student t CDF via the regularized incomplete beta function."""
    x = df / (df + t * t)
    ib = _betainc(df / 2.0, 0.5, x)
    return 1 - 0.5 * ib if t >= 0 else 0.5 * ib


def t_ppf(p, df):
    lo, hi = -100.0, 100.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _betainc(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(lbeta + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def _betacf(a, b, x):
    tiny = 1e-300
    c, d = 1.0, 1 - (a + b) * x / (a + 1)
    d = 1 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-14:
            break
    return h


# ---------------------------------------------------------------- tests

def _midranks(values):
    """Ranks of abs values, ties sharing the mean rank. Returns ranks * 2 as ints."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks2 = [0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        # ranks i+1 .. j+1, mean = (i+j+2)/2, doubled = i+j+2
        for k in range(i, j + 1):
            ranks2[order[k]] = i + j + 2
        i = j + 1
    return ranks2


def wilcoxon_signed_rank(diffs, exact=True):
    """Two-sided Wilcoxon signed-rank test on paired differences.

    Zero differences are dropped (Wilcoxon's rule; the count is returned).
    Ties share midranks. With exact=True the p-value comes from the exact
    permutation distribution of the (midrank) statistic, enumerated by dynamic
    programming over sign flips; otherwise the normal approximation with tie
    correction. Returns a dict with W+ (as a float), n used, zeros, p.
    """
    nz = [d for d in diffs if d != 0]
    zeros = len(diffs) - len(nz)
    n = len(nz)
    if n == 0:
        return {"w_plus": 0.0, "n": 0, "zeros": zeros, "p": 1.0, "method": "none"}
    ranks2 = _midranks([abs(d) for d in nz])
    w2 = sum(r for r, d in zip(ranks2, nz) if d > 0)
    total2 = sum(ranks2)
    if exact:
        # dist[s] = number of sign assignments with doubled W+ == s
        dist = {0: 1}
        for r in ranks2:
            nxt = dict(dist)
            for s, c in dist.items():
                nxt[s + r] = nxt.get(s + r, 0) + c
            dist = nxt
        allc = 2 ** n
        # Under the null the doubled statistic is centred on total2 / 2, so a
        # sign assignment is at least as extreme when |2s - total2| >= |2w2 - total2|.
        dev = abs(2 * w2 - total2)
        tail = sum(c for s, c in dist.items() if abs(2 * s - total2) >= dev)
        p = min(1.0, tail / allc)
        method = "exact"
    else:
        ranks = [r / 2 for r in ranks2]
        mu = sum(ranks) / 2
        var = sum(r * r for r in ranks) / 4
        if var == 0:
            p = 1.0
        else:
            z = (w2 / 2 - mu) / math.sqrt(var)
            p = min(1.0, 2 * (1 - norm_cdf(abs(z))))
        method = "normal"
    return {"w_plus": w2 / 2, "n": n, "zeros": zeros, "p": p, "method": method}


def paired_t_lower_bound(diffs, alpha=0.05):
    """One-sided (1 - alpha) lower confidence bound for the mean difference."""
    n = len(diffs)
    if n < 2:
        return float("nan")
    s = sd(diffs)
    return mean(diffs) - t_ppf(1 - alpha, n - 1) * s / math.sqrt(n)


def bootstrap_ci(diffs, seed, reps=10000, level=0.95, label="boot"):
    """Percentile bootstrap interval for the mean of diffs (resampling tasks)."""
    n = len(diffs)
    if n == 0:
        return (float("nan"), float("nan"))
    r = rng(seed, label)
    means = []
    for _ in range(reps):
        means.append(sum(diffs[r.randrange(n)] for _ in range(n)) / n)
    means.sort()
    lo = means[int(math.floor((1 - level) / 2 * reps))]
    hi = means[min(reps - 1, int(math.ceil((1 + level) / 2 * reps)) - 1)]
    return (lo, hi)


def holm(pvalues):
    """Holm step-down adjustment. pvalues: dict name -> p. Returns name -> adjusted p."""
    items = sorted(pvalues.items(), key=lambda kv: (kv[1], kv[0]))
    m = len(items)
    out, running = {}, 0.0
    for i, (name, p) in enumerate(items):
        adj = min(1.0, (m - i) * p)
        running = max(running, adj)
        out[name] = running
    return out


# ---------------------------------------------------------------- agreement

def cohen_kappa(a, b, categories=None, weights=None):
    """Cohen's kappa between two raters' labels (lists of equal length).

    weights=None gives unweighted kappa; weights="quadratic" treats the
    categories as ordered (in the order given) and weights disagreements by the
    squared distance. Returns nan when expected disagreement is zero.
    """
    if len(a) != len(b):
        raise ValueError("raters must label the same items")
    if not a:
        return float("nan")
    cats = list(categories) if categories else sorted(set(a) | set(b), key=str)
    idx = {c: i for i, c in enumerate(cats)}
    k = len(cats)
    n = len(a)
    obs = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b):
        obs[idx[x]][idx[y]] += 1
    ra = [sum(obs[i]) for i in range(k)]
    rb = [sum(obs[i][j] for i in range(k)) for j in range(k)]

    def w(i, j):
        if weights == "quadratic":
            return ((i - j) / (k - 1)) ** 2 if k > 1 else 0.0
        return 0.0 if i == j else 1.0

    do = sum(w(i, j) * obs[i][j] for i in range(k) for j in range(k)) / n
    de = sum(w(i, j) * ra[i] * rb[j] for i in range(k) for j in range(k)) / (n * n)
    if de == 0:
        return float("nan")
    return 1 - do / de


def exact_agreement(a, b):
    return sum(1 for x, y in zip(a, b) if x == y) / len(a) if a else float("nan")


def binom_two_sided_p(k, n, p0):
    """Exact two-sided binomial test (sum of outcomes no likelier than k)."""
    p0 = Fraction(p0).limit_denominator(10 ** 6)
    probs = [math.comb(n, i) * float(p0) ** i * float(1 - p0) ** (n - i) for i in range(n + 1)]
    pk = probs[k]
    return min(1.0, sum(pr for pr in probs if pr <= pk * (1 + 1e-9)))
