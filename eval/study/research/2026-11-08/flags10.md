# flags10 (round 10, WS-D): F1 and F2, not admitted

The two mechanisms are F1 and F2 of [`PLAN-R10.md`](../../PLAN-R10.md) §2.2. Neither passed the fold rule in §3.2. Under the lead's decision on #127, neither is in the product, **not even switched off**.

- **Implementation, for a later round:** commit **`bd66659`** on `ws/flags10`. It sits on top of `65418e7`, and the revert commit right after it removes both.
- **To restore it:** revert that revert commit, then measure again under §3.2.
- **Data:** dev only, and in-sample unless marked. The numbers behind every table here are in [`flags10.json`](flags10.json).

## What was built (at `bd66659`)
- **F1, comparable outliers** (`crates/drift-mine/src/comparable.rs`).
  - **A member's signature beside its role** has two components:
    - its export position: primary (a default export, the file's only export of its kind, or an export named for the file) or secondary;
    - for a class, its lineage roots: the bases its `extends` chain ends at, through in-repo classes.
  - **The holders' signature** keeps each component that ≥ 90% of the holders share, with at least 5 holders.
  - **Not comparable.** An outlier whose value is known and differs is set apart, with exemption code `not_comparable`. It is no longer an outlier and is not counted in `total`. A class with no base never differs on lineage.
  - **Card drop.** A card is not proposed when the members set apart outnumber the outliers left, unless a person accepted it.
  - **Check.** `check` read the holders' signature from `evidence.comparable`.
- **F2, entry-point evidence** (`crates/drift-mine/src/entry_evidence.rs`).
  - **The test.** An outlier on a card that D7 would place in the default tier counts only if it meets all three conditions:
    - it is a reachable entry point of the members' entry kind (a GraphQL `FIELD` resolver is not reachable);
    - it reads input (`reads_input`) or reaches a sink (`security::SinkReach`);
    - it has no guard: no `rejects_caller`, no guard callee, and no call wrapper or decorator that `authenticates`.
  - **Layering cards.** "Reachable" means an entry-point file loads the module through value imports, and the other two conditions do not apply.
  - **Demotion.** Any outlier that fails demotes the card (tier reason `entry_evidence`).
- **Study switches:** `census --mechanisms f1,f2|none` (hidden), and `drift debug entry-evidence`, which runs F2 on cards read from stdin.

## Design folds (declared before any other-fold figure was computed)
Folds are those of `eval/study/folds-r10.json`. The design repos were recorded in my scratch when I started building, before WS-A's folds existed. I mapped them to folds when #126 landed, before running `generalise.mjs`.

| Mechanism | Designed from (reasons and outlier verdicts read) | Design folds |
|---|---|---|
| F1 | TS suggestion cards of **twenty** (fold 3) and **immich** (fold 1) | 1, 3 |
| F2 | The PLAN-R10 text, and the default-tier cards of **cal.com** and **dub** (fold 4) at dev-v3 and relabel5 | 4 |

**Other exposure.** Before the folds existed I also saw two summary tables, with no reasons and no outlier lists from any other repo:
- the relabel5 verdict counts and labels of every TS card;
- the dev-v3 and relabel5 default-tier tables for all repos (label, `wrong_because`, verdict counts).

**[STRICT] For any re-attempt of F1 or F2, or of a mechanism derived from them, folds 1, 3 and 4 have now been seen and count as design folds.** Only fold 2 is unseen for these mechanisms.

## Census

**Method.** All runs are release builds, `census --json --max 15`, over the 34 dev clones. The label column is the newest v3 label.

**Base verification.** The base (`cgu171-459e528`) reproduces relabel5's census on all 34 clones. The branch binary with `--mechanisms none` is byte-identical to the base.

**F1 (`--mechanisms f1`): 26 ids changed.**
- **10 cards removed, all of them labelled ACCEPT:**
  - InvenTree D-16c1ac, ai D-4683f7, langchain D-0e154c, open-wearables D-262064 and saleor D-ac08d9;
  - **supabase D-e93eb6**, which is a default-tier card.
- **9 cards removed, all of them labelled WRONG:**
  - InvenTree D-455913, D-9838a4 and D-b24fe0;
  - Misago D-5862f4, dub D-258285 and D-ec6127, immich D-26380c, midday D-98e729;
  - netbox D-3ab42c, open-wearables D-b21ebc, paperless-ngx D-1d6a6a and tasking-manager D-6ec938.
- **Outliers set apart on cards that stay, 8 ACCEPT and 1 WRONG:**
  - ACCEPT: cal.com D-d690c0 and D-fafac1, changedetection.io D-1ce566, excalidraw D-553404, novu D-dbba9a, ralph D-cfd5da, tasking-manager D-68243e;
  - WRONG: Django-CRM D-b6f0b8.
- Tiers and outlier counts per id are in `flags10.json` under `census.f1`.

**F2 (`--mechanisms f2`): 24 tier changes.** Every one goes from default to suggestion, and every one is a relabel5 ACCEPT. Outlier counts are unchanged.

| Repo | Cards demoted |
|---|---|
| cal.com | D-594d38, D-85e09a |
| documenso | D-041293, D-2a51e9, D-32c861, D-55ae12, D-7b5140, D-9b91c3, D-a0eee5, D-c3b713, D-d51d70 |
| dub | D-015190, D-345913, D-83351e, D-d24d21, D-ebbc30 |
| formbricks | D-73b648, D-b8f1ee |
| infisical | D-1e9bb3, D-7731c9, D-c4efb8, D-f674a5 |
| midday | D-50255f |
| supabase | D-e93eb6 |

The per-card reasons are in `flags10.json` under `f2_relabel5_why`.

## Fold verdicts (`generalise.mjs --design-folds`)
[STRICT] A default-tier ACCEPT moved to the suggestion tier counts as an ACCEPT lost.

| | F1 TS | F1 Python | F2 TS |
|---|---|---|---|
| In-sample accept | 63.9 → 65.2% (+1.3 pts) | 61.0 → 66.2% (+5.1) | 63.9 → 63.9%; default tier 30 → 6 cards |
| Undo-named | 43.6 → 44.7% (+1.1) | 34.3 → 34.8% (+0.5) | +0.0 |
| Other-fold effect | +2.6 pts (folds 2, 4) | +4.5 pts | +0.0 (folds 1–3) |
| Helps | 3 repos, 2 folds | 6 repos, 3 folds | 0 repos |
| ACCEPT lost outside the design folds | 1 (ai D-4683f7) | 2 (langchain D-0e154c, open-wearables D-262064) | 16 |
| **§3.2** | **not admitted** | **not admitted** | **not admitted** |

## F2 acceptance (§2.2): fails in both readings

**dev-v3 reading.** These are the 32 dev-v3 default cards, with their outlier lists as dev-v3 showed them, read against today's facts through `debug entry-evidence`. All 232 outliers were found among today's units.

| Card class | Demoted | Target |
|---|---|---|
| Flag-error WRONGs | 3 of 6: formbricks D-5303d3 and D-60208a, cal.com D-0b36fb (guarded through a builder chain) | ≥ 4 |
| Mixed-group WRONGs | 2 of 2 | – |
| ACCEPTs | 18 of 24 | ≤ 2 |

- nest's 3 layering WRONGs stay default, because entry files load their outliers.
- Default-tier accept goes from 24/32 (75%) to 6/9 (66.7%).

**relabel5.** F2 keeps 6 of 30 default-tier ACCEPTs; the target is ≥ 28. Every demoted card was an ACCEPT, so the six it keeps are 6/6 ACCEPT.

**The "no guard" finding.** "Guarded" is the main reason for the demotions.
- **The rubric.** Under rubric v3 (R3), a reachable endpoint that does its own auth, or uses a different auth wrapper, is a **real** flag. Labellers mark it `look` ("worth confirming"): dub's invite routes on `withSession`, cron-secret routes, OAuth callbacks.
- **The conflict.** So the condition "no guard in its body or its builder chain" removes the flags the labellers count as real.
- **The other causes:**
  - `no_input`: input Drift cannot read counts as none [STRICT];
  - `not_reachable`: documenso's layering outliers are modules that no entry file loads through value imports.
- **For a later attempt.** A guard test can separate *false outliers* (a guard built on the rule's own wrapper, R6) from *another guard* (R3: real), but not as F2 was written.

## Flag precision (relabel5 A/B verdicts)
Precision is look + mistake over all verdicts. Verdicts were matched to outliers by name: 1,100 matched, 370 unmatched and counted as kept, and 114 on removed cards.

| | Before | F1 | F2 |
|---|---|---|---|
| TS suggestion, all | 38.4% (326/848) | 39.0% (309/793) | 50.8% (569/1121), because it moves the demoted cards' flags here |
| TS suggestion, other folds (target ≥ 55%) | 43.3% (146/337) | **45.7% (132/289)** | – |
| TS suggestion, design folds | 35.2% (180/511) | 35.1% (177/504) | – |
| TS suggestion, naming | 49.2% (118/240) | 55.0% (105/191) | 49.2% |
| TS suggestion, ordering | 6.2% (1/16) | 0.0% (0/14) | 6.2% |
| TS suggestion, avoids_other | 45.2% (14/31) | 40.7% (11/27) | 45.2% |
| TS suggestion, the other families | – | unchanged | unchanged |
| TS default | 88.8% (261/294) | 89.0% (260/292) | 85.7% (18/21) |
| Python suggestion, all | 45.2% (200/442) | 49.7% (181/364) | 45.2% |
| Python suggestion, naming | 66.7% (40/60) | 86.4% (38/44) | 66.7% |
| Python suggestion, base classes | 15.8% (9/57) | 8.0% (2/25) | 15.8% |

**F1's reach cap.** F1 keeps the exemption invariant [STRICT]: it sets apart no entry point and acts under no guard rule.
- **Out of reach.** That excludes the TS suggestion verdicts on entry roles: 280 of the 848, at 25.4% precision.
- **Ceiling.** If F1 removed every non-real flag on plain roles, precision would reach only about **61%** (326/535).
- **What 55% would take.** Reaching 55% would mean removing about 80% of those flags. The actual F1 removed few, and most of its effect was dropping whole cards.

## STRICT choices
1. F2 fails closed:
   - input Drift cannot read counts as none;
   - any guard counts;
   - a call-wrapper card on non-entry members always fails;
   - an outlier that cannot be found again fails.
2. F1 obeys the exemption invariant: it never sets apart an entry point and never acts under a guard rule.
3. Neither mechanism is admitted, and the product code has been reverted (the lead's decision): tier, blocking, check and agent text are unchanged.
4. In the fold readings, a default-tier ACCEPT demoted to the suggestion tier counts as an ACCEPT lost.
5. Folds 1, 3 and 4 count as design folds for any re-attempt (see the design folds section).
