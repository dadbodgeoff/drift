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

---

## Status 2026-08-05, end of session: items 1 and 2 landed, item 3 (this document) NOT started

Geoffrey's ordering was: (1) generalize the exemplar predicate, (2) convention-scope the harness,
(3) unify the onboarding baseline pass, (4) flip the default, (5) the small pieces — with the fallback
"if context runs short: land 1–3, leave the default gated, and hand off 4–5."

**Landed: 1 and 2.** **Not landed: 3.** One item short of the fallback, stated plainly rather than
rushed, because item 3 changes what seeds the baseline on all seven eval repos and needs a battery on
either side of it. Starting that with no budget left to read the diff is how a seven-repo regression
gets handed over as done.

### What items 1 and 2 bought, measured

With auto-acceptance temporarily forced default-on and items 1–2 in place, `eval:external` on all seven
repos:

```
ok  taxonomy   cleanFP=no neg=ok exemplars=6/6   guidance=3k
ok  dub        cleanFP=no neg=ok exemplars=21/21 guidance=6k
ok  formbricks cleanFP=no neg=ok exemplars=6/6   guidance=4k
ok  calcom     cleanFP=no neg=ok exemplars=6/6   guidance=4k
ok  papermark  cleanFP=no neg=ok exemplars=6/6   guidance=4k
ok  midday     cleanFP=no neg=ok exemplars=6/6   guidance=4k
ok  openstatus cleanFP=no neg=ok exemplars=6/6   guidance=4k
```

Every one of the four assertions that failed before is green: `exemplar_integrity` holds at **21/21** on
dub, and `clean_control_false_positive`, `fp_type_only_import` and `fp_lookalike_module` are all back to
false. The evasion cells pass too.

Three diffs vs baseline remain, and all three are the intended consequence of a second accepted
convention rather than defects:

| Cell | Movement | Mechanism |
|---|---|---|
| `findings_count` (dub) | 2 → 7 | The harness injects five routes (bad, clean, type-only, lookalike, subpath). All five call no auth wrapper, so the auth family reports five true findings on top of the two data-access ones. |
| `exemplars_emitted` (dub) | 6 → 21 | More findings carry more exemplar sets. All 21 are integrity-clean, which is the point of item 1. |
| `guidance_bytes` (dub) | 5,501 → 6,567 | A second accepted convention in the guidance view. Still far inside the 32,768 ceiling. |

Those three are the `BASELINE_CHANGE` that item 4 has to record, with this table as its mechanism.

### Item 3, unchanged and still approved

Everything above the divider stands. The recommended shape is B — have onboarding run the same path
`drift check --scope full` uses. `ParsedArgs` is only `{ positional, flags }`, so synthesizing one for
`runCheck` is mechanically easy:

```ts
const checkParsed: ParsedArgs = {
  positional: [],
  flags: new Map<string, string | true>([["repo", repoId], ["scope", "full"], ["json", true], ["now", now]])
};
```

The work is not the call, it is the consequences: `runCheck` writes a check run, emits audit events, and
creates findings for **every** accepted kind, so `baselined` may move on all seven repos including for
data-access. Per the BB-8 standing rule each movement must be explained by mechanism, not intent, which
means a battery before and after and a per-repo diff read.

**Item 3 lands before item 4.** An auto-accepted family that floods the user's first check is worse than
no family, which is why the gate stays until this is done.
