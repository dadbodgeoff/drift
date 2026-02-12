# Storage Systems — v2 Audit & Architecture

## Executive Summary

Drift v1 has **6 fragmented storage backends** that evolved organically across phases. v2 consolidates everything into a **single Rust-managed SQLite database** with no JSON file storage. This document is a thorough audit of the current state, what gets removed, what gets kept, and the target architecture.

---

## v1 Current State: Full Inventory

### Backend 1: JSON File Storage (DEPRECATED — REMOVE IN v2)

**Location**: `packages/core/src/store/`

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `pattern-store.ts` | Pattern CRUD, querying, state transitions via JSON files in `.drift/patterns/{status}/{category}.json` | ~1168 | Deprecated (marked in JSDoc) |
| `contract-store.ts` | Contract persistence to `.drift/contracts/{status}/` | ~800 | Deprecated |
| `history-store.ts` | Pattern change history tracking in JSON | ~300 | Deprecated |
| `cache-manager.ts` | LRU in-memory cache with JSON persistence to `.drift/cache/` | ~400 | Partially useful (LRU logic) |
| `project-registry.ts` | Global registry at `~/.drift/registry.json` | ~500 | Needs migration to DB |
| `project-config.ts` | Per-project config in `.drift/config.json` | ~200 | Needs migration to DB |
| `lock-file-manager.ts` | `drift.lock` generation for version control | ~300 | Keep concept, rewrite |
| `schema-validator.ts` | JSON schema validation for pattern files | ~200 | Remove (DB constraints replace this) |
| `types.ts` | Shared types for JSON stores | ~500 | Partially reusable |

**What this backend does**:
- Stores patterns as JSON files organized by `status/category.json`
- Auto-saves with debouncing (30s default)
- Creates timestamped `.backups/` directories before overwrites
- Generates SHA-256 checksums for integrity
- Supports pattern state transitions: `discovered → approved/ignored`

**Why it must go**:
- O(n) reads — must parse entire category file to find one pattern
- No concurrent access safety (file locking is advisory only)
- No transactional guarantees — partial writes corrupt data
- Generates 50+ JSON files that clutter `.drift/`
- No query optimization — all filtering happens in-memory after full load
- Version control noise — every scan changes dozens of files

### Backend 2: SQLite Unified Store (KEEP — BECOMES THE FOUNDATION)

**Location**: `packages/core/src/storage/`

| File | Purpose | Lines |
|------|---------|-------|
| `schema.sql` | 899-line schema with 40+ tables, 50+ indexes, triggers, views | 899 |
| `unified-store.ts` | Main store class — lifecycle, transactions, export/import | ~400 |
| `store-factory.ts` | Auto-detects backend (SQLite vs JSON), creates appropriate store | ~250 |
| `migration.ts` | JSON → SQLite migration with backup/restore | ~500 |
| `sync-service.ts` | Bidirectional JSON ↔ SQLite sync (11 data domains) | ~1142 |
| `hybrid-pattern-store.ts` | Bridge: reads from SQLite, optionally writes to both | ~450 |
| `hybrid-contract-store.ts` | Same bridge pattern for contracts | ~350 |
| `types.ts` | All DB types, repository interfaces, config | ~500 |

**Repositories** (`storage/repositories/`):

| Repository | Tables Managed | Key Operations |
|-----------|---------------|----------------|
| `pattern-repository.ts` | `patterns`, `pattern_locations`, `pattern_examples` | CRUD, bulk ops, search with 15+ filter fields, aggregations |
| `contract-repository.ts` | `contracts`, `contract_frontends` | CRUD, status queries, state transitions |
| `constraint-repository.ts` | `constraints` | CRUD, category/status queries |
| `boundary-repository.ts` | `data_models`, `sensitive_fields`, `data_access_points` | Model/field/access point management |
| `environment-repository.ts` | `env_variables`, `env_access_points` | Variable tracking, sensitivity classification |
| `callgraph-repository.ts` | `functions`, `function_calls`, `function_data_access` | Function/call/data-access CRUD |
| `audit-repository.ts` | `audit_snapshots`, `pattern_history`, `health_trends`, `scan_history` | Snapshot management, trend tracking |
| `dna-repository.ts` | `dna_profile`, `dna_genes`, `dna_mutations` | Profile/gene/mutation management |
| `test-topology-repository.ts` | `test_files`, `test_coverage` | Test file tracking, coverage mapping |

