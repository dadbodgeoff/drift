# Precision: eval/study/runs/dev-py-2026-11-05

- drift: drift 0.1.0-dev commit 859542f401a358c1bf32e43fefd9e048fd88be92, binary sha256 34ded3c35a36
- manifest: eval/repos-py.json, 8 repos ok
- labels: eval/study/runs/dev-py-2026-11-05/final.jsonl (53 records)
- default tier: role has ≥ 15 members (NOT pre-registered (run.json params.tier_pre_registered: false))
- rubric: v2; label records by rubric: not recorded 53
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved); see README.md decision log

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 53 | 53 | 25 | 0 | 28 | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) | 3.1 mean, 2.5 median, 1/8 repos with none |
| Default tier (≥ 15 members, not pre-registered) | 53 | 53 | 25 | 0 | 28 | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) | 3.1 mean, 2.5 median, 1/8 repos with none |
| Suggestion tier (everything else) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 8/8 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05); the not-wrong target is met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| python | Default tier | 8 | 53 | 53 | 25 | 0 | 28 | **47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05): **no verdict (not a primary held-out run)** | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) |
| python | Suggestion tier | 8 | 0 | 0 | 0 | 0 | 0 | – | – |
| python | All shown (both tiers) | 8 | 53 | 53 | 25 | 0 | 28 | 47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%) | **47.2% [34.4%–60.3%] (8 repos: bootstrap 38.1%–66.7%, cluster-t 32.6%–61.8%)**; target met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05): **no verdict (not a primary held-out run)** |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| polar | 15 | 5 | 0 | 10 | 33% [15%–58%] | 33% [15%–58%] | 5 | 15 | 33% [15%–58%] |
| netbox | 15 | 6 | 0 | 9 | 40% [20%–64%] | 40% [20%–64%] | 6 | 15 | 40% [20%–64%] |
| saleor | 14 | 7 | 0 | 7 | 50% [27%–73%] | 50% [27%–73%] | 7 | 14 | 50% [27%–73%] |
| CTFd | 5 | 4 | 0 | 1 | 80% [38%–96%] | 80% [38%–96%] | 4 | 5 | 80% [38%–96%] |
| flask | 1 | 0 | 0 | 1 | 0% [0%–79%] | 0% [0%–79%] | 0 | 1 | 0% [0%–79%] |
| fastapi | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| langchain | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 100% [34%–100%] |
| Decorators | 7 | 2 | 0 | 5 | 29% [8%–64%] | 29% [8%–64%] | 7 | 29% [8%–64%] |
| Base classes | 5 | 3 | 0 | 2 | 60% [23%–88%] | 60% [23%–88%] | 5 | 60% [23%–88%] |
| Argument keys | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 6 | 33% [10%–70%] |
| Layering (imports avoided) | 12 | 5 | 0 | 7 | 42% [19%–68%] | 42% [19%–68%] | 12 | 42% [19%–68%] |
| Rendered components | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Calls | 6 | 2 | 0 | 4 | 33% [10%–70%] | 33% [10%–70%] | 6 | 33% [10%–70%] |
| Naming | 8 | 5 | 0 | 3 | 63% [31%–86%] | 63% [31%–86%] | 8 | 63% [31%–86%] |
| Other avoidance (any, console, bare Error) | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |
| Control and typing | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 100% [21%–100%] |
| Package and repo facts | 2 | 1 | 0 | 1 | 50% [9%–91%] | 50% [9%–91%] | 2 | 50% [9%–91%] |

## Why not accepted

- TRIVIAL by: –
- WRONG because: legit_outliers 5, incidental 10, false_outliers 3, mixed_group 9, misdescribes 1
