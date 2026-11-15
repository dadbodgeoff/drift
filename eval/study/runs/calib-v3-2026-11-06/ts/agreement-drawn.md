# Agreement: eval/study/runs/calib-v3-2026-11-06/ts/drawn-A.jsonl vs eval/study/runs/calib-v3-2026-11-06/ts/drawn-B.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 20 |
| Labelled by both | 20 |
| Exact agreement (3 labels) | 95.0% |
| Cohen's κ (3 labels) | 0.89 (almost perfect), bootstrap over 9 repos, 95% 0.69–1.00 |
| ACCEPT vs not: agreement / κ | 95.0% / 0.89 |
| WRONG vs not: agreement / κ | 95.0% / 0.89 |
| Disagreements to adjudicate | 1 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 7 | 0 | 0 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 1 | 0 | 12 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 7 | 0 | 13 |
| B | 8 | 0 | 12 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| ai | 1 | 100% |  |
| cal.com | 3 | 100% |  |
| documenso | 3 | 67% | D-2a51e9 W/A |
| dub | 3 | 100% |  |
| immich | 2 | 100% |  |
| midday | 4 | 100% |  |
| nest | 1 | 100% |  |
| supabase | 2 | 100% |  |
| twenty | 1 | 100% |  |
