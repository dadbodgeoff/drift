# TypeScript Code Intelligence Map

Date: 2026-05-24
Scope: current implemented Drift V3 TS/JS intelligence, verified from code, tests, CLI/MCP output, and live dogfood scan.

Support labels:

- `implemented`: code exists, storage/exposure exists where applicable, and tests or live commands proved it.
- `partial`: real code exists, but confidence, coverage, storage, exposure, or tests are incomplete for production-grade claims.
- `documented-only`: docs/specs mention it, but current code/tests do not prove it as a working surface.
- `missing`: not implemented in the current repo.

## Capability Matrix

| Item | Support | Implementation source | Storage | CLI/MCP exposure | Proof | Production gaps |
| --- | --- | --- | --- | --- | --- | --- |
| Files and snapshots | implemented | Rust file discovery, unchanged-file fact reuse, and scan output in `crates/drift-engine/src/main.rs`; scan persistence in `packages/cli/src/domain/scan-status.ts` | `file_snapshots` in `packages/storage/src/migrations.ts`; `scan_file_changes` in `packages/storage/src/migrations.ts` | `scan`, `scan status`, `repo map`; MCP `get_scan_status`, `get_repo_map` | `pnpm verify:ci`; dogfood scan indexed 163 files | Incremental reuse is limited to unchanged file facts; graph projections are rebuilt per scan |
| File roles | implemented | Path-based role facts in `crates/drift-engine/src/facts.rs:531`; role node/edge graphing in `crates/drift-engine/src/main.rs:670` | persisted as `facts`, `graph_nodes`, `graph_edges` | `repo map`; MCP `get_repo_map`; `prepare` relevant files | Rust facts tests, stream graph tests, CLI/query/MCP tests | Role ontology is path-driven and not user-configurable enough for arbitrary repos |
| Imports | implemented | Import extraction in `crates/drift-engine/src/facts.rs:115`; import binding parser in `crates/drift-engine/src/facts.rs:258` | `facts`; graph import nodes/edges/projections | `repo map`, `prepare`; MCP equivalents | stream graph tests for aliases, package imports, jsconfig/tsconfig, index files | Type-only imports intentionally skipped; dynamic import/require not fully covered |
| Resolved imports | partial | Resolver context and `resolve_import` use in `crates/drift-engine/src/main.rs:115` and `crates/drift-engine/src/main.rs:703` | `resolver_dependencies`, `module_dependents`, graph edges | route flow, affected files, repo map, prepare; MCP equivalents | `stream_graph` 15 tests passed; dogfood parser gaps surfaced | Live dogfood had 33 unresolved symbols; completeness can degrade |
| Exports | implemented | Export extraction in `crates/drift-engine/src/facts.rs:175`; default export handling in `crates/drift-engine/src/facts.rs:241` | `facts`, export graph nodes/edges | repo map; symbol neighborhood/read-model paths | `typescript_facts`, `stream_graph` | Full TS export forms and type-only export semantics are not semantic |
| Symbols | partial | `ExportedSymbol`, `SymbolCalled`, graph symbol/call nodes, `symbol_identities` table | `symbol_occurrences`, `symbol_identities` in `packages/storage/src/migrations.ts:355` and `packages/storage/src/migrations.ts:568` | query symbol neighborhood; contract show/internal surfaces | query tests and contract parity proof | `changed_symbols` is always empty in `packages/query/src/change-impact.ts:40`; no full TS type graph |
| Callsites | implemented | Call extraction in `crates/drift-engine/src/facts.rs:137`; member call parsing in `crates/drift-engine/src/facts.rs:406` | `facts`, callsite graph nodes/edges | repo map call counts; query symbol neighborhood | Rust facts and stream graph tests; dogfood repo map had call counts | Computed calls, chained semantics, and alias binding precision are limited |
| Route/entrypoint facts | partial | Next route/path detection in `crates/drift-engine/src/facts.rs:218` and `crates/drift-engine/src/facts.rs:575`; route graph nodes/endpoint shape in engine | `facts`, graph route nodes/edges | route flows in `prepare`/query/MCP; contract checks | fixture matrix and stream graph endpoint tests | Primarily Next-style route coverage; other frameworks are not production supported |
| Data operations | partial | DB-like receiver/path detection in `crates/drift-engine/src/facts.rs:422`; data operation kinds in `crates/drift-engine/src/facts.rs:462` | `facts`, data-operation graph nodes/edges | route flow, data-access risk, prepare, repo map | beta proof good/bad route; route flow tests | Name/path heuristic; no type-based ORM/client semantics |
| Graph nodes and edges | implemented | Graph batch construction in `crates/drift-engine/src/main.rs:543`; graph schema in `packages/factgraph/src/index.ts` | `fact_graph_artifacts`, `graph_nodes`, `graph_edges`, `graph_evidence`, `graph_diagnostics`, `graph_completeness` | query read models; CLI repo map/prepare/check; MCP read-only tools | `pnpm verify:ci`, query/storage tests, dogfood graph-backed prepare | Completeness and parser gaps must be treated as confidence gates |
| Parser gaps | implemented | Engine diagnostics and parser gap persistence in `packages/cli/src/domain/scan-status.ts`; migration `015_parser_gaps` in `packages/storage/src/migrations.ts:540` | `parser_gaps` | `scan status`, `prepare`, MCP `get_scan_status` | dogfood scan showed 45 parser gaps; CLI tests cover parser gap summary | Confidence is coarse; not every read model uses gaps with the same strictness |
| Role ontology | partial | Role types in `packages/core/src/domain.ts`; path role extraction in Rust | facts and graph roles; contracts can encode role rules | repo map, prepare, contract surfaces | CLI/core/MCP tests | Drift-specific package roles are hard-coded path heuristics |
| Layer architecture | partial | Query layer proof in `packages/query/src/layer-architecture.ts`; agent contracts in `packages/core/src/agent-contracts.ts` | derived and contract-backed; findings/check runs when enforced | prepare/check/contract/MCP | contract parity/beta proof | Broader architecture understanding requires accepted contracts and better role evidence |
| Route/service/data-access flows | partial | route-flow query in `packages/query/src/index.ts:344`; engine service/data graph edges | graph projections | prepare graph context, repo map, MCP `get_task_preflight` | e2e fixture matrix; stream graph service-boundary tests | Dogfood preflight had 0 route flows and parser gaps; flow confidence drops on unresolved imports |
| Change impact | partial | `packages/query/src/change-impact.ts` | derived, not persisted as its own table | prepare agent preflight packet; MCP equivalent | query tests | `changed_symbols` is empty; affected tests/routes are heuristic |
| Test relevance | partial | `packages/query/src/test-intelligence.ts` | derived | prepare packet; MCP equivalent | query/CLI tests | path/slug heuristic, not coverage-aware |
| Required checks | implemented | required check contracts and execution storage in core/CLI; migration `013_required_check_executions` | `required_check_executions` | `checks list`, `checks run`, prepare, MCP `get_required_check_executions` | beta proof verified required check execution proof | External command trust is local-process proof, not CI integration |
| Context policy | implemented | capabilities and context policy in `packages/core`; CLI policy commands; allowed-context MCP tool | repo policy/contract context in SQLite | `policy show`, `policy check-context`, `prepare`, MCP `get_allowed_context` | CLI/MCP tests and beta proof parity | Policy is local metadata; no cloud or org policy enforcement |
| Conventions/elections/contracts | implemented | candidates in Rust candidate command; accept/import/contract materialization in CLI/core/storage | `convention_candidates`, `accepted_conventions`, `repo_contracts` | CLI conventions/contract commands; MCP get_conventions/get_repo_contract | beta proof accepted a deterministic convention and checked it | Candidate inference is narrow; Drift-on-Drift generated 0 candidates |
| Findings | implemented for accepted contracts | engine/CLI check flow in `packages/cli/src/check/run-check.ts` | `findings`, `check_runs` | `findings list/show`, `check`; MCP `get_findings` | beta proof bad route blocked with evidence | No-contract dogfood findings refuse; broad finding categories are not implemented |
| Waivers | implemented | contract waiver commands and schemas | repo contract/waiver storage | CLI contract waiver commands; check honors waivers; MCP reads contract/finding state | CLI tests | Waiver UX is CLI-only; no approval workflow beyond local confirmation |
| Baselines | implemented | baseline CLI/domain | `baseline_violations` | CLI baseline status/create/clear; check uses baselines | CLI tests | MCP does not expose baseline as a first-class tool |
| Audit | implemented | audit append/verify in storage and CLI | `audit_events`, audit sequence/hash fields, object hashes | `audit list`, `audit verify`, MCP `get_audit_status` | dogfood strict audit valid; beta proof audit verified | Audit is local SQLite chain, not remote notarization |
| Proof | implemented for beta fixture | `scripts/run-beta-proof.mjs`; release proof script | proof artifact JSON, not persisted as core DB row | `pnpm beta:proof`, `pnpm release:proof` | `pnpm verify:ci` ran beta proof successfully | Fixture proof is not broad production proof |

