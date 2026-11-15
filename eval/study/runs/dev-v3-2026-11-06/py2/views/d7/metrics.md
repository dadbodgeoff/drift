# Precision: eval/study/runs/dev-v3-2026-11-06/py2/views/d7

- drift: drift 0.1.0-dev commit debc33a3483ba9c53dfac93d50bbadf58553ea27, binary sha256 b2b23599f83a
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-2026-11-06/py2/final.jsonl (76 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 76
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 76 | 76 | 23 | 1 | 52 | 31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%) | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | 1.9 mean, 2 median, 1/12 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 12/12 repos with none |
| Suggestion tier (everything else) | 76 | 76 | 23 | 1 | 52 | 31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%) | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | 1.9 mean, 2 median, 1/12 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 7 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 7 | 18 | 18 | 7 | 0 | 11 | 38.9% [20.3%–61.4%] (7 repos: bootstrap 23.5%–64.3%, cluster-t 14.6%–63.2%) | 38.9% [20.3%–61.4%] (7 repos: bootstrap 23.5%–64.3%, cluster-t 14.6%–63.2%) |
| typescript/javascript | All shown (both tiers) | 7 | 18 | 18 | 7 | 0 | 11 | 38.9% [20.3%–61.4%] (7 repos: bootstrap 23.5%–64.3%, cluster-t 14.6%–63.2%) | **38.9% [20.3%–61.4%] (7 repos: bootstrap 23.5%–64.3%, cluster-t 14.6%–63.2%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 12 | 58 | 58 | 16 | 1 | 41 | 27.6% [17.8%–40.2%] (10 repos: bootstrap 16.0%–41.1%, cluster-t 12.1%–43.1%) | 29.3% [19.2%–42.0%] (10 repos: bootstrap 18.8%–42.4%, cluster-t 14.5%–44.1%) |
| python | All shown (both tiers) | 12 | 58 | 58 | 16 | 1 | 41 | 27.6% [17.8%–40.2%] (10 repos: bootstrap 16.0%–41.1%, cluster-t 12.1%–43.1%) | **29.3% [19.2%–42.0%] (10 repos: bootstrap 18.8%–42.4%, cluster-t 14.5%–44.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 12 | 76 | 76 | 23 | 1 | 52 | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | 31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%) |
| all languages (pooled, secondary) | All shown (both tiers) | 12 | 76 | 76 | 23 | 1 | 52 | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | 31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | django | 5 | 14 | 0 | – | 14 | 35.7% [16.3%–61.2%] (5 repos: bootstrap 14.3%–70.0%, cluster-t 3.1%–68.3%) | 35.7% [16.3%–61.2%] (5 repos: bootstrap 14.3%–70.0%, cluster-t 3.1%–68.3%) |
| typescript/javascript | fastapi | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| python | django | 8 | 32 | 0 | – | 32 | 31.3% [18.0%–48.6%] (6 repos: bootstrap 10.7%–48.6%, cluster-t 3.3%–59.2%) | 34.4% [20.4%–51.7%] (6 repos: bootstrap 17.2%–50.0%, cluster-t 9.6%–59.2%) |
| python | fastapi | 2 | 13 | 0 | – | 13 | 30.8% [12.7%–57.6%] (2 repos: bootstrap 28.6%–33.3%, cluster-t 0.7%–60.8%) | 30.8% [12.7%–57.6%] (2 repos: bootstrap 28.6%–33.3%, cluster-t 0.7%–60.8%) |
| python | flask | 2 | 13 | 0 | – | 13 | 15.4% [4.3%–42.2%] (2 repos: bootstrap 10.0%–33.3%, cluster-t 0.0%–100.0%) | 15.4% [4.3%–42.2%] (2 repos: bootstrap 10.0%–33.3%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 9 | 5 | 0 | 4 | 56% [27%–81%] | 56% [27%–81%] | 5 | 0 | – |
| InvenTree | 11 | 2 | 1 | 8 | 27% [10%–57%] | 18% [5%–48%] | 2 | 0 | – |
| ralph | 6 | 1 | 0 | 5 | 17% [3%–56%] | 17% [3%–56%] | 1 | 0 | – |
| Misago | 8 | 2 | 0 | 6 | 25% [7%–59%] | 25% [7%–59%] | 2 | 0 | – |
| paperless-ngx | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| wger | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 0 | – |
| lotus | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 2 | 0 | – |
| pontoon | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| open-wearables | 8 | 3 | 0 | 5 | 38% [14%–69%] | 38% [14%–69%] | 3 | 0 | – |
| tasking-manager | 9 | 3 | 0 | 6 | 33% [12%–65%] | 33% [12%–65%] | 3 | 0 | – |
| simplelogin | 10 | 1 | 0 | 9 | 10% [2%–40%] | 10% [2%–40%] | 1 | 0 | – |
| changedetection.io | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 9 | 7 | 0 | 2 | 78% [45%–94%] | 78% [45%–94%] | 0 | – |
| Decorators | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Base classes | 11 | 2 | 1 | 8 | 18% [5%–48%] | 27% [10%–57%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 17 | 2 | 0 | 15 | 12% [3%–34%] | 12% [3%–34%] | 0 | – |
| Naming | 12 | 2 | 0 | 10 | 17% [5%–45%] | 17% [5%–45%] | 0 | – |
| Other avoidance (any, console, bare Error) | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Call order | 8 | 0 | 0 | 8 | 0% [0%–32%] | 0% [0%–32%] | 0 | – |
| Control and typing | 7 | 7 | 0 | 0 | 100% [65%–100%] | 100% [65%–100%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: false_outliers 8, incidental 14, mixed_group 20, legit_outliers 9, misdescribes 1
