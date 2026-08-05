# CV-5 blocker: an auto-accepted family's existing violations are never baselined

**Found 2026-08-05 while starting CV-5 piece 1.** Diagnosed, not fixed — the fix touches the
onboarding baseline path, which decides `baselined` on all seven eval repos, and it should land with a
full battery behind it rather than at the end of a session.

## The defect

`packages/cli/src/check/run-check.ts`, `runFullRepoCheck` (the onboarding baseline pass):

```ts
for (const convention of contract.conventions) {
  if (convention.kind !== "api_route_no_direct_data_access") {
    continue;
  }
```

It evaluates **one kind**. Every other accepted convention is skipped, so its pre-existing violations
are never seen and never baselined. That was invisible while onboarding could only ever accept one
convention; CV-5's acceptance floor made it possible to accept more, and this is the first thing that
breaks.

Measured on dub after `--accept-defaults`:

```
baseline_violations   convention_c8a97e3d…  (data-access)   397
                      convention_5a03f3e2…  (auth family)     0
findings              data-access  397 new
                      auth family    0
```

The auth family covers 0.7731 of 357 application routes, so roughly 81 routes do not call a member.
None of them is baselined.

## Why it matters more than a missing count

The user's **first** `drift check` after onboarding reports those ~81 routes as **new** violations —
for code they did not write. That is exactly the decision-C behaviour T121 exists to protect, and
BB-8 exists to keep measurable, reproduced for the newly-accepted kinds.

A secondary symptom: `migration_sentence` is `null` for the family in the guidance packet, because
`baselineActiveCountFor(conventionId)` returns 0. The sentence is what tells an agent the surrounding
violations are not precedent, so its absence is the Q19 shape — but it is downstream of this, not a
separate defect.

## What is NOT wrong, corrected

An earlier report in this session said the family's guidance block carried **0 exemplars**. That was a
measurement error: the reader used the key `exemplars`, and the field is `conforming_examples`. Both
accepted conventions carry three:

```
api_route_requires_auth_helper       conforming_examples: 3   migration_sentence: null
api_route_no_direct_data_access      conforming_examples: 3   migration_sentence: "397 existing…"
```

So CV-5 red #1's exemplar requirement is already satisfied for presence kinds, and the
`will_this_block` field is present too (the earlier report also looked for `will_block`). The only
missing element of red #1 is the migration sentence, and it is missing because of the baseline gap
above.

## The fix, and why it is not a one-liner

Deleting the `continue` is not enough: `runFullRepoCheck` is a hand-rolled data-access evaluator that
walks `import_used` facts directly. It has no presence evaluation, and the presence path lives in the
engine behind `runEngineOwnedAuthCheck`, which is async while `runFullRepoCheck` is sync.

Two shapes, and the choice is a product decision:

**A — extend the onboarding pass.** Make it async and add a presence pass that calls the engine for
presence conventions. Contained, but it duplicates a second evaluation path at onboarding.

**B — have onboarding run the real check.** Replace the hand-rolled pass with the same path
`drift check --scope full` uses, which already evaluates every kind. Removes the duplication and is
the reason the gap existed. **But it changes what seeds the baseline on all seven repos**, so
`baselined` may move even for data-access — and per the BB-8 standing rule, a baseline cell that moves
must be explained by mechanism, not intent. Recommended, with the battery run before and after and the
diff explained per repo.

Either way the DoD is: on dub, `--accept-defaults` baselines the auth family's ~81 pre-existing
violations, the first `drift check` afterwards reports **zero** new findings for that convention, and
the family's `migration_sentence` is non-null.
