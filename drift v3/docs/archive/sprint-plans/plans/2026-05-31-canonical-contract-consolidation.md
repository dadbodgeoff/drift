# Canonical Contract Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drift answer route, framework, semantic coverage, readiness, and security questions from canonical engine contracts and query read models instead of scattered CLI/MCP/security helpers.

**Architecture:** The Rust engine remains the scan-time owner for Next route identity and normalized framework entrypoints. Storage persists those contracts unchanged per scan. Query owns product read models that merge normalized entrypoints, security proofs, parser gaps, and capability reports; CLI, MCP, and beta proof consume those read models.

**Tech Stack:** Rust drift-engine, TypeScript packages `@drift/core`, `@drift/engine-contract`, `@drift/storage`, `@drift/query`, `@drift/cli`, `@drift/mcp`, SQLite, Vitest, Cargo tests, Node beta proof.

---

## Live State Verified

- Worktree audited: `/Users/geoffreyfernald/.config/superpowers/worktrees/driftv3/codex-canonical-contract-consolidation-plan/drift v3`
- Branch: `codex/canonical-contract-consolidation-plan`
- Base: `origin/main` at `d9c9e187`
- Required landed merges present on `origin/main`: `363f4876` (#90), `fbdcbf23` (#91), `d9c9e187` (#92)
- Current dirty source checkout was not used because `/Users/geoffreyfernald/Downloads/driftv3` is on `codex/security-phase4-tenant-authorization` with local changes.

## Scope Boundaries

In Sprint 1:
- Consolidate route identity, route path, method, framework role, security route summaries, parser gap summaries, semantic coverage, and readiness through canonical contracts/read models.
- Keep Next.js app router, pages router, `src/app`, dynamic routes, and route groups behavior stable.
- Make CLI and MCP route/security/readiness surfaces agree for the same persisted scan.
- Fail closed when canonical contracts are absent, stale, or bypassed by raw fallback.

Out of scope:
- No new framework support.
- No new major product surface.
- No new security rule family.
- No rewrite of graph construction beyond consuming its existing completeness/capability data.
- No removal of legacy `drift.security.context.v1` until v2 parity is proven.

## Findings

### P1 - CLI repo map still derives Next route paths locally

- File/path: `packages/cli/src/domain/repo-map.ts:190-230`
- Exact issue: `knownPhase8Routes` builds `route_id` from `file.path` and exported method, then `routePathForFile` reimplements app-router parsing with `app`, `api`, route groups, and bracket replacement.
- Why it matters: CLI route summaries can diverge from `packages/core/src/next-routes.ts` and Rust `crates/drift-engine/src/next_routes.rs`; the local helper handles app routes only and does not use persisted normalized entrypoints.
- Proposed fix: remove CLI-local route path parsing. Build `known_routes` through a query read model fed by `storage.listNormalizedEntrypoints(...)` and security proofs.
- Test needed: CLI repo-map test where `apps/web/app/(admin)/api/projects/route.ts` and `src/pages/api/projects/[projectId].ts` produce the same route IDs, paths, and methods as MCP `get_repo_map`.

### P1 - MCP security context v2 still falls back to raw facts for known routes

- File/path: `packages/mcp/src/security-context.ts:80-93`, `packages/mcp/src/security-context.ts:126-143`
- Exact issue: v2 uses `knownRoutesFromFacts(storage.listFacts(...))` and reconstructs route IDs from `route_declared` facts.
- Why it matters: raw facts do not carry the full canonical framework entrypoint contract. A missing or stale normalized entrypoint stream can be masked by raw fact fallback.
- Proposed fix: pass normalized entrypoints into the security route read model. Allow raw fact fallback only through an explicit `legacy_fact_fallback` source field when normalized entrypoints are empty, and make beta proof fail when that fallback is used.
- Test needed: MCP security context test where normalized entrypoints are missing but route facts exist; v2 must mark fallback explicitly, and beta proof must reject it.

### P1 - Rust proof output has duplicate Next route path helpers

- File/path: `crates/drift-engine/src/check_command.rs:1192-1203`, `crates/drift-engine/src/check_command.rs:2045-2058`, `crates/drift-engine/src/check_command.rs:2991-3021`, `crates/drift-engine/src/security_phase6.rs:1336-1368`
- Exact issue: security proof and check code contain local `next_route_path` / `phase5_route_path_from_file` implementations instead of using `next_api_route_identity`.
- Why it matters: route groups and `src/app` are handled in the canonical helper, but these local helpers only handle narrower `app/api` paths and simple bracket replacement.
- Proposed fix: replace local route path helpers with `next_api_route_identity(file_path).map(|identity| identity.route_path)`. Add a helper for endpoint JSON that uses the canonical identity.
- Test needed: Cargo tests for proof endpoint path on `src/app/(admin)/api/projects/[id]/route.ts` and pages API route path.

### P1 - Security proof routes do not consistently attach normalized entrypoint identity

- File/path: `packages/engine-contract/src/index.ts:720-728`, `packages/core/src/security.ts:502-514`, `packages/cli/src/check/run-check.ts:1982`, `packages/storage/src/sqlite-storage.ts:821-867`, `crates/drift-engine/src/check_command.rs:2271-2279`, `crates/drift-engine/src/check_command.rs:2422-2428`, `crates/drift-engine/src/check_command.rs:2618-2624`, `crates/drift-engine/src/check_command.rs:2862-2868`, `crates/drift-engine/src/security_phase6.rs:1066-1073`
- Exact issue: `@drift/engine-contract` allows `normalized_entrypoint_id`, but `@drift/core` does not, and CLI/storage parse proofs through the core schema. Rust proof JSON also omits the field on auth, Phase 5, request validation, Phase 4, and Phase 6 route objects.
- Why it matters: consumers must match proof routes back to entrypoints by string convention, which keeps duplicated route-id derivation alive.
- Proposed fix: add `normalized_entrypoint_id` to the core security proof route schema, verify CLI/storage round-trip preservation, then add a Rust helper that computes `entrypoint:<framework>:<file_path>:<method>` from `next_api_route_identity` and handler symbol and emits it in every security proof route.
- Test needed: core schema, engine contract, storage round-trip, CLI check parse, and Rust check tests asserting proof routes include `normalized_entrypoint_id` matching `normalized_entrypoints[*].entrypoint_id`.

### P1 - Proof-backed Phase 8 routes would still lose canonical route metadata

- File/path: `packages/query/src/security-boundary-proof.ts:163-170`, `packages/query/src/security-boundary-proof.ts:445-530`
- Exact issue: `buildSecurityPhase8ReadModel` filters `known_routes` out when a proof has the same `route_id`, then builds proof-backed routes only from the proof. If canonical route metadata is only propagated through unknown routes, the primary proof-backed paths still lose `normalized_entrypoint_id`, route source, and fallback/staleness state.
- Why it matters: the most important security routes are the ones with proofs. Leaving those proof-backed routes unmerged would make CLI/MCP parity look fixed only for routes with no proof.
- Proposed fix: index canonical routes by `route_id` and merge their path/method/source/`normalized_entrypoint_id` into both proof-backed and unknown Phase 8 route summaries. Surface fallback and staleness status at the read-model level.
- Test needed: query test with a proof and matching normalized entrypoint; assert `routes`, `changed_route_security`, `required_proofs`, and `current_proof_status` preserve canonical metadata.

### P1 - Latest proof runs can be mixed with unrelated latest scan entrypoints

- File/path: `packages/cli/src/domain/repo-map.ts:120-130`, `packages/mcp/src/index.ts:1576-1586`, `packages/mcp/src/security-context.ts:67-78`
- Exact issue: CLI/MCP read latest proof runs by repo/path/check filters, then combine those proof runs with latest indexed scan entrypoints and readiness without requiring matching `scan_id`.
- Why it matters: route/security output can combine fresh framework entrypoints with stale proof results, which defeats the canonical contract freshness guarantee.
- Proposed fix: query should detect proof-run scan mismatch and return `proof_freshness: "stale"` with refusal/readiness reasons unless explicitly rendering legacy scan-scoped fallback.
- Test needed: seed latest scan `scan_new` plus proof run `scan_old`; repo map and MCP security context must mark stale/refuse instead of silently merging.

### P1 - CLI and MCP have duplicated readiness-for-stored-scan logic

- File/path: `packages/cli/src/domain/scan-status.ts:734-755`, `packages/mcp/src/index.ts:1268-1293`
- Exact issue: both packages calculate stored-scan readiness separately. Scan-status paths are close today, but repo-map and preflight consumers can diverge on no-scan/missing-graph vocabulary.
- Why it matters: `drift scan status`, MCP scan status, repo map, and preflight can disagree about `required_capabilities`, `missing_capabilities`, or refusal reasons.
- Proposed fix: move stored-scan readiness input normalization into `packages/query/src/readiness.ts` as a pure helper. CLI and MCP pass storage facts into the same helper.
- Test needed: query unit tests for no scan, scan without graph, scan with graph, and parser gap v2 blocking; CLI/MCP tests assert byte-level matching readiness objects for scan status, repo map, and preflight.

### P2 - Framework entrypoints are persisted and surfaced, but not yet authoritative

- File/path: `crates/drift-engine/src/frameworks/mod.rs:42-71`, `packages/storage/src/sqlite-storage.ts:525-659`, `packages/query/src/framework-entrypoints.ts:24-98`, `packages/cli/src/domain/repo-map.ts:93-101`, `packages/mcp/src/index.ts:1549-1557`
- Exact issue: normalized entrypoints are emitted, stored, and exposed, but route/security product summaries still use read-model files/facts to construct known routes.
- Why it matters: `framework_entrypoints` is secondary evidence instead of the product source of truth.
- Proposed fix: create a canonical route read model in query that starts from normalized entrypoints, enriches from proof routes, and explicitly reports fallback status.
- Test needed: query test proves route summaries use normalized entrypoints even when fact file role data is incomplete.

### P2 - Semantic coverage and readiness use the same builder but not the same capability source everywhere

- File/path: `packages/cli/src/commands/prepare.ts:129-151`, `packages/mcp/src/index.ts:268-290`, `packages/cli/src/domain/scan-status.ts:807-855`, `packages/core/src/semantic-capabilities.ts:7`, `scripts/run-beta-proof.mjs:199-244`
- Exact issue: prepare surfaces hard-code `ts.route_flow.v1`, while scan status capability reports derive from engine stats, graph completeness, and fallback status. The vocabularies are not identical: scan capability reports can contain names like `fact_graph`, `syntax_facts`, and `file_discovery`, while semantic capability contracts use IDs like `ts.route_flow.v1`.
- Why it matters: beta proof can pass semantic contract checks while product surfaces still use narrower vocabulary.
- Proposed fix: expose a query helper that maps scan capability report vocabulary into semantic capability IDs, validates unknown capability names fail closed, and builds semantic coverage from the mapped vocabulary and requested product scope. Prepare/MCP preflight use that helper instead of hard-coded capability arrays.
- Test needed: CLI and MCP preflight parity test where capability report includes both raw scan names and semantic IDs; both surfaces return the same semantic coverage, and unknown required capability names are reported rather than silently certified.

### P2 - Test coverage exists for route groups and readiness, but CLI/MCP parity is incomplete

- File/path: `packages/core/test/next-routes.test.ts:24-50`, `crates/drift-engine/tests/stream_graph.rs:487-710`, `packages/mcp/test/mcp.test.ts:1872-1915`, `packages/cli/test/cli.test.ts:10328-10362`
- Exact issue: route identity, framework entrypoint, MCP security context, CLI repo map, and readiness are tested separately. There is no focused parity test proving CLI repo map, MCP repo map, and MCP security context agree on route IDs/paths/methods for the same stored scan; scan status should only be compared for readiness/capability fields because it does not expose route IDs.
- Why it matters: each surface can pass while cross-surface product contracts drift.
- Proposed fix: add a shared parity fixture and assertions around CLI/MCP repo-map, scan-status, security context, and preflight.
- Test needed: new parity tests for grouped app route, pages router route, `src/app` route, dynamic route, middleware route proof, and parser-gap readiness.

## Source-of-Truth Map

| Concept | Current source of truth | Consumers | Duplicates to remove | Proposed canonical owner |
| --- | --- | --- | --- | --- |
| Next API route identity | Rust `next_routes.rs`; TS `packages/core/src/next-routes.ts` mirrors it | engine scan, core tests, CLI/MCP helpers | CLI `routePathForFile`, Rust `next_route_path`, security raw fact route fallback | Rust `next_routes.rs` for scan/proofs; TS core only as contract mirror for TS-only adapters/tests |
| Normalized framework entrypoint | Engine `frameworks/mod.rs` emits `normalized_entrypoints` | storage, query, CLI repo map, MCP repo map | Product route lists using repo-map files/facts first | Engine normalized entrypoint persisted in storage, exposed through query route read model |
| Route id | Security proof builders use `route:<file_path>:<method>` | storage proof tables, query security models, CLI/MCP routes | ad hoc route ID strings in MCP security context, CLI repo map, raw fact fallback | Query canonical route read model, enriched by proof `normalized_entrypoint_id` |
| Route path | `route_pattern` on normalized entrypoints; proof endpoint path; local helpers | repo map, security context, check filters | CLI local route parser, Rust check/security_phase6 path helpers | Normalized entrypoint `route_pattern`; proof endpoint path generated from Rust route identity |
| Method | Route facts and normalized entrypoint `method` | check, repo map, proof route endpoint | `first_route_method` source scan fallback for contract filters | Normalized entrypoint method where persisted; route fact only inside engine scan/proof creation |
| Framework role | Engine endpoint shape and normalized entrypoint framework | repo map framework_entrypoints | role inferred from path outside engine | Normalized entrypoint `framework` plus endpoint metadata |
| Security route summary | Query `buildSecurityPhase8ReadModel` | CLI repo map, MCP repo map, MCP security context | known routes from readModel files and facts | Query canonical route + Phase 8 read model |
| Semantic coverage capability | Query `buildSemanticCoverage` plus core semantic capability registry | prepare, MCP preflight, beta proof | hard-coded required capability arrays in CLI/MCP preflight | Query semantic coverage helper using scan capability report |
| Capability vocabulary bridge | Partly implicit in scan capability report and semantic capability registry | prepare, MCP preflight, beta proof | direct reuse of raw scan capability names as semantic IDs | Query helper mapping scan names to semantic capability IDs and failing closed on unknown required names |
| Parser gap v2 summary | CLI/MCP parser gap summary functions | scan status, repo map, prepare | duplicated parser-gap summary functions | Query parser gap summary helper |
| Proof freshness | Proof-run `scan_id` stored separately from latest scan | repo map, MCP security context, beta proof | latest proof-run selection mixed with latest scan entrypoints | Query security route read model rejects or marks stale proof/scan mismatches |
| Readiness status | Query `buildReadiness`; CLI/MCP duplicate storage wrappers | scan status, repo map, prepare, MCP | duplicate `readinessForStoredScan` | Query readiness storage-input normalizer consumed by CLI/MCP |

## Risk Register

- Migration risk: existing stored scans may lack normalized entrypoints. Mitigation: explicit fallback status, no silent fallback, beta proof fails closed.
- Schema risk: adding `normalized_entrypoint_id` to security proof route must land in both `@drift/engine-contract` and `@drift/core`; otherwise CLI/storage parsing can strip it before query sees it. The field remains optional for backward compatibility, but tests must cover old rows and new round trips.
- Backward compatibility risk: `drift.security.context.v1` raw-fact sections may still be consumed. Mitigation: keep v1 but move v2 and product surfaces to canonical read models.
- Freshness risk: proof runs can be newer/older than the latest scan entrypoints. Mitigation: reject or mark stale when proof-run `scan_id` does not match the latest scan used for canonical routes.
- Runtime risk: repo map currently tolerates fact fallback. Tightening it could expose missing scan data. Mitigation: return clear readiness/fallback reasons and next commands.
- Vocabulary risk: scan capability names and semantic capability IDs are not identical. Mitigation: use a tested capability vocabulary bridge and fail closed on unknown required capabilities.
- CI risk: touching engine contract schemas requires synchronized Rust, TS contract, storage, query, CLI, and MCP test updates.
- Product risk: route ID format remains file-path based in this sprint. Mitigation: centralize derivation now; do not rename route IDs until a separate migration exists.

## Architecture Decision

Canonical owners:
- Engine owns scan-time route identity for framework facts, endpoint shapes, and security proof endpoint metadata.
- Storage owns persisted scan contracts and proof rows without deriving product semantics.
- Query owns canonical product read models: route summaries, security summaries, readiness, semantic coverage, and parser gap summaries.
- CLI and MCP are adapters only.
- Beta proof is the final gate and must fail if canonical contracts are missing, stale, or bypassed.

Expected final data flow:
1. Engine scan emits facts, framework adapters, normalized entrypoints, framework parser gaps, and framework capabilities.
2. CLI scan persists those records through storage.
3. Query builds canonical route/security/readiness/semantic read models from persisted records.
4. CLI and MCP return those read models without local route parsing.
5. Beta proof checks CLI/MCP parity, no silent raw fallback, capability report freshness, and semantic coverage completeness.

## File Structure

- Modify `crates/drift-engine/src/next_routes.rs`: keep as Rust route identity owner.
- Modify `crates/drift-engine/src/check_command.rs`: replace route path helpers, emit `normalized_entrypoint_id`.
- Modify `crates/drift-engine/src/security_phase6.rs`: replace route path helper, emit `normalized_entrypoint_id`.
- Modify `crates/drift-engine/src/security_rules.rs`: keep path helper as a thin canonical adapter.
- Modify `crates/drift-engine/src/security_control_flow.rs`: keep path helper as a thin canonical adapter.
- Modify `crates/drift-engine/tests/stream_graph.rs` and security check tests for proof entrypoint linkage.
- Modify `packages/core/src/security.ts` and `packages/engine-contract/src/index.ts` so proof route schema preserves optional `normalized_entrypoint_id`.
- Modify `packages/cli/src/check/run-check.ts` tests or fixtures so CLI check parsing preserves proof route metadata.
- Modify `packages/storage/test/sqlite-storage.test.ts` so proof persistence round trips `normalized_entrypoint_id`.
- Create `packages/query/src/canonical-routes.ts`.
- Modify `packages/query/src/index.ts` to export canonical route helpers.
- Modify `packages/query/src/security-boundary-proof.ts` to accept canonical known routes and expose fallback source.
- Modify `packages/query/src/readiness.ts` to expose stored-scan readiness and parser-gap summary helpers.
- Modify `packages/query/src/semantic-coverage.ts` to build from capability reports.
- Add/update query tests in `packages/query/test/canonical-routes.test.ts`, `packages/query/test/security-boundary-proof.test.ts`, and `packages/query/test/query.test.ts`.
- Modify `packages/cli/src/domain/repo-map.ts` and `packages/cli/src/domain/scan-status.ts`.
- Modify `packages/mcp/src/index.ts` and `packages/mcp/src/security-context.ts`.
- Add parity tests in `packages/cli/test/cli.test.ts` and `packages/mcp/test/mcp.test.ts`.
- Modify `scripts/run-beta-proof.mjs`.

## TDD Tasks

### Task 1: Query Canonical Route Read Model

**Files:**
- Create: `packages/query/src/canonical-routes.ts`
- Modify: `packages/query/src/index.ts`
- Test: `packages/query/test/canonical-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildCanonicalRouteReadModel } from "../src/canonical-routes.js";

describe("buildCanonicalRouteReadModel", () => {
  it("uses normalized entrypoints as the route source of truth", () => {
    const model = buildCanonicalRouteReadModel({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      entrypoints: [{
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint:next_app:apps/web/app/(admin)/api/projects/route.ts:GET",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        kind: "api_route",
        file_path: "apps/web/app/(admin)/api/projects/route.ts",
        handler_symbol: "GET",
        route_pattern: "/api/projects",
        method: "GET",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact:apps/web/app/(admin)/api/projects/route.ts:route_declared:GET:1-3"],
        parser_gap_ids: []
      }],
      proofs: [],
      fallback_fact_routes: [{
        route_id: "route:apps/web/app/(admin)/api/projects/route.ts:GET",
        file_path: "apps/web/app/(admin)/api/projects/route.ts",
        path: "/api/wrong",
        method: "GET",
        file_role: "api_route"
      }]
    });

    expect(model.routes).toEqual([expect.objectContaining({
      route_id: "route:apps/web/app/(admin)/api/projects/route.ts:GET",
      normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/(admin)/api/projects/route.ts:GET",
      path: "/api/projects",
      method: "GET",
      source: "normalized_entrypoint"
    })]);
    expect(model.fallback.used).toBe(false);
  });

  it("marks legacy fact fallback explicitly when entrypoints are absent", () => {
    const model = buildCanonicalRouteReadModel({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      entrypoints: [],
      proofs: [],
      fallback_fact_routes: [{
        route_id: "route:apps/web/app/api/projects/route.ts:GET",
        file_path: "apps/web/app/api/projects/route.ts",
        path: "/api/projects",
        method: "GET",
        file_role: "api_route"
      }]
    });

    expect(model.fallback).toMatchObject({
      used: true,
      reason: "normalized_entrypoints_missing"
    });
    expect(model.routes[0]).toMatchObject({ source: "legacy_fact_fallback" });
  });

  it("marks proof-only routes and scan mismatches explicitly", () => {
    const model = buildCanonicalRouteReadModel({
      repo_id: "repo_abc",
      scan_id: "scan_new",
      entrypoints: [],
      proofs: [{
        proof_scan_id: "scan_old",
        route_id: "route:apps/web/app/api/projects/route.ts:GET",
        file_path: "apps/web/app/api/projects/route.ts",
        path: "/api/projects",
        method: "GET"
      }],
      fallback_fact_routes: []
    });

    expect(model.routes[0]).toMatchObject({
      source: "security_proof",
      freshness: "stale"
    });
    expect(model.proof_freshness).toBe("stale");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @drift/query test -- canonical-routes`

Expected RED: module `../src/canonical-routes.js` cannot be found or `buildCanonicalRouteReadModel` is not exported.

- [ ] **Step 3: Implement the minimal read model**

Implement `buildCanonicalRouteReadModel(input)` with:
- `response_schema: "drift.canonical_routes.read_model.v1"`
- route ID format `route:${entrypoint.file_path}:${entrypoint.method ?? entrypoint.handler_symbol ?? "unknown"}`
- source `"normalized_entrypoint"` for entrypoint-backed routes
- source `"security_proof"` only for proof routes with no matching entrypoint
- source `"legacy_fact_fallback"` only when `entrypoints.length === 0`
- `proof_freshness: "fresh" | "stale" | "none"` derived from proof scan IDs versus the canonical scan ID
- stable sorting by `file_path`, `method`, `route_id`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @drift/query test -- canonical-routes`

Expected GREEN: new canonical route tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/query/src/canonical-routes.ts packages/query/src/index.ts packages/query/test/canonical-routes.test.ts
git commit -m "feat(query): add canonical route read model"
```

### Task 2: Core And Storage Preserve Proof Route Metadata

**Files:**
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Test: `packages/core/test/security.test.ts`
- Test: `packages/engine-contract/test/security-contract.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/security-check.test.ts`

- [ ] **Step 1: Write failing schema and round-trip tests**

Add tests asserting a `SecurityBoundaryProof` route with `normalized_entrypoint_id` is:
- accepted by `@drift/core`
- accepted by `@drift/engine-contract`
- preserved by CLI check proof parsing
- preserved through `SqliteDriftStorage.upsertSecurityBoundaryProofs` and `listSecurityBoundaryProofs`

Run:

```bash
pnpm --filter @drift/core test -- security.test.ts -t "normalized entrypoint"
pnpm --filter @drift/engine-contract test -- security-contract.test.ts -t "normalized entrypoint"
pnpm --filter @drift/storage test -- sqlite-storage.test.ts -t "normalized entrypoint"
pnpm --filter @drift/cli test -- security-check.test.ts -t "normalized entrypoint"
```

Expected RED: `@drift/core` strips or rejects `normalized_entrypoint_id`, so storage/CLI round-trip assertions fail.

- [ ] **Step 2: Implement schema preservation**

Add optional `normalized_entrypoint_id: z.string().min(1).optional()` to the core security proof route schema and verify the engine-contract schema stays aligned. Do not make the field required because old stored proofs must remain readable.

- [ ] **Step 3: Run verification**

Run:

```bash
pnpm --filter @drift/core test -- security.test.ts
pnpm --filter @drift/engine-contract test -- security-contract.test.ts
pnpm --filter @drift/storage test -- sqlite-storage.test.ts
pnpm --filter @drift/cli test -- security-check.test.ts
```

Expected GREEN: proof route metadata survives schema parse and storage round trip.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/security.ts packages/core/test/security.test.ts packages/engine-contract/src/index.ts packages/engine-contract/test/security-contract.test.ts packages/storage/test/sqlite-storage.test.ts packages/cli/test/security-check.test.ts
git commit -m "feat(contract): preserve proof normalized entrypoint ids"
```

### Task 3: Security Read Model Consumes Canonical Routes

**Files:**
- Modify: `packages/query/src/security-boundary-proof.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests that pass `known_routes` from the canonical route read model and assert both proof-backed and unknown security routes preserve `path`, `method`, `normalized_entrypoint_id`, `source`, and fallback/staleness status.

Run: `pnpm --filter @drift/query test -- security-boundary-proof`

Expected RED: `buildSecurityPhase8ReadModel` drops `normalized_entrypoint_id` and `source`, especially for proof-backed routes whose `route_id` already exists in `known_routes`.

- [ ] **Step 2: Implement minimal read-model propagation**

Extend the known route input type in `security-boundary-proof.ts` to accept:

```ts
{
  route_id: string;
  normalized_entrypoint_id?: string;
  file_path: string;
  path?: string;
  method?: string;
  source?: "normalized_entrypoint" | "security_proof" | "legacy_fact_fallback";
}
```

Index known routes by `route_id`. Merge those fields into proof-backed Phase 8 routes and unknown routes. Also propagate them into `changed_route_security`, `required_proofs`, and `current_proof_status` where route identity is returned.

Add read-model-level fields:
- `route_source_summary`
- `canonical_route_fallback`
- `proof_freshness`

Return `proof_freshness: "stale"` when a proof run scan ID does not match the scan ID used for canonical routes.

- [ ] **Step 3: Run verification**

Run: `pnpm --filter @drift/query test -- security-boundary-proof canonical-routes`

Expected GREEN: canonical route and security proof tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/query/src/security-boundary-proof.ts packages/query/test/security-boundary-proof.test.ts
git commit -m "feat(query): feed security summaries from canonical routes"
```

### Task 4: CLI Repo Map Uses Query Canonical Routes

**Files:**
- Modify: `packages/cli/src/domain/repo-map.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Add a repo-map test that seeds normalized entrypoints for:
- `apps/web/app/(admin)/api/projects/route.ts` method `GET` path `/api/projects`
- `src/pages/api/projects/[projectId].ts` method `default` path `/api/projects/:projectId`

Assert `payload.routes` contains those exact paths/methods and does not use a CLI-local parser.

Run: `pnpm --filter @drift/cli test -- cli.test.ts -t "repo map uses canonical route entrypoints"`

Expected RED: CLI repo map either has no canonical route source field or uses the local app-only route parser.

- [ ] **Step 2: Replace local route construction**

In `repo-map.ts`:
- fetch normalized entrypoints, framework parser gaps, and capabilities once
- build `frameworkEntryPoints`
- build `canonicalRoutes`
- pass `canonicalRoutes.routes` to `buildSecurityPhase8ReadModel`
- reject or mark stale when proof runs do not match the latest scan used for canonical routes
- delete CLI-local `routePathForFile`

- [ ] **Step 3: Run verification**

Run: `pnpm --filter @drift/cli test -- cli.test.ts -t "repo map"`

Expected GREEN: repo-map tests pass, including canonical route entrypoint coverage.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/domain/repo-map.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): drive repo map routes from canonical entrypoints"
```

### Task 5: MCP Repo Map And Security Context Use Canonical Routes

**Files:**
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing parity tests**

Add tests that:
- seed the same normalized entrypoints used by CLI
- call MCP `get_repo_map`
- call MCP `get_security_context`
- assert route IDs, paths, methods, `normalized_entrypoint_id`, and no snippets/request payloads/secrets/actor identity

Run: `pnpm --filter @drift/mcp test -- mcp.test.ts -t "canonical route"`

Expected RED: MCP security context still uses `knownRoutesFromFacts`, and route source/fallback state is absent.

- [ ] **Step 2: Replace fact fallback in v2**

In `packages/mcp/src/security-context.ts`:
- load normalized entrypoints for the latest scan
- build canonical routes through query
- pass canonical routes into `buildSecurityPhase8ReadModel`
- keep legacy v1 raw-fact sections isolated in `buildLegacySecurityContextPayload`
- remove v2 `knownRoutesFromFacts` as the default path

In `packages/mcp/src/index.ts`:
- mirror CLI repo-map canonical route wiring
- delete MCP-local known route construction except as explicit fallback input
- reject or mark stale when proof runs do not match the latest scan used for canonical routes

- [ ] **Step 3: Run verification**

Run: `pnpm --filter @drift/mcp test -- mcp.test.ts -t "repo map|security context|canonical route"`

Expected GREEN: MCP repo map and security context return canonical route summaries and no raw sensitive content.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/security-context.ts packages/mcp/test/mcp.test.ts
git commit -m "feat(mcp): use canonical routes for repo and security context"
```

