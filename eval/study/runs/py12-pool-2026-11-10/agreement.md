# Agreement: /tmp/claude-0/-home-user/4171c86d-7359-5961-a82e-0bb2a6a458e2/scratchpad/w4-mining/label/run-base/labels/A vs /tmp/claude-0/-home-user/4171c86d-7359-5961-a82e-0bb2a6a458e2/scratchpad/w4-mining/label/run-base/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 55 |
| Labelled by both | 55 |
| Exact agreement (3 labels) | 80.0% |
| Cohen's κ (3 labels) | 0.60, bootstrap over 17 repos, 95% 0.37–0.81 |
| Gwet's AC1 (3 labels) | 0.73, bootstrap over 17 repos, 95% 0.58–0.87 |
| ACCEPT vs not: agreement / κ / AC1 | 80.0% / 0.60 / 0.60 |
| WRONG vs not: agreement / κ / AC1 | 80.0% / 0.60 / 0.60 |
| Disagreements to adjudicate | 11 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 20 | 0 | 8 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 3 | 0 | 24 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 28 | 0 | 27 |
| B | 23 | 0 | 32 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| L01 | 1 | 100% |  |
| L02 | 2 | 50% | D-2d3433 A/W |
| L03 | 2 | 100% |  |
| L04 | 3 | 100% |  |
| L05 | 5 | 80% | D-f6962f A/W |
| L06 | 1 | 100% |  |
| L07 | 1 | 100% |  |
| L08 | 2 | 50% | D-c55373 A/W |
| L09 | 4 | 75% | D-8a3bd9 W/A |
| L10 | 1 | 100% |  |
| L11 | 4 | 100% |  |
| L12 | 10 | 90% | D-514683 A/W |
| L13 | 8 | 50% | D-db73ae A/W, D-e0fe86 A/W, D-9229df W/A, D-faf7b3 A/W |
| L14 | 1 | 0% | D-7bdafb A/W |
| L15 | 3 | 100% |  |
| L16 | 6 | 83% | D-20b2f2 W/A |
| L17 | 1 | 100% |  |
