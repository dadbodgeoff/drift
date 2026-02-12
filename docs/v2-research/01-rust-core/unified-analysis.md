# Rust Unified Analysis

## Location
`crates/drift-core/src/unified/`

## Files
| File | Lines (approx) | Purpose |
|------|----------------|---------|
| `mod.rs` | ~10 | Module exports |
| `analyzer.rs` | ~170 | Combined pattern detection pipeline |
| `ast_patterns.rs` | ~600 | AST-based pattern detection with per-language tree-sitter queries |
| `string_analyzer.rs` | ~200 | Regex-on-strings fallback detection |
| `interner.rs` | ~220 | String interning for memory efficiency (Symbol, PathInterner, FunctionInterner) |
| `index.rs` | ~280 | In-memory function resolution index |
| `types.rs` | ~250 | All unified analysis types |

## What It Does

The unified analyzer is Drift's core pattern detection engine in Rust. It combines AST-first pattern detection with regex-on-strings fallback in a single pass over the codebase. No intermediate files, no redundant reads.

## NAPI Exposure
- `analyze_unified(root, options) -> JsUnifiedResult`

---

## Architecture: 4-Phase Per-File Pipeline

Each file goes through 4 phases inside `analyze_file()`:

```
┌─────────────────────────────────────────────────────────────┐
│  File Content                                               │
│  ↓                                                          │
│  tree-sitter parse → ParseResult (with AST tree)            │
│  ↓                                                          │
│  Phase 1: AstPatternDetector.detect(tree, source, lang)     │
│           → Vec<DetectedPattern> (confidence 0.85-0.95)     │
│  ↓                                                          │
│  Phase 2: AstPatternDetector.extract_strings(tree, source)  │
│           → Vec<StringLiteral> (strings >3 chars only)      │
│  ↓                                                          │
│  Phase 3: StringLiteralAnalyzer.analyze(strings, file)      │
│           → Vec<DetectedPattern> (confidence 0.8-0.9)       │
│           Regex applied ONLY to extracted strings, NOT raw   │
│  ↓                                                          │
│  Phase 4: ResolutionIndex.insert(func_name, file, line...)  │
│           Index every function for cross-file resolution     │
└─────────────────────────────────────────────────────────────┘
```

### Top-Level Flow (`UnifiedAnalyzer.analyze()`)

```
1. Scan files (Scanner with ScanConfig)
2. Parallel or sequential analysis (controlled by UnifiedOptions.parallel)
   - Each file → analyze_file() → Option<FilePatterns>
   - Resolution index shared via Arc<RwLock<ResolutionIndex>>
3. Compute statistics (total patterns, violations, timing)
4. Return UnifiedResult
```

### Parallel Execution

When `options.parallel = true`, uses `rayon::par_iter()` over scanned files. Each rayon thread creates its own `ParserManager` (noted as optimization TODO — thread-local pooling would be better). The `ResolutionIndex` is shared via `Arc<RwLock<>>`.

---

## Phase 1: AST Pattern Detection (`AstPatternDetector`)

### Structure

```rust
pub struct AstPatternDetector {
    ts_queries: Vec<CompiledQuery>,    // TypeScript
    js_queries: Vec<CompiledQuery>,    // JavaScript
    py_queries: Vec<CompiledQuery>,    // Python
    java_queries: Vec<CompiledQuery>,  // Java
    csharp_queries: Vec<CompiledQuery>,// C#
    php_queries: Vec<CompiledQuery>,   // PHP
    go_queries: Vec<CompiledQuery>,    // Go
    rust_queries: Vec<CompiledQuery>,  // Rust
    cpp_queries: Vec<CompiledQuery>,   // C++ (also used for C)
}
```

### CompiledQuery

```rust
pub struct CompiledQuery {
    pub query: tree_sitter::Query,  // Pre-compiled tree-sitter query
    pub pattern_type: String,       // e.g. "auth-decorator", "express-route"
    pub category: PatternCategory,  // e.g. Auth, Api, Errors
    pub confidence: f32,            // 0.0-1.0
}
```