### Task 6: Rust Security Proofs Use Canonical Next Route Identity

**Files:**
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase6.rs`
- Test: `crates/drift-engine/tests/security_check_repo_request_validation.rs`
- Test: existing Phase 4/Phase 5 check coverage in `crates/drift-engine/tests`

- [ ] **Step 1: Write failing Rust tests**

Add tests asserting proof route endpoint path and `normalized_entrypoint_id` for:
- `src/app/(admin)/api/projects/[id]/route.ts`
- `pages/api/projects/[projectId].ts`

Cover every proof route JSON path:
- auth
- Phase 5 sensitive response/secret exposure
- request validation
- Phase 4 session/authorization/tenant
- Phase 6 SSRF/raw SQL/CORS/CSRF/rate limit

Run: `cargo test -p drift-engine security_check_repo_auth -- --nocapture`

Expected RED: proof routes lack `normalized_entrypoint_id`, and duplicate helpers miss at least one grouped or pages route path.

- [ ] **Step 2: Implement canonical endpoint helper**

In Rust, replace duplicate endpoint path logic with a helper shaped like:

```rust
fn route_endpoint(file_path: &str, handler_symbol: &str) -> serde_json::Value {
    if let Some(identity) = next_api_route_identity(file_path) {
        json!({
            "path": identity.route_path,
            "method": handler_symbol,
            "framework": identity.framework
        })
    } else {
        json!({ "method": handler_symbol })
    }
}

