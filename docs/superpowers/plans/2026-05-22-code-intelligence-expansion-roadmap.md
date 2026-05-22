# Code Intelligence Expansion Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Drift's deterministic codebase intelligence from route/import graph checks into a broader parser, resolver, graph, and agent-context substrate without drifting from the local-first R&D decisions.

**Architecture:** Rust remains the deterministic authority for parsing, graph construction, resolver truth, completeness, and rule evaluation. TypeScript remains the product/control plane for CLI/MCP, SQLite persistence, policy, audit, governance, and user-facing envelopes. SQLite graph projections are the query source; full graph artifacts remain replay/debug artifacts.

**Tech Stack:** Rust tree-sitter engine, TypeScript workspace packages, SQLite projections, `@drift/factgraph`, `@drift/query`, `@drift/engine-contract`, pnpm/vitest, cargo tests, fixture-driven e2e.

---

## Non-Negotiable R&D Boundaries

- Do not add UI, cloud sync, OCR, Python/Ruby/Go adapters, or duplicate-helper detection until the adapter and graph contracts are stronger.
- Do not let TypeScript independently decide deterministic rule truth once Rust has an engine-owned answer.
- Do not execute repo code, package scripts, bundler plugins, or dynamic config while resolving imports.
- Do not emit blocking findings unless evidence is deterministic, graph-backed, complete enough for the scope, and has stable fingerprints.
- Do not serve agent-facing JSON without freshness, diagnostics, policy metadata, and next commands.
- Do not query full graph JSON for product surfaces. Use normalized SQLite projections and `@drift/query`.
- Do not silently fall back from Rust to TypeScript for enforcement. Fallback is explicit, diagnostic-bearing, and non-blocking.
- Do not claim incremental precision until reverse dependencies and resolver dependencies exist.

## Current Baseline

Already completed:

- CLI/product shell, local SQLite state, audit, backup/restore, baseline, policy, read-only MCP.
- Rust engine scan/check/candidate contracts.
- FactGraph artifact plus normalized node/edge/evidence projections.
- Import-to-module and import-to-symbol resolution for the TypeScript wedge.
- Route-to-service/data-access graph flow and engine-owned deterministic checks.
- Resolver input freshness invalidation for `package.json`, `tsconfig*.json`, and `jsconfig.json`.

The next work must deepen what Drift can learn about source code, while first making dependency and completeness projections strong enough to support parser expansion.

## Files And Ownership

- `crates/drift-engine/src/facts.rs`: deterministic syntax facts. Add parser facts here first, with Rust tests proving extraction before graph changes.
- `crates/drift-engine/src/main.rs`: graph construction, resolver metadata, graph diagnostics, and completeness.
- `crates/drift-engine/src/check_command.rs`: engine-owned rule evaluation only.
- `crates/drift-engine/src/candidate_command.rs`: engine-owned candidate inference only.
- `crates/drift-engine/tests/*.rs`: parser, graph, check, candidate, scale, and determinism fixtures.
- `packages/factgraph/src/index.ts`: graph schema and artifact builders.
- `packages/engine-contract/src/index.ts`: engine protocol validation.
- `packages/storage/src/migrations.ts`: durable SQLite schema.
- `packages/storage/src/sqlite-storage.ts`: storage-owned projection writes and query methods.
- `packages/query/src/index.ts`: shared read models for CLI/MCP/UI, never parser authority.
- `packages/cli/src/**`: orchestration, output, policy, governance, no duplicated deterministic rule logic.
- `packages/mcp/src/**`: read-only transport over query package.
- `test/fixtures/**` and `test/e2e/**`: golden product loops.

## Adjusted Next 25 Sprints

### Sprint 1: Resolver Dependency Projection V1

Problem: `module_dependents` exists and `resolver_dependencies` is migrated, but resolver dependency rows are not yet productized enough for invalidation and affected-file queries.

Deliverables:

