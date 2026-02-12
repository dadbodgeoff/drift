# Rust Coupling Analyzer

> `crates/drift-core/src/coupling/` — 3 files (~430 lines)
> NAPI bridge: `crates/drift-napi/src/lib.rs` — `analyze_coupling()`
> TS counterpart: `packages/core/src/module-coupling/` (~900 lines, significantly richer)

## What It Does

Analyzes module-level import/export dependencies to compute Robert C. Martin coupling metrics, detect dependency cycles, identify coupling hotspots, and find unused exports. Uses AST-parsed data from the `ParserManager` (tree-sitter) — no regex fallback.

## File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `mod.rs` | ~10 | Module declaration, re-exports `CouplingAnalyzer` + all types |
| `types.rs` | ~100 | Data model: `ModuleMetrics`, `DependencyCycle`, `CouplingHotspot`, `UnusedExport`, `FileGraph` |
| `analyzer.rs` | ~430 | `CouplingAnalyzer` implementation: graph building, metrics, cycle detection, health scoring |

## Architecture

```
                    ┌──────────────────────┐
                    │   analyze_coupling() │  ← NAPI entry point
                    │   (drift-napi)       │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  CouplingAnalyzer     │
                    │  (drift-core)         │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
    ┌─────────▼──────┐ ┌──────▼──────┐ ┌───────▼───────┐
    │ ParserManager  │ │ Graph Build │ │ Analysis      │
    │ (tree-sitter)  │ │ (FileGraph) │ │ (metrics,     │
    │ → ParseResult  │ │ → modules   │ │  cycles, etc) │
    └────────────────┘ └─────────────┘ └───────────────┘
```

## CouplingAnalyzer

### Construction

```rust
pub struct CouplingAnalyzer {
    parser: ParserManager,  // tree-sitter parser for all languages
}
```

Creates a `ParserManager` internally. Implements `Default`.

### Main Entry Point: `analyze()`

```rust
pub fn analyze(&mut self, files: &[String]) -> CouplingAnalysisResult
```

**Pipeline (6 steps):**

1. **Parse files** — For each file, calls `build_file_graph_from_ast()` which uses `ParserManager::parse_file()` to get a `ParseResult`, then extracts imports, exports, exported functions, and exported classes into a `FileGraph`
2. **Build module map** — Groups files by parent directory (directory = module)
3. **Calculate module metrics** — Computes Ca, Ce, instability, abstractness, distance per module
4. **Detect cycles** — DFS-based cycle detection on the module dependency graph
5. **Find hotspots** — Modules with total coupling (Ca + Ce) ≥ 3, top 10
6. **Find unused exports** — Exports that are never imported by any analyzed file
7. **Calculate health score** — Penalty-based scoring starting from 100

Returns `CouplingAnalysisResult` with timing information.

### Graph Building: `build_file_graph_from_ast()`

AST-first approach — reads file from disk, parses via tree-sitter, extracts:

- **Imports:** From `ParseResult.imports` — resolves relative paths, records source path and named symbols
- **Exports:** From `ParseResult.exports` — records name, line, and default status
- **Exported functions:** From `ParseResult.functions` where `is_exported == true`
- **Exported classes:** From `ParseResult.classes` where `is_exported == true`

Import resolution (`resolve_import`):
- External packages (no `.` or `/` prefix) → returned as-is
- Relative paths → resolved against the importing file's directory
- No extension resolution (`.ts`, `.js`, `/index` not appended)

### Module Metrics Calculation

Modules are defined as directories (parent path of each file).

For each module:
- **Ca (afferent coupling):** Count of distinct other modules that import from this module
- **Ce (efferent coupling):** Count of distinct other modules this module imports from
- **Instability:** `Ce / (Ca + Ce)` — 0 = maximally stable, 1 = maximally unstable
- **Abstractness:** Hardcoded to `0.0` (TODO — needs deeper AST analysis for interfaces/abstract classes)
- **Distance from main sequence:** `|A + I - 1|` — distance from the ideal line

Results sorted by total coupling (Ca + Ce) descending.

### Cycle Detection

DFS with recursion stack tracking:

```
1. Build module dependency graph (module → set of dependent modules)
2. For each unvisited module:
   a. Push to path and recursion stack
   b. For each neighbor:
      - If unvisited → recurse
      - If in recursion stack → cycle found (extract from path)
   c. Pop from path and recursion stack
```

**Severity classification:**

| Cycle Length | Severity |
|-------------|----------|
| ≤ 2 modules | `Info` |
| 3–4 modules | `Warning` |
| ≥ 5 modules | `Critical` |

Each cycle records `files_affected` (sum of files across all modules in the cycle).

### Hotspot Detection

Simple threshold filter:
- Modules with `Ca + Ce ≥ 3` are hotspots
- Returns top 10 by total coupling
- `incoming` and `outgoing` lists are currently empty (TODO — not tracked during analysis)

### Unused Export Detection

```
1. Build set of all (source_file, symbol_name) pairs from imports
2. For each file's exports:
   - Check if any import references this file + symbol name
   - If not referenced and not a default export → mark as unused
```

`export_type` is always `"unknown"` (TODO — could be inferred from `ParseResult`).

### Health Score

Starts at 100, applies penalties:

| Condition | Penalty |
|-----------|---------|
| Critical cycle | -15 |
| Warning cycle | -8 |
| Info cycle | -3 |
| Module with Ca + Ce > 10 | -2 |
| Module with distance > 0.7 | -1 |

Clamped to [0, 100].

## Types (`types.rs`)

