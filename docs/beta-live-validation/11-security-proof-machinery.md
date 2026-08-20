# CHARTER 11 — Security proof and receipt machinery

**Depends on:** 10 · **Est. 4 h** · **Output:** `results/11-security-proof-machinery.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 11 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 11 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 11` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Drift's security conventions do not merely report findings; they build **proofs** and emit
**receipts**. A receipt is the tool's own statement of what it examined. This charter tests
whether the proof is sound, whether the receipt is honest, and whether a known schema mismatch
between the Rust engine and the TypeScript layer throws in production.

## 2. Mechanism under test

Six proof-building files (`crates/drift-engine/src/`):
`security_facts.rs`, `security_proof.rs`, `security_phase6.rs`, `security_control_flow.rs`,
`security_patterns.rs`, `security_rules.rs` (per-kind orchestration, lines 160-943).
Full catalog of `pub fn build_*` / `pub fn evaluate_*` across the six is in §11 of the forensics
report; re-derive it with grep rather than trusting the list.

Receipts: `CheckEvaluationReceipt` (`crates/drift-engine/src/protocol.rs`), carrying `reached`,
`inputs_considered`, `enforcement_result`, `convention_id`. Engine-side
`inputs_considered = facts.len()`, **confirmed**. The CLI-side value
(`packages/cli/src/check/run-check.ts:3368-3381`) was cited by the audit as `fileSet.size` — a
different quantity — and **was never independently verified** (§21). Closing that is a probe here.

Storage: `security_boundary_proofs` (migration 023), `security_boundary_proof_runs` (025).
Schema enforcement: `SecurityBoundaryProofSchema.parse` at
`packages/storage/src/sqlite-storage.ts:1279, 1329, 1342, 2903`.

## 3. Procedure

### The `session_not_trusted` schema mismatch

§22 obs. 11: the engine emits the literal string `"session_not_trusted"` into a proof field whose
independently-maintained TypeScript schema — **two copies** — excludes that exact string from its
allowed enum, enforced by a throwing parse at multiple points in the pipeline. It is reachable
from **any** accepted security convention whose build function is one of the **5** that call the
emitting function, not only session-trust.

| Probe | What to do |
|---|---|
| P-11-01 | Identify the 5 build functions that call the emitting function (`security_proof.rs:1429-1482`; schema at `packages/core/src/security.ts:311-339`). |
| P-11-02 | For each of the 5, construct a fixture that drives it to emit `session_not_trusted`, accept the corresponding convention, and run `drift check`. Record: does it throw? At which of the four `.parse` call sites? What does the user see — a stack trace, a `DriftError`, or a silently dropped proof? |
| P-11-03 | If it throws: is state left consistent? Re-run `check` and `contract validate` afterward. |
| P-11-04 | If it does **not** throw: determine why — was the enum widened, is the emitting path unreachable, or is the parse skipped on that route? Establish the mechanism, do not just report "did not reproduce". |
| P-11-05 | `git log -p --follow -- crates/drift-engine/src/security_proof.rs` filtered to the emitting range, and the same for `packages/core/src/security.ts`. §21 notes the "still unfixed" claim rests on content comparison at HEAD only, not history. Settle it. |

### Proof soundness

