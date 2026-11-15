# Precision: eval/study/runs/dev4-py-2026-11-09

- drift: drift 0.1.0-dev commit 1a44d7effbc6cd8c41a119524266630fdfce14de, binary sha256 9a8c7cd52483
- manifest: eval/study/runs/dev4-py-2026-11-09/manifest.json, 24 repos ok
- labels: eval/study/runs/dev4-py-2026-11-09/final.jsonl (3 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 3
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 3 | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 0.1 mean, 0 median, 22/24 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 24/24 repos with none |
| Suggestion tier (everything else) | 3 | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 0.1 mean, 0 median, 22/24 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 24 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 24 | 3 | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | All shown (both tiers) | 24 | 3 | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | **66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Naming | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | django | 10 | 1 | 0 | – | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | fastapi | 9 | 2 | 0 | – | 2 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | flask | 3 | 0 | 0 | – | 0 | – | – |
| python | other_python | 2 | 0 | 0 | – | 0 | – | – |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P02 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P03 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P04 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P05 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P06 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P07 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P08 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P09 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P10 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P11 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P12 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P13 | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| P14 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P15 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P16 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P17 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P18 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P19 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P20 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P21 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P22 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P23 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P24 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Naming | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: mixed_group 1