All queries are compiled once at `AstPatternDetector::new()` and reused across files.

### Per-Language Query Inventory

#### TypeScript (`build_typescript_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `auth-decorator` | Auth | 0.95 | `@Auth`, `@RequireAuth`, `@Authenticated`, `@Protected`, `@Guard` decorators |
| `middleware-usage` | Auth | 0.90 | `.use(auth)`, `.use(protect)`, `.use(guard)`, `.use(verify)`, `.use(session)` |
| `express-route` | Api | 0.90 | `.get("/path")`, `.post("/path")`, `.put()`, `.patch()`, `.delete()`, `.all()` |
| `try-catch` | Errors | 0.95 | `try { } catch (e) { }` blocks |

#### JavaScript (`build_javascript_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `express-route` | Api | 0.90 | Same as TypeScript route patterns |
| `try-catch` | Errors | 0.95 | Same as TypeScript try-catch |

#### Python (`build_python_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `fastapi-depends` | Auth | 0.90 | `Depends(auth_function)` calls |
| `auth-decorator` | Auth | 0.95 | `@login_required`, `@requires_auth`, `@authenticated`, `@permission_required` |
| `fastapi-route` | Api | 0.90 | `@app.get("/path")`, `@app.post()`, etc. |
| `try-except` | Errors | 0.95 | `try: ... except ExceptionType as e:` blocks |

#### Java (`build_java_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `spring-security` | Auth | 0.95 | `@PreAuthorize`, `@Secured`, `@RolesAllowed`, `@PermitAll`, `@DenyAll` |
| `spring-route` | Api | 0.95 | `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` |
| `jpa-entity` | DataAccess | 0.95 | `@Entity`, `@Table`, `@Repository`, `@Query` |
| `try-catch` | Errors | 0.95 | `try { } catch (ExceptionType e) { }` |

#### C# (`build_csharp_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `authorize-attribute` | Auth | 0.95 | `[Authorize]`, `[AllowAnonymous]` |
| `aspnet-route` | Api | 0.95 | `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpDelete]`, `[HttpPatch]`, `[Route]` |
| `ef-entity` | DataAccess | 0.95 | `[Table]`, `[Key]`, `[Column]`, `[ForeignKey]`, `[DbContext]` |

#### PHP (`build_php_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `laravel-middleware` | Auth | 0.90 | `->middleware('auth')` calls |
| `laravel-route` | Api | 0.90 | `Route::get()`, `Route::post()`, etc. |
| `eloquent-model` | DataAccess | 0.90 | `class X extends Model` |

#### Go (`build_go_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `http-handler` | Api | 0.90 | `.HandleFunc()`, `.Handle()`, `.Get()`, `.Post()`, `.Put()`, `.Delete()`, `.Patch()` |
| `error-check` | Errors | 0.90 | `if err != nil { }` pattern |

#### Rust (`build_rust_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `actix-route` | Api | 0.90 | `#[get]`, `#[post]`, `#[put]`, `#[delete]`, `#[patch]`, `#[route]` attributes |
| `result-match` | Errors | 0.85 | `match expr? { }` (try expression in match) |
| `derive-attribute` | DataAccess | 0.80 | `#[derive(...)]` (for Diesel/SQLx detection) |

#### C++ (`build_cpp_queries`)
| Pattern Type | Category | Confidence | What It Matches |
|-------------|----------|------------|-----------------|
| `try-catch` | Errors | 0.95 | `try { } catch (ExceptionType) { }` |
| `cpp-route` | Api | 0.85 | `CROW_ROUTE`, `route` calls |

### Detection Method

```rust
fn detect(&self, tree: &Tree, source: &[u8], language: Language, file: &str) -> Vec<DetectedPattern> {
    // For each CompiledQuery for this language:
    //   Run QueryCursor.matches() against the AST root
    //   For each match, extract the first capture node
    //   Create DetectedPattern with line/column/text/confidence
}
```

---

## Phase 2: String Extraction

