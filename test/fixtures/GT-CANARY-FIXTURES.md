# Canary fixtures — the cells the audit corpus could not reach

`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The two
below were added by phase 0b (TDD §4.2) for cells that no fixture in `test/fixtures/` could enter.
They are not audit artifacts and carry no audit numbers.

| Fixture | Cell it exists for | Why a new fixture was needed |
|---|---|---|
| `gt-presence-auth` | `api_route_requires_auth_helper` × `presence_findings` | A presence family is only proposed when **two** helpers from one module each wrap handlers in **two** files (`candidate_command.rs`, `FAMILY_SPECS` + `members.len() < 2`). Sweeping all 79 fixture directories through `scan` → `start` produced no candidate carrying `enforcement_semantics: "presence"`. Arm 3 intercepts before every kind arm, so with no such fixture the whole presence path was unreachable from the test suite. |
| `gt-cors-policy` | `api_route_cors_must_match_policy` × `phase6_proof` | `security-cors-policy-violation` is a single route and is entirely the violation, so it offers no conformance half. The `firing` state requires ≥1 finding on a violation **and** 0 on a conformance route; this fixture supplies both against one inferred policy. |
| `gt-tenant-scope` | `api_route_requires_tenant_scope` × `phase4_proof` | The ledger recorded this cell as unreachable because "no fixture produces a candidate of this kind". Every `security-tenant-*` fixture is a single route calling `requireUser`, and `push_guard_candidate` (`candidate_command.rs:539`/`:555`) needs the **same** symbol in ≥2 api-route facts **and** a symbol that survives `is_tenant_candidate_symbol` (`:1897`) — `requireUser` fails both halves. Two routes calling `requireTenantScope` supply the candidate; a third unscoped route supplies the violation. |
| `gt-secret-exposure` | `api_route_forbids_secret_exposure` × `phase5_proof` | `security-secret-leak` is one route, is entirely the violation, and sits at `app/api/users/route.ts` with a key (`API_KEY`) that happens to classify — but it offers no conformance half and no log-sink case. This fixture supplies a response-sink violation, a log-sink violation and a compliant sibling in one repo, all under `app/api/**/route.ts` so the proposer's `**/`-prefixed scope has **zero leading segments** to match, which is the case D1 killed. |

## Near-miss content, per §4.3

`gt-presence-auth/lib/blog.ts` exports `withAuthorHat`. The name is a deliberate hit for
`is_auth_candidate_symbol` — it starts with `with`, it contains `auth` — and the body decorates a
response with a byline and checks nothing. It resolves to a different module, so the canary asserts
it never joins the family and that `blog-a.ts` / `blog-b.ts`, which call only it, are still flagged.
Drop those two routes and a detector that simply matched `/auth/i` on the symbol name would score
identically to the real one.

`gt-cors-policy` has no near-miss routes on purpose: the CORS check compares a declared policy
value against an inferred one and is not name-driven, so a lookalike name would test nothing.

`gt-tenant-scope/server/tenant.ts` exports `throwIfTenantScopeMismatch` beside the real
`requireTenantScope`. The name contains both substrings `is_tenant_candidate_symbol` keys on —
`tenant` and `scope` — and the body compares two ids and narrows no query; the filter rejects it
only on its `throwif` prefix. Two routes call it and nothing else, so the canary asserts the
proposer emits exactly **one** candidate and that both of those routes are still flagged. Drop them
and a detector that simply matched `/tenant.*scope/i` would score identically to the real one.
`gt-secret-exposure/app/api/status/route.ts` reads the **same** `process.env.STRIPE_API_KEY` as both
violating routes — same key, same `classify_secret` result, same variable name — and genuinely uses
it, passing it as an outbound request header. The flow simply never reaches a response or an accepted
log sink. A detector reduced to "this route reads a secret-looking env var" scores identically to a
correct one until this route exists, and the canary asserts the engine names it as a *conforming
example* rather than merely failing to flag it.

## The one contract-import canary

`api_route_forbids_secret_exposure` has no proposer at all, so `gt-secret-exposure` is driven through
`drift contract import` rather than `drift conventions accept` — the single exception in
`gt-canary.test.ts`, argued at the test and at `WorkflowOptions.importConventions` in `gt-harness.ts`.
The imported scope is the proposer's own literal glob set, not a de-globbed convenience, so the canary
still dies if the globstar matcher regresses.
