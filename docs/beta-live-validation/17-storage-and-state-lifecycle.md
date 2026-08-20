# CHARTER 17 — Storage and state lifecycle

**Depends on:** 05 · **Est. 3 h** · **Output:** `results/17-storage-and-state-lifecycle.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 17 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 17 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 17` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Drift is local-first: the SQLite state **is** the product's memory. This charter tests whether that
memory survives upgrade, interruption, corruption, concurrency, and a full disk — and whether a
damaged state is ever mistaken for a healthy one.

## 2. Mechanism under test

- `packages/storage/src/migrations.ts` — `MIGRATIONS: Migration[]` (`:6`), **36** entries as of `a0517f3e`,
  `001_initial_local_state` … `036_sink_candidate_fact_kind`. Re-derive rather than trust this number.
- `SUPPORTED_SQLITE_SCHEMA_VERSION = MIGRATIONS.length`
  (`packages/cli/src/domain/versions.ts:16`), surfaced as `storage_schema_version` in
  `drift version --json` (`:28`).
- `packages/storage/src/sqlite-storage.ts` — the storage boundary; accepted-conventions CRUD at
  `:2080-2146`; `SecurityBoundaryProofSchema.parse` at `:1279, 1329, 1342, 2903`.
- ~30 tables; full catalog in §19e. The load-bearing ones for recovery: `schema_migrations`,
  `repos`, `scan_manifests`, `file_snapshots`, `facts`, `graph_nodes`, `graph_edges`,
  `graph_evidence`, `findings`, `baseline_violations`, `accepted_conventions`, `repo_contracts`,
  `audit_events`.
- Guards: `scripts/storage-lifecycle.mjs`, `scripts/storage-invariants.mjs` (both in `verify:ci`).

Confirm the current count first — it may have moved since:

```bash
node -e "const m=require('./packages/storage/dist/migrations.js');console.log(m.MIGRATIONS.length)" \
  || grep -c "id: \"0" packages/storage/src/migrations.ts
drift version --json | grep storage_schema_version
```

## 3. Procedure

### Migrations

| Probe | What to do |
|---|---|
| P-17-01 | Fresh `drift init` → confirm all migrations apply and `schema_migrations` row count equals `MIGRATIONS.length` (36 at `a0517f3e`). Time it. |
| P-17-02 | Apply migrations to a **populated** database, not an empty one: build real state at an older schema version if a prior release artifact is obtainable, then upgrade. If no prior artifact exists, say so and construct the closest achievable test — a database with rows in every table, migrated forward from the earliest reachable point. |
| P-17-03 | Interrupt a migration mid-run (SIGKILL). Re-open. Is the database usable, does it report its true version, or is it half-migrated and silent? |
| P-17-04 | Open a database with a **higher** schema version than the CLI supports. Oracle: `unsupported_database`, exit 1 — never a silent downgrade or partial read. |
| P-17-05 | Open a database with a lower version and confirm the upgrade is automatic, announced, and reversible via backup (charter 18). |
| P-17-06 | Confirm `drift doctor`'s `drift_state` check reports schema incompatibility as `fail` (`doctor.ts:216-221`) and `contract` as `fail` on contract-schema incompatibility (`:230-234`). |

### Corruption and adversity

| Probe | What to do |
|---|---|
| P-17-07 | Truncate the SQLite file to 50%. Every command's behavior and exit code. Oracle: `corrupt_database`, exit 1, no stack trace. |
| P-17-08 | Flip random bytes in the middle of the file. Same. |
| P-17-09 | Delete one table. Delete one row from `schema_migrations`. |
| P-17-10 | Zero-length database file. Directory where a database file is expected. A non-SQLite file passed to `--db`. |
| P-17-11 | Read-only state root (chmod 555). Oracle: `permission_denied`, exit 1, and **no partial write**. |
| P-17-12 | Fill the volume, then run `scan`. Oracle: `disk_full` / `disk_io_error`, exit 1, and the pre-existing state must remain valid — confirm by restoring space and re-running `check`. **Use a BOUNDED volume, never the host disk** — see the note below. |
| P-17-13 | SIGKILL mid-`scan` and mid-`check`. Re-open and run `scan status`, `check`, `doctor`. Is partial state distinguishable from complete state, or does `check` report a verdict over a half-written graph? **This is the highest-value probe in the charter.** |
| P-17-14 | Leftover WAL/journal files after a kill. Does the next open recover them correctly? |
| P-17-15 | The database on a network filesystem or a case-insensitive volume, if reachable. Record what breaks. |

