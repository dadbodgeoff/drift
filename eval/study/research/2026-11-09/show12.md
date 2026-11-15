# show12: the show policy regenerated on the larger build set, and D4 at the F12 candidate (round 12)

**Result.**
- Re-applying the show policy's declared rule to the larger labelled build set changes nothing. The same three families are admitted: TS naming, TS control, Python naming.
- The F12 candidate's census is identical, card for card, under the current table and under the regenerated one: 126 build repos, both views.
- Build-set D4 at the F12 candidate:
  - **TS/JS: 79.6% (82/103), Wilson [70.8, 86.3]**, over everything `census --all` lists.
  - **Python (opt-in view): 85.7% (12/14), [60.1, 96.0].**
- **Recommendation:** keep the committed table for F12. The regenerated table is recorded here for the next table refresh.

- F12 candidate binary: `/home/user/drift-bin/f12rc/drift`, sha256 `b98b7863…`, census commit `cgu194-8348b84c-…`.
- Regenerated-table binary: a scratch build of 8348b84c with only `crates/drift-mine/data/show-policy.json` replaced by `show12/show-policy.regenerated.json`.
  - `build-verified.sh`, CGU 95, census commit `cgu95-8348b84c-1794217864`.
  - Verified by behaviour: its `census --json` `params.show.run` names the pooled table.
- Nothing here was tuned. The bar, the families, the outlier cap and the hidden families are the committed ones.

## 1. The rule (`eval/study/show-policy.mjs`, #129, PLAN-R10 §4)

A suggestion-tier card is shown only when all of the following hold:
- **Outliers:** it has at most **1** outlier (`total − holders`).
- **Not hidden by plan:** its family is not hidden for its language, whatever the counts (PLAN-R10 §2.3):
  - TS: `calls`, `ordering`, `renders`;
  - Python: `ordering`, `repo`.
- **Admitted by leave-one-repo-out:** its family, in the card's language (`proposalLanguage`), passes the LORO test:
  - with **any one** repo's cards left out, the family's suggestion-tier accept on the other repos is **≥ 60% of ≥ 5 labelled cards**;
  - the minimum is taken over the left-out repos, and **≥ 2 repos** are required.
- **Counting:**
  - The counts are per repo, over the suggestion-tier cards of a labelled census, with the tier and family as that census gave them.
  - A card without a final label counts as not accepted. polar and CTFd are left out.
  - The product recomputes LORO from the per-repo counts (`drift_mine::show::FamilyRecord::loro_met`).
- **Default tier:** not affected.

The committed table applies this rule to one run, `dev-v3-relabel5-2026-11-07` (ts, py, py2 D7 views).

## 2. The labelled build set (`show12/pool.mjs`, `show12/pool.json`)

The rule is imported, not copied: `loro`, `BAR`, `HIDDEN`, `EXCLUDED_REPOS`, `familyOf`, `proposalLanguage`.

**Sources** (a later record supersedes an earlier one for the same card):

