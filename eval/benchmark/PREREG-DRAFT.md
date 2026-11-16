# Agent benchmark: pre-registration (DRAFT)

> **This is a draft. It registers nothing.** It becomes a pre-registration only when the owner has
> settled every decision in §10, dated it, renamed it `PREREG.md`, and committed and pushed it
> **before** the task-draw seed exists (§9, step 2). Until then, every number and rule below is a
> proposal. Once registered, nothing in it changes except by a dated amendment at the end that says
> what changed and why; amendments are published next to the results.

- **What it is for.** `docs/v2/PLAN.md`, "Agent benchmark (launch proof)", and the success metric
  "Agent violations per task, with versus without Drift: published reduction". The roadmap
  (`docs/v2/ROADMAP-MAP-TO-ENFORCEMENT.md` §5 sprint 6 and §6) puts it, with the held-out release
  gate, between the private beta and any public launch.
- **Status.** Harness written and dry-run tested (`README.md`). No task drawn, no agent run, nothing
  spent.
- **Registered by:** _(owner)_ **Date:** _(YYYY-MM-DD)_ **Commit:** _(sha of the commit that adds
  `PREREG.md`)_
- **Model and agent names.** This file names no model and no agent product. The operator's config
  supplies the model identifier and the agent command; the run manifest records them, with the
  agent's own version output and the Drift binary's version and sha256.

## 1. The question

On tasks rebuilt from real merged pull requests, does a coding agent that has Drift's hooks leave
fewer convention violations in its change than the same agent without Drift, without solving fewer
tasks? And how much of any effect comes from the exported instructions file alone, compared with a
plain generated instructions file?

## 2. Arms

Every arm runs the same task prompt, agent and agent version, model, tool set, timeout, budget,
environment and machine. The harness gives each run a fresh working copy at the task's base
commit, a fresh HOME and TMPDIR, and commits whatever the arm adds as one commit, "Project setup",
with a fixed identity and date, in every arm (empty in arm 1). The agent cannot see which arm it is
in from the commit, the path or the environment; it can see the files the arm adds, which is the
treatment.

| # | Arm | What the working copy has | `drift` on the agent's PATH |
| --- | --- | --- | --- |
| 1 | `none` | The repository as it is at the base commit. | No |
| 2 | `plain` | A plain generated instructions file, appended to the instructions file (default `AGENTS.md`) between neutral markers. Made once per task at its base commit, before any run, by the procedure of decision D2, and frozen. | No |
| 3 | `agents-md` | `drift init`; the accept rule (D1); `drift export agents-md --write AGENTS.md`. The `.drift/` policy and `drift.lock` are committed, as a team would. No hooks, no MCP server. | D3 (default No) |
| 4 | `hooks` | Arm 3's setup (D4), plus Drift's hook wiring for the agent under test, built from `integrations/` and placed where that agent reads project hooks, as the integration ships it (hooks, skill, and the `drift mcp` server entry). | Yes (the hooks run `drift hook ...`) |

- The scripts are `arms/none.sh`, `arms/plain.sh`, `arms/agents-md.sh`, `arms/hooks.sh`. They run
  only the commands documented in `docs/wiki/Command-Reference.md` and `Using-Drift-with-Agents.md`.
- The harness refuses a run where `drift` is on the PATH of an arm that must not have it, and a run
  whose working copy can reach the merge commit.
- Arms 3 and 4 run `drift init` on every run. The policy file's sha256 is recorded per run; the
  manifest lists any task whose runs got different policies (Drift is meant to be deterministic, so
  this should be empty).
