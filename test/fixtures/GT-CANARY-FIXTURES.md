# Canary fixtures — the cells the audit corpus could not reach

`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The ones
below were added for cells that no fixture in `test/fixtures/` could enter — the first two by phase
0b (TDD §4.2). They are not audit artifacts and carry no audit numbers.
`GT-CORPUS.md` documents the six `gt-` directories the falsification audit hand-built. The three
below were added by phase 0b (TDD §4.2) for cells that no fixture in `test/fixtures/` could enter.
They are not audit artifacts and carry no audit numbers.

| Fixture | Cell it exists for | Why a new fixture was needed |
|---|---|---|
| `gt-presence-auth` | `api_route_requires_auth_helper` × `presence_findings` | A presence family is only proposed when **two** helpers from one module each wrap handlers in **two** files (`candidate_command.rs`, `FAMILY_SPECS` + `members.len() < 2`). Sweeping all 79 fixture directories through `scan` → `start` produced no candidate carrying `enforcement_semantics: "presence"`. Arm 3 intercepts before every kind arm, so with no such fixture the whole presence path was unreachable from the test suite. |
| `gt-cors-policy` | `api_route_cors_must_match_policy` × `phase6_proof` | `security-cors-policy-violation` is a single route and is entirely the violation, so it offers no conformance half. The `firing` state requires ≥1 finding on a violation **and** 0 on a conformance route; this fixture supplies both against one inferred policy. |
| `gt-tenant-scope` | `api_route_requires_tenant_scope` × `phase4_proof` | The ledger recorded this cell as unreachable because "no fixture produces a candidate of this kind". Every `security-tenant-*` fixture is a single route calling `requireUser`, and `push_guard_candidate` (`candidate_command.rs:539`/`:555`) needs the **same** symbol in ≥2 api-route facts **and** a symbol that survives `is_tenant_candidate_symbol` (`:1897`) — `requireUser` fails both halves. Two routes calling `requireTenantScope` supply the candidate; a third unscoped route supplies the violation. |
| `gt-secret-exposure` | `api_route_forbids_secret_exposure` × `phase5_proof` | `security-secret-leak` is one route, is entirely the violation, and sits at `app/api/users/route.ts` with a key (`API_KEY`) that happens to classify — but it offers no conformance half and no log-sink case. This fixture supplies a response-sink violation, a log-sink violation and a compliant sibling in one repo, all under `app/api/**/route.ts` so the proposer's `**/`-prefixed scope has **zero leading segments** to match, which is the case D1 killed. |
| `gt-authorization` | `api_route_requires_authorization` × `phase4_proof` | The cell was `needs-review` on the evidence that no fixture produces a candidate of this kind. That is a fixture-shape problem, not an engine one: `push_guard_candidate` (`candidate_command.rs`) nominates a symbol only when it appears in **≥2** route facts, and `security-role-guard-present`, `security-role-missing` and `security-role-branch-bypass` are each a single route making a single `requireRole` call, so the group never reaches the threshold and the kind was unreachable from the documented workflow. This fixture calls one helper, `requirePermission`, from three of its five `app/api/.../route.ts` files, which is what makes it a convention rather than a one-off. |

## Why `gt-authorization`'s guard takes no arguments

`requirePermission()` is called with an empty argument list, not as
`requirePermission(session.user, "projects:write")`. That is forced, and it is worth knowing why
before anyone "fixes" the fixture to read more naturally.

`build_authorization_proof_from_facts` (`security_proof.rs`) records `session_not_trusted` for any
guard whose first argument is not a variable listed in `session_trust.trusted_sessions`. Trusted
sessions come only from `SessionRead` facts with `source: "auth_result"`, which `security_facts.rs`
emits only for a helper listed in the convention's `requires.auth_helpers`. A candidate of kind
`api_route_requires_authorization` carries `requires.authorization_helpers` and nothing else — the
proposer never puts `auth_helpers` on it — so `trusted_sessions` is necessarily empty, and **any**
subject argument makes the proof fail. A guard called with no arguments has no `subject_var`, the
check is skipped, and the conformance half is expressible. See the report accompanying this fixture:
the false positive is real and is deliberately left unfixed here, because fixing it means changing
shared phase-4 proof semantics.
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

`gt-authorization` carries two, one per side of the workflow. `logPermissionCheck` is a proposal-side
near-miss: it passes `is_authorization_candidate_symbol` on its name alone (lowercased, it contains
`permission`) and guards nothing, and one call site keeps it below the ≥2 threshold, so it must never
be nominated while the route calling it must still be flagged. `app/api/audits/route.ts` is an
enforcement-side near-miss: it does call the accepted helper, but after the sink has already run, so
a presence-only matcher scores it clean while this path must report
`authorization_guard_not_dominating_sink`. Drop either route and a name match plus a call-presence
check would score identically to the real evaluator.

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
`gt-session-trust/app/api/trace/route.ts` reads from the *same* untrusted source as the violating
route — `request.headers.get(...)` — into `traceId`, which is not a session object. A check reduced
to "this route reads a request header" would flag it. The real discriminator is
`is_session_like_variable` (`security_facts.rs:1642`) applied to the assigned variable, and without
this route a detector that dropped that half would score identically to the correct one.
