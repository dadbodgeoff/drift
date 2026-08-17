# `needs-review` should stop being a passing ledger state

**Status:** proposed; mechanism implemented and shipped default-off
**Date:** 2026-08-17
**Applies to:** `test/canary/convention-cell-ledger.json`, `scripts/convention-cell-ledger.mjs`,
`test/e2e/ledger-needs-review.test.ts`

## The state today

The canary ledger declares one state per (convention kind × enforcement path) cell. Four states,
of which three carry evidence:

| state | evidence required |
|---|---|
| `firing` | a passing canary: ≥1 finding on a violation fixture, 0 on a conformance fixture |
| `quarantined` | a located citation, quoted, plus a test asserting no findings |
| `unimplemented` | a passing test proving the proposer emits no candidate of this shape |
| `needs-review` | **none.** The default, assigned when the other three could not be produced |

`needs-review` passes CI. That was the right call when the ledger was written, and the file says
why in terms worth preserving: assigning `quarantined` by inference is a claim about intent, and
guessing it converts an undiscovered P0 into a checked-in "working as designed", which is exactly
how D1 survived. A state that admits ignorance is better than one that manufactures a conclusion.

Six cells are `needs-review` today (seven before
[the service-delegation decision](./service-delegation-capability.md) resolved one):

- `api_route_requires_request_validation::presence_findings`
- `api_route_requires_rate_limit::presence_findings`
- `api_route_forbids_untrusted_ssrf::phase6_proof`
- `api_route_forbids_raw_sql_without_params::phase6_proof`
- `api_route_requires_csrf_for_mutation::phase6_proof`
- `api_route_requires_rate_limit::phase6_proof`

## Why it should tighten

The argument is the one the evaluation receipts were built on, moved up one level.

Receipts exist because a convention that never ran and a convention that ran and found nothing
produced identical check output, so a dead rule shipped looking like a clean one. `needs-review` is
that same collapse in the release process rather than in a payload: a cell nobody has been able to
evaluate ships exactly as quietly as a cell that was evaluated and found healthy. `pnpm verify:ci`
prints `needs-review 6` and exits 0, and 6 is a number that has never had to go down.

Every one of the six is `needs-review` for the same reason, and it is the worst of the available
reasons. Not "the canary is awkward to write" and not "the evaluator is flaky" — **the proposer
emits no candidate of that shape at all**, on any fixture in the corpus, so no convention of that
shape can be accepted, so `drift check` produces no receipt for it. Read against the receipt
vocabulary that is not `reached: false`; it is one state weaker:

| receipt | meaning |
|---|---|
| `reached: true` | an evaluator ran for a convention of this shape |
| `reached: false` | a convention of this shape exists and its evaluator did not run |
| `reached: null` | no convention of this shape can be accepted here, so no receipt exists |

`reached: false` is a rule you can point at and say "this did not fire". `null` is a rule with no
observable behaviour whatsoever — the evaluator's arm has never been entered by anything a user
could produce. Five of the six phase-6 and presence cells sit there with emission code present in
`candidate_command.rs` and no input that reaches it, which is precisely the shape of the original
disaster: an implementation that exists, is tested in isolation, and is unreachable in practice.

## What ships now

**The evidence.** Every `needs-review` cell carries `receipt_evidence: { reached, source, note }`,
and the ledger gate requires it unconditionally — not only under strict mode. That ordering is
deliberate: a policy cannot be decided on data that will only be collected once the policy is
adopted.

**The re-derivation.** `test/e2e/ledger-needs-review.test.ts` drives the proposer over the fixtures
each cell's own `missing_evidence` names and asserts the recorded value is still true. It probes on
the (kind × enforcement path) pair rather than the kind, because `is_presence_convention`
dispatches on `matcher.enforcement_semantics` before any kind arm — `api_route_requires_request_validation`
is `firing` on its per-symbol path and `needs-review` on its presence path, and a kind-level probe
would call the second one stale on the strength of the first. If a shape becomes proposable, this
test fails and says so, with the remedy: accept the candidate, read the receipt, re-derive the
state.

**The gate.** `DRIFT_LEDGER_STRICT_NEEDS_REVIEW=1`, on an enforcing branch, makes a `needs-review`
cell whose `receipt_evidence.reached` is not `true` a failure. Exercised in both positions against
the real committed ledger (`scripts/convention-cell-ledger.test.mjs`), because a flag nobody has
watched fail is a flag nobody knows works.

## Why default off

**Turning it on today reds the gate on all six cells.** That is not a reason to weaken the rule; it
is the reason the flip is somebody's decision rather than a side effect of building the
measurement. The honest options are: write fixtures that make the five unproposable shapes
proposable, or accept that Drift ships kinds it cannot demonstrate. Both are real answers and
neither is mine to pick from inside a remediation branch — the same principle the ledger already
states about state transitions ("made by the lead at integration time, never speculatively on the
strength of another track's in-flight work").

**The strict criterion is deliberately narrow.** It fails a cell for being *unmeasured*, not for
being *unfinished*. A cell whose kind is evaluated on the corpus — reviewed for a missing
conformance half, an unverified message, an awkward assertion — passes strict mode, and there is a
test pinning that. What strict mode objects to is a rule with no observable behaviour.

**One thing it must never teach.** A red cell is fixed by making it evaluable, not by editing its
`receipt_evidence`. The failure message says so, and the re-derivation test is what makes the
evidence expensive to falsify.

## Recommendation

Flip it once the phase-6 and presence shapes have fixtures — five candidate emissions to reach, all
with existing emission code. Until then the count is visible, the evidence is recorded, and the
mechanism is one environment variable away.

The interim state is honest but not comfortable, and that is the point of writing it down: `needs-review 6`
in CI output currently means "six enforcement paths have never been shown to work", and nothing in
the build says it out loud.
