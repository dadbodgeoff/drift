# Parser Subsystem — Overview

## Locations
- **Rust Core**: `crates/drift-core/src/parsers/` — 12 files (~8,000 lines)
- **TypeScript Layer**: `packages/core/src/parsers/` — 8 files (~4,000 lines)
- **Tree-Sitter Wrappers**: `packages/core/src/parsers/tree-sitter/` — 22 files + subdirs (~6,000 lines)
- **NAPI Bridge**: `crates/drift-napi/src/lib.rs` — Parser section (~400 lines)
- **Native Adapters**: `packages/core/src/native/native-adapters.ts` — Fallback logic

## What It Is
The parser subsystem is Drift's foundation layer. Every other subsystem — detectors, analyzers, call graph, boundaries, security — depends on parser output. It extracts structured metadata (functions, classes, imports, exports, call sites) from source code across 10+ languages using tree-sitter grammars.

## Core Design Principles
1. Dual-layer architecture: Rust for speed, TypeScript for richness (v1 reality)
2. Native tree-sitter in Rust — no WASM overhead, grammars linked at compile time
3. Graceful fallback: Rust → TS tree-sitter → TS regex, per language
4. Unified output format: all parsers produce the same `ParseResult` shape
5. Query-based extraction: tree-sitter `Query` API for pattern matching on AST nodes
6. Framework-aware: parsers understand Spring, Django, Laravel, NestJS, ASP.NET, etc.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                    Consumer Layer                            │
│  Detectors │ Analyzers │ Call Graph │ Boundaries │ Security  │
├─────────────────────────────────────────────────────────────┤
│                    NAPI Bridge (drift-napi)                  │
│  JsParseResult ← Rust ParseResult conversion                │
├─────────────────────────────────────────────────────────────┤
│                    Native Adapters                           │
│  parseWithFallback() — try Rust, fall back to TS            │
├──────────────────────┬──────────────────────────────────────┤
│   Rust Parsers       │   TypeScript Parsers                  │
│   (drift-core)       │   (packages/core)                     │
│                      │                                       │
│   ParserManager      │   ParserManager (LRU cache)           │
│   ├─ TypeScript      │   ├─ TypeScriptParser (TS Compiler)   │
│   ├─ Python          │   ├─ PythonParser (regex)             │
│   ├─ Java            │   ├─ CSSParser                        │
│   ├─ C#              │   ├─ JSONParser                        │
│   ├─ PHP             │   ├─ MarkdownParser                    │
│   ├─ Go              │   └─ Tree-Sitter Wrappers             │
│   ├─ Rust            │       ├─ Python (+ Pydantic)           │
│   ├─ C++             │       ├─ Java (+ Spring)               │
│   └─ C               │       ├─ C# (+ ASP.NET)               │
│                      │       ├─ PHP (+ Laravel)               │
│                      │       ├─ Go                             │
│                      │       ├─ Rust                           │
│                      │       └─ C++                            │
├──────────────────────┴──────────────────────────────────────┤
│                    Tree-Sitter Grammars                       │
│  Rust: compile-time linked │ TS: dynamic loading via require │
└─────────────────────────────────────────────────────────────┘
```

## Entry Points
- **Rust**: `ParserManager::new()` → `parse_file(path, source)` or `parse(source, language)`
- **TypeScript**: `ParserManager` → `parse(filePath, source)` with LRU caching
- **NAPI**: `parse(source, filePath)` → `JsParseResult`
- **Fallback**: `parseWithFallback(source, filePath)` in `native-adapters.ts`

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `crates/drift-core/src/parsers/types.rs` | Core Rust types (Language, ParseResult, FunctionInfo, etc.) | [types.md](./types.md) |
| `crates/drift-core/src/parsers/manager.rs` | Rust ParserManager — unified language dispatch | [rust-parsers.md](./rust-parsers.md) |
| `crates/drift-core/src/parsers/*.rs` | 9 language-specific Rust parsers | [rust-parsers.md](./rust-parsers.md) |
| `packages/core/src/parsers/base-parser.ts` | Abstract BaseParser class (20+ methods) | [base-parser.md](./base-parser.md) |
| `packages/core/src/parsers/parser-manager.ts` | TS ParserManager with LRU cache + incremental parsing | [ts-parser-manager.md](./ts-parser-manager.md) |
| `packages/core/src/parsers/types.ts` | TS type definitions (Language, AST, ASTNode) | [types.md](./types.md) |
| `packages/core/src/parsers/typescript-parser.ts` | TS Compiler API parser | [ts-parsers.md](./ts-parsers.md) |
| `packages/core/src/parsers/python-parser.ts` | Regex-based Python parser | [ts-parsers.md](./ts-parsers.md) |
| `packages/core/src/parsers/tree-sitter/` | Tree-sitter wrappers (7 languages) | [tree-sitter-layer.md](./tree-sitter-layer.md) |
| `packages/core/src/parsers/tree-sitter/pydantic/` | Pydantic v1/v2 model extraction | [pydantic.md](./pydantic.md) |
| `packages/core/src/parsers/tree-sitter/java/` | Java-specific extractors (annotations, classes, methods) | [tree-sitter-layer.md](./tree-sitter-layer.md) |
| `crates/drift-napi/src/lib.rs` | NAPI bridge types and `parse()` function | [napi-bridge.md](./napi-bridge.md) |
| `packages/core/src/native/native-adapters.ts` | Rust→TS fallback adapter | [napi-bridge.md](./napi-bridge.md) |

## Parse Pipeline

```
1. Input: source code string + file path
2. Language detection (from file extension)
3. Parser selection (ParserManager dispatches to correct parser)
4. Tree-sitter parsing → raw AST tree
5. Query-based extraction:
   a. Functions (name, params, return type, decorators, doc comments)
   b. Classes (name, extends, implements, properties, decorators)
   c. Imports (source, named, default, namespace, type-only)
   d. Exports (name, original, re-exports, type-only)
   e. Call sites (callee, receiver, arg count)
6. Output: ParseResult with all extracted metadata + timing
```

## Language Coverage (10 languages in Rust, 14 in TS)

| Language | Rust | TS Custom | TS Tree-Sitter | Framework Support |
|----------|------|-----------|----------------|-------------------|
| TypeScript/JS | ✅ | ✅ (Compiler API) | — | NestJS, Express |
| Python | ✅ | ✅ (regex) | ✅ | Django, FastAPI, Flask, Pydantic |
| Java | ✅ | — | ✅ | Spring, JPA |
| C# | ✅ | — | ✅ | ASP.NET, Entity Framework |
| PHP | ✅ | — | ✅ | Laravel, Symfony |
| Go | ✅ | — | ✅ | Gin, Echo |
| Rust | ✅ | — | ✅ | Actix, Axum, Rocket |
| C++ | ✅ | — | ✅ | Boost, Qt |
| C | ✅ | — | — | Embedded/HAL |
| CSS/SCSS | — | ✅ | — | — |
| JSON | — | ✅ | — | — |
| Markdown | — | ✅ | — | — |

## Performance Characteristics
- Rust parsers: ~1-10ms per file (native tree-sitter, no WASM)
- TS tree-sitter parsers: ~5-20ms per file (Node.js bindings)
- TS regex parsers: ~5-50ms per file (fallback)
- LRU cache: 100 entries default, hash-based invalidation
- Batch parsing: `parse_batch()` in Rust for bulk operations

## v1 → v2 Migration Goal
Bring Rust parsers to full feature parity with TS parsers, then deprecate the TS parsing layer entirely. CSS, JSON, Markdown parsers can stay in TS (not performance-critical). The tree-sitter loader layer becomes unnecessary when Rust handles all parsing natively.

## V2 Additions Needed
- Decorator/annotation extraction in Rust (partially done)
- Generic type parameter extraction
- Full inheritance chain resolution
- Framework-specific construct detection
- Pydantic model support in Rust
- Incremental parsing support in Rust
- AST caching in Rust
