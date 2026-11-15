# map11: map coverage, the yield funnel, test and kind roles, `drift map` (round 11, F12 candidate)

Status: research branch `ws/map11`, draft PR marked "F12 candidate". Main is frozen at F11, and nothing here changes a default:
- the test and kind roles are off unless asked for;
- off, `census --json --max 15` is byte-identical to F11 (apart from `commit`) on all 54 build clones.

## 0. Declaration

- **Inputs.**
  - The 54 build clones of `eval/study/folds-r11.json` (folds 1-4 and fold 5 = dev3, by key), read through Drift's facts.
  - The F11 binary (`/home/user/drift-bin/f11/drift`), and the product code.
  - The pilot's de-identified coverage aggregate and probe, on `ws/gc-pilot`. I read them only with the lead's leave, and only aggregates appear here.
- **apps-build.** apps11's `eval/apps11-build.json` (12 repos) was committed late. It was measured last, with the final binary, at its pins (§1.1). Its blind half was not opened.
- **Design folds [STRICT].** Fold 5 is a design fold for everything here: I read the summaries of the 14 new shown cards, and four of them are fold-5 cards. No card, label or file name of fold 5 is quoted below.
- **Not opened.** No held-out pool, no dev4 file, and nothing of apps11's blind half.

## 1. Map coverage: one definition, aligned with the pilot's probe

**Where it is computed.** `drift census --coverage [--json]` computes it in `crates/drift-mine/src/map.rs` (`coverage`). It uses the miner's own units and role grouping. A role is a group of at least `MIN_ROLE_SIZE` (8) units, from at least 3 files when they are all Python.

**The universe.** Every file in the fact index, plus every skipped file (counted as not parsed). LOC means physical lines.

**The measures, as in the pilot:**
1. parsed;
2. in a package;
3. in at least one role;
4. internal imports resolved;
5. files with entry points;
6. under at least one mined convention (every tier, hidden ones included);
7. under at least one shown convention (what `census --json --max 15` shows by default).

**Two maps.** The production map and the test map are reported apart.

**Strict readings, as the headlines:**
- production files in a role narrower than their package (a folder or kind role, not package-wide);
- files under a shown convention.

**Role keying** (`funnel.rs` `keying`):
- *kind*: a file kind, an entry kind, a class kind, a framework member kind, a reserved export, a test or kind shape, or models;
- *path*: only a folder below the package;
- *package*: the package itself, or its top level.

**Before and after.**
- **Before** is the map11 binary with the new roles off. Its census is byte-identical to F11's.
- **F11's own role definition** is `role_places`: only the roles mining forms at F11.
- **After** is `--test-roles --kind-roles`.

Build set, 54 repos (median; repos ≥ 90% in brackets):

| Measure | F11 | With test + kind roles |
|---|---|---|
| (3) files in ≥1 role, all files | **63.4%** (4/54) | **94.4%** (34/54) |
| production files in a role narrower than package | 85.8% (18/54) | **88.3%** (24/54) |
| production files in a kind-keyed role | 25.1% (0/54) | 59.8% (5/54) |
| test files in a test role | 0% | 99.6% (45/54) |
| (1) parsed, (2) in a package | 98.7%, 98.7% (39/54) | unchanged |
| (4) internal imports resolved | 100% (52/54) | unchanged |
| (6) files under a mined convention | 9.6% | 19.2% |
| (7) files under a shown convention | **0%** (mean 3.3%) | **0%** (mean 3.5%) |

**What is left unmapped**, by class (`map-coverage.mjs` `CLASSES`) with Drift's reason. These are files over the pool, after the change:

| Class | Files | Reason |
|---|---|---|
| demonstration and example code | 5,717 | non-production by position (by design) |
| migrations | 4,288 | not parsed (skipped as generated) |
| skipped generated or minified sources (lib, TS modules, type declarations) | about 2,100 | not parsed (skipped) |
| small groups: TS modules, barrels, configs | about 450 | below 8 members |
| everything else | under 100 per class | |

