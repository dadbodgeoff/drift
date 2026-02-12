# Call Graph — Storage

## Location
- `packages/core/src/call-graph/store/call-graph-store.ts` — TS persistence + loading
- `packages/core/src/call-graph/streaming-builder.ts` — TS streaming construction
- `packages/core/src/call-graph/unified-provider.ts` — Unified access layer
- `crates/drift-core/src/call_graph/storage.rs` — Rust SQLite storage (`CallGraphDb`)
- `crates/drift-core/src/call_graph/builder.rs` — Rust streaming builder

## Storage Backends

### Legacy JSON
Original storage format. Serializes the entire call graph as JSON in `.drift/lake/callgraph/`.
- Simple but doesn't scale
- Entire graph must fit in memory
- Used for small-medium codebases
- Being deprecated in favor of SQLite

### Sharded SQLite (Current)
Each file's functions are stored as rows in SQLite:
```
.drift/lake/callgraph/
└── callgraph.db              # SQLite database
```

## Rust SQLite Storage (`CallGraphDb`)

### Schema
```sql
-- Core tables
functions (id TEXT PK, name TEXT, file TEXT, start_line INT, end_line INT,
           is_entry_point BOOL, is_data_accessor BOOL, calls_json TEXT, data_access_json TEXT)
call_edges (caller_id TEXT, callee_id TEXT, callee_name TEXT, confidence REAL, line INT)
data_access (function_id TEXT, table_name TEXT, operation TEXT, fields_json TEXT, line INT)

-- Indexes
idx_functions_file, idx_functions_name
idx_call_edges_caller, idx_call_edges_callee, idx_call_edges_callee_name
idx_data_access_function, idx_data_access_table

-- Metadata
metadata (key TEXT PK, value TEXT)  -- version, generated_at, project_root, etc.
```

### Key Operations
```rust
impl CallGraphDb {
    fn open(path) → Self                          // Open or create database
    fn open_readonly(path) → Self                 // Read-only access
    fn insert_batch(batch: &FunctionBatch)        // Insert functions from one file
    fn insert_batches(batches: &[FunctionBatch])  // Batch insert (transactional)
    fn resolve_calls() → usize                    // Resolution pass (returns resolved count)
    fn get_function(id) → Option<FunctionEntry>
    fn get_calls_from(caller_id) → Vec<CallEntry>
    fn get_callers(target_id) → Vec<String>       // By resolved ID
    fn get_callers_by_name(name) → Vec<String>    // By function name
    fn get_data_access(function_id) → Vec<DataAccessRef>
    fn get_table_accessors(table) → Vec<String>
    fn get_entry_points() → Vec<String>
    fn get_data_accessors() → Vec<String>
    fn get_functions_in_file(file) → Vec<String>
    fn get_stats() → DbStats                      // total_functions, total_calls, resolved, etc.
}
```

### ParallelWriter
```rust
struct ParallelWriter {
    sender: Sender<FunctionBatch>,
    handle: JoinHandle<SqliteResult<DbStats>>,
}
```
Runs a dedicated writer thread that receives `FunctionBatch` messages from rayon worker threads. Batches writes into transactions for performance. Used by the Rust streaming builder.

## Rust Streaming Builder (`builder.rs`)

### BuilderConfig
```rust
struct BuilderConfig {
    root_dir: PathBuf,
    patterns: Vec<String>,       // File glob patterns
    use_sqlite: bool,            // Default: true
    batch_size: usize,           // Default: 100
}
```

### SQLite Build Pipeline
```
1. Walk filesystem with rayon (parallel file discovery)
2. For each file (parallel via rayon):
   a. Parse with tree-sitter
   b. Extract functions + calls via UniversalExtractor
   c. Extract data access via DataAccessDetector
   d. Send FunctionBatch to ParallelWriter
3. ParallelWriter batches inserts into SQLite transactions
4. Resolution pass: resolve call targets using resolution index
5. Build resolution index (exports → function IDs, imports → source files)
```

