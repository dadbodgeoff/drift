# Test Topology System — Overview

## Location
- `packages/core/src/test-topology/` — TypeScript (~15 source files)
- `crates/drift-core/src/test_topology/` — Rust (3 files)

## What It Is
Test Topology maps tests to the production code they exercise. It answers: "Which tests cover this function?", "What's untested?", and "Which tests should I run after changing this file?" It understands test frameworks across 9 languages, tracks mock usage, measures test quality, and integrates with the call graph for transitive coverage analysis.

## Core Design Principles
1. Tests are linked to production code through direct calls and transitive reachability
2. Mock-only coverage is tracked separately — it's not real coverage
3. Test quality is scored (assertions, error cases, edge cases, mock ratio)
4. Framework detection is per-language with dedicated extractors
5. Minimum test set selection minimizes CI time after changes

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              TestTopologyAnalyzer                        │
│  (test-topology-analyzer.ts — unified analysis API)     │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Coverage │ Minimum  │ Mock     │   Quality              │
│ Mapping  │ Test Set │ Analysis │   Scoring              │
├──────────┴──────────┴──────────┴────────────────────────┤
│              Per-Language Extractors                     │
│  TS │ Python │ Java │ C# │ PHP │ Go │ Rust │ C++       │
├─────────────────────────────────────────────────────────┤
│              Call Graph Integration                      │
│  Direct calls │ Transitive reachability │ Native SQLite │
├─────────────────────────────────────────────────────────┤
│              Rust Core (crates/drift-core)               │
│  TestFile │ TestCase │ MockUsage │ Framework detection   │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `test-topology-analyzer.ts` — `TestTopologyAnalyzer` class: main analysis API
- `hybrid-test-topology-analyzer.ts` — Hybrid analyzer (tree-sitter + regex)
- `index.ts` — Public exports

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `extractors/` | Per-language test extraction (8 languages) | [extractors.md](./extractors.md) |
| `extractors/regex/` | Regex fallback extractors | [extractors.md](./extractors.md) |
| `types.ts` | All test topology types | [types.md](./types.md) |
| `test-topology-analyzer.ts` | Main analyzer with coverage, mocks, minimum test set | [analyzer.md](./analyzer.md) |
| `hybrid-test-topology-analyzer.ts` | Hybrid tree-sitter + regex analyzer | [analyzer.md](./analyzer.md) |

## Supported Frameworks (35+)

| Language | Frameworks |
|----------|-----------|
| TypeScript/JS | Jest, Vitest, Mocha, Ava, Tape |
| Python | Pytest, Unittest, Nose |
| Java | JUnit4, JUnit5, TestNG |
| C# | xUnit, NUnit, MSTest |
| PHP | PHPUnit, Pest, Codeception |
| Go | go-testing, Testify, Ginkgo, Gomega |
| Rust | rust-test, tokio-test, proptest, criterion, rstest |
| C++ | GTest, Catch2, Boost.Test, doctest, CppUnit |

## Analysis Lifecycle

```
Extract → Map → Score → Query
```

1. Per-language extractor parses test files → `TestExtraction` (cases, mocks, setup blocks, fixtures)
2. Analyzer builds mappings: test → source file, test → functions (direct + transitive via call graph)
3. Quality scoring: assertion count, error/edge case coverage, mock ratio, setup ratio
4. Query API: coverage per file, uncovered functions, minimum test set, mock analysis

## Key Capabilities

### Coverage Mapping
For any source file, returns which tests cover it, how (direct/transitive/mocked), call depth, and confidence score.

### Minimum Test Set
Given changed files, computes the smallest set of tests that covers the changes — with estimated time savings.

### Uncovered Function Detection
Identifies functions with no test coverage, assigns risk scores based on: entry point status, sensitive data access, call graph centrality. Infers reasons for intentional non-coverage (dead code, framework hooks, generated, trivial).

### Mock Analysis
Tracks mock-to-real ratio per test, identifies tests with excessive mocking, distinguishes external mocks (good) from internal mocks (suspicious), and reports most-mocked modules.

### Test Quality Scoring
Per-test quality score (0-100) based on: assertion count, error case testing, edge case testing, mock ratio, setup-to-test ratio.

## Rust Implementation
The Rust side (`crates/drift-core/src/test_topology/`) provides:
- `types.rs` — Core types: `TestFile`, `TestCase`, `TestFramework`, `MockUsage`, `MockType`, `TestType`
- `analyzer.rs` — Rust-native test file analysis
- Framework detection for 13 frameworks

## MCP Integration
Exposed via `drift_test_topology` MCP tool for AI-assisted test analysis.

## V2 Notes
- Per-language extractors should move to Rust for performance on large codebases
- Quality scoring is pure computation — ideal for Rust
- Coverage mapping with call graph traversal benefits from Rust's speed
- Framework detection already partially in Rust, needs full parity
