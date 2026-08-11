# Graph Query API

Date: 2026-05-21

## Purpose

CLI, MCP, and future UI surfaces must read graph intelligence through the same query layer.

No product surface should query raw graph tables differently. If they do, Drift will develop inconsistent answers for the same repo.

## Query Layer Ownership

The query layer belongs above storage and below product surfaces.

```text
SQLite graph tables/artifacts
  -> GraphQueryService
  -> CLI commands / MCP tools / future UI
```

The service can live in TypeScript first, likely under `packages/core` or a shared CLI/MCP module. If queries become performance-critical, selected queries can move into Rust or storage-specific projections.

Query outputs that are consumed by agents should use the common envelope in `docs/architecture/agent-response-contract.md`.

## Query Context

Every graph query should receive:

```ts
type GraphQueryContext = {
  repo_id: string;
  scan_id?: string;
  graph_id?: string;
  require_fresh?: boolean;
  policy_surface: "cli-preflight" | "mcp" | "contract-export" | "ui";
  actor?: string;
};
```

Rules:

- default to latest completed graph for the repo
- expose freshness metadata
- respect policy before returning file/path context
- include diagnostics when graph data is stale, missing, truncated, or partially unsupported

## Required Queries

## Low-Level Graph Primitives

Product queries should be wrappers over a smaller set of graph primitives. This keeps CLI, MCP, and future UI behavior aligned.

```ts
type GraphPrimitiveApi = {
  getNode(input: GraphQueryContext & { node_id: string }): GraphNodeResult;
  findNodes(input: GraphQueryContext & {
    kind?: string;
    path?: string;
    role?: string;
    package_name?: string;
    limit?: number;
  }): GraphNodeListResult;
  getEdges(input: GraphQueryContext & {
    from_node_id?: string;
    to_node_id?: string;
    kind?: string;
    limit?: number;
  }): GraphEdgeListResult;
  traverse(input: GraphQueryContext & {
    start_node_id: string;
    edge_kinds?: string[];
    direction: "out" | "in" | "both";
    max_depth: 1 | 2 | 3;
    limit?: number;
  }): GraphTraversalResult;
  findPath(input: GraphQueryContext & {
    from_node_id: string;
    to_node_id: string;
    edge_kinds?: string[];
    max_depth: 1 | 2 | 3 | 4;
  }): GraphPathResult;
  explainEvidence(input: GraphQueryContext & {
    evidence_ids: string[];
  }): EvidenceExplanationResult;
  getCompleteness(input: GraphQueryContext & {
    rule_id?: string;
    scope: "changed-hunks" | "changed-files" | "full";
  }): GraphCompletenessResult;
  getDiffImpact(input: GraphQueryContext & {
    diff_ref?: string;
    paths?: string[];
  }): DiffImpactResult;
};
```

The first implementation can keep these internal. The important constraint is that product queries do not hand-roll graph traversal.

### `getRepoMap`

Returns a bounded map of files, roles, imports, exports, calls, impacts, and diagnostics.

```ts
type GetRepoMapInput = GraphQueryContext & {
  path?: string;
  role?: string;
  limit?: number;
  offset?: number;
};
```

Used by:

- `drift repo map`
- MCP `get_repo_map`
- future UI map views

### `getTaskContext`

Returns context for an agent before editing.

```ts
type GetTaskContextInput = GraphQueryContext & {
  task: string;
  paths?: string[];
  max_files?: number;
};
```

Returns:

- matched conventions
- relevant files
- risky areas
- open findings
- required checks
- graph diagnostics
- policy metadata

Used by:

- `drift prepare`
- `drift ask`
- MCP `get_task_preflight`

### `getFileImpact`

Returns graph neighborhood and governance impact for one file.

```ts
type GetFileImpactInput = GraphQueryContext & {
  path: string;
  depth?: 1 | 2;
};
```

Returns:

- file node
- imports
- exports
- callers/callees where known
- routes
- conventions touching the file
- findings touching the file

### `getSymbolNeighborhood`

Returns local graph context around a symbol.

```ts
type GetSymbolNeighborhoodInput = GraphQueryContext & {
  symbol_id: string;
  depth?: 1 | 2;
};
```

Used later for:

- duplicate-helper analysis
- blast-radius analysis
- code navigation

### `getRouteFlow`

Returns the route-to-service-to-data path when known.

```ts
type GetRouteFlowInput = GraphQueryContext & {
  route_id?: string;
  path?: string;
  method?: string;
};
```

V1 value:

- explain direct data access
- explain service delegation
- show unresolved import gaps

### `getFindingEvidence`

Returns evidence and related graph nodes for a finding.

```ts
type GetFindingEvidenceInput = GraphQueryContext & {
  finding_id: string;
};
```

Used by:

- `findings show`
- MCP `get_findings`
- future review UI

## Output Rules

All query outputs should include:

- `repo_id`
- `scan_id`
- `graph_id`
- `freshness`
- `policy`
- `diagnostics`
- `next_commands`
- `recommended_action`
- `denied_context` when policy refuses paths or fields

Never return source snippets unless the policy explicitly allows snippets for that surface and path.

Use machine-readable actions from `AgentActionKind` in the agent response contract instead of loose prose like "you may want to rescan."

## Freshness

```ts
type GraphFreshness = {
  status: "fresh" | "stale" | "missing" | "truncated";
  source_change_count: number;
  invalidation_reasons: string[];
  latest_scan_id?: string;
  latest_graph_id?: string;
};
```

If `require_fresh=true`, stale or missing graph data should fail closed with a clear `drift scan` command.

## Diagnostics

Queries should surface relevant graph diagnostics:

- unresolved imports
- unsupported syntax
- skipped files
- graph truncation
- adapter failures
- stale graph projections

Diagnostics should be bounded and summarized so MCP responses do not become huge.

## Policy Requirements

Every query must declare its output surface and call the central context authorization service before returning:

- paths
- snippets
- import/source strings from denied files
- document/OCR text
- diagnostic artifacts
- contract export data

Queries can return aggregate counts for denied data, but denied details must be redacted consistently across CLI JSON, MCP, and UI.

## Acceptance Criteria

- `repo map`, `prepare`, `ask`, and MCP equivalents use the same query builders.
- Query outputs include freshness and diagnostics.
- Query outputs are policy-gated.
- Query outputs use the shared agent envelope when returned to MCP or `drift prepare --json`.
- Product queries are built over low-level graph primitives.
- Raw graph table access is kept inside storage/query services.
- Adding future UI does not require reimplementing graph traversal logic.