### Resolution in Rust
```rust
fn resolve_call(target, file, exports, imports) → Resolution {
    // 1. Local: same file
    // 2. Import: follow import chain
    // 3. Export: match exported name
    // 4. Unresolved
}
```

## TS Streaming Builder (`streaming-builder.ts`)

### StreamingCallGraphBuilder
```typescript
interface StreamingBuilderConfig {
  rootDir: string;
  patterns?: string[];
  useNative?: boolean;           // Use Rust N-API when available
  batchSize?: number;
}
```

**Build pipeline:**
1. Find files matching patterns
2. For each file: get hybrid extractor for language, extract functions + calls
3. Write shard to storage immediately
4. After all files: run resolution pass
5. Build resolution index (exports map, imports map)
6. Resolve calls using 6-strategy algorithm
7. Clean up temporary resolution index

## TS Call Graph Store (`call-graph-store.ts`)

### Loading
Supports loading from multiple sources:
1. **SQLite** (preferred): Reads from `callgraph.db`, reconstructs `CallGraph` with `Map<string, FunctionNode>`
2. **Lake shards**: Reads from `.drift/lake/callgraph/` JSON shards
3. Builds reverse references (`calledBy`) after loading
4. Caches reachability results

### Key Methods
```typescript
class CallGraphStore {
  load(): Promise<CallGraph | null>           // Auto-detect and load
  save(graph: CallGraph): Promise<void>       // Serialize and save
  getGraph(): CallGraph | null                // Get cached graph
  getFunction(id): FunctionNode | undefined
  getFunctionsInFile(file): FunctionNode[]
  getFunctionAtLine(file, line): FunctionNode | null
  cacheReachability(key, data): Promise<void>
  getCachedReachability<T>(key): Promise<T | null>
}
```

## Unified Provider (`unified-provider.ts`)

### Purpose
Single interface over both storage backends with auto-detection, LRU caching, and reachability built in.

### Auto-Detection
```typescript
private async detectFormat(): Promise<'sqlite' | 'sharded' | 'legacy' | 'none'> {
  // 1. Check for callgraph.db (SQLite)
  // 2. Check for .drift/lake/callgraph/ (sharded JSON)
  // 3. Check for legacy JSON
  // 4. None available
}
```

### LRU Cache
Built-in LRU cache (default 500 entries) for function lookups. Avoids repeated SQLite queries for hot functions.

### Key Methods
```typescript
class UnifiedCallGraphProvider {
  initialize(): Promise<void>                    // Detect format, open connections
  isAvailable(): boolean
  getFunction(id): Promise<UnifiedFunction | null>
  getFunctionsInFile(file): Promise<UnifiedFunction[]>
  getFunctionAtLine(file, line): Promise<UnifiedFunction | null>
  getEntryPoints(): Promise<string[]>
  getDataAccessors(): Promise<string[]>
  getStats(): Promise<CallGraphStats | null>
  getReachableData(file, line, options): Promise<ReachabilityResult>
  getCodePathsToData(options): Promise<InverseReachabilityResult>
}
```

### Native SQLite Queries
When Rust N-API is available, analysis engines bypass the TS graph entirely:
```typescript
if (isNativeAvailable() && isCallGraphAvailable(projectRoot)) {
  const callers = getCallGraphCallers(projectRoot, funcName);
}
```

This pattern is used by: ErrorHandlingAnalyzer, ModuleCouplingAnalyzer, TestTopologyAnalyzer.

## V2 Notes
- SQLite sharded storage is the future — deprecate JSON entirely
- Rust builder with rayon parallelism is 10-50x faster than TS
- Resolution index should be maintained incrementally (not rebuilt on every scan)
- Consider WAL mode for concurrent read/write during incremental updates
- The UnifiedCallGraphProvider pattern is good — keep for backward compatibility during migration
- ParallelWriter with dedicated thread is a good pattern — preserve in v2