- Persist resolver dependency rows from graph import resolution edges.
- Store source file path, dependency path, and dependency kind.
- Expose storage list methods for module dependents and resolver dependencies.
- Keep projection rebuild atomic inside `upsertFactGraphArtifact`.

Verification:

- Storage test proves `IMPORT_RESOLVES_TO_MODULE` creates resolver dependency rows.
- Storage test proves `MODULE_IMPORTS_MODULE` creates module dependent rows.
- `pnpm --filter @drift/storage test`.

### Sprint 2: Dependency-Aware Affected Files Query

Problem: `getAffectedFiles` only walks graph adjacency in memory. Agents need a deterministic reverse-dependency answer that can later use indexes without loading the whole graph.

Deliverables:

- Extend `GraphQueryStorage` with optional dependent and resolver dependency read methods.
- Use module dependents first when available.
- Include direct resolver source files for a changed dependency path.
- Preserve deterministic sorted output.

Verification:

- Query test proves changing a service/data module returns route dependents.
- Query test proves changing a resolved package entrypoint returns importing source files.
- `pnpm --filter @drift/query test`.

### Sprint 3: Graph Completeness Projection V1

Problem: agent and check surfaces need a machine-readable answer for graph readiness before richer parsing and blocking rules expand.

Deliverables:

- Persist graph completeness rows from graph artifact inputs.
- Add a query method that reports completeness reasons from projections, not just node count.
- Surface missing graph, missing import-resolution edges, and missing resolver dependency rows.

Verification:

- Query test for complete graph returns `complete=true`.
- Query test for empty graph returns `graph_empty`.
- Query test for import graph without resolver dependency rows returns `resolver_dependencies_missing`.

### Sprint 4: Data Operation Parser Facts V1

Problem: Drift sees calls like `db.user.findMany()` as generic callsites, but it should learn deterministic data operation shapes.

Deliverables:

- Add a Rust syntax fact kind for data-operation-shaped member calls.
- Detect receiver root, store/model segment, operation name, and full receiver chain.
- Do not classify arbitrary method calls as data operations unless the root is an imported data-access binding or a known data-access local.

Verification:

- Rust parser test detects `db.user.findMany()` as read operation metadata.
- Rust parser test detects `prisma.user.create()` as write operation metadata.
- Rust parser test does not detect `logger.info()`.

### Sprint 5: Data Store Graph Nodes V1

Problem: graph queries should answer which data store/model a route or service reaches, not only which module it imports.

Deliverables:

- Add graph node kinds `data_store` and `data_operation`.
- Add edges from callsite/data operation to data store.
- Add evidence on operation nodes and edges.

Verification:

- Stream graph test proves route graph includes `data_store:user` and `data_operation:findMany`.
- FactGraph schema test accepts new node/edge kinds.

### Sprint 6: Route Reachable Data Operations Query

Problem: `getReachableDataAccess` returns modules, not operations. Agents need compact, actionable data operation context.

Deliverables:

- Extend reachable data-access query payload with operations: operation kind, store/model, file, line, and path.
- Keep snippet-free output.
- Preserve policy and freshness metadata.

Verification:

- Query test proves route -> service -> db exposes the reachable operation through the module path.
- CLI prepare test includes operation summary without source snippets.

### Sprint 7: Read/Write Risk Classification

Problem: Drift should distinguish read-only paths from mutation paths before adding broader conventions.

Deliverables:

- Classify operation names into `read`, `write`, `delete`, `unknown`.
- Add risk reasons for route flows reaching write/delete operations.
- Keep classification deterministic and conservative.

Verification:

- Rust tests for Prisma/common ORM verbs.
- Query test surfaces `data_write` risk for POST route reaching `create`.

### Sprint 8: Endpoint Shape V1

Problem: route facts identify HTTP method but not route path semantics, dynamic params, or handler kind.

Deliverables:

