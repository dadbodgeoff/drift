#!/usr/bin/env python3
"""What the benchmark can and cannot detect: the arithmetic behind PREREG-DRAFT.md §5.

    python3 -I eval/benchmark/power.py [--seed bench-power-v1] [--sims 2000] [--quick]

Pure simulation with a fixed seed, so the numbers in the pre-registration can be
reproduced exactly. It runs no agent and reads no data. Every assumption is a
named argument below and is printed with the result.

Three questions:
  A. The smallest standardized paired effect (mean task difference / SD of task
     differences) the primary test detects with 80% power, for 20, 25 and 30 tasks.
  B. The same in plain units, under a count model of convention violations:
     the smallest relative reduction in violations per run the primary test
     detects, depending on how many violations the no-Drift arm makes.
  C. The chance of showing task success is not lower (non-inferiority) when
     the arms are truly equal, for a few margins.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchlib as bl  # noqa: E402


def exact_wilcoxon_critical(n, alpha):
    """Smallest deviation c of W+ from n(n+1)/4 (doubled units) whose two-sided
    exact tail probability is <= alpha, for untied ranks 1..n."""
    dist = {0: 1}
    for r in range(1, n + 1):
        nxt = dict(dist)
        for s, c in dist.items():
            nxt[s + r] = nxt.get(s + r, 0) + c
        dist = nxt
    total = n * (n + 1) // 2
    allc = 2 ** n
    devs = sorted({abs(2 * s - total) for s in dist}, reverse=True)
    best = None
    for d in devs:
        tail = sum(c for s, c in dist.items() if abs(2 * s - total) >= d)
        if tail / allc <= alpha:
            best = d
        else:
            break
    return best, total


def wplus_untied(diffs):
    order = sorted(range(len(diffs)), key=lambda i: abs(diffs[i]))
    return sum(rank + 1 for rank, i in enumerate(order) if diffs[i] > 0)


def power_standardized(n, dz, sims, seed, alpha):
    crit, total = exact_wilcoxon_critical(n, alpha)
    tcrit = bl.t_ppf(1 - alpha / 2, n - 1)
    r = bl.rng(seed, "A", n)
    hit_w = hit_t = 0
    for _ in range(sims):
        z = [r.gauss(0, 1) for _ in range(n)]
        d = [x + dz for x in z]
        if abs(2 * wplus_untied(d) - total) >= crit:
            hit_w += 1
        m, s = bl.mean(d), bl.sd(d)
        if s > 0 and abs(m / (s / math.sqrt(n))) >= tcrit:
            hit_t += 1
    return hit_w / sims, hit_t / sims


def detectable_dz(n, sims, seed, alpha, target=0.8):
    lo, hi = 0.05, 2.0
    for _ in range(14):
        mid = (lo + hi) / 2
        pw, _ = power_standardized(n, mid, sims, seed, alpha)
        if pw >= target:
            hi = mid
        else:
            lo = mid
    return hi


def poisson(r, lam):
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(r.gauss(lam, math.sqrt(lam)))))
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= r.random()
        if p <= l:
            return k
        k += 1


def power_counts(n, base_mean, reduction, runs, sims, seed, alpha, shape):
    """Per task a base violation rate drawn from a gamma with the given mean and
    shape (shape 1 = exponential: tasks differ a lot). The treated arm's rate is
    base * (1 - reduction). Each arm gets `runs` Poisson runs; the task value is
    the mean over runs; the test is the Wilcoxon signed-rank (normal
    approximation with ties, which is what ties force at this n)."""
    r = bl.rng(seed, "B", n, base_mean, reduction, runs, shape)
    hit = 0
    for _ in range(sims):
        diffs = []
        for _ in range(n):
            lam = r.gammavariate(shape, base_mean / shape)
            a = sum(poisson(r, lam) for _ in range(runs)) / runs
            b = sum(poisson(r, lam * (1 - reduction)) for _ in range(runs)) / runs
            diffs.append(b - a)
        res = bl.wilcoxon_signed_rank(diffs, exact=False)
        if res["p"] <= alpha and bl.mean(diffs) < 0:
            hit += 1
    return hit / sims


def power_noninferiority(n, margin, true_drop, runs, sims, seed, alpha):
    """Task success: per task a base success chance uniform on [0.2, 0.9]; the
    treated arm's chance is lower by true_drop. Non-inferiority is shown when the
    one-sided (1 - alpha) lower bound of the mean task difference (treated minus
    control, in success share) is above -margin."""
    r = bl.rng(seed, "C", n, margin, true_drop, runs)
    hit = 0
    for _ in range(sims):
        diffs = []
        for _ in range(n):
            p = r.uniform(0.2, 0.9)
            q = min(1.0, max(0.0, p - true_drop))
            a = sum(1 for _ in range(runs) if r.random() < p) / runs
            b = sum(1 for _ in range(runs) if r.random() < q) / runs
            diffs.append(b - a)
        if bl.paired_t_lower_bound(diffs, alpha) > -margin:
            hit += 1
    return hit / sims


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", default="bench-power-v1")
    ap.add_argument("--sims", type=int, default=2000)
    ap.add_argument("--alpha", type=float, default=0.05)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--quick", action="store_true", help="fewer simulations (for tests)")
    args = ap.parse_args()
    sims = 200 if args.quick else args.sims

    print("# Power of the pre-registered analysis (simulation, seed %r, %d sims per point)" % (args.seed, sims))
    print("# Monte Carlo error of a power near 0.8: about +/- %.3f" % math.sqrt(0.16 / sims))
    print()
    print("## A. Smallest standardized paired effect detected with 80% power")
    print("Primary test: two-sided exact Wilcoxon signed-rank on task-level differences.")
    print("dz = mean of task differences / SD of task differences (normal differences).")
    for alpha_name, alpha in (("alpha 0.05", args.alpha), ("alpha 0.0167 (Holm, 3 tests, worst case)", args.alpha / 3)):
        print("- %s:" % alpha_name)
        for n in (20, 25, 30):
            dz = detectable_dz(n, sims, args.seed, alpha)
            pw_w, pw_t = power_standardized(n, dz, sims, args.seed, alpha)
            print("  n=%d tasks: dz = %.2f (Wilcoxon power %.2f, paired t at same dz %.2f)" % (n, dz, pw_w, pw_t))
    print()
    print("## B. Smallest relative reduction in violations per run detected with 80% power")
    print("Count model: per task a base rate (gamma, shape 1, given mean), Poisson runs,")
    print("%d runs per arm averaged per task, alpha %.2f two-sided, effect in the right direction." % (args.runs, args.alpha))
    grid = [i / 10 for i in range(1, 11)]
    for n in (20, 25, 30):
        for base in (0.25, 0.5, 1.0, 2.0, 4.0):
            found = None
            last = None
            for red in grid:
                pw = power_counts(n, base, red, args.runs, sims // 2 or 1, args.seed, args.alpha, 1.0)
                last = (red, pw)
                if pw >= 0.8:
                    found = (red, pw)
                    break
            if found:
                print("  n=%d, no-Drift mean %.2f violations/run: reduction >= %d%% (power %.2f)" % (n, base, round(found[0] * 100), found[1]))
            else:
                print("  n=%d, no-Drift mean %.2f violations/run: not detectable even at 100%% reduction (power %.2f)" % (n, base, last[1]))
    print()
    print("## C. Non-inferiority of task success (arms truly equal)")
    print("Per task base success uniform on [0.2, 0.9]; %d runs per arm; one-sided 95%% t lower bound." % args.runs)
    for n in (20, 25, 30):
        cells = []
        for margin in (0.10, 0.15, 0.20):
            pw = power_noninferiority(n, margin, 0.0, args.runs, sims, args.seed, args.alpha)
            cells.append("margin %d points: %.2f" % (round(margin * 100), pw))
        print("  n=%d: chance to show non-inferiority: %s" % (n, "; ".join(cells)))
    for n in (25,):
        for drop in (0.05, 0.10):
            pw = power_noninferiority(n, 0.15, drop, args.runs, sims, args.seed, args.alpha)
            print("  n=%d, true drop %d points, margin 15: chance to (wrongly) show non-inferiority %.2f" % (n, round(drop * 100), pw))


if __name__ == "__main__":
    main()
