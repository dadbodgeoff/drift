# Phase 2 Middleware Security Correction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the Phase 2 middleware security-boundary PR so deterministic middleware coverage is enforced in real `drift check`, repo-map/MCP/query read paths do not overstate proof, parser gaps remain blocking, and all review findings are covered by tests.

**Architecture:** Rust remains the deterministic authority for middleware parsing, matcher normalization, route coverage, proof construction, parser gaps, missing proof, and blocking rule evaluation. TypeScript only dispatches accepted contracts to the Rust engine, validates engine contracts, stores/query-formats persisted proof, and exposes read models without reinterpreting deterministic proof from raw facts.

**Tech Stack:** Rust `drift-engine`, TypeScript packages `@drift/cli`, `@drift/core`, `@drift/engine-contract`, `@drift/query`, `@drift/mcp`, Vitest, Cargo tests, e2e tests.

---

## Current Review Findings Covered

This plan accounts for every review item:

- P1: real `drift check` skips `middleware_must_cover_routes`.
- P1: `api_route_requires_auth_helper` check-run ignores deterministic middleware proof.
- P1: scan/repo-map emits `middleware_protects_route` from unaccepted helper context.
- P1: dynamic `config.matcher` expressions with string literals can become static proof.
- P1: middleware auth helper existence is treated as proof without dominance.
- P1: reused route facts can retain stale derived middleware coverage.
- P1: reused middleware files can drop parser-gap diagnostics.
- P2: route scoping normalizer is narrower than route detection.
- P2: middleware contract `methods` are stored but not evaluated.
- P2: query and MCP derive `proven: true` from raw `middleware_protects_route` facts.
- P2: MCP security context lacks scan freshness/readiness metadata.
- P2: CLI flag readers reject `middleware_must_cover_routes`.
- P2: engine-contract test blesses impossible proven-plus-parser-gap middleware state.
- P2: e2e middleware tests lack exclusion fixture and collapse mismatch reasons.
- P3: CLI scan-status middleware capability test does not assert `required` and `complete`.
- P3: PR lacks visible RED/GREEN evidence despite the TDD requirement.

## Scope Guardrails

- Do not implement Phase 3+ request validation, SSRF, SQL, tenant scope, sensitive data, CORS, CSRF, or rate-limit work.
- Do not add deterministic middleware coverage logic to TypeScript.
- Candidate-only and heuristic evidence must never block.
- Middleware existence alone must never satisfy auth.
- Dynamic or unsupported middleware matchers must create parser-gap-backed proof/finding evidence and must not silently pass.
- Blocking middleware/security findings require accepted contracts or accepted agent contracts.
- Outputs/storage/MCP/CLI must not include source snippets, secret values, request payloads, cookie/header values, raw SQL values, env values, or tokens.
- Preserve waiver, baseline, lifecycle, diff-scope, check-run, audit, policy egress, direct-data-access, service-delegation, and Phase 1 auth behavior.
- Do not include the local Phase 3 TDD expansion or unrelated dirty code changes in the Phase 2 correction PR.

## Required Branch Hygiene Before Implementation

Current observed state when this plan was written:

```text
## codex/security-middleware-phase2...origin/codex/security-middleware-phase2
 M crates/drift-engine/src/facts.rs
 M crates/drift-engine/src/lib.rs
 M crates/drift-engine/src/main.rs
 M crates/drift-engine/src/security_control_flow.rs
 M crates/drift-engine/src/security_facts.rs
 M crates/drift-engine/src/security_patterns.rs
 M crates/drift-engine/tests/security_facts.rs
 M docs/architecture/security-boundary-enforcement-100-tdd.md
?? docs/superpowers/plans/2026-05-25-security-boundary-p1-corrective-plan.md
```

The implementation agent must not mix those dirty files into the correction unless each change is verified as part of this review-fix scope.

Use a clean worktree from the remote Phase 2 PR branch:

```bash
cd "/Users/geoffreyfernald/Downloads/driftv3"
git worktree add "drift v3 phase2 corrections" origin/codex/security-middleware-phase2 -b codex/security-middleware-phase2-corrections
cd "drift v3 phase2 corrections"
git status --short --branch
```

Expected: clean branch `codex/security-middleware-phase2-corrections` based on `origin/codex/security-middleware-phase2`.