- Add endpoint graph nodes with method, route pattern, framework role, dynamic params.
- Support Next.js app route and pages API patterns.
- Keep path derivation static from file path.

Verification:

- Stream graph test for `app/api/users/[id]/route.ts`.
- Query route flow can select by endpoint path.

### Sprint 9: Service Boundary Detection V2

Problem: service modules are mostly path-role based. Drift should learn service boundary from exports/imports and route usage.

Deliverables:

- Infer service role from import target used by routes plus export shape.
- Keep path-role evidence as supporting signal, not sole authority.
- Emit counterexample diagnostics for ambiguous modules.

Verification:

- Fixture where `src/domain/users.ts` is route-delegated service passes.
- Fixture where route imports data client from non-service path still fails.

### Sprint 10: Symbol Occurrence Projection V1

Problem: symbol declarations and occurrences are not separately queryable enough for rename/affected-file work.

Deliverables:

- Populate `symbol_occurrences` from graph symbol/callsite/evidence.
- Expose storage list method.
- Query symbol neighborhood can include occurrence count and files.

Verification:

- Storage projection test.
- Query symbol neighborhood test.

### Sprint 11: Re-Export Chain Graph V1

Problem: barrel files and re-exports can hide data-access clients and services.

Deliverables:

- Add explicit re-export nodes/edges.
- Preserve re-export chain in import resolution metadata.
- Candidate/check evidence should include the chain when direct data access is hidden behind a barrel.

Verification:

- Rust stream graph fixture for `export { db } from "./client"`.
- Engine check fixture flags route importing db through barrel.

### Sprint 12: Alias And Default Import Symbol Semantics

Problem: named aliases are handled, but default/namespace imports need stronger symbol semantics.

Deliverables:

- Resolve default exports where statically declared.
- Model namespace import membership conservatively.
- Emit unresolved-symbol diagnostics for unsupported namespace shapes.

Verification:

- Rust fixtures for default service export and namespace data client import.

### Sprint 13: Check Completeness V2

Problem: checks need per-rule completeness, not only global limits.

Deliverables:

- Add required node/edge/evidence classes per deterministic rule.
- Disable blocking when required graph evidence is incomplete for the scope.
- Return explicit completeness diagnostics.

Verification:

- Check fixture with unresolved route import warns and does not block.
- Check fixture with complete graph blocks deterministic violation.

### Sprint 14: Baseline Graph Fingerprint V2

Problem: baselines should survive harmless line movement and import alias renames.

Deliverables:

- Prefer graph entity IDs and resolved module/symbol IDs in fingerprints.
- Keep legacy fingerprint compatibility.
- Add migration-safe matching strategy.

Verification:

- Moving a violation line does not create a new baseline violation.
- Renaming `db` to `database` does not bypass baseline.

### Sprint 15: Exception Targeting V2

Problem: exceptions are path/import/symbol level. Richer graph rules need route/endpoint/data-operation targeting.

Deliverables:

- Add exception matcher fields for endpoint path, method, resolved module, resolved symbol, data store, operation kind.
- Apply in engine-owned checks.
- Audit convention exception changes.

Verification:

- Health route exception suppresses only health endpoint.
- Read-only operation exception does not suppress write operation.

### Sprint 16: Required Checks From Graph Risk

Problem: prepare can recommend commands, but it does not yet derive checks from graph risk.

Deliverables:

- Map risky route/data operation changes to required checks.
- Keep checks recommended unless explicitly invoked.
- Expose reason and evidence node IDs.

Verification:

- Prepare fixture for write route recommends API/service tests.

### Sprint 17: Adapter Capability Registry Package

Problem: multi-language growth needs capability certification before new adapters.

Deliverables:

- Add `packages/adapters` with manifest schemas and capability certification types.
- Add built-in TypeScript adapter manifest.
- Do not execute external adapters.

Verification:

- Package tests validate manifests.
- Boundary checks prevent CLI from importing adapter internals directly.

