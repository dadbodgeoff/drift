# Agent benchmark

The launch proof `docs/v2/PLAN.md` asks for ("Agent benchmark (launch proof)"): tasks rebuilt from
real merged pull requests, four arms (no Drift; a plain generated instructions file; Drift's
exported `AGENTS.md` only; Drift's hooks), three runs per arm, two blind graders, hypotheses
registered first, everything published.

**State: harness and pre-registration draft written; nothing registered, drawn or run.** No agent
has been run and nothing has been spent. The harness has been tested end to end with `--dry-run` on
a throwaway git repository (below).

| File | What it is |
| --- | --- |
| `PREREG-DRAFT.md` | The pre-registration, as a draft for the owner: hypotheses, outcomes, sample size and power, the analysis, exclusions, publication, threats, and the decisions only the owner can make (§10) |
| `TASKS.md`, `tasks/schema.json` | How tasks are selected and frozen; the export format; the task record |
| `RUBRIC.md` | The grading rubric and what blinding removes |
| `select_tasks.py` | The seeded draw from local exports of merged pull requests (no network) |
| `harness.py` | Runs every (task, arm, run); `freeze`, `plan`, `run`, `status` |
| `arms/*.sh` | The four arms' setup scripts |
| `grade.py` | Blind packets out; grades in; agreement and the registered analysis |
| `power.py`, `power-v1.txt` | The power simulation behind PREREG §5, and its output |
| `benchlib.py` | Seeded randomness, the tests (exact Wilcoxon, t bound, bootstrap, Holm), κ, the schema check |
| `dryrun/` | The stand-ins `--dry-run` uses for the agent and for drift |
| `config.example.json` | The operator's config, with every field explained by its placeholder |
| `tests/` | Unit tests and the end-to-end dry run |

Python 3 standard library only. Run everything with `python3 -I`.

## Running it

Do these in order; PREREG-DRAFT.md §9 is the authority.

1. **Register.** The owner settles PREREG-DRAFT.md §10, writes §11, dates it and commits it as
   `PREREG.md`. Then the seed is made and recorded (§9, step 2).
2. **Mirror the repositories** locally (`git clone --mirror`), and **export their merged pull
   requests** in the format of TASKS.md. This is the only step that needs the network; nothing here
   does it.
3. **Draw**, then verify:
   ```bash
   python3 -I eval/benchmark/select_tasks.py draw --spec SPEC.json --seed "$SEED" --out TASKSET exports/*.json
   python3 -I eval/benchmark/select_tasks.py verify --out TASKSET exports/*.json
   ```
4. **Config.** Copy `config.example.json` outside the repository and fill it in: the mirrors, the
   agent command template, the agent's version command, the model identifier, the drift binary, the
   hook wiring for the agent under test, the plain instruction files, the timeout and budgets.
   - **The agent command** is a list. The harness fills `{workdir}`, `{prompt_file}`,
     `{transcript}`, `{usage}`, `{run_dir}`, `{timeout_s}`, `{budget}`, `{model}` and `{home}`, and
     runs it in the working copy with a minimal environment: PATH from `agent.path`, a fresh HOME
     and TMPDIR, `agent.env`, and the variables named in `agent.pass_env` (API keys go there, by
     name; never in the config).
   - **The wrapper** is the operator's: it must start the agent non-interactively on the prompt
     file, enforce the budget (and exit with a code from `budget_exit_codes` when it stops for it),
     write the agent's transcript to `{transcript}`, and optionally write `{"cost": <number>}` to
     `{usage}`. `total_cost_limit` stops the harness once the reported costs reach it.
5. **Freeze**: `python3 -I eval/benchmark/harness.py freeze --config CONFIG --tests`, then the test
   commands, the plain instruction files and the graders' convention lists (TASKS.md, "Freezing").
   Commit them.
6. **Check the plan**: `harness.py plan --config CONFIG` prints the seeded run order.
7. **Run**: `harness.py run --config CONFIG`. It runs one at a time, resumes where it stopped
   (finished runs are skipped; an attempt directory left by an interrupted run is moved aside to
   `a1.stale-1` and the attempt starts empty, so its transcript and cost are never reused), and writes `RUNS_ROOT/manifest.json` (versions, hashes, seed, order,
   status counts) and `RUNS_ROOT/runs/<run id>/` per run (`result.json`, `agent.diff`, `full.diff`,
   `setup.diff`, `transcript.jsonl`, `arm.log`, agent stdout and stderr, test output).
   `--limit N` stops after N runs, for the headroom check.
8. **Packets**:
   `python3 -I eval/benchmark/grade.py packets --config CONFIG --seed "$GRADE_SEED" --out PACKETS --key-out KEYDIR/key.json`.
   Give `PACKETS/g1` and `PACKETS/g2` to the graders and the key to someone who is not a grader.
9. **Join**: `grade.py join --config CONFIG --packets PACKETS --key KEYDIR/key.json --grades g1.json
   g2.json --out analysis.json [--margin 0.15]`.

### The dry run

```bash
python3 -I eval/benchmark/harness.py run --config CONFIG --dry-run
```

executes everything except the agent and Drift: the agent command becomes `dryrun/fake_agent.py`,
which appends one function to a source file, and drift becomes `dryrun/fake_drift.py`, which writes
small fixed `.drift/` files and an `AGENTS.md` block. The repository's own test command still runs.
It needs a config with `seed`, `tasks_dir`, `runs_root` and `mirrors` only.

The end-to-end test does all of it on a throwaway repository, with 3 tasks × 4 arms × 2 runs, one
task that fails and one that times out:

```bash
BENCH_SCRATCH=/a/scratch/dir python3 -I -m unittest discover -s eval/benchmark/tests
```

It checks: the run statuses (ok, agent error, timeout with the process group killed); the setup each
arm made and nothing else; that the agent's diff excludes the arm's setup; that the working copies
are gone afterwards; that a second `run` is a no-op; that no packet contains "drift", an
instructions file name, the name "agents-md", the setup commit message or a results path; that packets are
byte-identical given the seed and ordered differently per grader; and that `join` computes the
analysis and refuses an incomplete grades file. It takes about 40 seconds and under 3 MB.

## What it costs

From the plan: **about 360 runs, roughly $500 to $1,500**, which is about $1.40 to $4.20 per run.
At this draft's 25 tasks × 4 arms × 3 runs = 300 runs, that is about $420 to $1,250, plus the
optional headroom check (25 runs, about $35 to $105) and making the plain instruction files (one
agent call per task). At 30 tasks it is the plan's 360 runs. These are the plan's figures, not
measured: the per-run cost depends on the agent and model the owner picks, and should be checked on
the headroom runs before the budget is fixed (D10).

Other costs the plan does not price:

- **Machine time.** Runs are sequential (shared machine). At 10 to 15 minutes a run (the agent, plus
  `drift init` on arms 3 and 4, about 25 seconds on a mid-sized repository, plus tests), 300 runs
  take about 50 to 75 hours.
- **Grader time.** Listing conventions: 25 tasks × 2 graders × about 30 minutes, about 25 hours.
  Grading: 300 packets × 2 graders × 6 to 10 minutes, about 60 to 100 hours. This is the largest
  cost, and the plan asks for people who are not the builder.

## What is not built

- **Exports.** Nothing fetches pull requests or issues; the operator writes the exports (TASKS.md).
- **The agent wrapper.** The harness is agent-neutral on purpose; the wrapper that starts a
  particular agent non-interactively, enforces its budget and writes its transcript is the
  operator's.
- **The hook wiring for a particular agent.** `arms/hooks.sh` copies the files the config names
  into the working copy. Building them from `integrations/` for the agent under test (and the MCP
  server entry and skill, if that agent reads them from the repository) is the operator's, and the
  files are recorded by hash in the manifest. A plugin that installs into the agent's user
  configuration would need `agent.home_template`, which is copied into each run's fresh HOME.
- **Isolation stronger than separate directories.** Each run has its own working copy, HOME and
  TMPDIR, apart from the results, and they are deleted after the run; transcripts naming another
  run's results are flagged. The harness cannot stop a process from reading files its user can
  read: for the real run, the wrapper should start each agent in its own container with only its
  working copy mounted and only its model's host reachable (PREREG D13).
- **Parallel runs.** One at a time by design.
- **Adjudication by a third grader.** Not in the registered analysis; agreement below the bar is
  published as such (PREREG §6.9).
- **Any number from a real run.** The power figures are simulations under stated assumptions.
