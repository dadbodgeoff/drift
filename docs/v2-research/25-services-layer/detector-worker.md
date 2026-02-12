# Detector Worker

## Location
`packages/core/src/services/detector-worker.ts`

## Purpose
Worker thread entry point that runs in a separate Piscina thread. Loads detectors once per worker (cached), processes a single file through all applicable detectors, and returns pattern matches and violations with full metadata preserved.

## Files
- `detector-worker.ts` — Worker module (~350 lines)

---

## Task Types

### WarmupTask
Preloads detectors without processing files. Sent during initialization to prime all workers.
```typescript
interface WarmupTask {
  type: 'warmup';
  categories?: string[];
  criticalOnly?: boolean;
}

interface WarmupResult {
  type: 'warmup';
  detectorsLoaded: number;
  duration: number;
}
```

### DetectorWorkerTask
Processes a single file through all applicable detectors.
```typescript
interface DetectorWorkerTask {
  type?: 'scan';
  file: string;
  rootDir: string;
  projectFiles: string[];
  projectConfig: Record<string, unknown>;
  detectorIds?: string[];
  categories?: string[];
  criticalOnly?: boolean;
}
```

---

## Worker Result
```typescript
interface DetectorWorkerResult {
  file: string;
  language: string | null;
  patterns: WorkerPatternMatch[];
  violations: WorkerViolation[];
  detectorsRan: number;
  detectorsSkipped: number;
  duration: number;
}
```

---

## WorkerPatternMatch
```typescript
interface WorkerPatternMatch {
  patternId: string;
  detectorId: string;
  detectorName: string;
  detectorDescription: string;
  category: string;
  subcategory: string;
  confidence: number;
  location: {
    file: string;
    line: number;
    column: number;
    endLine?: number;      // full range highlighting
    endColumn?: number;
  };
  isOutlier?: boolean;
  outlierReason?: string;
  matchedText?: string;
  metadata?: Record<string, unknown>;  // auth types, route info, etc.
}
```

---

## WorkerViolation
```typescript
interface WorkerViolation {
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

## Processing Flow

1. Receive task (warmup or scan)
2. If warmup: load detectors from `driftdetect-detectors`, cache them, return count
3. If scan:
   a. Read file content from disk
   b. Detect language from file extension
   c. Load applicable detectors (from cache or fresh)
   d. Filter by categories/criticalOnly if specified
   e. Build `DetectionContext` with file content, language, project files, config
   f. Run each detector on the context
   g. Collect pattern matches and violations
   h. Return `DetectorWorkerResult`

## Detector Caching
Detectors are loaded once per worker thread via `createAllDetectorsArray()` from `driftdetect-detectors`. The loaded array is cached in module scope — subsequent tasks reuse the same detector instances.

## Language Detection
Maps file extensions to language identifiers. Supports 25+ extensions including TypeScript, Python, Java, C#, PHP, Go, Rust, Swift, Kotlin, Scala, CSS/SCSS/LESS, HTML, Vue, Svelte, JSON, YAML, Markdown, SQL.

## Metadata Preservation
All metadata from detectors is preserved end-to-end:
- `endLine`/`endColumn` for full range highlighting in IDE
- `isOutlier`/`outlierReason` for deviation tracking
- `matchedText` for context display
- Custom `metadata` for detector-specific data (auth types, route info, etc.)

## Rust Rebuild Considerations
- The worker becomes a Rust function called via NAPI
- Detector loading and caching moves to Rust (static initialization)
- File reading uses Rust's `std::fs` (faster than Node's `fs`)
- Language detection is a static `HashMap` in Rust
- Pattern matching runs natively in Rust (no JS overhead)
- The worker thread model may be replaced by Rust's `rayon` thread pool
