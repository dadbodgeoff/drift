# Engine Roadmap Sprints

Date: 2026-05-22

## Executive Direction

Drift has the local-first product shell. The next phase is the intelligence substrate.

The stricter frontier-grade requirements are tracked in:

- `docs/architecture/frontier-engineering-requirements.md`

Updated sequence:

```text
enforce package/import boundaries in CI
-> engine API contract
-> streaming engine output
-> storage-owned durable workflows
-> agent response/refusal envelope
-> fixture matrix and determinism gates
-> FactGraph V1 tables and query service
-> import and symbol resolution
-> incremental invalidation and reverse indexes
-> engine-owned checks
-> scale gates
-> dogfood Drift on Drift
```

Do not add broad language support, UI, cloud sync, OCR, or duplicate-helper detection before this foundation is in place.

## Sprint 1: Boundary Enforcement

Goal: prevent architecture regressions while the system expands.

Primary docs:

- `docs/superpowers/plans/2026-05-21-cli-monolith-extraction.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- add the boundary checker to `pnpm verify:ci`
- enforce no command-to-command imports
- enforce formatter purity
- enforce no core imports from CLI/MCP/storage
- enforce no storage imports from CLI/MCP/engine
- enforce no MCP duplication of query/business logic beyond transport
- document the current CLI modularization as completed in the inventory

Why first:

The CLI split is already present in the current worktree. The next risk is regression: command, formatter, query, storage, and engine boundaries need CI enforcement before more packages land.

## Sprint 2: Engine API Contract

Goal: make Rust/engine boundaries explicit before moving more authority into the engine.

Primary docs:

- `docs/architecture/engine-api-contract.md`
- `docs/architecture/engine-owned-checks.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- versioned scan request/result schema
- versioned check request/result schema
- JSON Schema or generated Rust/TypeScript validators
- limits, stats, diagnostics, and completeness metadata
- explicit no-silent-fallback behavior
- golden boundary fixtures

Why second:

The CLI should orchestrate and persist. The engine should own deterministic scan/check truth. That boundary needs to be executable, not prose.

## Sprint 3: Streaming Engine Output

Goal: remove blob JSON and whole-repo memory multiplication.

Primary docs:

- `docs/architecture/engine-api-contract.md`
- `docs/architecture/fixture-matrix-and-scale-gates.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- framed or JSONL engine batch protocol
- batch validation in TypeScript
- batch persistence hooks
- engine stats deltas
- per-file diagnostics instead of whole-scan aborts
- packaged engine binary resolution or explicit development fallback

Why third:

Large repos cannot flow through one Rust JSON blob, one Node buffer, one parsed JS object tree, and then SQLite inserts.

## Sprint 4: Storage-Owned Durable Workflows

Goal: make `@drift/storage` own durability and transaction invariants.

Primary docs:

- `docs/architecture/release-compatibility-policy.md`
- `docs/architecture/security-threat-model.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- prefix migration validation in storage
- SQL constraints and hot indexes
- atomic scan completion workflow
- safe backup via SQLite backup API or `VACUUM INTO`
- atomic restore through temp database and swap
- audit monotonic sequence and head-hash anchoring
- storage maintenance/integrity check command surface

Why fourth:

Governance state is the product's memory. If scan, backup, restore, or audit can partially succeed, agent trust collapses.

## Sprint 5: Agent Response And MCP Contract

Goal: make coding agents able to branch on Drift output reliably.

Primary docs:

- `docs/architecture/agent-response-contract.md`
- `docs/architecture/graph-query-api.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- shared success envelope
- shared refusal envelope
- JSON refusals on CLI `--json`
- MCP `structuredContent`
- MCP `outputSchema`
- MCP read-only annotations
- shared query/preflight builders instead of duplicated MCP logic

Why fifth:

Agents should not infer state from prose. Drift must say whether the next action is edit, scan, stop, run checks, or ask a human.

## Sprint 6: Fixture Matrix And Determinism

Goal: stop overfitting to the first Next.js direct-DB fixture.

Primary docs:

- `docs/architecture/fixture-matrix-and-scale-gates.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- fixtures for direct DB, clean service delegation, monorepo alias DB, re-exported DB, legacy baseline, mixed JS/TS, no-TS repo, and large synthetic repo
- golden scan/check/prepare/repo-map/findings outputs
- MCP parity checks where applicable
- fixture normalization utilities for timestamps/temp paths
- determinism tests for graph IDs and finding fingerprints
- repeated-run output equality

