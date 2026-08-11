# Overnight Frontier Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Drift from a graph-backed local-first product shell into a frontier-grade agent intelligence tool without violating the existing R&D boundaries.

**Architecture:** Rust remains the deterministic authority for scan, graph construction, import/symbol resolution, diff classification, and rule evaluation. TypeScript remains the product/control plane for CLI, MCP, SQLite persistence, governance, audit, policy, and output rendering. SQLite graph projections are the query source; immutable graph artifacts are replay/debug records.

**Tech Stack:** Rust tree-sitter engine, TypeScript packages, SQLite storage, `@drift/factgraph`, `@drift/query`, `@drift/engine-contract`, pnpm/vitest, cargo tests, packaged Rust engine binaries.

---

## R&D Constraints This Plan Must Preserve

- Do not build UI, cloud sync, broad language support, OCR, or duplicate-helper detection before the intelligence substrate is stable.
- Do not let TypeScript become deterministic rule authority once Rust can answer the rule.
- Do not query giant graph JSON from CLI/MCP. Product surfaces read normalized SQLite graph projections through `@drift/query`.
- Do not silently fall back from Rust to TypeScript for blocking checks.
- Do not produce agent-facing JSON without policy/freshness/diagnostic metadata.
- Do not add a new adapter path without the adapter SDK/capability contract.
- Blocking findings require deterministic evidence, stable fingerprints, and completeness metadata.
- Every outward context surface must remain local-first and policy-gated.

## Adjusted 25-Sprint Sequence

The earlier 25-sprint sketch is adjusted to account for work already completed: CLI modularization, boundary checks, engine contracts, graph streaming, FactGraph projections, graph-backed prepare, import-resolution phase 2, packaging foundation, and incremental scan change records.

### Sprint 1: Symbol Resolution V1

Problem: Drift resolves imports to modules and callsites to import aliases, but it does not yet link import declarations to exported symbols in resolved modules.

Deliverables:

- Add graph edge kind `IMPORT_RESOLVES_TO_SYMBOL`.
- Add Rust graph stream edges from import declarations to matching exported symbol nodes when the resolved module exports that name.
- Support named imports, aliased named imports, and default imports where evidence exists.
- Add unresolved-symbol diagnostics only for local resolved modules, not external packages.

Verification:

- Rust stream fixture proves `import { getUsers as loadUsers } from "@/services/users"` resolves to `symbol:src/services/users.ts:function:getUsers`.
- `cargo test -p drift-engine scan_stream_resolves_imports_to_exported_symbols`.
- `pnpm --filter @drift/factgraph test` if graph schema changes require package validation.

### Sprint 2: Symbol Neighborhood Query

Problem: The query package exposes a symbol neighborhood method, but it depends on generic edge fanout rather than semantically useful import/call/symbol links.

Deliverables:

- Query should return import declarations, exported symbol nodes, callsites, route handlers, and evidence around a symbol.
- Add bounded depth handling and deterministic ordering.
- Include diagnostics when a symbol id is missing.

Verification:

- `packages/query/test/query.test.ts` fixture asserts symbol neighborhood includes `IMPORT_RESOLVES_TO_SYMBOL` and `CALLSITE_REFERENCES_SYMBOL`.
- `pnpm --filter @drift/query test`.

### Sprint 3: Route-To-Service Flow Enforcement

Problem: Drift can describe route-to-service-to-data graph flows, but check enforcement still mainly targets direct data imports.

Deliverables:

- Add engine-owned rule support for `api_route_requires_service_delegation`.
- Treat `route -> service -> data_access` as compliant.
- Treat `route -> data_access` as violation.
- Treat unresolved route imports as warning/incomplete, not blocking.

Verification:

- Clean service fixture emits no finding.
- Direct route-to-db fixture emits blocking finding.
- Unresolved import fixture emits completeness diagnostic and does not over-block.
- `cargo test -p drift-engine` and CLI check tests pass.

### Sprint 4: Engine-Owned Candidate Inference V2

Problem: Candidate inference is engine-owned but still fact-heavy and not fully symbol/flow-aware.

