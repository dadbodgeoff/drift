# Precision: eval/study/runs/dev-ts-r2-2026-11-05/views/rule5

- drift: drift 0.1.0-dev commit ce38aeaae86e56d2a4dfc43c121b255632df184f, binary sha256 151b79ddfc1a
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-ts-r2-2026-11-05/final.jsonl (162 records)
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, passes_key, avoids:import, renders, wrapped_by:jsx} and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: not recorded; label records by rubric: not recorded 162
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 162 | 162 | 122 | 12 | 28 | 82.7% [76.2%–87.8%] (13 repos: bootstrap 76.6%–88.6%, cluster-t 75.9%–89.6%) | 75.3% [68.1%–81.3%] (13 repos: bootstrap 68.2%–82.7%, cluster-t 67.1%–83.5%) | 7.6 mean, 10 median, 3/16 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 92 | 92 | 77 | 5 | 10 | 89.1% [81.1%–94.0%] (12 repos: bootstrap 82.3%–95.6%, cluster-t 81.4%–96.9%) | 83.7% [74.8%–89.9%] (12 repos: bootstrap 74.7%–93.0%, cluster-t 72.9%–94.5%) | 4.8 mean, 6.5 median, 4/16 repos with none |
| Suggestion tier (everything else) | 70 | 70 | 45 | 7 | 18 | 74.3% [63.0%–83.1%] (13 repos: bootstrap 61.3%–85.9%, cluster-t 60.0%–88.6%) | 64.3% [52.6%–74.5%] (13 repos: bootstrap 50.8%–76.0%, cluster-t 50.0%–78.6%) | 2.8 mean, 3 median, 5/16 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 16 | 92 | 92 | 77 | 5 | 10 | **83.7% [74.8%–89.9%] (12 repos: bootstrap 74.7%–93.0%, cluster-t 72.9%–94.5%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 89.1% [81.1%–94.0%] (12 repos: bootstrap 82.3%–95.6%, cluster-t 81.4%–96.9%) |
| typescript/javascript | Suggestion tier | 16 | 70 | 70 | 45 | 7 | 18 | 64.3% [52.6%–74.5%] (13 repos: bootstrap 50.8%–76.0%, cluster-t 50.0%–78.6%) | 74.3% [63.0%–83.1%] (13 repos: bootstrap 61.3%–85.9%, cluster-t 60.0%–88.6%) |
| typescript/javascript | All shown (both tiers) | 16 | 162 | 162 | 122 | 12 | 28 | 75.3% [68.1%–81.3%] (13 repos: bootstrap 68.2%–82.7%, cluster-t 67.1%–83.5%) | **82.7% [76.2%–87.8%] (13 repos: bootstrap 76.6%–88.6%, cluster-t 75.9%–89.6%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 11 | 2 | 2 | 87% [62%–96%] | 73% [48%–89%] | 11 | 10 | 70% [40%–89%] |
| twenty | 15 | 8 | 2 | 5 | 67% [42%–85%] | 53% [30%–75%] | 8 | 13 | 62% [36%–82%] |
| formbricks | 15 | 11 | 0 | 4 | 73% [48%–89%] | 73% [48%–89%] | 11 | 9 | 78% [45%–94%] |
| cal.com | 15 | 15 | 0 | 0 | 100% [80%–100%] | 100% [80%–100%] | 15 | 8 | 100% [68%–100%] |
| documenso | 15 | 11 | 2 | 2 | 87% [62%–96%] | 73% [48%–89%] | 11 | 9 | 89% [57%–98%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 6 | 4 | 0 | 2 | 67% [30%–90%] | 67% [30%–90%] | 4 | 1 | 100% [21%–100%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 5 | 4 | 1 | 0 | 100% [57%–100%] | 80% [38%–96%] | 4 | 4 | 100% [51%–100%] |
| supabase | 15 | 11 | 2 | 2 | 87% [62%–96%] | 73% [48%–89%] | 11 | 5 | 60% [23%–88%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 12 | 1 | 2 | 87% [62%–96%] | 80% [55%–93%] | 12 | 8 | 100% [68%–100%] |
| immich | 14 | 11 | 1 | 2 | 86% [60%–96%] | 79% [52%–92%] | 11 | 7 | 86% [49%–97%] |
| midday | 15 | 9 | 1 | 5 | 67% [42%–85%] | 60% [36%–80%] | 9 | 8 | 88% [53%–98%] |
| infisical | 15 | 13 | 0 | 2 | 87% [62%–96%] | 87% [62%–96%] | 13 | 10 | 100% [72%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 20 | 19 | 0 | 1 | 95% [76%–99%] | 95% [76%–99%] | 20 | 95% [76%–99%] |
| Decorators | 16 | 14 | 0 | 2 | 88% [64%–97%] | 88% [64%–97%] | 16 | 88% [64%–97%] |
| Base classes | 13 | 11 | 0 | 2 | 85% [58%–96%] | 85% [58%–96%] | 13 | 85% [58%–96%] |
| Argument keys | 17 | 12 | 2 | 3 | 71% [47%–87%] | 82% [59%–94%] | 17 | 71% [47%–87%] |
| Layering (imports avoided) | 13 | 13 | 0 | 0 | 100% [77%–100%] | 100% [77%–100%] | 13 | 100% [77%–100%] |
| Rendered components | 11 | 6 | 3 | 2 | 55% [28%–79%] | 82% [52%–95%] | 11 | 55% [28%–79%] |
| Rendered inside a wrapper | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Calls | 14 | 8 | 1 | 5 | 57% [33%–79%] | 64% [39%–84%] | 0 | – |
| Naming | 29 | 19 | 3 | 7 | 66% [47%–80%] | 76% [58%–88%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 4 | 1 | 1 | 67% [30%–90%] | 83% [44%–97%] | 0 | – |
| Call order | 3 | 2 | 0 | 1 | 67% [21%–94%] | 67% [21%–94%] | 0 | – |
| Control and typing | 9 | 5 | 2 | 2 | 56% [27%–81%] | 78% [45%–94%] | 0 | – |
| Package and repo facts | 9 | 7 | 0 | 2 | 78% [45%–94%] | 78% [45%–94%] | 0 | – |

## Why not accepted

- TRIVIAL by: –
- WRONG because: incidental 2, mixed_group 4, legit_outliers 4, false_outliers 2, team_disabled 1