fn normalized_entrypoint_id(file_path: &str, handler_symbol: &str) -> Option<String> {
    next_api_route_identity(file_path).map(|identity| {
        let framework = if identity.framework == "next_pages_api" { "next_pages" } else { "next_app" };
        format!("entrypoint:{framework}:{file_path}:{handler_symbol}")
    })
}
```

Emit `normalized_entrypoint_id` in every proof route JSON object that already emits `route_id`, including auth, Phase 5, request validation, Phase 4, and Phase 6.

- [ ] **Step 3: Run verification**

Run:

```bash
cargo fmt --all -- --check
cargo test -p drift-engine security_check_repo_auth security_check_repo_request_validation security_check_repo_phase4 security_check_repo_phase6 stream_graph
```

Expected GREEN: proof route endpoint and normalized entrypoint linkage tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/drift-engine/src/check_command.rs crates/drift-engine/src/security_phase6.rs crates/drift-engine/tests/security_check_repo_auth.rs crates/drift-engine/tests/security_check_repo_request_validation.rs crates/drift-engine/tests/security_check_repo_phase4.rs crates/drift-engine/tests/security_check_repo_phase6.rs
git commit -m "feat(engine): link security proofs to normalized entrypoints"
```

### Task 7: Shared Readiness And Parser Gap Summaries

