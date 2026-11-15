# Precision: eval/study/runs/dev-v3-relabel5-2026-11-07/py/views/d7

- drift: drift 0.1.0-dev commit de57356738f26849eba160b797d271e59652b5ec, binary sha256 0d4ec8f54c10
- manifest: eval/repos-py.json, 6 repos ok
- labels: eval/study/runs/dev-v3-relabel5-2026-11-07/py/final.jsonl (17 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 17
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 17 | 17 | 10 | 0 | 7 | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 1.7 mean, 1 median, 2/6 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 6/6 repos with none |
| Suggestion tier (everything else) | 17 | 17 | 10 | 0 | 7 | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 1.7 mean, 1 median, 2/6 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 1 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 1 | 1 | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | All shown (both tiers) | 1 | 1 | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | **0.0% [0.0%–79.3%] (1 repo: no cluster interval)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 4 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 4 | 16 | 16 | 10 | 0 | 6 | 62.5% [38.6%–81.5%] (4 repos: bootstrap 50.0%–80.0%, cluster-t 50.3%–74.7%) | 62.5% [38.6%–81.5%] (4 repos: bootstrap 50.0%–80.0%, cluster-t 50.3%–74.7%) |
| python | All shown (both tiers) | 4 | 16 | 16 | 10 | 0 | 6 | 62.5% [38.6%–81.5%] (4 repos: bootstrap 50.0%–80.0%, cluster-t 50.3%–74.7%) | **62.5% [38.6%–81.5%] (4 repos: bootstrap 50.0%–80.0%, cluster-t 50.3%–74.7%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 6 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 6 | 17 | 17 | 10 | 0 | 7 | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) |
| all languages (pooled, secondary) | All shown (both tiers) | 6 | 17 | 17 | 10 | 0 | 7 | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) | 58.8% [36.0%–78.4%] (5 repos: bootstrap 33.3%–68.8%, cluster-t 41.9%–75.7%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Decorators | Suggestion tier | 3 | 3 | 0 | 0 | 100.0% [43.9%–100.0%] (1 repo: no cluster interval) | 100.0% [43.9%–100.0%] (1 repo: no cluster interval) |
| python | Base classes | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Argument keys | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (1 repo: no cluster interval) | 33.3% [6.1%–79.2%] (1 repo: no cluster interval) |
| python | Naming | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (2 repos: bootstrap 50.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (2 repos: bootstrap 50.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Control and typing | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Package and repo facts | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Import source | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| netbox | 11 | 7 | 0 | 4 | 64% [35%–85%] | 64% [35%–85%] | 7 | 0 | – |
| saleor | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| langchain | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Decorators | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 0 | – |
| Base classes | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Calls | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Naming | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 0 | – |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Package and repo facts | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Import source | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 4, misdescribes 1, mixed_group 2
