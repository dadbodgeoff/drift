/**
 * Unified Pattern System
 *
 * This module provides the consolidated pattern system for Drift.
 * It includes:
 * - Unified Pattern type (single source of truth)
 * - IPatternRepository interface (storage abstraction)
 * - IPatternService interface (consumer API)
 * - Multiple repository implementations (file, memory, cached)
 *
 * @module patterns
 * @see PATTERN-SYSTEM-CONSOLIDATION.md
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  Severity,
  DetectionMethod,

  // Location types
  PatternLocation,
  OutlierLocation,

  // Metadata types
  PatternMetadata,
  DetectorConfig,

  // Summary types
  PatternSummary,

  // Creation types
  CreatePatternInput,
} from './types.js';

export {
  // Constants
  PATTERN_CATEGORIES,
  VALID_STATUS_TRANSITIONS,
  CONFIDENCE_THRESHOLDS,
  SEVERITY_ORDER,

  // Utility functions
  computeConfidenceLevel,
  toPatternSummary,
  createPattern,
} from './types.js';

// ============================================================================
// Repository Interface
// ============================================================================

export type {
  // Repository interface
  IPatternRepository,

  // Query types
  PatternFilter,
  PatternSort,
  PatternPagination,
  PatternQueryOptions,
  PatternQueryResult,

  // Event types
  PatternRepositoryEventType,
  PatternRepositoryEventHandler,

  // Config types
  PatternRepositoryConfig,
} from './repository.js';

export { DEFAULT_REPOSITORY_CONFIG } from './repository.js';

// ============================================================================
// Service Interface
// ============================================================================

export type {
  // Service interface
  IPatternService,

  // Status types
  PatternSystemStatus,
  CategorySummary,

  // Detail types
  PatternWithExamples,
  CodeExample,

  // List types
  ListOptions,
  PaginatedResult,
  SearchOptions,

  // Config types
  PatternServiceConfig,
} from './service.js';

export { DEFAULT_SERVICE_CONFIG } from './service.js';

// ============================================================================
// Implementations
// ============================================================================

export {
  // File repository (legacy - deprecated)
  FilePatternRepository,
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,

  // Unified file repository (P3 - recommended)
  UnifiedFilePatternRepository,
  createUnifiedFilePatternRepository,

  // Repository factory (auto-detects format - recommended)
  createPatternRepository,
  createPatternRepositorySync,
  detectStorageFormat,

  // Memory repository
  InMemoryPatternRepository,

  // Cached repository
  CachedPatternRepository,

  // Pattern service
  PatternService,
  createPatternService,
} from './impl/index.js';

export type {
  UnifiedRepositoryConfig,
  StorageFormat,
  RepositoryFactoryConfig,
} from './impl/index.js';

// ============================================================================
// Adapters (for backward compatibility)
// ============================================================================

export {
  PatternStoreAdapter,
  createPatternStoreAdapter,
  createPatternServiceFromStore,
} from './adapters/index.js';
