# Test Topology — Types

## Location
- `packages/core/src/test-topology/types.ts` — TypeScript types
- `crates/drift-core/src/test_topology/types.rs` — Rust types

## Core Types

### TestCase
```typescript
interface TestCase {
  id: string;                    // "file:name:line"
  name: string;                  // Test name/description
  parentBlock?: string;          // Parent describe/context
  qualifiedName: string;         // "describe > it"
  file: string;
  line: number;
  directCalls: string[];         // Functions directly called
  transitiveCalls: string[];     // Functions transitively reachable
  assertions: AssertionInfo[];   // Assertion details
  quality: TestQualitySignals;   // Quality scoring
}
```

### TestQualitySignals
```typescript
interface TestQualitySignals {
  assertionCount: number;
  hasErrorCases: boolean;
  hasEdgeCases: boolean;        // null, empty, boundary
  mockRatio: number;            // High = potentially brittle
  setupRatio: number;           // Setup lines vs test lines
  score: number;                // 0-100 overall quality
}
```

### TestCoverage
```typescript
interface TestCoverage {
  sourceFile: string;
  tests: TestCoverageInfo[];     // Tests covering this file
  functions: FunctionCoverageInfo[];
  coveragePercent: number;
}
```

### UncoveredFunction
```typescript
interface UncoveredFunction {
  functionId: string;
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  possibleReasons: UncoveredReason[];  // dead-code, framework-hook, generated, trivial, test-only, deprecated
  riskScore: number;                    // 0-100
  isEntryPoint: boolean;
  accessesSensitiveData: boolean;
}
```

### MinimumTestSet
```typescript
interface MinimumTestSet {
  tests: Array<{ file: string; name: string; reason: string }>;
  totalTests: number;
  selectedTests: number;
  timeSaved: string;
  changedCodeCoverage: number;
}
```

### MockStatement
```typescript
interface MockStatement {
  target: string;               // What's being mocked
  mockType: string;             // jest.mock, sinon.stub, @patch, etc.
  line: number;
  isExternal: boolean;          // External deps (good) vs internal code (suspicious)
  hasImplementation?: boolean;
}
```

### MockAnalysis
```typescript
interface MockAnalysis {
  totalMocks: number;
  externalMocks: number;
  internalMocks: number;
  externalPercent: number;
  internalPercent: number;
  avgMockRatio: number;
  highMockRatioTests: Array<{ file: string; testName: string; mockRatio: number }>;
  topMockedModules: Array<{ module: string; count: number }>;
}
```

## Rust Types

### TestFile (Rust)
```rust
struct TestFile {
    path: String,
    tests_file: Option<String>,     // Source file being tested
    framework: TestFramework,
    test_cases: Vec<TestCase>,
    mocks: Vec<MockUsage>,
}
```

### TestFramework (Rust)
Enum: Jest, Vitest, Mocha, Pytest, JUnit, NUnit, XUnit, PHPUnit, GoTest, RustTest, Catch2, GoogleTest, Unknown

### TestType (Rust)
Enum: Unit, Integration, E2E, Unknown

### MockType (Rust)
Enum: Function, Module, Class, Http

## Type Parity Notes
- Rust types are simpler (no quality scoring, no transitive analysis)
- TypeScript types include full quality metrics and coverage analysis
- V2 should unify: Rust handles extraction + scoring, TS handles presentation