| Source | Cards | Suggestions | ACCEPT / TRIVIAL / WRONG |
|---|---|---|---|
| relabel5 (the committed table's run) | 221 | 191 | 139 / 5 / 77 |
| show-before-cap run 2 (`labels-final.jsonl`) | 22 | 22 | 14 / 0 / 8 |
| map11 clean relabel (`labels-relabel.jsonl`) | 18 | 9 | 13 / 0 / 5 |
| dev3 (F10, `final.jsonl`) | 14 | 9 | 8 / 1 / 5 |
| dev4 (F11; TS `final-all.jsonl`, Python `final.jsonl`) | 19 | 9 | 13 / 0 / 6 |
| apps-build | 0 | 0 | no labelled record existed |
| **Pooled** (3 rows superseded) | **294** | **240** | |

- **By language:** TS 230 cards (176 suggestions), Python 64 (64).
- **By pool:**
  - dev clones 258;
  - dev3 17 (14 from its run, 3 from map11's fold-5 rows);
  - dev4 19.
- **Card identity:** pool, repo and id (`lib.mjs` `uidOf`, with the pool prefixed). dev3 and dev4 keys collide (`T02` is a different repo in each), so a repo is `dev3:T02` or `dev4:T02` in the counts.
- **map11's fold-5 rows** carry no id, by the aggregates-only rule. They are new cards (group `new_kind`), so each is counted as its own card.
- **dev4's arms add no labels.** The semantic-on arm is scored on the same 19 cards. The history-replay arm did not run.

**Left out [STRICT]:**
- **Deviation runs:** show-before-cap run 1, and map11's first run (`map11/labels-final.jsonl`).
- **layer11's labels.** Its `render.py` pasted the raw census block (with the `agents:` and `tier:` lines) and the rubric with its study-only notes, which breaks the labelling-prompt rule. None of the cards it relabelled is in the F12 candidate's census, so this changes no reading.
- **monorepo11's labels.** Its cards are behind `experimental: [intra_package_layering]`, off by default: not shown, and all default tier.
- **Rubric-v2 runs, and everything held out or blind.**

## 3. The regenerated policy against the committed one

The same families are admitted, and **no family or tier moves between shown and hidden.**

| Language | Family | Committed (relabel5) | Regenerated (pooled) | Shown |
|---|---|---|---|---|
| TS | naming | 24/37, LORO min 60.0% | **48/69, LORO min 67.2%, 22 repos** | yes → yes |
| TS | control | 8/10, 66.7% | **14/18, 71.4%, 13 repos** | yes → yes |
| Python | naming | 11/12, 90.0% | **14/18, 75.0%, 14 repos** | yes → yes |
| TS | base_class | 11/18, 53.8% | 11/18, 53.8% | no → no |
| Python | calls | 7/11, 55.6% | 7/11, 55.6% | no → no |
| Python | wrapper | 5/6, 66.7% (3 repos) | 5/6, 66.7% | no → no (n = 5 is met with no repo left out, but with the 3-card repo left out, n is 3) |

- Every other family's counts are unchanged (`pool.json` `suggestion_by_language_family`).
- dev3, dev4 and the newer dev-clone records add suggestions only to TS naming and control and to Python naming.
- The full table, in the product's format, is `show12/show-policy.regenerated.json`.

**Sensitivity (not the rule as declared).** The earlier v3 dev snapshots (dev-v3, relabel, relabel2, relabel3, relabel4) can also be pooled under relabel5, so that cards the product no longer mines count too (`pool.mjs --sensitivity all-snapshots`, `pool-all-snapshots.json`; +103 cards, 91 suggestions). Then:

| Family | Pooled | All snapshots | Shown |
|---|---|---|---|
| TS control | 14/18, 71.4% | 16/26, LORO min 54.5% | would be hidden |
| Python naming | 14/18, 75.0% | 19/31, 57.1% | would be hidden |
| Python wrapper | 5/6, 66.7% | 10/13, 62.5% | would be shown |
| TS naming | 48/69, 67.2% | 48/71, 65.2% | shown |

- The committed rule reads one labelled census, and these extra cards belong to product states that no longer exist. So the declared rule's result is the primary one (lead decision, 2026-11-09).
- That one choice of pooling moves three families. This is a reason not to rebuild the table on a pool that is still growing.

## 4. Census at the F12 candidate, both arms

**Coverage.**
- The census is `census --json --max 15`: the default view, and the Python opt-in view (`--python-proposals`).
- Text is `census --all --all-outliers --max 15`, used to compare each card with the card that was labelled.
- 126 repos, one at a time, each with a private cache:
  - the 16 TS, 6 Python and 12 Python-2 dev clones;
  - the 20 dev3 clones;
  - the 36 + 24 dev4 repos from the run manifests (`eval/study/runs/dev4-*/manifest.json`);
  - the 12 apps-build repos (`eval/apps11-build.json`).
- dev4 and apps-build were fetched at their pins (depth 1) and deleted after their census.

**Results.**
- **The arms are identical.** All 252 census outputs are equal, apart from `commit` and `params.show`.
- **The dev4 repo whose census failed at F11** (D3) runs at the F12 candidate.
- **A label counts only if it was given to the identical card** (stage.mjs rule 4):
  - the labelled card text (labellerCard, without the `tier:` line) must be byte-identical;
  - the repo must be at the same pin;
  - otherwise the card counts as unlabelled [STRICT].
  - All pins matched.

| | TS/JS (default view): listed / labelled / not-wrong | Python (opt-in view) |
|---|---|---|
| dev clones | 70 / 70 / 60 (30 default tier) | 9 / 9 / 9 |
| dev3 | 12 / 12 / 8 (5 default tier) | 2 / 2 / 1 |
| dev4 | 17 / 14 / 11 → with the new labels 17 / 17 / 12 | 3 / 3 / 2 |
| apps-build | 4 / 0 / – → 4 / 4 / 2 | 0 |
| **All** | **103 listed, 47 default tier, 30 repos** | **14 listed, 13 repos** |

**Shown with no final clean label: 7 (TS):**
- **4 new apps-build cards:**
  - designsystemet: 1 default-tier call wrapper and 1 control suggestion;
  - monitorss: 2 naming suggestions.
- **1 new dev4 card:** default-tier layering.
- **2 dev4 cards** labelled at F11 whose evidence count moved by one member, with the same outliers. Relabelled under rule 4 [STRICT].

## 5. Labels of the 7 cards

- **Rows** (`show12/label12.py rows`): each card as the F12 candidate's text census prints it, with its rank replaced by a fresh opaque key (`K-…`, keymap in the operator's scratch only).
- **Checkouts:** fetched at the manifest pins, clean, and without a remote. The dev4 checkouts are named by key, and their prompts say "(keyed checkout)".
- **Prompts** (`label12.py render`):
  - `REVIEWER-PROMPT.md`, with `lib.mjs` `rubricText('v3')`;
  - each card through `labellerCard`, with its `tier:` line removed;
  - one prompt per repo per labeller, cards shuffled per labeller;
  - a fresh empty working directory and outbox each.
- **Pre-launch check, on every prompt:** 0 `agents:` lines, 0 "Moves labels", 0 "N% of M", 0 `tier:` lines, no card id and no other prompt's key.
- **Labellers:** A, then B, both on the default model (lead decision: the other model failed the evidence rule repeatedly on repo-wide roles). B was rendered after A was collected.
  - **Launch wrapper (lead):** labellers were asked for at least three other role files in `checked`, none of them the example or an `outlier:` file, and told to search the checkout for more. The rendered prompts are unchanged, and validation is rubric v3's (≥ 2 other members).
- **Validation and collection:**
  - `show-before-cap/validate.mjs` (`lib.mjs` `checkLabel`, rubric v3) passed 7 of 7 records for A and 7 of 7 for B, each on the first attempt.
  - `show-before-cap/collect.py`: every cwd was empty and every outbox held only its output; all 4 checkouts were clean; no key appears outside the label folder.
- **Agreement:** 7 of 7 (κ = 1.0, `agreement-A-B.json`). No C was needed, and the 3-attempt cap was never reached.
- **Final** (`labels-final.jsonl`; dev4 rows without id, by the aggregates-only rule): **3 ACCEPT, 0 TRIVIAL, 4 WRONG.**
  - apps-build 2 ACCEPT / 2 WRONG (WRONG: `legit_outliers` 1, `mixed_group` 1);
  - dev4 1 ACCEPT / 2 WRONG.
  - Both relabelled dev4 cards are WRONG again, as at F11.

## 6. D4 (PREREG-F11 §2: (ACCEPT + TRIVIAL) / everything listed, both tiers; Python in the opt-in view)

| | Without the 7 new labels (96 labelled) | **With them (final)** |
|---|---|---|
| **TS/JS, everything `census --all` lists** (103) | 82.3% (79/96), Wilson [73.5, 88.6] | **79.6% (82/103), [70.8, 86.3]** |
| TS/JS, listed without `--all` (93) | 86.0% (74/86), [77.2, 91.8] | **82.8% (77/93), [73.9, 89.1]** |
| **Python, opt-in** (14) | 85.7% (12/14), [60.1, 96.0] | **85.7% (12/14), [60.1, 96.0]** |

- **Same in both arms.** Current table and regenerated table, by construction and as measured (`d4-final.json`, `d4-final-regenerated-arm.json`).
- **What the 7 add:** 3 not-wrong of 7, mostly from apps-build (2 of 4).
- **In-sample warning.** This is in-sample: it is computed over the same labels the show table and the D7 tier were set on. It is not a prediction for apps-blind or held-out.
- **Sensitivity, not a policy input** (labelled after the policy was fixed): with the 3 new apps-build suggestions added, TS naming is 49/71 (LORO min 66.7%) and TS control 15/19 (73.3%). Both are still admitted.

## 7. Recommendation for F12

**Do not adopt the regenerated table for F12. Freeze with the committed one.**
- It shows exactly the same cards on every build repo (§4), so adopting it changes nothing a user or agent sees.
- What it changes is the binary. A new binary would have to replace the measured candidate (`b98b7863…`) just before the freeze and the apps-blind before/after check, with no change in behaviour to gain from it.
- The admitted set depends on how the pool is defined (§3, sensitivity), so a table refresh should come with a declared pooling rule, after apps-blind.
- [STRICT] If you prefer the regenerated table's provenance anyway, it is `show12/show-policy.regenerated.json`. Its census on all 126 repos is the regenerated arm here: identical.

## Deviations

1. **Pooled population.** The committed rule reads one run. Pooling several records needs a choice, and I declared it before reading any new label:
   - the newest labelled census of each pool, plus the newer clean records of new cards;
   - the earlier snapshots go in only as a sensitivity (§3), confirmed by the lead.
2. **layer11 labels excluded** [STRICT]: hand-rendered prompts. No effect: none of those cards is in the F12 candidate's census.
3. **map11's fold-5 rows** carry no id in the record. To match them to census cards, their ids were read from the map11 operator's key map in scratch. No dev3 or dev4 card id, reason or file name is quoted here.
4. **apps-build had no labels.** Its 4 shown cards were labelled here.
5. **Identity rule for "already labelled"** [STRICT]: the stage.mjs rule-4 identical-card test, not the uid alone. It sent 2 dev4 cards back for relabel.
6. **D4's Python view is the opt-in view.** The default view lists no Python card (D13-py).
7. **The launch wrapper** asked for ≥ 3 other role files (§5). The rendered prompts and the validator are unchanged.

## Files (`eval/study/research/2026-11-09/show12/`)

| File | What |
|---|---|
| `pool.mjs` | the pooled build set and the rule re-applied (imports show-policy.mjs) |
| `pool.json`, `pool-all-snapshots.json` | its outputs, aggregates and per-repo counts (dev3, dev4 by key) |
| `show-policy.regenerated.json` | the regenerated table, in the product's format |
| `d4.mjs` | D4 per arm: census JSON and text, label matching by identical card |
| `d4-before-new-labels.json`, `d4-final.json`, `d4-final-regenerated-arm.json` | D4 aggregates |
| `label12.py`, `final12.py` | rows, prompts (A, B, C), agreement and final labels |
| `labels-final.jsonl`, `agreement-A-B.json` | final labels of the 7 cards (dev4 without id), agreement |
