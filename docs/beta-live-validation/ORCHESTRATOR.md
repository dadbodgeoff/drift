# Orchestrator brief — Drift beta live-validation program

Hand this file to the agent that will run the program. It is self-contained.

---

## 1. What you are running

`docs/beta-live-validation/` holds 23 charters (`00-PREFLIGHT.md`, `01-*` … `22-*`), an
[INDEX.md](INDEX.md), and a [RESULTS-TEMPLATE.md](RESULTS-TEMPLATE.md). Each charter is a brief for
**one measurement job** against a live build of Drift. Your job is to run them through Claude Code
workflows, collect 23 results files under `results/`, and produce one synthesis.

**You are an orchestrator, not an auditor.** You do not run probes yourself. You do not read the
whole codebase. You dispatch, verify the shape of what comes back, and escalate.

**The charter is the source of truth for its own scope.** Do not re-plan a charter, do not merge
charters, do not "optimize" a probe list. If a charter looks wrong, record that as a note in the
synthesis and run it as written.

## 1b. Before anything: freeze the subject

Run [HARNESS.md](HARNESS.md)'s three setup steps first. They are not optional.

`main` advanced **24 commits during the hour these charters were written** (`3b5349ea` →
`699af646`), landing sprints S2 and S3. Twenty-three agents each measuring "current main" measure
twenty-three different products. Pin one commit, build it once, freeze it read-only, and hand every
agent the same `env.sh`.

Pin at **the commit the in-flight sprint branches fork from**. Today that is `origin/main` — S4 and
S6 are both branched at `699af646`. That makes the post-sprint re-run a clean diff against the audit
baseline rather than a comparison across two moving things.

**The charters were written against `3b5349ea` and are already partially stale.** Two known cases,
which every agent should treat as illustrative rather than exhaustive:

- Charter 11's headline suspect (S-11-1, the `session_not_trusted` schema mismatch) appears
  **already fixed** at `699af646` — S2/S3 landed typed reason enums, and `security_proof.rs:116`
  and `:2137-2142` now carry explicit comments separating the finding-level code from the
  proof-level enum, with a regression guard. Charter 11 should still run P-11-01…05, but expect
  **REFUTED**, and its job becomes proving the fix holds rather than reproducing the break.
- Charter 07's suspects overlap work already landed (`f19be489` "resolve what an accepted security
  helper's specifier actually means", `d6646d74` "ship resolved helper identity as a typed matcher
  field", `a3a54334` the barrel re-export closure). Re-derive the tier ladder from source before
  trusting the charter's §2 table.

**A suspect that turns out already fixed is a successful disposition, not a wasted probe.** Record
it `REFUTED` with the commit that fixed it. What the program must not do is assume a suspect still
holds and write a finding it never reproduced.

## 2. Rules that bind every agent you spawn

Copy these into every subagent prompt. They are the difference between a measurement program and a
pile of transcripts.

1. **No fixes.** No agent edits product source, updates a baseline JSON, or "unblocks" itself by
   patching. An agent that patches a bug has destroyed the measurement. Record and route around.
2. **A failure is a data point, not a stop.** When a probe fails, record it per
   [RESULTS-TEMPLATE.md §5](RESULTS-TEMPLATE.md) — including the **cause traced to `file:line`** —
   then continue to the next probe. Establishing cause is part of the job.
3. **Verbatim or nothing.** Paraphrased CLI output is inadmissible. Exit codes always recorded,
   including `0`.
4. **N=1 is not a benchmark.** Trial count and spread, or the number is discarded.
5. **State isolation.** Every mutating probe gets its own `--state-root` under a temp dir. Never
   reuse a state root across charters.
6. **Stay in your charter.** Do not investigate something another charter owns. Note it in §6 of
   your results file ("discovered surface not in the charter") and move on.

## 3. Model and effort policy

The expensive part of this program is not the charter count — it is fixture construction and cause
tracing. Stage by cost, not by charter.

| Stage | Model | Effort | Why |
|---|---|---|---|
| **Execute** — run the charter's probes, capture output, apply the oracle | Sonnet 5 | `medium` | Drives a CLI, builds fixtures, judges match/no-match. This is the workhorse and it is most of the tokens. |
| **Escalate** — cause-trace, only for probes that failed or diverged | Opus 5 | `high` | Tracing a symptom to `file:line` across 65k lines of Rust + TypeScript is where a cheaper model produces confident nonsense. Runs on the failures only, typically a small fraction of probes. |
| **Assemble** — write the results file from the structured probe log | Sonnet 5 | `low` | Mechanical transcription into a fixed template. |
| **Synthesize** — read all 23 results, answer the §6 beta-gate questions | Opus 5 | `high` | Runs once, at the end. Cross-charter contradictions are the whole value. |

