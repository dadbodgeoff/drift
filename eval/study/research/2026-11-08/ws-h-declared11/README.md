# WS-H, declared scope (round 11): members the repo's own configuration excludes

A file that the repository's own configuration leaves out of its application graph is not a member of a role. The configuration read: tsconfig `include` / `exclude` / `files` (following `extends` and project references), ESLint global ignores (legacy `ignorePatterns`, flat-config `ignores` blocks and `globalIgnores()`; not rule overrides), a published package's `package.json` `files`, and Python package discovery (`pyproject.toml` / `setup.cfg`). Such members are set apart before mining, so support, outliers and Wilson bounds all see the narrowed role. Deterministic and authored by the repo: no model, no name lists, no new thresholds.

## Design folds, declared before any fold figure was computed

Folds are those of `eval/study/folds-r11.json`.

| Mechanism | Designed from | Design folds |
|---|---|---|
| Declared scope | the idea as an outside review stated it (read off dev3 cards); the PLAN-R11 text (§1.3, §1.4, §5), which quotes every dev3 default card; the WS-C record `ws-c-scope11/` (README and `census-diff-k2.txt`); the config formats' own documentation (tsconfig, ESLint, npm, setuptools, Poetry, Hatch); the product code | **5** |

- **[STRICT] Fold 5 is a design fold** (PLAN-R11 §5): the idea was read off dev3 cards.
- **Folds 1-4 are other folds [STRICT].** No build-fold card, card reason or build-clone configuration file was read while designing. The only fold 1-4 card facts seen before measuring are the ids, labels and one-line summaries that `ws-c-scope11/census-diff-k2.txt` lists (cal.com, documenso, formbricks, midday layering cards whose config or tooling holders K2 set apart). They were not used to design this mechanism; declaring their folds as other folds is the stricter choice, since an ACCEPT lost there fails condition b.
- Census and fold figures follow below once computed; nothing is tuned after they are read.

## Verdict: not admitted

The mechanism was built, censused on all 54 build clones and read with `generalise.mjs --design-folds 5`. **It does not pass the five-fold rule (PLAN-R11 §5), so it is not in the product.** The implementation is kept as [`declared.patch`](declared.patch), which applies to main `9c22512`. Every gate passes on the patched tree; see *Verification*. Per PLAN-R11 §5 it is not tuned on these numbers.

## What was built (`declared.patch`)

- **Facts** (`drift-core`). `RepoFacts.declared`: one `DeclaredScope` per config (path, source, governed directory, judged extensions, `files`, `include`, `exclude`, `note`), optional and omitted when empty, so the facts schema stays 10.
- **What is set apart** (`drift_core::declared::set_apart`), before mining.
  - **Governance.** Per source, the scopes of the deepest directory that can govern a file decide together:
    - ESLint: the nearest config;
    - tsconfig: every `tsconfig*.json` of the nearest directory at or below the file's package, plus every project they reference;
    - `npm-files` and `python-packages`: the file's own package.
  - **Out.** A file is out by a source only when every governing scope was read, judges its extension (a tsconfig judges JS only with `allowJs`/`checkJs`) and takes it in nowhere.
  - **Fail closed.** A config that was not read is a scope with a note: it still governs its directory and sets nothing apart. Notes are kept in the facts (`drift scan --json`).
  - **Kept [STRICT]:**
    - every file an adapter found an entry point in (route, server action, handler);
    - every source a package manifest exposes (`PackageFacts.entries`);
    - every file a kept file imports, registers or discovers, to any depth. This is the application graph: tsconfig `exclude` does not remove an imported file either.
