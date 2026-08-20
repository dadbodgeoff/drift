# CHARTER 00 — Preflight

**Run once, by a human or a single agent, before any other charter starts.** Every other charter
assumes this one completed and its outputs are on disk.

---

## 1. Objective

Establish one build, one environment, and one evidence protocol that all 22 remaining charters
share, so that a number produced by charter 16 and a number produced by charter 10 are comparable.

## 2. Build the thing under test

```bash
git rev-parse HEAD && git status --porcelain
```

The working tree **must be clean**. A dirty tree invalidates every measurement in the program —
`scripts/worktree-contamination.mjs` exists precisely because this has bitten before. Record the
sha; every results file repeats it.

```bash
pnpm install --frozen-lockfile
pnpm build:engine
pnpm build
```

Then pin the engine binary for every subsequent invocation:

```bash
export DRIFT_ENGINE_BIN="$PWD/target/release/drift-engine"
```

Confirm nothing in `crates/` is newer than the binary:

```bash
find crates -name '*.rs' -newer target/release/drift-engine
```

Zero results, or the build is stale and every engine-side measurement is wrong.

## 3. Environment record

Capture into `results/artifacts/00/environment.txt`:

- `uname -a`
- `node --version`, `pnpm --version`, `rustc --version`, `cargo --version`
- `sqlite3 --version` if present
- free disk on the volume holding the state root, free RAM
- whether the machine is on AC power and whether CPU frequency scaling is active — **this matters
  for charter 16 and nothing else, but it matters there completely**
- `git rev-parse HEAD`, `git log --oneline -5`

## 4. Corpora

Three distinct bodies of code get used. Do not confuse them.

| Corpus | Location | Used by | Note |
|---|---|---|---|
| Committed fixtures | `test/fixtures/` (92 dirs) | 06, 07, 08, 10, 11, 12 | Purpose-built, small, ground truth known |
| Ledger canaries | `test/canary/` | 10, 22 | `convention-cell-ledger.json` (18 cells), `glob-parity.json` |
| External eval repos | `$DRIFT_EVAL_REPOS`, default `~/drift-falsification/repos` | 10, 15, 16 | Real repos: calcom, dub, formbricks, midday, openstatus, papermark, taxonomy |

Confirm the external corpus is present and record each repo's own commit sha. A benchmark against
`calcom@<sha-A>` is not comparable to one against `calcom@<sha-B>`; charter 16 will be re-run and
the shas are how anyone knows whether a change is Drift's or the corpus's.

Charter 16 additionally needs **synthetic repos at controlled file counts** (500 / 1,000 / 5,000 /
20,000). Generate them once here, deterministically, and record the generator so the same repos
can be rebuilt:

```bash
# store generator at results/artifacts/00/gen-synthetic-repo.mjs and record its sha256
```

## 5. Evidence protocol — binding on every charter

1. **Every claim carries a command.** A statement with no command that produces it is not a
   finding, it is an opinion, and it does not go in a results file.
2. **Verbatim output or nothing.** Paraphrased CLI output is inadmissible. Truncate with an
   explicit `[… N lines elided …]` marker; never silently.
3. **Exit codes are always recorded**, including `0`. Drift's exit vocabulary is
   `0` pass · `1` operational error · `2` blocked · `3` refused (fail-closed). A charter that
   records "it worked" without the code has recorded nothing.
4. **Text and JSON are two surfaces.** Where a command supports `--json`, run both and compare.
   The audit found at least one command (`doctor`, §20h) whose two renderers are independently
   authored; assume divergence is possible everywhere until a probe shows otherwise.
5. **State isolation.** Each probe that mutates state uses its own `--state-root` under a temp
   directory. Cross-contamination between probes has produced false results in this codebase
   before. Never reuse a state root across charters.
6. **N=1 is never a benchmark.** Any timing reported without a trial count and a spread will be
   discarded.
7. **When a probe fails, the charter continues.** Record the failure per
   [RESULTS-TEMPLATE.md §5](RESULTS-TEMPLATE.md) — including the *cause*, cited to `file:line`,
   not just the symptom — and move to the next probe. Establishing the cause is part of the
   charter's job, not a follow-up.
8. **Do not fix anything.** No charter edits product source. A charter that patches a bug to
   unblock itself has destroyed the measurement. Record it and route around it.

## 6. Beta gate criteria

This program does not vote. It produces evidence against these questions, which are settled after
all 23 results files exist:

- **Can a new user get from install to a first true verdict without help?** (01, 02, 04, 20)
- **Does every command in the surface do what it says, or fail honestly?** (03, 13, 23-equivalent
  material inside 13 and 21)
- **When Drift says "pass", is it because it checked and found nothing, or because it checked
  nothing?** (10, 11, 12, 14) — this is the central question of the whole program.
- **Are two runs over identical input identical?** (15)
- **Does it stay usable at the size of a real repo?** (16)
- **Does state survive interruption, corruption, upgrade, and restore?** (17, 18)
- **Does an agent consuming Drift get a contract it can rely on?** (19)
- **Does anything leave the machine?** (21)
- **Does the gate that claims to gate actually gate?** (22)

## 7. Known-state snapshot to record before anything runs

So that later charters can distinguish "this broke" from "this was already broken":

```bash
pnpm verify:ci   # record full output and exit code, do NOT fix failures
```

`verify:ci` is expected to be informative rather than green — the forensics report found a pinned
assertion in `test/e2e/release-hygiene.test.ts` that had drifted from `package.json`. Record its
current state exactly. Charter 22 investigates; charter 00 only snapshots.

Also record:

```bash
node -e "const c=require('./test/canary/convention-cell-ledger.json');
  const n={};for(const x of c.cells)n[x.state]=(n[x.state]||0)+1;console.log(c.cells.length,n)"
```

Baseline at time of writing: **18 cells — 11 firing, 2 quarantined, 5 needs-review**. Charter 10
measures whether those states are true.

## 8. Deliverables

- `results/00-preflight.md`
- `results/artifacts/00/environment.txt`
- `results/artifacts/00/verify-ci-baseline.txt`
- `results/artifacts/00/corpus-shas.txt`
- `results/artifacts/00/gen-synthetic-repo.mjs`
- An exported, documented `DRIFT_ENGINE_BIN` every other charter inherits
