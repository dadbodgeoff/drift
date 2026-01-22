# Enterprise Pattern System Consolidation

## Executive Summary

This document proposes a comprehensive consolidation of Drift's pattern detection and storage system. The goal is to transform the current architecture into an enterprise-grade system that is:

- **Unified**: Single source of truth for all pattern data
- **Abstracted**: Clean interfaces that hide implementation details
- **Extensible**: Easy to add new detectors, storage backends, consumers
- **Performant**: Optimized for large codebases with sharding and caching
- **Testable**: Mockable interfaces at every layer

**Current State:**
- 400+ detectors with ~40% code duplication across variants
- 2 separate storage systems with no synchronization
- 5+ consumers with inconsistent access patterns
- No unified abstraction layer

**Target State:**
- Unified detector architecture with composable detection strategies
- Single storage abstraction with pluggable backends
- Unified consumer interface (PatternService)
- 30-40% reduction in codebase complexity

---

## Part 1: The Problems

### Problem 1: Dual Storage Systems (CRITICAL)

**Current State:**
```
.drift/patterns/           ← PatternStore (status-based)
├── discovered/
│   ├── structural.json
│   └── security.json
├── approved/
└── ignored/

.drift/lake/patterns/      ← PatternShardStore (category-based)
├── structural.json
├── security.json
└── api.json
```

**Issues:**
- No automatic synchronization between stores
- Different data models (Pattern vs PatternShardEntry)
- Status only tracked in PatternStore
- Consumers must know which store to use
- Changes in one don't reflect in the other

### Problem 2: Detector Variant Explosion (HIGH)

**Current State:**
Every pattern concept has 3 separate files:
```
file-naming.ts           # AST/regex-based detection
file-naming-learning.ts  # Learns conventions from codebase
file-naming-semantic.ts  # Keyword-based semantic matching
```

**Issues:**
- ~40% code duplication between variants
- 400+ files in detectors package
- Hard to maintain consistency
- Adding a new pattern requires 3 files
- No way to run all variants together

### Problem 3: No Consumer Abstraction (HIGH)

**Current State:**
```typescript
// MCP tool directly uses PatternStore
const patterns = await patternStore.query({ category: 'security' });

// CLI directly uses PatternStore
const pattern = patternStore.get(id);

// Dashboard... who knows?
```

**Issues:**
- Tight coupling to storage implementation
- Can't swap storage backends without changing consumers
- Can't add caching/metrics without modifying each consumer
- Testing requires real storage

### Problem 4: Inconsistent Data Models (MEDIUM)

**Current State:**
```typescript
// PatternStore
interface Pattern {
  confidence: { score: number; level: ConfidenceLevel };
  locations: Location[];
  status: PatternStatus;
}

// PatternShardStore
interface PatternShardEntry {
  confidence: { score: number; level: string };
  locations: PatternLocation[];
  // No status!
}

// Detector output
interface PatternMatch {
  confidence: number; // Just a number!
  location: { file, line, column }; // Singular!
}
```

**Issues:**
- Conversion logic scattered across codebase
- Easy to introduce bugs during conversion
- Hard to reason about data flow

---

## Part 2: The Solution Architecture

### Layer 1: Unified Data Model

**Single Pattern Type:**
```typescript
// packages/core/src/patterns/types.ts

interface Pattern {
  // Identity
  id: string;
  
  // Classification
  category: PatternCategory;
  subcategory: string;
  
  // Metadata
  name: string;
  description: string;
  
  // Detection info
  detectorId: string;
  detectorName: string;
  detectionMethod: DetectionMethod;
  
  // Confidence
  confidence: number;  // 0.0 - 1.0, simple
  confidenceLevel: ConfidenceLevel;  // Computed from score
  
  // Locations
  locations: PatternLocation[];
  outliers: PatternLocation[];
  
  // Status
  status: PatternStatus;
  
  // Severity
  severity: Severity;
  
  // Timestamps
  firstSeen: Date;
  lastSeen: Date;
  approvedAt?: Date;
  approvedBy?: string;
  
  // Tags
  tags: string[];
}

interface PatternLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;  // Code snippet for context
}

type PatternCategory = 
  | 'api' | 'auth' | 'security' | 'errors' | 'logging'
  | 'data-access' | 'config' | 'testing' | 'performance'
  | 'components' | 'styling' | 'structural' | 'types'
  | 'accessibility' | 'documentation';

type PatternStatus = 'discovered' | 'approved' | 'ignored';
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';
type Severity = 'error' | 'warning' | 'info' | 'hint';
type DetectionMethod = 'ast' | 'regex' | 'semantic' | 'learning' | 'structural';
```

