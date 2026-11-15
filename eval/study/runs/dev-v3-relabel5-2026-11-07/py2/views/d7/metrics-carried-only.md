# Precision: eval/study/runs/dev-v3-relabel5-2026-11-07/py2/views/d7

> **Computed on INCOMPLETE A/B label sets** (`--allow-incomplete`: carried labels only, before the relabel is labelled: the cards to label count as WRONG). Not labelled: A Django-CRM (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); A InvenTree (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 6 labelled (prompt rendered, output not collected); A ralph (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 4 labelled (prompt rendered, output not collected); A Misago (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 4 labelled (prompt rendered, output not collected); A paperless-ngx (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 3 labelled (prompt rendered, output not collected); A wger (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); A lotus (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); A pontoon (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); A tasking-manager (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 2 labelled (prompt rendered, output not collected); A changedetection.io (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); B Django-CRM (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered); B InvenTree (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 6 labelled (no prompt rendered); B ralph (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 4 labelled (no prompt rendered); B Misago (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 4 labelled (no prompt rendered); B paperless-ngx (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 3 labelled (no prompt rendered); B wger (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered); B lotus (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered); B pontoon (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered); B tasking-manager (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 2 labelled (no prompt rendered); B changedetection.io (eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered).

- drift: drift 0.1.0-dev commit de57356738f26849eba160b797d271e59652b5ec, binary sha256 0d4ec8f54c10
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-relabel5-2026-11-07/py2/carried.jsonl (36 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 36
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 60 | 36 | 17 | 0 | 19 | 47.2% [32.0%–63.0%] (11 repos: bootstrap 37.1%–58.3%, cluster-t 34.7%–59.8%) | 47.2% [32.0%–63.0%] (11 repos: bootstrap 37.1%–58.3%, cluster-t 34.7%–59.8%) | 2.0 mean, 2 median, 0/2 repos with none (10 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 12/12 repos with none |
| Suggestion tier (everything else) | 60 | 36 | 17 | 0 | 19 | 47.2% [32.0%–63.0%] (11 repos: bootstrap 37.1%–58.3%, cluster-t 34.7%–59.8%) | 47.2% [32.0%–63.0%] (11 repos: bootstrap 37.1%–58.3%, cluster-t 34.7%–59.8%) | 2.0 mean, 2 median, 0/2 repos with none (10 partly labelled repos excluded) |

**24 shown proposals have no label** (excluded above). Over all 60 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) |
| Default tier, unlabelled = WRONG | – | – |
| Suggestion tier, unlabelled = WRONG | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 68.3% | 68.3% |

Unlabelled: Django-CRM/D-39c60a, InvenTree/D-7c0991, InvenTree/D-c2b101, InvenTree/D-90cbee, InvenTree/D-100344, InvenTree/D-455913, InvenTree/D-b5f2f2, ralph/D-40c349, ralph/D-03c0d5, ralph/D-c2b101, ralph/D-a68e99, Misago/D-d8703c, Misago/D-c9ae1e, Misago/D-e72fc8, Misago/D-562769, paperless-ngx/D-de2489, paperless-ngx/D-b958b1, paperless-ngx/D-0dfb1b, wger/D-f93026, lotus/D-7d8745, pontoon/D-6957a9, tasking-manager/D-ee4d58, tasking-manager/D-665f41, changedetection.io/D-129993

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Incomplete label sets (--allow-incomplete): no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 7 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 7 | 18 | 15 | 5 | 0 | 10 | 27.8% [12.5%–50.9%] (7 repos: bootstrap 14.3%–41.2%, cluster-t 12.8%–42.8%) | 27.8% [12.5%–50.9%] (7 repos: bootstrap 14.3%–41.2%, cluster-t 12.8%–42.8%) |
| typescript/javascript | All shown (both tiers) | 7 | 18 | 15 | 5 | 0 | 10 | 27.8% [12.5%–50.9%] (7 repos: bootstrap 14.3%–41.2%, cluster-t 12.8%–42.8%) | **27.8% [12.5%–50.9%] (7 repos: bootstrap 14.3%–41.2%, cluster-t 12.8%–42.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** |
| python | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 12 | 42 | 21 | 12 | 0 | 9 | 28.6% [17.2%–43.6%] (11 repos: bootstrap 15.8%–42.5%, cluster-t 12.9%–44.3%) | 28.6% [17.2%–43.6%] (11 repos: bootstrap 15.8%–42.5%, cluster-t 12.9%–44.3%) |
| python | All shown (both tiers) | 12 | 42 | 21 | 12 | 0 | 9 | 28.6% [17.2%–43.6%] (11 repos: bootstrap 15.8%–42.5%, cluster-t 12.9%–44.3%) | **28.6% [17.2%–43.6%] (11 repos: bootstrap 15.8%–42.5%, cluster-t 12.9%–44.3%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** |
| all languages (pooled, secondary) | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 12 | 60 | 36 | 17 | 0 | 19 | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) |
| all languages (pooled, secondary) | All shown (both tiers) | 12 | 60 | 36 | 17 | 0 | 19 | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) | 28.3% [18.5%–40.8%] (12 repos: bootstrap 20.3%–38.9%, cluster-t 17.8%–38.9%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Decorators | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Base classes | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Naming | Suggestion tier | 3 | 1 | 0 | 0 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 0 | 0 | 5 | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 4 | 2 | 0 | 1 | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 6 | 3 | 0 | 1 | 50.0% [18.8%–81.2%] (3 repos: bootstrap 0.0%–66.7%, cluster-t 0.0%–100.0%) | 50.0% [18.8%–81.2%] (3 repos: bootstrap 0.0%–66.7%, cluster-t 0.0%–100.0%) |
| python | Decorators | Suggestion tier | 4 | 1 | 0 | 2 | 25.0% [4.6%–69.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) | 25.0% [4.6%–69.9%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–100.0%) |
| python | Base classes | Suggestion tier | 7 | 1 | 0 | 1 | 14.3% [2.6%–51.3%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–57.2%) | 14.3% [2.6%–51.3%] (5 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–57.2%) |
| python | Argument keys | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 8 | 2 | 0 | 2 | 25.0% [7.1%–59.1%] (6 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–55.5%) | 25.0% [7.1%–59.1%] (6 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–55.5%) |
| python | Naming | Suggestion tier | 9 | 0 | 0 | 0 | 0.0% [0.0%–29.9%] (7 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–29.9%] (7 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 3 | 3 | 0 | 0 | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | django | 5 | 14 | 0 | – | 14 | 21.4% [7.6%–47.6%] (5 repos: bootstrap 0.0%–28.6%, cluster-t 3.5%–39.3%) | 21.4% [7.6%–47.6%] (5 repos: bootstrap 0.0%–28.6%, cluster-t 3.5%–39.3%) |
| typescript/javascript | fastapi | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| python | django | 8 | 28 | 0 | – | 28 | 25.0% [12.7%–43.4%] (7 repos: bootstrap 7.7%–45.5%, cluster-t 0.5%–49.5%) | 25.0% [12.7%–43.4%] (7 repos: bootstrap 7.7%–45.5%, cluster-t 0.5%–49.5%) |
| python | fastapi | 2 | 9 | 0 | – | 9 | 33.3% [12.1%–64.6%] (2 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–100.0%) | 33.3% [12.1%–64.6%] (2 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–100.0%) |
| python | flask | 2 | 5 | 0 | – | 5 | 40.0% [11.8%–76.9%] (2 repos: bootstrap 33.3%–50.0%, cluster-t 0.0%–100.0%) | 40.0% [11.8%–76.9%] (2 repos: bootstrap 33.3%–50.0%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 6 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 3 | 0 | – |
| InvenTree | 12 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 0 | – |
| ralph | 5 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| Misago | 7 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |
| paperless-ngx | 5 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| wger | 3 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | 0 | – |
| lotus | 3 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| pontoon | 1 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| open-wearables | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 3 | 0 | – |
| tasking-manager | 8 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 0 | – |
| simplelogin | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| changedetection.io | 3 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 6 | 3 | 0 | 1 | 75% [30%–95%] | 75% [30%–95%] | 0 | – |
| Decorators | 5 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Base classes | 10 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 9 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 0 | – |
| Naming | 12 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Call order | 5 | 0 | 0 | 5 | 0% [0%–43%] | 0% [0%–43%] | 0 | – |
| Control and typing | 7 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: incidental 6, false_outliers 4, mixed_group 5, legit_outliers 3, misdescribes 1
