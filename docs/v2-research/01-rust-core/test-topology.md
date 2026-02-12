# Rust Test Topology Analyzer

## Location
`crates/drift-core/src/test_topology/`

## Files
- `analyzer.rs` — `TestTopologyAnalyzer`: maps tests to source code, detects frameworks, analyzes coverage
- `types.rs` — `TestFile`, `TestCase`, `TestFramework`, `TestType`, `MockUsage`, `MockType`, `TestCoverage`, `RiskLevel`, `TestTopologyResult`
- `mod.rs` — Module exports

## NAPI Exposure
- `analyze_test_topology(files: Vec<String>) -> JsTestTopologyResult`

## What It Does
- Identifies test files by naming convention and content
- Detects test frameworks (Jest, Vitest, Mocha, pytest, JUnit, NUnit, xUnit, Go testing, PHPUnit, etc.)
- Extracts test cases with names, types (unit/integration/e2e), and line numbers
- Detects mock usage (vi.mock, jest.mock, unittest.mock, Mockito, etc.)
- Maps tests to source files they cover
- Calculates coverage metrics and risk levels

## Types

```rust
TestFile {
    file: String,
    framework: TestFramework,
    test_cases: Vec<TestCase>,
    mocks: Vec<MockUsage>,
    imports: Vec<String>,        // What the test imports
    covers: Vec<String>,         // Source files this test covers
}

TestCase {
    name: String,
    test_type: TestType,         // Unit, Integration, E2E, Performance, Snapshot
    line: u32,
    is_async: bool,
    is_skipped: bool,
}

TestFramework { Jest, Vitest, Mocha, Pytest, JUnit, NUnit, XUnit, GoTest, PHPUnit, RustTest, Unknown }
TestType { Unit, Integration, E2E, Performance, Snapshot }

MockUsage {
    target: String,              // What's being mocked
    mock_type: MockType,         // Full, Partial, Spy
    line: u32,
}

MockType { Full, Partial, Spy }

TestCoverage {
    source_file: String,
    test_files: Vec<String>,
    test_count: usize,
    risk_level: RiskLevel,
}

RiskLevel { Low, Medium, High, Critical }

TestTopologyResult {
    test_files: Vec<TestFile>,
    coverage: Vec<TestCoverage>,
    stats: TestTopologyStats,
}
```

## TS Counterpart
`packages/core/src/test-topology/` — Richer analysis with:
- Per-language test extractors (8 languages, 35+ frameworks)
- Minimum test set calculation
- Quality scoring
- Mock analysis depth

## v2 Notes
- Rust version handles basic test detection. The TS side has much richer framework-specific extraction.
- Test-to-source mapping uses import analysis — could be enhanced with call graph integration.
