/**
 * Pattern Repository Implementations
 *
 * @module patterns/impl
 */

// Shared errors
export {
  PatternNotFoundError,
  InvalidStatusTransitionError,
  PatternAlreadyExistsError,
} from '../errors.js';

// File-based repository (legacy status-based format)
/** @deprecated Use UnifiedFilePatternRepository instead */
export { FilePatternRepository } from './file-repository.js';

// Unified file repository (P3 - category-based format with status)
export {
  UnifiedFilePatternRepository,
  createUnifiedFilePatternRepository,
} from './unified-file-repository.js';
export type { UnifiedRepositoryConfig } from './unified-file-repository.js';

// Repository factory (auto-detects format)
export {
  createPatternRepository,
  createPatternRepositorySync,
  detectStorageFormat,
} from './repository-factory.js';
export type { StorageFormat, RepositoryFactoryConfig } from './repository-factory.js';

// In-memory repository (for testing)
export { InMemoryPatternRepository } from './memory-repository.js';

// Cached repository (decorator)
export { CachedPatternRepository } from './cached-repository.js';

// Pattern service
export { PatternService, createPatternService } from './pattern-service.js';
