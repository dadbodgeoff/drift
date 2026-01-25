/**
 * Test Topology Types
 *
 * Types for analyzing test-to-code mapping, mock patterns, and test quality.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Supported test frameworks
 */
export type TestFramework =
  // JavaScript/TypeScript
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'ava'
  | 'tape'
  // Python
  | 'pytest'
  | 'unittest'
  | 'nose'
  // Java
  | 'junit4'
  | 'junit5'
  | 'testng'
  // C#
  | 'xunit'
  | 'nunit'
  | 'mstest'
  // PHP
  | 'phpunit'
  | 'pest'
  | 'codeception'
  // Go
  | 'go-testing'
  | 'testify'
  | 'ginkgo'
  | 'gomega'
  // Rust
  | 'rust-test'
  | 'tokio-test'
  | 'proptest'
  | 'criterion'
  | 'rstest'
  // C++
  | 'gtest'
  | 'catch2'
  | 'boost-test'
  | 'doctest'
  | 'cppunit'
  | 'unknown';

/**
 * How a test reaches production code
 */
export type ReachType = 'direct' | 'transitive' | 'mocked';

/**
 * A single test case extracted from a test file
 */
export interface TestCase {
  /** Unique ID: file:name:line */
  id: string;
  /** Test name/description */
  name: string;
  /** Parent describe/context block */
  parentBlock?: string | undefined;
  /** Full qualified name (describe > it) */
  qualifiedName: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Functions directly called by this test */
  directCalls: string[];
  /** Functions transitively reachable */
  transitiveCalls: string[];
  /** Assertions in this test */
  assertions: AssertionInfo[];
  /** Test quality signals */
  quality: TestQualitySignals;
}

/**
 * Information about an assertion
 */
export interface AssertionInfo {
  /** Assertion method (expect, assert, assertEquals, etc.) */
  matcher: string;
  /** Line number */
  line: number;
  /** Is this testing error cases? */
  isErrorAssertion: boolean;
  /** Is this testing edge cases? */
  isEdgeCaseAssertion: boolean;
}

/**
 * Test quality signals
 */
export interface TestQualitySignals {
  /** Number of assertions */
  assertionCount: number;
  /** Does it test error cases? */
  hasErrorCases: boolean;
  /** Does it test edge cases (null, empty, boundary)? */
  hasEdgeCases: boolean;
  /** Mock-to-real ratio (high = potentially brittle) */
  mockRatio: number;
  /** Lines of setup vs actual test */
  setupRatio: number;
  /** Overall quality score 0-100 */
  score: number;
}

// ============================================================================
// Mock Types
// ============================================================================

/**
 * A mock/stub/spy statement
 */
export interface MockStatement {
  /** What's being mocked (module path or function) */
  target: string;
  /** Mock type: jest.mock, sinon.stub, @patch, etc. */
  mockType: string;
  /** Line number */
  line: number;
  /** Is this mocking external deps (good) or internal code (suspicious)? */
  isExternal: boolean;
  /** The mock implementation if inline */
  hasImplementation?: boolean;
}

/**
 * Mock analysis for a test file or suite
 */
export interface MockAnalysis {
  /** Total mocks across all tests */
  totalMocks: number;
  /** Mocks of external dependencies */
  externalMocks: number;
  /** Mocks of internal code */
  internalMocks: number;
  /** Percentage external */
  externalPercent: number;
  /** Percentage internal */
  internalPercent: number;
  /** Average mock ratio across tests */
  avgMockRatio: number;
  /** Tests with high mock ratio (>0.7) */
  highMockRatioTests: Array<{ file: string; testName: string; mockRatio: number }>;
  /** Most commonly mocked modules */
  topMockedModules: Array<{ module: string; count: number }>;
}

// ============================================================================
// Coverage Types
// ============================================================================

/**
 * Test coverage for a source file
 */
export interface TestCoverage {
  /** Source file being covered */
  sourceFile: string;
  /** Tests that cover this file */
  tests: TestCoverageInfo[];
  /** Functions in this file */
  functions: FunctionCoverageInfo[];
  /** Overall coverage percentage */
  coveragePercent: number;
}

/**
 * Info about a test covering a file
 */
