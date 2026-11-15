# Precision: eval/study/runs/dev-py-r2-2026-11-05/views/rule5-py

- drift: drift 0.1.0-dev commit 2709f17fbbc2ef21a1612b9f8a94efcba45593a8, binary sha256 41054fadcecf
- manifest: eval/repos-py.json, 8 repos ok
- labels: eval/study/runs/dev-py-r2-2026-11-05/final.jsonl (43 records; 7 not in this run's queue, ignored)
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, passes_key, avoids:import, renders, wrapped_by:jsx} and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: not recorded; label records by rubric: not recorded 36
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 36 | 36 | 22 | 0 | 14 | 61.1% [44.9%–75.2%] (6 repos: bootstrap 54.1%–71.4%, cluster-t 49.0%–73.2%) | 61.1% [44.9%–75.2%] (6 repos: bootstrap 54.1%–71.4%, cluster-t 49.0%–73.2%) | 2.8 mean, 1 median, 2/8 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 16 | 16 | 11 | 0 | 5 | 68.8% [44.4%–85.8%] (4 repos: bootstrap 33.3%–80.0%, cluster-t 41.4%–96.1%) | 68.8% [44.4%–85.8%] (4 repos: bootstrap 33.3%–80.0%, cluster-t 41.4%–96.1%) | 1.4 mean, 0 median, 5/8 repos with none |
| Suggestion tier (everything else) | 20 | 20 | 11 | 0 | 9 | 55.0% [34.2%–74.2%] (5 repos: bootstrap 39.1%–81.8%, cluster-t 23.5%–86.5%) | 55.0% [34.2%–74.2%] (5 repos: bootstrap 39.1%–81.8%, cluster-t 23.5%–86.5%) | 1.4 mean, 1 median, 3/8 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 8 | 16 | 16 | 11 | 0 | 5 | **68.8% [44.4%–85.8%] (4 repos: bootstrap 33.3%–80.0%, cluster-t 41.4%–96.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 68.8% [44.4%–85.8%] (4 repos: bootstrap 33.3%–80.0%, cluster-t 41.4%–96.1%) |
| python | Suggestion tier | 8 | 20 | 20 | 11 | 0 | 9 | 55.0% [34.2%–74.2%] (5 repos: bootstrap 39.1%–81.8%, cluster-t 23.5%–86.5%) | 55.0% [34.2%–74.2%] (5 repos: bootstrap 39.1%–81.8%, cluster-t 23.5%–86.5%) |
| python | All shown (both tiers) | 8 | 36 | 36 | 22 | 0 | 14 | 61.1% [44.9%–75.2%] (6 repos: bootstrap 54.1%–71.4%, cluster-t 49.0%–73.2%) | **61.1% [44.9%–75.2%] (6 repos: bootstrap 54.1%–71.4%, cluster-t 49.0%–73.2%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| polar | 9 | 6 | 0 | 3 | 67% [35%–88%] | 67% [35%–88%] | 6 | 6 | 83% [44%–97%] |
| netbox | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 7 | 71% [36%–92%] |
| saleor | 7 | 5 | 0 | 2 | 71% [36%–92%] | 71% [36%–92%] | 5 | 0 | – |
| CTFd | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 2 | 50% [9%–91%] |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| langchain | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 1 | 0% [0%–79%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Decorators | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 100% [44%–100%] |
| Base classes | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 7 | 57% [25%–84%] |
| Argument keys | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 4 | 50% [15%–85%] |
| Calls | 7 | 3 | 0 | 4 | 43% [16%–75%] | 43% [16%–75%] | 0 | – |
| Naming | 6 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Call order | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Package and repo facts | 4 | 3 | 0 | 1 | 75% [30%–95%] | 75% [30%–95%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 4, mixed_group 2, false_outliers 2, incidental 3