- The number of accepted conventions per task (from each run's `census.json` and the accept rule) is
  published. A task where Drift proposes nothing still has arms 3 and 4 differ from arm 1 by the
  facts Drift gives (the session brief, cards, the "first stop" line).

## 3. Tasks

`TASKS.md` is the procedure; this section registers its parameters.

- **Repositories:** 5 (D6). **Tasks:** 25, 5 per repository (the plan says 20 to 30; D7).
- **Query:** merged pull requests merged inside the registered date window, 10 to 400 changed
  lines, 1 to 12 files, at least one non-test code file in a language Drift reads (TypeScript,
  JavaScript, Python), exactly one linked issue of at least 80 characters opened before the merge,
  no diff in the issue, no bot author, no revert, release, dependency or chore title.
- **Draw:** the eligible pull requests of each repository in the order of
  sha256(seed, "draw", repository, number); the first 5 are tasks, the next 2 are reserves; a
  repository with fewer than 5 is filled from the other repositories' leftovers in the same order.
- **Prompt:** the issue's title and body, verbatim, after the stripping rule removes links and
  references to the fix, in one fixed sentence of framing identical in every arm.
- **Freezing**, before any run: the technical check (`harness.py freeze --tests`), the reference
  diff, the test command, the plain instructions file, and the graders' convention list per task
  (RUBRIC.md step 1). All are committed with the task records.

## 4. Outcomes

Per run, each of the two graders scores the run's final diff with `RUBRIC.md`. The run's value of
every graded measure is the mean of the two graders.

**Primary outcome: V, listed-convention violations.** The number of the task's frozen conventions
the grader marks `violated` in the run's diff. Conventions the change does not reach are `na` and
count 0.

**Co-primary guard: S, task success.** 1 when the grader scores "does what the issue asks" 2 or 3
(of 0 to 3), else 0.

**Secondary outcomes**
- V for the other pairs of arms (§6).
- O: other clear convention violations not on the list (count).
- B: breakage (0 to 3), Z: size and stray edits (0 to 3).
- Tests pass rate, where the task has a test command (mechanical, not graded).
- V per 100 changed lines.
- Suppressions: added `drift-ignore` comments (mechanical; removed from packets for blinding).
- Wall time and the cost the agent wrapper reports (descriptive).

Transcripts are published but not graded: they carry too many traces of the arm to blind reliably.

## 5. Unit of analysis, sample size, and what it can and cannot detect

**Unit of analysis: the task.** The arms are compared within a task (paired). The 3 runs of a
(task, arm) are repeated measures of one quantity and are averaged; they are never counted as
independent observations. With 25 tasks the analysis has n = 25 pairs, not 75 or 300.

**Why 3 runs do not buy much.** The spread of the task-level difference between two arms is
sd(d)² = σ²(task × arm) + 2·σ²(run) / r, where r is runs per arm. More runs shrink only the second
term. Whether Drift helps more on some tasks than others (the first term) is reduced only by more
tasks.

**What 25 tasks can detect.** By simulation with a fixed seed (`power.py`, output in
`power-v1.txt`, 2,000 simulated studies per point), for the registered test (exact two-sided
Wilcoxon signed-rank, α = 0.05) at 80% power:

| Tasks | Smallest detectable effect, dz | Same, at the Holm worst case α = 0.0167 |
| --- | --- | --- |
| 20 | 0.68 | 0.82 |
| 25 | 0.59 | 0.70 |
| 30 | 0.54 | 0.64 |

dz is the mean task-level difference divided by its standard deviation across tasks. In plain
words: with 25 tasks the benchmark reliably detects an effect only when the average reduction is
at least about 0.6 times the task-to-task spread of the reduction. That is a moderate-to-large
effect. Smaller effects will usually not reach significance, and a non-significant result will
not show that there is no effect.

In violation counts (count model in `power.py`: per-task rates vary widely, Poisson runs, 3 runs
per arm), the smallest relative reduction detected with 80% power at 25 tasks:

| No-Drift violations per run (mean) | Smallest detectable reduction |
| --- | --- |
| 0.25 | about 80% |
| 0.5 | about 70% |
| 1 | about 50% |
| 2 | about 40% |
| 4 | about 30% |

(A 10-point grid, so "about". At 20 tasks the figures are 90%, 70%, 60%, 40%, 30%; at 30 tasks
80%, 60%, 50%, 40%, 30%.)

**The floor is the real risk.** The earlier A/B's step 0 (`eval/agent-ab/v3/PREREG.md` §1) found
the no-Drift arm already followed the conventions checked 96% to 98% of the time on build-set
tasks. If agents without Drift leave about 0.25 to 0.5 listed violations per run, this benchmark can
only detect reductions of 70% or more. That is why D8 offers a headroom check before the full run.

**Success (H2).** Non-inferiority on S with 25 tasks, 3 runs, and the arms truly equal (base success
spread uniformly over 20% to 90% across tasks):

| Margin | Chance of showing non-inferiority |
| --- | --- |
| 10 points | 0.37 |
| 15 points | 0.61 |
| 20 points | 0.84 |

At a 15-point margin, a true 10-point drop in success would still be called non-inferior 16% of
the time, and a 5-point drop 36% of the time. **This benchmark cannot show that success is
unchanged to within less than about 15 to 20 points.** Small costs to success will not be seen.

## 6. Analysis, fixed in advance

`grade.py join` implements all of this. It is deterministic given the grades and the seed.

1. **Run values.** For each graded run and each grader: V, S, R (resolves), B, Z, O. The run's value
   is the mean of the two graders.
2. **Task-arm values.** The mean over that (task, arm)'s graded runs.
3. **H1 (primary).** d(t) = V(hooks, t) − V(none, t) over the tasks with both. Exact two-sided
   Wilcoxon signed-rank; zero differences dropped (Wilcoxon's rule); tied absolute differences share
   midranks; the exact null distribution is enumerated. **H1 is supported if and only if p < 0.05 and
   the mean of d is below 0.** Also reported: the mean and median of d, a 95% percentile bootstrap
   interval (10,000 resamples of tasks, seeded), and the counts of tasks better, worse and tied.
4. **H2 (co-primary guard).** e(t) = S(hooks, t) − S(none, t). **Non-inferior if and only if the
   one-sided 95% t lower bound of the mean of e is above −margin** (D9; default 15 points).
5. **The launch statement.** "With Drift's hooks, agents left fewer convention violations without
   solving fewer tasks" is made only if H1 is supported and H2 is non-inferior. H1 alone allows only
   "fewer violations; whether success changed was not settled". Neither allows a percentage claim
   beyond the measured mean with its interval.
6. **Secondary comparisons**, all on V with the same test as H1, two-sided, Holm-adjusted together
   at α = 0.05 (five pairs). A secondary hypothesis is supported when its adjusted p is below 0.05
   and the mean difference is in the stated direction:
   - H3: agents-md has fewer V than none.
   - H4: hooks has fewer V than agents-md (the hooks add something beyond the file).
   - H5: agents-md has fewer V than plain (Drift's file beats a generic one).
   - Also in the family, with no direction registered: plain against none, hooks against plain.
7. **Failed and timed-out runs.**
   - A run that timed out, crashed, stopped at its budget, or left an empty diff is **kept** and
     graded as it stands. An empty diff has every convention `na`, so V = 0 and S = 0.
   - Because doing nothing scores V = 0, H2 is the guard against an arm that "wins" by doing less.
   - Two sensitivity analyses are also reported: V on successful runs only, and V excluding
     non-`ok` runs.
8. **Harness errors** (the harness, not the agent, failed: the working copy, the arm script, a
   check) are retried once with the first attempt kept. A run that fails twice is not graded and is
   listed. A (task, arm) with no graded run drops that task from the comparisons using that arm,
   and is listed.
9. **Agreement.** Cohen's κ on the convention verdicts and on S; quadratic-weighted κ on R, B and Z;
   exact agreement for each. The bar is 0.6 (PLAN.md, "Evaluation harness"). Below the bar, the
   result is published with that label, and the per-grader analyses (sensitivity) are given
   beside the mean. There is no re-grading after the key is opened.
10. **Blinding check.** Each grader guesses the arm of every packet, or says they cannot tell. The
    share right among guesses is compared with chance (1 in 4) by an exact binomial test, per
    grader.
11. **Training-recall check.** For each run, the similarity of its added lines to the real change's
    added lines (difflib ratio). H1 is repeated on the tasks whose no-Drift runs have median
    similarity below 0.5 (the `eval/agent-ab/v3` precedent).
12. **Other sensitivity analyses:** V per 100 changed lines; O; V by each grader alone.

## 7. Exclusions, decided before any run

- **Tasks.** A drawn task is replaced, before any run, only when `harness.py freeze --tests` reports
  a problem: a commit missing from the mirror, the base not the first parent of the merge, the
  changed files not matching the export, or the test command failing at the merge commit. The
  replacement is the next reserve of the same repository in seeded order. Every replacement is
  listed with its reason. No task is replaced or dropped after the first agent run.
- **Runs, not graded:** a harness error twice (§6.8).
- **Runs never excluded for their outcome:** timeouts, agent errors, budget stops, empty diffs.
- **Runs flagged, kept, and analysed both ways:** a transcript that names another run's results
  directory (`transcript_names_other_runs`), or a `drift` invocation in arm 1 or 2 (contamination).
- **If more than 10% of an arm's runs are harness errors**, comparisons involving that arm are
  published as not interpretable.

## 8. Published whatever the result

Into the results directory and the accuracy page, with the same prominence for a loss as for a win:

- this file and every amendment;
- the harness at the commit used, with the run manifest (versions, hashes, seed, run order);
- the task records, the selection record (every pull request considered and why it was excluded)
  and the reserves used;
- every run's diff, transcript, logs and result, including harness errors;
- both graders' grades, the packet key, agreement and the blinding check;
- the analysis output, including the per-task differences;
- **every task where an arm with Drift did worse than the arm without it**, by name and with its
  diffs (`tasks_where_hooks_lost_on_V` in the analysis, and the same for each secondary pair);
- the predictions of §11 next to what happened;
- the cost as spent, and any stop at the budget.

## 9. Order of work

1. The owner settles §10, writes §11, dates and commits this file as `PREREG.md`.
2. The seed is made after that commit and recorded in amendment A1:
   `drift-bench-v1:<registration commit sha>:<32 hex characters from the operating system's random
   source>`. Nobody chooses it.
3. The operator exports the merged pull requests of the 5 repositories (TASKS.md, "The export
   format") and commits the exports' sha256 in A1.
4. `select_tasks.py draw` with the registered spec and seed; `select_tasks.py verify`.
5. Freezing (TASKS.md): `harness.py freeze --tests`; test commands; the plain instruction files;
   the graders' convention lists. Committed before any agent run.
6. Optional headroom check (D8).
7. `harness.py run`. Then `grade.py packets`; the key goes to someone who is not a grader.
8. Calibration on practice packets that are not in the study (RUBRIC.md step 2), then grading.
9. `grade.py join`; publication (§8).

## 10. Decisions the owner must make before registering

| # | Decision | Default in this draft | Why it matters |
| --- | --- | --- | --- |
| D1 | Which proposals count as accepted in arms 3 and 4 | Every default-tier proposal, in advise mode, by rule (`accept.rule: default-tier`) | Agents see only accepted conventions. A rule is reproducible and nobody picks; a non-builder maintainer's list per repository is closer to real use but is a choice made per repository. |
| D2 | How the plain instructions file is made | The agent under test's own "generate instructions for this repository" command, run once per task at the base commit, before any run, outputs frozen | It is the plan's "/init" arm. If the agent has no such command, a fixed generic prompt for writing one must be registered. |
| D3 | Is `drift` on the PATH in arm 3 | No | The exported block tells the agent to run `drift card`. Without the binary that line cannot be followed, which handicaps arm 3. With it, arm 3 is "file plus command-line tool". |
| D4 | Does arm 4 include the AGENTS.md block | Yes, so H4 isolates what the hooks add | The plan says "Drift hooks". Without the block, arm 4 against arm 3 compares two deliveries rather than adding one. |
| D5 | Advise or block mode | Advise | Block mode tests the end-of-turn stop. The beta runs advise only. |
| D6 | Which 5 repositories, and by what rule | At least 3 that were never in any Drift development or evaluation set, chosen by a stated rule before any export; none from the blind or held-out sets | Repositories Drift was tuned on favour it (§12). |
| D7 | Number of tasks | 25 | 30 tasks lowers the detectable dz from 0.59 to 0.54, at 60 more runs. |
| D8 | Headroom check before the full run | Yes: arm 1 once per task, graded by graders who do not grade the study. If the mean V is below 0.5 per run, stop and decide, by amendment and before any other arm runs, whether to proceed (at 30 tasks) or to stop and publish the check. Tasks are never re-drawn because of it. | §5: at low base rates the benchmark can only find very large effects. |
| D9 | Non-inferiority margin for success | 15 points | §5: 61% chance to show it when the arms are equal at 25 tasks; 20 points gives 84% but allows a larger loss. |
| D10 | Per-run timeout and budget, and the total budget | 30 minutes; the per-run budget the wrapper enforces; the total from the plan (§README) | The total must be set before any run; a stop at the budget is published. |
| D11 | Who grades, and who holds the key | Two people who did not build Drift, did not pick the repositories, and do not see the key; the key held by a third person until both grade files are in | PLAN.md: never the builder. |
| D12 | The agent and model, and their pinned versions | Operator config | Results hold for that agent and model only. |
| D13 | Network access of the agent during runs | Only what the agent needs to reach its model; the repository host blocked | Stops the agent from reading the real pull request. |

## 11. Predictions (to be written by the owner before registering)

Fill in, before registering, the expected value with a range for: mean V per run in arm 1; the
difference hooks − none in V; agents-md − none; S per arm; the share of tasks where hooks loses;
κ on convention verdicts; the blinding guess rate. A missed prediction is published beside the
result.

## 12. Threats to validity, and what is done about each

| Threat | Effect | Mitigation | What remains |
| --- | --- | --- | --- |
| Tasks drawn from repositories Drift was developed against | Drift's mining was tuned on them; it favours arms 3 and 4 | D6: at least 3 of 5 repositories new to Drift; every result reported per repository and split into "developed against" and "new" | With 2 new repositories of 5 tasks each, the split is descriptive only |
| The agent may have seen the original pull request in training | Arms converge on the real change; less room for Drift | Tasks merged after a registered date (ideally after the model's training data); the similarity check (§6.11) with H1 repeated on low-similarity tasks; the repository host blocked during runs (D13) | The training cutoff of a hosted model is not always known |
| Graders can sometimes guess the arm | Expectation bias in grading | Arm traces stripped from packets (RUBRIC.md, "Blinding"); transcripts not graded; packets in a different seeded order per grader; graders guess the arm and the guess rate is published | A change in style that Drift caused cannot be stripped; it is the treatment |
| The builder chose the tasks | Favourable selection | Tasks come from a registered query and a seeded draw; the seed is made after registration; every excluded pull request is listed with its reason; reserves are used only by a mechanical rule | The builder still writes the query; it is registered before any export |
| The builder chose the repositories | Favourable selection | D6: a stated rule, registered before any export | Five repositories cannot represent all codebases |
| The convention list could follow Drift's view | Measures agreement with Drift rather than with the repository | Graders list conventions from the real change and the repository at the base commit, before any run, and never see Drift's output for it (RUBRIC.md step 1) | Graders may still list what is easy to see |
| Doing less looks like fewer violations | An arm wins by changing less | H2 guard; V on successful runs; V per 100 changed lines | — |
| The accept rule is not a real team | A team would reject some proposals and add others | D1 stated; accepted conventions per task published | The benchmark measures Drift with that rule |
| Hook wiring is specific to one agent | Arm 4 is defined per agent | The harness is agent-neutral; the wiring is an input recorded in the manifest | Results for arm 4 hold for the agent tested |
| One agent and one model | Results may not transfer | Versions pinned and published | A second agent or model is a second registration |
| Sequential runs over days | Model or service drift over time | Seeded random run order across tasks, arms and runs; versions recorded at the start and checked at the end | A provider can change a model behind a fixed identifier |
| Runs can read each other's results | Contamination | Working copies apart from results; a fresh HOME per run; working copies deleted after each run; the check on transcripts naming other runs. Full isolation needs the operator's sandbox (one container per run) | The harness cannot stop a process from reading what its user can read |
| Small sample | Moderate effects only (§5) | Stated in advance; no claim beyond the interval | — |

## Amendments

(none yet. A1 records the seed, the export hashes, the Drift commit and binary hash, the agent and
model identifiers as configured, and the total budget, before any run.)