Deliverables:

- Infer direct-data-access and service-delegation candidates from graph edges first.
- Include graph fingerprints, required capabilities, and counterexamples.
- Avoid candidate creation from fixture/test paths.
- Keep candidate state mutation exclusively in TypeScript governance commands.

Verification:

- Candidate fixture produces stable candidate ids across repeat scans.
- Service-delegation candidate includes route/service evidence and direct-db counterexamples.
- `pnpm --filter @drift/cli test -- --runInBand --testNamePattern "candidate"`.

### Sprint 5: Incremental Scan Execution V1

Problem: Drift persists file change records but still effectively reparses everything.

Deliverables:

- Reuse unchanged file snapshots/facts/graph projections when adapter, resolver, and schema versions match.
- Reparse added/modified files.
- Remove deleted-file graph projections.
- Mark resolver-wide invalidation when tsconfig/jsconfig/package exports change.

Verification:

- Repeated scan fixture shows unchanged files reused.
- Modified route updates graph.
- Deleted file removes graph nodes/edges.
- Resolver config change forces full graph rebuild.

### Sprint 6: Resolver Reverse Dependency Index

Problem: Incremental import resolution cannot be honest without reverse indexes.

Deliverables:

- Persist `module_dependents` and `resolver_dependencies` projections.
- Record which config/package files influenced each resolved import.
- Use reverse dependencies for invalidation summaries.

Verification:

- Changing `tsconfig.json` reports affected aliases.
- Changing a barrel file reports dependent modules.
- Storage migration tests cover new projections.

### Sprint 7: Finding Evidence V2

Problem: Findings need richer graph evidence than single import lines.

Deliverables:

- Link findings to import declaration, resolved module, resolved symbol, route, and route handler nodes where available.
- Emit evidence ids from graph evidence, not synthetic ids when real evidence exists.
- Add `FINDING_HAS_EVIDENCE` projection for persisted findings.

Verification:

- Finding evidence query returns import + symbol + route nodes.
- CLI findings JSON includes related graph node ids.

### Sprint 8: Baseline V2

Problem: Current baseline fingerprints can be too line/import-source dependent.

Deliverables:

- Prefer stable graph entity ids in finding fingerprints.
- Keep legacy fingerprint compatibility for existing baseline records.
- Add migration-safe baseline matching strategy.

Verification:

- Moving a violation down a few lines does not create a new baseline violation.
- Renaming an import alias does not bypass a graph-backed baseline.

### Sprint 9: Waiver And Exception V2

Problem: Exceptions need graph-aware targeting so teams do not weaken entire conventions.

Deliverables:

- Support exceptions for path glob, file role, import source, resolved module, resolved symbol, and route method/path.
- Apply exceptions in engine-owned checks.
- Audit exception creation/editing.

Verification:

- Health route exception suppresses only that route.
- Symbol-specific exception does not suppress another DB client.

### Sprint 10: Agent Envelope V2

Problem: Agent outputs are useful but not yet fully uniform across CLI/MCP.

Deliverables:

- Shared success/refusal envelope for prepare, ask, repo map, findings, and MCP tools.
- Machine-readable freshness, policy, diagnostics, truncation, payload, next commands.
- JSON-mode failures return JSON refusals.

Verification:

- CLI/MCP parity tests for equivalent prepare payloads.
- Malformed/no-scan/stale-state paths return JSON refusal, not prose-only stderr.

### Sprint 11: Freshness And Require-Fresh

Problem: Agent context must fail closed when graph state is missing/stale/truncated.

Deliverables:

- Add `--require-fresh` to `prepare`, `ask`, `repo map`, and relevant MCP inputs.
- Use source changes, adapter version, resolver version, graph schema, rule version, and policy changes in freshness metadata.
- Emit exact rescan command.

Verification:

- Dirty source after scan makes `prepare --require-fresh --json` refuse with `drift scan`.
- Non-require-fresh surfaces include stale warning.

### Sprint 12: Fixture Matrix V2

Problem: Test coverage is still too concentrated around a few fixture shapes.

Deliverables:

