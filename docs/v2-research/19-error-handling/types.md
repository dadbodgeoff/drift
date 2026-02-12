# Error Handling Types

## TypeScript Types (`packages/core/src/error-handling/types.ts`, ~400 lines)

### Core Enums

```typescript
type CatchAction = 'log' | 'rethrow' | 'swallow' | 'transform' | 'recover';
type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';
type ErrorHandlingQuality = 'excellent' | 'good' | 'fair' | 'poor';
```

### CatchClause
```typescript
interface CatchClause {
  errorType: string;       // Error type or 'any' for bare catch
  action: CatchAction;     // What happens in the catch block
  line: number;
  preservesError: boolean; // Does it preserve the original error?
}
```

### AsyncErrorHandling
```typescript
interface AsyncErrorHandling {
  hasCatch: boolean;                // Has .catch() on promises
  hasAsyncTryCatch: boolean;        // Uses try/catch with await
  hasUnhandledPromises: boolean;    // Has unhandled promise chains
  unhandledLocations: Array<{ line: number; expression: string }>;
}
```

### ErrorHandlingProfile (per-function)
```typescript
interface ErrorHandlingProfile {
  functionId: string;
  file: string;
  name: string;
  qualifiedName: string;           // "ClassName.methodName"
  line: number;
  hasTryCatch: boolean;
  canThrow: boolean;
  throwLocations: number[];
  catchClauses: CatchClause[];
  rethrows: boolean;
  asyncHandling: AsyncErrorHandling | null;
  isAsync: boolean;
  qualityScore: number;            // 0-100
}
```

### ErrorBoundary
```typescript
interface ErrorBoundary {
  functionId: string;
  file: string;
  name: string;
  catchesFrom: string[];           // Function IDs caught from
  handledTypes: string[];
  isFrameworkBoundary: boolean;
  frameworkType?: 'react-error-boundary' | 'express-middleware' | 'nestjs-filter' | 'spring-handler' | 'laravel-handler';
  coverage: number;                // % of callers protected
  line: number;
}
```

### UnhandledErrorPath
```typescript
interface UnhandledErrorPath {
  entryPoint: string;
  path: string[];                  // Function IDs in the path
  errorType: string;
  severity: ErrorSeverity;
  suggestedBoundary: string;       // Where to add error handling
  reason: string;
}
```

### ErrorTransformation
```typescript
interface ErrorTransformation {
  location: string;                // Function ID
  fromType: string;
  toType: string;
  preservesStack: boolean;
  line: number;
}
```

### ErrorPropagationChain
```typescript
interface ErrorPropagationChain {
  source: { functionId: string; throwLine: number };
  sink: { functionId: string; catchLine: number } | null;  // null = uncaught
  propagationPath: string[];
  transformations: ErrorTransformation[];
  depth: number;
}
```

### ErrorHandlingTopology (complete result)
```typescript
interface ErrorHandlingTopology {
  functions: Map<string, ErrorHandlingProfile>;
  boundaries: ErrorBoundary[];
  unhandledPaths: UnhandledErrorPath[];
  propagationChains: ErrorPropagationChain[];
  generatedAt: string;
  projectRoot: string;
}
```

### ErrorHandlingMetrics
```typescript
interface ErrorHandlingMetrics {
  totalFunctions: number;
  functionsWithTryCatch: number;
  functionsThatThrow: number;
  boundaryCount: number;
  unhandledCount: number;
  unhandledBySeverity: Record<ErrorSeverity, number>;
  avgQualityScore: number;
  swallowedErrorCount: number;
  unhandledAsyncCount: number;
  frameworkBoundaries: number;
}
```

### ErrorHandlingSummary
```typescript
interface ErrorHandlingSummary {
  totalFunctions: number;
  coveragePercent: number;
  unhandledPaths: number;
  criticalUnhandled: number;
  avgQuality: number;
  qualityDistribution: Record<ErrorHandlingQuality, number>;
  topIssues: Array<{
    type: 'swallowed' | 'unhandled-async' | 'no-boundary' | 'bare-catch';
    count: number;
    severity: ErrorSeverity;
  }>;
}
```