## Layer Architecture

Current layers are real but pragmatic:

1. Rust engine extracts TS/JS facts and graph batches.
2. `@drift/engine-contract` validates Rust/TS boundary shapes.
3. CLI engine bridge collects scan data and blocks silent fallback.
4. Storage persists facts, graph, contracts, findings, checks, audit, and proof-related state.
5. `@drift/query` builds read models: repo map, route flow, topology, affected files, findings evidence, completeness.
6. CLI exposes local workflow commands and human-confirmed mutations.
7. MCP exposes read-only agent surfaces.

Boundary guard evidence:

- `packages/cli/scripts/check-boundaries.mjs:107` rejects raw SQLite outside storage.
- `packages/cli/scripts/check-boundaries.mjs:131` rejects MCP importing CLI.
- `packages/cli/scripts/check-boundaries.mjs:135` rejects mutation-like MCP tools.
- `packages/cli/scripts/check-boundaries.mjs:157` rejects import cycles.

## Route/Service/Data-Access Flow

Current flow support:

```text
file discovery
-> role fact: api_route/service_module/data_access_module
-> import facts
-> resolved import graph edges
-> route/service/data-access graph projection
-> query route flow
-> prepare/check/finding evidence
```

Support level: `partial`.

Why partial: beta proof proves the direct-data-access route wedge. It does not prove arbitrary framework routes or complete service/data-flow semantics. Dogfood on Drift itself produced no route flows for the audited `prepare.ts` path and had parser gaps.