**Per fold** (after; production narrower than package):

| Fold | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Median | 78.4% | 85.7% | 92.1% | 94.5% | 93.8% |

**Reading.**
- The pilot finds the same thing:
  - production code is almost all in a role already;
  - tests decide measure (3);
  - the gap is between roles and conventions.
- Test roles take measure (3) from 63% to 94%. They are the only lever on it.
- Kind roles more than double the kind-keyed share of production. They hardly move "narrower than package", which folders already give.
- Neither changes measure (7). Coverage dies in the funnel below, not in the map.

### 1.1 apps-build (12 repos, final binary)

Medians (repos ≥ 90% in brackets); `apps-build-coverage.json`:

| Measure | F11 | With test + kind roles |
|---|---|---|
| (3) files in ≥1 role, all files | 76.1% (3/12) | **98.5%** (10/12) |
| production files in a role narrower than package | 93.7% (8/12) | **96.0%** (9/12) |
| production files in a kind-keyed role | 19.4% | 57.4% |
| test files in a test role | 0% | 96.6% (9/12) |
| (4) internal imports resolved | 99.6% (9/12; mean 84.1%) | unchanged |
| (6) mined, (7) shown | 0.9%, **0%** (mean 1.1%) | 2.1%, **0%** (mean 1.1%) |

- **Unmapped production files.** 188 Python modules (144 in groups too small to be roles) and 293 files of demonstration code. Nothing else reaches 30 files.
- **Funnel, default census** (`apps-build-funnel-default.json`):
  - 1,232 roles;
  - 103,303 candidate rules, of which the Wilson bound drops 96.6%;
  - 47 drafts;
  - 22 mined;
  - the show policy drops 18;
  - 4 proposed;
  - 4 shown.
- **Card diff when enabled.** +1 shown card, a test-role card. There are 0 new kind-role cards and 0 displaced (`apps-build-card-diff.txt`). Test roles are not admitted, so it was not labelled.
- **Reading.** On app-shaped repos the map clears the user's bar from the root, and so does production narrower than package. Conventions do not. Their yield is lower still than on the build set: 4 shown cards over 12 repos.

## 2. The yield funnel (`DRIFT_FUNNEL`, `eval/study/coverage/funnel.mjs`)

**The default census, 54 build repos** (numbers exactly as reported to the lead):
- 16,798 roles;
- 1.56M candidate rules, of which the Wilson bound drops 98.6%;
- 1,618 drafts;
- 305 mined;
- the show policy drops 233;
- 72 proposed;
- 61 shown.

**Every stage, summed** (`funnel-default.json`):

| Stage | n |
|---|---|
| groups of units at a role selector | 93,527 |
| groups too small (< 8) | 75,833 |
| Python groups from fewer than 3 files | 896 |
| roles mined | 16,798 |
| candidate rules observed in a role's members | 1,555,671 |
| dropped: Wilson bound < 0.75 | 1,534,611 |
| dropped: optional key | 11,521 |
| dropped: universal in the role | 4,014 |
| dropped: indirect base or refined base | 4,132 |
| dropped: lift | 313 |
| drafts, from every generator | 1,618 |
| dropped: near-duplicate | 519 |
| dropped: TS call family hidden | 164 |
| dropped: framework mandate | 147 |
| dropped: per-repo, per-role and layering caps | 138 |
| dropped: built-not-run calls | 69 |
| dropped: lint | 64 |
| dropped: tautology | 62 |
| dropped: uncorroborated absence | 57 |
| dropped: other filters | 59 |
| mined | 305 |
| dropped: show policy | 233 |
| proposed | 72 |
| dropped: Python off (D13-py) | 11 |
| shown | 61 |

**Roles and cards by keying** (default census; mined cards per 100 roles):

