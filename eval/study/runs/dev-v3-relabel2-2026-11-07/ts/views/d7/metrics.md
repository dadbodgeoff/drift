# Precision: eval/study/runs/dev-v3-relabel2-2026-11-07/ts/views/d7

- drift: drift 0.1.0-dev commit feefad614e6e13e3cdc2f661e42c8630d1579f53, binary sha256 24ed92b6a8e7
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-relabel2-2026-11-07/ts/final.jsonl (158 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 158
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 158 | 158 | 79 | 2 | 77 | 51.3% [43.5%–58.9%] (13 repos: bootstrap 41.6%–60.1%, cluster-t 40.5%–62.1%) | 50.0% [42.3%–57.7%] (13 repos: bootstrap 39.2%–59.9%, cluster-t 37.8%–62.2%) | 4.9 mean, 5.5 median, 3/16 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 29 | 29 | 27 | 0 | 2 | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) | 1.7 mean, 0 median, 10/16 repos with none |
| Suggestion tier (everything else) | 129 | 129 | 52 | 2 | 75 | 41.9% [33.7%–50.5%] (13 repos: bootstrap 31.7%–52.3%, cluster-t 29.9%–53.8%) | 40.3% [32.2%–48.9%] (13 repos: bootstrap 28.9%–51.7%, cluster-t 27.2%–53.4%) | 3.3 mean, 2.5 median, 3/16 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 13 | 29 | 29 | 27 | 0 | 2 | **93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) |
| typescript/javascript | Suggestion tier | 13 | 129 | 129 | 52 | 2 | 75 | 40.3% [32.2%–48.9%] (13 repos: bootstrap 28.9%–51.7%, cluster-t 27.2%–53.4%) | 41.9% [33.7%–50.5%] (13 repos: bootstrap 31.7%–52.3%, cluster-t 29.9%–53.8%) |
| typescript/javascript | All shown (both tiers) | 13 | 158 | 158 | 79 | 2 | 77 | 50.0% [42.3%–57.7%] (13 repos: bootstrap 39.2%–59.9%, cluster-t 37.8%–62.2%) | **51.3% [43.5%–58.9%] (13 repos: bootstrap 41.6%–60.1%, cluster-t 40.5%–62.1%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 5 | 100% [57%–100%] |
| twenty | 15 | 5 | 1 | 9 | 40% [20%–64%] | 33% [15%–58%] | 5 | 0 | – |
| formbricks | 13 | 7 | 0 | 6 | 54% [29%–77%] | 54% [29%–77%] | 7 | 2 | 100% [34%–100%] |
| cal.com | 15 | 10 | 0 | 5 | 67% [42%–85%] | 67% [42%–85%] | 10 | 5 | 100% [57%–100%] |
| documenso | 15 | 11 | 0 | 4 | 73% [48%–89%] | 73% [48%–89%] | 11 | 9 | 100% [70%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 8 | 3 | 0 | 5 | 38% [14%–69%] | 38% [14%–69%] | 3 | 1 | 0% [0%–79%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 1 | 0 | – |
| supabase | 14 | 9 | 0 | 5 | 64% [39%–84%] | 64% [39%–84%] | 9 | 1 | 0% [0%–79%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 0 | – |
| immich | 14 | 1 | 1 | 12 | 14% [4%–40%] | 7% [1%–31%] | 1 | 0 | – |
| midday | 15 | 7 | 0 | 8 | 47% [25%–70%] | 47% [25%–70%] | 7 | 2 | 100% [34%–100%] |
| infisical | 15 | 6 | 0 | 9 | 40% [20%–64%] | 40% [20%–64%] | 6 | 4 | 100% [51%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 20 | 17 | 0 | 3 | 85% [64%–95%] | 85% [64%–95%] | 19 | 89% [69%–97%] |
| Decorators | 16 | 7 | 1 | 8 | 44% [23%–67%] | 50% [28%–72%] | 0 | – |
| Base classes | 13 | 9 | 0 | 4 | 69% [42%–87%] | 69% [42%–87%] | 0 | – |
| Argument keys | 16 | 4 | 1 | 11 | 25% [10%–49%] | 31% [14%–56%] | 0 | – |
| Layering (imports avoided) | 10 | 10 | 0 | 0 | 100% [72%–100%] | 100% [72%–100%] | 10 | 100% [72%–100%] |
| Rendered components | 10 | 4 | 0 | 6 | 40% [17%–69%] | 40% [17%–69%] | 0 | – |
| Rendered inside a wrapper | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Calls | 14 | 2 | 0 | 12 | 14% [4%–40%] | 14% [4%–40%] | 0 | – |
| Naming | 30 | 12 | 0 | 18 | 40% [25%–58%] | 40% [25%–58%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |
| Call order | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Control and typing | 7 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 0 | – |
| Package and repo facts | 11 | 5 | 0 | 6 | 45% [21%–72%] | 45% [21%–72%] | 0 | – |

## Why not accepted

- TRIVIAL by: types 1, framework 1
- WRONG because: legit_outliers 27, mixed_group 30, misdescribes 1, incidental 13, false_outliers 1, team_disabled 5
