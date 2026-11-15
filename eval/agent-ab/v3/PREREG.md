# Agent A/B v3: pre-registration (written 2026-11-09, before any v3 run)

This is the three-arm A/B that PLAN-R13 §9.7 calls for, built to PLAN-R14 WS-E (E1–E6).
`eval/agent-ab/PREREG-R13-ab.md` points here.

**Status:** pre-registered, not run.
- **Prerequisites.** It runs after four things land on main:
  - the practice engine (PLAN-R13 §3–§4);
  - the session-start brief (workstream B);
  - PLAN-R14 WS-C, so the drift arm has something to say on repos with few accepted
    conventions;
  - the hook-speed fixes of PLAN-R14 WS-D, so the latency gate (§6) can pass.
- **Changes.** Nothing below may change without a dated amendment at the end that says what
  changed and why.
- **Publication.** Results are published whatever they show (§9).
- **Model names.** The tiers are called "strong" and "cheap" in this file and in every record.
  The operator's run config maps them to model ids and stays out of the repository.

## 1. What earlier records did and did not test

The v1 A/B (`eval/agent-ab/results-*.json`) and the v2 pilot (`eval/agent-ab/v2/results/`)
tested the **old product**: rule-enforcement hooks over almost no accepted conventions (0–4 per
repo touched). They did not test practice recipes delivered at session start, or the
`drift_practices` tool. The figures, checked in `eval/agent-ab/r13-step0/README.md` §1:

- **v1:** 18 control runs. 0 of 18 left a violation of an ACCEPT-labelled convention.
- **v2 pilot:** the drift arm cost $0.39 against $0.23 as printed, and $0.32 against $0.18
  once resumed calls are no longer double-counted. All of the gap is one chained task. n = 1.
- **Pilot hook latency:** "1,082 ms" is an upper median of four per-run medians; the median
  over all 47 calls is 465 ms. The pilot binary predates #6, so every edit paid for a full
  scan.

**Step 0** (`r13-step0/`, the only data from the current product era) measured the control arm
alone: 10 deletion tasks, 6 build-set repos, 3 repeats, 2 models, $3.29.
- Strong control conformance: 98% [91%–100%]. Cheap: 96% [88%–99%].
- The kill rule fired, so **consistency is not claimed for strong models**.
- The headroom gate (§3a) would not pass on that task family.

This design changes the tasks (§3) so that the control arm can fail. If it still cannot, the
A/B stops at the gate (§3a).

## 2. Arms (E4)

All arms run the same task, prompt, tool set, turn limit (40), timeout (15 min), model and
sandbox (v2 `sandbox.mjs`: allowlisted env, `--restricted`, `--strict-mcp-config`, fixed
`--tools`). The init check allows the arms to differ only in what each arm adds.

| Arm | What the session has |
| --- | --- |
| **A: control** | The repository as is. No Drift, no AGENTS.md change. |
| **B: drift** | The Drift plugin as shipped after PLAN-R14 WS-C, delivered the new way (three parts below). There are no blocking rules; Stop only advises. |
| **C: agents-md** | The same brief and card text as arm B for the task's repo: B's brief, and the `drift practices` recipes for the task's package, rendered by `drift export agents-md`. It is written once into `AGENTS.md` and `CLAUDE.md` at the repo root and frozen per repo. No hooks, no MCP, no `drift` on PATH. This separates the information from its delivery. |

