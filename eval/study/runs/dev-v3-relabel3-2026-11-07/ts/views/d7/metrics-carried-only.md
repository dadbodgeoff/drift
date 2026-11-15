# Precision: eval/study/runs/dev-v3-relabel3-2026-11-07/ts/views/d7

- drift: drift 0.1.0-dev commit 7d63aa31e2d213ca8ddcd28ae9eee0c5e610da46, binary sha256 a7456324d3ff
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-relabel3-2026-11-07/ts/carried.jsonl (138 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 138
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 158 | 138 | 75 | 2 | 61 | 55.8% [47.5%–63.8%] (13 repos: bootstrap 44.6%–67.5%, cluster-t 42.4%–69.2%) | 54.3% [46.0%–62.4%] (13 repos: bootstrap 41.5%–67.2%, cluster-t 39.5%–69.2%) | 2.9 mean, 1.5 median, 3/8 repos with none (8 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 29 | 26 | 26 | 0 | 0 | 100.0% [87.1%–100.0%] (6 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [87.1%–100.0%] (6 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 1.7 mean, 0 median, 8/13 repos with none (3 partly labelled repos excluded) |
| Suggestion tier (everything else) | 129 | 112 | 49 | 2 | 61 | 45.5% [36.6%–54.8%] (13 repos: bootstrap 33.8%–59.2%, cluster-t 30.9%–60.1%) | 43.8% [34.9%–53.0%] (13 repos: bootstrap 30.9%–58.5%, cluster-t 27.8%–59.7%) | 2.1 mean, 2 median, 3/9 repos with none (7 partly labelled repos excluded) |

**20 shown proposals have no label** (excluded above). Over all 158 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 48.7% [41.1%–56.5%] (13 repos: bootstrap 39.7%–57.1%, cluster-t 38.7%–58.7%) | 47.5% [39.8%–55.2%] (13 repos: bootstrap 37.1%–56.7%, cluster-t 36.1%–58.8%) |
| Default tier, unlabelled = WRONG | 89.7% [73.6%–96.4%] (8 repos: bootstrap 71.4%–100.0%, cluster-t 74.0%–100.0%) | 89.7% [73.6%–96.4%] (8 repos: bootstrap 71.4%–100.0%, cluster-t 74.0%–100.0%) |
| Suggestion tier, unlabelled = WRONG | 39.5% [31.5%–48.2%] (13 repos: bootstrap 29.9%–49.6%, cluster-t 28.3%–50.8%) | 38.0% [30.1%–46.6%] (13 repos: bootstrap 27.4%–48.7%, cluster-t 25.6%–50.3%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 61.4% | 60.1% |

Unlabelled: cal.com/D-c54406, cal.com/D-6c77ce, cal.com/D-bcef5c, cal.com/D-d690c0, cal.com/D-fafac1, cal.com/D-8d7d13, cal.com/D-e5e923, documenso/D-a10f62, ai/D-fc5ef7, supabase/D-e93eb6, supabase/D-5bd6b4, novu/D-2e9dcc, novu/D-e79710, novu/D-67ddb9, novu/D-bdd970, novu/D-808edd, immich/D-26380c, midday/D-b905f9, midday/D-98e729, infisical/D-156a6f

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 13 | 29 | 26 | 26 | 0 | 0 | **89.7% [73.6%–96.4%] (8 repos: bootstrap 71.4%–100.0%, cluster-t 74.0%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 89.7% [73.6%–96.4%] (8 repos: bootstrap 71.4%–100.0%, cluster-t 74.0%–100.0%) |
| typescript/javascript | Suggestion tier | 13 | 129 | 112 | 49 | 2 | 61 | 38.0% [30.1%–46.6%] (13 repos: bootstrap 27.4%–48.7%, cluster-t 25.6%–50.3%) | 39.5% [31.5%–48.2%] (13 repos: bootstrap 29.9%–49.6%, cluster-t 28.3%–50.8%) |
| typescript/javascript | All shown (both tiers) | 13 | 158 | 138 | 75 | 2 | 61 | 47.5% [39.8%–55.2%] (13 repos: bootstrap 37.1%–56.7%, cluster-t 36.1%–58.8%) | **48.7% [41.1%–56.5%] (13 repos: bootstrap 39.7%–57.1%, cluster-t 38.7%–58.7%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 19 | 16 | 0 | 0 | 84.2% [62.4%–94.5%] (8 repos: bootstrap 50.0%–100.0%, cluster-t 58.2%–100.0%) | 84.2% [62.4%–94.5%] (8 repos: bootstrap 50.0%–100.0%, cluster-t 58.2%–100.0%) |
| typescript/javascript | Call wrappers | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Call wrappers | All shown | 20 | 16 | 0 | 1 | 80.0% [58.4%–91.9%] (8 repos: bootstrap 45.5%–96.2%, cluster-t 51.8%–100.0%) | 80.0% [58.4%–91.9%] (8 repos: bootstrap 45.5%–96.2%, cluster-t 51.8%–100.0%) |
| typescript/javascript | Decorators | Suggestion tier | 16 | 7 | 1 | 8 | 43.8% [23.1%–66.8%] (4 repos: bootstrap 15.8%–80.0%, cluster-t 0.0%–99.7%) | 50.0% [28.0%–72.0%] (4 repos: bootstrap 31.6%–80.0%, cluster-t 7.0%–93.0%) |
| typescript/javascript | Base classes | Suggestion tier | 13 | 9 | 0 | 4 | 69.2% [42.4%–87.3%] (6 repos: bootstrap 50.0%–90.0%, cluster-t 39.5%–98.9%) | 69.2% [42.4%–87.3%] (6 repos: bootstrap 50.0%–90.0%, cluster-t 39.5%–98.9%) |
| typescript/javascript | Argument keys | Suggestion tier | 16 | 4 | 1 | 10 | 25.0% [10.2%–49.5%] (6 repos: bootstrap 7.1%–38.9%, cluster-t 1.7%–48.3%) | 31.3% [14.2%–55.6%] (6 repos: bootstrap 7.7%–50.0%, cluster-t 1.6%–60.9%) |
| typescript/javascript | Layering (imports avoided) | Default tier | 10 | 10 | 0 | 0 | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Rendered components | Suggestion tier | 10 | 4 | 0 | 6 | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) |
| typescript/javascript | Rendered inside a wrapper | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 14 | 2 | 0 | 11 | 14.3% [4.0%–39.9%] (10 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–37.9%) | 14.3% [4.0%–39.9%] (10 repos: bootstrap 0.0%–40.0%, cluster-t 0.0%–37.9%) |
| typescript/javascript | Naming | Suggestion tier | 30 | 9 | 0 | 7 | 30.0% [16.7%–47.9%] (11 repos: bootstrap 17.9%–46.2%, cluster-t 13.8%–46.2%) | 30.0% [16.7%–47.9%] (11 repos: bootstrap 17.9%–46.2%, cluster-t 13.8%–46.2%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 6 | 2 | 0 | 4 | 33.3% [9.7%–70.0%] (5 repos: bootstrap 0.0%–80.0%, cluster-t 0.0%–97.8%) | 33.3% [9.7%–70.0%] (5 repos: bootstrap 0.0%–80.0%, cluster-t 0.0%–97.8%) |
| typescript/javascript | Call order | Suggestion tier | 3 | 1 | 0 | 2 | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) | 33.3% [6.1%–79.2%] (2 repos: bootstrap 0.0%–50.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 7 | 4 | 0 | 2 | 57.1% [25.0%–84.2%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 57.1% [25.0%–84.2%] (4 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 11 | 5 | 0 | 6 | 45.5% [21.3%–72.0%] (4 repos: bootstrap 0.0%–68.8%, cluster-t 0.0%–97.9%) | 45.5% [21.3%–72.0%] (4 repos: bootstrap 0.0%–68.8%, cluster-t 0.0%–97.9%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 5 | 100% [57%–100%] |
| twenty | 15 | 5 | 1 | 9 | 40% [20%–64%] | 33% [15%–58%] | 5 | 0 | – |
| formbricks | 13 | 7 | 0 | 6 | 54% [29%–77%] | 54% [29%–77%] | 7 | 2 | 100% [34%–100%] |
| cal.com | 15 | 7 | 0 | 1 | 88% [53%–98%] | 88% [53%–98%] | 7 | 5 | 100% [51%–100%] |
| documenso | 15 | 11 | 0 | 3 | 79% [52%–92%] | 79% [52%–92%] | 11 | 9 | 100% [70%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 8 | 3 | 0 | 4 | 43% [16%–75%] | 43% [16%–75%] | 3 | 1 | – |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| supabase | 14 | 9 | 0 | 3 | 75% [47%–91%] | 75% [47%–91%] | 9 | 1 | – |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 8 | 0 | 2 | 80% [49%–94%] | 80% [49%–94%] | 8 | 0 | – |
| immich | 14 | 1 | 1 | 11 | 15% [4%–42%] | 8% [1%–33%] | 1 | 0 | – |
| midday | 15 | 7 | 0 | 6 | 54% [29%–77%] | 54% [29%–77%] | 7 | 2 | 100% [34%–100%] |
| infisical | 15 | 6 | 0 | 8 | 43% [21%–67%] | 43% [21%–67%] | 6 | 4 | 100% [51%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 20 | 16 | 0 | 1 | 94% [73%–99%] | 94% [73%–99%] | 19 | 100% [81%–100%] |
| Decorators | 16 | 7 | 1 | 8 | 44% [23%–67%] | 50% [28%–72%] | 0 | – |
| Base classes | 13 | 9 | 0 | 4 | 69% [42%–87%] | 69% [42%–87%] | 0 | – |
| Argument keys | 16 | 4 | 1 | 10 | 27% [11%–52%] | 33% [15%–58%] | 0 | – |
| Layering (imports avoided) | 10 | 10 | 0 | 0 | 100% [72%–100%] | 100% [72%–100%] | 10 | 100% [72%–100%] |
| Rendered components | 10 | 4 | 0 | 6 | 40% [17%–69%] | 40% [17%–69%] | 0 | – |
| Rendered inside a wrapper | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Calls | 14 | 2 | 0 | 11 | 15% [4%–42%] | 15% [4%–42%] | 0 | – |
| Naming | 30 | 9 | 0 | 7 | 56% [33%–77%] | 56% [33%–77%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |
| Call order | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Control and typing | 7 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 0 | – |
| Package and repo facts | 11 | 5 | 0 | 6 | 45% [21%–72%] | 45% [21%–72%] | 0 | – |

## Why not accepted

- TRIVIAL by: types 1, framework 1
- WRONG because: legit_outliers 24, mixed_group 17, misdescribes 1, incidental 13, false_outliers 1, team_disabled 5
