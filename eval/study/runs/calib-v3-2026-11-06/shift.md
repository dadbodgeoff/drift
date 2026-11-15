# Agreement: eval/study/runs/calib-v3-2026-11-06/prior.jsonl vs eval/study/runs/calib-v3-2026-11-06/v3-final.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 61 |
| Labelled by both | 61 |
| Exact agreement (3 labels) | 63.9% |
| Cohen's κ (3 labels) | 0.38 (fair), bootstrap over 16 repos, 95% 0.17–0.58 |
| ACCEPT vs not: agreement / κ | 70.5% / 0.45 |
| WRONG vs not: agreement / κ | 63.9% / 0.36 |
| Disagreements to adjudicate | 22 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 19 | 0 | 18 |
| TRIVIAL | 0 | 0 | 4 |
| WRONG | 0 | 0 | 20 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 37 | 4 | 20 |
| B | 19 | 0 | 42 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 8 | 25% | D-e25af3 A/W, D-3fad9a T/W, D-a23ff8 A/W, D-024a81 T/W, D-742eb6 A/W, D-79cc0a A/W |
| twenty | 5 | 60% | D-47b768 T/W, D-006db2 T/W |
| cal.com | 3 | 100% |  |
| documenso | 3 | 100% |  |
| ai | 2 | 50% | D-fc5ef7 A/W |
| nest | 1 | 0% | D-f68b2a A/W |
| supabase | 3 | 67% | D-c59437 A/W |
| novu | 1 | 100% |  |
| immich | 3 | 33% | D-c10e8e A/W, D-26380c A/W |
| midday | 6 | 83% | D-7da2b9 A/W |
| infisical | 2 | 0% | D-d9b44e A/W, D-1b2542 A/W |
| full-stack-fastapi-template | 1 | 0% | D-6e757d A/W |
| polar | 11 | 91% | D-fb4011 A/W |
| netbox | 8 | 75% | D-cc1341 A/W, D-bc0c7d A/W |
| saleor | 3 | 67% | D-6af632 A/W |
| langchain | 1 | 0% | D-468530 A/W |
