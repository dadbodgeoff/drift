"""Statistics for detection metrics. Every number a benchmark reports should come from here.

The failure this module exists to prevent: reporting `precision = 1.00` from 50 fixtures as if it
were a fact, then treating a later 0.98 as a regression when the two are statistically identical.
"""
import math

def _phi_inv(p):
    """Inverse standard normal CDF (Acklam), good to ~1e-9 — enough for any n we will ever run."""
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    pl, pu = 0.02425, 1 - 0.02425
    if p < pl:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > pu:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q, r = p - 0.5, (p - 0.5) ** 2
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)

def wilson(k, n, conf=0.95):
    """Wilson score interval. Correct at p=0 and p=1, where the naive interval collapses to a point
    and invites exactly the overclaim this guards against."""
    if n == 0: return {"p": None, "lo": None, "hi": None, "n": 0}
    z = _phi_inv(1 - (1 - conf) / 2)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = (z / den) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return {"p": p, "lo": max(0.0, c - h), "hi": min(1.0, c + h), "n": n, "k": k, "conf": conf}

def mde(p0, n, alpha=0.05, power=0.80, direction="down"):
    """Minimum detectable effect: the smallest true rate that this n could distinguish from p0.

    Answers "our baseline says precision 0.96 over 50 fixtures - how far would it have to fall
    before this suite could tell?" If the answer is 0.83, then a 0.92 reading is not a regression,
    it is noise, and ratcheting on it will produce false alarms forever."""
    if n <= 0: return None
    za, zb = _phi_inv(1 - alpha / 2), _phi_inv(power)
    lo, hi = (0.0, p0) if direction == "down" else (p0, 1.0)
    for _ in range(200):
        p1 = (lo + hi) / 2
        need = ((za * math.sqrt(p0 * (1 - p0)) + zb * math.sqrt(p1 * (1 - p1))) ** 2) / max((p1 - p0) ** 2, 1e-12)
        if need > n:
            if direction == "down": hi = p1
            else: lo = p1
        else:
            if direction == "down": lo = p1
            else: hi = p1
    return (lo + hi) / 2

def n_for(p0, delta, alpha=0.05, power=0.80):
    """How many fixtures would be needed to detect a change of `delta` from p0."""
    za, zb = _phi_inv(1 - alpha / 2), _phi_inv(power)
    p1 = max(0.0, min(1.0, p0 - delta))
    return math.ceil(((za * math.sqrt(p0 * (1 - p0)) + zb * math.sqrt(p1 * (1 - p1))) ** 2) / max(delta ** 2, 1e-12))

def mcnemar(b, c):
    """Paired comparison of two detectors over the SAME fixtures - which is what a baseline
    comparison always is. b = caught before, missed now. c = missed before, caught now.

    Using an unpaired two-proportion test here (the common mistake) throws away the pairing and
    badly understates significance."""
    n = b + c
    if n == 0: return {"b": 0, "c": 0, "p_value": 1.0, "method": "no discordant pairs", "significant": False}
    if n < 25:
        # Exact two-sided binomial - the chi-square approximation is unreliable at this size.
        p = 2 * sum(math.comb(n, i) for i in range(0, min(b, c) + 1)) / (2 ** n)
        p = min(1.0, p); method = "exact binomial"
    else:
        chi2 = (abs(b - c) - 1) ** 2 / n
        p = math.erfc(math.sqrt(chi2 / 2)); method = "chi-square, continuity corrected"
    return {"b": b, "c": c, "p_value": p, "method": method, "significant": p < 0.05,
            "direction": "improved" if c > b else ("regressed" if b > c else "unchanged")}

def f1(precision, recall):
    if precision is None or recall is None or (precision + recall) == 0: return 0.0
    return 2 * precision * recall / (precision + recall)

def cohen_kappa(a, b):
    """Inter-rater agreement for ground-truth labels. Raw agreement flatters itself when one class
    dominates; kappa is what makes a labeled corpus defensible."""
    n = len(a)
    if n == 0 or len(b) != n: return None
    labels = sorted(set(a) | set(b))
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pe = sum((a.count(l) / n) * (b.count(l) / n) for l in labels)
    return (po - pe) / (1 - pe) if pe != 1 else 1.0
