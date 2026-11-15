# Recall against documented conventions: eval/study/runs/heldout-py-2026-11-07

- 669 documented, code-checkable, enabled items in 10 repos

|  | Items | Recall@shown strict | Recall@shown lenient | Recall@pool strict | Recall@pool lenient |
| --- | --- | --- | --- | --- | --- |
| All documented | 669 | 0% [0%–1%] (repo bootstrap 0%–0%) | 0% [0%–1%] (repo bootstrap 0%–1%) | 0% [0%–1%] (repo bootstrap 0%–0%) | 0% [0%–1%] (repo bootstrap 0%–1%) |
| Followed by the code | 522 | 0% [0%–1%] (repo bootstrap 0%–0%) | 0% [0%–1%] (repo bootstrap 0%–1%) | 0% [0%–1%] (repo bootstrap 0%–0%) | 0% [0%–1%] (repo bootstrap 0%–1%) |
| From lint configs | 274 | 0% [0%–1%] | 0% [0%–1%] | 0% [0%–1%] | 0% [0%–1%] |
| From prose (AGENTS.md, CONTRIBUTING...) | 395 | 0% [0%–1%] | 1% [0%–2%] | 0% [0%–1%] | 1% [0%–2%] |

## Per repo

| Repo | Items | Followed | @shown strict | @shown lenient | @pool lenient |
| --- | --- | --- | --- | --- | --- |
| codex-autorunner | 160 | 112 | 0% [0%–2%] | 0% [0%–2%] | 0% [0%–2%] |
| dbt-charts | 165 | 135 | 1% [0%–3%] | 1% [0%–3%] | 1% [0%–3%] |
| aws-parallelcluster | 52 | 46 | 0% [0%–7%] | 0% [0%–7%] | 0% [0%–7%] |
| taos | 91 | 70 | 0% [0%–4%] | 0% [0%–4%] | 0% [0%–4%] |
| veritasgraph | 31 | 20 | 0% [0%–11%] | 0% [0%–11%] | 0% [0%–11%] |
| ods | 89 | 66 | 0% [0%–4%] | 0% [0%–4%] | 0% [0%–4%] |
| platypush | 9 | 9 | 0% [0%–30%] | 11% [2%–43%] | 11% [2%–43%] |
| trimesh | 24 | 24 | 0% [0%–14%] | 0% [0%–14%] | 0% [0%–14%] |
| freesound | 35 | 30 | 0% [0%–10%] | 0% [0%–10%] | 0% [0%–10%] |
| cosmos-transfer1 | 13 | 10 | 0% [0%–23%] | 0% [0%–23%] | 0% [0%–23%] |

## Per category

| Category | Items | @shown lenient | @pool lenient |
| --- | --- | --- | --- |
| argument | 13 | 0% [0%–23%] | 0% [0%–23%] |
| avoid | 106 | 0% [0%–3%] | 0% [0%–3%] |
| base_class | 10 | 0% [0%–28%] | 0% [0%–28%] |
| calls | 44 | 2% [0%–12%] | 2% [0%–12%] |
| decorator | 6 | 0% [0%–39%] | 0% [0%–39%] |
| error_handling | 34 | 0% [0%–10%] | 0% [0%–10%] |
| file_layout | 44 | 0% [0%–8%] | 0% [0%–8%] |
| import_restriction | 53 | 0% [0%–7%] | 0% [0%–7%] |
| layering | 55 | 0% [0%–7%] | 0% [0%–7%] |
| naming | 32 | 3% [1%–16%] | 3% [1%–16%] |
| other | 155 | 0% [0%–2%] | 0% [0%–2%] |
| render | 34 | 0% [0%–10%] | 0% [0%–10%] |
| testing | 31 | 0% [0%–11%] | 0% [0%–11%] |
| typing | 50 | 0% [0%–7%] | 0% [0%–7%] |
| wrapper | 2 | 0% [0%–66%] | 0% [0%–66%] |

## Precision labels against the repo's own policy

| Shown proposals | n | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- | --- |
| Match a documented convention | 2 | 0 | 0 | 2 |
| No documented counterpart | 42 | 23 | 2 | 17 |

Labelled WRONG although the repo documents the convention (check the label, the match, or whether the doc is stale):
- dbt-charts/D-0f5597 (dbt-charts#R175): Diagnostic code constants (ERR_ANNOTATION_INVALID, codes_render/codes_query entries) are REGISTRY.register(...) results, but every outlier is a plain lookup table or constant (dialect notes dict in codes_execute.py, retired-code frozenset, successor maps in hints.py) that is not a diagnostic code and must not be registered. 0 of 7 are mistakes.
- platypush/D-84701e (platypush#R06): Plugin classes are *Plugin (NgrokPlugin, LinodePlugin), but plugin __init__ files routinely hold helper classes: a config class (ipcam AndroidIpcam), an ORM model (github GithubResource), a factory and preview writers (camera preview), listeners, a searcher and utils; 0 of 9 counted outliers are mistakes.

Second matcher on 360 items: agreement 100%, κ 0.50

Second extractor (in-scope items, E1/E2): dbt-charts 165/180, aws-parallelcluster 52/58, ods 89/70
