# CHARTER 13 — Exit-code and refusal contract

**Depends on:** 12 · **Est. 3 h** · **Output:** `results/13-exit-code-and-refusal-contract.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 13 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 13 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 13` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Reach every exit code and every refusal code live, and find every case where what Drift **prints**
disagrees with what Drift **returns**. A CI gate consumes the exit code; a human reads the text.
If those two disagree, one audience is being lied to.

## 2. The contract

Vocabulary, documented in two agreeing places (`run-check.ts:1343-1345`,
`packages/cli/src/app/drift-error.ts:52-93`):

- **0** pass · **1** operational error · **2** blocked · **3** refused (fail-closed)
- Exit **2** is *deliberately absent* from the `FAILURE_CONTRACT` table (`drift-error.ts:64-65`) —
  it belongs only to `check` finding a real violation: a verdict, not a `DriftError`.

`FAILURE_CONTRACT` codes:

| Exit 3 — refusals | Exit 1 — errors |
|---|---|
| `stale_scan`, `missing_contract`, `missing_engine`, `insufficient_disk`, `insufficient_memory`, `shallow_clone`, `empty_diff_scope`, `stale_diff_scope`, `empty_contract`, `engine_payload_too_large`, `unindexed_contract_target`, `engine_vocabulary_mismatch` | `unsupported_database`, `missing_database`, `disk_full`, `disk_io_error`, `corrupt_database`, `permission_denied`, `cli_error` |

Plus check-specific refusals from `checkRefusalFailureFor` (`run-check.ts:316-372`), all exit 3,
all mutually exclusive with a real block (`blockingCount > 0` always wins, `:327-329`):
`full_scope_cannot_block`, `enforcement_degraded_by_incomplete_coverage`,
`contract_stale_under_strict`.

Assembly: `packages/cli/src/main.ts:11` — `process.exitCode = result.exitCode;` (single site).

## 3. Procedure

### Reach every code

One probe per code. For each, record the triggering command, the exit code, the printed text, the
`--json` payload's `failure`/`code` field, and whether text and JSON agree.

| Code | How to reach it |
|---|---|
| `stale_scan` | Scan, then modify files, then run a command requiring fresh scan state |
| `missing_contract` | `check` with no accepted conventions but a registered repo |
| `empty_contract` | A contract that accepts nothing and carries nothing (`repo-paths.ts:327-332`) |
| `missing_engine` | Remove/chmod the engine binary (charter 01 P-01-07 overlaps; repeat here for the code) |
| `insufficient_disk` | Fill or simulate a full volume for the state root |
| `insufficient_memory` | Constrain with `ulimit -v` / cgroup |
| `shallow_clone` | `git clone --depth 1`, then `doctor` and `check` |
| `empty_diff_scope` | `check --diff` with an empty diff |
| `stale_diff_scope` | A diff naming only files absent from the worktree |
| `engine_payload_too_large` | Drive the engine payload past its limit — a very large file, or many facts |
| `unindexed_contract_target` | Accept a convention, then remove its target file from the index |
| `engine_vocabulary_mismatch` | Substitute an engine whose vocabulary differs (relates to charter 05 P-05-06) |
| `unsupported_database` | Point `--db` at a SQLite file with a future schema version |
| `missing_database` | `check`/`prepare` where the default DB does not exist |
| `disk_full`, `disk_io_error` | Read-only mount, ENOSPC |
| `corrupt_database` | Truncate / scramble the SQLite file |
| `permission_denied` | chmod 000 the state root |
| `cli_error` | Unknown command; missing `--db` on a non-auto-resolving command |
| `full_scope_cannot_block` | `--scope full` with a block-mode convention |
| `enforcement_degraded_by_incomplete_coverage` | A finding whose `enforcement_result` is zeroed by coverage gaps |
| `contract_stale_under_strict` | Delete a forbidden module, run `check --strict-contract` |
| exit 2 | A real blocking violation |
| exit 0 | A genuine pass |

