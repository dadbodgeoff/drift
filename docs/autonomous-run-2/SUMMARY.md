# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 4 |
| Done (partial) | 1 |
| Premise false (no change needed) | 1 |
| Blocked — needs discussion | 0 |
| Skipped — dependency blocked | 0 |
| Deferred — human-gated | 0 |
| Discoveries | 1 |
| Baseline changes | 0 |

## Completed

- **T100** Match on resolved module identity, not specifier strings — Both T93 bypasses closed. Relative import (../../../lib/prisma) and barrel re-export now block; the clean control still passes; external suite 7/7 with ZERO baseline drift, so no overshoot.
- **T100b** Rebuild the T93 fixtures so they actually reproduce — The fixtures I committed in run 1 did not reproduce the bypass they were filed for. Each now carries a tsconfig paths mapping and a route violating via the ALIAS form, so inference learns @/lib/prisma and the sneaky route is genuinely the odd one out. Pinned by packages/cli/test/bypass-fixtures.test.ts, which drives the real CLI end to end.
- **T101** T01c: block-mode contract, finding reports enforcement none — RESOLVED, and the product behaviour was correct all along. enforcement_matches_mode is now true on all seven repos and promoted to a HARD ASSERTION - verified to bite by forcing it false, which flips midday to FAIL.
- **T102** Gitignore correctness via per-directory semantics — Adopted ignore::WalkBuilder for file discovery. Nested .gitignore files and ! negations now work, patterns stay scoped to the directory that declares them, and the external suite is 7/7 with zero drift - openstatus keeps injection_caught and catches_genuine_subpath, the exact fields the first attempt regressed.
- **T101** T01c: block-mode contract, finding reports enforcement none _(partial)_ — REPRODUCED deterministically, and the scope is four times larger than T01c stated. Root cause narrowed to one gate; not yet fixed.

## Premise false — deliberately no change

- **T103** A6 discovery: workspace-package resolution and message suppression
  - Both halves were already fixed; the plan premise (from run-1 discoveries T01a/T01b) is stale. specifierPointsAt already resolves workspace package names through workspaceDirs built from the workspace manifest, and start.ts line 224 already appends the discovery text when a candidate exists. Verified empirically on midday, which has 3 convention candidates: the message IS visible, names packages/supabase/src/client/server.ts with the local path, states it is imported by 2 routes as @midday/supabase/server, explains that inference only recognises prisma/database/db names, and gives the exact --data-modules command. That is the DoD, met.

## Discoveries made while working

- **T101b** Intermittent MCP parity flake at default concurrency
  - evidence: pnpm -r test failed once on mcp.test.ts "proves cross-surface canonical route parity for CLI and MCP route contracts" (1 failed / 56 passed), then passed in isolation (53/53) and on two consecutive full workspace runs.

