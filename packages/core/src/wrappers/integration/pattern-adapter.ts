/**
 * Pattern System Integration
 *
 * Converts wrapper clusters to Drift patterns for integration with
 * the existing pattern detection and management system.
 */

import { createPattern } from '../../patterns/types.js';

import type {
  Pattern,
  PatternCategory,
  PatternLocation,
  CreatePatternInput,
  Severity,
} from '../../patterns/types.js';
import type { WrapperCluster, WrapperFunction, WrapperCategory } from '../types.js';

// =============================================================================
// Category Mapping
// =============================================================================

/**
 * Map wrapper categories to pattern categories
 */
const WRAPPER_TO_PATTERN_CATEGORY: Record<WrapperCategory, PatternCategory> = {
  'state-management': 'components',
  'data-fetching': 'api',
  'side-effects': 'components',
  'authentication': 'auth',
  'authorization': 'auth',
  'validation': 'api',
  'dependency-injection': 'config',
  'middleware': 'api',
  'testing': 'testing',
  'logging': 'logging',
  'caching': 'performance',
  'error-handling': 'errors',
  'async-utilities': 'api',
  'form-handling': 'components',
  'routing': 'api',
  'factory': 'structural',
  'decorator': 'structural',
  'utility': 'structural',
  'other': 'structural',
};

/**
 * Map wrapper categories to subcategories
 */
const WRAPPER_TO_SUBCATEGORY: Record<WrapperCategory, string> = {
  'state-management': 'state-wrapper',
  'data-fetching': 'data-wrapper',
  'side-effects': 'effect-wrapper',
  'authentication': 'auth-wrapper',
  'authorization': 'authz-wrapper',
  'validation': 'validation-wrapper',
  'dependency-injection': 'di-wrapper',
  'middleware': 'middleware-wrapper',
  'testing': 'test-wrapper',
  'logging': 'logging-wrapper',
  'caching': 'cache-wrapper',
  'error-handling': 'error-wrapper',
  'async-utilities': 'async-wrapper',
  'form-handling': 'form-wrapper',
  'routing': 'routing-wrapper',
  'factory': 'factory-pattern',
  'decorator': 'decorator-pattern',
  'utility': 'utility-wrapper',
  'other': 'wrapper',
};

// =============================================================================
// Conversion Options
// =============================================================================

export interface WrapperToPatternOptions {
  /** Minimum confidence to convert (default: 0.5) */
  minConfidence?: number | undefined;
  /** Default severity for wrapper patterns (default: 'info') */
  defaultSeverity?: Severity | undefined;
  /** Prefix for pattern IDs (default: 'wrapper-') */
  idPrefix?: string | undefined;
  /** Include wrapper details in pattern description */
  includeDetails?: boolean | undefined;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert a wrapper cluster to a Drift pattern
 */
export function clusterToPattern(
  cluster: WrapperCluster,
  options: WrapperToPatternOptions = {}
): Pattern {
  const {
    defaultSeverity = 'info',
    idPrefix = 'wrapper-',
    includeDetails = true,
  } = options;

  const category = WRAPPER_TO_PATTERN_CATEGORY[cluster.category];
  const subcategory = WRAPPER_TO_SUBCATEGORY[cluster.category];

  // Build description
  let description = cluster.description;
  if (includeDetails) {
    const primitiveList = cluster.primitiveSignature.join(', ');
    description += `\n\nWraps: ${primitiveList}`;
    description += `\nWrappers: ${cluster.wrappers.length}`;
    description += `\nAvg depth: ${cluster.avgDepth.toFixed(1)}`;
  }

  // Convert wrapper locations to pattern locations
  const locations: PatternLocation[] = cluster.wrappers.map(wrapperToLocation);

  const input: CreatePatternInput = {
    id: `${idPrefix}${cluster.id}`,
    category,
    subcategory,
    name: cluster.name,
    description,
    detectorId: 'wrapper-detector',
    detectorName: 'Framework Wrapper Detector',
    detectionMethod: 'semantic',
    confidence: cluster.confidence,
    locations,
    severity: defaultSeverity,
    tags: [
      'wrapper',
      `wrapper-${cluster.category}`,
      ...cluster.primitiveSignature.map((p) => `wraps-${p}`),
    ],
    autoFixable: false,
    detector: {
      type: 'semantic',
      config: {
        primitiveSignature: cluster.primitiveSignature,
        avgDepth: cluster.avgDepth,
        maxDepth: cluster.maxDepth,
        totalUsages: cluster.totalUsages,
        fileSpread: cluster.fileSpread,
      },
    },
  };

  return createPattern(input);
}

/**
 * Convert a wrapper function to a pattern location
 */
export function wrapperToLocation(wrapper: WrapperFunction): PatternLocation {
  // Build snippet showing wrapper signature
  const primitives = wrapper.primitiveSignature.join(', ');
  const snippet = `${wrapper.name} wraps [${primitives}] at depth ${wrapper.depth}`;

  return {
    file: wrapper.file,
    line: wrapper.line,
    column: 1,
    snippet,
  };
}

/**
 * Convert multiple clusters to patterns
 */
export function clustersToPatterns(
  clusters: WrapperCluster[],
  options: WrapperToPatternOptions = {}
): Pattern[] {
  const { minConfidence = 0.5 } = options;

  return clusters
    .filter((c) => c.confidence >= minConfidence)
    .map((c) => clusterToPattern(c, options));
}

// =============================================================================
// Pattern ID Generation
// =============================================================================

/**
 * Generate a unique pattern ID for a wrapper cluster
 */
export function generatePatternId(cluster: WrapperCluster): string {
  // Use signature hash for uniqueness
  const signatureHash = cluster.primitiveSignature
    .sort()
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');

  return `wrapper-${cluster.category}-${signatureHash}`.slice(0, 64);
}

// =============================================================================
// Pattern Metadata Extraction
// =============================================================================

/**
 * Extract pattern metadata from a wrapper cluster
 */
export function extractPatternMetadata(cluster: WrapperCluster): Record<string, unknown> {
  return {
    wrapperCategory: cluster.category,
    primitiveSignature: cluster.primitiveSignature,
    wrapperCount: cluster.wrappers.length,
    avgDepth: cluster.avgDepth,
    maxDepth: cluster.maxDepth,
    totalUsages: cluster.totalUsages,
    fileSpread: cluster.fileSpread,
    suggestedNames: cluster.suggestedNames,
    wrapperNames: cluster.wrappers.map((w) => w.name),
  };
}

// =============================================================================
// Reverse Conversion (Pattern to Cluster info)
// =============================================================================

/**
 * Check if a pattern was created from a wrapper cluster
 */
export function isWrapperPattern(pattern: Pattern): boolean {
  return (
    pattern.detectorId === 'wrapper-detector' ||
    pattern.id.startsWith('wrapper-') ||
    pattern.tags.includes('wrapper')
  );
}

/**
 * Extract wrapper info from a pattern (if it's a wrapper pattern)
 */
export function extractWrapperInfo(pattern: Pattern): {
  primitiveSignature: string[];
  wrapperCategory: string;
  avgDepth: number;
  maxDepth: number;
} | null {
  if (!isWrapperPattern(pattern)) {return null;}

  const config = pattern.detector.config;

  return {
    primitiveSignature: (config['primitiveSignature'] as string[]) ?? [],
    wrapperCategory: (config['wrapperCategory'] as string) ?? pattern.subcategory,
    avgDepth: (config['avgDepth'] as number) ?? 1,
    maxDepth: (config['maxDepth'] as number) ?? 1,
  };
}
