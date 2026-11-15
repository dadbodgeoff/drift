# Step 0: the agent-proof kill test (round 13, 2026-11-09)

PLAN-R13 §9.7. This measures how often an agent with **no Drift** already writes a new unit the
way its siblings do. If a strong model already does so ≥ 90% of the time, the consistency claim
is dead for strong models.

**Verdict.** The strong model's control conformance is **98% [91%–100%]**: 56 of 57
task-concern pairs, automatic scorer. By a manual read it is 100%.
- The kill rule fires. **The consistency claim is dead for strong models.**
- The cheap model is at **96% [88%–99%]** (53 of 55), and 100% by a manual read. So "a cheap
  model plus Drift matches a strong one" has no room to show on these tasks: the cheap model
  alone already matches the strong one, at a tenth of the cost.
- What remains to claim is cost (tokens, exploration) and exhaustiveness. The PLAN-R14 E5
  headroom gate (§5) would not pass on this task family.

## 1. The earlier records, checked

The external review's figures, checked against `eval/agent-ab/`:

- **v1** (`results-haiku.json`, `results-opus.json`): 18 control runs (9 tasks × 2 models).
  **0 of 18** left a violation of an ACCEPT-labelled convention, so the review's "0 violations
  in 18 of 18" is right for accepted rules.
  - Counting every proposal, 2 of 18 control runs (`infisical-email-template`, both models)
    left one violation, of D-6610a6, which is labelled WRONG.
  - The drift arm cost 21% more on the cheap model ($0.154 against $0.127; 140 turns against
    111). On the strong model it was level ($3.60 against $3.61; 127 turns against 127).
- **v2 Haiku pilot** (`v2/results/pilot-haiku-2026-11-05.*`): the totals of $0.39 against $0.23
  and 36.3 against 25.8 mean turns are as printed. Two corrections:
  - **Costs.** The pilot's own correction note says the resumed calls of the chained task were
    double-counted. Corrected, the arms cost **$0.32 against $0.18**.
  - **Where the difference sits.** All of it is in one task, midday-f (three chained prompts):
    $0.34 against $0.18, and 105 turns against 62. The other three tasks are level: $0.055
    against $0.051, and 40 turns against 41.
  - n = 1 per cell. The pilot ran before the sandbox, and its policy had 0–4 accepted
    conventions per repo.
- **Hook latency:** "PostToolUse median 1,082 ms" is the report's upper median of four per-run
  medians, one of them a single call. Over all 47 calls the median is **465 ms**.
  - The cause: the pilot binary predates #6, so every edit paid for a full scan.
  - Main takes 0.04–0.16 s on the same repos and files.
  - Details: [../r13-latency/README.md](../r13-latency/README.md).
- **What they tested:** the old product, rule-enforcement hooks over almost no accepted
  conventions. Neither pilot tested practice recipes at session start or `drift_practices`.

## 2. Method

**Tasks** ([`tasks.json`](tasks.json)): 10 tasks, made mechanically.
- **Repos:** 4 TS repos (dub, immich, infisical, midday) and 2 Python repos
  (full-stack-fastapi-template, Django-CRM). All are build-set dev clones.
- **Construction:** each task deletes one existing unit that carries its siblings' dominant
  guard, plus its registration lines. A commit on a private bare repo does this; the dev clone
  is never written.
- **Dominant guards:** from `drift security --json` on the clone. Shares among sibling entry
  points range from 66% (dub `withWorkspace`) to 100% (immich `Authenticated`); every task is
  listed with its share.
- **Prompts:** a behavioural spec of the unit. They pass `verify-tasks.mjs`'s ban list (checked
  by `run.mjs` before any call).
- **Kinds:** 7 tasks delete a whole file and 3 delete one handler from a file that keeps its
  siblings.
- **Concerns:** 1–2 per task (authn on all 10, plus validation, errors or scoping), 19 in all.
  They were fixed in `tasks.json` before any run.

**Runs** ([`run.mjs`](run.mjs)):
- control arm only: 10 tasks × 3 repeats × 2 models (a strong tier and a cheap tier) = 60
  units;
- the v2 harness's sandbox (`sandbox.mjs`: allowlisted env, `--restricted`, fixed tools, init
  check), max 40 turns, 15 min;
- at most 2 sessions and 2 checkouts at once. Checkouts are `git worktree` on a bare repo with
  alternates, because the dev clones are shallow and `clone --shared` would copy every object;
- the cap was enforced on the ledger plus in-flight estimates.

**Validity.** 7 sessions ended without a result message (exit 0, the stream stopped mid-turn),
1 strong and 6 cheap. The cause is not known. Each was set aside and retried once
(`attempt1/`). After the retry, 1 cheap run is still invalid and is excluded. One more ledger
row without a result is a session I killed when I stopped the first pass to fix disk use.

**Scoring** ([`score.mjs`](score.mjs)): on the final tree.
- The run's new entry points are Drift's `security --json` inventory minus the base commit's.
- **authn:** each new entry point carries the guard.
- **validation:** Drift's `validates` fact, and/or the task's regex on the added lines.
- **errors and scoping:** the task's regex. A concern with no new entry point scores `none`,
  and counts as not conformant [strict].