- Add/upgrade fixtures: `next-api-clean`, `next-api-service-delegated`, `monorepo-alias-db`, `re-exported-db-client`, `legacy-baselined-violations`, `mixed-js-ts-next-repo`, `no-ts-repo`, `large-synthetic-repo`.
- Add golden normalization utilities.
- Cover scan, repo map, prepare, check, findings, and MCP where applicable.

Verification:

- Golden outputs are deterministic across repeated runs.
- `pnpm test:e2e` covers the matrix without machine-specific paths.

### Sprint 13: Scale Gates V1

Problem: Drift needs honest large-repo behavior before public beta.

Deliverables:

- Add scan limits to engine request path.
- Enforce max files seen, parsed files, file bytes, facts, graph nodes, graph edges, diagnostics.
- Emit truncation and completeness metadata.
- Add synthetic large repo generator/test.

Verification:

- Large synthetic test finishes under CI budget.
- Limit breach disables blocking and reports exact reason.

### Sprint 14: Storage Workflows V2

Problem: Storage owns durable invariants but some workflows still stitch state in product code.

Deliverables:

- Add transaction-owned scan completion workflow.
- Add projection rebuild workflow.
- Add integrity/maintenance command surface.
- Harden backup/restore with temp DB validation and atomic swap.

Verification:

- Injected scan failure leaves no completed partial scan.
- Restore validates repo id/schema/checksums before swap.

### Sprint 15: Audit Integrity V2

Problem: Audit needs stronger tamper evidence as the product becomes enterprise-grade.

Deliverables:

- Add monotonic sequence field.
- Add head hash anchoring.
- Add `drift audit verify --strict`.
- Ensure import/export/policy/exception/baseline actions emit events.

Verification:

- Removing or editing an event breaks strict verification.
- Normal governance actions verify cleanly.

### Sprint 16: Policy Egress Hardening V2

Problem: Every outward surface must prove it passed policy.

Deliverables:

- Centralize context authorization for CLI, MCP, export, artifact, logs, and future UI.
- Add denied context metadata to responses.
- Add secret-like string redaction tests.

Verification:

- `.env`, key/cert files, denied globs, and long snippets are blocked on all surfaces.

### Sprint 17: Package Release Matrix

Problem: macOS arm64 local/package path works, but public npm needs platform matrix.

Deliverables:

- GitHub Actions build Rust engine for macOS arm64/x64, Linux x64/arm64, Windows x64.
- Publish platform engine packages from release artifacts.
- Root CLI package depends on optional platform packages.

Verification:

- CI artifact smoke runs engine on each platform.
- Installed CLI finds bundled engine without `DRIFT_ENGINE_BIN`.

### Sprint 18: Installed CLI Beta Smoke

Problem: Public testers need install behavior proven outside the monorepo.

Deliverables:

- Fresh temp consumer project test.
- No `DRIFT_ENGINE_BIN` required.
- Offline-ish package install smoke where feasible.
- Wrong-platform/missing/corrupt binary failures are clear and fail closed.

Verification:

- `pnpm pack` plus consumer smoke passes.
- Missing engine binary disables blocking checks and reports exact remediation.

### Sprint 19: First-Run UX V2

Problem: `drift start` must be five-year-old simple without hiding governance truth.

Deliverables:

- One command registers repo, scans, shows candidates, explains contract readiness, and prints next commands.
- No dead-end states.
- Human output stays short; JSON stays complete.

Verification:

- Fresh repo e2e covers start -> candidate review -> prepare -> check.

### Sprint 20: Convention Review UX V2

Problem: Candidate approval must feel clean and safe.

Deliverables:

- Add review queue summaries.
- Add grouped evidence display.
- Add safer edit/exception previews.
- Add dry-run for accept/edit/exception commands.

Verification:

- CLI tests cover accept/reject/edit/exception previews and audit events.

### Sprint 21: Prepare Packet Quality V2

Problem: `drift prepare` should become the killer agent preflight surface.

Deliverables:

