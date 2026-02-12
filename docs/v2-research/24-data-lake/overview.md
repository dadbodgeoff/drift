# Data Lake — Overview

## Location
`packages/core/src/lake/` — 100% TypeScript (~11 source files)

## What It Is
Enterprise-grade data storage layer with materialized views, sharded storage, pre-computed indexes, and a unified query engine. Sits between raw pattern/security/callgraph data and consumers (MCP tools, CLI), optimizing for instant responses to common queries. Deprecated for v2 — SQLite views and indexes replace it natively — but its architectural concepts are preserved.

## Core Design Principles
1. Pre-compute common queries as materialized views (instant `drift_status`)
2. Shard large datasets by category/file/table (load only what you need)
3. Index everything for O(1) lookups
4. Route queries to the optimal data source automatically
5. Rebuild only stale views after scans (incremental materialization)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    QueryEngine                           │
│  Routes to: Views -> Indexes -> Shards -> Raw fallback   │
├──────────┬──────────┬──────────┬────────────────────────┤
│ ViewStore│ Index    │ Shard    │ Raw Data               │
│          │ Store    │ Stores   │ (injected loader)      │
│ status   │ file     │ pattern  │                        │
│ patterns │ category │ security │                        │
│ security │ table    │ callgrph │                        │
│ trends   │ entry    │ examples │                        │
├──────────┴──────────┴──────────┴────────────────────────┤
│              ViewMaterializer                            │
│  Rebuilds stale views + indexes after scans              │
├─────────────────────────────────────────────────────────┤
│              ManifestStore                               │
│  Quick-load index: all stats, file hashes, view status   │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `query-engine.ts` — `QueryEngine`: unified query API
- `view-materializer.ts` — `ViewMaterializer`: post-scan rebuild
- `index.ts` — Barrel exports with `Lake` prefix to avoid conflicts

## Subsystem Directory Map

| File | Class | Doc |
|------|-------|-----|
| `types.ts` | — | [types.md](./types.md) |
| `manifest-store.ts` | `ManifestStore` | [manifest.md](./manifest.md) |
| `view-store.ts` | `ViewStore` | [views.md](./views.md) |
| `index-store.ts` | `IndexStore` | [indexes.md](./indexes.md) |
| `query-engine.ts` | `QueryEngine` | [query-engine.md](./query-engine.md) |
| `view-materializer.ts` | `ViewMaterializer` | [materializer.md](./materializer.md) |
| `pattern-shard-store.ts` | `PatternShardStore` | [shards.md](./shards.md) |
| `callgraph-shard-store.ts` | `CallGraphShardStore` | [shards.md](./shards.md) |
| `security-shard-store.ts` | `SecurityShardStore` | [shards.md](./shards.md) |
| `examples-store.ts` | `ExamplesStore` | [shards.md](./shards.md) |

## Disk Layout

```
.drift/
  manifest.json                    # ManifestStore
  views/
    status.json                    # StatusView
    pattern-index.json             # PatternIndexView
    security-summary.json          # SecuritySummaryView
    trends.json                    # TrendsView
  indexes/
    by-file.json                   # FileIndex
    by-category.json               # CategoryIndex
    by-table.json                  # TableIndex
    by-entry-point.json            # EntryPointIndex
  lake/
    patterns/{category}.json       # PatternShardStore
    callgraph/index.json           # CallGraphShardStore index
    callgraph/entry-points.json    # Entry point data
    callgraph/{fileHash}.json      # Per-file call graph shards
    security/index.json            # SecurityShardStore index
    security/sensitive-fields.json # Sensitive field registry
    security/{tableName}.json      # Per-table security shards
    examples/index.json            # ExamplesStore index
    examples/{patternId}.json      # Per-pattern code examples
```

## Configuration
```typescript
interface DataLakeConfig {
  rootDir: string;
  enableSharding: boolean;     // Default: true
  shardThreshold: number;      // Items before sharding kicks in
  enableViews: boolean;        // Default: true
  enableIndexes: boolean;      // Default: true
  autoRebuild: boolean;        // Auto-rebuild stale views
  viewTtlMs: number;           // View freshness TTL
}
```

## V2 Implications
The entire Data Lake is replaced by SQLite:
- ManifestStore -> `v_manifest` SQL view + cached Rust query
- ViewStore -> `v_status`, `v_pattern_index`, `v_security_summary` SQL views
- IndexStore -> SQL indexes (`idx_pattern_locations_file`, `idx_patterns_category`)
- PatternShardStore -> Direct `patterns` table queries with category filter
- CallGraphShardStore -> `functions` + `function_calls` tables
- SecurityShardStore -> `data_access_points` + `sensitive_fields` tables
- ExamplesStore -> `pattern_examples` table
- QueryEngine -> SQL queries with query planner optimization
- ViewMaterializer -> SQLite triggers + materialized view refresh

Concepts to preserve: query routing, single-read stats, load-only-what-you-need, selective rebuild.