If the correction must land on the existing PR branch instead of a follow-up branch, finish and verify in the clean worktree, then fast-forward or cherry-pick the correction commit onto `codex/security-middleware-phase2`. Do not carry unrelated local dirty files.

## File Responsibility Map

- `crates/drift-engine/src/security_facts.rs`: extraction only. It may record accepted helper call facts and middleware-return/control-flow facts, but it must not mark auth as proven from existence alone.
- `crates/drift-engine/src/security_patterns.rs`: accepted helper/sink/policy/middleware matcher normalization only. It must parse matcher literals deterministically and gap all non-literal matcher expressions.
- `crates/drift-engine/src/security_control_flow.rs`: route and middleware coverage summaries, matcher/path/method coverage, and dominance summaries only.
- `crates/drift-engine/src/security_proof.rs`: proof, parser-gap, missing-proof construction only.
- `crates/drift-engine/src/security_rules.rs`: deterministic accepted-contract rule evaluation only.
- `crates/drift-engine/src/check_command.rs`: Rust check-run bridge for accepted security conventions and engine check output.
- `crates/drift-engine/src/main.rs`: scan orchestration and fact serialization only; no unaccepted proof promotion and no stale derived-fact reuse.
- `packages/cli/src/check/run-check.ts`: CLI orchestration, lifecycle/diff/baseline/waiver mapping, and Rust engine dispatch only.
- `packages/cli/src/check/security-check.ts`: CLI output mapping only, no deterministic rule logic.
- `packages/cli/src/args/flag-readers.ts`: CLI argument validation only.
- `packages/query/src/security-boundary-proof.ts`: query/read model over persisted `SecurityBoundaryProof`.
- `packages/query/src/index.ts`: exports and compatibility wrappers only; no proof derivation from raw middleware facts.
- `packages/mcp/src/security-context.ts`: MCP read model over persisted proof plus freshness/readiness metadata.
- `packages/engine-contract/src/index.ts`: schema validation for engine output states.
- Tests stay near the behavior they protect.

---

## Task 1: Wire `middleware_must_cover_routes` Through Real `drift check`

**Findings covered:** P1 skip in `run-check.ts`, P2 flag-reader rejection.

**Files:**
- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/cli/src/args/flag-readers.ts`
- Test: `packages/cli/test/security-check.test.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing CLI dispatch test**

Add a `security-check.test.ts` case that creates a repo with:

- `app/api/projects/route.ts`
- `middleware.ts`
- an accepted `middleware_must_cover_routes` convention
- changed-file or changed-hunk diff scope covering the route

Assert:

- `runCheck(... --json)` invokes Rust-owned security check behavior for `middleware_must_cover_routes`.
- output includes `security_boundary_proofs[0].middleware.required === true`.
- a missing or uncovered route produces a blocking finding with `rule_id === "middleware_must_cover_routes"`.
- JSON output contains no middleware or route source snippet.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED: fail because `runEngineOwnedAuthCheck` filters out every convention whose kind is not `api_route_requires_auth_helper`, so `middleware_must_cover_routes` produces no engine findings and no security boundary proofs in real `drift check`.

- [ ] **Step 3: Write the failing flag-reader test**

Add or extend a `cli.test.ts`/flag-reader coverage case so `--kind middleware_must_cover_routes` is accepted anywhere convention kind filters are accepted.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @drift/cli test -- cli
```

Expected RED: fail because `optionalConventionKindFlag` rejects `middleware_must_cover_routes` and the error text omits it.

- [ ] **Step 5: Implement minimal GREEN**

In `run-check.ts`:

- Rename `runEngineOwnedAuthCheck` to a security-check dispatcher name such as `runEngineOwnedSecurityCheck`.
- Dispatch accepted deterministic conventions for both `api_route_requires_auth_helper` and `middleware_must_cover_routes`.
- Preserve lifecycle filtering, `enforcement_mode !== "off"`, `enforcement_capability === "deterministic_check"`, diff scope, baseline, waivers, and existing finding status handling.
- For `middleware_must_cover_routes`, include route files and middleware files required for deterministic proof. Do not filter the Rust request down to only route-local facts when middleware proof is needed.
- Do not implement matcher or coverage decisions in TypeScript.

In `flag-readers.ts`:

- Add `middleware_must_cover_routes` to the accepted convention kind set.
- Update the error text to include it.

- [ ] **Step 6: Run GREEN**

```bash
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/cli test -- cli
```

Expected GREEN: new tests pass, existing auth check tests still pass, and blocked findings keep existing lifecycle/diff/baseline/waiver semantics.

---

## Task 2: Allow Auth Helper Contract to Accept Proven Middleware Coverage in Check-Run

**Findings covered:** P1 `check_command.rs` builds only route-local auth proofs for `api_route_requires_auth_helper`.

**Files:**
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify only if needed: `crates/drift-engine/src/security_rules.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Test: `packages/cli/test/security-check.test.ts`

