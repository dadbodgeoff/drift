/**
 * Analyzer module exports
 *
 * Provides AST, type, semantic, and flow analysis capabilities
 * with a unified interface across all supported languages.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

// Export all analyzer types
export * from './types.js';

// Export analyzer implementations
export { ASTAnalyzer } from './ast-analyzer.js';
export type {
  ASTPattern,
  PatternMatchOptions,
  PatternMatchResult,
  SubtreeCompareOptions,
  SubtreeCompareResult,
  SubtreeDifference,
  ASTVisitorFn,
} from './ast-analyzer.js';

// Export TypeAnalyzer
export { TypeAnalyzer } from './type-analyzer.js';
export type {
  TypeExtractionOptions,
  TypeAnalysisOptions,
  TypeRelationship,
  TypeRelationshipKind,
  TypeCoverageInfo,
} from './type-analyzer.js';

// Export SemanticAnalyzer
export { SemanticAnalyzer } from './semantic-analyzer.js';
export type { SemanticAnalysisOptions } from './semantic-analyzer.js';

// Export FlowAnalyzer
export { FlowAnalyzer } from './flow-analyzer.js';
export type { FlowAnalysisOptions } from './flow-analyzer.js';
