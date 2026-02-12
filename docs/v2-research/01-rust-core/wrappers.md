# Rust Wrappers Analyzer

## Location
`crates/drift-core/src/wrappers/`

## Files
- `analyzer.rs` — `WrappersAnalyzer`: orchestrates detection and clustering
- `detector.rs` — `WrapperDetector`: identifies wrapper functions by analyzing call targets against known primitives
- `clusterer.rs` — `WrapperClusterer`: groups related wrappers into clusters
- `types.rs` — All types: `WrapperInfo`, `WrapperCluster`, `WrapperCategory`, `WrappersStats`
- `mod.rs` — Module exports

## NAPI Exposure
- `analyze_wrappers(files: Vec<String>) -> JsWrappersResult`

## What It Does
Detects functions that wrap framework primitives (React hooks, fetch APIs, validation libraries, etc.) by analyzing the call graph within each function. Groups related wrappers into clusters for pattern recognition.

## Detection Algorithm

```
For each file:
  Parse → extract functions and call sites
  For each function:
    Extract calls within function's line range
    For each call:
      Check against known primitives registry
      If match found:
        Calculate confidence
        If confidence > 0.5: record as wrapper
        Break (one wrapper per function)
```

## Known Primitives Registry

| Category | Primitives |
|----------|-----------|
| StateManagement | useState, useReducer |
| SideEffects | useEffect, useLayoutEffect |
| DataFetching | fetch, axios, useSWR, useQuery |
| Validation | zod, yup, joi |
| Logging | console.log/error/warn/info/debug, logger.* |
| Authentication | Auth-related primitives |

Primitive matching: exact match OR `call.ends_with(primitive)` OR `call.contains(primitive)`

## Confidence Scoring

```
base = 0.6

Name-based adjustments:
  + 0.15 if name starts with: use, with, create, make
  + 0.15 if name contains: wrapper, hook, helper
  + 0.10 if custom hook pattern (useXxx where X is uppercase)

Call-count adjustments:
  - 0.10 if total_calls > 10 (complex function, probably not a wrapper)
  + 0.10 if total_calls ≤ 3 (focused wrapper)

confidence = clamp(base + adjustments, 0.0, 1.0)
```

Minimum threshold: 0.5 (below this, not recorded as wrapper)

## Name-Based Category Fallback

When wrapped primitive doesn't match the registry, falls back to function name analysis:

| Name Contains | Category |
|--------------|----------|
| auth, login, session | Authentication |
| fetch, api, request | DataFetching |
| valid, schema | Validation |
| log, trace, debug | Logging |
| cache, memo | Caching |
| error, catch, handle | ErrorHandling |
| form, input, field | FormHandling |
| route, navigate, link | Routing |
| create, factory, build | Factory |
| (none of above) | Other |

## WrapperCategory Enum
```rust
WrapperCategory {
    StateManagement, SideEffects, DataFetching, Validation,
    Logging, Authentication, Caching, ErrorHandling,
    FormHandling, Routing, Factory, Other
}
```

## Types

```rust
WrapperInfo {
    name: String,           // Function name
    file: String,           // File path
    line: u32,              // Line number
    wraps: Vec<String>,     // Wrapped primitives
    category: WrapperCategory,
    is_exported: bool,
    usage_count: u32,       // Filled by analyzer (cross-file usage)
    confidence: f32,
}

WrapperCluster {
    name: String,           // Cluster name
    category: WrapperCategory,
    wrappers: Vec<WrapperInfo>,
    total_usage: u32,
}

WrappersResult {
    wrappers: Vec<WrapperInfo>,
    clusters: Vec<WrapperCluster>,
    stats: WrappersStats,
}

WrappersStats {
    total_wrappers: usize,
    by_category: HashMap<String, usize>,
    by_primitive: Vec<PrimitiveCount>,
    exported_count: usize,
    files_analyzed: usize,
    duration_ms: u64,
}
```

## Call Extraction Strategy
Uses `ParseResult.calls` filtered by function line range:
```rust
result.calls.iter()
    .filter(|c| c.range.start.line >= func.range.start.line &&
               c.range.start.line <= func.range.end.line)
    .map(|c| if receiver { format!("{}.{}", receiver, callee) } else { callee })
```

## TS Counterpart
`packages/core/src/wrappers/` — Additional features:
- Cross-file usage counting
- Richer clustering with similarity scoring
- Integration with pattern store

## v2 Notes
- Primitive registry is React-focused. Needs expansion for: Vue (composables), Angular (services), Svelte (stores), Express (middleware).
- Usage counting requires call graph — currently set to 0 in Rust, filled by TS layer.
- Clustering algorithm in `clusterer.rs` needs documentation (not covered here).
