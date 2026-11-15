# Agreement: eval/study/runs/dev-v3-2026-11-06/py/relabel/labels/A vs eval/study/runs/dev-v3-2026-11-06/py/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 20 |
| Labelled by both | 18 (missing: A 2, B 2) |
| Exact agreement (3 labels) | 83.3% |
| Cohen's κ (3 labels) | 0.64 (substantial), bootstrap over 4 repos, 95% 0.00–1.00 |
| ACCEPT vs not: agreement / κ | 83.3% / 0.64 |
| WRONG vs not: agreement / κ | 83.3% / 0.64 |
| Disagreements to adjudicate | 3 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 5 | 0 | 1 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 2 | 0 | 10 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 6 | 0 | 12 |
| B | 7 | 0 | 11 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| polar | 6 | 100% |  |
| netbox | 7 | 86% | D-cc8d72 A/W |
| saleor | 4 | 50% | D-e86c5d W/A, D-0da0cf W/A |
| fastapi | 1 | 100% |  |
