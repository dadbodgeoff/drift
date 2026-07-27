# DRAFT — not published

Outward-facing. Needs explicit approval before it goes anywhere.

---

# I ran my AI-code guardrail against six real repos. It failed four of them.

I built a tool that stops AI agents from writing code that violates conventions your repo already
follows. It passed its own test suite. Then I pointed it at six real open-source Next.js
codebases — cal.com, dub, formbricks, papermark, openstatus, taxonomy — and it fell over on four
of them.

Here is every bug, what caused it, and what it cost to fix. I am publishing this because the
failures are more useful than the demo, and because a guardrail you cannot trust is worse than no
guardrail: it converts "we don't know" into "we checked, it's fine."

## The two that crashed

**F1 — a UNIQUE constraint, on 43 of papermark's 334 entrypoints.**
A Pages Router file that exports both `export const config = {...}` and
`export default function handler(...)` produced two rows with the same entrypoint id, inserted
without conflict handling. cal.com hit it on its Stripe webhooks. Exit 1, no findings, no partial
result.

**F2 — the tool threw on its own inconsistency.**
`Missing import_used fact for deterministic direct-data finding`. A multi-line named import with
an inline `type` modifier folded `type ` into the symbol name, so the finding referenced a fact
that had never been recorded. It crashed rather than reporting anything.

Both are ordinary bugs. Neither would have survived a week of real use — which is the point: they
survived a full test suite.

## The one I would fix first

**F3 — a glob that could never match.**

Drift compiled `**/app/api/**/route.ts` into a regex requiring a leading `/`. So a violating route
at `app/api/…` was invisible, while a byte-identical file at `src/app/api/…` was caught.

That alone is a normal bug. What makes it the one I would fix first is what the tool reported
while it was happening:

```json
"findings_count": 0,
"status": "pass",
"capability_completeness": { "complete": true, "can_block": true }
```

Not "I couldn't check." Not "partial coverage." A clean pass, and an explicit claim of complete
coverage, on a repository where the check had matched nothing at all. A user would have read that
as *verified*.

This is the failure mode that matters for any tool in this category. Being wrong is recoverable.
Being confidently wrong, with a green check, is what makes people stop looking.

## The one that meant it never blocked anything

**F6 — out of the box, the guardrail could not fail CI.**

`drift start --accept-defaults` materialised the convention in `warn` mode. A live violation in a
new hunk produced `enforcement_result: "warn"`, `status: "pass"`, **exit code 0**. The tool
correctly identified the violation, attached the evidence, and let it through.

The fix was not simply "block by default", and this is where it got interesting. Drift infers the
convention *from the violations*. On dub, 323 of 494 routes violated it. Blocking by default there
would reject new routes written exactly like the 323 that already exist — which is the opposite of
holding code to a repo's established patterns.

So the mode now follows the direction of the evidence. A minority violating means the convention
is real and new violations block. A majority violating means it is a refactor goal, and it warns
until a human decides. formbricks (1 route of 83) blocks; dub warns.

**F7** compounded it: a brand-new file reported `diff_status: "touched_existing"`, so new
violations inherited the exemption meant for legacy code.

## The one that was never really learning

**F4 — inference no-ops on data layers it does not recognise.**

Drift claimed to learn conventions. It recognised a data layer by testing whether the import
specifier contained one of five substrings: `prisma`, `database`, `db`, `data-access`. A repo
naming its data layer `store`, `supabase`, `repository` or `models` produced **zero** candidates
for the identical violation.

The fix here was mostly honesty. The claims manifest now blocks
`automatic_convention_inference_for_any_data_layer` and `convention_learning` outright, and the
README says plainly that Drift bootstraps and enforces a *declared* layering contract. A repo with
an unrecognised data layer declares it with `--data-modules`.

I also added a seventh evaluation repo — midday, whose Supabase data layer matches none of the
substrings — specifically so the test suite can tell whether this ever regresses. It could not
before: all six original repos named their data layer something the whitelist happened to match,
so the suite would have passed whether or not the feature existed.

## The noisy ones

**F5 — 8.5% false positives on dub**, all type-only imports. `import { Domain } from
"@prisma/client"` used solely as `Pick<Domain, …>` is erased by TypeScript and creates no runtime
dependency on the data layer. Modelling type positions properly took it to 3.1%.

**F8 — candidate noise.** 19 of dub's 21 inferred candidates sat under 5% coverage. One proposed
that mutation routes "validate request input with `validateBounty`" — 2 supporting examples across
494 route files. Non-blocking, but it is what a human reviewing defaults has to read past.

## What I would tell you to check in your own tool

Three things, in order.

**Does it distinguish "clean" from "could not check"?** F3 is the whole argument. Every scan should
report what it actually inspected, and a tool that could not inspect anything should refuse rather
than pass. Drift now exits `3` for that case — distinct from `0` (clean) and `2` (violation found).

**Does your test suite fail when the feature is removed?** Mine did not for F4. I deliberately
broke five core behaviours afterwards to check; the sharpest result was that two of them were
caught by a single unit test but by fourteen checks across the real repositories. The unit tests
were not what was guarding the product.

**Does it work on a repo you did not choose?** Every one of these was found by pointing the tool at
code I had not seen. None were found by the test suite, and the suite was not small.

## Where it is now

Seven repos, checked on every change: all seven onboard, learn the real data layer, and catch an
injected violation with correct file-and-line evidence. Zero false positives on properly layered
routes. The false-positive rate on dub is 3.1%.

The evaluation harness is in the repo. So is a document listing seven contract fields that are
accepted, stored, and enforced by nothing — because that one is not fixed yet, and the same
argument applies to it.
