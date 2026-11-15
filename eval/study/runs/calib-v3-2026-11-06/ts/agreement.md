# Agreement: eval/study/runs/calib-v3-2026-11-06/ts/labels/A vs eval/study/runs/calib-v3-2026-11-06/ts/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 37 |
| Labelled by both | 37 |
| Exact agreement (3 labels) | 97.3% |
| Cohen's κ (3 labels) | 0.93 (almost perfect), bootstrap over 11 repos, 95% 0.78–1.00 |
| ACCEPT vs not: agreement / κ | 97.3% / 0.93 |
| WRONG vs not: agreement / κ | 97.3% / 0.93 |
| Disagreements to adjudicate | 1 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 10 | 0 | 0 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 1 | 0 | 26 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 10 | 0 | 27 |
| B | 11 | 0 | 26 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 8 | 100% |  |
| twenty | 5 | 100% |  |
| cal.com | 3 | 100% |  |
| documenso | 3 | 67% | D-2a51e9 W/A |
| ai | 2 | 100% |  |
| nest | 1 | 100% |  |
| supabase | 3 | 100% |  |
| novu | 1 | 100% |  |
| immich | 3 | 100% |  |
| midday | 6 | 100% |  |
| infisical | 2 | 100% |  |
