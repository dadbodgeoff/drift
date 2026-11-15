# Agreement: eval/study/runs/calib-v3-2026-11-06/py/labels/A vs eval/study/runs/calib-v3-2026-11-06/py/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 26 |
| Labelled by both | 24 (missing: A 2, B 2) |
| Exact agreement (3 labels) | 95.8% |
| Cohen's κ (3 labels) | 0.90 (almost perfect), bootstrap over 5 repos, 95% 0.84–1.00 |
| ACCEPT vs not: agreement / κ | 95.8% / 0.90 |
| WRONG vs not: agreement / κ | 95.8% / 0.90 |
| Disagreements to adjudicate | 1 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 7 | 0 | 1 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 16 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 8 | 0 | 16 |
| B | 7 | 0 | 17 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 100% |  |
| polar | 11 | 91% | D-093712 A/W |
| netbox | 8 | 100% |  |
| saleor | 3 | 100% |  |
| langchain | 1 | 100% |  |
