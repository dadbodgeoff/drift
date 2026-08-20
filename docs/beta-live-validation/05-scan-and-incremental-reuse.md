# CHARTER 05 — Scan pipeline and incremental reuse

**Depends on:** 00 · **Est. 3 h** · **Output:** `results/05-scan-and-incremental-reuse.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 05 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 05 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 05` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Establish what `drift scan` indexes, what it skips, what it reuses, and whether it ever reuses
something it should not. Incremental reuse is the single mechanism most capable of producing a
silently wrong result: a stale fact reused across an engine change makes every downstream verdict
a lie, and nothing downstream can detect it.

## 2. Mechanism under test

`scan_repo()` (`crates/drift-engine/src/main.rs:207-260`):
walk → `files.sort()` (`:216`) → **sequential** `scan_files` loop (`:683-720`, one
`for file_path in files`) → `graph_for_file` per file (`:1214`) → return to TypeScript → SQLite.

Reuse (`main.rs:45-48`, `498-538`, `752-768`):
- `ReuseIndex` loaded from `--reuse-manifest <path>` JSON, built by `createScanReuseManifest`
  (`packages/cli/src/domain/scan-status.ts:438-500`), passed at
  `packages/cli/src/engine/collect-scan-data.ts:176`.
- Gated **first** on exact engine-version match — `main.rs:517-519` comment: *"Fail closed on an
  engine change: reparse rather than trust facts produced by different extraction logic."*
- Per-file reuse requires `previous.content_hash == file.content_hash && previous.byte_size ==
  file.byte_size` (`:758`). **No mtime participates.**
- Stats returned: `files_reused`, `reuse_applied` (`main.rs:243-244`).

Scan scope: root-level `.gitignore` only (nested `.gitignore` files not honored, negation lines
filtered out) plus a hard-coded 8-entry directory skip-list. No `.driftignore` exists
(§22 obs. 4). Walk lives at `packages/query/src/repo-files.ts:17-37`, gitignore handling `:75-115`.

## 3. Procedure

| Probe | What to do |
|---|---|
| P-05-01 | Cold scan a known repo. Record files indexed, files skipped and why, facts emitted, `parser_gaps`, wall time. |
| P-05-02 | Immediately re-scan, unchanged. Record `files_reused` / `reuse_applied` and wall time. Reuse should be near-total. |
| P-05-03 | `touch` a file without changing its content. Re-scan. Because reuse is content-hash gated, reuse must **still** apply. If it does not, mtime is leaking in somewhere. |
| P-05-04 | Change one byte in one file. Re-scan. Exactly that file reparses; everything else reuses. |
| P-05-05 | Change a file's content such that byte size is identical (swap two characters). Confirm the content hash still catches it. |
| P-05-06 | **Engine-version fail-closed.** Scan, then substitute an engine binary reporting a different version, then re-scan with the existing reuse manifest. Every file must reparse. Confirm `files_reused == 0`. This is the highest-value probe in the charter. |
| P-05-07 | Corrupt the reuse manifest (truncate it, invalidate its JSON, point it at a nonexistent path). Does the scan refuse, or silently proceed with no reuse, or silently proceed with partial garbage? |
| P-05-08 | Add a file to `.gitignore` at the root. Confirm it drops from the index. |
| P-05-09 | Add a **nested** `.gitignore` in a subdirectory. Confirm — per `test/fixtures/gitignore-nested` — that it is **not** honored, and record whether the user is told. |
| P-05-10 | Add a negation line (`!keep.ts`) to the root `.gitignore`. Confirm negation lines are filtered out and record the resulting behavior. |
| P-05-11 | Symlinks: a symlinked source file, a symlinked directory, a symlink loop. Record behavior for each. Repo identity does no symlink canonicalization (§22 obs. 1). |
| P-05-12 | Unreadable and binary files (`test/fixtures/binary-and-unreadable`). Skipped honestly, or silently? |
| P-05-13 | A file that is deleted mid-scan and a file that is written mid-scan. Record behavior. |
| P-05-14 | `drift scan status` after each of the above. Does it correctly report drift between stored hashes and current files? |
| P-05-15 | Two `drift scan` processes concurrently against the same state root. Record what happens (charter 17 owns storage concurrency; this probe only establishes whether it is reachable from normal use). |
| P-05-16 | Interrupt a scan with SIGINT mid-run. Re-run `scan status` and `check`. Is partial state distinguishable from complete state? |

## 4. Benchmarks

| Metric | n | Note |
|---|---|---|
| Cold scan wall time by repo size | 5 | Charter 16 owns the scaling curve; this charter establishes the single-point baselines it uses |
| Warm (full-reuse) scan wall time | 5 | The ratio to cold is the reuse mechanism's whole value |
| Scan time with 1 file changed of N | 5 | Should be ≈ warm, not ≈ cold |
| Peak RSS during scan | 3 | The scan loop is sequential; memory should be flat, not proportional to repo size |
| Facts/second, files/second | 5 | For cross-charter comparison |

Run these against at least three of the `$DRIFT_EVAL_REPOS` corpus repos and record each repo's
own commit sha.

## 5. Oracles

- Reuse is decided by content hash and byte size only; mtime changes nothing.
- An engine version change invalidates **all** reuse, unconditionally.
- A corrupt or unreadable reuse manifest never produces a partially-reused scan.
- Every file the walk skipped is either reported to the user or provably irrelevant.
- An interrupted scan leaves state that `scan status` reports as incomplete.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-05-1 | Reuse is content-hash gated, not mtime gated. | §3.1, `main.rs:758` | P-05-03, P-05-04 |
| S-05-2 | Reuse fails closed on engine version drift. | §3.1, `main.rs:517-519` | P-05-06 |
| S-05-3 | Only the root `.gitignore` is honored; nested ones are not; negation lines are filtered out; the only other exclusion is a hard-coded 8-entry skip-list, and no `.driftignore` exists. | §22 obs. 4, `repo-files.ts:75-115` | P-05-08 … P-05-10 |
| S-05-4 | Repo identity is path-derived with **no symlink canonicalization**, and a second, independent git/content-derived fingerprint exists that nothing reconciles against it. | §22 obs. 1, §5a, §5b | P-05-11 plus: scan via a symlinked path and via the real path; do you get one repo or two? |
| S-05-5 | There is no git-root discovery anywhere; `--repo-root` (or cwd) is taken literally. | §22 obs. 2 | Run `drift scan` from a subdirectory of a git repo without `--repo-root`. What gets indexed? |
| S-05-6 | The scan loop is sequential and non-parallel. | §3.1, `main.rs:690` | Observe CPU utilization during a large scan; confirm single-core saturation. |
| S-05-7 | `crates/drift-engine/tests/scan_reuse.rs` was never opened; its assertions are filename-inferred. | §21 | Read it, then determine whether the probes above cover anything it does not, and vice versa. |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). P-05-06 failing is a beta blocker and must be reported
as such in §1 of the results file — but the charter still runs to completion.

## 8. Deliverables

`results/05-scan-and-incremental-reuse.md`; scan stats JSON per probe under
`results/artifacts/05/`.
