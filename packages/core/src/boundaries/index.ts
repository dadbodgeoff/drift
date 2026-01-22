/**
 * Data Boundaries Module
 *
 * Exports types and store for tracking data access boundaries.
 */

// Types
export type {
  DataOperation,
  SensitivityType,
  ORMFramework,
  ORMModel,
  SensitiveField,
  DataAccessPoint,
  TableAccessInfo,
  FileAccessInfo,
  DataAccessMap,
  BoundarySeverity,
  BoundaryRule,
  SensitivityTiers,
  BoundaryRules,
  BoundaryViolation,
  BoundaryStoreConfig,
  BoundaryScanResult,
} from './types.js';

// Store
export { BoundaryStore, createBoundaryStore } from './boundary-store.js';

// Scanner (with learning)
export { BoundaryScanner, createBoundaryScanner } from './boundary-scanner.js';
export type { BoundaryScannerConfig, ScanFilesOptions } from './boundary-scanner.js';

// Data Access Learner
export { DataAccessLearner, createDataAccessLearner } from './data-access-learner.js';
export type {
  LearnedDataAccessPattern,
  LearnedDataAccessConventions,
  DataAccessLearningConfig,
} from './data-access-learner.js';

// Security Prioritizer
export { SecurityPrioritizer, createSecurityPrioritizer } from './security-prioritizer.js';
export type {
  SecurityClassification,
  PrioritizedAccessPoint,
  SecuritySummary,
  PrioritizedScanResult,
} from './security-prioritizer.js';
