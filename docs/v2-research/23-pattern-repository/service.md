# Pattern Service Interface

## Location
`packages/core/src/patterns/service.ts` (interface)
`packages/core/src/patterns/impl/pattern-service.ts` (implementation)

## Purpose
Consumer-facing API for pattern operations. All consumers (MCP tools, CLI, Dashboard) should use this interface instead of directly accessing the repository. Provides higher-level operations, business logic (validation, enrichment), caching, and metrics.

## Files
- `service.ts` — `IPatternService` interface + supporting types
- `impl/pattern-service.ts` — `PatternService` implementation

---

## IPatternService

### Discovery (instant, lightweight)
- `getStatus()` → `PatternSystemStatus` — Total counts, breakdowns, health score
- `getCategories()` → `CategorySummary[]` — Per-category counts

### Exploration (paginated)
- `listPatterns(options?)` → `PaginatedResult<PatternSummary>`
- `listByCategory(category, options?)` → `PaginatedResult<PatternSummary>`
- `listByStatus(status, options?)` → `PaginatedResult<PatternSummary>`

### Detail (focused)
- `getPattern(id)` → `Pattern | null`
- `getPatternWithExamples(id, maxExamples?)` → `PatternWithExamples | null`
- `getPatternsByFile(file)` → `Pattern[]`

### Actions
- `approvePattern(id, approvedBy?)` → `Pattern`
- `ignorePattern(id)` → `Pattern`
- `approveMany(ids[], approvedBy?)` → `Pattern[]`
- `ignoreMany(ids[])` → `Pattern[]`

### Search
- `search(query, options?)` → `PatternSummary[]`

### Advanced Queries
- `query(options)` → `PatternQueryResult`

### Write Operations (for producers like scan)
- `addPattern(pattern)` → `void`
- `addPatterns(patterns[])` → `void`
- `updatePattern(id, updates)` → `Pattern`
- `deletePattern(id)` → `boolean`
- `save()` → `void`
- `clear()` → `void`

---

## Supporting Types

### PatternSystemStatus
```typescript
interface PatternSystemStatus {
  totalPatterns: number;
  byStatus: Record<PatternStatus, number>;
  byCategory: Record<PatternCategory, number>;
  byConfidence: Record<ConfidenceLevel, number>;
  lastScanAt: Date | null;
  healthScore: number;  // 0–100
}
```

### CategorySummary
```typescript
interface CategorySummary {
  category: PatternCategory;
  count: number;
  approvedCount: number;
  discoveredCount: number;
  highConfidenceCount: number;
}
```

### PatternWithExamples
```typescript
interface PatternWithExamples extends Pattern {
  codeExamples: CodeExample[];
  relatedPatterns: PatternSummary[];
}

interface CodeExample {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}
```

### ListOptions
```typescript
interface ListOptions {
  offset?: number;
  limit?: number;
  sortBy?: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'locationCount';
  sortDirection?: 'asc' | 'desc';
}
```

### PaginatedResult
```typescript
interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}
```

### SearchOptions
```typescript
interface SearchOptions {
  categories?: PatternCategory[];
  statuses?: PatternStatus[];
  minConfidence?: number;
  limit?: number;
}
```

---

## PatternService Implementation

### Health Score Computation
The service computes a health score (0–100) from pattern data. Factors include average confidence, approval ratio, compliance rate, and pattern distribution.

### Status Cache
In-memory cache for `PatternSystemStatus` with configurable TTL (default 60s). Invalidated on any write operation.

### Code Example Extraction
`getPatternWithExamples()` reads source files from disk, extracts code snippets around pattern locations with configurable context lines (default 5). Detects language from file extension (supports 25+ extensions).

### Configuration
```typescript
interface PatternServiceConfig {
  enableCache?: boolean;           // Default: true
  cacheTtlMs?: number;            // Default: 60000 (1 minute)
  enableMetrics?: boolean;         // Default: true
  codeExampleContextLines?: number; // Default: 5
}
```

## Rust Rebuild Considerations
- The interface maps to a Rust trait
- Health score computation is pure math — trivial to port
- Code example extraction involves file I/O — Rust's `tokio::fs` handles this
- Status cache maps to `tokio::sync::RwLock<Option<CachedStatus>>`
- Language detection from extension is a static `HashMap`
