# Rust Parsers

## Location
`crates/drift-core/src/parsers/`

## Files
- `manager.rs` — Parser manager (language detection, parser selection)
- `typescript.rs` — TypeScript/JavaScript parser
- `python.rs` — Python parser
- `java.rs` — Java parser
- `csharp.rs` — C# parser
- `php.rs` — PHP parser
- `go.rs` — Go parser
- `rust_lang.rs` — Rust parser
- `cpp.rs` — C++ parser
- `c.rs` — C parser
- `types.rs` — Shared types (`ParseResult`, `FunctionInfo`, `ClassInfo`, etc.)
- `mod.rs` — Module exports

## What It Does
- Uses tree-sitter for native AST parsing across 11 languages (TS, JS, Python, Java, C#, PHP, Go, Rust, C++, C)
- Extracts: functions, classes, imports, exports, call sites, parameters, properties
- Language auto-detection from file extension
- Returns structured `ParseResult` with all extracted entities

## NAPI Exposure
- `parse(source, file_path) -> Option<JsParseResult>` — Parse single file
- `supported_languages() -> Vec<String>` — List supported languages

## Dependencies (tree-sitter grammars, all v0.23)
- `tree-sitter` core
- `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-java`
- `tree-sitter-c-sharp`, `tree-sitter-php`, `tree-sitter-go`
- `tree-sitter-rust`, `tree-sitter-cpp`, `tree-sitter-c`

## v2 Notes
- This is the foundation. Already covers 11 languages.
- Needs: richer extraction (decorators, annotations, generics, type info), framework-aware parsing.
- The TS-side parsers extract much more detail (especially for Java, C#, PHP). That richness needs to move here.