**Files:**
- Modify: `packages/query/src/readiness.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing query and parity tests**

Add query tests for:
- missing scan returns `required_capabilities: ["fact_graph", "scan_manifest"]`
- scan without graph returns `missing_capabilities: ["fact_graph"]`
- parser gap v2 blocking returns `decision: "refuse"`

Add CLI/MCP tests asserting readiness equality for:
- scan status
- repo map
- CLI prepare and MCP preflight

Run:

```bash
pnpm --filter @drift/query test -- query.test.ts -t "readiness"
pnpm --filter @drift/cli test -- cli.test.ts -t "scan status"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "scan status"
pnpm --filter @drift/cli test -- cli.test.ts -t "repo map readiness|prepare readiness"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "repo map readiness|preflight readiness"
```

Expected RED: at least one stored-scan readiness consumer differs on no-scan/missing-graph cases, especially repo map or preflight.

- [ ] **Step 2: Implement shared helpers**

Move pure logic into query:
- `buildStoredScanReadiness(input)`
- `buildParserGapSummary(gaps)`

CLI and MCP still load storage data, but do not decide missing capability vocabulary themselves.

- [ ] **Step 3: Run verification**

Run:

```bash
pnpm --filter @drift/query test -- query.test.ts
pnpm --filter @drift/cli test -- cli.test.ts -t "scan status"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "scan status"
pnpm --filter @drift/cli test -- cli.test.ts -t "repo map readiness|prepare readiness"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "repo map readiness|preflight readiness"
```

Expected GREEN: readiness and parser gap summaries match across CLI and MCP.

- [ ] **Step 4: Commit**

```bash
git add packages/query/src/readiness.ts packages/query/test/query.test.ts packages/cli/src/domain/scan-status.ts packages/cli/test/cli.test.ts packages/mcp/src/index.ts packages/mcp/test/mcp.test.ts
git commit -m "feat(query): centralize readiness and parser gap summaries"
```

### Task 8: Semantic Coverage Uses Capability Report Vocabulary

**Files:**
- Modify: `packages/query/src/semantic-coverage.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing tests**

