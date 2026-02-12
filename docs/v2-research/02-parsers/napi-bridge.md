# NAPI Bridge & Native Adapters

## Locations
- **NAPI Types & Functions**: `crates/drift-napi/src/lib.rs` (~2200 lines)
- **Native Adapters**: `packages/core/src/native/native-adapters.ts`

## Purpose
Exposes all of drift-core's Rust functionality to Node.js via napi-rs. The native adapter layer provides a fallback mechanism: try Rust first, fall back to TypeScript on failure.

---

## Exported Functions (27 total)

### Scanner (2 functions)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `scan` | `(config: JsScanConfig) -> JsScanResult` | Scan directory for source files |
| `version` | `() -> String` | Get drift-core version |

### Parser (2 functions)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `parse` | `(source: String, file_path: String) -> Option<JsParseResult>` | Parse source code, extract AST info |
| `supported_languages` | `() -> Vec<String>` | List parseable languages |

### Call Graph (8 functions)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `build_call_graph` | `(config: JsBuildConfig) -> JsBuildResult` | Build call graph with SQLite storage (recommended) |
| `build_call_graph_legacy` | `(config: JsBuildConfig) -> JsBuildResult` | Build with JSON shard storage (backward compat) |
| `get_call_graph_stats` | `(root_dir: String) -> JsCallGraphStats` | Get stats from SQLite DB |
| `get_call_graph_entry_points` | `(root_dir: String) -> Vec<JsEntryPointInfo>` | List all entry points |
| `get_call_graph_data_accessors` | `(root_dir: String) -> Vec<JsDataAccessorInfo>` | List all data accessors |
| `get_call_graph_callers` | `(root_dir: String, target: String) -> Vec<JsCallerInfo>` | Get callers of a function (by ID or name) |
| `get_call_graph_file_callers` | `(root_dir: String, file_path: String) -> Vec<JsCallerInfo>` | Get all external callers of functions in a file |
| `is_call_graph_available` | `(root_dir: String) -> bool` | Check if SQLite DB exists and has data |

### Boundaries (2 functions)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `scan_boundaries` | `(files: Vec<String>) -> JsBoundaryScanResult` | Scan files for data access points and sensitive fields |
| `scan_boundaries_source` | `(source: String, file_path: String) -> JsBoundaryScanResult` | Scan a single source string for boundaries |

### Coupling (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_coupling` | `(files: Vec<String>) -> JsCouplingResult` | Analyze module coupling |

### Test Topology (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_test_topology` | `(files: Vec<String>) -> JsTestTopologyResult` | Analyze test topology |

### Error Handling (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_error_handling` | `(files: Vec<String>) -> JsErrorHandlingResult` | Analyze error handling patterns and gaps |

### Reachability (4 functions)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_reachability` | `(graph_input: JsCallGraphInput, function_id: String, options: JsReachabilityOptions) -> JsReachabilityResult` | Forward reachability from in-memory graph |
| `analyze_inverse_reachability` | `(graph_input: JsCallGraphInput, table: String, field: Option<String>, max_depth: Option<i64>) -> JsInverseReachabilityResult` | Inverse reachability from in-memory graph |
| `analyze_reachability_sqlite` | `(root_dir: String, function_id: String, options: JsReachabilityOptions) -> JsReachabilityResult` | Forward reachability from SQLite DB |
| `analyze_inverse_reachability_sqlite` | `(root_dir: String, table: String, field: Option<String>, max_depth: Option<i64>) -> JsInverseReachabilityResult` | Inverse reachability from SQLite DB |

### Unified Analysis (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_unified` | `(root: String, options: JsUnifiedOptions) -> JsUnifiedResult` | AST-first pattern detection + resolution |

### Constants (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_constants` | `(files: Vec<String>) -> JsConstantsResult` | Analyze constants, secrets, magic numbers |

### Environment (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_environment` | `(files: Vec<String>) -> JsEnvironmentResult` | Analyze environment variable usage |

