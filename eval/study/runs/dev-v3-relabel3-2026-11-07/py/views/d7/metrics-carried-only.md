# Precision: eval/study/runs/dev-v3-relabel3-2026-11-07/py/views/d7

- drift: drift 0.1.0-dev commit 7d63aa31e2d213ca8ddcd28ae9eee0c5e610da46, binary sha256 a7456324d3ff
- manifest: eval/repos-py.json, 6 repos ok
- labels: eval/study/runs/dev-v3-relabel3-2026-11-07/py/carried.jsonl (14 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 14
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 23 | 14 | 5 | 0 | 9 | 35.7% [16.3%–61.2%] (4 repos: bootstrap 0.0%–54.5%, cluster-t 0.0%–82.1%) | 35.7% [16.3%–61.2%] (4 repos: bootstrap 0.0%–54.5%, cluster-t 0.0%–82.1%) | 1.3 mean, 0 median, 2/3 repos with none (3 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 6/6 repos with none |
| Suggestion tier (everything else) | 23 | 14 | 5 | 0 | 9 | 35.7% [16.3%–61.2%] (4 repos: bootstrap 0.0%–54.5%, cluster-t 0.0%–82.1%) | 35.7% [16.3%–61.2%] (4 repos: bootstrap 0.0%–54.5%, cluster-t 0.0%–82.1%) | 1.3 mean, 0 median, 2/3 repos with none (3 partly labelled repos excluded) |

**9 shown proposals have no label** (excluded above). Over all 23 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) |
| Default tier, unlabelled = WRONG | – | – |
| Suggestion tier, unlabelled = WRONG | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 60.9% | 60.9% |

Unlabelled: netbox/D-cc1341, netbox/D-76eb6b, netbox/D-bc0c7d, netbox/D-e2c3e4, netbox/D-58913a, netbox/D-937c0c, netbox/D-310ec7, fastapi/D-499c0e, langchain/D-0e154c

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 1 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 1 | 1 | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | All shown (both tiers) | 1 | 1 | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | **0.0% [0.0%–79.3%] (1 repo: no cluster interval)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 4 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 4 | 22 | 13 | 5 | 0 | 8 | 22.7% [10.1%–43.4%] (4 repos: bootstrap 0.0%–52.2%, cluster-t 0.0%–73.0%) | 22.7% [10.1%–43.4%] (4 repos: bootstrap 0.0%–52.2%, cluster-t 0.0%–73.0%) |
| python | All shown (both tiers) | 4 | 22 | 13 | 5 | 0 | 8 | 22.7% [10.1%–43.4%] (4 repos: bootstrap 0.0%–52.2%, cluster-t 0.0%–73.0%) | **22.7% [10.1%–43.4%] (4 repos: bootstrap 0.0%–52.2%, cluster-t 0.0%–73.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 6 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 6 | 23 | 14 | 5 | 0 | 9 | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) |
| all languages (pooled, secondary) | All shown (both tiers) | 6 | 23 | 14 | 5 | 0 | 9 | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) | 21.7% [9.7%–41.9%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–62.3%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Decorators | Suggestion tier | 3 | 0 | 0 | 1 | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) |
| python | Base classes | Suggestion tier | 1 | 0 | 0 | 0 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Argument keys | Suggestion tier | 2 | 0 | 0 | 0 | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 3 | 1 | 0 | 1 | 33.3% [6.1%–79.2%] (1 repo: no cluster interval) | 33.3% [6.1%–79.2%] (1 repo: no cluster interval) |
| python | Naming | Suggestion tier | 6 | 3 | 0 | 2 | 50.0% [18.8%–81.2%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [18.8%–81.2%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 1 | 0 | 0 | 0 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Package and repo facts | Suggestion tier | 4 | 1 | 0 | 3 | 25.0% [4.6%–69.9%] (2 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–100.0%) | 25.0% [4.6%–69.9%] (2 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–100.0%) |
| python | Import source | Suggestion tier | 1 | 0 | 0 | 0 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| netbox | 12 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 1 | 0 | – |
| saleor | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 4 | 0 | – |
| flask | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fastapi | 1 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| langchain | 2 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Decorators | 3 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Base classes | 1 | 0 | 0 | 0 | – | – | 0 | – |
| Argument keys | 2 | 0 | 0 | 0 | – | – | 0 | – |
| Calls | 3 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Naming | 6 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 1 | 0 | 0 | 0 | – | – | 0 | – |
| Package and repo facts | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 0 | – |
| Import source | 1 | 0 | 0 | 0 | – | – | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 4, mixed_group 4, incidental 1
