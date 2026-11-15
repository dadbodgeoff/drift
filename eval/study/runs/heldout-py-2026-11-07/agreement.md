# Agreement: eval/study/runs/heldout-py-2026-11-07/labels/A vs eval/study/runs/heldout-py-2026-11-07/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 44 |
| Labelled by both | 44 |
| Exact agreement (3 labels) | 88.6% |
| Cohen's κ (3 labels) | 0.79 (substantial), bootstrap over 9 repos, 95% 0.62–0.95 |
| ACCEPT vs not: agreement / κ | 90.9% / 0.82 |
| WRONG vs not: agreement / κ | 88.6% / 0.77 |
| Disagreements to adjudicate | 5 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 19 | 0 | 3 |
| TRIVIAL | 0 | 1 | 0 |
| WRONG | 1 | 1 | 19 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 22 | 1 | 21 |
| B | 20 | 2 | 22 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| codex-autorunner | 1 | 100% |  |
| dbt-charts | 5 | 80% | D-e818b0 W/A |
| aws-parallelcluster | 7 | 86% | D-51bdb8 A/W |
| taos | 8 | 100% |  |
| veritasgraph | 5 | 80% | D-1d585e W/T |
| ods | 7 | 71% | D-4c758e A/W, D-6e9535 A/W |
| platypush | 7 | 100% |  |
| freesound | 1 | 100% |  |
| cosmos-transfer1 | 3 | 100% |  |
