# Precision: eval/study/runs/dev-v3-2026-11-06/ts/views/d5

- drift: drift 0.1.0-dev commit debc33a3483ba9c53dfac93d50bbadf58553ea27, binary sha256 b2b23599f83a
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/runs/dev-v3-2026-11-06/ts/final.jsonl (162 records)
- default tier: rule kind in {wrapped_by:call, wrapped_by:decorator, wrapped_by:extends, avoids:import, wrapped_by:jsx}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 162
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 162 | 162 | 69 | 1 | 92 | 43.2% [35.8%–50.9%] (13 repos: bootstrap 33.8%–52.3%, cluster-t 32.6%–53.9%) | 42.6% [35.2%–50.3%] (13 repos: bootstrap 32.5%–52.0%, cluster-t 31.1%–54.0%) | 4.3 mean, 4 median, 3/16 repos with none |
| Default tier (default rule kinds, ≥ 15 members, not pre-registered) | 52 | 52 | 35 | 1 | 16 | 69.2% [55.7%–80.1%] (12 repos: bootstrap 51.4%–84.2%, cluster-t 49.8%–88.6%) | 67.3% [53.8%–78.5%] (12 repos: bootstrap 47.7%–83.3%, cluster-t 46.2%–88.4%) | 2.2 mean, 1.5 median, 6/16 repos with none |
| Suggestion tier (everything else) | 110 | 110 | 34 | 0 | 76 | 30.9% [23.0%–40.1%] (13 repos: bootstrap 19.0%–43.1%, cluster-t 17.0%–44.8%) | 30.9% [23.0%–40.1%] (13 repos: bootstrap 19.0%–43.1%, cluster-t 17.0%–44.8%) | 2.1 mean, 1 median, 4/16 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unknown | Default tier | 16 | 52 | 52 | 35 | 1 | 16 | **67.3% [53.8%–78.5%] (12 repos: bootstrap 47.7%–83.3%, cluster-t 46.2%–88.4%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 69.2% [55.7%–80.1%] (12 repos: bootstrap 51.4%–84.2%, cluster-t 49.8%–88.6%) |
| unknown | Suggestion tier | 16 | 110 | 110 | 34 | 0 | 76 | 30.9% [23.0%–40.1%] (13 repos: bootstrap 19.0%–43.1%, cluster-t 17.0%–44.8%) | 30.9% [23.0%–40.1%] (13 repos: bootstrap 19.0%–43.1%, cluster-t 17.0%–44.8%) |
| unknown | All shown (both tiers) | 16 | 162 | 162 | 69 | 1 | 92 | 42.6% [35.2%–50.3%] (13 repos: bootstrap 32.5%–52.0%, cluster-t 31.1%–54.0%) | **43.2% [35.8%–50.9%] (13 repos: bootstrap 33.8%–52.3%, cluster-t 32.6%–53.9%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 6 | 0 | 9 | 40% [20%–64%] | 40% [20%–64%] | 6 | 5 | 100% [57%–100%] |
| twenty | 15 | 4 | 0 | 11 | 27% [11%–52%] | 27% [11%–52%] | 4 | 7 | 43% [16%–75%] |
| formbricks | 15 | 7 | 0 | 8 | 47% [25%–70%] | 47% [25%–70%] | 7 | 4 | 50% [15%–85%] |
| cal.com | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 6 | 83% [44%–97%] |
| documenso | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 8 | 100% [68%–100%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 2 | 1 | 0% [0%–79%] |
| trpc | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| nest | 5 | 1 | 0 | 4 | 20% [4%–62%] | 20% [4%–62%] | 1 | 4 | 25% [5%–70%] |
| supabase | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 2 | 50% [9%–91%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 9 | 0 | 6 | 60% [36%–80%] | 60% [36%–80%] | 9 | 5 | 80% [38%–96%] |
| immich | 14 | 1 | 1 | 12 | 14% [4%–40%] | 7% [1%–31%] | 1 | 3 | 0% [0%–56%] |
| midday | 15 | 6 | 0 | 9 | 40% [20%–64%] | 40% [20%–64%] | 6 | 3 | 100% [44%–100%] |
| infisical | 15 | 4 | 0 | 11 | 27% [11%–52%] | 27% [11%–52%] | 4 | 4 | 75% [30%–95%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 20 | 14 | 0 | 6 | 70% [48%–85%] | 70% [48%–85%] | 19 | 74% [51%–88%] |
| Decorators | 16 | 6 | 1 | 9 | 38% [18%–61%] | 44% [23%–67%] | 6 | 33% [10%–70%] |
| Base classes | 13 | 9 | 0 | 4 | 69% [42%–87%] | 69% [42%–87%] | 12 | 67% [39%–86%] |
| Argument keys | 16 | 4 | 0 | 12 | 25% [10%–49%] | 25% [10%–49%] | 0 | – |
| Layering (imports avoided) | 13 | 10 | 0 | 3 | 77% [50%–92%] | 77% [50%–92%] | 13 | 77% [50%–92%] |
| Rendered components | 11 | 2 | 0 | 9 | 18% [5%–48%] | 18% [5%–48%] | 0 | – |
| Rendered inside a wrapper | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Calls | 14 | 2 | 0 | 12 | 14% [4%–40%] | 14% [4%–40%] | 0 | – |
| Naming | 30 | 11 | 0 | 19 | 37% [22%–54%] | 37% [22%–54%] | 0 | – |
| Other avoidance (any, console, bare Error) | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 0 | – |
| Call order | 3 | 1 | 0 | 2 | 33% [6%–79%] | 33% [6%–79%] | 0 | – |
| Control and typing | 9 | 3 | 0 | 6 | 33% [12%–65%] | 33% [12%–65%] | 0 | – |
| Package and repo facts | 9 | 4 | 0 | 5 | 44% [19%–73%] | 44% [19%–73%] | 0 | – |

## Why not accepted

- TRIVIAL by: framework 1
- WRONG because: legit_outliers 31, incidental 14, mixed_group 36, false_outliers 6, team_disabled 5
