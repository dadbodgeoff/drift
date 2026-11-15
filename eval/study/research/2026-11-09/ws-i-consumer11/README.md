# WS-I, consumer-set comparability (round 11)

This mechanism came from an outside review. It uses no name lists and no new thresholds. For a convention draft (role R, rule):

- **Consumers.** R's consumer set C(R) is the set of roles whose production files value-import at least `MIN_LOWER_BOUND` (75%, `mine.rs`) of R's holders.
- **Comparable.** A member of R is comparable if some file of C(R) imports it.
- **Set apart.** Any other member is set apart before the support test. It is not flagged, and it does not count towards support.

## Design folds, declared before any fold figure was computed

The declaration is in PR #141's first body, which was published before the census after-state existed.

| Mechanism | Designed from | Design folds |
|---|---|---|
| Consumer sets | the outside review's statement; the PLAN-R11 text (§1.3, §1.4, §5) and PLAN-R10 §3.2; the product code | **5** |

- **[STRICT] Fold 5 is a design fold** (PLAN-R11 §5).
- **No card, label or census file of folds 1–4 was opened before the declaration.** The plans quote a few ids from folds 1–3 as aggregates of earlier PRs. Declaring folds 1–4 as other folds is the stricter choice.
- **Nothing was tuned after the figures were read.**

## Verdict: not admitted

The mechanism was built, censused on all 54 build clones and read with `generalise.mjs --design-folds 5`. **It does not pass the five-fold rule (PLAN-R11 §5), so it is not in the product.** The implementation is kept as [`consumer11.patch`](consumer11.patch), which applies to main `9c22512`. It is on by default in the patch, and it includes:

- the unit tests (`crates/drift-mine/tests/consumers.rs`, 6/6 passed on the patched tree);
- the Studio pair (exemption code `not_consumed`).

## What was built (`consumer11.patch`)

- **Where it runs.** `consumer_set_apart` in `crates/drift-mine/src/mine.rs` runs in `narrow`, after the existing exemptions and before the support count. A set-apart member goes to `exempt` with code `not_consumed`.
- **The import graph.** It is `crate::parts`' (#52), unchanged:
  - production files only, so tests, stories and demo code consume nothing;
  - value imports only (`type_only` is skipped);
  - followed through re-exports; a namespace import or an import of `default` reaches every export.
  - `Parts` also records each production file's roles (interned), and whether a package entry exposes a symbol.
