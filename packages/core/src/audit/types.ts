/**
 * Audit System Types
 *
 * Type definitions for the pattern audit system that provides
 * automated validation, deduplication detection, cross-reference
 * verification, and approval recommendations.
 */

import type { PatternCategory } from '../store/types.js';

// =============================================================================
// Core Audit Types
// =============================================================================

/**
 * Complete audit result
 */
export interface AuditResult {
  /** Schema version */
  version: string;
  
  /** When the audit was generated */
  generatedAt: string;
  
  /** Hash of the scan that was audited */
  scanHash: string;
  
  /** Summary statistics */
  summary: AuditSummary;
  
  /** Per-pattern audit results */
  patterns: PatternAuditResult[];
  
  /** Detected duplicate groups */
  duplicates: DuplicateGroup[];
  
  /** Cross-validation results */
  crossValidation: CrossValidationResult;
  
  /** Degradation compared to previous audit */
  degradation?: DegradationResult;
}

/**
 * Audit summary statistics
 */
export interface AuditSummary {
  /** Total patterns audited */
  totalPatterns: number;
  
  /** Patterns eligible for auto-approval (≥90% confidence) */
  autoApproveEligible: number;
  
  /** Patterns that need human review */
  flaggedForReview: number;
  
  /** Patterns likely to be false positives */
  likelyFalsePositives: number;
  
  /** Number of duplicate candidate groups */
  duplicateCandidates: number;
  
  /** Overall health score (0-100) */
  healthScore: number;
  
  /** Breakdown by category */
  byCategory: Record<string, CategoryAuditSummary>;
}

/**
 * Per-category audit summary
 */
export interface CategoryAuditSummary {
  total: number;
  autoApproveEligible: number;
  flaggedForReview: number;
  likelyFalsePositives: number;
  avgConfidence: number;
}

// =============================================================================
// Pattern Audit Types
// =============================================================================

/**
 * Audit recommendation for a pattern
 */
export type AuditRecommendation = 'auto-approve' | 'review' | 'likely-false-positive';

/**
 * Audit result for a single pattern
 */
export interface PatternAuditResult {
  /** Pattern ID */
  id: string;
  
  /** Pattern name */
  name: string;
  
  /** Pattern category */
  category: PatternCategory;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Number of locations */
  locationCount: number;
  
  /** Number of outliers */
  outlierCount: number;
  
  /** Audit recommendation */
  recommendation: AuditRecommendation;
  
  /** Reasons for the recommendation */
  reasons: string[];
  
  /** Cross-validation status */
  crossValidation?: PatternCrossValidation;
  
  /** Duplicate group ID if part of a duplicate group */
  duplicateGroupId?: string;
}

/**
 * Cross-validation status for a pattern
 */
export interface PatternCrossValidation {
  /** Pattern has matching call graph entries */
  inCallGraph: boolean;
  
  /** Pattern aligns with constraints */
  matchesConstraints: boolean;
  
  /** Pattern has test coverage */
  hasTestCoverage: boolean;
  
  /** Specific issues found */
  issues: string[];
}

// =============================================================================
// Duplicate Detection Types
// =============================================================================

/**
 * Recommendation for handling duplicates
 */
export type DuplicateRecommendation = 'merge' | 'keep-both' | 'review';

/**
 * A group of potentially duplicate patterns
 */
export interface DuplicateGroup {
  /** Unique ID for this group */
  id: string;
  
  /** Pattern IDs in this group */
  patterns: string[];
  
  /** Pattern names for display */
  patternNames: string[];
  
  /** Similarity score (0-1) */
  similarity: number;
  
  /** Why these are considered duplicates */
  reason: string;
  
  /** Recommendation for handling */
  recommendation: DuplicateRecommendation;
  
  /** Overlapping file locations */
  overlappingLocations: number;
  
  /** Total locations across all patterns */
  totalLocations: number;
}

// =============================================================================
// Cross-Validation Types
// =============================================================================

/**
 * Cross-validation issue type
 */
export type CrossValidationIssueType = 
  | 'orphan-pattern'      // Pattern has no call graph entry
  | 'missing-pattern'     // Call graph entry has no pattern
  | 'constraint-mismatch' // Pattern doesn't align with constraint
  | 'no-test-coverage'    // Pattern has no test coverage
  | 'inconsistent-data';  // Data inconsistency detected

/**
 * Cross-validation issue severity
 */
export type CrossValidationSeverity = 'error' | 'warning' | 'info';

/**
 * A cross-validation issue
 */
export interface CrossValidationIssue {
  /** Issue type */
  type: CrossValidationIssueType;
  
  /** Severity level */
  severity: CrossValidationSeverity;
  
  /** Related pattern ID */
  patternId?: string;
  
  /** Related call graph entry */
  callGraphEntry?: string;
  
  /** Related constraint ID */
  constraintId?: string;
  
