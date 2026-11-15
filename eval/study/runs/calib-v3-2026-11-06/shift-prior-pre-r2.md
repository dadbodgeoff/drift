# Agreement: eval/study/runs/calib-v3-2026-11-06/prior-prior-pre-r2.jsonl vs eval/study/runs/calib-v3-2026-11-06/v3-final.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 32 |
| Labelled by both | 32 |
| Exact agreement (3 labels) | 46.9% |
| Cohen's κ (3 labels) | 0.21 (fair), bootstrap over 12 repos, 95% 0.05–0.45 |
| ACCEPT vs not: agreement / κ | 59.4% / 0.30 |
| WRONG vs not: agreement / κ | 46.9% / 0.17 |
| Disagreements to adjudicate | 17 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 8 | 0 | 13 |
| TRIVIAL | 0 | 0 | 4 |
| WRONG | 0 | 0 | 7 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 21 | 4 | 7 |
| B | 8 | 0 | 24 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 8 | 25% | D-e25af3 A/W, D-3fad9a T/W, D-a23ff8 A/W, D-024a81 T/W, D-742eb6 A/W, D-79cc0a A/W |
| twenty | 4 | 50% | D-47b768 T/W, D-006db2 T/W |
| documenso | 1 | 100% |  |
| ai | 1 | 100% |  |
| nest | 1 | 0% | D-f68b2a A/W |
| immich | 3 | 33% | D-c10e8e A/W, D-26380c A/W |
| midday | 2 | 50% | D-7da2b9 A/W |
| infisical | 2 | 0% | D-d9b44e A/W, D-1b2542 A/W |
| full-stack-fastapi-template | 1 | 0% | D-6e757d A/W |
| polar | 5 | 100% |  |
| netbox | 2 | 50% | D-bc0c7d A/W |
| saleor | 2 | 50% | D-6af632 A/W |
