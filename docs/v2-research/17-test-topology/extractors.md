# Test Topology — Per-Language Extractors

## Location
`packages/core/src/test-topology/extractors/`

## Architecture
Each language has a dedicated extractor that inherits from `BaseTestExtractor`. Extractors parse test files and produce `TestExtraction` results containing test cases, mock statements, setup blocks, and fixtures.

### Base Extractor
`base-test-extractor.ts` — Abstract base class providing:
- Framework detection interface
- Test case extraction interface
- Mock statement extraction interface
- Setup block extraction interface
- Common utilities (line counting, pattern matching)

### Per-Language Extractors

| File | Language | Frameworks Detected |
|------|----------|-------------------|
| `typescript-test-extractor.ts` | TypeScript/JS | Jest, Vitest, Mocha, Ava, Tape |
| `python-test-extractor.ts` | Python | Pytest, Unittest, Nose |
| `java-test-extractor.ts` | Java | JUnit4, JUnit5, TestNG |
| `csharp-test-extractor.ts` | C# | xUnit, NUnit, MSTest |
| `php-test-extractor.ts` | PHP | PHPUnit, Pest, Codeception |
| `go-test-extractor.ts` | Go | go-testing, Testify, Ginkgo, Gomega |
| `rust-test-extractor.ts` | Rust | rust-test, tokio-test, proptest, criterion, rstest |
| `cpp-test-extractor.ts` | C++ | GTest, Catch2, Boost.Test, doctest, CppUnit |

### Regex Fallback
`regex/` — Regex-based extractors used when tree-sitter parsing is unavailable or fails. Provides degraded but functional extraction.

## Extraction Output

```typescript
interface TestExtraction {
  file: string;
  framework: TestFramework;
  language: string;
  testCases: TestCase[];      // Individual test cases with calls, assertions, quality
  mocks: MockStatement[];     // Mock/stub/spy statements
  setupBlocks: SetupBlock[];  // beforeEach, setUp, etc.
  fixtures?: FixtureInfo[];   // Pytest fixtures, etc.
}
```

## What Each Extractor Detects

### Test Cases
- Test function/method declarations (it, test, def test_, @Test, etc.)
- Parent describe/context blocks for qualified naming
- Direct function calls within test body
- Assertions (expect, assert, assertEquals, etc.)
- Error case assertions and edge case assertions

### Mock Statements
- Module mocks (jest.mock, @patch, sinon.stub)
- Function mocks/spies
- HTTP mocks
- Whether mock targets external or internal code
- Whether mock has inline implementation

### Setup Blocks
- beforeEach / afterEach / beforeAll / afterAll
- setUp / tearDown (Python, Java)
- Functions called during setup

### Fixtures (Python-specific)
- Pytest fixture name, scope, line number
- What the fixture provides

## V2 Notes
- All extractors should move to Rust for performance
- Tree-sitter primary, regex fallback pattern should be preserved
- Fixture detection should expand beyond Python (JUnit @Rule, C# [SetUp])
