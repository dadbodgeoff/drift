# Precision: eval/study/runs/dev3-py-2026-11-08

- drift: drift 0.1.0-dev commit 5151e5cb40b980f3db61416662dadbcf47c2f1ba, binary sha256 bf33e175ede9
- manifest: eval/study/runs/dev3-py-2026-11-08/manifest.json, 8 repos ok
- labels: eval/study/runs/dev3-py-2026-11-08/final.jsonl (2 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 2
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 2 | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 0.1 mean, 0 median, 7/8 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 8/8 repos with none |
| Suggestion tier (everything else) | 2 | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 0.1 mean, 0 median, 7/8 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 8 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 8 | 2 | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | All shown (both tiers) | 8 | 2 | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | **50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Naming | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | django | 2 | 1 | 0 | – | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | fastapi | 3 | 1 | 0 | – | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | flask | 1 | 0 | 0 | – | 0 | – | – |
| python | other_python | 2 | 0 | 0 | – | 0 | – | – |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P09 | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| P03 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P04 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P10 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P06 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P07 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P12 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Naming | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: mixed_group 1