- **What counts as a consumer.**
  - A role Q is a consumer when files holding a unit of Q import ≥ 75% of the holders (plain share against the miner's own bound).
  - **[STRICT] Entry roles.** I chose the adapter option, not skipping entry members. One more consumer stands for what loads code from outside the facts:
    - an adapter entry point (`RepoContext::is_entry_unit`: entry facts, entry classes, handlers registered by reference);
    - a file's default export (what a loader or runner picks up, as `parts.rs` treats it);
    - a symbol a package entry exposes.

    It is a consumer when it loads ≥ 75% of the holders. A member loaded from outside is always comparable, and the #45 gate (`exemption_allowed`) refuses every entry point too. So a reachable entry point is never set apart. I took the adapter option because skipping entry members would leave the route-file case (exported helpers beside framework-loaded handlers) unreachable by construction.
- **[STRICT] File, model and package units are never set apart.** Any role with such a member is left untouched, and that includes every layering (`avoids import:`) role. A file nothing imports may be loaded by a framework or a tool that has no adapter fact (a config file, a script, middleware, a Django `admin.py`). The facts cannot tell that apart from a stray file, and the brief forbids setting apart a reachable entry point.
- **[STRICT] Fail closed: the role is left untouched when**
  - the facts do not say who imports what (`RepoContext::imports_complete`): a single-file scan, a file skipped for lack of stack (`stack_unavailable`, the level `unchecked.rs` already tracks), or a file whose parse stopped early (`parse_ok` false);
  - a relative import that did not resolve may point at a member's file (`may_be_imported_unseen`). The TS `./` / `../` and Python `.`-relative specifiers are resolved against the importer's directory, and a target that climbs out of the repo matches every file;
  - a member or holder is not a symbol the import graph has;
  - the holders have no consumer at all;
  - the rule is a guard rule (the #45 gate every exemption keeps).
- **[STRICT] Support.** Holders can be set apart too. When that takes the draft's Wilson bound below 0.75 over the comparable members, the draft is dropped.
  - The mechanism runs after the caps, like `narrow`, so it never brings in another draft.
  - The show policy (≤ 1 outlier for a suggestion) can still show a card whose outliers were set apart: midday D-98e729 below.
- **Mutation checks.** Each of the seven new branches was disabled in turn. One test failed for each, and all six passed restored:
  - support drop: `holders_set_apart_below_the_bound_drop_the_rule`;
  - `imports_complete`, `parse_ok`, unresolved relative target: `an_import_graph_not_known_leaves_the_role_untouched`;
  - loaded from outside: `a_member_loaded_from_outside_is_comparable`;
  - no consumer: `holders_with_no_consumer_leave_the_role_untouched`;
  - guard gate: `nothing_is_set_apart_under_a_guard_rule`.

## Census (`census --json --max 15 --python-proposals`, release builds, all 54 build clones: 34 dev and 20 dev3)

- **Before.** `build-verified.sh` at CGU 180 on a clean main worktree, tag `cgu180-9c225129-1794180503`.
- **After.** CGU 80 on the branch, tag `cgu80-20ecfded-1794181327`.
- **Behaviour.** The two binaries differ on 11 cards in 9 repos. Every changed or new card carries a `not_consumed` exemption, and the one gone card lost its bound to set-apart holders.
- **Proposals:** 72 before and 72 after. No default-tier (candidate) card changed. The full list is in `census-diff.txt` (JSON beside it), written by `census-diff.py`.

| Id | Tier | Label (newest; dev-v3) | Change |
|---|---|---|---|
| InvenTree D-095ebc | suggestion | ACCEPT; ACCEPT | 3 holders set apart (69/70 → 66/67) |
| InvenTree D-16c1ac | suggestion | ACCEPT; ACCEPT | 1 holder set apart (43/44 → 42/43) |
| InvenTree D-7c0991 | suggestion | ACCEPT; – | 3 holders set apart (199/200 → 196/197) |
| P03 D-1062a8 | suggestion | ACCEPT (dev3) | 3 holders set apart (21/22 → 18/19) |
| T07 D-51aa33 | suggestion | ACCEPT (dev3) | 3 holders set apart (40/41 → 37/38) |
| T18 D-62fb72 | suggestion | ACCEPT (dev3) | 1 holder set apart (73/74 → 72/73) |
| documenso D-a10f62 | suggestion | ACCEPT; – | its 1 outlier and 3 holders set apart (97/98 → 94/94) |
| immich D-26380c | suggestion | WRONG mixed_group; WRONG mixed_group | its 1 outlier and 1 holder set apart (61/62 → 60/60) |
| midday D-495f56 | suggestion | ACCEPT; ACCEPT | its 1 outlier and 45 holders set apart (308/309 → 263/263) |
| **midday D-98e729** | suggestion, **new** | **WRONG mixed_group**; WRONG mixed_group | one of its outliers set apart, so it is now shown (≤ 1 outlier) |
| **tasking-manager D-665f41** | suggestion, **gone** | **ACCEPT**; – | holders set apart took its bound below 0.75 (19/20, lb 0.764) |

## Fold verdict (`generalise.txt`)

[STRICT] Fold 5 is a design fold, and folds 1–4 are all other folds. Cards keep their relabel5 or dev3 label by uid, and nothing was relabelled.

| | TS | Python |
|---|---|---|
| a. Helps ≥ 3 repos across ≥ 2 folds | 0 repos: **NO** | 0 repos: **NO** |
| b. No ACCEPT lost outside the design folds | yes | **NO**: tasking-manager D-665f41 (fold 4) |
| c. Other-fold effect positive | 93.5% (43/46) → 91.5% (43/47), −2.0 pts: **NO** (midday D-98e729 shown) | 100% (12/12) → 100% (11/11), +0.0: **NO** |
| d. Fold-5 effect not negative | 58.3% (7/12) → 58.3% (7/12): yes | 50.0% (1/2) → 50.0% (1/2): yes |
| **Admitted** | **no** | **no** |
| Undo-named reading | 40.9% → 40.9%; default 24/32 → 24/32 | 30.4% → 30.4% |
| dev-v3 reading | n/a: a census mechanism, not a label policy. No default card changes, so the 32 dev-v3 default cards would read 24/32 either way. | n/a |

### Flag precision per fold, before → after

Flag precision is (mistake + look) over the A and B per-outlier verdicts. A card whose outlier count changed is untraced.

| Fold | TS default tier: ACCEPT / shown; flag precision | TS suggestions: ACCEPT / shown; flag precision (`suggestion-flags.mjs`) | Python suggestions |
|---|---|---|---|
| 1 | 4/4; 89.2% → unchanged | 0/1; 0.0% (0/3) → n/a (1 untraced) | 8/8; 100% → unchanged |
| 2 | 10/10; 89.4% → unchanged | 9/9; 50.0% (4/8) → 33.3% (2/6), 1 untraced | 2/2; n/a |
| 3 | 3/3; 75.0% → unchanged | 3/3; 85.7% → unchanged | 1/1; 100% → unchanged |
| 4 | 13/13; 89.0% → unchanged | 1/3 → 1/4; 33.3% (2/6) → 0.0% (0/4), 2 untraced | 1/1 → none |
| 5 (dev3) | 1/5; 31.3% (5/16) → unchanged | 6/7; 54.5% → unchanged | 1/2; 50.0% → unchanged |
| Folds 1–4 | 30/30; 88.8% (261/294) → unchanged | 13/16 → 13/17; 50.0% → 47.1%, 4 untraced | 12/12 → 11/11; 100% → 100% |

## Why it does nothing for the default tier (aggregates)

- **Layering.** Four of fold 5's five default cards are layering rules, whose members are file units. The [STRICT] file-unit rule leaves them untouched.
- **The fifth card** is a call-wrapper rule. Both of its outliers are value-imported by production files of the same consumer roles as its holders, so under this mechanism they are comparable to the holders.
- **What it does touch.** Most of the 11 cards it changes are suggestion cards whose holders include a few exports nobody imports. Setting those apart changes their evidence, not their outliers.
- **The two cards it does affect visibly** both go the wrong way on the labels:
  - it shows a WRONG card it used to hide;
  - it drops an ACCEPT whose bound sat near the bar.

## Not done
- **No `check` parity.** The patch changes mining (census, `init`) only, and `check` still flags set-apart members. Parity would need the holders' consumer set in `check` and a full-scan rule for hooks.
  - Note one effect for a future attempt: in `check`, a new member nobody imports yet would be set apart, so the rule would go quiet on new non-entry code until someone imports it.
- **Four existing tests fail on the patched tree**, and the patch leaves them as they are, since they state behaviour the mechanism changes (`gates.sh` on the patched tree: 888 passed, 4 failed).
  - `factory.rs`: 2 tests, `retryLater` and `makeCronJob`.
  - `parts.rs`: 2 tests, `BaseLink`, `addAwaitFn` and `formatName`.
  - Each asserts that a helper is an outlier because a member uses it, the #52 rule that a symbol used by fewer than two members is a member. Under consumer sets, such a helper is set apart:
    - the holders are default exports, loaded from outside, so the only consumer is the outside loader;
    - and the helper is not one of those exports.
  - So the mechanism overrides #52's member/part decision. Shipping it would mean changing what those tests state, not only their fixtures (which also name cross-file uses without import facts).
- **No relabel.** Three cards lost their only outlier and stay shown: documenso D-a10f62, immich D-26380c and midday D-495f56. They keep their labels by uid.
  - If immich's WRONG flipped to ACCEPT, the mechanism would help 1 repo in 1 fold. It would still fail a (and b for Python, c for TS).
- **Any re-attempt** has now seen the census effects on every fold. [STRICT] Only dev4 is unseen.
