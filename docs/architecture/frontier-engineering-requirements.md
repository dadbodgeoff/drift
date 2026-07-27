# Frontier Engineering Requirements

Date: 2026-05-22

## Purpose

This document captures the second architecture review round: the requirements Drift must meet to become a frontier-grade local-first coding-agent tool, not just a useful repo scanner.

The core conclusion is direct:

```text
Drift has a credible product shell.
Drift does not yet have a frontier-grade intelligence substrate.
```

The next work must harden the engine, graph, storage, rule system, and agent contracts before expanding languages or UI.

## Non-Negotiable Architecture Decisions

### 1. Rust Owns Deterministic Truth

Rust must own:

- file walking
- ignore rules
- canonical path/root containment
- symlink and special-file handling
- hashing
- syntax extraction
- import/symbol resolution
- FactGraph construction
- diff classification
- deterministic rule evaluation
- scan/check limits
- diagnostics
- completeness metadata

TypeScript owns:

- CLI command routing
- MCP transport
- SQLite orchestration
- governance status overlays
- audit, backup, restore
- policy-gated output filtering
- human-readable rendering

TypeScript must not independently decide whether a deterministic violation exists once engine-owned checks are active.

### 2. No Silent Fallback

Silent Rust-to-TypeScript fallback is incompatible with Drift's trust model.

Allowed:

- explicit compatibility fallback
- test-only parity mode
- fallback for non-blocking diagnostics when clearly marked

Required in every fallback result:

- fallback reason
- engine error code
- unavailable capabilities
- whether enforcement was degraded
- whether blocking was disabled

Default deterministic enforcement must fail closed if the engine cannot provide required capabilities.

### 3. Streaming Engine Boundary

The engine cannot emit one giant JSON blob.

Required engine protocol:

```text
scan_started
file_snapshot_batch
fact_batch
graph_node_batch
graph_edge_batch
graph_evidence_batch
diagnostic_batch
stats_delta
scan_completed
```

The host must validate and persist batches incrementally. The final scan is complete only after all expected batches are committed and the scan manifest is marked completed.

### 4. SQLite Projections Are The Query Source

Drift uses Option B:

```text
normalized SQLite graph projections are the product query path
immutable graph artifacts are replay/debug/export records
```

CLI, MCP, and future UI must not query giant graph JSON directly.

### 5. Storage Owns Durable Invariants

`@drift/storage` should not be thin CRUD.

It must own:

- schema compatibility validation
- prefix migration validation
- migration backup policy
- transaction boundaries for multi-row workflows
- atomic scan completion
- atomic graph projection writes
- audit append integrity
- backup creation
- restore validation and atomic swap
- integrity checks
- maintenance/checkpoint behavior

Product commands call storage workflows. They should not manually stitch durable state transitions across many independent writes.

### 6. Agent Outputs Need A Shared Envelope

Every agent-facing CLI JSON and MCP response must expose:

- `schema_version`
- `repo_id`
- `surface`
- `action`
- `freshness`
- `policy`
- `diagnostics`
- `truncated`
- `payload`
- `next_commands`

Failures in JSON mode must still return machine-readable JSON, not prose on stderr only.

### 7. Conventions Need A Real Rule Contract

`ConventionMatcher` cannot stay as a few arrays forever.

Frontier-grade conventions need:

- `rule_id`
- `rule_version`
- `matcher_schema_version`
- `matcher_fingerprint`
- selectors over graph nodes/edges/evidence
- required capabilities
- required evidence classes
- completeness behavior
- deterministic bounded evaluation
- line/span/graph evidence requirements
- versioned candidate/convention lineage

Natural-language statements remain display text over structured rules.

## Required Package And Service Boundaries

Target package map:

