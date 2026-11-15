# Precision: eval/study/runs/heldout2-ts-2026-11-08

- drift: drift 0.1.0-dev commit 4e017e38ccc507d282ca31f49029ca48f035ddc1, binary sha256 41edaa85c656
- manifest: eval/holdout-2-2026-11-07.json (HELD-OUT), 18 repos ok
- labels: eval/study/runs/heldout2-ts-2026-11-08/final.jsonl (109 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 109
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided); see README.md decision log
- 2 shown proposals have no structured rule and are suggestion tier: island.is/D-9d506a, better-chatbot/D-ad0dad

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 109 | 109 | 43 | 1 | 65 | 40.4% [31.6%–49.8%] (16 repos: bootstrap 30.6%–50.0%, cluster-t 29.7%–51.1%) | 39.4% [30.8%–48.8%] (16 repos: bootstrap 29.5%–50.0%, cluster-t 28.2%–50.7%) | 2.4 mean, 2 median, 3/18 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 3 | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 0.1 mean, 0 median, 17/18 repos with none |
| Suggestion tier (everything else) | 106 | 106 | 42 | 1 | 63 | 40.6% [31.7%–50.1%] (16 repos: bootstrap 30.4%–51.2%, cluster-t 29.2%–51.9%) | 39.6% [30.8%–49.1%] (16 repos: bootstrap 29.3%–50.9%, cluster-t 27.7%–51.6%) | 2.3 mean, 2 median, 3/18 repos with none |

## Exposure check: all repos vs excluding exposed (0 of 18 repos exposed)

Exposed: none. Rates over all shown, unlabelled counted as WRONG (the target definition); labelled-only rates in brackets.

