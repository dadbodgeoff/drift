# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 29 |
| Done (partial) | 7 |
| Premise false (no change needed) | 2 |
| Blocked — needs discussion | 5 |
| Skipped — dependency blocked | 0 |
| Deferred — human-gated | 1 |
| Discoveries | 6 |
| Baseline changes | 0 |

## Completed

- **T00** Install autonomous run protocol, plan, and log tooling — triage-and-continue lifecycle; log.jsonl as resume substrate; tacit-knowledge section covering the traps that cost time in the prior session
- **T01** Add a 7th eval repo whose data layer defeats the substring whitelist — midday-ai/midday (Supabase monorepo, @midday/supabase/server). Screened 3 candidates; basejump had 0 API routes, supabase/supabase studio uses an apiWrapper indirection. midday exercises the F4 gap on a real repo: 3 candidates inferred, none data-access.
- **T02** Assert the F4 path in the harness, not just observe it — whitelistIndependent repos run a pre-pass without --data-modules; assert inference alone finds nothing AND discovery names the expected wrapper. Caught my own inverted assertion polarity before it became a false green.
- **T03** Add negative controls to the harness — Three per repo: type-only import of the data module (A3/F5), a <dataModule>-legacy lookalike (B3), and a genuine subpath that must still be caught (B3 in the other direction, guarding against overshoot into a false negative).
- **T04** Assert performance envelopes in the harness — max_onboard_seconds = 3x baseline with a 30s floor, soft-asserted so upstream repo growth does not cause flakes. Counts stay volatile.
- **T05** Record the harness own failure modes as tests — 6 tests pinning resetTree staged-file removal, no-commit-in-eval-repos, /dev/null added-file diff shape (which F7 depends on), volatile-field exclusion, every behavioural baseline field, and the presence of a whitelist-independent repo with the F4 gap exercised. Wired into verify:ci as test:harness.
- **T06** Make the harness runnable against an arbitrary repo path — --repo-path with --data-module/--data-symbol/--route-dir/--clean-module/--declare. Prints one result row, never compares to or writes the baseline. Verified against the A6 Supabase fixture: PASS.
- **T08** Verify B4 gitignore claims — Premise CONFIRMED and narrowed. Root .gitignore IS honored (src/generated/ excluded). Nested .gitignore is NOT: packages/inner/ignored-here.ts was indexed despite packages/inner/.gitignore listing it. The ! negation part of the claim is not separately testable because nested ignore files are never read at all.
- **T09** Verify B5 typed-error claim — Premise CONFIRMED: 8 sites, 7 in run-cli.ts plus one in rust-engine.ts. All are user-facing classification, not internal.
- **T11** Audit for other unconditional capability assertions — 22 sites classified in docs/architecture/capability-assertion-audit.md. One real overclaim fixed: candidate inference reported complete:true unconditionally while deciding the data layer by five-substring match - on midday it finds nothing and claimed full coverage. Now derived from whether a data-access candidate was produced, with missing_capabilities and a reason pointing at --data-modules.
- **T11b** Invert the factgraph fail-open completeness default and wire the engine measurement through — Both factgraph completeness fallbacks now default to complete:false with missing_capabilities [completeness_not_reported] and a reason, instead of claiming full coverage plus blocking authority when a caller omits the measurement.
- **T12** Symbol-level type classification: drop imports used only in type positions — dub baseline findings 458 -> 417; type-only false-positive rate 8.5% -> 3.1%, with real headroom under the <10% gate. Zero reconciliation gaps.
- **T13** Reduce whitelist over-matching — cal.com forbidden_imports 6 -> 1: exactly ["@calcom/prisma"], its real data layer. openstatus 4 -> 3, keeping @openstatus/db/src/schema.
- **T14** Assert exact forbidden_imports sets — expectForbiddenExact pins the full set for taxonomy, formbricks, calcom and openstatus; expectForbidden alone only proved the real data layer was present, so cal.com passed while carrying four wrong entries out of six. dub/papermark/midday left as null pending a decision on their expected exact sets.
- **T15** Version-gate incremental scan reuse — Reuse was keyed only on content_hash and byte_size, which assumes a file always yields the same facts. T12 (stop emitting type-only imports) and T13 (narrow data-layer matching) both broke that assumption, so upgrading Drift and rescanning would have silently kept stale facts for every unchanged file - stale analysis presented as current, the exact failure this product exists to prevent.
- **T41** Disk-space preflight in doctor and start — doctor gains a disk_space check reporting free space against an estimate scaled by indexable file count (~220KB of state per file, measured across the eval repos); start refuses with exit 3 and names the remedy rather than only the problem. The external suite already refuses below 5GB from the earlier partial.
- **T40** Stop storing the fact graph twice — dub per-repo state 599 MB -> 394 MB, a 34% reduction, with no functional change.
- **T17** Concurrency: busy_timeout for hook + CLI + MCP — WAL and foreign_keys were already on but busy_timeout was absent, so two concurrent writers hit SQLITE_BUSY immediately - reaching the user as a crash rather than a brief wait. Set to 5000ms, which comfortably covers a single-file check. Three tests: pragmas set, a second connection reads while the first holds the database, and 20 interleaved writes from two connections all land.
- **T20** Deleted-file handling in check — Verified on formbricks: deleting the baselined violating route yields 0 findings, the path is recorded in skipped_deleted_files, deleted_file_count is 1, and no orphaned or re-reported finding appears. Behaviour was already correct; now pinned by tests.
- **T21** Renamed/moved route handling — The concern did NOT materialise. I expected a git rename to present as delete+add, which under A5 block-new would punish a refactor by treating a moved legacy violation as new code.
- **T30** Define the FP metric in the DoD — Definition fixed in PLAN.md: type-only usage counts as a false positive; a runtime import of the data package that is not itself a query (the Prisma error-namespace case) does not, and is documented as policy. Enforcement is the T03 per-repo negative control, not a rate threshold, because after T12 the engine cannot emit a type-only finding by construction.
- **T72** Document the enforcement model honestly — docs/reference/enforcement.md explains why the same violation blocks on formbricks/cal.com/openstatus and only warns on taxonomy/dub/papermark, with the real ratios. Without that explanation the split reads as inconsistency; it is the coverage-direction gate refusing to reject code written like its neighbours.
- **T73** Exit-code and JSON contract reference — Exit codes now in drift --help and in docs/reference/enforcement.md, plus the three fields that get conflated: check.status (did anything blocking happen), finding.enforcement_result (what would this convention do), summary.blocking_count (how many actually block). Documents that enforcement_result block with status pass is not a contradiction, the diff-status semantics including added/renamed/deleted files, the baseline, and how to read completeness.
- **T16** Storage migration path for existing users — Forward migration verified: id-based, forward-only, idempotent, and a database that stopped at migration 8 upgrades to all 27 with data intact. Ids are asserted unique, since they are the upgrade key and a duplicate or rename would silently skip a migration on an existing install.
- **T24** Error-message quality pass — Added the three codes that previously reached users as raw SQLite or filesystem strings: disk_full (I hit "database or disk is full" verbatim mid-scan, with no indication of what to do), corrupt_database and permission_denied. Each carries a cause, a next action, recovery commands, and an honest safe_to_retry - false for corrupt_database and permission_denied, since rerunning cannot fix either and inviting a retry loop wastes time.
- **T29** Verify secret redaction actually applies — Canary test across six surfaces (prepare, ask, repo map, contract show, scan status, findings list) with a marked secret in .env, apps/web/.env and server.pem: zero leaks. Then pinned the mechanism with 15 policy tests.
- **T27** Pin CLI-side enforcement of engine-ignored contract fields — Rewritten from B2, whose premise was false. The engine does bind waivers/exceptions/scope/governance to _ in check_command.rs, but the CLI applies them at every enforcement site, so it is layering rather than a fail-open - and implementing B2 as written would have broken every contract using an exception or waiver.
- **T25** Gate the security heuristics layer behind --experimental-security — Security convention kinds are hidden from listings by default and can never be auto-accepted by --accept-defaults. On dub the default listing drops from 20 candidates to 1 (the layering wedge), with 19 security candidates hidden AND reported, plus the reveal command. Verified the accepted default convention is still the data-access one.
- **T31** Claims to behaviour reconciliation — Every allowed claim is now mapped to the test that proves it, and adding an allowed claim without evidence fails the suite. Also asserts the JSON manifest stays in step with the code manifest, and that the four demoted claims (convention_learning, automatic_convention_inference_for_any_data_layer, security_boundary_proofs, auth_dominance_analysis) stay blocked - a regression re-allowing them would be an overclaim, not a feature.
- **T07** Verify B1 security-layer claims individually _(partial)_ — All 5 audit claims CONFIRMED, plus a 6th found. Written to docs/architecture/security-heuristic-audit.md. Claims 1/2/5 are inspection-only - exercising them needs a hand-written contract naming the auth helper, filed as T07b.
- **T10** Verify remaining A4 sweep items _(partial)_ — Two of four A4 sub-items were already fixed (scan abort, repo_completeness). The remaining two are check_command.rs:655-665 silent continue on unreadable files and :1865 zero security findings when repo_root is absent. Both fold into T25 scope since they sit in the security path being gated; recorded in the capability audit rather than fixed separately.
- **T41** Disk preflight in the external suite _(partial)_ — The suite now refuses to start below 5GB free with exit 3 and the remediation command, rather than failing mid-run. Disk exhaustion happened twice this session; the first time it produced four false failures, the second left the tool unable to write output at all. The drift CLI itself still needs the same preflight (T41 proper).
- **T63** Pin version-constant coupling _(partial)_ — Four TypeScript constants plus the Rust DRIFT_ENGINE_VERSION all read 0.1.0 independently, which makes them look interchangeable. T15 proved they are not: incremental reuse needs the engine version and no TypeScript constant tracks it, so the version had to be threaded from the engine scan_started event. Tests now pin the coupling to package.json and Cargo.toml so a bump cannot silently desynchronise them. Genuinely single-sourcing (generate from one file) is still open.
- **T23** Typed errors for user-facing failures _(partial)_ — Added DriftError carrying its own failure code, user action, recovery commands and retryability. The top-level classifier now reads error.code first and falls back to the existing string matching, so this is incremental rather than a rewrite and no throw site breaks. Migrated the two highest-value sites: missing_contract in repo-paths.ts and insufficient_disk in start.ts (which also converts the disk refusal from a hand-built exit-3 payload into a classified throw).
- **T28** Map every contract field to its enforcement site _(partial)_ — Mapped all RepoContract fields. 13 are genuinely enforced. SEVEN are declared in the schema and read by nothing: enforcement_policy, active_convention_rule_ids, beta_claim_profile, active_semantic_capability_ids, architecture_contract_id, architecture_contract_fingerprint, semantic_capability_contract_version. layer_architecture is a near-miss - written by contract-materialization but never read back.
- **T26** Remove test-tailored literals from production paths _(partial)_ — Removed "withworkspace" from the auth-helper name list, and generalised the dynamic-control-flow valve from three fixture strings to actual dispatch shapes.

