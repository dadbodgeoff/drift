# Detection Pipeline — End-to-End

## Location
Spans multiple packages:
- `packages/core/src/scanner/` — File walking
- `packages/core/src/parsers/` — AST parsing
- `packages/detectors/` — Pattern detection
- `packages/core/src/matcher/` — Matching, scoring, outliers
- `packages/core/src/rules/` — Violation generation
- `packages/core/src/storage/` — Persistence

## Purpose
Documents the complete flow from `drift scan` to stored patterns and violations. This is the sequence you'd need to reimplement to recreate the system.

---

## Phase 1: File Scanning

### Input
Project root directory + configuration

### Process
```
1. Walk directory tree (parallel in Rust, sequential in TS)
2. Apply .driftignore rules (glob patterns)
3. Apply config excludes (node_modules, .git, etc.)
4. Collect file metadata:
   - path, language, size, line count
   - content hash (for incremental scanning)
   - last modified timestamp
5. Compare against previous scan:
   - Skip unchanged files (same content hash)
   - Mark new/modified files for scanning
```

### Output
`FileMetadata[]` — files to scan with language classification

### Incremental Scanning
Content hash comparison enables incremental scans:
```
if file.contentHash === previousScan.contentHash:
  skip (patterns still valid)
else:
  re-scan (patterns may have changed)
```

---

## Phase 2: Parsing

### Input
`FileMetadata[]` from Phase 1

### Process
```
For each file:
  1. Determine language from extension + content heuristics
  2. Parse AST via tree-sitter (11 languages supported)
  3. Extract imports (source, named, default, namespace, type-only)
  4. Extract exports (name, default, type-only, re-exports)
  5. Classify: isTestFile, isTypeDefinition
  6. Build DetectionContext
```

### Output
`DetectionContext[]` — one per file, ready for detection

### Supported Languages
TypeScript, JavaScript, Python, Go, Rust, C++, PHP, C#, Java, Ruby, Swift

---

## Phase 3: Detection

### Input
`DetectionContext[]` + enabled detectors from registry

### Process
```
1. Query registry for enabled detectors
2. Sort by priority (higher runs first)
3. For each file context:
   For each detector:
     a. Check language support (detector.supportedLanguages)
     b. Run detector.detect(context) → DetectionResult
     c. Collect PatternMatch[] and Violation[]
4. Handle errors gracefully (skip failed detectors, continue)
```

### Detector Execution Order
1. Base detectors (regex) — fast, deterministic
2. Learning detectors — use learned conventions
3. Semantic detectors — keyword-based, context-aware
4. Unified detectors — multi-strategy, merge results

### Output
`DetectionResult[]` — patterns and violations per file per detector

---

## Phase 4: Aggregation

### Input
`DetectionResult[]` from all detectors across all files

### Process
```
1. Group PatternMatch results by pattern ID
2. For each pattern:
   a. Collect all locations across files
   b. Count occurrences, unique files
   c. Calculate variance in confidence values
   d. Track first/last seen timestamps
3. Build AggregatedMatchResult per pattern
```

### Output
`AggregatedMatchResult[]` — cross-file pattern data ready for scoring

---

## Phase 5: Confidence Scoring

### Input
`AggregatedMatchResult[]` from Phase 4

### Process
```
For each aggregated pattern:
  1. Calculate frequency = occurrences / totalLocations
  2. Calculate consistency = 1 - variance
  3. Calculate ageFactor = linear scale over 30 days
  4. Calculate spread = fileCount / totalFiles
  5. Weighted sum: score = f×0.4 + c×0.3 + a×0.15 + s×0.15
  6. Classify level: high (≥0.85) / medium (≥0.70) / low (≥0.50) / uncertain
```

### Output
`Pattern[]` with `ConfidenceScore` attached

---

## Phase 6: Outlier Detection

### Input
`Pattern[]` with locations from Phase 5

### Process
```
For each pattern with enough data points (≥ minSampleSize):
  1. Extract confidence values as numeric data points
  2. Select method:
     - n ≥ 30 → Z-Score
     - n < 30 → IQR
  3. Run statistical detection
  4. Run rule-based detection
  5. Mark outlier locations with:
     - isOutlier = true
     - outlierReason (human-readable)
     - significance (high/medium/low)
```

### Output
`Pattern[]` with outlier annotations on locations

---

## Phase 7: Storage

### Input
`Pattern[]` from Phase 6

### Process
```
1. Begin SQLite transaction
2. Upsert patterns (INSERT OR REPLACE)
3. Upsert pattern locations (bulk insert)
4. Update pattern history (track changes)
5. Commit transaction
6. Write JSON shards (one per category)
7. Update indexes (by-category, by-file)
8. Update checksums
```

### Output
Persisted pattern state in SQLite + JSON

---

## Phase 8: Violation Generation

### Input
`Pattern[]` + file contexts

### Process
```
For each file:
  For each applicable pattern:
    1. Run pattern matcher against file
    2. Run outlier detector on matches
    3. For each outlier location:
       Create Violation with severity, message, range, expected/actual
    4. Check for missing patterns:
       If file should have pattern but doesn't → info violation
    5. Generate quick fixes for auto-fixable violations
```

### Output
`Violation[]` — ready for IDE diagnostics, CLI output, or CI checks

---

## Performance Characteristics

| Phase | Bottleneck | Optimization |
|-------|-----------|-------------|
| Scanning | Filesystem I/O | Parallel walking, incremental (content hash) |
| Parsing | AST construction | Tree-sitter (native), skip unchanged files |
| Detection | Detector count × file count | Priority ordering, early exit, language filtering |
| Aggregation | Memory (large location arrays) | Streaming aggregation, limit locations |
| Scoring | CPU (math) | Batch calculation, SIMD potential |
| Outlier | CPU (statistics) | Skip patterns with < minSampleSize |
| Storage | SQLite writes | Bulk inserts in transactions, WAL mode |
| Violations | Pattern matcher calls | LRU cache, skip low-confidence patterns |

---

## Rust Rebuild Considerations
- Phases 1-2 (scanning, parsing) are already in Rust via tree-sitter
- Phase 3 (detection) is the largest codebase — migrate incrementally by category
- Phases 4-6 (aggregation, scoring, outliers) are pure computation — ideal for Rust
- Phase 7 (storage) maps to `rusqlite` with bulk operations
- Phase 8 (violations) is the presentation layer — can stay in TypeScript
- The full pipeline should be a single Rust function called via NAPI
- Target: < 1 second for 10,000 files (currently ~5-10 seconds in TypeScript)
