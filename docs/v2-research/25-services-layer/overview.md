# Services / Orchestration Layer — Overview

## Location
`packages/core/src/services/` — 100% TypeScript (~3 source files, ~1600 lines)

## What It Is
The orchestration layer between CLI/MCP and the core detection engine. Coordinates pattern detection across files using worker threads, aggregates results, and generates manifests. Previously duplicated in both `packages/cli/` and `packages/mcp/`, now consolidated into `packages/core/` as shared infrastructure.

## Core Design Principles
1. Parallel processing via Piscina worker threads (CPU-bound detection)
2. Warmup phase preloads detectors in all workers before scanning
3. Results aggregated and deduplicated across files
4. Graceful fallback to single-threaded mode if workers unavailable
5. Full metadata preservation from detector through to consumer

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              CLI / MCP Server                            │
│  drift scan | MCP tool handlers                          │
├─────────────────────────────────────────────────────────┤
│              ScannerService                              │
│  Worker pool | Aggregation | Outlier detection | Manifest│
├─────────────────────────────────────────────────────────┤
│              DetectorWorker (Piscina threads)             │
│  Load detectors | Parse file | Run detectors | Return    │
├─────────────────────────────────────────────────────────┤
│              driftdetect-detectors                        │
│  22 categories | 100+ detectors | AST + regex + semantic │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `scanner-service.ts` — `ScannerService`: main orchestrator
- `detector-worker.ts` — Worker thread entry point
- `index.ts` — Barrel exports

## Subsystem Directory Map

| File | Purpose | Doc |
|------|---------|-----|
| `scanner-service.ts` | Scanning orchestration, worker pool, aggregation | [scanner-service.md](./scanner-service.md) |
| `detector-worker.ts` | Worker thread: loads detectors, processes files | [detector-worker.md](./detector-worker.md) |

## Scan Pipeline

```
1. Create worker pool (Piscina, CPU cores - 1)
2. Warmup: preload detectors in all workers
3. Dispatch: one DetectorWorkerTask per file
4. Collect: DetectorWorkerResult per file
5. Aggregate: group patterns by ID, merge locations
6. Outlier detection: statistical analysis on aggregated patterns
7. Manifest generation (if configured)
8. Return ScanResults
```

## Data Flow

```
Detector emits PatternMatch
  -> WorkerPatternMatch preserves endLine, endColumn, isOutlier, matchedText, metadata
    -> AggregatedPattern merges locations with all metadata intact
      -> Pattern (stored) retains locations with full range + outlier info
        -> MCP response includes all metadata for IDE highlighting
```

## V2 Implications
- Keep: ScannerService orchestration, worker pool, aggregation logic
- Change: Workers call Rust NAPI for detection instead of TS detectors
- Change: Results go directly to SQLite via Rust NAPI instead of JSON stores
- Keep: ProjectContext, ScanResults, AggregatedPattern types
- Remove: Manifest generation (replaced by SQLite stats)
- Keep: Outlier detection (statistical analysis stays in TS)
