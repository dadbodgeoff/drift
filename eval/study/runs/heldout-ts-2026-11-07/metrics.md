# Precision: eval/study/runs/heldout-ts-2026-11-07

- drift: drift 0.1.0-dev commit ab1a8f348039310fcf908f65b99cb6d90cc1f5e3, binary sha256 e199f1cfd067
- manifest: eval/holdout-primary.json (HELD-OUT), 18 repos ok
- labels: eval/study/runs/heldout-ts-2026-11-07/final.jsonl (57 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 57
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 57 | 57 | 22 | 1 | 34 | 40.4% [28.6%–53.3%] (15 repos: bootstrap 26.7%–54.1%, cluster-t 24.9%–55.8%) | 38.6% [27.1%–51.6%] (15 repos: bootstrap 24.4%–52.2%, cluster-t 22.8%–54.4%) | 1.2 mean, 1 median, 8/18 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 7 | 7 | 5 | 0 | 2 | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 0.3 mean, 0 median, 14/18 repos with none |
| Suggestion tier (everything else) | 50 | 50 | 17 | 1 | 32 | 36.0% [24.1%–49.9%] (14 repos: bootstrap 20.5%–48.3%, cluster-t 20.3%–51.7%) | 34.0% [22.4%–47.8%] (14 repos: bootstrap 17.5%–46.5%, cluster-t 17.7%–50.3%) | 0.9 mean, 0 median, 11/18 repos with none |

## Exposure check: all repos vs excluding exposed (0 of 18 repos exposed)

Exposed: none. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.

|  | Repos | Shown | Not-wrong | Accept | Default-tier accept | (labelled: not-wrong / accept) | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All repos | 18 | 57 | 40.4% [28.6%–53.3%] (15 repos: bootstrap 26.7%–54.1%, cluster-t 24.9%–55.8%) | 38.6% [27.1%–51.6%] (15 repos: bootstrap 24.4%–52.2%, cluster-t 22.8%–54.4%) | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 40.4% / 38.6% | 1.2 |
| Excluding exposed | 18 | 57 | 40.4% [28.6%–53.3%] (15 repos: bootstrap 26.7%–54.1%, cluster-t 24.9%–55.8%) | 38.6% [27.1%–51.6%] (15 repos: bootstrap 24.4%–52.2%, cluster-t 22.8%–54.4%) | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 40.4% / 38.6% | 1.2 |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 18 | 7 | 7 | 5 | 0 | 2 | **71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **NOT MET** | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) |
| typescript/javascript | Suggestion tier | 18 | 50 | 50 | 17 | 1 | 32 | 34.0% [22.4%–47.8%] (14 repos: bootstrap 17.5%–46.5%, cluster-t 17.7%–50.3%) | 36.0% [24.1%–49.9%] (14 repos: bootstrap 20.5%–48.3%, cluster-t 20.3%–51.7%) |
| typescript/javascript | All shown (both tiers) | 18 | 57 | 57 | 22 | 1 | 34 | 38.6% [27.1%–51.6%] (15 repos: bootstrap 24.4%–52.2%, cluster-t 22.8%–54.4%) | **40.4% [28.6%–53.3%] (15 repos: bootstrap 26.7%–54.1%, cluster-t 24.9%–55.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **NOT MET** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call wrappers | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | Call wrappers | All shown | 4 | 2 | 0 | 2 | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Decorators | Suggestion tier | 4 | 1 | 0 | 3 | 25.0% [4.6%–69.9%] (1 repo: no cluster interval) | 25.0% [4.6%–69.9%] (1 repo: no cluster interval) |
| typescript/javascript | Argument keys | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Layering (imports avoided) | Default tier | 4 | 4 | 0 | 0 | 100.0% [51.0%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [51.0%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Rendered components | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) |
| typescript/javascript | Naming | Suggestion tier | 15 | 6 | 0 | 9 | 40.0% [19.8%–64.3%] (8 repos: bootstrap 12.5%–60.0%, cluster-t 10.2%–69.8%) | 40.0% [19.8%–64.3%] (8 repos: bootstrap 12.5%–60.0%, cluster-t 10.2%–69.8%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 6 | 1 | 0 | 5 | 16.7% [3.0%–56.4%] (5 repos: bootstrap 0.0%–37.5%, cluster-t 0.0%–55.2%) | 16.7% [3.0%–56.4%] (5 repos: bootstrap 0.0%–37.5%, cluster-t 0.0%–55.2%) |
| typescript/javascript | Call order | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 5 | 3 | 0 | 2 | 60.0% [23.1%–88.2%] (4 repos: bootstrap 25.0%–100.0%, cluster-t 0.0%–100.0%) | 60.0% [23.1%–88.2%] (4 repos: bootstrap 25.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 11 | 3 | 1 | 7 | 27.3% [9.7%–56.6%] (5 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–86.0%) | 36.4% [15.2%–64.6%] (5 repos: bootstrap 7.1%–87.5%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Other | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Sensitivity: without computer-science-fundamentals (decision D2)

Course-material repos stay in, as pre-registered: the with-them rows are the result, the without-them rows a sensitivity check. Over all shown, unlabelled counted as WRONG.

| Language | Repos |  | Shown | Default n | Default-tier accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | 18 | with them (result) | 57 | 7 | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 40.4% [28.6%–53.3%] (15 repos: bootstrap 26.7%–54.1%, cluster-t 24.9%–55.8%) |
| typescript/javascript | 17 | without computer-science-fundamentals | 55 | 7 | 71.4% [35.9%–91.8%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 20.7%–100.0%) | 40.0% [28.1%–53.2%] (14 repos: bootstrap 25.4%–54.3%, cluster-t 23.8%–56.2%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | nestjs | 5 | 13 | 0 | – | 13 | 46.2% [23.2%–70.9%] (3 repos: bootstrap 0.0%–54.5%, cluster-t 0.3%–92.0%) | 46.2% [23.2%–70.9%] (3 repos: bootstrap 0.0%–54.5%, cluster-t 0.3%–92.0%) |
| typescript/javascript | nextjs | 6 | 27 | 3 | 33.3% [6.1%–79.2%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 24 | 29.2% [14.9%–49.2%] (6 repos: bootstrap 9.5%–52.6%, cluster-t 1.3%–57.0%) | 29.6% [15.9%–48.5%] (6 repos: bootstrap 9.4%–55.0%, cluster-t 0.0%–59.4%) |
| typescript/javascript | express_fastify_hono | 4 | 12 | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 11 | 36.4% [15.2%–64.6%] (3 repos: bootstrap 0.0%–66.7%, cluster-t 0.0%–92.8%) | 50.0% [25.4%–74.6%] (4 repos: bootstrap 36.8%–80.0%, cluster-t 12.5%–87.5%) |
| typescript/javascript | react_spa | 3 | 5 | 3 | 100.0% [43.9%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 60.0% [23.1%–88.2%] (2 repos: bootstrap 50.0%–66.7%, cluster-t 0.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| thunderhub | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| fedify | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| hedgedoc | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| mercur | 9 | 3 | 0 | 6 | 33% [12%–65%] | 33% [12%–65%] | 3 | 1 | 0% [0%–79%] |
| genkit | 7 | 0 | 0 | 7 | 0% [0%–35%] | 0% [0%–35%] | 0 | 1 | 0% [0%–79%] |
| taxhacker | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| computer-science-fundamentals | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| memcode | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| zyfun | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |
| tududi | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 0 | – |
| cursorless | 2 | 0 | 1 | 1 | 50% [9%–91%] | 0% [0%–66%] | 0 | 0 | – |
| backend | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| kan | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 3 | 1 | 100% [21%–100%] |
| ipfs-webui | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 2 | 100% [34%–100%] |
| restty | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| e2e | 3 | 0 | 0 | 3 | 0% [0%–56%] | 0% [0%–56%] | 0 | 0 | – |
| glyph | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 1 | 100% [21%–100%] |
| dyrectorio | 11 | 6 | 0 | 5 | 55% [28%–79%] | 55% [28%–79%] | 6 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 4 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 3 | 33% [6%–79%] |
| Decorators | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Argument keys | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 0 | – |
| Layering (imports avoided) | 4 | 4 | 0 | 0 | 100% [51%–100%] | 100% [51%–100%] | 4 | 100% [51%–100%] |
| Rendered components | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Naming | 15 | 6 | 0 | 9 | 40% [20%–64%] | 40% [20%–64%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 1 | 0 | 5 | 17% [3%–56%] | 17% [3%–56%] | 0 | – |
| Call order | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Control and typing | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 0 | – |
| Package and repo facts | 11 | 3 | 1 | 7 | 27% [10%–57%] | 36% [15%–65%] | 0 | – |
| Other | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |

## Why not accepted

- TRIVIAL by: lint 1
- WRONG because: mixed_group 15, false_outliers 2, misdescribes 2, legit_outliers 8, incidental 7
