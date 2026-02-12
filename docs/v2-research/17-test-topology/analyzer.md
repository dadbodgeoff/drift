# Test Topology — Analyzer

## Location
`packages/core/src/test-topology/test-topology-analyzer.ts`

## Purpose
The `TestTopologyAnalyzer` is the main analysis engine. It consumes test extractions, integrates with the call graph for transitive coverage, and exposes query APIs for coverage, uncovered functions, minimum test sets, and mock analysis.

## Class: TestTopologyAnalyzer

### Construction
Requires parsers (tree-sitter instances per language). Optionally accepts a call graph via `setCallGraph()` for transitive coverage analysis. When a call graph with SQLite backing is available, uses native N-API queries for performance.

### Key Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `extractFromFile(content, filePath)` | Extract tests from a single file | `TestExtraction \| null` |
| `buildMappings()` | Build test→source and test→function mappings | `void` |
| `getCoverage(sourceFile)` | Get test coverage for a source file | `TestCoverage` |
| `getUncoveredFunctions(options)` | Find functions with no test coverage | `UncoveredFunction[]` |
| `getMinimumTestSet(changedFiles)` | Compute smallest test set for changes | `MinimumTestSet` |
| `analyzeMocks()` | Analyze mock usage across all tests | `MockAnalysis` |
| `getSummary()` | Get topology-wide summary statistics | `TestTopologySummary` |

## Coverage Mapping Algorithm

```
1. For each test case:
   a. Resolve direct function calls → function IDs
   b. If call graph available: find transitive calls (BFS through call graph)
   c. Record: test → function mapping with reach type (direct/transitive/mocked)
2. For each source file:
   a. Collect all functions in the file
   b. For each function, find covering tests
   c. Calculate coverage percentage
   d. Flag mock-only coverage separately
```

### Reach Types
- `direct` — Test directly calls the function
- `transitive` — Test reaches the function through call chain
- `mocked` — Function is only reached via mocked paths

### Confidence Scoring
Coverage confidence is based on:
- Direct calls: high confidence
- Transitive (shallow depth): medium-high
- Transitive (deep): lower confidence
- Mocked: lowest confidence

## Uncovered Function Detection

```
1. Iterate all functions in call graph
2. Filter out test files
3. For each function without covering tests:
   a. Calculate risk score (0-100) based on:
      - Is it an entry point? (+30)
      - Does it access sensitive data? (+25)
      - How many callers does it have? (centrality)
   b. Infer possible reasons for non-coverage:
      - dead-code: no callers
      - framework-hook: lifecycle method
      - generated: in generated file
      - trivial: getter/setter/constructor
      - test-only: only called from tests
      - deprecated: marked deprecated
```

## Minimum Test Set Selection

```
1. For each changed file:
   a. Find all functions in the file
   b. Find all tests covering those functions
2. Deduplicate test set
3. Calculate coverage of changed code
4. Estimate time saved vs running full suite
```

Returns: selected tests with reasons, total vs selected count, estimated time savings, changed code coverage percentage.

## Mock Analysis

```
1. Aggregate all mock statements across tests
2. Classify: external (good) vs internal (suspicious)
3. Calculate per-test mock ratio
4. Identify high-mock-ratio tests (>0.7)
5. Rank most-mocked modules
```

## Summary Statistics
- Test files / test cases count
- Covered vs total source files and functions
- Coverage percentages (file-level and function-level)
- Average mock ratio and quality score
- Breakdown by framework

## Hybrid Analyzer
`hybrid-test-topology-analyzer.ts` combines tree-sitter parsing with regex fallback for robustness. Uses tree-sitter as primary, falls back to regex extractors when parsing fails.

## V2 Notes
- Coverage mapping with call graph traversal is the bottleneck — move to Rust
- Quality scoring is pure computation — ideal for Rust
- Mock analysis can stay TS (presentation layer)
- Minimum test set is a set-cover problem — Rust performance helps at scale
