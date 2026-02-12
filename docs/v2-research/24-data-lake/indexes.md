# Data Lake Index Store

## Location
`packages/core/src/lake/index-store.ts`

## Purpose
Fast lookup indexes stored as JSON files. Four index types enable O(1) lookups by file, category, table, and entry point without loading full pattern data.

## Files
- `index-store.ts` — `IndexStore` class (~440 lines)

---

## IndexStore

### File Index
- `getFileIndex()` / `saveFileIndex(index)` — Full file index
- `buildFileIndex(patterns)` — Build from raw patterns
- `getPatternIdsForFile(file)` — O(1) lookup: file -> pattern IDs
- `updateFileIndex(changedFiles, patterns)` — Incremental update

### Category Index
- `getCategoryIndex()` / `saveCategoryIndex(index)` — Full category index
- `buildCategoryIndex(patterns)` — Build from raw patterns
- `getPatternIdsForCategory(category)` — O(1) lookup: category -> pattern IDs

### Table Index
- `getTableIndex()` / `saveTableIndex(index)` — Full table index
- `getAccessPointIdsForTable(table)` — Access points touching a table
- `getAccessorIdsForTable(table)` — Functions accessing a table

### Entry Point Index
- `getEntryPointIndex()` / `saveEntryPointIndex(index)` — Full entry point index
- `getReachableFunctions(entryPointId)` — Functions reachable from entry point
- `getReachableTables(entryPointId)` — Tables reachable from entry point
- `getReachableSensitiveData(entryPointId)` — Sensitive data reachable from entry point

### Management
- `invalidateCache(index?)` — Clear in-memory cache
- `hasIndex(index)` — Check if index file exists
- `deleteIndex(index)` — Remove index file
- `rebuildAllIndexes(patterns)` — Full rebuild of all four indexes

---

## Index Structures

### FileIndex
```typescript
interface FileIndex {
  generatedAt: string;
  checksum: string;
  total: number;
  files: Record<string, string[]>;  // filePath -> patternId[]
}
```

### CategoryIndex
```typescript
interface CategoryIndex {
  generatedAt: string;
  checksum: string;
  total: number;
  categories: Record<PatternCategory, string[]>;  // category -> patternId[]
}
```

### TableIndex
Maps table names to access point IDs and accessor function IDs.

### EntryPointIndex
Maps entry point IDs to reachable functions, tables, and sensitive data fields.

---

## Caching
In-memory cache per index type. Same pattern as ViewStore — populated on first read, invalidated on save.

## Rust Rebuild Considerations
- All four indexes become SQL indexes in `schema.sql`
- `idx_pattern_locations_file` replaces FileIndex
- `idx_patterns_category` replaces CategoryIndex
- Table and entry point indexes become SQL joins on existing tables
- No JSON file I/O — SQLite's B-tree indexes provide O(log n) lookups natively
