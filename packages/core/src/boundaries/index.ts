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
export type { ExtendedBoundaryStoreConfig } from './boundary-store.js';

// Table Name Validator
export { 
  TableNameValidator, 
  createTableNameValidator,
  defaultTableNameValidator,
} from './table-name-validator.js';
export type { 
  TableNameValidationResult, 
  TableNameValidatorConfig,
} from './table-name-validator.js';

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

// Field Extractors
export {
  // Types
  type FieldExtractor,
  type ExtractedField,
  type FieldSource,
  type LineExtractionResult,
  type ModelExtractionResult,
  BaseFieldExtractor,
  // Extractors
  SupabaseFieldExtractor,
  createSupabaseExtractor,
  PrismaFieldExtractor,
  createPrismaExtractor,
  DjangoFieldExtractor,
  createDjangoExtractor,
  SQLAlchemyFieldExtractor,
  createSQLAlchemyExtractor,
  RawSQLFieldExtractor,
  createRawSQLExtractor,
  GORMFieldExtractor,
  createGORMExtractor,
  DieselFieldExtractor,
  createDieselExtractor,
  // Factory functions
  getMatchingExtractors,
  getAllExtractors,
  extractFieldsFromLine,
  extractModelsFromContent,
} from './field-extractors/index.js';
