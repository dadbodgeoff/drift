# Tree-Sitter Integration Layer (TypeScript)

## Location
`packages/core/src/parsers/tree-sitter/` — 22 files + 2 subdirectories

## Purpose
TypeScript wrappers around Node.js tree-sitter bindings. Provides enhanced language-specific extraction beyond what the Rust parsers offer (v1). Each language has a loader (dynamic grammar loading) and a parser (semantic extraction).

## File Inventory

### Core Infrastructure
| File | Purpose | Lines |
|------|---------|-------|
| `config.ts` | `PythonParserConfig` + validation + env var support | ~150 |
| `loader.ts` | Generic tree-sitter + Python grammar loader | ~100 |
| `types.ts` | Tree-sitter type definitions (Node, Tree, Parser, Query, Pydantic types) | ~500 |
| `index.ts` | Public exports | ~20 |

### Per-Language Loaders (dynamic grammar loading)
| File | Grammar Package |
|------|----------------|
| `typescript-loader.ts` | `tree-sitter-typescript` |
| `csharp-loader.ts` | `tree-sitter-c-sharp` |
| `java-loader.ts` | `tree-sitter-java` |
| `php-loader.ts` | `tree-sitter-php` |
| `go-loader.ts` | `tree-sitter-go` |
| `cpp-loader.ts` | `tree-sitter-cpp` |
| `rust-loader.ts` | `tree-sitter-rust` |

### Per-Language Parsers
| File | Extends | Special Features |
|------|---------|-----------------|
| `tree-sitter-python-parser.ts` | `BaseParser` | Pydantic extraction, fallback to regex |
| `tree-sitter-java-parser.ts` | Standalone | Full semantic extraction, Spring annotations |
| `tree-sitter-csharp-parser.ts` | Standalone | ASP.NET attributes, records, structs |
| `tree-sitter-php-parser.ts` | Standalone | Laravel/Symfony attributes, traits |
| `tree-sitter-go-parser.ts` | Standalone | Struct tags, interfaces |
| `tree-sitter-rust-parser.ts` | Standalone | Derive macros, serde attributes |
| `tree-sitter-cpp-parser.ts` | Standalone | Templates, virtual methods |

### AST Converters
| File | Purpose |
|------|---------|
| `python-ast-converter.ts` | Converts tree-sitter Python tree → Drift ASTNode format |
| `csharp-ast-converter.ts` | Converts tree-sitter C# tree → Drift ASTNode format |

### Subdirectories
- `java/` — Java-specific extractors (5 files)
- `pydantic/` — Pydantic model extraction (9 files)

---

## Loader Pattern

All loaders follow the same pattern:

```typescript
let available: boolean | null = null;
let cachedParser: TreeSitterParser | null = null;
let cachedLanguage: TreeSitterLanguage | null = null;
let loadingError: string | null = null;

export function isXxxTreeSitterAvailable(): boolean { /* lazy check */ }
export function getXxxLanguage(): TreeSitterLanguage { /* cached */ }
export function createXxxParser(): TreeSitterParser { /* factory */ }
export function getXxxLoadingError(): string | null { /* error info */ }
export function resetXxxLoader(): void { /* for testing */ }
```

Loading uses `createRequire(import.meta.url)` for ESM compatibility. Grammars are loaded via `require('tree-sitter-xxx')`.

---

## Configuration (`config.ts`)

```typescript
interface PythonParserConfig {
  useTreeSitter: boolean;        // Default: true
  extractPydanticModels: boolean; // Default: true
  maxTypeDepth: number;          // Default: 10
  includePositions: boolean;     // Default: true
  parseTimeout: number;          // Default: 5000ms
  useIncremental: boolean;       // Default: true
  includeComments: boolean;      // Default: true
  includeAnonymous: boolean;     // Default: false
}
```

Environment variable overrides: `DRIFT_PYTHON_USE_TREE_SITTER`, `DRIFT_PYTHON_EXTRACT_PYDANTIC`, etc.

Validation returns `ConfigValidationResult` with field-level errors.

---

## Tree-Sitter Types (`types.ts`)

### Core Types
- `TreeSitterNode` — Full node interface (type, text, positions, children, parent, siblings, field access)
- `TreeSitterTree` — Tree with rootNode, edit(), getChangedRanges()
- `TreeSitterParser` — Parser with setLanguage(), parse(), setTimeoutMicros()
- `TreeSitterLanguage` — Language with version, nodeTypeCount, fieldCount
- `TreeSitterTreeCursor` — Cursor for tree walking
- `TreeSitterQuery` — Query with matches(), captures()
- `TreeSitterPoint` — { row, column }
- `TreeSitterRange` — { startPosition, endPosition, startIndex, endIndex }
- `TreeSitterEdit` — Edit descriptor for incremental parsing

### Pydantic Types (also in types.ts)
- `PydanticModelInfo` — Model name, fields, validators, config, bases
- `PydanticFieldInfo` — Field name, type, default, constraints, alias
- `TypeInfo` — Type name, args, optional flag, union members
- `FieldConstraints` — ge, le, gt, lt, minLength, maxLength, pattern, multipleOf
- `PydanticValidatorInfo` — Validator name, fields, mode (before/after/wrap)
- `PydanticConfigInfo` — extra, frozen, validate_assignment, etc.

---

## Java Subdirectory (`java/`)

| File | Purpose |
|------|---------|
| `types.ts` | `JavaParseResult`, `PackageInfo`, `JavaImportInfo`, `JavaClassInfo`, `JavaMethodInfo`, `JavaFieldInfo`, `JavaAnnotation` |
| `class-extractor.ts` | `extractClasses()`, `extractInterfaces()`, `extractEnums()`, `extractRecords()`, `extractAnnotationDefinitions()` |
| `method-extractor.ts` | Method and constructor extraction with annotations |
| `annotation-extractor.ts` | First-class annotation extraction (Spring pattern detection) |
| `index.ts` | Public exports |

Annotations are treated as first-class citizens — they're the primary signal for Spring Boot pattern detection.

---

## Python Parser (`tree-sitter-python-parser.ts`)

Extends `BaseParser`. Key features:
- Lazy parser initialization
- Fallback to regex-based `PythonParser` when tree-sitter unavailable
- Pydantic model extraction via `PydanticExtractor`
- AST conversion via `PythonASTConverter`
- Returns `TreeSitterPythonParseResult` (extends ParseResult with `treeSitterTree`, `usedTreeSitter`, `pydanticModels`)

---

## v2 Considerations
- This entire layer becomes unnecessary when Rust parsers reach feature parity
- The Pydantic extraction logic needs to be ported to Rust (complex — see [pydantic.md](./pydantic.md))
- Java annotation extraction needs Rust port (Spring pattern detection depends on it)
- The loader pattern is irrelevant in Rust (grammars are compile-time linked)
- AST converters are unnecessary in Rust (tree-sitter nodes are native)
- Config/validation can be simplified in Rust (compile-time types)
