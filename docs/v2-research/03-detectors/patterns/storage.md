# Pattern Storage

## Location
`packages/core/src/storage/` — SQLite persistence
`.drift/patterns/` — JSON shard files (one per category)
`.drift/indexes/` — Derived indexes (by-category, by-file)

## Purpose
Dual storage layer for patterns: SQLite as the primary database, JSON shards as human-readable backups. V2 moves to SQLite-only with JSON for export.

---

## SQLite Tables

### `patterns` — Core pattern table
```sql
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',  -- discovered | approved | ignored
  detection_method TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  pattern_id TEXT NOT NULL,
  confidence_frequency REAL,
  confidence_consistency REAL,
  confidence_age INTEGER,
  confidence_spread INTEGER,
  confidence_score REAL,
  confidence_level TEXT,
  severity TEXT DEFAULT 'info',
  auto_fixable INTEGER DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT,
  source TEXT DEFAULT 'auto-detected',
  tags TEXT,                                   -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### `pattern_locations` — Where patterns are found
```sql
CREATE TABLE pattern_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  column_num INTEGER NOT NULL,
  is_outlier INTEGER DEFAULT 0,
  confidence REAL,
  outlier_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### `pattern_variants` — Scoped overrides
```sql
CREATE TABLE pattern_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  scope TEXT NOT NULL,              -- 'global' | 'directory' | 'file'
  scope_path TEXT,                  -- Directory or file path
  severity_override TEXT,
  enabled_override INTEGER,
  threshold_override REAL,
  config_override TEXT,             -- JSON
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### `pattern_examples` — Code examples for patterns
```sql
CREATE TABLE pattern_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  file TEXT NOT NULL,
  code TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  is_positive INTEGER DEFAULT 1,   -- 1 = good example, 0 = bad example
  created_at TEXT DEFAULT (datetime('now'))
);
```

### `pattern_history` — Pattern change tracking
```sql
CREATE TABLE pattern_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'created' | 'updated' | 'approved' | 'ignored' | 'deleted'
  old_value TEXT,                   -- JSON of previous state
  new_value TEXT,                   -- JSON of new state
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Indexes
```sql
CREATE INDEX idx_patterns_category ON patterns(category);
CREATE INDEX idx_patterns_status ON patterns(status);
CREATE INDEX idx_patterns_confidence ON patterns(confidence_score);
CREATE INDEX idx_pattern_locations_file ON pattern_locations(file);
CREATE INDEX idx_pattern_locations_pattern ON pattern_locations(pattern_id);
CREATE INDEX idx_pattern_variants_pattern ON pattern_variants(pattern_id);
CREATE INDEX idx_pattern_variants_scope ON pattern_variants(scope, scope_path);
```

---

## JSON Shard Files

One file per category in `.drift/patterns/`:

```
.drift/patterns/
├── accessibility.json
├── auth.json
├── components.json
├── config.json
├── data-access.json
├── documentation.json
├── errors.json
├── logging.json
├── performance.json
├── security.json
├── structural.json
├── styling.json
├── testing.json
└── types.json
```

Each file follows the `PatternFile` schema (see [data-model.md](./data-model.md)).

### Integrity
Each file includes a `checksum` field — a 16-char hex hash of the pattern data. Used to detect corruption or tampering.

---

## Index Files

Derived indexes for fast lookup:

### `by-category.json`
```json
{
  "security": ["pattern-id-1", "pattern-id-2"],
  "structural": ["pattern-id-3", "pattern-id-4"]
}
```

### `by-file.json`
```json
{
  "src/api/handler.ts": ["pattern-id-1", "pattern-id-5"],
  "src/components/Button.tsx": ["pattern-id-3"]
}
```

---

## Backup System

Pattern backups stored in `.drift/backups/patterns-{timestamp}/`:
- Full copy of all pattern JSON files
- Includes `discovered/` subdirectory for auto-discovered patterns
- Triggered before destructive operations (re-scan, reset)

---

## V1 → V2 Migration

| Aspect | V1 | V2 |
|--------|----|----|
| Primary storage | JSON shards | SQLite |
| Secondary storage | SQLite | JSON (export only) |
| Write ownership | TypeScript | Rust |
| Read access | TypeScript | TypeScript via NAPI |
| Index files | Materialized JSON | SQLite indexes |
| Backup format | JSON copies | Compressed archives |

---

## Rust Rebuild Considerations
- SQLite is already C — Rust's `rusqlite` is a natural fit
- JSON shard writes can be eliminated in v2 (SQLite-only)
- Pattern location inserts are bulk operations — use SQLite transactions
- The `by-file` index is a hot path for IDE integration — keep in-memory in Rust
- Content hash validation (checksum) should use `xxhash` for speed
- WAL mode + concurrent reads are well-supported in `rusqlite`
- Consider `r2d2` connection pooling for multi-threaded access
