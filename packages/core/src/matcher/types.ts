/**
 * Matcher type definitions
 *
 * Provides types for pattern matching, confidence scoring, and outlier detection.
 * These types support the pattern matching engine that identifies code patterns
 * and calculates confidence scores based on frequency, consistency, age, and spread.
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */

import type { AST, ASTNode, Position } from '../parsers/types.js';

// ============================================================================
// Location Types
// ============================================================================

/**
 * Location in source code for pattern matches
 */
export interface Location {
  /** File path (relative to project root) */
  file: string;

  /** Line number (1-indexed) */
  line: number;

  /** Column number (1-indexed) */
  column: number;

  /** End line number (1-indexed) */
  endLine?: number;

  /** End column number (1-indexed) */
  endColumn?: number;
}

/**
 * Range in source code with start and end positions
 */
export interface SourceRange {
  /** Start position */
  start: Position;

  /** End position */
  end: Position;
}

// ============================================================================
// Match Type Definitions
// ============================================================================

/**
 * Types of pattern matching methods supported by the matcher
 *
 * @requirements 5.1 - Pattern matching supports multiple detection methods
 */
export type MatchType = 'ast' | 'regex' | 'structural';

/**
 * Extended match type including semantic and custom matching
 */
export type ExtendedMatchType = MatchType | 'semantic' | 'custom';

// ============================================================================
// Confidence Level Types
// ============================================================================

/**
 * Confidence level classification based on score thresholds
 *
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

/**
 * Confidence level thresholds
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Threshold for high confidence (>= 0.85) */
  HIGH: 0.85,
  /** Threshold for medium confidence (>= 0.70) */
  MEDIUM: 0.70,
  /** Threshold for low confidence (>= 0.50) */
  LOW: 0.50,
} as const;

// ============================================================================
// Confidence Score Types
// ============================================================================

/**
 * Confidence score with component factors
 *
 * The confidence score is calculated from multiple factors:
 * - frequency: How often the pattern appears relative to applicable locations
 * - consistency: How consistent the pattern implementation is across occurrences
 * - age: How long the pattern has been observed (in days)
 * - spread: How many files contain the pattern
 *
 * @requirements 5.1 - Pattern confidence scoring with frequency, consistency, age, spread factors
 * @requirements 5.2 - Confidence score SHALL be a decimal value between 0.0 and 1.0
 */
export interface ConfidenceScore {
  /**
   * Frequency score (0.0 to 1.0)
   * Percentage of applicable locations where the pattern is found
   */
  frequency: number;

  /**
   * Consistency score (0.0 to 1.0)
   * Measure of variance in pattern implementation
   */
  consistency: number;

  /**
   * Age in days since pattern was first observed
   */
  age: number;

  /**
   * Spread count - number of files containing the pattern
   */
  spread: number;

  /**
   * Weighted overall score (0.0 to 1.0)
   * Combined score from all factors
   */
  score: number;

  /**
   * Confidence level classification
   * @requirements 5.3, 5.4, 5.5, 5.6
   */
  level: ConfidenceLevel;
}

/**
 * Weights for confidence score calculation
 */
export interface ConfidenceWeights {
  /** Weight for frequency factor (default: 0.4) */
  frequency: number;

  /** Weight for consistency factor (default: 0.3) */
  consistency: number;

  /** Weight for age factor (default: 0.15) */
  age: number;

  /** Weight for spread factor (default: 0.15) */
  spread: number;
}

/**
 * Default weights for confidence calculation
 */
export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  frequency: 0.4,
  consistency: 0.3,
  age: 0.15,
  spread: 0.15,
};

/**
 * Input data for confidence score calculation
 */
export interface ConfidenceInput {
  /** Number of pattern occurrences */
  occurrences: number;

  /** Total applicable locations */
  totalLocations: number;

  /** Variance in pattern implementation (0 = perfectly consistent) */
  variance: number;

  /** Days since first observation */
  daysSinceFirstSeen: number;

  /** Number of files containing the pattern */
  fileCount: number;

  /** Total files in scope */
  totalFiles: number;
}

// ============================================================================
// Pattern Match Types
// ============================================================================

/**
 * Basic pattern match result
 *
 * @requirements 5.1 - Pattern matching with confidence scoring
 */
export interface PatternMatch {
  /** ID of the matched pattern */
  patternId: string;

  /** Location of the match in source code */
  location: Location;

  /** Confidence score for this specific match (0.0 to 1.0) */
  confidence: number;

  /** Whether this match is an outlier (deviates from pattern) */
  isOutlier: boolean;
}

/**
 * Extended pattern match result with additional metadata
 *
 * @requirements 5.1 - Pattern matching with detailed results
 */