### Wrappers (1 function)
| Function | Signature | Purpose |
|----------|-----------|---------|
| `analyze_wrappers` | `(files: Vec<String>) -> JsWrappersResult` | Analyze wrapper patterns |

---

## Complete Js* Struct Inventory (62 structs)

### Scanner Structs (4)

```rust
#[napi(object)]
pub struct JsScanConfig {
    pub root: String,
    pub patterns: Vec<String>,
    pub extra_ignores: Option<Vec<String>>,
    pub compute_hashes: Option<bool>,       // default: true
    pub max_file_size: Option<i64>,         // default: 10MB
    pub threads: Option<i64>,               // default: 0 (auto)
}

#[napi(object)]
pub struct JsScanResult {
    pub root: String,
    pub files: Vec<JsFileInfo>,
    pub stats: JsScanStats,
    pub errors: Vec<String>,
}

#[napi(object)]
pub struct JsFileInfo {
    pub path: String,
    pub size: i64,
    pub hash: Option<String>,
    pub language: Option<String>,
}

#[napi(object)]
pub struct JsScanStats {
    pub total_files: i64,
    pub total_bytes: i64,
    pub dirs_skipped: i64,
    pub files_skipped: i64,
    pub duration_ms: i64,
}
```

### Parser Structs (10)

```rust
#[napi(object)]
pub struct JsParseResult {
    pub language: String,
    pub functions: Vec<JsFunctionInfo>,
    pub classes: Vec<JsClassInfo>,
    pub imports: Vec<JsImportInfo>,
    pub exports: Vec<JsExportInfo>,
    pub calls: Vec<JsCallSite>,
    pub errors: Vec<JsParseError>,
    pub parse_time_us: i64,
}

#[napi(object)]
pub struct JsFunctionInfo {
    pub name: String,
    pub qualified_name: Option<String>,
    pub parameters: Vec<JsParameterInfo>,
    pub return_type: Option<String>,
    pub is_exported: bool,
    pub is_async: bool,
    pub start_line: i64,
    pub end_line: i64,
    pub decorators: Vec<String>,
    pub doc_comment: Option<String>,
}

#[napi(object)]
pub struct JsParameterInfo {
    pub name: String,
    pub type_annotation: Option<String>,
    pub default_value: Option<String>,
    pub is_rest: bool,
}

#[napi(object)]
pub struct JsClassInfo {
    pub name: String,
    pub extends: Option<String>,
    pub implements: Vec<String>,
    pub is_exported: bool,
    pub start_line: i64,
    pub end_line: i64,
    pub decorators: Vec<String>,
    pub properties: Vec<JsPropertyInfo>,
}

#[napi(object)]
pub struct JsPropertyInfo {
    pub name: String,
    pub type_annotation: Option<String>,
    pub is_static: bool,
    pub is_readonly: bool,
    pub visibility: String,           // "public" | "private" | "protected"
    pub tags: Option<Vec<JsStructTag>>,
}

#[napi(object)]
pub struct JsStructTag {
    pub key: String,
    pub value: String,
}

#[napi(object)]
pub struct JsImportInfo {
    pub source: String,
    pub named: Vec<String>,
    pub default: Option<String>,
    pub namespace: Option<String>,
    pub is_type_only: bool,
    pub line: i64,
}

#[napi(object)]
pub struct JsExportInfo {
    pub name: String,
    pub from_source: Option<String>,
    pub is_default: bool,
    pub line: i64,
}

#[napi(object)]
pub struct JsCallSite {
    pub callee: String,
    pub receiver: Option<String>,
    pub arg_count: i64,
    pub line: i64,
}

#[napi(object)]
pub struct JsParseError {
    pub message: String,
    pub line: i64,
}
```

### Call Graph Structs (7)

