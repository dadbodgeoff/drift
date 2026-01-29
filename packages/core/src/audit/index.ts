/**
 * Audit System
 *
 * Provides automated pattern validation, deduplication detection,
 * cross-reference verification, and agent-assisted approval workflows.
 *
 * @module audit
 */

// Types
export type {
  AuditResult,
  AuditSummary,
  AuditOptions,
  AuditEngineConfig,
  PatternAuditResult,
  PatternCrossValidation,
  DuplicateGroup,
  DuplicateRecommendation,
  CrossValidationResult,
  CrossValidationIssue,
  CrossValidationIssueType,
  CrossValidationSeverity,
  DegradationResult,
  DegradationTracking,
  DegradationAlert,
  DegradationAlertType,
  AuditHistoryEntry,
  CategoryAuditSummary,
  AuditRecommendation,
  TrendDirection,
} from './types.js';

// Constants
export {
  AUDIT_VERSION,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  DEFAULT_REVIEW_THRESHOLD,
  DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD,
  DEFAULT_MIN_LOCATIONS_ESTABLISHED,
  DEFAULT_MAX_OUTLIER_RATIO,
  HEALTH_SCORE_WEIGHTS,
} from './types.js';

// Engine
export { AuditEngine } from './audit-engine.js';

// Store
export { AuditStore, type AuditStoreConfig } from './audit-store.js';
