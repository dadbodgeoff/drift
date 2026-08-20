# CHARTER 01 — Install and packaging

**Depends on:** 00 · **Est. 2 h** · **Output:** `results/01-install-and-packaging.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 01 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 01 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 01` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Determine whether the artifact a beta user actually obtains — a packed tarball, not this working
tree — installs and runs on a machine that has never built Drift. Everything else in this program
tests a repo checkout; this charter tests the product.

## 2. Scope

**In.** `npm pack` / `pnpm pack` of `@drift/cli` and `@drift/mcp`; the five platform engine-binary
carrier packages and their `optionalDependencies` wiring; global install; `drift` and `drift-mcp`
on `PATH`; first invocation with no state anywhere; engine binary discovery when
`DRIFT_ENGINE_BIN` is **not** set.

**Out.** Anything the CLI does after it successfully starts (charters 02, 03).

## 3. Preconditions

A clean install target. Preferably a container or a fresh user account — at minimum, a shell with
`DRIFT_ENGINE_BIN` unset, no `DRIFT_DB`, and no `~/.drift` (or whatever the default state root
resolves to; establish it and record it).

## 4. Procedure

| Probe | What to do |
|---|---|
| P-01-01 | `pnpm pack` each publishable package. Record every tarball's name, size, and file list (`tar tzf`). |
| P-01-02 | Inspect the CLI tarball for files that should not ship: test fixtures, `.env`, source maps pointing outside the package, the 92-dir `test/fixtures` tree, any absolute path from the build machine. `grep -r` the extracted tarball for the builder's home directory string. |
| P-01-03 | Install the CLI tarball globally into the clean target. Record the exact command and every warning npm/pnpm emits. |
| P-01-04 | `which drift`, `drift --version`, `drift --version --json`. Record `storage_schema_version` — **36** as of `a0517f3e` (`035_secret_source_read_fact_kind`, `036_sink_candidate_fact_kind` landed with S6). If it differs, that is charter 17's baseline: record and continue. |
| P-01-05 | `drift capabilities` and `drift capabilities --json`. This is one of four commands that runs before the database opens (`run-cli.ts:46-82`); it must work with no state at all. |
| P-01-06 | `drift doctor` with no repo, no state, no engine env var. Record every check's status and the exit code. The `engine` check is the one under test: does the installed CLI find its platform's engine binary through `optionalDependencies` without help? |
| P-01-07 | Deliberately break engine resolution — rename or chmod-000 the resolved binary — and rerun `drift doctor` and `drift scan`. Confirm the failure is a stated refusal (`missing_engine`, exit 3) and not a stack trace. |
| P-01-08 | Confirm the engine binary's provenance check: what does the CLI do with a binary of the right name but the wrong version or wrong contents? (`scripts/validate-engine-release-matrix.mjs` and `scripts/engine-handshake.mjs` describe the intended handshake; drive it live.) |
| P-01-09 | Install `@drift/mcp`. `drift-mcp` with no `--db` must print `Missing --db <path> or DRIFT_DB for drift-mcp.` and exit **1** (`packages/mcp/src/index.ts:826-829`). Confirm exactly that string and code. |
| P-01-10 | Uninstall cleanly. Record anything left behind on disk. |
| P-01-11 | Re-run P-01-03 through P-01-06 on a second platform if one is available (the release matrix names darwin-arm64, darwin-x64, linux-arm64-gnu, linux-x64-gnu, win32-x64). If only one platform is available, say so in §7 rather than implying coverage. |

## 5. Benchmarks

| Metric | n | How |
|---|---|---|
| Tarball size per package | 1 | `ls -l` |
| Cold install wall time | 5 | `time` the install into a fresh prefix each trial |
| `drift --version` cold start | 20 | First invocation after install; this is the floor on every other command's latency |
| `drift doctor` on an empty dir | 10 | The realistic first command a user types |

Report median and p95. A cold start above ~1 s is a beta-relevant fact regardless of whether it is
"acceptable" — record the number, not a judgment.

## 6. Oracles

- Every packed tarball contains only what a consumer needs to run.
- `drift --version --json` parses as JSON and carries `storage_schema_version`.
- With no state and no repo, `doctor` and `capabilities` succeed; every other command fails with a
  stated reason and a documented exit code, never a stack trace.
- A missing or unusable engine produces `missing_engine` / exit 3, not a crash and not a silent
  degraded run.

## 7. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-01-1 | The five engine carrier packages are empty binary carriers consumed as `optionalDependencies`; if the platform is unmatched there is no fallback. | census §1.1 | Install on a platform with no matching carrier (or simulate by removing it) and observe the failure mode. |
| S-01-2 | `release-hygiene.test.ts` asserts engine binary package versions stay exact and workspace-free. | §20b | Inspect the packed manifests directly; confirm no `workspace:*` survived packing. |
| S-01-3 | `beta:proof` cannot be self-attested via env vars. | §20b `release-hygiene.test.ts:376` | Attempt to self-attest against the installed artifact and confirm refusal. |

## 8. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). If the install itself fails, that is the charter's
headline finding — establish the cause to `file:line` or to the exact npm/pnpm resolution step,
then continue with the remaining probes against the working-tree build, clearly labelled as such.

## 9. Deliverables

`results/01-install-and-packaging.md` plus tarball file listings and full install logs under
`results/artifacts/01/`.