`extract_strings()` walks the AST recursively looking for string literal nodes. The node kind varies by language:

| Language | String Node Kinds |
|----------|-------------------|
| TypeScript/JavaScript | `string`, `template_string` |
| Python | `string`, `concatenated_string` |
| Java/C# | `string_literal` |
| PHP | `string`, `encapsed_string` |
| Go | `interpreted_string_literal`, `raw_string_literal` |
| Rust | `string_literal`, `raw_string_literal` |
| C/C++ | `string_literal`, `raw_string_literal` |

Strings shorter than 4 characters are discarded. Quotes are stripped.

### StringContext Determination

Each extracted string gets a context based on its parent AST node:

```rust
pub enum StringContext {
    FunctionArgument,    // parent: arguments, argument_list, call_expression
    VariableAssignment,  // parent: variable_declarator, assignment_expression, assignment
    ObjectProperty,      // parent: pair, property, key_value_pair
    Decorator,           // parent: decorator, annotation, attribute
    ReturnValue,         // parent: return_statement
    ArrayElement,        // parent: array, list, array_expression
    Unknown,             // anything else
}
```

---

## Phase 3: String Literal Analysis (`StringLiteralAnalyzer`)

Regex is applied ONLY to pre-extracted string literals, never to raw source code. Uses `RegexSet` for efficient multi-pattern matching.

### Regex Pattern Sets

#### SQL Patterns (9 regexes) → Category: `DataAccess`, Confidence: `0.9`
```
(?i)SELECT\s+.+\s+FROM\s+\w+
(?i)INSERT\s+INTO\s+\w+
(?i)UPDATE\s+\w+\s+SET
(?i)DELETE\s+FROM\s+\w+
(?i)CREATE\s+TABLE\s+\w+
(?i)ALTER\s+TABLE\s+\w+
(?i)DROP\s+TABLE\s+\w+
(?i)JOIN\s+\w+\s+ON
(?i)WHERE\s+\w+\s*[=<>]
```

#### Route Patterns (6 regexes) → Category: `Api`, Confidence: `0.85`
```
^/api/v?\d*/
^/api/(?:admin|user|account|auth|profile|settings)
^/(?:dashboard|admin|settings|profile|billing)
^/auth/(?:login|logout|register|reset|verify)
:\w+                    ← path params like :id
\{[^}]+\}              ← path params like {userId}
```

#### Sensitive Data Patterns (8 regexes) → Category: `Security`, Confidence: `0.8`
```
(?i)password|passwd|pwd
(?i)secret|private[_-]?key
(?i)api[_-]?key|apikey
(?i)access[_-]?token|auth[_-]?token
(?i)credit[_-]?card|card[_-]?number
(?i)ssn|social[_-]?security
(?i)bearer\s+
(?i)authorization
```

#### Environment Patterns (6 regexes) → Category: `Config`, Confidence: `0.85`
```
(?i)process\.env\.\w+
(?i)os\.environ\[
(?i)getenv\(
(?i)env\(
(?i)\$\{[A-Z_]+\}
(?i)%[A-Z_]+%
```

#### Log Patterns (4 regexes) — compiled but not currently used in `analyze()`
```
(?i)console\.(log|error|warn|info|debug)
(?i)logger\.(log|error|warn|info|debug)
(?i)logging\.(log|error|warn|info|debug)
(?i)log\.(error|warn|info|debug)
```

### Confidence Score Summary

| Detection Source | Confidence Range |
|-----------------|-----------------|
| AST queries (decorators, annotations) | 0.85 – 0.95 |
| SQL in strings | 0.90 |
| Route paths in strings | 0.85 |
| Sensitive data in strings | 0.80 |
| Environment refs in strings | 0.85 |

---

## Phase 4: Resolution Index

### Purpose
Build an in-memory function index during analysis so cross-file call resolution can happen without a separate build phase.

### Data Structures

