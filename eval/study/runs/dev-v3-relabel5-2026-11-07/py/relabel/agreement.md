# Agreement: eval/study/runs/dev-v3-relabel5-2026-11-07/py/relabel/labels/A vs eval/study/runs/dev-v3-relabel5-2026-11-07/py/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 12 |
| Labelled by both | 12 |
| Exact agreement (3 labels) | 100.0% |
| Cohen's κ (3 labels) | 1.00 (almost perfect), bootstrap over 3 repos, 95% 1.00–1.00 |
| ACCEPT vs not: agreement / κ | 100.0% / 1.00 |
| WRONG vs not: agreement / κ | 100.0% / 1.00 |
| Disagreements to adjudicate | 0 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 8 | 0 | 0 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 4 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 8 | 0 | 4 |
| B | 8 | 0 | 4 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| netbox | 10 | 100% |  |
| saleor | 1 | 100% |  |
| fastapi | 1 | 100% |  |
