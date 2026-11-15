# Precision: eval/study/runs/calib-v3-2026-11-06/py

- drift: drift 0.1.0-dev commit 2709f17fbbc2ef21a1612b9f8a94efcba45593a8, binary sha256 41054fadcecf
- manifest: eval/repos-py.json, 6 repos ok
- labels: eval/study/runs/calib-v3-2026-11-06/py/final.jsonl (24 records)
- kind: **calibration** (a relabel that measures a rubric change, not a precision result): shift eval/study/runs/calib-v3-2026-11-06/shift.json, agreement eval/study/runs/calib-v3-2026-11-06/py/agreement.json
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, passes_key, avoids:import, renders, wrapped_by:jsx} and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 24
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 26 | 24 | 8 | 0 | 16 | 33.3% [18.0%–53.3%] (5 repos: bootstrap 8.3%–51.4%, cluster-t 0.0%–70.9%) | 33.3% [18.0%–53.3%] (5 repos: bootstrap 8.3%–51.4%, cluster-t 0.0%–70.9%) | 1.6 mean, 1 median, 2/5 repos with none (1 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 13 | 11 | 5 | 0 | 6 | 45.5% [21.3%–72.0%] (2 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%) | 45.5% [21.3%–72.0%] (2 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%) | 1.0 mean, 0 median, 4/5 repos with none (1 partly labelled repos excluded) |
| Suggestion tier (everything else) | 13 | 13 | 3 | 0 | 10 | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) | 0.5 mean, 0.5 median, 3/6 repos with none |

**2 shown proposals have no label** (excluded above). Over all 26 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 30.8% [16.5%–50.0%] (6 repos: bootstrap 6.7%–48.6%, cluster-t 0.0%–64.2%) | 30.8% [16.5%–50.0%] (6 repos: bootstrap 6.7%–48.6%, cluster-t 0.0%–64.2%) |
| Default tier, unlabelled = WRONG | 38.5% [17.7%–64.5%] (3 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%) | 38.5% [17.7%–64.5%] (3 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%) |
| Suggestion tier, unlabelled = WRONG | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 38.5% | 38.5% |

Unlabelled: CTFd/D-560792, CTFd/D-f6c1fb

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 6 | 13 | 11 | 5 | 0 | 6 | **38.5% [17.7%–64.5%] (3 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 38.5% [17.7%–64.5%] (3 repos: bootstrap 0.0%–71.4%, cluster-t 0.0%–100.0%) |
| python | Suggestion tier | 6 | 13 | 13 | 3 | 0 | 10 | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) | 23.1% [8.2%–50.3%] (5 repos: bootstrap 12.5%–28.6%, cluster-t 12.1%–34.1%) |
| python | All shown (both tiers) | 6 | 26 | 24 | 8 | 0 | 16 | 30.8% [16.5%–50.0%] (6 repos: bootstrap 6.7%–48.6%, cluster-t 0.0%–64.2%) | **30.8% [16.5%–50.0%] (6 repos: bootstrap 6.7%–48.6%, cluster-t 0.0%–64.2%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| polar | 11 | 6 | 0 | 5 | 55% [28%–79%] | 55% [28%–79%] | 6 | 7 | 71% [36%–92%] |
| netbox | 8 | 1 | 0 | 7 | 13% [2%–47%] | 13% [2%–47%] | 1 | 4 | 0% [0%–49%] |
| saleor | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| CTFd | 2 | 0 | 0 | 0 | – | – | 0 | 2 | – |
| langchain | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Decorators | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 2 | 0% [0%–66%] |
| Base classes | 4 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 4 | 50% [9%–91%] |
| Argument keys | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 3 | 33% [6%–79%] |
| Rendered components | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Calls | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 0 | – |
| Naming | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Package and repo facts | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 6, false_outliers 1, incidental 4, mixed_group 5
