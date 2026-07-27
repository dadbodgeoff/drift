# Incremental Scan And Invalidation

Date: 2026-05-21

## Purpose

Drift should rescan only what it needs, but it must never serve stale graph intelligence as fresh.

The invalidation model decides when file facts, graph projections, findings, baselines, and preflight context are still trustworthy.

## Inputs That Invalidate Scan State

| Input | Invalidates |
| --- | --- |
| file content hash change | file facts, dependent graph edges, findings for that file |
| file added/deleted/renamed | file snapshot, graph nodes/edges, repo map |
| branch change | freshness status |
| commit change | scan manifest freshness metadata |
| dirty state change | scan manifest freshness metadata |
| adapter version change | facts and graph nodes emitted by that adapter |
| rule engine version change | check results and findings |
| graph schema version change | graph artifact/projection |
| policy change | outward context responses, not raw facts |
| accepted convention change | required checks/findings for that convention |
| baseline change | finding status classification |
| tsconfig/jsconfig path alias change | import resolution graph, dependent modules, rule completeness |
| package/workspace manifest change | package graph, external/internal import classification |
| package exports change | import resolution graph |
| barrel/re-export file change | reverse import resolution and dependent symbol links |
| generated API/schema/doc artifact change | API/document adapter facts and dependent graph edges |

## Scan State Records

Extend scan state around these concepts:

```ts
type ScanInvalidationState = {
  repo_id: string;
  latest_scan_id?: string;
  latest_graph_id?: string;
  source_change_count: number;
  changed_files: string[];
  deleted_files: string[];
  added_files: string[];
  adapter_invalidations: string[];
  rule_invalidations: string[];
  graph_schema_invalid: boolean;
  status: "fresh" | "stale" | "missing" | "truncated";
};
```

## Incremental Queue

V1 can start with a simple changed-file queue:

```text
compare latest file_snapshots to current repo files
-> enqueue added/modified/deleted paths
-> re-extract facts for changed paths
-> remove graph nodes/edges for deleted paths
-> rebuild affected projections
```

The first implementation may still rebuild the full graph projection after changed-file extraction. That is acceptable if the state model already distinguishes changed files.

## Resolver Invalidation

Import resolution has wider blast radius than single-file parsing.

Changes to these files should invalidate resolver output for affected packages or the whole repo:

- `tsconfig.json`
- `jsconfig.json`
- package-level `tsconfig*.json`
- `package.json`
- workspace manifests
- files that serve as package entrypoints
- `index.ts`, `index.tsx`, `index.js`, `index.jsx`
- barrel/re-export files
- OpenAPI/GraphQL/protobuf schema files when endpoint/schema adapters exist

The resolver should keep enough dependency metadata to answer:

```text
which imports used this alias?
which files imported this module?
which symbols flowed through this re-export?
which package exports were used by this resolved import?
```

Without that reverse index, Drift should rebuild the graph projection instead of pretending a narrow invalidation is safe.

## Reverse Dependency Index

Store a projection that can be rebuilt from graph artifacts:

```text
module_dependents
  repo_id
  scan_id
  module_id
  dependent_module_id
  edge_kind

resolver_dependencies
  repo_id
  scan_id
  source_file_id
  config_file_id
  dependency_kind
```

This index is not the source of truth. It is a performance and invalidation aid.

## Adapter Invalidation

Every fact and graph node should record:

- adapter id
- adapter version
- capability set
- graph schema version

If an adapter version changes, facts emitted by that adapter are stale until rescanned.

## Rule Invalidation

Every finding should record:

- rule id
- rule version
- rule engine version
- graph id or scan id used

If a deterministic rule changes, Drift should mark existing findings as needing recomputation. It should not silently reuse old finding classifications as fresh.

## Graph Projection Invalidation

Graph artifacts and projections need separate freshness:

- graph artifact can exist
- graph projection can be missing/stale
- scan facts can be fresh while graph schema is stale

This matters during migrations. A storage migration may require projection rebuild without reparsing every source file.

## Freshness In User Surfaces

Every agent-facing query should include:

```ts
type FreshnessMetadata = {
  status: "fresh" | "stale" | "missing" | "truncated";
  source_change_count: number;
  invalidation_reasons: string[];
  require_fresh: boolean;
  next_scan_command?: string;
};
```

If `require_fresh=true`, stale context must fail closed.

## Partial Scans

Partial scans are allowed only if they are explicit.

Required fields:

- `truncated=true`
- truncation reason
- affected limits
- diagnostics count
- whether blocking checks are disabled or degraded

Blocking deterministic checks should not use incomplete graph facts unless the rule can prove the required evidence is complete for the diff scope.

## Acceptance Criteria

- `scan status` reports source, adapter, rule, and graph invalidation reasons.
- `prepare --require-fresh` and MCP `require_fresh` fail closed on stale/missing/truncated graph state.
- Changed-file queues are persisted or derivable from snapshots.
- Resolver invalidation handles path aliases, workspace packages, package exports, and re-exports.
- Reverse dependency projection exists before incremental resolver claims are made.
- Adapter/rule version changes mark affected results stale.
- Projection rebuild can happen independently of source reparsing when possible.
