# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 11 |
| Done (partial) | 2 |
| Premise false (no change needed) | 0 |
| Blocked — needs discussion | 2 |
| Skipped — dependency blocked | 0 |
| Deferred — human-gated | 1 |
| Discoveries | 4 |
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
- **T07** Verify B1 security-layer claims individually _(partial)_ — All 5 audit claims CONFIRMED, plus a 6th found. Written to docs/architecture/security-heuristic-audit.md. Claims 1/2/5 are inspection-only - exercising them needs a hand-written contract naming the auth helper, filed as T07b.
- **T10** Verify remaining A4 sweep items _(partial)_ — Two of four A4 sub-items were already fixed (scan abort, repo_completeness). The remaining two are check_command.rs:655-665 silent continue on unreadable files and :1865 zero security findings when repo_root is absent. Both fold into T25 scope since they sit in the security path being gated; recorded in the capability audit rather than fixed separately.

## Discoveries made while working

- **T01a** A6 discovery message suppressed when other candidate kinds exist
  - evidence: midday: data_layer_discovery present in --json but absent from text output because 3 non-data-access candidates exist, so noCandidateText() is never reached. The A6 fixture had zero candidates of any kind, so it passed.
- **T01b** A6 discovery cannot resolve monorepo workspace package imports
  - evidence: midday: declared @supabase/supabase-js and @supabase/ssr found, but reason=data_dependency_declared_but_no_local_wrapper_reached_by_routes. Routes import @midday/supabase/server; the wrapper lives at packages/supabase/src/... specifierPointsAt matches specifier tails against file paths, which handles @/lib/store but not workspace package names.
- **T07c** An inference heuristic hardcodes dub auth helper name, and it is load-bearing
  - evidence: candidate_command.rs:1035 matches!(lower, ... | "withworkspace"). None of the surrounding broad conditions match withWorkspace: it does not start with get and contains none of session/login/authenticate/authguard. So the literal is required for the match.
- **T-disk** Disk exhaustion produced two false test failures mid-run
  - evidence: Free space hit 1.8GB. pnpm -r test reported 2 failures (doctor state, version metadata) and the external suite reported "database or disk is full" for formbricks and calcom. All passed on retry after remediation with no code change.

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