```rust
#[napi(object)]
pub struct JsBuildConfig {
    pub root: String,
    pub patterns: Vec<String>,
    pub resolution_batch_size: Option<i64>,  // default: 50
}

#[napi(object)]
pub struct JsBuildResult {
    pub files_processed: i64,
    pub total_functions: i64,
    pub total_calls: i64,
    pub resolved_calls: i64,
    pub resolution_rate: f64,
    pub entry_points: i64,
    pub data_accessors: i64,
    pub errors: Vec<String>,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsCallGraphStats {
    pub total_functions: i64,
    pub total_calls: i64,
    pub resolved_calls: i64,
    pub entry_points: i64,
    pub data_accessors: i64,
}

#[napi(object)]
pub struct JsEntryPointInfo {
    pub id: String,
    pub name: String,
    pub file: String,
    pub line: i64,
}

#[napi(object)]
pub struct JsDataAccessorInfo {
    pub id: String,
    pub name: String,
    pub file: String,
    pub line: i64,
    pub tables: Vec<String>,
}

#[napi(object)]
pub struct JsCallerInfo {
    pub caller_id: String,
    pub caller_name: String,
    pub caller_file: String,
    pub line: i64,
}

// Input struct for in-memory reachability
#[napi(object)]
pub struct JsCallGraphInput {
    pub functions: Vec<JsCallGraphFunction>,
    pub entry_points: Vec<String>,
    pub data_accessors: Vec<String>,
}
```

### Boundary Structs (4)

```rust
#[napi(object)]
pub struct JsBoundaryScanResult {
    pub access_points: Vec<JsDataAccessPoint>,
    pub sensitive_fields: Vec<JsSensitiveField>,
    pub models: Vec<JsORMModel>,
    pub files_scanned: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsDataAccessPoint {
    pub table: String,
    pub operation: String,       // "read" | "write" | "delete"
    pub fields: Vec<String>,
    pub file: String,
    pub line: i64,
    pub confidence: f64,
    pub framework: Option<String>,
}

#[napi(object)]
pub struct JsSensitiveField {
    pub field: String,
    pub table: Option<String>,
    pub sensitivity_type: String, // "pii" | "credentials" | "financial" | "health"
    pub file: String,
    pub line: i64,
    pub confidence: f64,
}

#[napi(object)]
pub struct JsORMModel {
    pub name: String,
    pub table_name: String,
    pub fields: Vec<String>,
    pub file: String,
    pub line: i64,
    pub framework: String,
    pub confidence: f64,
}
```

### Coupling Structs (5)

```rust
#[napi(object)]
pub struct JsCouplingResult {
    pub modules: Vec<JsModuleMetrics>,
    pub cycles: Vec<JsDependencyCycle>,
    pub hotspots: Vec<JsCouplingHotspot>,
    pub unused_exports: Vec<JsUnusedExport>,
    pub health_score: f64,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsModuleMetrics {
    pub path: String,
    pub ca: i64,              // Afferent coupling (incoming)
    pub ce: i64,              // Efferent coupling (outgoing)
    pub instability: f64,     // Ce / (Ca + Ce)
    pub abstractness: f64,
    pub distance: f64,        // Distance from main sequence
    pub files: Vec<String>,
}

#[napi(object)]
pub struct JsDependencyCycle {
    pub modules: Vec<String>,
    pub severity: String,     // "info" | "warning" | "critical"
    pub files_affected: i64,
}

#[napi(object)]
pub struct JsCouplingHotspot {
    pub module: String,
    pub total_coupling: i64,
    pub incoming: Vec<String>,
    pub outgoing: Vec<String>,
}

#[napi(object)]
pub struct JsUnusedExport {
    pub name: String,
    pub file: String,
    pub line: i64,
    pub export_type: String,
}
```

### Test Topology Structs (3)