| Keying | TS roles | TS mined (per 100) | Py roles | Py mined (per 100) |
|---|---|---|---|---|
| kind | 4,977 | 115 (2.31) | 1,085 | 50 (4.61) |
| path | 8,485 | 74 (0.87) | 1,626 | 27 (1.66) |
| package | 589 | 38 (6.45) | 36 | 1 (2.78) |

With kind and test roles on (final binary, `funnel-shapes.json`):

| Keying | TS roles | TS mined (per 100) | Py roles | Py mined (per 100) |
|---|---|---|---|---|
| kind | 8,294 | 405 (4.88) | 3,371 | 95 (2.82) |
| path | 8,485 | 74 (0.87) | 1,626 | 27 (1.66) |
| package | 589 | 38 (6.45) | 36 | 1 (2.78) |

**Cards per covered file**, from `census --coverage` `conventions.by_keying`, summed (every tier):
- kind-keyed roles: 218 cards over 8,432 files;
- path-keyed roles: 145 cards over 7,363 files.

That is 1.3 times the cards per covered file, and 2.7 times the cards per role for TS. Kind-keyed roles yield more, so the kind detectors were brought back behind the same flag (§3).

**Reading.**
- Most candidate rules die at the Wilson bound: a rule must hold for about 90% of an 8-member role.
- After drafting, the losses are the near-duplicate filter, the hidden TS call family and the caps.
- After mining, the show policy hides 76% of mined cards: 233 of 305. It is the largest single post-mining gate.
- All of these are precision gates set on labels. None is a mapping problem.

## 3. Test roles and kind roles (selector version 4, off by default)

**Test roles** (`crates/drift-mine/src/shapes.rs`).
- Test, story and fixture files become units: exported test functions, fixtures and classes, and one unit per module.
- They sit in their folder's place roles, marked with a shape (`py:test`, `ts:fixture`, `ts:e2e`, `ts:story`), and in one role per shape across the repo.
- They are mined **in a pass of their own**, with their own lift baseline. Every production card is therefore unchanged (tested), and a test role is never a production role.
- These are tautologies and never mined:
  - rules that name only test frameworks (pytest, vitest, jest, Testing Library, Playwright, ...);
  - runner-mandated names (`test_*`, `Test*`).
- For agents, test placement and naming are described by `drift map`, structurally:
  - placement: next to the source, in test folders, or mixed;
  - naming patterns and fixture files, per package.

**Kind roles.**
- One role per structural kind of production unit across the repo, read from structure only, never from a repo-chosen name:
  - TS: components, `use*` hooks, schema values, entry points by kind, server-action modules, Next app-router files;
  - Python: pydantic and ORM models, through the repo's own bases; framework member kinds and special classes; service and repository classes;
  - modules: FastAPI routers, LangGraph modules, CLI scripts, migrations, configs, barrels, type modules, lib modules.
- Fixtures with invented names cover each detector (`shapes.rs` tests).
- A rule that restates the kind is a tautology: the defining base, call, import or directive, or a hook's `use*` name.

**How to turn them on.**
- `census --test-roles` / `--kind-roles`, or `test_roles` / `kind_roles` in the config's `experimental` list.
- The vocabulary freezes them (`FileKinds.tests`, `kind_roles`), so `check` reads the same roles.
- Conventions on them carry `selector_version: 4`. Every existing selector reads as before.

**Card diff when enabled, first build** (`census --json --max 15`, default view, Python off): **+14 shown cards** (11 kind-role, 3 test-role), and 3 shown place cards displaced.
- 7 of the 11 kind-role cards are default-tier call-wrapper rules on entry roles across the repo. As block candidates they reach agents only after a person accepts them.
- The other 4 kind-role cards, and the 3 displaced ones, are naming suggestions.
- 2 of the 3 test-role cards are default tier as well, because test roles go through the same tiers. If they ship, the stricter option is to keep test roles at suggestion tier.

