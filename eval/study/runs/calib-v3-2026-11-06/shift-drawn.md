# Agreement: eval/study/runs/calib-v3-2026-11-06/prior-drawn.jsonl vs eval/study/runs/calib-v3-2026-11-06/v3-final.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 40 |
| Labelled by both | 40 |
| Exact agreement (3 labels) | 72.5% |
| Cohen's κ (3 labels) | 0.49 (moderate), bootstrap over 13 repos, 95% 0.18–0.74 |
| ACCEPT vs not: agreement / κ | 72.5% / 0.49 |
| WRONG vs not: agreement / κ | 72.5% / 0.49 |
| Disagreements to adjudicate | 11 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 16 | 0 | 11 |
| TRIVIAL | 0 | 0 | 0 |
| WRONG | 0 | 0 | 13 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 27 | 0 | 13 |
| B | 16 | 0 | 24 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 3 | 33% | D-742eb6 A/W, D-79cc0a A/W |
| twenty | 1 | 100% |  |
| cal.com | 3 | 100% |  |
| documenso | 3 | 100% |  |
| ai | 1 | 100% |  |
| nest | 1 | 0% | D-f68b2a A/W |
| supabase | 2 | 50% | D-c59437 A/W |
| immich | 2 | 0% | D-c10e8e A/W, D-26380c A/W |
| midday | 4 | 75% | D-7da2b9 A/W |
| full-stack-fastapi-template | 1 | 0% | D-6e757d A/W |
| polar | 10 | 100% |  |
| netbox | 7 | 71% | D-cc1341 A/W, D-bc0c7d A/W |
| saleor | 2 | 50% | D-6af632 A/W |