**Do not use Haiku for the execute stage.** It is a false economy here. These charters require
building adversarial fixtures — a decoy module that resolves to an accepted specifier, a
100%-similarity rename crossing a glob boundary, a guard that is present but not dominating. A
subtly wrong fixture produces a measurement that *looks* valid and is not, and nothing downstream
catches it. Haiku is defensible for one narrow thing: mechanically executing a pre-written command
list and recording exit codes (charter 03's P-03-a/b/f sweep, charter 04's extract-and-run), **with
the fixtures already built by a Sonnet agent**. If you are not sure, use Sonnet.

**Five charters run their execute stage on Opus at `high`, not Sonnet:** `07`, `10`, `11`, `15`,
`16`. These are investigative rather than procedural — they reconcile a contradiction, hunt for a
false pass, judge whether a proof actually justifies a verdict, or attribute a performance curve to
a mechanism. Charter 15 in particular has to defend a *negative* result, which is a reasoning task,
not an execution task.

Everything else: Sonnet, `medium`.

## 4. Wave structure

The default workflow size guideline is ~15 agents. This program is 23 charters × 3 stages. **Run it
as sequential waves, not one fan-out** — this also matches the dependency order in
[INDEX.md](INDEX.md) and keeps you in the loop between phases.

| Wave | Charters | Note |
|---|---|---|
| **0** | `00-PREFLIGHT` | **Run by hand, or one agent, alone.** Everything else inherits its build, its `DRIFT_ENGINE_BIN`, its corpus shas, and its synthetic repos. Do not start wave 1 until its deliverables exist. |
| **1** | `22` | Alone, first. It establishes whether the gates can catch a regression at all — which is what tells you if the in-flight sprints will land safely. It also deliberately breaks CI on a scratch branch, so it must not overlap anything. |
| **2** | `01, 03, 04, 05, 17, 19, 20` | Surface, plumbing, state, protocol. Fully parallel. |
| **3** | `02, 06, 08, 09, 12, 13, 18, 21` | Depends on wave 2's state and fixtures. Fully parallel. |
| **4** | `16` | **Alone. Nothing else on the machine.** Any concurrent agent running `drift scan` on a 20,000-file repo contaminates every timing in the grid. |
| **5** | `07` (S5-relevant probes only: P-07-02, P-07-03, P-07-15) | Run now — it produces the pre-fix measurement that sizes sprint S5. Defer P-07-04 … P-07-09 until S4 lands. |
| **6** | `10, 11, 14, 15` + `07` remainder | **Hold until sprints S4/S5/S6 land.** These measure precision/recall, proof soundness, fingerprint stability, and the determinism fingerprint set — all of which those sprints change. Running them now measures code that is being replaced. |
| **7** | Synthesis | One Opus agent, all 23 results files. |

## 5. Machine contention — the thing that silently ruins this

Every agent shares one machine, one filesystem, and one `~/drift-falsification/repos` corpus.

- **Charter 16 runs alone.** Enforce this. Also confirm the machine's power/thermal state from
  charter 00 before its timings are believed.
- **Charter 22 runs alone.** It pushes deliberate breakage to a scratch branch and drives CI.
- **Charters that dirty the working tree** (`22`, and anything building fixtures in-repo) get
  `isolation: 'worktree'`. A dirty tree invalidates measurements program-wide —
  `scripts/worktree-contamination.mjs` exists because this has bitten before.
- **Corpus repos are read-shared.** No agent may commit into, clean, or `git checkout` inside
  `$DRIFT_EVAL_REPOS`. Each agent's fixtures go under its own temp dir.
- **State roots never collide.** One temp state root per probe, not per charter.

## 6. Workflow script shape

One workflow per wave. Pipeline the three stages so a charter's failures escalate as soon as *that*
charter finishes, rather than waiting on the slowest charter in the wave.

`executePrompt`, `causePrompt` and `assemblePrompt` are **yours to write** from the template in
§7 — they are referenced below, not defined. Everything else is executable as shown.

