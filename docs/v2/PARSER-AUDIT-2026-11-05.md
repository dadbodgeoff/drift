# Parser audit against the TypeScript compiler, 2026-11-05

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

**Drift's TypeScript/JavaScript parser now agrees with the TypeScript compiler on
every in-repo import it could compare (about 47,500), and finds 100% of the
compiler's value exports in sampled files on four of five repos.** Six gaps
found by this audit were fixed, each with a regression test.

## Method

A differential oracle (`eval/oracle/oracle.mjs`) compares Drift with
TypeScript 5.9.3:

- **Imports:** every specifier Drift saw (`drift debug imports`) is resolved again
  with `ts.resolveModuleName`, using that file's own `tsconfig.json`.
- **Exports:** 400 files per repo, sampled deterministically, are type-checked
  and their value exports (types excluded) are compared with Drift's facts.

Repos are fresh shallow clones with no `node_modules`, which is how Drift runs
in CI and agent sandboxes.

| Repo | Why chosen |
| --- | --- |
| vercel/ai | Many-package monorepo, `exports` maps, ESM `.js` extensions |
| trpc/trpc | Builder chains, workspace self-references |
| nestjs/nest | Decorators, barrels, CommonJS interop |
| supabase/supabase | Very large Next.js monorepo |
| hagopj13/node-express-boilerplate | Plain CommonJS Express app |

## Results after fixes

| Repo | Files | Scan | In-repo imports agreeing with TypeScript | Disagreements | Value exports found |
| --- | --- | --- | --- | --- | --- |
| vercel/ai | 7,824 | 0.7 s | 13,251 | 0 | 257/257 |
| trpc/trpc | 1,032 | 0.1 s | 2,202 | 0 | 432/433 |
| nestjs/nest | 2,291 | 0.3 s | 5,561 | 0 | 354/354 |
| supabase/supabase | 9,013 | 0.8 s | 26,383 | 0 | 636/636 |
| node-express-boilerplate | 50 | 0.01 s | 108 | 0 | (see below) |

A further 17,390 imports resolve only in Drift. These are workspace packages that
the compiler cannot find without `node_modules`. Spot checks show Drift resolves
them to the right package source (`ai` → `packages/ai/index.ts`).

"Extra" exports reported by the oracle are expanded `export *` names and
CommonJS exports in `.js` files. The compiler, run with `noResolve` and without
`checkJs`, cannot see either, so these are oracle limitations, not Drift errors.

## Gaps found and fixed

| # | Gap | Evidence before | After |
| --- | --- | --- | --- |
| 1 | CommonJS invisible: `require`, `module.exports`, `exports.x` | Express app: 0 imports, 0 exports | 176 imports, all 108 in-repo agree with TypeScript; exports and member calls resolve to defining files |
| 2 | No Express adapter | 0 entry points | 15 routes as symbols; middleware (`auth`, `validate`) recorded as wrappers, including router-level `router.use()` |
| 3 | Generated-file markers matched anywhere in the first 1 KB | 22 supabase files skipped, at least 11 hand-written. A comment could hide a file from the gate | Only the leading header comment counts; `.gen.`/`.generated.` file names still skip. 11 files recovered |
| 4 | Destructured exports missed (`export const { GET, POST } = handlers`) | 8 trpc exports missing; NextAuth routes had no entry points | One symbol per bound name, entry points detected |
| 5 | `export *` names not expanded | Barrel exports missing in trpc and nest | Names expanded to their origin (never `default`) |
| 6 | Declaration-only modules unresolved (`@/data/api` → `api.d.ts`) | 77 supabase imports | 0 |

Related correctness fixes: a chain that ends at a module without the name now
points at the deepest module reached, and `require(x).member` against
`module.exports = { … }` resolves like a namespace import.

## Known gaps, not yet fixed

| Gap | Impact | Next step |
| --- | --- | --- |
| TypeScript `namespace` exports | 1 of 433 trpc exports | Lower `export namespace X` as a symbol |
| NestJS adapter (controller methods as HTTP entry points) | Nest apps get class-level conventions but no per-route facts | Adapter for `@Controller` + `@Get`/`@Post` methods |
| Express path prefixes from `app.use('/v1', router)` across files | Route paths are file-local (`/`, `/:userId`) | Join mount paths through the import graph |
| Fastify and Hono adapters | Routes not recognised | Same pattern as the Express adapter |
| Workspace subpath imports resolve to package ids when not installed | Rare (`@dub/ui/icons`) | Use the package's `exports` map without `node_modules` |
| Dynamic `import()` | Not recorded as imports | Record literal specifiers |
| Oracle cannot judge CommonJS exports | CommonJS checked by fixtures only | Run the oracle with `checkJs` for `.js` samples |
