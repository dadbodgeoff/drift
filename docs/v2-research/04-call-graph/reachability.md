# Call Graph — Reachability (Rust)

## Location
- `crates/drift-core/src/reachability/` — Rust (4 files)
- `packages/core/src/call-graph/analysis/reachability.ts` — TypeScript counterpart

## Purpose
Reachability is the core security analysis capability. It answers two fundamental questions:
1. **Forward**: "From this code, what sensitive data can it ultimately access?"
2. **Inverse**: "Who can reach this sensitive data?"

The Rust implementation provides both an in-memory engine (fast, for small-medium codebases) and a SQLite-backed engine (scalable, for large codebases).

## Two Engines

### ReachabilityEngine (`engine.rs`)
In-memory BFS traversal through a `CallGraph` struct.

```rust
pub struct ReachabilityEngine {
    graph: CallGraph,  // HashMap<String, FunctionNode>
}
```

**Forward reachability:**
```rust
pub fn get_reachable_data(
    &self, file: &str, line: u32, options: &ReachabilityOptions
) -> ReachabilityResult
```
1. Find containing function at file:line
2. BFS through `calls` edges, tracking visited set
3. At each function, collect `data_access` points
4. Classify sensitive fields (PII, credentials, financial, health)
5. Build call path for each reachable data access
6. Return with depth tracking and function traversal count

**Inverse reachability:**
```rust
pub fn get_code_paths_to_data(
    &self, options: &InverseReachabilityOptions
) -> InverseReachabilityResult
```
1. Find all functions that access the target table/field
2. For each accessor, find all paths from entry points via reverse BFS
3. Return entry points and access paths

**Path finding:**
```rust
pub fn get_call_path(
    &self, from_id: &str, to_id: &str, max_depth: u32
) -> Vec<Vec<CallPathNode>>
```
BFS with path tracking between any two functions.

### SqliteReachabilityEngine (`sqlite_engine.rs`)
SQLite-backed reachability for large codebases where the full graph doesn't fit in memory.

```rust
pub struct SqliteReachabilityEngine {
    conn: Connection,  // SQLite connection to callgraph.db
}
```

**Same API as in-memory engine**, but queries SQLite directly:
- `get_function_info()` → SQL query on functions table
- `get_resolved_calls()` → SQL query on call_edges table
- `get_data_access()` → SQL query on data_access table
- `get_table_accessors()` → SQL query filtering by table name
- `get_entry_points()` → SQL query for is_entry_point = 1
- `find_containing_function()` → SQL range query on start_line/end_line

**BFS is the same algorithm**, just backed by SQL queries instead of HashMap lookups. Trades latency per lookup for memory efficiency.

## Rust Types (`types.rs`)

### Core Types
```rust
struct CodeLocation { file, line, column?, function_id? }
struct CallPathNode { function_id, function_name, file, line }
struct ReachableDataAccess { access: DataAccessPoint, path: Vec<CallPathNode>, depth }
struct SensitiveFieldAccess { field: SensitiveField, paths, access_count }
```

### Query Types
```rust
struct ReachabilityOptions {
    max_depth: Option<u32>,
    sensitive_only: bool,
    tables: Vec<String>,
    include_unresolved: bool,
}

struct InverseReachabilityOptions {
    table: String,
    field: Option<String>,
    max_depth: Option<u32>,
}
```

### Result Types
```rust
struct ReachabilityResult {
    origin: CodeLocation,
    reachable_access: Vec<ReachableDataAccess>,
    tables: Vec<String>,
    sensitive_fields: Vec<SensitiveFieldAccess>,
    max_depth: u32,
    functions_traversed: u32,
}

struct InverseReachabilityResult {
    target: InverseTarget,
    access_paths: Vec<InverseAccessPath>,
    entry_points: Vec<String>,
    total_accessors: u32,
}
```

### Sensitivity Classification (Rust-side)
Built into the reachability engine:
- PII: email, phone, ssn, name, address, dob
- Credentials: password, token, key, secret, salt
- Financial: credit_card, bank, account_number, salary
- Health: diagnosis, prescription, medical

## NAPI Exposure
```
analyze_reachability(options) → JsReachabilityResult
analyze_inverse_reachability(options) → JsInverseReachabilityResult
analyze_reachability_sqlite(options) → JsReachabilityResult
analyze_inverse_reachability_sqlite(options) → JsInverseReachabilityResult
```

## MCP Integration
The `drift_reachability` MCP tool uses `UnifiedCallGraphProvider` which:
1. Initializes and auto-detects storage format (legacy JSON vs sharded SQLite)
2. Supports `location` as `file:line` or function name
3. Forward: returns tables, sensitive fields, reachable data with paths
4. Inverse: returns entry points and access paths to target data
5. Warns on credential field access

## V2 Notes
- Rust reachability is already well-implemented — one of the strongest Rust modules
- Needs: taint analysis (track data transformations along paths)
- Needs: more granular data flow tracking (field-level, not just table-level)
- Needs: cross-service reachability (API calls between microservices)
- SQLite engine should use recursive CTEs for even better performance
- Consider: caching frequently-queried reachability results