**Blind labels** (rubric v3; A, then B, then C on disagreements; validated as `collect.mjs` does; opaque keys; `map11/labels-final.jsonl`).
- **Deviation run.** These prompts showed each card's `agents:` and `tier:` lines, and in 18 of the 40 card renders across those prompts the `agents:` line carried the family's accept rate ("N% of M"). The run is kept as a deviation run. The labels and verdicts of record are the clean relabel (§3.2), which gives the same 18 final labels.
- **Scope.** The 17 cards, plus the 1 extra card the Python opt-in view shows (a Python kind-role naming suggestion).
- **Agreement and relaunches.**
  - κ(A,B) = 0.514 on the 17 (13 agree), and 1.0 on the Python card.
  - Two B records were relaunched once: their `checked` lacked two other members.
  - C was ACCEPT on all 4 disagreements.

Labels (ACCEPT / not-wrong / n):

| Group | F1 | F2 | F3 | F4 | F5 (design) | Total |
|---|---|---|---|---|---|---|
| new kind-role cards (default view) | 1/1/1 | 1/1/1 | 1/1/1 | 4/4/5 | 2/2/3 | 9/9/11 |
| new kind-role card (Python opt-in) | 0/0/1 | | | | | 0/0/1 |
| new test-role cards | | 1/1/3 | | | | 1/1/3 |
| displaced place cards | | 2/2/2 | | 1/1/1 | | 3/3/3 |

- Kind-role cards in the default tier: 6 of 7 ACCEPT.
- Test-role cards in the default tier: 0 of 2 ACCEPT (both `false_outliers`).

**Fold rule** (PLAN-R11 §5; fold 5 a design fold [STRICT]):

| | (1) ACCEPT gains in ≥3 repos over ≥2 folds | (2) no ACCEPT lost outside the design folds | (3) other-fold effect | (4) fold-5 effect | Verdict |
|---|---|---|---|---|---|
| kind roles | yes: 4 repos, folds 1, 3, 4 | **no: 3 ACCEPTs lost (folds 2, 4)** | +4 | +2 | **not admitted** |
| test roles | **no: 1 repo** | yes | +1 | 0 | **not admitted** |

- **Net accepted cards per repo** (first build): +7 in total (kind +6, test +1). Only one repo is net negative (−1, fold 2).

### 3.1 Follow-up: kind roles made additive (same branch, still off by default)

**The cause is the per-repo cap.** With kind roles on, their drafts took cap slots: the displaced cards come back at `--max 30`. The near-duplicate and same-holder steps of `dedupe` compare drafts of one role only, and no kind role is nested in a place role. So the simpler of the two fixes is enough: **kind-role drafts are capped on their own** (`mine.rs`, the per-repo and layering-share caps). Why this one:
- it is one change in one place;
- `dedupe` is untouched;
- with kind roles on, every other draft meets exactly the caps it meets without them.

**Checks.**
- **Test.** `kind_roles_never_displace_place_cards` uses a fixture where the repo-wide role outranks both place roles. It checks `--max 1`, `2` and `15`.
- **Mutation check.** With the shared cap restored, that test fails. With the change, it passes.
- **Non-regression.** The census with the roles off is still byte-identical to F11 on 54 of 54 repos.

**Card diff on the 54 repos**, final binary (`card-diff.txt`, `card-diff-followup-vs-labelled.txt`):
- **+14 shown cards** (11 kind-role, 3 test-role), and **0 displaced**.
- Against the labelled set, the only difference is that the 3 displaced place cards are back: the same ids, all already labelled ACCEPT. No card is new or changed apart from the entry-role wording, which the labelled text already carried. So nothing new needed labelling.

**Fold rule re-applied** (same declared design fold, fold 5):

| | (1) | (2) | (3) other-fold effect | (4) fold-5 effect | Verdict |
|---|---|---|---|---|---|
| kind roles | yes: 6 repos, folds 1–4 | yes: 0 ACCEPT lost | +7 | +2 | **admitted, candidate for F12, default still off pending the F12 blind check** |
| test roles | no: 1 repo | yes | +1 | 0 | not admitted (stays out) |

