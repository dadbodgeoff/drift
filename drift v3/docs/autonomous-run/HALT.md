# Run halted — context exhausted (clean)

**Halt condition:** #5, context exhausted. This is the planned clean-halt path, not a failure.
**Tree state:** green. External suite 7/7, TS 721 tests, Rust 22 suites, all passing.
**Last commit:** `1559512` on `fix/phase-a-correctness`. Nothing pushed.

## Resume

```bash
cd ~/drift-falsification/drift/"drift v3"
node scripts/run-log.mjs status          # what is already done
pnpm build && cargo build --release -p drift-engine
pnpm eval:external                       # confirm the oracle is green before trusting anything
```

Then read `PROTOCOL.md` (triage-and-continue lifecycle, tacit knowledge) and continue at
**T12** in `PLAN.md`. Skip any task `run-log.mjs done <ID>` reports as complete.

Check free disk before starting: this run hit 1.8 GB and produced four false failures. Keep
above 5 GB. `cargo clean --release` deletes the engine binary the harness needs — rebuild after.

## Completed this run

**Phase 1 — gate integrity (T01–T06).** The suite could not detect F4 regressions; now it can.

- **T01** added midday-ai/midday, a Supabase monorepo whose data layer (`@midday/supabase/server`)
  matches none of the whitelist substrings. Screened two alternatives first.
- **T02** asserts the F4 gap is *exercised*: inference alone must find nothing and discovery must
  name the wrapper. My first attempt asserted the opposite polarity, which would have asserted the
  bug's absence.
- **T03** negative controls — type-only import, lookalike module, and a genuine subpath that must
  still be caught. The suite previously could not distinguish a correct rule from one that flags
  everything.
- **T04** performance ceiling, **T05** harness self-tests (6), **T06** ad-hoc `--repo-path` mode.

Two defects in the A6 work from the prior session, both found only by using a real repo:
the discovery message was suppressed whenever any other candidate kind existed, and discovery
could not resolve monorepo workspace imports (4 of 6 repos are monorepos).

**Phase 2 — premise verification (T07–T11).** B2's premise was false last session, so premises are
now checked before scope is committed. All confirmed this time, plus two new findings.

- **T07** all five security claims confirmed. The sharpest:
  `unsupported_dynamic_control_flow()` — the layer's own "too dynamic to prove anything" valve —
  is `contains("guards[") || contains("await guard(") || contains("computed_handler")`, all
  fixture strings. Real dynamic dispatch matches none, so the valve only opens for test inputs and
  line-ordering dominance proceeds as if flow were straight-line.
- **T07c (new)** `candidate_command.rs:1035` hardcodes `"withworkspace"`, and it is load-bearing —
  none of the surrounding broad conditions match it. The falsification report called dub's
  `withWorkspace` observation the most useful output across six repos; it exists because dub is an
  eval repo and its helper name is compiled into the engine. T26 will correctly cost that candidate.
- **T08** gitignore confirmed and narrowed: root honored, **nested `.gitignore` not read at all**.
- **T09** typed errors confirmed, 8 sites — and now more consequential, since A5 made exit codes a
  contract and the stale-scan branch maps to exit 3.
- **T11** 22 capability-assertion sites audited. Fixed one real overclaim: inference reported
  `complete: true` unconditionally while deciding the data layer by substring; now derived.

## Discussion agenda (see SUMMARY.md for full evidence)

1. **T01c — beta-blocking.** On midday the contract materialises `enforcement_mode: block` but the
   finding reports `enforcement_result: "none"`, so `blocking_count` is 0 and check exits 0. Only
   repo using the `--data-modules` path; only mismatch; not reproducible by hand in two attempts.
   F3-class silent failure. `enforcement_matches_mode` is recorded per repo — promote to a hard
   assertion once fixed.
2. **T07b** — dominance/branch/tenant claims need a hand-written auth contract to exercise
   end-to-end; `security-auth-branch-bypass` has no test referencing it. Days-scale, split out.

## Next tasks, in order

**T12** symbol-level type classification (closes the residual 8.5% FP on dub; needs tree-sitter
type-position detection — guard with fixtures for `Pick<>`, generic constraints, re-exported types).
Then **T13** over-match reduction — note the caution recorded in PROTOCOL.md: excluding `/schema`
would also drop `@openstatus/db/src/schema`, which *is* that repo's real Drizzle data layer.
Then **T14** exact-list assertions, **T15** incremental-scan staleness across engine versions.

**Promoted:** T40/T41 (disk footprint) now have direct evidence from this run — ~1 GB per large
repo, and exhaustion produced false results twice.
