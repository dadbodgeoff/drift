# Rust Call Graph

> **Canonical documentation**: See [04-call-graph/rust-core.md](../04-call-graph/rust-core.md) for the comprehensive Rust call graph documentation, and [04-call-graph/overview.md](../04-call-graph/overview.md) for the full system overview covering both TS and Rust implementations.

## Location
`crates/drift-core/src/call_graph/`

## Quick Reference
- `builder.rs` — StreamingBuilder: parallel file processing via rayon, SQLite writing, resolution pass
- `extractor.rs` — CallGraphExtractor trait + to_function_entries() helper
- `universal_extractor.rs` — Language-agnostic extraction from tree-sitter ParseResult
- `storage.rs` — CallGraphDb (SQLite CRUD) + ParallelWriter (threaded batch writer)
- `types.rs` — FunctionEntry, CallEntry, DataAccessRef, CallGraphShard, BuildResult

## NAPI Exposure
- `build_call_graph(config) → JsBuildResult`
- `is_call_graph_available(root_dir) → bool`
- `get_call_graph_stats(root_dir) → JsCallGraphStats`
- `get_call_graph_entry_points(root_dir) → Vec<JsEntryPointInfo>`
- `get_call_graph_data_accessors(root_dir) → Vec<JsDataAccessorInfo>`
- `get_call_graph_callers(root_dir, target) → Vec<JsCallerInfo>`
- `get_call_graph_file_callers(root_dir, file_path) → Vec<JsCallerInfo>`