- [ ] **Step 1: Write the failing Rust check-command test**

Add a `security_check_repo_auth.rs` integration case with:

- route file lacking route-local auth helper
- accepted `api_route_requires_auth_helper` convention
- accepted middleware helper contract data
- deterministic middleware proof covering the route and method

Assert:

- no blocking auth finding is returned for the covered route
- `security_boundary_proofs[0].auth.proven === true`
- `security_boundary_proofs[0].auth.proof_kind === "middleware"`
- middleware proof references accepted middleware evidence only
- no candidate or heuristic evidence satisfies the contract

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_check_repo_auth -- --nocapture
```

Expected RED: fail because check-run evaluates `api_route_requires_auth_helper` from route-local facts only, so middleware coverage does not satisfy auth in the actual Rust check command.

- [ ] **Step 3: Write the failing CLI bridge test**

Add a `security-check.test.ts` case proving the same behavior through `runCheck(... --json)`: a route-local missing helper is allowed only when accepted deterministic middleware coverage is present.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED: fail because the CLI receives route-local missing auth output from Rust and cannot satisfy auth from middleware proof.

- [ ] **Step 5: Implement minimal GREEN**

In `check_command.rs`:

- Build middleware-aware auth proof using existing Rust proof/rule helpers.
- Accept middleware proof for `api_route_requires_auth_helper` only when coverage is deterministic, accepted, parser-gap-free, method/path-matched, and `protection_kind === "auth"`.
- Keep missing proof and parser-gap proof blocking.
- Preserve route-local auth helper behavior for existing tests.

- [ ] **Step 6: Run GREEN**

```bash
cargo test -p drift-engine security_check_repo_auth -- --nocapture
pnpm --filter @drift/cli test -- security-check
```

Expected GREEN: route-local auth still works, missing auth still blocks, and accepted deterministic middleware proof satisfies the auth contract through real check-run.

---

## Task 3: Stop Emitting Proven Route Coverage From Unaccepted Middleware Context

**Findings covered:** P1 `main.rs` extracts scan security facts with `[]` accepted helpers and emits `middleware_protects_route` anyway.

**Files:**
- Modify: `crates/drift-engine/src/main.rs`
- Modify if needed: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`
- Test: `test/e2e/security-middleware.test.ts`

- [ ] **Step 1: Write the failing Rust scan fact test**

Add a test where `middleware.ts` contains a helper-like call that is not in accepted helper contracts. Assert scan facts do not include a deterministic `middleware_protects_route` proof for `protection_kind: "auth"`.

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_facts -- --nocapture
```

Expected RED: fail because scan orchestration currently emits `middleware_protects_route` even though the scan extraction used no accepted helper set.

- [ ] **Step 3: Write the failing e2e test**

Add an e2e fixture where middleware exists and matcher covers the route, but the helper is unaccepted. Assert repo-map/MCP-visible facts do not claim proven auth coverage.

- [ ] **Step 4: Run RED**

```bash
pnpm test:e2e -- security-middleware
```

Expected RED: fail because raw facts expose `middleware_protects_route` as if unaccepted middleware protection were proven.

- [ ] **Step 5: Implement minimal GREEN**

In `main.rs`:

- Emit deterministic `middleware_protects_route` facts only when proof was built from accepted helper or accepted agent-contract evidence.
- If static matcher coverage is useful without accepted protection, emit a nonblocking/static coverage representation that cannot be interpreted as auth proof, or omit the fact entirely.
- Do not let repo-map/MCP infer `proven: true` from middleware existence.

- [ ] **Step 6: Run GREEN**

```bash
cargo test -p drift-engine security_facts -- --nocapture
pnpm test:e2e -- security-middleware
```

Expected GREEN: accepted middleware proof still emits deterministic coverage, unaccepted middleware no longer appears as proven protection.

---

## Task 4: Gap All Dynamic Middleware Matcher Expressions

**Findings covered:** P1 dynamic `config.matcher` expressions with string literals can silently become static proof.

**Files:**
- Modify: `crates/drift-engine/src/security_patterns.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`
- Test: `test/e2e/security-middleware.test.ts`

- [ ] **Step 1: Write the failing matcher tests**

Add Rust tests for these matcher forms:

```ts
export const config = { matcher: process.env.MATCHER ?? "/api/:path*" };
export const config = { matcher: isProd ? ["/api/:path*"] : ["/health"] };
const matcher = "/api/:path*";
export const config = { matcher };
```

Assert:

- each creates a parser gap for unsupported/dynamic matcher expression
- none creates static `middleware_matcher_declared` coverage
- none creates `middleware_protects_route`

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_facts -- --nocapture
```

