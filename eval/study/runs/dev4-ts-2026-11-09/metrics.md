# Precision: eval/study/runs/dev4-ts-2026-11-09

- drift: drift 0.1.0-dev commit 1a44d7effbc6cd8c41a119524266630fdfce14de, binary sha256 9a8c7cd52483
- manifest: eval/study/runs/dev4-ts-2026-11-09/manifest.json, 35 repos ok, 1 failed: T17
- **1 repos failed** (decision D3: reported as failures, not swapped; the run continues with the rest): T17 (ERROR: drift --root /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/dev4/f11/cache/repos/T17 --no-cache census --all-outliers --all --max 15 failed (101): )
- labels: eval/study/runs/dev4-ts-2026-11-09/final-all.jsonl (16 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 16
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 16 | 16 | 11 | 0 | 5 | 68.8% [44.4%–85.8%] (9 repos: bootstrap 35.3%–96.4%, cluster-t 27.7%–100.0%) | 68.8% [44.4%–85.8%] (9 repos: bootstrap 35.3%–96.4%, cluster-t 27.7%–100.0%) | 0.3 mean, 0 median, 28/35 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 10 | 10 | 6 | 0 | 4 | 60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%) | 60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%) | 0.2 mean, 0 median, 32/35 repos with none |
| Suggestion tier (everything else) | 6 | 6 | 5 | 0 | 1 | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) | 0.1 mean, 0 median, 31/35 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 35 | 10 | 10 | 6 | 0 | 4 | **60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Suggestion tier | 35 | 6 | 6 | 5 | 0 | 1 | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) | 83.3% [43.6%–97.0%] (5 repos: bootstrap 40.0%–100.0%, cluster-t 34.6%–100.0%) |
| typescript/javascript | All shown (both tiers) | 35 | 16 | 16 | 11 | 0 | 5 | 68.8% [44.4%–85.8%] (9 repos: bootstrap 35.3%–96.4%, cluster-t 27.7%–100.0%) | **68.8% [44.4%–85.8%] (9 repos: bootstrap 35.3%–96.4%, cluster-t 27.7%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Layering (imports avoided) | Default tier | 10 | 6 | 0 | 4 | 60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%) | 60.0% [31.3%–83.2%] (4 repos: bootstrap 10.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Naming | Suggestion tier | 4 | 3 | 0 | 1 | 75.0% [30.1%–95.4%] (4 repos: bootstrap 25.0%–100.0%, cluster-t 0.0%–100.0%) | 75.0% [30.1%–95.4%] (4 repos: bootstrap 25.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | nestjs | 6 | 3 | 0 | – | 3 | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | nextjs | 11 | 3 | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 2 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [43.9%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | react_spa | 9 | 5 | 4 | 100.0% [51.0%–100.0%] (1 repo: no cluster interval) | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 80.0% [37.6%–96.4%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | other_node | 3 | 0 | 0 | – | 0 | – | – |
| typescript/javascript | express_fastify_hono | 6 | 5 | 5 | 20.0% [3.6%–62.4%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 0 | – | 20.0% [3.6%–62.4%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T02 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| T03 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| T04 | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| T05 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| T06 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T07 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T08 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T09 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T10 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T11 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T12 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| T13 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T14 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T15 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T16 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T18 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T19 | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 3 | 0% [0%–56%] |
| T20 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T21 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T22 | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 2 | 50% [9%–91%] |
| T23 | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| T24 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T25 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T26 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T27 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T28 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T29 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T30 | 4 | 4 | 0 | 0 | 100% [51%–100%] | 100% [51%–100%] | 4 | 4 | 100% [51%–100%] |
| T31 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T32 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T33 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T34 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T35 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| T36 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Layering (imports avoided) | 10 | 6 | 0 | 4 | 60% [31%–83%] | 60% [31%–83%] | 10 | 60% [31%–83%] |
| Naming | 4 | 3 | 0 | 1 | 75% [30%–95%] | 75% [30%–95%] | 0 | – |
| Control and typing | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: mixed_group 2, incidental 3
