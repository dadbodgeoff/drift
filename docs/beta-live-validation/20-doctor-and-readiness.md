# CHARTER 20 — Doctor and readiness

**Depends on:** 01 · **Est. 2 h** · **Output:** `results/20-doctor-and-readiness.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 20 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 20 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 20` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

`drift doctor` is the first command a new user runs and the one a CI setup step leans on. Drive
**every** check to **every** status — `ok`, `warn`, and `fail` — and confirm the aggregate status
and exit code follow. The comment at `doctor.ts:340-346` documents that this exit-code wiring was
itself a fix for a prior defect: *"a failing readiness check reported success … A setup step that
cannot fail cannot gate anything."* This charter verifies the fix holds under live conditions.

## 2. Mechanism under test

`packages/cli/src/commands/doctor.ts:71-349` (`doctorRepo`). Dispatched **before the database
opens** (`run-cli.ts:57-64`).

Checks (`:102-224`), each a `DoctorCheck` with `id`/`label`/`status`/`detail`:
`repo_root`, `engine`, `git`, `repo_identity`, `package_manifest`, `package_manager`, `workspace`,
`typescript_files`, `api_routes`, `local_state`, `disk_space`, `memory_headroom`, `drift_state`.

Conditional block (`:225-284`), only when `stateSummary.exists && compatible && repo_registered`:
`contract`, `scan_freshness`, `audit_integrity`, `backup_artifacts`, `import_coverage`.

Status enum `"ok" | "warn" | "fail"` (`:26`). Aggregate: `failed > 0 ? "fail" : warnings > 0 ?
"warn" : "ok"` (`:285-287`); `exitCode: status === "fail" ? 1 : 0` (`:347`), wired at
`run-cli.ts:57-64`.

**Known `fail` paths** (§20h): `repo_root` when the path is not a directory (`:91,106`); `engine`
when provenance ≠ available (`:116`); `repo_identity` on a shallow clone (`:139-141`);
`disk_space` (`:200`); `memory_headroom` (`:209`); `drift_state` on incompatible schema
(`:216-221`); `contract` on incompatible contract schema (`:230-234`); `audit_integrity` on a
broken hash chain (`:252`); `import_coverage` when the coverage report's own gap count does not
reconcile (`:272-278`).

**Doctor's text and JSON are two independently-authored string-building blocks** reading the same
upstream variables — not one shared render function, unlike `check`, `ask`, and `prepare`
(§22 obs. 20). Divergence is therefore structurally possible and must be tested, not assumed away.

## 3. Procedure

### Drive every check to every status

For each of the 18 checks, construct the conditions for `ok`, for `warn` (where one exists), and
for `fail` (where one exists). Record status, detail text, aggregate status, and exit code.

| Check | How to force `fail` / `warn` |
|---|---|
| `repo_root` | Point at a file, a nonexistent path, an unreadable directory |
| `engine` | Remove, chmod-000, or substitute a wrong-provenance engine binary (charter 01 P-01-07/08) |
| `git` | A directory that is not a git repo; a git repo with no commits; a detached HEAD |
| `repo_identity` | `git clone --depth 1` → shallow-clone `fail` |
| `package_manifest` | No `package.json`; malformed `package.json` |
| `package_manager` | No lockfile → the `unknown` WARN; then add a real `pnpm-lock.yaml` and confirm it **clears** — **§21 records this as never runtime-tested** |
| `workspace` | Same: no workspace config → WARN; real pnpm workspace → clears; monorepo root vs `apps/web` (charter 02 shape D) |
| `typescript_files` | A repo with zero `.ts` files |
| `api_routes` | A repo with zero recognized routes (charter 08 shape C) |
| `local_state` | Unwritable state root |
| `disk_space` | Fill the volume |
| `memory_headroom` | `ulimit -v` / cgroup constraint |
| `drift_state` | A database at an incompatible schema version (charter 17 P-17-04) |
| `contract` | An incompatible contract schema |
| `scan_freshness` | Scan, then modify files |
| `audit_integrity` | Tamper with the hash chain (charter 18 P-18-13) |
| `backup_artifacts` | A corrupt or missing backup artifact |
| `import_coverage` | A coverage report whose gap count does not reconcile — use `test/fixtures/coverage-report-repo` |

### Cross-cutting

| Probe | What to do |
|---|---|
| P-20-01 | For every configuration above, run **both** text and `--json` and diff their content. Given two independently-authored renderers, find every field present in one and absent or different in the other. |
| P-20-02 | Confirm the aggregate status is `fail` iff at least one check is `fail`, and `warn` iff at least one `warn` and no `fail`. |
| P-20-03 | Confirm `exitCode` is 1 iff aggregate is `fail`, and 0 otherwise — including for `warn`. A `warn` exiting 0 is correct per source; confirm it is what a CI setup step actually wants, and record the answer as a fact. |
| P-20-04 | Confirm the five conditional checks (`contract`, `scan_freshness`, `audit_integrity`, `backup_artifacts`, `import_coverage`) appear **only** when `stateSummary.exists && compatible && repo_registered` — and record what a user sees when state exists but the repo is not registered. A check that silently does not run is indistinguishable from one that passed. |
| P-20-05 | Every `warn`/`fail` detail line: does it tell the user what to **do**, and is the suggested action correct? |
| P-20-06 | `doctorNextCommands` (`args/doctor-commands.ts:48-72`) — execute each printed suggestion verbatim in a shell with no `DRIFT_DB`. Charter 03 S-03-1 predicts `audit verify`, `backup list`, and `backup create` all fail. Confirm here from doctor's own surface. |
| P-20-07 | Doctor with **no arguments at all**, in an empty directory, on a machine with no state — the true first-run case. |
| P-20-08 | Doctor on each of charter 02's five repo shapes. Does it predict the dead ends those shapes hit? A readiness check that reports `ok` on a repo that cannot reach a verdict is not measuring readiness. |

## 4. Benchmarks

| Metric | How |
|---|---|
| `doctor` wall time, warm | 20 trials |
| `doctor` wall time vs. repo size | 500 / 5,000 / 20,000 |
| Which check dominates the time | Profile at 20,000 files |

## 5. Oracles

- Every declared status of every check is reachable, or documented as unreachable with a reason.
- Aggregate status and exit code follow the checks, in every combination.
- Text and JSON carry the same facts.
- Doctor's `ok` implies the repo can actually reach a verdict (P-20-08).
- Every suggestion doctor prints works when pasted.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-20-1 | `fail` is genuinely reachable for nine named checks, and the exit code follows — a fix that predates the audit's own commit. | §20h, `doctor.ts:340-346` | The full status grid |
| S-20-2 | Doctor's text and JSON are independently authored, unlike every other multi-surface command. | §22 obs. 20 | P-20-01 |
| S-20-3 | The `Package manager: unknown` / `Workspace: unknown` WARNs were only ever observed against a no-lockfile fixture; whether they clear with a real lockfile was never runtime-confirmed. | §21 | `package_manager`, `workspace` rows |
| S-20-4 | Doctor's own printed next-commands fail when pasted, because `audit` and `backup` do not auto-resolve `--db`. | §18b, §22 obs. 18 | P-20-06 |
| S-20-5 | Five checks run only conditionally, and a skipped check may be indistinguishable from a passing one. | §20h, `doctor.ts:225` | P-20-04 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A check whose `fail` cannot be forced is recorded as
**NOT REACHABLE** with the attempts made.

## 8. Deliverables

`results/20-doctor-and-readiness.md` with the 18-check × {ok, warn, fail} reachability grid and the
text-vs-JSON diff; transcripts under `results/artifacts/20/`.
