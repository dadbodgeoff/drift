# Agreement: eval/study/runs/heldout2-py-2026-11-08/labels/A vs eval/study/runs/heldout2-py-2026-11-08/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 43 |
| Labelled by both | 43 |
| Exact agreement (3 labels) | 93.0% |
| Cohen's κ (3 labels) | 0.88 (almost perfect), bootstrap over 9 repos, 95% 0.76–1.00 |
| ACCEPT vs not: agreement / κ | 93.0% / 0.85 |
| WRONG vs not: agreement / κ | 95.3% / 0.91 |
| Disagreements to adjudicate | 3 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 14 | 0 | 2 |
| TRIVIAL | 1 | 4 | 0 |
| WRONG | 0 | 0 | 22 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 16 | 5 | 22 |
| B | 15 | 4 | 24 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| statsmodels | 3 | 100% |  |
| flagsmith | 3 | 100% |  |
| kunlun-m | 1 | 100% |  |
| django-oscar | 1 | 100% |  |
| dcs_liberation | 6 | 83% | D-0de628 A/W |
| supoclip | 3 | 100% |  |
| vmlx | 8 | 88% | D-5e79e4 T/A |
| fenic | 5 | 100% |  |
| future-agi | 13 | 92% | D-12246d A/W |
