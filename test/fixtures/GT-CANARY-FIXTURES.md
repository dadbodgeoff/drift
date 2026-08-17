# Canary fixtures — the cells the audit corpus could not reach

`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The ones
below were added for cells that no fixture in `test/fixtures/` could enter — the first two by
phase 0b (TDD §4.2). They are not audit artifacts and carry no audit numbers.

| Fixture | Cell it exists for | Why a new fixture was needed |
|---|---|---|
| `gt-presence-auth` | `api_route_requires_auth_helper` × `presence_findings` | A presence family is only proposed when **two** helpers from one module each wrap handlers in **two** files (`candidate_command.rs`, `FAMILY_SPECS` + `members.len() < 2`). Sweeping all 79 fixture directories through `scan` → `start` produced no candidate carrying `enforcement_semantics: "presence"`. Arm 3 intercepts before every kind arm, so with no such fixture the whole presence path was unreachable from the test suite. |
| `gt-cors-policy` | `api_route_cors_must_match_policy` × `phase6_proof` | `security-cors-policy-violation` is a single route and is entirely the violation, so it offers no conformance half. The `firing` state requires ≥1 finding on a violation **and** 0 on a conformance route; this fixture supplies both against one inferred policy. |
| `gt-request-validation` | `api_route_requires_request_validation` × `request_validation_proof` | The proposer needs the **same** validation symbol in ≥2 api-route facts (`push_request_validation_candidates`, `facts.len() >= 2`). `security-validation-before-data` is one route with one `parse` call and `security-validation-missing` is the violation with no validation call at all, so neither reaches the floor and no fixture in the tree produced a candidate of this kind. This fixture carries two conforming `safeParse` routes — which is what makes the candidate exist at all — plus one violating route. |

## Near-miss content, per §4.3

`gt-presence-auth/lib/blog.ts` exports `withAuthorHat`. The name is a deliberate hit for
`is_auth_candidate_symbol` — it starts with `with`, it contains `auth` — and the body decorates a
response with a byline and checks nothing. It resolves to a different module, so the canary asserts
it never joins the family and that `blog-a.ts` / `blog-b.ts`, which call only it, are still flagged.
Drop those two routes and a detector that simply matched `/auth/i` on the symbol name would score
identically to the real one.

`gt-cors-policy` has no near-miss routes on purpose: the CORS check compares a declared policy
value against an inferred one and is not name-driven, so a lookalike name would test nothing.

`gt-request-validation` carries its near-miss inside the conforming routes rather than beside them.
`safeParse` returns a result object, not the parsed value, so a check that merely saw the accepted
symbol get called would pass a route that reads `result` directly and never checks `result.success`.
The canary's conformance half therefore asserts `proven: true` on routes that DO guard and DO use
`result.data` — the shapes `security_control_flow.rs::safe_parse_success_guard_dominates` already
separates in unit tests, now driven through the real workflow.
