# Harness — what to run before any agent starts

Six scripts in `harness/`. They exist to make 23 agents cheap, comparable, and unable to
contaminate each other.

## The problem each one solves

| Script | Solves |
|---|---|
| `freeze.sh` | **The subject moves.** `main` advanced 24 commits during the hour these charters were written. Twenty-three agents each measuring "current main" measure twenty-three different products, and the synthesis is meaningless. Also: this repo has ten worktrees on one object store, several of them active sprint branches — a worktree subject is a subject other agents can move. |
| `run-probe.sh` | **Output eats context.** `drift repo map --json` on calcom is megabytes. An agent that reads one into context has spent its budget on one probe. |
| `workspace.sh` | **Agents mutate shared state.** One corrupted corpus repo silently invalidates every later charter. |
| `golden-state.sh` | **Nine charters open by rebuilding the same state.** ~10 commands each, every one producing output an agent must read and reason about. |
| `facts.sh` | **Several charters re-derive the same enumerations.** |
| `quiet-lock.sh` | **Charters 15, 16 and 22 need the machine to themselves.** Anything concurrent invalidates them. |
| `machine-state` | **A benchmark on a throttling machine is a lie.** `--assert` refuses to start one. |
| `bench` | **Every charter says "n trials, median and p95"** and would otherwise get 23 subtly different implementations. |
| `charter-probes` | **Charters name units in five schemes** (P-05-01, P-03-a, L1..L10, C1..C7, S-NN-n). Completeness checking understands all of them once, here. |
| `validate-result` | **A results file is written by a model; the ledger is written by the process.** Where they disagree, the ledger is right. |
| `cost` | **The model policy is currently a belief.** This makes it a measurement. |
| `compare-runs` | **"The sprint fixed it" is a claim about two runs**, and needs both. |
| `selftest` | **A harness for a validation program that was never validated** is the failure this project exists to find. |

> Plumbing lives here. For the tools that decide whether a measurement is any *good* — labeled
> ground truth, confidence intervals, mutation-testing the eval suite, systematic evasion, and the
> report compiler — see **[EVAL-QUALITY.md](EVAL-QUALITY.md)**.

## Validate the harness first

```bash
./selftest
```

Nine probes covering timeout, redaction, elision, binary stdout, missing binaries, ledger schema,
and the sweep. It has already caught one real defect in this harness — a planted secret leaking
into agent context through the echoed command line, while the output itself was clean. A harness
for a validation program that was never itself validated is the failure this project exists to find.

## Order

```bash
cd docs/beta-live-validation/harness
./selftest                           # prove the harness before trusting it
./freeze.sh                          # pins origin/main, builds once, packs, freezes, writes manifest.json
source ~/drift-beta-freeze/env.sh
./facts.sh
./golden-state.sh                    # ~one scan per corpus repo, once, forever
```

Then every agent begins with exactly:

```bash
source ~/drift-beta-freeze/env.sh
```

and nothing else. No agent runs `pnpm install`, `pnpm build`, `cargo build`, `git pull`, or
`git checkout`.

## What freezing buys, concretely

- **One build.** `pnpm install` + `cargo build --release` + `pnpm build`, once, not 23 times.
  Everything downstream consumes `$DRIFT_ENGINE_BIN` and `packages/*/dist`.
- **One set of tarballs.** Charter 01 installs the artifact a user gets, instead of rebuilding.
- **`chmod -R a-w` on the subject.** An agent that tries to "just fix" something fails loudly
  instead of silently changing what everyone else is measuring. This enforces
  [ORCHESTRATOR.md §2.1](ORCHESTRATOR.md) rather than trusting it.
- **A stale-build check.** `freeze.sh` fails if any `.rs` is newer than the binary.
- **Recorded corpus shas.** A benchmark against `calcom@A` is not comparable to one against
  `calcom@B`; `corpus-shas.txt` is how anyone knows which they got.
- **A clean diff target.** Pinning at the commit the sprint branches fork from means a post-sprint
  re-run diffs against the audit baseline exactly.

## `run-probe.sh` — the main token lever

```bash
run-probe.sh 03 P-03-04 -- drift repo map --repo-root "$WS_REPO" --state-root "$WS_STATE" --json
```

The agent sees ~20 lines: exit code, duration, byte counts, head, tail, and two paths. The full
output is on disk. A structured row lands in `$DRIFT_BETA_LEDGER/03.jsonl`.

