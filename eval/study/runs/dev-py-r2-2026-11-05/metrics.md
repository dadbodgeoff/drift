# Precision: eval/study/runs/dev-py-r2-2026-11-05

- drift: drift 0.1.0-dev commit 2709f17fbbc2ef21a1612b9f8a94efcba45593a8, binary sha256 41054fadcecf
- manifest: eval/repos-py.json, 8 repos ok
- labels: eval/study/runs/dev-py-r2-2026-11-05/final.jsonl (43 records)
- default tier: role has ≥ 15 members (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: not recorded; label records by rubric: not recorded 43
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 43 | 43 | 26 | 0 | 17 | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) | 3.3 mean, 1 median, 1/8 repos with none |
| Default tier (≥ 15 members, not pre-registered) | 43 | 43 | 26 | 0 | 17 | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) | 3.3 mean, 1 median, 1/8 repos with none |
| Suggestion tier (everything else) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 8/8 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 8 | 43 | 43 | 26 | 0 | 17 | **60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) |
| python | Suggestion tier | 8 | 0 | 0 | 0 | 0 | 0 | – | – |
| python | All shown (both tiers) | 8 | 43 | 43 | 26 | 0 | 17 | 60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%) | **60.5% [45.6%–73.6%] (7 repos: bootstrap 55.1%–73.1%, cluster-t 51.5%–69.5%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| polar | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 15 | 60% [36%–80%] |
| netbox | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 15 | 53% [30%–75%] |
| saleor | 7 | 5 | 0 | 2 | 71% [36%–92%] | 71% [36%–92%] | 5 | 7 | 71% [36%–92%] |
| CTFd | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 2 | 50% [9%–91%] |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| langchain | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 2 | 50% [9%–91%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Decorators | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 100% [44%–100%] |
| Base classes | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 7 | 57% [25%–84%] |
| Argument keys | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 4 | 50% [15%–85%] |
| Rendered components | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Calls | 10 | 4 | 0 | 6 | 40% [17%–69%] | 40% [17%–69%] | 10 | 40% [17%–69%] |
| Naming | 6 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 6 | 67% [30%–90%] |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 1 | 0% [0%–79%] |
| Call order | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 1 | 0% [0%–79%] |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 100% [21%–100%] |
| Package and repo facts | 6 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 6 | 83% [44%–97%] |

## Why not accepted

- TRIVIAL by: –
- WRONG because: incidental 4, legit_outliers 6, mixed_group 2, false_outliers 2
