# WS-C, role cohesion for TypeScript (round 10): measured, not admitted

PLAN-R10 §2.1 M1 and M2 were built, censused on the 34 dev clones and read with `eval/study/generalise.mjs`. **Neither passes the fold rule (§3.2), so neither is in the product.** The implementation is kept here as `m1-m2.patch` (against `1ea62fd`) so a later round can start from it without tuning it on these numbers.

## Design cards, declared before the other-fold numbers were read

| | Design cards (repo, fold) | Design folds |
|---|---|---|
| M1 | the five TS plain-function naming WRONGs in r10-history §16: dub D-258285 (4), cal.com D-8d7d13 (4), infisical D-4be5e9, D-156a6f, D-ac787f (1) | **1, 4** |
| M2 | dub D-ec6127 (4, "secondary exports of the same files"), plus every TS naming card in the relabel5 census seen while designing the signature: midday D-80f1c3 (4), immich D-26380c (1), novu D-808edd (2), infisical D-536c03 (1), InvenTree D-455913 (1, Python-language repo) | **1, 2, 4** [STRICT: every repo whose cards were looked at, not only the one the plan cites] |

The folds are eval/study/folds-r10.json. Infisical is fold 1, so M1's design folds are 1 and 4, not 4 alone.

## What was built (`m1-m2.patch`)

- **M1** (`has_kind_marker`, in `naming_drafts`): a TS/JS naming rule is not proposed on a role of kind `function` with file `*`, entry `-`, and no variety, member kind or reserved export name, unless at least 90% of its naming population are hooks (`use` + upper case or digit). Components, classes and values are not asked (the plan's caution on `const` roles; there is no dev evidence on classes).
- **M2** (`cohesive`, before mining, all families): for a TS/JS role of a symbol kind (function, component, class, const) and entry `-`, each member gets a signature: whether it is a secondary export of its file (a file whose default export, or export named after the file, is another symbol of the same kind), and for a class each base of its lineage or class decorator (or none). If no signature covers 90% of members, the role proposes nothing [STRICT: not mined, rather than mined per signature]. Entry roles, file roles and Python are not asked.
- Tests: `crates/drift-mine/tests/cohesion.rs` (12, including determinism under file and symbol order). With the patch applied, 9 existing tests fail and would need fixture changes (`companion.rs` 5, `precision.rs` 3, `role_stability.rs` 1): plain-function naming fixtures (M1) and a provider folder whose base class sits among its members (M2). Those were not adapted, since nothing ships.

## Census (`census --json --max 15`, release builds, all 34 dev clones)

| Step | Binary tag | Changed ids | Default-tier changes |
|---|---|---|---|
| base | `cgu170-459e528-1794143626` (main; no crate change to `1ea62fd`) | – | – |
| M1 | `cgu70-1ea62fd-1794146055` | 8: 4 WRONG/mixed_group removed (cal.com D-8d7d13; infisical D-4be5e9, D-156a6f, D-ac787f), 4 unlabelled new ids in the freed slots | 0 |
| M2 on M1 | `cgu70-1ea62fd-1794146283` | 16: 3 WRONG removed (immich D-26380c, novu D-808edd, Misago D-5862f4), **8 ACCEPT removed** (InvenTree D-16c1ac, ai D-4683f7, excalidraw D-553404, midday D-8fd473, novu D-bdd970, novu D-e79710, pontoon D-6957a9, supabase D-017ce5), 5 unlabelled new ids | 0 |

Every changed id with its tier, newest label and dev-v3 label: `census-diff-m1.txt`, `census-diff-m2.txt` (JSON beside them; `census-diff.py` wrote them).

dub D-258285 stays under M1 as built: its role is 90% `use*Modal` hooks, which the plan lists as a kind marker. The label-level policy `M1` in generalise.mjs (plain-function naming cards by role shape) removes it; the implementation does not.

## Readings (generalise.mjs)

| | In-sample TS accept | Undo-named TS | dev-v3 reading TS | §3.2 |
|---|---|---|---|---|
| M1, census | 63.9% → 63.9% (+0.0; 4 WRONG out, 4 unlabelled in) | 43.6% → 43.4% | n/a (census change) | helps 2 repos in 2 folds (NO); 0 ACCEPT lost outside design; other folds +0.0 (NOT positive): **not admitted** |
| M1, label policy | 63.9% → 66.2% | 43.6% → 44.7% | 42.6% → 43.7% | helps 3 repos in 2 folds (yes); 0 lost; other folds +0.0 (NOT positive): **not admitted** |
| M2 (after M1) | 63.9% → 61.5% (−2.4) | 42.6% → 41.1% | n/a | helps 2 repos (NO); 2 ACCEPT lost outside the design folds (excalidraw, supabase); other folds −2.0: **not admitted**. Python-language repos (their TS frontends): 2 ACCEPT lost in design fold 1 (InvenTree, pontoon), helps 1 repo: not admitted |

All M1 evidence sits in its design folds: no repo in folds 2 or 3 has a TS naming card on a plain-function role, so the other-fold effect is zero, under the census and the label policy alike. M2 loses 8 ACCEPTs on the build set (the bar is ≤ 1).