### Concurrency

| Probe | What to do |
|---|---|
| P-17-16 | Two `drift scan` processes, same state root, simultaneously. |
| P-17-17 | `drift scan` and `drift check` simultaneously. |
| P-17-18 | `drift check` and `drift findings suppress` simultaneously. |
| P-17-19 | The MCP server (read-only, charter 19) reading while the CLI writes. |
| For each: record whether it blocks, errors cleanly, or corrupts. A clean lock error is a good outcome; a corrupted database is a beta blocker; a silently interleaved write is worse than either. |

### Invariants

| Probe | What to do |
|---|---|
| P-17-20 | Run `pnpm check:storage-lifecycle` and `pnpm check:storage-invariants`. Record what they assert. |
| P-17-21 | Deliberately violate one invariant each guard claims to protect (by direct SQL) and confirm the guard catches it. A guard that passes on a violated invariant is itself the finding. |
| P-17-22 | Growth: database size vs. repo size vs. scan count. Do old scans accumulate forever? Is there any pruning? Measure after 1, 10, and 50 scans of the same repo. |

### Filling a volume without endangering the machine

`P-17-12` and `P-17-11` need a real `ENOSPC`, not a simulated one — the point is to see what Drift
does when the filesystem genuinely refuses a write. Doing that to the host volume risks the machine
rather than the test, and on a laptop that is already tight it will simply fail for the wrong reason.

Give the probe its own filesystem instead:

```bash
hdiutil create -size 200m -fs APFS -volname drift-fill -quiet /tmp/fill.dmg
MNT=$(hdiutil attach /tmp/fill.dmg -nobrowse | awk '{print $NF}' | tail -1)
# put the state root on it, then fill the remainder:
dd if=/dev/zero of="$MNT/filler" bs=1m count=500 2>/dev/null   # runs until real ENOSPC
# ... run the probe against --state-root "$MNT/state" ...
hdiutil detach "$MNT" -quiet && rm -f /tmp/fill.dmg
```

Verified: 200 MB image fills to 5 MB free and returns genuine `ENOSPC`, with the host volume
unchanged. A read-only mount for `P-17-11` comes from the same image mounted with `-readonly`.

## 4. Benchmarks

| Metric | How |
|---|---|
| Migration time, fresh vs. populated | 5 trials each |
| Database size vs. repo file count | 500 / 5,000 / 20,000 |
| Database growth per scan on unchanged content | 50 sequential scans |
| Write transaction time during scan | Profile from charter 16 P-16-05 |
| Recovery time after kill | 5 trials |

## 5. Oracles

- A damaged state is always detected and reported, never silently used to produce a verdict.
- An interrupted write leaves either the old state or the new one, never a blend.
- Every adverse condition maps to a documented `FAILURE_CONTRACT` code (charter 13).
- Concurrent access either serializes or fails cleanly.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-17-1 | `storage_schema_version` is **36** at `a0517f3e` and equals `MIGRATIONS.length`. | §19e, re-measured | P-17-01 |
| S-17-2 | Migrations have only ever been tested forward from empty, not from a populated older database. | inferred from `storage-lifecycle.mjs`'s scope | P-17-02, P-17-20 |
| S-17-3 | `drift_state` and `contract` doctor checks can produce `fail` on schema incompatibility. | §20h | P-17-06 |
| S-17-4 | Old scans accumulate in `facts`, `graph_nodes`, `graph_edges`, `graph_evidence` with no pruning mechanism named anywhere in the schema catalog. | §19e | P-17-22 |
| S-17-5 | `scan status` creates the state directory as a side effect (charter 03 S-03-3) — confirm what it creates and whether it is complete or a stub. | §18b | Cross-reference charter 03 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). Every corruption probe runs on a **copy**; never on a
state root another charter depends on. Any case where a corrupted database produces a *verdict*
rather than an error gets its own `F-17-n` block and is repeated in §1.

## 8. Deliverables

`results/17-storage-and-state-lifecycle.md`; corrupted-database samples and recovery transcripts
under `results/artifacts/17/`.