## Change Impact

Support level: `partial`.

Implemented source:

- `packages/query/src/change-impact.ts:18` filters changed files against route/service/data flows.
- `packages/query/src/change-impact.ts:40` returns `changed_symbols: []`.
- `packages/query/src/index.ts:424` uses resolver dependencies or graph edge neighborhoods for affected files.

Exposure:

- CLI `prepare`.
- MCP `get_task_preflight`.

Gap to production:

- Populate changed symbols from persisted symbol identities.
- Separate direct importers from transitive dependents.
- Add confidence and parser-gap reasons to every affected path.
- Prove on a fixture matrix with changed service, changed data access, changed route, and changed shared helper.

## Test Relevance

Support level: `partial`.

Implemented source:

- `packages/query/src/test-intelligence.ts` derives relevant tests from path/slug matching.
- `prepare` surfaces required checks and safe commands.

Gaps:

- No test coverage graph.
- No package test-target inference beyond scripts/safe commands.
- No historical pass/fail or CI integration.

## Context Policy

Support level: `implemented`.

Source:

- Capability and governance surfaces in `packages/core/src/capabilities.ts:41`.
- MCP allowed-context tool schema in `packages/mcp/src/tools.ts:177`.
- CLI policy and prepare context surfaces in `packages/cli/src/commands/policy.ts` and `packages/cli/src/commands/prepare.ts`.

Verified:

- Beta proof parity includes allowed context.
- Dogfood MCP `get_scan_status` and CLI/MCP preflight returned local-only, read-only metadata.

Gap:

- No org/cloud policy manager.
- No first-class UI.

## Contract and Enforcement Flow

Support level: `implemented` for narrow wedge, `partial` for broad agent-contract intelligence.

Implemented source:

- Runtime capabilities support TypeScript/JavaScript, deterministic `api_route_no_direct_data_access`, heuristic `api_route_requires_service_delegation`, SQLite, no source mutation in `packages/core/src/capabilities.ts:97`.
- Only human-confirmed CLI commands mutate conventions/contracts/policy in `packages/core/src/capabilities.ts:73`.
- `runCheck` blocks TypeScript fallback and persists check/finding evidence in `packages/cli/src/check/run-check.ts:78`.

Verified:

- `pnpm beta:proof` generated a good-route pass and bad-route block.
- CLI tests cover convention acceptance, baselines, waivers, findings, checks, policy, prepare, repo map, required checks, and support flows.

Production gaps:

- Dogfood has no accepted contract and no findings/check proof against Drift itself.
- Heuristic convention kinds must not block until upgraded and proven.
- Broad contract kinds require durable fixture directories and missing-evidence tests.

## Current Parser Gaps and Confidence Impact

Live dogfood scan:

```json
{
  "total_count": 45,
  "by_kind": {
    "unresolved_symbol": 33,
    "unsupported_framework_pattern": 12
  },
  "confidence_impact": {
    "lowers_flow": 33,
    "none": 12
  }
}
```

Impact:

- Route/service/data-access flow claims should be qualified when parser gaps exist.
- Change impact should be treated as advisory where resolver dependencies or symbols are missing.
- Checks should only block where capability completeness allows it.

## What Drift Can Define Today From a TS/JS Repo

Implemented:

- Indexed TS/JS files and content hashes.
- File snapshots and scan manifests.
- File roles from path heuristics.
- Static value imports and re-exports.
- Static exported function/class/default symbols.
- Identifier/member callsites.
- DB-shaped data operations.
- API route declarations for supported Next patterns.
- Graph nodes/edges/evidence/diagnostics/completeness.
- Parser gaps.
- Repo topology from files/roles/imports/tests.
- Convention candidates for the route-layering wedge.
- Accepted conventions and repo contracts.
- Findings, baselines, waivers, audit events, required checks.

Partial:

- Resolved imports across all TS/JS module shapes.
- Symbol identity as a complete user-facing graph.
- Route/service/data-access flow outside common patterns.
- Change impact and test relevance.
- Confidence gating across every CLI/MCP surface.

Missing:

- Full TypeScript semantic type graph.
- Broad dynamic execution or dataflow analysis.
- Non-TS language intelligence.
- Cloud sync or desktop UI.
- Incremental reuse.
