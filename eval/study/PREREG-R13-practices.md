# Round 13: the practice map, its measures and the apps13 blind set (pre-registration)

This file pre-registers how the round-13 practice map (`drift practices`, PLAN-R13 §0–§4 and §9) is measured: the measures, the bars and predictions, the populations, the samples, the sets and the ship rule. It is the version rewritten to PLAN-R14 WS-F F6, which the lead adopted with decision D-3 at its default ("yes") on 2026-11-09. §10 records the history.

**What exists when this is committed:**
- No practices binary has been measured on any set.
- The binary is not frozen.
- No label of any kind exists.
- The apps13 draw exists as hashes (30 when this version was first committed; 40 after amendment 2, §10), but it has not been used: no Drift run, no sample, no label.

**What is filled in later:** the freeze table (§1), at the freeze and before any measurement with the frozen binary. (The rubric texts of the variant-recall arm, left for later in the F6 version, are pinned by amendment 3, §6.4.)

Nothing else changes after this commit. A deviation is reported in the run READMEs and in the report, never edited in here.

No figure in this file comes from a blind pool, a held-out manifest or the owner's pilot repository.

## 1. The freeze (filled in at the freeze)

| Item | Value |
| --- | --- |
| Product commit `F13` | to be filled in: the main commit after the round-13 practices workstreams are merged |
| Binary | to be filled in: the path of a `build-verified.sh` release build of `F13` |
| Binary sha256 | to be filled in |
| Census commit tag | to be filled in: `census --json` `commit` of that binary |
| Facts schema, lowering versions | to be filled in (planned: facts schema 11) |
| `practices --help` flags | to be filled in: whether the binary has `--all-variants` and `--units` (§6.1, P3) |

Every apps13 measure uses this binary only. One draw per frozen binary (F7): apps13 is the draw for `F13`. Build-set figures may come from any binary, and are labelled with it.

## 2. Concerns

- **Primary concerns** (PLAN-R13 §9.1, the route recipe): `authn`, `authz`, `validation`, `errors` and `api`. Their bars gate.
- **Secondary concerns** (a preview): `logging`, `config`, `data_access` and `testing`. They are reported against the same bars, in brackets, and gate nothing.

## 3. Measures

All measures read `drift practices --json`, version 1 (PLAN-R13 §0.3). `eval/study/practices-run.mjs` produces it, at the repository root, one repo at a time, with a private cache.

### 3.1 M-cov: coverage (co-primary with known_only)

From each concern's `population` (`total`, `known`, `none`, `unknown`), by `practices.mjs` (`repoCov`, `pooledCov`):

- **known-or-none** = (known + none) / total, and **known_only** = known / total. Both are co-primary: a classifier that says `none` can meet known-or-none.
- Also: the shares of known, `none` and unknown, the dominant known variant's share, and the variant count.
- Each is given per package, per repo, pooled over repos, and as the median over repos.

The rules:
- A repo with no unit in a concern is not in that concern's median.
- A repo whose run fails, or whose JSON is inconsistent (`shapeProblems`), is out of the pooled counts. It counts as **0** in the median of every concern that some measured repo has units in [STRICT].
- `unknown` always counts against coverage, and is never counted as `none`.

### 3.2 M-acc: assignment accuracy, from a description blind to the assignment

Per sampled unit there are two steps (F6):

1. **Describe** (rubric `practice-describe`). A labeller sees the unit (file, line, symbol), the concern and its population, and **never** Drift's assignment, its attributes, shares or counts. The labeller writes what the unit does:
   - `does`: `DOES`, `NONE`, `CANNOT_TELL`, `NOT_IN_POPULATION` or `UNSURE`;
   - when it does the concern, every mechanism it uses, as `{mechanism, instrument}`;
   - a description in words.
2. **Match** (rubric `practice-match`). A matcher sees that description, the assignment (label, mechanisms, instruments) and the attributes to check. It answers `same`: whether the described mechanism is the assigned one (true or false, needed when the description says `DOES` and the assignment is a known variant). It also gives a verdict per attribute.

**The label** follows from the assignment, the description and `same` (lib.mjs `derivePracticeLabel`):