## Premise false — deliberately no change

- **T70** Docs audit against A5 behaviour changes
  - Expected docs describing exit 1 for a blocked check to be wrong after A5. They were not: the README and docs never documented drift check exit codes at all, and the only exit-1 references are about the CI gate script. Nothing became stale. The real gap is the inverse - exit codes are now a documented contract with nothing documenting them - which is T73, done alongside.
- **T19** Contract portability across machines
  - The stated concern - that importing a contract from an unrelated repo would be silently accepted - is false. Importing cal.com contract into taxonomy returns imported:false, compatible:false, with reasons [repo_id_mismatch, repo_fingerprint_mismatch]. My first probe reported ACCEPTED only because it checked for an error key rather than reading the compatibility block. The safety check works.

## Discoveries made while working

- **T01a** A6 discovery message suppressed when other candidate kinds exist
  - evidence: midday: data_layer_discovery present in --json but absent from text output because 3 non-data-access candidates exist, so noCandidateText() is never reached. The A6 fixture had zero candidates of any kind, so it passed.
- **T01b** A6 discovery cannot resolve monorepo workspace package imports
  - evidence: midday: declared @supabase/supabase-js and @supabase/ssr found, but reason=data_dependency_declared_but_no_local_wrapper_reached_by_routes. Routes import @midday/supabase/server; the wrapper lives at packages/supabase/src/... specifierPointsAt matches specifier tails against file paths, which handles @/lib/store but not workspace package names.