```text
crates/
  drift-engine/
    Rust engine host: scan, graph, check, resolver, deterministic rules.

  drift-adapter-typescript/
    Built-in deterministic TypeScript/JavaScript adapter.

  drift-adapter-python/
    First non-TS adapter after graph/engine contracts are stable.

  drift-adapter-openapi/
  drift-adapter-graphql/
  drift-adapter-docs-ocr/
    Later adapters, all behind the same protocol.

packages/
  core/
    Domain schemas, policy types, IDs, fingerprints, compatibility constants.

  engine-contract/
    Versioned engine request/result JSON Schemas, generated TS validators.

  factgraph/
    Graph schema, stable IDs, evidence model, traversal/query contracts.

  adapters/
    Adapter SDK protocol, manifests, capability certification, conformance metadata.

  storage/
    SQLite migrations, durable repositories, graph projections, backup/restore.

  query/
    Shared query/preflight/repo-map/finding builders for CLI, MCP, and UI.

  cli/
    Command routing, flags, output formatting, user workflow.

  mcp/
    Read-only MCP transport over query package.

  telemetry/
    Local diagnostics, performance metrics, support bundles, no source leakage.

  fixtures/
    Golden fixture harness and synthetic large-repo generator.
```

Rules:

- `core` imports no product/runtime package.
- `storage` imports `core`, not CLI/MCP/engine transport.
- `query` imports `core` and storage interfaces.
- `cli` and `mcp` depend on query, not duplicate query logic.
- formatters are text-only.
- command modules do not import other command modules.
- engine/check logic does not import command modules.
- new languages are adapters, not product forks.

## Engine And Performance Requirements

### Scan Limits

Every scan request must carry limits:

```ts
type ScanLimits = {
  max_files_seen: number;
  max_files_parsed: number;
  max_file_bytes: number;
  max_facts: number;
  max_graph_nodes: number;
  max_graph_edges: number;
  max_diagnostics: number;
  max_duration_ms?: number;
  follow_symlinks: false;
};
```

Every scan result must report:

- files seen/skipped/parsed
- bytes read
- skipped categories
- facts emitted
- graph nodes/edges emitted
- diagnostics emitted
- duration
- peak RSS where measurable
- batch count
- spill artifacts
- truncation reason
- whether deterministic blocking is allowed

### Read Safety

The engine must skip before reading:

- files above max size
- binary files
- secret-like files
- symlinks by default
- sockets
- FIFOs
- devices
- unreadable files
- invalid encoded paths
- generated/vendor/build outputs

Each skip category produces counts and bounded diagnostics.

### Query Performance

These commands must be bounded:

- `drift repo map --limit N`
- `drift prepare --path X`
- `drift ask --path X`
- `drift scan status`
- MCP equivalents

They should not materialize all facts, findings, graph nodes, or repo files before filtering.

## Graph Requirements

Minimum tables:

```text
graph_artifacts
graph_nodes
graph_edges
graph_evidence
graph_diagnostics
graph_completeness
symbol_occurrences
resolver_dependencies
module_dependents
```

Required node primitives:

- `file`
- `file_version`
- `module`
- `package`
- `workspace`
- `external_package`
- `symbol`
- `symbol_declaration`
- `symbol_occurrence`
- `import_decl`
- `export_decl`
- `callsite`
- `route`
- `endpoint`
- `data_store`
- `data_operation`
- `config_file`
- `path_alias`
- `diagnostic`
- `document`
- `page`
- `text_block`
- `table`
- `image_region`

Required edge primitives:

- `FILE_HAS_VERSION`
- `FILE_DEFINES_MODULE`
- `FILE_CONTAINS_SYMBOL`
- `MODULE_IMPORTS_MODULE`
- `IMPORT_DECL_BINDS_SYMBOL`
- `IMPORT_RESOLVES_TO_MODULE`
- `IMPORT_RESOLVES_TO_SYMBOL`
- `EXPORT_REEXPORTS_SYMBOL`
- `SYMBOL_ALIASES_SYMBOL`
- `CALLSITE_RESOLVES_TO_SYMBOL`
- `SYMBOL_CALLS_SYMBOL`
- `ROUTE_HANDLED_BY_SYMBOL`
- `DATA_OPERATION_READS_DATA_STORE`
- `DATA_OPERATION_WRITES_DATA_STORE`
- `RESOLUTION_USED_CONFIG`
- `OCCURRENCE_HAS_EVIDENCE`
- `EDGE_HAS_EVIDENCE`

