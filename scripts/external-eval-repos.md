# External evaluation repos

The external suite (`scripts/external-eval.mjs`) runs the full Drift loop against real
open-source Next.js codebases. These six were chosen because each broke Drift in a
different way during the falsification test, so together they cover distinct layouts,
package managers, and data layers.

Clone them into `$DRIFT_EVAL_REPOS` (default `~/drift-falsification/repos`):

```bash
mkdir -p ~/drift-falsification/repos && cd ~/drift-falsification/repos
git clone --depth 1 https://github.com/shadcn-ui/taxonomy.git      taxonomy
git clone --depth 1 https://github.com/dubinc/dub.git              dub
git clone --depth 1 https://github.com/formbricks/formbricks.git   formbricks
git clone --depth 1 https://github.com/calcom/cal.com.git          calcom
git clone --depth 1 https://github.com/mfts/papermark.git          papermark
git clone --depth 1 https://github.com/openstatusHQ/openstatus.git openstatus
```

`node_modules` are not needed — Drift scans source only.

## Pinned SHAs for the recorded baseline

| Repo | SHA |
|---|---|
| taxonomy | `298a8857c7128a0d121e7f699dfd729f23b3966d` |
| dub | `482b8e2f6720dd9c23332b56d3db087b8c5d88de` |
| formbricks | `b5a12fb3e3168202591e46e7cf9a4ad985fe2581` |
| calcom | `3894f37e14eae5082770f35ff1fde72110c0e6b6` |
| papermark | `9d7db9e95f8208cad88844eb0399e2a09e6719f1` |
| openstatus | `b25db6f256c689fb2cc37ee7abf51a1b4ab54fe4` |

Counts (`files`, `facts`, `candidates`, `baselined`) are recorded but excluded from
regression comparison, so re-cloning at a newer SHA does not produce false failures.
Behavioural fields — onboarding, learned `forbidden_imports`, injection detection,
evidence correctness, clean-control result, engine source — are compared strictly.

## Why each repo is in the suite

| Repo | Layout | Data layer | Originally exposed |
|---|---|---|---|
| taxonomy | `app/` at repo root (default `create-next-app`) | `@/lib/db` | **F3** — root-relative globs never matched, so enforcement was silently dead while reporting `can_block: true` |
| dub | monorepo `apps/web/app/api` | `@/lib/prisma`, `@prisma/client` | **F5** — type-only imports flagged as data access (8.5%); largest finding set (458) |
| formbricks | monorepo, helpers inside `app/api` | `@formbricks/database` | Precision case: exactly 1 of 83 routes truly violates, and Drift found that one |
| calcom | monorepo, mixed `app/api` + `pages/api` | `@calcom/prisma` | **F1** — `export const config` + default handler crashed onboarding |
| papermark | `app/` *and* `pages/api` at repo root | `@/lib/prisma` | **F1** at scale (43/334 duplicate entrypoints) plus **F3** |
| openstatus | monorepo `apps/*/src/app/api` | `@openstatus/db` (**Drizzle**) | **F2** — inline `type` modifier aborted onboarding; only non-Prisma data layer |

## Known gap

All six data layers contain `prisma`, `db`, or `database`, so every one of them matches
the substring whitelist in `is_data_access_source`
(`crates/drift-engine/src/candidate_command.rs`). **This suite therefore cannot detect
regressions in finding F4.** A seventh repo whose data layer is named something else —
Supabase, or a local wrapper called `store`/`repository`/`models` — is needed before the
suite can be treated as covering inference. Until then, F4 coverage rests on the fixture
evals only.