- **T07c** An inference heuristic hardcodes dub auth helper name, and it is load-bearing
  - evidence: candidate_command.rs:1035 matches!(lower, ... | "withworkspace"). None of the surrounding broad conditions match withWorkspace: it does not start with get and contains none of session/login/authenticate/authguard. So the literal is required for the match.
- **T-disk** Disk exhaustion produced two false test failures mid-run
  - evidence: Free space hit 1.8GB. pnpm -r test reported 2 failures (doctor state, version metadata) and the external suite reported "database or disk is full" for formbricks and calcom. All passed on retry after remediation with no code change.
- **T-stale-binary** Verified against a stale release binary after a Rust source fix
  - evidence: Corrected the T12 retain predicate, ran cargo test (debug) which passed, then measured against target/release which still held the inverted logic - producing a misleading 8.4% result and 3 spurious reconciliation gaps. Rebuilding release gave the true 3.1%.
- **T13b** Boundary rule drops ../../lib/prismaClient, a legitimate client specifier
  - evidence: cal.com previously listed ../../lib/prismaClient; the word-boundary rule drops it because "prisma" is followed by "C" and "client" is preceded by "prisma", so neither token sits at a boundary in the lowercased string.

## Deferred — human-gated by design

- **T-halt** Run halted cleanly: context exhausted after Phase 1 and Phase 2 — Resume at T12 per docs/autonomous-run/HALT.md. Tree green, nothing pushed, 7/7 suite passing.

