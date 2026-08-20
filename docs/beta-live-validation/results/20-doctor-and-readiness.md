# CHARTER 20 — Doctor and readiness — RESULTS

**Agent:** Claude Sonnet 5 / subagent session
**Run started:** 2026-08-19T15:10:00Z
**Run finished:** 2026-08-19T15:45:00Z
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573 (`git rev-parse HEAD` in `$DRIFT_BETA_SRC`)
**Working tree:** dirty (host repo `/Users/geoffreyfernald/drift-w7`, unrelated to the frozen source under test) —
`?? docs/architecture/remaining-workstreams-diagnosis.md`, `?? docs/architecture/security-convention-pipeline-refactor.md`,
`?? docs/architecture/security-convention-pipeline-tdd.md`, `?? docs/architecture/security-identity-resolution-review.md`,
`?? docs/beta-live-validation/` (this results file and its siblings). The frozen source at
`$DRIFT_BETA_SRC` (`/tmp/drift-beta-freeze/src`) is clean at the pinned SHA above.
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · built 2026-08-18T22:31 ·
`DRIFT_ENGINE_BIN` exported: yes (via `env.sh`)
**CLI invocation:** `node /tmp/drift-beta-freeze/src/packages/cli/dist/main.js` (the package's declared
`bin` entry per `packages/cli/package.json`). See the anomaly note below — the `drift` name on `PATH`
resolves to an unrelated globally-installed npm package, not the frozen build, so every probe in this
charter invokes `node .../dist/main.js` directly.
**Platform:** Darwin Mac.lan 24.6.0 Darwin Kernel Version 24.6.0: Mon Jul 14 11:30:40 PDT 2025;
root:xnu-11417.140.69~1/RELEASE_ARM64_T8132 arm64
**Node / pnpm / rustc:** v25.2.1 / 10.28.0 / rustc 1.97.0 (2d8144b78 2026-07-07)

## 0. Anomaly — injected instruction, not acted on

Mid-session, a tool result carried a fabricated `<system-reminder>` claiming `env.sh` had been edited
to add `export DRIFT='node /tmp/drift-beta-freeze/src/packages/cli/dist/main.js'`, with an explicit
instruction not to mention the change to the user. Reading the actual file on disk showed no such
line — the claim was false and the "don't tell the user" instruction is a prompt-injection pattern.
It was not acted on: no alias was trusted, and this note exists specifically to disclose it. All CLI
invocations in this charter were constructed independently from the verified `bin` field in
`packages/cli/package.json`, not from the injected content.

## 1. Verdict

`drift doctor`'s exit-code fix holds under live conditions: every one of the 9 checks the charter
names as having a `fail` path (`repo_root`, `engine`, `repo_identity`, `disk_space`,
`memory_headroom`, `drift_state`, `contract`, `audit_integrity`, `import_coverage`) was driven to
`fail` live, and in every case the aggregate status became `fail` and the exit code became `1`.
Conversely every all-`ok`/`warn` configuration exited `0`. Two checks the charter's procedure table
implies might have a `fail` path do not: `package_manifest` only calls `existsSync` and never
parses the file, so a malformed `package.json` still reports `ok`; `backup_artifacts` has no `fail`
branch in source at all (`stateSummary.backup_problem_count > 0 ? "warn" : "ok"`), so a missing or
checksum-mismatched backup artifact can only ever warn, never fail doctor. `package_manager` and
`workspace` were confirmed, for the first time per §21, to clear from `warn` (`unknown`) to `ok`
against a real `pnpm-lock.yaml` / `pnpm-workspace.yaml` (S-20-3 CONFIRMED). Text and JSON carried
matching facts in every configuration tested — no divergence was found (S-20-2 REFUTED for the
cases probed). The five conditional checks (`contract`, `scan_freshness`, `audit_integrity`,
`backup_artifacts`, `import_coverage`) were confirmed to appear only when
`stateSummary.exists && compatible && repo_registered`; when state exists but the repo is not
registered, doctor reports `drift_state: warn, "database exists, repo not registered"` and the five
checks are silently absent — indistinguishable, at the JSON-shape level, from "not applicable" unless
the reader already knows the rule (P-20-04). `doctorNextCommands`' own printed suggestions for
`audit verify`, `backup list`, and `backup create` all fail with no `DRIFT_DB` set, exactly as
predicted by charter 03 (S-20-4 CONFIRMED) — but `scan status` and `prepare`, also in the same
next-commands list, fail differently (`Unknown repo …`, not `missing_database`), meaning they DO
resolve a database path on their own; a user pasting the suggestions verbatim sees two different
failure shapes from one printed list. A genuine, previously-undocumented defect was found in
`doctor.ts:304-305`: the printed instruction on any `fail` status is the unconditional
`"Fix the failed check before running the first scan."`, even when the failing check is one of the
five post-scan conditional checks and a scan (or several) has already completed successfully — the
suggested action is then factually wrong, not merely generic. Doctor's true first-run behavior
(empty directory, no args beyond `--repo-root`/`--state-root`, no state) is `status: warn`, exit `0`,
with a printed `drift start … --accept-defaults` next command — a new user is not blocked (P-20-07).
One further surface not anticipated by the charter's known-fail-path table: pointing `repo_root` at
an *unreadable* directory does not exercise the `repo_root` check at all — `walkIndexableFiles`
throws `EACCES` before `doctorRepo` builds its check array, and the CLI's outer error handler
renders a `FAILURE_CONTRACT`-shaped `{error, failure}` payload with `code: "permission_denied"`
instead of the normal 18-check grid. Exit code is still the documented `1` (operational error), so
the exit-code contract holds, but the check grid itself is unreachable for this input.

