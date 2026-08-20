# CHARTER 12 — Diff parsing and scope semantics

**Depends on:** 09 · **Est. 3 h** · **Output:** `results/12-diff-and-scope-semantics.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 12 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 12 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 12` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Establish exactly which files a `drift check` invocation evaluates, for every way of describing a
change. The known headline: **a file moved into a block-mode convention's scope by a pure
`git mv` is never evaluated**, because the parser puts pure renames in a set whose only two
consumers are an empty-diff refusal suppressor and a cosmetic counter (§22 obs. 12).

## 2. Mechanism under test

`packages/cli/src/check/diff.ts`:
- `ParsedDiff` (`:10-25`) — three fields: `files`, `deletedFiles`, optional `renamedFiles`.
- `parseUnifiedDiff` (`:111-174`) — the `rename to ` branch (`:122-125`) adds to `renamedFiles`
  **only**; a `files` entry is created only on a `+++ ` line (`:131-145`), which a pure rename
  never emits.
- `filesForConvention` (`:187-202`) — reads `diff.files` only. `renamedFiles` is never passed in.
- `diffStatusFor` (`:204-232`), `fullRepoDiff` (`:176-185`).

`packages/cli/src/check/run-check.ts`:
- `:440` — `renamedFiles.length === 0` used **only** to suppress the empty-diff refusal.
- `:2979` — `renamed_file_count`, feeding only the display line.
- `:432-458` — `empty_diff_scope` refusal. `:474-501` — `stale_diff_scope`, firing **only when
  every** named file is missing (`:483`); a partial miss proceeds and reports via
  `partial_coverage.reasons` (`:503-…`, `:1275`).

Scopes: `full`, `changed-files`, `changed-hunks`.

## 3. Procedure

### The rename gap

| Probe | Shape |
|---|---|
| P-12-01 | Pure `git mv` (100% similarity, no content change) moving a **violating** file **into** a block-mode convention's `path_globs`. `git diff` will contain only `rename from` / `rename to`. Run `drift check --diff`. Oracle: it must block. Record what actually happens, and the printed `Checked N files (M renamed file unchanged)` line. |
| P-12-02 | The same move for **every** convention kind that has an evaluator, not just `api_route_no_direct_data_access`. §21 records kind-independence as a *structural inference*, never observed. Settle it. |
| P-12-03 | Pure rename moving a violating file **out of** scope. |
| P-12-04 | Rename **with** a content edit (similarity < 100%) — the path `packages/cli/test/diff-lifecycle.test.ts:37-72` already covers. Confirm it behaves correctly, establishing the contrast. |
| P-12-05 | Find the similarity threshold at which git stops emitting a pure-rename header and starts emitting hunks; that threshold is the boundary of the gap. Vary edit size to locate it. |
| P-12-06 | Copy (`git diff -C`) rather than rename. Same question. |
| P-12-07 | A rename combined in one diff with an ordinary edit elsewhere — does the presence of real `files` entries change the renamed file's treatment? |

### Scope semantics

| Probe | What to do |
|---|---|
| P-12-08 | The same violation checked under `--scope full`, `changed-files`, `changed-hunks`. Record verdict and exit code for each. |
| P-12-09 | `--scope full` with at least one non-expired block-mode convention: `blockModeConventionsUnenforceableAtFullScope` (`run-check.ts:286-304`) makes this always a refusal (`full_scope_cannot_block`, exit 3, `:332`). Confirm, and confirm `blocked_reasons` carries `block_mode_convention_unenforced:<id>` per id (`:1257`). |
| P-12-10 | `changed-hunks` where the violating line is **outside** every hunk but the file is in the diff. |
| P-12-11 | `--diff` vs `--diff-file` — same content, both paths. Do they agree byte-for-byte in output? |
| P-12-12 | Malformed diff: truncated, wrong headers, CRLF line endings, a diff with no trailing newline, binary file diff, a diff for a path outside the repo, a path with spaces or unicode. |
| P-12-13 | Empty diff → `empty_diff_scope`, exit 3 (`:442-457`). |
| P-12-14 | Diff naming files **all** absent from the working tree → `stale_diff_scope`, exit 3 (`:487-500`). |
| P-12-15 | Diff naming files **partly** absent → must **not** refuse; must proceed on present files and report the rest in `partial_coverage.reasons`. Confirm the user can see which files were dropped. |
| P-12-16 | Deleted files: a violating file deleted in the diff. Does it still produce a finding? |
| P-12-17 | Added files: a new violating file. |
| P-12-18 | Mode-only change (`chmod`), symlink change, submodule change. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Diff parse time vs. diff size | 10, 100, 1,000, 10,000 changed files |
| `check` wall time by scope | `full` vs `changed-files` vs `changed-hunks` on the same repo, 10 trials each |
| Scope reduction ratio | files evaluated / files in repo, per scope |

## 5. Oracles

- A file that a diff brings into a convention's scope is evaluated, by **every** mechanism that
  can bring it there.
- A malformed diff refuses; it never silently evaluates a subset.
- A partial-coverage run tells the user exactly what it could not examine.
- Text and JSON agree on the file counts.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-12-1 | A pure `git mv` into a block-mode convention's scope produces no finding: `renamedFiles` feeds only the empty-diff-refusal suppressor and a display counter, never `filesForConvention`. | §14, §22 obs. 12, `diff.ts:187-202` | P-12-01 |
| S-12-2 | The gap is kind-independent because the mechanism is upstream of dispatch — but this was reasoned, never executed. | §21 | P-12-02 |
| S-12-3 | The existing rename test covers rename-with-edit (a different, already-correct code path), not the pure-rename shape. | §14, §20h | P-12-04 vs P-12-01 |
| S-12-4 | `stale_diff_scope` fires only on a **total** miss; a partial miss proceeds silently-ish via `partial_coverage.reasons`. | §15, §18a, `run-check.ts:483` | P-12-14, P-12-15 |
| S-12-5 | `--scope full` plus any block-mode convention is always a refusal. | §14 | P-12-09 |
| S-12-6 | A pure rename is displayed as `Checked 0 files (1 renamed file unchanged)`. | §14, `checks.ts:127-130` | P-12-01, verbatim string |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). P-12-01 confirming is expected; report it as
**CONFIRMED** with the reproducing command, not as a surprise.

## 8. Deliverables

`results/12-diff-and-scope-semantics.md`; every constructed diff under
`results/artifacts/12/diffs/` so each probe is replayable with `--diff-file`.
