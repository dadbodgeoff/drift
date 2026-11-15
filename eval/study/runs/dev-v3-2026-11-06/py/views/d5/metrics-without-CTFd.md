# Precision: eval/study/runs/dev-v3-2026-11-06/py/views/d5

- drift: drift 0.1.0-dev commit debc33a3483ba9c53dfac93d50bbadf58553ea27, binary sha256 b2b23599f83a
- manifest: eval/repos-py.json, 8 repos ok
- labels: eval/study/runs/dev-v3-2026-11-06/py/final.jsonl (37 records)
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, avoids:import, wrapped_by:jsx}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 37
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 39 | 37 | 15 | 0 | 22 | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 2.1 mean, 1 median, 3/7 repos with none (1 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 10 | 8 | 3 | 0 | 5 | 37.5% [13.7%–69.4%] (2 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 37.5% [13.7%–69.4%] (2 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 0.4 mean, 0 median, 6/7 repos with none (1 partly labelled repos excluded) |
| Suggestion tier (everything else) | 29 | 29 | 12 | 0 | 17 | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) | 1.5 mean, 0.5 median, 4/8 repos with none |

**2 shown proposals have no label** (excluded above). Over all 39 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) |
| Default tier, unlabelled = WRONG | 30.0% [10.8%–60.3%] (3 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 30.0% [10.8%–60.3%] (3 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) |
| Suggestion tier, unlabelled = WRONG | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 43.6% | 43.6% |

Unlabelled: CTFd/D-560792, CTFd/D-f6c1fb

## Exposure check: all repos vs excluding exposed (1 of 8 repos exposed)

Exposed: CTFd. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.

|  | Repos | Shown | Not-wrong | Accept | Default-tier accept | (labelled: not-wrong / accept) | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All repos | 8 | 39 | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 30.0% [10.8%–60.3%] (3 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 40.5% / 40.5% | 2.1 |
| Excluding exposed | 7 | 37 | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 37.5% [13.7%–69.4%] (2 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 40.5% / 40.5% | 1.9 |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unknown | Default tier | 8 | 10 | 8 | 3 | 0 | 5 | **30.0% [10.8%–60.3%] (3 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 30.0% [10.8%–60.3%] (3 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) |
| unknown | Suggestion tier | 8 | 29 | 29 | 12 | 0 | 17 | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) | 41.4% [25.5%–59.3%] (6 repos: bootstrap 30.4%–54.2%, cluster-t 26.6%–56.1%) |
| unknown | All shown (both tiers) | 8 | 39 | 37 | 15 | 0 | 22 | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | **38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| polar | 15 | 7 | 0 | 8 | 47% [25%–70%] | 47% [25%–70%] | 7 | 4 | 75% [30%–95%] |
| netbox | 12 | 3 | 0 | 9 | 25% [9%–53%] | 25% [9%–53%] | 3 | 4 | 0% [0%–49%] |
| saleor | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 4 | 0 | – |
| CTFd | 2 | 0 | 0 | 0 | – | – | 0 | 2 | – |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| langchain | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Decorators | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 3 | 0% [0%–56%] |
| Base classes | 6 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 5 | 33% [6%–79%] |
| Argument keys | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 0 | – |
| Rendered components | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Calls | 8 | 2 | 0 | 6 | 25% [7%–59%] | 25% [7%–59%] | 0 | – |
| Naming | 6 | 3 | 0 | 3 | 50% [19%–81%] | 50% [19%–81%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Package and repo facts | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 8, incidental 2, false_outliers 3, mixed_group 9
