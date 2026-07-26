# Run paused — context exhausted (clean)

**Tree state:** green. External suite **7/7**, TS suites green, Rust **23** suites green.
**Branch:** `fix/phase-a-correctness`. **Nothing pushed.**
**Completed:** 33 tasks (26 done, 5 partial, 2 premise-false). 5 blocked, 6 discoveries.

## Resume

```bash
cd ~/drift-falsification/drift/"drift v3"
df -h ~                                   # need >5 GB; the suite refuses below that now
pnpm build && cargo build --release -p drift-engine
pnpm eval:external                        # confirm the oracle before trusting anything
node scripts/run-log.mjs status
```

Read `PROTOCOL.md` first (triage-and-continue, tacit knowledge, halt conditions). Then:

```bash
node scripts/run-log.mjs next     # prints the next unsettled task; exits 1 when none remain
```

Continue at **T25**. Disk no longer halts the run - `./scripts/reclaim-disk.sh` reclaims in four
tiers of regenerable artifacts only, and never touches the pinned evaluation repos.

## Completed

**Phase 1 — gate integrity (T01–T06).** The suite could not detect F4 regressions; now it can.
Added **midday-ai/midday**, a Supabase monorepo whose data layer matches no whitelist substring,
and asserted the gap is *exercised* rather than merely present. Added negative controls
(type-only import, lookalike module, genuine subpath), a performance ceiling, harness
self-tests, and `--repo-path` for ad-hoc triage.

**Phase 2 — premise verification (T07–T11).** All B1 security claims confirmed; the sharpest is
that `unsupported_dynamic_control_flow()` — the layer's own "too dynamic to prove anything"
valve — matches only Drift's fixture strings, so it opens for test inputs and never for real
dynamic dispatch. B4 confirmed and narrowed. B5 confirmed and more consequential than stated,
since A5 made exit codes a contract. T11 audited 22 capability-assertion sites and fixed one
real overclaim.

**Phase 3/5 — correctness and footprint.**

| Task | Outcome |
|---|---|
| **T12** | dub FP rate **8.5% → 3.1%**, findings 458 → 417. AST-based via tree-sitter's `type_identifier`/`identifier` distinction. Also forced B3's structural fix: `runFullRepoCheck` now reads engine facts instead of re-deriving imports, eliminating the TS/Rust divergence class. |
| **T13** | cal.com forbidden imports **6 → 1** (exactly `@calcom/prisma`); openstatus 4 → 3 keeping `/src/schema`. |
| **T15** | Reuse now refuses facts from a different engine version. Without it, T12/T13 would have silently kept stale facts for every unchanged file after an upgrade. |
| **T40** | dub state **599 MB → 394 MB**. `graph_json` was a 206 MB duplicate of the normalized graph tables. |
| **T41** | Disk preflight in `doctor`, `start`, and the suite. |
| **T17** | `busy_timeout` set — concurrent holders wait instead of hitting `SQLITE_BUSY`. Unblocks T44. |
| **T11b** | Inverted the fail-open completeness default, which revealed that A4's honest measurement never reached users at all. |
| **T20/T21** | Verified and pinned; the block-new refactor risk did **not** materialize. |
| **T30/T72/T73** | FP metric defined; enforcement contract documented. |

## Second batch (after the first handoff)

| Task | Outcome |
|---|---|
| **T16** | Refuses a database written by a *newer* Drift. An older build previously applied nothing and carried on against a schema it did not know - silent wrong behaviour. Forward migration from an 8-migration-old database verified with data intact. |
| **T23** | `DriftError` carries its own failure code; the classifier reads it before falling back to matching prose. Rewording an error string used to change exit-code behaviour, since stale-scan maps to exit 3. |
| **T24** | Added `disk_full`, `corrupt_database`, `permission_denied` - all previously reaching users as raw SQLite or filesystem strings. `docs/reference/errors.md` tables all ten codes with honest `safe_to_retry`. |
| **T29** | Context egress pinned with 15 tests on the exact shapes F9 let through. The canary test alone would have misled: those files were never indexed because only TS/JS is, which is incidental, not the policy. |
| **T19** | Premise false - foreign contracts *are* refused. But see T19b. |
| **T22, T18** | Attempted, reverted, logged with root cause. |