Create a scan capability report with mixed vocabulary:
- raw scan names: `["fact_graph", "syntax_facts", "file_discovery"]`
- semantic IDs: `["ts.route_flow.v1"]`
- one unknown required capability: `"unknown_capability"`

Assert CLI prepare and MCP preflight semantic coverage return the same required/complete/missing/unsupported capability arrays, and unknown required capabilities are surfaced as missing or unsupported instead of certified.

Run:

```bash
pnpm --filter @drift/query test -- query.test.ts -t "semantic coverage"
pnpm --filter @drift/cli test -- cli.test.ts -t "semantic coverage"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "semantic coverage"
```

Expected RED: prepare/preflight still hard-code `["ts.route_flow.v1"]`, and there is no vocabulary bridge for raw scan names.

- [ ] **Step 2: Implement capability-report input helper**

Add a query helper that builds semantic coverage inputs from:
- scan capability report certified/required/missing arrays
- a tested mapping from scan capability names to semantic capability IDs
- readiness
- parser gaps
- unsupported capabilities from semantic registry
- unknown required capabilities, which must fail closed as missing/unsupported

Replace CLI/MCP hard-coded required capabilities with the helper.

- [ ] **Step 3: Run verification**

Run:

```bash
pnpm --filter @drift/query test -- query.test.ts
pnpm --filter @drift/cli test -- cli.test.ts -t "prepare"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "preflight"
```