Evidence must attach to edges, not only nodes and findings.

Every resolver decision must record:

- source import
- resolved module or unresolved diagnostic
- config files consulted
- package manifest consulted
- condition set
- alias mapping
- re-export chain when relevant

## Import And Symbol Resolution Requirements

The TypeScript/JavaScript resolver must handle:

- relative imports
- extension substitution
- index files
- `tsconfig` and `jsconfig` paths
- `baseUrl`
- package workspaces
- package `exports`
- package `imports`
- common Node16/NodeNext/Bundler modes
- barrel re-exports
- named/default/namespace imports
- type-only imports
- unresolved import diagnostics

Resolution must be static. It must not execute repo code, bundler config, package scripts, compiler plugins, or network calls.

## Rule And Convention Requirements

### Candidate Fields

Candidates need:

- `candidate_id`
- `candidate_version`
- `rule_id`
- `rule_version`
- `matcher_schema_version`
- `matcher_fingerprint`
- `scope_fingerprint`
- `derived_from_scan_ids`
- `graph_fingerprint`
- `required_capabilities`
- `completeness`
- `evidence_refs`
- `counterexample_refs`
- `supersedes_candidate_id`
- `created_at`
- `updated_at`
- `expires_at`

### Accepted Convention Fields

Accepted conventions need:

- stable `convention_id`
- incrementing `convention_version`
- accepted candidate lineage
- accepted matcher fingerprint
- accepted rule version
- enforcement capability
- enforcement mode
- owner/actor
- exceptions
- expiry/review date where relevant

### Rejections

Rejections must become first-class memory:

- rejected candidate id
- matcher fingerprint
- scope fingerprint
- reason
- actor
- timestamp
- expires/review date

This prevents the same bad candidate from being proposed repeatedly.

### Waivers And Exceptions

Convention exceptions:

- rule-scoped
- path/symbol/import predicates
- rationale
- owner
- expiry/review date

Contract waivers:

- governance override
- convention id or rule id
- optional finding fingerprint
- rationale
- owner
- expiry/review date
- audit event

Do not collapse exceptions, waivers, false positives, and accepted drift into the same behavior.

## Finding And Baseline Requirements

Findings should separate:

```text
engine rule truth
governance overlay
diff classification
baseline classification
waiver/exception application
```

Engine emits:

- detected/not detected
- evidence
- diff status
- baseline match hint
- completeness
- enforcement result

TypeScript/storage overlays:

- suppressed
- false positive
- accepted drift
- needs review
- fixed

Baselines must:

- be created from a real scan/check at a commit/range
- not just copy whatever findings happen to be stored
- auto-resolve when a fresh check proves the fingerprint is gone
- preserve evidence for why an old issue did not block

## Storage Requirements

### SQL Hardening

Add SQL-level constraints where possible:

- enum `CHECK`s
- `json_valid(...)` checks
- non-null hash columns after migration
- unique graph IDs per repo/scan
- monotonic audit sequence
- foreign keys for evidence/graph/finding relationships

### Durability Settings

Storage open should explicitly configure and report:

- WAL mode
- `foreign_keys=ON`
- `busy_timeout`
- `synchronous` mode
- `application_id`
- `user_version`
- checkpoint policy

### Backup

Backup must use a SQLite-safe mechanism:

- SQLite Online Backup API or `VACUUM INTO`
- write to temp file
- verify checksum
- run integrity checks
- fsync/rename where available
- write manifest and completed audit event after artifact verification

Do not claim `backup_created` before a usable backup exists.

### Restore

Restore must:

- validate backup before writing target
- restore into temp database
- run migrations/integrity checks
- validate repo fingerprint or require explicit override
- preserve previous target until final atomic swap
- mark graph stale when source differs
- emit audit events

