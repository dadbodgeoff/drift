# Call Graph — Types

## Location
- `packages/core/src/call-graph/types.ts` — TypeScript types (~300 lines)
- `crates/drift-core/src/call_graph/types.rs` — Rust types
- `crates/drift-core/src/reachability/types.rs` — Rust reachability types

## Supported Languages
```typescript
type CallGraphLanguage = 'python' | 'typescript' | 'javascript' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp';
```

## Core Graph Types (TypeScript)

### FunctionNode
```typescript
interface FunctionNode {
  id: string;                   // "file:name:line"
  name: string;
  qualifiedName: string;        // Class.method or module.function
  file: string;
  startLine: number;
  endLine: number;
  language: CallGraphLanguage;
  calls: CallSite[];            // What this function calls (forward edges)
  calledBy: CallSite[];         // What calls this function (reverse edges)
  dataAccess: DataAccessPoint[];// Direct data access within this function
  className?: string;
  moduleName?: string;
  isExported: boolean;
  isConstructor: boolean;
  isAsync: boolean;
  decorators: string[];         // @app.route, [HttpGet], etc.
  parameters: ParameterInfo[];
  returnType?: string;
}
```

### CallSite
```typescript
interface CallSite {
  callerId: string;
  calleeId: string | null;     // null if unresolved
  calleeName: string;           // Name as written in code
  receiver?: string;            // Object for method calls (e.g., "userService")
  file: string;
  line: number;
  column: number;
  resolved: boolean;
  resolvedCandidates: string[]; // Multiple targets (polymorphism, dynamic dispatch)
  confidence: number;           // 0-1
  resolutionReason?: string;    // Why we resolved this way
  argumentCount: number;
}
```

### CallGraph
```typescript
interface CallGraph {
  version: string;
  generatedAt: string;
  projectRoot: string;
  functions: Map<string, FunctionNode>;
  entryPoints: string[];        // API handlers, exported functions, main
  dataAccessors: string[];      // Functions with direct data access
  stats: CallGraphStats;
  _sqliteAvailable?: boolean;   // Internal flag: using SQLite storage
}
```

### CallGraphStats
```typescript
interface CallGraphStats {
  totalFunctions: number;
  totalCallSites: number;
  resolvedCallSites: number;
  unresolvedCallSites: number;
  totalDataAccessors: number;
  byLanguage: Record<CallGraphLanguage, number>;
}
```

## Extraction Types (TypeScript)

### FileExtractionResult
```typescript
interface FileExtractionResult {
  file: string;
  language: CallGraphLanguage;
  functions: FunctionExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
  classes: ClassExtraction[];
}
```

### FunctionExtraction
```typescript
interface FunctionExtraction {
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  parameters: ParameterInfo[];
  returnType?: string;
  className?: string;
  isExported: boolean;
  isConstructor: boolean;
  isAsync: boolean;
  decorators: string[];
}
```

## Reachability Types (TypeScript)

### ReachabilityResult
```typescript
interface ReachabilityResult {
  origin: CodeLocation;
  reachableAccess: ReachableDataAccess[];
  sensitiveFields: SensitiveFieldAccess[];
  tables: string[];
  functionsTraversed: number;
  maxDepth: number;
}
```

### InverseReachabilityResult
```typescript
interface InverseReachabilityResult {
  target: { table: string; field?: string };
  accessPaths: InverseAccessPath[];
  entryPoints: string[];
  totalAccessors: number;
}
```

## Rust Types

### FunctionEntry
```rust
struct FunctionEntry {
    id: String,                 // "file:name:line"
    name: String,
    start_line: u32,
    end_line: u32,
    is_entry_point: bool,
    is_data_accessor: bool,
    calls: Vec<CallEntry>,
    called_by: Vec<String>,     // Populated during index building
    data_access: Vec<DataAccessRef>,
}
```

### CallEntry
```rust
struct CallEntry {
    target: String,             // Target function name as written in code
    resolved_id: Option<String>,// Resolved function ID (if resolved)
    resolved: bool,
    confidence: f32,
    line: u32,
}
```

### DataAccessRef
```rust
struct DataAccessRef {
    table: String,
    fields: Vec<String>,
    operation: DataOperation,   // Read, Write, Delete
    line: u32,
}
```

### CallGraphShard
```rust
struct CallGraphShard {
    file: String,               // Relative file path
    functions: Vec<FunctionEntry>,
}
```

### BuildResult
```rust
struct BuildResult {
    total_files: usize,
    total_functions: usize,
    total_calls: usize,
    resolved_calls: usize,
    entry_points: usize,
    data_accessors: usize,
    duration_ms: u64,
}
```

### Rust Reachability Types
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

// Reachability has its own CallGraph/FunctionNode types
// (separate from call_graph module, optimized for traversal)
struct FunctionNode {
    id, name, qualified_name, file, start_line, end_line,
    calls: Vec<CallSite>,
    data_access: Vec<DataAccessPoint>,
    is_entry_point: bool,
}
```

## Type Parity Notes

| Feature | TypeScript | Rust (call_graph) | Rust (reachability) |
|---------|-----------|-------------------|---------------------|
| Function metadata | Full (decorators, params, return type) | Basic (name, lines, flags) | Medium (qualified name, calls) |
| Call resolution | 6 strategies, candidates | 3 strategies | Pre-resolved |
| Data access | Full DataAccessPoint | DataAccessRef (compact) | DataAccessPoint (full) |
| Reverse edges | calledBy: CallSite[] | called_by: Vec<String> | Not stored (computed) |
| Polymorphism | resolvedCandidates | Not supported | Not supported |

V2 should unify: Rust extracts full metadata (matching TS depth), TS wraps for presentation only.
