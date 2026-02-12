# Parser Comparison: Rust vs TypeScript

## Language Coverage

| Language | Rust Parser | TS Parser | TS Tree-Sitter | Notes |
|----------|------------|-----------|----------------|-------|
| TypeScript/JS | ✅ | ✅ (custom) | — | Rust is basic, TS is rich |
| Python | ✅ | ✅ (custom) | ✅ | TS has Pydantic support |
| Java | ✅ | — | ✅ | TS extracts annotations, generics |
| C# | ✅ | — | ✅ | TS extracts records, structs, attributes |
| PHP | ✅ | — | ✅ | TS extracts traits, attributes |
| Go | ✅ | — | ✅ | Basic in both |
| Rust | ✅ | — | ✅ | Basic in both |
| C++ | ✅ | — | ✅ | TS extracts templates, virtual methods |
| C | ✅ | — | — | Rust only |
| CSS | — | ✅ (custom) | — | TS only, not needed in Rust |
| JSON | — | ✅ (custom) | — | TS only, not needed in Rust |
| Markdown | — | ✅ (custom) | — | TS only, not needed in Rust |

## Extraction Depth Comparison

| Feature | Rust | TS |
|---------|------|-----|
| Function signatures | ✅ | ✅ |
| Class definitions | ✅ | ✅ |
| Import/export | ✅ | ✅ |
| Call sites | ✅ | ✅ |
| Parameters with types | Basic | Full |
| Decorators/annotations | ❌ | ✅ |
| Generic type params | ❌ | ✅ |
| Inheritance chains | ❌ | ✅ |
| Access modifiers | ❌ | ✅ |
| Namespace/package | ❌ | ✅ |
| Framework constructs | ❌ | ✅ |
| Property definitions | Basic | Full |

## v2 Goal
Bring Rust parsers to feature parity with TS parsers, then deprecate the TS parsing layer entirely.