### Layer 2: Pattern Repository (Storage Abstraction)

**Interface:**
```typescript
// packages/core/src/patterns/repository.ts

interface IPatternRepository {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // CRUD
  add(pattern: Pattern): Promise<void>;
  addMany(patterns: Pattern[]): Promise<void>;
  get(id: string): Promise<Pattern | null>;
  update(id: string, updates: Partial<Pattern>): Promise<Pattern>;
  delete(id: string): Promise<boolean>;
  
  // Querying
  query(options: PatternQueryOptions): Promise<PatternQueryResult>;
  getByCategory(category: PatternCategory): Promise<Pattern[]>;
  getByStatus(status: PatternStatus): Promise<Pattern[]>;
  getByFile(file: string): Promise<Pattern[]>;
  getAll(): Promise<Pattern[]>;
  count(filter?: PatternFilter): Promise<number>;
  
  // Status transitions
  approve(id: string, approvedBy?: string): Promise<Pattern>;
  ignore(id: string): Promise<Pattern>;
  
  // Batch operations
  saveAll(): Promise<void>;
  
  // Events
  on(event: 'pattern:added' | 'pattern:updated' | 'pattern:deleted' | 'pattern:approved' | 'pattern:ignored', 
     handler: (pattern: Pattern) => void): void;
}

interface PatternQueryOptions {
  filter?: PatternFilter;
  sort?: PatternSort;
  pagination?: { offset: number; limit: number };
}

interface PatternFilter {
  ids?: string[];
  categories?: PatternCategory[];
  statuses?: PatternStatus[];
  minConfidence?: number;
  maxConfidence?: number;
  confidenceLevels?: ConfidenceLevel[];
  severities?: Severity[];
  files?: string[];
  hasOutliers?: boolean;
  tags?: string[];
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

interface PatternSort {
  field: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'locationCount';
  direction: 'asc' | 'desc';
}

interface PatternQueryResult {
  patterns: Pattern[];
  total: number;
  hasMore: boolean;
}
```

**Implementations:**

```typescript
// 1. File-based implementation (current PatternStore behavior)
class FilePatternRepository implements IPatternRepository {
  // Stores patterns in .drift/patterns/{status}/{category}.json
  // Maintains backward compatibility
}

// 2. Sharded implementation (current PatternShardStore behavior)
class ShardedPatternRepository implements IPatternRepository {
  // Stores patterns in .drift/lake/patterns/{category}.json
  // Optimized for large datasets
}

// 3. In-memory implementation (for testing)
class InMemoryPatternRepository implements IPatternRepository {
  // Stores patterns in memory
  // Fast, no I/O
}

// 4. Cached implementation (decorator)
class CachedPatternRepository implements IPatternRepository {
  constructor(private inner: IPatternRepository) {}
  // Adds caching layer on top of any implementation
}
```

### Layer 3: Pattern Service (Consumer Interface)

**Interface:**
```typescript
// packages/core/src/patterns/service.ts

interface IPatternService {
  // Discovery (instant, lightweight)
  getStatus(): Promise<PatternStatus>;
  getCategories(): Promise<CategorySummary[]>;
  
  // Exploration (paginated)
  listPatterns(options: ListOptions): Promise<PaginatedResult<Pattern>>;
  listByCategory(category: PatternCategory, options?: ListOptions): Promise<PaginatedResult<Pattern>>;
  
  // Detail (focused)
  getPattern(id: string): Promise<Pattern | null>;
  getPatternWithExamples(id: string): Promise<PatternWithExamples>;
  getPatternLocations(id: string): Promise<PatternLocation[]>;
  
  // Actions
  approvePattern(id: string, approvedBy?: string): Promise<Pattern>;
  ignorePattern(id: string): Promise<Pattern>;
  
  // Bulk operations
  approveMany(ids: string[]): Promise<Pattern[]>;
  ignoreMany(ids: string[]): Promise<Pattern[]>;
  
  // Search
  search(query: string, options?: SearchOptions): Promise<Pattern[]>;
}

interface PatternStatus {
  totalPatterns: number;
  byStatus: Record<PatternStatus, number>;
  byCategory: Record<PatternCategory, number>;
  byConfidence: Record<ConfidenceLevel, number>;
  lastScanAt: Date;
  healthScore: number;
}

interface CategorySummary {
  category: PatternCategory;
  count: number;
  approvedCount: number;
  discoveredCount: number;
  highConfidenceCount: number;
}

interface PatternWithExamples extends Pattern {
  codeExamples: CodeExample[];
  relatedPatterns: Pattern[];
}

interface CodeExample {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}
```