```rust
pub struct ResolutionIndex {
    name_index: BTreeMap<Symbol, SmallVec<[FunctionId; 4]>>,  // name → function IDs
    entries: FxHashMap<FunctionId, FunctionEntry>,              // ID → full entry
    file_index: FxHashMap<Symbol, Vec<FunctionId>>,            // file → functions
    path_interner: PathInterner,
    func_interner: FunctionInterner,
    next_id: u32,
}
```

- `BTreeMap` for ordered name lookups and efficient prefix search
- `FxHashMap` (rustc-hash) for O(1) ID lookups
- `SmallVec<[FunctionId; 4]>` avoids heap allocation for the common case of 1-4 functions sharing a name

### FunctionEntry

```rust
pub struct FunctionEntry {
    pub id: FunctionId,              // FunctionId(u32)
    pub name: Symbol,                // Interned function name
    pub qualified_name: Option<Symbol>, // e.g. "MyClass.myMethod"
    pub file: Symbol,                // Interned file path
    pub line: u32,
    pub is_exported: bool,
    pub is_async: bool,
}
```

### Resolution Algorithm

`resolve(name, caller_file) -> Resolution`:

```
1. Look up name symbol in name_index
   → Not found? Return Unresolved

2. Get candidate FunctionIds from name_index
   → Empty? Return Unresolved
   → Exactly 1? Return Resolved(candidate)

3. Prefer same-file resolution:
   If any candidate's file == caller_file → Return Resolved(that one)

4. Prefer exported functions:
   Filter to exported candidates only
   → Exactly 1 exported? Return Resolved(that one)

5. Multiple candidates remain → Return Ambiguous(all candidates)
```

### Resolution Enum

```rust
pub enum Resolution {
    Resolved(ResolvedFunction),       // Single match found
    Ambiguous(Vec<ResolvedFunction>), // Multiple candidates
    Unresolved,                       // No match
}
```

### IndexStats

```rust
pub struct IndexStats {
    pub unique_names: usize,       // Distinct function names
    pub total_functions: usize,    // Total indexed functions
    pub files: usize,              // Files with functions
    pub exported_functions: usize, // Exported function count
}
```

---

## String Interning (`interner.rs`)

### Why
Large codebases repeat file paths and function names thousands of times. Interning stores each unique string once and uses a 4-byte `Symbol(u32)` handle everywhere else.

### StringInterner

```rust
pub struct StringInterner {
    map: HashMap<String, Symbol>,    // string → symbol (dedup lookup)
    strings: Vec<String>,           // symbol.0 → string (reverse lookup)
    next_id: AtomicU32,
}
```

- `intern(&mut self, s: &str) -> Symbol` — O(1) amortized, returns existing symbol if already interned
- `resolve(&self, sym: Symbol) -> Option<&str>` — O(1) reverse lookup
- `memory_stats() -> InternerStats` — reports unique_strings, total_bytes, overhead_bytes
- Claims 60-80% memory reduction for large codebases

### PathInterner

Wraps `StringInterner` with path normalization:
- `intern_path(path)` normalizes `\` → `/` before interning
- Default capacity: 4096

### FunctionInterner

Wraps `StringInterner` with qualified name support:
- `intern(name)` — simple function name
- `intern_qualified(class, method)` — creates `"Class.method"` string
- Default capacity: 8192

### InternerStats

```rust
pub struct InternerStats {
    pub unique_strings: usize,  // Number of unique strings stored
    pub total_bytes: usize,     // Total bytes used by string content
    pub overhead_bytes: usize,  // Overhead for HashMap + Vec structures
}
```

---

## Type Definitions

### Language (10 variants)

```rust
pub enum Language {
    TypeScript, JavaScript, Python, Java, CSharp, Php, Go, Rust, Cpp, C,
}
```

Extension mapping:
- `ts|tsx|mts|cts` → TypeScript
- `js|jsx|mjs|cjs` → JavaScript
- `py|pyi` → Python
- `java` → Java
- `cs` → CSharp
- `php` → Php
- `go` → Go
- `rs` → Rust
- `cpp|cc|cxx|c++|hpp|hxx|hh` → Cpp
- `c|h` → C

### PatternCategory (15 variants)

```rust
pub enum PatternCategory {
    Api, Auth, Components, Config, DataAccess, Documentation,
    Errors, Logging, Performance, Security, Structural,
    Styling, Testing, Types, Validation,
}
```

### DetectionMethod

```rust
pub enum DetectionMethod {
    AstQuery,       // Primary: tree-sitter query
    RegexFallback,  // Secondary: regex on extracted strings
    Structural,     // File/directory pattern analysis
}
```

### DetectedPattern

```rust
pub struct DetectedPattern {
    pub category: PatternCategory,
    pub pattern_type: String,           // e.g. "auth-decorator", "sql-query"
    pub subcategory: Option<String>,
    pub file: String,
    pub line: u32,                      // 1-indexed
    pub column: u32,                    // 1-indexed
    pub end_line: u32,
    pub end_column: u32,
    pub matched_text: String,
    pub confidence: f32,                // 0.0-1.0
    pub detection_method: DetectionMethod,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}
