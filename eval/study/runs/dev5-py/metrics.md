# Precision: eval/study/runs/dev5-py

- drift: drift 0.1.0-dev commit 5bafc43d4366f183ab0a25d780533c9bb1725077, binary sha256 18681df2dce1
- manifest: eval/study/runs/dev5-py/manifest.json, 30 repos ok
- labels: eval/study/runs/dev5-py/final.jsonl (13 records)
- default tier: the proposal is TypeScript/JavaScript, rule kind in {wrapped_by:call, avoids:import}, the rule names no symbol from outside the repository (package, built-in, unresolved) and role has ≥ 15 members; every other shown proposal is suggestion tier (Python: advise only, every proposal suggestion tier) (pre-registered)
- rubric: v3 (labeller-facing text sha256 79316bdc08a6…); label records by rubric: v3 13
- decisions: D1 (decided), D2 (decided), D3 (decided), D4 (decided), D5 (approved), D5a (decided), D6 (approved), D7 (approved), D7a (decided), D8 (pre-registered), D9 (decided), D11 (decided), WS-F (decided); see README.md decision log
- 1 shown proposals have no structured rule and are suggestion tier: P10/D-578f93

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 13 | 13 | 12 | 1 | 0 | 100.0% [77.2%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 92.3% [66.7%–98.6%] (10 repos: bootstrap 72.7%–100.0%, cluster-t 74.2%–100.0%) | 0.4 mean, 0 median, 21/30 repos with none |
| Default tier (default rule kinds, ≥ 15 members, pre-registered) | 0 | 0 | 0 | 0 | 0 | – | – | 0.0 mean, 0 median, 30/30 repos with none |
| Suggestion tier (everything else) | 13 | 13 | 12 | 1 | 0 | 100.0% [77.2%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 92.3% [66.7%–98.6%] (10 repos: bootstrap 72.7%–100.0%, cluster-t 74.2%–100.0%) | 0.4 mean, 0 median, 21/30 repos with none |

## Per language and tier

Pre-registered targets (≥ 95%): **default-tier accept** and **not-wrong over all shown, both tiers**. Rates here are over all shown proposals, unlabelled counted as WRONG (the target definition): Wilson 95%, then repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos; quote the wider cluster interval. The default-tier accept target is met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound); the not-wrong target is met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3 for D4, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound); the intervals are published next to both. Pooled rows (all languages) are secondary and carry no verdict. Rows are by the convention's language (decision D7: Python when any member of its role is Python), not the repo's; only the set's own language carries a verdict. Not a primary held-out run: no verdicts.