**Implementation:**
```typescript
class PatternService implements IPatternService {
  constructor(
    private repository: IPatternRepository,
    private codeReader: ICodeReader,
    private cache?: ICache
  ) {}
  
  // Implements all methods using repository
  // Adds business logic (validation, enrichment)
  // Handles caching if provided
}
```

### Layer 4: Unified Detector Architecture

**Current Problem:**
```
file-naming.ts           # 200 lines
file-naming-learning.ts  # 180 lines (40% overlap)
file-naming-semantic.ts  # 150 lines (30% overlap)
```

**Solution: Composite Detector with Strategies**

```typescript
// packages/detectors/src/base/unified-detector.ts

abstract class UnifiedDetector extends BaseDetector {
  // Detection strategies this detector supports
  abstract readonly strategies: DetectionStrategy[];
  
  // Main detection method - runs all strategies
  async detect(context: DetectionContext): Promise<DetectionResult> {
    const results = await Promise.all(
      this.strategies.map(strategy => this.detectWithStrategy(strategy, context))
    );
    return this.mergeResults(results);
  }
  
  // Strategy-specific detection (implemented by subclass)
  protected abstract detectWithStrategy(
    strategy: DetectionStrategy,
    context: DetectionContext
  ): Promise<DetectionResult>;
  
  // Merge results from multiple strategies
  protected mergeResults(results: DetectionResult[]): DetectionResult {
    // Deduplicate by location
    // Take highest confidence for duplicates
    // Combine violations
  }
}

type DetectionStrategy = 'ast' | 'regex' | 'semantic' | 'learning';

// Example: Unified file naming detector
class FileNamingDetector extends UnifiedDetector {
  readonly id = 'structural/file-naming';
  readonly category = 'structural';
  readonly strategies: DetectionStrategy[] = ['structural', 'learning', 'semantic'];
  
  protected async detectWithStrategy(
    strategy: DetectionStrategy,
    context: DetectionContext
  ): Promise<DetectionResult> {
    switch (strategy) {
      case 'structural':
        return this.detectStructural(context);
      case 'learning':
        return this.detectLearning(context);
      case 'semantic':
        return this.detectSemantic(context);
      default:
        return this.createEmptyResult();
    }
  }
  
  // Strategy implementations (previously in separate files)
  private detectStructural(context: DetectionContext): Promise<DetectionResult> { ... }
  private detectLearning(context: DetectionContext): Promise<DetectionResult> { ... }
  private detectSemantic(context: DetectionContext): Promise<DetectionResult> { ... }
}
```

**Benefits:**
- Single file per pattern concept
- All strategies in one place
- Easy to add/remove strategies
- Shared code stays shared
- ~60% reduction in detector files

---

## Part 3: Migration Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Create abstractions without breaking existing code

**Status:** ✅ COMPLETE

**Tasks:**
1. Create unified Pattern type in `packages/core/src/patterns/types.ts`
2. Create IPatternRepository interface
3. Create IPatternService interface
4. Create adapter implementations that wrap existing stores:
   - `PatternStoreAdapter implements IPatternRepository`
   - `PatternShardStoreAdapter implements IPatternRepository`

**Deliverables:**
- New `packages/core/src/patterns/` directory
- Interfaces and types
- Adapter implementations
- Unit tests for adapters