### Sprint 18: Parser Capability Completeness

Problem: adapter capabilities must be attached to facts, nodes, and checks.

Deliverables:

- Add capability metadata to graph completeness and engine stats.
- Ensure rules read required capabilities, not adapter identity.

Verification:

- Engine contract tests reject missing capabilities for blocking rule results.

### Sprint 19: Fixture Matrix V3

Problem: richer intelligence needs fixtures that prevent overfitting.

Deliverables:

- Add fixtures for barrel re-export db, namespace import, default export service, dynamic route params, route write operation, mixed JS/TS.
- Add golden scan/check/prepare snapshots where stable.

Verification:

- `pnpm test:e2e` covers new fixtures with deterministic normalized output.

### Sprint 20: Performance Budget Harness

Problem: parser expansion can regress speed/memory.

Deliverables:

- Add synthetic repo generator or fixture harness for 1k+ source files.
- Record scan stats and enforce a CI-safe budget.
- Keep failures diagnostic, not flaky.

Verification:

- Scale test enforces file count, fact count, graph count, duration budget with stable threshold.

### Sprint 21: Agent Envelope V2 Adoption

Problem: agent-facing surfaces are not yet fully uniform.

Deliverables:

- Add shared envelope for prepare, ask, repo map, findings, MCP.
- JSON-mode failures return structured refusals.
- Include action: `safe_to_edit`, `run_scan_first`, `blocked_by_policy`, `blocked_by_stale_graph`, `context_truncated`.

Verification:

- CLI/MCP parity tests for prepare.
- Stale/no-scan paths return JSON refusals.

### Sprint 22: Policy Surface Audit

Problem: new intelligence increases outward context risk.

Deliverables:

- Route every agent-facing query through central policy context authorization.
- Add redaction/truncation metadata on graph-derived payloads.
- Ensure no source snippets are stored or emitted by new graph intelligence.

Verification:

- Policy tests for denied globs, secret-like files, long evidence, MCP payloads.

### Sprint 23: Dogfood Drift On Drift V2

Problem: the product must prove usefulness on its own repo.

Deliverables:

- Run Drift on Drift using the latest graph intelligence.
- Update dogfood transcript with scan, repo map, prepare, check, findings, MCP, and gaps.
- Capture confusing output and next fixes.

Verification:

- Dogfood doc includes real command outputs and honest limitations.

### Sprint 24: OSS Hardening Pack

Problem: public testers need trust and contribution rails.

Deliverables:

- Add/refresh `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, issue templates, PR template, package metadata.
- Keep product claims aligned to current capabilities.

Verification:

- Release hygiene e2e validates docs/package metadata.

### Sprint 25: Beta Intelligence Gate

Problem: before broader languages or UI, Drift needs one hard gate that proves it is a product, not a parser demo.

Deliverables:

- Define beta readiness checklist across engine, storage, query, CLI/MCP, packaging, security, performance, and dogfood.
- Run full verification.
- Document remaining blockers explicitly.

Verification:

- `pnpm verify:ci`.
- Dogfood transcript updated.
- Branch pushed with clean working tree.

## Immediate Implementation Batch

This overnight batch begins with Sprints 1-5. Sprints 1-3 establish dependency and completeness projections first; Sprints 4-5 then add the first narrow parser/graph intelligence expansion on top of those projections.

### Task 1: Resolver Dependency Projection

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

- [ ] Add `ResolverDependency` and `ModuleDependent` domain types.
- [ ] Add schemas for both records.
- [ ] In `upsertFactGraphArtifact`, derive resolver dependency rows from `IMPORT_RESOLVES_TO_MODULE` edges and their `import_decl` source node metadata.
- [ ] Add `listResolverDependencies(repoId, scanId)` and `listModuleDependents(repoId, scanId)`.
- [ ] Prove rows are replaced atomically when the graph artifact is replaced.

Run:

```bash
pnpm --filter @drift/storage test
```

Expected:

```text
Test Files  1 passed
```

### Task 2: Dependency-Aware Affected Files Query

**Files:**

- Modify: `packages/query/src/index.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] Extend `GraphQueryStorage` with optional `listResolverDependencies` and `listModuleDependents`.
- [ ] Make `getAffectedFiles` include reverse module dependents through the projection when available.
- [ ] Make `getAffectedFiles` include resolver source files when `input.path` is a resolved dependency path.
- [ ] Preserve current graph-adjacency fallback when projection methods are absent.