Arm B's delivery has three parts:
1. **A session-start brief of ≤ 300 tokens** (counted with the model's tokenizer). It gives one
   recipe per package × entry role for the concerns that matter to the task's package: the top
   variant, its share and a file to copy.
2. **Hooks that stay silent unless the information changes what the agent would do.** That is
   a PreToolUse line when the package's practice differs from what is about to be written, and
   a PostToolUse line only for a new departure from the dominant variant.
3. **The `drift_practices` MCP tool**, whose description says to call it instead of searching.

The exact strings (brief template, hook texts, MCP tool description) are copied verbatim from
workstream B's merged PR. Amendment A1 pins them by commit sha before any run.

**Fairness (E6).**
- Every arm gets the same Bash allowlist. The only exception is arm B's `drift` subcommands
  (`check`, `example`, `practices`).
- Advise-mode findings are never counted as violations.
- Exclusions are reported per arm, with a sensitivity line that counts every excluded session
  as a failure on both primaries.

## 3. Tasks (E2)

- **Construction:** 40 tasks, made mechanically as in step 0 (`r13-step0/tasks.json`,
  `run.mjs` prepare).
  - Each deletes one production entry point that follows its role's dominant variant on authn,
    authz/scoping, validation or errors, together with its registration lines.
  - The prompt describes the route and its behaviour.
  - The prompt names no sibling file and no folder.
  - It passes the `verify-tasks.mjs` ban list plus "practice", "recipe" and "copy".
- **Headroom by design.** Step 0 showed that a unit whose siblings sit in the same file or
  directory is rebuilt correctly almost every time. So the draw is stratified by the distance
  from the target to the nearest file in the same role, with at least half the tasks in the
  two far strata:
  - same directory (≤ 25% of tasks);
  - a sibling directory (≥ 25%);
  - further, or another package (≥ 50%).
  The draw is also stratified by repo size: under 1,000 source files, 1,000–5,000, and more
  than 5,000.
- **Eligible units:** a dominant variant with share between 60% and 95%. Split practices are
  where an unaided agent can pick the wrong variant. Each unit's removal must leave the repo
  buildable without other edits.
- **The draw:** seed 1301, recorded before any session.
- **Repos:** build-set dev clones only, ≥ 8 repos (≥ 5 TS, ≥ 3 Python), at most 6 tasks per
  repo. No blind pool, held-out or apps-blind repo is used. The practice engine was developed
  on these repos, so arm B is in-sample. This favours Drift and is stated with every result.
- **Recall confound.** The repos are public. Step 0 found recreations with median line
  similarity 0.80–0.84 to the deleted original, and 9 of 60 identical. Every task's report
  therefore gives that similarity (`r13-step0/recall.py`), and the primaries are also reported
  on the subset with similarity < 0.5.
- **Concerns per task:** fixed in the task file before any run, 1–3 per task.

## 3a. Headroom gate (E5), before the full run

- Arm A runs once per task on the cheap model.
- **The full run proceeds only if arm A fails primary 1 on ≥ 20% of the 40 tasks.** A task
  fails when any of its concerns is not conformant, by the automatic scorer.
- If the gate fails, that result is reported, with its interval and the per-stratum failure
  rates, and the A/B stops. Only the token and exploration endpoints of these gate runs are
  reported, and they are descriptive.

## 4. Size

- **Sessions:** 40 tasks × 5 repeats × 3 arms × 2 models = **1,200 sessions**.
- **Cost estimate:** from step-0 control means ($0.087 strong, $0.008 cheap per session), times
  2 for the far-stratum tasks and 1.6 for arm B (the v2 pilot's worst ratio). That is about
  $0.20 × 600 strong plus $0.02 × 600 cheap ≈ **$130**. The budget is the estimate × 1.3,
  recorded in amendment A1. The harness stops at the budget, and a stopped run is reported as
  stopped.
- **Order:** seeded random order (seed 1302), arms interleaved within a task, at most 2
  sessions and 2 checkouts at once (shared disk).

## 5. Endpoints

**Method.** Every endpoint is computed per session and compared per task (arm minus control,
paired on task and model). The primary interval is a cluster bootstrap over tasks (4,000
resamples, v2 `report.mjs` `paired()`). Per-arm rates also get a Wilson interval on pooled
sessions.

**Primary (E3; Holm over 4 tests: 2 endpoints × 2 models; B against A only):**

1. **Conformance** of the recreated unit to the dominant variant, as the share of task-concern
   pairs. Scoring is in §7.
   - H1: B > A.
2. **Total tokens to a conforming solution:** input + output + cache read + cache write over
   the session, each also reported apart. Tokens come from the transcript's per-message usage
   (E1: a token-returning variant of v2 `costFromTranscript`).
   - A solution counts when it passes the task's functional check (a type check or import of
     the touched module, plus a behavioural probe listed per task) and conforms on every
     concern.
   - A session without one is censored at its token total. The comparison is a paired
     difference of medians, with censored sessions ranked last.
   - H2: B < A.

**Co-primary early signal (reported with the primaries, outside the Holm family):**

3. **Exploration calls before the first Write/Edit/MultiEdit (E1):** Read, Grep, Glob and
   read-only Bash, per session, from the transcript. The read-only Bash detector is
   `r13-step0/score.mjs` `readOnlyBash`. Read/Grep/Glob alone is also reported.
   - H3: B < A.
   - Stated mechanism: if the brief and `drift_practices` replace searching, this drops first
     and the token saving follows. If H3 fails, a token saving needs another explanation.

**Secondary:**
- time to the first edit, turns, wall time, cost in USD;
- tokens to a passing (not necessarily conforming) solution;
- `drift_practices` calls (B only);
- hook latency per event (p50, p95) and the share and reasons of full-scan fallbacks, from
  `DRIFT_HOOK_TRACE` (`r13-latency/`);
- the share of sessions that pass the functional check;
- C against A and B against C on every endpoint (descriptive);
- every endpoint by concern, by distance stratum, by size stratum, and on the
  low-similarity subset (§3).

## 6. Latency requirement for arm B (a gate before the run)

Measured with the trace build (`r13-latency/trace.patch`, or its product successor from PLAN-R14
WS-D1) on the release binary of the frozen commit. The setup is the harness's: policy
committed, cache warmed by `drift scan`, default `.drift/cache`. It runs on every task repo.

- PostToolUse after a source edit: **p50 < 100 ms**, p95 < 300 ms.
- PostToolUse after a non-source edit: p50 < 20 ms.
- PreToolUse: p50 < 20 ms.
- Stop with nothing changed since the last Stop: p50 < 50 ms.
- SessionStart: p50 < 2 s.

If a bar is missed, the run waits for a fix, or this file is amended with the measured numbers
before any session starts.

**Baseline** (`r13-latency/README.md` §2–§7; trace binary, load average 16–21):

| hook | dub | midday | infisical |
| --- | --- | --- | --- |
| PostToolUse, source edit, p50 (of which repo walk) | 74 ms (33) | 69 ms (17) | 276 ms (123) |
| PostToolUse, README edit, p50 | 50 ms | 24 ms | 143 ms |
| Stop, nothing edited, block-mode convention, p50 | 1,237 ms | 558 ms | 3,928 ms |
| SessionStart, p50 | 1,211 ms | 596 ms | 3,448 ms |

0 of 504 source-edit hooks fell back to a full scan. PLAN-R14 WS-D2/D3 address the README and
Stop rows. The source-edit row needs D5/D6 on mid-size repos, and a long-lived process on the
largest.

## 7. Scoring conformance

- **Automatic (primary).**
  - Drift's classifier runs on the final tree. A concern passes when every unit the session
    added carries the task's dominant variant, as reported by `drift practices --path`.
  - Before that command exists, the step-0 scorer is used: `drift security --json` guards and
    `validates` on the added entry points, plus the task's fixed regex.
  - A concern with no added unit in the inventory scores `none`, counts as not conformant, and
    is reported apart.
- **Blind label (E3), validating the classifier.** A seeded 20% subsample of sessions
  (stratified by arm and model; about 240) is labelled on every concern by two labellers.
  - The question: does the new unit handle authn, validation and errors the way its siblings
    do?
  - Labellers see only the diff, the task's behavioural spec and the sibling files. They never
    see the arm, the transcript, the hook text or any Drift output. `AGENTS.md`, `CLAUDE.md`
    and `.drift/` are stripped.
  - Labels: conformant, not conformant, or cannot tell. Labelling prompts are rendered with
    `eval/study` `lib.mjs` `rubricText` + `labellerCard`.
  - We report classifier-against-label agreement and Cohen's κ between labellers. If agreement
    is below 85%, the labelled subsample becomes the primary conformance estimate, with its own
    interval.
  - Step 0's manual check found 2 regex false negatives in 3 automatic failures. That is why
    the classifier is checked at all.

## 8. Exclusions and validity

- A session is invalid, excluded from rates and listed per arm, when:
  - the init check fails;
  - a file changes outside the checkout;
  - it times out;
  - it ends without a result message (7 of 60 did in step 0);
  - the replay disagrees with the final tree (v2 rules).
- An invalid session is retried once, and the dead attempt is kept.
- If more than 10% of an arm's sessions are invalid, comparisons involving that arm are
  reported as not interpretable.
- **Contamination check:** arms A and C show 0 `drift` processes in their traces.

## 9. Publication of failures

All results go into `eval/agent-ab/v3/results/`, whatever they show. That includes:
- failed hypotheses;
- a failed headroom gate;
- a stopped run and invalid sessions;
- the latency gate result;
- classifier disagreement.

Each gets the same prominence as a success.
- If H1 fails for a model, the README and docs/ACCURACY.md say that the consistency claim is
  unsupported for that model.
- If H2 fails, the same goes for the token claim.
- No endpoint is added, dropped or redefined after the first session, except by a dated
  amendment reported next to the results.

## 10. Decision rules stated in advance

- **Strong model.** Step 0 put strong control conformance at ≥ 90% (98%), so consistency is
  not claimed for strong models whatever H1 shows on the strong tier. The strong-tier test is
  still run and reported. Its positioning is cost (H2, H3) and exhaustiveness.
- **Cheap model.** If B on the cheap model reaches A on the strong model's conformance (the
  intervals overlap, or B is above) at lower total cost, that is the "cheap model plus Drift"
  statement. It is descriptive, not tested.

