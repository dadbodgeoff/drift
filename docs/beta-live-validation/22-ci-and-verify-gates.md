# CHARTER 22 — CI and verify gates

**Depends on:** 00 · **Est. 3 h** · **Output:** `results/22-ci-and-verify-gates.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 22 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 22 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 22` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Determine whether the gates that claim to gate actually gate. Three specific mechanisms are under
suspicion: a ledger check that returns 0 on errors depending on branch detection, an eval suite
that CI never runs, and a pinned-string assertion whose drift inverts its own purpose. Each is
settled by running CI, not by reading it.

## 2. Mechanism under test

`.github/workflows/ci.yml` — triggers on `pull_request` (no branch filter) and `push: [main]`
(`:8-11`). One job `verify` (`:13-40`): checkout `fetch-depth: 0`, pnpm 10.28.0 / Node 22 /
Rust 1.97.0, `pnpm install --frozen-lockfile`, `pnpm build:engine`, `pnpm verify:ci`.

`verify:ci` (`package.json`) chains: `verify` → `test:harness` → engine fmt/clippy →
`check:boundaries` → `check:storage-lifecycle` → `check:storage-invariants` →
`check:error-contract` → `check:vocabulary` → `check:surface-parity` →
`check:payload-invariants` → `check:cell-ledger` → `check:engine-schema-parity` →
`validate-engine-release-matrix --allow-unverified` → `validate:claims` → `beta:proof` →
`git diff --check`.

`verify:evals` is a **disjoint** chain: `eval:external`, `eval:breadth`, `eval:evasion`,
`eval:bench`, `eval:presence`, `eval:determinism`. The two are combined only in `verify:full`,
which CI never invokes (§22 obs. 16). The workflow's own header calls evals "a local gate."

`scripts/convention-cell-ledger.mjs`:
- `enforcing = !reportOnly && (integration || forced)` (`:376`)
- `integration` = `ledger.enforcement.integration_branches.includes(branch)`, where
  `integration_branches` = `["remediation/ground-truth-audit", "main"]`
  (`convention-cell-ledger.json:48-51`)
- `forced` = `process.env[ledger.enforcement.override_env] === "1"`, i.e. `DRIFT_LEDGER_ENFORCE`
- When errors exist and `!enforcing` (`:416-423`): every error prints to stderr, then
  "NOT FAILING: enforcement is integration-branch only (…)", then the function **returns 0**.
- `currentBranch()` (`:428-438`) is `git rev-parse --abbrev-ref HEAD`, overridable by
  `DRIFT_LEDGER_BRANCH`.
- **`DRIFT_LEDGER_ENFORCE` is never set anywhere in CI** — verified by grep.

## 3. Procedure

### Does the ledger gate ever enforce?

| Probe | What to do |
|---|---|
| P-22-01 | Run a real GitHub Actions job on `push: main` and print `git rev-parse --abbrev-ref HEAD` inside it. `actions/checkout@v4` commonly leaves a detached HEAD, which would report a SHA, not `main` — in which case `integration` is false and the ledger **never enforces on any trigger**. §21 records this as **CANNOT DETERMINE from source**. This charter closes it, and it is the charter's highest-value probe. |
| P-22-02 | Same on a `pull_request` trigger. |
| P-22-03 | Introduce a deliberate, reversible ledger error (a cell with no canary; an undeclared cell). Push to a branch and open a PR. Does CI go red? Then push the same to `main` (or a protected simulation). Does CI go red there? |
| P-22-04 | Run with `DRIFT_LEDGER_ENFORCE=1` and confirm it forces enforcement. |
| P-22-05 | Run with `DRIFT_LEDGER_BRANCH=main` in a PR context and confirm that flips the behavior — which tells you exactly what branch detection is worth. |
| P-22-06 | Establish what the ledger check would have caught if it had been enforcing: run it in enforcing mode against the last N merge commits and report how many would have failed. |

### The evals CI never runs

| Probe | What to do |
|---|---|
| P-22-07 | Confirm `verify:ci` contains no `eval:*` step. Then run `pnpm verify:evals` locally with `$DRIFT_EVAL_REPOS` set and record what it reports — this is the signal CI has never seen. |
| P-22-08 | Determine how many commits have landed on `main` since `verify:evals` last passed. If the answer cannot be determined from history, say so. |
| P-22-09 | Assess whether `verify:evals` **could** run in CI: it needs cloned corpus repos and a release engine binary. Quantify the cost — clone size, wall time — as a fact, not a recommendation. |
| P-22-10 | Confirm `eval:determinism` is inside `verify:evals` (charter 15 S-15-4), meaning the repo's own determinism harness has never gated a merge. |

### Pinned-string gates

