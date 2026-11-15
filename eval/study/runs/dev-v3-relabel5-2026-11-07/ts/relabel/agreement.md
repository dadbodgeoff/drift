# Agreement: eval/study/runs/dev-v3-relabel5-2026-11-07/ts/relabel/labels/A vs eval/study/runs/dev-v3-relabel5-2026-11-07/ts/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 80 |
| Labelled by both | 80 |
| Exact agreement (3 labels) | 87.5% |
| Cohen's κ (3 labels) | 0.76 (substantial), bootstrap over 12 repos, 95% 0.53–0.92 |
| ACCEPT vs not: agreement / κ | 87.5% / 0.74 |
| WRONG vs not: agreement / κ | 88.8% / 0.75 |
| Disagreements to adjudicate | 10 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 44 | 1 | 8 |
| TRIVIAL | 0 | 4 | 0 |
| WRONG | 1 | 0 | 22 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 53 | 4 | 23 |
| B | 45 | 5 | 30 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 14 | 100% |  |
| twenty | 5 | 100% |  |
| formbricks | 7 | 71% | D-ec0946 A/W, D-514f45 W/A |
| cal.com | 8 | 63% | D-85e09a A/W, D-5722ba A/T, D-8d7d13 A/W |
| documenso | 6 | 100% |  |
| ai | 3 | 100% |  |
| nest | 1 | 100% |  |
| supabase | 6 | 67% | D-e93eb6 A/W, D-922bc7 A/W |
| novu | 12 | 83% | D-dbba9a A/W, D-3f3e16 A/W |
| immich | 2 | 100% |  |
| midday | 5 | 80% | D-f90103 A/W |
| infisical | 11 | 100% |  |
