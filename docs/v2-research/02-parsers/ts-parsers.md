# TypeScript-Side Parsers

## Location
`packages/core/src/parsers/`

## Custom Parsers (Pure TS, no tree-sitter)
- `typescript-parser.ts` — TypeScript/JavaScript AST parsing
- `python-parser.ts` — Python AST parsing
- `css-parser.ts` — CSS parsing
- `json-parser.ts` — JSON parsing
- `markdown-parser.ts` — Markdown parsing
- `base-parser.ts` — Abstract base class for all parsers
- `parser-manager.ts` — Parser selection and management
- `types.ts` — Shared types (`Language`, `AST`, `ASTNode`, `ParseResult`, `ParseError`)

## Tree-Sitter Loaders (TS wrappers around Node tree-sitter bindings)
`packages/core/src/parsers/tree-sitter/`

### Per-Language Parsers
- `tree-sitter-python-parser.ts` + `python-ast-converter.ts`
- `tree-sitter-csharp-parser.ts` + `csharp-ast-converter.ts`
- `tree-sitter-java-parser.ts` + `java/` (subdirectory with Java-specific logic)
- `tree-sitter-php-parser.ts`
- `tree-sitter-go-parser.ts`
- `tree-sitter-cpp-parser.ts`
- `tree-sitter-rust-parser.ts`

### Loaders (dynamic loading of tree-sitter grammars)
- `loader.ts` — Generic tree-sitter grammar loader
- `typescript-loader.ts`, `csharp-loader.ts`, `java-loader.ts`
- `php-loader.ts`, `go-loader.ts`, `cpp-loader.ts`, `rust-loader.ts`
- `config.ts` — Tree-sitter configuration

### Specialized
- `pydantic/` — Pydantic model parsing for Python

## Types Extracted
The TS parsers extract significantly more detail than the Rust parsers:
- Full class hierarchies with inheritance
- Decorator/annotation semantics
- Generic type parameters
- Method signatures with full parameter types
- Property definitions with access modifiers
- Namespace/package information
- Framework-specific constructs (Spring annotations, Laravel attributes, etc.)

## v2 Notes
- The Rust parsers handle basic extraction. The TS parsers handle rich extraction.
- v2 must bring the TS-level richness into Rust parsers.
- CSS, JSON, Markdown parsers can stay in TS (not performance-critical).
- The tree-sitter loader layer becomes unnecessary when Rust handles all parsing.