**Implementation Notes (January 2026):**
- Created unified Pattern type with all fields from both legacy systems
- Created IPatternRepository interface with CRUD, querying, status transitions, events
- Created IPatternService interface for consumer API
- Implemented FilePatternRepository, InMemoryPatternRepository, CachedPatternRepository
- Implemented PatternService with caching and business logic
- Created PatternStoreAdapter to bridge legacy PatternStore to IPatternRepository
- Created createPatternServiceFromStore factory for easy migration
- 146 tests passing (121 repository/service + 25 adapter tests)

**Risk:** Low - no changes to existing code

### Phase 2: Consumer Migration (Week 3-4)

**Goal:** Migrate consumers to use new abstractions

**Status:** ✅ COMPLETE

**Tasks:**
1. Create PatternService implementation ✅
2. Update MCP tools to use IPatternService:
   - `drift_patterns_list` ✅ (supports both legacy and service)
   - `drift_pattern_get` ✅ (supports both legacy and service)
   - `drift_status` ✅ (supports both legacy and service)
   - `drift_code_examples` ✅ (supports both legacy and service)
   - `drift_context` - still uses PatternStore directly (complex, deferred)
3. Update CLI commands to use IPatternService:
   - `drift status` ✅
   - `drift approve` ✅
   - `drift ignore` ✅
   - `drift check` ✅
   - `drift files` ✅
   - `drift where` ✅
   - `drift export` ✅
   - `drift report` ✅
   - `drift scan` - still uses PatternStore (writes patterns, complex)
   - `drift init` - still uses PatternStore (initialization, complex)
   - `drift watch` - still uses PatternStore (real-time updates, complex)
4. Update any direct PatternStore usage (pending)

**Deliverables:**
- PatternService implementation ✅
- Updated MCP tools ✅ (4 of 5 pattern-related tools migrated)
- Updated CLI commands ✅ (8 of 11 pattern-related commands migrated)
- Integration tests (pending)

**Implementation Notes (January 2026):**
- Created handlePatternsListWithService, handlePatternGetWithService, handleStatusWithService, handleCodeExamplesWithService
- Enterprise server now creates PatternService by default (usePatternService config)
- Service auto-initializes on first use via AutoInitPatternService wrapper
- Legacy handlers preserved for backward compatibility
- All migrated tools route through service when available
- `drift_context` deferred due to complexity (creates its own stores for multi-project support)
- CLI commands migrated: status, approve, ignore, check, files, where, export, report
- Remaining CLI commands (scan, init, watch) are complex because they write patterns, not just read
- Added write methods to IPatternService: addPattern, addPatterns, updatePattern, deletePattern, save, clear
- 157 tests passing (repository, service, adapter tests)

**Risk:** Medium - changes to consumer code

### Phase 3: Storage Consolidation (Week 5-6)

**Goal:** Unify storage into single implementation

**Status:** ✅ COMPLETE

**Tasks:**
1. Create unified FilePatternRepository that: ✅
   - Stores patterns by category (like PatternShardStore)
   - Tracks status (like PatternStore)
   - Supports all query operations
2. Create migration script to move data ✅
3. Deprecate PatternStore and PatternShardStore ✅
4. Create repository factory for auto-detection ✅

**Deliverables:**
- `UnifiedFilePatternRepository` implementation ✅
- Migration CLI command (`drift migrate-storage`) ✅
- Repository factory (`createPatternRepository`) ✅
- 29 new tests for unified repository ✅
- Deprecation notices on legacy stores ✅

**Implementation Notes (January 2026):**
- Created `UnifiedFilePatternRepository` in `packages/core/src/patterns/impl/unified-file-repository.ts`
- New storage format: `.drift/patterns/{category}.json` with status field per pattern (version 2.0)
- Auto-migration from legacy format on initialize (configurable)
- Incremental save support (only dirty categories)
- Storage stats API for monitoring
- Repository factory `createPatternRepository()` auto-detects format and migrates if needed
- CLI command `drift migrate-storage` with:
  - `--dry-run` to preview migration
  - `--backup` (default) to create backup before migration
  - `--keep-legacy` to preserve old format files
  - `rollback` subcommand to restore from backup
  - `status` subcommand to check current format
- Added deprecation warnings to:
  - `PatternStore` (legacy status-based store)
  - `PatternShardStore` (legacy lake store)
  - `FilePatternRepository` (legacy repository implementation)

