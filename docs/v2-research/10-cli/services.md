# CLI Services Layer

## Location
`packages/cli/src/services/`

## Purpose
Business logic layer that sits between commands and core. Commands handle arg parsing and output formatting; services handle orchestration, store creation, and scan coordination.

## Files
- `scanner-service.ts` — `ScannerService`: multi-detector scan orchestration (~1400 lines)
- `pattern-service-factory.ts` — Store creation with auto-detection of SQLite vs JSON
- `boundary-scanner.ts` — Boundary scan orchestration with CLI progress
- `contract-scanner.ts` — Contract scan orchestration with CLI progress
- `backup-service.ts` — Backup create/restore/list (empty — logic lives in `backup.ts` command)

## ScannerService (`scanner-service.ts`)

The largest service. Orchestrates the entire scan pipeline.

### Key Types

```typescript
interface ProjectContext {
  rootDir: string;
  language: string;
  framework: string;
  // ... project metadata for detectors
}

interface ScannerServiceConfig {
  rootDir: string;
  verbose?: boolean;
  useWorkerThreads?: boolean;
  workerCount?: number;
  categories?: string[];
  generateManifest?: boolean;
  incremental?: boolean;
}

interface AggregatedPattern {
  patternId: string;
  detectorId: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  confidence: number;
  locations: Array<{
    file: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  }>;
  outliers: Array<{...}>;
  severity: string;
  autoFixable: boolean;
  metadata: {...};
}

interface ScanResults {
  patterns: AggregatedPattern[];
  violations: AggregatedViolation[];
  filesScanned: number;
  duration: number;
  detectorResults: Map<string, FileScanResult>;
}
```

### Lifecycle

```
1. constructor(config) — stores config
2. initialize() — loads detectors from driftdetect-detectors, optionally creates Piscina worker pool
3. scanFiles(files, projectContext) — runs scan (worker or single-threaded)
4. destroy() — shuts down worker pool
```

### Worker Thread Mode

When `useWorkerThreads: true`:
1. Creates `Piscina` pool with `detector-worker.ts` as the worker script
2. Sends warmup task to each worker (loads detectors once per thread)
3. Distributes files across workers via `pool.run(task)`
4. Aggregates results from all workers via `aggregateWorkerResults()`

Worker task interface:
```typescript
interface DetectorWorkerTask {
  type: 'scan';
  file: string;
  content: string;
  language: string;
  categories?: string[];
  projectContext: ProjectContext;
}
```

### Single-Threaded Mode

When workers disabled (default for small codebases):
1. Iterates files sequentially
2. For each file: reads content, determines language, filters applicable detectors
3. Runs each detector's `detect()` method
4. Aggregates patterns with location deduplication

### Location Deduplication

Two dedup strategies:
- `locationKey(loc)` — `"file:line:column"` for standard locations
- `semanticLocationKey(loc)` — includes function/class context for semantic locations

`addUniqueLocation()` checks existing keys before adding.

### Manifest Generation

When `generateManifest: true`:
- Creates `ManifestStore` from data lake
- For each pattern location, creates a `SemanticLocation` with function/class context
- Extracts semantic info from source lines (function names, class names, etc.)

## PatternServiceFactory (`pattern-service-factory.ts`)

Thin factory that creates pattern stores with auto-detection.

### Functions

```typescript
// Async — auto-detects SQLite vs JSON, returns initialized store
async function createCLIPatternServiceAsync(rootDir: string): Promise<IPatternService>

// Sync — always creates JSON-based PatternStore (backward compat)
function createCLIPatternService(rootDir: string): IPatternService

// Returns both store and service (deprecated)
function createCLIPatternStoreAndService(rootDir: string): { store, service }

// Returns initialized store (auto-detects backend)
async function createCLIPatternStore(rootDir: string): Promise<PatternStoreInterface>

// Returns storage backend info
function getCLIStorageInfo(rootDir: string): { backend, hasSqlite, hasJson, recommended }
```

### Detection Logic

Delegates to `createPatternStore()` from `driftdetect-core/storage` which:
1. Checks if `.drift/drift.db` exists → use SQLite (HybridPatternStore)
2. Checks if `.drift/patterns/*.json` exists → use JSON (PatternStore)
3. Neither exists → default to SQLite (new projects)

## Worker (`workers/detector-worker.ts`)

Piscina worker script that runs detectors in a separate thread.

### Types

```typescript
interface DetectorWorkerTask {
  type: 'scan';
  file: string;
  content: string;
  language: string;
  categories?: string[];
  projectContext: ProjectContext;
}

interface WarmupTask {
  type: 'warmup';
}

interface DetectorWorkerResult {
  file: string;
  patterns: WorkerPatternMatch[];
  violations: WorkerViolation[];
  duration: number;
  detectorCount: number;
  error?: string;
}
```

### Flow

```
1. First call: WarmupTask → loads all detectors via createAllDetectorsArray()
2. Subsequent calls: DetectorWorkerTask → filters applicable detectors by language, runs detect()
3. Returns DetectorWorkerResult with patterns and violations
```

Detectors are loaded once per worker thread and reused across file scans.

## Rust Rebuild Considerations
- `ScannerService` is the primary migration target — Rust replaces the entire scan pipeline
- Worker threads (`Piscina`) become unnecessary: Rust uses Rayon for native parallelism
- `PatternServiceFactory` stays in TS but switches from creating TS stores to wrapping Rust NAPI storage calls
- The auto-detection logic (SQLite vs JSON) moves to Rust's `HybridPatternStore`
- `BoundaryScanner` and `ContractScanner` become thin wrappers around Rust analysis
- Location deduplication (`locationKey`, `semanticLocationKey`) is pure string ops — trivial in Rust
- Manifest generation with `SemanticLocation` extraction benefits from Rust's AST access
- The `AggregatedPattern` type maps to a Rust struct; NAPI serializes it for TS consumption
