# Precision: eval/study/runs/dev-2026-11-05

- drift: drift 0.1.0-dev commit 2e83ec292b6561338f68a8122d2456afcd2bc45c, binary sha256 a343b8633a87
- manifest: eval/repos.json, 16 repos ok
- labels: eval/study/labels.jsonl (230 records; 50 not in this run's queue, ignored)
- default tier: role has ≥ 15 members (pre-registered)

## Overall

|  | Shown | Labelled | ACCEPT | TRIVIAL | WRONG | Not-wrong rate | Accept rate | Yield (ACCEPT/repo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All proposals | 181 | 180 | 108 | 29 | 43 | 76.1% [69.4%–81.8%] (14 repos: bootstrap 71.0%–81.2%, cluster-t 70.3%–81.9%) | 60.0% [52.7%–66.9%] (14 repos: bootstrap 54.5%–66.5%, cluster-t 53.3%–66.7%) | 6.5 mean, 8 median, 2/15 repos with none (1 partly labelled repos excluded) |
| Default tier (≥ 15 members, pre-registered) | 181 | 180 | 108 | 29 | 43 | 76.1% [69.4%–81.8%] (14 repos: bootstrap 71.0%–81.2%, cluster-t 70.3%–81.9%) | 60.0% [52.7%–66.9%] (14 repos: bootstrap 54.5%–66.5%, cluster-t 53.3%–66.7%) | 6.5 mean, 8 median, 2/15 repos with none (1 partly labelled repos excluded) |

**1 shown proposals have no label** (excluded above). Over all 181 shown, with the unlabelled counted as WRONG (the target definition) / as ACCEPT:

|  | Not-wrong | Accept |
| --- | --- | --- |
| All proposals, unlabelled = WRONG | 75.7% [68.9%–81.4%] (14 repos: bootstrap 71.0%–80.3%, cluster-t 70.4%–81.0%) | 59.7% [52.4%–66.5%] (14 repos: bootstrap 54.4%–65.8%, cluster-t 53.4%–66.0%) |
| Default tier, unlabelled = WRONG | 75.7% [68.9%–81.4%] (14 repos: bootstrap 71.0%–80.3%, cluster-t 70.4%–81.0%) | 59.7% [52.4%–66.5%] (14 repos: bootstrap 54.4%–65.8%, cluster-t 53.4%–66.0%) |
| All proposals, unlabelled = ACCEPT (upper bound) | 76.2% | 60.2% |

Unlabelled: novu/D-b386b6

## Per repo

| Repo | Shown | A | T | W | Not-wrong | Accept | Yield | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 15 | 8 | 5 | 2 | 87% [62%–96%] | 53% [30%–75%] | 8 | 15 | 53% [30%–75%] |
| twenty | 15 | 8 | 2 | 5 | 67% [42%–85%] | 53% [30%–75%] | 8 | 15 | 53% [30%–75%] |
| formbricks | 15 | 10 | 1 | 4 | 73% [48%–89%] | 67% [42%–85%] | 10 | 15 | 67% [42%–85%] |
| cal.com | 15 | 9 | 1 | 5 | 67% [42%–85%] | 60% [36%–80%] | 9 | 15 | 60% [36%–80%] |
| documenso | 15 | 9 | 3 | 3 | 80% [55%–93%] | 60% [36%–80%] | 9 | 15 | 60% [36%–80%] |
| excalidraw | 2 | 2 | 0 | 0 | 100% [34%–100%] | 100% [34%–100%] | 2 | 2 | 100% [34%–100%] |
| create-t3-app | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| ai | 15 | 7 | 2 | 6 | 60% [36%–80%] | 47% [25%–70%] | 7 | 15 | 47% [25%–70%] |
| trpc | 1 | 1 | 0 | 0 | 100% [21%–100%] | 100% [21%–100%] | 1 | 1 | 100% [21%–100%] |
| nest | 13 | 6 | 4 | 3 | 77% [50%–92%] | 46% [23%–71%] | 6 | 13 | 46% [23%–71%] |
| supabase | 15 | 8 | 3 | 4 | 73% [48%–89%] | 53% [30%–75%] | 8 | 15 | 53% [30%–75%] |
| node-express-boilerplate | 0 | 0 | 0 | 0 | – | – | 0 | 0 | – |
| novu | 15 | 11 | 2 | 1 | 93% [69%–99%] | 79% [52%–92%] | 11 | 15 | 79% [52%–92%] |
| immich | 15 | 8 | 3 | 4 | 73% [48%–89%] | 53% [30%–75%] | 8 | 15 | 53% [30%–75%] |
| midday | 15 | 9 | 2 | 4 | 73% [48%–89%] | 60% [36%–80%] | 9 | 15 | 60% [36%–80%] |
| infisical | 15 | 12 | 1 | 2 | 87% [62%–96%] | 80% [55%–93%] | 12 | 15 | 80% [55%–93%] |

## Per rule family

| Family | n | A | T | W | Accept | Not-wrong | Tier n | Tier accept |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Call wrappers | 22 | 20 | 0 | 2 | 91% [72%–97%] | 91% [72%–97%] | 22 | 91% [72%–97%] |
| Decorators | 22 | 13 | 6 | 3 | 59% [39%–77%] | 86% [67%–95%] | 22 | 59% [39%–77%] |
| Base classes | 11 | 9 | 0 | 2 | 82% [52%–95%] | 82% [52%–95%] | 11 | 82% [52%–95%] |
| Argument keys | 16 | 11 | 2 | 3 | 69% [44%–86%] | 81% [57%–93%] | 16 | 69% [44%–86%] |
| Layering (imports avoided) | 13 | 8 | 0 | 5 | 62% [36%–82%] | 62% [36%–82%] | 13 | 62% [36%–82%] |
| Rendered components | 13 | 7 | 6 | 0 | 54% [29%–77%] | 100% [77%–100%] | 13 | 54% [29%–77%] |
| Rendered inside a wrapper | 5 | 3 | 1 | 1 | 60% [23%–88%] | 80% [38%–96%] | 5 | 60% [23%–88%] |
| Calls | 27 | 12 | 6 | 9 | 44% [28%–63%] | 67% [48%–81%] | 27 | 44% [28%–63%] |
| Naming | 24 | 10 | 4 | 9 | 43% [26%–63%] | 61% [41%–78%] | 24 | 43% [26%–63%] |
| Other avoidance (any, console, bare Error) | 13 | 4 | 2 | 7 | 31% [13%–58%] | 46% [23%–71%] | 13 | 31% [13%–58%] |
| Control and typing | 6 | 6 | 0 | 0 | 100% [61%–100%] | 100% [61%–100%] | 6 | 100% [61%–100%] |
| Package and repo facts | 9 | 5 | 2 | 2 | 56% [27%–81%] | 78% [45%–94%] | 9 | 56% [27%–81%] |