Expected GREEN: CLI and MCP preflight semantic coverage match.

- [ ] **Step 4: Commit**

```bash
git add packages/query/src/semantic-coverage.ts packages/query/test/query.test.ts packages/cli/src/commands/prepare.ts packages/cli/test/cli.test.ts packages/mcp/src/index.ts packages/mcp/test/mcp.test.ts
git commit -m "feat(query): derive semantic coverage from capability reports"
```

### Task 9: Beta Proof Fails Closed On Missing Canonical Contracts

**Files:**
- Modify: `scripts/run-beta-proof.mjs`
- Test: existing beta proof script

- [ ] **Step 1: Add failing proof checks**

Add assertions inside `validateBetaProof` or the proof construction path that require:
- latest scan has normalized entrypoints for grouped app route, `src/app` route, plain app route, and pages API route fixture paths
- CLI and MCP repo-map route arrays hash equal for route IDs, paths, methods, and normalized entrypoint IDs
- MCP security context v2 has no `legacy_fact_fallback` routes
- no route source is raw fact fallback when normalized entrypoints are present
- proof runs used by product surfaces match the scan ID used for canonical routes

Run: `node scripts/run-beta-proof.mjs`

Expected RED before implementation if any canonical route fields are missing from product payloads.

- [ ] **Step 2: Implement proof fields**