- **Net accepted cards per repo** (final): +10 in total (kind +9, test +1). No repo is net negative.
  - fold 1: one repo +1;
  - fold 2: two repos +1 each;
  - fold 3: one repo +1;
  - fold 4: three repos +4;
  - fold 5: +2.
- **Precision of the kind-role cards:**
  - 9 of 11 ACCEPT in the default view;
  - in the default tier, 6 of 7;
  - the 2 WRONG are `mixed_group`;
  - the one Python opt-in kind card is WRONG.
- **Both stay off by default.**

### 3.2 Relabel (clean prompts)

The old prompts leaked the family accept rate through the cards' `agents:` line (§3, deviation run). All 18 cards were labelled again, blind, from clean prompts. This run is the one of record (`map11/labels-relabel.jsonl`, `map11/foldrule-relabel.json`).

**How.**
- Prompts rendered with `lib.mjs` `rubricText("v3")` and `labellerCard`, in `promptOrder`, as `prompt.mjs` does. One prompt per checkout, each with a fresh empty cwd and outbox.
- Every prompt has 0 `agents:` lines, 0 "Moves labels", 0 "N% of M", 0 `tier:` lines and none of the old run's keys.
- Fresh opaque keys (`old_key` in the labels file maps them) and a fresh shuffle seed.
- A, then B, then C on disagreements. Validated as `collect.mjs` does: `checkLabel` (rubric v3), empty cwd, unchanged checkout, no byte-identical outputs, no reason copied from another labeller. Each output was archived and its outbox deleted before the next launch.
- At most 3 attempts per labeller and card. When B fails 3 times, C labels the card blind with the plain labeller prompt, and the final label is ACCEPT only if A and C both accept.

**Attempts.**
- A: 18 of 18 valid. The infisical kind-role record needed a second attempt.
- B: 16 of 18 valid. The documenso displaced card needed a second attempt.
- B failed all 3 attempts on 2 repo-wide kind-role cards (cal.com fold 4, infisical fold 1). Each time, `checked` named the example and the `outlier:` files but fewer than 2 other members. C labelled both blind, on its first attempt. A and C both accepted both cards.
- C adjudicated 3 disagreements, all on its first attempt, all ACCEPT.

**Agreement.**
- κ(A,B) = 0.587 on the 15 TS cards both labelled (12 agree). It is 0.625 on all 16 (13 agree), and 1.0 on the Python card. The old run had 0.514 on 17 (13 agree).
- The 3 disagreements are all A ACCEPT and B WRONG: a fold-5 kind-role card and two displaced place cards (documenso fold 2, cal.com fold 4).
- Against the old run, A is unchanged on all 18. On the 16 cards B labelled in both runs, B moved on 4: a kind-role card (dub, fold 4) and a test-role card (novu, fold 2) went from WRONG to ACCEPT, and the two displaced place cards above went from ACCEPT to WRONG.

**Final labels.** All 18 are the same as in the old run. No id changed label, so the label table in §3 stands.

**Fold rule, rerun on the clean labels** (`foldrule.mjs`; PLAN-R10 §3.2 as in §3; design fold 5 as declared before the first labels, unchanged; nothing tuned on these labels):

| | Build | (1) | (2) ACCEPT lost | (3) other-fold effect | (4) fold-5 effect | Old run | Clean relabel |
|---|---|---|---|---|---|---|---|
| kind roles | first | 4 repos, folds 1, 3, 4 | 3 | +4 | +2 | not admitted | not admitted |
| test roles | first | 1 repo, fold 2 | 0 | +1 | 0 | not admitted | not admitted |
| kind roles | final (additive) | 6 repos, folds 1–4 | 0 | +7 | +2 | admitted (F12 candidate, default off) | **admitted (F12 candidate, default off)** |
| test roles | final (additive) | 1 repo, fold 2 | 0 | +1 | 0 | not admitted | **not admitted** |

