# Concepts

Five things, in the order Drift produces them.

```
files → facts → contract → baseline → check
```

## Facts

A **fact** is something observed in source, with a location. `import_used`, `route_handler`,
`data_operation`. They are extracted by the Rust engine using tree-sitter, and they are the only
input to everything downstream.

Facts are deliberately dumb. `import_used: prisma from @/lib/prisma at route.ts:2` says nothing
about whether that is good or bad. Judgement happens later, against a contract.

Two properties matter:

**One parser.** There was once a TypeScript re-implementation alongside the engine, and the two
disagreed — the TypeScript side matched `@/lib/prisma-client` where the engine did not, so a
finding's existence depended on which code path reached it. Everything now reads engine facts.

**Type-only bindings are not facts.** `import type { User }` is erased by TypeScript and creates
no runtime dependency, so recording it would produce findings about code that does not exist at
runtime. Removing this class took the false-positive rate on dub from 8.5% to 3.1%.

## Contract

A **contract** is the set of conventions Drift will enforce, stored per repo. A convention is a
statement plus a matcher plus a scope:

```
statement  API routes should not import data-access clients directly
matcher    forbidden_imports: ["@calcom/prisma"]
scope      **/app/api/**/route.ts, file_roles: [api_route]
```

Conventions start as **candidates** inferred from the repo, and become part of the contract only
when a human accepts one. `--accept-defaults` accepts the strongest candidate at onboarding.

The inference is narrower than it looks, and this is stated plainly rather than buried: a data
layer is recognised when its import specifier contains `prisma`, `database`, `db`, or
`data-access`. A repo naming its data layer `store` or `supabase` infers nothing, and must
declare it with `--data-modules`. Drift bootstraps and enforces a *declared* layering contract;
it does not learn conventions in general. The claims manifest blocks
`automatic_convention_inference_for_any_data_layer` for exactly this reason.

## Baseline

The **baseline** is every violation that existed when you onboarded. Baselined findings do not
block.

This is what makes enforcement safe on a repo that already violates the convention hundreds of
times. Without it, adopting Drift would mean either fixing 417 files first or turning enforcement
off — and the second always wins.

One sharp edge, recorded rather than hidden: a baseline entry is currently a **permanent** waiver
for that exact violation. Rewriting the violating line, or deleting it and adding it back, stays
exempt. Whether that is right is an open question — see T18 in
[autonomous-run/SUMMARY.md](./autonomous-run/SUMMARY.md).

## Check

A **check** answers one question: does this diff introduce a new violation?

Three fields, three different questions, and they are easy to confuse:

| Field | Question |
|---|---|
| `check.status` | did anything blocking happen? |
| `finding.enforcement_result` | what would this convention do about this finding? |
| `summary.blocking_count` | how many findings actually block this diff? |

A finding can be `enforcement_result: "block"` while status is `pass` — the convention *would*
block, but this finding is not new code. Only findings that are new **and** in a changed hunk
**and** under a block-mode convention count.

Full semantics in [reference/enforcement.md](./reference/enforcement.md).

## Completeness

Every scan reports what it actually inspected. `complete: false` with `missing_capabilities`
means coverage was partial — a file that could not be read, or no data-access convention could be
inferred.

This exists because the alternative is worse. A guardrail that reports success when it could not
inspect anything is not a guardrail; it is a false sense of one. When Drift cannot check, it says
so and exits `3` rather than `0`.
