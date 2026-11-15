# Precision: eval/study/runs/dev-v3-2026-11-06/py/views/d7

- drift: drift 0.1.0-dev commit debc33a3483ba9c53dfac93d50bbadf58553ea27, binary sha256 b2b23599f83a
- manifest: eval/repos-py.json, 8 repos ok
- labels: eval/study/runs/dev-v3-2026-11-06/py/final.jsonl (37 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 37
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 39 | 37 | 15 | 0 | 22 | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 2.1 mean, 1 median, 3/7 repos with none (1 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 8/8 repos with none |
| Suggestion tier (everything else) | 39 | 37 | 15 | 0 | 22 | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 40.5% [26.3%–56.5%] (6 repos: bootstrap 25.0%–54.2%, cluster-t 21.4%–59.7%) | 2.1 mean, 1 median, 3/7 repos with none (1 partly labelled repos excluded) |

**2 shown proposals have no label** (excluded above). Over all 39 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) |
| Default tier, unlabelled = WRONG | – | – |
| Suggestion tier, unlabelled = WRONG | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 43.6% | 43.6% |

Unlabelled: CTFd/D-560792, CTFd/D-f6c1fb

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 2 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 2 | 6 | 6 | 2 | 0 | 4 | 33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%) | 33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | All shown (both tiers) | 2 | 6 | 6 | 2 | 0 | 4 | 33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%) | **33.3% [9.7%–70.0%] (2 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 6 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 6 | 33 | 31 | 13 | 0 | 18 | 39.4% [24.7%–56.3%] (6 repos: bootstrap 22.2%–55.6%, cluster-t 17.1%–61.6%) | 39.4% [24.7%–56.3%] (6 repos: bootstrap 22.2%–55.6%, cluster-t 17.1%–61.6%) |
| python | All shown (both tiers) | 6 | 33 | 31 | 13 | 0 | 18 | 39.4% [24.7%–56.3%] (6 repos: bootstrap 22.2%–55.6%, cluster-t 17.1%–61.6%) | **39.4% [24.7%–56.3%] (6 repos: bootstrap 22.2%–55.6%, cluster-t 17.1%–61.6%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 8 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 8 | 39 | 37 | 15 | 0 | 22 | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) |
| all languages (pooled, secondary) | All shown (both tiers) | 8 | 39 | 37 | 15 | 0 | 22 | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) | 38.5% [24.9%–54.1%] (7 repos: bootstrap 20.0%–51.5%, cluster-t 20.4%–56.5%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| polar | 15 | 7 | 0 | 8 | 47% [25%–70%] | 47% [25%–70%] | 7 | 0 | – |
| netbox | 12 | 3 | 0 | 9 | 25% [9%–53%] | 25% [9%–53%] | 3 | 0 | – |
| saleor | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 4 | 0 | – |
| CTFd | 2 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| langchain | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Decorators | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Base classes | 6 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 0 | – |
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