```js
export const meta = {
  name: 'drift-beta-wave-2',
  description: 'Execute beta live-validation charters, escalate failures, assemble results',
  phases: [
    { title: 'Execute', detail: 'one agent per charter, runs every probe' },
    { title: 'Escalate', detail: 'cause-trace each failed probe', model: 'opus' },
    { title: 'Assemble', detail: 'write the results file' },
  ],
}

const CHARTERS = ['01', '03', '04', '05', '17', '19', '20']   // wave 2

const PROBE_LOG = {
  type: 'object',
  required: ['charter', 'probes', 'measurements', 'suspects', 'not_covered'],
  properties: {
    charter: { type: 'string' },
    probes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'command', 'exit_code', 'observed', 'oracle', 'match'],
        properties: {
          id: { type: 'string' },
          command: { type: 'string' },
          exit_code: { type: 'integer' },
          observed: { type: 'string' },
          oracle: { type: 'string' },
          match: { enum: ['yes', 'no', 'blocked'] },
          artifact_path: { type: 'string' },
        },
      },
    },
    measurements: { type: 'array', items: { type: 'object' } },
    suspects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'disposition', 'evidence'],
        properties: {
          id: { type: 'string' },
          disposition: { enum: ['CONFIRMED', 'REFUTED', 'NOT_REACHABLE', 'INCONCLUSIVE'] },
          evidence: { type: 'string' },
        },
      },
    },
    discovered: { type: 'array', items: { type: 'string' } },
    not_covered: { type: 'array', items: { type: 'string' } },
  },
}

const CAUSE = {
  type: 'object',
  required: ['probe_id', 'cause', 'established', 'blast_radius', 'reproduction'],
  properties: {
    probe_id: { type: 'string' },
    cause: { type: 'string' },                  // must cite file:line, or say "cause not established"
    established: { type: 'boolean' },
    ruled_out: { type: 'array', items: { type: 'string' } },
    blast_radius: { type: 'string' },
    reproduction: { type: 'string' },
  },
}

await pipeline(
  CHARTERS,

  // Execute — Sonnet, medium. Opus/high for 07, 10, 11, 15, 16.
  (id) => agent(executePrompt(id), {
    label: `execute:${id}`, phase: 'Execute', schema: PROBE_LOG,
    model: ['07','10','11','15','16'].includes(id) ? 'opus' : 'sonnet',
    effort: ['07','10','11','15','16'].includes(id) ? 'high' : 'medium',
  }),

  // Escalate — Opus, high, ONLY on probes that did not match. Cheap when the charter went clean.
  async (log, id) => {
    const failed = (log?.probes ?? []).filter(p => p.match !== 'yes')
    if (!failed.length) { log.causes = []; return log }
    log.causes = (await parallel(failed.map(p => () =>
      agent(causePrompt(id, p), {
        label: `cause:${id}:${p.id}`, phase: 'Escalate', schema: CAUSE,
        model: 'opus', effort: 'high',
      })
    ))).filter(Boolean)
    return log
  },

  // Assemble — Sonnet, low. Pure transcription into the fixed template.
  (log, id) => agent(assemblePrompt(id, log), {
    label: `assemble:${id}`, phase: 'Assemble', model: 'sonnet', effort: 'low',
  }),
)
```

Charters 16 and 22 do not go in a `pipeline` with anything else — give each its own single-agent
workflow so nothing shares the machine with them.

## 7. Subagent prompt template

```
You are running CHARTER <NN> of the Drift beta live-validation program.

Read docs/beta-live-validation/<NN>-<slug>.md and execute it exactly as written. Also read
docs/beta-live-validation/00-PREFLIGHT.md §5 (evidence protocol) and RESULTS-TEMPLATE.md.

Do NOT read DRIFT-ARCHITECTURE-FORENSICS-REPORT.md. The charter already carries every citation
you need. Reading it will cost you your context for no gain.

Environment: DRIFT_ENGINE_BIN=<path>, corpus at <path>, synthetic repos at <path>,
commit under test <sha>. Working tree must be clean before you start; verify and report if not.

Binding rules:
- You do not edit product source. You do not update any baseline JSON. You do not fix anything.
- Every claim carries the command that produced it. Verbatim output only. Exit codes always.
- When a probe fails: record it, establish the cause to file:line, and CONTINUE. A charter that
  stops at the first failure has failed.
- Every mutating probe gets its own --state-root under a temp dir.
- Dispositon EVERY entry in the charter's §8 suspect list. None may be omitted.
- Long output goes to results/artifacts/<NN>/<probe-id>.txt, referenced by path, never pasted
  beyond 20 lines.
- Anything outside your charter's scope: note it, do not chase it.

Return the structured probe log. Your final output is data, not a report.
```

## 8. Your own checks before accepting a charter's result

- Every probe in the charter appears in the log, with a disposition. Missing probes are not
  "skipped", they are a rejected result — send it back.
