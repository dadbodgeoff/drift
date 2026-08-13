# CV-3 is blocked: none of its three kinds meets its own promotion standard

**Written:** 2026-08-04, from a source read of the enforcement paths, before attempting CV-3.
**Status:** needs a decision from Geoffrey. CV-4 and CV-5 depend on it.

CV-3 says a kind leaves quarantine when, among other things, **(a) its matcher is
presence/resolution-only (no control-flow claims)**, and that kinds failing (a) — "guard
*dominance*, sensitive-field *flow*" — "stay experimental regardless of demand." It names three
kinds to promote. All three fail (a) as currently enforced.

This is not a judgement call about where to draw a line. Two of the three say so in their own
source.

## The evidence, per kind

### `api_route_requires_auth_helper`

`crates/drift-engine/src/check_command.rs:146` declares, for this kind and no other reason:

```rust
required_capabilities.extend([
    "security_facts".to_string(),
    "auth_boundary_facts".to_string(),
    "control_flow_guard_dominance".to_string(),
]);
```

The finding it emits (`check_command.rs:856`) reads **"Accepted auth helper must dominate protected
route sinks."** The proof behind it (`security_proof.rs:252`, `build_auth_boundary_proof`) is:

```rust
let dominated_sinks = guard_dominates_straight_line_sinks(&facts);
let mut undominated_sinks = undominated_straight_line_reasons(&facts);
undominated_sinks.extend(branch_bypass_reasons(source, &facts));
undominated_sinks.extend(callback_boundary_reasons(source, &facts));
let dynamic_control_flow = unsupported_dynamic_control_flow(source);
...
let proven = sink_count > 0 && dominated_sinks.len() == sink_count && undominated_sinks.is_empty();
```

Guard dominance, branch-bypass analysis, callback boundaries, and a dynamic-control-flow bail-out.
A kind that declares the capability `control_flow_guard_dominance` cannot be promoted by a standard
that excludes control-flow claims.

Note also `sink_count > 0` is required for `proven`: a route that calls the wrapper but has no
recognised sink is `MissingProof`, i.e. a finding. That is a false-positive shape independent of the
tier question.

### `api_route_requires_rate_limit`

`security_phase6.rs:268` routes this kind to `build_guard_proof` with
`not_dominating_code: "rate_limit_guard_not_dominating_sink"`. Dominance again, by name.

### `api_route_requires_request_validation`

`security_proof.rs:652`, `build_request_validation_proof_with_scope`, correlates
`RequestInputRead` facts to `ValidatedInputUsed` facts through `source_input_var` — input-to-sink
dataflow. Not dominance, but not presence either.

## What this means for the plan

CV-3's §3 red says acceptance of a promoted family must flow through the existing handlers "with
**no changes to the handlers at `run-check.ts:2567+`** — proving, as with the AK plan's §0, that
inference was the only missing half," and adds: **"If a handler needs modification, stop and record
why before proceeding."** This document is that record.

The handlers do exist and are reachable — that part of the plan's premise holds, and
`run-check.ts:2567-2573` dispatches all three kinds. What is false is the plan's stronger claim that
these kinds are "exactly as deterministic as the shipped data-access kind." The *inference* half is
(CV-1 built it, and presence-of-a-family-member is a resolution claim). The *enforcement* half is
not: it computes proofs the security-heuristic audit quarantined.

So promoting these three kinds unchanged would surface, as ordinary blocking conventions, exactly
the control-flow reasoning `docs/architecture/security-heuristic-audit.md` put behind
`--experimental-security`. That is the v1 pattern with better branding, which the CV plan's own
preamble forbids.

## The options, with a recommendation

**A — Promote nothing; leave all 18 quarantined. Close CV-3 as PREMISE_FALSE.**
CV-1's families still improve the product: `conventions list --experimental-security` now shows one
coherent candidate per kind instead of N fragments, and coverage that reflects reality (dub auth
0.032 → 0.571). Nothing regresses. CV-4 and CV-5 become moot as written.
*Cost:* the detection surface stays invisible by default, which is what the sprint set out to fix.

**B — Add a presence-only enforcement mode for family kinds, then promote. (Recommended.)**
Give the three family kinds a second enforcement semantics: *satisfied iff the route calls a family
member*, with no proof object, no dominance, no sink requirement. That is a new code path beside the
existing proof path — the existing one keeps its semantics and stays quarantined; the family path is
presence-only and promotable, and it is honestly weaker: it cannot catch a wrapper that is present
but bypassed on a branch. CV-4's evasion matrix then tests exactly what that mode claims, which is a
much smaller and more honest surface than the current matcher's.
*Cost:* it is a handler change, which CV-3 told me to stop before making — hence this document.
Roughly 1–1.5 agent-days plus CV-4's matrix against the new mode.
*Why recommended:* it is the only option that delivers the sprint's goal without promoting a
dominance claim, and the weaker guarantee is statable in one sentence to a user, which the current
proof's failure modes are not.

**C — Promote with the existing proof semantics and document the caveat.**
Not recommended, and I would push back if asked. It ships guard dominance as a default-visible
blocking convention on the strength of a doc paragraph. `sink_count > 0` alone would flag wrapped
routes that do nothing a sink detector recognises.

## What I did instead of guessing

CV-1 is complete and committed (`b03e4b6f`) — it is pure inference and unaffected by any of this.
CV-2 is also inference-side and can proceed. CV-3 stops here pending the decision; CV-4 and CV-5 are
`SKIPPED_DEPENDENCY` because both verify or surface a promotion that has not happened.
