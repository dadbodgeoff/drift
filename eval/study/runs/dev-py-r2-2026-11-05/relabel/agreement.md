# Agreement: eval/study/runs/dev-py-r2-2026-11-05/relabel/labels/A vs eval/study/runs/dev-py-r2-2026-11-05/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 22 |
| Labelled by both | 22 |
| Exact agreement (3 labels) | 81.8% |
| Cohen's κ (3 labels) | 0.64 (substantial), bootstrap over 5 repos, 95% 0.15–0.81 |
| ACCEPT vs not: agreement / κ | 81.8% / 0.64 |
| WRONG vs not: agreement / κ | 81.8% / 0.64 |
| Disagreements to adjudicate | 4 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 9 | 0 | 2 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 2 | 0 | 9 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 11 | 0 | 11 |
| B | 11 | 0 | 11 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| polar | 6 | 83% | D-fb4011 W/A |
| netbox | 11 | 91% | D-310ec7 W/A |
| saleor | 1 | 0% | D-e36ea5 A/W |
| CTFd | 2 | 100% |  |
| langchain | 2 | 50% | D-468530 A/W |
