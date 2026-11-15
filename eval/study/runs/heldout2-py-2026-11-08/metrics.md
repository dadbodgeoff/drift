# Precision: eval/study/runs/heldout2-py-2026-11-08

- drift: drift 0.1.0-dev commit 4e017e38ccc507d282ca31f49029ca48f035ddc1, binary sha256 41edaa85c656
- manifest: eval/holdout-2-2026-11-07-py.json (HELD-OUT), 10 repos ok
- labels: eval/study/runs/heldout2-py-2026-11-08/final.jsonl (43 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 43
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log
- 1 shown proposals have no structured rule and are suggestion tier: future-agi/D-a0e724

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 43 | 43 | 16 | 5 | 22 | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | 1.6 mean, 1 median, 2/10 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 10/10 repos with none |
| Suggestion tier (everything else) | 43 | 43 | 16 | 5 | 22 | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | 1.6 mean, 1 median, 2/10 repos with none |

## Exposure check: all repos vs excluding exposed (0 of 10 repos exposed)

Exposed: none. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.

|  | Repos | Shown | Not-wrong | Accept | Default-tier accept | (labelled: not-wrong / accept) | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All repos | 10 | 43 | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | – | 48.8% / 37.2% | 1.6 |
| Excluding exposed | 10 | 43 | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | – | 48.8% / 37.2% | 1.6 |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 3 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 3 | 8 | 8 | 0 | 1 | 7 | 0.0% [0.0%–32.4%] (3 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 12.5% [2.2%–47.1%] (3 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–63.3%) |
| typescript/javascript | All shown (both tiers) | 3 | 8 | 8 | 0 | 1 | 7 | 0.0% [0.0%–32.4%] (3 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | **12.5% [2.2%–47.1%] (3 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–63.3%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not this set's language)** |
| python | Default tier | 10 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 10 | 35 | 35 | 16 | 4 | 15 | 45.7% [30.5%–61.8%] (9 repos: bootstrap 23.7%–68.4%, cluster-t 17.9%–73.5%) | 57.1% [40.9%–72.0%] (9 repos: bootstrap 31.6%–80.4%, cluster-t 25.3%–89.0%) |
| python | All shown (both tiers) | 10 | 35 | 35 | 16 | 4 | 15 | 45.7% [30.5%–61.8%] (9 repos: bootstrap 23.7%–68.4%, cluster-t 17.9%–73.5%) | **57.1% [40.9%–72.0%] (9 repos: bootstrap 31.6%–80.4%, cluster-t 25.3%–89.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **NOT MET** |
| all languages (pooled, secondary) | Default tier | 10 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 10 | 43 | 43 | 16 | 5 | 22 | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) |
| all languages (pooled, secondary) | All shown (both tiers) | 10 | 43 | 43 | 16 | 5 | 22 | 37.2% [24.4%–52.1%] (9 repos: bootstrap 18.8%–56.9%, cluster-t 14.1%–60.3%) | 48.8% [34.6%–63.2%] (9 repos: bootstrap 24.4%–71.1%, cluster-t 18.1%–79.5%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Argument keys | Suggestion tier | 1 | 0 | 1 | 0 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Rendered components | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Call order | Suggestion tier | 3 | 0 | 0 | 3 | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 5 | 3 | 0 | 2 | 60.0% [23.1%–88.2%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 60.0% [23.1%–88.2%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Decorators | Suggestion tier | 4 | 2 | 0 | 2 | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Base classes | Suggestion tier | 8 | 2 | 2 | 4 | 25.0% [7.1%–59.1%] (5 repos: bootstrap 0.0%–54.5%, cluster-t 0.0%–79.9%) | 50.0% [21.5%–78.5%] (5 repos: bootstrap 0.0%–83.3%, cluster-t 0.0%–100.0%) |
| python | Argument keys | Suggestion tier | 2 | 1 | 1 | 0 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 5 | 0 | 1 | 4 | 0.0% [0.0%–43.4%] (4 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 20.0% [3.6%–62.4%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–88.9%) |
| python | Naming | Suggestion tier | 6 | 5 | 0 | 1 | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) |
| python | Control and typing | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | fastapi | 2 | 5 | 0 | – | 5 | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | django | 1 | 3 | 0 | – | 3 | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) | 33.3% [6.1%–79.2%] (1 repo: no cluster interval) |
| python | django | 5 | 18 | 0 | – | 18 | 72.2% [49.1%–87.5%] (5 repos: bootstrap 53.8%–100.0%, cluster-t 46.3%–98.1%) | 83.3% [60.8%–94.2%] (5 repos: bootstrap 53.8%–100.0%, cluster-t 53.5%–100.0%) |
| python | fastapi | 3 | 12 | 0 | – | 12 | 16.7% [4.7%–44.8%] (3 repos: bootstrap 0.0%–20.0%, cluster-t 6.3%–27.0%) | 33.3% [13.8%–60.9%] (3 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–88.1%) |
| python | flask | 1 | 0 | 0 | – | 0 | – | – |
| python | other_python | 1 | 5 | 0 | – | 5 | 20.0% [3.6%–62.4%] (1 repo: no cluster interval) | 20.0% [3.6%–62.4%] (1 repo: no cluster interval) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| statsmodels | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| flagsmith | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 0 | – |
| kunlun-m | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| django-oscar | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| dcs_liberation | 6 | 1 | 2 | 3 | 50% [19%–81%] | 17% [3%–56%] | 1 | 0 | – |
| supoclip | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 0 | – |
| vmlx | 8 | 1 | 0 | 7 | 13% [2%–47%] | 13% [2%–47%] | 1 | 0 | – |
| nlweb | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fenic | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 1 | 0 | – |
| future-agi | 13 | 7 | 3 | 3 | 77% [50%–92%] | 54% [29%–77%] | 7 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 6 | 3 | 0 | 3 | 50% [19%–81%] | 50% [19%–81%] | 0 | – |
| Decorators | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 0 | – |
| Base classes | 8 | 2 | 2 | 4 | 25% [7%–59%] | 50% [22%–78%] | 0 | – |
| Argument keys | 3 | 1 | 2 | 0 | 33% [6%–79%] | 100% [44%–100%] | 0 | – |
| Layering (imports avoided) | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Rendered components | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Calls | 5 | 0 | 1 | 4 | 0% [0%–43%] | 20% [4%–62%] | 0 | – |
| Naming | 6 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Call order | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Control and typing | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Package and repo facts | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 4, types 1
- WRONG because: mixed_group 7, incidental 8, legit_outliers 2, false_outliers 5