```rust
#[napi(object)]
pub struct JsTestTopologyResult {
    pub test_files: Vec<JsTestFile>,
    pub coverage: Vec<JsTestCoverage>,
    pub uncovered_files: Vec<String>,
    pub total_tests: i64,
    pub skipped_tests: i64,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsTestFile {
    pub path: String,
    pub tests_file: Option<String>,
    pub framework: String,    // "jest"|"vitest"|"mocha"|"pytest"|"junit"|"nunit"|"xunit"|"phpunit"|"gotest"|"rusttest"|"catch2"|"googletest"|"unknown"
    pub test_count: i64,
    pub mock_count: i64,
}

#[napi(object)]
pub struct JsTestCoverage {
    pub source_file: String,
    pub test_files: Vec<String>,
    pub coverage_percent: Option<f64>,
    pub risk_level: String,   // "low" | "medium" | "high" | "critical"
}
```

### Error Handling Structs (4)

```rust
#[napi(object)]
pub struct JsErrorHandlingResult {
    pub boundaries: Vec<JsErrorBoundary>,
    pub gaps: Vec<JsErrorGap>,
    pub error_types: Vec<JsErrorType>,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsErrorBoundary {
    pub file: String,
    pub start_line: i64,
    pub end_line: i64,
    pub boundary_type: String,  // "try_catch"|"try_except"|"try_finally"|"error_handler"|"promise_catch"|"async_await"|"result_match"|"panic_handler"
    pub caught_types: Vec<String>,
    pub rethrows: bool,
    pub logs_error: bool,
    pub is_swallowed: bool,
}

#[napi(object)]
pub struct JsErrorGap {
    pub file: String,
    pub line: i64,
    pub function: String,
    pub gap_type: String,       // "unhandled_promise"|"unhandled_async"|"missing_catch"|"swallowed_error"|"unwrap_without_check"|"unchecked_result"|"missing_error_boundary"
    pub severity: String,       // "low"|"medium"|"high"|"critical"
    pub description: String,
}

#[napi(object)]
pub struct JsErrorType {
    pub name: String,
    pub file: String,
    pub line: i64,
    pub extends: Option<String>,
    pub is_exported: bool,
}
```

### Reachability Structs (10)

```rust
#[napi(object)]
pub struct JsReachabilityOptions {
    pub max_depth: Option<i64>,
    pub sensitive_only: Option<bool>,
    pub tables: Option<Vec<String>>,
    pub include_unresolved: Option<bool>,
}

#[napi(object)]
pub struct JsReachabilityResult {
    pub origin: JsCodeLocation,
    pub reachable_access: Vec<JsReachableDataAccess>,
    pub tables: Vec<String>,
    pub sensitive_fields: Vec<JsSensitiveFieldAccess>,
    pub max_depth: i64,
    pub functions_traversed: i64,
}

#[napi(object)]
pub struct JsCodeLocation {
    pub file: String,
    pub line: i64,
    pub column: Option<i64>,
    pub function_id: Option<String>,
}

#[napi(object)]
pub struct JsCallPathNode {
    pub function_id: String,
    pub function_name: String,
    pub file: String,
    pub line: i64,
}

#[napi(object)]
pub struct JsReachableDataAccess {
    pub table: String,
    pub operation: String,       // "read" | "write" | "delete"
    pub fields: Vec<String>,
    pub file: String,
    pub line: i64,
    pub confidence: f64,
    pub framework: Option<String>,
    pub path: Vec<JsCallPathNode>,
    pub depth: i64,
}

#[napi(object)]
pub struct JsSensitiveFieldAccess {
    pub field: String,
    pub table: Option<String>,
    pub sensitivity_type: String,
    pub file: String,
    pub line: i64,
    pub confidence: f64,
    pub paths: Vec<Vec<JsCallPathNode>>,
    pub access_count: i64,
}

#[napi(object)]
pub struct JsInverseAccessPath {
    pub entry_point: String,
    pub path: Vec<JsCallPathNode>,
    pub access_table: String,
    pub access_operation: String,
    pub access_fields: Vec<String>,
    pub access_file: String,
    pub access_line: i64,
}

#[napi(object)]
pub struct JsInverseReachabilityResult {
    pub target_table: String,
    pub target_field: Option<String>,
    pub access_paths: Vec<JsInverseAccessPath>,
    pub entry_points: Vec<String>,
    pub total_accessors: i64,
}

// Input structs for in-memory reachability
#[napi(object)]
pub struct JsCallGraphFunction {
    pub id: String,
    pub name: String,
    pub qualified_name: String,
    pub file: String,
    pub start_line: i64,
    pub end_line: i64,
    pub calls: Vec<JsCallGraphCallSite>,
    pub data_access: Vec<JsCallGraphDataAccess>,
    pub is_entry_point: bool,
}

#[napi(object)]
pub struct JsCallGraphCallSite {
    pub callee_name: String,
    pub resolved: bool,
    pub resolved_candidates: Vec<String>,
    pub line: i64,
}

#[napi(object)]
pub struct JsCallGraphDataAccess {
    pub table: String,
    pub operation: String,
    pub fields: Vec<String>,
    pub file: String,
    pub line: i64,
    pub confidence: f64,
    pub framework: Option<String>,
}
```