## Discussion agenda

Blocked tasks in plan order. Each records what was attempted, the evidence, and the
recommendation. Work reverted; the tree is green.

### T01c — Declared-modules convention materialises as block but its finding reports enforcement_result none

- **reason:** verification_failed
- **attempted:** Reproduced the injection by hand twice (one declared module, then both) - both returned enforcement_result=block. Compared mode vs enforcement across all 7 repos.
- **evidence:** midday is the ONLY repo where enforcement_mode(block) != injection_enforcement(none), and the only one using the --data-modules path. formbricks/calcom/openstatus all use inferred candidates and correctly report block. Finding status is 'new', diff_status 'new_in_diff', engine_source 'rust', so it is not a baseline or fallback artifact. Consequence: blocking_count 0, check_status pass, exit 0 - the guardrail does not fail where the contract says it should.
- **diagnosis:** Isolated to declaredDataModulesCandidate (A6), not the engine: enforcementResultFor and enforcement_mode_from_str both map block correctly, and every inferred-candidate repo matches. Not reproducible by hand, which suggests something about the harness sequence (it injects a clean control route alongside the bad one, and runs a separate F4 probe first) interacts with the declared path.
- **needs:** A focused investigation with the declared path instrumented at the point the engine payload is built. This is an F3-class silent failure - a block-mode contract that returns pass - so it should block beta. enforcement_matches_mode is now recorded per repo in the harness baseline; promote it to a hard assertion once fixed.
- **reverted to:** `n/a - diagnostic field added, no behaviour change reverted`

### T07b — Exercise dominance/branch/tenant claims end-to-end with a hand-written auth contract

- **reason:** scope_too_large
- **attempted:** Scanned test/fixtures/security-auth-branch-bypass directly; only data_operation_detected was emitted, no AuthGuardCalled, because guard facts require an accepted convention naming the helper.
- **evidence:** security-auth-branch-bypass fixture exists for the exact bypass case (guard on line 6 inside a branch, sink on line 8 in the else) and NO test in the repo references it. Line 6 < line 8, so naive dominance marks the line-8 sink protected.
- **needs:** A hand-written contract declaring requireUser as the auth helper, plus fixtures for guard-in-dead-branch, guard-in-unrelated-function, else-if chain, ternary guard, and destructured tenant id. Split out because it is a days-scale task, not a verification step.

### T22 — Gitignore correctness via the ignore crate