- **Readers.**
  - tsconfig `files`/`include`/`exclude` through `extends` (string or array) and `references`; any `extends` that is not a file in the repository (a package base such as `@tsconfig/node20`) fails closed [STRICT].
  - ESLint: legacy `ignorePatterns` (JSON, `package.json` `eslintConfig`, `.eslintrc.js`), gitignore-style; flat-config blocks whose only keys are `ignores` (and `name`) and `globalIgnores([...])`, read syntactically with oxc. Rule overrides (`files` + `ignores` blocks) are not ignores. A negation, a pattern built at run time or one Drift's globs do not read fails the whole config closed.
  - `package.json` `files` of a package that is not `private`, read only when every entry is in the checkout: a package that publishes `dist` fails closed. Its `main` and `bin` always count as published.
  - Python: setuptools (`[tool.setuptools]` `packages`, `packages.find`, `py-modules`, `package-dir` `""`), `setup.cfg` `[options]`, Poetry `packages`, Hatch wheel `packages`. A `setup.py` beside a declaration, two declarations, or a Hatch file selection fails closed. A project that declares nothing gets no scope.
- **Mining and check** (`drift-mine`).
  - A set-apart file's units have no roles, so support, outliers, the Wilson bound and the role size are counted without them, in mining and in `check` alike. The units stay in the repository context, as before.
  - **`selector_version` 4.** A convention written at version 3 or lower still holds set-apart members (`roles::Legacy::declared`), so an accepted convention never silently stops checking a file [STRICT].
- **Hooks** (`drift-cli`). A single-file scan of a file the patterns set apart returns "full scan needed": only a full scan sees whether another file reaches it.
- **Bumps it would need:** `selector_version` 4. No lowering bump (TS stays 37, Python 16), no facts schema bump.

## Census (`census --json --max 15 --python-proposals`, release builds, all 54 build clones: 34 dev and 20 dev3)

- **Binaries.** `build-verified.sh`:
  - base: main `9c22512` at CGU 179, tag `cgu179-9c225129-1794176344`;
  - as built: CGU 79, tag `cgu79-34a7cf6e-1794176457`;
  - with the reading fix (below): CGU 79, tag `cgu79-4d1cb8f0-1794177035`;
  - with the gate fixes (below): CGU 79, tag `cgu79-89d316d9-1794182099`.