### Unified Analysis Structs (8)

```rust
#[napi(object)]
pub struct JsUnifiedOptions {
    pub patterns: Vec<String>,
    pub categories: Option<Vec<String>>,       // string names, converted to PatternCategory
    pub max_resolution_depth: Option<i64>,     // default: 10
    pub parallel: Option<bool>,                // default: true
    pub threads: Option<i64>,                  // default: 0 (auto)
}

#[napi(object)]
pub struct JsUnifiedResult {
    pub file_patterns: Vec<JsFilePatterns>,
    pub resolution: JsResolutionStats,
    pub call_graph: JsCallGraphSummary,
    pub metrics: JsAnalysisMetrics,
    pub total_patterns: i64,
    pub total_violations: i64,
}

#[napi(object)]
pub struct JsFilePatterns {
    pub file: String,
    pub language: String,
    pub patterns: Vec<JsDetectedPattern>,
    pub parse_time_us: i64,
    pub detect_time_us: i64,
}

#[napi(object)]
pub struct JsDetectedPattern {
    pub category: String,
    pub pattern_type: String,
    pub subcategory: Option<String>,
    pub file: String,
    pub line: i64,
    pub column: i64,
    pub end_line: i64,
    pub end_column: i64,
    pub matched_text: String,
    pub confidence: f64,
    pub detection_method: String,   // "ast" | "regex" | "structural"
}

#[napi(object)]
pub struct JsResolutionStats {
    pub total_calls: i64,
    pub resolved_calls: i64,
    pub resolution_rate: f64,
    pub same_file_resolutions: i64,
    pub cross_file_resolutions: i64,
    pub unresolved_calls: i64,
}

#[napi(object)]
pub struct JsCallGraphSummary {
    pub total_functions: i64,
    pub entry_points: i64,
    pub data_accessors: i64,
    pub max_call_depth: i64,
}

#[napi(object)]
pub struct JsAnalysisMetrics {
    pub files_processed: i64,
    pub total_lines: i64,
    pub parse_time_ms: i64,
    pub detect_time_ms: i64,
    pub resolve_time_ms: i64,
    pub total_time_ms: i64,
}
```


### Constants Analysis Structs (8)

