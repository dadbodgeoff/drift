# Run 2 — paused, context exhausted

**Tree:** green. External suite **7/7** zero drift · e2e **63/63** · TS 791 · Rust 25 suites ·
clippy + rustfmt clean. Eval repos clean. **9 commits. Nothing pushed, nothing published.**

**Resume:** `cd ~/drift-falsification/drift`, then
`DRIFT_RUN_DIR=docs/autonomous-run-2 node scripts/run-log.mjs next` → **T113**.

**Read the T111 entry before touching Phase 2 further** — it invalidates how the plan frames both
T111 and T112.

| Outcome | Count |
|---|---|
| Done | 4 |
| Done (partial) | 3 |
| Blocked — needs redesign | 1 |
| Premise false | 1 |
| Discovery | 1 |

## Phase 1 complete — both beta blockers closed

**T100 — the two enforcement bypasses.** Relative import and barrel re-export now block; clean
control still passes; 7/7 with **zero baseline drift**. Four layers had to be peeled: the engine's
graph matcher was never called during a check; the deciding logic is a CLI-side pre-filter with the
same path-vs-specifier defect; the engine gets a graph **scoped to the changed files** so it cannot
derive what `@/lib/prisma` names (the CLI now computes identities from the full graph and passes
them); and `MODULE_REEXPORTS_MODULE` was filtered out before the engine saw it.

**T100b — the run-1 fixtures did not reproduce the bug they were filed for.** One had learned the
sneaky route's own spelling; the other inferred no contract at all. Both rebuilt with a tsconfig
paths mapping and an alias-form violation, and pinned by a test that drives the real CLI.

**T101 — the silent pass was the harness, and the product was right.** Enforcement now matches the
contract on all seven repos and is a **hard assertion** (verified to bite). Two causes: midday's
`cleanSymbol` was `sanitizeRedirect` where the module exports `sanitizeRedirectPath`, and
structurally the lookalike/subpath probes *must* import non-existent modules, which legitimately
makes coverage incomplete. The harness was suppressing what it was measuring. I implemented
per-file gating in the engine first and reverted it — it produces results
`packages/engine-contract` rejects, and that invariant is deliberate and tested.

Two corrections to run 1's record: **four** repos were affected, not one, and `--data-modules` was
never implicated.

**T102 — gitignore, second attempt, this time correct.** `ignore::WalkBuilder` gives per-directory
precedence natively. The fixture carries the exact shape that reverted attempt 1: a bare `app`
pattern in one package plus API routes in another. Caught a regression of my own — WalkBuilder
yields a missing repo root as an error *entry*, so a scan of a non-existent repo reported an empty
repo and exited 0. The root must now be readable or the scan fails; per-entry errors deeper in the
tree stay diagnostics.

**T103 — premise false.** Both halves were already fixed. Verified on midday *with three candidates
present* — the case T01b said would suppress it. Added tests for the text-output path, which was
the one thing unguarded.

## Phase 2 started

**T110 — state growth is now bounded.** dub across five `start` runs: `393 → 787 → 1179 → 1179 →
1179 MB`, facts fixed at two scans. Before: `393 → 787 → 1180 → 1573 → 1963` and climbing.

The DoD's ≤1.2× is **not** met (it is 3×) for two deliberate reasons: `keep=2` retains two fact
sets because incremental reuse needs the predecessor's, and I removed `VACUUM` after it demanded
~2× the file size in free space and failed a run with a disk I/O error — housekeeping becoming the
disk-exhaustion failure T41 exists to prevent.

**Settled on the record:** stored scan count does **not** affect check latency (2.7s on dub at both
2 and 10 scans). Retention is a footprint fix, not a speed one. The 3.9s-vs-18.7s discrepancy in
the benchmark is therefore *not* scan accumulation — still unexplained.

## T111 — the plan's premise is wrong; T111 and T112 are one task

T111 assumes the engine walks and hashes every file to decide reusability, at ~3.9s. Measured on
formbricks:

    reuse:      seen=2871  parsed=1  reused=2870     already perfect
    walk+hash:  0.04s for 2,837 files / 14 MB        free
    engine:     1750 ms
    CLI:        ~2250 ms
    total:      3.91s  (matches run 1; cal.com 6.09s)

Neither walking, hashing, nor parsing is the cost. **Both halves are dominated by payload volume**:
the engine emits 157k facts, 162k nodes and 244k edges for the whole repo on every check, and the
CLI re-ingests and re-assembles all of it — for a one-line change.

So the fix is not a changed-files scan mode. The check should not move the whole graph at all; it
needs the changed file's facts plus the stored graph already in SQLite. Two designs are open (engine
emits changed-file facts and the CLI merges; or engine emits a delta and the CLI patches stored
state). Both are architectural, so I did not start one with limited context. **T114 stays blocked.**

## T112 — latency fixed, footprint not

    papermark   11.93s → 1.38s      (target <2s)  ✓
    cal.com     13.70s → 4.89s      (target <5s)  ✓
    dub         47.6s  → 3.8s
    eval:prepare 3/3, ranks unchanged

Cause was not slow SQL: the graph was loaded in full at **eighteen** call sites, and `getRouteFlow`
loads all of it per route — so `prepare` loaded the whole graph ten times. A per-scan memo fixed it.

**RSS target not met**, and the two numbers are different problems: `prepare` at 1.08 GB is the graph
in memory and is T112's remaining half (scoped SQL, which caching does not substitute for);
`check` at 1.64 GB is T111's payload problem and will not move until that is redesigned.

## Carry forward

- **One run exited 1 under disk pressure then recovered** (T110). Unexplained; worth a look.
- **T101b** — one intermittent MCP parity flake at default concurrency, then three clean runs. T64
  removed serialisation on four green runs; this is a fifth-run failure.
- **These test runs eat disk fast.** Two disk-I/O failures this session. `./scripts/reclaim-disk.sh`
  between repos, and delete `/tmp/t1*` HOMEs as you go.

## Two rules earned this run

- **A fixture can pass for the wrong reason.** Two of mine did. When a fixture exists to prove a bug
  is fixed, check it fails with the fix reverted.
- **The harness can cause what it reports.** T101 was four repos of "product bug" that was the
  negative controls suppressing the measurement. Check the instrument before the subject.

## Not started

T111 (changed-files-only engine mode — the T114 gate), T112 (scoped graph loading), T113 (`repo map`
from SQL), T114 (hooks pack), Phase 3 (T120–T124 — all four maintainer decisions pre-registered in
`PLAN.md` §0.3), Phase 4 (T130–T137), Phase 5 (T140–T141).