| Language | Tier | Repos | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Default tier | 1 | 0 | 0 | 0 | 0 | 0 | **–**; target met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound): **no verdict (no default-tier proposals, n = 0)** | – |
| typescript/javascript | Suggestion tier | 1 | 2 | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| typescript/javascript | All shown (both tiers) | 1 | 2 | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | **100.0% [34.2%–100.0%] (1 repo: no cluster interval)**; target met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3 for D4, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound): **no verdict (not a primary held-out run)** |
| python | Default tier | 30 | 0 | 0 | 0 | 0 | 0 | **–**; target met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound): **no verdict (no default-tier proposals, n = 0)** | – |
| python | Suggestion tier | 30 | 11 | 11 | 10 | 1 | 0 | 90.9% [62.3%–98.4%] (10 repos: bootstrap 70.0%–100.0%, cluster-t 70.1%–100.0%) | 100.0% [74.1%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | All shown (both tiers) | 30 | 11 | 11 | 10 | 1 | 0 | 90.9% [62.3%–98.4%] (10 repos: bootstrap 70.0%–100.0%, cluster-t 70.1%–100.0%) | **100.0% [74.1%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%)**; target met when n ≥ 30 and the quoted lower bound (the widest of Wilson, bootstrap and cluster-t), per language, is ≥ 95% (F3 for D4, PLAN-R14 WS-F: minimum n 30 and the quoted lower bound): **no verdict (not a primary held-out run)** |
| all languages (pooled, secondary) | Default tier | 30 | 0 | 0 | 0 | 0 | 0 | – | – |
| all languages (pooled, secondary) | Suggestion tier | 30 | 13 | 13 | 12 | 1 | 0 | 92.3% [66.7%–98.6%] (10 repos: bootstrap 72.7%–100.0%, cluster-t 74.2%–100.0%) | 100.0% [77.2%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| all languages (pooled, secondary) | All shown (both tiers) | 30 | 13 | 13 | 12 | 1 | 0 | 92.3% [66.7%–98.6%] (10 repos: bootstrap 72.7%–100.0%, cluster-t 74.2%–100.0%) | 100.0% [77.2%–100.0%] (10 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |

With adjudicated items counted as WRONG (F4; 1 adjudicated):

| Language | Default-tier accept | Not-wrong (all shown) |
| --- | --- | --- |
| typescript/javascript | – | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| python | – | 90.9% [62.3%–98.4%] (10 repos: bootstrap 70.0%–100.0%, cluster-t 70.1%–100.0%) |

## Per language, tier and rule family

Rates over all shown, unlabelled counted as WRONG, with Wilson 95% and both repo-cluster 95% intervals (clusters: the repos with a proposal of that family in that tier); quote the wider cluster interval. Secondary to the per-language rows above: no verdict.

| Language | Family | Tier | Shown | ACCEPT | TRIVIAL | WRONG | Accept | Not-wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | Control and typing | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| python | Layering (imports avoided) | Suggestion tier | 2 | 2 | 0 | 0 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| python | Naming | Suggestion tier | 3 | 2 | 1 | 0 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | Control and typing | Suggestion tier | 6 | 6 | 0 | 0 | 100.0% [61.0%–100.0%] (6 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [61.0%–100.0%] (6 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |

## Per framework bucket

Buckets as the manifest records them (`framework_bucket`). Over all shown, unlabelled counted as WRONG; a handful of repos per bucket, so read the cluster intervals.

| Language | Framework bucket | Repos | Shown | Default n | Default-tier accept | Suggestion n | Suggestion accept | Not-wrong (all shown) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript/javascript | fastapi | 1 | 2 | 0 | – | 2 | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) | 100.0% [34.2%–100.0%] (1 repo: no cluster interval) |
| python | django | 10 | 5 | 0 | – | 5 | 100.0% [56.6%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [56.6%–100.0%] (4 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | fastapi | 9 | 3 | 0 | – | 3 | 66.7% [20.8%–93.9%] (3 repos: bootstrap 0.0%–100.0%, cluster-t 0.0%–100.0%) | 100.0% [43.9%–100.0%] (3 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |
| python | flask | 7 | 1 | 0 | – | 1 | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) | 100.0% [20.7%–100.0%] (1 repo: no cluster interval) |
| python | other_python | 4 | 2 | 0 | – | 2 | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) | 100.0% [34.2%–100.0%] (2 repos: bootstrap 100.0%–100.0%, cluster-t 100.0%–100.0%) |

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P02 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P03 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P04 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P05 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P06 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P07 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P08 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P09 | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 0 | – |
| P10 | 3 | 3 | 0 | 0 | 100% [44%–100%] | 100% [44%–100%] | 3 | 0 | – |
| P11 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P12 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P13 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P14 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P15 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P16 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P17 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P18 | 1 | 0 | 1 | 0 | 100% [21%–100%] | 0% [0%–79%] | 0 | 0 | – |
| P19 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P20 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P21 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P22 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P23 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P24 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P25 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P26 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P27 | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 0 | – |
| P28 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P29 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| P30 | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Layering (imports avoided) | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 0 | – |
| Naming | 3 | 2 | 1 | 0 | 67% [21%–94%] | 100% [44%–100%] | 0 | – |
| Control and typing | 8 | 8 | 0 | 0 | 100% [68%–100%] | 100% [68%–100%] | 0 | – |

## Why not accepted

- TRIVIAL by: lint 1
- WRONG because: –