export interface PatternMatchResult extends PatternMatch {
  /** Type of matching method used */
  matchType: MatchType;

  /** AST node that matched (for AST-based matching) */
  matchedNode?: ASTNode;

  /** Matched text content */
  matchedText?: string;

  /** Captured groups (for regex matching) */
  captures?: Record<string, string>;

  /** Reason for outlier classification (if isOutlier is true) */
  outlierReason?: string;

  /** Similarity score to the canonical pattern (0.0 to 1.0) */
  similarity?: number;

  /** Additional match metadata */
  metadata?: Record<string, unknown>;

  /** Timestamp of when the match was found */
  timestamp: Date;
}

/**
 * Aggregated match results for a pattern across multiple files
 */
export interface AggregatedMatchResult {
  /** Pattern ID */
  patternId: string;

  /** All matches found */
  matches: PatternMatchResult[];

  /** Overall confidence score for the pattern */
  confidence: ConfidenceScore;

  /** Total number of matches */
  matchCount: number;

  /** Number of outliers */
  outlierCount: number;

  /** Files containing matches */
  files: string[];
}

// ============================================================================
// Pattern Definition Types
// ============================================================================

/**
 * Definition of a pattern to match against code
 *
 * @requirements 5.1 - Pattern definitions for matching
 */
export interface PatternDefinition {
  /** Unique pattern identifier */
  id: string;

  /** Human-readable pattern name */
  name: string;

  /** Pattern description */
  description: string;

  /** Category of the pattern */
  category: string;

  /** Subcategory for more specific classification */
  subcategory?: string;

  /** Type of matching to use */
  matchType: ExtendedMatchType;

  /** AST matching configuration */
  astConfig?: ASTMatchConfig;

  /** Regex matching configuration */
  regexConfig?: RegexMatchConfig;

  /** Structural matching configuration */
  structuralConfig?: StructuralMatchConfig;

  /** Languages this pattern applies to */
  languages?: string[];

  /** File patterns to include (glob patterns) */
  includePatterns?: string[];

  /** File patterns to exclude (glob patterns) */
  excludePatterns?: string[];

  /** Whether the pattern is enabled */
  enabled: boolean;

  /** Pattern metadata */
  metadata?: PatternMetadata;
}

/**
 * Configuration for AST-based pattern matching
 */
export interface ASTMatchConfig {
  /** AST node type to match */
  nodeType: string;

  /** Query to run against the AST (tree-sitter query syntax) */
  query?: string;

  /** Properties to match on the node */
  properties?: Record<string, unknown>;

  /** Child node patterns to match */
  children?: ASTMatchConfig[];

  /** Whether to match descendants (not just direct children) */
  matchDescendants?: boolean;

  /** Minimum depth in AST tree */
  minDepth?: number;

  /** Maximum depth in AST tree */
  maxDepth?: number;
}

/**
 * Configuration for regex-based pattern matching
 */
export interface RegexMatchConfig {
  /** Regular expression pattern */
  pattern: string;

  /** Regex flags (e.g., 'gi' for global, case-insensitive) */
  flags?: string;

  /** Named capture groups to extract */
  captureGroups?: string[];

  /** Whether to match across multiple lines */
  multiline?: boolean;

  /** Context lines to include around match */
  contextLines?: number;
}

/**
 * Configuration for structural pattern matching
 */
export interface StructuralMatchConfig {
  /** File path pattern (glob) */
  pathPattern?: string;

  /** Directory structure pattern */
  directoryPattern?: string;

  /** File naming convention pattern */
  namingPattern?: string;

  /** Required sibling files */
  requiredSiblings?: string[];

  /** Required parent directory structure */
  parentStructure?: string[];

  /** File extension to match */
  extension?: string;
}

/**
 * Pattern metadata for tracking and management
 */
export interface PatternMetadata {
  /** When the pattern was first observed */
  firstSeen?: Date;

  /** When the pattern was last seen */
  lastSeen?: Date;

  /** Who created/approved the pattern */
  author?: string;

  /** Version of the pattern definition */
  version?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Related pattern IDs */
  relatedPatterns?: string[];

  /** Custom metadata fields */
  custom?: Record<string, unknown>;
}

// ============================================================================
// Outlier Detection Types
// ============================================================================

/**
 * Information about a detected outlier
 *
 * @requirements 5.7 - Outlier detection for code that deviates from patterns
 */
export interface OutlierInfo {
  /** Location of the outlier */
  location: Location;

  /** Pattern ID this outlier deviates from */
  patternId: string;

  /** Reason for outlier classification */
  reason: string;

  /** Deviation score (how far from the pattern norm, 0.0 to 1.0) */
  deviationScore: number;

  /** Type of deviation */
  deviationType: OutlierType;

  /** Expected value/structure based on pattern */
  expected?: string;

