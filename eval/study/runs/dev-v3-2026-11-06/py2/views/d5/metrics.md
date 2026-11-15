# Precision: eval/study/runs/dev-v3-2026-11-06/py2/views/d5

- drift: drift 0.1.0-dev commit debc33a3483ba9c53dfac93d50bbadf58553ea27, binary sha256 b2b23599f83a
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-2026-11-06/py2/final.jsonl (76 records)
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, avoids:import, wrapped_by:jsx}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 76
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 76 | 76 | 23 | 1 | 52 | 31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%) | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | 1.9 mean, 2 median, 1/12 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 14 | 14 | 6 | 1 | 7 | 50.0% [26.8%–73.2%] (9 repos: bootstrap 23.5%–83.3%, cluster-t 12.9%–87.1%) | 42.9% [21.4%–67.4%] (9 repos: bootstrap 16.7%–75.0%, cluster-t 7.0%–78.7%) | 0.5 mean, 0 median, 7/12 repos with none |
| Suggestion tier (everything else) | 62 | 62 | 17 | 0 | 45 | 27.4% [17.9%–39.6%] (12 repos: bootstrap 17.2%–39.5%, cluster-t 14.5%–40.4%) | 27.4% [17.9%–39.6%] (12 repos: bootstrap 17.2%–39.5%, cluster-t 14.5%–40.4%) | 1.4 mean, 2 median, 3/12 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 12 | 14 | 14 | 6 | 1 | 7 | **42.9% [21.4%–67.4%] (9 repos: bootstrap 16.7%–75.0%, cluster-t 7.0%–78.7%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 50.0% [26.8%–73.2%] (9 repos: bootstrap 23.5%–83.3%, cluster-t 12.9%–87.1%) |
| python | Suggestion tier | 12 | 62 | 62 | 17 | 0 | 45 | 27.4% [17.9%–39.6%] (12 repos: bootstrap 17.2%–39.5%, cluster-t 14.5%–40.4%) | 27.4% [17.9%–39.6%] (12 repos: bootstrap 17.2%–39.5%, cluster-t 14.5%–40.4%) |
| python | All shown (both tiers) | 12 | 76 | 76 | 23 | 1 | 52 | 30.3% [21.1%–41.3%] (12 repos: bootstrap 20.8%–41.9%, cluster-t 18.3%–42.3%) | **31.6% [22.2%–42.7%] (12 repos: bootstrap 22.4%–42.5%, cluster-t 20.2%–43.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | django | 8 | 46 | 8 | 37.5% [13.7%–69.4%] (5 repos: bootstrap 0.0%–85.7%, cluster-t 0.0%–100.0%) | 38 | 31.6% [19.1%–47.5%] (8 repos: bootstrap 19.6%–46.4%, cluster-t 15.6%–47.5%) | 34.8% [22.7%–49.2%] (8 repos: bootstrap 23.1%–50.0%, cluster-t 18.2%–51.4%) |
| python | fastapi | 2 | 17 | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 13 | 30.8% [12.7%–57.6%] (2 repos: bootstrap 28.6%–33.3%, cluster-t 0.7%–60.8%) | 35.3% [17.3%–58.7%] (2 repos: bootstrap 33.3%–37.5%, cluster-t 8.9%–61.7%) |
| python | flask | 2 | 13 | 2 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 11 | 9.1% [1.6%–37.7%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 15.4% [4.3%–42.2%] (2 repos: bootstrap 10.0%–33.3%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 9 | 5 | 0 | 4 | 56% [27%–81%] | 56% [27%–81%] | 5 | 2 | 100% [34%–100%] |
| InvenTree | 11 | 2 | 1 | 8 | 27% [10%–57%] | 18% [5%–48%] | 2 | 1 | 0% [0%–79%] |
| ralph | 6 | 1 | 0 | 5 | 17% [3%–56%] | 17% [3%–56%] | 1 | 2 | 0% [0%–66%] |
| Misago | 8 | 2 | 0 | 6 | 25% [7%–59%] | 25% [7%–59%] | 2 | 2 | 0% [0%–66%] |
| paperless-ngx | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 1 | 100% [21%–100%] |
| wger | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 0 | – |
| lotus | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 2 | 0 | – |
| pontoon | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| open-wearables | 8 | 3 | 0 | 5 | 38% [14%–69%] | 38% [14%–69%] | 3 | 1 | 100% [21%–100%] |
| tasking-manager | 9 | 3 | 0 | 6 | 33% [12%–65%] | 33% [12%–65%] | 3 | 3 | 33% [6%–79%] |
| simplelogin | 10 | 1 | 0 | 9 | 10% [2%–40%] | 10% [2%–40%] | 1 | 1 | 100% [21%–100%] |
| changedetection.io | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 1 | 0% [0%–79%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 9 | 7 | 0 | 2 | 78% [45%–94%] | 78% [45%–94%] | 6 | 67% [30%–90%] |
| Decorators | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 1 | 0% [0%–79%] |
| Base classes | 11 | 2 | 1 | 8 | 18% [5%–48%] | 27% [10%–57%] | 6 | 17% [3%–56%] |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 100% [21%–100%] |
| Calls | 17 | 2 | 0 | 15 | 12% [3%–34%] | 12% [3%–34%] | 0 | – |
| Naming | 12 | 2 | 0 | 10 | 17% [5%–45%] | 17% [5%–45%] | 0 | – |
| Other avoidance (any, console, bare Error) | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Call order | 8 | 0 | 0 | 8 | 0% [0%–32%] | 0% [0%–32%] | 0 | – |
| Control and typing | 7 | 7 | 0 | 0 | 100% [65%–100%] | 100% [65%–100%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: false_outliers 8, incidental 14, mixed_group 20, legit_outliers 9, misdescribes 1