### FunctionErrorAnalysis (detailed per-function)
```typescript
interface FunctionErrorAnalysis {
  profile: ErrorHandlingProfile;
  incomingErrors: Array<{ from: string; errorType: string }>;
  outgoingErrors: Array<{ to: string; caught: boolean }>;
  isProtected: boolean;
  protectingBoundary?: ErrorBoundary;
  issues: Array<{ type: string; message: string; severity: ErrorSeverity; line?: number }>;
  suggestions: string[];
}
```

### ErrorHandlingGap
```typescript
interface ErrorHandlingGap {
  functionId: string;
  file: string;
  name: string;
  line: number;
  gapType: 'no-try-catch' | 'swallowed-error' | 'unhandled-async' | 'bare-catch' | 'missing-boundary';
  severity: ErrorSeverity;
  description: string;
  suggestion: string;
  riskScore: number;               // 0-100
}
```

### Options Types
```typescript
interface ErrorHandlingOptions {
  rootDir: string;
  includeAsync?: boolean;          // Default: true
  detectFrameworkBoundaries?: boolean; // Default: true
  maxPropagationDepth?: number;    // Default: 20
}

interface GapDetectionOptions {
  minSeverity?: ErrorSeverity;     // Default: 'low'
  limit?: number;                  // Default: 20
  includeSuggestions?: boolean;    // Default: true
  files?: string[];                // Focus on specific files
}

interface BoundaryAnalysisOptions {
  includeFramework?: boolean;
  minCoverage?: number;
}
```

---

## Rust Types (`crates/drift-core/src/error_handling/types.rs`)

### BoundaryType
```rust
pub enum BoundaryType {
    TryCatch,       // JS/TS/Java/C# try-catch
    TryExcept,      // Python try-except
    TryFinally,     // try-finally without catch
    ErrorHandler,   // Framework error handler
    PromiseCatch,   // .catch() on promises
    AsyncAwait,     // async/await with try-catch
    ResultMatch,    // Rust match on Result<T, E>
    PanicHandler,   // Rust panic::catch_unwind
}
```

### ErrorBoundary (Rust)
```rust
pub struct ErrorBoundary {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
    pub boundary_type: BoundaryType,
    pub caught_types: Vec<String>,
    pub rethrows: bool,
    pub logs_error: bool,
    pub is_swallowed: bool,
}
```

### GapType
```rust
pub enum GapType {
    UnhandledPromise,      // .then() without .catch()
    UnhandledAsync,        // async function without try/catch
    MissingCatch,          // try without catch
    SwallowedError,        // empty catch block
    UnwrapWithoutCheck,    // Rust .unwrap() / .expect()
    UncheckedResult,       // Rust Result not matched
    MissingErrorBoundary,  // Entry point without error handling
}
```

### GapSeverity
```rust
pub enum GapSeverity { Low, Medium, High, Critical }
```

### ErrorGap (Rust)
```rust
pub struct ErrorGap {
    pub file: String,
    pub line: u32,
    pub function: String,
    pub gap_type: GapType,
    pub severity: GapSeverity,
    pub description: String,
}
```

### ErrorType
```rust
pub struct ErrorType {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub extends: Option<String>,
    pub is_exported: bool,
}
```

### ErrorHandlingResult (Rust aggregate)
```rust
pub struct ErrorHandlingResult {
    pub boundaries: Vec<ErrorBoundary>,
    pub gaps: Vec<ErrorGap>,
    pub error_types: Vec<ErrorType>,
    pub files_analyzed: usize,
    pub duration_ms: u64,
}
```

---

## Type Mapping: Rust ↔ TypeScript

| Concept | Rust | TypeScript |
|---------|------|------------|
| Boundary | `ErrorBoundary` (file-level) | `ErrorBoundary` (function-level, with call graph) |
| Gap | `ErrorGap` (AST-detected) | `ErrorHandlingGap` (call-graph-aware, with risk score) |
| Error type | `ErrorType` | Extracted via `FunctionErrorAnalysis` |
| Propagation | Not implemented | `ErrorPropagationChain` (call graph traversal) |
| Topology | Not implemented | `ErrorHandlingTopology` (complete graph) |
| Quality | Not implemented | `qualityScore` (0-100) per function |

The Rust implementation is AST-first (pattern detection), while TypeScript is call-graph-first (topology analysis). v2 should merge both approaches.
