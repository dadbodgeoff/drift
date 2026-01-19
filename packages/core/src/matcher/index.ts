/**
 * Matcher module exports
 *
 * Provides pattern matching, confidence scoring, and outlier detection.
 * This module is responsible for:
 * - Matching code against pattern definitions
 * - Calculating confidence scores based on frequency, consistency, age, and spread
 * - Detecting statistical outliers that deviate from established patterns
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */

// Export all types
export * from './types.js';

// Export type aliases for convenience
export type {
  // Location types
  Location,
  SourceRange,

  // Match types
  MatchType,
  ExtendedMatchType,

  // Confidence types
  ConfidenceLevel,
  ConfidenceScore,
  ConfidenceWeights,
  ConfidenceInput,

  // Pattern match types
  PatternMatch,
  PatternMatchResult,
  AggregatedMatchResult,

  // Pattern definition types
  PatternDefinition,
  ASTMatchConfig,
  RegexMatchConfig,
  StructuralMatchConfig,
  PatternMetadata,

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

  // Context types
  MatcherContext,
  MatchingResult,
  MatchingError,
} from './types.js';

// Export constants
export {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
} from './types.js';

// Export matcher components
export { PatternMatcher, type MatchOptions } from './pattern-matcher.js';
export {
  ConfidenceScorer,
  calculateConfidence,
  createConfidenceScore,
  type AgeNormalizationConfig,
  DEFAULT_AGE_CONFIG,
} from './confidence-scorer.js';
export {
  OutlierDetector,
  detectOutliers,
  calculateStatistics,
  type OutlierDetectorConfig,
  type DataPoint,
  type OutlierRule,
  DEFAULT_OUTLIER_CONFIG,
} from './outlier-detector.js';
