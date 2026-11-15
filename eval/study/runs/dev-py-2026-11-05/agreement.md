# Agreement: eval/study/runs/dev-py-2026-11-05/labels/A vs eval/study/runs/dev-py-2026-11-05/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 53 |
| Labelled by both | 53 |
| Exact agreement (3 labels) | 88.7% |
| Cohen's κ (3 labels) | 0.77 (substantial), bootstrap over 8 repos, 95% 0.45–1.00 |
| ACCEPT vs not: agreement / κ | 88.7% / 0.77 |
| WRONG vs not: agreement / κ | 88.7% / 0.77 |
| Disagreements to adjudicate | 6 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 19 | 0 | 6 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 28 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 25 | 0 | 28 |
| B | 19 | 0 | 34 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| full-stack-fastapi-template | 1 | 100% |  |
| polar | 15 | 100% |  |
| netbox | 15 | 80% | D-bc0c7d A/W, D-0eddf0 A/W, D-7d7f0c A/W |
| saleor | 14 | 100% |  |
| CTFd | 5 | 40% | D-49130f A/W, D-bd2596 A/W, D-ce2984 A/W |
| flask | 1 | 100% |  |
| fastapi | 1 | 100% |  |
| langchain | 1 | 100% |  |