**The ledger, not the agent's context, is the source of truth.** An agent that dies at probe 40 of
54 loses nothing already probed — the assemble stage reads the ledger. That makes charters resumable
at probe granularity, which matters when a charter is six hours long.

It also makes cross-charter contradiction detection mechanical rather than a reasoning task: the
same command appearing in two charters' ledgers with two different exit codes is a harness
contamination alarm you can `jq` for, without spending an Opus token on it.

## `workspace.sh` — free isolation on APFS

```bash
eval "$(workspace.sh 12 P-12-01 --golden corpus-taxonomy)"
# WS, WS_REPO, WS_STATE, WS_DB now point into a private temp dir
```

`cp -c` is a copy-on-write clone on APFS: cloning a 20,000-file repo, or a fully scanned state root,
costs almost nothing in time and no bytes on disk until written. Isolation stops being a cost you
trade against, so there is no reason for any probe to share anything.

## Contention rules the orchestrator enforces

```bash
quiet-lock.sh acquire 16 && trap 'quiet-lock.sh release 16' EXIT
```

Charters **15** and **16** take the machine lock. Charter **22** runs alone because it pushes
deliberate breakage and drives CI. Everything else is free to run in parallel, because
`workspace.sh` means nothing is shared.

## Re-freezing after the sprints

When S4/S5/S6 land, do not mutate the freeze. Create a second one:

```bash
FREEZE_ROOT=~/drift-beta-freeze-post-sprints ./freeze.sh <new-sha>
```

Two frozen subjects, two results trees, one diff. That is the only honest way to claim a sprint
fixed something — and it is why the pre-sprint run of charter 07's decoy probes is worth doing now
rather than after.

## Mechanical oracles — why this is not just plumbing

The charters were originally written for an agent to run a command and *judge* whether the output
matched an oracle. `run-probe` lets the oracle be declared instead:

```bash
run-probe 13 P-13-01 --expect-exit 3 --refute-out "will not fail CI" -- drift check ...
```

That single line is charter 13's headline suspect — the state where the text says "this run exits 0
and will not fail CI" while the process exits 3 — expressed so that the harness decides, not the
model. Three consequences:

- **Cheaper.** The execute agent stops reasoning about output and just runs probes.
- **Harder to fool.** A declared oracle cannot be quietly reinterpreted after a surprising result.
- **Auditable.** `verdict` and the per-check detail land in the ledger, so `validate-result` can
  catch a results file that reads a FAIL as a pass.

A probe with no assertion is recorded `UNJUDGED` and counted separately, so exploratory probes stay
legitimate without being able to masquerade as passes.

## What the selftest has already caught

Four real defects in this harness, none of which were findable by reading it:

1. A planted secret leaking into agent context through the echoed command line, while the captured
   output was correctly redacted.
2. `ledger-sweep`'s completeness regex missing charter 03's lettered probe classes — charter 03
   would have silently reported "no spec".
3. `ledger-sweep` crashing on a `*.bench.jsonl` file sitting beside the probe ledgers, which would
   have taken out the between-wave sweep the moment charter 16 ran.
4. A wave plan that put charter 15 (exclusive) in a batch with three others, so wave 6 could never
   have run at all.

A fifth was a bad test rather than bad code: the selftest asserted `bench` must always certify a
number USABLE, when refusing on a throttling machine is the correct outcome.

## What is still unverified

Straight, so nobody assumes more than was checked:

- **Executed and passing: `run-probe`, `bench`, `ledger-sweep`, `validate-result`, `charter-probes`,
  `cost`, `replay`, `machine-state`, `selftest`, and the workflow's dispatch policy.** 80 checks
  across 16 tools, including a demonstration that `validate-result` catches a fabricated exit code
  by cross-referencing the ledger.
- **`freeze.sh`, `golden-state.sh`, `workspace.sh`, `facts.sh`, `quiet-lock.sh` are syntax-checked
  only.** `freeze.sh` clones and runs a full release build, so it needs a real invocation with a
  chosen SHA. Run it once by hand and read its output before launching wave 0 — and if it fails,
  that is charter 00's first finding, not a reason to improvise around it.
- **`cost` records spend but nothing calls it automatically.** The orchestrator must invoke
  `cost record <charter> <stage> <model> <effort> <in> <out> [secs]` as each subagent returns; the
  workflow runtime has the numbers but does not write them here on its own.
- **`machine-state` reports this machine is currently unfit for benchmarking** — on battery, load
  12.3 across 10 CPUs, 2 GB free. Charter 16 cannot run until that is resolved. That is a real
  finding from the harness, not a harness bug.