## Discussion agenda — read `SUMMARY.md` for full evidence

1. **T01c — beta-blocking.** On midday the contract materializes `enforcement_mode: block` but
   the finding reports `enforcement_result: "none"`, so `blocking_count` is 0 and check exits 0.
   Only repo using the `--data-modules` path; only mismatch across seven repos; not reproducible
   by hand in two attempts. F3-class silent failure. `enforcement_matches_mode` is recorded per
   repo — promote to a hard assertion once fixed.
2. **T22 — gitignore.** Attempted and reverted. `GitignoreBuilder::add()` interprets patterns
   relative to the *builder root*, not the added file's directory, so a bare `app` in
   `apps/server/.gitignore` went repo-wide and swallowed openstatus's real routes. Fix is
   per-directory scoping or `ignore::WalkBuilder`. **T08's fixture passes under the broken
   version** — the suite is what caught it.
3. **T19b — blocks E3 and E4.** Contract portability is impossible: `repoIdForRoot` hashes the
   **absolute path**, so every teammate's checkout is a different repo and no one can import a
   committed contract. E3 pitches `drift.lock` as "a package-lock for your conventions"; that
   cannot work today, and CI checks out to a path no developer shares. Needs a path-independent
   identity (git remote + root commit, falling back to repo content).
4. **T18 — baseline is a permanent per-violation waiver.** Rewriting a baselined violating line,
   or removing and reintroducing it, stays exempt forever. I implemented the fix and all four
   matrix cases behaved as pre-registered, then reverted: two tests encode the current contract
   deliberately. `baseline_violations` has no provenance column, so an automatic onboarding
   shield cannot be told apart from a considered waiver. Recommend adding provenance.
5. **T22 — gitignore.** Reverted. `GitignoreBuilder::add()` scopes patterns to the *builder root*,
   so a bare `app` in `apps/server/.gitignore` went repo-wide and swallowed openstatus's routes.
   **T08's fixture passes under the broken version** — the suite caught it.
6. **T07b** — dominance/branch/tenant claims need a hand-written auth contract to exercise;
   `security-auth-branch-bypass` still has no test referencing it.

## Two findings that change how you read earlier results

- **T07c:** `candidate_command.rs:1035` hardcodes `"withworkspace"`, and it is load-bearing —
  none of the surrounding conditions match it. The falsification report called dub's
  `withWorkspace` observation the most useful output across six repos; it exists because dub is
  an eval repo and its helper name is compiled into the engine. **T26 will correctly cost that
  candidate.**
- **T13b:** the boundary rule also drops `../../lib/prismaClient`, a legitimate client. A
  camelCase-aware boundary cannot separate `prismaClient` from `isPrismaObj`; that needs the
  structural signal (does the module export an instantiated client), which is E2.

## Next, in order

**T25/T26** security gating and literal removal — scoped by T07, and the largest remaining
correctness item (12 `can_block: true` sites plus vocabulary and fixture literals). **T27/T28**
contract-field enforcement mapping. **T31** claims ↔ behaviour reconciliation. **T42/T43** scaling
probes (need a ~20k-file repo). **T44** hooks pack — now unblocked by T17. **T46** `drift prepare`
quality eval, which is the untested half of the context claim.

## Protocol lessons earned this run

- `cargo test` builds **debug**; the CLI and harness use `target/release`. Verifying against a
  stale release binary produced a plausible-but-wrong 8.4% and three spurious parser gaps.
- Disk exhaustion produced **four false test failures** in one run and, in another, left no
  space to write tool output at all. Both remediated with no code change.
- Fixture-only verification was insufficient twice (T01 discovery suppression, T22 gitignore).
  The seven-repo suite caught both.
