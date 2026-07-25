# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 3 |
| Done (partial) | 0 |
| Premise false (no change needed) | 0 |
| Blocked — needs discussion | 1 |
| Skipped — dependency blocked | 0 |
| Deferred — human-gated | 0 |
| Discoveries | 2 |
| Baseline changes | 0 |

## Completed

- **T00** Install autonomous run protocol, plan, and log tooling — triage-and-continue lifecycle; log.jsonl as resume substrate; tacit-knowledge section covering the traps that cost time in the prior session
- **T01** Add a 7th eval repo whose data layer defeats the substring whitelist — midday-ai/midday (Supabase monorepo, @midday/supabase/server). Screened 3 candidates; basejump had 0 API routes, supabase/supabase studio uses an apiWrapper indirection. midday exercises the F4 gap on a real repo: 3 candidates inferred, none data-access.
- **T02** Assert the F4 path in the harness, not just observe it — whitelistIndependent repos run a pre-pass without --data-modules; assert inference alone finds nothing AND discovery names the expected wrapper. Caught my own inverted assertion polarity before it became a false green.

## Discoveries made while working

- **T01a** A6 discovery message suppressed when other candidate kinds exist
  - evidence: midday: data_layer_discovery present in --json but absent from text output because 3 non-data-access candidates exist, so noCandidateText() is never reached. The A6 fixture had zero candidates of any kind, so it passed.
- **T01b** A6 discovery cannot resolve monorepo workspace package imports
  - evidence: midday: declared @supabase/supabase-js and @supabase/ssr found, but reason=data_dependency_declared_but_no_local_wrapper_reached_by_routes. Routes import @midday/supabase/server; the wrapper lives at packages/supabase/src/... specifierPointsAt matches specifier tails against file paths, which handles @/lib/store but not workspace package names.

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

