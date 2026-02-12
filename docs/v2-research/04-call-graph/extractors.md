# Call Graph — Per-Language Extractors

## Location
- `packages/core/src/call-graph/extractors/` — TypeScript (30+ files)
- `crates/drift-core/src/call_graph/extractor.rs` — Rust extractor trait
- `crates/drift-core/src/call_graph/universal_extractor.rs` — Rust universal extractor

## Architecture
Three extractor variants per language in TS, all inheriting from base classes. Rust has a single universal extractor that works across all languages.

### Base Classes (TS)
- `base-extractor.ts` — Abstract base for standard extractors
- `hybrid-extractor-base.ts` — Abstract base for hybrid (tree-sitter + regex) extractors
- `data-access-extractor.ts` — Abstract base for data access extractors
- `semantic-data-access-scanner.ts` — Semantic-level data access scanning (cross-language)

### Per-Language Extractor Matrix (TS)

| Language | Standard | Hybrid | Data Access |
|----------|----------|--------|-------------|
| TypeScript | `typescript-extractor.ts` | `typescript-hybrid-extractor.ts` | `typescript-data-access-extractor.ts` |
| Python | `python-extractor.ts` | `python-hybrid-extractor.ts` | `python-data-access-extractor.ts` |
| Java | `java-extractor.ts` | `java-hybrid-extractor.ts` | `java-data-access-extractor.ts` |
| C# | `csharp-extractor.ts` | `csharp-hybrid-extractor.ts` | `csharp-data-access-extractor.ts` |
| PHP | `php-extractor.ts` | `php-hybrid-extractor.ts` | `php-data-access-extractor.ts` |
| Go | `go-extractor.ts` | `go-hybrid-extractor.ts` | `go-data-access-extractor.ts` |
| Rust | `rust-extractor.ts` | `rust-hybrid-extractor.ts` | `rust-data-access-extractor.ts` |
| C++ | — | `cpp-hybrid-extractor.ts` | `cpp-data-access-extractor.ts` |

### Regex Fallback
`regex/` — Regex-based extractors used when tree-sitter parsing fails. Provides degraded but functional extraction for all languages.

## What Extractors Produce

### Standard/Hybrid Extractors → FileExtractionResult
```typescript
interface FileExtractionResult {
  file: string;
  language: CallGraphLanguage;
  functions: FunctionExtraction[];   // Function declarations
  calls: CallExtraction[];           // Call sites
  imports: ImportExtraction[];       // Import statements
  classes: ClassExtraction[];        // Class declarations
}
```

### Data Access Extractors → DataAccessPoint[]
Per-language ORM-aware data access detection:
- TypeScript: Prisma, TypeORM, Sequelize, Drizzle, Knex, Mongoose, Supabase
- Python: Django ORM, SQLAlchemy, raw SQL
- Java: Spring Data, Hibernate, jOOQ, MyBatis
- C#: EF Core, Dapper
- PHP: Eloquent, Doctrine
- Go: GORM, sqlx, Ent
- Rust: Diesel, SeaORM
- C++: Raw SQL, ODBC

## Hybrid Extraction Pattern
The hybrid approach is Drift's key innovation for robustness:

```
1. Try tree-sitter parsing
2. If successful: extract from AST (high confidence)
3. If failed or incomplete: fall back to regex (lower confidence)
4. Merge results, preferring tree-sitter when available
5. Mark confidence based on extraction method
```

This ensures extraction works even on:
- Syntactically invalid files (work in progress)
- Languages with complex grammars
- Files with preprocessor directives (C++)
- Template-heavy code

## Function Extraction Details
Each extractor identifies:
- Function/method declarations with parameters and return types
- Class membership (methods vs standalone functions)
- Async/generator markers
- Decorators/attributes (@app.route, [HttpGet], etc.)
- Export/visibility modifiers
- Constructor detection

## Call Extraction Details
Each extractor identifies:
- Direct function calls
- Method calls with receiver (obj.method())
- Chained calls
- Callback/closure calls
- Dynamic dispatch candidates
- Argument count for resolution

## Rust Extractor Trait
```rust
pub trait CallGraphExtractor: Send + Sync {
    fn can_handle(&self, file: &str) -> bool;
    fn extract(&self, parse_result: &ParseResult, file: &str) -> ExtractionResult;
    fn language(&self) -> Language;
}
```

Produces:
```rust
struct ExtractionResult {
    functions: Vec<ExtractedFunction>,  // name, start/end line, is_exported, is_async
    calls: Vec<ExtractedCall>,          // callee_name, line, receiver
}
```

## Rust Universal Extractor
`universal_extractor.rs` — Language-agnostic extraction using the unified `ParseResult` from tree-sitter. Works across all 11 languages through a single interface.

**Key behavior:**
- Extracts functions from `ParseResult.functions`
- Extracts classes as callable entities (for `new MyClass()` resolution)
- Extracts class methods as qualified names (`ClassName.methodName`)
- Extracts calls from `ParseResult.calls` with receiver tracking
- Converts to `FunctionEntry` via `to_function_entries()` helper

**Limitation vs TS:** The universal extractor doesn't have per-language specialization. It relies on the tree-sitter parser to provide a normalized `ParseResult`. The TS extractors have deeper language-specific knowledge (DI patterns, framework decorators, etc.).

## V2 Notes
- All TS extractors should move to Rust for performance
- The hybrid pattern (tree-sitter + regex) must be preserved in Rust
- Data access extractors are the most language-specific — need careful Rust ports
- The semantic data access scanner provides cross-language patterns — keep as shared logic
- Rust needs per-language extractors to match TS feature depth (DI, decorators, framework patterns)
- The `CallGraphExtractor` trait is the right abstraction — add language-specific implementations
