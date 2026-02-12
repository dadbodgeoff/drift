# Data Lake Shard Stores

## Location
`packages/core/src/lake/`

## Purpose
Partitioned storage that loads only the data you need. Four shard stores partition data by different dimensions: patterns by category, call graph by file, security by table, and examples by pattern.

## Files
- `pattern-shard-store.ts` — `PatternShardStore` (~430 lines)
- `callgraph-shard-store.ts` — `CallGraphShardStore` (~650 lines)
- `security-shard-store.ts` — `SecurityShardStore` (~660 lines)
- `examples-store.ts` — `ExamplesStore` (~550 lines)

---

## PatternShardStore

Partitions patterns by category. Each shard is a JSON file at `.drift/lake/patterns/{category}.json`.

### Key Methods
- `getByCategory(category)` -> `PatternShardEntry[]` — Load one category
- `getByCategories(categories)` -> `PatternShardEntry[]` — Parallel load of multiple
- `getById(id, category?)` -> `PatternShardEntry | null` — If category known, loads one shard; otherwise searches all
- `getAll()` -> `PatternShardEntry[]` — Load all shards
- `listCategories()` -> `PatternCategory[]` — Which categories have data
- `getCategoryCounts()` -> `Record<PatternCategory, number>` — Counts per category
- `saveShard(category, patterns)` — Write one shard
- `saveAll(patterns)` — Partition and write all shards
- `deleteShard(category)` — Remove a shard
- `hasShardChanged(category, checksum)` — Change detection for incremental updates

### Caching
In-memory cache per category. `invalidateCache(category?)` clears specific or all.

---

## CallGraphShardStore

Partitions call graph data by file (hashed file path). Each shard at `.drift/lake/callgraph/{fileHash}.json`.

### Key Methods
- `getFileShard(fileHash)` / `getFileShardByPath(file)` — Load one file's call graph
- `getFileShards(fileHashes)` — Batch load
- `saveFileShard(shard)` — Write one shard
- `listFiles()` — Which files have data
- `deleteFileShard(fileHash)` — Remove a shard

### Cross-Shard Queries
- `getFunction(functionId)` — Search across all shards for a function
- `getFunctionsByTable(table)` — Functions that access a specific table
- `getDataAccessByTable(table)` — Data access refs for a table

### Entry Points
- `getEntryPoints()` / `saveEntryPoints(data)` — Aggregated entry point data
- `buildEntryPoints()` — Scans all shards to find entry points
- Entry point type inference: `api`, `handler`, `controller`, `route`, `other`

### Index
```typescript
interface CallGraphIndex {
  generatedAt: string;
  checksum: string;
  totalFiles: number;
  totalFunctions: number;
  totalCalls: number;
  files: Record<string, FileIndexEntry>;
}

interface FileIndexEntry {
  fileHash: string;
  functionCount: number;
  callCount: number;
  dataAccessCount: number;
  entryPoints: string[];
  dataAccessors: string[];
}
```

---

## SecurityShardStore

Partitions security data by table name. Each shard at `.drift/lake/security/{sanitizedTable}.json`.

### Key Methods
- `getTableShard(table)` -> `AccessMapShard | null` — One table's access map
- `getTableShards(tables)` -> `AccessMapShard[]` — Batch load
- `saveTableShard(shard)` — Write one shard
- `listTables()` — Which tables have data
- `deleteTableShard(table)` — Remove a shard

### Cross-Shard Queries
- `getAccessPointsByFile(file)` — Access points in a specific file
- `getSensitiveAccessPoints()` — All access points touching sensitive data

### Sensitive Field Registry
- `getSensitiveFields()` / `saveSensitiveFields(registry)` — Global sensitive field registry
- `buildSensitiveRegistry()` — Scans all shards to build registry

### Security Analysis
- `detectViolations(shard)` — Auto-detect: unprotected access, missing auth, direct DB access
- `calculateRiskScore(shard)` — Per-table risk score
- `calculateOverallRisk(index)` — Aggregate risk level
- `indexToSummaryView(index)` — Convert index to SecuritySummaryView

### Index
```typescript
interface SecurityIndex {
  generatedAt: string;
  checksum: string;
  totalTables: number;
  tables: Record<string, TableIndexEntry>;
  sensitiveTablesCount: number;
  totalAccessPoints: number;
  totalViolations: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
```

---

## ExamplesStore

Stores extracted code examples per pattern at `.drift/lake/examples/{sanitizedPatternId}.json`.

### Key Methods
- `getPatternExamples(patternId)` -> `PatternExamples | null` — One pattern's examples
- `getMultiplePatternExamples(patternIds)` -> `PatternExamples[]` — Batch load
- `savePatternExamples(examples)` — Write one pattern's examples
- `getExamplesByCategory(category)` — Bulk retrieval by category
- `listPatterns()` — Which patterns have examples
- `deletePatternExamples(patternId)` — Remove examples

### Example Extraction
- `extractExamples(pattern, options)` — Reads source files, extracts code snippets with context lines
- `extractSingleExample(location, options)` — Extract one example from a file location
- `calculateExampleQuality(example)` — Scores by length, content, and structure

### Configuration
```typescript
interface ExampleExtractionOptions {
  maxExamples?: number;      // Default: 5
  contextLines?: number;     // Default: 3
  minQuality?: number;       // Default: 0.3
  maxFileSize?: number;      // Default: 1MB
}
```

---

## Common Patterns Across All Shard Stores

### Caching
All stores maintain in-memory caches with `invalidateCache()` and `getCacheStats()`.

### Checksums
All shards include SHA-256 checksums for change detection. `hasShardChanged()` compares stored vs new checksum.

### Index Building
All stores can build their index from raw shard data via `buildIndex()`.

## Rust Rebuild Considerations
- All shard stores are eliminated in v2 (SQLite replaces JSON shards)
- PatternShardStore -> `SELECT * FROM patterns WHERE category = ?`
- CallGraphShardStore -> `SELECT * FROM functions WHERE file = ?`
- SecurityShardStore -> `SELECT * FROM data_access_points WHERE table_name = ?`
- ExamplesStore -> `SELECT * FROM pattern_examples WHERE pattern_id = ?`
- Cross-shard queries become SQL JOINs
- Checksums replaced by SQLite's row versioning
- Caching replaced by SQLite's page cache
