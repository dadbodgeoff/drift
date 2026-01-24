/**
 * Framework Wrapper Detection
 *
 * Automatically detect custom abstractions built on top of framework primitives.
 *
 * @example
 * ```typescript
 * import { analyzeWrappers } from '@drift/core/wrappers';
 *
 * const result = await analyzeWrappers({
 *   projectPath: '/path/to/project',
 *   language: 'typescript',
 * });
 *
 * console.log(`Found ${result.clusters.length} wrapper patterns`);
 * ```
 */

// Types
export type {
  // Primitive types
  PrimitiveSourceType,
  PrimitiveSource,
  DetectedPrimitive,
  SupportedLanguage,

  // Wrapper types
  WrapperFunction,
  WrapperCategory,
  WrapperCluster,

  // Factory & decorator types
  FactoryType,
  FactoryFunction,
  DecoratorWrapper,

  // Async types
  AsyncType,
  ErrorHandlingPattern,
  AsyncWrapper,

  // Result types
  WrapperAnalysisResult,
  FrameworkInfo,
  WrapperSummary,

  // Registry types
  PrimitiveRegistry,
  FrameworkDetectionResult,
} from './types.js';

// Primitive registry
export {
  // Individual registries
  REACT_PRIMITIVES,
  REACT_ECOSYSTEM_PRIMITIVES,
  VUE_PRIMITIVES,
  SVELTE_PRIMITIVES,
  ANGULAR_PRIMITIVES,
  EXPRESS_PRIMITIVES,
  JS_TESTING_PRIMITIVES,
  FASTAPI_PRIMITIVES,
  DJANGO_PRIMITIVES,
  FLASK_PRIMITIVES,
  SQLALCHEMY_PRIMITIVES,
  CELERY_PRIMITIVES,
  PYDANTIC_PRIMITIVES,
  PYTHON_TESTING_PRIMITIVES,
  SPRING_PRIMITIVES,
  JAVA_TESTING_PRIMITIVES,
  ASPNET_PRIMITIVES,
  EFCORE_PRIMITIVES,
  CSHARP_TESTING_PRIMITIVES,
  LARAVEL_PRIMITIVES,
  SYMFONY_PRIMITIVES,
  PHP_TESTING_PRIMITIVES,

  // Combined registries
  TYPESCRIPT_PRIMITIVES,
  PYTHON_PRIMITIVES,
  JAVA_PRIMITIVES,
  CSHARP_PRIMITIVES,
  PHP_PRIMITIVES,
  ALL_PRIMITIVES,

  // Utility functions
  getPrimitiveNames,
  getFrameworkNames,
  findPrimitiveFramework,
  looksLikePrimitive,
  getPrimitiveCount,
  getPrimitivesByCategory,
} from './primitives/registry.js';

// Primitive discovery
export {
  discoverPrimitives,
  detectFrameworks,
  filterByConfidence,
  groupByFramework,
  groupByCategory,
  type ImportInfo,
  type DecoratorUsage,
  type FunctionUsage,
  type DiscoveryContext,
} from './primitives/discovery.js';

// Wrapper detection
export {
  detectWrappers,
  getWrappersByDepth,
  getWrappersForPrimitive,
  getWrapperCallChain,
  calculateWrapperStats,
  type FunctionInfo,
  type ParameterInfo,
  type CallInfo,
  type DetectionContext,
  type DetectionOptions,
} from './detection/detector.js';

// Clustering
export {
  clusterWrappers,
  inferCategory,
  calculateConfidence,
  detectNamingPatterns,
  getClustersByCategory,
  getMostCommonPrimitives,
  findRelatedClusters,
  type ClusteringOptions,
} from './clustering/clusterer.js';


// =============================================================================
// High-Level Analysis API
// =============================================================================

import type {
  WrapperAnalysisResult,
  WrapperSummary,
  SupportedLanguage,
  WrapperCategory,
  FrameworkInfo,
} from './types.js';
import { discoverPrimitives, detectFrameworks, type DiscoveryContext } from './primitives/discovery.js';
import { detectWrappers, calculateWrapperStats, type DetectionContext } from './detection/detector.js';
import { clusterWrappers, getMostCommonPrimitives } from './clustering/clusterer.js';