- Every §8 suspect is dispositioned. `INCONCLUSIVE` must say what would distinguish it.
- Every `no`/`blocked` probe has a cause entry. `cause not established` is acceptable **only** with
  a list of what was ruled out.
- Every measurement carries a trial count.
- No results file claims full coverage without justifying it in §7.

## 9. Synthesis

One Opus agent, `high`, reading all 23 results files. It answers the nine beta-gate questions in
[00-PREFLIGHT.md §6](00-PREFLIGHT.md), and — more valuable than any single charter —
**reports every place two charters contradict each other.** A `pass` in one charter and a false
pass in another over the same mechanism is the finding this whole program exists to surface.

It does not vote on beta readiness. It presents the evidence against the nine questions and names
what is still unknown.

## 10. Cost control that actually works here

In descending order of savings:

1. **Never let a subagent read the forensics report or sweep the codebase.** The charter carries the
   citations. This is the single biggest lever.
2. **Escalate on failure only.** A clean charter pays zero Opus tokens. Do not run cause-tracing
   over probes that matched their oracle.
3. **Schema-forced output.** Structured returns, not prose. The assemble stage turns data into the
   template; the execute stage should not write English.
4. **Artifacts to disk, paths in context.** A 20,000-line scan dump goes in a file. The log carries
   its path.
5. **One wave at a time.** You read the wave's results before launching the next. Cheaper, and it
   means a systematic problem in wave 2 does not get repeated 8 times in wave 3.

## 10b. Harness invariants the orchestrator enforces

Every charter's agent opens with exactly two commands and nothing else:

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

`assert-env` refuses to proceed unless the frozen tree is at the pinned SHA, clean, read-only, and
its engine binary matches the freeze manifest's sha256. An agent that somehow points at the live
worktree, or at a subject someone re-froze mid-wave, stops instead of producing results that look
valid and are not.

Every command an agent runs goes through `run-probe`, never bare. That is what makes the ledger —
not the agent's context — the source of truth, and it is what makes charters resumable at probe
granularity.

Between waves, run `ledger-sweep`. It answers three questions mechanically, for zero model tokens:
which named probes never ran, which commands produced different exit codes in different charters,
and whether every probe in the program was run against **one** subject. That last check is the one
that catches the failure this whole freeze exists to prevent.

**Known tension: golden state roots vs. charter 15.** `golden-state.sh` bakes exactly one scan into
each golden state. If evidence selection flickers — the open question charter 15 exists to settle —
then every charter cloning a golden state inherits one sample of a distribution and reports it as
fact. Charter 15 must therefore scan fresh and must never use a golden state (its charter already
requires this). Charters 10 and 14 do use golden states, so if charter 15 confirms flicker, their
fixture-derived findings need re-reading in that light. Note it in the synthesis.

## 11. Program-level deliverables beyond the results files

The results files are not the only output worth keeping.

1. **Harvest the fixtures.** Charters 07, 10, 11, and 12 construct exactly the shapes the committed
   test suite is missing — a decoy module resolving to an accepted specifier, a 100%-similarity
   rename crossing a `path_globs` boundary, a guard present but not dominating, per-cell evasion
   variants. Every one of those is a regression test the repo does not have. Collect them under
   `results/artifacts/<NN>/fixtures/` with a one-line statement of what each pins, and hand the set
   to whoever owns `test/fixtures/`. A program that finds a gap and throws away the reproduction has
   done half the work.
2. **Re-run the preflight snapshot at the end** and diff it against charter 00's. Any difference is
   the program's own contamination and must be explained before the synthesis is trusted.
3. **A ledger-level contradiction sweep.** `jq` across `$DRIFT_BETA_LEDGER/*.jsonl` for the same
   command with different exit codes in different charters. Cheap, mechanical, and it catches
   harness contamination that no single charter can see.

## 12. Known gaps in the charter set

Run the program as written, but record these as scope notes rather than pretending they are covered:

- **Windows is untested.** `@drift/engine-win32-x64` ships in the release matrix, and nothing in the
  program exercises Windows path separators, CRLF diffs, or a case-insensitive filesystem. Charter
  01 P-01-11 asks for a second platform; if only macOS is available, the results file must say so
  rather than implying matrix coverage.
- **Error-message actionability has no owner.** It is sampled inside charter 20 (P-20-05) and
  charter 02, but no charter systematically asks "does this message tell the user what to do, and is
  the suggested action correct." Consider a short charter 23 if the synthesis shows it mattering.
- **Multi-developer / shared-state use is out of scope** by assumption, not by measurement. Drift is
  local-first; if that assumption is wrong for beta, nothing here tests it.