Run:

```bash
pnpm --filter @drift/query test
```

Expected:

```text
Test Files  1 passed
```

### Task 3: Projection-Based Completeness Query

**Files:**

- Modify: `packages/query/src/index.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] `getCompleteness` returns `graph_empty` when no graph nodes exist.
- [ ] `getCompleteness` returns `resolver_dependencies_missing` when import resolution edges exist but resolver dependency rows are absent.
- [ ] `getCompleteness` returns `complete=true` when graph and resolver dependency projections agree.

Run:

```bash
pnpm --filter @drift/query test
```

Expected:

```text
Test Files  1 passed
```

### Task 4: Data Operation Parser Facts

**Files:**

- Modify: `crates/drift-engine/src/facts.rs`
- Modify: `crates/drift-engine/src/main.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Test: `crates/drift-engine/tests/typescript_facts.rs`

- [ ] Add deterministic `data_operation_detected` facts for member-call shapes like `db.user.findMany()`.
- [ ] Store receiver chain, operation name, store/model segment, and conservative read/write kind.
- [ ] Do not classify arbitrary member calls like `logger.info()`.
- [ ] Keep engine/check protocol schemas in parity with the new fact kind.

Run:

```bash
cargo test -p drift-engine detects_data_operation_shaped_member_calls
```

Expected:

```text
test detects_data_operation_shaped_member_calls ... ok
```

### Task 5: Data Store Graph Nodes

**Files:**

- Modify: `crates/drift-engine/src/main.rs`
- Modify: `packages/factgraph/src/index.ts`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Test: `crates/drift-engine/tests/stream_graph.rs`
- Test: `packages/factgraph/test/factgraph.test.ts`

- [ ] Add graph node kinds `data_store` and `data_operation`.
- [ ] Add data operation edges to data stores.
- [ ] Emit operation graph only when the receiver root resolves to a data-access import binding.
- [ ] Version the FactGraph contract for the new graph surface while retaining read compatibility with `factgraph.v1`.

Run:

```bash
cargo test -p drift-engine scan_stream_resolves_alias_workspace_index_imports_and_reports_unresolved_imports
pnpm --filter @drift/factgraph test
```

Expected:

```text
test scan_stream_resolves_alias_workspace_index_imports_and_reports_unresolved_imports ... ok
Test Files  1 passed
```

### Task 6: Full Gate

**Files:**

- Production files limited to Tasks 1-5.

- [ ] Run the full repo gate.
- [ ] Fix only root-cause issues inside this batch.
- [ ] Commit and push if green.

Run:

```bash
pnpm verify:ci
```

Expected:

```text
Architecture boundaries OK
```

## Self-Review

Spec coverage:

- The 25-sprint roadmap covers parser expansion, graph learning, dependency invalidation, storage/query projection, agent envelopes, policy, fixture growth, performance, dogfood, and beta readiness.
- The immediate batch covers the infrastructure needed before new parser facts are safe to rely on.

Placeholder scan:

- No sprint says "TBD" or asks future agents to invent behavior.
- Deferred items are explicitly sequenced and have concrete acceptance criteria.

Type consistency:

- Projection names match existing migrations: `resolver_dependencies` and `module_dependents`.
- Query method names align with existing storage naming: `listGraphNodes`, `listGraphEdges`, `listGraphEvidence`.
