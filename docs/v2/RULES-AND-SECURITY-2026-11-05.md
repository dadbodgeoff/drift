# Rules beyond wrappers, and security as facts (2026-11-05)

> **Dated record (2026-11-05).** This page records Drift as it was on that date and is
> kept as written, apart from this note. It is not current documentation:
> behaviour, output and figures may have changed since. The [README](../../README.md)
> describes the current product, and its
> [Limits of the beta](../../README.md#limits-of-the-beta) gives the current
> precision figures and their sources in `eval/study/runs/`. Precision figures
> here are development-set figures under the tier and rubric of their date, and
> none is a held-out result. Under decision D7 the default tier is TypeScript
> call wrappers and layering only, Python advises only, and the default tier
> ships as advise until it measures ≥ 95% on a held-out set.

This milestone adds the facts found missing in the 16-repo evaluation to
mining and check, and adds a security inventory. Drift still prescribes nothing:
every rule is learned from the repo, and security findings are listed as facts
for people to judge.

## New units

Conventions used to be about exported symbols only. A unit is now one of:

| Unit | Role | Example rule |
| --- | --- | --- |
| Symbol | package, directory, file kind, entry kind, symbol kind (unchanged) | "HTTP handlers in `app/api/**` call `requireUser()` before `db.query()`" |
| File | the same selectors with kind `module`, plus one package-wide role (`dir: "**"`) | "files in `packages/ui/**` do not import `next`" |
| Model | one role per source (`prisma`, `drizzle`, `sql`) | "prisma models have a `createdAt` field" |
| Package | one role for all workspace packages (the root manifest is left out in monorepos) | "workspace packages define a `lint` script" |

`check`, `drift example`, the hooks and the MCP tools evaluate all four.
Violations of file, model and package rules are keyed `path#(file)`,
`schema.prisma#Model` and `pkg/package.json#name` in `drift.lock`.

## New rules

| Rule | Holds when | Population | Notes |
| --- | --- | --- | --- |
| `throws` | the symbol throws this class | role | internal error classes score as specific; `global#Error` does not |
| `named` | the name matches `use*` / `get*` (lowercase prefix) or `*Service` (PascalCase suffix) | role | lowest priority, so a stronger rule with the same outliers wins |
| `before` | if the symbol calls `then`, it calls `first` earlier | members calling `then` | only pairs both called by ≥60% of the role; built-ins excluded |
| `avoids` | the unit never has the signal | role (client files only for `client_leak`) | see below |
| `has_test` | the file has a matching test or spec file | file role | lift against all files |
| `prefers_library` | the file imports no other library of the group | package-wide file role, files using the group | 14 groups: dates, HTTP client, validation, state, data fetching, icons, CSS-in-JS, utilities, ids, logging, database, class names, toasts, forms |
| `model_has` | the model has the field (case and `_` ignored) | model role | shown in the spelling most models use |
| `package_has` | the package has the script or tsconfig flag | package role | |
| `dependency_version` | every dependency on `name` uses `range` | packages depending on `name` | |

`validates` (schema validation in the body) and `typed_return` were already
facts; they now read as "validate their input with a schema" and "declare their
return type". `uses_any` is never a positive convention, only something avoided.

### Avoidance needs contrast

An absence is almost always true somewhere, so `avoids` has extra gates:

- the signal is used by at least 3 units of the same kind outside the role,
  at a rate of at least 10%, and at least 3 times the rate inside the role;
- signals are risky operations (`sink:*`), direct `process.env` reads,
  `console.*`, `throw new Error`, `any`, client leaks, and imports;
- import avoidance counts internal layers (first two path segments, e.g.
  `packages/ui`) and only *layer* packages (UI frameworks, database clients and
  drivers, server frameworks, `server-only`, `fs`, `child_process`,
  `@trpc/server`), needs a 0.9 lower bound, and avoidance rules are capped at a
  quarter of a repo's proposals.

Before the last two gates, `do not import` was 153 of 290 proposals across the
16 repos and crowded out positive conventions ("`src/**` does not import zod").
After them it is 35 of 183, almost all layering: "`packages/trpc/**` does not import
from `packages/ui/**`" (397/398), "`packages/ui/**` does not import `next`",
"`apps/web/lib/swr/**` does not import from `packages/prisma/**`".

### Near-duplicates compare outliers

The near-duplicate pass compared holder sets. Two strong rules in a role always
share most holders, so unrelated rules were merged (a missing `lint` script and
an odd `react` range in different packages counted as "the same"). It now
compares outlier sets.

## `drift security`

```sh
drift security [FILES...] [--json] [--max N]
```

One inventory, also served as the MCP tool `drift_security`:

- **Entry points** with their wrappers and decorators, whether they validate
  input, the env vars they read, and the risky operations they reach, with the
  call chain. Request-driven sinks (`eval`, shell, raw HTML, raw SQL, SQL
  interpolation, computed redirects and requests) are followed through up to
  four internal calls; weak hashes, cookie flags and CORS only count where
  written, because a checksum helper three calls away says nothing about the
  endpoint.
- **Risky operations** by kind, with locations.
- **Client leaks**, grouped by the server-only module reached, with the
  shortest import chain from one client file: the place to cut.
- **Environment variables** and how many files read each.

### Precision work found by running it

| Problem | Seen in | Fix |
| --- | --- | --- |
| `fetch(process.env.HOOK)` and `` fetch(`${API_URL}/x`) `` counted as dynamic requests | dub: 144 entry points through one logging helper | configured origins (`process.env.*`, `import.meta.env.*`, `env.*`, `config.*`, SCREAMING_CASE constants) are fixed |
| `@prisma/client` enums and `drizzle-orm` operators made shared schema files "server-only" | dub: 466 client files | server roots are `server-only`, `next/headers`, Node `fs`/`child_process`, database drivers, `stripe`, and `PrismaClient` specifically |
| `import Stripe from "stripe"` used only in types tainted constants files | dub: 354 client files through `lib/constants/payouts.ts` | TypeScript import elision: an import whose bindings are all referenced, and only in type positions, is `type_only` |
| one leak reported once per client file | dub | grouped by root module with an example chain |
| weak hashes in storage helpers reached 111 immich endpoints | immich | only request-driven sinks propagate through calls |

After these, dub has one client leak (`VERCEL` read in a client layout, where it
is undefined at runtime) and cal.com one (`VERCEL_URL` in the tRPC client).

## Bugs found by the evaluation

- **Scanner panic on `` `http://${host}` ``.** The fixed-origin check sliced the
  template after `https://` even when it was only `http://`, so a seven-byte
  string panicked. trpc and immich failed to scan. Fixed with prefix stripping
  and a regression case in the `signals` fixture.
- **Oracle false gaps with TypeScript 5.9.** With `typeRoots: ["./src/@types"]`,
  TypeScript resolves the bare `knex` to infisical's in-repo augmentation
  `src/@types/knex.d.ts`. Drift's `pkg:knex` is right for conventions; the oracle
  now classifies an in-repo `@types`/`types` declaration named after the package
  as agreement (`agree_package_with_repo_types`), which removed 1,089 false gaps.

`LOWERING_VERSION` is 12 (sink precision and import elision), so old caches are
ignored.

## Evaluation

Pinned 16-repo run (`node eval/run.mjs`, TypeScript 5.9.3 oracle): every repo
scans with no parse errors, **0 disagreements and 0 gaps** with the TypeScript
compiler, 100% export recall.

| Repo | Files | Scan | Imports agreeing | Disagree | Gaps | Export recall | Entry points | Conventions | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub | 3,921 | 0.76 s | 11,870 | 0 | 0 | 100.0% | 977 | 15 | ok |
| twenty | 36,125 | 4.82 s | 126,284 | 0 | 0 | 100.0% | 982 | 15 | ok |
| formbricks | 5,420 | 0.90 s | 16,443 | 0 | 0 | 100.0% | 535 | 15 | ok |
| cal.com | 5,010 | 0.88 s | 9,349 | 0 | 0 | 100.0% | 526 | 15 | ok |
| documenso | 2,363 | 0.42 s | 4,732 | 0 | 0 | 100.0% | 335 | 15 | ok |
| excalidraw | 707 | 0.14 s | 3,764 | 0 | 0 | 100.0% | 4 | 2 | ok |
| create-t3-app | 179 | 0.03 s | 119 | 0 | 0 | 100.0% | 49 | 1 | ok |
| ai | 7,824 | 1.08 s | 13,436 | 0 | 0 | 100.0% | 665 | 15 | ok |
| trpc | 1,032 | 0.16 s | 2,220 | 0 | 0 | 100.0% | 383 | 2 | ok |
| nest | 2,291 | 0.29 s | 5,577 | 0 | 0 | 100.0% | 682 | 13 | ok |
| supabase | 9,013 | 1.43 s | 26,791 | 0 | 0 | 100.0% | 626 | 15 | ok |
| node-express-boilerplate | 50 | 0.01 s | 108 | 0 | 0 | 100.0% | 15 | 0 | ok |
| novu | 8,660 | 1.37 s | 25,088 | 0 | 0 | 100.0% | 678 | 15 | ok |
| immich | 1,135 | 0.21 s | 4,642 | 0 | 0 | 100.0% | 316 | 15 | ok |
| midday | 2,027 | 0.27 s | 4,464 | 0 | 0 | 100.0% | 535 | 15 | ok |
| infisical | 9,012 | 1.47 s | 33,430 | 0 | 0 | 100.0% | 1,714 | 15 | ok |

### Conventions and security inventory per repo

`census` at the default cap of 15, before (previous commit) and after; the
security columns come from `drift security --json`.

| Repo | Conventions before | after | Entry points | reaching a risky op | Risky ops | Leaking client files |
| --- | --- | --- | --- | --- | --- | --- |
| dub | 10 | 15 | 911 | 142 | 94 | 1 |
| twenty | 15 | 15 | 908 | 375 | 208 | 0 |
| formbricks | 9 | 15 | 434 | 55 | 117 | 0 |
| cal.com | 15 | 15 | 519 | 32 | 163 | 1 |
| documenso | 9 | 15 | 335 | 29 | 45 | 0 |
| excalidraw | 0 | 2 | 4 | 0 | 23 | 0 |
| create-t3-app | 0 | 1 | 49 | 0 | 13 | 1 |
| ai | 9 | 15 | 658 | 9 | 65 | 0 |
| trpc | scan crashed | 2 | 150 | 0 | 11 | 1 |
| nest | 6 | 13 | 492 | 0 | 7 | 0 |
| supabase | 14 | 15 | 625 | 99 | 120 | 0 |
| node-express-boilerplate | 0 | 0 | 15 | 0 | 1 | 0 |
| novu | 15 | 15 | 678 | 155 | 151 | 0 |
| immich | scan crashed | 15 | 316 | 16 | 32 | 0 |
| midday | 10 | 15 | 535 | 42 | 78 | 0 |
| infisical | 15 | 15 | 1,704 | 6 | 90 | 0 |

(Entry points here exclude test files; the evaluation table counts all.)

Of the 183 proposals: 35 import avoidance (layering), 23 calls, 22 call
wrappers, 22 decorators, 17 naming (`*Repository`, `*Processor`, `use*`), 16
argument keys, 17 render/JSX layout, 9 base classes, 9 other avoidance (`any`,
risky operations, bare `Error`), 5 validation/return types, 4 package
config/versions (`emitDecoratorMetadata`, `@nestjs/common@12.3.3`,
`zod@^4.2.1`), 1 test coverage.

No `before`, `prefers_library` or `model_has` rule reached the top 15 in these
repos at the default thresholds; each is covered by planted tests
(`crates/drift-mine/tests/rules.rs`) and appears when a repo has the pattern.

## Known gaps

- Class symbols aggregate their methods, so call chains through a service class
  are coarse (`via UsersService` rather than `UsersService.find`).
- Client leaks follow whole modules, not the imported names; a barrel that
  re-exports one server module taints every client importing the barrel.
- Ordering uses first-call order within a body, capped at 32 callees.