- The v2 `securityCheck` (`--diff-base HEAD` guard gaps) is saved per run in `runs/*/ci/`.
- [`selftest.mjs`](selftest.mjs), with no model calls: putting each original unit back scores
  every concern `pass`, and an untouched tree scores none of them `pass`
  ([`selftest.json`](selftest.json): 20 / 20 ok).
- Manual check: [`manual-check.md`](manual-check.md).

## 3. Results ([`report.md`](report.md), [`results.json`](results.json))

| | strong | cheap |
| --- | --- | --- |
| valid runs | 30 | 29 |
| task-concern pairs conformant, automatic (Wilson 95%) | **56/57, 98% [91%–100%]** | **53/55, 96% [88%–99%]** |
| the same, manual read | 57/57, 100% [94%–100%] | 55/55, 100% [93%–100%] (1 file does not parse) |
| runs with every concern conformant | 29/30, 97% [83%–99%] | 27/29, 93% [78%–98%] |
| authn / validation / errors / scoping | 30/30 · 15/15 · 6/6 · 5/6 | 28/29 · 15/15 · 6/6 · 4/5 |
| median turns | 11 | 14 |
| median tokens: input / output / cache read / cache write | 14 / 2,857 / 87,356 / 11,161 | 16 / 4,941 / 143,154 / 18,840 |
| median Read+Grep+Glob before the first edit | 5 | 5 |
| median exploration calls (with read-only Bash, PLAN-R14 E1) | 5.5 | 6 |
| median wall time | 24 s | 24 s |
| mean cost per run | $0.087 | $0.008 |

- **Every automatic failure is in two tasks.**
  - crm-case-watch: scoping went through `get_case_or_404` / `case_list_queryset`, which
    both apply `visible_cases_qs`. That is a regex false negative.
  - immich-view-controller: an unparseable file. The guard was present.
- **Per task** (`report.md`): tokens and turns per task and tier, and exploration before the
  first edit.
  - It ranges from 0–1 calls (fastapi-delete-item, where the siblings sit in the same file)
    to 10 (the infisical tasks on the cheap model).
  - The cheap model explores and reads more (cache read 1.6×, output 1.7×). It still costs a
    tenth as much.

**Recall, not only imitation** ([`recall.py`](recall.py), [`recall.json`](recall.json)). These
are public repositories, so a model may have seen the unit in training.
- The median line similarity between the recreated unit and the deleted original is 0.84
  (strong) and 0.80 (cheap). 9 runs reproduced the original exactly. All of them are in-file
  tasks (fastapi-delete-item, immich-tag-get), where the siblings sit in the same file.
- But conformance holds where the recreation is not a copy: crm-case-watch (similarity
  0.16–0.45) and midday-tags-router (0.24–0.29).
- So recall does not explain the result away. Still, any A/B on public repositories inherits
  this confound. The v3 pre-registration (`../v3/PREREG.md`) handles it.

## 4. Cost

| | |
| --- | --- |
| Ledger (every returned session) | **$2.87** (67 calls) |
| Ledger rows without a result message (8), priced at the dearest run of their tier | ≤ $0.36 |
| Sessions killed, unledgered, when the first pass was stopped to fix disk use (2, cheap) | ≤ $0.05 |
| Probe calls (credentials and model availability) | $0.01 |
| **Total** | **≤ $3.29, against the $25 cap** |

## 5. What this means for the A/B

- **Kill rule (PLAN-R13 §9.7):** strong-model control conformance ≥ 90%, so the consistency
  claim is dropped for strong models. Pitch cost and exhaustiveness instead.
- **PLAN-R14 E5 headroom gate:** "proceed only if control fails ≥ 20% on the cheapest model".
  Here the cheap model failed at least one concern on 2 of 29 runs (7%), and on 0 by the manual
  read. **The gate would not pass on this task family**: deleting a dominant-guard unit from a
  public repo leaves no headroom.
  - A v3 run needs tasks where control fails: e.g. units whose dominant variant is not visible
    from the nearest sibling (PLAN-R14 E2's distance stratum), split practices, or repos the
    models have not seen.
  - Otherwise the A/B can only measure tokens and exploration.
- **"Cheap plus Drift matches strong"** is moot here: cheap without Drift is within 2 points of
  strong, at a tenth of the cost.

## Files

- `tasks.json`, `run.mjs`, `wt.mjs`, `score.mjs`, `selftest.mjs`, `report.mjs`, `recall.py`:
  the harness. It imports `../v2/lib.mjs`, `../v2/sandbox.mjs` and `../v2/score.mjs`.
- `report.md`, `results.json`, `ledger.jsonl`, `selftest.json`, `recall.json`,
  `manual-check.md`: the records.
  - Model ids are replaced by tier labels.
  - Transcripts and patches stay in the operator's scratch (they quote third-party source).

```sh
node eval/agent-ab/r13-step0/run.mjs --drift <bin> --clones <dev-clones> --work <dir> --prepare-only
node eval/agent-ab/r13-step0/selftest.mjs --drift <bin> --work <dir>
node eval/agent-ab/r13-step0/run.mjs --drift <bin> --clones <dev-clones> --work <dir> \
     --models <strong id>,<cheap id> --labels strong,cheap --repeats 3 --jobs 2 --budget-usd 25
node eval/agent-ab/r13-step0/report.mjs --work <dir> --out <dir>
python3 -I eval/agent-ab/r13-step0/recall.py <dir> <out.json>
```
