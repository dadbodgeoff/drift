# neighbour gate, member level, leave-one-out (build-set data; in-sample on folds 1-4, fold 5 = dev3)

Labelled cards with a study card now: 238 (no study card: 0; no A and B records: 0). Labelled outliers placed: 765; verdicts not placed: 208; placed members no longer outliers: 66.

## all labelled cards: Drift exemptions + other LEGIT outliers as reviewer's exceptions

| Fold | Lang | LEGIT held / LEGIT (recall) | KEEP held / KEEP (mistake, look) | precision | OTHER held / OTHER | guarded |
|---|---|---|---|---|---|---|
| 1 | all | 49/120 (40.8%) | 0/73 (0, 0) | 100.0% | 2/4 | 88 |
| 2 | all | 6/55 (10.9%) | 0/104 (0, 0) | 100.0% | 0/3 | 32 |
| 3 | all | 9/55 (16.4%) | 0/87 (0, 0) | 100.0% | 0/2 | 47 |
| 4 | all | 16/85 (18.8%) | 0/162 (0, 0) | 100.0% | 0/1 | 142 |
| 5 | all | 4/7 (57.1%) | 0/7 (0, 0) | 100.0% | 0/0 | 2 |
| 1 | py | 12/31 (38.7%) | 0/17 (0, 0) | 100.0% | 1/2 | 5 |
| 2 | py | 2/37 (5.4%) | 0/25 (0, 0) | 100.0% | 0/2 | 7 |
| 3 | py | 0/5 (0.0%) | 0/8 (0, 0) | n/a | 0/0 | 0 |
| 4 | py | 5/35 (14.3%) | 0/66 (0, 0) | 100.0% | 0/1 | 69 |
| 5 | py | 0/1 (0.0%) | 0/1 (0, 0) | n/a | 0/0 | 1 |
| 1 | ts | 37/89 (41.6%) | 0/56 (0, 0) | 100.0% | 1/2 | 83 |
| 2 | ts | 4/18 (22.2%) | 0/79 (0, 0) | 100.0% | 0/1 | 25 |
| 3 | ts | 9/50 (18.0%) | 0/79 (0, 0) | 100.0% | 0/2 | 47 |
| 4 | ts | 11/50 (22.0%) | 0/96 (0, 0) | 100.0% | 0/0 | 73 |
| 5 | ts | 4/6 (66.7%) | 0/6 (0, 0) | 100.0% | 0/0 | 1 |
| all | all | 84/322 (26.1%) | 0/433 (0, 0) | 100.0% | 2/10 | 311 |

Fold rule (design folds 5): (a) helped repos 12 [dub, twenty, formbricks, documenso, novu, immich, infisical, Django-CRM, InvenTree, ralph, Misago, T18] across folds [1, 2, 3, 4, 5]: MET; (b) MISTAKE outliers held back outside the design folds: none: MET. **ADMITTED**

## cards the product shows now (72): Drift exemptions + other LEGIT outliers as reviewer's exceptions

| Fold | Lang | LEGIT held / LEGIT (recall) | KEEP held / KEEP (mistake, look) | precision | OTHER held / OTHER | guarded |
|---|---|---|---|---|---|---|
| 1 | all | 0/3 (0.0%) | 0/43 (0, 0) | n/a | 0/0 | 40 |
| 2 | all | 0/0 (n/a) | 0/45 (0, 0) | n/a | 0/0 | 19 |
| 3 | all | 0/0 (n/a) | 0/8 (0, 0) | n/a | 0/0 | 3 |
| 4 | all | 0/3 (0.0%) | 0/45 (0, 0) | n/a | 0/0 | 36 |
| 5 | all | 4/7 (57.1%) | 0/7 (0, 0) | 100.0% | 0/0 | 2 |
| 1 | py | 0/0 (n/a) | 0/5 (0, 0) | n/a | 0/0 | 0 |
| 3 | py | 0/0 (n/a) | 0/1 (0, 0) | n/a | 0/0 | 0 |
| 4 | py | 0/0 (n/a) | 0/1 (0, 0) | n/a | 0/0 | 0 |
| 5 | py | 0/1 (0.0%) | 0/1 (0, 0) | n/a | 0/0 | 1 |
| 1 | ts | 0/3 (0.0%) | 0/38 (0, 0) | n/a | 0/0 | 40 |
| 2 | ts | 0/0 (n/a) | 0/45 (0, 0) | n/a | 0/0 | 19 |
| 3 | ts | 0/0 (n/a) | 0/7 (0, 0) | n/a | 0/0 | 3 |
| 4 | ts | 0/3 (0.0%) | 0/44 (0, 0) | n/a | 0/0 | 36 |
| 5 | ts | 4/6 (66.7%) | 0/6 (0, 0) | 100.0% | 0/0 | 1 |
| all | all | 4/13 (30.8%) | 0/148 (0, 0) | 100.0% | 0/0 | 100 |

Fold rule (design folds 5): (a) helped repos 1 [T18] across folds [5]: NOT MET; (b) MISTAKE outliers held back outside the design folds: none: MET. **NOT ADMITTED**

## all labelled cards: exemptions only (no reviewer's exceptions)

| Fold | Lang | LEGIT held / LEGIT (recall) | KEEP held / KEEP (mistake, look) | precision | OTHER held / OTHER | guarded |
|---|---|---|---|---|---|---|
| 1 | all | 14/120 (11.7%) | 0/73 (0, 0) | 100.0% | 1/4 | 88 |
| 2 | all | 2/55 (3.6%) | 0/104 (0, 0) | 100.0% | 0/3 | 32 |
| 3 | all | 0/55 (0.0%) | 0/87 (0, 0) | n/a | 0/2 | 47 |
| 4 | all | 0/85 (0.0%) | 0/162 (0, 0) | n/a | 0/1 | 142 |
| 5 | all | 0/7 (0.0%) | 0/7 (0, 0) | n/a | 0/0 | 2 |
| 1 | py | 2/31 (6.5%) | 0/17 (0, 0) | 100.0% | 1/2 | 5 |
| 2 | py | 0/37 (0.0%) | 0/25 (0, 0) | n/a | 0/2 | 7 |
| 3 | py | 0/5 (0.0%) | 0/8 (0, 0) | n/a | 0/0 | 0 |
| 4 | py | 0/35 (0.0%) | 0/66 (0, 0) | n/a | 0/1 | 69 |
| 5 | py | 0/1 (0.0%) | 0/1 (0, 0) | n/a | 0/0 | 1 |
| 1 | ts | 12/89 (13.5%) | 0/56 (0, 0) | 100.0% | 0/2 | 83 |
| 2 | ts | 2/18 (11.1%) | 0/79 (0, 0) | 100.0% | 0/1 | 25 |
| 3 | ts | 0/50 (0.0%) | 0/79 (0, 0) | n/a | 0/2 | 47 |
| 4 | ts | 0/50 (0.0%) | 0/96 (0, 0) | n/a | 0/0 | 73 |
| 5 | ts | 0/6 (0.0%) | 0/6 (0, 0) | n/a | 0/0 | 1 |
| all | all | 16/322 (5.0%) | 0/433 (0, 0) | 100.0% | 1/10 | 311 |

Fold rule (design folds 5): (a) helped repos 3 [novu, infisical, InvenTree] across folds [1, 2]: MET; (b) MISTAKE outliers held back outside the design folds: none: MET. **ADMITTED**

**Verdict [STRICT: both reviewer readings must pass]: NOT ADMITTED.**
