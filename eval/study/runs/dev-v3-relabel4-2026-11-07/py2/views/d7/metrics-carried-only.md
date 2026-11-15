# Precision: eval/study/runs/dev-v3-relabel4-2026-11-07/py2/views/d7

> **Computed on INCOMPLETE A/B label sets** (`--allow-incomplete`: carried labels only, before the relabel is labelled: the cards to label count as WRONG). Not labelled: A InvenTree (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 2 labelled (prompt rendered, output not collected); A ralph (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 4 labelled (prompt rendered, output not collected); A Misago (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 4 labelled (prompt rendered, output not collected); A wger (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); A lotus (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 2 labelled (prompt rendered, output not collected); A open-wearables (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 1 labelled (prompt rendered, output not collected); B InvenTree (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 2 labelled (no prompt rendered); B ralph (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 4 labelled (no prompt rendered); B Misago (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 4 labelled (no prompt rendered); B wger (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered); B lotus (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 2 labelled (no prompt rendered); B open-wearables (eval/study/runs/dev-v3-relabel4-2026-11-07/py2/relabel): 0 of 1 labelled (no prompt rendered).

- drift: drift 0.1.0-dev commit 2c81ba491d09f33dfcd209676572508e98923c4c, binary sha256 5d0cd386c9e7
- manifest: eval/repos-py-2.json, 12 repos ok
- labels: eval/study/runs/dev-v3-relabel4-2026-11-07/py2/carried.jsonl (47 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 47
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 61 | 47 | 21 | 1 | 25 | 46.8% [33.3%–60.8%] (12 repos: bootstrap 36.2%–61.0%, cluster-t 32.9%–60.7%) | 44.7% [31.4%–58.8%] (12 repos: bootstrap 32.2%–60.5%, cluster-t 28.5%–60.9%) | 2.2 mean, 1.5 median, 0/6 repos with none (6 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 12/12 repos with none |
| Suggestion tier (everything else) | 61 | 47 | 21 | 1 | 25 | 46.8% [33.3%–60.8%] (12 repos: bootstrap 36.2%–61.0%, cluster-t 32.9%–60.7%) | 44.7% [31.4%–58.8%] (12 repos: bootstrap 32.2%–60.5%, cluster-t 28.5%–60.9%) | 2.2 mean, 1.5 median, 0/6 repos with none (6 partly labelled repos excluded) |

**14 shown proposals have no label** (excluded above). Over all 61 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 36.1% [25.2%–48.6%] (12 repos: bootstrap 26.8%–49.1%, cluster-t 23.5%–48.6%) | 34.4% [23.7%–47.0%] (12 repos: bootstrap 24.2%–49.0%, cluster-t 20.5%–48.4%) |
| Default tier, unlabelled = WRONG | – | – |
| Suggestion tier, unlabelled = WRONG | 36.1% [25.2%–48.6%] (12 repos: bootstrap 26.8%–49.1%, cluster-t 23.5%–48.6%) | 34.4% [23.7%–47.0%] (12 repos: bootstrap 24.2%–49.0%, cluster-t 20.5%–48.4%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 59.0% | 57.4% |

Unlabelled: InvenTree/D-6f225b, InvenTree/D-f31910, ralph/D-4529f9, ralph/D-5b6f70, ralph/D-b1df5c, ralph/D-43f01e, Misago/D-c9ae1e, Misago/D-e72fc8, Misago/D-b4e5ff, Misago/D-d8703c, wger/D-db04dc, lotus/D-26d6a0, lotus/D-1cbdac, open-wearables/D-6606a8

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Incomplete label sets (--allow-incomplete): no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 7 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 7 | 19 | 19 | 7 | 0 | 12 | 36.8% [19.1%–59.0%] (7 repos: bootstrap 21.1%–61.5%, cluster-t 12.6%–61.1%) | 36.8% [19.1%–59.0%] (7 repos: bootstrap 21.1%–61.5%, cluster-t 12.6%–61.1%) |
| typescript/javascript | All shown (both tiers) | 7 | 19 | 19 | 7 | 0 | 12 | 36.8% [19.1%–59.0%] (7 repos: bootstrap 21.1%–61.5%, cluster-t 12.6%–61.1%) | **36.8% [19.1%–59.0%] (7 repos: bootstrap 21.1%–61.5%, cluster-t 12.6%–61.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** |
| python | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 12 | 42 | 28 | 14 | 1 | 13 | 33.3% [21.0%–48.4%] (10 repos: bootstrap 17.5%–53.7%, cluster-t 11.3%–55.4%) | 35.7% [23.0%–50.8%] (10 repos: bootstrap 22.0%–55.0%, cluster-t 15.1%–56.4%) |
| python | All shown (both tiers) | 12 | 42 | 28 | 14 | 1 | 13 | 33.3% [21.0%–48.4%] (10 repos: bootstrap 17.5%–53.7%, cluster-t 11.3%–55.4%) | **35.7% [23.0%–50.8%] (10 repos: bootstrap 22.0%–55.0%, cluster-t 15.1%–56.4%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** |
| all languages (pooled, secondary) | Default tier | 12 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 12 | 61 | 47 | 21 | 1 | 25 | 34.4% [23.7%–47.0%] (12 repos: bootstrap 24.2%–49.0%, cluster-t 20.5%–48.4%) | 36.1% [25.2%–48.6%] (12 repos: bootstrap 26.8%–49.1%, cluster-t 23.5%–48.6%) |
| all languages (pooled, secondary) | All shown (both tiers) | 12 | 61 | 47 | 21 | 1 | 25 | 34.4% [23.7%–47.0%] (12 repos: bootstrap 24.2%–49.0%, cluster-t 20.5%–48.4%) | 36.1% [25.2%–48.6%] (12 repos: bootstrap 26.8%–49.1%, cluster-t 23.5%–48.6%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Decorators | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Base classes | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Naming | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 0 | 0 | 5 | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 5 | 4 | 0 | 1 | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Call wrappers | Suggestion tier | 8 | 6 | 0 | 2 | 75.0% [40.9%–92.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 75.0% [40.9%–92.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Decorators | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Base classes | Suggestion tier | 8 | 1 | 1 | 2 | 12.5% [2.2%–47.1%] (6 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–46.6%) | 25.0% [7.1%–59.1%] (6 repos: bootstrap 0.0%–66.7%, cluster-t 0.0%–71.6%) |
| python | Argument keys | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| python | Layering (imports avoided) | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Calls | Suggestion tier | 6 | 1 | 0 | 2 | 16.7% [3.0%–56.4%] (4 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–64.5%) | 16.7% [3.0%–56.4%] (4 repos: bootstrap 0.0%–42.9%, cluster-t 0.0%–64.5%) |
| python | Naming | Suggestion tier | 9 | 0 | 0 | 2 | 0.0% [0.0%–29.9%] (6 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–29.9%] (6 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 3 | 3 | 0 | 0 | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Package and repo facts | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | django | 5 | 15 | 0 | – | 15 | 33.3% [15.2%–58.3%] (5 repos: bootstrap 11.1%–63.6%, cluster-t 1.0%–65.7%) | 33.3% [15.2%–58.3%] (5 repos: bootstrap 11.1%–63.6%, cluster-t 1.0%–65.7%) |
| typescript/javascript | fastapi | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 33.3%–100.0%, cluster-t 0.0%–100.0%) |
| python | django | 8 | 27 | 0 | – | 27 | 33.3% [18.6%–52.2%] (6 repos: bootstrap 8.7%–62.1%, cluster-t 0.0%–73.0%) | 37.0% [21.5%–55.8%] (6 repos: bootstrap 16.0%–64.3%, cluster-t 0.3%–73.7%) |
| python | fastapi | 2 | 10 | 0 | – | 10 | 30.0% [10.8%–60.3%] (2 repos: bootstrap 20.0%–40.0%, cluster-t 0.0%–100.0%) | 30.0% [10.8%–60.3%] (2 repos: bootstrap 20.0%–40.0%, cluster-t 0.0%–100.0%) |
| python | flask | 2 | 5 | 0 | – | 5 | 40.0% [11.8%–76.9%] (2 repos: bootstrap 33.3%–50.0%, cluster-t 0.0%–100.0%) | 40.0% [11.8%–76.9%] (2 repos: bootstrap 33.3%–50.0%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Django-CRM | 7 | 5 | 0 | 2 | 71% [36%–92%] | 71% [36%–92%] | 5 | 0 | – |
| InvenTree | 11 | 2 | 1 | 6 | 33% [12%–65%] | 22% [6%–55%] | 2 | 0 | – |
| ralph | 5 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| Misago | 7 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |
| paperless-ngx | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| wger | 3 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | 0 | – |
| lotus | 4 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| pontoon | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| open-wearables | 6 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 2 | 0 | – |
| tasking-manager | 8 | 3 | 0 | 5 | 38% [14%–69%] | 38% [14%–69%] | 3 | 0 | – |
| simplelogin | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 1 | 0 | – |
| changedetection.io | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 8 | 6 | 0 | 2 | 75% [41%–93%] | 75% [41%–93%] | 0 | – |
| Decorators | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Base classes | 11 | 2 | 1 | 4 | 29% [8%–64%] | 43% [16%–75%] | 0 | – |
| Argument keys | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Layering (imports avoided) | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 7 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 0 | – |
| Naming | 12 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 0 | – |
| Other avoidance (any, console, bare Error) | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Call order | 5 | 0 | 0 | 5 | 0% [0%–43%] | 0% [0%–43%] | 0 | – |
| Control and typing | 8 | 7 | 0 | 1 | 88% [53%–98%] | 88% [53%–98%] | 0 | – |
| Package and repo facts | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: false_outliers 4, incidental 7, mixed_group 10, legit_outliers 3, misdescribes 1
