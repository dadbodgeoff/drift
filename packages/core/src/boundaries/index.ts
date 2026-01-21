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
