# Agreement: eval/study/runs/calib-v3-2026-11-06/py/drawn-A.jsonl vs eval/study/runs/calib-v3-2026-11-06/py/drawn-B.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 20 |
| Labelled by both | 20 |
| Exact agreement (3 labels) | 95.0% |
| Cohen's κ (3 labels) | 0.89 (almost perfect), bootstrap over 4 repos, 95% 0.81–1.00 |
| ACCEPT vs not: agreement / κ | 95.0% / 0.89 |
| WRONG vs not: agreement / κ | 95.0% / 0.89 |
| Disagreements to adjudicate | 1 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 7 | 0 | 1 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 12 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 8 | 0 | 12 |
| B | 7 | 0 | 13 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 100% |  |
| netbox | 7 | 100% |  |
| polar | 10 | 90% | D-093712 A/W |
| saleor | 2 | 100% |  |