- Task text maps to conventions, graph nodes, risk areas, findings, checks, freshness, and relevant files.
- Packet is compact and bounded.
- Packet tells an agent what not to touch when evidence is incomplete.

Verification:

- Dogfood task packets are materially useful and stable.

### Sprint 22: Check Quality V2

Problem: `drift check` must become trustworthy in local and CI use.

Deliverables:

- Better changed-hunks + affected-symbol scope.
- Clear block/warn/brief outcomes.
- Stable SARIF-like optional output can be considered only after JSON stability.

Verification:

- Legacy baseline fixture blocks only new deterministic drift.
- Touched-existing status is visible but not over-blocking.

### Sprint 23: Adapter SDK V1

Problem: New languages need a host/adapter protocol before Python.

Deliverables:

- Adapter manifest schema.
- Capability negotiation types.
- Adapter output batch schema.
- Conformance harness with negative adapter fixtures.
- Version/invalidation hooks.

Verification:

- Invalid adapter outputs are rejected.
- Overclaimed capabilities are reported and cannot block.

### Sprint 24: Python Adapter Spike

Problem: Python should validate the adapter boundary, not fork the product.

Deliverables:

- Python files/imports/functions/classes/facts.
- Local module resolution.
- Basic package detection from `pyproject.toml`/`requirements.txt`.
- One Python direct-data-access-style rule only if deterministic.

Verification:

- Python adapter emits FactGraph-compatible data through the same storage/query paths.

### Sprint 25: Beta Readiness And Dogfood Freeze

Problem: Before beta, Drift needs honest docs, smoke evidence, and no weak claims.

Deliverables:

- Fresh Drift-on-Drift transcript.
- Beta readiness checklist.
- README install/use flow.
- Known limitations doc.
- Release smoke results.

Verification:

- `pnpm verify:ci`.
- Fresh installed CLI smoke.
- Dogfood transcript captures real output and known gaps.

## Overnight Execution Strategy

Run the plan in dependency order. If a sprint uncovers a blocker, fix the blocker if it is local and bounded. Stop only for external blockers such as missing credentials, unavailable CI secrets, or a design contradiction that would violate the R&D documents.

First overnight implementation batch:

1. Sprint 1: Symbol Resolution V1.
2. Sprint 2: Symbol Neighborhood Query.
3. Sprint 3: Route-To-Service Flow Enforcement.
4. Sprint 4: Engine-Owned Candidate Inference V2.
5. Sprint 5: Incremental Scan Execution V1.

Do not start Sprint 24 before Sprint 23 is complete. Do not start UI/cloud/OCR work in this roadmap.

## Required Verification Cadence

After each completed sprint:

- Run the narrow test that proved the behavior red/green.
- Run the owning package test.
- Run `cargo test -p drift-engine` when Rust changed.
- Run `pnpm verify:ci` before final completion or push.

Final completion requires:

```bash
pnpm verify:ci
git status -sb
```

## Initial Execution Checklist

- [ ] Sprint 1 red test: add Rust stream fixture for import-to-exported-symbol resolution.
- [ ] Sprint 1 implementation: emit `IMPORT_RESOLVES_TO_SYMBOL`.
- [ ] Sprint 1 schema: allow the edge kind in `@drift/factgraph`.
- [ ] Sprint 1 query compatibility: ensure stored projections accept the edge kind.
- [ ] Sprint 1 verification: Rust engine test and affected package tests pass.
- [ ] Sprint 2 red test: add query symbol-neighborhood fixture using `IMPORT_RESOLVES_TO_SYMBOL`.
- [ ] Sprint 2 implementation: make symbol neighborhood semantically useful.
- [ ] Sprint 3 red tests: direct route-to-db vs route-to-service-to-db enforcement.
- [ ] Sprint 3 implementation: add engine-owned service delegation rule.
- [ ] Sprint 4 red tests: graph-backed candidate inference with counterexamples.
- [ ] Sprint 4 implementation: prefer graph evidence over raw facts.
- [ ] Sprint 5 red tests: unchanged-file reuse and resolver invalidation.
- [ ] Sprint 5 implementation: persist/reuse safe unchanged graph projections.