| Assigned | Described | Label |
| --- | --- | --- |
| known | DOES, same | CORRECT |
| known | DOES, not same; or NONE | WRONG_VARIANT |
| none | NONE | CORRECT |
| none | DOES | FALSE_NONE |
| unknown | CANNOT_TELL | CORRECT |
| unknown | DOES | MISSED |
| unknown | NONE | WRONG_VARIANT |
| any | NOT_IN_POPULATION | NOT_IN_POPULATION |
| any | UNSURE, or anything else | UNSURE |

**Labellers.**
- A and B describe independently, and each description gets its own match (MA matches A's, MB matches B's).
- When A's and B's labels differ, C describes the unit blind and MC matches it. C's label is final.
- A, B and C run on **three different models** (F4).

**Accuracy is stratum-weighted to the population** (F6).
- Each sampled unit stands for (its stratum's members) / (the units sampled from that stratum). A stratum is a repo × concern × variant, or `unknown`.
- **Weighted accuracy** = Σ weight × CORRECT / the concern's whole population. Strata that nobody sampled are in the denominator and count as not correct [STRICT].
- Its **repo-cluster bootstrap 95% interval is primary**: 4000 resamples of repos, seed `drift-practices-r13`.
- UNSURE, NOT_IN_POPULATION, an A/B disagreement without C, and a missing label all count as not correct [STRICT].
- The unweighted rate, with Wilson, is reported beside it.

### 3.3 FALSE_NONE

**FALSE_NONE** = units Drift assigned `none` that do the concern / units Drift assigned `none` (F6).
- "Do the concern" is the final description: A and B agree on `DOES`, or C says `DOES`.
- A description with no final value counts as doing it [STRICT].
- It is weighted like accuracy, over the `none` strata that were sampled, with the repo-cluster interval. It is reported per concern.

### 3.4 Variant recall (co-primary)

For **at least 2 packages per repo**, a lister who is **never shown any Drift output** lists every mechanism the package uses for each primary concern (§6.4). The packages are drawn by seed from every package in which Drift reports units of any concern, so the choice does not depend on what Drift found for the concern itself. A matcher then marks each listed mechanism FOUND (a Drift known variant in that package, with that instrument and mechanism), PARTIAL or MISSED.

**Variant recall** = FOUND / every mechanism listed. PARTIAL counts as not found [STRICT]. It is given per concern, with the repo-cluster interval.

### 3.5 M-apart (secondary, gates nothing)

Each attribute of a non-dominant variant V is also put, as a control, on the match cards of up to 2 sampled units of the dominant known variant D. Every attribute is presented the same way, as "attributes to check against this unit", so the matcher cannot tell a control from a variant's own attribute.

A line (repo, concern, V, attribute) is scored as follows:
- **confirmed** when most of V's verdicts are TRUE and most of the controls' are FALSE;
- a **coincidence** when most of the controls' verdicts are TRUE.

M-apart = confirmed / lines with controls, reported with the number of coincidences.

### 3.6 M-agent (secondary, gates nothing)

The share of repos where the frozen binary's agent priming at the repository root carries at least one practice line, a line starting `drift: practices`. It is measured with:
- `drift hook claude SessionStart` from the root, with the JSON of its `--help` example;
- or, if the binary primes practices only per file, the `PreToolUse` `Edit` event for the first production source file (`git ls-files` order) of the package that holds the root.

The hook runs on a copy of the checkout. Target ≥ 90%.

### 3.7 The human anchor (F5; G8)

The sample: about 100 units, 20 per primary concern, from the M-acc sample (`practices.mjs goldSample`, the uids written to `gold.json`), with the seed `…:gold:<concern>`.

The labelling: a person describes them with the describe rubric, through `human-anchor.mjs form`.

The report (`human-anchor.mjs report`):
- raw agreement with the models' final descriptions, and agreement per outcome;
- at n ≥ 30, Cohen's κ and Gwet's AC1.

Decision D-4's default applies: the form and the report are built, and **nothing is labelled** until the owner decides who labels and the budget. Until a person has labelled at least 100 items, every accuracy figure quoted outside the repository carries the sentence **"labelled by models, not maintainers"**.

## 4. Bars and predictions

For each **primary** concern, on apps13, at the frozen binary:

| Measure | Bar (the pass rule) |
| --- | --- |
| known-or-none | ≥ 90%, pooled and as the per-repo median |
| known_only | ≥ 80%, pooled and as the per-repo median |
| M-acc | **repo-cluster bootstrap lower bound of the weighted accuracy ≥ 80%** (G7), and point ≥ 90%, with **n ≥ 100** labelled units from **≥ 30 repos** |
| FALSE_NONE | ≤ 5% (weighted point) of the units assigned `none`, with ≥ 60 such units: **a release gate on authn** (PLAN-R13 §9.2), and also applied to validation [STRICT] |
| Variant recall | repo-cluster lower bound ≥ 80%, from ≥ 30 repos |
| Population | units in ≥ 30 repos |

A primary concern passes when it meets every bar. The "≥ 30 repos" bars count repos with units in the concern, out of the 40 drawn (amendment 2): a concern with units in fewer than 30 of them fails those bars [STRICT]. The 80% figures for known_only and for variant recall are this file's choices: the review asked for both measures as co-primary but gave no numbers.

**Pre-registered predictions** (point values, made before any practices binary exists, from the plan's expectations only: high for authn, api, validation and data_access; lower for logging and errors; lowest for authz and testing). The report states each prediction beside its observation. A prediction is not a bar: a concern predicted below a bar is expected to fail it.

| Concern | Tier | known-or-none | known_only | M-acc | FALSE_NONE | variant recall |
| --- | --- | --- | --- | --- | --- | --- |
| authn | primary | 92% | 80% | 90% | 5% | 85% |
| api | primary | 93% | 88% | 90% | 5% | 85% |
| validation | primary | 90% | 70% | 88% | 8% | 80% |
| errors | primary | 85% | 75% | 82% | 10% | 75% |
| authz | primary | 75% | 55% | 75% | 15% | 65% |
| data_access | secondary | 92% | 90% | 90% | 5% | 85% |
| logging | secondary | 85% | 75% | 82% | 10% | 75% |
| config | secondary | 88% | 85% | 85% | 8% | 80% |
| testing | secondary | 70% | 60% | 75% | 15% | 65% |

(`practices.mjs PREDICTIONS` holds the same table.)

**A failed bar is published,** primary or secondary, with its figures, in the report and in `mcov.md` and `score.md`.

**Auth is reported twice, apart** (F6):
- `authn` practice units, on their own row of `score.md`;
- auth cards of the census study, under rubric v4's strict R3, where a by-design public outlier is `legit`.

## 5. Sets

| Set | What | Who may read it | Use |
| --- | --- | --- | --- |
| Build set | dev clones `ts` 16, `py` 6 (without polar and CTFd), `py2` 12; apps-build 12 (`eval/apps11-build.json`) | everyone | design and tuning; in-sample figures, labelled so |
| dev3, dev4 | | aggregates only | aggregates only |
| Owner's pilot repository | | the gc-pilot agent only | M-cov and M-acc aggregates at the frozen binary; nothing quoted |
| **apps13** (fresh blind) | 40 repos (amendment 2), `eval/study/select-apps13.mjs` | the apps13 operator only, from `scratchpad/apps13-blind*` | the bars of §4 and the ship rule |

**apps13 selection.** It uses apps11's specification (`select-apps.mjs`): criteria C1–C5, the two search queries, permissive licences, 20k–500k non-blank source lines, pushed within 12 months, and no libraries, SDKs, templates or lists. So it draws app-shaped TS and Python monorepos and services. What differs from apps11:

- A **new public seed**, `drift-apps13-2026-11-09:81a1d01a81ad609ba7304cf112e6eca4b4ab3cc8`, and a **new 128-bit secret**, whose sha256 `de32f02e35c2eca7a2c4a96271588629219ab44996d63b501eb9e9eac5d7bc87` was committed (`d8b24faa`) before the draw.
- **40 repos, all blind** (amendment 2; the "≥ 30 repos with units" bars are out of these 40).
- **Wider exclusions:**
  - every exclusion of apps11 (`select-holdout.mjs exclusion-hashes`);
  - both apps11 halves: the build half by slug, name **and owner**, the blind half by its slug and name hashes;
  - **by organisation**, the owner of every repo any manifest names (`owners_hashed`). The apps11 blind half carries no owner hashes, so it is excluded by repo only.
- polar and CTFd are never drawn.

**Hygiene** (F7):
- The set is **hash-only until it is reported**: `eval/apps13-blind-hashes.json`, with slug, name, owner and pin hashes.
- The key map, the record and the exclusions stay in `scratchpad/apps13-blind/`.
- It is one draw for the one frozen binary `F13`.
- **Swaps for the parse-size rule: 0.** The apps selection has no swap rule; size is a walk criterion (C4), applied before acceptance (§9).

**The private-manifest procedure** (the apps13 operator):
1. Replay the draw: `node eval/study/select-apps13.mjs verify --private scratchpad/apps13-blind`.
2. Copy `apps13-blind.json` to `scratchpad/apps13-blind-run*/`. Anything that leaves that directory names repos only by key.
3. Run the binary: `node eval/study/practices-run.mjs --manifest <that copy> --blind-operator --drift <F13 binary> --out <run>/run --clones <run>/clones --fetch --keep-clones`.
4. Draw the sample (§6), label it (§7), then run `practices.mjs score` and `human-anchor.mjs report` if the anchor is funded.

## 6. Samples

Drawn once, before any label, by `practices.mjs sample` from the practices-run directory. The seed is `drift-practices-r13-2026-11-09:<set id>`, and the apps13 set id is `apps13-blind-2026-11-09`. Sizes are fixed from population counts only (`sampleSizes`).

### 6.1 The M-acc sample

- **The frame.** The full member lists (`variants[].units`, `unknown.units`) when the binary has `--units`. Otherwise each variant's examples and the exceptions that name it, recorded as frame `examples` (P3).
- **Strata:** repo × concern × variant, plus `unknown`.
- **At most 5 units per repo per concern**, a hard cap (F6), filled in this order:
  1. on authn and validation, the `none` stratum gets min_none = min(5, ceil(66 / the number of repos with a `none` member in the concern)) units: the oversampling of `none`, aiming at ≥ 60 labelled;
  2. one unit each, while the cap allows, for `unknown`, `none`, then each known variant with share ≥ 5%, largest first. A minimum the cap leaves out is recorded (`unmet_minimum`);
  3. the rest of the cap by D'Hondt over members.
- **Order:** strata by members (descending), then key. Within a stratum, units are sorted by (path, symbol, line) and shuffled with the seed `…:<repo>:<concern>:<variant key>`.
- A unit listed under two strata is never sampled [STRICT].
- **Weights:** the queue carries every stratum's members and sampled count (`population`). The weights of the sampled strata plus the members of the unsampled strata sum to the population.
- **No top-up.** A primary concern with fewer than 100 sampled units, or units from fewer than 30 repos, fails its M-acc bar.

### 6.2 M-apart controls

Up to 2 controls per (repo, concern, non-dominant variant with attributes), chosen with the seed `…:<repo>:<concern>:<variant key>:controls` from the sampled units of the dominant known variant.

### 6.3 The gold subset

20 units per primary concern from the M-acc sample, chosen with the seed `…:gold:<concern>` (`gold.json`). Planned, pending D-4.

### 6.4 The variant-recall packages

2 packages per repo, chosen with the seed `…:recall:<repo>` from every package with units of any concern (`recall.json`; fewer only when a repo has fewer).

The labelling (amendment 3):
- **The lister, L1** (`prompt.mjs recall-list`, `RECALL-LIST-PROMPT.md`, rubric `practice-recall-list`). L1 sees the package and the five primary concerns, never any tool output. For each concern, L1 lists every distinct mechanism as `{mechanism, instrument, example}`, with `none` as a mechanism, after opening at least five units per concern where the package has them.
- **The matcher, R1** (`prompt.mjs recall-match`, `RECALL-MATCH-PROMPT.md`, rubric `practice-recall-match`). R1 sees L1's list and the tool's variants in that package (label, kind, mechanisms, instruments), and marks each listed mechanism FOUND, PARTIAL or MISSED, one answer per listed mechanism and in order. `collect.mjs` refuses a record that answers too few or too many.

The cards are rendered by lib.mjs `labellerCard`; the prompts are masked and leak-checked, with `--model` recorded. `practices.mjs score` adds variant recall from L1 and R1.

## 7. Labelling

**Prompts.** `prompt.mjs label` (describe: A, B, C) and `prompt.mjs match` (MA, MB, MC) render `PRACTICE-PROMPT.md` and `PRACTICE-MATCH-PROMPT.md`, with lib.mjs `rubricText` and lib.mjs `labellerCard`.
- The describe card shows the concern and the unit only. The match card adds the description, the assignment and the attributes.
- No card shows a share, a count, a variant id, which variant is dominant, or which attributes are controls.

**Pinned texts.** These are the labeller-facing texts' sha256 (lib.mjs `APPROVED_PRACTICE_RUBRICS`). `prompt.mjs` renders no practice prompt with another text.

| Rubric | File | sha256 |
| --- | --- | --- |
| `practice-describe` | `RUBRIC-practice-describe-v1.md` | `ed57ad294f3c3d06f78d5bfb896efa2add9717c6e7710784dbe77c16562d0c0c` |
| `practice-match` | `RUBRIC-practice-match-v1.md` | `a4254b69186535cfa0f9dd1c30a5768c05ba7e8fafff3aad44adcbab721f3503` |
| `practice-recall-list` | `RUBRIC-practice-recall-list-v1.md` | `f122762ec91b169659d56e474ad664a8a2e6b18fcd33d04980d41c43665c2b4d` |
| `practice-recall-match` | `RUBRIC-practice-recall-match-v1.md` | `b6028fa20156c9988f2048ff98f4abd835d018eef4f6f73e4f9c6e3d43cde0b8` |

**Masking (F1).**
- The repository's name is replaced by an opaque key, in the header and in every uid. `collect.mjs` maps the uids back.
- The URL and the commit are withheld.
- The checkout is reached through an opaquely named link.

**The leak check (F1).** Every prompt passes lib.mjs `promptLeaks` before it is written: no `agents:` line, no "Moves labels", no "<n>% of <n>", no `evidence:` line, "lower bound" or "lift N". The prompt without its cards is also checked for the repo's name.

**Models (F4).**
- `--model ID` is required, and A, B and C run on three different models.
- The ids are committed with the run's data only: `prompts/index.json`, and each collected record's `model`.

**Agreement (F2).** A/B agreement on the derived labels is reported as raw agreement. At n ≥ 30 pairs, Cohen's κ and Gwet's AC1 are reported as well. No adjective is used.

**Validation.** `collect.mjs` (lib.mjs `checkPracticeLabel`) checks the following:
- a description carries no label;
- `DOES` lists its mechanisms;
- the match copies the description's outcome, and answers `same` where it is needed;
- one verdict is given per attribute shown;
- the unit's file is in `checked`.

## 8. Ship rule and deviation rules

Judged on apps13 at the frozen binary:

- **The claim.** "The practice map covers ≥ 90% of <concern> and its assignments are ≥ 80% correct at the lower bound" is made only for primary concerns that pass every bar of §4. Every quotation of it carries "labelled by models, not maintainers" until the human anchor exists (§3.7).
- **The release gate.** FALSE_NONE ≤ 5% on authn (PLAN-R13 §9.2, G7). If it fails, the practice map does not ship to customers.
- **Agent-facing lines.** The practice lines that reach agents (hook priming, the card's "Practices here") carry only the concerns that pass, until a later blind check passes them [STRICT]. `drift practices`, the MCP tool and the Studio view show every concern, with its coverage and unknown share.
- **The round.** Round 13 meets its target when all five primary concerns pass. Otherwise the report says which pass, which fail, and on which bar.
- **Enforcement** is unchanged: promotion is deferred (PLAN-R13 §9.6).

**Deviation rules:**

- **P1, a failed repo.** It is re-run once with the same binary. If it fails again, it is a failed repo (§3.1). apps13 repos are never replaced.
- **P2, no units in a concern.** The repo is not in that concern's median. This is not a deviation.
- **P3, the frame.** Without full member lists (`--units`), the sample frame is examples and exceptions, which over-represent typical members. M-acc then speaks only for those units, and **the M-acc bar is not met** for any concern [STRICT]. The coverage claim may still be made.
- **P4, labelling.** Prompts are rendered once. An invalid output is relaunched under `collect.mjs`'s rules, and the relaunch is recorded. A label still missing at scoring time counts as not correct.
- **P5, the rubrics.** The labeller-facing texts are the ones hashed in §7. A change needs a new rubric id and file and a recorded amendment before any label of the set.
- **P6, anything else** that departs from this file is reported as a deviation, with its effect on the figures, and the stricter reading is taken.

## 9. Record of the apps13 draw (aggregates only)

- **The first draw** (`ecabe326`, 18 repos). It ran after `d8b24faa` (the spec and the secret commitment) was pushed.
  - Search: 31,491 unique results over the two queries (388 API calls).
  - Excluded:
    - 10,585 without a permissive licence;
    - 1,184 by topic and 974 by name;
    - 334 templates;
    - 360 in another pool or mentioned by the Drift repository;
    - 643 of an organisation of another pool;
    - 3 never drawn.
  - Eligible: 17,408.
  - Walk: 505 walked, 18 accepted.
- **The extension to 30** (`f885bd2d`). It ran after amendment 1 (`89b54c7d`) was pushed. The same walk went on over the same recorded pool, exclusions and secret.
  - Walk: 822 walked, 30 accepted.
  - Skipped: 532 at C1, 247 at C2, and 13 at C4 (line count).
  - The first 18 rows are unchanged.
- **Swaps:** none (F7).
- **The extension to 40** (amendment 2, `a7205444` pushed first). The same walk went on over the same recorded pool, exclusions and secret, from the 30th accepted repo.
  - Walk: 963 walked, 40 accepted.
  - Skipped: 616 at C1, 289 at C2, and 18 at C4 (line count).
  - The first 30 rows are unchanged.
- **Verification:** `select-apps13.mjs verify --private` replays the whole walk offline, and the public `verify` passes at every ref.
- **Use:** none yet. No Drift run, no sample, no label.

## 10. History

| Commit | What |
| --- | --- |
| `d8b24faa` | The first pre-registration: M-cov ≥ 90%, M-acc with the labeller shown the assignment (rubric `practices`, never used), n ≥ 30 per concern, 18 repos. Pushed before the draw. |
| `ecabe326` | The first apps13 draw, 18 repos, hashes only. |
| `89b54c7d` | Amendment 1, after an external review relayed by the lead (PLAN-R13 §9): primary concerns; known_only, FALSE_NONE and recall co-primary; n ≥ 100 from ≥ 30 repos; the cluster bootstrap; `none` oversampled; predictions; M-apart controls (rubric `practices2`, never used); the gold subset; 30 repos. |
| `f885bd2d` | The apps13 extension to 30. |
| `4c410f80` | The rewrite to PLAN-R14 WS-F F6 (decision D-3 at its default), before anything used the apps13 draw. The changes: the labeller is blind to the assignment, with a describe step and a match step and their rubrics; accuracy is stratum-weighted, with unsampled strata counted as not correct; FALSE_NONE gets its denominator; at most 5 units per repo per concern; recall on ≥ 2 packages per repo with no Drift output shown; the cluster lower bound is the pass rule; auth is reported apart; masking, model ids and the agreement rules come from F1, F2 and F4; the human anchor follows F5 with nothing labelled. The bars and predictions of amendment 1 stand. |
| `a7205444` | **Amendment 2** (the lead, 2026-11-09, before any binary touches the draw). apps13 goes from 30 to **40**, by continuing the same seeded walk over the same recorded pool, exclusions and secret from the 30th accepted repo. The first 30 rows stay unchanged. Why: with exactly 30, one repo without a primary concern would fail every "≥ 30 repos" bar, which is a design flaw, not rigour. The bars are unchanged: ≥ 30 repos with units per primary concern, now out of the 40 drawn. The variant-recall texts (§6.4) come in their own recorded amendment. |
| `2891752b` | **Amendment 3** (before any recall label, and before any binary touches the draw). The variant-recall lister and matcher (§6.4): their rubrics, prompt templates, `prompt.mjs` stages (`recall-list`, `recall-match`), their `collect.mjs` checks and the score, with both texts pinned (§7). |
| this commit | The extension to 40 (amendment 2): `eval/apps13-blind-hashes.json` now has 40 rows, the first 30 unchanged; aggregates in §9. Both `verify --private` and the public `verify` pass. No binary has touched the draw. |
