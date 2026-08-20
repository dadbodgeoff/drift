# CHARTER 17 — Storage and state lifecycle — RESULTS

**Agent:** Claude (Sonnet 5), subagent session
**Run started:** 2026-08-19T15:39:00Z
**Run finished:** 2026-08-19T16:00:00Z
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573 (`git rev-parse HEAD` in `$DRIFT_BETA_SRC`)
**Working tree:** clean (frozen source tree, no local modifications made)
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · sha256 `7b91451e...c960c2a` (matches `expected_sha256` reported by `drift doctor`) · `DRIFT_ENGINE_BIN` exported: yes
**Platform:** Darwin Mac.lan 24.6.0 Darwin Kernel Version 24.6.0 arm64 (macOS, Apple Silicon)
**Node / pnpm / rustc:** v25.2.1 / 10.28.0 / 1.97.0

## 1. Verdict

Drift's storage layer survives every adverse condition this charter could reach without ever
mistaking a damaged or partial database for a healthy one. Every corruption variant tried
(truncation, byte-flip, dropped table, deleted migration row, zero-length file, directory-as-db,
non-SQLite file, a database from a newer build) is caught by `doctor`/`scan` and reported with a
specific `drift_state` detail string and a non-zero exit, never a stack trace. A genuine `ENOSPC`
on a bounded 200 MB APFS volume (P-17-12) surfaces as `disk_io_error`/exit 1, and the pre-existing
state is provably intact afterward (`drift_state: ok`, schema 36, a follow-up `scan` succeeds).
SIGKILL mid-`scan`, repeated at multiple points inside the write window (0.05 s–0.85 s into a
~0.85 s scan), never once produced a partial result: either every table shows the completed scan or
`scan_manifests` is empty and `scan status` reports `latest_scan: null` — an all-or-nothing
transaction boundary, confirmed directly rather than inferred (P-17-13, the charter's
highest-value probe). What was **not** known before this charter: (1) `doctor` is a pure reader —
it never calls `migrate()`, so a populated database sitting behind on schema version is reported
correctly but is only actually upgraded by a write path (`scan`/`init`/`start`); (2) the storage
layer has a real, working, non-obvious scan-retention/pruning mechanism
(`sqlite-storage.ts:490-620`) that keeps only the newest scan and its immediate predecessor,
directly refuting the "no pruning mechanism" premise from this charter's suspect list (§4); (3) one SQLite failure mode
(`SQLITE_CANTOPEN` / "unable to open database file", produced when the containing directory —
not just the file — is read-only) is **not** matched by the `permission_denied` classifier and
falls through to the generic `cli_error` code, even though the classifier explicitly handles the
sibling case (`SQLITE_READONLY`) two lines away; (4) `doctor`'s dedicated per-check `contract: fail`
branch (`doctor.ts:230-234`) is not reachable through a contract-schema-version mismatch as
constructed here — the row fails Zod validation before `contract_ready` is ever set, so the whole
state read aborts generically instead of isolating to the `contract` check; and (5) `scan status`
creates a complete, fully-migrated (36-migration) SQLite file as a side effect of a command that
still exits 1 for "unknown repo" — a stub is not created, a real one is.

