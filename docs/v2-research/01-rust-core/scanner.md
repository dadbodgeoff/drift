# Rust Scanner

## Location
`crates/drift-core/src/scanner/`

## Files
- `walker.rs` — Parallel file walking using `walkdir` + `rayon`
- `ignores.rs` — Enterprise-grade ignore patterns (gitignore, driftignore)
- `types.rs` — `ScanConfig`, `ScanResult`, `FileInfo`, `ScanStats`
- `mod.rs` — Module exports

## What It Does
- Walks the filesystem in parallel using rayon for thread-level parallelism
- Respects `.gitignore`, `.driftignore`, and configurable ignore patterns
- Returns file metadata: path, size, language detection
- Configurable: max file size, include/exclude patterns, follow symlinks

## NAPI Exposure
- `scan(config: JsScanConfig) -> JsScanResult` — Full directory scan
- Returns: files list, stats (total files, total size, languages found)

## Dependencies
- `walkdir` — Directory traversal
- `ignore` — Gitignore-compatible pattern matching
- `globset` — Glob pattern matching
- `rayon` — Parallel iteration

## TS Counterpart
`packages/core/src/scanner/` — Has additional features:
- `file-walker.ts` — TS file walker (slower, more features)
- `native-scanner.ts` — Wrapper that calls Rust via NAPI
- `dependency-graph.ts` — Import/export dependency tracking
- `change-detector.ts` — Incremental change detection
- `worker-pool.ts` / `threaded-worker-pool.ts` — Worker thread management
- `file-processor-worker.ts` — Per-file processing in worker threads

## v2 Notes
- The Rust scanner is solid. Needs: incremental scanning, dependency graph building, and change detection added to Rust side.
- Worker pool concept can be replaced by rayon's built-in parallelism.
