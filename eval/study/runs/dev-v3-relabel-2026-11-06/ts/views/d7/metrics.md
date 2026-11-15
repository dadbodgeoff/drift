# Precision: eval/study/runs/dev-v3-relabel-2026-11-06/ts/views/d7

- drift: drift 0.1.0-dev commit fcec23198fe36fa3b3c621613f158573f146a032, binary sha256 24ed92b6a8e7
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-relabel-2026-11-06/ts/final.jsonl (105 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 105
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 158 | 105 | 56 | 1 | 48 | 54.3% [44.8%–63.5%] (13 repos: bootstrap 41.4%–65.3%, cluster-t 39.8%–68.8%) | 53.3% [43.8%–62.6%] (13 repos: bootstrap 38.6%–65.3%, cluster-t 37.2%–69.5%) | 1.8 mean, 0 median, 3/5 repos with none (11 partly labelled repos excluded) |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 29 | 29 | 27 | 0 | 2 | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) | 1.7 mean, 0 median, 10/16 repos with none |
| Suggestion tier (everything else) | 129 | 76 | 29 | 1 | 46 | 39.5% [29.2%–50.7%] (13 repos: bootstrap 27.0%–50.9%, cluster-t 25.4%–53.6%) | 38.2% [28.1%–49.4%] (13 repos: bootstrap 23.9%–50.8%, cluster-t 22.0%–54.3%) | 1.4 mean, 0 median, 3/5 repos with none (11 partly labelled repos excluded) |

**53 shown proposals have no label** (excluded above). Over all 158 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 36.1% [29.0%–43.8%] (13 repos: bootstrap 25.8%–46.7%, cluster-t 24.2%–48.0%) | 35.4% [28.4%–43.2%] (13 repos: bootstrap 24.5%–46.4%, cluster-t 22.9%–47.9%) |
| Default tier, unlabelled = WRONG | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) |
| Suggestion tier, unlabelled = WRONG | 23.3% [16.8%–31.3%] (13 repos: bootstrap 14.1%–33.6%, cluster-t 12.0%–34.5%) | 22.5% [16.1%–30.4%] (13 repos: bootstrap 13.0%–33.1%, cluster-t 10.8%–34.2%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 69.6% | 69.0% |

Unlabelled: dub/D-e25af3, dub/D-3fad9a, dub/D-a23ff8, dub/D-024a81, dub/D-418256, dub/D-258285, twenty/D-6429a5, twenty/D-0cd62c, twenty/D-2df337, twenty/D-70d216, twenty/D-cfebe6, twenty/D-2a3e38, twenty/D-153f9c, twenty/D-865fba, twenty/D-bc65cf, twenty/D-006db2, twenty/D-868e25, cal.com/D-42ab67, cal.com/D-ec4221, cal.com/D-5722ba, cal.com/D-4791b7, cal.com/D-d690c0, cal.com/D-e5e923, documenso/D-4785b8, documenso/D-a10f62, ai/D-5baed4, ai/D-80697a, nest/D-897eda, supabase/D-db9d80, supabase/D-3c4b60, novu/D-7c65a3, novu/D-462c2b, novu/D-2e9dcc, novu/D-6d3bdc, novu/D-94d735, novu/D-67ddb9, novu/D-bdd970, novu/D-dbba9a, immich/D-3b4f47, midday/D-efc6d4, midday/D-98e729, midday/D-5880dd, midday/D-f6c709, midday/D-8fd473, infisical/D-272621, infisical/D-bf8c50, infisical/D-d9b44e, infisical/D-055c32, infisical/D-1b2542, infisical/D-156a6f, infisical/D-fd3f1a, infisical/D-ac787f, infisical/D-d7b5b7

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 13 | 29 | 29 | 27 | 0 | 2 | **93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 93.1% [78.0%–98.1%] (8 repos: bootstrap 75.0%–100.0%, cluster-t 79.4%–100.0%) |
| typescript/javascript | Suggestion tier | 13 | 129 | 76 | 29 | 1 | 46 | 22.5% [16.1%–30.4%] (13 repos: bootstrap 13.0%–33.1%, cluster-t 10.8%–34.2%) | 23.3% [16.8%–31.3%] (13 repos: bootstrap 14.1%–33.6%, cluster-t 12.0%–34.5%) |
| typescript/javascript | All shown (both tiers) | 13 | 158 | 105 | 56 | 1 | 48 | 35.4% [28.4%–43.2%] (13 repos: bootstrap 24.5%–46.4%, cluster-t 22.9%–47.9%) | **36.1% [29.0%–43.8%] (13 repos: bootstrap 25.8%–46.7%, cluster-t 24.2%–48.0%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 6 | 0 | 3 | 67% [35%–88%] | 67% [35%–88%] | 6 | 5 | 100% [57%–100%] |
| twenty | 15 | 1 | 0 | 3 | 25% [5%–70%] | 25% [5%–70%] | 1 | 0 | – |
| formbricks | 13 | 7 | 0 | 6 | 54% [29%–77%] | 54% [29%–77%] | 7 | 2 | 100% [34%–100%] |
| cal.com | 15 | 7 | 0 | 2 | 78% [45%–94%] | 78% [45%–94%] | 7 | 5 | 100% [57%–100%] |
| documenso | 15 | 10 | 0 | 3 | 77% [50%–92%] | 77% [50%–92%] | 10 | 9 | 100% [70%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 8 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 1 | 0% [0%–79%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 2 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 0 | – |
| supabase | 14 | 7 | 0 | 5 | 58% [32%–81%] | 58% [32%–81%] | 7 | 1 | 0% [0%–79%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 4 | 0 | 3 | 57% [25%–84%] | 57% [25%–84%] | 4 | 0 | – |
| immich | 14 | 1 | 1 | 11 | 15% [4%–42%] | 8% [1%–33%] | 1 | 0 | – |
| midday | 15 | 5 | 0 | 5 | 50% [24%–76%] | 50% [24%–76%] | 5 | 2 | 100% [34%–100%] |
| infisical | 15 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 4 | 4 | 100% [51%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 20 | 17 | 0 | 3 | 85% [64%–95%] | 85% [64%–95%] | 19 | 89% [69%–97%] |
| Decorators | 16 | 4 | 1 | 3 | 50% [22%–78%] | 63% [31%–86%] | 0 | – |
| Base classes | 13 | 2 | 0 | 3 | 40% [12%–77%] | 40% [12%–77%] | 0 | – |
| Argument keys | 16 | 3 | 0 | 7 | 30% [11%–60%] | 30% [11%–60%] | 0 | – |
| Layering (imports avoided) | 10 | 10 | 0 | 0 | 100% [72%–100%] | 100% [72%–100%] | 10 | 100% [72%–100%] |
| Rendered components | 10 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | – |
| Rendered inside a wrapper | 2 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 0 | – |
| Calls | 14 | 2 | 0 | 8 | 20% [6%–51%] | 20% [6%–51%] | 0 | – |
| Naming | 30 | 8 | 0 | 10 | 44% [25%–66%] | 44% [25%–66%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |
| Call order | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Control and typing | 7 | 2 | 0 | 2 | 50% [15%–85%] | 50% [15%–85%] | 0 | – |
| Package and repo facts | 11 | 4 | 0 | 5 | 44% [19%–73%] | 44% [19%–73%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: legit_outliers 16, mixed_group 16, incidental 11, team_disabled 5
