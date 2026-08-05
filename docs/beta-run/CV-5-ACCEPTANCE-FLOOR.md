# The auto-acceptance floor for presence families — pre-registered

**Decision by Geoffrey, 2026-08-05.** Written and committed BEFORE the implementation and before the
measurement, which is the only thing that makes "pre-registered, not fitted" a checkable claim rather
than an assertion. If a later commit moves either constant, the diff has to say why, and "so dub
accepts the family we wanted" is not a why.

## The rule

`drift start --accept-defaults` auto-accepts a presence family at **warn** if and only if BOTH hold:

| Constant | Value | Field it reads |
|---|---|---|
| `PRESENCE_AUTO_ACCEPT_MIN_COVERAGE` | **0.6** | `scoring.coverage_ratio` — conditioned, i.e. within the family's own flavour scope |
| `PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES` | **20** | distinct files in `evidence_refs` |

Below either floor, the family **stays a candidate**. It is not rejected, not hidden, and not
downgraded — it is left for a human, and the BB-3 disclosure names it.

## Why these two, and why both

**Coverage ≥ 0.6, measured within the flavour scope.** A convention that most of its own scope already
follows is a description of the codebase; one that a minority follows is a proposal about it. 0.6 is
the same side of the line as the A5 coverage-direction gate, which demotes a convention violated by
most of the repo on the grounds that it is an aspiration rather than a rule. Accepting a
minority-coverage convention at warn would fill the packet with findings that describe a migration
nobody agreed to.

Conditioned rather than global is load-bearing. dub's auth family reads 0.5709 against all 494 route
files and 0.7731 against the 357 application routes it is actually about. The global number would put
a real convention below the floor because the repo also has 112 cron routes that authenticate
differently — which is the exact miscount CV-2 exists to prevent, reappearing as an acceptance
decision.

**Evidence files ≥ 20.** Coverage is a ratio, and on a small scope a ratio is loud. Four route files
where three call a wrapper is 0.75 coverage from three examples; that is not yet a convention, it is a
coincidence with a good score. The absolute floor stops a small repo — or a small flavour partition
inside a large one — from auto-accepting on almost no evidence. 20 is chosen as roughly an order of
magnitude above the 2-file membership threshold the family deriver already uses, so the two thresholds
are not measuring the same thing twice.

Both, not either: coverage alone admits the tiny-scope case, evidence alone admits the
large-but-unfollowed case.

## What this is not

- **Not a block decision.** Auto-acceptance is at warn, always. Block remains an explicit
  `--mode block` by the author, per the CV-3 condition that a repo's first intentionally-public route
  must not be a false block. Clearing this floor changes what Drift *reports*, never what it *fails*.
- **Not applicable to the proof-tier candidates.** Only candidates carrying
  `enforcement_semantics: "presence"` are eligible. The guard-dominance candidates of the same kinds
  stay quarantined and are never auto-accepted at any coverage.
- **Not a quality claim about the family.** Presence enforcement's residual is unchanged and stated in
  `beta-claims.json`: a route that calls the wrapper but routes a sink around it passes.

## Expected outcome on dub, stated in advance

Recorded before running it, so the measurement can contradict me:

- `api_route_no_direct_data_access` — accepted as it is today, unaffected by this rule.
- **auth family** — expected to clear both floors and auto-accept at warn.
- **rate-limit family** — expected to fail the coverage floor and stay a candidate.
- **request-validation family** — does not exist on dub at all. dub emits zero
  `request_validation_called` facts, so there is nothing to accept or defer. This is why CV-5's
  original DoD of "Accepted 4 conventions" was unreachable: it was written against an assumption that
  a validation family forms, which it cannot until VP-1 gives that kind real detection.

So the expected accepted count on dub is **2**.

## The corrected CV-5 DoD

Superseding "dub onboarding: *Accepted 4 conventions* with per-kind modes":

> dub onboarding accepts every family clearing the floor (measured: 2), the disclosure names
> below-floor candidates with their coverage and a review command, and guidance carries all accepted
> conventions within the 32,768-byte budget on 7/7 repos.

Corrected because the old number rested on a stale premise, not because it was inconvenient. The rule
stands: record what is true, never tune the repo to the number.
