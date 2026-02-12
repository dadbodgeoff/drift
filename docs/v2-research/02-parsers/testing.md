# Parser Testing

## Rust Tests
Every Rust parser has inline `#[cfg(test)]` tests in the same file. Run with:
```bash
cargo test -p drift-core parsers
```

### Test Coverage Per Language

| Parser | Test Count | Covers |
|--------|-----------|--------|
| TypeScript | ~10 | Functions, classes, imports, exports, calls, decorators, async, generators |
| Python | ~15 | Functions, classes, imports, calls, decorators, docstrings, generators, base classes |
| Java | ~12 | Methods, constructors, classes, interfaces, imports, calls, annotations, Javadoc |
| C# | ~12 | Methods, constructors, classes, interfaces, structs, records, usings, calls, attributes, XML docs |
| PHP | ~12 | Functions, methods, classes, interfaces, traits, uses, calls, PHP 8 attributes, parameters, return types |
| Go | ~12 | Functions, methods, structs, interfaces, imports, calls, struct tags, parameters, doc comments, variadic |
| Rust | ~12 | Functions, structs, enums, traits, impl blocks, uses, calls, derive attributes, async, serde tags |
| C++ | ~12 | Functions, classes, structs, includes, calls, templates, parameters, doc comments, class members |
| C | ~12 | Functions, structs, unions, enums, typedefs, includes, calls, parameters, doc comments, embedded patterns |

### Test Patterns
Each parser tests:
1. **Basic extraction**: Single function, class, import, call
2. **Framework patterns**: Language-specific decorators/annotations/attributes
3. **Parameter extraction**: Types, defaults, variadic
4. **Doc comments**: Language-specific comment styles
5. **Edge cases**: Abstract classes, async functions, generators, visibility
6. **Enterprise features**: Full parameter types, return types, struct tags/serde

## TypeScript Tests
Located in `packages/core/src/parsers/tree-sitter/__tests__/`

### Test Files
- Parser-specific test suites for each tree-sitter wrapper
- Pydantic extraction tests
- Java annotation extraction tests
- Configuration validation tests
- Loader availability tests

## Integration Tests
- NAPI bridge tests verify Rust → JS type conversion
- Native adapter tests verify fallback behavior
- End-to-end tests parse real project files

## v2 Testing Strategy
- Port all TS parser tests to Rust as feature parity is achieved
- Add property-based tests for type resolution (especially Pydantic)
- Add benchmark tests comparing Rust vs TS parser performance
- Add cross-language consistency tests (same patterns detected regardless of parser path)
