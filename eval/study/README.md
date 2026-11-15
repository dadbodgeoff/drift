# Precision study v2: protocol

This directory measures whether Drift's proposals are conventions a maintainer would accept, on repos Drift was never tuned on. It closes study gaps S1–S3 in [GAPS-2026-11-05.md](../../docs/v2/GAPS-2026-11-05.md):

- **S1:** a frozen held-out set, and a frozen product;
- **S2:** two blind labellers on every proposal, plus adjudication;
- **S3:** yield, and recall against the conventions each repo documents itself.

## Targets, as defined in the plan of record

| Target | Definition |
| --- | --- |
| Not-wrong rate ≥ 95% | (ACCEPT + TRIVIAL) / proposals shown, on the held-out set. Unlabelled proposals count as WRONG, so leaving hard cases unlabelled cannot raise it. |
| Default-tier accept rate ≥ 95% | ACCEPT / proposals shown in the default (blocking-eligible) tier, on the held-out set, unlabelled counted as WRONG. The tier definition is pre-registered in the manifest (`tier`) and copied into `run.json` before labelling. For the primary sets it is the rule-kind tier of rule 5; [decision D5](#decisions-before-any-held-out-census-2026-11-05) (approved by the founder 2026-11-06) replaced it with `tier-d5.json`, and [decision D7](#decisions-before-any-held-out-census-2026-11-05) (approved by the founder 2026-11-06) with `tier-d7.json`, which both primary manifests now hold. |
| Yield | accepted conventions per repo, and recall against documented conventions, reported with every precision number |

When each target counts as met, and how per-language and pooled figures are reported, was decided before any held-out census: see decisions [D1 (default-tier accept) and D4 (not-wrong)](#decisions-before-any-held-out-census-2026-11-05).

**Release gate (founder, 2026-11-06, with decision D6).** The default tier ships as **advise**: its conventions warn and never block, until the default-tier accept rate, measured under rubric v3 (`RUBRIC-v3.md`) and judged as in D1 (point estimate per language, unlabelled counted as WRONG), is ≥ 95%. Until then "blocking-eligible" describes the tier definition, not what the product does. Blocking may be enabled only for a language whose figure meets the gate, on a primary held-out run labelled under v3. Making the product advise-only is a separate product change, not part of the study. [Decision D7](#decisions-before-any-held-out-census-2026-11-05) leaves the gate unchanged in form; under D7, Python has no default tier, so no Python convention is blocking-eligible whatever its figure.

## Contents

| File | What it is |
| --- | --- |
| [`../holdout-primary.json`](../holdout-primary.json) | **primary** held-out set: 18 TypeScript/JavaScript repos, pinned (plus 6 ordered reserves), selected code-blind |
| [`../holdout-primary-py.json`](../holdout-primary-py.json) | **primary** held-out set: 10 Python repos, pinned (plus 4 ordered reserves), selected code-blind |
| [`../holdout.json`](../holdout.json) | secondary held-out set: 18 TypeScript/JavaScript repos, pinned (plus 4 reserves) |
| [`../holdout-py.json`](../holdout-py.json) | secondary held-out set: 8 Python repos, pinned (plus 3 reserves) |
| `select-holdout.mjs` | the code-blind, seeded selection of the primary sets, the later held-out draws and the blind dev pools (`--selection`) (see [Primary held-out sets: selection](#primary-held-out-sets-selection)); `verify` checks the manifests against it offline |
| [`HELDOUT-RUNBOOK.md`](HELDOUT-RUNBOOK.md) | the exact commands of the primary held-out run, in order, and what to report |
| [`HELDOUT-CHECKLIST.md`](HELDOUT-CHECKLIST.md) | the short form of the labelling half of a held-out run: each command in order and the checks it makes |
| `selection/primary-2026-11-05.json` | its record: queries, seed, retrieval date, exclusions, the eligible pool and every walked candidate (metadata only) |
| `RUBRIC-v4.md` | rubric v4 (WS-F F1): v3 with cards without evidence numbers, a masked repository and R3's strict reading of public-by-design auth outliers; the default for new dev runs |
| `human-anchor.mjs` | the human anchor (WS-F F5): the JSONL form a person fills and the model-vs-human report |
| `RUBRIC-v3.md` | the labelling rubric, from decision [D6](#decisions-before-any-held-out-census-2026-11-05) on: v2 plus decision rules R1–R9 for the points where labellers split |
| `RUBRIC-v2.md` | the previous rubric: ACCEPT / TRIVIAL / WRONG, with an operational TRIVIAL test and a required `checked` list; runs started before D6 keep it |
| `RUBRIC.md`, `labels.jsonl`, `second-opinion.jsonl` | the first study's rubric and labels (v1), kept for comparison |
| `REVIEWER-PROMPT.md` | prompt template for labellers A and B |
| `ADJUDICATOR-PROMPT.md` | prompt template for labeller C, who sees only the disagreements |
| `EXTRACT-PROMPT.md` | prompt template: extract the conventions a repo documents |
| `MATCH-PROMPT.md` | prompt template: match documented conventions against proposals |
| `prepare.mjs` | clone pinned repos, run Drift, write proposals and `queue.json`; `--python-proposals` (dev runs only) gives the Python opt-in view (D13-py: `census --python-proposals`, and `proposals: {python: on}` for `init`), recorded in `run.json` `params.python_proposals`; `run.json` `harness.commit` records the study tooling commit |
| `prompt.mjs` | render every agent prompt from the templates |
| `collect.mjs` | validate agent output from the outbox and copy it into the run |
| `agree.mjs` | agreement between A and B: exact agreement and the confusion matrix; at n ≥ 30, Cohen's κ and Gwet's AC1 with repo-cluster intervals (WS-F F2); records the sha256 of both label sets, and runs before adjudication |
| `adjudicate.mjs` | list the disagreements for C (only once `agree.mjs` has recorded the agreement of the same labels), then merge the final labels |
| `metrics.mjs` | precision, yield, per-repo, per-family and default-tier metrics, per language, per framework bucket and per language × tier × rule family, with Wilson and repo-cluster intervals |
| `stage.mjs` | a dev labelling round on any prepared run: carry final labels that rule 4 allows, write the `relabel/` sub-run of the rest, apply a tier as a derived view (`views/<name>/`), then merge the round's `final.jsonl`; replaces the run-local `stage.mjs`/`view-d7.mjs`/`family-d7.mjs` scripts of the 2026-11-06 rounds; refuses held-out runs. `--candidate-json DIR` reads each repo's `census --json --candidate <decision>` for a tier with a guard condition (D8's candidate), and stops unless the product and the study give every proposal the same tier |
| `techcheck.mjs` | rule 1's technical check (clone, `drift scan`, parseable files) of a held-out set's slots and reserves, before any census; prints the `replaced` entries a rule-1 failure needs, and stops with exit 3 and no swap on an environment error; `--prune` deletes each checkout once checked, and `--min-free-gb G` stops (exit 3) before a fetch when the disk is low |
| [`folds-r10.json`](folds-r10.json), `folds.mjs` | the round-10 folds of the build set ([PLAN-R10.md](PLAN-R10.md) §3.2): the 34 dev repos in 4 fixed folds by a seeded shuffle stratified by language (4 TS/JS repos per fold; Python 5, 5, 4, 4), recorded once with its seed, method and sha256; `folds.mjs --check` recomputes it from the seed and the dev manifests, and `folds.test.mjs` pins the hash |
| `generalise.mjs` | the generalisation readings of a change (PLAN-R10 §3.2–§3.3), for a census before/after (`census --json` per repo), a census diff or a shown-set policy: in-sample, the undo-named reading, the dev-v3 reading (policies), per-fold effects with `--design-folds`, and the §3.2 admission verdict per language; refuses held-out and dev3 paths and repos outside the folds. `generalise.test.mjs` reproduces the PLAN-R10 figures from the dev labels and mutation-checks the admission rule |
| `dry-run.mjs` | synthetic labellers A, B and C, extractor E1 and matcher M1 for a plumbing dry run on dev repos (refuses held-out runs), and a check of the merged labels, the tables and recall against them |
| `*.test.mjs` | `node --test`, one file at a time (as CI does): tiers, metrics tables on a synthetic run, the pipeline on synthetic repos with a stand-in binary, `select-holdout.mjs verify`, label validation's "other members" rule (`validate.test.mjs`), excluding a repo from adjudication (`adjudicate.test.mjs`) |
| `recall.mjs` | find documentation sources; score recall and cross-check labels against repo policy |
| `lib.mjs` | shared parsing (census text, conventions.yaml) and statistics (Wilson, κ, cluster bootstrap, cluster-t). `parseCensus` keeps the product's `tier:` line out of the block labellers see |
| `tier-cases.json`, `tier.test.mjs` | shared tier cases, run through `tierOf` here (`node --test eval/study/tier.test.mjs`) and through the product's `drift_mine::tier::tier_of` (`cargo test`), so the two definitions cannot drift apart. Each case has an example (its language), its D7 tier (`tier`) and `reason` (the product's `tier_reason`), its D5 tier (`d5_tier`) and its rule-5 tier (`rule5_tier`). `d8_cases` do the same for D8's candidate tier (`d8_tier`, `d8_reason`, and `guards`, the product's word on a call wrapper's alternatives), through `drift_mine::tier::d8_candidate_reason` |
| `tier-d7.json` | decision D7's tier block: what both primary manifests hold and the product implements |
| `tier-d8-candidate.json` | decision D8's **candidate** tier block (pre-registered 2026-11-07, not adopted): D7 for TypeScript/JavaScript, plus Python guard call wrappers and layering in roles of ≥ 50. No manifest holds it and the product does not ship it; `census --json --candidate d8` reports it. The pre-registration is [D8](#decisions-before-any-held-out-census-2026-11-05) and [`runs/d8-prereg-2026-11-07/`](runs/d8-prereg-2026-11-07/README.md) |
| `tier-d5.json`, [`TIER-ADMISSION.md`](TIER-ADMISSION.md), `tier-admission.mjs` | decision D5's tier block, its memo, and the analysis of dev labels behind it (precision by rule kind and feature, candidate rules, leave-one-repo-out cross-validation) |
| `holdout-manifests.json` | the registered held-out manifests and their sha256; `prepare.mjs` refuses a held-out run whose manifest does not match |
| `runs/dev-2026-11-05/` | the dev set at drift-main, used to validate the scripts (see its README) |
| `runs/calib-v3-2026-11-06/` | the calibration relabel of D6: a stratified sample of labelled dev proposals, blind-labelled under v3; the v2→v3 shift and A/B agreement (see its README) |
| [`../repos-py-2.json`](../repos-py-2.json) | a second Python **dev** set: 12 applications (Django/DRF, Celery, FastAPI, Flask), pinned, with rule 5's tier pre-registered; not yet labelled |
| [`PREREG-R13-practices.md`](PREREG-R13-practices.md) | round 13's pre-registration for the practice map (PLAN-R13 §5): M-cov, M-acc, M-apart, M-agent, the bars, the sample, the apps13 blind set and the ship rule |
| `practices-run.mjs`, `practices.mjs` | run a binary's `drift practices --json` over a manifest, one repo at a time, and write the M-cov tables (`practices.mjs mcov` recomputes them); draw the stratified M-acc sample as a practice run, with the variant-recall packages and the gold subset (`sample`), and score its labels (`score`). Tests: `practices.test.mjs`, on the hand-written fixtures in `practices-fixtures/` |
| `RUBRIC-practice-describe-v1.md`, `RUBRIC-practice-match-v1.md`, `PRACTICE-PROMPT.md`, `PRACTICE-MATCH-PROMPT.md`, `RUBRIC-practice-recall-list-v1.md`, `RUBRIC-practice-recall-match-v1.md`, `RECALL-LIST-PROMPT.md`, `RECALL-MATCH-PROMPT.md` | the two practice labelling steps (WS-F F6), and the variant-recall lister and matcher: a description blind to the assignment, then a match; texts pinned by lib.mjs `APPROVED_PRACTICE_RUBRICS` (they replaced `RUBRIC-practices-v1.md` and `-v2.md`, never used); `prompt.mjs label` / `match` render them for a practice run, with lib.mjs `labellerCard` and the `promptLeaks` check |
| `select-apps13.mjs` | the apps13 fresh blind set (40 repos, amendment 2): apps11's criteria with a new seed and secret and wider exclusions (both apps11 halves, organisations); only hashes are committed (`../apps13-blind-hashes.json`) |

Node 22, no dependencies.

## Held-out rules

These rules make the held-out number mean something. Breaking one invalidates the run.

0. **Decision, 2026-11-05: the current sets are secondary.** This was decided by the product lead, before any held-out data existed, and is recorded in both manifests' `decision`.
   - **What is demoted.** The current sets (`holdout.json`, `holdout-py.json`) are demoted to `secondary`. No headline result may come from them. They may be reported only as an exploratory secondary check, with the exposure disclosed (see the isolation note below).
   - **What replaces them.** The **primary** held-out sets will be fresh, and selected by a code-blind script:
     - a seeded random sample from GitHub search, by language, size and activity;
     - the framework detected only from dependency manifests;
     - only url, sha and shape recorded.

     They are [`holdout-primary.json`](../holdout-primary.json) (`ts-primary-2026-11-05`) and [`holdout-primary-py.json`](../holdout-primary-py.json) (`py-primary-2026-11-05`), selected by `select-holdout.mjs` and frozen before any held-out run; see [Primary held-out sets: selection](#primary-held-out-sets-selection).
   - **How it is enforced.**
     - `role` (`"secondary"` here) is part of each manifest's frozen core, so it cannot be flipped to `"primary"` later.
     - `prepare.mjs` records the role in `run.json` and requires every held-out manifest to declare one.
     - `metrics.mjs` titles a secondary run "SECONDARY — not a headline result", and its JSON has `headline_eligible: false`.
     - Only a run of a `"primary"` held-out manifest is headline-eligible.

1. **The manifests are frozen.**
   - **The frozen core is** `set_id`, `role`, `frozen_at`, `repos`, `reserves`, `tier`, `max` and `pool`.
     - Once a version with `frozen_at` is committed, do not add, remove, reorder or re-pin anything in it.
     - **One exception, registered:** the `tier` of all four held-out manifests was replaced by decision D5's (`tier-d5.json`) before any held-out census: the primaries' with D5's approval, the secondaries' by the lead the same day. The `tier` of all four was then replaced by decision D7's (`tier-d7.json`), again before any held-out census: the primaries' under D7, the secondaries' by the lead (D7a). `holdout-manifests.json` `amendments` records each superseded core, and `prepare.mjs` accepts the earlier frozen versions only through those entries (tier only; see D5 and D7).
     - **A second exception, registered (decision D9, 2026-11-07, before any held-out census):** the primaries' `reserves` were extended, append only, after reserve exhaustion at runbook step 4, by the selection's own procedure; `holdout-manifests.json` `amendments` records each superseded core (`fields` `["reserves"]` or `["tier", "reserves"]`), and `amendmentAllows` accepts only a strict append.
     - `max` and `pool` fix "proposals shown" (census `--max`) and the recall pool. `tier` fixes the default tier.
     - `set_id` names the set across renames.
     - `eval/study/holdout-manifests.json` registers the sha256 of each manifest's canonicalised core (scheme `core-v2`, pinned in `prepare.mjs`).
   - **Three append-only lists sit outside the core**, so appending to them never changes the registered hash:
     - `replaced`: `{date, repo, reserve, reason}`.
       - A slot's current occupant may be replaced only if it fails a technical check, or (Python) overlaps the dev set. The current occupant is the primary, or a reserve swapped in earlier, so swaps chain. A failed check means: the clone fails, `drift scan` errors, or the repo has fewer than 200 parseable files.
       - The i-th swap must use the i-th reserve, and is decided before anyone looks at its proposals.
       - "Parseable files", and what happens when census or init fails, are fixed by [decision D3](#decisions-before-any-held-out-census-2026-11-05).
       - A replaced repo is no longer held-out, and may be a dev repo.
     - `burned`: `{date, name, reason}`, for rule 3 only.
     - `exposed`: `{name, where}`, for the isolation note below.
   - **The manifests carry only shape and size facts.** Selection notes about the code itself would be an answer key, so they are kept outside the repository and pre-registered by sha256 (`notes_sha256`). They are revealed with the held-out results.
   - **What `prepare.mjs` enforces.**
     - **Detection.** It decides whether a run is held-out by five tests, not just by the file's own flag:
       - the manifest's core hash is registered;
       - the file is named `holdout*.json`;
       - it is flagged `"holdout": true`;
       - it pins the commit of a repo a registered manifest still holds out: a current slot occupant, or an unused reserve; not replaced or burned (forks and mirrors included);
       - it lists the same `owner/repo` (https, ssh or `www.` URLs).
     - **Requirements.** For a held-out run, the manifest must be:
       - inside `--drift-src`, tracked and identical to HEAD;
       - marked `"status": "frozen"`;
       - equal in core to its registered hash;
       - declaring `set_id`, `frozen_at` and `role`;
       - consistent in its append-only lists.
     - **The history walk.** `prepare.mjs` walks the git history of every held-out manifest file: every path any registry version registered, and every `**/holdout*.json` (full clone required). Every committed version that has `frozen_at` must still exist among the registered manifests, by `set_id`, with an identical core. This refuses all of these, short of rewriting history:
       - a re-pin together with an updated hash;
       - a rename;
       - a `set_id` change;
       - a scheme bump;
       - a `role` flip.
2. **The product is frozen and built by `prepare.mjs`.** For a held-out run:
   - **Everything must be committed:** everything in the `--drift-src` checkout except `eval/study/runs/`, including untracked files. Product and harness are frozen together.
   - **`--drift-src` must be the checkout that contains the harness.**
   - **`prepare.mjs` builds the binary itself.** It exports `git archive HEAD` and runs `cargo build --release --locked` in a **fresh** `CARGO_TARGET_DIR` for the run (`<cache>/runs/<run>/build`, deleted first), so no uncommitted or ignored file, and no stale or replaced `target/`, reaches the binary.
     - The binary is copied out, and its sha256 is taken from that build.
     - Resuming the same run (`--only`, before any prompts) reuses the copy only if its sha256 still matches.
     - `run.json` records the commit and its tree, the binary's sha256, the `cargo`/`rustc` versions, the `RUST*`/`CARGO*` environment variables, and any user-level `~/.cargo/config.toml`, by hash.
   - **These flags are refused:** `--drift`, `--drift-commit`, `--force`, `--tier-min`, `--max`, `--pool` and `--reset-clones`. `max`, `pool` and `tier` come from the manifest.
   - **A run directory never accepts** another binary, another `max`/`pool`/`tier`, or another repo list.
   - **Once `prompts/index.json` exists** (labelling has started), a held-out run is never re-prepared.

   Dev runs still take `--drift BIN` and only *record* `--drift-src`. They also refuse to change `max`/`pool`/`tier` within a run dir without `--force`, which starts the run over.
3. **Held-out results are never used to tune.**
   - Nobody working on the product reads held-out proposals, labels, reasons or recall misses until the run is final and reported.
   - After that, the findings may motivate product work only if the repos involved are **burned**:
     - add them to `"burned"` in the manifest, with the date and reason (the registered core hash does not change);
     - move them to the dev set (`eval/repos.json`);
     - replace them in the next held-out set with fresh repos chosen the same way.
   - A number measured on a burned repo is a dev number.
4. **One run measures one product version.**
   - To measure a new version, start a new run directory against the same manifest. Do not relabel the old one.
   - Labels carry over between runs only for proposals whose uid and text are identical. Carried labels are reported as such.
5. **The tier is pre-registered.** The default tier's definition is the manifest's `tier`. `prepare.mjs` checks it (`checkTier` in `lib.mjs`), copies it into `run.json` before any labelling, and writes each queue item's `rule_kind` and `tier`. `metrics.mjs` recomputes the tiers from `run.json`, reports them as the result, and reports any `--tier-min` under "Exploratory, not pre-registered".
   - **Secondary sets** (`"kind": "min_members"`): default tier = role has ≥ 15 members.
   - **Primary sets** (`"kind": "rule_kind"`). Decided by the product lead on 2026-11-05, and written into the manifests and this rule before any data of these sets existed: before they were drawn, then amended once after the draw and before any run (see the decision log below):
     - **Default tier** (blocking-eligible). Its accept rate, ACCEPT / shown in the tier with unlabelled counted as WRONG, is the headline **default-tier accept rate**. It holds a proposal whose structured rule kind is one of the following, **and** whose role has ≥ 15 members (the plan's threshold for blocking):

       | Rule kind (`ruleKind`) | What it is |
       | --- | --- |
       | `wrapped_by:call` | call wrappers |
       | `wrapped_by:decorator` | decorators |
       | `wrapped_by:extends` | base classes |
       | `passes_key` | required argument keys |
       | `avoids:import` | layering (import avoidance) |
       | `renders` | rendered components |
       | `wrapped_by:jsx` | rendered inside a (layout) wrapper |

     - **Suggestion tier:** every other shown proposal. The lead named generic calls (`calls`), naming (`named`), absence (`avoids:other`: `any`, `console`, bare `Error` and other non-import signals), preferred libraries (`prefers_library`), ordering (`before`), and file, model and package rules (`has_test`, `model_has`, `package_has`, `dependency_version`). Unmeasured kinds go here too, because the default tier is an allowlist: `wrapped_by:try`, `control`, `directive` and `throws`. So does a proposal without a structured rule, and a default-tier kind whose role has fewer than 15 members.
     - **The not-wrong rate** is reported over all shown proposals, both tiers. `metrics.mjs` also reports both tiers' rates separately.
     - **Decision log.**
       - 2026-11-05: tier pre-registered by the product lead, before the sets were drawn.
       - 2026-11-05: tier amended before any held-out run (`wrapped_by:jsx` → default). No held-out data existed. The lead grouped it with rendered components using PR #4's final dev labels (164 proposals, double-labelled; the "rendered components" family in the PR #4 results comment): 71% accept, 93% not-wrong, n=14. From `runs/dev-2026-11-05` with the v1 labels the figures differ: `renders` + `wrapped_by:jsx` 18 proposals, 56% accept, 94% not-wrong; `wrapped_by:jsx` alone 5 proposals, 60% / 80%. Both are dev-set figures and small samples. Both manifests' `frozen_at` were reset to the amending commit, and PR #10 must be squash-merged, so that main's history only holds the amended version. The selection record keeps the tier as it stood at the draw (`spec.tier`); the tier plays no part in the draw, and the manifests' `tier` is the definition.
       - 2026-11-06: [decision D5](#decisions-before-any-held-out-census-2026-11-05) proposed by the lead and approved by the founder, before any held-out census. `passes_key` and `renders` move to suggestion, and a default-tier rule must name no package symbol (`tier-d5.json`). Both manifests now hold the D5 tier, registered as an amendment of their core.
       - 2026-11-06: [decision D7](#decisions-before-any-held-out-census-2026-11-05) approved by the founder, before any held-out census. The default tier is TypeScript/JavaScript call wrappers (`wrapped_by:call`) and layering (`avoids:import`) only, with D5's conditions on top; decorators, base classes and JSX layout wrappers move to suggestion, and every Python proposal is suggestion tier (`tier-d7.json`). Both primary manifests now hold the D7 tier, registered as a second tier-only amendment of their core. The secondary sets keep D5's tier (D5a).
       - 2026-11-06: secondary sets amended to D7 (lead), before any held-out census: [decision D7a](#decisions-before-any-held-out-census-2026-11-05), "secondary sets measured under the D7 tier". `eval/holdout.json` and `eval/holdout-py.json` hold `tier-d7.json`'s tier, registered as tier-only amendments from each earlier frozen core (the drawn one and D5a's) to the new one, so that they still run and measure the tier the product ships. Nothing else about the secondary sets changes.
       - 2026-11-06: secondary sets amended to D5 (lead), before any held-out census: [decision D5a](#decisions-before-any-held-out-census-2026-11-05), "secondary sets measured under the D5 tier". `eval/holdout.json` and `eval/holdout-py.json` hold `tier-d5.json`'s tier, registered as tier-only amendments like the primaries', so that they still run and measure the tier the product ships. The two entries were first recorded under D5; `holdout-manifests.json` `corrections` changes their decision to D5a without rewriting them (amendments are append-only); `lib.mjs` `effectiveAmendments` applies the corrections wherever amendments are reported (`select-holdout.mjs verify`, the history check's messages, and each held-out `run.json`'s `amendments`). The sets stay exploratory: never a headline result, and their exposed repos are still reported separately.
     - **The rule kind is structured,** never read from summary text. It is `ruleKind(rule)` of the `conventions.yaml` rule: `rule.type`, with `rule.kind` for `wrapped_by`, and `import:` versus other signals for `avoids`.
6. **The Python set must not overlap the Python dev set.**
   - On overlap, the held-out repo gives way (next reserve, recorded in `replaced`), never the dev repo.
   - This list is public. So the Python dev set must be picked by criteria written down before looking at it, or from repos with no overlap. Otherwise whoever picks the dev set can knock out held-out repos.
   - **This has happened once.** On 2026-11-05 the Python dev set (`eval/repos-py.json` on `ws/python`, chosen independently, without seeing this list) turned out to contain polar and CTFd, and both had already driven product fixes. They were replaced by the first two reserves, in order:

     | Held-out repo | Shape | Replaced by | Shape |
     | --- | --- | --- | --- |
     | polar | FastAPI | pretalx | Django |
     | CTFd | Flask | lnbits | FastAPI |

     FastAPI is still covered (mealie, lnbits). Flask is now covered by one repo only, indico (Flask + Celery). No reserve is a plain Flask app. Adding one would need a new pre-registered reserve, not an ad-hoc pick.

### Decisions before any held-out census (2026-11-05)

**Decision log, 2026-11-05 (D1–D4) and 2026-11-06 (D5, D5a, D6, D7, D7a): decided before any held-out census.** No primary held-out repo had been cloned, scanned or censused, and no held-out data of the primary sets existed (see the isolation note on one secondary-set repo, 2026-11-06). D1 and D2 were decided by the founder, D3 and D4 by the product lead; D5 (2026-11-06) is the lead's, approved by the founder the same day; D5a is the lead's; D6 is the lead's, approved by the founder on 2026-11-06; D7 was approved by the founder on 2026-11-06; D7a is the lead's. D8 (2026-11-07) is a pre-registration of a candidate Python default tier: not decided, not adopted, and it changes nothing that runs. D9 (2026-11-07) is the lead's, at runbook step 4, before any held-out census: the freeze scope and further reserves after reserve exhaustion. D11 (2026-11-07) is the lead's, after the primary run was reported and before any data of the new sets: a second held-out draw (selection only). The definitions of rules 1 and 5 and the targets table are unchanged; these decisions fix what they left open. `HELDOUT-RUNBOOK.md` follows them, and `metrics.mjs` prints them (`lib.mjs` `TARGET`, `TARGET_CRITERION`, `NOT_WRONG_CRITERION`, `COURSE_MATERIAL`), and every `metrics.json` carries the log as `decisions` (`lib.mjs` `DECISIONS`).

- **D1: when the 95% target is met.**
  - **The criterion.** The default-tier accept target is met when its **point estimate, per language**, is ≥ 95%:
    - TypeScript/JavaScript (`ts-primary-2026-11-05`) and Python (`py-primary-2026-11-05`) are judged separately;
    - the rate is ACCEPT / shown in the default tier (rule 5), with unlabelled counted as WRONG.
  - **The intervals** (Wilson and both repo-cluster intervals) are always published next to it.
  - **Pooled TypeScript/JavaScript + Python figures** are reported as secondary only.
  - **Where it shows.** `metrics.mjs` states the criterion in the bold default-tier cell of the per-language table. It gives the verdict there (MET or NOT MET) for a primary held-out run only; pooled rows carry no verdict.
- **D2: course-material repos.**
  - **What.** `computer-science-fundamentals` (`ts-primary-2026-11-05`) and `cs146s_cn` (`py-primary-2026-11-05`) look like course material by name. The name filter of the selection did not catch them.
  - **Decision.** They stay in, as pre-registered: rule 1 replaces a repo only on a technical failure. The results with them are the result.
  - **Reporting.** Both are flagged in the report. The per-language results are shown with and without them: the "Sensitivity" table of `metrics.mjs`, from `COURSE_MATERIAL`.
- **D3: rule 1 details.**
  - **Parseable files.** They are `drift scan`'s files minus its parse errors, as `techcheck.mjs` counts them.
  - **Census or init errors.** Sometimes a repo passes the technical check, and then its census or `init` errors in `prepare.mjs`. That repo is **reported as a failure, with no swap**, and the run continues with the rest. `metrics.mjs` lists it under the failed repos.

- **D4: when the not-wrong target is met (product lead; the founder may override it before the census).**
  - **The criterion.** The not-wrong target is judged the same way as D1. It is met when its **point estimate, per language**, is ≥ 95%. The rate is (ACCEPT + TRIVIAL) / all shown, both tiers, with unlabelled counted as WRONG, and TypeScript/JavaScript and Python are judged separately.
  - **The intervals** (Wilson and both repo-cluster intervals) are always published next to it.
  - **The pooled row** is secondary, with no verdict.
  - **Where it shows.** `metrics.mjs` states the criterion in the bold not-wrong cell ("All shown (both tiers)") of each language. It gives the verdict there (MET or NOT MET; `by_language[].not_wrong_target` in JSON) for a primary held-out run only; dev runs say "no verdict".
  - **An override** by the founder must be recorded here, dated, before any held-out census.

- **D5: the default tier admits only in-repo structural rules (lead; approved by founder 2026-11-06, before any held-out census).**
  - **Approval.** The founder approved D5 on 2026-11-06, choosing it over C6 (D5 plus package targets at entry points) and over keeping rule 5. No held-out census had run.
  - **Recorded before any held-out census.** No held-out repo had been cloned, scanned or censused, and no held-out data existed. The analysis used dev labels only, and its author did not open the held-out manifests. The memo is [`TIER-ADMISSION.md`](TIER-ADMISSION.md).
  - **The change to rule 5's tier.** The definition is `tier-d5.json`. A shown proposal is in the default tier when all three hold:
    - its rule kind is `wrapped_by:call`, `wrapped_by:decorator`, `wrapped_by:extends`, `avoids:import` or `wrapped_by:jsx`. `passes_key` and `renders` move to the suggestion tier;
    - **its rule names no symbol from outside the repository** (`default.target: "in_repo"`): no `pkg:` (package), `global#` (built-in or ambient, such as `Error` or `Exception`) or `unresolved:` wrapper, decorator, base class or callee, and no `import:` avoidance of one. The checks are `lib.mjs` `namesPackage` and `drift_mine::tier::names_package`, with the prefixes `security.rs` treats as not internal. A package object addressed through a binding the repository defines (`CTFd/models/__init__.py#ma.ModelSchema` after `ma = Marshmallow()`, `sso-router.ts#passport.authenticate`) has an in-repo id and counts as in-repo: a known limit (memo §5).
    - its role has ≥ 15 members, as before.

    Everything else is suggestion tier.
  - **Why.** Measured on the dev labels, unlabelled counted as WRONG:

    | Language | Rule 5 default tier | D5 default tier |
    | --- | --- | --- |
    | TypeScript/JavaScript | 83.7% (77/92) | 96.2% (50/52) |
    | Python | 68.8% (11/16) | 90.0% (9/10) |

    Leave-one-repo-out cross-validation of the procedures that choose such a rule gives 91.2–100% for TS (91.2–95.7% for those that keep 46 or more proposals) and 75–100% for Python, on 5–10 proposals. The cost is 27 TS and 2 Python accepted proposals that become suggestions. No support, lift, outlier or size threshold improved the cross-validated precision.
  - **What does not change.** D1, D4 and the targets table are unchanged. D1's rate is ACCEPT / shown in the default tier, which is D5's. The not-wrong rate stays over all shown proposals, both tiers, so D5 cannot change it.
  - **The product implements D5,** `tier_of` in `crates/drift-mine/src/tier.rs`; `census --json` gives each proposal's `tier_reason` (`null` in the default tier, else `rule_kind`, `names_package` or `small_role`) and `names_package`.
  - **The manifests hold D5 (applied 2026-11-06, in #28).** All four held-out manifests' `tier` is `tier-d5.json`'s, verbatim; nothing else in them changed. The primaries were amended with D5's approval; the secondary sets were amended to D5 by the lead the same day, so that they still run and measure the product's tier. Their new core sha256 are in `holdout-manifests.json`, which records the change under `amendments` (the superseded core, the new core, `fields: ["tier"]`, decision D5). `prepare.mjs` accepts an earlier frozen version of a manifest only through such an amendment (`lib.mjs` `amendmentAllows`: the earlier version with the current tier has the registered core), and `select-holdout.mjs verify` checks the amendments and that every registered manifest holds `tier-d5.json`'s tier. Both run the same history check (`lib.mjs` `heldOutHistoryProblems`): every frozen version is the current core or allowed by an amendment; amendments are append-only and unique, name only cores of frozen versions, and none is dated, or first committed, at or after the first held-out census recorded under `eval/study/runs`. An entry allows a version only when it produced the current core: a second amendment of a manifest adds an entry from every earlier frozen core to the new one, and the earlier entries stay.
  - **Guards, all failing closed on a mismatch** (not a defence against tampering; see "What it can and cannot do" below). `cargo test` (`definition_is_d5_in_the_product_and_every_held_out_manifest`) and `tier.test.mjs` require every registered held-out manifest's tier to equal `tier-d5.json`'s, which equals the product's constants. A held-out `prepare.mjs` run refuses a manifest whose tier is not `tier-d5.json`'s, and stops when any proposal's census `tier:` line differs from `tierOf` under the manifest's tier or is missing (`--strict-tier` does the same on dev runs).
  - **Conventions already set to block** under rule 5 (argument keys, rendered components, package or built-in targets) keep blocking until a person changes them; the README says so.
  - **No amendment after a held-out run: ordered by history, not dates.** `heldOutHistoryProblems` refuses an amendment unless a registry commit holding it is an ancestor (`git merge-base --is-ancestor`) of every commit, on any ref, that adds or changes a held-out run record at any depth under `eval/study/runs`. Committer dates and the `date` field play no part, so back-dating does not help, and a run recorded on another branch still counts. Every walk runs without history simplification (`--full-history -m`) and reads each commit's tree with raw paths (`-z`): a record added by a merge, a run branch merged with `-s ours` and deleted, a branch that later removed its run directory, or a merge that takes another branch's registry cannot hide a record or an entry. A listed record that cannot be read (not a file, not JSON) is a problem, never skipped.
    - **Every held-out census leaves a committed marker.** A held-out `prepare.mjs` run must use `--run eval/study/runs/<name>`, with a name of `[A-Za-z0-9._-]+`. Before any census it writes `<run>/start.json` (`held_out: true`, the manifest, its core, the product commit, `started_at`) and stops until that file is committed. A run that dies mid-census still leaves the marker.
    - **The product commit is unchanged by run records.** It is HEAD less any trailing commits that change only `eval/study/runs/` (compared without rename detection, so moving product code into `runs/` does not count), so committing a start record does not change what is built or measured.
    - **The `--only none` preflight is not a census.** It clones and scans nothing, its `run.json` has no repo rows, and it writes no start record, so it does not count.
    - **What it can and cannot do.** These checks read the local clone. They prevent accidents and honest-operator mistakes: an amendment made after a run, a run on a forgotten branch, a run that crashed. They are not a defence against tampering: someone who rewrites local history, or deletes an uncommitted run directory, can defeat any local check. The pushed git history and the PR record are the audit trail, so push each start record before its census.
- **D5a: the secondary sets are measured under the D5 tier (lead, 2026-11-06, before any held-out census).** The secondary sets (`eval/holdout.json`, `eval/holdout-py.json`) are exploratory, but they must still run and must measure the tier the product ships. Their tier is replaced by `tier-d5.json`'s, as a tier-only amendment of each core. D5's founder approval covered the primary sets only; this is the lead's decision. Nothing else about the secondary sets changes: never a headline result, exposed repos reported separately.
- **D6: rubric v3 (lead; approved by founder 2026-11-06, before any held-out census).**
  - **Why.** On proposals that are alike, labellers following v2 gave contradictory labels, and agreement was κ 0.67 (TypeScript, `runs/dev-ts-r2-2026-11-05`, PR #25) and κ 0.64 (Python, `runs/dev-py-r2-2026-11-05`, PR #22). The labellers' reasons locate the splits:
    - **a class-level decorator restated for every handler:** twenty `D-6429a5` and `D-7e503c` ACCEPT, immich `D-4fc758` WRONG `misdescribes` ("applied at class level");
    - **a key the callee's type already requires:** infisical `D-d9b44e` and `D-1b2542` ACCEPT ("everyone uses the factory"), twenty `D-47b768` and `D-006db2` TRIVIAL by the type, although every outlier of all four never calls the callee;
    - **library primitives** (react-email in dub's `packages/email`, all five sharing two fragment outliers): `<Preview>` and `<Footer>` ACCEPT, `<Text>` and `<Tailwind>` TRIVIAL ("describes what an email is", "visible in preview": not v2 tools), `<Container>` WRONG;
    - **a few outliers of another kind** (helpers, fields, infrastructure): CTFd `D-560792` ACCEPT and `D-f6c1fb` WRONG for one field class versus a validator and a field; ai `D-fc5ef7` ACCEPT but midday `D-efc6d4`/`D-98e729` WRONG, by the same adjudicator reasoning both ways; polar `D-fb4011` ACCEPT on "only 3 of 38";
    - **incidental or a choice:** supabase `D-d8dcea` (WRONG `incidental` versus ACCEPT for return-type annotations), saleor `D-e36ea5`.
  - **The decision.** [`RUBRIC-v3.md`](RUBRIC-v3.md) is v2 with nine decision rules, each derived from the rubric's question, *would a reviewer on this team want an agent told this?*, and each with a made-up worked example (no dev case appears in the rubric, so the calibration below stays blind). Which way each rule moves labels:

    | Rule | Settles | Moves labels |
    | --- | --- | --- |
    | R1 one-offs | only the definition of the wrapper/base/callee and the one aggregator are set aside; every other outlier of another kind counts, however few | towards WRONG (`mixed_group`) for "only a few helpers" ACCEPTs; towards ACCEPT/TRIVIAL where only one-offs were outliers |
    | R2 count | ACCEPT only if more than half of the counted outliers are `mistake`/`look`; open three more when the first three disagree | towards WRONG where a hypothetical violation outweighed legit outliers; towards ACCEPT where a minority of legit outliers decided WRONG; sampling neutral |
    | R3 security exception | covers only outliers where something is at stake (a reachable endpoint, posted data, a read input) | towards WRONG versus a broad reading; matches most v2 labels |
    | R4 class decorators | a class-level decorator counts for its methods; wording → `clear: false`; duplicates are no label reason | away from `misdescribes`, towards whatever Q2/Q3 decide |
    | R5 required keys | the type catches the missing key, not the missing call; non-callers judged by R1/R2 | towards TRIVIAL when only one-offs remain (these were ACCEPT); towards WRONG/ACCEPT when outliers never call the callee (these were TRIVIAL) |
    | R6 indirect compliance | doing it through a helper that does it is `not_violation` | towards WRONG `false_outliers` where most outliers comply indirectly |
    | R7 library primitives | "every member has it" or "visible in preview" is not TRIVIAL; incidental only when outliers lack the content | away from TRIVIAL, towards ACCEPT or WRONG by R2 |
    | R8 incidental or choice | incidental only when outliers lack the need, or the order has no effect; an unenforced style the outliers could follow is a choice | towards ACCEPT for consistently followed style choices; towards WRONG `incidental` for need-driven rules |
    | R9 as checked | an "or" list is met by any alternative; loose wording is `clear: false`, not `misdescribes` | away from `misdescribes`, towards Q2/Q3 |

    Taken together they are **not** expected to raise accept rates. R1, R2, R3 and R5 push the most common contested pattern (an ACCEPT with a few legitimately different outliers) towards WRONG or TRIVIAL; R4, R7, R8 and R9 push some WRONG and TRIVIAL labels towards ACCEPT.
  - **The approved text.** The labeller-facing text of `RUBRIC-v3.md` (what `prompt.mjs` renders, `lib.mjs` `rubricText("v3")`) has sha256 `79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd`, the text the calibration was labelled with. It is pinned in `lib.mjs` `APPROVED_RUBRIC` and in `DECISIONS`. `prepare.mjs` refuses a held-out run, and `prompt.mjs` refuses held-out label and adjudication prompts, with any other text, and `pipeline.test.mjs` fails if the committed rubric drifts from it. Any later rubric change needs a new recorded decision.
  - **Scope.** v3 applies to the held-out run and to every dev round started after this decision. One run uses one rubric **text**. `prompt.mjs` gives a new run v3, and keeps a run that already has v2 prompts on v2. It refuses to mix versions, and it refuses to render when the rubric text differs from that of the run's earlier prompts (the file was edited: start a new run). It records `rubric` and the text's sha256 per prompt. `collect.mjs` stamps that sha256 on every collected record, so the text survives a cleared or edited `prompts/index.json`. It rejects records whose `rubric` is not the prompt's, and records of a prompt whose text differs from the run's (from the index or from records already collected). `prompt.mjs` reads both sources as well. `agree.mjs` and `adjudicate.mjs` refuse label sets that name two texts (`agree.mjs --allow-mixed-rubric` compares across rubrics on purpose, as the calibration's shift does). `adjudicate.mjs --merge` carries the text into `final.jsonl`. The targets and criteria (D1–D4) are unchanged. v2 and v3 figures are not directly comparable: dev figures published before D6 are v1/v2 figures.
  - **Calibration, before the held-out run** ([`runs/calib-v3-2026-11-06/`](runs/calib-v3-2026-11-06/README.md)). The plan: a blind A/B (and C) relabel under v3 of 63 already-labelled dev proposals (37 TypeScript, 26 Python): every case above and every A/B disagreement of the two r2 rounds (23), plus 40 drawn at random, 10 per language and tier, half from the v2-labelled r2 rounds where the cell allows. It reports the v2→v3 shift (each uid's previous final label against its v3 final label, split by previous rubric) and A/B κ under v3, which should rise above 0.67 / 0.64. Read κ on the 40 drawn proposals separately: the 23 forced ones were chosen because they are hard. The 53 r2 labels were read while writing v3, so the calibration is in-sample for them; the held-out run is the out-of-sample test.
  - **Expected effect, written before the calibration** (kept as it was). The dev default-tier accept rates (TypeScript 83.7%, 77/92; Python-side 68.8%, 11/16) were expected to fall by a few points. Six default-tier ACCEPTs among the named cases were expected to become WRONG or TRIVIAL, and one WRONG might become ACCEPT (immich `D-4fc758`, R4).
  - **Calibration results** (2026-11-06; [`shift.md`](runs/calib-v3-2026-11-06/shift.md), [`shift-drawn.md`](runs/calib-v3-2026-11-06/shift-drawn.md), [`shift-forced.md`](runs/calib-v3-2026-11-06/shift-forced.md), [`shift-prior-v2.md`](runs/calib-v3-2026-11-06/shift-prior-v2.md), [`shift-prior-pre-r2.md`](runs/calib-v3-2026-11-06/shift-prior-pre-r2.md); TS [`agreement-drawn.md`](runs/calib-v3-2026-11-06/ts/agreement-drawn.md), Python [`agreement-drawn.md`](runs/calib-v3-2026-11-06/py/agreement-drawn.md)). 61 of the 63 uids were labelled; CTFd's two were excluded (below).
    - **Agreement rose.** A/B κ under v3, on the 40 drawn uids: **0.89** TypeScript and **0.89** Python (95% exact agreement each), against κ 0.67 and 0.64 under v2. On all labelled uids: 0.93 (37) and 0.90 (24).
    - **Every shift was towards WRONG.** 18 of 37 ACCEPTs and all 4 TRIVIALs became WRONG; nothing became ACCEPT. On the drawn 40: 11 of 27 ACCEPTs became WRONG.
    - **Default-tier proposals, ACCEPT before → under v3,** under two tier definitions (each row says which):

      | Tier | Drawn | Forced |
      | --- | --- | --- |
      | **rule 5** (the rule-kind tier as pre-registered for the primary sets before D5; `params.tier` of `runs/*/views/rule5/run.json`) | 16/20 → 11/20 (TypeScript 9 → 6 of 10, Python 7 → 5 of 10) | 7/14 → 2/14 |
      | **D5** (`eval/study/tier-d5.json`, with `lib.mjs` `tierOf` since #28) | 12/12 → 8/12 | 3/3 → 2/3 |

      `node eval/study/runs/calib-v3-2026-11-06/tier-rows.mjs` reproduces both rows, with no arguments, now that #28 is merged. The held-out manifests now hold D5's tier, so the rule-5 row reads rule 5 from the views' `run.json`.
    - **Which rules.** The 22 shifted uids cite R2 (21), R1 (14), R5 and R8 (5 each), R7 (4), R6 (3) and R9 (1) in labeller A's `rules`; their v3 reasons are `mixed_group` 10, `legit_outliers` 8, `incidental` 3, `false_outliers` 1. The rules expected to move labels towards ACCEPT (R4, R7, R8, R9) moved none.
    - **How to read it.** The 29 uids last labelled under v2 agree with their v3 labels 82.8% (κ 0.66), about the v2 A/B agreement, so their shift alone is not clearly beyond labeller noise; but all 5 of their changes go one way (ACCEPT → WRONG), which noise would not do. The 32 pre-r2 labels agree 46.9%, and include the v1 → v2 change. The forced 21 were chosen because they are hard, and they and the r2 labels were read while v3 was written: the calibration is **in-sample** for them, and the held-out run is the out-of-sample test.
    - **CTFd excluded.** CTFd's labeller was stopped by a safety system, a false positive on capture-the-flag content, so its two uids (`D-560792`, `D-f6c1fb`) have no v3 labels and are left out of every figure above.
  - **The founder's decision (2026-11-06).** The founder approved v3, choosing it over "v3 and report both" and over keeping v2. Because v3 makes the 95% target much harder, the founder also decided that **the default tier ships as advise (warn, never block) until it measures ≥ 95% default-tier accept under v3**: see the release gate under [Targets](#targets-as-defined-in-the-plan-of-record). The product change is a separate task.

- **D7: the default tier is TypeScript/JavaScript call wrappers and layering; Python advises (approved by the founder 2026-11-06, before any held-out census).**
  - **Approval.** The founder approved D7 on 2026-11-06. It is option C of the round-5 precision plan (option B, call wrappers and layering only, for TypeScript; Python advise-only), which that plan recommended over option A (keep D5's rule kinds and land every fix).
  - **Recorded before any held-out census.** No primary held-out repo had been cloned, scanned or censused, and no held-out data existed. The analysis used dev labels only (`runs/dev-v3-2026-11-06`, rubric v3; every figure below is a dev, in-sample figure). The manifests were changed by a script that replaced their `tier` value only (below).
  - **The change to D5's tier.** The definition is `tier-d7.json`. A shown proposal is in the default tier when all four hold:
    - **its language is TypeScript/JavaScript** (`default.languages: ["ts"]`). The language is read conservatively: a proposal is Python when **any member of its role** is Python (conventions.yaml `evidence.python_members`, recorded at mining) or its example path is (a `.py`/`.pyi` file or a Python package manifest: `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `Pipfile`), TypeScript/JavaScript otherwise (`lib.mjs` `proposalLanguage`, `drift_mine::tier::convention_language`). So a role mixing `.ts` and `.py` members never blocks its Python members, and `drift init` re-picking the example cannot move such a convention into the default tier. **Python has no rule kind in the default tier:** it is advise-only, and every Python proposal is suggestion tier (`suggestion.languages: ["py"]`);
    - **its rule kind is `wrapped_by:call` (call wrappers) or `avoids:import` (layering).** `wrapped_by:decorator`, `wrapped_by:extends` and `wrapped_by:jsx` move to the suggestion tier, as does every other kind;
    - its rule names no symbol from outside the repository (no `pkg:`, `global#` or `unresolved:` target), as in D5;
    - its role has ≥ 15 members, as before. The count is the **role's size**, exempt members included (`evidence.role_members` when the rule is about only part of the role, else `total`; `lib.mjs` `tierMembers`, `Evidence::role_size`). `prepare.mjs` copies it, and `python_members`, from conventions.yaml into each queue item, so the census `tier:` line and `tierOf` read the same count.

    Everything else is suggestion tier.
  - **Per language, by the convention's language.** `metrics.mjs` splits its per-language rows by the convention's language (`proposalLanguage`), not the repo's: a Python set's frontend rules are a TypeScript row of that run, reported but without a verdict ("not this set's language"); only the set's own language row carries D1's and D4's verdicts.
  - **Why.** On the v3 dev labels, D5's default tier did not approach 95% for either language, and the gap sits in the rule kinds, not in the thresholds:
    - **Per-violation analysis** (dev, in-sample; main `cd8296b`): TypeScript precision per violation is 89.5% for layering and 81.8% for call wrappers, against 36.7% for decorators and 26.9% for base classes. Switching D5 to per-violation scoring does not rescue it (TypeScript 63.6%, Python 48.3%). Call wrappers and layering per rule: TypeScript 75.0%.
    - **Round-5 plan** (dev, rubric v3, D5 default tier): with every known fix class, D5's kinds reach about 88.6–93.2% for TypeScript and 70.6% for Python. With call wrappers and layering only, TypeScript projects to about **96%** (96.4%, interval 82–99%) after the open precision PRs, the mixed-auth-set change and F10, on 7 of 16 dev repos, at the cost of 10 accepted class rules. Python class rules (`extends`, decorators) stall at about **55–64%** at best (2 of 15 accepted today), and Python's call-wrapper and layering sample is too small to judge (3 repos).
    - These are projections on dev repos, in-sample for the fixes. Only a primary held-out run measures D7.
  - **Measured on the dev labels now** (rubric v3, unlabelled counted as WRONG; `runs/dev-v3-2026-11-06/*/views/d7`, a derived view, before the round-5 fixes): TypeScript default tier **75.0%** (24/32; Wilson 57.9–86.7%; cluster 45.7–93.0% / 46.8–100%, 9 repos), against 67.3% (35/52) under D5: call wrappers 14/19, layering 10/13. D7 moves 20 TypeScript proposals out of D5's default tier (decorators 6, base classes 12, JSX wrappers 2; 11 of them ACCEPT). Python (`py`, `py2`): no default tier (D5 had 3/10 and 6/14). The not-wrong rate is over all shown proposals, both tiers, so D7 cannot change it.
  - **What does not change.** D1, D4, D6 and the targets table are unchanged. **The release gate is unchanged in form:** a language's default tier ships as advise until it measures ≥ 95% default-tier accept under rubric v3, judged per D1, on a primary held-out run. Under D7, Python has no default tier, so Python stays advise-only whatever is measured; a Python default tier needs a new recorded decision.
  - **The product implements D7,** `tier_of` in `crates/drift-mine/src/tier.rs`: the convention's language is `convention_language` (any Python member, else the example), and `census --json` and `check --format json` give it per proposal as `language` (`ts` or `py`), with `evidence.python_members`. `census --json` gives each proposal's `tier_reason`: `null` in the default tier, else the first condition it fails, in order: `language_advise` (a Python proposal), `rule_kind_d7` (a decorator, base-class or JSX-wrapper rule: D5's default kinds that D7 left out), `rule_kind` (any other kind), `names_package` or `small_role`. `params.tier` names the decision (`"decision": "D7"`) and the languages. Conventions already set to block keep blocking until a person changes them, as under D5.
  - **The manifests hold D7 (applied 2026-11-06).** `eval/holdout-primary.json` and `eval/holdout-primary-py.json` hold `tier-d7.json`'s `tier`, verbatim. They were edited by a script that parsed each file, replaced exactly the `tier` value, checked that no other key changed and that the file's layout round-trips, and wrote it back, printing only confirmations. `holdout-manifests.json` registers their new core sha256, computed with `lib.mjs` `coreSha` (there is no register command; `select-holdout.mjs write` runs once), and records the change under `amendments`: for each primary, one tier-only entry from **every** earlier frozen core (the original and D5's) to the new core, as `amendmentAllows` requires (no chaining). `select-holdout.mjs verify` passes, history check included.
  - **The secondary sets: D7a.** D7 names the two primary manifests only; the secondary sets were amended to it by the lead (D7a, below). `lib.mjs` `heldOutTierFile` now requires `tier-d7.json` for both roles.
  - **Guards** (as D5's, failing closed). `cargo test` (`definition_is_d7_in_the_product_and_every_held_out_manifest`) and `tier.test.mjs` require every registered held-out manifest's tier to equal `tier-d7.json`'s, which equals the product's constants. `tier-cases.json` carries an example per case, and both implementations agree on every case's D7 tier and reason. A held-out `prepare.mjs` run refuses a manifest whose tier is not its set's, and stops when any proposal's census `tier:` line differs from `tierOf` under the manifest's tier.
- **D7a: the secondary sets are measured under the D7 tier (lead, 2026-11-06, before any held-out census).** The secondary sets (`eval/holdout.json`, `eval/holdout-py.json`) are exploratory, but they must still run and must measure the tier the product ships, which is D7's since #61: under D5a's tier a held-out `prepare.mjs` run of one stops at the census tier check. Their tier is replaced by `tier-d7.json`'s, as a tier-only amendment of each core, exactly as D5a did for D5.
  - **How it was applied.** A script parsed each manifest and replaced exactly the `tier` value. It checked that every other key is equal, that the key order and layout are unchanged, and that the new block equals `tier-d7.json`'s `.tier`, and printed only those confirmations and the core hashes; nothing else in the files was read or printed.
  - **Registered.** `holdout-manifests.json` `manifests` holds the new cores (`eval/holdout.json` `ca69f1b9f514…`, `eval/holdout-py.json` `6c44f508e915…`), and `amendments` gains four tier-only entries, decision D7a: one from each earlier frozen core of each set (the drawn core and D5a's) to the new core. The earlier entries stay.
  - **What does not change.** D7's founder approval covered the primary sets only; this is the lead's decision. Nothing else about the secondary sets changes: never a headline result, exposed repos reported separately.
- **D8 (pre-registered 2026-11-07, not adopted): a Python default tier, candidate.** Recorded before any Python labelling for it and before any held-out census. **Nothing changes in the product or the held-out sets:** the shipped tier is D7's, every Python convention still advises, and the four held-out manifests still hold `tier-d7.json`'s tier. D8 is adopted only by a later recorded decision (founder approval, as D7), and only if every threshold below is met. The evidence and the staged pool are in [`runs/d8-prereg-2026-11-07/`](runs/d8-prereg-2026-11-07/README.md).
  - **Status.** Pre-registered at the lead's request (D8 workstream), from the merged Python plan ([`runs/py-plan-2026-11-07`](runs/py-plan-2026-11-07/README.md), #67: Python stays advise-only; its "D8 candidate, for later"). Not approved, not adopted. No label of a D8 card has been made; the pool is staged, not labelled. **The staged dev pool (main `f293f1c` plus this candidate) is 2 cards from 2 repos** (Django-CRM `D-f135a4`, simplelogin `D-2a4960`) of the 18 `py`/`py2` repos, against the 40 cards from 10 repos required: stopping rule 3 applies, no D8 label is made, and D8 cannot be tested on the current Python dev sets.
  - **The candidate tier** (`tier-d8-candidate.json`; product: `drift_mine::tier::d8_candidate_reason`, reported by `drift census --json --candidate d8` as each proposal's `candidate`). A shown proposal would be default tier when:
    - **TypeScript/JavaScript:** exactly D7 (call wrappers and layering, in-repo targets, roles of ≥ 15). D8 does not change TypeScript/JavaScript;
    - **Python** (by `convention_language`, as D7: any Python member makes it Python): its rule kind is `wrapped_by:call` or `avoids:import`; it names no symbol from outside the repository (D5's `in_repo`); **a call wrapper's every alternative is a guard**, by the product's guard notion (`drift_mine::security::authenticates`, which mining uses for auth variant sets since #60: read from the definition, the wrapper turns away callers who are not signed in or not allowed, or is a library's own guard; a name that opens access, such as `login_required_optional`, is never one), so a database session (`get_db`) or a mixed set is not admitted; and **its role has ≥ 50 members** (the role's size, exempt members included, as D7).
    - Everything else is suggestion tier: Python decorators, base classes, `passes_key` and every other kind. Reasons (`candidate.reason`): `rule_kind`, `names_package`, `not_guard`, `small_role` for Python; D7's for TypeScript/JavaScript.
    - **The study cannot read definitions**, so `lib.mjs` `tierOf` takes the guard fact from the item's `guards`, which `stage.mjs --candidate-json` copies from the product's `candidate.guards`; anything but `true` is suggestion tier (fail closed), and `stage.mjs` stops unless the product's candidate tier and the study's agree on every proposal. The shared `d8_cases` of `tier-cases.json` run through both implementations.
  - **The member floor: 50 [STRICT]**, from the v3 dev labels by rule family (`runs/dev-v3-2026-11-06/{py,py2}/final.jsonl`, metrics.mjs's per-language, tier and rule family table, #68; [`floors.md`](runs/d8-prereg-2026-11-07/floors.md), polar and CTFd left out):
    - **No labelled Python card of the D8 kinds has a role under 40** (10 cards: 9 call wrappers, 1 layering, roles 40–195). Floors 15, 20, 30 and 40 give the same default tier on the labels (call wrappers 4/6 accepted, layering 1/1), so the labels say nothing about Python roles of 15–39 for these kinds; D7's 15 would extrapolate from TypeScript. Across all Python families, cards with roles under 40 are accepted less often (5/22, 22.7%) than those of 40 or more (19/57, 33.3%).
    - **At a floor of 50 the call-wrapper family's default tier is 3/3 accepted (no WRONG); at 40 it is 4/6.** Both WRONGs sit at 40–43 members (tasking-manager `D-c373f7`, `get_db` with `login_required_optional`; `D-3e220e`, `get_db`). The guard condition should remove both on its own (neither set is all guards), but it has never been labelled on Python; 50 is a second, independent safeguard against the same failure. Its cost on the labels: one guard ACCEPT (Django-CRM `D-4a6ea2`, 41 members).
    - Not higher: no label supports it, and every further step only drops ACCEPTs. Not 40: the stricter choice was taken (both labelled call-wrapper WRONGs are below 50).
  - **Dev evidence, before any held-out run** (every condition must hold):
    - **≥ 40 D8 default-tier Python cards from ≥ 10 Python dev repos**, where a card counts once, in the D8 Python default tier of one frozen dev census (one product commit, census `--max 15`), and no repo supplies more than 10 of the 40 [STRICT] (cards beyond 10 in a repo count in the rate but not towards n).
    - **Labelled fresh under the v3 protocol**, in one round: rubric v3 at the approved text (D6); blind labellers A and B, **one fresh agent per (labeller, repo)**, A and B of one repo never at once; `collect.mjs` validates every output; **`agree.mjs` records A/B agreement before** `adjudicate.mjs` lists the disagreements; C adjudicates them; `adjudicate.mjs --merge` writes `final.jsonl`. **No label is carried** from an earlier round, even for an identical card [STRICT]: the earlier labels were read to design D8.
    - **Dev accept ≥ 97.5% (point estimate)**, ACCEPT / all D8 Python default-tier cards, unlabelled counted as WRONG (at n = 40: at most one card not ACCEPT; TRIVIAL is not ACCEPT), **and no WRONG reason in two or more repos** [STRICT, from the Python plan]. Reported with Wilson and both repo-cluster intervals, and A/B κ; κ does not gate.
    - **Repos.** Only dev repos: never a repo of a held-out manifest (prepare.mjs's held-out check must pass), never polar or CTFd. `py` and `py2` (18 repos) are in-sample: their labels set the floor. New Python dev repos may be added, chosen before any census of them by a rule that does not look at their code (for example, guard-heavy frameworks: FastAPI, DRF, Flask-Login), and every figure is reported with and without `py`/`py2`.
  - **Held-out threshold.** The primary Python held-out run (`py-primary-2026-11-05`), labelled under v3 as any held-out run, with D8's tier as its manifest tier:
    - **≥ 30 D8 Python default-tier cards** [STRICT]. Below 30 there is no verdict, and Python stays advise-only whatever the point estimate (at a true 90%, a 10-card tier scores 100% one time in three; at 30 cards, ≥ 95% needs 29/30, P = 0.18).
    - **The release gate: ≥ 95% default-tier accept, judged on the point estimate** per D1 (Python alone, unlabelled counted as WRONG), with the intervals published beside it. Only then may Python conventions in the D8 tier block.
    - **Operating characteristics** (binomial, both stages, n = 40 dev at ≥ 39/40 then n = 30 held-out at ≥ 29/30): a true accept rate of 90% passes both 1.5% of the time; 95%, 22%; 97%, 51%; 99%, 91%.
  - **Stopping rules.**
    1. **The definition is frozen** from this commit: kinds, guard notion, target condition, floor, the `language` rule and the thresholds. A change before the first dev label is a new recorded decision (D8b); after it, a change also needs a new dev round on repos not labelled in this one.
    2. **One dev round, no interim looks.** The pool is staged at one frozen product commit; no figure is computed from partial labels; labels are final once merged, and are never redone to change a result.
    3. **Too small a pool stops the round before labelling:** with fewer than 40 cards or fewer than 10 repos, no D8 label is made. Dev repos may be added (as above) and the pool restaged, once per added manifest; a pool still short after that leaves Python advise-only and is reported as such.
    4. **The held-out run happens at most once** for D8, on the primary Python set, and only if D8's tier is registered as a tier-only amendment of that manifest before any held-out census of it (`heldOutHistoryProblems`). If a held-out census has already run there, D8 needs a newly drawn held-out set.
    5. **A product change after the dev round** that changes any D8 Python card voids the dev evidence for those cards (rule 4: labels carry only to identical cards); the held-out run measures the product commit it builds, with D8's tier.
  - **What counts as failure.** Any of: dev n < 40 or < 10 repos after rule 3 (D8 not testable: Python stays advise-only, a finding, not a failure of the product); dev accept < 97.5%; one WRONG reason in two or more repos; the product and the study disagreeing on any card's candidate tier (the round stops, fixed by a new decision); held-out n < 30 (no verdict); held-out accept < 95% (NOT MET). Each leaves Python advise-only. A failed D8 is never re-tested on the same dev or held-out cards; a revision is a new decision with fresh repos.
  - **What does not change.** D1–D7a, the targets table and the release gate's form. TypeScript/JavaScript's tier and its held-out measurement are D7's. D8's candidate is reported by `census --json --candidate d8` only, and changes no convention's tier, `tier_reason`, `blockable`, check result, hook or Studio view. Python `LOWERING_VERSION` is unchanged: no Python lowering was touched; a future one here would take 14 (12 went to #75 and 13 to the Python continuation work).

- **D9: reserve exhaustion at runbook step 4 (lead, 2026-11-07; decided before any held-out census, blind to outcomes).**
  - **Reason.** "Reserve exhaustion at runbook step 4; decided before any held-out census, blind to outcomes." The technical check (rule 1, [`HELDOUT-RUNBOOK.md`](HELDOUT-RUNBOOK.md) step 4) ran on 2026-11-07 with the frozen binary of main `29f4cd6` (sha256 `e199f1cfd067…`), twice, with identical results. TypeScript/JavaScript: 11 of 18 slots pass, 4 of the 6 reserves pass, so 3 slots have no reserve left. Python: 6 of 10 slots pass, 3 of the 4 reserves pass, so 1 slot has no reserve left. Every failure was "fewer than 200 parseable files": no clone failed and no scan errored. No start record had been written, no census had run, and nobody had seen a proposal of either set. Rule 1 did not say what happens when the reserves run out.
  - **1. Freeze scope.** The frozen product `F` is the **product tree** at `29f4cd6`: `crates/`, `apps/`, `npm/`, `integrations/`, the plugin and Action files, and `Cargo.toml`/`Cargo.lock`. Changes under `eval/` (manifest swaps, decision docs, harness, run directories) do not move `F`.
    - **What is verified.** The tree of everything outside `eval/` at `29f4cd6` is `6c88cac98c0e971a0ad41bfc99e40ec742c0149f` (`git ls-tree 29f4cd6`, without `eval`, through `git mktree`). The run's commit must have the same tree outside `eval/`, and the run binary must have sha256 `e199f1cfd067e232273c0ac61e9784335d27e5e28b85923d843e2c1c24dc991c`, the release build of `29f4cd6`.
    - **What `prepare.mjs` records.** It still records, as `drift.commit`, the commit it builds: HEAD, less trailing commits that change only `eval/study/runs/`. That is a later commit that changes only `eval/`. The run READMEs record that commit, `29f4cd6`, the tree hash and the binary sha256.
    - **Runbook step 4.4** (`git diff --stat $F HEAD`) must list only files under `eval/`.
  - **2. Further reserves for unfilled slots.** They are drawn by `select-holdout.mjs extend`, continuing the selection's own pre-registered procedure:
    - **Same procedure.** It uses the same candidate pool (the record's `pool`), the same seed and shuffled walk order, the same classifier (dependency manifests through code search), and pins from `git ls-remote`, continuing past the walk's last step.
    - **Buckets.** Each set's `reserve_order` is continued cyclically. Added place *i* comes from bucket `reserve_order[i mod length]`: for TypeScript/JavaScript, Next.js, React SPA, Express/Fastify/Hono, NestJS, other Node, Next.js, then again from the start. For Python, Django, FastAPI, Flask, other Python.
    - **Walked candidates.** A candidate the original walk visited keeps its recorded sha and bucket. The exclusions are recomputed when the extension is drawn, exactly as `fetch` computes them. A candidate the Drift repository now mentions (a dev repo since the draw, say) is skipped [STRICT], because a held-out repo never overlaps a dev repo (rule 6).
    - **How many.** The number of added places is fixed before the draw: **8 for TypeScript/JavaScript and 4 for Python**, chosen for about the reserve pass rate seen at step 4. The draw is not looked at before this is committed.
    - **Registration.** The new reserves are appended to each manifest's `reserves` (a core change), and nothing else in the core changes. `holdout-manifests.json` registers the new core with D9 amendments (`fields: ["reserves"]`, or `["tier", "reserves"]` from the cores before D7), one from every earlier frozen core. `lib.mjs` `amendmentAllows` accepts a reserves amendment only when the earlier reserve list is a strict prefix of the new one, so nothing can be removed, reordered or re-pinned. `select-holdout.mjs verify` replays the extension offline from `selection/primary-2026-11-05-d9.json`, taking its exclusions from that record.
    - **Swaps.** Then the same rule-1 technical check runs on each slot's occupant and the reserves, in order. The i-th swap uses the i-th reserve, and a failing reserve is replaced by the next. The 200-parseable-file threshold and every other rule are unchanged.
    - **If the added places run out.** The set is extended again by the same number of places (`--add` is the total), until every slot is filled or the pool is exhausted.
    - **If the pool is exhausted.** The run goes ahead with the slots that are filled, and n per part is reported as a deviation (wider intervals), not as a protocol failure.
  - **3. Course material (D2).** The Python repo flagged under D2 is one of the failures. It is replaced like any other. The Python "Sensitivity" table then has no course-material repo to leave out.
  - **4. The agent A/B expectations** (runbook step 0) were not regenerated: the A/B is not part of this run. This is recorded as a deviation.
  - **What does not change.** Nothing else changes: D1–D8, the tier (`tier-d7.json`), rule 1's three reasons and threshold, D3, the rubric (D6), `max`, `pool`, the primaries and the first reserves.

- **D11: second held-out draw (lead, 2026-11-07): selection only; census at the round-9 freeze; used for the D1/D4 re-measure and the D10.3 verifier check.** Decided after the primary run was reported (#111) and before any data of the new sets existed.
  - **Reason.** The primary sets are reported, so they can no longer test anything decided or tuned after them. [`PLAN-PAR.md`](PLAN-PAR.md) D10.3 needs a **new** held-out draw for the verifier's held-out check, and the round-9 product is to be re-measured against D1 and D4 on repos nobody has seen.
  - **What.** `select-holdout.mjs --selection heldout2` draws `ts-heldout2-2026-11-07` (18 TypeScript/JavaScript repos, [`../holdout-2-2026-11-07.json`](../holdout-2-2026-11-07.json)) and `py-heldout2-2026-11-07` (10 Python repos, [`../holdout-2-2026-11-07-py.json`](../holdout-2-2026-11-07-py.json)), recorded in [`selection/heldout2-2026-11-07.json`](selection/heldout2-2026-11-07.json). Both are role `primary`: their runs are headline-eligible, with D1 and D4 verdicts per language.
  - **The same procedure as the primary draw** ([Primary held-out sets: selection](#primary-held-out-sets-selection)): the same search (stars 300–15,000, GitHub size 20–500 MB, pushed within 6 months of the draw date, so since 2026-05-07), the same filters (OSI licence; not archived, a fork or a template; non-application names and topics), the same framework buckets, quotas, precedence and classifier (dependency manifests through code search only), pins from `git ls-remote`, and the same walk (the pool sorted, shuffled with `lib.mjs` `shuffle` by the seed suffixed with the `set_id`). `max` 15, `pool` 200, rule 1 (200 parseable files, D3) and rubric v3 (D6) are unchanged.
  - **Exclusions.** As `fetch` computes them, at every ref of the Drift repository when the draw runs. The primary sets are now sources: their manifests (repos, every reserve including D9's, `replaced`), their selection records and run directories, like the dev sets (`eval/repos*.json`, so polar and CTFd), the secondary sets with their lists, every `github.com/<owner>/<repo>` on any branch, commit messages, PR and issue text, and the Drift owner. Only the new draw's own manifests and record are left out of the scan.
  - **Seed.** `drift-heldout2-2026-11-07:6be4e9b992729c31fbd50b70d9c55c5d72085eaa:96981b12fc4ecd258ffa1003af1a1917`: the main commit this selection branched from and 128 bits from `openssl rand -hex 16`. It is committed and pushed, with this decision, before `fetch` runs; the record's `retrieved_at` and its commit come after that push.
  - **Reserves, fixed before the draw: 18 TypeScript/JavaScript and 12 Python.** Each set's reserve order is the primary order three times (TS/JS: Next.js, React SPA, Express/Fastify/Hono, NestJS, other Node, Next.js; Python: Django/DRF, FastAPI, Flask, other Python). The primary run needed 10 and 5 swaps, every one for "fewer than 200 parseable files". There is no extension for this set [STRICT]: D9 extended the primary sets only, and `lib.mjs` `heldOutHistoryProblems` requires every amendment to precede every held-out run record; the primary run's records exist, so no reserves or tier amendment of these manifests can be registered. If the reserves run out, the run goes ahead with the slots filled, and n per part is reported as a deviation (as D9's last rule).
  - **No amendments: these sets cannot take any [STRICT].** `lib.mjs` `heldOutHistoryProblems` requires every amendment of any registered manifest to be an ancestor of every held-out run record, and the primary run's records were committed before these sets existed. So no amendment of these manifests, of the tier or of the reserves, can ever be registered: their frozen core is final. This is why the reserves were over-drawn, at 18 and 12 (the primary run needed 10 and 5) rather than the 12 and 8 first asked for, and fixed before the draw: a D9-style extension is not available to these sets.
  - **Tier.** The manifests hold `tier-d7.json`'s tier, the product's (D10 leaves the default tier unchanged) [STRICT]. It is frozen with them. For the reason above, a different tier at the round-9 freeze cannot be registered as an amendment: it would need a new decision and a harness change first.
  - **Course material (D2).** No repo of these sets is listed in `lib.mjs` `COURSE_MATERIAL`; every drawn repo stays in, as rule 1 allows only technical swaps.
  - **When.** Selection and pre-registration only, now. Nothing is cloned, scanned or labelled. The census runs at the round-9 freeze, following [`HELDOUT-RUNBOOK.md`](HELDOUT-RUNBOOK.md) with these manifests, on the frozen product `F` of that freeze. The D10.3 verifier check is pre-registered (prompt, model, rule) before that census.
  - **Isolation (rule 3).** As for the primary sets: nobody working on the product opens these manifests, their record or these repos; every message names a repo only by key (`<set_id>:repos[i]`).
  - **What does not change.** D1–D10, the primary and secondary sets and their records, rule 1, the rubric.
  - **The freeze and the run (lead, 2026-11-08; recorded before any census of these sets).**
    - **Frozen product `F`: the product tree at `de57356`** (round 9: workstreams B, C, D, E, F and G merged), as D9's freeze scope defines it. The tree of everything outside `eval/` at `de57356` is `2018b7c84ac7195e30dc90a189f54dff0487cd08` (`git ls-tree`, without `eval`, through `git mktree`). It is identical at main `011ae8c`: main has moved only in `eval/` since. The run commit (`run.json` `drift.commit`) is a later commit with the same tree outside `eval/`, and `git diff --stat de57356 <run commit> -- . ':(exclude)eval'` must be empty. Both runs use one binary, built by `prepare.mjs` from `git archive` of the run commit. Its sha256 is recorded in the run READMEs, and a `build-verified.sh` build (codegen-units 66) is the behaviour probe, as in the primary run.
    - **No verifier check on these sets (D10.3 dev gate not met).** relabel5 (#122) scored the frozen verifier prompt v3 at 84.3% (43/51) passed-card precision on untuned dev cards, below D10.3's 90%. Under D10.3 the verifier stays off, and the held-out check does not run. These sets measure D1 (default-tier accept), D4 (not-wrong over all shown) and per-card accept per language and tier, under the D7 tier and rubric v3, with the primary run's protocol (`HELDOUT-RUNBOOK.md`, as D9 adapted it, and its section on these sets).
    - **Recall is not measured** (lead's choice, operator's call: extraction and matching need about 30 more agent sessions per run). Recall was measured on the primary draw. `metrics.md` reports precision and yield only, and the run READMEs record this as a deviation.
    - **Swaps:** rule 1 (D3's 200 parseable files), using reserves only, in order. No amendment is possible (above). If the reserves run out, the run goes ahead with the slots filled, and n is reported as a deviation.
  - **The draw (2026-11-07).** The seed commit `339f4f9` was pushed at 22:31:55Z; `fetch` retrieved at 22:32:04Z, from 120 refs (119 commits; 37 not reachable from `main` at the draw, one of them the seed commit). 481 GitHub API calls, 338 of them code search. No bucket ran short.

    | | TypeScript/JavaScript | Python |
    | --- | --- | --- |
    | Search results (unique) | 5,651 | 5,176 |
    | Excluded: no OSI licence | 1,169 | 1,236 |
    | Excluded: template repository | 59 | 16 |
    | Excluded: non-application by name / by topic | 82 / 60 | 83 / 39 |
    | Excluded: in the Drift repository, by owner/repo / by name | 36 / 9 | 33 / 2 |
    | Eligible pool | 4,236 | 3,767 |
    | Walked until every bucket was full | 264 (9 had no `package.json` found) | 134 (13 had no Python manifest found) |
    | **Primaries per bucket** | NestJS 3, Next.js 4, Express/Fastify/Hono 4, React SPA 4, other Node 3 (18) | Django/DRF 3, FastAPI 3, Flask 2, other Python 2 (10) |
    | **Reserves per bucket** | Next.js 6, React SPA 3, Express/Fastify/Hono 3, NestJS 3, other Node 3 (18) | 3 per bucket (12) |

    The exclusion list has 152 owner/repo and 119 name entries (the primary draw's: 57 and 56); every repo of the dev sets and of the four earlier held-out manifests (repos, reserves, `replaced`) is among them. `verify` replays the draw and finds no overlap with any dev manifest or earlier held-out set.

- **WS-F: measurement fixes (lead, 2026-11-09; [PLAN-R14](PLAN-R14.md) WS-F, with decisions D-3 and D-4 at their defaults).** Recorded before any run under them. **Past sets are not re-read under the new rules:** every run prepared before them keeps the rules it was reported under (`metrics.mjs` applies F3 only to runs whose `run.json` `params.decisions` names it, which `prepare.mjs` records from now on).
  - **F1: cards without Drift's confidence.**
    - Rubric v4 ([`RUBRIC-v4.md`](RUBRIC-v4.md)) is v3, with cards rendered without the `evidence:` line (counts, Wilson lower bound, lift), without the `split:` counts and without "N members" / "N of M" (lib.mjs `labellerCard(block, { rubric: "v4" })`).
    - The repository is masked in the prompt: an opaque key for its name (in the header and the uids), no URL or commit, and the checkout behind an opaquely named link. `collect.mjs` maps the uids back.
    - lib.mjs `promptLeaks` also refuses an `evidence:` line, "lower bound", "lift N" and the repo's name outside the cards.
    - R3 reads auth cards strictly: an outlier that is public by design is `legit` (finding h).
    - v4 is the default for new dev runs. A held-out run keeps the text approved with D6 until a recorded decision approves another.
    - v4 labels are never pooled with earlier ones in one rate: `metrics.mjs` refuses.
  - **F2: agreement.** `agree.mjs` prints raw agreement only below n = 30. At n ≥ 30 it prints Cohen's κ and Gwet's AC1, each with a repo-cluster bootstrap interval. No adjective.
  - **F3: intervals and verdicts.**
    - Every pooled rate quotes the widest of Wilson, the repo-cluster bootstrap and cluster-t (`quoted`).
    - D1 and D4, for a run prepared under F3, need n ≥ 30, and are judged on the quoted lower bound ≥ 95% (lib.mjs `d1Met`).
    - A check's condition (c) is one-sided: the blind result is not more than 10 points **below** in-sample (lib.mjs `conditionC`). A blind result above in-sample passes.
  - **F4: three models.**
    - Labellers A and B and adjudicator C run on three different models. `prompt.mjs --model ID` is required under v4 and for practice runs, and it refuses a model already used by another of A, B and C in the run.
    - Model ids are committed with each run's data, and only there: `prompts/index.json`, each collected record (`model`), and `final.jsonl` (`models`).
    - `metrics.mjs` also reports every rate with adjudicated items counted as WRONG.
  - **F5: the human anchor.** `human-anchor.mjs` writes the JSONL form (v4 cards, or practice describe cards) and the model-vs-human report. Nothing is labelled (D-4's default). Until a person has labelled at least 100 items, no accuracy figure is quoted outside the repository without "labelled by models, not maintainers".
  - **F6: the practice map.** See [`PREREG-R13-practices.md`](PREREG-R13-practices.md): a description blind to the assignment, then a match; stratum weights; at most 5 units per repo per concern; recall on at least 2 packages per repo; the cluster lower bound as the pass rule.

### The dev3 blind dev pool (PLAN-R10 section 3.1)

`select-holdout.mjs --selection dev3` draws a **blind dev pool**, role `dev`: 12 TypeScript/JavaScript repos (`ts-dev3-2026-11-08`) and 8 Python repos (`py-dev3-2026-11-08`). It is not a held-out set and carries no D1/D4 verdict: its job is to predict the next held-out draw (D12, PLAN-R10 section 3.4).

- **The held-out procedure.** The heldout2 draw's search, filters, buckets, precedence, classifier, pins and walk; pushed since 2026-05-08 (6 months before the draw date). Only the primary quotas are smaller: the held-out quotas scaled to 12/18 and 8/10 by largest remainder, ties in bucket order (NestJS 2, Next.js 3, Express/Fastify/Hono 3, React SPA 2, other Node 2; Django/DRF 2, FastAPI 2, Flask 2, other Python 2).
- **The held-out exclusions.** As `fetch` computes them at every ref when the draw runs: the dev manifests (so polar and CTFd), every held-out manifest (primary, secondary and heldout2: repos, reserves, `replaced`, `burned`, `exposed`), every selection record, any `github.com/<owner>/<repo>` on any branch, commit messages, PR and issue text, and the Drift owner. Only dev3's own outputs are left out of the scan. `verify --selection dev3` also checks that no dev3 repo overlaps a dev manifest or any held-out manifest, by owner/repo, pin or name.
- **Seed.** `drift-dev3-2026-11-08:459e52857b0d6de8fb7a414e5841d3ad6a66a74d:1ec283eb0ee09446d7ea887006f5cebd`: the main commit this selection branched from and 128 bits from `openssl rand -hex 16`, committed and pushed before `fetch` runs.
- **Reserves, fixed before the draw: 18 TypeScript/JavaScript and 12 Python** (the held-out reserve order three times; heldout2 needed 12 of 18 and 5 of 12 for 18 and 10 slots). Used in order by rule 1's technical check, at the current main binary; there is no extension.
- **Isolation.** Every output is named `eval/dev3*`: the manifests `../dev3-2026-11-08.json` and `../dev3-2026-11-08-py.json`, the record `../dev3-2026-11-08-selection.json`, and the pool's own core registry `../dev3-2026-11-08-registry.json` (it is not in `holdout-manifests.json`; `fetch` and `write` refuse any output path outside `eval/dev3*` or `eval/study/runs/dev3*`). Nobody building product opens them, or the pool's repos, cards or labels, before the round-10 freeze; only the dev3 operator does. Every `verify` message names a dev3 repo only by slot (`<set_id>:repos[i]`), as for held-out repos.
- **The draw (2026-11-08T13:35:15Z, after the seed commit `2d83e59` was pushed).** Exclusions at 127 refs: 211 owner/repo and 177 name entries. TS/JS: 5,661 results, 4,201 eligible, 296 walked; Python: 5,178 results, 3,744 eligible, 184 walked. All primaries and reserves were filled.
- **Technical check (rule 1), 2026-11-08.** `techcheck.mjs`'s check with a `build-verified.sh` build of main `459e528` (codegen-units 67, binary sha256 `b12623052ea7…`). 6 TS/JS primaries and 3 Python primaries (and one Python reserve) had fewer than 200 parseable files; 6 and 4 reserves were swapped in, in order; the failures reproduced on a second run. Every slot is filled: 12 TS/JS and 8 Python, with 12 and 8 reserves left.
- **When.** Selection and the technical check now. Census and blind labelling (rubric v3) once, at the round-10 freeze, on the frozen binary. After its report it joins the build set, and round 11 draws dev4.

### The dev4 blind dev pool (PLAN-R11 section 4.1)

`select-holdout.mjs --selection dev4` draws the round-11 **blind dev pool**, role `dev`: 36 TypeScript/JavaScript repos (`ts-dev4-2026-11-08`) and 24 Python repos (`py-dev4-2026-11-08`). Like dev3, it is not a held-out set and carries no D1/D4 verdict. Its dev4-check, pre-registered in [`PREREG-F11-dev4-check.md`](PREREG-F11-dev4-check.md) before the seed, gates the next held-out draw (PLAN-R11 §4.2).

- **The held-out procedure.** dev3's: the held-out draws' search, filters, buckets, precedence, classifier, pins and walk, pushed since 2026-05-08. The primary quotas are **twice the held-out quotas**: NestJS 6, Next.js 8, Express/Fastify/Hono 8, React SPA 8, other Node 6; Django/DRF 7, FastAPI 7, Flask 5, other Python 5 (24/10 of the held-out quotas by largest remainder). The cap up to which a short bucket's open places are handed to other buckets is doubled with them, from 5 to 10 (`max_per_bucket` in the spec).
- **The exclusions.** dev3's, plus **every earlier blind dev pool**: dev3's manifests are a manifest source like a held-out manifest (repos, reserves and the names in `replaced`, `burned` and `exposed`), not only a source of `github.com` URLs. `verify` also checks that no repo of one pool overlaps another pool, by owner/repo, pin or name. Only dev4's own outputs are left out of the scan.
- **Seed.** `drift-dev4-2026-11-08:bb1d45ed129027d3c65349dc0ca653e68b13d125:abedc84078600f8fdfce1b9318162139`: the main commit this selection branched from and 128 bits from `openssl rand -hex 16`, committed and pushed after the pre-registration (`48b85cf`) and before `fetch` runs.
- **Reserves, fixed before the draw: 54 TypeScript/JavaScript and 36 Python** (the held-out reserve order nine times, 1.5 times the slots; dev3's technical check swapped 6 of 12 and 4 of 8). Used in order by rule 1's technical check, at the current main binary; there is no extension.
- **Isolation.** Every output is named `eval/dev4*`: the manifests `../dev4-2026-11-08.json` and `../dev4-2026-11-08-py.json`, the record `../dev4-2026-11-08-selection.json` and the pool's own registry `../dev4-2026-11-08-registry.json`. Nobody building product opens them, or the pool's repos, cards or labels, before its report; only the dev4 operator does. Every `verify` message names a dev4 repo only by slot.
- **The draw (2026-11-08T20:34:29Z, after the seed commit `9dd8622` was pushed).** Exclusions at 137 refs: 262 owner/repo and 227 name entries (dev3's manifests among the sources by name: 50 entries). TS/JS: 5,663 results, 4,163 eligible, 867 walked; Python: 5,175 results, 3,721 eligible, 461 walked. All primaries and reserves were filled. A first `fetch` was stopped during its TS/JS walk, before anything was written, and rerun from scratch; it had printed bucket counts only.
- **Technical check (rule 1), 2026-11-08.** `techcheck.mjs --prune --min-free-gb 3.6` with a `build-verified.sh` build of main `bb1d45e` (codegen-units 75, binary sha256 `a50cfb66bf40…`). Every failure was fewer than 200 parseable files, and each reproduced on a second run: 9 TS/JS primaries and 4 TS/JS reserves, 7 Python primaries and 6 Python reserves. 13 and 13 reserves were swapped in, in order. Every slot is filled: 36 TS/JS (NestJS 6, Next.js 11, Express/Fastify/Hono 7, React SPA 9, other Node 3) and 24 Python (Django/DRF 10, FastAPI 9, Flask 3, other Python 2), with 41 and 23 reserves left. Rule 1 swaps in reserve order, not by bucket, so the buckets moved from the quotas.
- **When.** Selection and the technical check now. Census (TS/JS shown cards; the Python opt-in view) and blind labelling once, at the round-11 freeze `F11`, on the frozen binary. After its report it joins the build set.

### Isolation note: repos whose conventions were exposed

While this harness was built (PR #2), the selection notes described the code of every original primary. They were written where product engineers can read:

- the manifests' former `why` fields (commit `bddf1d6` on the PR branch; the squash merge keeps them off main);
- review comments that quoted them;
- an author reply listing them;
- the study-v2 agent's first report to the coordinator.

**Criterion (strict).** A repo is exposed if any text product engineers can read named one of these:

- a convention of it;
- a convention category: wrappers, guards, decorators, base classes, procedures, layering, and so on;
- where one lives.

By that criterion, every original primary is exposed: **all 18 TypeScript/JavaScript repos** and **all 8 original Python repos**. The swapped-in pretalx and lnbits, and all other reserves, were never described. Each manifest lists its exposed repos, with where, in `exposed`.

**Consequence: decision 0.** These sets are secondary. When one is reported as the exploratory check, `metrics.mjs` prints every headline rate twice, over all repos and excluding the exposed ones, from `exposed` (`--exclude-repos a,b` adds names; it also works on dev runs). With every primary exposed, the excluded-exposed row has no TypeScript repos and two Python repos. That is the point of the decision: the comparison cannot rescue these sets.

**A secondary-set repo, cloned and scanned on 2026-11-06.** While `../repos-py-2.json` was built, one candidate passed `select-holdout.mjs verify --dev` and was cloned shallow, scanned and censused (`--max 15`: two proposals, read by the agent building the manifest) before `prepare.mjs` refused the manifest as held-out: a **secondary** held-out set lists the repo. `verify` then checked dev manifests only against the primary sets. The candidate was dropped, and its clone and census output deleted. No primary held-out repo was cloned, scanned or opened. By lead decision it is recorded as **exposed**, not burned (no finding drove product work): an entry in that manifest's `exposed` list, outside the frozen core, so the registered core hash is unchanged. Since then `verify` checks dev manifests against the secondary sets too (see [Reproducing and checking](#reproducing-and-checking)).

**Two secondary-set names printed in a review harness, 2026-11-06.** A review agent's local harness output printed the names of `ts-2026-11-05:repos[0]` and `py-2026-11-05:repos[0]`. Both were already exposed (each is its set's `exposed[0]`, and the second is also `replaced[0].repo`), so their status is unchanged.

## Primary held-out sets: selection

[`holdout-primary.json`](../holdout-primary.json) (`ts-primary-2026-11-05`) and [`holdout-primary-py.json`](../holdout-primary-py.json) (`py-primary-2026-11-05`) are the primary sets of decision 0. Headline results come only from them.

**Nobody working on the product has read these repos.** They were selected by `select-holdout.mjs` from metadata and dependency manifests only. Nobody opened, cloned, grepped or summarised their source, docs, README, AGENTS.md or CONTRIBUTING, and nobody ran Drift on them. No selection notes about their code exist, so the manifests have no `notes_sha256`. Keep it that way (rule 3): do not open them until a primary run is final and reported. The study's labellers, extractors and matchers open them only under the blinding rules below.

### Method

1. **Search.** The script ran GitHub repository search (`gh api -X GET search/repositories`) with one fixed query per language. It split the star range until every slice had ≤ 1,000 results, so the pool is complete, not a top-1,000. Retrieved 2026-11-05T18:27:26Z.

   ```
   language:TypeScript  size:20000..500000 pushed:>=2026-05-05 archived:false fork:false is:public stars:<slice of 300..15000>
   language:JavaScript  size:20000..500000 pushed:>=2026-05-05 archived:false fork:false is:public stars:<slice of 300..15000>
   language:Python      size:20000..500000 pushed:>=2026-05-05 archived:false fork:false is:public stars:<slice of 300..15000>
   ```

   - **The fields:** stars 300–15,000; pushed within 6 months; GitHub size 20–500 MB.
   - **The size floor** is the metadata-only proxy for at least ~300 source files, so that 15-member roles can exist. A repo that still turns out too small fails the rule 1 technical check and gives way to the next reserve.
   - **The slices:** 8 TypeScript, 6 JavaScript and 9 Python. The exact query strings, with their counts, are in the record.
2. **Filter.** The script applied these filters to the result metadata:
   - not archived, not a fork, not a template;
   - an OSI-approved licence (SPDX id in the record). Repository search takes one `license:` per query, so this filter is applied to the results instead of fanned out into queries.
3. **Exclude.** Every repo that the Drift repository mentions is excluded, on any branch, by `owner/repo` and by repo name (which also covers forks and mirrors):
   - the dev sets (`eval/repos.json`, `eval/repos-py.json`);
   - the secondary sets, with their reserves and their `replaced` and `exposed` entries;
   - every `github.com/<owner>/<repo>` in a tracked file, commit message, PR or issue body, or comment;
   - the Drift owner's own repos.

   Obvious non-applications are also dropped, by **name or topic only**: awesome lists, tutorials, courses, examples, demos, boilerplates, starters, templates, and similar. The patterns are in the record.
4. **Draw.**
   - The eligible pool is sorted by `owner/repo` and shuffled with `lib.mjs` `shuffle`. The seed is `drift-heldout-primary-2026-11-05:859542f401a358c1bf32e43fefd9e048fd88be92`, the main commit this selection branched from, suffixed with the `set_id`.
   - The script then walks the pool in that order. Each walked candidate is classified into a framework bucket and fills the next open place of its bucket: primaries first, then that bucket's reserves. A candidate whose bucket is full is passed over.
   - The first k of a uniform random permutation within each bucket is a uniform random sample per bucket. The quotas were fixed before the draw: at most 5 per bucket, and the order of reserves by bucket is fixed.
5. **Classify, from dependency manifests only.** This session's GitHub gateway serves search but not the contents API of unattached repos, so manifests were not downloaded. Instead, GitHub **code search, restricted to manifest file names**, answered which manifests of a batch of candidates contain a framework's package name:
   - TypeScript/JavaScript searches `package.json`, for `@nestjs/core`, `next`, `express`, `fastify`, `hono` and `react-dom`.
   - Python searches `pyproject.toml`, `requirements*`, `setup.cfg` and `Pipfile`, for `django`, `djangorestframework`, `fastapi` and `flask`.

   Only the repo, the manifest's path and, for `next`, the matched manifest fragment were used. The path is used to skip docs, example and test members, and the fragment because the tokenizer also matches `next-auth`. The first bucket in precedence order wins:
   - TS: NestJS, then Next.js, then Express/Fastify/Hono, then React SPA, then other Node.
   - Python: Django/DRF, then FastAPI, then Flask, then other.

   A candidate with no manifest found is skipped. Code search covers the default branch.

   **Deviation from the planned method.** The plan was to download the dependency manifests through the contents API. The product lead accepted this deviation on 2026-11-05. The selection is still code-blind, for three reasons:

   - **Only manifest files are searched.** Every code-search query carries `filename:` qualifiers for the dependency manifests listed above, so no source, docs, README, AGENTS.md or CONTRIBUTING file can match.
   - **The script uses less than a download would show.** It reads only whether a repo has a matching manifest, that manifest's path, and, for `next`, the fragment of that manifest that matched. Paths of non-manifest files are dropped unused.
   - **Only the bucket is recorded.** Nothing else from the search answers is kept.

   The known differences from the planned method:

   - The framework is detected at the default branch as indexed by code search, not at the pinned sha.
   - Detection is token-based: `express`, for example, also matches `@types/express`.
   - A repo that code search has not indexed reads as having no manifest, and is skipped.
6. **Pin.** Each selected repo's default-branch HEAD comes from `git ls-remote`.
7. **Record.** Each repo is recorded as `{name, url, sha, language, framework_bucket, size_kb, stars, pushed_at}` only.

`max` 15 and `pool` 200 are the secondary sets' values. The tier at the draw was the rule-kind tier of rule 5; since decision D5 every held-out manifest held `tier-d5.json`'s, and since decisions D7 and D7a every held-out manifest holds `tier-d7.json`'s.

### Counts

| | TypeScript/JavaScript | Python |
| --- | --- | --- |
| Search results (unique) | 5,628 | 5,162 |
| Excluded: no OSI licence | 1,165 | 1,228 |
| Excluded: template repository | 58 | 17 |
| Excluded: non-application by name / by topic | 83 / 59 | 81 / 39 |
| Excluded: in the Drift repository, by owner/repo / by name | 4 / 4 | 5 / 1 |
| Eligible pool | 4,255 | 3,791 |
| Walked until every bucket was full | 116 (5 had no `package.json` found) | 55 (7 had no Python manifest found) |
| **Primaries per bucket** | NestJS 3, Next.js 4, Express/Fastify/Hono 4, React SPA 4, other Node 3 (18) | Django/DRF 3, FastAPI 3, Flask 2, other Python 2 (10) |
| **Reserves, in order** | Next.js, React SPA, Express/Fastify/Hono, NestJS, other Node, Next.js (6) | Django/DRF, FastAPI, Flask, other Python (4) |

No bucket ran short. The whole pipeline used 293 GitHub API calls, 150 of them code search.

### Reproducing and checking

```sh
node eval/study/select-holdout.mjs verify [--dev more-dev-manifests.json,...]   # offline, deterministic
```

`verify` never contacts GitHub or a held-out repo. It needs a full clone of the Drift repository with the commits the record names; the tags `heldout-exclusion-ref-1` … `-7` keep them fetchable after their branches are deleted. It checks:

- **the frozen inputs:** the record's seed and spec (queries, filters, buckets, quotas) are the script's pre-registered ones;
- **the exclusion lists:** the git-derived part (manifests, tracked files and commit messages at the recorded refs) is replayed and must equal the record; the PR and issue text part needs the API and is taken from the record;
- **the pool:** sorted, unique, the recorded size, and free of every excluded owner/repo, owner and name and of non-application names;
- **the draw:** replayed twice from the pool, the seed and the walked shas and buckets, it gives the recorded walk, primaries and reserves, with every pin a 40-hex sha from the walk;
- **the manifests:** each is exactly what `write` produces from the record (`frozen_at` and the append-only lists aside), its lists are consistent, and the registry holds its core hash;
- **no overlap (rule 6):** no held-out repo (a slot's current occupant or an unused reserve) shares an owner/repo, a pinned sha or a repo name with a dev manifest (`eval/repos*.json` in the working tree and on every local branch, plus `--dev` files), a secondary set, or the other primary set. Run it with `--dev` on a proposed dev manifest before adding it.
- **the secondary sets' lists:** `checkManifestLists` on each, so an `exposed` (or `burned`) entry that names no occupant, reserve or replaced repo of that set fails;
- **no held-out name in any message:** verify, probe and every `gh` failure print a held-out repo only as `<set_id>:repos[i]`, `<set_id>:reserves[i]`, `<set_id>:record.primaries[i]` or `<set_id>:name#<hash>` (its name, owner/repo, URL and pin, and any 7–40-character prefix of a pin, are replaced), because product engineers can read CI logs. JSON and YAML parse errors anywhere in `eval/study/` name only the file (and line and column when known), never the text. `probe` refuses any repo of any held-out manifest before contacting anything. `select-holdout.test.mjs` checks this on tampered and malformed fixtures. `--manifest-root DIR` reads fixture manifests, says so, and never exits 0 (4 when clean): it is never a verification of this repository;
- **the secondary sets' core hashes:** each must match the registry, like the primary sets';
- **no dev manifest takes a secondary-set repo:** every secondary set's current occupants and unused reserves (by owner/repo, sha and name), and the names in its `replaced` (swapped-in reserves) and `exposed` lists, against the same dev manifests. Repos a secondary set replaced or burned are released (rules 1 and 3) and may be dev repos. Added 2026-11-06, after a secondary-set repo passed `--dev` (see the isolation note); `prepare.mjs` refuses such a manifest too, but verify now catches it first.

**The record** is [`selection/primary-2026-11-05.json`](selection/primary-2026-11-05.json). Its sha256 is in each manifest's `selection`. It holds:

- the spec: queries, filters, buckets, quotas and the tier;
- the exclusion list and the refs it was taken from;
- the eligible pool (owner/repo only);
- every walked candidate's sha and bucket.

**`fetch` ran once.** Search results change over time, so re-running `fetch` is a new selection, not a check, and the script refuses to overwrite the record. `write` refuses to overwrite a manifest. `probe` tests the classifier, and refuses any repo that is not already a dev or secondary repo.

## Protocol, in order

Throughout, `RUN=eval/study/runs/<name>` (for example `holdout-2026-11-20`) and `CACHE=~/.cache/drift-eval`.

**Checkouts.**

- **Held-out runs get their own checkouts**, `<cache>/runs/<run>-<hash>/repos/<name>`, which nothing else writes to. The commit is copied from the shared clone when that clone has it.
- **Dev runs use the shared `<cache>/repos/<name>` clones of `eval/run.mjs`.** These must be clean, ignored files included: `eval/run.mjs` leaves `.drift/cache` there. `--reset-clones` cleans them (`git clean -ffdx`, `checkout -f`).
- **Every checkout is verified clean** after census and init.

### 1. Freeze and prepare

```sh
git status                              # everything committed (rule 2)
node eval/study/prepare.mjs --manifest eval/holdout-primary.json --run $RUN --drift-src . \
  [--cache $CACHE] [--only a,b]          # builds drift itself; max, pool, tier from the manifest
# dev: node eval/study/prepare.mjs --drift BIN --manifest eval/repos.json --run DIR [--reset-clones]
```

For each repo, `prepare.mjs`:

1. **Checks it out** shallowly at its pinned sha (see above), clean.
2. **Runs `drift census --all-outliers --max 15`:** the proposals a user is shown, written to `proposals/<repo>.txt`. A binary with `census --all` (round 8, W4: by default census lists the default tier and only the 5 best suggestions) gets `--all`, so every proposal is labelled as before (`lib.mjs` `censusListAll`).
3. **Runs `drift census --max 200`:** the deeper pool used for recall, written to `pool/<repo>.txt`.
4. **Runs `drift init`:** this gives the structured role and rule (`proposals/<repo>.yaml`). Everything `init` adds is removed again, so the checkout that reviewers open is exactly the repo at its sha.
5. **Writes `queue.json`:** every shown proposal, with:
   - a stable `uid` of `<repo>/<D-id>`;
   - its census text block;
   - its role, rule, evidence and member count;
   - a rule family;
   - its outlier files.

Each `run.json` row records the binary that produced it. `--force` (dev only) starts the run over: rows from another build are dropped, never mixed in.

Drift IDs are only unique within a repo: midday and novu share one. Always join on `uid`.

A held-out run downloads several GB: n8n and activepieces are the largest. For a first look, use `--only` with a few repos.

### 2. Label: A and B, independently

```sh
node eval/study/prompt.mjs label --run $RUN --labeller A   # prompts/label/A/<repo>.md, one per repo; rubric v3 (D6)
# launch the A agents; when they finish:
node eval/study/collect.mjs --run $RUN --stage label
node eval/study/prompt.mjs label --run $RUN --labeller B   # renders B only for repos whose A output is collected
# launch the B agents; when they finish:
node eval/study/collect.mjs --run $RUN --stage label
```

**Launching.** Launch one fresh agent per (labeller, repo) prompt. A and B of one repo never run at the same time. Different repos can.

**Working directory (since 2026-11-07).** Start every agent (A, B, C, extractor, matcher) in the fresh, empty directory `prompt.mjs` made for its prompt: `<cache>/workdirs/<random uuid>/`, recorded as `cwd` in `prompts/index.json` and printed as `launch in (cwd) ...`. Never start one in a Drift checkout or worktree (the orchestrator's included), the run directory, a repo checkout or the outbox. `prompt.mjs` refuses a root (`--workdir-root`) that is inside any git work tree, the Drift repository, the run directory, a checkout or the outbox root. In `dev-v3-relabel3-2026-11-07` a labeller started in the orchestrator's worktree wrote a copy of its output there.

**What a labeller sees.** Each prompt contains:

- the rubric: `RUBRIC-v3.md` for a run started after decision D6, otherwise the rubric the run already uses (`--rubric v2|v3` names it; one run never mixes them);
- that repo's proposals, in a per-labeller shuffled order, without Drift's rank;
- the path of the checkout;
- a fresh outbox, `<cache>/outbox/<random uuid>/out.jsonl`.

It starts in its own empty working directory, which the prompt does not name. The outbox is outside the Drift repository. Its path says nothing about the stage, labeller or repo, and it is recorded only in `prompts/index.json`. The prompt does not say which labeller it is for: `collect.mjs` fills in `labeller`.

Never give a labeller anything else; see the blinding notes in `REVIEWER-PROMPT.md`. Where possible, use different models for A and B, and record which in `$RUN/README.md`.

Any agent running as the orchestrator's user can still list `<cache>/outbox` and read the outboxes in it: the 0700/0711 modes only stop other users. The remaining controls are:

- the sequencing above;
- collection, which moves files out;
- the instructions.

Prefer a sandbox that mounts only the checkout and the one outbox.

**Collecting.**

```sh
node eval/study/collect.mjs --run $RUN --stage label        # validates, moves to labels/<A|B>/<repo>.jsonl
```

`collect.mjs` rejects an output file (INVALID; the other files are still collected) when:

- a line is not JSON;
- a record breaks the schema in `RUBRIC-v3.md` (the same fields as v2), or names another `rubric` than its prompt was rendered with, for example:
  - a missing `checked`, `trivial_by`, `lint_severity` or `wrong_because`;
  - a `checked` list that misses the example file, min(3, outlier files) outlier files, or two further files (other members). Since 2026-11-06 (`runs/dev-v3-2026-11-06`, protocol amendment) the further files required are min(2, the files the role can have members in besides the example's and outliers'), bounded from the role's selector over the checkout, and for Django and Prisma model roles from the files that may declare a model (`lib.mjs` `memberFileBound`, an over-approximation); roles it cannot bound still need two;
- the file does not cover exactly the repo's proposals (relaunch the agent, or pass `--allow-partial` and report the gap).

Since 2026-11-07 the further files of the "other members" rule count only when they can hold a member: a file in `checked` besides the example's and the outliers' counts when it is a tracked file of the checkout, is not a lint, compiler, package or framework config (`lib.mjs` `CONFIG_FILE`), and, when the role's files can be bounded, is one of them (`roleFileCandidates`). The message names each file not counted and why. Two B outputs of `dev-v3-relabel3-2026-11-07` failed the count; rechecked under the new rule, 4 of the 106 A and B records of `dev-v3-relabel2-2026-11-07/ts` would also have been rejected (three counted a config, one a decorator file outside the role), and none of relabel 3's 58 ts and py records (its py2 checkouts no longer exist, so those 24 were not rechecked). **Not detectable from a record:** that a counted file really holds a member that follows the rule (the census names only the example and the outliers), and that the agent opened every file it lists. Check those by audit: for a sample of records, open each counted file at the run's pin and find a member of the role (the card's selector) that follows the rule; and read the agent's transcript for a read of each listed file. On a held-out run the audit is done by someone who does not work on the product, after the run is reported (rule 3), and its result is reported with the agreement.

**Outputs that are missing, duplicated or outside their outbox (since 2026-11-07).** An output is also INVALID, and stays where it is, when:

- its outbox holds any file besides `out.jsonl`;
- the agent's working directory is not empty, or is gone (on a held-out run, also when the prompt was rendered without one);
- the repo checkout gained or changed a file since the prompt was rendered (`checkout_status` in the index);
- a copy of its records (a record's reason text) is in an untracked file of the Drift repository outside the run directory, elsewhere under an outbox root, or in another agent's working directory;
- it is byte-identical to another prompt's output, a label record repeats the reason of the other labeller's collected label of the same uid, or its records carry `labeller` or `rubric_sha256` (only `collect.mjs` writes them).

A prompt with no output is `waiting`; it is `MISSING`, and fails, when its working directory holds files, or with `--complete`, which also fails while any repo lacks a complete A or B label set (labellers in scope). A loose file directly in an outbox root fails too. Move stray files aside unread, record the deviation in the run README, and relaunch the agent; never edit an output. Each rejection is appended to the entry's `rejected` list in `prompts/index.json`.

A collected file is final. It is not replaced without `--force`.

### 3. Agreement

```sh
node eval/study/agree.mjs --run $RUN [--json $RUN/agreement.json] > $RUN/agreement.md
```

The report contains:

- coverage;
- exact agreement;
- Cohen's κ on the three labels, with a repo-cluster bootstrap interval;
- κ for ACCEPT-vs-not and WRONG-vs-not;
- the 3×3 confusion matrix;
- each labeller's label mix;
- per-repo disagreements.

Report it unchanged. **Agreement is computed before adjudication,** and is never recomputed after it. The scripts enforce the order:

- `agree.mjs --run` writes `<run>/agreement.json` (or `--json FILE`) with `labels_sha256`, the sha256 of every field of every A and B record (`lib.mjs` `labelSetSha256`);
- `adjudicate.mjs` writes its queue only when that file (or `--agreement FILE`) holds the sha256 of exactly the labels it queues, and `--merge` checks the queue's against the labels it merges;
- `agree.mjs --run` refuses while any repo of the queue lacks an A or B label, or has a label prompt rendered but not collected (`lib.mjs` `labelSetGaps`). In `dev-v3-relabel3-2026-11-07` one part's agreement was first computed before a repo's B labels were collected. `--allow-incomplete TEXT` computes it anyway and records TEXT and the gaps in `agreement.json` and `agreement.md` (`incomplete`); report it as a deviation. With `--run` and `--a`/`--b`, the two sets must cover the queue;
- once `adjudication/queue.json` exists, `agree.mjs --run` refuses. If agreement was not computed in time, `--after-adjudication` recomputes it from A and B labels unchanged since the queue was written (sha256 checked), and both outputs say "recomputed after adjudication". Comparisons of any two label sets (`--a`, `--b`) are not ordered.

### 4. Adjudicate: C, on disagreements only

```sh
node eval/study/adjudicate.mjs --run $RUN                  # validates A and B, writes adjudication/queue.json
node eval/study/prompt.mjs adjudicate --run $RUN           # prompts/adjudicate/C/<repo>.md
# launch one agent per prompt (not the A or B sessions)
node eval/study/collect.mjs --run $RUN --stage adjudicate  # -> labels/C/<repo>.jsonl
node eval/study/adjudicate.mjs --run $RUN --merge          # -> final.jsonl
```

**Excluding a repo.** When a repo's labellers could not run (a dev run only in practice; on a held-out run it stays a failure reported as such), `adjudicate.mjs --exclude-repos a,b --exclude-reason TEXT` leaves those repos out of the missing-label check, the disagreements and `final.jsonl`. The reason is required, and the exclusion (repos, uids, reason, date) is recorded in `adjudication/queue.json` `excluded`; `--merge` uses the recorded exclusion and refuses a different `--exclude-repos`. The excluded proposals stay unlabelled, so `metrics.mjs` counts them as WRONG; report the rates with and without them (`metrics.mjs --exclude-repos`, the same names). Added 2026-11-06 in `runs/dev-v3-2026-11-06`; test `adjudicate.test.mjs`.

**What C sees.** C sees both reviews as "Reviewer 1" and "Reviewer 2". The order is shuffled per proposal, and the mapping to A and B is stored in `adjudication/queue.json`. C must re-check the files, and may choose any label.

**The merge.** `--merge` writes:

- A's label where A and B agree, otherwise C's;
- for each proposal, both original labels, and whom C sided with.

It refuses if:

- any field of any A or B record changed after the queue was written (the queue stores a sha256 of each label set);
- a C record's `sided_with` does not match its label: `"1"`/`"2"` means C chose that reviewer's label, `"neither"` a third label;
- any disagreement is unadjudicated.

### Dev rounds: carried labels, relabel sub-runs and derived views (`stage.mjs`)

A dev round that relabels only what changed since an earlier labelled run (or applies a tier the manifest did not pre-register) is staged with `stage.mjs`, for any run or part, never a held-out one:

```sh
node eval/study/stage.mjs stage --run $RUN --checkouts <read-only clones> --cache <neutral dir> \
  [--carry-from <earlier run or part>] [--tier eval/study/tier-d7.json] [--relabel all|default|suggestion] \
  [--carry-summary-only default] [--expect-relabel uid,...] [--round TEXT] [--allow-tier-mismatch TEXT]
node eval/study/stage.mjs batches --run $RUN                 # batches.json: one (labeller, repo) prompt each
# steps 2-4 on $RUN/relabel (prompt.mjs label --rubric v3, collect, agree, adjudicate, --merge), then:
node eval/study/stage.mjs final --run $RUN                   # final.jsonl = relabel/final.jsonl + carried.jsonl
node eval/study/metrics.mjs --run $RUN/views/d7 --labels $RUN/final.jsonl --json $RUN/views/d7/metrics.json > $RUN/views/d7/metrics.md
```

- **Carry (rule 4).** A final label is carried only when the uid is shown now, its repo is pinned at the same commit, its card (the census block without rank and tier line) is byte-identical, and it was labelled under the approved rubric text. `--carry-summary-only TIER` also carries, in that tier only, a card whose first (summary) line alone changed: a lead's decision, recorded in `stage.json` and on each row (`carried_card`).
- **Relabel.** Everything not carried, or only its `--relabel` tier, goes to `relabel/`, a harness run whose checkouts are the given clones (each verified at its pin and clean, read with `GIT_OPTIONAL_LOCKS=0`). The rest stays unlabelled and counts as WRONG. `--expect-relabel` stops unless the set is the lead's list. Once `relabel/` has prompts it is never restaged.
- **View.** `--tier FILE` writes `views/<name>/` with that tier applied to every shown proposal (`tier_pre_registered: false`), the member count and `python_members` read back from `proposals/<repo>.yaml`. A census `tier:` line that differs from the tier applied stops staging unless `--allow-tier-mismatch` says why.
- `stage.json` records, per tier, what was shown, carried, relabelled and left unlabelled, every uid's card status and action, and the census tier check.

### 5. Precision and yield

```sh
node eval/study/metrics.mjs --run $RUN [--json $RUN/metrics.json] > $RUN/metrics.md
#   --tier-min N adds an exploratory row; it never replaces the pre-registered tier
```

Reported overall, per repo, and per rule family:

- **Proposals shown**, with the ACCEPT / TRIVIAL / WRONG counts.
- **Not-wrong rate:** (ACCEPT + TRIVIAL) / labelled.
- **Accept rate:** ACCEPT / labelled.
- **Complete label sets first.** `metrics.mjs` refuses while the A and B sets behind its labels are incomplete: the run's own, when it holds labels or label prompts, and its part's `relabel/` sub-run, when it is a staged view (`<part>/views/<name>`). Repos an adjudication queue records as excluded are left out of the check. `--allow-incomplete TEXT` computes the metrics anyway, records TEXT and the gaps in both outputs (`incomplete`), and makes the run ineligible for a headline (no verdicts). A carried-only preview before labelling is the usual reason. `stage.mjs final` refuses the same way, and records its `--allow-incomplete` in `stage.json` (`final_incomplete`).
- **When anything is unlabelled,** both rates also over all shown, with unlabelled counted as WRONG (the target definition), and the upper bound with unlabelled counted as ACCEPT. On a held-out run, only the first counts against a target. `metrics.mjs` fails if the labels file is missing.
- **Yield:** ACCEPT per repo, as mean, median and repos with none. Repos with no proposals count as zero; partly labelled repos are excluded.
- **Targets (decisions D1, D4):** the bold default-tier accept cell and the bold not-wrong cell of each language state the criterion (point estimate ≥ 95%, per language) and, for a primary held-out run, the verdict. Pooled rows are secondary. **Sensitivity (D2):** the per-language rates again without the set's course-material repos (and any `--without a,b`). **Failed repos (D3)** are listed in the header.
- **Per language and tier:** for each language (`typescript/javascript`, `python`, by the convention's language, `lib.mjs` `proposalLanguageGroup`, decision D7; a language's clusters are the repos `run.json` gives that language plus any repo with a proposal in it), the default tier, the suggestion tier and all shown, with the target-definition rates (over all shown, unlabelled counted as WRONG), Wilson and both cluster intervals over that language's repos. **Per framework bucket:** the same, per the manifest's `framework_bucket`.
- **Default and suggestion tier:** the same rates, restricted to the pre-registered tier from `run.json` (`params.tier`, rule 5: role has at least N members, `evidence.total`, and for the primary sets a default-tier rule kind; under D5 also a rule that names no package symbol; under D7 also a TypeScript/JavaScript proposal, by `lib.mjs` `proposalLanguage`: Python when any role member is, or its example is). Every shown proposal outside the default tier is suggestion tier. A run without `params.tier` is labelled "not pre-registered".
- **Per language, tier and rule family:** the same rates over all shown for each rule family with a shown proposal, per tier, with Wilson and both repo-cluster intervals (clusters: the language's repos with a proposal of that family in that tier; `by_language[].families[]` in JSON). Secondary: no verdict.
- **Intervals:**
  - Wilson 95% for every rate.
  - For pooled rates, two repo-cluster 95% intervals, with the number of repos (clusters):
    - a percentile bootstrap (4,000 resamples, one fixed seed, so the intervals are deterministic and not independent draws);
    - a cluster-robust interval (linearised ratio variance, t with G − 1 df).

    Proposals in one repo are correlated, so quote a cluster interval, not Wilson. With 15–20 clusters, several of them tiny, the percentile bootstrap tends to under-cover, so quote the wider of the two.
- **Why not accepted:** counts of `trivial_by` (lint split by `lint_severity`) and `wrong_because`. These map onto the product gaps P1–P11.
- **Provenance in `metrics.json`:**
  - `rubric`: the run's rubric, from `prompts/index.json` (entries before D6 are v2), else from the label records;
  - `rubric_sha256`: the labeller-facing rubric text's hash, as recorded per prompt since D6; `rubric_sha256s` lists every distinct hash, and `rubric` is `"mixed"` (with `rubric_sha256` null) when a run's prompts used more than one text, or its labels more than one version. With `--labels`, `rubric` comes from those label records, not from the run's prompts;
  - `label_rubrics`: the scored records counted by their `rubric` field;
  - `decisions`: the decision log (`lib.mjs` `DECISIONS`);
  - `tier.pre_registered`: false when `run.json` says `params.tier_pre_registered: false`, as for dev manifests without a tier and for derived views;
  - `kind`: `"calibration"` for a run whose `run.json` has `calibration` (a relabel that measures a rubric change, written by its stage script), with `calibration: {shift, agreement}`, the repo-relative paths of its shift and A/B agreement files; `"precision"` otherwise.

**Rule families** come from the structured rule in `conventions.yaml` (`rule.type`, `rule.kind`, `rule.signal`), with the census text as a fallback. The two agree on all 488 dev-set conventions. The families are:

- call wrappers, decorators, base classes, argument keys;
- layering (`avoids import:`), rendered components, rendered inside a wrapper;
- calls, naming, other avoidance;
- call order, control and typing;
- package and repo facts.

### 6. Recall against documented conventions

```sh
node eval/study/recall.mjs sources --run $RUN             # recall/sources/<repo>.json: docs, agent rules, lint configs, custom rules
node eval/study/prompt.mjs extract --run $RUN             # one extractor agent per repo (blind to proposals)
node eval/study/collect.mjs --run $RUN --stage extract    # -> recall/docs/<repo>.jsonl
node eval/study/prompt.mjs match --run $RUN               # one matcher agent per repo (blind to labels)
node eval/study/collect.mjs --run $RUN --stage match      # -> recall/matches/<repo>.jsonl
node eval/study/recall.mjs score --run $RUN [--json $RUN/recall.json] > $RUN/recall.md
```

**Sequencing.** Extractors and matchers must never see labels. So `prompt.mjs` skips an extract or match prompt for a repo while any label or adjudication prompt for that repo is outstanding (rendered but not collected). It renders match prompts only once `final.jsonl` exists, when every label is inside the run directory.

Extraction never sees proposals. It can run before labelling, or between labelling and adjudication, for repos whose outputs are all collected.

**Building the reference list.** Extractors read:

- AGENTS.md, CLAUDE.md, CONTRIBUTING.md;
- `.cursorrules`, `.cursor/rules`, copilot instructions, agent skills;
- lint configs that are set explicitly in the repo: eslint, oxlint, biome, ruff, pylint, mypy and import-linter;
- custom lint rules.

They write one structured item per statement, with:

- the source, a quote, and a normalized statement;
- the scope and a category;
- the strength (must or should);
- `enabled` (false for rules turned off);
- `code_checkable` (false for process, formatting and generic advice).

**The recall denominator** is the items that are enabled and code-checkable.

**Matching.** Matchers judge each item FULL, PARTIAL or NONE twice: against the shown proposals, and against the shown plus pool. They also say whether the code actually follows the item: `yes`, `mostly`, `no` or `unknown`. The rubric is in `MATCH-PROMPT.md`.

**`score` reports:**

- **recall@shown and recall@pool,** each strict (FULL) and lenient (FULL + PARTIAL), with Wilson and bootstrap intervals:
  - misses at the pool are mining misses;
  - misses only at shown are ranking misses;
- **the same, restricted to items the code follows:** a rule nobody follows cannot be learned from the code;
- **splits** by source (lint vs prose), per repo and per category;
- **cross-check of labels against the repo's own policy:**
  - the label mix of proposals that match a documented convention, and of those that do not;
  - every proposal labelled WRONG although the repo documents it. Review each one: it is a labelling error, a bad match, or a stale doc.

Expect recall of lint-enforced items to be low by design. Drift is meant to defer to lint (gap P4), and a lint-enforced rule that it did propose would be labelled TRIVIAL. Report the lint and prose splits, not just the total.

**Agreement for extraction and matching.** For at least 3 repos, run a second extractor (`--labeller E2`) and a second matcher (`--labeller M2`). `score` reports matcher κ, and the extractors' item counts. Overlap between extractors is judged by reading the two lists.

### 7. Report

1. **Commit `$RUN`:**
   - `run.json`, `queue.json`, `proposals/`, `pool/`;
   - `prompts/` (what each agent was asked);
   - `labels/A|B|C`, `adjudication/`, `final.jsonl`;
   - `recall/`;
   - the `.md` outputs;
   - a `README.md` recording the models used per labeller, any reserve swaps, and any isolation weaker than the prompts assume.
2. **Publish the numbers together.** A precision number is published only with its agreement, its yield and its recall.

## File layout of a run

```
runs/<name>/
  run.json                 drift binary sha256, version, commit, dirty, build; manifest path, sha256, holdout (and why);
                           params (max, pool, tier, checkouts); per-repo status, binary, language and framework_bucket
  queue.json               {items: [{uid, repo, id, rank, summary, role, rule, evidence, members, family, example, outliers, outlier_files, block}]}
  proposals/<repo>.txt     census --all-outliers --max <max>     (what users see; what labellers see)
  proposals/<repo>.yaml    .drift/conventions.yaml from drift init --max <pool>
  pool/<repo>.txt          census --max <pool>
  prompts/index.json       every rendered prompt: stage, labeller, repo, prompt path, outbox path, cwd (the agent's empty working
                           directory), checkout_status, expected ids, collected {at, dest, sha256}, rejected [{at, problems}]
  prompts/<stage>/<L>/<repo>.md
  labels/A/<repo>.jsonl    labeller A   (schema: RUBRIC-v3.md "Output"; v2 for runs before D6)
  labels/B/<repo>.jsonl    labeller B
  labels/C/<repo>.jsonl    adjudicator  (same schema + sided_with: "1" | "2" | "neither")
  adjudication/queue.json  {labels_sha256: {A, B}, cases: [{uid, repo, order: ["B","A"], reviews: {A, B}}]}
  final.jsonl              {uid, repo, id, label, source: agreed|adjudicated, A, B, C, sided_with, clear, trivial_by, wrong_because, reason}
  recall/sources/<repo>.json
  recall/docs/<repo>.jsonl     {ref, repo, source, source_kind, quote, statement, scope, category, strength, enabled, enforced_by, code_checkable}
  recall/matches/<repo>.jsonl  {ref, match, proposals, pool_match, pool_proposals, followed, checked, reason}
```

**Label record (v2, v3).** Every record has:

- `uid`, `rubric: "v3"` (`"v2"` before D6), and `labeller` (added by `collect.mjs`);
- `label`, plus `trivial_by` and `trivial_evidence` if TRIVIAL (and `lint_severity` if by lint), or `wrong_because` if WRONG;
- `clear`, `confidence`;
- `checked`: the repo-relative files that were opened;
- optional `outliers` verdicts;
- `reason`;
- optional `defects`;
- optional (v3) `rules`, the decision rules applied, and the outlier verdict `one_off`.

`metrics.mjs` also reads v1 records (`repo`, `id`, `label`).

## Blinding and independence, summarised

| Who | Sees | Never sees |
| --- | --- | --- |
| Labellers A and B | the rubric, one repo's proposals (shuffled, no rank), the repo checkout, a fresh outbox, an empty working directory | other labels (never in an outbox while they work), which labeller they are, Drift's source or docs, earlier studies, expected numbers |
| Adjudicator C | the above, plus both reviews, anonymised and shuffled | which review is A or B, agreement statistics |
| Extractor | the repo checkout, the candidate source list | proposals, labels |
| Matcher | documented items, proposals (shown and pool), the repo | labels |
| Product engineers | nothing from a held-out run until it is reported | (rule 3) |

## Validation on the dev set

`runs/dev-2026-11-05/` re-runs drift-main on the 16 dev repos and scores the first study's labels. It reproduces:

- **accept** 60.0% (108/180) and **not-wrong** 76.1% (137/180);
- **the per-family table;**
- **agreement** on the 40-proposal second opinion: 72.5%, κ 0.51.

The one difference is a proposal of novu that had inherited midday's label through an ID collision; see that run's README.

## Proposed `drift census --json`

`prepare.mjs` gets structured rules by running `drift init` inside the clone, removing what it wrote, and parsing YAML with a small subset parser. A `--json` flag on `census` would remove the side effects and the parser. It should have this shape:

```jsonc
{
  "schema": 1,
  "engine": "drift 0.1.0-dev",
  "commit": "2e83ec29...",            // git commit the binary was built from; "+dirty" suffix if the tree was dirty
  "root": "/abs/path",
  "units": 9139, "roles": 460, "conventions": 15,
  "params": { "max": 15 },            // plus the mining thresholds in effect (min members, min lower bound)
  "proposals": [                      // same order, same ids, same set as the text output for the same --max
    {
      "id": "D-50df58",               // as today: unique within one repo only
      "rank": 1,
      "summary": "apps/web: server actions in lib/actions/** are wrapped in ...",   // the text line, verbatim
      "role":  { "package": "apps/web", "dir": "lib/actions", "file": "*", "entry": "server_action", "kind": "function", "members": 109 },
      "rule":  { "type": "wrapped_by", "kind": "call", "any_of": ["apps/web/lib/actions/safe-action.ts#authActionClient.inputSchema().action"] },
                                      // exactly the `rule` object of conventions.yaml, for every rule type
      "evidence": { "holders": 106, "total": 109, "lower_bound": 0.922, "lift": 17.285,
                    "split": [["apps/web/lib/actions/safe-action.ts#authActionClient.inputSchema().action", 75]] },
      "tier": "default",              // once tiering exists: "default" | "suggestion"; "blockable": members >= 15 today
      "example":  { "path": "apps/web/lib/actions/add-edit-integration.ts", "symbol": "addEditIntegration", "line": 12 },
      "outliers": [ { "path": "apps/web/lib/actions/partners/ban-partner.ts", "line": 50, "symbol": "banPartner" } ],
                                      // always all of them (as --all-outliers)
      "outliers_total": 3
    }
  ]
}
```

It must be:

- **deterministic;**
- **free of side effects:** no files written, so it is safe on a reviewer's checkout;
- **consistent with the text output:** the same ids, the same summaries and the same order.

Embedding `git describe --dirty` in `drift --version` would also let any binary be checked against a commit. Held-out runs don't need it: `prepare.mjs` builds the binary from the commit itself. Dev runs could then verify `--drift` instead of only recording it.