- **Checks.**
  - The base census of the 20 dev3 repos equals the committed main re-census (`runs/dev3-recensus-2026-11-08/census-json`): same ids, tiers and outlier counts, 20/20.
  - `--python-proposals` is the opt-in view dev4 measures; TS cards are the same with and without it (#136).
  - Behaviour probes: a `tsconfig.json` with `include: ["src"]` gives one `declared` scope in `scan --json` on the new binaries and none on the base. A `../configs/base.json` extends reads with no note on the fixed binary.
- **Reading fix after the first census.** The first census showed, in aggregate, 381 tsconfig notes "a config outside the repository". The cause: `extends` and `references` named through `..` were not normalised.
  - The first effect was a fail-closed note.
  - The second was worse: such a reference was silently dropped, which could set apart a file the referenced project takes in.
  - It was fixed (commit `4d1cb8f0`) and the census re-run. Both readings are reported. **[STRICT] The verdict holds for both, and the stricter one decides:** "as built" was declared before any figure.
- **Gate fixes after the second census.** The full gates on the patched tree found two more reading errors, plus fixture updates (snapshots gain `declared`, and the reserved-exports test expects `selector_version: 4`). Commit `89d316d9`, kept in the patch only.
  - **Python, the unsafe direction.** `packages.find` `where` was joined to `package-dir`, not to the project. A `src` layout then took in nothing, so every file of the project was set apart.
  - **Python, the safe direction.** The fix also fails closed when a declaration takes in none of the project's Python files.
  - **TS, the safe direction.** A root tsconfig with neither `files` nor `include` failed closed instead of taking everything in.
  - **Result.** The third census (v3) changes exactly the cards v2 changes, and its fold reading (`generalise-v3.txt`) is v2's.
- **Every changed id** is in `census-diff-v1.txt` (as built), `census-diff-v2.txt` (reading fix) and `census-diff-v3.txt` (gate fixes, the patch as kept), with JSON beside them; `census-diff.py` wrote them.

| | As built (v1) | Fixed (v2, and v3 identically) |
|---|---|---|
| Removed | **T18 D-41177a** (default layering, WRONG `legit_outliers`, fold 5): both its outliers are set apart | T18 D-41177a, as v1; **novu D-6ded6b** (suggestion naming, **ACCEPT**, fold 2): holders of its role were set apart (its one outlier was not), and it is no longer proposed |
| Changed, still shown, outliers unchanged (holders set apart) | T02 D-f9ec7b (suggestion, ACCEPT, 61/61 → 60/60); T13 D-005b17 (default, ACCEPT, 230/232 → 228/230); documenso D-041293, D-2a51e9, D-7b5140, D-c3b713 (default, ACCEPT, 8 holders each); formbricks D-b8f1ee (default, ACCEPT, 115/116 → 113/114); midday D-b8cff6 (default, ACCEPT, 68/69 → 67/68) | the same 8 |
| Proposals over the 54 clones | 72 → 71 | 72 → 70 |
| Python cards changed | none | none |

**What the configuration sets apart, in aggregate (v2, `declared-stats.py`; v3's Python fix lowers the Python count, which changed no card):**
- **Scopes read.** 2,150 scopes over 141,133 analysed files: 1,700 tsconfig, 126 ESLint, 304 npm `files`, 20 Python.
- **Failed closed: 818.**
  - 465 `extends` of a package base;
  - 253 `files` naming a build output;
  - 90 patterns Drift does not read;
  - 6 invalid JSON;
  - 4 others.
- **Set apart: 7,895 files in 40 of 54 repos**: 4,746 by a tsconfig, 926 by ESLint, 302 by npm `files`, 1,921 by Python discovery.
- **Kept although out by pattern:** 159 entry-point files and 566 files reached from kept files.
- **Outliers touched.** Of the 1,059 outlier files of the 277 dev-v3 cards, none is set apart. Of dev3's 13 outlier files, 2 are set apart, both T18 D-41177a's.

## Fold verdict (`generalise-v1.txt`, `generalise-v2.txt`, `generalise-v3.txt`)

[STRICT] Fold 5 is the design fold; folds 1–4 are other folds. Cards keep their relabel5 or dev3 label by uid; nothing was relabelled.

| | As built (v1) | Fixed (v2 and v3) |
|---|---|---|
| a. Helps ≥ 3 repos across ≥ 2 folds | 1 repo, 1 fold (T18): **NO** | 1 repo, 1 fold: **NO** |
| b. No ACCEPT lost outside the design folds | yes, 0 lost | **NO**: novu D-6ded6b (fold 2) |
| c. Other-fold effect positive | 93.5% (43/46) → 93.5% (43/46), +0.0: **NO** | 93.5% → 93.3% (42/45), −0.1: **NO** |
| d. Fold-5 effect not negative | 58.3% (7/12) → 63.6% (7/11), 0 lost: yes | the same: yes |
| **Admitted** | **no** | **no** |
| Undo-named reading, TS | 40.9% → 40.9%; default 24/32 unchanged | the same |
| Python (opt-in view) | no change | no change |
| **dev-v3 reading** | **0 of the 8 dev-v3 default non-ACCEPTs removed, 0 ACCEPTs lost; default 24/32 unchanged.** No outlier file of any dev-v3 card is set apart, so no dev-v3 card would lose an outlier; a census change is not a label policy, so this is read off the dev-v3 cards' `outlier_files` against the v2 set-apart files | the same |

### Default (candidate) tier per fold: ACCEPT / shown, and flag precision, before → after (v1, v2 and v3 alike)

| Fold | Accept | Flag precision |
|---|---|---|
| 1 | 4/4 → 4/4 | 89.2% (66/74) → 89.2% |
| 2 | 10/10 → 10/10 | 89.4% (84/94) → 89.4% |
| 3 | 3/3 → 3/3 | 75.0% (6/8) → 75.0% |
| 4 | 13/13 → 13/13 | 89.0% (105/118) → 89.0% |
| 5 (dev3) | 1/5 → 1/4 | 31.3% (5/16) → 41.7% (5/12) |
| Folds 1–4 | 30/30 → 30/30 | 88.8% (261/294) → 88.8% |
| All five | 31/35 → 31/34 | 85.8% (266/310) → 86.9% (266/306) |

**Reading.**
- **The configuration rarely covers an outlier.** Repos do exclude many files, 5.6% of those analysed. But the members they exclude are almost always holders or files in no proposed role, not the outliers that make cards wrong:
  - **0 of 1,059 dev-v3 outlier files;**
  - 2 of 13 on dev3, one card.
- **The design case is not caught.** The dev3 card the idea was read from (a packaging config file as the only outlier of a layering card) is unchanged. No config of its repo sets the file apart as read:
  - of the three tsconfigs governing its directory, two do not judge JS (no `allowJs`) [STRICT] and one failed closed;
  - the nearest ESLint config does not ignore it.
- **Removing a member can hide a correct card.** In v2, setting holders apart took novu D-6ded6b, an ACCEPT, out of the proposals.

## Verification

On the patched tree (`89d316d9`, then `44f826e8` with a clippy fix to a test; the patch as kept):
- **`gates.sh` at CGU 79:** fmt OK; clippy 0 after the fix; tests 903 passed, 0 failed; `node --test` 196 passed.
- **Unit tests.** `drift-core` `declared` (5), `drift-ts` `declared` (7), `drift-py` `declared` (1), `drift-mine` `tests/declared.rs` (4) and `drift-cli` `scan::tests::a_file_the_config_sets_apart_needs_a_full_scan`.
- **Mutation checks: 12 of 12 caught.** Each new safety branch was disabled, a test failed, and the branch was restored.

| Branch disabled | Test that fails |
|---|---|
| a noted scope still decides (`declared-note`) | `a_config_that_was_not_read_narrows_nothing` |
| entry points not kept (`declared-entry`) | `an_entry_point_is_never_set_apart` |
| files reached from kept files not kept (`declared-reach`) | `a_file_reached_from_a_kept_file_is_kept` |
| set-apart units keep their roles (`declared-apart`) | `a_member_the_config_excludes_is_in_no_role` |
| version-3 selectors do not hold set-apart members (`declared-legacy`) | `a_member_the_config_excludes_is_in_no_role` |
| hook scan of a set-apart file not sent to a full scan (`declared-hook`) | `a_file_the_config_sets_apart_needs_a_full_scan` |
| unresolved tsconfig `extends` skipped instead of failing closed | `an_unreadable_tsconfig_sets_nothing_apart` |
| ESLint negation read | `eslint_global_ignores_not_rule_overrides` |
| ESLint ignores built at run time read in part | `eslint_global_ignores_not_rule_overrides` |
| npm `files` naming a build output read | `published_files_only_when_in_the_checkout` |
| a `setup.py` beside a declaration ignored | `setuptools_find_poetry_hatch_and_fail_closed` |
| a Python declaration that takes in nothing read (`py-takes-none`) | `setuptools_find_poetry_hatch_and_fail_closed` |

## Not done

- **No relabel.** The changed cards keep their outliers and their labels by uid.
- **Not covered:**
  - `.eslintignore`, `.npmignore`, `jsconfig.json`, a tsconfig's default `outDir` exclude;
  - Flit, PDM and maturin discovery;
  - global ignores inside a config imported from another module, which could only set more apart;
  - the pre-write hook's view of a new file (`conventions_for_path`). It still lists rules for a new file in a set-apart directory, which `check` would then not apply: more advice, never less.
- **Any re-attempt** of this mechanism, or of one derived from it, has now seen the census effects on every fold. [STRICT] Only dev4 is unseen.

## Files

| Path | What |
|---|---|
| `declared.patch` | The implementation against main `9c22512`: commits `34a7cf6e`, `4d1cb8f0` and `fd3e11cf` of this branch, plus the gate fixes `89d316d9` and `44f826e8` (`git diff 9c225129 44f826e8 -- crates`) |
| `census-diff-v{1,2,3}.{txt,json}` | Every changed id, tier and label: as built, after the reading fix, and after the gate fixes |
| `generalise-v{1,2,3}.txt` | `generalise.mjs --before <base> --after <new> --design-folds 5` |
| `census-diff.py` | Writes the census diffs (from `ws-c-scope11/`, without its tooling column) |
| `declared-stats.py` | The aggregate counts above, from compact `scan --json` dumps |
