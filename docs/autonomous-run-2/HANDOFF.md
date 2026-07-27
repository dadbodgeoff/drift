# Run 2 — paused, context exhausted

**Tree:** green. External suite **7/7** with zero baseline drift · e2e **63/63** · TS 791 · Rust 24
suites. Eval repos clean. **3 commits. Nothing pushed, nothing published.**

**Resume:** `cd ~/drift-falsification/drift`, then
`DRIFT_RUN_DIR=docs/autonomous-run-2 node scripts/run-log.mjs next` → **T101** (finish), then T102.

Run-2 state lives in `docs/autonomous-run-2/` (`DRIFT_RUN_DIR` selects it, so run 1's log stays
an immutable record).

## Done

**T100 — both enforcement bypasses closed.** The relative import and the barrel re-export now
block; the clean control still passes; external suite 7/7 with **zero baseline drift**, so nothing
overshot.

The plan's premise was partly wrong and locating the real defect was most of the work. Four
layers, in the order they had to be peeled:

1. The engine's graph matcher **was never called** during a check — instrumented it, got no output
   at all. Dead code on that path.
2. The deciding logic is a CLI-side pre-filter, `graphImportResolvesToForbidden`, carrying the
   identical defect: `isForbiddenImport(resolvedPath, forbiddenImports)` compares a resolved file
   path against specifiers.
3. Fixing that was still not enough — the engine gets a graph **scoped to the changed files**, so
   it cannot know what `@/lib/prisma` names. The CLI now computes the identities from the full
   graph and passes them as `matcher.forbidden_module_files`.
4. `MODULE_REEXPORTS_MODULE` was not in the kept-edge list, so the barrel chain never reached the
   engine even once it could use it.

**T100b — the run-1 fixtures did not reproduce the bug they were filed for.**
`bypass-relative-import` inferred `forbidden_imports: ["../../../lib/prisma"]` — it learned the
sneaky route's own spelling, so it would have passed with the bug fully present.
`bypass-barrel-reexport` inferred nothing at all. Both rebuilt with a tsconfig paths mapping and
an alias-form violating route, and pinned by `packages/cli/test/bypass-fixtures.test.ts`, which
drives the real CLI end to end.

## In flight — T101, reproduced, cause narrowed, not fixed

**Two corrections to run 1.** It is **not midday-only**: `enforcement_matches_mode` is false on
**four** repos — taxonomy, cal.com, papermark, midday — and correct on three. The harness had that
recorded all along. And it is **not the `--data-modules` path**: midday blocks correctly by hand
with the declared contract materialising exactly right.

**The trigger is route count.** Bisected on midday:

| Diff contents | enforcement |
|---|---|
| bad route alone | **block** |
| bad + clean | none |
| bad + lookalike | none |
| bad + subpath | none |
| bad + typeonly | **block** |

`typeonly` is the tell: T12 drops type-only imports, so that route contributes no import fact and
the count effectively stays at one. **Any second route with a real import collapses
`enforcement_result` to `none`.**

**Candidate mechanism, not confirmed.** `check_command.rs:280` downgrades `enforcement_result` to
`"none"` when `can_block` is false; `can_block` (line 37) is `completeness_reasons.is_empty()`,
fed by `check_graph_completeness_reasons` flagging `unresolved_import` on API route files. Not
confirmed because the CLI-reported `capability_completeness.can_block` stays **true** with no
unresolved diagnostics in the payload — the engine's internal gate reads something in the scoped
request the CLI does not expose.

**Next step:** instrument `completeness_reasons` in the engine for the two-route case. That is one
run and it should settle it.

## Two things worth carrying into any further work here

- **The harness records more than it asserts.** `enforcement_matches_mode` was diagnostic-only, and
  four repos were failing it in the committed baseline while the suite reported 7/7. T101's DoD
  (promote it to a hard assertion) matters more than it looked.
- **A fixture can pass for the wrong reason.** Two of mine did. When a fixture exists to prove a
  bug is fixed, check that it fails with the fix reverted.

## Not started

T102 (gitignore via `ignore::WalkBuilder`), T103 (A6 workspace resolution), Phase 2 (T110–T114,
performance to sub-1s and the hooks pack), Phase 3 (T120–T124, identity/baseline/contract fields
— all four maintainer decisions are pre-registered in `PLAN.md` §0.3), Phase 4 (T130–T137),
Phase 5 (T140–T141).
