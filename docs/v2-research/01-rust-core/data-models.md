# Rust Core Data Models

## ParseResult
```rust
ParseResult {
  language: Language,                    // 10 variants: TypeScript..C
  tree: Option<tree_sitter::Tree>,       // Raw AST (not serialized)
  functions: Vec<FunctionInfo>,
  classes: Vec<ClassInfo>,
  imports: Vec<ImportInfo>,
  exports: Vec<ExportInfo>,
  calls: Vec<CallSite>,
  errors: Vec<ParseError>,
  parse_time_us: u64,
}

FunctionInfo {
  name, qualified_name?, parameters: Vec<ParameterInfo>,
  return_type?, is_exported, is_async, is_generator,
  range: Range, decorators: Vec<String>, doc_comment?
}

ClassInfo {
  name, extends?, implements: Vec<String>,
  is_exported, is_abstract,
  methods: Vec<FunctionInfo>, properties: Vec<PropertyInfo>,
  range: Range, decorators: Vec<String>
}

PropertyInfo { name, type_annotation?, is_static, is_readonly, visibility, tags? }
ImportInfo { source, named: Vec<String>, default?, namespace?, is_type_only, range }
ExportInfo { name, original_name?, from_source?, is_type_only, is_default, range }
CallSite { callee, receiver?, arg_count, range }
```

## Call Graph
```rust
FunctionEntry {
  id: "file:name:line",
  name, start_line, end_line,
  is_entry_point, is_data_accessor,
  calls: Vec<CallEntry>,
  called_by: Vec<String>,
  data_access: Vec<DataAccessRef>,
}

CallEntry { target, resolved_id?, resolved: bool, confidence: f32, line }
DataAccessRef { table, fields: Vec<String>, operation: Read|Write|Delete, line }
CallGraphShard { file, functions: Vec<FunctionEntry> }
BuildResult { files_processed, total_functions, total_calls, resolved_calls, resolution_rate, entry_points, data_accessors, errors, duration_ms }
```

## Unified Analysis
```rust
DetectedPattern {
  category: PatternCategory,     // 15 variants
  pattern_type: String,
  subcategory?,
  file, line, column, end_line, end_column,
  matched_text, confidence: f32,
  detection_method: AstQuery | RegexFallback | Structural,
  metadata?: HashMap<String, Value>,
}

FilePatterns { file, language, patterns: Vec<DetectedPattern>, violations: Vec<Violation>, parse_time_us, detect_time_us }
UnifiedResult { file_patterns, resolution: ResolutionStats, call_graph: CallGraphSummary, metrics: AnalysisMetrics, total_patterns, total_violations }
```

## Boundaries
```rust
DataAccessPoint { table, operation: Read|Write|Delete, file, line, column, context?, fields, is_raw_sql, confidence }
SensitiveField { table_name, field_name, sensitivity: Pii|Financial|Auth|Health|Custom, reason? }
ORMModel { name, table_name, file, line, framework?, fields }
BoundaryScanResult { data_access_points, sensitive_fields, orm_models }
```

## Key Enums
```rust
Language: TypeScript|JavaScript|Python|Java|CSharp|Php|Go|Rust|Cpp|C
PatternCategory: Api|Auth|Components|Config|DataAccess|Documentation|Errors|Logging|Performance|Security|Structural|Styling|Testing|Types|Validation
DataOperation: Read|Write|Delete
ViolationSeverity: Error|Warning|Info|Hint
DetectionMethod: AstQuery|RegexFallback|Structural
Visibility: Public|Private|Protected
```

## Performance Characteristics
- tree-sitter v0.23 for all parsers
- rayon for parallel file processing
- rusqlite with bundled SQLite for storage
- xxhash (xxh3) for fast hashing
- smallvec for small vector optimization
- rustc-hash for fast hash maps
- String interning in unified analyzer for memory efficiency
- Release profile: LTO enabled, codegen-units=1, opt-level=3