Expected RED: fail because quoted path extraction currently pulls literal strings out of non-literal matcher expressions and treats them as static matcher proof.

- [ ] **Step 3: Implement minimal GREEN**

In `security_patterns.rs`:

- Parse only direct string literals and arrays of direct string literals from `config.matcher`.
- Treat identifiers, member expressions, conditional expressions, logical expressions, call expressions, spreads, template expressions with interpolation, and imported values as parser gaps.
- Preserve support for direct literal matchers:

```ts
export const config = { matcher: "/api/:path*" };
export const config = { matcher: ["/api/:path*", "/admin/:path*"] };
```

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine security_facts -- --nocapture
pnpm test:e2e -- security-middleware
```

Expected GREEN: literal matchers still work, dynamic matcher expressions produce parser-gap evidence and do not silently prove coverage.

---

## Task 5: Require Middleware-Local Dominance Before `protection_kind = "auth"`

**Findings covered:** P1 helper existence anywhere in `middleware.ts` proves auth even after `NextResponse.next()`, in a branch, or in a callback.

**Files:**
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Test: `crates/drift-engine/tests/security_control_flow.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: Write failing dominance tests**

Add cases proving these do not satisfy middleware auth:

```ts
export function middleware(req) {
  const response = NextResponse.next();
  requireUser(req);
  return response;
}
```

```ts
export function middleware(req) {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    requireUser(req);
  }
  return NextResponse.next();
}
```

```ts
export function middleware(req) {
  const fn = () => requireUser(req);
  return NextResponse.next();
}
```

Also add a positive case where the accepted guard dominates the return path for covered routes.

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_control_flow security_facts security_rules -- --nocapture
```

Expected RED: fail because middleware facts currently mark auth from any accepted helper call in the file, and proof construction treats that as proven.

- [ ] **Step 3: Implement minimal GREEN**

In Rust:

- Extract helper calls as facts without marking middleware protection proven.
- Add or extend middleware control-flow summary so accepted guard dominance is required before auth protection is proven.
- Produce missing-proof or parser-gap evidence when dominance cannot be established.
- Keep this logic in Rust only.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine security_control_flow security_facts security_rules -- --nocapture
```

Expected GREEN: helper after response, branch-only helper, and callback-only helper do not prove middleware auth; dominating accepted guard does.

---

## Task 6: Remove Stale Derived Middleware Facts From Reuse

**Findings covered:** P1 stale `middleware_protects_route` can survive when only middleware changes.

**Files:**
- Modify: `crates/drift-engine/src/main.rs`
- Modify if needed: `packages/cli/src/domain/scan-status.ts`
- Test: `test/e2e/security-middleware.test.ts`
- Test if Rust helper exists: `crates/drift-engine/tests/security_facts.rs`

- [ ] **Step 1: Write the failing reuse test**

Add an e2e test with two scans:

1. scan route plus middleware that proves coverage
2. change only `middleware.ts` so coverage no longer proves auth

Assert second scan does not retain old `middleware_protects_route` for the route.

- [ ] **Step 2: Run RED**

```bash
pnpm test:e2e -- security-middleware
```

Expected RED: fail because reused route facts can include stale derived cross-file middleware coverage before recomputed middleware coverage is appended.

- [ ] **Step 3: Implement minimal GREEN**

In scan reuse code:

- Strip derived cross-file facts from reused facts before appending current middleware coverage.
- At minimum strip `middleware_protects_route` from reused facts.
- Prefer making derived fact kinds non-reusable in the reuse manifest so future derived facts cannot stale across scans.

- [ ] **Step 4: Run GREEN**

```bash
pnpm test:e2e -- security-middleware
cargo test -p drift-engine security_facts -- --nocapture
```

Expected GREEN: second scan reflects current middleware coverage only.

---

## Task 7: Preserve Parser Gaps Across Reused Middleware Files

**Findings covered:** P1 reused dynamic middleware loses blocking parser gaps because reuse persists only facts.

**Files:**
- Modify: `crates/drift-engine/src/main.rs`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Test: `test/e2e/security-middleware.test.ts`
- Test if reusable unit exists: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing parser-gap reuse test**

Add an e2e test with:

1. scan `middleware.ts` containing a dynamic matcher
2. run a second scan where the middleware file is reused

Assert the second scan still exposes a blocking parser-gap-backed proof/finding for the accepted middleware contract.

- [ ] **Step 2: Run RED**

```bash
pnpm test:e2e -- security-middleware
```

Expected RED: fail because reused middleware skips dynamic matcher diagnostics and the reuse manifest persists facts only.

- [ ] **Step 3: Implement minimal GREEN**

Choose one production path:

- persist and replay diagnostics/parser gaps in reuse manifests, or
- disable reuse for middleware files when parser gaps affect deterministic security contracts.

The lower-risk Phase 2 fix is to disable reuse for middleware files with parser gaps and document the reason in code near reuse filtering. Do not drop parser gaps silently.

- [ ] **Step 4: Run GREEN**

```bash
pnpm test:e2e -- security-middleware
pnpm --filter @drift/cli test -- cli
```

Expected GREEN: parser gaps survive scan reuse and continue to block accepted deterministic middleware contracts.

---

## Task 8: Share API Route Normalization With Middleware Rule Scoping

**Findings covered:** P2 route scoping misses `.tsx`, `.js`, `.jsx`, and some pages routes.

**Files:**
- Modify: `crates/drift-engine/src/facts.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify if cleaner: `crates/drift-engine/src/security_control_flow.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`
- Test: `crates/drift-engine/tests/security_facts.rs`

- [ ] **Step 1: Write the failing normalizer tests**

Add cases proving middleware contract route scoping matches API route detection for:

- `app/api/projects/route.ts`
- `app/api/projects/route.tsx`
- `app/api/projects/route.js`
- `app/api/projects/route.jsx`
- `pages/api/projects.ts`
- `pages/api/projects.js`

Assert required route path and method are known, not skipped or marked unknown.

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_rules security_facts -- --nocapture
```

Expected RED: fail because `security_rules.rs` uses a narrower route normalizer than API route detection.

- [ ] **Step 3: Implement minimal GREEN**

Move route-path normalization into a shared Rust helper or expose the existing route detector so middleware rules and fact extraction use the same source of truth.

Do not fork route normalization logic.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine security_rules security_facts -- --nocapture
```

Expected GREEN: app and pages API route variants receive consistent route path/method scope evaluation.

---

## Task 9: Enforce Middleware Contract Method Scope

**Findings covered:** P2 `SecurityMiddlewareContract.methods` is stored but ignored.

**Files:**
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify if needed: `crates/drift-engine/src/security_control_flow.rs`
- Test: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 1: Write the failing method-scope tests**

Add cases:

- contract methods `["POST"]`, route method `GET`, matcher path covers route: should not satisfy GET auth requirement.
- contract methods `["GET"]`, route method `GET`, matcher path covers route: can satisfy when proof is otherwise valid.
- contract methods omitted: applies to all route methods.

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine security_rules -- --nocapture
```

Expected RED: fail because middleware method scope is ignored and method-scoped contracts can apply to the wrong route method.

- [ ] **Step 3: Implement minimal GREEN**

In rule evaluation:

- Filter middleware coverage by required route method before proof is accepted.
- Emit a method-mismatch proof/finding reason when a contract exists but does not cover the route method.
- Keep method-omitted behavior as all-methods coverage.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine security_rules -- --nocapture
```

Expected GREEN: method-scoped contracts apply only to matching route methods.

---

## Task 10: Stop Query and MCP From Interpreting Raw Middleware Facts as Proven Proof

**Findings covered:** P2 query and MCP set `proven: true` from raw `middleware_protects_route` facts.

**Files:**
- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/query/src/index.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write the failing query tests**

Add query tests proving:

- persisted `SecurityBoundaryProof.middleware.proven === true` returns proven coverage
- raw `middleware_protects_route` fact without persisted proof does not return proven coverage
- parser-gap proof remains unproven and exposes safe gap metadata

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/query test -- security-boundary-proof
```