```rust
#[napi(object)]
pub struct JsConstantsResult {
    pub constants: Vec<JsConstantInfo>,
    pub secrets: Vec<JsSecretCandidate>,
    pub magic_numbers: Vec<JsMagicNumber>,
    pub inconsistencies: Vec<JsValueInconsistency>,
    pub stats: JsConstantsStats,
}

#[napi(object)]
pub struct JsConstantInfo {
    pub name: String,
    pub value: String,
    pub value_type: String,       // "string"|"number"|"boolean"|"array"|"object"|"unknown"
    pub category: String,
    pub file: String,
    pub line: i64,
    pub is_exported: bool,
    pub language: String,
    pub declaration_type: String,
}

#[napi(object)]
pub struct JsSecretCandidate {
    pub name: String,
    pub masked_value: String,
    pub secret_type: String,
    pub severity: String,         // "critical"|"high"|"medium"|"low"|"info"
    pub file: String,
    pub line: i64,
    pub confidence: f64,
    pub reason: String,
}

#[napi(object)]
pub struct JsMagicNumber {
    pub value: f64,
    pub file: String,
    pub line: i64,
    pub context: String,
    pub suggested_name: Option<String>,
}

#[napi(object)]
pub struct JsValueLocation {
    pub value: String,
    pub file: String,
    pub line: i64,
}

#[napi(object)]
pub struct JsValueInconsistency {
    pub name_pattern: String,
    pub values: Vec<JsValueLocation>,
    pub severity: String,         // "critical"|"high"|"medium"|"low"|"info"
}

#[napi(object)]
pub struct JsConstantsStats {
    pub total_constants: i64,
    pub by_category: Vec<JsCategoryCount>,
    pub by_language: Vec<JsLanguageCount>,
    pub exported_count: i64,
    pub secrets_count: i64,
    pub magic_numbers_count: i64,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsCategoryCount {
    pub category: String,
    pub count: i64,
}
```

### Environment Analysis Structs (6)

```rust
#[napi(object)]
pub struct JsEnvironmentResult {
    pub accesses: Vec<JsEnvAccess>,
    pub variables: Vec<JsEnvVariable>,
    pub required: Vec<JsEnvVariable>,
    pub secrets: Vec<JsEnvVariable>,
    pub stats: JsEnvironmentStats,
}

#[napi(object)]
pub struct JsEnvAccess {
    pub name: String,
    pub file: String,
    pub line: i64,
    pub has_default: bool,
    pub default_value: Option<String>,
    pub access_method: String,
    pub language: String,
}

#[napi(object)]
pub struct JsEnvVariable {
    pub name: String,
    pub sensitivity: String,      // "secret"|"credential"|"config"|"unknown"
    pub accesses: Vec<JsEnvAccessLocation>,
    pub is_required: bool,
    pub default_values: Vec<String>,
    pub access_count: i64,
}

#[napi(object)]
pub struct JsEnvAccessLocation {
    pub file: String,
    pub line: i64,
    pub has_default: bool,
}

#[napi(object)]
pub struct JsEnvironmentStats {
    pub total_accesses: i64,
    pub unique_variables: i64,
    pub required_count: i64,
    pub secrets_count: i64,
    pub credentials_count: i64,
    pub config_count: i64,
    pub by_language: Vec<JsLanguageCount>,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsLanguageCount {
    pub language: String,
    pub count: i64,
}
```

### Wrappers Analysis Structs (5)

```rust
#[napi(object)]
pub struct JsWrappersResult {
    pub wrappers: Vec<JsWrapperInfo>,
    pub clusters: Vec<JsWrapperCluster>,
    pub stats: JsWrappersStats,
}

#[napi(object)]
pub struct JsWrapperInfo {
    pub name: String,
    pub file: String,
    pub line: i64,
    pub wraps: Vec<String>,
    pub category: String,
    pub is_exported: bool,
    pub usage_count: i64,
    pub confidence: f64,
}

#[napi(object)]
pub struct JsWrapperCluster {
    pub id: String,
    pub category: String,
    pub wrapped_primitive: String,
    pub wrappers: Vec<JsWrapperInfo>,
    pub confidence: f64,
    pub total_usage: i64,
}

#[napi(object)]
pub struct JsWrappersStats {
    pub total_wrappers: i64,
    pub cluster_count: i64,
    pub by_category: Vec<JsCategoryCount>,
    pub top_primitives: Vec<JsPrimitiveCount>,
    pub files_analyzed: i64,
    pub duration_ms: i64,
}

#[napi(object)]
pub struct JsPrimitiveCount {
    pub primitive: String,
    pub count: i64,
}
```

