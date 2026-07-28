# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 7 |
| Done (partial) | 3 |
| Premise false (no change needed) | 2 |
| Blocked — needs discussion | 1 |
| Skipped — dependency blocked | 1 |
| Deferred — human-gated | 0 |
| Discoveries | 2 |
| Baseline changes | 0 |

## Completed

- **T100** Match on resolved module identity, not specifier strings — Both T93 bypasses closed. Relative import (../../../lib/prisma) and barrel re-export now block; the clean control still passes; external suite 7/7 with ZERO baseline drift, so no overshoot.
- **T100b** Rebuild the T93 fixtures so they actually reproduce — The fixtures I committed in run 1 did not reproduce the bypass they were filed for. Each now carries a tsconfig paths mapping and a route violating via the ALIAS form, so inference learns @/lib/prisma and the sneaky route is genuinely the odd one out. Pinned by packages/cli/test/bypass-fixtures.test.ts, which drives the real CLI end to end.
- **T101** T01c: block-mode contract, finding reports enforcement none — RESOLVED, and the product behaviour was correct all along. enforcement_matches_mode is now true on all seven repos and promoted to a HARD ASSERTION - verified to bite by forcing it false, which flips midday to FAIL.
- **T102** Gitignore correctness via per-directory semantics — Adopted ignore::WalkBuilder for file discovery. Nested .gitignore files and ! negations now work, patterns stay scoped to the directory that declares them, and the external suite is 7/7 with zero drift - openstatus keeps injection_caught and catches_genuine_subpath, the exact fields the first attempt regressed.
- **T121** Baseline provenance (decision C) — Implemented decision C, and the four-case matrix on formbricks now behaves as pre-registered: untouched baselined violation passes, file edited elsewhere passes, violating line REWRITTEN blocks, removed-and-reintroduced blocks. External suite 7/7 with zero drift.
- **T120** Path-independent repo identity — Both DoD directions proven end to end on real checkouts. Export from checkout A of taxonomy, import into checkout B at a different path -> imported=True, compatible=True. cal.com contract into the taxonomy checkout -> imported=False with reasons [repo_id_mismatch, repo_fingerprint_mismatch]. 11 tests.
- **T122** drift.lock framing (E3) — Flow verified end to end on two checkouts of taxonomy: export as drift.lock from checkout A, commit it, import it in checkout B at a different path -> imported=True, compatible=True. Documented in docs/agent-integration.md.
- **T101** T01c: block-mode contract, finding reports enforcement none _(partial)_ — REPRODUCED deterministically, and the scope is four times larger than T01c stated. Root cause narrowed to one gate; not yet fixed.
- **T110** Scan retention: GC superseded scans _(partial)_ — Growth is now BOUNDED. Measured on dub across 5 consecutive start runs: 393 -> 787 -> 1179 -> 1179 -> 1179 MB, with facts plateauing at 214,176 (two scans) from run 2 onward. Before: unbounded at ~393MB per run, reaching 1963MB at 5 runs and still climbing.
- **T112** Scoped graph loading for prepare _(partial)_ — Both latency targets met, quality held, memory target not met. papermark prepare 11.93s -> 1.38s (target <2s). calcom 13.70s -> 4.89s (target <5s). pnpm eval:prepare still 3/3, and the eval itself got much faster - dub prepare 47.6s -> 3.8s.

## Premise false — deliberately no change

- **T103** A6 discovery: workspace-package resolution and message suppression
  - Both halves were already fixed; the plan premise (from run-1 discoveries T01a/T01b) is stale. specifierPointsAt already resolves workspace package names through workspaceDirs built from the workspace manifest, and start.ts line 224 already appends the discovery text when a candidate exists. Verified empirically on midday, which has 3 convention candidates: the message IS visible, names packages/supabase/src/client/server.ts with the local path, states it is imported by 2 routes as @midday/supabase/server, explains that inference only recognises prisma/database/db names, and gives the exact --data-modules command. That is the DoD, met.
- **T113** repo map answers from SQL, paginated
  - The DoD is already met and the premise is wrong. Plan says --limit/--offset exist but the whole map is built first. Measured on cal.com: repo map --limit 10 returns in 0.09s against a <5s target. Pagination is also fully honest, not silently truncating - it reports returned_count 10, has_more true, next_offset 10, and the summary carries indexed_file_count 5064 and filtered_file_count 5064, so a consumer knows exactly what it has and where to continue.

## Discoveries made while working

- **T101b** Intermittent MCP parity flake at default concurrency
  - evidence: pnpm -r test failed once on mcp.test.ts "proves cross-surface canonical route parity for CLI and MCP route contracts" (1 failed / 56 passed), then passed in isolation (53/53) and on two consecutive full workspace runs.
- **T101b** Intermittent MCP parity flake — second occurrence
  - evidence: Same test failed again (mcp.test.ts "proves cross-surface canonical route parity"), now twice across the run. Narrowed this time: mcp.test.ts alone passes 53/53 three times consecutively, and three consecutive full workspace runs are green afterwards. So it is intermittent under WITHIN-PACKAGE file concurrency (the mcp package has other test files that run alongside it), not workspace-level concurrency.

## Skipped — dependency blocked

- **T114** Ship the hooks pack — waiting on T111 sub-1s check latency. The task specifies auto-skip with the measured number if Phase 2 misses the target, so: formbricks single-file check is 3.91s and cal.com 6.09s against a <1s requirement. Correctness was already proven in run 1 (exit 2 on a violating edit, exit 0 on clean, warn/block split verified) - only latency gates it. T111 is blocked pending an architectural decision, since the cost is payload volume (563k records moved per one-line check), not the walk-and-hash the plan assumed.

## Discussion agenda

Blocked tasks in plan order. Each records what was attempted, the evidence, and the
recommendation. Work reverted; the tree is green.

### T111 — Changed-files-only engine mode

- **reason:** premise_wrong_needs_redesign
- **attempted:** Measured the actual cost of a single-file check before implementing, on formbricks (2,819 ts files) and cal.com (5,025). Baseline: formbricks 3.91s (matches run 1 exactly), cal.com 6.09s. Targets were <1s and <1.5s.
- **evidence:** The plan premise is wrong on both counts. It says the engine still walks and hashes every file to decide reusability, at a cost of 3.9s. Measured: reuse is already perfect - seen=2871 parsed=1 reused=2870 - and hashing all 2,837 files takes 0.04s for 14MB. Neither walking nor hashing nor parsing is the cost. Instrumented the split: engine 1750ms, CLI ~2250ms, and BOTH are dominated by moving the payload - the engine emits 157,319 facts, 162,362 graph nodes and 243,622 edges for the whole repository on every check, and the CLI re-ingests and re-assembles all of it, for a one-line change.
- **diagnosis:** So T111 and T112 are one task with a different fix than either describes: the check should not move the whole repo graph at all. It needs the changed file facts plus the stored graph already in SQLite. Two designs - (a) engine emits only changed-file facts and the CLI merges against stored state, (b) engine emits a delta plus an unchanged marker and the CLI patches the stored graph. Both are architectural; the CLI currently rebuilds the graph from the full stream every time. NOT started, because beginning it with limited context would leave the check path half-migrated. Also confirms T114 (hooks pack) stays blocked, and note the reason it took instrumentation to find: the check payload does not surface scan stats at all, which run 1 T45 flagged and which made this invisible.