**Risk:** Medium-High - data migration required

### Phase 4: Detector Consolidation (Week 7-10)

**Goal:** Unify detector variants into single files

**Tasks:**
1. Create UnifiedDetector base class
2. Create migration script to combine detector variants
3. Migrate detectors category by category:
   - structural (8 detectors)
   - security (8 detectors)
   - api (6 detectors)
   - ... etc
4. Update detector registry
5. Remove old detector files

**Deliverables:**
- UnifiedDetector base class
- Migrated detectors (~130 unified detectors)
- Updated registry
- Removed ~270 duplicate files

**Risk:** High - large code changes, but well-tested

### Phase 5: Optimization (Week 11-12)

**Goal:** Performance and polish

**Tasks:**
1. Add caching layer (CachedPatternRepository)
2. Add incremental sync support
3. Add metrics collection
4. Performance testing
5. Documentation updates

**Deliverables:**
- Caching implementation
- Incremental sync
- Metrics
- Performance benchmarks
- Updated documentation

**Risk:** Low - additive changes

---

## Part 4: File Structure (Target State)

```
packages/core/src/
├── patterns/                    # NEW: Unified pattern system
│   ├── types.ts                 # Pattern, PatternLocation, etc.
│   ├── repository.ts            # IPatternRepository interface
│   ├── service.ts               # IPatternService interface
│   ├── impl/
│   │   ├── file-repository.ts   # File-based implementation
│   │   ├── cached-repository.ts # Caching decorator
│   │   └── memory-repository.ts # In-memory (testing)
│   └── index.ts
├── store/                       # DEPRECATED: Old pattern store
│   └── pattern-store.ts         # Marked deprecated
└── lake/                        # DEPRECATED: Old shard store
    └── pattern-shard-store.ts   # Marked deprecated

packages/detectors/src/
├── base/
│   ├── unified-detector.ts      # NEW: Composite detector base
│   ├── base-detector.ts         # Keep for compatibility
│   └── strategies/              # NEW: Detection strategies
│       ├── ast-strategy.ts
│       ├── regex-strategy.ts
│       ├── semantic-strategy.ts
│       └── learning-strategy.ts
├── structural/
│   ├── file-naming.ts           # UNIFIED: All strategies in one
│   ├── import-ordering.ts
│   └── ...
├── security/
│   ├── sql-injection.ts         # UNIFIED
│   └── ...
└── ...
```

---

## Part 5: Success Metrics

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Detector files | ~400 | ~130 | 67% reduction |
| Storage implementations | 2 | 1 | 50% reduction |
| Lines of code (detectors) | ~50,000 | ~30,000 | 40% reduction |
| Consumer coupling | Direct | Abstracted | 100% improvement |
| Test coverage | ~70% | ~90% | 20% improvement |
| Time to add new detector | 3 files | 1 file | 67% reduction |

---

## Part 6: Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | High | Backup before migration, rollback plan |
| Breaking existing consumers | Medium | High | Adapter pattern, gradual migration |
| Performance regression | Low | Medium | Benchmark before/after, caching |
| Detector behavior changes | Medium | Medium | Comprehensive test suite, comparison tests |
| Timeline slip | Medium | Low | Phased approach, can stop at any phase |

---

## Part 7: Decision Points

### Decision 1: Storage Format

**Option A: Keep status-based directories**
```
.drift/patterns/discovered/structural.json
.drift/patterns/approved/structural.json
```
- Pro: Backward compatible
- Con: More files, harder to query across statuses

**Option B: Category-based with status field**
```
.drift/patterns/structural.json  # Contains all statuses
```
- Pro: Simpler, fewer files
- Con: Breaking change

**Recommendation:** Option B with migration script

### Decision 2: Detector Consolidation Approach

**Option A: Merge into single file**
- All strategies in one file
- ~500-800 lines per detector
- Pro: Everything in one place
- Con: Large files

**Option B: Strategy files with coordinator**
- Coordinator file + strategy files
- ~200-300 lines each
- Pro: Smaller files
- Con: More files, more complexity

**Recommendation:** Option A for most detectors, Option B for complex ones

### Decision 3: Backward Compatibility