- Kind-role cards: 9 of 11 ACCEPT. Test-role cards: 1 of 3. Displaced place cards: 3 of 3. Python opt-in kind card: WRONG.
- The fold rule's output is byte-identical to the old run's.

**Deviations of the relabel.**
- **Validator, repo-wide kind roles.** `lib.mjs` `roleFileCandidates` reads package `"*"` as a literal path, so it would reject every file of a repo-wide role. For those roles the validator counts any tracked non-config file as a possible member, as `memberFileInfo` does with no candidate set. The harness is not changed.
- **No `tier:` line.** The clean cards are `parseCensus` blocks as `prompt.mjs` shows them. The old cards showed a `tier:` line (default, or suggestion with its rule kind), and the clean cards do not.
- **Fresh keys.** The keys and the shuffle seed are new, so no old label can be looked up by key. Prompt order and each card's uid differ from the old run.
- **Launch wrapper, not the rendered prompt.** B attempt 2 asked for at least three role files in `checked`, where attempt 1 asked for two. B attempt 3 and C blind said the other role files must be neither the example file nor any file on an `outlier:` line, and to search the checkout for more of the same kind. Each rendered prompt is unchanged.
- **[STRICT]** A's second infisical record was also checked against B's reasons for copied text.

## 4. `drift map` and MCP `drift_map`

**What it returns.**
- For the repo or a package:
  - packages with their layers (the layering areas);
  - entry points by kind;
  - the package dependency graph (in-repo imports and workspace-package imports);
  - the test layout;
  - the largest roles, each with an id, a summary, its size, and whether it is mined here.
- For a file (`--file`): its package, layer, roles (most specific first) and up to 5 typical peers. A file in no role gets Drift's reason.
- For a role (`--role R-xxxxxx`): up to 10 typical members, spread over its files.

**Properties.**
- Read-only: no mining, and no fact cache unless `DRIFT_CACHE_DIR` is set.
- Deterministic and capped.
- It describes test and kind roles whether or not they are mined.

**Tests.** `crates/drift-cli/tests/map_coverage.rs` and `mcp_conformance.rs` (`drift_map_describes_structure`).

## 5. Not done

- **apps-build** was not committed in time. Run `map-coverage.mjs run`, then `report`, on it.
- **Per-package census on apps-build** (`census --root <package>`) with the new roles.
- **The F12 blind check of kind roles** (PLAN-R11 §4 style, on a pool nobody designing them has seen) before any default changes.
- **The Studio** shows `role.shape` only through the summary text (SYNC row).

## Files

| Path | What |
|---|---|
| `eval/study/coverage/map-coverage.mjs` | `run` (census with the funnel, `census --coverage`, `map --files` per repo), `report` (pool medians, ≥ 90% shares, folds, unmapped by class), `cards` (card diff, labelling rows) |
| `eval/study/coverage/funnel.mjs` | the yield funnel by family, keying, language and fold |
| `eval/study/coverage-map.test.mjs` | node tests of both |
| `map11/coverage-before-after.json`, `map11/funnel-{default,shapes}.json`, `map11/card-diff.txt`, `map11/card-diff-followup-vs-labelled.txt`, `map11/card-diff-python-opt-in.txt` (first build), `map11/census-f11-vs-off.txt` | the outputs, aggregates only (final binary unless marked) |
| `map11/apps-build-coverage.json`, `map11/apps-build-card-diff.txt`, `map11/apps-build-funnel-default.json` | apps-build outputs |
| `map11/labels-final.jsonl` | the old run's final blind labels by opaque key (fold-5 card ids left out); a deviation run (§3) |
| `map11/labels-relabel.jsonl`, `map11/foldrule-relabel.json` | the clean relabel of record (§3.2): A, B, C and final labels by fresh key, with `old_key` and `old_final` (fold-5 card ids left out), and the fold rule's output |