```

### UnifiedOptions

```rust
pub struct UnifiedOptions {
    pub patterns: Vec<String>,              // File globs (empty = "**/*")
    pub categories: Vec<PatternCategory>,   // Filter categories (empty = all)
    pub max_resolution_depth: u32,          // Call graph depth limit
    pub parallel: bool,                     // Use rayon parallelism
    pub threads: usize,                     // Thread count (0 = auto)
    pub include_violations: bool,           // Include violation detection
}
```

### UnifiedResult

```rust
pub struct UnifiedResult {
    pub file_patterns: Vec<FilePatterns>,
    pub resolution: ResolutionStats,
    pub call_graph: CallGraphSummary,
    pub metrics: AnalysisMetrics,
    pub total_patterns: u64,
    pub total_violations: u64,
}
```

### FilePatterns

```rust
pub struct FilePatterns {
    pub file: String,
    pub language: Language,
    pub patterns: Vec<DetectedPattern>,
    pub violations: Vec<Violation>,     // TODO: not yet populated
    pub parse_time_us: u64,
    pub detect_time_us: u64,
}
```

### ResolutionStats

```rust
pub struct ResolutionStats {
    pub total_calls: u64,
    pub resolved_calls: u64,
    pub resolution_rate: f32,
    pub same_file_resolutions: u64,
    pub cross_file_resolutions: u64,
    pub unresolved_calls: u64,
}
```

### CallGraphSummary

```rust
pub struct CallGraphSummary {
    pub total_functions: u64,   // From ResolutionIndex
    pub entry_points: u64,      // Exported functions
    pub data_accessors: u64,
    pub max_call_depth: u32,
}
```

### AnalysisMetrics

```rust
pub struct AnalysisMetrics {
    pub files_processed: u64,
    pub total_lines: u64,
    pub parse_time_ms: u64,
    pub detect_time_ms: u64,
    pub resolve_time_ms: u64,
    pub total_time_ms: u64,
}
```

### Violation / ViolationSeverity (defined but not yet populated)

```rust
pub struct Violation {
    pub id: String,
    pub pattern_id: String,
    pub severity: ViolationSeverity,  // Error | Warning | Info | Hint
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub message: String,
    pub expected: String,
    pub actual: String,
    pub suggested_fix: Option<String>,
}
```

---

## v2 Notes
- This is the core pattern detection engine in Rust. Currently handles framework-specific patterns via AST queries and string-based patterns via regex.
- The TS detectors package has 300+ files of much richer pattern detection.
- v2 goal: Move all detector logic into this unified Rust pipeline.
- The `log_patterns` RegexSet is compiled but not used in `analyze()` — likely a TODO.
- `ResolutionStats` fields (total_calls, resolved_calls, etc.) are initialized to 0 with TODO comments — resolution tracking not yet wired up.
- `Violation` detection is defined in types but `violations` is always `Vec::new()` — not yet implemented.
- Thread-local `ParserManager` per rayon thread is noted as an optimization TODO.
