# Pattern Repository — Implementations

> `packages/core/src/patterns/impl/` — 7 files
> Four repository implementations + service + factory.

## Repository Implementations

### 1. FilePatternRepository (Legacy — Deprecated)

> `impl/file-repository.ts` — ~680 lines

Status-based directory layout matching the original `PatternStore` format.

**Storage format:**
```
.drift/patterns/
├── discovered/
│   ├── api.json
│   ├── auth.json
│   └── ...
├── approved/
│   ├── api.json
│   └── ...
└── ignored/
    └── ...
```

Each JSON file contains patterns for one category within one status directory.

**Key behaviors:**
- Loads all patterns into memory on `initialize()`
- Groups patterns by status and category for file I/O
- Auto-save with configurable debounce (default: 1000ms)
- Generates checksums for integrity verification
- Converts between internal `Pattern` type and stored `StoredPattern` format

**When to use:** Only for backward compatibility with existing `.drift/patterns/{status}/` layouts.

### 2. UnifiedFilePatternRepository (Recommended)

> `impl/unified-file-repository.ts` — ~880 lines

Category-based layout with status as a field. This is the recommended format.

**Storage format:**
```
.drift/patterns/
├── api.json          # All API patterns (discovered + approved + ignored)
├── auth.json
├── security.json
├── errors.json
└── ...
```

Each JSON file is a `UnifiedPatternFile`:
```typescript
interface UnifiedPatternFile {
  version: '2.0';
  category: PatternCategory;
  updatedAt: string;
  checksum: string;
  statusCounts: Record<PatternStatus, number>;
  patterns: UnifiedPatternEntry[];
}
```

**Key behaviors:**
- Incremental saves — only writes dirty categories (tracks via `dirtyCategories` Set)
- Auto-migration from legacy format on initialization (configurable)
- Can optionally keep legacy files after migration (`keepLegacyFiles` config)
- Storage stats: `getStorageStats()` returns file count, total patterns, and per-category counts
- Version 2.x format detection for the repository factory

**Configuration:**
```typescript
interface UnifiedRepositoryConfig {
  rootDir: string;
  autoSave?: boolean;           // Default: true
  autoSaveDelayMs?: number;     // Default: 1000
  autoMigrate?: boolean;        // Default: true
  keepLegacyFiles?: boolean;    // Default: true
}
```

### 3. InMemoryPatternRepository (Testing)

> `impl/memory-repository.ts` — ~400 lines

Pure in-memory implementation backed by a `Map<string, Pattern>`.

**Key behaviors:**
- No file I/O — all operations are synchronous (wrapped in Promises for interface compliance)
- Full query/filter/sort support matching the file-based implementations
- `seed(patterns)` method for test setup
- `getInternalMap()` for test assertions
- `saveAll()` is a no-op

**When to use:** Unit tests, integration tests, benchmarks.

### 4. CachedPatternRepository (Decorator)

> `impl/cached-repository.ts` — ~400 lines

Transparent caching decorator that wraps any `IPatternRepository`.

**Cache layers:**
- **Pattern cache:** `Map<string, CacheEntry<Pattern>>` — individual pattern lookups
- **Query cache:** `Map<string, CacheEntry<PatternQueryResult>>` — query results
- **Count cache:** `Map<string, CacheEntry<number>>` — count results
- **All patterns cache:** Single entry for `getAll()` results

**Configuration:**
```typescript
interface CacheConfig {
  ttlMs: number;           // Default: 60000 (1 minute)
  maxPatternEntries: number; // Default: 1000
  maxQueryEntries: number;   // Default: 100
}
```

**Invalidation strategy:**
- Write operations (`add`, `update`, `delete`, `approve`, `ignore`, `clear`) invalidate all caches
- Individual pattern updates also invalidate that specific pattern's cache entry
- Query and count caches are fully invalidated on any write (conservative approach)

**Cache stats:**
```typescript
getCacheStats(): {
  patternCacheSize: number;
  queryCacheSize: number;
  countCacheSize: number;
  hasAllPatternsCache: boolean;
}
```

**Event forwarding:** All events from the inner repository are forwarded through the cache decorator.

## PatternService Implementation

> `impl/pattern-service.ts` — ~400 lines

Implements `IPatternService` on top of any `IPatternRepository`.

**Constructor:**
```typescript
constructor(repository: IPatternRepository, rootDir: string, config?: Partial<PatternServiceConfig>)
```

**Key behaviors:**

- **Status caching:** Caches `PatternSystemStatus` with configurable TTL. Invalidated on any write operation.
- **Health score computation:** Weighted formula (40% approval rate + 30% high confidence rate + 30% low outlier rate)
- **Code example extraction:** Reads source files from disk, extracts context lines around pattern locations. Language detected from file extension (25 extensions mapped).
- **Related patterns:** When fetching a pattern with examples, also returns up to 4 related patterns from the same category.
- **Pagination:** Converts `ListOptions` to `PatternQueryOptions` with default limit of 20.

**Language detection** (for code examples):
```
.ts/.tsx → typescript, .js/.jsx → javascript, .py → python,
.java → java, .cs → csharp, .go → go, .rs → rust,
.rb → ruby, .php → php, .swift → swift, .kt → kotlin,
.scala → scala, .vue → vue, .svelte → svelte, etc.
```

## Repository Factory

> `impl/repository-factory.ts` — ~170 lines

Auto-detects storage format and creates the appropriate repository.

### Format Detection

```typescript
async function detectStorageFormat(rootDir: string): Promise<'unified' | 'legacy' | 'none'>
```

Detection logic:
1. Check for unified format: Look for category files (`api.json`, `auth.json`, etc.) with `version: '2.x'`
2. Check for legacy format: Look for status directories (`discovered/`, `approved/`, `ignored/`)
3. If neither found: `'none'`

### Factory Function

```typescript
async function createPatternRepository(config?: Partial<RepositoryFactoryConfig>): Promise<IPatternRepository>
```

| Detected Format | `autoMigrate` | Result |
|----------------|---------------|--------|
| `unified` | — | `UnifiedFilePatternRepository` (no migration) |
| `legacy` | `true` | `UnifiedFilePatternRepository` (with migration) |
| `legacy` | `false` | `FilePatternRepository` (legacy) |
| `none` | — | `UnifiedFilePatternRepository` (fresh) |

**Sync variant:** `createPatternRepositorySync()` always creates `UnifiedFilePatternRepository` with `autoMigrate: true`.

### Factory Configuration

```typescript
interface RepositoryFactoryConfig {
  rootDir: string;
  autoSave?: boolean;           // Default: true
  autoSaveDelayMs?: number;     // Default: 1000
  validateSchema?: boolean;     // Default: true
  preferUnified?: boolean;      // Default: true
  autoMigrate?: boolean;        // Default: true
  keepLegacyFiles?: boolean;    // Default: true
}
```
