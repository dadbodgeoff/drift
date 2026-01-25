/**
 * Constants Integration Module
 *
 * Adapters for integrating constant extraction with the scanner,
 * call graph, and pattern detection systems.
 */

// Scanner Adapter
export {
  ConstantScannerAdapter,
  createConstantScanner,
  getConstantLanguage,
  hashContent,
  processConstantTask,
  createDefaultConstantQuality,
  type ConstantScannerConfig,
  type ConstantScanResult,
  type ConstantBatchScanResult,
  type ConstantWorkerTask,
  type ConstantWorkerResult,
} from './scanner-adapter.js';

// Call Graph Adapter
export {
  ConstantCallGraphAdapter,
  createCallGraphAdapter,
  type CallGraphAdapterConfig,
  type CallGraphInterface,
  type ConstantWithContext,
  type ConstantImpactAnalysis,
  type FunctionUsage,
  type DataFlowPath,
  type AffectedFunction,
} from './callgraph-adapter.js';

// Pattern Adapter
export {
  ConstantPatternAdapter,
  createPatternAdapter,
  severityToNumber,
  compareSeverity,
  type PatternAdapterConfig,
  type ConstantPattern,
  type ConstantPatternCategory,
  type ConstantPatternResult,
  type PatternLocation,
  type ManifestPattern,
} from './pattern-adapter.js';