### The text-vs-exit disagreement

§22 obs. 13 and §14: `checks.ts:337` and `:352` hard-code
`"this run exits 0 and will not fail CI"` with **no reference** to the computed exit code or to
`blocked_reasons`. `nonBlockingDisclosure`'s only guard (`:326-328`) is
`if (payload.summary.blocking_count > 0) return [];` — it never checks whether the run is a
refusal.

| Probe | What to do |
|---|---|
| P-13-01 | Construct the exact state: **a finding exists, `blocking_count === 0`, and `enforcementDegraded === true`** (a finding whose `enforcement_result` is `"none"` because coverage gaps zeroed it, `run-check.ts:345-351`). Run `drift check` in text mode. Oracle: the printed line says "exits 0"; the process exits **3**. Capture both verbatim. |
| P-13-02 | The same state in `--json`. Does the JSON payload carry the truth even when the text does not? |
| P-13-03 | The 0-findings variant (`checks.ts:352`) under a refusal condition. |
| P-13-04 | `contract_stale_under_strict` and `full_scope_cannot_block` — do they also print "exits 0"? |
| P-13-05 | The "To make it a gate: `drift conventions accept … --mode block --confirm`" line, printed unconditionally after a 0-finding result **even when already accepted in block mode** (`checks.ts:338-340, 353-355`). Reproduce with a block-mode convention producing a warn-severity or `--scope full` non-blocking finding. |
| P-13-06 | Wire a real CI job to `drift check` and confirm which of these states fails the job and which does not. The exit code is the only thing CI sees; establish empirically that it is right in every state above. |

### Error surface hygiene

| Probe | What to do |
|---|---|
| P-13-07 | For every code reached: confirm stderr vs stdout placement is consistent, and that `--json` never emits non-JSON to stdout even on failure. |
| P-13-08 | Confirm no path emits a raw stack trace. The known candidate is the plain `Error` thrown by the no-evaluator acceptance refusal (charter 09 P-09-02) — cross-reference its exit code here and place it in or outside the contract. |
| P-13-09 | Run `pnpm check:error-contract` (`scripts/error-contract.mjs`) and reconcile it against the codes actually reached. Any code in the table this charter could not reach is either dead or undocumented-how-to-reach; say which. |

## 4. Benchmarks

Not a timing charter. Counted metrics:

- codes in `FAILURE_CONTRACT` reached live / total
- states where printed text and exit code disagree
- paths emitting a raw stack trace
- commands whose `--json` output is not parseable on a failure path

## 5. Oracles

- Every code in the contract is reachable, or is documented as unreachable with a reason.
- Printed text never contradicts the exit code.
- `--json` on a failure path is still valid JSON on stdout.
- Exit 2 is produced only by `check` finding a real violation.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-13-1 | A reachable state exists where the text says "this run exits 0 and will not fail CI" and the process exits 3. | §14, §22 obs. 13, `checks.ts:337` | P-13-01 |
| S-13-2 | `nonBlockingDisclosure` never reads `blocked_reasons`, which `formatCheckText` never touches at all. | §14 | P-13-01, P-13-02 |
| S-13-3 | The "make it a gate" suggestion is printed unconditionally, including to users who already did it. | §14, `checks.ts:338-340` | P-13-05 |
| S-13-4 | The no-evaluator acceptance refusal throws a plain `Error` outside `FAILURE_CONTRACT`; its exit code was never traced. | §15, §18a, §21 | P-13-08 |
| S-13-5 | Exit 1 for operational errors is real but was omitted from the audit's summary vocabulary. | §14 | Reach several exit-1 codes and confirm |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A code that cannot be reached after genuine effort is
recorded as **NOT REACHABLE** with the exact attempts made — not as a skipped probe.

## 8. Deliverables

`results/13-exit-code-and-refusal-contract.md` with a code × reached × exit × text-agrees table;
transcripts under `results/artifacts/13/`.