| Probe | What to do |
|---|---|
| P-11-06 | For each of the 12 security kinds, dump the stored proof from `security_boundary_proofs` for a positive fixture. Is the proof's content actually sufficient to justify the verdict, or is it a record that a substring matched? |
| P-11-07 | Control flow: `security_control_flow.rs` implements branch/dominance heuristics. Build a route where the guard is present but **not dominating** (inside one branch of an `if`, after an early `return`, inside a `try` whose `catch` skips it, inside a callback that may not run). Does the proof claim the guard covers the route? (`test/fixtures/security-dynamic-control-flow`, `security-role-branch-bypass`.) |
| P-11-08 | The reverse: a guard that **does** dominate but is written unusually (a wrapper HOF, a decorator, an early-return-on-failure pattern). Does the proof miss it, producing a false positive? (`security-role-guard-present`, `security-middleware-covered`.) |
| P-11-09 | Presence path vs. proof path: the same kind has both a `presence_findings` cell and a `*_proof` cell for auth-helper and request-validation. Construct a case where the two disagree and record which one the user is shown. |
| P-11-10 | The **starve-guard exemption** (§10): identify it in source, then construct the input that triggers it, and record what the receipt says while it is active. |
| P-11-11 | Parser-gap interaction: `security-middleware-dynamic-parser-gap`, `security-tenant-parser-gap`, `security-validation-dynamic-body-parser-gap` fixtures exist. For each, confirm that a parser gap in a security-relevant position degrades the verdict **visibly** — `enforcement_result` reduced, refusal raised, or the gap surfaced — rather than silently passing. |

### Receipt honesty

| Probe | What to do |
|---|---|
| P-11-12 | For a run with known inputs, compare the engine's `inputs_considered` (= `facts.len()`) against the CLI's rendered value. If they differ, that difference is the finding — **§21 leaves this open.** |
| P-11-13 | A convention with `reached: true, inputs_considered: 0`. Confirm charter 08's P-08-17 result from the receipt side, and check the `--json` payload — is it named there even though the text output only counts it? |
| P-11-14 | `enforcement_result: "none"` due to coverage gaps: confirm this produces `enforcement_degraded_by_incomplete_coverage` and exit 3 (charter 13 owns the exit contract; this probe owns the receipt). |
| P-11-15 | Run `pnpm check:payload-invariants` and `pnpm check:surface-parity` and reconcile their claims against the receipts observed here. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Proof build time per kind | 10 trials each, on a fixture of fixed size |
| Proof storage size per route | Measure `security_boundary_proofs` row size across corpus repos |
| Proof cost vs. route count | 1, 10, 100, 1,000 routes |
| Control-flow heuristic accuracy | (correct dominance verdicts) / (total), across P-11-07 and P-11-08 shapes |

## 5. Oracles

- A proof that justifies a "pass" verdict contains enough to justify it — not merely the absence
  of a substring.
- A guard that does not dominate never produces a covering proof.
- A parser gap in a security-relevant position is always visible in the verdict.
- The receipt's `inputs_considered` means the same thing on both surfaces.
- No user-facing path throws a raw schema-parse exception.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-11-1 | The engine emits `"session_not_trusted"` into a field whose two TypeScript schema copies exclude it, enforced by a throwing parse, reachable from 5 build functions. | §22 obs. 11, §9f | P-11-01 … P-11-04 |
| S-11-2 | The claim that this is unfixed rests on HEAD content comparison only; history was never queried. | §21 | P-11-05 |
| S-11-3 | Eleven of twelve proof-building functions bottom out in a raw substring check with no AST, reachability, or dataflow at that step. | §22 obs. 8 | P-11-06, cross-referenced to charter 10 P-10-01 |
| S-11-4 | CLI-side `inputs_considered` may be `fileSet.size` rather than the engine's `facts.len()`. Never verified. | §21 | P-11-12 |
| S-11-5 | The six security-proof files were verified by a dedicated sub-pass but four of them were **not** opened by the pass that covered parsing and identity — a scope handoff, not a gap, but never behaviorally closed. | §21 | P-11-06 … P-11-11 close it behaviorally |
| S-11-6 | A `needs-review` phase6 cell (SSRF, raw SQL, CSRF, rate limit) may build a proof that never fires. | ledger, charter 10 C7 | P-11-06 on those four kinds specifically |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). If P-11-02 throws an unhandled exception, capture the
full stack, the state of the database afterward, and whether the CLI's exit code is in the
documented vocabulary — then continue.

## 8. Deliverables

`results/11-security-proof-machinery.md`; dumped proofs and stack traces under
`results/artifacts/11/`.