- **reason:** verification_failed
- **attempted:** Replaced the hand-rolled IgnoreMatcher with ignore::gitignore::GitignoreBuilder rooted at the repo, adding every .gitignore discovered in the tree. Fixture verification passed: nested .gitignore honored (was not) and ! negations honored (were discarded).
- **evidence:** The external suite caught a real regression on openstatus - injection_caught true -> false, catches_genuine_subpath true -> false, status PASS -> FAIL. Root cause: apps/server/.gitignore contains a bare pattern `app`, and GitignoreBuilder::add() interprets patterns relative to the *builder root*, not the added file directory. So a pattern scoped to apps/server/ went repo-wide and excluded apps/dashboard/src/app/ - swallowing openstatus real API routes.
- **diagnosis:** My approach was wrong, not the crate. Per-directory scoping is normally handled by ignore::WalkBuilder, which constructs a separate Gitignore per directory and applies precedence nearest-first. Reverted: a wrong ignore implementation that silently excludes real routes is far worse than the original limitation, since excluded files produce no findings at all.
- **needs:** Either (a) build one Gitignore per directory rooted at that directory and test a path against each applicable one nearest-first, or (b) adopt ignore::WalkBuilder for file discovery, which handles this natively but replaces the existing walk. (b) is cleaner but larger. Note the fixture from T08 passes under the naive approach, so fixture-only verification is insufficient here - the suite is what caught it.
- **reverted to:** `185b9b0`

### T18 — Baseline drift semantics when a baselined file changes

- **reason:** needs_human_decision
- **attempted:** Mapped the full four-case matrix on formbricks, then changed the blocking predicates (blockingCount, blockingNewHunks, warnings, preExisting accounting) so a finding blocks on diff_status=new_in_diff + block regardless of baseline status. Verified all four cases behaved as the plan pre-registered. Reverted after two existing tests failed.
- **evidence:** Matrix as shipped: (1) untouched baselined violation -> no finding, pass. (2) file edited elsewhere -> pre_existing/touched_existing, pass. (3) violating line itself REWRITTEN -> pre_existing/new_in_diff/block but blocking_count 0, pass. (4) violation REMOVED, committed, then REINTRODUCED -> same, pass. So a baseline fingerprint match is a permanent per-violation waiver: rewriting the line or deleting and re-adding it stays exempt forever. My plan pre-registered that (4) must block.
- **diagnosis:** Not a bug - a product decision, and two tests encode the current contract explicitly ("does not fail check for active baseline findings" reuses the same diff that otherwise exits 2, and "preserves human-governed finding statuses during repeated checks"). The tension is that --accept-defaults baselines everything automatically, so an onboarding-time bulk shield is being treated as a considered per-finding waiver. baseline_violations has no provenance column, so the two cannot be distinguished today.
- **needs:** A decision between: (A) keep as-is, baseline = permanent per-fingerprint waiver; (B) baseline shields untouched code only, so rewriting or reintroducing a violation blocks - stronger promise, breaks the tested contract, makes previously-passing diffs fail; (C) add a provenance column to baseline_violations and honour explicit waivers permanently while onboarding baselines shield only untouched code. Recommend C: Drift already has explicit waiver mechanisms (findings suppress, contract waivers), so the bulk onboarding baseline should not silently double as one. C needs a migration, hence the decision.
- **reverted to:** `27ef387`

### T19b — Contract portability is impossible, which invalidates E3 drift.lock premise

- **reason:** needs_human_decision
- **attempted:** Exported taxonomy contract on one checkout and imported it into a second checkout of the same repo at a different path.
- **evidence:** Refused: imported:false, reasons [repo_id_mismatch, repo_fingerprint_mismatch]. Root cause is repoIdForRoot in packages/cli/src/domain/identifiers.ts - repo_${hashStable(resolve(repoRoot))} - so repo identity is derived from the ABSOLUTE PATH. Every teammate checkout is a different repo as far as Drift is concerned, and the repo_fingerprint carries the same derivation.
- **diagnosis:** The compatibility check is correct for foreign contracts; the problem is that path-derived identity cannot distinguish "same repo, different checkout" from "different repo". Direct consequence: E3 pitches contract export as a committed, PR-reviewable drift.lock - a package-lock for your conventions - and that cannot work today, because no teammate can import the committed contract. E4 (GitHub Action) has the same problem: CI checks out to a different path than any developer.
- **needs:** A path-independent repo identity before E3 or E4 can ship. Options: (a) derive from git remote URL plus root commit sha - stable across clones, breaks for repos with no remote; (b) derive from repo content (e.g. root package.json name plus root commit) - no remote needed; (c) allow import with an explicit --allow-path-mismatch flag, cheapest but leaves the identity wrong everywhere else. Recommend (a) with (b) as fallback. This is a design decision affecting stored ids, so it needs a migration story too.
- **blocks:** T49, T50

