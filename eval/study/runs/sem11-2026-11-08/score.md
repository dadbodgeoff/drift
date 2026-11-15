# sem11 offline scoring

Cards: 237 (decided 236; undecided 1)

| Member-level agreement | n | exact | κ |
|---|---|---|---|
| S2 majority vs labeller, 5 classes | 933 | 53.9% | 0.37 |
| S2 majority vs labeller, real vs not | 933 | 80.0% | 0.59 |
| set apart vs labeller not real | 941 | 74.4% | 0.48 |
| A vs B (ceiling), 5 classes | 425 | 81.6% | 0.71 |
| A vs B (ceiling), real vs not | 425 | 92.2% | 0.84 |

S1 `other` by labeller verdict: mistake 3.9% (4/103); look 2.6% (10/389); legit 25.8% (105/407); not_violation 0.0% (0/30); one_off 66.7% (8/12)

Confusion (rows: S2 majority; columns: labeller): mistake: 94/222/105/9/0; look: 2/125/28/2/0; legit: 6/28/265/7/4; not_violation: 1/8/4/12/1; one_off: 0/0/3/0/7

Flip rate (3 samples not unanimous): members 12.2% (186/1529), flags 20.9% (175/837); flags with no 2-of-3 majority 0.6% (5/837)

| (b) flags, per fold | cards | helped | real set apart | flag precision before | after |
|---|---|---|---|---|---|
| 1 | 42 | 17 | 1 | 32.7% (90/275) | 50.3% (86/171) |
| 2 | 30 | 5 | 2 | 59.3% (99/167) | 75.0% (93/124) |
| 3 | 23 | 5 | 0 | 63.9% (106/166) | 79.5% (105/132) |
| 4 (design) | 44 | 13 | 0 | 59.6% (189/317) | 69.0% (185/268) |
| 5 (design) | 7 | 3 | 0 | 50.0% (8/16) | 100.0% (8/8) |

| (b) by tier and language | cards | real set apart | flag precision before | after |
|---|---|---|---|---|
| default/ts | 12 | 0 | 92.2% (83/90) | 96.5% (83/86) |
| suggestion/ts | 75 | 2 | 43.6% (228/523) | 60.3% (217/360) |
| suggestion/py | 59 | 1 | 55.2% (181/328) | 68.9% (177/257) |

(b) admission: **NOT ADMITTED**: helps pass; no_real_flag_set_apart_outside_design FAIL; other_fold_flag_precision_rises pass; fold5_not_negative pass

Real flags set apart outside the design folds: novu/D-808edd libs/application-generic/src/commands/project.command.ts#EnvironmentWithSubscriber, novu/D-6ded6b packages/framework/src/errors/resource.errors.ts#ResourceExecutionFailed, paperless-ngx/D-b958b1 src/documents/views.py#EmailDocumentDetailSchema

| (a) candidate tier, card reading | accept where it passes | accept where it fails |
|---|---|---|
| fold 1 | 100.0% (4/4) | n/a |
| fold 2 | 100.0% (8/8) | 100.0% (2/2) |
| fold 3 | 100.0% (2/2) | 100.0% (1/1) |
| fold 4 | 100.0% (9/9) | 100.0% (4/4) |
| fold 5 | 0.0% (0/1) | 25.0% (1/4) |
| all | 95.8% (23/24) | 72.7% (8/11) |

(a) would-be gate: would fail the fold rule (helps FAIL; no_accept_lost_outside_design FAIL; other_fold_effect_positive FAIL; fold5_not_negative FAIL); not a gate (lead constraint 2): not admitted by construction

| (c) suggestions with a verifier outcome | verifier pass: accept | verifier and semantic: accept |
|---|---|---|
| fold 1 | 100.0% (16/16) | 100.0% (15/15) |
| fold 2 | 93.5% (29/31) | 92.9% (26/28) |
| fold 3 | 83.3% (20/24) | 81.8% (18/22) |
| fold 4 | 79.2% (19/24) | 79.2% (19/24) |

(c) reading: would fail (helps FAIL; no_accept_lost_outside_design FAIL; other_fold_effect_positive FAIL; fold5_not_negative FAIL); not wired (lead constraint 2)