---

## Type Conversion Details

| Rust Type | → | JavaScript Type | Notes |
|-----------|---|-----------------|-------|
| `Language::TypeScript` | → | `"typescript"` | `format!("{:?}", lang).to_lowercase()` |
| `Range { start, end }` | → | `start_line: i64, end_line: i64` | Line numbers extracted from Range |
| `Visibility::Public` | → | `"public"` | Manual match arm |
| `Option<T>` | → | `T \| null` | NAPI handles automatically |
| `Vec<T>` | → | `T[]` | NAPI handles automatically |
| `usize` | → | `i64` | NAPI limitation (no u64 support) |
| `f32` | → | `f64` | Widened for JS compatibility |
| `tree_sitter::Tree` | → | dropped | Not serializable across FFI |
| `Duration` | → | `i64` (ms) | `.as_millis() as i64` |
| Rust enums | → | `String` | Manual match arms per variant |
| `HashMap<K,V>` | → | `Vec<{key, value}>` | Flattened to array of structs |

## Error Handling Pattern

All NAPI functions return `napi::Result<T>`. Errors are mapped via:
- `.map_err(|e| napi::Error::from_reason(format!("...: {}", e)))` for Rust errors
- Direct `Err(napi::Error::from_reason("..."))` for precondition failures (e.g., missing DB)

The `parse()` function returns `Result<Option<JsParseResult>>` — `None` for unsupported languages, `Err` for actual failures.

## Serde Conversion Approach

Rust structs are NOT automatically serialized via serde. Each conversion is manual field-by-field mapping in the NAPI function body. This is intentional:
- Allows type narrowing (e.g., `usize` → `i64`)
- Allows enum-to-string conversion
- Allows flattening nested structures
- Avoids serde overhead for large results

## Thread Safety

- `parse()` uses `thread_local!` for `ParserManager` — avoids re-initialization overhead
- Other analyzer functions create fresh analyzer instances per call
- `build_call_graph()` uses rayon internally for parallel parsing

## Native Adapter (`native-adapters.ts`)

### Module Loading
```typescript
let nativeModule: NativeModule | null = null;
try {
  nativeModule = require('driftdetect-native');    // Published package
} catch {
  try {
    nativeModule = require('@drift/native');        // Local dev
  } catch {
    // Native not available
  }
}
```

### NativeModule Interface
```typescript
interface NativeModule {
  parse(source: string, filePath: string): ParseResult | null;
  analyzeCoupling(files: string[]): CouplingResult;
  analyzeTestTopology(files: string[]): TestTopologyResult;
  analyzeErrorHandling(files: string[]): ErrorHandlingResult;
  analyzeConstants(files: string[]): ConstantsResult;
  analyzeEnvironment(files: string[]): EnvironmentResult;
  analyzeWrappers(files: string[]): WrappersResult;
  scanBoundaries(files: string[]): BoundaryScanResult;
}
```

### parseWithFallback()
```typescript
async function parseWithFallback(source: string, filePath: string): Promise<ParseResult | null> {
  // 1. Check if native module available
  // 2. Try native parse
  // 3. If success → return result
  // 4. If failure → log, fall back to TS ParserManager
  // 5. If TS also fails → return null
}
```

### Debug Logging
Controlled by `DRIFT_DEBUG=true` environment variable:
- `[native] parse: ✓ (3ms)` — Success with timing
- `[native] parse: ✗` — Failure
- `[native] parse: falling back to TypeScript - native not available`

---

## v2 Considerations
- The fallback mechanism becomes less important as Rust parsers reach parity
- Consider exposing the raw tree-sitter tree via NAPI for TS-side AST queries
- The `thread_local!` pattern should be benchmarked against a parser pool
- NAPI type conversion has overhead — consider returning serialized JSON for large results
- The native adapter's `require()` pattern should be replaced with proper ESM imports
- Consider adding `parse_batch()` to NAPI for bulk operations
