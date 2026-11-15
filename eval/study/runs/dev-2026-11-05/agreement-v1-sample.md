# Agreement: eval/study/labels.jsonl vs eval/study/second-opinion.jsonl

|  |  |
| --- | --- |
| Proposals in scope | 40 |
| Labelled by both | 40 |
| Exact agreement (3 labels) | 72.5% |
| Cohen's κ (3 labels) | 0.51 (moderate), bootstrap over 12 repos, 95% 0.15–0.77 |
| ACCEPT vs not: agreement / κ | 75.0% / 0.48 |
| WRONG vs not: agreement / κ | 92.5% / 0.79 |
| Disagreements to adjudicate | 11 |

Confusion matrix (rows A, columns B):

| A \ B | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| ACCEPT | 19 | 5 | 0 |
| TRIVIAL | 3 | 2 | 0 |
| WRONG | 2 | 1 | 8 |

| Label mix | ACCEPT | TRIVIAL | WRONG |
| --- | --- | --- | --- |
| A | 24 | 5 | 11 |
| B | 24 | 8 | 8 |

| Repo | Both | Agree | Disagreements (A/B) |
| --- | --- | --- | --- |
| dub | 3 | 67% | D-024a81 T/A |
| cal.com | 3 | 33% | D-0b36fb A/T, D-42ab67 A/T |
| documenso | 4 | 50% | D-bac94d W/T, D-d19fc6 A/T |
| formbricks | 4 | 100% |  |
| supabase | 4 | 100% |  |
| twenty | 6 | 83% | D-2456fc W/A |
| infisical | 5 | 80% | D-156a6f W/A |
| immich | 4 | 25% | D-379261 A/T, D-62dfac T/A, D-0fb8e0 T/A |
| midday | 2 | 100% |  |
| ai | 1 | 100% |  |
| novu | 3 | 67% | D-2467a6 A/T |
| nest | 1 | 100% |  |
