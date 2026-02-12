# Rust Parser Core

## Location
`crates/drift-core/src/parsers/` — 12 files

## Architecture
Each language parser follows an identical pattern:
1. Initialize tree-sitter `Parser` with compile-time-linked grammar
2. Pre-compile tree-sitter `Query` objects for each extraction type
3. `parse(source)` → parse tree → run queries → collect into `ParseResult`

All grammars are linked at compile time via Cargo dependencies (e.g., `tree-sitter-python`, `tree-sitter-java`). No WASM, no dynamic loading.

## ParserManager (`manager.rs`)

Unified dispatch layer holding optional instances of all 9 parsers.

```rust
pub struct ParserManager {
    typescript_parser: Option<TypeScriptParser>,
    python_parser: Option<PythonParser>,
    java_parser: Option<JavaParser>,
    csharp_parser: Option<CSharpParser>,
    php_parser: Option<PhpParser>,
    go_parser: Option<GoParser>,
    rust_parser: Option<RustParser>,
    cpp_parser: Option<CppParser>,
    c_parser: Option<CParser>,
}
```

### API
- `new()` — Creates all parsers (each wrapped in `Option` — `None` if grammar fails to load)
- `supports(language: Language) -> bool`
- `supported_languages() -> Vec<Language>`
- `parse_file(path, source) -> Option<ParseResult>` — Auto-detects language from extension
- `parse(source, language) -> Option<ParseResult>` — Explicit language
- `parse_batch(files: &[(String, String)]) -> HashMap<String, ParseResult>` — Bulk parsing

## Module Exports (`mod.rs`)
```rust
pub use types::*;
pub use manager::ParserManager;
pub use typescript::TypeScriptParser;
pub use python::PythonParser;
pub use java::JavaParser;
pub use csharp::CSharpParser;
pub use php::PhpParser;
pub use go::GoParser;
pub use rust_lang::RustParser;
pub use cpp::CppParser;
pub use c::CParser;
```

---

## Per-Language Parser Details

### TypeScript/JavaScript (`typescript.rs`)
- **Grammar**: `tree-sitter-typescript` (LANGUAGE_TYPESCRIPT)
- **Handles**: Both TS and JS via `parse(source, is_typescript: bool)`
- **Queries**: function, class, import, export, call (5 queries)
- **Extracts**:
  - Functions: `function_declaration`, `method_definition`, `arrow_function`
  - Classes: `class_declaration` with `extends_clause`, `implements_clause`
  - Imports: `import_statement` with default, named, namespace variants
  - Exports: `export_statement` with clause, source, declaration
  - Calls: `call_expression`, `new_expression` with receiver
- **Enterprise features**: Decorator extraction, JSDoc comments, type annotations, return types, async/generator detection, constructor properties

### Python (`python.rs`, ~1000 lines)
- **Grammar**: `tree-sitter-python`
- **Queries**: function, class, import, call (4 queries)
- **Extracts**:
  - Functions: `function_definition`, `decorated_definition`
  - Classes: `class_definition`, `decorated_definition` (with bases)
  - Imports: `import_statement`, `import_from_statement`
  - Calls: `call` with `identifier` or `attribute` callee
- **Enterprise features**: Decorator extraction (`@decorator`), parameter types + defaults, return type (`-> Type`), docstrings (`"""..."""`), base class extraction (multiple inheritance), generator detection (`yield`), class property extraction
- **Framework awareness**: FastAPI, Django, Flask, SQLAlchemy patterns via decorators
- **Deduplication**: Tracks decorated function lines to avoid double-counting

### Java (`java.rs`)
- **Grammar**: `tree-sitter-java`
- **Queries**: method, class, import, call (4 queries)
- **Extracts**:
  - Methods: `method_declaration`, `constructor_declaration` with modifiers
  - Classes: `class_declaration`, `interface_declaration` with superclass/interfaces
  - Imports: `import_declaration` with `scoped_identifier`
  - Calls: `method_invocation`, `object_creation_expression`
- **Enterprise features**: Annotation extraction (`@Service`, `@GetMapping`, `@Autowired`), Javadoc comments, visibility modifiers, abstract class detection, generic type support
- **Framework awareness**: Spring, JPA, validation annotations

### C# (`csharp.rs`, ~1000 lines)
- **Grammar**: `tree-sitter-c-sharp`
- **Queries**: method, class, using, call (4 queries)
- **Extracts**:
  - Methods: `method_declaration`, `constructor_declaration`
  - Classes: `class_declaration`, `interface_declaration`, `struct_declaration`, `record_declaration`
  - Usings: `using_directive` with `qualified_name`
  - Calls: `invocation_expression`, `object_creation_expression`
- **Enterprise features**: `[Attribute]` extraction, XML doc comments (`/// <summary>`), parameter types, property extraction with attributes, namespace extraction, async detection
- **Framework awareness**: ASP.NET Core routes (`[HttpGet]`, `[Route]`), authorization (`[Authorize]`), Entity Framework (`[Key]`, `[Required]`, `[ForeignKey]`)

### PHP (`php.rs`)
- **Grammar**: `tree-sitter-php` (LANGUAGE_PHP)
- **Queries**: function, class, use, call (4 queries)
- **Extracts**:
  - Functions: `function_definition`, `method_declaration` with visibility
  - Classes: `class_declaration`, `interface_declaration`, `trait_declaration`
  - Uses: `namespace_use_declaration`
  - Calls: `function_call_expression`, `member_call_expression`, `scoped_call_expression`, `object_creation_expression`