**Schema covers 40+ tables across domains**:
- Project metadata (3 tables)
- Patterns (4 tables)
- Contracts (2 tables)
- Constraints (1 table)
- Boundaries (3 tables)
- Environment (2 tables)
- Call graph (3 tables)
- Audit & history (4 tables)
- DNA (3 tables)
- Test topology (2 tables)
- Constants (2 tables)
- Decisions (1 table)
- Coupling (2 tables)
- Error handling (2 tables)
- Wrappers (2 tables)
- Quality gates (2 tables)
- Learning (1 table)
- Sync log (1 table)

**Performance configuration**:
```sql
PRAGMA journal_mode = WAL;    -- Concurrent reads during writes
PRAGMA synchronous = NORMAL;  -- Balanced durability/speed
PRAGMA foreign_keys = ON;     -- Referential integrity
```

### Backend 3: Data Lake (DEPRECATED — REPLACE WITH DB VIEWS)

**Location**: `packages/core/src/lake/`

| File | Purpose | Lines |
|------|---------|-------|
| `manifest-store.ts` | Quick-load project stats in `.drift/manifest.json` | ~420 |
| `view-store.ts` | Pre-computed views in `.drift/views/*.json` | ~430 |
| `view-materializer.ts` | Rebuilds views after scans | ~400 |
| `index-store.ts` | File/category indexes in `.drift/indexes/*.json` | ~350 |
| `query-engine.ts` | Query execution over shards/views | ~400 |
| `pattern-shard-store.ts` | Pattern data shards by category | ~300 |
| `callgraph-shard-store.ts` | Call graph shards by file | ~350 |
| `security-shard-store.ts` | Security data shards | ~300 |
| `examples-store.ts` | Code example storage | ~250 |

**What this backend does**:
- Materializes views as JSON files for instant `drift_status` responses
- Shards large datasets by category/file for parallel processing
- Maintains indexes for fast lookups without loading full data
- Provides a `QueryEngine` that selects optimal data source

**Why it must go**:
- SQLite views and indexes already provide this functionality natively
- The `v_status`, `v_pattern_index`, `v_category_counts`, `v_file_patterns`, `v_security_summary` views in `schema.sql` already replace the JSON views
- Maintaining two query paths (lake vs. SQLite) creates bugs and inconsistency
- JSON shards have no transactional guarantees
- The manifest is just a cache of data already in SQLite

**What to preserve in v2**:
- The `QueryEngine` concept — but backed by SQLite queries instead of JSON reads
- The materialized view pattern — but using SQLite's own view mechanism
- The manifest concept — but as a cached query result, not a JSON file

### Backend 4: Rust SQLite Storage (KEEP — EXPAND)

**Location**: `crates/drift-core/src/`

| File | Purpose |
|------|---------|
| `call_graph/storage.rs` | High-performance call graph SQLite with WAL, batched inserts, MPSC channel pattern |
| `reachability/sqlite_engine.rs` | Read-only reachability analysis directly from SQLite |

**CallGraphDb features**:
- WAL mode with `PRAGMA cache_size = -64000` (64MB cache)
- `PRAGMA mmap_size = 268435456` (256MB memory-mapped I/O)
- Batched inserts (1000 rows per transaction)
- MPSC channel pattern for parallel parsing → sequential writes
- Read-only mode for query-only access
- Separate schema: `functions`, `calls`, `data_access`, `metadata`

**SqliteReachabilityEngine features**:
- Opens DB in read-only mode
- BFS traversal via SQL queries (not in-memory graph)
- O(1) memory regardless of codebase size
- Sensitive field classification (PII, financial, health, credentials)

**v2 direction**: This becomes the model for all storage. The Rust core manages the single database, and TypeScript accesses it through NAPI bindings.

### Backend 5: Cortex Memory Storage (KEEP — CONSOLIDATE)

**Location**: `packages/cortex/src/storage/`

| File | Purpose |
|------|---------|
| `interface.ts` | `IMemoryStorage` interface — CRUD, vector search, bitemporal, relationships |
| `sqlite/schema.ts` | Schema v5: `memories`, relationships, links, consolidation, validation |
| `sqlite/storage.ts` | Full `IMemoryStorage` implementation |
| `sqlite/client.ts` | SQLite client with sqlite-vec extension loading |
| `sqlite/migrations.ts` | Schema migrations (5 versions) |
| `sqlite/queries.ts` | Prepared SQL queries |