Add beta proof fields:
- `canonical_routes_verified`
- `canonical_route_fallback_absent`
- `cli_mcp_route_parity_verified`
- `security_context_canonical_verified`
- `canonical_proof_freshness_verified`

Add those fields to the required true-field list.

- [ ] **Step 3: Run verification**

Run: `node scripts/run-beta-proof.mjs`

Expected GREEN: beta proof completes only when canonical route contracts are present and parity checks pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-beta-proof.mjs
git commit -m "test(beta): fail closed on missing canonical route contracts"
```

### Task 10: Final Cross-Surface Parity Gate

**Files:**
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`
- Test: `test/e2e/installed-flow.test.ts`

- [ ] **Step 1: Write final parity tests**

Add one fixture-backed test that scans a repo containing:
- `apps/web/app/(admin)/api/projects/route.ts`
- `apps/web/src/app/api/users/[id]/route.ts`
- `src/pages/api/projects/[projectId].ts`
- `middleware.ts`

Assert these surfaces agree for route IDs, paths, and methods:
- `drift repo map`
- MCP `get_repo_map`
- MCP `get_security_context`

Assert these surfaces agree for readiness/capability summaries only:
- `drift scan status`
- MCP scan status

Run:

```bash
pnpm --filter @drift/cli test -- cli.test.ts -t "cross-surface canonical route parity"
pnpm --filter @drift/mcp test -- mcp.test.ts -t "cross-surface canonical route parity"
```