  /** Actual value/structure found */
  actual?: string;

  /** Suggested fix for the outlier */
  suggestedFix?: string;

  /** Statistical significance of the deviation */
  significance: OutlierSignificance;

  /** Additional context about the outlier */
  context?: OutlierContext;
}

/**
 * Types of outlier deviations
 *
 * @requirements 5.7 - Outlier detection categories
 */
export type OutlierType =
  | 'structural'    // Structural deviation (file organization, naming)
  | 'syntactic'     // Syntactic deviation (code structure)
  | 'semantic'      // Semantic deviation (meaning/behavior)
  | 'stylistic'     // Stylistic deviation (formatting, conventions)
  | 'missing'       // Missing expected element
  | 'extra'         // Extra unexpected element
  | 'inconsistent'; // Inconsistent with other occurrences

/**
 * Statistical significance of an outlier
 */
export type OutlierSignificance = 'high' | 'medium' | 'low';

/**
 * Additional context for outlier analysis
 */
export interface OutlierContext {
  /** Nearby pattern matches for comparison */
  nearbyMatches?: PatternMatch[];

  /** Statistical metrics about the deviation */
  statistics?: OutlierStatistics;

  /** AST context around the outlier */
  astContext?: ASTNode;

  /** Code snippet showing the outlier */
  codeSnippet?: string;
}

/**
 * Statistical metrics for outlier analysis
 */
export interface OutlierStatistics {
  /** Mean value for the pattern metric */
  mean: number;

  /** Standard deviation */
  standardDeviation: number;

  /** Z-score of this outlier */
  zScore: number;

  /** Percentile rank */
  percentile: number;

  /** Sample size used for statistics */
  sampleSize: number;
}

/**
 * Result of outlier detection for a file or pattern
 */
export interface OutlierDetectionResult {
  /** Pattern ID analyzed */
  patternId: string;

  /** File analyzed (if file-specific) */
  file?: string;

  /** Detected outliers */
  outliers: OutlierInfo[];

  /** Total items analyzed */
  totalAnalyzed: number;

  /** Outlier rate (outliers / total) */
  outlierRate: number;

  /** Detection timestamp */
  timestamp: Date;

  /** Detection method used */
  method: OutlierDetectionMethod;
}

/**
 * Methods for outlier detection
 */
export type OutlierDetectionMethod =
  | 'statistical'   // Statistical analysis (z-score, IQR)
  | 'clustering'    // Clustering-based detection
  | 'rule-based'    // Rule-based detection
  | 'ml-based';     // Machine learning-based detection

// ============================================================================
// Matcher Configuration Types
// ============================================================================

/**
 * Configuration options for the pattern matcher
 */
export interface MatcherConfig {
  /** Confidence weights for score calculation */
  confidenceWeights?: Partial<ConfidenceWeights>;

  /** Minimum confidence threshold for matches */
  minConfidence?: number;

  /** Whether to detect outliers */
  detectOutliers?: boolean;

  /** Outlier detection sensitivity (0.0 to 1.0) */
  outlierSensitivity?: number;

  /** Maximum matches to return per pattern */
  maxMatchesPerPattern?: number;

  /** Whether to include AST nodes in results */
  includeAstNodes?: boolean;

  /** Whether to include matched text in results */
  includeMatchedText?: boolean;

  /** Timeout for matching operations (ms) */
  timeout?: number;

  /** Cache configuration */
  cache?: MatcherCacheConfig;
}

/**
 * Cache configuration for the matcher
 */
export interface MatcherCacheConfig {
  /** Whether caching is enabled */
  enabled: boolean;

  /** Maximum cache size (number of entries) */
  maxSize?: number;

  /** Cache TTL in milliseconds */
  ttl?: number;
}

// ============================================================================
// Matcher Context Types
// ============================================================================

/**
 * Context provided to the matcher for pattern matching
 */
export interface MatcherContext {
  /** File being matched */
  file: string;

  /** File content */
  content: string;

  /** Parsed AST (null if parsing failed) */
  ast: AST | null;

  /** Language of the file */
  language: string;

  /** Project root directory */
  projectRoot: string;

  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a matching operation
 */
export interface MatchingResult {
  /** File that was matched */
  file: string;

  /** Pattern matches found */
  matches: PatternMatchResult[];

  /** Outliers detected */
  outliers: OutlierInfo[];

  /** Matching duration in milliseconds */
  duration: number;

  /** Whether matching completed successfully */
  success: boolean;

  /** Errors encountered during matching */
  errors: MatchingError[];
}

/**
 * Error encountered during matching
 */
export interface MatchingError {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;

  /** Pattern ID that caused the error */
  patternId?: string;

  /** Whether matching can continue */
  recoverable: boolean;
}