## 11. Predicted values (stated before any v3 run)

The predictions come from step 0. That data is in-sample and on easier tasks, so the
predictions for the far strata are guesses, and they are labelled as such.

| Quantity | Strong | Cheap |
| --- | --- | --- |
| A: conformance, same-directory stratum | 97% (step 0: 98%) | 95% (step 0: 96%) |
| A: conformance, far strata (guess) | 90% | 82% |
| Headroom gate: share of tasks where A fails on the cheap model | – | **15% (guess; 7% in step 0). The gate is more likely to fail than to pass.** |
| B − A conformance, pairs | +0 to +4 points | +3 to +12 points |
| B / A total tokens to a conforming solution | 0.85–1.05 | 0.80–1.05 |
| B − A exploration calls before the first edit (step 0 A median: 5.5 strong, 6 cheap) | −1 to −3 | −1 to −3 |
| C − A conformance | about half of B − A | about half of B − A |
| B − A turns (step 0 A median: 11 strong, 14 cheap) | −1 to +2 | −1 to +2 |
| Classifier against blind label agreement | ≥ 90% | ≥ 90% |

A missed prediction is published next to the result (§9).

## Amendments

(none yet. A1 will record B's PR sha for the delivered strings, the frozen Drift commit, the
task draw and the budget.)