export interface AnalysisOptions {
  /** Minimum confidence for clusters (0-1) */
  minConfidence?: number;
  /** Minimum cluster size */
  minClusterSize?: number;
  /** Maximum wrapper depth to traverse */
  maxDepth?: number;
  /** Include test files in analysis */
  includeTestFiles?: boolean;
}

/**
 * Perform complete wrapper analysis on a codebase
 */
export function analyzeWrappers(
  discoveryContext: DiscoveryContext,
  detectionContext: Omit<DetectionContext, 'primitives'>,
  options: AnalysisOptions = {}
): WrapperAnalysisResult {
  // 1. Discover primitives
  const primitives = discoverPrimitives(discoveryContext);

  // 2. Detect frameworks
  const frameworkResults = detectFrameworks(discoveryContext);
  const frameworks: FrameworkInfo[] = frameworkResults.map((fw) => ({
    name: fw.framework,
    version: fw.version,
    primitiveCount: primitives.filter((p) => p.framework === fw.framework).length,
    language: discoveryContext.language,
  }));

  // 3. Detect wrappers
  const fullDetectionContext: DetectionContext = {
    ...detectionContext,
    primitives,
  };

  const wrappers = detectWrappers(fullDetectionContext, {
    maxDepth: options.maxDepth,
    includeTestFiles: options.includeTestFiles,
  });

  // 4. Cluster wrappers
  const clusters = clusterWrappers(wrappers, primitives, {
    minConfidence: options.minConfidence,
    minClusterSize: options.minClusterSize,
  });

  // 5. Calculate summary
  const stats = calculateWrapperStats(wrappers);
  const mostCommon = getMostCommonPrimitives(clusters, 1);

  const wrappersByLanguage: Record<SupportedLanguage, number> = {
    typescript: 0,
    python: 0,
    java: 0,
    csharp: 0,
    php: 0,
  };
  wrappersByLanguage[discoveryContext.language] = wrappers.length;

  const wrappersByCategory: Record<WrapperCategory, number> = {
    'state-management': 0,
    'data-fetching': 0,
    'side-effects': 0,
    'authentication': 0,
    'authorization': 0,
    'validation': 0,
    'dependency-injection': 0,
    'middleware': 0,
    'testing': 0,
    'logging': 0,
    'caching': 0,
    'error-handling': 0,
    'async-utilities': 0,
    'form-handling': 0,
    'routing': 0,
    'factory': 0,
    'decorator': 0,
    'utility': 0,
    'other': 0,
  };

  for (const cluster of clusters) {
    wrappersByCategory[cluster.category] += cluster.wrappers.length;
  }

  const mostUsedWrapper = wrappers.reduce(
    (max, w) => (w.calledBy.length > (max?.calledBy.length || 0) ? w : max),
    wrappers[0]
  );

  const summary: WrapperSummary = {
    totalWrappers: stats.totalWrappers,
    totalClusters: clusters.length,
    avgDepth: stats.avgDepth,
    maxDepth: stats.maxDepth,
    mostWrappedPrimitive: mostCommon[0]?.primitive || 'N/A',
    mostUsedWrapper: mostUsedWrapper?.name || 'N/A',
    wrappersByLanguage,
    wrappersByCategory,
  };

  return {
    frameworks,
    primitives,
    wrappers,
    clusters,
    factories: [], // TODO: Implement factory detection
    decoratorWrappers: [], // TODO: Implement decorator wrapper detection
    asyncWrappers: [], // TODO: Implement async wrapper detection
    summary,
  };
}

/**
 * Quick analysis - just get clusters without full details
 */
export function quickAnalyze(
  discoveryContext: DiscoveryContext,
  detectionContext: Omit<DetectionContext, 'primitives'>
): { clusterCount: number; wrapperCount: number; topPatterns: string[] } {
  const result = analyzeWrappers(discoveryContext, detectionContext, {
    minConfidence: 0.7,
    minClusterSize: 2,
  });

  return {
    clusterCount: result.clusters.length,
    wrapperCount: result.wrappers.length,
    topPatterns: result.clusters.slice(0, 5).map((c) => c.name),
  };
}
