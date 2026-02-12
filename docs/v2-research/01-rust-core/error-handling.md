# Rust Error Handling Analyzer

## Location
`crates/drift-core/src/error_handling/`

## Files
- `analyzer.rs` — `ErrorHandlingAnalyzer`: detects error boundaries and identifies error handling gaps
- `types.rs` — `ErrorBoundary`, `BoundaryType`, `ErrorGap`, `GapType`, `GapSeverity`, `ErrorType`, `ErrorHandlingResult`
- `mod.rs` — Module exports

## NAPI Exposure
- `analyze_error_handling(files: Vec<String>) -> JsErrorHandlingResult`

## What It Does
- Detects error boundaries (try/catch, error handlers, middleware, decorators)
- Identifies error handling gaps (unhandled promises, missing catch blocks, empty catch)
- Classifies boundary types and gap severities
- Reports error types used (custom error classes, built-in errors)

## Types

```rust
ErrorBoundary {
    file: String,
    line: u32,
    end_line: u32,
    boundary_type: BoundaryType,
    handler_name: Option<String>,
    catches: Vec<String>,        // Error types caught
    rethrows: bool,              // Does it re-throw?
    has_logging: bool,           // Does it log the error?
}

BoundaryType {
    TryCatch,           // try/catch block
    ErrorMiddleware,    // Express-style error middleware
    ErrorBoundary,      // React error boundary
    GlobalHandler,      // process.on('uncaughtException'), etc.
    Decorator,          // @Catch, @ExceptionHandler
    ResultType,         // Rust Result<T, E>, Go error return
}

ErrorGap {
    file: String,
    line: u32,
    gap_type: GapType,
    severity: GapSeverity,
    context: String,             // Code context around the gap
    suggestion: Option<String>,  // Fix suggestion
}

GapType {
    UnhandledPromise,    // await without try/catch
    EmptyCatch,          // catch block with no handling
    MissingCatch,        // Promise chain without .catch()
    SwallowedError,      // catch that doesn't log or rethrow
    UncheckedResult,     // Rust: Result not checked
    IgnoredError,        // Go: err not checked
}

GapSeverity { Critical, High, Medium, Low }

ErrorType {
    name: String,
    file: String,
    line: u32,
    extends: Option<String>,     // Parent error class
    is_custom: bool,
}

ErrorHandlingResult {
    boundaries: Vec<ErrorBoundary>,
    gaps: Vec<ErrorGap>,
    error_types: Vec<ErrorType>,
    stats: ErrorHandlingStats,
}
```

## TS Counterpart
`packages/core/src/error-handling/` — Richer analysis with:
- Error propagation chain tracking
- Error profile generation per module
- Integration with call graph for cross-function error flow

## v2 Notes
- Rust version handles AST-level detection. TS adds cross-function analysis via call graph.
- Gap detection could be enhanced with data flow analysis (tracking error variables through code).
