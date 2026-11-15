# Precision: eval/study/runs/dev-v3-relabel5-2026-11-07/ts/views/d7

- drift: drift 0.1.0-dev commit de57356738f26849eba160b797d271e59652b5ec, binary sha256 0d4ec8f54c10
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-relabel5-2026-11-07/ts/final.jsonl (147 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 147
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided); see README.md decision log
- 1 shown proposals have no structured rule and are suggestion tier: documenso/D-a10f62

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 147 | 147 | 94 | 5 | 48 | 67.3% [59.4%–74.4%] (13 repos: bootstrap 55.8%–77.8%, cluster-t 54.5%–80.2%) | 63.9% [55.9%–71.3%] (13 repos: bootstrap 50.7%–76.4%, cluster-t 48.8%–79.0%) | 5.9 mean, 6 median, 3/16 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 30 | 30 | 30 | 0 | 0 | 100.0% [88.6%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [88.6%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 1.9 mean, 0.5 median, 8/16 repos with none |
| Suggestion tier (everything else) | 117 | 117 | 64 | 5 | 48 | 59.0% [49.9%–67.5%] (13 repos: bootstrap 44.1%–72.3%, cluster-t 42.8%–75.1%) | 54.7% [45.7%–63.4%] (13 repos: bootstrap 38.2%–70.2%, cluster-t 36.1%–73.3%) | 4.0 mean, 2.5 median, 3/16 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 13 | 30 | 30 | 30 | 0 | 0 | **100.0% [88.6%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 100.0% [88.6%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Suggestion tier | 13 | 117 | 117 | 64 | 5 | 48 | 54.7% [45.7%–63.4%] (13 repos: bootstrap 38.2%–70.2%, cluster-t 36.1%–73.3%) | 59.0% [49.9%–67.5%] (13 repos: bootstrap 44.1%–72.3%, cluster-t 42.8%–75.1%) |
| typescript/javascript | All shown (both tiers) | 13 | 147 | 147 | 94 | 5 | 48 | 63.9% [55.9%–71.3%] (13 repos: bootstrap 50.7%–76.4%, cluster-t 48.8%–79.0%) | **67.3% [59.4%–74.4%] (13 repos: bootstrap 55.8%–77.8%, cluster-t 54.5%–80.2%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 20 | 20 | 0 | 0 | 100.0% [83.9%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [83.9%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Call wrappers | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Call wrappers | All shown | 21 | 20 | 0 | 1 | 95.2% [77.3%–99.2%] (8 repos: bootstrap 81.8%–100.0%, cluster-t 83.3%–100.0%) | 95.2% [77.3%–99.2%] (8 repos: bootstrap 81.8%–100.0%, cluster-t 83.3%–100.0%) |
| typescript/javascript | Decorators | Suggestion tier | 15 | 6 | 1 | 8 | 40.0% [19.8%–64.3%] (4 repos: bootstrap 14.3%–75.0%, cluster-t 0.0%–89.5%) | 46.7% [24.8%–69.9%] (4 repos: bootstrap 31.6%–75.0%, cluster-t 12.3%–81.0%) |
| typescript/javascript | Base classes | Suggestion tier | 15 | 10 | 2 | 3 | 66.7% [41.7%–84.8%] (6 repos: bootstrap 50.0%–90.0%, cluster-t 36.0%–97.3%) | 80.0% [54.8%–93.0%] (6 repos: bootstrap 69.2%–90.0%, cluster-t 67.0%–93.0%) |
| typescript/javascript | Argument keys | Suggestion tier | 12 | 6 | 2 | 4 | 50.0% [25.4%–74.6%] (6 repos: bootstrap 16.7%–90.0%, cluster-t 0.0%–100.0%) | 66.7% [39.1%–86.2%] (6 repos: bootstrap 33.3%–100.0%, cluster-t 14.8%–100.0%) |
| typescript/javascript | Layering (imports avoided) | Default tier | 10 | 10 | 0 | 0 | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Rendered components | Suggestion tier | 10 | 4 | 0 | 6 | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) |
| typescript/javascript | Rendered inside a wrapper | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Naming | Suggestion tier | 34 | 22 | 0 | 12 | 64.7% [47.9%–78.5%] (11 repos: bootstrap 38.2%–84.8%, cluster-t 37.1%–92.3%) | 64.7% [47.9%–78.5%] (11 repos: bootstrap 38.2%–84.8%, cluster-t 37.1%–92.3%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 1 | 0 | 4 | 20.0% [3.6%–62.4%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–88.9%) | 20.0% [3.6%–62.4%] (4 repos: bootstrap 0.0%–75.0%, cluster-t 0.0%–88.9%) |
| typescript/javascript | Control and typing | Suggestion tier | 6 | 5 | 0 | 1 | 83.3% [43.6%–97.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 83.3% [43.6%–97.0%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 13 | 7 | 0 | 6 | 53.8% [29.1%–76.8%] (5 repos: bootstrap 20.0%–76.9%, cluster-t 12.2%–95.5%) | 53.8% [29.1%–76.8%] (5 repos: bootstrap 20.0%–76.9%, cluster-t 12.2%–95.5%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 5 | 100% [57%–100%] |
| twenty | 13 | 6 | 2 | 5 | 62% [36%–82%] | 46% [23%–71%] | 6 | 0 | – |
| formbricks | 11 | 4 | 0 | 7 | 36% [15%–65%] | 36% [15%–65%] | 4 | 2 | 100% [34%–100%] |
| cal.com | 15 | 12 | 0 | 3 | 80% [55%–93%] | 80% [55%–93%] | 12 | 6 | 100% [61%–100%] |
| documenso | 15 | 13 | 0 | 2 | 87% [62%–96%] | 87% [62%–96%] | 13 | 9 | 100% [70%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 8 | 6 | 0 | 2 | 75% [41%–93%] | 75% [41%–93%] | 6 | 1 | 100% [21%–100%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| supabase | 15 | 13 | 0 | 2 | 87% [62%–96%] | 87% [62%–96%] | 13 | 1 | 100% [21%–100%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 14 | 12 | 0 | 2 | 86% [60%–96%] | 86% [60%–96%] | 12 | 0 | – |
| immich | 10 | 1 | 1 | 8 | 20% [6%–51%] | 10% [2%–40%] | 1 | 0 | – |
| midday | 14 | 10 | 0 | 4 | 71% [45%–88%] | 71% [45%–88%] | 10 | 2 | 100% [34%–100%] |
| infisical | 14 | 6 | 2 | 6 | 57% [33%–79%] | 43% [21%–67%] | 6 | 4 | 100% [51%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 21 | 20 | 0 | 1 | 95% [77%–99%] | 95% [77%–99%] | 20 | 100% [84%–100%] |
| Decorators | 15 | 6 | 1 | 8 | 40% [20%–64%] | 47% [25%–70%] | 0 | – |
| Base classes | 15 | 10 | 2 | 3 | 67% [42%–85%] | 80% [55%–93%] | 0 | – |
| Argument keys | 12 | 6 | 2 | 4 | 50% [25%–75%] | 67% [39%–86%] | 0 | – |
| Layering (imports avoided) | 10 | 10 | 0 | 0 | 100% [72%–100%] | 100% [72%–100%] | 10 | 100% [72%–100%] |
| Rendered components | 10 | 4 | 0 | 6 | 40% [17%–69%] | 40% [17%–69%] | 0 | – |
| Rendered inside a wrapper | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Calls | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Naming | 34 | 22 | 0 | 12 | 65% [48%–79%] | 65% [48%–79%] | 0 | – |
| Other avoidance (any, console, bare Error) | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Call order | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 0 | – |
| Control and typing | 6 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 0 | – |
| Package and repo facts | 13 | 7 | 0 | 6 | 54% [29%–77%] | 54% [29%–77%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 3, types 2
- WRONG because: legit_outliers 24, mixed_group 17, misdescribes 1, incidental 6
