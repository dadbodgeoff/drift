# Error Handling Analyzer — Algorithms

## TypeScript Analyzer (`packages/core/src/error-handling/error-handling-analyzer.ts`, ~600 lines)

### Class: ErrorHandlingAnalyzer

```typescript
class ErrorHandlingAnalyzer {
  constructor(options: ErrorHandlingOptions)
  setCallGraph(callGraph: CallGraph): void
  build(): ErrorHandlingTopology
  getTopology(): ErrorHandlingTopology | null
  getMetrics(): ErrorHandlingMetrics | null
  getSummary(): ErrorHandlingSummary | null
  analyzeFunction(funcId: string, func?: FunctionNode): ErrorHandlingProfile
  getFunctionAnalysis(funcId: string): FunctionErrorAnalysis | null
  getGaps(options?: GapDetectionOptions): ErrorHandlingGap[]
  getBoundaries(options?: BoundaryAnalysisOptions): ErrorBoundary[]
  getUnhandledPaths(minSeverity?: ErrorSeverity): UnhandledErrorPath[]
}
```

Factory: `createErrorHandlingAnalyzer(options) → ErrorHandlingAnalyzer`

### Build Algorithm (3 phases)

#### Phase 1: Function Profiling
For each function in the call graph:
1. Detect try/catch presence (`hasTryCatch`)
2. Detect throw capability (`canThrow` — conservative: any function with calls can throw)
3. Find throw locations
4. Extract catch clauses (type, action, preservesError)
5. Check for rethrows
6. Analyze async handling (if async function)
7. Calculate quality score (0-100)
8. If function has try/catch → check if it's a boundary

#### Phase 2: Propagation Chain Building
For each function that can throw:
1. Start at thrower, walk up the call graph via `calledBy`
2. At each level, check if any caller has try/catch
3. If found → chain terminates at that boundary (sink)
4. If not found and no more callers → chain escapes (sink = null)
5. Max depth: 20 levels (configurable)
6. Cycle detection: skip already-visited functions

#### Phase 3: Unhandled Path Detection
For each propagation chain where `sink === null`:
1. Identify the entry point (last function in the path)
2. Calculate severity based on entry point type:
   - Exported function → `critical`
   - Entry point file → `critical`
   - Otherwise → `medium`
3. Suggest boundary location (middle of the chain)

### Quality Score Algorithm

```
Base score: 50

Positive factors:
  +20  has try/catch
  +15  catch action is 'recover'
  +10  catch action is 'transform'
  +5   catch preserves original error
  +10  async function has try/catch with await
  +5   async function has .catch()

Negative factors:
  -20  can throw but no try/catch
  -25  catch swallows error (empty catch)
  -5   bare catch (catches 'any')
  -20  async with unhandled promises

Result: clamp(0, 100)
```

Quality mapping: ≥80 = excellent, ≥60 = good, ≥40 = fair, <40 = poor

### Risk Score Algorithm (for gaps)

```
Base score: 50

Gap type weights:
  +20  no-try-catch
  +30  swallowed-error
  +25  unhandled-async
  +5   bare-catch

Function importance:
  +15  exported function
  +20  entry point file
  +10  called by >5 functions

Result: min(100, score)
```

### Framework Boundary Detection

| Framework | Detection Signal |
|-----------|-----------------|
| React ErrorBoundary | `componentDidCatch` method or class name contains "ErrorBoundary" |
| Express middleware | Function with exactly 4 parameters (err, req, res, next) |
| NestJS filter | Class name contains "filter" + method named "catch" |
| Spring handler | `@ExceptionHandler` or `@ControllerAdvice` annotations |
| Laravel handler | (detected via class hierarchy) |

### Call Graph Integration
- Uses `setCallGraph()` to receive the call graph
- Checks for native SQLite call graph availability
- Falls back to in-memory `calledBy` arrays
- `getFunctionCallers()` tries: calledBy array → native SQLite query

---

## Rust Analyzer (`crates/drift-core/src/error_handling/analyzer.rs`, ~300 lines)

### Class: ErrorHandlingAnalyzer

```rust
impl ErrorHandlingAnalyzer {
    pub fn new() -> Self
    pub fn analyze(&mut self, files: &[String]) -> ErrorHandlingResult
}
```

### AST-First Approach
The Rust analyzer takes a fundamentally different approach — it works directly on source files without a call graph:

1. Parse each file with `ParserManager`
2. Extract boundaries from AST (line-by-line scan for try/catch/except patterns)
3. Detect gaps from AST (async functions without error handling, .then() without .catch())
4. Extract custom error types from class definitions

### Boundary Extraction Algorithm
```
For each line in source:
  1. Detect "try" keyword → mark try_start
  2. Detect "catch" / "except" keyword → create ErrorBoundary
     - Check if catch is empty (swallowed)
     - Check if catch logs error
     - Check if catch rethrows
     - Extract caught types from catch signature
  3. Detect .catch() calls from AST call sites → PromiseCatch boundary
```

### Gap Detection Algorithm
```
For each function in ParseResult:
  1. If async:
     - Check if function body contains try/catch
     - Check if function has .catch() calls within its range
     - If neither and contains "await" → UnhandledAsync gap
  2. For all call sites:
     - .then() without nearby .catch() → UnhandledPromise gap
     - .unwrap() → UnwrapWithoutCheck gap (High severity)
     - .expect() → UnwrapWithoutCheck gap (Medium severity)
```

### Error Type Extraction
```
For each class in ParseResult:
  If class.extends contains "Error" or "Exception" or "Throwable"
  OR class.name ends with "Error" or "Exception"
  → Extract as ErrorType
```

### Caught Type Extraction (multi-language)
```
JavaScript/TypeScript: "catch (e: Error)" → extract type after ':'
Python: "except ValueError as e" → extract word after "except"
Java/C#: "catch (IOException e)" → extract first word in parens
```

### Helper Methods
- `is_empty_catch(lines, line)` — Checks for `{}`, `{ }`, or `pass`
- `check_logs_error(lines, line)` — Scans next 10 lines for console.error, logger.error, etc.
- `check_rethrows(lines, line)` — Scans next 10 lines for `throw`, `raise`, `rethrow`
- `get_function_source(lines, func)` — Extracts function body text
- `function_has_try_catch(lines, func)` — Checks if function contains try+catch

---

## v2 Merge Strategy

The two implementations are complementary:
- **Rust**: Fast AST-level pattern detection (boundaries, gaps, error types)
- **TypeScript**: Deep call-graph-aware topology analysis (propagation, quality scoring)

v2 should:
1. Keep Rust for AST-level extraction (boundaries, gaps, error types)
2. Move propagation chain analysis to Rust (graph traversal is ideal for Rust)
3. Move quality scoring to Rust (pure math)
4. Keep framework boundary detection in Rust (pattern matching)
5. Expose topology via NAPI for MCP tools
