# `api_route_requires_service_delegation` fails closed at acceptance

**Status:** decided, implemented
**Date:** 2026-08-17
**Applies to:** `vocabulary/vocabulary.json` (`convention_kind.api_route_requires_service_delegation.dispatch`),
`crates/drift-engine/src/check_command.rs`, `packages/core/src/capabilities.ts`,
`test/canary/convention-cell-ledger.json`

## The state this replaces

A user could run the documented workflow — `drift scan`, `drift start`,
`drift conventions accept <candidate> --confirm` — accept an
`api_route_requires_service_delegation` convention, and get a stored, listed, exported
convention that could not produce a finding on any repo, ever. `drift check` reported
`findings: 0`, `partial_coverage.complete: true`, `check.status: "pass"`, exit 0.

Reproduced end to end on `test/fixtures/next-api-direct-db`, whose single API route imports
Prisma directly and delegates through no service module — an unambiguous violation of the
statement the convention carries ("API routes should delegate business and data-access work
through service modules"). Accepted through the real CLI, checked through the real CLI:
zero findings, `status: pass`.

## Why it could not fire — three independent blocks

1. **Capability mismatch.** Both proposers stamp `enforcement_capability: "heuristic_check"`
   (`crates/drift-engine/src/candidate_command.rs`,
   `packages/cli/src/domain/convention-candidates.ts`). The engine's convention loop requires
   `deterministic_check` before reaching any arm. `conventions accept` cannot override the
   capability — `--mode` and `--severity` are the only knobs, and `--mode block` is *refused*
   for a non-deterministic candidate while `--mode warn` is accepted, which is how the
   convention comes to exist in a state its own evaluator will not serve.

2. **The CLI never dispatches it.** `packages/cli/src/check/run-check.ts` contains zero
   occurrences of the string `api_route_requires_service_delegation`. The two engine-owned
   evaluators select on kind: one takes `api_route_no_direct_data_access`, the other takes the
   twelve security kinds. This kind is in neither list, so the engine is never invoked for it —
   the capability gate above is not even reached.

3. **The matcher's only configurable field is ignored.** `graph_service_delegation_findings`
   takes `_allowed_delegate_imports: &[String]` and never reads it. The proposer derives that
   list from the repo's own service imports and writes it into the accepted matcher, so the one
   thing the convention lets an author configure has no effect on the rule.

The cell ledger recorded the symptom before this decision:
`api_route_requires_service_delegation::graph`, state `needs-review`, `missing_evidence`
recording zero findings across ten probed fixtures including violation-shaped ones. Blocks 1
and 2 explain that result: the function was never called.

## The coverage that hid it

The arm was not untested. `crates/drift-engine/tests/graph_backed_check.rs` carried a matched
pair — `check_repo_flags_route_to_data_access_without_service_delegation` and
`check_repo_allows_route_to_service_to_data_access_flow` — a violation half and a conformance
half, both passing.

Both hand-wrote `"enforcement_capability": "deterministic_check"` into the engine request. No
proposer emits that for this kind; both emit `heuristic_check`. So the pair demonstrated that the
arm *worked* and said nothing about whether it *ran*, and the answer to the second question was
no. That is the same shape as the D1 P0 the canary ledger was built for — both halves of a seam
tested, both tests starting downstream of the seam that was actually broken — and it is why
`test/e2e/service-delegation-capability.test.ts` obtains its candidate from the proposer.

The pair is replaced by `check_repo_receipts_service_delegation_as_having_no_evaluator`, which
asserts the stronger property: a convention of this kind reaching the engine — even claiming
`deterministic_check`, the strongest capability a caller can assert — produces no findings AND a
receipt reading `reached: false, skip_reason: "no_evaluator_for_kind"`, while `completeness` still
reports `complete: true, can_block: true`. That last assertion is the point of the receipt: every
other trust field in the payload says the run was clean and blockable.

## The decision — option (b), fail closed at acceptance

`dispatch` for this kind moves from `engine_direct` to `none` in `vocabulary/vocabulary.json`.
That is the single source the generated `UNEVALUATED_CONVENTION_KINDS`, the Rust
`ConventionDispatch` and the parity gate all read, so:

- `hasConventionEvaluator("api_route_requires_service_delegation")` becomes false;
- `conventions accept` refuses by name, with the reason
  (`packages/cli/src/domain/convention-candidates.ts`);
- `contract import` refuses a contract containing one (`packages/cli/src/commands/contract.ts`);
- the engine's exhaustive match no longer compiles with the kind in an evaluator arm, so the arm
  and `graph_service_delegation_findings` are removed rather than left as dead code that the
  parity gate would flag.

The proposer keeps emitting the candidate. That is the established shape for this state, not an
oversight: `middleware_must_cover_routes` is proposed and refused at acceptance, and the canary
that covers it asserts exactly that pair. A candidate a user can see and cannot accept, with a
stated reason, is more honest than a candidate silently withheld — the observation that routes
do or do not delegate is real and worth reporting; the *enforcement* is what does not exist.

## Why not option (a) — make it deterministic

Option (a) was to make the check genuinely deterministic and align the capability. Rejected on
three grounds, in increasing order of weight:

1. **It is not one change, it is a feature.** All three blocks above have to be removed: a new
   CLI dispatch path, a capability change in two proposers, and an implementation of
   `allowed_delegate_imports`. None of that is remediation of a defect; it is building a rule
   that has never existed.

2. **The rule it would build already exists and works.** `graph_service_delegation_findings`
   flags a route module that imports a data-access module. That is the claim
   `api_route_no_direct_data_access` makes — the ledger's only `firing` layering cell, canary-
   covered on two independent repo shapes, deterministic, and the one convention Drift's own
   capability manifest names as its wedge. Shipping a second gate over the same violation gives
   users two findings per violation and two conventions to reason about, for no additional
   coverage.

3. **The honest version of this kind is a different rule from the one that was proposed.**
   "Delegates through a service module" is not the negation of "imports data access": a route
   can do neither (import nothing) or both. Deciding what the convention should mean, and what
   `allowed_delegate_imports` licenses, is a design question with a real answer — and answering
   it under a remediation branch, on a kind nobody has been able to enforce, would be inventing
   semantics to justify keeping a name.

Fail closed now; if the layering wedge later wants a genuine delegation rule, it starts from a
design rather than from an inert convention that has to be explained away.

## What this costs

Repos whose only candidate is this kind — the case
`packages/core/src/capabilities.ts` records, a fully compliant repo where every route already
delegates — now get an onboarding that proposes a convention `accept` refuses. That is worse
UX than accepting it and worse than proposing nothing. It is better than the state it replaces,
which was accepting it and reporting `pass` over violations forever. The refusal names the kind
and the reason, so the user learns something true.

`heuristic_convention_kinds` in `createDriftCapabilities` becomes empty: it listed exactly this
kind, and the claim it backed — that Drift enforces something heuristically — was never true of
any code path.

## Verification

- `test/e2e/service-delegation-capability.test.ts` drives scan → start → accept and asserts the
  refusal, by name and reason, on a fixture where the proposer does emit the candidate.
- The cell ledger row moves `needs-review` → `quarantined`, citing this document, with the
  refusal canary as the required "asserts no findings" evidence.
