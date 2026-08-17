# Canary fixtures — the cells the audit corpus could not reach

`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The two
below were added by phase 0b (TDD §4.2) for cells that no fixture in `test/fixtures/` could enter.
They are not audit artifacts and carry no audit numbers.

| Fixture | Cell it exists for | Why a new fixture was needed |
|---|---|---|
| `gt-presence-auth` | `api_route_requires_auth_helper` × `presence_findings` | A presence family is only proposed when **two** helpers from one module each wrap handlers in **two** files (`candidate_command.rs`, `FAMILY_SPECS` + `members.len() < 2`). Sweeping all 79 fixture directories through `scan` → `start` produced no candidate carrying `enforcement_semantics: "presence"`. Arm 3 intercepts before every kind arm, so with no such fixture the whole presence path was unreachable from the test suite. |
| `gt-cors-policy` | `api_route_cors_must_match_policy` × `phase6_proof` | `security-cors-policy-violation` is a single route and is entirely the violation, so it offers no conformance half. The `firing` state requires ≥1 finding on a violation **and** 0 on a conformance route; this fixture supplies both against one inferred policy. |
| `gt-tenant-scope` | `api_route_requires_tenant_scope` × `phase4_proof` | The ledger recorded this cell as unreachable because "no fixture produces a candidate of this kind". Every `security-tenant-*` fixture is a single route calling `requireUser`, and `push_guard_candidate` (`candidate_command.rs:539`/`:555`) needs the **same** symbol in ≥2 api-route facts **and** a symbol that survives `is_tenant_candidate_symbol` (`:1897`) — `requireUser` fails both halves. Two routes calling `requireTenantScope` supply the candidate; a third unscoped route supplies the violation. |

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