Expected RED: fail because query code derives proven middleware coverage directly from raw facts.

- [ ] **Step 3: Write the failing MCP tests**

Add MCP tests proving security context uses persisted proof/read model and does not promote raw `middleware_protects_route` facts to `proven: true`.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected RED: fail because MCP security context reads latest raw middleware facts and marks them proven.

- [ ] **Step 5: Implement minimal GREEN**

In query:

- Make `buildSecurityBoundaryProofReadModel` the only path that turns persisted proof into route summaries.
- Remove or downgrade compatibility wrappers that infer proof from raw facts.

In MCP:

- Read persisted `SecurityBoundaryProof`/query read model where available.
- If only raw facts exist, expose them as static evidence or omit proven coverage; do not set `proven: true`.

- [ ] **Step 6: Run GREEN**

```bash
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/mcp test -- mcp
```

Expected GREEN: TypeScript no longer duplicates deterministic proof interpretation.

---

## Task 11: Add Freshness and Readiness Metadata to MCP Security Context

**Findings covered:** P2 MCP uses latest scan coverage without freshness/readiness metadata.

**Files:**
- Modify: `packages/mcp/src/security-context.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write the failing MCP freshness test**

Add a test where latest scan is stale or not ready according to the same semantics used by repo-map/scan-status. Assert the MCP security context includes freshness/readiness metadata and does not present stale coverage as current without that metadata.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected RED: fail because MCP security context returns latest middleware coverage without freshness/readiness state.

- [ ] **Step 3: Implement minimal GREEN**

In `security-context.ts`:

- Mirror existing repo-map freshness/readiness behavior or call the shared scan-status readiness helper.
- Include scan id, scan status, readiness, freshness requirement, and stale reason where available.
- Keep the response source-snippet-free.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected GREEN: MCP consumers can distinguish current proven coverage from stale or incomplete scan data.

---

## Task 12: Reject Impossible Engine-Contract Middleware Proof States

**Findings covered:** P2 engine-contract test blesses `middleware.proven=true` with a blocking parser gap.

**Files:**
- Modify: `packages/engine-contract/src/index.ts`
- Test: `packages/engine-contract/test/security-contract.test.ts`
- Modify if needed: `packages/core/src/security.ts`
- Test if core schema changes: `packages/core/test/security.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Split fixtures:

- proven middleware proof with no blocking parser gap: accepted
- parser-gap middleware proof with `proven === false`: accepted
- parser-gap middleware proof with `proven === true`: rejected

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected RED: fail because the current schema/test fixture accepts an impossible proven-plus-blocking-gap state.

- [ ] **Step 3: Implement minimal GREEN**

Add schema refinement in engine-contract and core if necessary:

- `middleware.proven === true` must not coexist with blocking parser gaps for the same proof.
- `proof_kind === "parser_gap"` must imply `proven === false`.
- Preserve backwards-compatible parsing for valid Phase 1 auth proof states.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/engine-contract test -- security-contract
pnpm --filter @drift/core test -- security
```

Expected GREEN: impossible proof states fail schema validation; valid proven and parser-gap fixtures pass separately.

---

## Task 13: Strengthen Middleware E2E Fixtures for Exclusions and Mismatch Reasons

**Findings covered:** P2 e2e lacks exclusion fixture and collapses path/method mismatch to one boolean.

**Files:**
- Modify: `test/e2e/security-middleware.test.ts`

- [ ] **Step 1: Write the failing e2e assertions**

Add fixture coverage for:

- route excluded by middleware matcher
- route path mismatch
- route method mismatch
- parser gap
- accepted deterministic proof

Assert exact proof/finding reasons, not just presence/absence booleans.

- [ ] **Step 2: Run RED**

```bash
pnpm test:e2e -- security-middleware
```

Expected RED: fail because current e2e coverage does not expose exclusion and mismatch reasons distinctly.

- [ ] **Step 3: Implement minimal GREEN**

Adjust only the behavior required by prior tasks so e2e output contains:

- path mismatch reason
- method mismatch reason
- matcher exclusion reason
- parser-gap reason
- proven accepted deterministic coverage reason

Do not add TypeScript deterministic logic to manufacture these reasons.

- [ ] **Step 4: Run GREEN**

```bash
pnpm test:e2e -- security-middleware
```

Expected GREEN: scan-level regressions for exclusion, path mismatch, method mismatch, parser gap, and proven coverage are independently caught.

---

## Task 14: Complete Middleware Scan-Status Capability Assertions

**Findings covered:** P3 CLI scan-status capability test only partially asserts middleware capability.

**Files:**
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing assertion**

In the existing middleware scan-status capability test, assert:

- `required === true`
- `complete === true` when accepted middleware coverage requirements are satisfied
- incomplete or parser-gap cases set `complete === false`

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- cli
```

