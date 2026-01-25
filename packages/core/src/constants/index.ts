/**
 * Constants Module
 *
 * Comprehensive tracking of constants, enums, and exported values
 * across all supported languages.
 */

// Types
export * from './types.js';

// Store
export { ConstantStore, type ConstantStoreConfig } from './store/constant-store.js';

// Analysis
export {
  inferCategory,
  getCategoryDisplayName,
  getCategoryDescription,
  isSecuritySensitive,
  suggestConstantName,
} from './analysis/categorizer.js';

export {
  ConstantReferenceFinder,
  findAllReferences,
  DEFAULT_REFERENCE_FIND_CONFIG,
  type ReferenceFindConfig,
  type ReferenceResult,
} from './analysis/reference-finder.js';

export {
  MagicValueDetector,
  DEFAULT_MAGIC_DETECTOR_CONFIG,
  type MagicDetectorConfig,
  type MagicDetectionResult,
} from './analysis/magic-detector.js';

export {
  DeadConstantDetector,
  isLikelyDead,
  DEFAULT_DEAD_CONSTANT_CONFIG,
  type DeadConstantConfig,
  type DeadConstantResult,
} from './analysis/dead-constant-detector.js';

export {
  ConsistencyAnalyzer,
  hasPotentialInconsistency,
  DEFAULT_CONSISTENCY_CONFIG,
  type ConsistencyConfig,
  type ConsistencyResult,
} from './analysis/consistency-analyzer.js';

export {
  ConstantSecurityScanner,
  DEFAULT_SECURITY_SCAN_CONFIG,
  type SecurityScanConfig,
  type SecretPattern,
  type SecurityScanResult,
} from './analysis/security-scanner.js';

// Extractors - Base
export { BaseConstantExtractor } from './extractors/base-extractor.js';
export { BaseConstantRegexExtractor } from './extractors/regex/base-regex.js';

// Extractors - Language-specific regex
export { TypeScriptConstantRegexExtractor } from './extractors/regex/typescript-regex.js';
export { PythonConstantRegexExtractor } from './extractors/regex/python-regex.js';
export { JavaConstantRegexExtractor } from './extractors/regex/java-regex.js';
export { CSharpConstantRegexExtractor } from './extractors/regex/csharp-regex.js';
export { PhpConstantRegexExtractor } from './extractors/regex/php-regex.js';
export { GoConstantRegexExtractor } from './extractors/regex/go-regex.js';

// Integration
export {
  // Scanner Adapter
  ConstantScannerAdapter,
  createConstantScanner,
  getConstantLanguage,
  hashContent,
  processConstantTask,
  createDefaultConstantQuality,
  // Call Graph Adapter
  ConstantCallGraphAdapter,
  createCallGraphAdapter,
  // Pattern Adapter
  ConstantPatternAdapter,
  createPatternAdapter,
  severityToNumber,
  compareSeverity,
} from './integration/index.js';

export type {
  // Scanner types
  ConstantScannerConfig,
  ConstantScanResult,
  ConstantBatchScanResult,
  ConstantWorkerTask,
  ConstantWorkerResult,
  // Call graph types
  CallGraphAdapterConfig,
  CallGraphInterface,
  ConstantWithContext,
  ConstantImpactAnalysis,
  FunctionUsage,
  DataFlowPath,
  AffectedFunction,
  // Pattern types
  PatternAdapterConfig,
  ConstantPattern,
  ConstantPatternCategory,
  ConstantPatternResult,
  PatternLocation,
  ManifestPattern,
} from './integration/index.js';

// Re-export commonly used types for convenience
export type {
  ConstantExtraction,
  EnumExtraction,
  EnumMember,
  ConstantReference,
  FileConstantResult,
  ConstantExtractionQuality,
  ConstantFileShard,
  ConstantIndex,
  ConstantStats,
  ConstantLanguage,
  ConstantKind,
  ConstantCategory,
  IssueSeverity,
  MagicValue,
  PotentialSecret,
  DeadConstant,
  InconsistentConstant,
} from './types.js';