- **Enterprise features**: PHP 8 attributes (`#[Route]`, `#[IsGranted]`), extends/implements, parameter types + defaults, return types, PHPDoc comments, visibility modifiers, abstract class detection, property extraction with visibility/static/readonly
- **Framework awareness**: Laravel, Symfony attribute patterns

### Go (`go.rs`, ~835 lines)
- **Grammar**: `tree-sitter-go`
- **Queries**: function, struct, import, call (4 queries)
- **Extracts**:
  - Functions: `function_declaration`, `method_declaration` (with receiver)
  - Structs: `type_declaration` → `struct_type`, `interface_type`
  - Imports: `import_declaration` with alias support
  - Calls: `call_expression` with `selector_expression` receiver
- **Enterprise features**: Struct field extraction with tags (`json:"name" gorm:"primaryKey"`), parameter types, return types, doc comments (`//` before function), Go export convention (uppercase = exported), variadic parameters, interface detection
- **Unique**: `StructTag` parsing for `json`, `gorm`, `validate`, `db` tags
- **Framework awareness**: Gin, Echo handler patterns

### Rust (`rust_lang.rs`, ~1100 lines)
- **Grammar**: `tree-sitter-rust`
- **Queries**: function, struct, use, call, attribute (5 queries)
- **Extracts**:
  - Functions: `function_item` with visibility, params, return type
  - Structs: `struct_item`, `enum_item`, `trait_item`, `impl_item`
  - Uses: `use_declaration`
  - Calls: `call_expression` with `field_expression`, `scoped_identifier`
- **Enterprise features**: `#[derive(...)]` extraction, `#[serde(...)]` tag parsing, route attributes for Actix/Axum/Rocket, parameter types, return types, doc comments (`///`, `//!`), visibility modifiers (`pub`, `pub(crate)`), async detection, struct field extraction with serde tags
- **Unique**: Separate `attribute_query` for attribute extraction, `self` parameter handling, serde attribute → StructTag conversion

### C++ (`cpp.rs`, ~884 lines)
- **Grammar**: `tree-sitter-cpp`
- **Queries**: function, class, include, call (4 queries)
- **Extracts**:
  - Functions: `function_definition` (regular, qualified, pointer, inline method)
  - Classes: `class_specifier` with `base_class_clause`, `struct_specifier`
  - Includes: `preproc_include` (string and system paths)
  - Calls: `call_expression` with `field_expression`, `qualified_identifier`
- **Enterprise features**: Parameter types + defaults, doc comments (Doxygen `/**`, `///`, `//!`), class member extraction with access specifiers (`public:`, `private:`, `protected:`), static/const field detection, template function/class support
- **Framework awareness**: Boost, Qt patterns

### C (`c.rs`)
- **Grammar**: `tree-sitter-c`
- **Queries**: function, struct, include, call (4 queries)
- **Extracts**:
  - Functions: `function_definition`, pointer function declarations
  - Structs: `struct_specifier`, `union_specifier`, `enum_specifier`, `type_definition`
  - Includes: `preproc_include`
  - Calls: `call_expression` with `field_expression`, function pointer calls
- **Enterprise features**: Parameter types (including pointer params), struct field extraction, doc comments (`/* */`, `//`), variadic parameter support, typedef detection
- **Optimized for**: Embedded systems, HAL patterns, systems programming

---

## Common Parser Pattern (all languages follow this)

```rust
pub struct XxxParser {
    parser: Parser,
    function_query: Query,
    class_query: Query,     // or struct_query
    import_query: Query,    // or use_query / include_query
    call_query: Query,
}

impl XxxParser {
    pub fn new() -> Result<Self, String> {
        // 1. Create parser, set language
        // 2. Compile all queries
    }

    pub fn parse(&mut self, source: &str) -> ParseResult {
        // 1. Parse source → tree
        // 2. Extract functions, classes, imports, calls
        // 3. Return ParseResult with timing
    }

    fn extract_functions(&self, root, source, result) { /* query matches */ }
    fn extract_classes(&self, root, source, result)   { /* query matches */ }
    fn extract_imports(&self, root, source, result)   { /* query matches */ }
    fn extract_calls(&self, root, source, result)     { /* query matches */ }
}
```

## Tree-Sitter Query Pattern
Each extraction method:
1. Creates a `QueryCursor`
2. Runs `cursor.matches(&self.xxx_query, *root, source)`
3. Iterates matches, extracting captures by name
4. Builds typed structs from captured nodes

## Testing
Every parser has inline `#[cfg(test)]` tests covering:
- Basic function/class/import/call extraction
- Framework-specific patterns (decorators, annotations, attributes)
- Parameter extraction with types
- Doc comment extraction
- Edge cases (abstract classes, async functions, generators)

## v2 Gaps (Rust vs TS parity)
| Feature | Rust Status | TS Status | Priority |
|---------|-------------|-----------|----------|
| Decorator/annotation extraction | ✅ Done | ✅ | — |
| Parameter types + defaults | ✅ Done | ✅ | — |
| Return types | ✅ Done | ✅ | — |
| Doc comments | ✅ Done | ✅ | — |
| Visibility modifiers | ✅ Done | ✅ | — |
| Generic type parameters | ❌ Missing | ✅ | P0 |
| Full inheritance chains | Partial | ✅ | P1 |
| Framework construct detection | Partial | ✅ | P1 |
| Pydantic model support | ❌ Missing | ✅ | P0 |
| Incremental parsing | ❌ Missing | ✅ | P2 |
| AST caching | ❌ Missing | ✅ (LRU) | P2 |
| Access modifiers on functions | Partial | ✅ | P1 |
| Namespace/package extraction | ❌ Missing | ✅ | P1 |
