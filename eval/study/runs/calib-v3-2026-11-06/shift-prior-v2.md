# Agreement: eval/study/runs/calib-v3-2026-11-06/prior-prior-v2.jsonl vs eval/study/runs/calib-v3-2026-11-06/v3-final.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 29 |
| Labelled by both | 29 |
| Exact agreement (3 labels) | 82.8% |
| Cohen's κ (3 labels) | 0.66 (substantial), bootstrap over 11 repos, 95% 0.39–0.85 |
| ACCEPT vs not: agreement / κ | 82.8% / 0.66 |
| WRONG vs not: agreement / κ | 82.8% / 0.66 |
| Disagreements to adjudicate | 5 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 11 | 0 | 5 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 13 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 16 | 0 | 13 |
| B | 11 | 0 | 18 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| twenty | 1 | 100% |  |
| cal.com | 3 | 100% |  |
| documenso | 2 | 100% |  |
| ai | 1 | 0% | D-fc5ef7 A/W |
| supabase | 3 | 67% | D-c59437 A/W |
| novu | 1 | 100% |  |
| midday | 4 | 100% |  |
| polar | 6 | 83% | D-fb4011 A/W |
| netbox | 6 | 83% | D-cc1341 A/W |
| saleor | 1 | 100% |  |
| langchain | 1 | 0% | D-468530 A/W |