| Probe | What to do |
|---|---|
| P-22-11 | `test/e2e/release-hygiene.test.ts` pins `verify:evals`'s exact string. The forensics report found the pin missing `&& pnpm eval:presence` and therefore failing on every branch. **On current `main` the pin carries a comment acknowledging exactly this.** Run `pnpm test:e2e` and record whether the assertion passes now. |
| P-22-12 | Whether it passes or fails, the structural question stands: a pin that fails on every branch inverts its own purpose — it trains everyone to ignore a red gate. Determine how long it was red (`git log` the test file and `package.json`'s `verify:evals` line) and whether anything merged while it was. |
| P-22-13 | §21 asks whether **other** pinned-string assertions in `release-hygiene.test.ts` (600+ lines, never read in full) have similarly drifted. Read the file, extract every pinned string, and compare each to its current source of truth. |
| P-22-14 | Same for `pnpm test:harness`'s 18 script self-tests — does any of them pin a string that has drifted? |

### The full gate, run for real

| Probe | What to do |
|---|---|
| P-22-15 | Run `pnpm verify:ci` end to end. Record every step's exit code and duration. Compare against charter 00's baseline snapshot — anything that changed between them is this program's own contamination and must be explained. |
| P-22-16 | For each of the 12 `check:*` / `validate:*` / `beta:proof` steps: introduce a deliberate violation of what that step claims to protect, and confirm it goes red. **A gate never observed failing is not known to be a gate.** Produce a step × does-it-actually-fail table. |
| P-22-17 | `beta:proof` (`scripts/run-beta-proof.mjs`) — `release-hygiene.test.ts:376` asserts it cannot be self-attested via env vars. Attempt to self-attest. |
| P-22-18 | `git diff --check` as the last step: confirm it catches whitespace errors and that nothing earlier in the chain leaves the tree dirty (which would make this step fail for the wrong reason). |
| P-22-19 | The separate `drift-check-self.yml` dogfooding workflow — the merge commit `02feab5` was titled *"the dogfooding gate could not fail, because it never ran."* Confirm it now runs **and** can fail: introduce a violation Drift should catch in Drift's own repo and confirm the workflow goes red. |
| P-22-20 | `docs/ci-integration.md`'s documented integration (charter 04 P-04-09), set up for real: does the documented recipe produce a gate that actually fails on a violation? |

## 4. Benchmarks

| Metric | How |
|---|---|
| `verify:ci` total wall time, and per-step breakdown | 3 runs |
| `verify:evals` total wall time | 3 runs |
| CI job wall time on a hosted runner | 3 runs |
| Steps that have never been observed failing | count, from P-22-16 |

## 5. Oracles

- Every step in `verify:ci` can be made to fail by violating what it protects.
- The ledger gate enforces on at least one trigger that gates merges — or is documented as
  enforcing on none.
- Every pinned assertion matches its current source of truth.
- The dogfooding workflow runs and can fail.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-22-1 | Whether `git rev-parse --abbrev-ref HEAD` resolves to `main` inside a GitHub Actions `push: main` run determines whether the ledger gate ever enforces. Never runtime-tested. | §15, §21 | P-22-01 |
| S-22-2 | When not enforcing, the ledger prints every error to stderr and returns 0 — real errors, green build. | §15, §22 obs. 15, `:416-423` | P-22-03 |
| S-22-3 | `DRIFT_LEDGER_ENFORCE` is never set in CI. | §15 | grep + P-22-04 |
| S-22-4 | `verify:ci` and `verify:evals` are disjoint; the eval chain — including the determinism harness — never runs in CI and additionally needs a corpus env var CI does not set. | §22 obs. 16, §20e | P-22-07, P-22-10 |
| S-22-5 | The `verify:evals` pinned string drifted and was failing on every branch; current `main` carries a comment acknowledging it. | §15, live read | P-22-11, P-22-12 |
| S-22-6 | Other pinned strings in `release-hygiene.test.ts` may have drifted the same way; the file was never read in full. | §21 | P-22-13 |
| S-22-7 | The audit's cited line numbers for `convention-cell-ledger.mjs` did not match `main` even though the file was byte-identical between the two commits — unexplained. | §21 | Note whether current line numbers match either set; a third set means something is still unaccounted for. |
| S-22-8 | The canary-check truthy-string bug the audit reported does **not** exist at either commit — the audit's quoted code was never accurate. | §15 (**SOURCE CONTRADICTS AUDIT**) | Read `:345-347` directly and confirm the correct `cell.state === …` form |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). Deliberate CI breakage happens on a **scratch branch**,
never on `main`, and every introduced violation is reverted before the charter ends — record the
revert commit. Do not fix a genuinely-red gate found along the way; record it.

## 8. Deliverables

`results/22-ci-and-verify-gates.md` with the gate-step × can-it-fail table, the ledger enforcement
determination, and the pinned-string drift inventory; CI run URLs and logs under
`results/artifacts/22/`.
