# Pattern Repository Interface

## Location
`packages/core/src/patterns/repository.ts`

## Purpose
Defines the storage abstraction layer for patterns. All storage implementations must implement this interface, enabling swappable backends, consistent API for all consumers, easy testing with mocks, and caching decorators.

## IPatternRepository

### Lifecycle
- `initialize()` — Create directories/structures, load existing data
- `close()` — Release resources

### CRUD
- `add(pattern)` — Add new pattern (throws if ID exists)
- `addMany(patterns[])` — Bulk add
- `get(id)` → `Pattern | null`
- `update(id, updates)` → `Pattern` (throws if not found)
- `delete(id)` → `boolean`

### Querying
- `query(options)` → `PatternQueryResult` — Full filter/sort/pagination
- `getByCategory(category)` → `Pattern[]`
- `getByStatus(status)` → `Pattern[]`
- `getByFile(file)` → `Pattern[]`
- `getAll()` → `Pattern[]`
- `count(filter?)` → `number`

### Status Transitions
- `approve(id, approvedBy?)` → `Pattern` (throws on invalid transition)
- `ignore(id)` → `Pattern` (throws on invalid transition)

### Batch Operations
- `saveAll()` — Persist pending changes
- `clear()` — Remove all patterns

### Events
- `on(event, handler)` — Subscribe
- `off(event, handler)` — Unsubscribe

### Utilities
- `exists(id)` → `boolean`
- `getSummaries(options?)` → `PatternSummary[]`

---

## Query Types

### PatternFilter
```typescript
interface PatternFilter {
  ids?: string[];
  categories?: PatternCategory[];
  statuses?: PatternStatus[];
  minConfidence?: number;
  maxConfidence?: number;
  confidenceLevels?: ConfidenceLevel[];
  severities?: Severity[];
  files?: string[];              // patterns with locations in these files
  hasOutliers?: boolean;
  tags?: string[];
  search?: string;               // name + description text search
  createdAfter?: Date;
  createdBefore?: Date;
}
```

### PatternSort
```typescript
interface PatternSort {
  field: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'locationCount';
  direction: 'asc' | 'desc';
}
```

### PatternPagination
```typescript
interface PatternPagination {
  offset: number;
  limit: number;
}
```

### PatternQueryOptions
```typescript
interface PatternQueryOptions {
  filter?: PatternFilter;
  sort?: PatternSort;
  pagination?: PatternPagination;
}
```

### PatternQueryResult
```typescript
interface PatternQueryResult {
  patterns: Pattern[];
  total: number;       // before pagination
  hasMore: boolean;
}
```

---

## Event Types
```typescript
type PatternRepositoryEventType =
  | 'pattern:added'
  | 'pattern:updated'
  | 'pattern:deleted'
  | 'pattern:approved'
  | 'pattern:ignored'
  | 'patterns:loaded'
  | 'patterns:saved';

type PatternRepositoryEventHandler = (
  pattern?: Pattern,
  metadata?: Record<string, unknown>
) => void;
```

---

## Repository Configuration
```typescript
interface PatternRepositoryConfig {
  rootDir: string;
  autoSave?: boolean;           // Default: true
  autoSaveDelayMs?: number;     // Default: 1000
  validateSchema?: boolean;     // Default: true
}
```

## Rust Rebuild Considerations
- The interface maps cleanly to a Rust trait
- Query filtering is pure predicate evaluation — ideal for Rust iterators
- Sorting uses `Ord` trait implementations
- Pagination is slice operations
- Events map to Rust channels (`tokio::broadcast` or `crossbeam`)
- Status transition validation is a simple `match` expression
