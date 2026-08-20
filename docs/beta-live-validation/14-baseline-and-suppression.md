# CHARTER 14 — Baseline and suppression

**Depends on:** 10 · **Est. 3 h** · **Output:** `results/14-baseline-and-suppression.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 14 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 14 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 14` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Baselines and suppressions are how a real team adopts Drift on an existing codebase: accept
today's violations, gate tomorrow's. This charter tests whether a finding's governance status
survives, and whether a status change is ever made **silently**.

## 2. Mechanism under test

- Baseline: `packages/cli/src/commands/baseline.ts` (`create` `:13`, `status` `:119`,
  `clear` `:154`), `domain/baselines.ts:191-196` (`isBaselineEligibleFinding`), table
  `baseline_violations` (migration 001).
- Suppression / finding lifecycle: `commands/findings.ts` — `list` `:14`, `show` `:70`,
  `mark-fixed` `:133`, and `resolveFindingWithReason` `:206-262` backing `mark-needs-review`,
  `suppress`, `accept-drift`, `mark-false-positive`.
- Preserved status: `domain/findings.ts:22-34` (`preservedGovernanceStatus`).
- **Precedence:** baseline classification (`pre_existing` vs `new`) **always takes precedence**
  over a preserved suppression when both exist for the same finding fingerprint, and **no audit
  event is written when this override occurs** (§22 obs. 14). Classification sites:
  `run-check.ts:831-833, 2941-2943, 3235, 3487`.
- The repo's own test for related baseline-orphaning behavior is explicitly labelled
  **`EXPECTED-TO-CHANGE`** (`test/e2e/contract-import-baseline.test.ts:347-398`), i.e. pinned as a
  known-wrong behavior rather than a passing invariant.

## 3. Procedure

### Precedence and silence

| Probe | What to do |
|---|---|
| P-14-01 | Produce a finding. `findings suppress` it. Confirm `check` no longer reports it and `findings list` shows the suppressed status. |
| P-14-02 | Now `baseline create` so a baseline row matches the **same fingerprint**. Re-run `check`. Oracle per S-14-1: the status silently reverts to `pre_existing`. Record the observed status, and check `drift audit list` for **any** event recording the override. |
| P-14-03 | Reverse the order: baseline first, then suppress. Does suppression win in this direction? Record the asymmetry if any. |
| P-14-04 | Repeat P-14-02 for each of the five finding statuses reachable via `resolveFindingWithReason`: `mark-fixed`, `mark-needs-review`, `suppress`, `accept-drift`, `mark-false-positive`. Build a **status × baseline-present → resulting status** table. |
| P-14-05 | Confirm from the audit log which of these transitions write events and which do not. Every silent transition is a finding. |

### Fingerprint stability — the thing all of this rests on

| Probe | What to do |
|---|---|
| P-14-06 | Suppress a finding, then make an unrelated edit **elsewhere in the same file**. Does the suppression still match? |
| P-14-07 | Move the violating line up/down within the file. Still matched? |
| P-14-08 | Rename the file (charter 12's mechanism). Still matched? |
| P-14-09 | Reformat the file (prettier) without semantic change. Still matched? |
| P-14-10 | Re-scan with no change at all, 10 times. Does the fingerprint stay constant? (Charter 15 owns determinism broadly; this probe owns fingerprint stability specifically, because an unstable fingerprint silently discards every suppression a team has made.) |
| P-14-11 | Two structurally identical violations in the same file. Do they get distinct fingerprints? Suppress one — does the other stay reported? |

### Orphaning across contract changes

| Probe | What to do |
|---|---|
| P-14-12 | Baseline some findings. `contract export`, edit the contract to remove/rename a convention id, `contract import`. Then: `baseline status` (does it report rows under a dead convention id as active?), `contract validate` (does it call the contract valid?), `check` (does it re-report everything as `new`?). §18a says exit code is identical either side of the import — confirm. |
| P-14-13 | The same, but importing a contract from a **different repo**. |
| P-14-14 | `baseline clear` then `check` — does everything become `new`, and is the user warned before clearing? |
| P-14-15 | Waivers (charter 09 P-09-08) interacting with baselines and suppressions: all three present for one finding. Which wins? |
| P-14-16 | Run `test/e2e/contract-import-baseline.test.ts` and record which of its assertions are the `EXPECTED-TO-CHANGE` ones. Then state, from live observation, what the behavior actually is — the test pins it, this charter describes it. |

## 4. Benchmarks

| Metric | How |
|---|---|
| `baseline create` time vs. finding count | 10, 100, 1,000, 10,000 findings |
| `check` overhead with a large baseline | Same repo, baseline of 0 vs 10,000 rows |
| Fingerprint stability rate | (fingerprints unchanged) / (total) across P-14-06 … P-14-10 |
| `findings list` time vs. finding count | 10 trials at each size |

Fingerprint stability rate is this charter's headline number: it bounds how much of a team's
suppression work survives ordinary editing.

## 5. Oracles

- No governance status ever changes without an audit event.
- A suppression survives edits that do not touch the violation.
- A contract change that orphans baseline rows says so, on the surface a user is looking at.
- Precedence between baseline, suppression, and waiver is consistent and documented.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-14-1 | Baseline classification always overrides a preserved suppression for the same fingerprint, and **no audit event is written** when it does. | §22 obs. 14 | P-14-02, P-14-05 |
| S-14-2 | `contract import` can orphan baseline rows with no message on any surface: `baseline status` shows them active under a dead id, `contract validate` reports valid, `check` re-reports everything as `new`, and the exit code is identical either side. | §18a, §12 | P-14-12 |
| S-14-3 | The repo's own test for this is labelled `EXPECTED-TO-CHANGE` rather than treated as a passing invariant. | §22 obs. 14, §20b | P-14-16 |
| S-14-4 | `isBaselineEligibleFinding` restricts which findings can be baselined — establish which cannot, and what a user is told when they try. | `domain/baselines.ts:191-196` | Attempt to baseline an ineligible finding |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A silent status change is recorded as its own `F-14-n`
block even though nothing "failed" — silence is the defect.

## 8. Deliverables

`results/14-baseline-and-suppression.md` with the status × baseline precedence table and the
fingerprint stability rate; database dumps under `results/artifacts/14/`.