**Cortex schema (separate `cortex.db`)**:
- `memories` — 9 types, JSON content, bitemporal tracking, confidence/importance, archival
- `memory_relationships` — supersedes/supports/contradicts/related/derived_from
- `memory_patterns` — links to drift patterns
- `memory_constraints` — links to drift constraints
- `memory_files` — links to files with content_hash for drift detection
- `memory_functions` — links to call graph functions
- `consolidation_runs` — consolidation history
- `validation_runs` — validation history
- `memory_embedding_link` — links memories to vector embeddings
- `memory_embeddings` — sqlite-vec virtual table (384-dim float vectors)

**Embedding cache** (`packages/cortex/src/embeddings/cache/`):
- L1: In-memory LRU (fastest, ~1000 entries)
- L2: SQLite persistent cache (larger, survives restarts)
- L3: Precomputed embeddings for common patterns/intents (static)

**v2 direction**: Cortex tables move into the main `drift.db` or remain as a separate `cortex.db` attached via `ATTACH DATABASE`. The L1/L2/L3 cache architecture is solid and stays.

### Backend 6: Hybrid Stores (DEPRECATED — REMOVE IN v2)

**Location**: `packages/core/src/storage/`

| File | Purpose |
|------|---------|
| `hybrid-pattern-store.ts` | Reads from SQLite, optionally writes to both SQLite + JSON |
| `hybrid-contract-store.ts` | Same bridge for contracts |
| `sync-service.ts` | Syncs 11 data domains from JSON → SQLite |
| `migration.ts` | One-time JSON → SQLite migration |

**Why they exist**: Transitional layer during Phase 3→4 migration. Allowed gradual adoption of SQLite while maintaining JSON backward compatibility.

**Why they must go**: v2 is SQLite-only. No JSON fallback, no hybrid mode, no sync service.

---

## v2 Target Architecture

### Single Database: `drift.db`

```
.drift/
├── drift.db          # ALL data (patterns, contracts, call graph, audit, etc.)
├── drift.db-wal      # WAL file (auto-managed)
├── drift.db-shm      # Shared memory (auto-managed)
├── cortex.db         # Memory system (attached via ATTACH DATABASE)
├── cortex.db-wal
├── cortex.db-shm
└── drift.lock        # Version-controlled pattern snapshot (generated from DB)
```

No more:
- `.drift/patterns/` directory tree
- `.drift/contracts/` directory tree
- `.drift/constraints/` directory tree
- `.drift/boundaries/` directory tree
- `.drift/environment/` directory tree
- `.drift/audit/` directory tree
- `.drift/dna/` directory tree
- `.drift/test-topology/` directory tree
- `.drift/lake/` directory tree (shards, views, indexes, manifest)
- `.drift/views/` directory
- `.drift/indexes/` directory
- `.drift/history/` directory
- `.drift/backups/patterns-*/` directories
- `.drift/manifest.json`
- `.drift/source-of-truth.json`
- `.drift/.context-cache.json`

### Ownership Model

```
┌─────────────────────────────────────────────────┐
│              Rust Core (drift-core)              │
│                                                  │
│  Owns drift.db                                   │
│  - Schema creation & migrations                  │
│  - All write operations                          │
│  - WAL/pragma configuration                      │
│  - Batch insert optimization                     │
│  - MPSC channel pattern for parallel writes      │
│  - Connection pooling                            │
│                                                  │
│  Exposes via NAPI:                               │
│  - query(sql, params) → rows                     │
│  - execute(sql, params) → changes                │
│  - transaction(statements) → results             │
│  - getStatus() → cached stats                    │
│  - insertPatterns(batch) → ids                   │
│  - insertFunctions(batch) → ids                  │
│  - ... (typed high-level operations)             │
└──────────────────────┬──────────────────────────┘
                       │ NAPI bindings
                       ▼
┌─────────────────────────────────────────────────┐
│           TypeScript Layer                       │
│                                                  │
│  Read-only access to drift.db                    │
│  - Repository pattern for typed queries          │
│  - MCP tool implementations                      │
│  - CLI command handlers                          │
│                                                  │
│  Owns cortex.db                                  │
│  - Memory CRUD                                   │
│  - Vector search (sqlite-vec)                    │
│  - Relationship management                       │
│  - Embedding cache (L1/L2/L3)                    │
└─────────────────────────────────────────────────┘
```

