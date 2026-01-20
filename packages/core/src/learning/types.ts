/**
 * Learned Patterns Type System
 * 
 * Types for pattern learning - detectors learn from the user's codebase
 * rather than enforcing hardcoded conventions.
 * 
 * @requirements DRIFT-CORE - Detectors learn patterns from user's code, not enforce arbitrary rules
 */

// ============================================================================
// Core Learning Types
// ============================================================================

/**
 * A convention learned from analyzing the codebase
 */
export interface LearnedConvention<T = unknown> {
  /** The learned value/pattern */
  value: T;
  
  /** Number of occurrences found */
  occurrences: number;
  
  /** Files where this convention was found */
  files: string[];
  
  /** First line where this was seen (for reference) */
  firstSeenAt?: {
    file: string;
    line: number;
  };
  
  /** Confidence that this is the dominant convention (0-1) */
  confidence: number;
}

/**
 * Result of learning conventions from a codebase
 */
export interface LearnedConventions<T extends Record<string, unknown> = Record<string, unknown>> {
  /** The learned conventions by key */
  conventions: {
    [K in keyof T]: LearnedConvention<T[K]>;
  };
  
  /** Total files analyzed */
  filesAnalyzed: number;
  
  /** Files that matched the detector's scope */
  relevantFiles: number;
  
  /** When the learning was performed */
  learnedAt: string;
  
  /** Whether enough data was found to establish conventions */
  hasEnoughData: boolean;
  
  /** Minimum occurrences needed to establish a convention */
  minOccurrencesRequired: number;
}

/**
 * Statistics about a learned value distribution
 */
export interface ValueDistribution<T = unknown> {
  /** All values found with their counts */
  values: Map<T, number>;
  
  /** The dominant value (most common) */
  dominant: T | null;
  
  /** Percentage of occurrences that use the dominant value */
  dominantPercentage: number;
  
  /** Total occurrences across all values */
  totalOccurrences: number;
  
  /** Number of unique values found */
  uniqueValues: number;
}

// ============================================================================
// Learning Configuration
// ============================================================================

/**
 * Configuration for the learning process
 */
export interface PatternLearningConfig {
  /** Minimum occurrences to consider a pattern established */
  minOccurrences: number;
  
  /** Minimum percentage to consider a value "dominant" (0-1) */
  dominanceThreshold: number;
  
  /** Minimum files that must contain the pattern */
  minFiles: number;
  
  /** Maximum files to analyze (for performance) */
  maxFilesToAnalyze: number;
  
  /** File patterns to include */
  includePatterns: string[];
  
  /** File patterns to exclude */
  excludePatterns: string[];
}

/**
 * Default learning configuration
 */
export const DEFAULT_PATTERN_LEARNING_CONFIG: PatternLearningConfig = {
  minOccurrences: 3,
  dominanceThreshold: 0.6, // 60% must use the same convention
  minFiles: 2,
  maxFilesToAnalyze: 1000,
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/__tests__/**',
  ],
};

// ============================================================================
// Learning Results Storage
// ============================================================================

/**
 * Stored learned patterns for a detector
 */
export interface StoredLearnedPatterns {
  /** Detector ID */
  detectorId: string;
  
  /** Version of the learning algorithm */
  version: string;
  
  /** The learned conventions (serializable) */
  conventions: Record<string, SerializedConvention>;
  
  /** Learning metadata */
  metadata: {
    filesAnalyzed: number;
    relevantFiles: number;
    learnedAt: string;
    hasEnoughData: boolean;
    configUsed: PatternLearningConfig;
  };
}

/**
 * Serialized convention for JSON storage
 */
export interface SerializedConvention {
  value: unknown;
  occurrences: number;
  files: string[];
  firstSeenAt?: {
    file: string;
    line: number;
  };
  confidence: number;
}

// ============================================================================
// Learning Events
// ============================================================================

/**
 * Events emitted during learning
 */
export type LearningEventType =
  | 'learning:started'
  | 'learning:file-analyzed'
  | 'learning:completed'
  | 'learning:failed'
  | 'learning:convention-found'
  | 'learning:no-data';

/**
 * Learning event payload
 */
export interface LearningEvent {
  type: LearningEventType;
  detectorId: string;
  timestamp: string;
  data?: {
    file?: string;
    conventionKey?: string;
    conventionValue?: unknown;
    filesAnalyzed?: number;
    error?: string;
  };
}

// ============================================================================
// Specific Convention Types (for common patterns)
// ============================================================================

/**
 * Naming convention types
 */
export type NamingConvention = 
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'kebab-case'
  | 'SCREAMING_SNAKE_CASE'
  | 'lowercase'
  | 'mixed';

/**
 * Learned naming conventions
 */
export interface LearnedNamingConventions {
  /** File naming convention */
  fileNaming?: NamingConvention;
  
  /** Function naming convention */
  functionNaming?: NamingConvention;
  
  /** Variable naming convention */
  variableNaming?: NamingConvention;
  
  /** Class naming convention */
  classNaming?: NamingConvention;
  
  /** Constant naming convention */
  constantNaming?: NamingConvention;
  
  /** Component naming convention */
  componentNaming?: NamingConvention;
}

/**
 * Learned string patterns (for things like error codes, route prefixes, etc.)
 */
export interface LearnedStringPatterns {
  /** Common prefixes found */
  prefixes: string[];
  
  /** Common suffixes found */
  suffixes: string[];
  
  /** Regex pattern that matches the learned format */
  pattern?: string;
  
  /** Example values */
  examples: string[];
}

/**
 * Learned structural patterns
 */
export interface LearnedStructuralPatterns {
  /** Directory structure patterns */
  directories: string[];
  
  /** Co-location patterns (what files are typically together) */
  coLocatedFiles: string[][];
  
  /** Import patterns */
  importPatterns: string[];
}