  /** Human-readable message */
  message: string;
}

/**
 * Cross-validation results
 */
export interface CrossValidationResult {
  /** Patterns that have matching call graph entries */
  patternsMatchingCallGraph: number;
  
  /** Patterns without call graph entries */
  patternsNotInCallGraph: number;
  
  /** Call graph entries without patterns */
  callGraphEntriesWithoutPatterns: number;
  
  /** Constraint alignment score (0-1) */
  constraintAlignment: number;
  
  /** Test coverage alignment score (0-1) */
  testCoverageAlignment: number;
  
  /** All issues found */
  issues: CrossValidationIssue[];
}

// =============================================================================
// Degradation Types
// =============================================================================

/**
 * Quality trend direction
 */
export type TrendDirection = 'improving' | 'stable' | 'declining';

/**
 * Degradation alert type
 */
export type DegradationAlertType = 
  | 'health-drop'
  | 'confidence-drop'
  | 'new-false-positives'
  | 'duplicate-increase'
  | 'cross-validation-regression';

/**
 * A degradation alert
 */
export interface DegradationAlert {
  /** Alert type */
  type: DegradationAlertType;
  
  /** Severity */
  severity: 'critical' | 'warning' | 'info';
  
  /** Human-readable message */
  message: string;
  
  /** When the alert was generated */
  date: string;
  
  /** Metric value change */
  delta?: number;
}

/**
 * Degradation comparison result
 */
export interface DegradationResult {
  /** Date of previous audit */
  previousAuditDate: string;
  
  /** Health score change */
  healthScoreDelta: number;
  
  /** Average confidence change */
  confidenceDelta: number;
  
  /** Pattern count change */
  patternCountDelta: number;
  
  /** New issues since last audit */
  newIssues: string[];
  
  /** Issues resolved since last audit */
  resolvedIssues: string[];
  
  /** Overall trend */
  trend: TrendDirection;
  
  /** Active alerts */
  alerts: DegradationAlert[];
}

// =============================================================================
// Historical Tracking Types
// =============================================================================

/**
 * Historical audit entry for trend tracking
 */
export interface AuditHistoryEntry {
  /** Date of the audit */
  date: string;
  
  /** Health score */
  healthScore: number;
  
  /** Average confidence */
  avgConfidence: number;
  
  /** Total patterns */
  totalPatterns: number;
  
  /** Approved patterns */
  approvedCount: number;
  
  /** Duplicate groups */
  duplicateGroups: number;
  
  /** Cross-validation score */
  crossValidationScore: number;
}

/**
 * Degradation tracking data
 */
export interface DegradationTracking {
  /** Historical entries */
  history: AuditHistoryEntry[];
  
  /** Trend analysis */
  trends: {
    healthTrend: TrendDirection;
    confidenceTrend: TrendDirection;
    patternGrowth: 'healthy' | 'rapid' | 'stagnant';
  };
  
  /** Active alerts */
  alerts: DegradationAlert[];
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Audit engine configuration
 */
export interface AuditEngineConfig {
  /** Project root directory */
  rootDir: string;
  
  /** Confidence threshold for auto-approval (default: 0.90) */
  autoApproveThreshold?: number;
  
  /** Confidence threshold for review (default: 0.70) */
  reviewThreshold?: number;
  
  /** Similarity threshold for duplicate detection (default: 0.85) */
  duplicateSimilarityThreshold?: number;
  
  /** Minimum locations for a pattern to be considered established */
  minLocationsForEstablished?: number;
  
  /** Maximum outlier ratio before flagging (default: 0.5) */
  maxOutlierRatio?: number;
}

/**
 * Audit run options
 */
export interface AuditOptions {
  /** Include cross-validation with call graph */
  crossValidateCallGraph?: boolean;
  
  /** Include cross-validation with constraints */
  crossValidateConstraints?: boolean;
  
  /** Include cross-validation with test topology */
  crossValidateTests?: boolean;
  
  /** Compare to previous audit for degradation */
  compareToPrevious?: boolean;
  
  /** Categories to audit (empty = all) */
  categories?: PatternCategory[];
  
  /** Force re-audit even if recent */
  force?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

export const AUDIT_VERSION = '1.0.0';

export const DEFAULT_AUTO_APPROVE_THRESHOLD = 0.90;
export const DEFAULT_REVIEW_THRESHOLD = 0.70;
export const DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD = 0.85;
export const DEFAULT_MIN_LOCATIONS_ESTABLISHED = 3;
export const DEFAULT_MAX_OUTLIER_RATIO = 0.5;

/** Health score weights */
export const HEALTH_SCORE_WEIGHTS = {
  avgConfidence: 0.30,
  approvalRatio: 0.20,
  complianceRate: 0.20,
  crossValidationRate: 0.15,
  duplicateFreeRate: 0.15,
};
