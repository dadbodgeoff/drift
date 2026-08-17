# Canary fixtures — the cells the audit corpus could not reach

`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The three
below were added by phase 0b (TDD §4.2) for cells that no fixture in `test/fixtures/` could enter.
They are not audit artifacts and carry no audit numbers.

| Fixture | Cell it exists for | Why a new fixture was needed |
|---|---|---|
| `gt-presence-auth` | `api_route_requires_auth_helper` × `presence_findings` | A presence family is only proposed when **two** helpers from one module each wrap handlers in **two** files (`candidate_command.rs`, `FAMILY_SPECS` + `members.len() < 2`). Sweeping all 79 fixture directories through `scan` → `start` produced no candidate carrying `enforcement_semantics: "presence"`. Arm 3 intercepts before every kind arm, so with no such fixture the whole presence path was unreachable from the test suite. |
| `gt-cors-policy` | `api_route_cors_must_match_policy` × `phase6_proof` | `security-cors-policy-violation` is a single route and is entirely the violation, so it offers no conformance half. The `firing` state requires ≥1 finding on a violation **and** 0 on a conformance route; this fixture supplies both against one inferred policy. |
| `gt-session-trust` | `session_object_must_come_from_trusted_helper` × `phase4_proof` | The two fixtures that already exist for this kind (`security-session-from-request-untrusted`, `security-session-trusted-helper`) are one route each — one entirely the violation, one entirely the conformance — in *separate repos*, so neither can show the check discriminating between siblings in a single run, and neither carries a near-miss. `firing` needs all three in one repo. Reached by `drift contract import` rather than `conventions accept`, because `candidate_command.rs` contains zero occurrences of `ConventionKind::SessionObjectMustComeFromTrustedHelper` — see the note below. |

## Why `gt-session-trust` is imported rather than accepted

Every other canary in `test/e2e/gt-canary.test.ts` obtains its convention from the proposer, and
that is the point of the §4.1 ban. This kind has no proposer at all: there is no candidate to
accept, on any repo, ever. The remaining route is the documented lockfile workflow —
`drift contract export` → edit → `drift contract import drift.lock --repo <id> --confirm`
(`docs/agent-integration.md`) — which is a real user-reachable path, not a test backdoor, and which
still enforces every compatibility and validation refusal a user would hit.

`runGtContractImportWorkflow` (`test/e2e/gt-harness.ts`) keeps that narrow: it asserts the proposer
emitted **no** candidate of the imported kind before it will import one, so the day this kind
becomes proposable the import canary fails and has to move to `runGtWorkflow`. The imported
contract's `scope.path_globs` is the proposer's own literal glob set, pinned against
`candidate_command.rs` by the canary itself — a de-globbed scope would pass even under the historical
`path_glob_matches` and would prove nothing.

## Near-miss content, per §4.3

`gt-presence-auth/lib/blog.ts` exports `withAuthorHat`. The name is a deliberate hit for
`is_auth_candidate_symbol` — it starts with `with`, it contains `auth` — and the body decorates a
response with a byline and checks nothing. It resolves to a different module, so the canary asserts
it never joins the family and that `blog-a.ts` / `blog-b.ts`, which call only it, are still flagged.
Drop those two routes and a detector that simply matched `/auth/i` on the symbol name would score
identically to the real one.

`gt-cors-policy` has no near-miss routes on purpose: the CORS check compares a declared policy
value against an inferred one and is not name-driven, so a lookalike name would test nothing.

`gt-session-trust/app/api/trace/route.ts` reads from the *same* untrusted source as the violating
route — `request.headers.get(...)` — into `traceId`, which is not a session object. A check reduced
to "this route reads a request header" would flag it. The real discriminator is
`is_session_like_variable` (`security_facts.rs:1642`) applied to the assigned variable, and without
this route a detector that dropped that half would score identically to the correct one.