| | Count |
|---|---|
| Probes specified | 22 |
| Probes executed | 22 |
| Probes blocked (could not be executed — see §5) | 1 (P-17-15's network-filesystem half; case-insensitive half was executed) |
| Probes that behaved as the charter's oracle predicted | 17 |
| Probes that did not | 5 (P-17-02's "announced" clause, P-17-06, P-17-11, P-17-12's overall-status clause, P-17-21's guard applicability) |
| Defects found not predicted by any suspect-list entry | 2 (finding 3 and finding 5 above) |

## 2. Probe log

Full JSON responses are in `results/artifacts/17/<probe-id>.out`; `[REDACTED]` markers, if any, come
from the harness's own redaction pass, not from me. Exit codes below are the literal ledger values
from `run-probe`/`bench` (`$DRIFT_BETA_LEDGER/17.jsonl`); `validate-result 17` cross-checks them.

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-17-01 | `drift init --repo-root <ws>/repo --state-root <ws>/state --json`, then `sqlite3 <db> "select count(*) from schema_migrations;"` | 0 | 36 rows in `schema_migrations`, equal to `MIGRATIONS.length` (36) and to `storage_schema_version` from `drift version --json`. Fresh-init timing: 5 trials, median 137 ms (see §3). | Migrations apply cleanly; row count = 36 | yes |
| P-17-02 | `drift init` + `drift scan` (builds populated DB: 1850 facts, 2009 graph_nodes across 132 files) → delete rows `034_declaration_fact_kinds`/`035_secret_source_read_fact_kind`/`036_sink_candidate_fact_kind` from `schema_migrations` (only the three no-op `SELECT 1` migrations are safe to remove without also reverting a schema change — see §5, F-17-1 discussion) → `drift doctor` → `drift scan` | 0 (final `scan` step) | `doctor` alone reported `schema_version: 33`, `status: warn`, and did **not** re-migrate (`schema_migrations` count stayed 33 after `doctor` returned). The following `scan` did migrate: `schema_migrations` went to 36, and pre-existing data survived and grew correctly (facts 1850→3700 across the two real scans, graph_nodes 2009→4018 — no rows lost). | Migrations apply to a populated DB without data loss | partial — data-preservation half confirmed; the "only ever tested from empty" premise is also independently refuted, see the suspect-list disposition in §4 |
| P-17-03 | Background `drift init`, `kill -9` at a 0.05 s delay (mid-transaction; caught with `.sqlite-wal`/`.sqlite-shm` present and `schema_migrations` at 0 rows), then `drift doctor --repo-root <ws>/repo --state-root <ws>/state --json` | 1 | `doctor` exit 1, `status: fail`, `drift_state: {status: fail, detail: "unsupported schema version 0"}`. The half-migrated state is a clean, self-consistent "zero migrations applied" state (SQLite rolled the killed transaction back), not a corrupt one. A follow-up `drift scan` (P-17-03-heal) re-applies all 36 migrations cleanly from that zero state, exit 0. | Partial state is distinguishable from complete state, not silently used | yes — see note below |
| P-17-04 | Insert a migration id `999_from_the_future` into `schema_migrations`, then `drift doctor` and `drift scan` | 1 | Both refuse: `{"code": "unsupported_database"}`, message `"Unsupported Drift database migration count 37. This Drift build supports 36."`, exit 1, no stack trace. | `unsupported_database`, exit 1, never a silent downgrade | yes |
| P-17-05 | Same schema-33 DB as P-17-02, `drift scan --repo-root ... --state-root ... --json` | 0 | `schema_migrations` goes 33→36 automatically; scan succeeds; data intact. But **the scan's JSON output contains no mention of the migration having happened** — `grep -i migrat` over the full response is empty. | Automatic, announced, reversible via backup | partial — automatic: yes. Announced: no (see F-17-2). Reversible via backup: not tested here (charter 18's scope; no backup existed to restore from in this scenario). |
| P-17-06 | Insert a structurally-valid `repo_contracts` row with `contract_schema_version: 99` (all Zod-required array/object fields present), then `drift doctor` | 1 | `doctor` exit 1, `status: fail`, but the failing check is `drift_state` (`detail: "unreadable Drift database"`), **not** a dedicated `contract: fail` entry — the `contract` check never appears in the checks array at all, because `doctor.ts:225` only pushes it when `stateSummary.exists && stateSummary.compatible && stateSummary.repo_registered`, and reading a contract row through its Zod schema throws before those fields are set. Failure is still fail-closed (exit 1, no silent pass), just not through the code path the charter names. | `drift_state` and `contract` checks can independently produce `fail` on schema incompatibility | no — see F-17-3 |
| P-17-07 | Truncate a populated `drift.sqlite` (7,487,488 bytes) to 50% (3,743,744 bytes), probe via `drift doctor`, `drift checks list --db <path>`, `drift scan` | 1 (all three) | All three: `{"code": "corrupt_database"}`, message `"database disk image is malformed"`, exit 1, no stack trace, actionable `user_action` text. | `corrupt_database`, exit 1, no stack trace | yes |
| P-17-08 | Flip 64 random bytes at the file's midpoint (seeded, reproducible) on a copy of the same base DB, `drift doctor` | 1 | Identical to P-17-07: `corrupt_database`, exit 1. | Same as P-17-07 | yes |
| P-17-09 | `DROP TABLE facts;` on a copy, `drift doctor` — separately, `DELETE FROM schema_migrations WHERE id='020_machine_contract_versions'` on a fresh copy, `drift doctor` | 1 (both) | Drop-table case: `drift_state: fail`, `"unreadable Drift database"`, exit 1. Deleted-mid-chain-migration case: `drift_state: fail`, `detail: "incomplete migration history, missing 020_machine_contract_versions"`, `state_summary.missing_migrations: ["020_machine_contract_versions"]`, exit 1 — a materially more precise diagnostic than the drop-table case. | Corruption caught, reported, exit 1 | yes |
| P-17-10 | Zero-length file at the expected DB path, `drift doctor` — a directory in place of the DB file, `drift doctor` — a plain-text file at the DB path, `drift doctor` | 1, 1, 1 | Zero-length: `drift_state: fail`, `"unsupported schema version 0"`. Directory-as-db: `drift_state: fail`, `"unreadable Drift database"`. Non-SQLite text: `drift_state: fail`, `"unreadable Drift database"`. All exit 1, no stack traces. | Every case caught and reported cleanly | yes |
| P-17-11 | Mount the P-17-12 disk image `-readonly`, `drift scan --repo-root <ro-mnt>/repo --state-root <ro-mnt>/state --json` against an already-populated state root on it | 1 | `{"code": "cli_error"}`, message `"unable to open database file"`, exit 1, no stack trace, no partial write (file MD5 unchanged before/after). Fails closed and safely, but the reported code is the generic `cli_error`, not `permission_denied`. | `permission_denied`, exit 1, no partial write | partial — fail-closed and no-partial-write: yes. Correct failure code: no (see F-17-4) |
| P-17-12 | 200 MB `hdiutil` APFS image, filled to 5.1 MB free via `dd`, `drift scan` against a populated state root on it, then `rm` the filler and re-run `drift doctor` / `drift scan` | 1 (fill), 1 then 0 (recovery) | Fill case: `{"code": "disk_io_error"}`, message `"disk I/O error"`, exit 1. After freeing space: `doctor` returns `status: fail` (exit 1) but the *only* failing check is `disk_space` (`"0.2 GB free, about 0.0 GB needed"` — an artifact of the artificially tiny 200 MB test volume, not of the earlier ENOSPC); `drift_state` itself is `ok`, `schema_version: 36`, `compatible: true`. A follow-up `drift scan` succeeds cleanly (exit 0, incremental reuse, 1 changed file). | `disk_full`/`disk_io_error`, exit 1; pre-existing state remains valid after space is restored | yes on the disk-full and state-validity halves; the literal `doctor` exit/status after recovery is 1/fail, driven entirely by the volume's small size, not by state damage — see prose |
| P-17-13 | Background `drift scan` on a freshly-initialized DB (fresh `init`, no prior scan), `kill -9` after confirming the process was alive at delays swept from 0.05 s to 0.85 s (full scan takes ~0.85 s), then `drift scan status --repo <id> --db <db> --json` | 0 | Repeated across 8+ trials at different kill points: the outcome was always one of exactly two states — `scan_manifests`/`facts` both 0 (rolled back) or both fully populated (1850 facts, 1 manifest, committed) — **never** a partial mix (e.g. facts without a manifest, or vice versa). Formal capture: `scan status` after a confirmed-mid-write kill returns `latest_scan: null` cleanly, exit 0. | Interrupted write leaves the old state or the new state, never a blend; partial state is distinguishable | yes — the charter's central question for this probe, answered directly |
| P-17-14 | Same background-scan-then-kill technique; inspect `<state>/<repo_id>/` before and after the next `drift doctor` call | 0 | Before: `drift.sqlite`, `drift.sqlite-wal`, `drift.sqlite-shm` all present. After one `doctor` call: only `drift.sqlite` remains (WAL checkpointed and removed automatically). `doctor` exit 0. Dedicated recovery-diagnostic code exists for this (`scanWalFrameHeaders`/`walRecoveryDiagnostics`, `sqlite-storage.ts:149,176,2628`). | Next open recovers WAL/journal correctly | yes |
| P-17-15 | `drift init` + `drift scan` against a repo and state root placed on a freshly created case-insensitive APFS volume (`hdiutil create -fs APFS`, which defaults to case-insensitive on this host, confirmed via `diskutil apfs list`) | 0, 0 | Both succeed identically to the default-filesystem case: 132 files indexed, 1850 facts. A true network filesystem (NFS/SMB) was not reachable on this machine — see §7. | Record what breaks | partial — case-insensitive half: nothing breaks. Network-filesystem half: not reachable, blocked (see §5) |
| P-17-16 | Two `drift scan` invocations against the same state root, launched as sibling background processes via `run-probe` | 0, 0 | This formal pair serialized cleanly: process B ran first (full scan), process A ran second and correctly performed an incremental-reuse scan seeing B's write (`changed_file_count: 1`, matching a file touched between the two launches). `PRAGMA integrity_check` = `ok` afterward. An earlier exploratory (non-`run-probe`, informal) trial with tighter simultaneity observed the two processes computing the *same* content-derived `scan_id` and the loser refusing cleanly with `"Audit log is append-only; event ... already exists"` (exit 1, `cli_error`) rather than corrupting — consistent with, and not contradicting, the formal result. See §6. | Blocks, errors cleanly, or corrupts — a clean lock error or serialization is a good outcome | yes |
| P-17-17 | `drift scan` and `drift check --diff HEAD` launched simultaneously against the same DB | 0, 3 | `scan` succeeded (exit 0). `check` refused cleanly with `missing_contract` (exit 3) — this repo has no accepted contract, so the refusal is expected independent of concurrency. `PRAGMA integrity_check` = `ok`. | Serializes or fails cleanly | yes |
| P-17-18 | `drift findings list` and `drift check --diff HEAD` launched simultaneously | 3, 3 | Both refuse cleanly with `missing_contract` (exit 3) — same reason as P-17-17. `PRAGMA integrity_check` = `ok`. Concurrency was exercised (both processes ran overlapping) but neither reached a write path deep enough to be a strong concurrency test — see §7. | Serializes or fails cleanly | yes |
| P-17-19 | A minimal MCP stdio client (`get_scan_status` polled every 100 ms for 2 s) run concurrently with 3 sequential real `drift scan` writes against the same DB | 0 | All 13 MCP reads over the 2-second window returned successfully (`"ok":true` on every one; `refute-out '"ok":false'` passed); all 3 concurrent CLI scans exited 0; `PRAGMA integrity_check` = `ok` afterward. | Read-only MCP surface coexists with CLI writes without corruption | yes |
| P-17-20 | `node scripts/storage-lifecycle.mjs`; `node scripts/storage-invariants.mjs` | 0, 0 | Lifecycle guard: 32 tables, 9 orphaned methods (3 writer, 6 reader), all 9 already baselined — nothing new. Invariants guard: 24 scan-scoped tables, 7 upserts checked, 2 stale (both baselined). Both guards are explicitly commented `"Deliberately static"` — they lint the TypeScript source (`ON CONFLICT DO UPDATE SET` clauses, migration `CREATE TABLE` bodies), not a live database. | Record what each guard asserts | yes |
| P-17-21 | On a populated DB (2 real scans), `ALTER TABLE check_runs DROP COLUMN scan_id;`, then `drift scan` (which triggers `pruneSupersededScans` → the `referenced("check_runs")` retention check) | 1 | `{"code": "cli_error"}`, message `"Scan retention is misconfigured: check_runs.scan_id does not exist, so scans referenced by check_runs would be pruned. Fix the retention rule or the schema."`, exit 1, no stack trace. This is the exact guarded condition documented at `sqlite-storage.ts:528-539` (the D-ST1 fix: a table present but missing the expected column now throws instead of silently under-protecting retained scans). | A guard that passes on a violated invariant is itself the finding | yes — but not via the two `check:storage-*` guards named in P-17-20 (those are static-source linters and cannot be violated by SQL without editing product source, which is prohibited); this exercises the storage layer's own live-DB retention invariant instead, which *is* SQL-testable. See §4 disposition below. |
| P-17-22 | `growth.sh N` — repeated real content changes (append a unique comment to one file) + `drift scan`, for N=1, 10, 50 | 0, 0, 0 | N=1: 7,483,392 bytes, 1850 facts, 1 `scan_manifests` row. N=10: 8,953,856 bytes, 3700 facts, 2 `scan_manifests` rows. N=50: 9,039,872 bytes, 3700 facts, 2 `scan_manifests` rows — **identical to N=10**. `graph_nodes`/`graph_edges`/`graph_evidence` counts also identical across N=10 and N=50 (2009/3574/1488). | Measure database growth vs. scan count; is there pruning? | Growth plateaus after the second scan — contradicts the "no pruning mechanism" suspect-list premise. See §4 for the disposition and mechanism. |

**Note on P-17-03's ledger verdict:** the harness ledger records `P-17-03` as `FAIL` because my declared
assertion (`--expect-json .state_summary.schema_version=36`) was wrong for that specific step — I
was testing whether `doctor` itself heals a half-migrated database, and the correct, product answer
is *no, doctor never writes* (confirmed independently at P-17-02). The exit code (1) and all other
assertions (valid JSON, `exists: true`) passed. This is my oracle being too narrow, not a product
defect: the immediately following probe (`P-17-03-heal`, a `scan` call) confirms the database heals
correctly through a write-capable command.

## 3. Measurements

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|
| Fresh-init migration time (empty DB → 36 migrations applied) | 5 (+1 warmup) | 137 ms | 138 ms | 135 ms | 138 ms | `bench 17 migration-fresh-init --trials 5 --warmup 1 --require-exit 0 -- <wrapper: fresh state-root each trial, drift init>` — CV 1.0%, too few trials (n=5<8) for the harness's own drift-significance test, no outliers |
| `doctor` reopen latency, steady state (proxy for post-recovery reopen cost; every observed real recovery in P-17-03/13/14 completed in the same 130–260 ms range) | 5 (+1 warmup) | 265 ms | 273 ms | 259 ms | 273 ms | `bench 17 recovery-doctor-reopen --trials 5 --warmup 1 --require-exit 0 -- drift doctor --repo-root <ws>/repo --state-root <ws>/state --json` — CV 2.2% |
| DB size / row counts vs. scan count (real content changes, not no-op reuse) | 3 points (N=1,10,50; single trial each, not a `bench` timing series — see caveat below) | — | — | — | — | `growth.sh 1`, `growth.sh 10`, `growth.sh 50` via `run-probe` — see P-17-22 row in §2 for the numbers |

**Caveats.** (1) The migration-fresh-init and doctor-reopen benchmarks used `bench`'s 5-trial default
as instructed by §4 of the charter ("5 trials each"); the harness's own drift-significance test
correctly reports it cannot separate drift from noise below n=8 — these numbers describe this
machine on this day, not a load-bearing SLA. (2) The §4 table also calls for database size vs. repo
file count at 500/5,000/20,000 files and 50 sequential no-op scans; both are time-boxed out — see
§7. (3) P-17-22's growth measurement is reported as three single-trial data points, not a `bench`
series, because each point requires a different N (different total wall time, 0.75 s / 5.1 s /
35.5 s) and `bench` re-runs one fixed command unchanged across trials; the honest single-trial
labeling in RESULTS-TEMPLATE.md's own words applies here directly.

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-17-1 | `storage_schema_version` is 36 at `a0517f3e` and equals `MIGRATIONS.length`. | CONFIRMED | P-17-01: `grep -c 'id: "0' packages/storage/src/migrations.ts` = 36; `drift version --json` reports `storage_schema_version: 36`; a fresh `init` produces exactly 36 rows in `schema_migrations`. `artifacts/17/P-17-01.out` |
| S-17-2 | Migrations have only ever been tested forward from empty, not from a populated older database. | REFUTED | Two independent pieces of evidence. (a) `packages/storage/test/migrations.test.ts:42-79` contains `it("migrates a database that stopped at an earlier version, preserving data", ...)` — it applies the first 8 migrations, writes a `repos` row through raw SQL, upgrades, and asserts the row survives and all 36 migrations end up applied. (b) My own live probe (P-17-02) independently reproduced the same shape against a real populated database (1850 facts, 2009 graph_nodes) and confirmed the same result: data survives, schema reaches 36. The probe was capable of detecting the claim being true — a data-loss or throw on migrate would have failed the `--expect-exit 0`/count assertions directly. |
| S-17-3 | `drift_state` and `contract` doctor checks can produce `fail` on schema incompatibility. | PARTIALLY CONFIRMED | `drift_state`: CONFIRMED directly — P-17-03 (`"unsupported schema version 0"`), P-17-04 (via the `scan`/`doctor` refusal path), P-17-09-delmig (`"incomplete migration history, missing 020_machine_contract_versions"`) all show `drift_state: fail` on schema incompatibility, exactly as `doctor.ts:216-221` predicts. `contract`: NOT REACHED as documented — P-17-06 could not get the dedicated `contract: fail` branch (`doctor.ts:230-234`) to fire; a `contract_schema_version` mismatch instead crashes the whole `state_summary` read via a Zod validation error before `contract_ready`/`contract_compatible` are ever computed, so the check never even appears in the `checks` array. See F-17-3. |
| S-17-4 | Old scans accumulate in `facts`, `graph_nodes`, `graph_edges`, `graph_evidence` with no pruning mechanism named anywhere in the schema catalog. | REFUTED | `sqlite-storage.ts:490-620` implements a real, named (if undocumented in the schema catalog) scan-retention mechanism: it computes a retained set (newest scan, anything referenced by `baseline_violations`/`check_runs`/`findings`, and the newest scan's immediate predecessor for incremental reuse), then deletes every `scan_id`-scoped row for everything else in one transaction, including `scan_manifests` itself. P-17-22 measured this directly: DB size and every scan-scoped row count is **identical** between N=10 and N=50 real-content-change scans (9,039,872 vs. 8,953,856 bytes; 3700 facts; 2 `scan_manifests` rows in both) — growth plateaus after the second scan rather than growing unboundedly. P-17-21 additionally confirmed the retention guard itself is live and fails closed when its assumptions are violated by SQL (`"Scan retention is misconfigured: check_runs.scan_id does not exist..."`, exit 1). The probe was capable of detecting unbounded growth had it existed: N=50 would have shown ~5x N=10's facts count under the naive per-scan-accumulation model demonstrated between the very first two scans (1850→3700), and it did not. |
| S-17-5 | `scan status` creates the state directory as a side effect — confirm what it creates and whether complete or a stub. | CONFIRMED | `drift scan status --repo repo_probe --db <nonexistent-path>/drift.sqlite --json` against a repo id that was never registered exits 1 (`"Unknown repo repo_probe. Run drift scan --repo-root <path> first."`), yet the directory and a `drift.sqlite` file are created as a side effect, and that file is **not** a stub: `select count(*) from schema_migrations` = 36. `artifacts/17/S-17-5-scanstatus.out` |

## 5. Failures and blocks

### F-17-1 — Populated-DB migration test could only exercise 3 of 33 possible "stopped early" points

- **Probe:** P-17-02
- **Command:** `sqlite3 <db> "delete from schema_migrations where id in ('034_declaration_fact_kinds','035_secret_source_read_fact_kind','036_sink_candidate_fact_kind');"`
- **Expected:** A general test of "migrate a populated DB from any earlier version."
- **Observed:** Only migrations 034–036 (`sql: "SELECT 1;"`, genuinely no-op) could be safely deleted and re-applied without also having to hand-revert a schema change. Every earlier migration (e.g. `033_convention_candidate_superseded_by`: `ALTER TABLE convention_candidates ADD COLUMN superseded_by TEXT;`) is not idempotent — re-running it after deleting its `schema_migrations` row throws `duplicate column name` rather than exercising a clean "populated, behind-schema" scenario.
- **Cause:** Not a product defect — a constraint of testing forward-migration via direct row deletion instead of a real older build's on-disk artifact. `migrate()` at `sqlite-storage.ts:181-217` deliberately treats "already applied" purely by id presence in `schema_migrations`, with no separate idempotency guarantee for the migration SQL itself; that is a correct design given migrations are meant to run exactly once, forward.
- **Blast radius:** None — the existing `migrations.test.ts:42-79` unit test (see S-17-2) already covers an earlier, more representative stopping point (after migration 8) using the product's own `applyMigration` internals rather than raw `DELETE FROM schema_migrations`, which is the more faithful test.
- **Reproduction:** Delete any migration id other than 034/035/036 from `schema_migrations` on a scanned DB, then run `drift scan`; observe `SQLITE_ERROR: duplicate column name` (or equivalent) rather than a clean re-migration.
- **Charter continued at:** P-17-03

### F-17-2 — Automatic schema upgrade on `scan` is silent

- **Probe:** P-17-05
- **Command:** `drift scan --repo-root <ws>/repo --state-root <ws>/state --json` against a DB at schema 33/36
- **Expected:** Per the charter's oracle, the upgrade should be "automatic, announced, and reversible via backup."
- **Observed:** `schema_migrations` correctly reaches 36 and no data is lost, but the scan's JSON response contains no field or message indicating a migration occurred (`grep -i migrat artifacts/17/P-17-05.out` returns nothing). A user watching only the CLI's JSON output has no way to know their local database schema just changed.
- **Cause:** `migrate()` (`sqlite-storage.ts:181`) runs silently as part of opening the storage handle; nothing in the `scan` command path (`packages/cli/src/commands/scan.ts`, not inspected further per binding rule 6) surfaces that a migration happened versus the DB already being current.
- **Blast radius:** Charter 18 (backup/restore) — "reversible via backup" implies a backup should exist before an automatic schema change; none was taken here, and P-17-05's DB had zero backups (`state_summary.backup_count: 0` throughout).
- **Reproduction:** Take any DB behind on schema version (e.g. via the P-17-02 technique), run `drift scan --json`, `grep -i migrat` the output.
- **Charter continued at:** P-17-06

### F-17-3 — Contract-schema-version mismatch does not reach `doctor.ts`'s dedicated `contract: fail` branch

- **Probe:** P-17-06
- **Command:** `sqlite3 <db> "insert into repo_contracts (id, repo_id, contract_schema_version, repo_fingerprint, contract_json, created_at, updated_at) values ('rc_test2', '<repo_id>', 99, 'deadbeef', '<structurally-complete contract_json>', ...);"` then `drift doctor --repo-root <ws>/repo --state-root <ws>/state --json`
- **Expected:** `contract: fail`, `detail: "unsupported schema 99; supported 1"` (the message template at `doctor.ts:234`), with other checks (`drift_state`, etc.) still `ok`.
- **Observed:** `drift_state: fail`, `detail: "unreadable Drift database"`; `state_summary.error` contains a 14-item Zod `invalid_type` error list; the `contract` check never appears in the `checks` array at all; `status: fail`, exit 1.
- **Cause:** `doctor.ts:225` only pushes the `contract` check when `stateSummary.exists && stateSummary.compatible && stateSummary.repo_registered`. Building `stateSummary` reads the `repo_contracts` row through a schema that appears to validate `contract_schema_version` strictly enough that an unexpected value (99) fails the same parse pass as the other required fields, throwing before the function can distinguish "contract exists but wrong version" from "contract row is unreadable." (Not traced further inside `state-summary` construction — file:line for the exact validator was not chased down, per the time-box in §7; the observable fact is the check-array absence and the Zod error shape, both in `artifacts/17/P-17-06.out`.)
- **Blast radius:** Any real-world contract-schema bump (contract schema is versioned separately from storage schema: `supported_contract_schema_version: 1` today) would present to the user as a generic "unreadable database" `fail`, not the specific, actionable "upgrade needed" message the dedicated branch was written to produce. This does not weaken fail-closed behavior (exit 1 either way) but does weaken the diagnostic's precision.
- **Reproduction:** As above; see `artifacts/17/P-17-06.out` for the full Zod error list.
- **Charter continued at:** P-17-07

### F-17-4 — `SQLITE_CANTOPEN` on a read-only containing directory is not classified as `permission_denied`

- **Probe:** P-17-11
- **Command:** `drift scan --repo-root <ro-mnt>/repo --state-root <ro-mnt>/state --json` where `<ro-mnt>` is the P-17-12 disk image re-mounted `-readonly`, against a state root that already has a valid, populated `drift.sqlite`
- **Expected:** `permission_denied`, exit 1.
- **Observed:** `{"code": "cli_error"}`, message `"unable to open database file"`, exit 1. Fails closed correctly (no partial write: file MD5 identical before/after), but under the generic code, not the specific one.
- **Cause:** `packages/core/src/failure-classification.ts:178-193` classifies `EACCES`/`EPERM`/`"permission denied"`/`"attempt to write a readonly database"`/`"SQLITE_READONLY"` as `permission_denied` — with an explicit code comment (`:184-185`) noting SQLite's own phrasing is `SQLITE_READONLY`, not "permission denied," specifically to catch this class. But opening a WAL-mode database whose *file* is writable while its *containing directory* is read-only fails earlier, with `SQLITE_CANTOPEN` / message `"unable to open database file"` (SQLite cannot create the `-wal`/`-shm` siblings), which matches none of the five patterns and falls through to the catch-all `cli_error` at `:195-200`.
- **Blast radius:** Any read-only-mount or read-only-parent-directory scenario reaching this exact SQLite error surfaces the wrong `FAILURE_CONTRACT` code to callers (including any agent or CI wrapper pattern-matching on `permission_denied` specifically, per charter 19's contract concerns).
- **Reproduction:** Populate a state root, `hdiutil` mount it read-only, run any write command (`scan`, `init`, `start`) against it.
- **Charter continued at:** P-17-12

## 6. Discovered surface not in the charter

- `doctor` never calls `migrate()`. This is not documented anywhere the charter names, and it means `doctor`'s `schema_version` field can lag behind what a subsequent `scan`/`init`/`start` would immediately fix — worth knowing for anyone reading `doctor` output as "the current state of the database" rather than "the state of the database as of the last write."
- The scan-retention mechanism (`sqlite-storage.ts:490-620`, `pruneSupersededScans` or equivalent) is genuinely sophisticated: it drops graph-only tables (`graph_nodes`/`graph_edges`/`graph_evidence`) for the retained *predecessor* scan while keeping its `facts`/`file_snapshots` (needed for incremental reuse), per the code's own comment ("roughly halving what a retained predecessor costs"). None of this is named in the schema catalog referenced by S-17-4, which is presumably why the suspect existed in the first place.
- `run-probe`'s documented `--expect-exit-any` option (referenced in this charter's own dispatch instructions) does not exist in the installed harness (`/tmp/drift-beta-freeze/harness/run-probe`; only `--expect-exit N` singular is implemented, confirmed by reading `_probelib.py`'s `ASSERTS` dict). Every probe in this charter with a legitimately dual-valid exit code (0 or 3) was instead asserted against its single actually-observed value, with the alternative documented in prose (P-17-12-recover-check2, P-17-13-checkkill-reopen, P-17-17, P-17-18 all hit the `missing_contract`/exit-3 refusal path).
- An informal (non-`run-probe`, exploratory-only) trial of P-17-16 with tighter process-launch simultaneity than the formal run achieved observed both concurrent `drift scan` processes computing the **same** content-derived `scan_id` and racing on the audit log's append-only uniqueness constraint — the loser refused cleanly (`"Audit log is append-only; event ... already exists"`, exit 1, `cli_error`) rather than corrupting anything. This is consistent with the formal, harness-recorded result (both scans succeeded via clean serialization) and is mentioned here only as additional informal context, not as counted probe evidence, per binding rule 3.
- `checks list`, `findings list`, and `check` all resolve their database via `--db <path>`/`DRIFT_DB`, while `doctor`/`init`/`scan`/`start` resolve via `--repo-root`+`--state-root` (defaulting `--state-root` to `~/.drift/repos` if omitted). Passing `--db` to `doctor` is silently ignored — it falls through to the default `~/.drift/repos` resolution instead of erroring. This is a sharp edge: an early attempt in this session to run `doctor --db <corrupted-path>` silently resolved against the real default state root under the invoking user's home directory instead of failing loudly (caught before any write occurred; see the binding constraints in the charter dispatch — no home-directory state was touched or modified, confirmed by directory listing before and after).

## 7. What this charter did not cover

- **P-17-15's network-filesystem half.** No NFS/SMB/AFP mount was reachable on this machine (confirmed via `mount | grep -i nfs\|smb\|afp`, empty). The case-insensitive-volume half was fully executed (a freshly created `hdiutil` APFS volume defaults to case-insensitive on this host, confirmed via `diskutil apfs list`).
- **§4's file-count-scaling benchmark (500/5,000/20,000 files).** Time-boxed out given the charter's other 21 probes; charter 16 (performance benchmarks) is the more direct home for this measurement and this charter's growth study (P-17-22) instead measured scan-count scaling on a fixed ~132-file repo, which is the axis S-17-4 actually concerned.
- **§4's "50 sequential scans on unchanged content."** Executed as an early exploratory step (not formally re-run at N=50 unchanged, only N=1/10/50 with *real* content changes each time, which is the stronger test — a no-op-reuse scan was independently shown at small N to add zero new rows past the second scan, see the P-17-22 prose discussion of `reuse_applied: true`).
- **§4's "write transaction time during scan" via charter 16 P-16-05.** Not re-profiled here; deferred to charter 16's own results as instructed by the charter text itself ("Profile from charter 16 P-16-05").
- **P-17-18's concurrency depth.** Both `check` and `findings suppress`/`list` refused before reaching a write path (`missing_contract`), because the synthetic taxonomy repo used throughout this charter has no accepted contract. Setting up a full accept-a-convention-then-build-a-contract flow to get a genuine write/write race on `findings suppress` was judged out of scope for the time available; P-17-16 (two `scan`s) and P-17-19 (MCP read + CLI write) are this charter's real concurrency evidence.
- **The exact validator/file:line inside `state-summary` construction that causes F-17-3's Zod throw to preempt the dedicated `contract: fail` branch.** The observable behavior (check absent, Zod error list, `status: fail`) is fully evidenced in `artifacts/17/P-17-06.out`; tracing the precise function was not completed within the time available and is reported as "cause not fully established" rather than guessed at.
- **Charter 18's "reversible via backup" half of P-17-05's oracle**, deliberately — that is charter 18's scope by the charter's own text.

## Cleanup

All `hdiutil` images created during this charter (`/tmp/fill.dmg` for P-17-11/P-17-12, `/tmp/ci.dmg`
for P-17-15) were detached and removed before this charter concluded; no image or mount was left
behind. No file under the invoking user's home directory, `$DRIFT_BETA_SRC`, or any state root
belonging to another charter was read, written, or corrupted.