## Sensitivity: the ids PLAN-R11 and R6 name left out

Cards: 233 (decided 232; undecided 1)

| Member-level agreement | n | exact | κ |
|---|---|---|---|
| S2 majority vs labeller, 5 classes | 933 | 53.9% | 0.37 |
| S2 majority vs labeller, real vs not | 933 | 80.0% | 0.59 |
| set apart vs labeller not real | 941 | 74.4% | 0.48 |
| A vs B (ceiling), 5 classes | 425 | 81.6% | 0.71 |
| A vs B (ceiling), real vs not | 425 | 92.2% | 0.84 |

S1 `other` by labeller verdict: mistake 3.9% (4/103); look 2.6% (10/389); legit 25.8% (105/407); not_violation 0.0% (0/30); one_off 66.7% (8/12)

Confusion (rows: S2 majority; columns: labeller): mistake: 94/222/105/9/0; look: 2/125/28/2/0; legit: 6/28/265/7/4; not_violation: 1/8/4/12/1; one_off: 0/0/3/0/7

Flip rate (3 samples not unanimous): members 12.3% (185/1505), flags 21.1% (174/825); flags with no 2-of-3 majority 0.6% (5/825)

| (b) flags, per fold | cards | helped | real set apart | flag precision before | after |
|---|---|---|---|---|---|
| 1 | 42 | 17 | 1 | 32.7% (90/275) | 50.3% (86/171) |
| 2 | 30 | 5 | 2 | 59.3% (99/167) | 75.0% (93/124) |
| 3 | 23 | 5 | 0 | 63.9% (106/166) | 79.5% (105/132) |
| 4 (design) | 44 | 13 | 0 | 59.6% (189/317) | 69.0% (185/268) |
| 5 (design) | 7 | 3 | 0 | 50.0% (8/16) | 100.0% (8/8) |

| (b) by tier and language | cards | real set apart | flag precision before | after |
|---|---|---|---|---|
| default/ts | 12 | 0 | 92.2% (83/90) | 96.5% (83/86) |
| suggestion/ts | 75 | 2 | 43.6% (228/523) | 60.3% (217/360) |
| suggestion/py | 59 | 1 | 55.2% (181/328) | 68.9% (177/257) |

(b) admission: **NOT ADMITTED**: helps pass; no_real_flag_set_apart_outside_design FAIL; other_fold_flag_precision_rises pass; fold5_not_negative pass

Real flags set apart outside the design folds: novu/D-808edd libs/application-generic/src/commands/project.command.ts#EnvironmentWithSubscriber, novu/D-6ded6b packages/framework/src/errors/resource.errors.ts#ResourceExecutionFailed, paperless-ngx/D-b958b1 src/documents/views.py#EmailDocumentDetailSchema

| (a) candidate tier, card reading | accept where it passes | accept where it fails |
|---|---|---|
| fold 1 | 100.0% (4/4) | n/a |
| fold 2 | 100.0% (7/7) | 100.0% (2/2) |
| fold 3 | 100.0% (1/1) | 100.0% (1/1) |
| fold 4 | 100.0% (9/9) | 100.0% (4/4) |
| fold 5 | 0.0% (0/1) | 25.0% (1/4) |
| all | 95.5% (21/22) | 72.7% (8/11) |

(a) would-be gate: would fail the fold rule (helps FAIL; no_accept_lost_outside_design FAIL; other_fold_effect_positive FAIL; fold5_not_negative FAIL); not a gate (lead constraint 2): not admitted by construction

| (c) suggestions with a verifier outcome | verifier pass: accept | verifier and semantic: accept |
|---|---|---|
| fold 1 | 100.0% (16/16) | 100.0% (15/15) |
| fold 2 | 93.5% (29/31) | 92.9% (26/28) |
| fold 3 | 90.9% (20/22) | 90.0% (18/20) |
| fold 4 | 79.2% (19/24) | 79.2% (19/24) |

(c) reading: would fail (helps FAIL; no_accept_lost_outside_design FAIL; other_fold_effect_positive FAIL; fold5_not_negative FAIL); not wired (lead constraint 2)

