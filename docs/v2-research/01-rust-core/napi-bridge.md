# NAPI Bridge (drift-napi)

## Location
`crates/drift-napi/`

## What It Does
Exposes Rust functions to Node.js via N-API. This is the bridge between the Rust engine and the TypeScript packages.

## Exposed Functions (~25 total)

### Scanning
- `scan(config)` — File system scanning

### Parsing
- `parse(source, file_path)` — Single file parsing
- `supported_languages()` — List supported languages
- `version()` — Get version

### Call Graph
- `build_call_graph(config)` — Build (sharded)
- `build_call_graph_legacy(config)` — Build (legacy)
- `is_call_graph_available(root_dir)` — Check existence
- `get_call_graph_stats(root_dir)` — Statistics
- `get_call_graph_entry_points(root_dir)` — Entry points
- `get_call_graph_data_accessors(root_dir)` — Data accessors
- `get_call_graph_callers(root_dir, target)` — Function callers
- `get_call_graph_file_callers(root_dir, file_path)` — File callers

### Analysis
- `scan_boundaries(files)` / `scan_boundaries_source(source, file_path)` — Boundary detection
- `analyze_coupling(files)` — Module coupling
- `analyze_test_topology(files)` — Test topology
- `analyze_error_handling(files)` — Error handling
- `analyze_reachability(options)` / `analyze_inverse_reachability(options)` — Data flow
- `analyze_reachability_sqlite(options)` / `analyze_inverse_reachability_sqlite(options)` — SQLite-backed data flow
- `analyze_unified(root, options)` — Combined pattern detection
- `analyze_constants(files)` — Constants/secrets
- `analyze_environment(files)` — Environment variables
- `analyze_wrappers(files)` — Wrapper detection

## Platform Support
Pre-built binaries for:
- darwin-arm64, darwin-x64
- linux-arm64-gnu, linux-arm64-musl
- linux-x64-gnu, linux-x64-musl
- win32-x64-msvc

## Dependencies
- `napi` v2 (with async + serde-json features)
- `napi-derive` v2
- `napi-build` v2 (build dependency)

## v2 Notes
- The bridge is functional but thin. For v2, it needs to expose:
  - Pattern detection (currently only in TS detectors)
  - Pattern matching and confidence scoring
  - Storage operations (pattern CRUD, contract CRUD)
  - Language intelligence (normalization, framework detection)
  - Richer call graph queries
- Consider: Should v2 use a different FFI approach? (e.g., Rust CLI with JSON IPC, or keep NAPI but much thicker)
