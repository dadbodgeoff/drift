# Agreement: eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel/labels/A vs eval/study/runs/dev-v3-relabel5-2026-11-07/py2/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 24 |
| Labelled by both | 24 |
| Exact agreement (3 labels) | 75.0% |
| Cohen's κ (3 labels) | 0.44 (moderate), bootstrap over 10 repos, 95% 0.00–0.82 |
| ACCEPT vs not: agreement / κ | 75.0% / 0.44 |
| WRONG vs not: agreement / κ | 75.0% / 0.44 |
| Disagreements to adjudicate | 6 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 14 | 0 | 6 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 4 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 20 | 0 | 4 |
| B | 14 | 0 | 10 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| Django-CRM | 1 | 100% |  |
| InvenTree | 6 | 83% | D-90cbee A/W |
| ralph | 4 | 100% |  |
| Misago | 4 | 25% | D-d8703c A/W, D-c9ae1e A/W, D-e72fc8 A/W |
| paperless-ngx | 3 | 67% | D-0dfb1b A/W |
| wger | 1 | 100% |  |
| lotus | 1 | 100% |  |
| pontoon | 1 | 100% |  |
| tasking-manager | 2 | 100% |  |
| changedetection.io | 1 | 0% | D-129993 A/W |
