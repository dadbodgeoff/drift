# Scanner Service

## Location
`packages/core/src/services/scanner-service.ts`

## Purpose
Central orchestrator for pattern detection. Manages a Piscina worker thread pool, dispatches file processing tasks, aggregates results across files, runs outlier detection, and optionally generates manifests.

## Files
- `scanner-service.ts` — `ScannerService` class (~1200 lines)

---

## Configuration
```typescript
interface ScannerServiceConfig {
  rootDir: string;
  verbose?: boolean;
  categories?: string[];          // filter detectors by category
  criticalOnly?: boolean;         // only high-value detectors
  generateManifest?: boolean;     // produce semantic manifest
  incremental?: boolean;          // only scan changed files
  useWorkerThreads?: boolean;     // enable Piscina (default: true)
  workerThreads?: number;         // thread count (default: CPU cores - 1)
}
```

---

## Worker Thread Pool

Uses [Piscina](https://github.com/piscinajs/piscina) for parallel CPU-bound processing:
- Thread count defaults to `os.cpus().length - 1`
- Workers warmed up before scanning (preload detectors)
- Each worker caches loaded detectors for reuse across files
- Graceful fallback to single-threaded mode if Piscina unavailable
- Worker stats tracked: threads used, tasks completed, queue size

---

## Scan Pipeline

### 1. Initialization
Create worker pool, resolve detector worker path.

### 2. Warmup
Send `WarmupTask` to each worker to preload detectors. Returns detector count and duration.

### 3. Task Dispatch
Create `DetectorWorkerTask` per file, submit to pool. Each task includes file path, root dir, project files list, project config, and detector filters.

### 4. Collection
Gather `DetectorWorkerResult` per file. Each result includes detected language, pattern matches, violations, detector stats, and duration.

### 5. Aggregation
Group pattern matches by `patternId` across all files. Merge locations into single `AggregatedPattern`. Merge metadata from all detectors.

### 6. Outlier Detection
Run `OutlierDetector` on aggregated patterns. Statistical analysis (Z-score, IQR) identifies locations that deviate from the established pattern.

### 7. Manifest Generation
If `generateManifest: true`, build `Manifest` with semantic locations for each pattern.

### 8. Result Assembly
Package into `ScanResults`.

---

## ProjectContext
```typescript
interface ProjectContext {
  rootDir: string;
  files: string[];
  config: Record<string, unknown>;
}
```
Passed to each detector worker so detectors have project-wide context even though they process one file at a time.

---

## Aggregation Logic

### AggregatedPattern
```typescript
interface AggregatedPattern {
  patternId: string;
  detectorId: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  locations: Array<{
    file: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    isOutlier?: boolean;
    outlierReason?: string;
    matchedText?: string;
    confidence?: number;
  }>;
  confidence: number;
  occurrences: number;
  outlierCount: number;
  metadata?: Record<string, unknown>;
}
```

When the same `patternId` appears in multiple files, locations are merged. Metadata from all detectors is merged. Outlier counts tracked per-pattern.

### AggregatedViolation
```typescript
interface AggregatedViolation {
  patternId: string;
  detectorId: string;
  category: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  file: string;
  line: number;
  column: number;
  message: string;
  explanation?: string;
  suggestedFix?: string;
}
```

---

## ScanResults
```typescript
interface ScanResults {
  files: FileScanResult[];
  patterns: AggregatedPattern[];
  violations: AggregatedViolation[];
  totalPatterns: number;
  totalViolations: number;
  totalFiles: number;
  duration: number;
  errors: string[];
  detectorStats: {
    total: number;
    ran: number;
    skipped: number;
  };
  manifest?: Manifest;
  workerStats?: {
    threads: number;
    tasksCompleted: number;
    avgTaskDuration: number;
  };
}
```

---

## Consumer Integration

### CLI Path
```
drift scan -> ScannerService.scanFiles() -> ScanResults
  -> PatternStore/PatternService for persistence
  -> ViewMaterializer for lake rebuild
  -> Reporters for output
```

### MCP Path
```
MCP tool handler -> ScannerService.scanFiles() -> ScanResults
  -> PatternService + Data Lake update
  -> Formatted response to MCP client
```

## Rust Rebuild Considerations
- The MPSC channel pattern from Rust's `CallGraphDb` should be adopted: workers parse in parallel, results written sequentially to SQLite
- Worker threads call Rust NAPI for detection instead of TS detectors
- Aggregation logic stays in TS (or moves to Rust for performance)
- Outlier detection stays in TS (statistical analysis)
- Manifest generation removed (SQLite stats replace it)
- Piscina replaced by Rust's `rayon` or `tokio` task pool
