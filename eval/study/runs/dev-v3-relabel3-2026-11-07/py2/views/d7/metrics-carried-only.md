# Precision: eval/study/runs/dev-v3-relabel3-2026-11-07/py2/views/d7

- drift: drift 0.1.0-dev commit 7d63aa31e2d213ca8ddcd28ae9eee0c5e610da46, binary sha256 a7456324d3ff
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-relabel3-2026-11-07/py2/carried.jsonl (65 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 65
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 77 | 65 | 20 | 0 | 45 | 30.8% [20.9%–42.8%] (12 repos: bootstrap 19.3%–43.9%, cluster-t 16.3%–45.3%) | 30.8% [20.9%–42.8%] (12 repos: bootstrap 19.3%–43.9%, cluster-t 16.3%–45.3%) | 1.3 mean, 1.5 median, 1/4 repos with none (8 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 12/12 repos with none |
| Suggestion tier (everything else) | 77 | 65 | 20 | 0 | 45 | 30.8% [20.9%–42.8%] (12 repos: bootstrap 19.3%–43.9%, cluster-t 16.3%–45.3%) | 30.8% [20.9%–42.8%] (12 repos: bootstrap 19.3%–43.9%, cluster-t 16.3%–45.3%) | 1.3 mean, 1.5 median, 1/4 repos with none (8 partly labelled repos excluded) |

**12 shown proposals have no label** (excluded above). Over all 77 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) |
| Default tier, unlabelled = WRONG | – | – |
| Suggestion tier, unlabelled = WRONG | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 41.6% | 41.6% |

Unlabelled: Django-CRM/D-b6f0b8, Django-CRM/D-1a9f79, InvenTree/D-47d790, InvenTree/D-455913, ralph/D-4529f9, ralph/D-5b6f70, ralph/D-43f01e, Misago/D-b4e5ff, paperless-ngx/D-de2489, open-wearables/D-dadcea, tasking-manager/D-c7acd1, simplelogin/D-2a4960

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 7 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 7 | 20 | 16 | 7 | 0 | 9 | 35.0% [18.1%–56.7%] (7 repos: bootstrap 18.2%–60.0%, cluster-t 10.1%–59.9%) | 35.0% [18.1%–56.7%] (7 repos: bootstrap 18.2%–60.0%, cluster-t 10.1%–59.9%) |
| typescript/javascript | All shown (both tiers) | 7 | 20 | 16 | 7 | 0 | 9 | 35.0% [18.1%–56.7%] (7 repos: bootstrap 18.2%–60.0%, cluster-t 10.1%–59.9%) | **35.0% [18.1%–56.7%] (7 repos: bootstrap 18.2%–60.0%, cluster-t 10.1%–59.9%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| python | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 12 | 57 | 49 | 13 | 0 | 36 | 22.8% [13.8%–35.2%] (10 repos: bootstrap 9.8%–38.9%, cluster-t 4.8%–40.8%) | 22.8% [13.8%–35.2%] (10 repos: bootstrap 9.8%–38.9%, cluster-t 4.8%–40.8%) |
| python | All shown (both tiers) | 12 | 57 | 49 | 13 | 0 | 36 | 22.8% [13.8%–35.2%] (10 repos: bootstrap 9.8%–38.9%, cluster-t 4.8%–40.8%) | **22.8% [13.8%–35.2%] (10 repos: bootstrap 9.8%–38.9%, cluster-t 4.8%–40.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 12 | 77 | 65 | 20 | 0 | 45 | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) |
| all languages (pooled, secondary) | All shown (both tiers) | 12 | 77 | 65 | 20 | 0 | 45 | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) | 26.0% [17.5%–36.7%] (12 repos: bootstrap 16.3%–37.2%, cluster-t 13.9%–38.0%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Decorators | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Base classes | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 2 | 1 | 0 | 0 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Naming | Suggestion tier | 3 | 1 | 0 | 0 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 0 | 0 | 5 | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 5 | 4 | 0 | 0 | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 8 | 5 | 0 | 1 | 62.5% [30.6%–86.3%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 62.5% [30.6%–86.3%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Decorators | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Base classes | Suggestion tier | 8 | 1 | 0 | 4 | 12.5% [2.2%–47.1%] (6 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–46.6%) | 12.5% [2.2%–47.1%] (6 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–46.6%) |
| python | Argument keys | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 1 | 0 | 0 | 0 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 16 | 1 | 0 | 15 | 6.3% [1.1%–28.3%] (6 repos: bootstrap 0.0%–20.0%, cluster-t 0.0%–22.3%) | 6.3% [1.1%–28.3%] (6 repos: bootstrap 0.0%–20.0%, cluster-t 0.0%–22.3%) |
| python | Naming | Suggestion tier | 9 | 1 | 0 | 6 | 11.1% [2.0%–43.5%] (6 repos: bootstrap 0.0%–30.0%, cluster-t 0.0%–38.0%) | 11.1% [2.0%–43.5%] (6 repos: bootstrap 0.0%–30.0%, cluster-t 0.0%–38.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 3 | 0 | 0 | 3 | 0.0% [0.0%–56.1%] (3 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–56.1%] (3 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Call order | Suggestion tier | 3 | 0 | 0 | 3 | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) | 0.0% [0.0%–56.1%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 3 | 3 | 0 | 0 | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | django | 5 | 16 | 0 | – | 16 | 31.3% [14.2%–55.6%] (5 repos: bootstrap 9.1%–58.3%, cluster-t 0.0%–64.3%) | 31.3% [14.2%–55.6%] (5 repos: bootstrap 9.1%–58.3%, cluster-t 0.0%–64.3%) |
| typescript/javascript | fastapi | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| python | django | 8 | 32 | 0 | – | 32 | 31.3% [18.0%–48.6%] (6 repos: bootstrap 10.7%–48.6%, cluster-t 3.3%–59.2%) | 31.3% [18.0%–48.6%] (6 repos: bootstrap 10.7%–48.6%, cluster-t 3.3%–59.2%) |
| python | fastapi | 2 | 12 | 0 | – | 12 | 16.7% [4.7%–44.8%] (2 repos: bootstrap 14.3%–20.0%, cluster-t 0.0%–52.0%) | 16.7% [4.7%–44.8%] (2 repos: bootstrap 14.3%–20.0%, cluster-t 0.0%–52.0%) |
| python | flask | 2 | 13 | 0 | – | 13 | 7.7% [1.4%–33.3%] (2 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–100.0%) | 7.7% [1.4%–33.3%] (2 repos: bootstrap 0.0%–33.3%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 11 | 5 | 0 | 4 | 56% [27%–81%] | 56% [27%–81%] | 5 | 0 | – |
| InvenTree | 11 | 2 | 0 | 7 | 22% [6%–55%] | 22% [6%–55%] | 2 | 0 | – |
| ralph | 6 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| Misago | 8 | 2 | 0 | 5 | 29% [8%–64%] | 29% [8%–64%] | 2 | 0 | – |
| paperless-ngx | 3 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| wger | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 0 | – |
| lotus | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 2 | 0 | – |
| pontoon | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| open-wearables | 8 | 2 | 0 | 5 | 29% [8%–64%] | 29% [8%–64%] | 2 | 0 | – |
| tasking-manager | 8 | 2 | 0 | 5 | 29% [8%–64%] | 29% [8%–64%] | 2 | 0 | – |
| simplelogin | 10 | 0 | 0 | 9 | 0% [0%–30%] | 0% [0%–30%] | 0 | 0 | – |
| changedetection.io | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 8 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 0 | – |
| Decorators | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Base classes | 11 | 2 | 0 | 6 | 25% [7%–59%] | 25% [7%–59%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 0 | 0 | 0 | – | – | 0 | – |
| Calls | 18 | 2 | 0 | 15 | 12% [3%–34%] | 12% [3%–34%] | 0 | – |
| Naming | 12 | 2 | 0 | 6 | 25% [7%–59%] | 25% [7%–59%] | 0 | – |
| Other avoidance (any, console, bare Error) | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | – |
| Call order | 8 | 0 | 0 | 8 | 0% [0%–32%] | 0% [0%–32%] | 0 | – |
| Control and typing | 8 | 7 | 0 | 0 | 100% [65%–100%] | 100% [65%–100%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: false_outliers 8, incidental 14, mixed_group 15, legit_outliers 7, misdescribes 1
