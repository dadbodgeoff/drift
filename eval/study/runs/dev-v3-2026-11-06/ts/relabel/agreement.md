# Agreement: eval/study/runs/dev-v3-2026-11-06/ts/relabel/labels/A vs eval/study/runs/dev-v3-2026-11-06/ts/relabel/labels/B

|  |  |
| --- | --- |
| Proposals in scope | 125 |
| Labelled by both | 125 |
| Exact agreement (3 labels) | 92.0% |
| Cohen's κ (3 labels) | 0.84 (almost perfect), bootstrap over 13 repos, 95% 0.70–0.95 |
| ACCEPT vs not: agreement / κ | 92.0% / 0.84 |
| WRONG vs not: agreement / κ | 92.8% / 0.86 |
| Disagreements to adjudicate | 10 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 52 | 1 | 5 |
| TRIVIAL | 0 | 1 | 0 |
| WRONG | 4 | 0 | 62 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 58 | 1 | 66 |
| B | 56 | 2 | 67 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 7 | 71% | D-50df58 A/W, D-d24d21 A/W |
| twenty | 10 | 100% |  |
| formbricks | 15 | 100% |  |
| cal.com | 12 | 75% | D-0b36fb W/A, D-5722ba A/T, D-fafac1 W/A |
| documenso | 12 | 100% |  |
| excalidraw | 2 | 100% |  |
| ai | 4 | 100% |  |
| nest | 4 | 50% | D-44a46d W/A, D-48b32a W/A |
| supabase | 12 | 100% |  |
| novu | 14 | 86% | D-3f3e16 A/W, D-dbba9a A/W |
| immich | 11 | 91% | D-d3f2f9 A/W |
| midday | 9 | 100% |  |
| infisical | 13 | 100% |  |
