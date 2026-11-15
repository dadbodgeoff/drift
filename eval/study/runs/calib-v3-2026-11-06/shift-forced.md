# Agreement: eval/study/runs/calib-v3-2026-11-06/prior-forced.jsonl vs eval/study/runs/calib-v3-2026-11-06/v3-final.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 21 |
| Labelled by both | 21 |
| Exact agreement (3 labels) | 47.6% |
| Cohen's κ (3 labels) | 0.19 (slight), bootstrap over 12 repos, 95% 0.00–0.47 |
| ACCEPT vs not: agreement / κ | 66.7% / 0.31 |
| WRONG vs not: agreement / κ | 47.6% / 0.15 |
| Disagreements to adjudicate | 11 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 3 | 0 | 7 |
| TRIVIAL | 0 | 0 | 4 |
| WRONG | 0 | 0 | 7 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 10 | 4 | 7 |
| B | 3 | 0 | 18 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 5 | 20% | D-e25af3 A/W, D-3fad9a T/W, D-a23ff8 A/W, D-024a81 T/W |
| twenty | 4 | 50% | D-47b768 T/W, D-006db2 T/W |
| ai | 1 | 0% | D-fc5ef7 A/W |
| supabase | 1 | 100% |  |
| novu | 1 | 100% |  |
| immich | 1 | 100% |  |
| midday | 2 | 100% |  |
| infisical | 2 | 0% | D-d9b44e A/W, D-1b2542 A/W |
| polar | 1 | 0% | D-fb4011 A/W |
| netbox | 1 | 100% |  |
| saleor | 1 | 100% |  |
| langchain | 1 | 0% | D-468530 A/W |
