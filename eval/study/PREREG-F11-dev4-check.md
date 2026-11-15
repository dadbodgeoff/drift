# F11 freeze record and dev4 pre-registration (WS-D, PLAN-R11 §4.1 and §4.2)

This file is committed and pushed **before the dev4 selection seed** is drawn or committed, and so before any candidate of the dev4 draw is seen, before any census of the pool and before any label of it. It names no dev4 repo: the pool's repos appear only by slot in `select-holdout.mjs verify` output, and by opaque key in the run directories `eval/study/runs/dev4-ts-*` and `eval/study/runs/dev4-py-*`.

Only three parts of this file are filled in later, all at the freeze `F11` and in one commit that is pushed before any dev4 census command runs: the freeze table (§1), the two build-set in-sample figures of §5 (c), and the semantic check's frozen prompt of §6. Nothing else in this file changes after that commit. A deviation is reported in the run READMEs, never edited in here.

## 1. The freeze F11

To be filled in at the freeze, by the dev4 operator, from the lead's freeze record. Every round-11 mining, check or exposure workstream (PLAN-R11 §5: A, B, C) is merged before `F11` (§4.2 (1)).

| Item | Value |
| --- | --- |
| Product commit `F11` | `1a44d7effbc6cd8c41a119524266630fdfce14de` (main, "Merge pull request #144"), recorded by the lead as the round-11 freeze. |
| Tree of `F11` | `bf92aa41fc6a9409f5538f98b99bf3fa09f96720` |
| Binary | `build-verified.sh` of a worktree at `F11`, release, the dev4 operator's codegen-units; the build tag check must pass. **At the freeze (disk short, lead's instruction):** the lead's read-only release build of a clean `F11` worktree, `/home/user/drift-bin/f11/drift` (`census --json` `commit` tag `cgu83-1a44d7ef-1794188563`). The dev4 operator checked it against a `build-verified.sh` release build of `F11` at CGU 75 (tag `cgu75-1a44d7ef-1794188509`, sha256 `a4410945694092711104dc932b85dffe217293f147bf0348a7323a8cc8e9be2a`, since deleted): `census --json --max 15` (Python with `--python-proposals`) on all 54 build-set repos is identical apart from the `commit` tag. |
| Binary sha256 | `9a8c7cd52483b8678e2dd3fb9f32a488d0be592d0e476a8be511f09aa20bd247` |
| Toolchain | cargo 1.97.0 (c980f4866 2026-06-30), rustc 1.97.0 (2d8144b78 2026-07-07) |
| Gates on `F11` | `gates.sh` at CGU 75 on a worktree at `F11`: `cargo fmt --check` OK; `clippy --all-targets -D warnings` 0 issues; `cargo test --all --locked` 916 passed, 0 failed (against a private verified debug binary, tag `gate75-1a44d7ef-1794188920`); `node --test eval/study/*.test.mjs` 222 pass, 0 fail; `select-holdout.mjs verify` OK for primary, heldout2, dev3 and dev4 |
| Tier | `eval/study/tier-d7.json` (sha256 `e695112de57a4927952dad89f50eed6bdc87b61e91560e3bb709706c7f30a51a`) as frozen in both dev4 manifests; the census runs with `prepare.mjs --strict-tier`, so the product's `tier:` line must agree with it on every card. The D7 default tier is the candidate tier of PLAN-R11 §2 (d): the same cards. |
| Rubric | v3, the text approved with D6: labeller-facing text sha256 `79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd` (`lib.mjs` `APPROVED_RUBRIC`). |
| Show policy | The product's own at `F11`. The show table is not regenerated in round 11 (PLAN-R11 §4.1, D13). The cards `census --max 15` prints for people are the cards shown, candidates included. At `F11`: `crates/drift-mine/data/show-policy.json` sha256 `a4656b659aed70cd6f6fb635d190e91103e399d08b75a20d73b3aff159c351e6`; `crates/drift-mine/data/family-admission.json` sha256 `f194215633496c4afd06fb49ec2653ad47274093a150f25332bed3bc200dab2b`; facts schema 10, `selector_version` 3, TS `LOWERING_VERSION` 37, Python `LOWERING_VERSION` 16. The neighbour gate (#144) is off by default (`DRIFT_NEIGHBOUR_GATE=on` opts in; §7). |
| Python opt-in | The census study flag and `.drift/config` setting that turn mined Python proposals on at `F11` (WS-B), named here at the freeze: `drift census --python-proposals` (the study's opt-in view), and `proposals: {python: on}` in `.drift/config.yaml`. |
| Build-set in-sample figures for §5 (c) | Per-card accept over all shown, both tiers, unlabelled counted as WRONG, on the 54 build-set repos of `folds-r11.json` (folds 1–4: the 34 dev repos; fold 5: dev3's 20): **TS/JS 86.2% (50/58)**, of which folds 1–4 43/46 and dev3 7/12; **Python 92.9% (13/14)** (opt-in view), of which folds 1–4 12/12 and dev3 1/2. How: the `F11` binary's `census --json --max 15` on each build clone at its pinned sha (Python with `--python-proposals`; every clone clean before and after); labels carried by rule 4 from relabel5 (folds 1–4) and dev3's `final.jsonl` (fold 5). All 72 shown cards are labelled cards at the same pin with a byte-identical labeller-visible card (`lib.mjs labellerCard` of `census --all-outliers --all --max 15`; 35 differ only in the `agents:` line, which labellers never see). So 0 cards needed a relabel, and 0 are unlabelled. |
| Semantic check (§6, WS-G) | Harness v1 `eval/study/semantic/harness.mjs` and prompt `eval/study/semantic/semantic-prompt-v1.txt`, as merged (#139): the prompt's sha256 (`95ec1162…`, written here in full), the harness file's sha256 at `F11`, the commit, and the setting that turns the check on (`agents.semantic`): prompt sha256 `95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752`; `harness.mjs` sha256 `3675e8190af38b92a617bf91330e10985f515880e2554ce53abd1e1fd63f7e7a`; both last changed in `afa1c339` (merged with #139) and unchanged at `F11`. The setting: none in the product at `F11`. WS-G's product code was reverted (`dd72865b`, nothing admitted), so there is no `agents.semantic`, and the arm runs the study harness on the `F11` census outputs as `harness.mjs` specifies. |

## 2. The pool and the census

- **Sets.** The current slot occupants of `eval/dev4-2026-11-08.json` (36 TS/JS, set `ts-dev4-2026-11-08`) and `eval/dev4-2026-11-08-py.json` (24 Python, set `py-dev4-2026-11-08`), after their rule-1 swaps. These are the PLAN-R11 §4.1 quotas: twice the held-out quotas per bucket (TS/JS: NestJS 6, Next.js 8, Express/Fastify/Hono 8, React SPA 8, other Node 6; Python: Django/DRF 7, FastAPI 7, Flask 5, other Python 5, by largest remainder). If the fixed reserves ran out at the technical check, the slots filled are the sets, and n per part is reported as a deviation.
- **Keys.** Each repo is named by an opaque key in a derived census manifest inside its run directory. That manifest records the frozen manifest's sha256 and core. The tier, `max` (15) and `pool` (200) are as frozen.
- **Census.** `prepare.mjs` dev run on the `F11` binary, with `--strict-tier`, one repo at a time. Each run directory's `start.json` is committed and pushed before its census.
  - **TS/JS:** the default census. Its shown cards are both tiers: the D7 candidate tier and the suggestions.
  - **Python:** the **opt-in view**, the census with mined Python proposals turned on by the `F11` opt-in (§1). The default Python census (proposals off) is also run, once per repo, and only its shown-card count is recorded (expected 0).
- **Failures.** A repo that fails census or `init` is reported as a failure, with no swap (D3). It counts as a repo with no shown card in yield.

## 3. Labelling

- **Labellers.** Two fresh labellers per repo, A then B, never at the same time on one repo, with rubric v3:
  - A runs on the session's default model;
  - B runs on a different, smaller model.
  - The lead keeps the model identifiers.
- **Collection.** Outputs are collected with `collect.mjs --complete`. An INVALID or MISSING output is relaunched as a fresh agent; its output is never edited.
- **Agreement and adjudication.** `agree.mjs` runs before adjudication. C, a fresh agent that ran neither A nor B, adjudicates the disagreements only. `adjudicate.mjs --merge` then writes `final.jsonl`.
- **Unlabelled.** A card without a final label counts as WRONG in every rate.
- **Not measured.** Recall, extraction and matching are not measured, as for heldout2 and dev3.

## 4. Measures (pre-registered)

Every rate is over all shown cards, with unlabelled counted as WRONG. Rates are computed per language by `metrics.mjs` (`by_language[]`, the language of the card, as metrics groups it). Each comes with its n, the Wilson 95% interval, and both repo-cluster 95% intervals (percentile bootstrap and cluster-t) with the number of repos. The wider cluster interval is the one quoted. For Python, "shown" is the opt-in view (§2) in every measure.

Measures 1–7 are those of `PREREG-F10-dev3-check.md` §4, unchanged:

1. **D1: default-tier accept, TS/JS.** ACCEPT / shown in the default tier (tier-d7), which is the candidate tier. Python has no default tier under D7 and gets no D1 figure.
2. **D4: not-wrong, all shown, per language.** (ACCEPT + TRIVIAL) / all shown, both tiers. Candidates count (PLAN-R11 §2: D4's population is everything shown to people).
3. **Per-card accept, per language and tier.** ACCEPT / shown for the default tier, the suggestion tier and all shown.
4. **Flag precision, per language and tier.** The verdicts counted are the per-outlier verdicts in the A and B label records of the shown cards. Flag precision is (`mistake` + `look`) / all of those verdicts. This is the definition of `research/2026-11-08/r10-history.mjs` §12 and PLAN-PAR secondary metric A. It is reported with its repo range; it has no target.
5. **Yield per repo, per language.** Accepted cards per repo (mean, median, repos with none) and shown cards per repo. Repos with no shown card, and failed repos, count as zero.
6. **WRONG causes, per language.** `wrong_because` of the final WRONG labels, and the number of unlabelled cards.
7. **Also reported:** agreement (exact agreement, κ and the confusion matrix), the per-framework-bucket table, and failed repos.

Added for dev4 (PLAN-R11 WS-D):

8. **Default-tier flag precision, TS/JS, as a headline row.** Measure 4 restricted to the TS/JS default (candidate) tier: (`mistake` + `look`) / all per-outlier verdicts of the A and B records of those cards, with its n of verdicts, n of cards and repo range. Beside it, dev3's figure at `F10` (31.3%, 5/16) and the build-set figure, both as reported, with no verdict. No target.
9. **The Python opt-in view.** Measures 2–6 for Python on the opt-in view, with the number of shown Python cards stated first, since condition (b) needs ≥ 10. Beside it: the shown-card count of the default Python census (proposals off), per repo and in total.
10. **Agent exposure.** The number of shown cards the `F11` census marks as reaching agents without a person's accept (PLAN-R11 round-11 target: 0 on every set), from each repo's census JSON at `F11` (its agents field as WS-B defines it). Reported per language, with no verdict.

## 5. The dev4-check (PLAN-R11 §4.2 (2), verbatim)

> 2. **dev4-check** replaces the dev3-check. Point estimates, unlabelled counted as WRONG:
>    - **(a)** TS default-tier (D7 candidate tier) accept ≥ 90% with ≥ 8 cards. *Unchanged*: the tier definition is the same under option (d), so the bar measures the same thing.
>    - **(b)** Not-wrong ≥ 70% per language:
>      - TS over all shown;
>      - Python over the opt-in view (§3), and **with ≥ 10 shown Python cards** (new).
>    - **(c)** For each language, the build-set in-sample figure within 10 points of dev4's. The build set now includes dev3, with dev3's cards re-censused at `F11` and labelled under the carry rule.

**How each condition is judged** (point estimates; strict wherever the wording is open):

- **(a)** D1 for TS/JS is ≥ 90.0%, and the TS/JS default tier has ≥ 8 shown cards. With fewer than 8 cards, (a) fails whatever the rate.
- **(b)** D4 is ≥ 70.0% for TS/JS over all shown, and ≥ 70.0% for Python over the opt-in view. Python also needs ≥ 10 shown cards in the opt-in view: with fewer, (b) fails whatever the rate. A language with no shown card has no point estimate, so (b) fails.
- **(c)** For each language, |dev4 − build-set in-sample| ≤ 10.0 points.
  - **The dev4 figure** is per-card accept over all shown, both tiers, unlabelled counted as WRONG (Python: the opt-in view). That is the definition the dev3-check used.
  - **The build-set in-sample figure** is the same rate on the build set at `F11`: the dev sets (`eval/repos.json`, `eval/repos-py.json` without polar and CTFd, `eval/repos-py-2.json`) and dev3, each censused with the `F11` binary (Python: the opt-in view), with the newest build-set labels carried to identical cards (rule 4) and every changed card relabelled by WS-E.
  - **Both figures are written into §1 at the freeze**, with their n, before any dev4 census command runs [STRICT]. No dev4 census starts until they are committed and pushed. A language whose build-set figure cannot be computed fails (c).
  - A language with no shown dev4 card fails (c).
- **The dev4-check passes** only if (a), (b) and (c) all hold, for both languages [STRICT: the conditions are joint, as D13 adopted].

**Reported beside them, with no verdict:** the undo-named and dev-v3 readings of the same policy, where WS-A's `generalise.mjs` gives them at `F11`.

**If the dev4-check fails**, there is no D12. dev4 joins the build set after its report, and round 12 draws dev5 (PLAN-R11 §4.2).

## 6. Secondary arm: "semantic-on" (WS-G; pre-registered, gates nothing)

**Provenance.** Added by the lead's round-11 decision (WS-G), on 2026-11-08, after the seed commit and while the draw was running: before any dev4 repo, card or label was seen by anyone, and before any census. The rest of this file is unchanged by it.

**What it is.** WS-G adds a semantic check, off by default behind `agents.semantic`, with two parts:
- **S1, role cohesion:** do a role's members do the same job?
- **S2, flag legitimacy:** is a flagged outlier a mistake, or a legitimate difference?

With it on, it decides whether a candidate card reaches agents unvetted, which flags are shown, and suggestion admission.

**How it is measured.** On the **same dev4 cards and the same final labels** as the dev4-check, with no extra labelling. Each shown card of the default census (TS/JS) and of the Python opt-in view, and each of its flags, is passed through the check at the `F11` binary with `agents.semantic` on, and the arm is the result of that filter:
- a card the check would not admit (S1, or the suggestion admission) is dropped from the arm;
- a flag the check would not show (S2) is dropped from the arm's flag verdicts.

The check's own outputs are recorded per card and per flag in the run directories before they are joined to the labels.

**The harness.** The arm runs WS-G's harness v1, `eval/study/semantic/harness.mjs`, with the prompt file `eval/study/semantic/semantic-prompt-v1.txt`, exactly as merged in #139 and as they stand at `F11`. Its payload differs from the one WS-G measured offline; the arm measures v1 as it stands, not the offline one.

**Joining flags to verdicts.** A kept or dropped flag is joined to the labellers' per-outlier verdict of the same card by its unit:
- a **symbol-unit** outlier matches a verdict on the same symbol (file and name);
- a **file-unit** outlier (the unit is a file, as on layering cards, where `mixed_group` lives) matches a verdict that names the same file, by repo-relative path, with `./` and trailing separators removed and case kept. Labellers name these by file, so a symbol match would never find them.

So the arm's member-level figures include file-unit flags. A kept flag that matches no verdict counts as not correct (neither `mistake` nor `look`) [STRICT], and the number of unmatched flags is reported, per unit kind.

**What it reports**, per language, with the definitions, intervals and unlabelled-as-WRONG rule of §4:
1. **Candidate accept among the cards that pass:** ACCEPT / candidate-tier (D7 default) cards the check admits, TS/JS. Beside it, the number of candidate cards it drops and their labels.
2. **Flag precision on the kept flags:** measure 4's definition over the per-outlier verdicts of the flags S2 keeps, per tier, with the default tier as the headline row; beside it, the verdicts of the flags it drops.
3. **D4:** not-wrong over every card the arm shows, both tiers (Python: the opt-in view).
4. **Yield:** accepted cards per repo over all repos of the set, and shown cards per repo.

Each is reported beside the shipped default's figure for the same cards (§4), as a difference with no verdict.

**How it is frozen.** At the prompt sha256 that WS-G commits, and the commit and setting it names, all written into §1 at the freeze, before any census. If the check cannot run at `F11` as frozen, the arm is reported as not run; it is never re-run on another prompt or binary.

**What it decides.** Nothing in the dev4-check. §5 is judged on the shipped default as written, whatever this arm shows. It is a pre-registered experiment, and any decision to ship the check is made later, from it and from other evidence, outside this file.

## 7. Secondary arm: history replay (agent-facing warning precision; pre-registered, gates nothing)

**Provenance.** Added by the lead's round-11 decision on 2026-11-08, after the seed commit and while the draw ran, before any dev4 repo, card or label was seen by anyone, and before any census. The neighbour-gate reporting (steps 6–7, (a)/(b), false suppressions) was added by the lead on 2026-11-09, before `F11` and before any census. It was amended by the lead the same day, also before `F11` and before any census. #144's neighbour gate ships **off** by default at `F11`, behind `DRIFT_NEIGHBOUR_GATE=on`, because a new failure mode was found: it hides real violations next to members Drift exempts by itself. So the arm now runs `check` twice at S, with the gate off (the product) and with it on.

**Question.** When an agent writes new code, how often is a warning `check` gives on it from a default-tier (candidate) card right?

**Repos.** The TS/JS dev4 repos whose dev4 census (§2) shows at least one default-tier card. The others take no part.

**Procedure, per repo** [STRICT wherever the wording is open]:
1. **S** is the repo's pinned sha in the dev4 manifest (the census sha).
2. **The selector.** The union of the frozen role selectors of the repo's default-tier cards in the dev4 census at S.
3. **Symbols.** A symbol is a unit the `F11` binary's facts record (a function, class, method or exported binding), keyed by file and name. A symbol is *new in P..S* when it is in the facts at S and not in the facts at P. Only symbols in files the selector matches count.
4. **P** is the newest commit on S's first-parent history such that P..S adds ≥ 20 new symbols, with P no more than 12 months older than S (committer dates). If no commit within 12 months reaches 20, P is the oldest first-parent commit within the 12 months, and the repo takes part with the symbols it has.
5. **Mine at P** with the `F11` binary, and freeze the policy: the `F11` show policy and tier, with every default-tier card mined at P accepted, as a person's accept would make it agent-facing. Nothing else is set; `agents.semantic` stays at its default.
6. **Check at S, twice.** Run `check --json` at S with that frozen policy twice, and keep each run's warnings on the symbols new in P..S. Each warning is one (card, new member) pair. Every warning of either run is labelled, and none is sampled away.
   - **Gate off: the product.** The first run is `F11` as it ships. #144's neighbour gate is off by default there. This run's warnings are the **shown** set, (a).
   - **Gate on.** The second run is the same `check` with only `DRIFT_NEIGHBOUR_GATE=on` added. The gate withholds a warning when the new member is strictly nearer the card's set-apart members than its holders, and `check --json` lists that warning as `suppressed_neighbour`.
   - **The withheld set.** These are the warnings present in the gate-off run that the gate-on run lists as `suppressed_neighbour`. The gate-on run's shown warnings are the basis of (b).
   - **Unexpected warnings.** A warning the gate-on run shows that the gate-off run does not is still labelled. It counts in (b), and it is reported as a discrepancy.
7. **Silent misses.** For each repo, draw a random sample, equal in size to its shown warnings (gate off), of the new members (symbols new in P..S in a warned card's role) on which neither run gave a warning, shown or withheld. Members warned in either run are already labelled under step 6, so they are left out of this sample. The sample uses `lib.mjs shuffle` with the seed `dev4-history-replay:<F11 commit>:<repo key>`, fixed at the freeze. A repo with fewer unwarned new members gives all of them.

**What labellers see** (blind, A/B/C as §3, fresh agents, rubric v3): the card as the census at P prints it, the new member's file at S, and the three holders the rubric samples. They are not told whether the member was warned, withheld or sampled.

**What they give:** the rubric v3 per-outlier verdict for the new member. A warning is **correct** when the final verdict is `mistake` or `look`. A sampled unwarned member is a **silent miss** when its final verdict is `mistake` or `look`. A withheld warning whose final verdict is `mistake` or `look` is a **false suppression** by the gate. Unlabelled items are scored the strict way [STRICT]:
- an unlabelled warning, shown or withheld, counts as incorrect;
- an unlabelled withheld warning also counts as a false suppression;
- an unlabelled sampled member counts as a silent miss.

**What it reports:**
- **Warning precision, two ways**, each as correct / warnings, with its Wilson 95% interval and the repo-cluster interval of §4, over all repos:
  - **(a) the product, gate off:** the shown set. This is what an agent gets at `F11`, and it is the headline figure.
  - **(b) gate on:** the warnings the gate-on run shows.
- **False suppressions:** the number of withheld warnings that are `mistake` or `look`, out of all withheld warnings, with its Wilson 95% interval.
- **Repos contributing:** the number of repos with ≥ 1 warning, and warnings per repo, for each run.
- **Discrepancies:** the number of warnings the gate-on run shows that the gate-off run does not (expected 0).
- **Silent-miss rate:** silent misses / sampled unwarned members, with its Wilson 95% interval.
- Beside them: the per-repo P (as months before S) and the number of new symbols, and the repos where the 12-month cap bound.

**Target recorded before any data:** ≥ 50 shown warnings across ≥ 10 repos, counted on (a), the product with the gate off. With fewer warnings or fewer repos, the arm is reported as **underpowered**, with its figures, and no reading is drawn from it.

**What it decides.** Nothing in the dev4-check (§5). It is a pre-registered secondary measure.

## 8. What is not part of this check

- **The D12 prediction** (PLAN-R11 §4.2 (3)): the written D1, D4 and per-card-accept prediction, with intervals, from dev3 and dev4 pooled. It is WS-F's, made only if the dev4-check passes, and committed before any held-out selection seed. Build-set readings are reported beside it, not used for it.
- **Spacing** (§4.2 (4)): at most one held-out draw per freeze, none before dev4 is reported.
- **The semantic-on arm** (§6): reported, never a condition of the dev4-check.
- **The history-replay arm** (§7): reported, never a condition of the dev4-check.

## 9. Order

Steps run in this order:

1. This record, committed and pushed.
2. The dev4 selection spec and seed, committed and pushed; then the draw, the manifests, the technical check (rule 1, reserves in order, no extension) and `verify`.
3. At the freeze: §1 (with the §6 prompt sha) and the §5 (c) figures, filled in, committed and pushed.
4. The start records, committed and pushed.
5. The census (TS/JS default; Python opt-in and default).
6. A, then B.
7. Agreement.
8. C.
9. The merge.
10. `metrics.mjs`, then the dev4-check report.
11. The semantic-on arm (§6): the check's outputs recorded per card and flag, then joined to the final labels, then its report.
12. The history-replay arm (§7): P chosen per repo, the mine at P, `check` at S with the gate off and on (both runs' warnings recorded), the silent-miss sample drawn, then A, B, agreement, C and the merge as in §3, then its report.

Only the dev4 operator runs steps 2 and 4–12 or opens their outputs (`eval/dev4*`, `eval/study/runs/dev4*`). Nobody building product opens dev4 repos, cards or labels before its report (PLAN-R11 §4.1, isolation).

**After the report: aggregates only.** No card-level content of dev4 (card ids, reasons, file names, selectors, quoted code or label text) may be quoted in any plan or research document, before or after the report. Plans and research cite dev4 by aggregate figures only. This keeps dev4 usable as an unseen fold for longer. The run directories hold the card-level record; they are cited by path, not quoted.
