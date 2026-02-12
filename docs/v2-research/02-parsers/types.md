# Parser Types & Data Model

## Rust Types (`crates/drift-core/src/parsers/types.rs`)

### Language Enum
```rust
pub enum Language {
    TypeScript, JavaScript, Python, Java, CSharp,
    Php, Go, Rust, Cpp, C,
}
```
- `from_extension(ext)` — Maps file extensions to language
- `from_path(path)` — Extracts extension from path, then maps
- Extension mappings: `.ts/.tsx/.mts/.cts` → TypeScript, `.js/.jsx/.mjs/.cjs` → JavaScript, `.py/.pyi` → Python, `.java` → Java, `.cs` → CSharp, `.php` → Php, `.go` → Go, `.rs` → Rust, `.cpp/.cc/.cxx/.hpp/.hh/.hxx` → Cpp, `.c/.h` → C

### ParseResult (primary output)
```rust
pub struct ParseResult {
    pub language: Language,
    pub tree: Option<tree_sitter::Tree>,  // Raw AST (not serializable)
    pub functions: Vec<FunctionInfo>,
    pub classes: Vec<ClassInfo>,
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<ExportInfo>,
    pub calls: Vec<CallSite>,
    pub errors: Vec<ParseError>,
    pub parse_time_us: u64,
}
```
- `new(language)` — Empty result
- `with_tree(language, tree)` — Result with AST tree attached
- `ParseResultSerialized` — Same but without `tree` field, implements `From<ParseResult>`

### FunctionInfo
```rust
pub struct FunctionInfo {
    pub name: String,
    pub qualified_name: Option<String>,   // e.g., "ClassName.methodName"
    pub parameters: Vec<ParameterInfo>,
    pub return_type: Option<String>,
    pub is_exported: bool,
    pub is_async: bool,
    pub is_generator: bool,
    pub range: Range,
    pub decorators: Vec<String>,          // @decorator or #[attribute] text
    pub doc_comment: Option<String>,      // Extracted doc comment
}
```

### ParameterInfo
```rust
pub struct ParameterInfo {
    pub name: String,
    pub type_annotation: Option<String>,
    pub default_value: Option<String>,
    pub is_rest: bool,                    // variadic/rest parameter
}
```

### ClassInfo
```rust
pub struct ClassInfo {
    pub name: String,
    pub extends: Option<String>,
    pub implements: Vec<String>,
    pub is_exported: bool,
    pub is_abstract: bool,
    pub methods: Vec<FunctionInfo>,       // Currently unused (methods in functions vec)
    pub properties: Vec<PropertyInfo>,
    pub range: Range,
    pub decorators: Vec<String>,
}
```

### PropertyInfo
```rust
pub struct PropertyInfo {
    pub name: String,
    pub type_annotation: Option<String>,
    pub is_static: bool,
    pub is_readonly: bool,
    pub visibility: Visibility,
    pub tags: Option<Vec<StructTag>>,     // Go struct tags
}
```

### StructTag (Go-specific)
```rust
pub struct StructTag {
    pub key: String,    // e.g., "json", "gorm", "validate"
    pub value: String,  // e.g., "id", "primaryKey", "required"
}
```

### Visibility
```rust
pub enum Visibility { Public, Private, Protected }
```

### ImportInfo
```rust
pub struct ImportInfo {
    pub source: String,           // Module path
    pub named: Vec<String>,       // Named imports
    pub default: Option<String>,  // Default import
    pub namespace: Option<String>,// Namespace import (* as X)
    pub is_type_only: bool,
    pub range: Range,
}
```

### ExportInfo
```rust
pub struct ExportInfo {
    pub name: String,
    pub original_name: Option<String>,
    pub from_source: Option<String>,  // Re-export source
    pub is_type_only: bool,
    pub is_default: bool,
    pub range: Range,
}
```

