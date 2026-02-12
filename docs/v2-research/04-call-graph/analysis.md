# Call Graph — Analysis Engines

## Location
`packages/core/src/call-graph/analysis/`

## Components

### Graph Builder (`graph-builder.ts`)
Constructs the complete call graph from extracted file information.

**Build Process:**
```
1. Register functions from each file extraction (FunctionExtraction → FunctionNode)
2. Store imports per file for cross-file resolution
3. Register classes for method resolution (classKey = "file:className")
4. Store pending calls for later resolution
5. Associate data access points with containing functions
6. Resolve all calls (6-strategy resolution pass)
7. Identify entry points (route decorators, controllers, exported handlers, main)
8. Identify data accessors (functions with DataAccessPoint[])
9. Compute statistics (total functions, call sites, resolved/unresolved, by language)
```

**Options:**
```typescript
interface GraphBuilderOptions {
  projectRoot: string;
  includeUnresolved?: boolean;   // Default: true
  minConfidence?: number;        // Default: 0.7 (raised from 0.5 to reduce false positives)
}
```

**Resolution Algorithm (6 strategies, in order):**
```
For each pending call:
  1. Same-file lookup — fastest, highest confidence
  2. Method resolution — via class/receiver type (obj.method → Class.method)
  3. DI injection — FastAPI Depends, Spring @Autowired, NestJS @Inject
  4. Import-based lookup — follow import chains across files
  5. Export-based lookup — match exported names from other files
  6. Fuzzy matching — name similarity, lowest confidence
```

**Entry Point Detection:**
- Route decorators: `@app.route`, `@GetMapping`, `@HttpGet`, `@Route`, `@Controller`
- Controller methods in framework-specific patterns
- Exported functions from entry modules (index.ts, main.py, etc.)
- Main functions (`main`, `__main__`, `Main`)

### Reachability Engine (`reachability.ts`)
Answers: "What data can this code reach?"

**Forward Reachability:**
```
Input: file + line (or function ID), max depth, filters
Algorithm: BFS through call graph from containing function
Output: ReachabilityResult {
  origin: CodeLocation,
  reachableAccess: ReachableDataAccess[],  // table, fields, operation, depth, path
  sensitiveFields: SensitiveFieldAccess[], // field, paths, access count
  tables: string[],
  functionsTraversed: number,
  maxDepth: number
}
```

**Inverse Reachability:**
```
Input: target table/field, max depth
Algorithm: Find all data accessors for table → reverse BFS to find entry points
Output: InverseReachabilityResult {
  target: { table, field? },
  accessPaths: InverseAccessPath[],  // entry point → ... → data accessor
  entryPoints: string[],
  totalAccessors: number
}
```

**Options:**
```typescript
interface ReachabilityOptions {
  maxDepth?: number;           // Default: Infinity
  sensitiveOnly?: boolean;     // Only sensitive data
  tables?: string[];           // Filter by table
  includeUnresolved?: boolean; // Include unresolved calls in traversal
}
```

### Impact Analyzer (`impact-analyzer.ts`)
Answers: "What breaks if I change this function?"

```
Input: changed function ID
Output: {
  affectedFunctions: string[],     // Functions that call the changed one (transitive)
  affectedDataPaths: DataPath[],   // Data paths through the changed function
  risk: 'low' | 'medium' | 'high' | 'critical'
}
```

Risk calculation:
- Number of affected functions (more = higher risk)
- Whether affected functions are entry points (API surface impact)
- Whether data paths include sensitive data (security impact)
- Depth of impact (how far the change propagates through the graph)

### Dead Code Detector (`dead-code-detector.ts`)
Identifies functions never called.

```
Input: call graph
Output: {
  candidates: DeadCodeCandidate[],
  confidence: 'high' | 'medium' | 'low',
  falsePositiveReasons: string[]
}
```

False positive reasons:
- Entry point (called externally via HTTP, CLI, etc.)
- Framework hook (lifecycle method: componentDidMount, setUp, etc.)
- Dynamic dispatch (called via reflection, eval, getattr)
- Event handler (called via event system, signals)
- Exported (may be used by external packages)

### Coverage Analyzer (`coverage-analyzer.ts`)
Integrates call graph with test topology.

```
Input: call graph + test topology
Output: {
  fieldCoverage: FieldCoverage[],    // Which sensitive fields have test coverage
  uncoveredPaths: DataPath[],        // Data paths without tests
}
```

### Path Finder (`path-finder.ts`)
Finds call paths between any two functions.

```
Input: source function ID, target function ID, max paths
Algorithm: BFS with path tracking
Output: CallPath[] — arrays of function ID sequences
```

Useful for understanding how data flows from entry point to data access.

## V2 Notes
- Graph building is CPU-intensive — Rust gives major speedup
- Reachability BFS is ideal for Rust (tight loops, minimal allocation)
- Impact analysis is graph traversal — Rust
- Dead code detection is set operations — Rust
- Path finding is BFS — Rust
- All analysis engines should move to Rust, with TS wrappers for MCP/CLI
