# Agreement: eval/study/runs/dev-v3-relabel2-2026-11-07/ts/relabel/labels/A vs eval/study/runs/dev-v3-relabel2-2026-11-07/ts/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 53 |
| Labelled by both | 53 |
| Exact agreement (3 labels) | 94.3% |
| Cohen's κ (3 labels) | 0.89 (almost perfect), bootstrap over 11 repos, 95% 0.77–1.00 |
| ACCEPT vs not: agreement / κ | 94.3% / 0.88 |
| WRONG vs not: agreement / κ | 94.3% / 0.88 |
| Disagreements to adjudicate | 3 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 20 | 0 | 3 |
| TRIVIAL | 0 | 1 | 0 |
| WRONG | 0 | 0 | 29 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 23 | 1 | 29 |
| B | 20 | 1 | 32 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 6 | 100% |  |
| twenty | 11 | 91% | D-70d216 A/W |
| cal.com | 6 | 100% |  |
| documenso | 2 | 50% | D-4785b8 A/W |
| ai | 2 | 100% |  |
| nest | 1 | 100% |  |
| supabase | 2 | 100% |  |
| novu | 8 | 88% | D-dbba9a A/W |
| immich | 1 | 100% |  |
| midday | 5 | 100% |  |
| infisical | 9 | 100% |  |
