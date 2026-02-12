# v2 Storage Removal Plan

## What Gets Deleted

### Entire files (JSON storage layer)

| File | Lines | Why |
|------|-------|-----|
| `packages/core/src/store/pattern-store.ts` | 1168 | JSON pattern persistence — replaced by `PatternRepository` |
| `packages/core/src/store/contract-store.ts` | ~800 | JSON contract persistence — replaced by `ContractRepository` |
| `packages/core/src/store/history-store.ts` | ~300 | JSON history — replaced by `pattern_history` table |
| `packages/core/src/store/schema-validator.ts` | ~200 | JSON schema validation — DB constraints handle this |

### Entire files (hybrid/sync bridge)

| File | Lines | Why |
|------|-------|-----|
| `packages/core/src/storage/hybrid-pattern-store.ts` | 450 | Bridge layer — v2 is SQLite-only |
| `packages/core/src/storage/hybrid-contract-store.ts` | 350 | Bridge layer — v2 is SQLite-only |
| `packages/core/src/storage/sync-service.ts` | 1142 | JSON↔SQLite sync — no JSON to sync |

### Entire files (data lake JSON stores)

| File | Lines | Why |
|------|-------|-----|
| `packages/core/src/lake/manifest-store.ts` | 420 | JSON manifest — replaced by `v_manifest` view |
| `packages/core/src/lake/view-store.ts` | 430 | JSON views — replaced by SQLite views |
| `packages/core/src/lake/view-materializer.ts` | 400 | JSON view builder — views are auto-computed |
| `packages/core/src/lake/index-store.ts` | 350 | JSON indexes — replaced by SQLite indexes |
| `packages/core/src/lake/pattern-shard-store.ts` | 300 | JSON shards — data lives in `patterns` table |
| `packages/core/src/lake/callgraph-shard-store.ts` | 350 | JSON shards — data lives in `functions` table |
| `packages/core/src/lake/security-shard-store.ts` | 300 | JSON shards — data lives in boundary tables |
| `packages/core/src/lake/examples-store.ts` | 250 | JSON examples — data lives in `pattern_examples` table |

### Temporary keep (for upgrade path)

| File | Keep Until | Why |
|------|-----------|-----|
| `packages/core/src/storage/migration.ts` | v2.1 | Needed for `drift upgrade` from v1 JSON → v2 SQLite |

### Total removal

- **17 files deleted**
- **~6,410 lines removed**
- Plus associated test files, type exports, and barrel imports

## What Gets Refactored

### `packages/core/src/storage/store-factory.ts`

Current: Detects JSON vs SQLite, creates hybrid stores, supports `backend: 'auto' | 'sqlite' | 'json'`.

v2: Always creates SQLite store. Remove `'json'` and `'auto'` backend options. Remove `hasJsonPatterns()`, `detectStorageBackend()`. The factory becomes a thin wrapper around `UnifiedStore`.

```typescript
// v2 store-factory.ts (simplified)
export async function createPatternStore(options: { rootDir?: string } = {}) {
  const store = new UnifiedStore({ rootDir: options.rootDir ?? '.' });
  await store.initialize();
  return store.patterns;
}
```

### `packages/core/src/store/cache-manager.ts`

Current: LRU cache with JSON persistence to `.drift/cache/`.

v2: LRU logic stays (it's well-implemented). Persistence moves to `cache_entries` table. Remove `persist()` and `load()` methods that read/write JSON. Add `persistToDb()` and `loadFromDb()`.

### `packages/core/src/store/project-registry.ts`

Current: Reads/writes `~/.drift/registry.json`.

v2: Reads/writes `~/.drift/global.db` → `project_registry` table. Same API, different backend.

### `packages/core/src/lake/query-engine.ts`

Current: Queries across JSON shards, views, and indexes with fallback to raw pattern loading.

v2: Queries SQLite directly. The `QueryEngine` concept is good — it provides pagination, filtering, and aggregation. But the implementation changes from "read JSON files" to "execute SQL queries".

### `packages/core/src/lake/index.ts` (DataLake facade)

Current: Orchestrates 8 JSON-based stores.

v2: Becomes a thin facade over `UnifiedStore` + SQLite views. Most methods become single SQL queries.

## .drift/ Directory Cleanup

### Files/dirs removed from `.drift/`

```
.drift/patterns/           # All JSON pattern files
.drift/contracts/          # All JSON contract files
.drift/constraints/        # All JSON constraint files
.drift/boundaries/         # All JSON boundary files
.drift/environment/        # All JSON environment files
.drift/audit/              # All JSON audit files
.drift/dna/                # All JSON DNA files
.drift/test-topology/      # All JSON test topology files
.drift/lake/               # All shard/view/index JSON files
.drift/views/              # Materialized JSON views
.drift/indexes/            # JSON indexes
.drift/history/            # JSON history snapshots
.drift/manifest.json       # JSON manifest
.drift/source-of-truth.json
.drift/.context-cache.json
```

### Files kept in `.drift/`

```
.drift/drift.db            # Main database
.drift/drift.db-wal        # WAL file
.drift/drift.db-shm        # Shared memory
.drift/cortex.db           # Memory database
.drift/cortex.db-wal
.drift/cortex.db-shm
.drift/config.json         # User-editable config (or move to DB)
.drift/drift.lock          # Version-controlled pattern snapshot
.drift/backups/            # DB backup files
```

## Consumers That Need Updating

### MCP Tools (packages/mcp/)

Every MCP tool that reads from JSON stores or the data lake needs to switch to SQLite queries. Key tools:

- `drift_status` — Currently reads manifest.json → use `v_manifest` view
- `drift_patterns_list` — Currently reads pattern shards → use `patterns` table
- `drift_file_patterns` — Currently reads file index → use `pattern_locations` join
- `drift_security_summary` — Currently reads security shards → use `v_security_posture` view
- `drift_code_examples` — Currently reads examples store → use `pattern_examples` table

### CLI Commands (packages/cli/)

- `drift scan` — Currently writes to both JSON and SQLite → write to SQLite only
- `drift status` — Currently reads manifest → read from DB
- `drift approve/ignore` — Currently updates JSON + SQLite → update SQLite only
- `drift migrate-storage` — Becomes `drift upgrade` for v1→v2 migration
- `drift backup` — Currently copies JSON dirs → use SQLite backup API

### Detectors (packages/detectors/)

Detectors currently return patterns that get written by `PatternStore`. In v2, they return patterns that get written directly to SQLite by the Rust core. The detector interface stays the same — only the persistence layer changes.

## Migration Order

1. Create `migration_history`, `packages`, `file_metadata`, `pattern_suppressions`, `cache_entries` tables
2. Add new columns to `patterns`, `functions`, `scan_history`
3. Create new views (`v_manifest`, `v_health_dashboard`, `v_file_summary`, `v_security_posture`)
4. Refactor `store-factory.ts` to SQLite-only
5. Refactor `query-engine.ts` to use SQLite
6. Update MCP tools to use SQLite queries
7. Update CLI commands
8. Delete JSON store files
9. Delete hybrid store files
10. Delete data lake JSON stores
11. Delete sync service
12. Update `.gitignore`
13. Add `drift upgrade` command for v1 users
