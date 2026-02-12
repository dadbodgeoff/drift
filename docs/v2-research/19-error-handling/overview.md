# Error Handling Analysis — Overview

## Location
- `packages/core/src/error-handling/` — TypeScript (3 files)
- `crates/drift-core/src/error_handling/` — Rust (3 files)

## What It Is
The Error Handling Analyzer builds a complete topology of how errors flow through a codebase. It detects try/catch blocks, error boundaries, unhandled error paths, error propagation chains, and async error handling gaps. It integrates with the call graph to trace error flow across function boundaries.

## Core Design Principles
1. Error handling is analyzed as a topology — not just per-function, but across call chains
2. Unhandled error paths are severity-ranked (critical for entry points, lower for internal)
3. Framework boundaries are detected (React ErrorBoundary, Express middleware, NestJS filters, etc.)
4. Async error handling is tracked separately (unhandled promises are a distinct class of bug)
5. Error transformations along propagation chains are tracked (does it preserve stack trace?)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              ErrorHandlingAnalyzer                       │
│  (error-handling-analyzer.ts — main analysis engine)    │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Profile  │ Boundary │ Propag.  │   Gap                  │
│ Building │ Detection│ Chains   │   Detection            │
├──────────┴──────────┴──────────┴────────────────────────┤
│              Call Graph Integration                      │
│  Caller lookup │ Path traversal │ Native SQLite queries  │
├─────────────────────────────────────────────────────────┤
│              Rust Core (crates/drift-core)               │
│  ErrorPattern │ CatchBlock │ ErrorPropagation            │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `error-handling-analyzer.ts` — `ErrorHandlingAnalyzer` class: main analysis API
- `types.ts` — All error handling types
- `index.ts` — Public exports

## Analysis Phases

### Phase 1: Function Profiling
For each function in the call graph, build an `ErrorHandlingProfile`:
- Does it have try/catch?
- Can it throw? Where?
- What does it catch? (error types, catch actions)
- Does it rethrow after catching?
- For async functions: are promises handled?
- Quality score (0-100)

### Phase 2: Boundary Detection
Identify error boundaries — functions that catch errors from their callees:
- Framework boundaries: React ErrorBoundary, Express error middleware, NestJS exception filters, Spring @ExceptionHandler, Laravel exception handlers
- Custom boundaries: functions with try/catch that catch from multiple callers
- Coverage: what percentage of callers are protected by this boundary

### Phase 3: Propagation Chain Analysis
Trace how errors flow from source to sink:
```
Source (throw) → [intermediate functions] → Sink (catch) or Uncaught
```
- Track error transformations along the chain (type changes, stack preservation)
- Measure chain depth
- Identify chains that escape without being caught

### Phase 4: Gap Detection
Find error handling gaps:
- `no-try-catch` — Function can throw but has no error handling
- `swallowed-error` — Catch block that silently swallows errors
- `unhandled-async` — Async function with unhandled promise chains
- `bare-catch` — Catch block that catches `any` without type checking
- `missing-boundary` — Entry point without error boundary protection

## Key Types

### ErrorHandlingProfile
```typescript
interface ErrorHandlingProfile {
  functionId: string;
  file: string;
  name: string;
  qualifiedName: string;
  line: number;
  hasTryCatch: boolean;
  canThrow: boolean;
  throwLocations: number[];
  catchClauses: CatchClause[];
  rethrows: boolean;
  asyncHandling: AsyncErrorHandling | null;
  isAsync: boolean;
  qualityScore: number;        // 0-100
}
```

### CatchClause
```typescript
interface CatchClause {
  errorType: string;           // Error type or 'any' for bare catch
  action: CatchAction;         // log, rethrow, swallow, transform, recover
  line: number;
  preservesError: boolean;
}
```

### ErrorBoundary
```typescript
interface ErrorBoundary {
  functionId: string;
  file: string;
  name: string;
  catchesFrom: string[];       // Function IDs caught from
  handledTypes: string[];
  isFrameworkBoundary: boolean;
  frameworkType?: string;      // react-error-boundary, express-middleware, etc.
  coverage: number;            // % of callers protected
  line: number;
}
```

### UnhandledErrorPath
```typescript
interface UnhandledErrorPath {
  entryPoint: string;
  path: string[];              // Function IDs in the path
  errorType: string;
  severity: ErrorSeverity;     // critical, high, medium, low
  suggestedBoundary: string;   // Where to add error handling
  reason: string;
}
```

### ErrorPropagationChain
```typescript
interface ErrorPropagationChain {
  source: { functionId: string; throwLine: number };
  sink: { functionId: string; catchLine: number } | null;
  propagationPath: string[];
  transformations: ErrorTransformation[];
  depth: number;
}
```

## Metrics & Summary

### ErrorHandlingMetrics
- Total functions analyzed
- Functions with try/catch, functions that throw
- Boundary count, unhandled path count
- Unhandled by severity (critical/high/medium/low)
- Average quality score
- Swallowed error count, unhandled async count
- Framework boundaries detected

### ErrorHandlingSummary
- Coverage percentage (functions with handling / total)
- Critical unhandled paths
- Quality distribution (excellent/good/fair/poor)
- Top issues ranked by severity

## MCP Integration
Exposed via `drift_error_handling` MCP tool with actions:
- `gaps` — Find error handling gaps with severity filtering
- `boundaries` — List error boundaries
- `propagation` — Trace error propagation chains
- `summary` — Get error handling summary

## V2 Notes
- Function profiling requires AST analysis — should use Rust parsers
- Boundary detection involves call graph traversal — move to Rust
- Propagation chain analysis is graph traversal — ideal for Rust
- Gap detection is the query layer — can stay TS
- Framework boundary detection is pattern matching — Rust
