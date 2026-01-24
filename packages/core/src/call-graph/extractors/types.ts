/**
 * Extraction Types
 *
 * Types for the enterprise-grade extraction system with fallback support.
 */

// ============================================================================
// Extraction Quality Types
// ============================================================================

/**
 * Method used for extraction
 */
export type ExtractionMethod = 'tree-sitter' | 'regex' | 'heuristic' | 'hybrid';

/**
 * Quality metrics for an extraction operation
 */
export interface ExtractionQuality {
  /** Overall confidence (0-1) */
  confidence: number;

  /** Primary extraction method used */
  method: ExtractionMethod;

  /** Percentage of file successfully parsed (0-100) */
  coveragePercent: number;

  /** Number of items extracted */
  itemsExtracted: number;

  /** Number of parse errors encountered */
  parseErrors: number;

  /** Warnings (non-fatal issues) */
  warnings: string[];

  /** Whether fallback was used */
  usedFallback: boolean;

  /** Time taken in ms */
  extractionTimeMs: number;

  /** Breakdown by extraction tier */
  tierBreakdown?: {
    treeSitter: number;
    regex: number;
    heuristic: number;
  };
}

/**
 * Confidence levels for extraction
 */
export const EXTRACTION_CONFIDENCE = {
  /** Tree-sitter AST parsing */
  TREE_SITTER: 0.95,
  /** Regex pattern matching */
  REGEX: 0.75,
  /** Heuristic line scanning */
  HEURISTIC: 0.50,
  /** Unknown/failed */
  UNKNOWN: 0.25,
} as const;

/**
 * Create default extraction quality
 */
export function createDefaultQuality(): ExtractionQuality {
  return {
    confidence: 0,
    method: 'tree-sitter',
    coveragePercent: 0,
    itemsExtracted: 0,
    parseErrors: 0,
    warnings: [],
    usedFallback: false,
    extractionTimeMs: 0,
  };
}

/**
 * Merge two extraction qualities (for hybrid extraction)
 */
export function mergeQualities(
  primary: ExtractionQuality,
  fallback: ExtractionQuality
): ExtractionQuality {
  const totalItems = primary.itemsExtracted + fallback.itemsExtracted;
  const primaryWeight = totalItems > 0 ? primary.itemsExtracted / totalItems : 0.5;
  const fallbackWeight = 1 - primaryWeight;

  return {
    confidence: primary.confidence * primaryWeight + fallback.confidence * fallbackWeight,
    method: 'hybrid',
    coveragePercent: Math.max(primary.coveragePercent, fallback.coveragePercent),
    itemsExtracted: totalItems,
    parseErrors: primary.parseErrors + fallback.parseErrors,
    warnings: [...primary.warnings, ...fallback.warnings],
    usedFallback: true,
    extractionTimeMs: primary.extractionTimeMs + fallback.extractionTimeMs,
    tierBreakdown: {
      treeSitter: primary.method === 'tree-sitter' ? primary.itemsExtracted : 0,
      regex: fallback.method === 'regex' ? fallback.itemsExtracted : 0,
      heuristic: 0,
    },
  };
}

// ============================================================================
// Regex Pattern Types
// ============================================================================

/**
 * A regex pattern with metadata
 */
export interface RegexPattern {
  /** Pattern name for debugging */
  name: string;
  /** The regex pattern */
  pattern: RegExp;
  /** What this pattern extracts */
  extracts: 'function' | 'class' | 'import' | 'export' | 'call' | 'method';
  /** Confidence for matches from this pattern */
  confidence: number;
  /** Optional post-processor for matches */
  postProcess?: (match: RegExpExecArray, source: string) => unknown;
}

/**
 * Collection of regex patterns for a language
 */
export interface LanguagePatterns {
  /** Language identifier */
  language: string;
  /** Function/method patterns */
  functions: RegexPattern[];
  /** Class/interface patterns */
  classes: RegexPattern[];
  /** Import patterns */
  imports: RegexPattern[];
  /** Export patterns */
  exports: RegexPattern[];
  /** Call patterns */
  calls: RegexPattern[];
}

// ============================================================================
// Extractor Configuration
// ============================================================================

/**
 * Configuration for hybrid extractors
 */
export interface HybridExtractorConfig {
  /** Enable tree-sitter (default: true) */
  enableTreeSitter?: boolean;
  /** Enable regex fallback (default: true) */
  enableRegexFallback?: boolean;
  /** Enable heuristic fallback (default: true) */
  enableHeuristicFallback?: boolean;
  /** Minimum confidence to accept results (default: 0.5) */
  minConfidence?: number;
  /** Timeout for tree-sitter parsing in ms (default: 5000) */
  treeSitterTimeout?: number;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Default hybrid extractor configuration
 */
export const DEFAULT_HYBRID_CONFIG: Required<HybridExtractorConfig> = {
  enableTreeSitter: true,
  enableRegexFallback: true,
  enableHeuristicFallback: true,
  minConfidence: 0.5,
  treeSitterTimeout: 5000,
  verbose: false,
};