### Schema Evolution: v1 → v2

#### Tables that stay (with refinements)

All 40+ tables from the current `schema.sql` are retained. Key changes:

1. **`project`** — Add `monorepo_root`, `package_manager`, `language_stats` (JSON)
2. **`patterns`** — Add `hash` column for deduplication, `parent_id` for hierarchy
3. **`functions`** — Add `complexity` (cyclomatic), `return_type`, `visibility`
4. **`scan_history`** — Add `incremental` flag, `changed_files` count
5. **`sync_log`** — Repurpose for cloud sync only (remove JSON sync triggers)

#### Tables to add

| Table | Purpose |
|-------|---------|
| `packages` | Monorepo package registry (name, path, dependencies) |
| `file_metadata` | Per-file stats: language, size, last_modified, content_hash |
| `pattern_suppressions` | Inline `// drift-ignore` tracking |
| `migration_history` | Schema migration tracking (version, applied_at, checksum) |
| `cache_entries` | Replaces JSON cache manager — key/value with TTL |
| `project_registry` | Replaces `~/.drift/registry.json` |

#### Tables to remove

| Table | Reason |
|-------|--------|
| None from current schema | All current tables serve valid purposes |

#### Views to add

| View | Replaces |
|------|----------|
| `v_manifest` | `.drift/manifest.json` (data lake manifest) |
| `v_pattern_shards` | `.drift/lake/patterns/*.json` shards |
| `v_security_index` | `.drift/lake/security/*.json` shards |
| `v_callgraph_index` | `.drift/lake/callgraph/*.json` shards |
| `v_examples_index` | `.drift/lake/examples/*.json` |
| `v_health_dashboard` | Combines audit + trends + scan history |

### Migration Path: v1 → v2

#### For existing users with JSON-only storage

```
drift upgrade
  1. Detect JSON files in .drift/
  2. Create drift.db with v2 schema
  3. Run migration.ts logic (already exists and works)
  4. Verify row counts match
  5. Archive JSON files to .drift/.v1-archive/
  6. Update .gitignore
```

#### For existing users with SQLite (hybrid mode)

```
drift upgrade
  1. Detect drift.db exists
  2. Run schema migrations (add new tables/columns)
  3. Remove hybrid store references
  4. Archive JSON files to .drift/.v1-archive/
  5. Update .gitignore
```

#### For new users

```
drift init
  1. Create .drift/drift.db with v2 schema
  2. No JSON files created
  3. Done
```

---

## Code to Remove in v2

### Entire files to delete

```
packages/core/src/store/pattern-store.ts          # JSON pattern store
packages/core/src/store/contract-store.ts          # JSON contract store
packages/core/src/store/history-store.ts           # JSON history store
packages/core/src/store/schema-validator.ts        # JSON schema validation
packages/core/src/store/lock-file-manager.ts       # Rewrite for DB-backed lock

packages/core/src/storage/hybrid-pattern-store.ts  # Hybrid bridge
packages/core/src/storage/hybrid-contract-store.ts # Hybrid bridge
packages/core/src/storage/sync-service.ts          # JSON↔SQLite sync
packages/core/src/storage/migration.ts             # Keep temporarily for upgrade path

packages/core/src/lake/manifest-store.ts           # JSON manifest
packages/core/src/lake/view-store.ts               # JSON views
packages/core/src/lake/view-materializer.ts        # JSON view builder
packages/core/src/lake/index-store.ts              # JSON indexes
packages/core/src/lake/pattern-shard-store.ts      # JSON shards
packages/core/src/lake/callgraph-shard-store.ts    # JSON shards
packages/core/src/lake/security-shard-store.ts     # JSON shards
packages/core/src/lake/examples-store.ts           # JSON examples
```

### Files to heavily refactor

```
packages/core/src/storage/store-factory.ts         # Remove JSON/hybrid paths
packages/core/src/store/cache-manager.ts           # Move to SQLite-backed cache
packages/core/src/store/project-registry.ts        # Move to SQLite table
packages/core/src/lake/query-engine.ts             # Rewrite to use SQLite directly
```

