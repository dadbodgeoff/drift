/**
 * Test Topology Module
 *
 * Provides test-to-code mapping, mock analysis, and test quality metrics.
 */

// Types
export type {
  TestFramework,
  ReachType,
  TestCase,
  AssertionInfo,
  TestQualitySignals,
  MockStatement,
  MockAnalysis,
  TestCoverage,
  TestCoverageInfo,
  FunctionCoverageInfo,
  UncoveredFunction,
  UncoveredReason,
  TestExtraction,
  SetupBlock,
  FixtureInfo,
  MinimumTestSet,
  TestTopologySummary,
  TestTopologyOptions,
  UncoveredOptions,
} from './types.js';

// Analyzer
export {
  TestTopologyAnalyzer,
  createTestTopologyAnalyzer,
  type TestTopologyResult,
} from './test-topology-analyzer.js';

// Hybrid Analyzer (with regex fallback)
export {
  HybridTestTopologyAnalyzer,
  createHybridTestTopologyAnalyzer,
  type HybridTestTopologyResult,
} from './hybrid-test-topology-analyzer.js';

// Extractors
export { BaseTestExtractor } from './extractors/base-test-extractor.js';
export { TypeScriptTestExtractor, createTypeScriptTestExtractor } from './extractors/typescript-test-extractor.js';
export { PythonTestExtractor, createPythonTestExtractor } from './extractors/python-test-extractor.js';
export { JavaTestExtractor, createJavaTestExtractor } from './extractors/java-test-extractor.js';
export { CSharpTestExtractor, createCSharpTestExtractor } from './extractors/csharp-test-extractor.js';
export { PHPTestExtractor, createPHPTestExtractor } from './extractors/php-test-extractor.js';

// Regex Fallback Extractors
export {
  TypeScriptTestRegexExtractor,
  createTypeScriptTestRegexExtractor,
  PythonTestRegexExtractor,
  createPythonTestRegexExtractor,
  JavaTestRegexExtractor,
  createJavaTestRegexExtractor,
  CSharpTestRegexExtractor,
  createCSharpTestRegexExtractor,
  PHPTestRegexExtractor,
  createPHPTestRegexExtractor,
  getTestRegexExtractor,
} from './extractors/regex/index.js';