|  | Repos | Shown | Not-wrong | Accept | Default-tier accept | (labelled: not-wrong / accept) | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All repos | 18 | 109 | 40.4% [31.6%–49.8%] (16 repos: bootstrap 30.6%–50.0%, cluster-t 29.7%–51.1%) | 39.4% [30.8%–48.8%] (16 repos: bootstrap 29.5%–50.0%, cluster-t 28.2%–50.7%) | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 40.4% / 39.4% | 2.4 |
| Excluding exposed | 18 | 109 | 40.4% [31.6%–49.8%] (16 repos: bootstrap 30.6%–50.0%, cluster-t 29.7%–51.1%) | 39.4% [30.8%–48.8%] (16 repos: bootstrap 29.5%–50.0%, cluster-t 28.2%–50.7%) | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 40.4% / 39.4% | 2.4 |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 18 | 3 | 3 | 1 | 0 | 2 | **33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **NOT MET** | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Suggestion tier | 18 | 97 | 97 | 39 | 1 | 57 | 40.2% [31.0%–50.2%] (16 repos: bootstrap 28.9%–51.9%, cluster-t 27.7%–52.8%) | 41.2% [32.0%–51.2%] (16 repos: bootstrap 30.0%–52.2%, cluster-t 29.4%–53.1%) |
| typescript/javascript | All shown (both tiers) | 18 | 100 | 100 | 40 | 1 | 59 | 40.0% [30.9%–49.8%] (16 repos: bootstrap 29.1%–50.6%, cluster-t 28.2%–51.8%) | **41.0% [31.9%–50.8%] (16 repos: bootstrap 30.3%–51.1%, cluster-t 29.9%–52.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **NOT MET** |
| python | Default tier | 3 | 0 | 0 | 0 | 0 | 0 | **–**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 3 | 9 | 9 | 3 | 0 | 6 | 33.3% [12.1%–64.6%] (3 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–81.1%) | 33.3% [12.1%–64.6%] (3 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–81.1%) |
| python | All shown (both tiers) | 3 | 9 | 9 | 3 | 0 | 6 | 33.3% [12.1%–64.6%] (3 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–81.1%) | **33.3% [12.1%–64.6%] (3 repos: bootstrap 20.0%–50.0%, cluster-t 0.0%–81.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not this set's language)** |
| all languages (pooled, secondary) | Default tier | 18 | 3 | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) |
| all languages (pooled, secondary) | Suggestion tier | 18 | 106 | 106 | 42 | 1 | 63 | 39.6% [30.8%–49.1%] (16 repos: bootstrap 29.3%–50.9%, cluster-t 27.7%–51.6%) | 40.6% [31.7%–50.1%] (16 repos: bootstrap 30.4%–51.2%, cluster-t 29.2%–51.9%) |
| all languages (pooled, secondary) | All shown (both tiers) | 18 | 109 | 109 | 43 | 1 | 65 | 39.4% [30.8%–48.8%] (16 repos: bootstrap 29.5%–50.0%, cluster-t 28.2%–50.7%) | 40.4% [31.6%–49.8%] (16 repos: bootstrap 30.6%–50.0%, cluster-t 29.7%–51.1%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Call wrappers | Suggestion tier | 3 | 2 | 0 | 1 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call wrappers | All shown | 4 | 2 | 0 | 2 | 50.0% [15.0%–85.0%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [15.0%–85.0%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Decorators | Suggestion tier | 17 | 10 | 0 | 7 | 58.8% [36.0%–78.4%] (3 repos: bootstrap 0.0%–72.7%, cluster-t 0.0%–100.0%) | 58.8% [36.0%–78.4%] (3 repos: bootstrap 0.0%–72.7%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Base classes | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Argument keys | Suggestion tier | 5 | 0 | 1 | 4 | 0.0% [0.0%–43.4%] (3 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 20.0% [3.6%–62.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Layering (imports avoided) | Default tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) |
| typescript/javascript | Rendered components | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Naming | Suggestion tier | 23 | 10 | 0 | 13 | 43.5% [25.6%–63.2%] (9 repos: bootstrap 17.6%–66.7%, cluster-t 13.0%–74.0%) | 43.5% [25.6%–63.2%] (9 repos: bootstrap 17.6%–66.7%, cluster-t 13.0%–74.0%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 7 | 5 | 0 | 2 | 71.4% [35.9%–91.8%] (5 repos: bootstrap 20.0%–100.0%, cluster-t 12.7%–100.0%) | 71.4% [35.9%–91.8%] (5 repos: bootstrap 20.0%–100.0%, cluster-t 12.7%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 9 | 1 | 0 | 8 | 11.1% [2.0%–43.5%] (3 repos: bootstrap 0.0%–14.3%, cluster-t 0.0%–27.0%) | 11.1% [2.0%–43.5%] (3 repos: bootstrap 0.0%–14.3%, cluster-t 0.0%–27.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 8 | 2 | 0 | 6 | 25.0% [7.1%–59.1%] (5 repos: bootstrap 0.0%–44.4%, cluster-t 0.0%–61.3%) | 25.0% [7.1%–59.1%] (5 repos: bootstrap 0.0%–44.4%, cluster-t 0.0%–61.3%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 22 | 8 | 0 | 14 | 36.4% [19.7%–57.0%] (7 repos: bootstrap 16.0%–58.8%, cluster-t 8.1%–64.7%) | 36.4% [19.7%–57.0%] (7 repos: bootstrap 16.0%–58.8%, cluster-t 8.1%–64.7%) |
| python | Call wrappers | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Decorators | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) |
| python | Base classes | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| python | Calls | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) |
| python | Other avoidance (any, console, bare Error) | Suggestion tier | 1 | 1 | 0 | 0 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | Control and typing | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | nestjs | 5 | 41 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 40 | 55.0% [39.8%–69.3%] (5 repos: bootstrap 44.4%–64.9%, cluster-t 39.0%–71.0%) | 53.7% [38.7%–67.9%] (5 repos: bootstrap 44.4%–62.2%, cluster-t 40.5%–66.8%) |
| typescript/javascript | nextjs | 6 | 39 | 2 | 50.0% [9.5%–90.5%] (1 repo: no cluster interval) | 37 | 32.4% [19.6%–48.5%] (6 repos: bootstrap 18.2%–56.5%, cluster-t 9.4%–55.5%) | 35.9% [22.7%–51.6%] (6 repos: bootstrap 20.9%–56.0%, cluster-t 13.6%–58.1%) |
| typescript/javascript | express_fastify_hono | 4 | 14 | 0 | – | 14 | 28.6% [11.7%–54.6%] (2 repos: bootstrap 25.0%–30.0%, cluster-t 2.6%–54.5%) | 28.6% [11.7%–54.6%] (2 repos: bootstrap 25.0%–30.0%, cluster-t 2.6%–54.5%) |
| typescript/javascript | react_spa | 2 | 4 | 0 | – | 4 | 25.0% [4.6%–69.9%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 25.0% [4.6%–69.9%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | other_node | 1 | 2 | 0 | – | 2 | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) | 0.0% [0.0%–65.8%] (1 repo: no cluster interval) |
| python | react_spa | 2 | 4 | 0 | – | 4 | 50.0% [15.0%–85.0%] (2 repos: bootstrap 50.0%–50.0%, cluster-t 50.0%–50.0%) | 50.0% [15.0%–85.0%] (2 repos: bootstrap 50.0%–50.0%, cluster-t 50.0%–50.0%) |
| python | other_node | 1 | 5 | 0 | – | 5 | 20.0% [3.6%–62.4%] (1 repo: no cluster interval) | 20.0% [3.6%–62.4%] (1 repo: no cluster interval) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ever-demand | 12 | 6 | 0 | 6 | 50% [25%–75%] | 50% [25%–75%] | 6 | 0 | – |
| ngx-bootstrap | 5 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 2 | 0 | – |
| island.is | 13 | 8 | 0 | 5 | 62% [36%–82%] | 62% [36%–82%] | 8 | 1 | 0% [0%–79%] |
| wind-comic | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 4 | 2 | 50% [9%–91%] |
| better-chatbot | 15 | 4 | 1 | 10 | 33% [15%–58%] | 27% [11%–52%] | 4 | 0 | – |
| ui | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | 0 | – |
| mitosis | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 0 | – |
| openwhyd | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| squirrelscan | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| webstudio | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 1 | 0 | – |
| reiverr | 4 | 3 | 0 | 1 | 75% [30%–95%] | 75% [30%–95%] | 3 | 0 | – |
| agentrove | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 2 | 0 | – |
| clickhouse-etl | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 1 | 0 | – |
| responsible-ai-toolbox | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 1 | 0 | – |
| ownpilot | 10 | 3 | 0 | 7 | 30% [11%–60%] | 30% [11%–60%] | 3 | 0 | – |
| workflow | 7 | 3 | 0 | 4 | 43% [16%–75%] | 43% [16%–75%] | 3 | 0 | – |
| planarally | 7 | 1 | 0 | 6 | 14% [3%–51%] | 14% [3%–51%] | 1 | 0 | – |
| onecli | 7 | 1 | 0 | 6 | 14% [3%–51%] | 14% [3%–51%] | 1 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 1 | 0% [0%–79%] |
| Decorators | 19 | 10 | 0 | 9 | 53% [32%–73%] | 53% [32%–73%] | 0 | – |
| Base classes | 4 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 0 | – |
| Argument keys | 5 | 0 | 1 | 4 | 0% [0%–43%] | 20% [4%–62%] | 0 | – |
| Layering (imports avoided) | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Rendered components | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Calls | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Naming | 23 | 10 | 0 | 13 | 43% [26%–63%] | 43% [26%–63%] | 0 | – |
| Other avoidance (any, console, bare Error) | 8 | 6 | 0 | 2 | 75% [41%–93%] | 75% [41%–93%] | 0 | – |
| Call order | 9 | 1 | 0 | 8 | 11% [2%–43%] | 11% [2%–43%] | 0 | – |
| Control and typing | 9 | 2 | 0 | 7 | 22% [6%–55%] | 22% [6%–55%] | 0 | – |
| Package and repo facts | 22 | 8 | 0 | 14 | 36% [20%–57%] | 36% [20%–57%] | 0 | – |

## Why not accepted

- TRIVIAL by: types 1
- WRONG because: mixed_group 26, legit_outliers 19, false_outliers 5, incidental 15
