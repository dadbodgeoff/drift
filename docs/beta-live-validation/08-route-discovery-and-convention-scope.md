# CHARTER 08 — Route discovery and convention scope

**Depends on:** 06 · **Est. 3 h** · **Output:** `results/08-route-discovery-and-convention-scope.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 08 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 08 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 08` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Establish which files Drift believes are routes, which files a convention's `path_globs` believe
are in scope, and every case where those two disagree. A route that is not recognized is a route
no security convention can ever protect — and the user is not necessarily told.

## 2. Mechanism under test

- Route recognition is **Next.js-only by construction**, at a single glob-matching function whose
  own code comment names Express as deliberately excluded. There is no independent framework
  classifier anywhere in the engine (§22 obs. 5). `crates/drift-engine/src/next_routes.rs`,
  `packages/core/src/next-routes.ts:15-23` (`API_ROUTE_SCOPE_GLOBS`).
- Route "flavor" / group classification: `packages/core/src/convention-scope.ts:90-107`
  (`routeFlavor()`), `crates/drift-engine/src/vocabulary.rs` (`RouteFlavor`).
- **The glob algorithm has been rewritten at least once since the audited commit**, fixing a more
  severe defect the audit never identified: a root-level route matching nothing at all under the
  default `create-next-app` layout (§22 obs. 21). Current behavior must be measured, not assumed.
- `test/canary/glob-parity.json` exists; its case list was never opened (§21). Open it first.

## 3. Procedure

### Route recognition

| Probe | Shape |
|---|---|
| P-08-01 | `app/api/x/route.ts` — baseline App Router API route |
| P-08-02 | `app/api/x/route.tsx`, `.js`, `.mjs` — extension variants |
| P-08-03 | `pages/api/x.ts` — Pages Router |
| P-08-04 | `src/app/api/x/route.ts` — the `src/` layout |
| P-08-05 | Root-level route: `app/route.ts` — **the shape §22 obs. 21 says used to match nothing** |
| P-08-06 | Route group: `app/(marketing)/api/x/route.ts` |
| P-08-07 | **Route group ahead of `/api/`**: `app/(admin)/api/x/route.ts` — the specific adjacency gap the session-trust ledger cell names (§13, §21) |
| P-08-08 | Nested route groups: `app/(a)/(b)/api/x/route.ts` |
| P-08-09 | Dynamic segments: `[id]`, `[...slug]`, `[[...slug]]` (`test/fixtures/dynamic-route-params`) |
| P-08-10 | Parallel and intercepting routes: `@modal`, `(.)`, `(..)`  |
| P-08-11 | `middleware.ts` at root and at `src/` |
| P-08-12 | `route.ts` in a non-`api` path: `app/x/route.ts` |
| P-08-13 | An Express router file and a Fastify plugin file — confirm neither gets `FileRole::ApiRoute` or `RouteDeclared`, and record **what the user is told**, if anything |
| P-08-14 | A monorepo where the Next.js app is at `apps/web/app/api/...` and `--repo-root` is the monorepo root |

For each: does `drift repo map` show it as a route? Does a route-scoped convention's
`inputs_considered` include it?

### Convention scope

| Probe | What to do |
|---|---|
| P-08-15 | Accept a route-scoped convention. Dump its `path_globs`. For every file in P-08-01..14, determine membership. Build the **file × recognized-as-route × in-glob-scope** matrix. Every cell where the two disagree is a finding. |
| P-08-16 | Author a custom `path_globs` with `**`, `*`, `?`, a character class, a leading `./`, a trailing `/`, and a Windows-style separator. Record which are supported. |
| P-08-17 | A convention whose globs match **zero** files. Does the receipt report `reached: true, inputs_considered: 0`, and is the user told **by name**? (§14: `checks.ts:180` only counts these, never names them.) |
| P-08-18 | Open `test/canary/glob-parity.json`, enumerate its cases, and determine whether P-08-07's shape is among them. |
| P-08-19 | Run `pnpm check:cell-ledger` and reconcile the glob-parity canary's claims against P-08-15's observed matrix. |

## 4. Benchmarks

| Metric | How |
|---|---|
| Routes recognized per corpus repo | Run against all 7 `$DRIFT_EVAL_REPOS` repos; compare to a ground-truth count obtained by `find` for Next.js route conventions |
| Route recognition recall | recognized / ground truth, per repo |
| Glob matching cost | Time `drift check` with 1, 10, 100 accepted conventions against a 5,000-file repo |

Recognition recall per corpus repo is this charter's headline number.

## 5. Oracles

- Every file matching a documented Next.js route convention is recognized.
- Recognized-as-route and in-glob-scope agree, or the disagreement is stated to the user.
- A convention that ran on zero inputs is **named**, not merely counted.
- A repo with zero recognized routes is told so explicitly, with the reason.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-08-1 | A route group **before** `/api/` escapes convention scope. **ALREADY REFUTED at `a0517f3e`** — the globs widened from `**/app/api/**/route.ts` to `**/app/**/route.ts`, and all 1,027 corpus routes are now in scope (FINDINGS-PRE-RUN F-1/F-2). It WAS real: under the previous globs dub scored 145/497. Re-confirm, then spend the time on S-08-7 instead. | §13, §21, F-1/F-2 | P-08-07, P-08-15 |
| S-08-2 | The glob algorithm was rewritten since the audit, fixing a root-level-route defect the audit never found — meaning at least one class of the audit's observations would read differently today. | §22 obs. 21 | P-08-05 |
| S-08-3 | Route recognition is Next.js-only at a single function that deliberately excludes Express, with no framework classifier. | §22 obs. 5 | P-08-13 |
| S-08-4 | `frameworks/mod.rs` exists but was never read; whether it contains dormant partial non-Next support is undetermined. | §21 | Read it, then test whatever it claims to support. |
| S-08-5 | `glob-parity.json`'s case list may not contain the route-group-ahead-of-`/api/` shape. | §21, §20h | P-08-18 |
| S-08-7 | The widened globs pull **non-API** app routes into scope: `app/dashboard/route.ts` matches `**/app/**/route.ts`, so a convention named `api_route_requires_auth_helper` now scopes over it. Whether that is intended is undetermined. | F-1, measured | Build the shape; accept an api-named convention; check `inputs_considered` |
| S-08-6 | A `reached: true, inputs_considered: 0` convention is never named in text output — only counted in aggregate. | §14, `checks.ts:174-192` | P-08-17 |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md).

## 8. Deliverables

`results/08-route-discovery-and-convention-scope.md` with the file × route × scope matrix and
per-corpus recognition recall; fixtures under `results/artifacts/08/fixtures/`.