Expected RED until previous tasks wire every surface through query canonical routes.

- [ ] **Step 2: Fix only parity defects**

Make no new abstractions here. Fix any remaining adapter drift by routing CLI/MCP through the query helpers introduced in earlier tasks.

- [ ] **Step 3: Run package verification**

Run:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
```

Expected GREEN: package tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/cli.test.ts packages/mcp/test/mcp.test.ts test/e2e/installed-flow.test.ts
git commit -m "test: prove CLI and MCP canonical route parity"
```

## Required Product Contracts

- CLI and MCP return consistent route IDs, paths, and methods for the same repo state.
- Route groups normalize identically everywhere.
- `app/(admin)/api/projects/route.ts` surfaces as `/api/projects`.
- Raw fact fallback cannot silently diverge from normalized framework entrypoints.
- MCP security context does not include snippets, request payloads, secrets, or actor identity.
- Beta proof fails closed if canonical contracts are missing or stale.

## Acceptance Gates

The implementation is not done until all pass:

```bash
git diff --check
pnpm -r build
pnpm -r typecheck
cargo fmt --all -- --check
cargo test -p drift-engine
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/mcp test
pnpm --filter @drift/cli test
pnpm check:boundaries
node scripts/run-beta-proof.mjs
```

## Self-Review

- Spec coverage: all requested audit areas are covered in Findings and mapped to TDD tasks.
- Placeholder scan: no task uses banned placeholder language.
- Type consistency: route fields use `route_id`, `normalized_entrypoint_id`, `path`, `method`, `file_path`, and `source` consistently across query, CLI, MCP, and beta proof.
