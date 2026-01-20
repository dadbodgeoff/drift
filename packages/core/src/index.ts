/**
 * @drift/core - Core pattern detection and analysis engine
 *
 * This package provides the foundational components for Drift:
 * - Scanner: File system analysis and dependency graph
 * - Parsers: Multi-language AST parsing via Tree-sitter
 * - Analyzers: AST, type, semantic, and flow analysis
 * - Matcher: Pattern matching and confidence scoring
 * - Store: Pattern persistence and history tracking
 * - Rules: Violation evaluation and quick fix generation
 * - Config: Configuration loading and validation
 */

// Export version
export const VERSION = '0.0.1';

// Type exports (main public API)
export * from './types/index.js';

// Scanner exports
export * from './scanner/index.js';

// Parser exports (selective to avoid Position conflict)
export type {
  Language,
  AST,
  ASTNode,
  ParseResult,
  ParseError,
  Position as ParserPosition,
} from './parsers/types.js';
export { BaseParser } from './parsers/base-parser.js';
export { ParserManager } from './parsers/parser-manager.js';
export { TypeScriptParser } from './parsers/typescript-parser.js';
export { PythonParser } from './parsers/python-parser.js';
export { CSSParser } from './parsers/css-parser.js';
export { JSONParser } from './parsers/json-parser.js';
export { MarkdownParser } from './parsers/markdown-parser.js';

// Analyzer exports
export * from './analyzers/index.js';

// Matcher exports (selective to avoid conflicts with other modules)
export type {
  // Core match types
  PatternMatch,
  PatternMatchResult,
  AggregatedMatchResult,
  Location as MatchLocation,
  SourceRange,

  // Match type enums
  MatchType,
  ExtendedMatchType,

  // Confidence types
  ConfidenceLevel,
  ConfidenceScore,
  ConfidenceWeights,
  ConfidenceInput,

  // Pattern definition types
  PatternDefinition,
  ASTMatchConfig,
  RegexMatchConfig,
  StructuralMatchConfig,
  PatternMetadata as MatcherPatternMetadata,

  // Outlier types
  OutlierInfo,
  OutlierType,
  OutlierSignificance,
  OutlierContext,
  OutlierStatistics,
  OutlierDetectionResult,
  OutlierDetectionMethod,

  // Configuration types
  MatcherConfig,
  MatcherCacheConfig,
  MatcherContext,
  MatchingResult,
  MatchingError,
} from './matcher/types.js';

// Matcher constants
export {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
} from './matcher/types.js';

// Store exports (selective to avoid conflicts)
export type { PatternFile, StoredPattern, DetectorConfig, ConfidenceInfo, PatternLocation, OutlierLocation, PatternStoreConfig, PatternCategory, PatternStatus, Pattern, VariantScope, PatternVariant } from './store/types.js';
export { CacheManager } from './store/cache-manager.js';
export type { CacheManagerOptions, CacheEntry, CacheStats } from './store/cache-manager.js';
export { PatternStore, PatternNotFoundError, InvalidStateTransitionError, PatternStoreError } from './store/pattern-store.js';

// Contract exports (BE↔FE mismatch detection)
export * from './types/contracts.js';
export { ContractStore, ContractNotFoundError, InvalidContractTransitionError, ContractStoreError } from './store/contract-store.js';
export type { ContractStoreConfig, ContractStoreEvent, ContractStoreEventType } from './store/contract-store.js';

// Rules exports (selective to avoid conflicts)
export type { Position as RulePosition, Violation, QuickFix, Range, Severity, ViolationInput, RuleEvaluationResult, RuleEvaluationSummary, RuleEvaluationError } from './rules/types.js';
export { Evaluator, createEvaluator, createEvaluatorWithConfig, createEvaluatorWithAI, type EvaluatorConfig, type EvaluationInput, type EvaluationResult, type EvaluationSummary } from './rules/evaluator.js';
export { RuleEngine, createRuleEngine, createRuleEngineWithConfig, createRuleEngineWithAI, type RuleEngineConfig, type RuleEvaluationInput, type PatternWithContext } from './rules/rule-engine.js';
export { VariantManager, VariantNotFoundError, VariantManagerError, InvalidVariantInputError, type CreateVariantInput, type UpdateVariantInput, type VariantQuery, type VariantManagerEvent, type VariantManagerEventType, type VariantManagerConfig } from './rules/variant-manager.js';

// Config exports
export * from './config/index.js';

// Manifest exports (pattern location discovery)
export * from './manifest/index.js';

// Learning exports (pattern learning system)
export * from './learning/index.js';