Why sixth:

Parser and graph work without diverse fixtures creates false confidence.

## Sprint 7: FactGraph V1 Tables And Query Service

Goal: introduce a stable graph contract that can support many languages and artifact types.

Primary docs:

- `docs/architecture/factgraph-adapter-boundary.md`
- `docs/architecture/graph-query-api.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- graph schema in `packages/factgraph` or equivalent
- `graph_artifacts`
- `graph_nodes`
- `graph_edges`
- `graph_evidence`
- `graph_diagnostics`
- `graph_completeness`
- `symbol_occurrences`
- `resolver_dependencies`
- `module_dependents`
- shared query service for CLI/MCP/future UI

Why seventh:

Drift should become graph-backed before adding more rules or languages.

## Sprint 8: Import And Symbol Resolution

Goal: make TypeScript/Next.js intelligence deeper than path-pattern matching.

Deliverables:

- relative import resolution
- `tsconfig` and `jsconfig` path alias resolution
- package/workspace import resolution
- package `exports` and `imports` handling
- mode-aware Node16/NodeNext/Bundler behavior where practical
- symbol binding through imports and re-exports
- unresolved import diagnostics
- resolver dependency indexes

Acceptance:

- `monorepo-alias-db` fixture resolves package imports
- `re-exported-db-client` emits resolved re-export edges or clear diagnostics
- direct-data-access findings can reference resolved module evidence where available

Why eighth:

Import resolution is the highest-leverage parser improvement for architectural checks.

## Sprint 9: Incremental Invalidation

Goal: make scan, graph, adapter, resolver, and rule freshness explicit.

Primary docs:

- `docs/architecture/incremental-scan-invalidation.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- source change invalidation
- adapter version invalidation
- rule version invalidation
- graph projection invalidation
- changed-file queue model
- resolver invalidation for aliases, workspace manifests, package exports, and re-exports
- reverse dependency projection
- stale/missing/truncated freshness metadata in agent-facing surfaces

Why ninth:

Graph intelligence becomes dangerous if stale results look fresh. Invalidation has to be designed before scan optimizations and deeper graph use.

## Sprint 10: Engine-Owned Checks

Goal: make Rust/engine the source of truth for deterministic checks.

Primary docs:

- `docs/architecture/engine-owned-checks.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- engine check request/result contract implemented
- engine emits direct-data-access findings
- CLI persists engine findings and governance overlays
- parity mode comparing old and engine paths
- stable fingerprints against current fixtures
- old TypeScript duplicate rule authority demoted or removed

Why tenth:

Drift cannot credibly prevent architecture drift if its own rule authority is split.

## Sprint 11: Scale Gates

Goal: make large repo behavior explicit, bounded, and honest.

Primary docs:

- `docs/architecture/fixture-matrix-and-scale-gates.md`
- `docs/architecture/frontier-engineering-requirements.md`

Deliverables:

- scan limits
- skip counts
- truncation diagnostics
- `.gitignore` behavior
- symlink policy
- max file size behavior
- binary/secret-like skip tests
- large synthetic repo CI gate
- peak RSS/wall-time/batch/spill stats where measurable
- bounded query performance tests

Why eleventh:

Enterprise-grade does not mean parsing everything. It means bounded behavior and explicit partial-context reporting.

## Sprint 12: Dogfood Drift On Drift

Goal: prove the product on itself and expose UX/intelligence gaps.

Primary doc:

- `docs/dogfood/drift-on-drift.md`

Deliverables:

- real transcript on current Drift checkout
- command summaries
- useful/missing context notes
- false positive/noise notes
- beta-readiness checklist

Why twelfth:

Dogfood evidence is more convincing than roadmap claims.

## Expansion After These Sprints

Only after these sprints should Drift expand into:

- Python adapter
- Ruby/Rails adapter
- Go adapter
- Java/Kotlin adapter
- OpenAPI/GraphQL adapter
- OCR/document adapter
- semantic duplicate-helper search
- UI graph explorer
- cloud/team sync

Each new adapter should implement the adapter manifest and emit FactGraph-compatible evidence. No adapter should get a special product path.

## Product Bar

The credible milestone:

```text
Drift can understand a TypeScript/Next.js API route well enough to determine whether it directly accesses data, delegates through an approved service layer, or violates a repo contract, with graph-backed evidence and stable findings.
```

That is the next product proof.
