# Cortex Storage Layer

## Location
`packages/cortex/src/storage/`

## Architecture
SQLite-backed persistence using `better-sqlite3` with `sqlite-vec` for vector operations. Factory pattern for storage creation with auto-detection.

## Files
- `interface.ts` — `IMemoryStorage` contract (all implementations must satisfy)
- `factory.ts` — Storage creation and auto-detection
- `sqlite/schema.ts` — DDL for all tables
- `sqlite/storage.ts` — `SQLiteMemoryStorage` implementation
- `sqlite/client.ts` — `better-sqlite3` wrapper with sqlite-vec loading
- `sqlite/migrations.ts` — Schema versioning (5 migrations)
- `sqlite/queries.ts` — Optimized SQL query builders

## IMemoryStorage Interface

### Lifecycle
- `initialize()` — Create tables, load extensions
- `close()` — Close connection

### CRUD
- `create(memory)` → `string` (ID)
- `read(id)` → `Memory | null`
- `update(id, updates)` → `void`
- `delete(id)` → `void`

### Bulk Operations
- `bulkCreate(memories[])` → `string[]`
- `bulkUpdate(updates[])` → `void`
- `bulkDelete(ids[])` → `void`

### Query Operations
- `findByType(type, options?)` — Filter by memory type
- `findByPattern(patternId)` — Find memories linked to a pattern
- `findByConstraint(constraintId)` — Find memories linked to a constraint
- `findByFile(filePath)` — Find memories linked to a file
- `findByFunction(functionId)` — Find memories linked to a function
- `search(query)` — Complex query with multiple filters

### Vector Operations
- `similaritySearch(embedding, limit, threshold?)` — Cosine similarity search
- `upsertEmbedding(memoryId, embedding)` — Insert/update vector

### Bitemporal Operations
- `asOf(timestamp)` — Scope to transaction time
- `validAt(timestamp)` — Scope to valid time

### Relationship Operations
- `addRelationship(sourceId, targetId, type)` — Create memory-to-memory link
- `removeRelationship(sourceId, targetId, type)` — Remove link
- `getRelated(memoryId, type?, depth?)` — Traverse relationships

### Link Operations
- `linkToPattern(memoryId, patternId)`
- `linkToConstraint(memoryId, constraintId)`
- `linkToFile(memoryId, filePath, citation?)` — With optional line numbers + content hash
- `linkToFunction(memoryId, functionId)`

### Aggregation
- `count(filter?)` — Count matching memories
- `countByType()` — Breakdown by type
- `getSummaries(filter?)` — Lightweight summaries

### Maintenance
- `vacuum()` — SQLite VACUUM
- `checkpoint()` — WAL checkpoint

## Relationship Types

### Core (v1)
- `supersedes` — New memory replaces old
- `supports` — Confirms another memory
- `contradicts` — Conflicts with another
- `related` — General relationship
- `derived_from` — Extracted from another

### Semantic (v2)
- `owns` — Entity owns Entity/Goal/Workflow
- `affects` — Incident affects Entity/Environment
- `blocks` — Incident/Blocker blocks Goal
- `requires` — Workflow requires Skill/Environment
- `references` — Any memory references another
- `learned_from` — Feedback learned from Incident/Conversation
- `assigned_to` — Goal assigned to Entity
- `depends_on` — Entity depends on Entity/Environment

## Database Schema

### Core Table: `memories`
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- Constrained to valid types
  content TEXT NOT NULL,        -- JSON blob
  summary TEXT NOT NULL,
  recorded_at TEXT NOT NULL,    -- Transaction time
  valid_from TEXT NOT NULL,     -- Valid time start
  valid_until TEXT,             -- Valid time end (null = current)
  confidence REAL NOT NULL DEFAULT 1.0,
  importance TEXT DEFAULT 'normal',
  last_accessed TEXT,
  access_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  created_by TEXT,
  tags TEXT,                    -- JSON array
  archived INTEGER DEFAULT 0,
  archive_reason TEXT,
  superseded_by TEXT,
  supersedes TEXT,
  last_validated TEXT
);
```

### Relationship Tables
- `memory_relationships` — Memory-to-memory edges with strength
- `memory_patterns` — Memory-to-pattern links
- `memory_constraints` — Memory-to-constraint links
- `memory_files` — Memory-to-file links with citation (line_start, line_end, content_hash)
- `memory_functions` — Memory-to-function links

### Vector Table
- `memory_embeddings` — 384-dimensional vectors via sqlite-vec
- `memory_embedding_link` — Maps memory IDs to embedding row IDs

### V2 Tables (Migrations 2-5)
- `causal_edges` — Causal graph edges
- `session_contexts` — Session state persistence
- `memory_validation_history` — Validation feedback
- `memory_usage_history` — Effectiveness tracking
- `memory_contradictions` — Detected contradictions
- `consolidation_triggers` — Adaptive consolidation triggers
- `token_usage_snapshots` — Token monitoring
- `memory_clusters` — Memory grouping

### Indexes
20+ indexes covering: type, confidence, validity, importance, created_at, last_accessed, patterns, constraints, files, functions, relationships, causal edges.

## Migration System
5 schema versions tracked via `schema_version` table. `runMigrations()` applies pending migrations. `needsMigration()` checks if upgrade needed.

## Rust Rebuild Considerations
- SQLite is already a C library — Rust's `rusqlite` is a natural fit
- Vector operations could use `faiss-rs` or custom SIMD for better perf
- The `IMemoryStorage` interface maps cleanly to a Rust trait
- Bitemporal queries are pure SQL — portable as-is
- Content is stored as JSON blobs — consider typed serialization (serde) in Rust
- WAL mode and concurrent reads are well-supported in rusqlite
