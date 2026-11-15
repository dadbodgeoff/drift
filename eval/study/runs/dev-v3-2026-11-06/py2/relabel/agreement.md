# Agreement: eval/study/runs/dev-v3-2026-11-06/py2/relabel/labels/A vs eval/study/runs/dev-v3-2026-11-06/py2/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 76 |
| Labelled by both | 76 |
| Exact agreement (3 labels) | 90.8% |
| Cohen's κ (3 labels) | 0.79 (substantial), bootstrap over 12 repos, 95% 0.66–0.91 |
| ACCEPT vs not: agreement / κ | 90.8% / 0.78 |
| WRONG vs not: agreement / κ | 90.8% / 0.78 |
| Disagreements to adjudicate | 7 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 18 | 0 | 7 |
| TRIVIAL | 0 | 1 | 0 |
| WRONG | 0 | 0 | 50 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 25 | 1 | 50 |
| B | 18 | 1 | 57 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| Django-CRM | 9 | 78% | D-f135a4 A/W, D-8ee062 A/W |
| InvenTree | 11 | 100% |  |
| ralph | 6 | 100% |  |
| Misago | 8 | 88% | D-90a5d9 A/W |
| paperless-ngx | 3 | 100% |  |
| wger | 3 | 100% |  |
| lotus | 4 | 75% | D-e5b6fe A/W |
| pontoon | 2 | 100% |  |
| open-wearables | 8 | 88% | D-3b39dc A/W |
| tasking-manager | 9 | 78% | D-cfe608 A/W, D-c373f7 A/W |
| simplelogin | 10 | 100% |  |
| changedetection.io | 3 | 100% |  |
