# Data Lake Query Engine

## Location
`packages/core/src/lake/query-engine.ts`

## Purpose
Unified query API that routes queries to the optimal data source automatically. Knows whether to use pre-computed views, indexes, shards, or raw data based on availability and freshness.

## Files
- `query-engine.ts` — `QueryEngine` class (~400 lines)

---

## QueryEngine

### Initialization
- `initialize()` — Initializes all sub-stores (manifest, views, indexes, shards)
- `setRawPatternLoader(loader)` — Inject fallback loader for raw data

### Query Methods
- `getStatus()` -> `StatusView | null` — Status query
- `getPatterns(options)` -> `PaginatedResult<PatternSummary>` — Pattern listing
- `getPatternsByCategory(categories, options)` -> `PaginatedResult<PatternShardEntry>` — Category query
- `getPatternsByFile(file, options)` -> `PaginatedResult<PatternSummary>` — File query
- `getSecuritySummary()` -> `SecuritySummaryView | null` — Security overview

### Stats
- `getStats()` -> `QueryStats` — Hit counts and response times

---

## Query Routing Strategy

| Query Type | Primary Source | Fallback |
|------------|---------------|----------|
| Status | StatusView | Build from raw patterns |
| Pattern list | PatternIndexView | Build from raw patterns |
| By category | PatternShardStore | Filter raw patterns |
| By file | FileIndex + PatternIndexView | Filter raw patterns |
| Security | SecuritySummaryView | Build from security shards |

The engine checks `ManifestStore.isViewStale()` before using a view. If stale, it falls back to the next source.

---

## Pagination
```typescript
interface PaginationOptions {
  limit?: number;
  cursor?: string;
  offset?: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  executionTime: number;
  source: 'view' | 'index' | 'raw';
}
```

Every result includes `source` — which data path was used. This is useful for monitoring query efficiency.

---

## Stats Tracking
```typescript
interface QueryStats {
  viewHits: number;
  indexHits: number;
  rawHits: number;
  shardHits: number;
  avgResponseTime: number;
}
```

Every query records which source was used and its execution time. `getStats()` returns aggregated hit counts and average response time.

---

## Dependencies
The engine composes four sub-stores:
- `ManifestStore` — View freshness checks
- `ViewStore` — Pre-computed view reads
- `IndexStore` — Fast lookups
- `PatternShardStore` — Category-scoped data

All are injected via constructor or created with defaults.

## Rust Rebuild Considerations
- The query routing concept maps to SQLite's query planner (automatic)
- Views become SQL views — SQLite decides the optimal execution plan
- Stats tracking becomes query profiling via `EXPLAIN QUERY PLAN`
- Pagination becomes `LIMIT/OFFSET` or keyset pagination
- The `source` field is no longer needed (SQLite handles routing internally)
- The concept of "stale views" is replaced by SQLite triggers that refresh materialized data
