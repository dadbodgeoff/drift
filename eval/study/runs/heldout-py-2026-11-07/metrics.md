# Precision: eval/study/runs/heldout-py-2026-11-07

- drift: drift 0.1.0-dev commit ab1a8f348039310fcf908f65b99cb6d90cc1f5e3, binary sha256 e199f1cfd067
- manifest: eval/holdout-primary-py.json (HELD-OUT), 10 repos ok
- labels: eval/study/runs/heldout-py-2026-11-07/final.jsonl (44 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 44
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 44 | 44 | 23 | 2 | 19 | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | 2.3 mean, 2 median, 2/10 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 10/10 repos with none |
| Suggestion tier (everything else) | 44 | 44 | 23 | 2 | 19 | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | 2.3 mean, 2 median, 2/10 repos with none |

## Exposure check: all repos vs excluding exposed (0 of 10 repos exposed)

Exposed: none. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.

|  | Repos | Shown | Not-wrong | Accept | Default-tier accept | (labelled: not-wrong / accept) | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All repos | 10 | 44 | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | – | 56.8% / 52.3% | 2.3 |
| Excluding exposed | 10 | 44 | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | – | 56.8% / 52.3% | 2.3 |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 1 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 1 | 4 | 4 | 3 | 0 | 1 | 75.0% [30.1%–95.4%] (1 repo: no cluster interval) | 75.0% [30.1%–95.4%] (1 repo: no cluster interval) |
| typescript/javascript | All shown (both tiers) | 1 | 4 | 4 | 3 | 0 | 1 | 75.0% [30.1%–95.4%] (1 repo: no cluster interval) | **75.0% [30.1%–95.4%] (1 repo: no cluster interval)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not this set's language)** |
| python | Default tier | 10 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 10 | 40 | 40 | 20 | 2 | 18 | 50.0% [35.2%–64.8%] (9 repos: bootstrap 37.2%–63.6%, cluster-t 33.8%–66.2%) | 55.0% [39.8%–69.3%] (9 repos: bootstrap 44.7%–65.8%, cluster-t 42.1%–67.9%) |
| python | All shown (both tiers) | 10 | 40 | 40 | 20 | 2 | 18 | 50.0% [35.2%–64.8%] (9 repos: bootstrap 37.2%–63.6%, cluster-t 33.8%–66.2%) | **55.0% [39.8%–69.3%] (9 repos: bootstrap 44.7%–65.8%, cluster-t 42.1%–67.9%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **NOT MET** |
| all languages (pooled, secondary) | Default tier | 10 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 10 | 44 | 44 | 23 | 2 | 19 | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) |
| all languages (pooled, secondary) | All shown (both tiers) | 10 | 44 | 44 | 23 | 2 | 19 | 52.3% [37.9%–66.2%] (9 repos: bootstrap 37.8%–65.5%, cluster-t 35.0%–69.5%) | 56.8% [42.2%–70.3%] (9 repos: bootstrap 45.5%–67.3%, cluster-t 43.1%–70.6%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call order | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Control and typing | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| python | Decorators | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Base classes | Suggestion tier | 8 | 1 | 0 | 7 | 12.5% [2.2%–47.1%] (6 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–46.6%) | 12.5% [2.2%–47.1%] (6 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–46.6%) |
| python | Argument keys | Suggestion tier | 4 | 2 | 2 | 0 | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 100.0% [51.0%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 3 | 0 | 0 | 3 | 0.0% [0.0%–56.1%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–56.1%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Naming | Suggestion tier | 7 | 5 | 0 | 2 | 71.4% [35.9%–91.8%] (2 repos: bootstrap 60.0%–100.0%, cluster-t 0.0%–100.0%) | 71.4% [35.9%–91.8%] (2 repos: bootstrap 60.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Control and typing | Suggestion tier | 7 | 7 | 0 | 0 | 100.0% [64.6%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [64.6%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 5 | 2 | 0 | 3 | 40.0% [11.8%–76.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 40.0% [11.8%–76.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | fastapi | 1 | 4 | 0 | – | 4 | 75.0% [30.1%–95.4%] (1 repo: no cluster interval) | 75.0% [30.1%–95.4%] (1 repo: no cluster interval) |
| python | fastapi | 4 | 17 | 0 | – | 17 | 58.8% [36.0%–78.4%] (4 repos: bootstrap 31.6%–80.0%, cluster-t 9.8%–100.0%) | 64.7% [41.3%–82.7%] (4 repos: bootstrap 47.4%–80.0%, cluster-t 33.8%–95.6%) |
| python | django | 2 | 6 | 0 | – | 6 | 33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%) | 33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%) |
| python | flask | 2 | 14 | 0 | – | 14 | 42.9% [21.4%–67.4%] (2 repos: bootstrap 42.9%–42.9%, cluster-t 42.9%–42.9%) | 50.0% [26.8%–73.2%] (2 repos: bootstrap 42.9%–57.1%, cluster-t 0.0%–100.0%) |
| python | other_python | 2 | 3 | 0 | – | 3 | 66.7% [20.8%–93.9%] (1 repo: no cluster interval) | 66.7% [20.8%–93.9%] (1 repo: no cluster interval) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| codex-autorunner | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| dbt-charts | 5 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 2 | 0 | – |
| aws-parallelcluster | 7 | 3 | 0 | 4 | 43% [16%–75%] | 43% [16%–75%] | 3 | 0 | – |
| taos | 8 | 6 | 0 | 2 | 75% [41%–93%] | 75% [41%–93%] | 6 | 0 | – |
| veritasgraph | 5 | 1 | 1 | 3 | 40% [12%–77%] | 20% [4%–62%] | 1 | 0 | – |
| ods | 7 | 5 | 0 | 2 | 71% [36%–92%] | 71% [36%–92%] | 5 | 0 | – |
| platypush | 7 | 3 | 1 | 3 | 57% [25%–84%] | 43% [16%–75%] | 3 | 0 | – |
| trimesh | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| freesound | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| cosmos-transfer1 | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Decorators | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Base classes | 8 | 1 | 0 | 7 | 13% [2%–47%] | 13% [2%–47%] | 0 | – |
| Argument keys | 4 | 2 | 2 | 0 | 50% [15%–85%] | 100% [51%–100%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Naming | 7 | 5 | 0 | 2 | 71% [36%–92%] | 71% [36%–92%] | 0 | – |
| Other avoidance (any, console, bare Error) | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Call order | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 9 | 9 | 0 | 0 | 100% [70%–100%] | 100% [70%–100%] | 0 | – |
| Package and repo facts | 6 | 3 | 0 | 3 | 50% [19%–81%] | 50% [19%–81%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 2
- WRONG because: mixed_group 14, false_outliers 1, incidental 2, legit_outliers 2
