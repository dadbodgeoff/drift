# Precision: eval/study/runs/dev-v3-relabel4-2026-11-07/ts/views/d7

> **Computed on INCOMPLETE A/B label sets** (`--allow-incomplete`: carried labels only, before the relabel is labelled: the cards to label count as WRONG). Not labelled: A twenty (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 2 labelled (prompt rendered, output not collected); A formbricks (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 2 labelled (prompt rendered, output not collected); A cal.com (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 4 labelled (prompt rendered, output not collected); A documenso (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (prompt rendered, output not collected); A ai (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (prompt rendered, output not collected); A supabase (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (prompt rendered, output not collected); A novu (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (prompt rendered, output not collected); A midday (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 8 labelled (prompt rendered, output not collected); A infisical (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 5 labelled (prompt rendered, output not collected); B twenty (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 2 labelled (no prompt rendered); B formbricks (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 2 labelled (no prompt rendered); B cal.com (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 4 labelled (no prompt rendered); B documenso (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (no prompt rendered); B ai (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (no prompt rendered); B supabase (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (no prompt rendered); B novu (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 1 labelled (no prompt rendered); B midday (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 8 labelled (no prompt rendered); B infisical (eval/study/runs/dev-v3-relabel4-2026-11-07/ts/relabel): 0 of 5 labelled (no prompt rendered).

- drift: drift 0.1.0-dev commit 2c81ba491d09f33dfcd209676572508e98923c4c, binary sha256 5d0cd386c9e7
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-relabel4-2026-11-07/ts/carried.jsonl (122 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 122
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 147 | 122 | 80 | 1 | 41 | 66.4% [57.6%–74.2%] (13 repos: bootstrap 53.1%–78.6%, cluster-t 51.2%–81.5%) | 65.6% [56.8%–73.4%] (13 repos: bootstrap 51.0%–78.3%, cluster-t 49.3%–81.9%) | 1.7 mean, 1 median, 3/7 repos with none (9 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 30 | 28 | 28 | 0 | 0 | 100.0% [87.9%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [87.9%–100.0%] (8 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 1.6 mean, 0 median, 8/15 repos with none (1 partly labelled repos excluded) |
| Suggestion tier (everything else) | 117 | 94 | 52 | 1 | 41 | 56.4% [46.3%–66.0%] (13 repos: bootstrap 40.0%–72.0%, cluster-t 37.5%–75.2%) | 55.3% [45.3%–65.0%] (13 repos: bootstrap 37.9%–71.7%, cluster-t 35.2%–75.4%) | 1.0 mean, 1 median, 3/7 repos with none (9 partly labelled repos excluded) |

**25 shown proposals have no label** (excluded above). Over all 147 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 55.1% [47.0%–62.9%] (13 repos: bootstrap 43.4%–66.9%, cluster-t 41.6%–68.6%) | 54.4% [46.4%–62.3%] (13 repos: bootstrap 42.0%–66.4%, cluster-t 40.2%–68.6%) |
| Default tier, unlabelled = WRONG | 93.3% [78.7%–98.2%] (8 repos: bootstrap 81.0%–100.0%, cluster-t 78.4%–100.0%) | 93.3% [78.7%–98.2%] (8 repos: bootstrap 81.0%–100.0%, cluster-t 78.4%–100.0%) |
| Suggestion tier, unlabelled = WRONG | 45.3% [36.6%–54.3%] (13 repos: bootstrap 30.8%–60.4%, cluster-t 28.3%–62.3%) | 44.4% [35.8%–53.5%] (13 repos: bootstrap 29.5%–59.8%, cluster-t 26.8%–62.1%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 72.1% | 71.4% |

Unlabelled: twenty/D-81a1f5, twenty/D-532878, formbricks/D-3bb3c1, formbricks/D-66d37f, cal.com/D-594d38, cal.com/D-85e09a, cal.com/D-42ab67, cal.com/D-8d7d13, documenso/D-d7fae5, ai/D-4683f7, supabase/D-922bc7, novu/D-6ded6b, midday/D-98e729, midday/D-495f56, midday/D-7da2b9, midday/D-afc38b, midday/D-8fbbad, midday/D-48f0ae, midday/D-a45d35, midday/D-798f44, infisical/D-d9b44e, infisical/D-1b2542, infisical/D-156a6f, infisical/D-ac787f, infisical/D-536c03

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Incomplete label sets (--allow-incomplete): no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 13 | 30 | 28 | 28 | 0 | 0 | **93.3% [78.7%–98.2%] (8 repos: bootstrap 81.0%–100.0%, cluster-t 78.4%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** | 93.3% [78.7%–98.2%] (8 repos: bootstrap 81.0%–100.0%, cluster-t 78.4%–100.0%) |
| typescript/javascript | Suggestion tier | 13 | 117 | 94 | 52 | 1 | 41 | 44.4% [35.8%–53.5%] (13 repos: bootstrap 29.5%–59.8%, cluster-t 26.8%–62.1%) | 45.3% [36.6%–54.3%] (13 repos: bootstrap 30.8%–60.4%, cluster-t 28.3%–62.3%) |
| typescript/javascript | All shown (both tiers) | 13 | 147 | 122 | 80 | 1 | 41 | 54.4% [46.4%–62.3%] (13 repos: bootstrap 42.0%–66.4%, cluster-t 40.2%–68.6%) | **55.1% [47.0%–62.9%] (13 repos: bootstrap 43.4%–66.9%, cluster-t 41.6%–68.6%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (incomplete label sets, --allow-incomplete)** |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Call wrappers | Default tier | 20 | 18 | 0 | 0 | 90.0% [69.9%–97.2%] (8 repos: bootstrap 60.0%–100.0%, cluster-t 64.9%–100.0%) | 90.0% [69.9%–97.2%] (8 repos: bootstrap 60.0%–100.0%, cluster-t 64.9%–100.0%) |
| typescript/javascript | Call wrappers | Suggestion tier | 1 | 0 | 0 | 1 | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) | 0.0% [0.0%–79.3%] (1 repo: no cluster interval) |
| typescript/javascript | Call wrappers | All shown | 21 | 18 | 0 | 1 | 85.7% [65.4%–95.0%] (8 repos: bootstrap 58.3%–100.0%, cluster-t 59.2%–100.0%) | 85.7% [65.4%–95.0%] (8 repos: bootstrap 58.3%–100.0%, cluster-t 59.2%–100.0%) |
| typescript/javascript | Decorators | Suggestion tier | 16 | 7 | 1 | 8 | 43.8% [23.1%–66.8%] (4 repos: bootstrap 15.8%–80.0%, cluster-t 0.0%–99.7%) | 50.0% [28.0%–72.0%] (4 repos: bootstrap 31.6%–80.0%, cluster-t 7.0%–93.0%) |
| typescript/javascript | Base classes | Suggestion tier | 15 | 9 | 0 | 4 | 60.0% [35.7%–80.2%] (6 repos: bootstrap 33.3%–90.0%, cluster-t 15.9%–100.0%) | 60.0% [35.7%–80.2%] (6 repos: bootstrap 33.3%–90.0%, cluster-t 15.9%–100.0%) |
| typescript/javascript | Argument keys | Suggestion tier | 12 | 3 | 0 | 3 | 25.0% [8.9%–53.2%] (6 repos: bootstrap 9.1%–45.5%, cluster-t 1.5%–48.5%) | 25.0% [8.9%–53.2%] (6 repos: bootstrap 9.1%–45.5%, cluster-t 1.5%–48.5%) |
| typescript/javascript | Layering (imports avoided) | Default tier | 10 | 10 | 0 | 0 | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [72.2%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Rendered components | Suggestion tier | 10 | 4 | 0 | 6 | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) | 40.0% [16.8%–68.7%] (4 repos: bootstrap 25.0%–66.7%, cluster-t 12.5%–67.5%) |
| typescript/javascript | Rendered inside a wrapper | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| typescript/javascript | Calls | Suggestion tier | 2 | 0 | 0 | 2 | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–65.8%] (2 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Naming | Suggestion tier | 34 | 17 | 0 | 9 | 50.0% [34.1%–65.9%] (11 repos: bootstrap 25.0%–70.0%, cluster-t 22.9%–77.1%) | 50.0% [34.1%–65.9%] (11 repos: bootstrap 25.0%–70.0%, cluster-t 22.9%–77.1%) |
| typescript/javascript | Other avoidance (any, console, bare Error) | Suggestion tier | 2 | 1 | 0 | 1 | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 50.0% [9.5%–90.5%] (2 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Call order | Suggestion tier | 5 | 0 | 0 | 1 | 0.0% [0.0%–43.4%] (4 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) | 0.0% [0.0%–43.4%] (4 repos: bootstrap 0.0%–0.0%, cluster-t 0.0%–0.0%) |
| typescript/javascript | Control and typing | Suggestion tier | 5 | 4 | 0 | 0 | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 80.0% [37.6%–96.4%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) |
| typescript/javascript | Package and repo facts | Suggestion tier | 13 | 5 | 0 | 6 | 38.5% [17.7%–64.5%] (5 repos: bootstrap 0.0%–61.1%, cluster-t 0.0%–84.3%) | 38.5% [17.7%–64.5%] (5 repos: bootstrap 0.0%–61.1%, cluster-t 0.0%–84.3%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 8 | 0 | 7 | 53% [30%–75%] | 53% [30%–75%] | 8 | 5 | 100% [57%–100%] |
| twenty | 13 | 5 | 0 | 6 | 45% [21%–72%] | 45% [21%–72%] | 5 | 0 | – |
| formbricks | 11 | 4 | 0 | 5 | 44% [19%–73%] | 44% [19%–73%] | 4 | 2 | 100% [34%–100%] |
| cal.com | 15 | 10 | 0 | 1 | 91% [62%–98%] | 91% [62%–98%] | 10 | 6 | 100% [51%–100%] |
| documenso | 15 | 12 | 0 | 2 | 86% [60%–96%] | 86% [60%–96%] | 12 | 9 | 100% [70%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 8 | 3 | 0 | 4 | 43% [16%–75%] | 43% [16%–75%] | 3 | 1 | 100% [21%–100%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| supabase | 14 | 11 | 0 | 2 | 85% [58%–96%] | 85% [58%–96%] | 11 | 1 | 100% [21%–100%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 12 | 0 | 2 | 86% [60%–96%] | 86% [60%–96%] | 12 | 0 | – |
| immich | 10 | 1 | 1 | 8 | 20% [6%–51%] | 10% [2%–40%] | 1 | 0 | – |
| midday | 14 | 5 | 0 | 1 | 83% [44%–97%] | 83% [44%–97%] | 5 | 2 | 100% [34%–100%] |
| infisical | 14 | 6 | 0 | 3 | 67% [35%–88%] | 67% [35%–88%] | 6 | 4 | 100% [51%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 21 | 18 | 0 | 1 | 95% [75%–99%] | 95% [75%–99%] | 20 | 100% [82%–100%] |
| Decorators | 16 | 7 | 1 | 8 | 44% [23%–67%] | 50% [28%–72%] | 0 | – |
| Base classes | 15 | 9 | 0 | 4 | 69% [42%–87%] | 69% [42%–87%] | 0 | – |
| Argument keys | 12 | 3 | 0 | 3 | 50% [19%–81%] | 50% [19%–81%] | 0 | – |
| Layering (imports avoided) | 10 | 10 | 0 | 0 | 100% [72%–100%] | 100% [72%–100%] | 10 | 100% [72%–100%] |
| Rendered components | 10 | 4 | 0 | 6 | 40% [17%–69%] | 40% [17%–69%] | 0 | – |
| Rendered inside a wrapper | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Calls | 2 | 0 | 0 | 2 | 0% [0%–66%] | 0% [0%–66%] | 0 | – |
| Naming | 34 | 17 | 0 | 9 | 65% [46%–81%] | 65% [46%–81%] | 0 | – |
| Other avoidance (any, console, bare Error) | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 0 | – |
| Call order | 5 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Control and typing | 5 | 4 | 0 | 0 | 100% [51%–100%] | 100% [51%–100%] | 0 | – |
| Package and repo facts | 13 | 5 | 0 | 6 | 45% [21%–72%] | 45% [21%–72%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: legit_outliers 23, mixed_group 14, misdescribes 1, incidental 3