### Estimated reduction

| Metric | v1 | v2 | Reduction |
|--------|----|----|-----------|
| Storage-related TS files | ~35 | ~15 | -57% |
| Lines of storage code | ~12,000 | ~5,000 | -58% |
| JSON files in `.drift/` | 50+ | 0 | -100% |
| Storage backends | 6 | 2 (drift.db + cortex.db) | -67% |
| Data sync paths | 3 (JSON→SQLite, SQLite→JSON, Lake) | 0 | -100% |

---

## Performance Characteristics: v1 vs v2

| Operation | v1 (JSON) | v1 (SQLite) | v2 (Rust SQLite) |
|-----------|-----------|-------------|------------------|
| Load all patterns | 200-800ms (parse all JSON) | 50-150ms (query + cache) | 10-30ms (Rust + mmap) |
| Find pattern by ID | O(n) scan | O(1) index lookup | O(1) index lookup |
| Find patterns by file | O(n×m) scan | O(log n) index | O(log n) index |
| Insert 1000 patterns | 500ms+ (serialize + write) | 100-200ms (transactions) | 20-50ms (batched + MPSC) |
| Status query | 100-300ms (read manifest.json) | 5-10ms (v_status view) | 1-3ms (cached Rust query) |
| Concurrent reads | Unsafe (file locks) | Safe (WAL mode) | Safe (WAL + connection pool) |
| Disk usage (10k patterns) | ~15MB (50+ JSON files) | ~3MB (single DB) | ~3MB (single DB) |

---

## Cortex Storage: Consolidation Strategy

### Option A: Separate database (recommended for v2.0)

```
.drift/drift.db    — All analysis data
.drift/cortex.db   — Memory system + embeddings
```

**Pros**: sqlite-vec extension only loaded for cortex, simpler schema management, independent backup/restore.

**Cons**: Cross-database queries require ATTACH, two connection pools.

### Option B: Single database (consider for v2.1+)

```
.drift/drift.db    — Everything including memories
```

**Pros**: Single connection, simpler architecture, atomic cross-domain transactions.

**Cons**: sqlite-vec loaded for all connections, larger single DB, memory schema migrations coupled to core.

### Recommendation

Start with Option A for v2.0. The Cortex schema has its own migration history (currently at v5) and the sqlite-vec dependency is non-trivial. Consolidate in v2.1 once the Rust core is stable.

The `ATTACH DATABASE` approach lets TypeScript query across both when needed:
```sql
ATTACH DATABASE '.drift/cortex.db' AS cortex;
SELECT m.summary, p.name
FROM cortex.memories m
JOIN patterns p ON m.id IN (
  SELECT memory_id FROM cortex.memory_patterns WHERE pattern_id = p.id
);
```

---

## Backup & Recovery in v2

### Strategy

```
drift backup create                    # → .drift/backups/drift-{timestamp}.db
drift backup restore {timestamp}       # ← Restore from backup
drift backup list                      # List available backups
```

SQLite's backup API (`sqlite3_backup_init`) provides hot backup without locking:
- No downtime during backup
- Consistent snapshot guaranteed
- Single file to copy/restore

### Retention

- Keep last 5 backups by default (configurable)
- Auto-backup before schema migrations
- Auto-backup before `drift upgrade`

### Export for version control

`drift.lock` remains the version-controlled artifact:
```
drift lock generate    # Exports approved patterns from DB → drift.lock
drift lock validate    # Compares drift.lock against DB
```

The lock file format stays human-readable (JSON or TOML) for code review.

---

## Cloud Sync in v2

The `sync_log` table already tracks all mutations. v2 refines this:

1. Triggers fire on INSERT/UPDATE/DELETE for key tables
2. `sync_log` records `(table, row_id, operation, timestamp, synced)`
3. Cloud sync reads unsynced entries, pushes to remote
4. On success, marks entries as synced
5. Conflict resolution: last-write-wins with vector clocks (future)

No JSON files involved in the sync path.

---

## .gitignore Updates for v2

```gitignore
# Drift v2
.drift/drift.db
.drift/drift.db-wal
.drift/drift.db-shm
.drift/cortex.db
.drift/cortex.db-wal
.drift/cortex.db-shm
.drift/backups/

# Keep in version control
# .drift/drift.lock
# .drift/config.json (if user-edited)
```
