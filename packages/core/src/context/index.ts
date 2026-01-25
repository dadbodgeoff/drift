/**
 * Package Context Module
 * 
 * @license Apache-2.0
 * 
 * Provides package-scoped context generation for monorepos.
 * Enables AI context minimization by scoping patterns, constraints,
 * and examples to specific packages.
 */

// Types
export type {
  PackageManager,
  DetectedPackage,
  MonorepoStructure,
  PackageContextOptions,
  ContextPattern,
  ContextConstraint,
  ContextEntryPoint,
  ContextDataAccessor,
  PackageContext,
  PackageContextResult,
  AIContextFormat,
  ContextCacheEntry,
  ContextEventType,
  ContextEvent,
} from './types.js';

// Package Detection
export {
  PackageDetector,
  createPackageDetector,
} from './package-detector.js';

// Context Generation
export {
  PackageContextGenerator,
  createPackageContextGenerator,
} from './context-generator.js';