Failed restore must leave previous state usable.

### Audit

Audit needs:

- per-repo monotonic sequence
- non-null event hashes
- previous hash chain
- head hash anchor outside mutable rows, such as backup manifest or sidecar
- tamper detection for modification and tail deletion
- bounded decision metadata with redaction

Audit is decision evidence, not debug logging.

## Agent Interface Requirements

### Success Envelope

```json
{
  "schema_version": "agent.response.v1",
  "repo_id": "repo_abc",
  "surface": "cli-preflight",
  "action": "run_required_checks",
  "freshness": {
    "status": "fresh",
    "source_change_count": 0,
    "invalidation_reasons": []
  },
  "policy": {
    "allowed": true,
    "decision_id": "ctx_abc",
    "denied_paths": [],
    "redactions": []
  },
  "truncated": false,
  "diagnostics": [],
  "payload": {},
  "next_commands": []
}
```

### Refusal Envelope

```json
{
  "schema_version": "agent.refusal.v1",
  "repo_id": "repo_abc",
  "surface": "mcp",
  "action": "blocked_by_stale_graph",
  "refusal": {
    "code": "stale_graph",
    "message": "Scan context is stale.",
    "recovery_commands": ["drift scan --repo-root . --json"]
  }
}
```

CLI `--json` must return JSON refusals on stdout. MCP must return structured tool results for business failures, not protocol errors.

### Action Taxonomy

- `safe_to_edit`
- `run_scan_first`
- `blocked_by_policy`
- `blocked_by_stale_graph`
- `blocked_by_open_findings`
- `needs_human_governance`
- `unsupported_repo`
- `context_truncated`
- `run_required_checks`

Agents should never need to infer these from prose.

### MCP Requirements

MCP tools should expose:

- input schema
- output schema
- structured content
- `readOnlyHint`
- bounded diagnostics
- typed refusal payloads
- same response schema as CLI

MCP remains read-only in V1.

## Enterprise Infrastructure Requirements

### Local Observability

Add a local diagnostics layer:

- scan timings
- query timings
- engine timings
- storage timings
- skipped file counts
- truncation reasons
- adapter failures
- policy denials
- MCP request summaries
- no source snippets by default

### Support Bundle

Add `drift support bundle` later:

- version info
- OS/runtime info
- migration status
- scan stats
- graph stats
- audit verification summary
- backup health
- redacted diagnostics
- no source code
- no secrets

### Release Gates

Required before public beta:

- boundary checker in `verify:ci`
- fixture matrix
- determinism tests
- migration compatibility tests
- backup/restore atomicity tests
- MCP structured output tests
- JSON refusal tests
- large synthetic repo performance gate
- packed package install smoke
- Rust engine binary resolution smoke
- license/security/contributing/changelog files
- Node/Rust/OS support matrix

## Immediate Engineering Order

The next work should be:

1. Enforce package/import boundaries in CI.
2. Implement engine contract package and generated validators.
3. Replace blob engine output with streaming/framed batches.
4. Move scan completion and batch persistence into storage-owned transactions.
5. Add storage hardening: compatibility validation, indexes, constraints, durable backup/restore.
6. Add FactGraph tables and query service.
7. Add shared agent response/refusal envelope for CLI and MCP.
8. Add MCP structured output and output schemas.
9. Add fixture/determinism/scale gates.
10. Move deterministic checks fully into Rust.

Only after that should Drift expand language count, duplicate-helper detection, OCR, or UI.

## Frontier Bar

Drift becomes frontier-grade when an agent can ask:

```text
I am about to change these files for this task.
What conventions apply, what context is allowed,
what graph evidence supports it, what checks must run,
and what would block this diff?
```

And Drift can answer with:

- bounded local computation
- no source leakage
- fresh graph evidence
- deterministic rule results
- baseline/waiver-aware enforcement
- typed machine-readable next action
- stable fingerprints
- exact evidence
- explicit incompleteness when it cannot know

That is the product bar.
