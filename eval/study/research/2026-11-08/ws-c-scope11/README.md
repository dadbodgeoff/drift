# WS-C, candidate scope (round 11): K1 and K2

PLAN-R11 §1.4 and §5 (WS-C). Two hypotheses tested as general mechanisms, with no repo-specific patches:

- **K1:** a call-wrapper candidate (D7 default tier) needs an entry role (http, rpc, server_action, ...).
- **K2:** a layering candidate does not count config or tooling files (`*.config.*`, `scripts/**` roles) as members.

A card that fails a mechanism moves to the suggestion tier.

## Design folds, declared before any fold figure was computed

Folds are those of `eval/study/folds-r11.json`.

| Mechanism | Designed from | Design folds |
|---|---|---|
| K1 | the PLAN-R11 text (§1.3, §1.4, §5); the product code; the dev3 default-tier cards and their reasons (fold 5) | **5** |
| K2 | the PLAN-R11 text (§1.3, §1.4, §5); the product code; the dev3 default-tier cards and their reasons (fold 5) | **5** |

- **[STRICT] Fold 5 is a design fold** of both (PLAN-R11 §5).
- **No build-fold card was read while designing.** The only fold 1-4 card facts seen before measuring are the ids and one-line causes the PLAN-R11 and flags10 texts quote (for example ai D-fc5ef7 and supabase D-e93eb6 as non-entry wrapper ACCEPTs). They are the plan's statement of the hypotheses, not design reads. Declaring folds 1-4 as other folds is the stricter choice: any ACCEPT lost in folds 1-4 fails condition b.
- Census and fold figures follow below once computed; nothing is tuned after they are read.

## Verdict: neither is admitted

Both were built, censused on all 54 build clones and read with `generalise.mjs --design-folds 5`. **Neither passes the five-fold rule (PLAN-R11 §5), so neither is in the product.** The implementation is kept as [`k1-k2.patch`](k1-k2.patch), which applies to main `891af0a`. It holds both mechanisms behind a study switch (`DRIFT_STUDY_SCOPE=k1|k2`, read once per process) and the unit tests of `scope.rs` (3/3 passed on the patched tree). Per PLAN-R11 §5, they are not tuned on these numbers.

## What was built (`k1-k2.patch`)

- **K1** (`crates/drift-mine/src/scope.rs` `k1_reason`, read by the `tiered!` tier methods). A `wrapped_by:call` rule that D7 would place in the default tier is moved to the suggestion tier, with tier reason `not_entry_role`, unless its role and every sibling role in `also` has an adapter entry kind. `-` (no entry point) and a wiring role's `*` do not count.
- **K2** (`scope.rs` `k2_exempts`, read first by `Rule::exemption_in`, so mining and `check` agree). Under an `avoids` `import:` rule, a TS/JS file whose name has a `.config.` part, or that sits under a `scripts/` directory, is exempt with code `tooling_file`: it is neither holder nor outlier.
  - `narrow` and the subtree step leave it out of the role size, so a role left under 15 counted members drops to the suggestion tier.
  - A role left with no outlier proposes nothing, as for any rule.
- **What a demotion means here.** The committed show table admits neither TS wrappers nor TS layering, so a card moved to the suggestion tier is not shown at all. `generalise.mjs` therefore reads a demotion as a removal.
- **Label policies** (`eval/study/generalise.mjs` `K1`, `K2`; tests in `generalise.test.mjs`). They give the same changes on the labelled cards, for the dev-v3 reading. On the census they give exactly the census's after state (`policy K1/K2 on the before cards gives the after cards: yes`).

## Census (`census --json --max 15`, release build, all 54 build clones: 34 dev and 20 dev3)

- **Binary.** `build-verified.sh` at CGU 77, tag `cgu77-9effa3b9-1794168734`, sha256 `b73a34b3…87f90`.
- **Before** is the same binary with the switch unset. It is identical, proposal for proposal, to the committed dev3 re-census at main (`runs/dev3-recensus-2026-11-08/census-json`) on all 20 dev3 repos.
- **Behaviour probe.** On T18, `k1` removes D-ea1da6 and `k2` removes D-41177a. With the switch off, neither changes.
- **Full lists.** Every changed id, with its tier, newest label and dev-v3 label, is in `census-diff-k1.txt` and `census-diff-k2.txt` (JSON beside them). `census-diff.py` wrote them.