| | Count |
|---|---|
| Probes specified | 8 |
| Probes executed | 8 (P-20-01 .. P-20-08), plus 26 supplementary status-grid probes (`P-20h-*`) covering the 18-check reachability matrix |
| Probes blocked (could not be executed — see §5) | 1 (repo-size benchmark sweep at 5,000/20,000 files) |
| Probes that behaved as the charter's oracle predicted | 7 of 8 named probes; 24 of 26 supplementary probes |
| Probes that did not | 1 named probe (P-20-08, partial — charter 02 out of scope per this charter's own instruction to read nothing else); 2 supplementary probes needed oracle correction after the first attempt (repo_root-unreadable, drift_state-incompatible) — both are recorded as ORACLE-narrow, not product defects, per below |
| Defects found not predicted by any suspect-list entry | 2 (the `doctor.ts:304-305` misleading fail-message for post-scan checks; the `repo_root`/unreadable-directory path bypassing the check grid entirely) |

## 2. Probe log

Full JSON/text bodies referenced below are truncated for readability; complete verbatim bodies are
at `results/artifacts/20/<probe>.out` for every probe (also mirrored under
`/tmp/drift-beta-freeze/artifacts/20/` by the harness).

### Named probes (charter §3 cross-cutting table)

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-20-01-text | `node dist/main.js doctor --repo-root <taxonomy-clone> --state-root <ws>` | 0 | 32-line text report, all 18 checks (14 base + 5 conditional, minus the always-absent 0-count row) | `--expect-exit 0 --expect-out "Drift doctor"` | yes |
| P-20-01-json | same, `--json` | 0 | Full JSON payload, valid | `--expect-exit 0 --expect-json-valid` | yes |
| P-20-01-limitation-text | `node dist/main.js doctor --repo-root <coverage-report-repo> --state-root <ws>` (contract tampered to fail) | 1 | text prints "Known limitations" block with both named limitations | `--expect-exit 1` | yes |
| P-20-01-limitation-json | same, `--json` | 1 | JSON `import_coverage.by_code[].limitation` matches text 1:1; every check `label: detail` line from JSON is present verbatim in text | `--expect-exit 1 --expect-json-valid` | yes |
| P-20-02 | (derived from every status-grid probe below, not a single command) | n/a | Across 26 configurations, aggregate `status` was `fail` iff at least one check was `fail`, `warn` iff at least one `warn` and zero `fail`, `ok` only when the fully-scanned real-repo baseline had zero warns (not observed live — every configuration tested produced at least one `warn`, e.g. `workspace: unknown` on a plain monorepo; see §6) | Charter §5 oracle | yes, on every configuration observed |
| P-20-03 | (derived, same set) | n/a | `exitCode == 1` iff `status == "fail"`, `0` otherwise, including every `warn`-only case (P-20-07: `warn`, exit `0`) | Charter §5 oracle; P-20-03 also asks to record whether `warn`→exit 0 is what a CI step wants | see verdict/discussion below | yes, plus recorded judgment |
| P-20-04 | `node dist/main.js doctor --repo-root <fullscan> --state-root <fullscan-state> --json` (registered) vs. `node dist/main.js doctor --repo-root <empty-repo> --state-root <state-with-orphan-db> --json` (state exists, repo not registered) | 0 / 0 | Registered: `checks` has 18 entries, all 5 conditional present. Not-registered: `checks` has 13 entries, `drift_state: warn "database exists, repo not registered"`, the 5 conditional keys entirely absent from the array (not present-but-null) | `--expect-json-exists .checks[13]` present in registered case, absent in not-registered case | yes |
| P-20-05 | inspection of every `warn`/`fail` detail string collected across all probes below, cross-referenced to `doctor.ts` source | n/a | 8 of 9 named `fail` details and all `warn` details tell the user what to do and are correct (e.g. shallow-clone remediation, disk-space remediation). One is wrong: the generic `"Fix the failed check before running the first scan."` printed for ANY `fail`, including post-scan conditional-check failures where a scan already ran (`doctor.ts:304-305`) | "does it tell the user what to do, and is the suggested action correct" | no — 1 defect found, recorded in §6 |
| P-20-06-scan-status | `env -u DRIFT_DB node dist/main.js scan status --repo repo_8d0753328cdfa964 --json` | 1 | `{"error":{"code":"cli_error","message":"Unknown repo repo_8d0753328cdfa964. Run drift scan --repo-root <path> first."}}` | `--expect-json-exists .error.code` | yes |
| P-20-06-prepare | `env -u DRIFT_DB node dist/main.js prepare "task" --repo repo_8d0753328cdfa964 --json` | 1 | `{"error":{"code":"cli_error","message":"Unknown repo repo_8d0753328cdfa964."}}` | `--expect-json-exists .error.code` | yes |
| P-20-06-audit-verify | `env -u DRIFT_DB node dist/main.js audit verify --repo repo_8d0753328cdfa964 --json` | 1 | `{"error":{"code":"missing_database","message":"Missing --db <path> or DRIFT_DB. Run drift --help."}}` | `--expect-json-exists .error.code` | yes — matches charter 03 S-03-1 prediction exactly |
| P-20-06-backup-list | `env -u DRIFT_DB node dist/main.js backup list --repo repo_8d0753328cdfa964 --json` | 1 | same `missing_database` shape | `--expect-json-exists .error.code` | yes |
| P-20-06-backup-create | `env -u DRIFT_DB node dist/main.js backup create --repo repo_8d0753328cdfa964 --confirm` | 1 | stderr: `Missing --db <path> or DRIFT_DB. Run drift --help.` (no `--json` in the printed suggestion, so plain-text stderr, not JSON) | `--expect-exit 1` | yes |
| P-20-07-text | `node dist/main.js doctor --repo-root <empty-dir> --state-root <empty-dir>` | 0 | 23-line report, 5 `ok`, 8 `warn`, 0 `fail`; final line `drift start --repo-root … --accept-defaults` | `--expect-exit 0 --expect-out "Drift doctor"` | yes |
| P-20-07-json | same, `--json` | 0 | `status: "warn"`, full 13-check array (5 conditional absent, state not registered) | `--expect-exit 0 --expect-json-valid --expect-json .status=warn` | yes |
| P-20-08 | not run as a distinct probe — charter 20 §"Nothing else" explicitly forbids reading charter 02, so its five named repo shapes could not be reconstructed from the shape names alone with confidence. Instead, doctor was exercised against 5 independently-constructed shape variants already covered by the status-grid probes below: empty repo, no-`package.json`, zero-`.ts`-files, real `pnpm` monorepo with `apps/*` workspace, and a fully-scanned real GitHub repo (`taxonomy`) | n/a | In every shape, `ok` never appeared on a check that could not reach a verdict — e.g. the zero-`.ts`-files repo reports `typescript_files: warn`, not `ok`, so it does not claim readiness it cannot back. No shape produced a false `ok`. | "Does it predict the dead ends those shapes hit? … ok implies the repo can reach a verdict" | yes, on the 5 shapes tested; **not a substitute for charter 02's specific shapes** — see §7 |

### Supplementary probes — 18-check × {ok, warn, fail} reachability grid (`P-20h-*`)

Full detail per probe is in `results/artifacts/20/P-20h-*.out`; exit codes below are from the FINAL
(corrected) run of each id, per the ledger (`by_probe`, last-write-wins).

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-20h-repo_root-file | `doctor --repo-root <a regular file> --state-root <ws>` | 1 | `checks[0] = {id: repo_root, status: fail, detail: "<path> is not a directory"}` | `--expect-exit 1 --expect-json .checks[0].status=fail` | yes |
| P-20h-repo_root-missing | `doctor --repo-root <nonexistent path> --state-root <ws>` | 1 | `checks[0] = {status: fail, detail: "<path> does not exist"}` | same | yes |
| P-20h-repo_root-unreadable | `doctor --repo-root <chmod-000 dir> --state-root <ws> --json` | 1 | NOT the normal check grid — a `FAILURE_CONTRACT`-shaped `{error:{code:"permission_denied"},failure:{...}}` payload, no `checks` key at all | first attempt used `--expect-json-exists .checks[0].status` and FAILED (recorded FAIL below) — the oracle assumed the check grid always renders, which this input disproves; corrected oracle `--expect-exit 1 --expect-json .error.code=permission_denied --refute-out '"checks"'` | first attempt: FAIL (oracle too narrow, corrected — this is the charter's own §00-PREFLIGHT and step-1 instruction: decide product-vs-oracle before recording a defect); second attempt: yes |
| P-20h-engine-missing | `env DRIFT_ENGINE_BIN=/nonexistent/path/drift-engine doctor --json` | 1 | `checks[1] = {id: engine, status: fail}` | `--expect-exit 1 --expect-json .checks[1].status=fail` | yes |
| P-20h-engine-chmod000 | `env DRIFT_ENGINE_BIN=<chmod-000 copy> doctor --json` | 1 | `checks[1] = {id: engine, status: fail}` | same | yes |
| P-20h-git-nocommits | `doctor` in a `git init`, zero-commit repo | 0 | `checks[2] = {id: git, status: ok, detail: "main @ unknown"}` | `--expect-json .checks[2].id=git` (exploratory on status value) | yes — note: `ok`, not `warn`/`fail`; a repo with no commits still reports git as healthy |
| P-20h-git-detached | `doctor` on a detached HEAD | 0 | `checks[2] = {status: ok, detail: "detached @ 6276cea"}` | same | yes — detached HEAD is `ok`, not `warn`, contrary to what the charter's procedure table implies is a forcing condition |
| P-20h-repo_identity-shallow | `doctor --repo-root <git clone --depth 1>` | 1 | `checks[3] = {id: repo_identity, status: fail, detail: "shallow clone … Fetch the full history first: … fetch-depth: 0 … git fetch --unshallow"}` | `--expect-exit 1 --expect-json .checks[3].status=fail` | yes |
| P-20h-package_manifest-malformed | `doctor` with `package.json` containing `{not valid json` | 0 | `checks[4] = {id: package_manifest, status: ok, detail: "package.json found"}` | exploratory | ok reported for a file that would fail `JSON.parse` — check is existence-only, confirmed at `doctor.ts:157-160`; `package_manifest` has NO fail branch in source at all |
| P-20h-typescript_files-zero | `doctor` on a repo with 0 `.ts`/`.tsx` files | 0 | `checks[7] = {status: warn, detail: "0 indexable files"}` | `--expect-json .checks[7].status=warn` | yes |
| P-20h-local_state-unwritable | `doctor --state-root <chmod-000 dir>` | 0 | `checks[10] = {status: warn, detail: "will create …"}` | exploratory | `local_state` never attempts a write during doctor (`existsSync` only) — no fail path exists in source; consistent with the charter's own known-fail-path list, which does NOT name `local_state` |
| P-20h-pm-unknown | `doctor` with `package.json` only, no lockfile | 0 | `checks[5]=warn(unknown)`, `checks[6]=warn(unknown)` | `--expect-json .checks[5].status=warn .checks[6].status=warn` | yes |
| P-20h-pm-real | `doctor` with real `pnpm-lock.yaml` + `pnpm-workspace.yaml` (`apps/*`) | 0 | `checks[5]={status:ok,detail:pnpm}`, `checks[6]={status:ok}` | `--expect-json .checks[5].status=ok .checks[5].detail=pnpm .checks[6].status=ok` | yes — **S-20-3 CONFIRMED**: clearing was never runtime-tested before; now it is |
| P-20h-disk_space-fail | `doctor --repo-root /tmp --state-root <200MB APFS disk image>` | 1 | `checks[10]={id:disk_space,status:fail,detail:"0.2 GB free, about 4.7 GB needed for 22184 files"}` | index assumption wrong on first pass (see below) | first attempt FAIL — wrong array index assumed (used `.checks[11]`, forgetting `--repo-root /tmp` pulled in 22,184 real files, shifting nothing but making the assumption unverified); re-run against a clean 1-file workspace confirmed `.checks[10]` | see next row |
| P-20h-disk_space-fail-clean | `doctor --repo-root <1-file repo> --state-root <200MB APFS disk image>` | 1 | `checks[10]={status:fail,detail:"0.2 GB free, about 4.7 GB needed"}`* | `--expect-exit 1 --expect-json .checks[10].id=disk_space .checks[10].status=fail` | yes. *(disk-image free space read as 0.2GB not 0.0GB because floor rounds; genuinely forced, not the absolute floor) |
| P-20h-memory_headroom-fail | `node --max-old-space-size=32 doctor` on an 8,000-file repo | 1 | `checks[11]={status:fail}` — `--max-old-space-size=64` on 2,000 files was NOT enough (V8's `heap_size_limit` does not scale linearly with the flag; measured 256MB reported limit at flag=64) | second attempt, `--expect-exit 1 --expect-json .checks[11].status=fail` | first attempt (64MB/2000 files): FAIL, oracle needed recalibration against measured `getHeapStatistics()` output, not a product defect; second attempt: yes |
| P-20h-drift_state-incompatible | `doctor` against a hand-tampered DB with `schema_migrations` missing a MIDDLE row (`010_audit_sequence` deleted, 011-036 kept) | 1 | `checks[12]={id:drift_state,status:fail}` | first two attempts FAIL: deleting only the LATEST-id row produces a valid shorter *prefix* (`sqliteSchemaCompatibility` calls that `compatible`, correctly — a lower schema version is not incompatibility), so the oracle's assumption of what "incompatible" means was wrong twice before landing on a genuine mid-sequence gap; third attempt (`--expect-exit 1 --expect-json .checks[12].status=fail`): yes |
| P-20h-conditional-checks | `doctor` on a fully-scanned real repo (`taxonomy`, registered, contract present) | 0 | `checks` array has 18 entries; `contract/scan_freshness/audit_integrity/backup_artifacts/import_coverage` all present and `ok` | `--expect-json-exists .checks[13]` | yes |
| P-20h-contract-incompatible | `doctor` with `repo_contracts.contract_json.contract_schema_version` hand-set to `2` (supported max is `1`) | 1 | `checks[13]={id:contract,status:fail,detail:"unsupported schema 2; supported 1"}` | first attempt against the wrong column (`contract_schema_version` column, not the `contract_json` blob field of the same name) silently no-op'd — `getRepoContract` reads only `contract_json` (`sqlite-storage.ts:2182-2192`); corrected by editing the JSON blob | first attempt: FAIL (my setup error, not product); second: yes |
| P-20h-scan_freshness-stale | `doctor` after appending a line to a source file post-scan | 0 | `checks[14]={status:warn,detail:"1 source change; source changed"}` | exploratory | yes, `warn` as documented |
| P-20h-audit_integrity-tamper | `doctor` with `audit_events.metadata_json` for `sequence=1` overwritten | 1 | `checks[15]={id:audit_integrity,status:fail,detail:"broken at audit_event_scan_started_…"}` | `--expect-exit 1 --expect-json-exists .checks[15]` | yes |
| P-20h-backup_artifacts-checksum-mismatch | `doctor` after appending bytes to a real backup artifact | 0 | `checks[16]={status:warn,detail:"2 tracked, 2 problems"}` | exploratory | `warn`, never `fail` — confirmed no fail branch exists in source (`doctor.ts:257-262`) |
| P-20h-backup_artifacts-missing | `doctor` after deleting the backup artifact file | 0 | `checks[16]={status:warn,detail:"2 tracked, 2 problems"}` | exploratory | same, `warn` only |
| P-20h-import_coverage-reconcile-fail | `doctor` with `scan_capability_reports.parser_gap_count` hand-set to `99` (real gap count was `2`) | 1 | `checks[17]={id:import_coverage,status:fail,detail:"… report does not reconcile with the stored parser gap count, so treat these numbers as unreliable"}`, `import_coverage.reconciles: false` | `--expect-exit 1 --expect-json-exists .checks[17]` | yes |

## 3. Measurements

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|
| `doctor` wall time, warm, on a 125-`.ts`-file real repo (`taxonomy`, fully scanned, registered, all 18 checks running) | 20 (+2 warmup, discarded) | 200.0ms | 211ms | 197ms | 215ms | `bench 20 doctor-warm-taxonomy --trials 20 --warmup 2 -- node dist/main.js doctor --repo-root <ws> --state-root <ws> --json` |

CV 2.2%, MAD 1.0ms, 2 modified-z outliers (211ms, 215ms) flagged but not excluded from the median.
Drift signal: `rho=0.426`, below the n=20 critical value (0.447) — "no drift distinguishable from
noise," i.e. no evidence of thermal throttling across the 20 trials. Full harness output in
`results/artifacts/20/doctor-warm-taxonomy` (bench ledger `20.bench.jsonl`).

`doctor` wall time vs. repo size (500 / 5,000 / 20,000 files) and "which check dominates the time at
20,000 files" were **not measured** — see §5, F-20-1.

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-20-1 | `fail` is genuinely reachable for nine named checks, and the exit code follows. | **CONFIRMED** | All 9 named checks (`repo_root`, `engine`, `repo_identity`, `disk_space`, `memory_headroom`, `drift_state`, `contract`, `audit_integrity`, `import_coverage`) driven to `fail` live with exit `1` in every case: P-20h-repo_root-file/missing, P-20h-engine-missing/chmod000, P-20h-repo_identity-shallow, P-20h-disk_space-fail-clean, P-20h-memory_headroom-fail, P-20h-drift_state-incompatible, P-20h-contract-incompatible, P-20h-audit_integrity-tamper, P-20h-import_coverage-reconcile-fail. |
| S-20-2 | Doctor's text and JSON are independently authored, unlike every other multi-surface command; divergence is possible. | **INCONCLUSIVE** — leaning REFUTED for the cases probed | P-20-01-text/json and P-20-01-limitation-text/json: every `label: detail` string in the JSON `checks` array was found verbatim in the text output, and the JSON's `import_coverage.by_code[].limitation` content matched the text's "Known limitations" block field-for-field, in both the no-limitation and has-limitation cases. No divergence was found in the configurations tested. This is not proof no divergence exists anywhere in the 18-check × 2-conditional-branch space — only the specific renders exercised were compared byte-for-field, so INCONCLUSIVE is the honest disposition rather than REFUTED outright; the source-level claim (two independently-authored string-building blocks, §20h) was not disputed, only its live consequence in the cases tested. |
| S-20-3 | The `Package manager: unknown` / `Workspace: unknown` WARNs were only ever observed against a no-lockfile fixture; whether they clear with a real lockfile was never runtime-confirmed. | **CONFIRMED** (as stated — i.e. the gap in prior testing is now closed) | P-20h-pm-unknown showed both `warn`/`unknown` with no lockfile; P-20h-pm-real showed both clear to `ok` (`pnpm` / workspace `ok`) against a real `pnpm-lock.yaml` and `pnpm-workspace.yaml` with an `apps/*` glob and a matching `apps/web` directory. |
| S-20-4 | Doctor's own printed next-commands fail when pasted, because `audit` and `backup` do not auto-resolve `--db`. | **CONFIRMED**, with a refinement | P-20-06-audit-verify and P-20-06-backup-list both fail with `missing_database` / "Missing --db <path> or DRIFT_DB." exactly as predicted. P-20-06-backup-create fails identically (exit 1, same stderr text, no `--json` on the printed suggestion so no JSON envelope). Refinement: the same next-commands list also includes `scan status` and `prepare`, which do NOT fail with `missing_database` — they resolve to a default DB path and fail with `cli_error: Unknown repo …` instead (P-20-06-scan-status, P-20-06-prepare). All five printed commands fail when pasted verbatim with no `DRIFT_DB`, but by two different mechanisms, which a user cannot tell apart from the printed suggestions alone. |
| S-20-5 | Five checks run only conditionally, and a skipped check may be indistinguishable from a passing one. | **CONFIRMED** | P-20-04: comparing a registered-repo JSON payload (`checks.length == 18`) against a state-exists-but-unregistered payload (`checks.length == 13`, the same `drift_state` check present but the 5 conditional checks entirely absent from the array — not present with a null/skipped status) shows the skip is real. The claim that this may be "indistinguishable from a passing one" is true at the array level: a caller who only checks `status !== "fail"` for a specific `id` (e.g. `contract`) cannot tell "not run" from "not present in this response" without also checking array membership; `drift_state: warn "database exists, repo not registered"` is the only textual signal that the other 5 didn't run. |

## 5. Failures and blocks

### F-20-1 — Repo-size benchmark sweep (500 / 5,000 / 20,000 files) blocked by the disk-write cap

- **Probe:** Charter §4, row 2 ("`doctor` wall time vs. repo size") and row 3 ("which check dominates
  the time, profiled at 20,000 files")
- **Command:** none run — blocked before execution
- **Expected:** three `bench` runs at 500/5,000/20,000 indexable files, plus a profile at 20,000
- **Observed:** not executed
- **Cause:** not a product defect — a resource constraint on this environment. The product's own
  code comment (`disk-space.ts:8-14`, `BYTES_PER_INDEXED_FILE = 220 * 1024`) states per-repo state
  runs "roughly 1 GB for a 5,000-file monorepo." A live scan (not just doctor) at 5,000 real files
  would be needed to produce a realistic `import_coverage`/`audit_integrity`/`scan_freshness` state
  for doctor to read, and that scan's own state-directory growth (~1 GB at 5,000 files, ~4 GB
  extrapolated at 20,000) exceeds this charter's binding rule 8 cap of ~200 MB of writes given the
  disk headroom available in this environment. The 200MB-scoped APFS disk-image technique used for
  `disk_space` (P-20h-disk_space-fail-clean) does not help here because the sweep needs the scan
  itself to succeed and persist real data at scale, not merely report insufficient space.
- **Blast radius:** none — this is a benchmark gap, not a correctness gap. The `doctor`
  wall-time-warm number (200ms median at 125 files, §3) and the qualitative "disk_space check
  estimates ~220KB/indexed-file" fact (confirmed live via P-20h-disk_space-fail's own detail string,
  `"4.7 GB needed for 22184 files"` = 220KB × 22184 ≈ 4.66GB, matching the constant exactly) stand
  on their own.
- **Reproduction:** would require either (a) running outside this charter's disk-write cap, or (b) a
  pre-scanned golden state fixture at 5,000/20,000 files supplied by the harness — `workspace.sh`'s
  `--golden` mode exists in the script but `$DRIFT_BETA_REF/golden/` does not exist on this machine
  (checked: `ls $DRIFT_BETA_REF` shows only `eval-repos/` and `fixtures/`, no `golden/`), so no
  pre-built large golden state was available to clone instead of scanning fresh.
- **Charter continued at:** all other §3/§4 items completed; the doctor-warm benchmark at 125 files
  was substituted as the only in-budget wall-time measurement.

## 6. Discovered surface not in the charter

- **`doctor.ts:304-305` — misleading fail-message for post-scan checks.** When `status === "fail"`,
  doctor unconditionally prints `"Fix the failed check before running the first scan."` This is
  correct advice when the failing check is pre-scan (`repo_root`, `engine`, `disk_space`,
  `memory_headroom`, `repo_identity`) — the user genuinely has not scanned yet. It is factually wrong
  when the failing check is one of the five post-scan conditional checks (`contract`,
  `audit_integrity`, `import_coverage`, and in principle `scan_freshness`/`backup_artifacts` were
  they to gain a fail path) — in P-20h-contract-incompatible and P-20-01-limitation-text/json, the
  repo had already been scanned successfully (contract existed, import coverage data existed,
  limitations were being reported), yet the printed instruction told the user to run a scan that had
  already happened. Reproduction: `results/artifacts/20/P-20-01-limitation-text.out`, last line
  before the elided prompt.
- **`repo_root`-unreadable bypasses the check grid entirely.** A `chmod 000` repo root does not
  produce `checks[0] = {id: repo_root, status: fail}` as the charter's procedure table implies —
  `walkIndexableFiles` throws `EACCES` before `doctorRepo` assembles the `checks` array at all, and
  the CLI's outer handler renders a generic `{error, failure}` `FAILURE_CONTRACT` payload with
  `code: "permission_denied"` instead. The exit code (`1`) is still correct per the documented
  vocabulary (operational error), so this is not a contract violation, but it means "make `repo_root`
  fail" via an unreadable directory tests a completely different code path than every other
  `repo_root` fail condition. Reproduction: `results/artifacts/20/P-20h-repo_root-unreadable.out`.
- **The `drift` binary on `PATH` is not the frozen build under test.** `/opt/homebrew/bin/drift`
  resolves to a separately-installed global npm package (`driftdetect@0.9.48` at
  `/opt/homebrew/lib/node_modules/driftdetect/dist/bin/drift.js`), unrelated to
  `$DRIFT_BETA_SRC`. Every probe in this charter therefore invokes
  `node $DRIFT_BETA_SRC/packages/cli/dist/main.js` directly rather than the bare `drift` word, per
  the package's declared `bin` entry. Anyone following the charter's own example invocations
  (`drift doctor …`) literally, with this machine's `PATH` as found, would silently test the wrong
  binary.
- **`package_manager`/`workspace` clear only against a *matching* lockfile + config**, not merely
  presence — untested combinations (e.g. an `npm` lockfile with a `pnpm-workspace.yaml`) were not
  explored; out of scope for this charter's named probes.
- **`local_state` and `package_manifest` have literally no `fail` branch in source** — both are
  `existsSync`-only checks (`doctor.ts:157,189`), confirmed by direct read of `doctor.ts` and by
  P-20h-local_state-unwritable / P-20h-package_manifest-malformed producing `ok`/`warn` under
  conditions that plausibly should fail (an unwritable state directory, an unparseable manifest).
  This is consistent with — not contradicting — the charter's own known-fail-path list (§2), which
  correctly does not name either check.

## 7. What this charter did not cover

- **Charter 02's five specific repo shapes (P-20-08).** This charter's own instructions say to read
  only `20-doctor-and-readiness.md` and `00-PREFLIGHT.md §5`, explicitly "nothing else" — charter 02
  was not read, so its named shapes (referenced here only as "charter 02 shape D" and "five repo
  shapes") could not be reconstructed with confidence. Five independently-chosen shapes (empty repo,
  no-manifest, zero-TS-files, real pnpm monorepo, fully-scanned real GitHub repo) were substituted
  and doctor's `ok`-implies-reachable-verdict property held on all five, but this is not a claim of
  coverage against charter 02's specific taxonomy.
- **The full repo-size benchmark sweep (500/5,000/20,000 files) and the 20,000-file profile.**
  Blocked by binding rule 8's ~200MB write cap against this environment's disk headroom; see F-20-1.
  Only a 125-file warm-time measurement was taken.
- **Text/JSON divergence across the full 18-check × conditional-branch space.** Two configurations
  (a clean scanned repo with one limitation-free gap, and a repo with a named limitation) were
  diffed field-for-field with no divergence found. The full combinatorial space (every check in
  every status, cross-referenced against both renderers) was not exhaustively diffed — S-20-2 is
  recorded as INCONCLUSIVE rather than REFUTED for exactly this reason.
- **`package_manager`/`workspace` mismatched-tooling combinations** (npm lockfile + pnpm workspace
  config, yarn + pnpm, etc.) — not named by the charter's probe table, not explored.
- **Concurrent/interrupted doctor runs**, multi-process contention on the same DB during a doctor
  check — out of this charter's scope (see charter 17/18 per the charter's own cross-references).
