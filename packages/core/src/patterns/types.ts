/**
 * Unified Pattern Types
 *
 * This module defines the unified data model for patterns across the entire
 * Drift system. It consolidates the previously separate Pattern (from PatternStore)
 * and PatternShardEntry (from PatternShardStore) types into a single source of truth.
 *
 * @module patterns/types
 * @see PATTERN-SYSTEM-CONSOLIDATION.md
 */

// ============================================================================
// Pattern Category Types
// ============================================================================

/**
 * Categories of patterns that can be detected.
 * Each category corresponds to a detector category.
 */
export type PatternCategory =
  | 'api'
  | 'auth'
  | 'security'
  | 'errors'
  | 'logging'
  | 'data-access'
  | 'config'
  | 'testing'
  | 'performance'
  | 'components'
  | 'styling'
  | 'structural'
  | 'types'
  | 'accessibility'
  | 'documentation';

/**
 * Array of all valid pattern categories
 */
export const PATTERN_CATEGORIES: PatternCategory[] = [
  'api',
  'auth',
  'security',
  'errors',
  'logging',
  'data-access',
  'config',
  'testing',
  'performance',
  'components',
  'styling',
  'structural',
  'types',
  'accessibility',
  'documentation',
];

// ============================================================================
// Pattern Status Types
// ============================================================================

/**
 * Status of a pattern in the system.
 *
 * - discovered: Pattern found but not yet reviewed
 * - approved: Pattern approved for enforcement
 * - ignored: Pattern explicitly ignored by user
 */
export type PatternStatus = 'discovered' | 'approved' | 'ignored';

/**
 * Valid state transitions for patterns
 */
export const VALID_STATUS_TRANSITIONS: Record<PatternStatus, PatternStatus[]> = {
  discovered: ['approved', 'ignored'],
  approved: ['ignored'],
  ignored: ['approved'],
};

// ============================================================================
// Confidence Types
// ============================================================================

/**
 * Confidence level classification based on score thresholds.
 *
 * - high: score >= 0.85
 * - medium: score >= 0.70 and < 0.85
 * - low: score >= 0.50 and < 0.70
 * - uncertain: score < 0.50
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

/**
 * Confidence score thresholds
 */
export const CONFIDENCE_THRESHOLDS = {
  high: 0.85,
  medium: 0.70,
  low: 0.50,
} as const;

/**
 * Compute confidence level from score
 */
export function computeConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) {return 'high';}
  if (score >= CONFIDENCE_THRESHOLDS.medium) {return 'medium';}
  if (score >= CONFIDENCE_THRESHOLDS.low) {return 'low';}
  return 'uncertain';
}

// ============================================================================
// Severity Types
// ============================================================================

/**
 * Severity levels for pattern violations.
 *
 * - error: Blocks commits and merges
 * - warning: Displayed but doesn't block
 * - info: Informational only
 * - hint: Subtle suggestion
 */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Severity level ordering (higher = more severe)
 */
export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

// ============================================================================
// Detection Method Types
// ============================================================================

/**
 * Type of detection method used by a detector
 */
export type DetectionMethod = 'ast' | 'regex' | 'semantic' | 'learning' | 'structural';

// ============================================================================
// Location Types
// ============================================================================

/**
 * Location of a pattern occurrence in source code
 */
export interface PatternLocation {
  /** File path (relative to project root) */
  file: string;

  /** Line number (1-indexed) */
  line: number;

  /** Column number (1-indexed) */
  column: number;

  /** End line number (optional, 1-indexed) */
  endLine?: number | undefined;

  /** End column number (optional, 1-indexed) */
  endColumn?: number | undefined;

  /** Code snippet for context */
  snippet?: string | undefined;
}

/**
 * Location of an outlier with reason for deviation
 */
export interface OutlierLocation extends PatternLocation {
  /** Reason why this location is an outlier */
  reason: string;

  /** Deviation score (0.0 to 1.0, higher = more deviation) */
  deviationScore?: number | undefined;
}

// ============================================================================
// Pattern Metadata Types
// ============================================================================

/**
 * Metadata for a pattern
 */
export interface PatternMetadata {
  /** ISO timestamp when pattern was first detected */
  firstSeen: string;

  /** ISO timestamp when pattern was last seen */
  lastSeen: string;

  /** ISO timestamp when pattern was approved (if approved) */
  approvedAt?: string | undefined;

  /** User who approved the pattern (if approved) */
  approvedBy?: string | undefined;

  /** Version of the pattern definition */
  version?: string | undefined;

  /** Tags for additional categorization */
  tags?: string[] | undefined;

  /** Related pattern IDs */
  relatedPatterns?: string[] | undefined;

  /** Source of the pattern (e.g., 'auto-detected', 'imported') */
  source?: string | undefined;

