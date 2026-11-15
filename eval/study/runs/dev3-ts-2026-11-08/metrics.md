# Precision: eval/study/runs/dev3-ts-2026-11-08

- drift: drift 0.1.0-dev commit 5151e5cb40b980f3db61416662dadbcf47c2f1ba, binary sha256 bf33e175ede9
- manifest: eval/study/runs/dev3-ts-2026-11-08/manifest.json, 12 repos ok
- labels: eval/study/runs/dev3-ts-2026-11-08/final.jsonl (12 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 12
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 12 | 12 | 7 | 1 | 4 | 66.7% [39.1%–86.2%] (5 repos: bootstrap 45.5%–100.0%, cluster-t 24.4%–100.0%) | 58.3% [32.0%–80.7%] (5 repos: bootstrap 33.3%–88.9%, cluster-t 15.4%–100.0%) | 0.6 mean, 0 median, 8/12 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 5 | 5 | 1 | 1 | 3 | 40.0% [11.8%–76.9%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 20.0% [3.6%–62.4%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–88.9%) | 0.1 mean, 0 median, 11/12 repos with none |
| Suggestion tier (everything else) | 7 | 7 | 6 | 0 | 1 | 85.7% [48.7%–97.4%] (4 repos: bootstrap 70.0%–100.0%, cluster-t 50.5%–100.0%) | 85.7% [48.7%–97.4%] (4 repos: bootstrap 70.0%–100.0%, cluster-t 50.5%–100.0%) | 0.5 mean, 0 median, 8/12 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 12 | 5 | 5 | 1 | 1 | 3 | **20.0% [3.6%–62.4%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–88.9%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 40.0% [11.8%–76.9%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Suggestion tier | 12 | 7 | 7 | 6 | 0 | 1 | 85.7% [48.7%–97.4%] (4 repos: bootstrap 70.0%–100.0%, cluster-t 50.5%–100.0%) | 85.7% [48.7%–97.4%] (4 repos: bootstrap 70.0%–100.0%, cluster-t 50.5%–100.0%) |
| typescript/javascript | All shown (both tiers) | 12 | 12 | 12 | 7 | 1 | 4 | 58.3% [32.0%–80.7%] (5 repos: bootstrap 33.3%–88.9%, cluster-t 15.4%–100.0%) | **66.7% [39.1%–86.2%] (5 repos: bootstrap 45.5%–100.0%, cluster-t 24.4%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Layering (imports avoided) | Default tier | 4 | 1 | 1 | 2 | 25.0% [4.6%–69.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Naming | Suggestion tier | 4 | 4 | 0 | 0 | 100.0% [51.0%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [51.0%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | nestjs | 3 | 4 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 3 | 66.7% [20.8%–93.9%] (1 repo: no cluster interval) | 50.0% [15.0%–85.0%] (1 repo: no cluster interval) |
| typescript/javascript | nextjs | 3 | 6 | 3 | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 3 | 100.0% [43.9%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 66.7% [30.0%–90.3%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | react_spa | 1 | 0 | 0 | – | 0 | – | – |
| typescript/javascript | express_fastify_hono | 4 | 2 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | other_node | 1 | 0 | 0 | – | 0 | – | – |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T02 | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 2 | 1 | 0% [0%–79%] |
| T03 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T13 | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 1 | 100% [21%–100%] |
| T14 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T06 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T07 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| T08 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T15 | 1 | 0 | 1 | 0 | 100% [21%–100%] | 0% [0%–79%] | 0 | 1 | 0% [0%–79%] |
| T16 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T17 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T18 | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 2 | 0% [0%–66%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 1 | 0% [0%–79%] |
| Layering (imports avoided) | 4 | 1 | 1 | 2 | 25% [5%–70%] | 50% [15%–85%] | 4 | 25% [5%–70%] |
| Naming | 4 | 4 | 0 | 0 | 100% [51%–100%] | 100% [51%–100%] | 0 | – |
| Control and typing | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 0 | – |

## Why not accepted

- TRIVIAL by: lint 1
- WRONG because: mixed_group 3, legit_outliers 1
