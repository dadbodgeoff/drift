# Call Graph — Rust Core

## Location
`crates/drift-core/src/call_graph/` — 6 files

## Purpose
The Rust call graph module provides high-performance parallel graph construction with SQLite persistence. It's the performance backbone — the TS side delegates to it via N-API when available.

## Files

| File | Purpose |
|------|---------|
| `builder.rs` | `StreamingBuilder`: parallel file processing, SQLite writing, resolution |
| `extractor.rs` | `CallGraphExtractor` trait + `to_function_entries()` helper |
| `universal_extractor.rs` | `UniversalExtractor`: language-agnostic extraction from ParseResult |
| `storage.rs` | `CallGraphDb`: SQLite CRUD, `ParallelWriter`: threaded batch writer |
| `types.rs` | `FunctionEntry`, `CallEntry`, `DataAccessRef`, `CallGraphShard`, `BuildResult` |
| `mod.rs` | Module exports |

## StreamingBuilder (`builder.rs`)

### Configuration
```rust
struct BuilderConfig {
    root_dir: PathBuf,
    patterns: Vec<String>,       // File glob patterns to scan
    use_sqlite: bool,            // Default: true
    batch_size: usize,           // Default: 100
}
```

### SQLite Build Pipeline (`build_sqlite`)
```
1. Open/create CallGraphDb at .drift/lake/callgraph/callgraph.db
2. Clear existing data
3. Walk filesystem with rayon (parallel)
4. For each file (parallel via rayon::par_iter):
   a. Parse with ParserManager (tree-sitter)
   b. Extract via UniversalExtractor → ExtractionResult
   c. Detect data access via DataAccessDetector
   d. Convert to FunctionBatch via to_function_entries()
   e. Send batch to ParallelWriter
5. ParallelWriter finishes (flushes remaining batches)
6. Resolution pass: build index, resolve calls
7. Return BuildResult with stats
```

### Resolution Pass
```
1. Build resolution index:
   - exports: HashMap<function_name, Vec<function_id>>
   - imports: HashMap<file, imported_module>
2. For each unresolved call in the database:
   a. Local lookup: same file
   b. Import resolution: follow import chain
   c. Export matching: find exported function with same name
3. Update call_edges with resolved IDs
4. Return count of resolved calls
```

## UniversalExtractor (`universal_extractor.rs`)

Language-agnostic extraction from tree-sitter `ParseResult`:

```rust
impl UniversalExtractor {
    fn extract_from_parse_result(&self, result: &ParseResult) -> ExtractionResult {
        // 1. Extract functions from result.functions
        // 2. Extract classes as callable entities (for new MyClass() resolution)
        // 3. Extract class methods as qualified names (ClassName.methodName)
        // 4. Extract calls from result.calls with receiver tracking
    }
}
```

**Key design decisions:**
- Classes are extracted as callable entities — enables `new MyClass()` resolution
- Methods get qualified names (`UserService.getUser`) — enables method call resolution
- Relies on tree-sitter parser to normalize across languages
- No per-language specialization (unlike TS hybrid extractors)

## CallGraphDb (`storage.rs`)

### SQLite Schema
```sql
CREATE TABLE functions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    is_entry_point INTEGER DEFAULT 0,
    is_data_accessor INTEGER DEFAULT 0,
    calls_json TEXT,              -- JSON array of CallEntry
    data_access_json TEXT         -- JSON array of DataAccessRef
);

CREATE TABLE call_edges (
    caller_id TEXT NOT NULL,
    callee_id TEXT,
    callee_name TEXT NOT NULL,
    confidence REAL DEFAULT 0.0,
    line INTEGER NOT NULL
);

CREATE TABLE data_access (
    function_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    fields_json TEXT,
    line INTEGER NOT NULL
);

CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### ParallelWriter
Dedicated writer thread that receives `FunctionBatch` messages from rayon workers:
```rust
struct ParallelWriter {
    sender: Sender<FunctionBatch>,
    handle: JoinHandle<SqliteResult<DbStats>>,
}
```

The writer thread:
1. Receives batches via channel
2. Accumulates until `batch_size` reached
3. Writes accumulated batches in a single transaction
4. Flushes remaining on `finish()`

This decouples parsing (CPU-bound, parallel) from writing (I/O-bound, serial) for maximum throughput.

### Query Methods
All query methods are available for the reachability engine and N-API bridge:
- `get_function(id)` — Single function lookup
- `get_callers(target_id)` / `get_callers_by_name(name)` — Reverse edge queries
- `get_data_access(function_id)` — Data access for a function
- `get_table_accessors(table)` — All functions accessing a table
- `get_entry_points()` / `get_data_accessors()` — Special function sets
- `get_functions_in_file(file)` — File-scoped queries
- `get_stats()` — Aggregate statistics

## NAPI Bridge
Exposed to TypeScript via N-API:
```
build_call_graph(config) → JsBuildResult
build_call_graph_legacy(config) → JsBuildResult
is_call_graph_available(root_dir) → bool
get_call_graph_stats(root_dir) → JsCallGraphStats
get_call_graph_entry_points(root_dir) → Vec<JsEntryPointInfo>
get_call_graph_data_accessors(root_dir) → Vec<JsDataAccessorInfo>
get_call_graph_callers(root_dir, target) → Vec<JsCallerInfo>
get_call_graph_file_callers(root_dir, file_path) → Vec<JsCallerInfo>
```

## V2 Notes
- The ParallelWriter pattern (channel + dedicated thread) is excellent — preserve
- UniversalExtractor needs per-language specialization (DI patterns, framework decorators)
- Resolution algorithm needs more strategies (method resolution, DI injection)
- Consider WAL mode for concurrent read/write during incremental updates
- The SQLite schema should add indexes on `call_edges(callee_name)` for faster reverse lookups
- Consider: incremental builds (only re-process changed files, update affected shards)