### CallSite
```rust
pub struct CallSite {
    pub callee: String,
    pub receiver: Option<String>,  // e.g., "db" in db.query()
    pub arg_count: usize,
    pub range: Range,
}
```

### Position & Range
```rust
pub struct Position { pub line: u32, pub column: u32 }
pub struct Range { pub start: Position, pub end: Position }
```

### ParseError
```rust
pub struct ParseError { pub message: String, pub range: Range }
```

---

## TypeScript Types (`packages/core/src/parsers/types.ts`)

### Language Type
```typescript
type Language =
  | 'typescript' | 'javascript' | 'python' | 'csharp' | 'java'
  | 'php' | 'go' | 'rust' | 'cpp'
  | 'css' | 'scss' | 'json' | 'yaml' | 'markdown';
```
Note: TS has 14 languages (adds CSS, SCSS, JSON, YAML, Markdown). Rust has 10.

### ParseResult (TS)
```typescript
interface ParseResult {
  ast: AST | null;
  language: Language;
  errors: ParseError[];
  success: boolean;
}
```
Note: TS ParseResult returns raw AST. Rust ParseResult returns extracted metadata. These are fundamentally different shapes — the NAPI bridge converts Rust's extracted metadata into `JsParseResult`.

### AST & ASTNode (TS)
```typescript
interface AST { rootNode: ASTNode; text: string; }
interface ASTNode {
  type: string;
  startPosition: Position;
  endPosition: Position;
  children: ASTNode[];
  text: string;
}
```

### Position (TS)
```typescript
interface Position { row: number; column: number; }
```

---

## NAPI Bridge Types (`crates/drift-napi/src/lib.rs`)

The NAPI bridge converts Rust types to JavaScript-compatible objects:

| Rust Type | NAPI Type | Notes |
|-----------|-----------|-------|
| `ParseResult` | `JsParseResult` | Drops `tree`, adds `parse_time_us` as i64 |
| `FunctionInfo` | `JsFunctionInfo` | `range` → `start_line`/`end_line` |
| `ClassInfo` | `JsClassInfo` | Properties as `JsPropertyInfo[]` |
| `ImportInfo` | `JsImportInfo` | `range` → `line` |
| `ExportInfo` | `JsExportInfo` | Flattened |
| `CallSite` | `JsCallSite` | Same shape |
| `ParameterInfo` | `JsParameterInfo` | Same shape |
| `PropertyInfo` | `JsPropertyInfo` | `visibility` as string, `tags` as `JsStructTag[]` |
| `Language` | `String` | Lowercase string |
| `Visibility` | `String` | "public", "private", "protected" |

---

## Type Mapping: Rust ↔ TS ↔ NAPI

```
Rust ParseResult
  ├─ language: Language enum
  ├─ tree: Option<Tree>          ← dropped in NAPI
  ├─ functions: Vec<FunctionInfo>
  │   ├─ range: Range            → start_line/end_line in NAPI
  │   └─ decorators: Vec<String>
  ├─ classes: Vec<ClassInfo>
  │   └─ properties: Vec<PropertyInfo>
  │       └─ tags: Option<Vec<StructTag>>
  ├─ imports: Vec<ImportInfo>
  │   └─ range: Range            → line in NAPI
  ├─ exports: Vec<ExportInfo>
  ├─ calls: Vec<CallSite>
  └─ errors: Vec<ParseError>

TS ParseResult (different shape!)
  ├─ ast: AST | null             ← raw tree, not extracted metadata
  ├─ language: Language string
  ├─ errors: ParseError[]
  └─ success: boolean
```

## v2 Considerations
- Unify the Rust and TS ParseResult shapes — v2 should have one canonical shape
- Add `generic_params: Vec<String>` to FunctionInfo and ClassInfo
- Add `access_modifier: Visibility` to FunctionInfo
- Add `namespace: Option<String>` to ClassInfo
- Consider adding `body_hash: String` for incremental change detection
- StructTag should be generalized beyond Go (C# attributes, Java annotations have similar key-value semantics)