**Option A: Full backward compatibility**
- Keep old APIs working
- Deprecation warnings
- Remove in next major version

**Option B: Clean break**
- Remove old APIs immediately
- Force migration

**Recommendation:** Option A - deprecate, don't remove

---

## Appendix A: Detector Migration Template

```typescript
// Before: 3 files
// file-naming.ts (200 lines)
// file-naming-learning.ts (180 lines)  
// file-naming-semantic.ts (150 lines)
// Total: 530 lines, 40% duplication

// After: 1 file
// file-naming.ts (~350 lines)

import { UnifiedDetector, DetectionStrategy } from '../base/unified-detector.js';

export class FileNamingDetector extends UnifiedDetector {
  readonly id = 'structural/file-naming';
  readonly name = 'File Naming Convention Detector';
  readonly description = 'Detects and enforces file naming conventions';
  readonly category = 'structural';
  readonly subcategory = 'naming';
  readonly supportedLanguages = ['typescript', 'javascript', 'python', 'java', 'csharp', 'php'];
  readonly strategies: DetectionStrategy[] = ['structural', 'learning', 'semantic'];

  // Shared state
  private learnedConventions: Map<string, LearnedConvention> = new Map();

  protected async detectWithStrategy(
    strategy: DetectionStrategy,
    context: DetectionContext
  ): Promise<DetectionResult> {
    switch (strategy) {
      case 'structural':
        return this.detectStructural(context);
      case 'learning':
        return this.detectLearning(context);
      case 'semantic':
        return this.detectSemantic(context);
      default:
        return this.createEmptyResult();
    }
  }

  // ============================================================
  // Structural Detection (from file-naming.ts)
  // ============================================================
  
  private async detectStructural(context: DetectionContext): Promise<DetectionResult> {
    // ... structural detection logic
  }

  // ============================================================
  // Learning Detection (from file-naming-learning.ts)
  // ============================================================
  
  private async detectLearning(context: DetectionContext): Promise<DetectionResult> {
    // ... learning detection logic
  }

  // ============================================================
  // Semantic Detection (from file-naming-semantic.ts)
  // ============================================================
  
  private async detectSemantic(context: DetectionContext): Promise<DetectionResult> {
    // ... semantic detection logic
  }

  // ============================================================
  // Shared Utilities
  // ============================================================
  
  private extractNamingPattern(filename: string): NamingPattern {
    // ... shared logic
  }
}
```

---

## Appendix B: Repository Migration Script

```typescript
// scripts/migrate-pattern-storage.ts

import { PatternStore } from '../packages/core/src/store/pattern-store.js';
import { PatternShardStore } from '../packages/core/src/lake/pattern-shard-store.js';
import { FilePatternRepository } from '../packages/core/src/patterns/impl/file-repository.js';

async function migrate(rootDir: string) {
  console.log('Starting pattern storage migration...');
  
  // 1. Load from old PatternStore
  const oldStore = new PatternStore({ rootDir });
  await oldStore.initialize();
  const patterns = oldStore.getAll();
  console.log(`Loaded ${patterns.length} patterns from PatternStore`);
  
  // 2. Create new repository
  const newRepo = new FilePatternRepository({ rootDir });
  await newRepo.initialize();
  
  // 3. Migrate patterns
  for (const pattern of patterns) {
    await newRepo.add(pattern);
  }
  console.log(`Migrated ${patterns.length} patterns to new repository`);
  
  // 4. Save
  await newRepo.saveAll();
  
  // 5. Verify
  const count = await newRepo.count();
  console.log(`Verification: ${count} patterns in new repository`);
  
  // 6. Backup old data
  // ... backup logic
  
  console.log('Migration complete!');
}
```

---

## Conclusion

This consolidation plan transforms Drift's pattern system from a collection of overlapping implementations into a clean, enterprise-grade architecture. The phased approach minimizes risk while delivering incremental value at each stage.

**Key Benefits:**
- 67% reduction in detector files
- Single source of truth for pattern storage
- Clean abstractions for all consumers
- Easier to extend and maintain
- Better test coverage

**Timeline:** 12 weeks (can be extended if needed)

**Next Steps:**
1. Review and approve this plan
2. Create tracking issues for each phase
3. Begin Phase 1: Foundation
