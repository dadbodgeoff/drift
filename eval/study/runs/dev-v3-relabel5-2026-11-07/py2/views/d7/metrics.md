# Precision: eval/study/runs/dev-v3-relabel5-2026-11-07/py2/views/d7

- drift: drift 0.1.0-dev commit de57356738f26849eba160b797d271e59652b5ec, binary sha256 0d4ec8f54c10
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-relabel5-2026-11-07/py2/final.jsonl (60 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 60
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 60 | 60 | 37 | 0 | 23 | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 3.1 mean, 3.5 median, 0/12 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 12/12 repos with none |
| Suggestion tier (everything else) | 60 | 60 | 37 | 0 | 23 | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 3.1 mean, 3.5 median, 0/12 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 7 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 7 | 18 | 18 | 7 | 0 | 11 | 38.9% [20.3%–61.4%] (7 repos: bootstrap 22.7%–63.6%, cluster-t 14.6%–63.2%) | 38.9% [20.3%–61.4%] (7 repos: bootstrap 22.7%–63.6%, cluster-t 14.6%–63.2%) |
| typescript/javascript | All shown (both tiers) | 7 | 18 | 18 | 7 | 0 | 11 | 38.9% [20.3%–61.4%] (7 repos: bootstrap 22.7%–63.6%, cluster-t 14.6%–63.2%) | **38.9% [20.3%–61.4%] (7 repos: bootstrap 22.7%–63.6%, cluster-t 14.6%–63.2%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 12 | 42 | 42 | 30 | 0 | 12 | 71.4% [56.4%–82.8%] (11 repos: bootstrap 58.5%–84.1%, cluster-t 56.0%–86.8%) | 71.4% [56.4%–82.8%] (11 repos: bootstrap 58.5%–84.1%, cluster-t 56.0%–86.8%) |
| python | All shown (both tiers) | 12 | 42 | 42 | 30 | 0 | 12 | 71.4% [56.4%–82.8%] (11 repos: bootstrap 58.5%–84.1%, cluster-t 56.0%–86.8%) | **71.4% [56.4%–82.8%] (11 repos: bootstrap 58.5%–84.1%, cluster-t 56.0%–86.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 12 | 60 | 60 | 37 | 0 | 23 | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) |
| all languages (pooled, secondary) | All shown (both tiers) | 12 | 60 | 60 | 37 | 0 | 23 | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) | 61.7% [49.0%–72.9%] (12 repos: bootstrap 51.3%–73.7%, cluster-t 48.3%–75.1%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Decorators | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Base classes | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Naming | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 0 | 0 | 5 | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 4 | 3 | 0 | 1 | 75.0% [30.1%–95.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 75.0% [30.1%–95.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 6 | 5 | 0 | 1 | 83.3% [43.6%–97.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 83.3% [43.6%–97.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Decorators | Suggestion tier | 4 | 1 | 0 | 3 | 25.0% [4.6%–69.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 25.0% [4.6%–69.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) |
| python | Base classes | Suggestion tier | 7 | 4 | 0 | 3 | 57.1% [25.0%–84.2%] (5 repos: bootstrap 16.7%–87.5%, cluster-t 1.2%–100.0%) | 57.1% [25.0%–84.2%] (5 repos: bootstrap 16.7%–87.5%, cluster-t 1.2%–100.0%) |
| python | Argument keys | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 8 | 6 | 0 | 2 | 75.0% [40.9%–92.9%] (6 repos: bootstrap 44.4%–100.0%, cluster-t 35.6%–100.0%) | 75.0% [40.9%–92.9%] (6 repos: bootstrap 44.4%–100.0%, cluster-t 35.6%–100.0%) |
| python | Naming | Suggestion tier | 9 | 9 | 0 | 0 | 100.0% [70.1%–100.0%] (7 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [70.1%–100.0%] (7 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 3 | 3 | 0 | 0 | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | django | 5 | 14 | 0 | – | 14 | 35.7% [16.3%–61.2%] (5 repos: bootstrap 14.3%–66.7%, cluster-t 3.1%–68.3%) | 35.7% [16.3%–61.2%] (5 repos: bootstrap 14.3%–66.7%, cluster-t 3.1%–68.3%) |
| typescript/javascript | fastapi | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| python | django | 8 | 28 | 0 | – | 28 | 78.6% [60.5%–89.8%] (7 repos: bootstrap 60.9%–93.5%, cluster-t 56.6%–100.0%) | 78.6% [60.5%–89.8%] (7 repos: bootstrap 60.9%–93.5%, cluster-t 56.6%–100.0%) |
| python | fastapi | 2 | 9 | 0 | – | 9 | 55.6% [26.7%–81.1%] (2 repos: bootstrap 50.0%–60.0%, cluster-t 0.0%–100.0%) | 55.6% [26.7%–81.1%] (2 repos: bootstrap 50.0%–60.0%, cluster-t 0.0%–100.0%) |
| python | flask | 2 | 5 | 0 | – | 5 | 60.0% [23.1%–88.2%] (2 repos: bootstrap 50.0%–66.7%, cluster-t 0.0%–100.0%) | 60.0% [23.1%–88.2%] (2 repos: bootstrap 50.0%–66.7%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 6 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 4 | 0 | – |
| InvenTree | 12 | 5 | 0 | 7 | 42% [19%–68%] | 42% [19%–68%] | 5 | 0 | – |
| ralph | 5 | 4 | 0 | 1 | 80% [38%–96%] | 80% [38%–96%] | 4 | 0 | – |
| Misago | 7 | 6 | 0 | 1 | 86% [49%–97%] | 86% [49%–97%] | 6 | 0 | – |
| paperless-ngx | 5 | 4 | 0 | 1 | 80% [38%–96%] | 80% [38%–96%] | 4 | 0 | – |
| wger | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| lotus | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |
| pontoon | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| open-wearables | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 3 | 0 | – |
| tasking-manager | 8 | 4 | 0 | 4 | 50% [22%–78%] | 50% [22%–78%] | 4 | 0 | – |
| simplelogin | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| changedetection.io | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 6 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 0 | – |
| Decorators | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 0 | – |
| Base classes | 10 | 5 | 0 | 5 | 50% [24%–76%] | 50% [24%–76%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 9 | 7 | 0 | 2 | 78% [45%–94%] | 78% [45%–94%] | 0 | – |
| Naming | 12 | 11 | 0 | 1 | 92% [65%–99%] | 92% [65%–99%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Call order | 5 | 0 | 0 | 5 | 0% [0%–43%] | 0% [0%–43%] | 0 | – |
| Control and typing | 7 | 6 | 0 | 1 | 86% [49%–97%] | 86% [49%–97%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: incidental 7, false_outliers 5, mixed_group 7, legit_outliers 3, misdescribes 1
