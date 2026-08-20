# CHARTER 18 — Backup, restore, and the audit chain

**Depends on:** 17 · **Est. 2 h** · **Output:** `results/18-backup-restore-and-audit-chain.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 18 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 18 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 18` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Two governance guarantees are under test. **Backup/restore**: can a team recover their Drift state
completely, and know when they cannot. **The audit chain**: `audit_events` is append-only and
hash-chained; does tampering actually get detected, or is `audit verify` decorative?

## 2. Mechanism under test

- `packages/cli/src/commands/backup.ts` — `create` `:19`, `list` `:83`, `verify` `:122`.
  `backup verify` is dispatched **before the database opens** (`run-cli.ts:75-82`) and is
  `--db`-free by construction.
- `packages/cli/src/commands/restore.ts:16` — also pre-database (`run-cli.ts:66-73`).
- `domain/backup-artifacts.ts`, `domain/restore-review.ts` — the latter holds **the only 3
  `next_commands` templates in the entire CLI that include `--db`** (`:83-84, 170`), for a case
  where it is specifically required (§22 obs. 18).
- `backup_manifests` table (migration 004).
- `packages/cli/src/commands/audit.ts` — `list` `:13`, `verify` `:74`. `audit_events` table
  (migration 001, re-touched 005). Doctor's `audit_integrity` check produces `fail` when the hash
  chain is broken (`doctor.ts:252`).

## 3. Procedure

### Backup and restore

| Probe | What to do |
|---|---|
| P-18-01 | Build rich state: scanned repo, accepted conventions, findings in several statuses, a baseline, waivers, audit events. Record a full inventory (row counts per table). |
| P-18-02 | `backup create --confirm`. Record the artifact's location, size, format, and whether it is self-describing (schema version, repo id, timestamp, checksum). |
| P-18-03 | `backup list`. `backup verify` on the good artifact — must succeed **without** `--db`. |
| P-18-04 | Restore into a **fresh, empty** state root. Compare row counts per table against P-18-01. Then compare **behavior**: does `check` produce identical output before and after? That is the real fidelity test, not row counts. |
| P-18-05 | Restore **over** existing state. Is the user warned? Is the prior state recoverable? |
| P-18-06 | `backup verify` on: a truncated artifact, one with a flipped byte, one from a different repo, one from a different schema version, an empty file, a directory. Each must be rejected with a stated reason and a documented exit code. |
| P-18-07 | Restore an artifact whose schema version is **older** than the CLI. Does it migrate forward? Newer than the CLI — is it refused? |
| P-18-08 | Interrupt a restore mid-run (SIGKILL). Is the target state root usable, or a blend? (Charter 17 P-17-13's question, on the restore path.) |
| P-18-09 | Follow `restore-review.ts`'s printed next-commands verbatim — these are the only ones carrying `--db`. Confirm they work, and confirm they are the only three (cross-reference charter 03 S-03-4). |
| P-18-10 | Backup a very large state (20,000-file repo). Time it, measure the artifact size, and confirm it round-trips. |

### The audit chain

| Probe | What to do |
|---|---|
| P-18-11 | Perform every mutating operation from charter 03 P-03-h. Confirm `audit list` shows an event for each. Enumerate operations that produce **no** event — especially the silent baseline/suppression override from charter 14 S-14-1. |
| P-18-12 | `audit verify` on a healthy chain. |
| P-18-13 | **Tamper.** Via direct SQL: modify one event's payload; delete a middle event; delete the last event; insert an event with a forged hash; reorder two events by swapping timestamps; append a plausible event with a recomputed chain hash. For each, run `audit verify` and `drift doctor`. Oracle: every tamper is detected. The last one — a fully recomputed chain — tests whether the chain is anchored to anything the tamperer cannot recompute. Report honestly which tampers are detectable and which are not. |
| P-18-14 | Confirm doctor's `audit_integrity` check reaches `fail` (`doctor.ts:252`) for a broken chain and that the exit code follows (charter 20). |
| P-18-15 | Does a backup/restore round trip preserve the chain's verifiability? Restore, then `audit verify`. |
| P-18-16 | Chain performance: `audit verify` time at 100 / 10,000 / 100,000 events. |

## 4. Benchmarks

| Metric | How |
|---|---|
| `backup create` time and artifact size vs. state size | 500 / 5,000 / 20,000-file repos |
| Restore time | Same sizes, 5 trials |
| Round-trip fidelity | tables matching / total tables; and behavioral identity of `check` output |
| `audit verify` time vs. event count | 100 / 10k / 100k |
| Tamper detection rate | detected / attempted, across P-18-13's six shapes |

## 5. Oracles

- A restored state produces byte-identical `check` output to the original.
- Every invalid artifact is rejected with a stated reason and a documented exit code.
- Every tamper shape is detected, or the results file states plainly which are not and why.
- Every state mutation is in the audit log.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-18-1 | `backup verify` is `--db`-free by construction and works with no state at all. | §20f, `commands/backup.ts:122` | P-18-03 |
| S-18-2 | `restore-review.ts:83-84,170` holds the only 3 `next_commands` templates in the CLI that include `--db`. | §22 obs. 18 | P-18-09 |
| S-18-3 | Doctor's `audit_integrity` `fail` path is reachable when the hash chain is broken. | §20h, `doctor.ts:252` | P-18-14 |
| S-18-4 | The baseline-over-suppression override writes no audit event. | §22 obs. 14, charter 14 | P-18-11 |
| S-18-5 | `backup create` requires `--confirm`; establish what other destructive operations do and do not. | §20f | P-18-02, P-18-05 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). Every tamper probe runs on a **copy**. An undetected
tamper is reported as a finding with the exact SQL that produced it.

## 8. Deliverables

`results/18-backup-restore-and-audit-chain.md` with the round-trip fidelity table and the tamper
detection matrix; artifacts and SQL under `results/artifacts/18/`.