### ModuleMetrics
```rust
pub struct ModuleMetrics {
    pub path: String,           // Module (directory) path
    pub ca: usize,              // Afferent coupling
    pub ce: usize,              // Efferent coupling
    pub instability: f32,       // Ce / (Ca + Ce)
    pub abstractness: f32,      // Always 0.0 currently
    pub distance: f32,          // |A + I - 1|
    pub files: Vec<String>,     // Files in this module
}
```

### DependencyCycle
```rust
pub struct DependencyCycle {
    pub modules: Vec<String>,
    pub severity: CycleSeverity,  // Info | Warning | Critical
    pub files_affected: usize,
}
```

### CouplingHotspot
```rust
pub struct CouplingHotspot {
    pub module: String,
    pub total_coupling: usize,
    pub incoming: Vec<String>,    // Currently always empty
    pub outgoing: Vec<String>,    // Currently always empty
}
```

### UnusedExport
```rust
pub struct UnusedExport {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub export_type: String,      // Currently always "unknown"
}
```

### FileGraph (internal)
```rust
pub struct FileGraph {
    pub path: String,
    pub imports: Vec<ImportEdge>,
    pub exports: Vec<ExportNode>,
}

pub struct ImportEdge {
    pub source: String,           // Resolved import path
    pub symbols: Vec<String>,     // Named imports
    pub line: u32,
}

pub struct ExportNode {
    pub name: String,
    pub line: u32,
    pub is_default: bool,
}
```

### CouplingAnalysisResult
```rust
pub struct CouplingAnalysisResult {
    pub modules: Vec<ModuleMetrics>,
    pub cycles: Vec<DependencyCycle>,
    pub hotspots: Vec<CouplingHotspot>,
    pub unused_exports: Vec<UnusedExport>,
    pub health_score: f32,
    pub files_analyzed: usize,
    pub duration_ms: u64,
}
```

## NAPI Bridge

Single function exposed to JavaScript:

```rust
#[napi]
pub fn analyze_coupling(files: Vec<String>) -> Result<JsCouplingResult>
```

**JS-exposed types** (all `#[napi(object)]`):

| Rust Type | JS Type | Notes |
|-----------|---------|-------|
| `JsModuleMetrics` | object | `ca`/`ce` as `i64`, `instability`/`abstractness`/`distance` as `f64` |
| `JsDependencyCycle` | object | `severity` as string (`"info"`, `"warning"`, `"critical"`) |
| `JsCouplingHotspot` | object | `total_coupling` as `i64` |
| `JsUnusedExport` | object | `line` as `i64` |
| `JsCouplingResult` | object | All fields, `health_score`/`files_analyzed`/`duration_ms` as numeric |

Type conversions: `usize → i64`, `f32 → f64`, `CycleSeverity → String`.

## Rust vs TypeScript Parity Gap

| Feature | Rust | TypeScript | Gap |
|---------|------|------------|-----|
| Ca/Ce/Instability metrics | ✅ | ✅ | — |
| Abstractness computation | ❌ (hardcoded 0.0) | ✅ (abstract exports / total) | Port from TS |
| Distance from main sequence | ✅ (but broken due to abstractness=0) | ✅ | Fix after abstractness |
| Cycle detection (DFS) | ✅ | ✅ | — |
| Cycle severity thresholds | ✅ (Info/Warning/Critical) | ✅ (low/medium/high/critical) | Different scale names |
| Break point suggestions | ❌ | ✅ (effort, rationale, approach) | Port from TS |
| Hotspot detection | ✅ (basic threshold) | ✅ (configurable) | Enhance Rust |
| Hotspot incoming/outgoing lists | ❌ (always empty) | ✅ | Fix in Rust |
| Unused export detection | ✅ (basic) | ✅ (with reason inference) | Port reason inference |
| Export type classification | ❌ (always "unknown") | ✅ (function/class/type/constant) | Port from ParseResult |
| Module role classification | ❌ | ✅ (hub/leaf/bridge/isolated) | Port from TS |
| Refactor impact assessment | ❌ | ✅ (health, effort, risk, suggestions) | Port from TS |
| Transitive dependency analysis | ❌ | ✅ (via call graph) | Needs call graph integration |
| Module health scoring | ✅ (penalty-based) | ✅ (multi-factor) | Different algorithms |
| Call graph integration | ❌ | ✅ | Major gap |
| Import path resolution | Basic (relative only) | Full (extensions, index files) | Enhance Rust |
| Aggregate graph metrics | ❌ | ✅ (avg instability, max coupling, etc.) | Port from TS |

### Priority for v2

1. **Fix abstractness** — Parse interfaces/abstract classes from `ParseResult` (data is already there)
2. **Fix hotspot incoming/outgoing** — Track during metrics calculation (trivial)
3. **Fix export_type** — Infer from `ParseResult` function/class/export data (trivial)
4. **Add module roles** — Simple classification from Ca/Ce thresholds
5. **Add call graph integration** — Enable transitive analysis (medium effort, depends on Rust call graph)
6. **Port break point suggestions** — Heuristic logic, medium effort
7. **Port refactor impact** — Depends on call graph integration

## v2 Notes

- The Rust implementation is a solid foundation but significantly less featured than the TS version
- The AST-first approach (using `ParserManager`) is correct — no regex needed
- Import resolution is naive (no `.ts`/`.js` extension resolution, no `index` file resolution) — this will cause missed edges
- Abstractness being hardcoded to 0.0 means the distance metric is also wrong
- The health score algorithm differs between Rust (penalty-based from 100) and TS (weighted multi-factor)
- Cycle severity uses different names (Info/Warning/Critical vs low/medium/high/critical)
- The TS version's refactor impact assessment and break point suggestions are the biggest value-adds missing from Rust