  /** Custom metadata fields */
  custom?: Record<string, unknown> | undefined;
}

// ============================================================================
// Detector Configuration Types
// ============================================================================

/**
 * Configuration for a pattern detector
 */
export interface DetectorConfig {
  /** Type of detection method */
  type: DetectionMethod;

  /** Detector-specific configuration */
  config: Record<string, unknown>;
}

// ============================================================================
// Unified Pattern Type
// ============================================================================

/**
 * Unified Pattern type - the single source of truth for pattern data.
 *
 * This type consolidates:
 * - Pattern from PatternStore (full metadata, status tracking)
 * - PatternShardEntry from PatternShardStore (optimized for queries)
 *
 * All consumers should use this type for pattern data.
 */
export interface Pattern {
  // === Identity ===

  /** Unique pattern identifier */
  id: string;

  // === Classification ===

  /** Pattern category */
  category: PatternCategory;

  /** Pattern subcategory for more specific classification */
  subcategory: string;

  // === Metadata ===

  /** Human-readable pattern name */
  name: string;

  /** Detailed pattern description */
  description: string;

  // === Detection Info ===

  /** Detector ID that found this pattern */
  detectorId: string;

  /** Detector name */
  detectorName: string;

  /** Detection method used */
  detectionMethod: DetectionMethod;

  /** Detector configuration */
  detector: DetectorConfig;

  // === Confidence ===

  /** Confidence score (0.0 to 1.0) */
  confidence: number;

  /** Confidence level (computed from score) */
  confidenceLevel: ConfidenceLevel;

  // === Locations ===

  /** Locations where pattern is found */
  locations: PatternLocation[];

  /** Outlier locations that deviate from the pattern */
  outliers: OutlierLocation[];

  // === Status ===

  /** Current status of the pattern */
  status: PatternStatus;

  // === Severity ===

  /** Severity level for violations */
  severity: Severity;

  // === Timestamps ===

  /** ISO timestamp when pattern was first detected */
  firstSeen: string;

  /** ISO timestamp when pattern was last seen */
  lastSeen: string;

  /** ISO timestamp when pattern was approved (if approved) */
  approvedAt?: string | undefined;

  /** User who approved the pattern (if approved) */
  approvedBy?: string | undefined;

  // === Additional Metadata ===

  /** Tags for additional categorization */
  tags: string[];

  /** Whether the pattern can be auto-fixed */
  autoFixable: boolean;

  /** Full metadata object */
  metadata: PatternMetadata;
}

// ============================================================================
// Pattern Summary Type (for listings)
// ============================================================================

/**
 * Lightweight pattern summary for listings and indexes.
 * Contains only the essential fields needed for display.
 */
export interface PatternSummary {
  id: string;
  name: string;
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  severity: Severity;
  locationCount: number;
  outlierCount: number;
}

/**
 * Convert a Pattern to PatternSummary
 */
export function toPatternSummary(pattern: Pattern): PatternSummary {
  return {
    id: pattern.id,
    name: pattern.name,
    category: pattern.category,
    subcategory: pattern.subcategory,
    status: pattern.status,
    confidence: pattern.confidence,
    confidenceLevel: pattern.confidenceLevel,
    severity: pattern.severity,
    locationCount: pattern.locations.length,
    outlierCount: pattern.outliers.length,
  };
}

// ============================================================================
// Pattern Creation Helpers
// ============================================================================

/**
 * Input for creating a new pattern (minimal required fields)
 */
export interface CreatePatternInput {
  id: string;
  category: PatternCategory;
  subcategory: string;
  name: string;
  description: string;
  detectorId: string;
  detectorName: string;
  detectionMethod: DetectionMethod;
  confidence: number;
  locations: PatternLocation[];
  severity?: Severity;
  outliers?: OutlierLocation[];
  tags?: string[];
  autoFixable?: boolean;
  detector?: DetectorConfig;
}

/**
 * Create a new Pattern with defaults
 */
export function createPattern(input: CreatePatternInput): Pattern {
  const now = new Date().toISOString();

  return {
    id: input.id,
    category: input.category,
    subcategory: input.subcategory,
    name: input.name,
    description: input.description,
    detectorId: input.detectorId,
    detectorName: input.detectorName,
    detectionMethod: input.detectionMethod,
    detector: input.detector ?? { type: input.detectionMethod, config: {} },
    confidence: input.confidence,
    confidenceLevel: computeConfidenceLevel(input.confidence),
    locations: input.locations,
    outliers: input.outliers ?? [],
    status: 'discovered',
    severity: input.severity ?? 'info',
    firstSeen: now,
    lastSeen: now,
    tags: input.tags ?? [],
    autoFixable: input.autoFixable ?? false,
    metadata: {
      firstSeen: now,
      lastSeen: now,
      tags: input.tags ?? [],
    },
  };
}
