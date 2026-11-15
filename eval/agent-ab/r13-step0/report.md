# Step 0: control-arm conformance on new-unit tasks

| Model tier | Runs | Invalid | Task-concern pairs conformant | of which no entry point found | Runs with every concern conformant | Mean cost | Total cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| strong | 30 | 0 | 56/57 98% [91%–100%] | 0 | 29/30 97% [83%–99%] | $0.087 | $2.62 |
| cheap | 30 | 1 | 53/55 96% [88%–99%] | 1 | 27/29 93% [78%–98%] | $0.008 | $0.24 |

## By concern

| Model tier | Concern | Conformant |
| --- | --- | --- |
| strong | authn | 30/30 100% [89%–100%] |
| strong | errors | 6/6 100% [61%–100%] |
| strong | scoping | 5/6 83% [44%–97%] |
| strong | validation | 15/15 100% [80%–100%] |
| cheap | authn | 28/29 97% [83%–99%] |
| cheap | errors | 6/6 100% [61%–100%] |
| cheap | scoping | 4/5 80% [38%–96%] |
| cheap | validation | 15/15 100% [80%–100%] |

## Per task (means over repeats)

| Task | Tier | n | Conformant pairs | Turns | Input | Output | Cache read | Cache write | Read/Grep/Glob before first edit | Exploration calls (E1) | Seconds | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub-tags-count | strong | 3 | 6/6 | 7.0 | 11 | 1,368 | 57,893 | 7,619 | 4.7 | 4.7 | 12 | $0.050 |
| dub-tags-count | cheap | 3 | 6/6 | 8.7 | 13 | 2,692 | 92,040 | 11,421 | 4.3 | 6.0 | 14 | $0.005 |
| dub-log-by-id | strong | 3 | 6/6 | 14.0 | 21 | 3,283 | 151,262 | 13,470 | 5.7 | 9.7 | 26 | $0.102 |
| dub-log-by-id | cheap | 3 | 6/6 | 15.3 | 22 | 6,424 | 211,165 | 20,442 | 6.3 | 8.7 | 32 | $0.009 |
| immich-view-controller | strong | 3 | 3/3 | 13.3 | 15 | 3,694 | 92,952 | 11,078 | 6.0 | 6.7 | 25 | $0.091 |
| immich-view-controller | cheap | 3 | 2/3 | 18.7 | 19 | 6,691 | 191,258 | 19,890 | 7.7 | 8.3 | 33 | $0.009 |
| immich-tag-get | strong | 3 | 6/6 | 4.3 | 7 | 1,052 | 37,546 | 6,389 | 2.0 | 2.0 | 9 | $0.040 |
| immich-tag-get | cheap | 3 | 6/6 | 6.3 | 9 | 1,679 | 60,336 | 10,828 | 4.3 | 4.3 | 10 | $0.004 |
| infisical-user-action | strong | 3 | 6/6 | 14.3 | 15 | 3,952 | 100,737 | 13,045 | 7.3 | 8.0 | 29 | $0.102 |
| infisical-user-action | cheap | 3 | 6/6 | 15.0 | 18 | 4,670 | 192,925 | 20,919 | 10.3 | 10.3 | 24 | $0.008 |
| infisical-project-key | strong | 3 | 6/6 | 12.0 | 13 | 2,668 | 91,748 | 15,065 | 7.0 | 7.7 | 23 | $0.096 |
| infisical-project-key | cheap | 3 | 6/6 | 15.3 | 19 | 5,571 | 211,787 | 25,751 | 10.3 | 10.3 | 28 | $0.010 |
| midday-tags-router | strong | 3 | 6/6 | 10.3 | 10 | 2,201 | 59,344 | 10,908 | 5.7 | 5.7 | 16 | $0.072 |
| midday-tags-router | cheap | 3 | 6/6 | 13.3 | 14 | 4,140 | 113,612 | 15,962 | 8.0 | 8.0 | 18 | $0.006 |
| fastapi-delete-item | strong | 3 | 6/6 | 3.0 | 6 | 542 | 28,773 | 4,940 | 0.0 | 1.0 | 5 | $0.028 |
| fastapi-delete-item | cheap | 3 | 6/6 | 4.7 | 9 | 1,333 | 51,842 | 6,167 | 1.3 | 2.3 | 8 | $0.002 |
| crm-account-export | strong | 3 | 6/6 | 10.7 | 18 | 3,653 | 154,712 | 19,279 | 0.7 | 2.0 | 29 | $0.129 |
| crm-account-export | cheap | 3 | 6/6 | 15.3 | 19 | 5,793 | 297,279 | 39,083 | 8.0 | 8.7 | 32 | $0.014 |
| crm-case-watch | strong | 3 | 5/6 | 16.0 | 19 | 5,013 | 199,465 | 23,609 | 5.3 | 7.7 | 34 | $0.165 |
| crm-case-watch | cheap | 2 | 3/4 | 16.5 | 28 | 12,235 | 500,499 | 47,423 | 2.5 | 5.0 | 61 | $0.021 |

## Per tier, per run (medians)

| Tier | Turns | Input | Output | Cache read | Cache write | Read/Grep/Glob before first edit | Exploration calls | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strong | 11.0 | 14 | 2,857 | 87,356 | 11,161 | 5.0 | 5.5 | 24 |
| cheap | 14.0 | 16 | 4,941 | 143,154 | 18,840 | 5.0 | 6.0 | 24 |

## Non-conformant pairs (valid runs)

- crm-case-watch__control__cheap__r3 scoping: fail (no match for /visible_cases_qs/)
- crm-case-watch__control__strong__r2 scoping: fail (no match for /visible_cases_qs/)
- immich-view-controller__control__cheap__r2 authn: none (no added entry point in Drift's inventory)

## Invalid runs

- crm-case-watch__control__cheap__r2: no result message

Ledger: 67 calls, $2.87.