| | Removed (default tier → hidden) | Changed, still default |
|---|---|---|
| **K1** | T18 D-ea1da6 (WRONG `mixed_group`); **ai D-fc5ef7 (ACCEPT)**; **supabase D-e93eb6 (ACCEPT)** | none |
| **K2** | T02 D-c983c0 (WRONG `mixed_group`: its only outlier, `electron-builder.config.cjs`, is set apart); T18 D-41177a (WRONG `legit_outliers`: a `scripts/**` role) | 9 cards keep their tier and their outliers. Their config or tooling holders are set apart (1 to 5 each), so the summary gains "except a config or tooling file": T15 D-ec6190 (TRIVIAL), cal.com D-2f232d and D-441d0e, documenso D-041293, D-2a51e9, D-7b5140 and D-c3b713, formbricks D-b8f1ee, midday D-b8cff6 (all ACCEPT) |

No Python card changed. Proposals over the 54 clones: 72 before, 69 after under K1, 70 after under K2.

## Fold verdicts (`generalise-k1.txt`, `generalise-k2.txt`)

[STRICT] Fold 5 is a design fold; folds 1–4 are all other folds. Cards keep their relabel5 or dev3 label by uid; nothing was relabelled.

| | K1 | K2 |
|---|---|---|
| a. Helps ≥ 3 repos across ≥ 2 folds | 1 repo, 1 fold (T18): **NO** | 2 repos, 1 fold (T02, T18): **NO** |
| b. No ACCEPT lost outside the design folds | **NO**: ai D-fc5ef7 (fold 2), supabase D-e93eb6 (fold 3) | yes, 0 lost |
| c. Other-fold effect positive | 93.5% (43/46) → 93.2% (41/44), −0.3 pts: **NO** | 93.5% → 93.5%, +0.0: **NO** |
| d. Fold-5 effect not negative | 58.3% (7/12) → 63.6% (7/11), 0 lost: yes | 58.3% → 70.0% (7/10), 0 lost: yes |
| **Admitted** | **no** | **no** |
| Undo-named reading, TS | 40.9% → 41.2%; default 24/32 → 24/31 | unchanged |
| **dev-v3 reading** (8 non-ACCEPTs among the 32 dev-v3 default cards) | **2 of 8 removed**: ai D-fc5ef7 and supabase D-c2e88c (both `mixed_group`, non-entry). 0 ACCEPTs lost. Default 24/32 → 24/30 (80.0%) | **0 of 8 removed**: no dev-v3 default layering card has a tooling role or only tooling outliers. Default 24/32 unchanged |

K1 meets the dev-v3 bar (≥ 2 of 8, 0 ACCEPTs). It still fails on folds 1–4: the two non-entry wrapper ACCEPTs that the plan named are lost. K2 meets neither bar. All of its help is in its design fold, and it changes no folds 1–4 card that the labels can see.

### Candidate (default) tier per fold: ACCEPT / shown, and flag precision, before → after

| Fold | K1 | K2 |
|---|---|---|
| 1 | 4/4 → 4/4; 89.2% → 89.2% | unchanged |
| 2 | 10/10 → 9/9; 89.4% → 92.3% | unchanged |
| 3 | 3/3 → 2/2; 75.0% → 83.3% | unchanged |
| 4 | 13/13 → 13/13; 89.0% → 89.0% | unchanged |
| 5 (dev3) | 1/5 → 1/4; 31.3% → 41.7% | 1/5 → 1/3; 31.3% → 50.0% |
| Folds 1–4 | 30/30 → 28/28; 88.8% → 90.0% | 30/30 → 30/30; 88.8% → 88.8% |
| All five | 31/35 → 29/32; 85.8% → 88.0% | 31/35 → 31/33; 85.8% → 87.5% |

Flag precision is (mistake + look) over the A and B per-outlier verdicts. K2's nine changed cards keep their outliers, so their verdicts still count.

## Not done
- **No relabel.** A card K2 changes but keeps (a config or tooling holder set apart) keeps its label by uid. None of their outliers changed.
- **The two mechanisms were not combined.** K1 + K2 together would still lose the same two fold 2–3 ACCEPTs, so the combination fails condition b as well.
- **Any re-attempt** of K1 or K2, or of a mechanism derived from them, has now seen the census effects on every fold. [STRICT] Only dev4 is unseen.