Expected RED: fail if scan-status does not populate both `required` and `complete` for middleware capability state.

- [ ] **Step 3: Implement minimal GREEN**

Use existing scan-status completeness data for `middleware_must_cover_routes`. Do not infer deterministic proof from raw facts in the test or formatter.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/cli test -- cli
```

Expected GREEN: scan-status reports middleware capability required/completion state explicitly.

---

## Task 15: Add PR-Visible RED/GREEN Evidence

**Findings covered:** P3 TDD requires RED/GREEN evidence, but the remote PR was one implementation commit.

**Files:**
- Create: `docs/architecture/security-boundary-enforcement-phase2-red-green-evidence.md`

- [ ] **Step 1: Create evidence log after implementing Tasks 1-14**

For each task, record:

- task number
- RED command
- expected failure reason
- actual RED summary
- GREEN command
- actual GREEN summary
- commit hash that contains the fix

Use concise summaries, not full test logs.

- [ ] **Step 2: Verify evidence doc has no draft-marker text**

```bash
node -e 'const fs=require("fs"); const p="docs/architecture/security-boundary-enforcement-phase2-red-green-evidence.md"; const t=fs.readFileSync(p,"utf8"); const markers=["TB"+"D","TO"+"DO","fill"+" in"]; const hits=markers.filter((m)=>t.includes(m)); if (hits.length) { console.error(hits.join("\n")); process.exit(1); }'
```

Expected: no matches.

- [ ] **Step 3: Include evidence in PR**

Stage the evidence doc with the correction commit or with a final evidence-only commit after all tests pass.

Expected GREEN: reviewer can see the focused RED/GREEN path without reconstructing it from local shell history.

---

## Final Verification Gates

Run these from the clean correction worktree before pushing:

```bash
cargo test -p drift-engine security_
cargo test -p drift-engine
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm test:e2e
pnpm typecheck
cargo fmt --all -- --check
cargo clippy -p drift-engine --all-targets -- -D warnings
git diff --check
```

Do not run `pnpm verify:ci` unless explicitly requested.

## Production Readiness Exit Criteria

- `middleware_must_cover_routes` blocks in real `drift check` with lifecycle, diff, baseline, waiver, and check-run behavior intact.
- `api_route_requires_auth_helper` accepts middleware only through accepted deterministic middleware proof.
- Unaccepted middleware, middleware existence, candidate evidence, heuristic evidence, and static matcher coverage alone never prove auth.
- Dynamic matcher expressions create parser-gap-backed evidence and cannot silently become static proof.
- Middleware helper calls prove auth only when middleware-local dominance is established.
- Reuse cannot retain stale derived middleware facts or drop parser-gap diagnostics.
- Route path/method normalization is shared and covers app/pages route variants.
- Contract method scope is enforced.
- Query and MCP consume persisted proof/read model, not raw facts, for `proven: true`.
- MCP exposes freshness/readiness metadata.
- Engine-contract/core schemas reject impossible proven-plus-parser-gap states.
- E2E tests cover exclusion, path mismatch, method mismatch, parser gap, and accepted proof separately.
- Scan-status middleware capability asserts both `required` and `complete`.
- PR includes focused RED/GREEN evidence.
- No Phase 3+ security-boundary implementation appears in the diff.
- No unrelated dirty files, generated build output, lockfile churn, source snippets, secrets, request payloads, cookie/header values, raw SQL values, env values, or tokens appear in output changes.