export interface TestCoverageInfo {
  /** Test file */
  testFile: string;
  /** Test name */
  testName: string;
  /** How the test reaches this code */
  reachType: ReachType;
  /** Call depth from test to this code */
  depth: number;
  /** Confidence this test actually exercises this code */
  confidence: number;
  /** Specific functions covered */
  coveredFunctions: string[];
}

/**
 * Coverage info for a function
 */
export interface FunctionCoverageInfo {
  /** Function ID */
  functionId: string;
  /** Function name */
  name: string;
  /** Line number */
  line: number;
  /** Is this function covered by any test? */
  isCovered: boolean;
  /** Tests that cover this function */
  coveringTests: string[];
  /** Is coverage via mock (not real execution)? */
  isMockedOnly: boolean;
}

/**
 * A function with no test coverage
 */
export interface UncoveredFunction {
  /** Function ID */
  functionId: string;
  /** Function name */
  name: string;
  /** Qualified name */
  qualifiedName: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Why it might be intentionally uncovered */
  possibleReasons: UncoveredReason[];
  /** Risk if this breaks (0-100) */
  riskScore: number;
  /** Is this an entry point? */
  isEntryPoint: boolean;
  /** Does it access sensitive data? */
  accessesSensitiveData: boolean;
}

export type UncoveredReason =
  | 'dead-code'
  | 'framework-hook'
  | 'generated'
  | 'trivial'
  | 'test-only'
  | 'deprecated';

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Result of extracting tests from a file
 */
export interface TestExtraction {
  /** File path */
  file: string;
  /** Detected framework */
  framework: TestFramework;
  /** Language */
  language: 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp';
  /** Extracted test cases */
  testCases: TestCase[];
  /** Mock statements */
  mocks: MockStatement[];
  /** Setup blocks (beforeEach, setUp, etc.) */
  setupBlocks: SetupBlock[];
  /** Fixtures (pytest fixtures, etc.) */
  fixtures?: FixtureInfo[] | undefined;
}

/**
 * A setup/teardown block
 */
export interface SetupBlock {
  /** Type: beforeEach, afterEach, beforeAll, etc. */
  type: 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll' | 'setUp' | 'tearDown';
  /** Line number */
  line: number;
  /** Functions called in setup */
  calls: string[];
}

/**
 * Fixture info (pytest, etc.)
 */
export interface FixtureInfo {
  /** Fixture name */
  name: string;
  /** Scope: function, class, module, session */
  scope: string;
  /** Line number */
  line: number;
  /** What it provides */
  provides?: string;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Minimum test set for changed files
 */
export interface MinimumTestSet {
  /** Tests to run */
  tests: Array<{
    file: string;
    name: string;
    reason: string;
  }>;
  /** Total tests in suite */
  totalTests: number;
  /** Tests selected */
  selectedTests: number;
  /** Estimated time saved */
  timeSaved: string;
  /** Coverage of changed code */
  changedCodeCoverage: number;
}

/**
 * Test topology summary
 */
export interface TestTopologySummary {
  /** Number of test files */
  testFiles: number;
  /** Number of test cases */
  testCases: number;
  /** Source files with coverage */
  coveredFiles: number;
  /** Total source files */
  totalFiles: number;
  /** Coverage percentage */
  coveragePercent: number;
  /** Functions with coverage */
  coveredFunctions: number;
  /** Total functions */
  totalFunctions: number;
  /** Function coverage percentage */
  functionCoveragePercent: number;
  /** Average mock ratio */
  avgMockRatio: number;
  /** Average test quality score */
  avgQualityScore: number;
  /** By framework */
  byFramework: Record<TestFramework, number>;
}

// ============================================================================
// Analyzer Options
// ============================================================================

/**
 * Options for test topology analysis
 */
export interface TestTopologyOptions {
  /** Root directory */
  rootDir: string;
  /** Test file patterns (glob) */
  testPatterns?: string[];
  /** Source file patterns (glob) */
  sourcePatterns?: string[];
  /** Directories to ignore */
  ignorePatterns?: string[];
  /** Include transitive coverage */
  includeTransitive?: boolean;
  /** Maximum depth for transitive analysis */
  maxDepth?: number;
}

/**
 * Options for uncovered function query
 */
export interface UncoveredOptions {
  /** Minimum risk level */
  minRisk?: 'low' | 'medium' | 'high';
  /** Maximum results */
  limit?: number;
  /** Include possible reasons */
  includeReasons?: boolean;
}
