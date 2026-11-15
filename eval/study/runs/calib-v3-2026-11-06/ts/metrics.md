# Precision: eval/study/runs/calib-v3-2026-11-06/ts

- drift: drift 0.1.0-dev commit ce38aeaae86e56d2a4dfc43c121b255632df184f, binary sha256 151b79ddfc1a
- manifest: eval/repos.json, 11 repos ok
- labels: eval/study/runs/calib-v3-2026-11-06/ts/final.jsonl (37 records)
- kind: **calibration** (a relabel that measures a rubric change, not a precision result): shift eval/study/runs/calib-v3-2026-11-06/shift.json, agreement eval/study/runs/calib-v3-2026-11-06/ts/agreement.json
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, passes_key, avoids:import, renders, wrapped_by:jsx} and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 37
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 37 | 37 | 11 | 0 | 26 | 29.7% [17.5%–45.8%] (11 repos: bootstrap 10.5%–52.6%, cluster-t 4.0%–55.4%) | 29.7% [17.5%–45.8%] (11 repos: bootstrap 10.5%–52.6%, cluster-t 4.0%–55.4%) | 1.0 mean, 0 median, 6/11 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 23 | 23 | 8 | 0 | 15 | 34.8% [18.8%–55.1%] (10 repos: bootstrap 9.1%–61.9%, cluster-t 1.4%–68.1%) | 34.8% [18.8%–55.1%] (10 repos: bootstrap 9.1%–61.9%, cluster-t 1.4%–68.1%) | 0.7 mean, 0 median, 7/11 repos with none |
| Suggestion tier (everything else) | 14 | 14 | 3 | 0 | 11 | 21.4% [7.6%–47.6%] (8 repos: bootstrap 5.3%–41.7%, cluster-t 0.0%–44.0%) | 21.4% [7.6%–47.6%] (8 repos: bootstrap 5.3%–41.7%, cluster-t 0.0%–44.0%) | 0.3 mean, 0 median, 8/11 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 11 | 23 | 23 | 8 | 0 | 15 | **34.8% [18.8%–55.1%] (10 repos: bootstrap 9.1%–61.9%, cluster-t 1.4%–68.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 34.8% [18.8%–55.1%] (10 repos: bootstrap 9.1%–61.9%, cluster-t 1.4%–68.1%) |
| typescript/javascript | Suggestion tier | 11 | 14 | 14 | 3 | 0 | 11 | 21.4% [7.6%–47.6%] (8 repos: bootstrap 5.3%–41.7%, cluster-t 0.0%–44.0%) | 21.4% [7.6%–47.6%] (8 repos: bootstrap 5.3%–41.7%, cluster-t 0.0%–44.0%) |
| typescript/javascript | All shown (both tiers) | 11 | 37 | 37 | 11 | 0 | 26 | 29.7% [17.5%–45.8%] (11 repos: bootstrap 10.5%–52.6%, cluster-t 4.0%–55.4%) | **29.7% [17.5%–45.8%] (11 repos: bootstrap 10.5%–52.6%, cluster-t 4.0%–55.4%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 8 | 0 | 0 | 8 | 0% [0%–32%] | 0% [0%–32%] | 0 | 5 | 0% [0%–43%] |
| twenty | 5 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 2 | 4 | 50% [15%–85%] |
| cal.com | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 2 | 100% [34%–100%] |
| documenso | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 3 | 100% [44%–100%] |
| ai | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | 1 | 0% [0%–79%] |
| nest | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 1 | 0% [0%–79%] |
| supabase | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 1 | 0% [0%–79%] |
| novu | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| immich | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 2 | 0% [0%–66%] |
| midday | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 2 | 50% [9%–91%] |
| infisical | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | 2 | 0% [0%–66%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Decorators | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 4 | 50% [15%–85%] |
| Argument keys | 6 | 1 | 0 | 5 | 17% [3%–56%] | 17% [3%–56%] | 6 | 17% [3%–56%] |
| Layering (imports avoided) | 5 | 4 | 0 | 1 | 80% [38%–96%] | 80% [38%–96%] | 5 | 80% [38%–96%] |
| Rendered components | 6 | 0 | 0 | 6 | 0% [0%–39%] | 0% [0%–39%] | 6 | 0% [0%–39%] |
| Calls | 4 | 0 | 0 | 4 | 0% [0%–49%] | 0% [0%–49%] | 0 | – |
| Naming | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 7, incidental 4, mixed_group 12, false_outliers 3
