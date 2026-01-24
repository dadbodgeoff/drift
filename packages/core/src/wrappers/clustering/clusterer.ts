/**
 * Wrapper Clustering
 *
 * Groups wrappers by their primitive signature to identify patterns.
 */

import type {
  WrapperFunction,
  WrapperCluster,
  WrapperCategory,
  DetectedPrimitive,
} from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface ClusteringOptions {
  minClusterSize?: number;
  minTotalUsages?: number;
  minConfidence?: number;
}

const DEFAULT_OPTIONS: Required<ClusteringOptions> = {
  minClusterSize: 2,
  minTotalUsages: 3,
  minConfidence: 0.5,
};

// =============================================================================
// Main Clustering
// =============================================================================

/**
 * Cluster wrappers by their primitive signature
 */
export function clusterWrappers(
  wrappers: WrapperFunction[],
  primitives: DetectedPrimitive[],
  options: ClusteringOptions = {}
): WrapperCluster[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Group by primitive signature
  const bySignature = new Map<string, WrapperFunction[]>();

  for (const wrapper of wrappers) {
    const signature = wrapper.primitiveSignature.join('+');

    if (!bySignature.has(signature)) {
      bySignature.set(signature, []);
    }
    bySignature.get(signature)!.push(wrapper);
  }

  // Convert to clusters
  const clusters: WrapperCluster[] = [];

  for (const [signature, members] of bySignature) {
    const totalUsages = members.reduce((sum, m) => sum + m.calledBy.length, 0);

    // Apply filters
    if (members.length < opts.minClusterSize && totalUsages < opts.minTotalUsages) {
      continue;
    }

    const primitiveList = signature.split('+');
    const category = inferCategory(primitiveList, primitives);
    const files = new Set(members.map((m) => m.file));
    const confidence = calculateConfidence(members, primitiveList, totalUsages, files.size);

    if (confidence < opts.minConfidence) {
      continue;
    }

    const depths = members.map((m) => m.depth);

    clusters.push({
      id: generateClusterId(signature),
      name: generateClusterName(primitiveList, category, members),
      description: generateDescription(primitiveList, members, category),
      primitiveSignature: primitiveList,
      wrappers: members,
      confidence,
      category,
      avgDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
      maxDepth: Math.max(...depths),
      totalUsages,
      fileSpread: files.size,
      suggestedNames: generateNameSuggestions(primitiveList, category, members),
    });
  }

  return clusters.sort((a, b) => b.confidence - a.confidence);
}


// =============================================================================
// Category Inference
// =============================================================================

/**
 * Infer the category of a wrapper cluster based on its primitives
 */
export function inferCategory(
  primitives: string[],
  allPrimitives: DetectedPrimitive[]
): WrapperCategory {
  const primSet = new Set(primitives.map((p) => p.toLowerCase()));

  // React-specific patterns
  if (primSet.has('usestate') || primSet.has('usereducer')) {
    if (primSet.has('useeffect') || primSet.has('uselayouteffect')) {
      return 'side-effects';
    }
    return 'state-management';
  }

  if (primSet.has('useeffect') || primSet.has('uselayouteffect') || primSet.has('useinsertioneffect')) {
    return 'side-effects';
  }

  if (primSet.has('usequery') || primSet.has('useswr') || primSet.has('usemutation') || primSet.has('useinfinitequery')) {
    return 'data-fetching';
  }

  if (primSet.has('useform') || primSet.has('useformik') || primSet.has('usefieldarray')) {
    return 'form-handling';
  }

  if (primSet.has('usenavigate') || primSet.has('userouter') || primSet.has('uselocation') || primSet.has('useparams')) {
    return 'routing';
  }

  // Cross-framework patterns based on primitive categories
  const categories = primitives
    .map((p) => {
      const prim = allPrimitives.find((ap) => ap.name.toLowerCase() === p.toLowerCase());
      return prim?.category;
    })
    .filter(Boolean) as string[];

  // Auth patterns
  if (
    categories.includes('auth') ||
    primitives.some((p) => /auth|login|session|token|user/i.test(p))
  ) {
    return 'authentication';
  }

  // Authorization patterns
  if (
    categories.includes('security') ||
    primitives.some((p) => /permission|role|authorize|grant|policy|gate/i.test(p))
  ) {
    return 'authorization';
  }

  // DI patterns
  if (
    categories.includes('di') ||
    primitives.some((p) => /inject|autowired|depends|resolve|getservice|getbean/i.test(p))
  ) {
    return 'dependency-injection';
  }

  // Middleware patterns
  if (
    categories.includes('middleware') ||
    primitives.some((p) => /middleware|interceptor|filter|pipe/i.test(p))
  ) {
    return 'middleware';
  }

  // Validation patterns
  if (
    categories.includes('validation') ||
    primitives.some((p) => /valid|schema|assert|check/i.test(p))
  ) {
    return 'validation';
  }

  // Testing patterns
  if (
    categories.includes('test') ||
    categories.includes('mock') ||
    primitives.some((p) => /test|mock|spy|stub|fixture|assert|expect/i.test(p))
  ) {
    return 'testing';
  }

  // Caching patterns
  if (primitives.some((p) => /cache|memo|remember/i.test(p))) {
    return 'caching';
  }

  // Logging patterns
  if (primitives.some((p) => /log|trace|debug|info|warn|error/i.test(p))) {
    return 'logging';
  }

  // Error handling patterns
  if (primitives.some((p) => /error|exception|catch|throw|try/i.test(p))) {
    return 'error-handling';
  }

  // Async patterns
  if (primitives.some((p) => /async|await|promise|future|task|observable/i.test(p))) {
    return 'async-utilities';
  }

  // Factory patterns
  if (primitives.some((p) => /factory|create|make|build|new/i.test(p))) {
    return 'factory';
  }

  // Decorator patterns
  if (primitives.some((p) => /decorator|wrapper|wrap/i.test(p))) {
    return 'decorator';
  }

  return 'utility';
}


// =============================================================================
// Confidence Scoring
// =============================================================================

/**
 * Calculate confidence score for a cluster
 */
export function calculateConfidence(
  members: WrapperFunction[],
  primitives: string[],
  totalUsages: number,
  fileSpread: number
): number {
  let confidence = 0.5; // Base confidence

  // More members = higher confidence
  if (members.length >= 5) {
    confidence += 0.2;
  } else if (members.length >= 3) {
    confidence += 0.1;
  }

  // More usages = higher confidence
  if (totalUsages >= 20) {
    confidence += 0.15;
  } else if (totalUsages >= 10) {
    confidence += 0.1;
  } else if (totalUsages >= 5) {
    confidence += 0.05;
  }

  // Spread across files = higher confidence
  if (fileSpread >= 3) {
    confidence += 0.1;
  } else if (fileSpread >= 2) {
    confidence += 0.05;
  }

  // Consistent naming = higher confidence
  const namingPatterns = detectNamingPatterns(members);
  if (namingPatterns.length > 0) {
    confidence += 0.1;
  }

  // Known primitives = higher confidence
  const knownPrimitiveRatio = primitives.filter((p) => isKnownPrimitive(p)).length / primitives.length;
  confidence += knownPrimitiveRatio * 0.1;

  return Math.min(confidence, 1.0);
}

/**
 * Check if a primitive is from a known framework
 */
function isKnownPrimitive(name: string): boolean {
  const knownPrimitives = [
    // React
    'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback', 'useMemo', 'useRef',
    'useQuery', 'useMutation', 'useSWR', 'useForm',
    // Vue
    'ref', 'reactive', 'computed', 'watch', 'onMounted',
    // Angular
    'inject', 'signal', 'computed', 'effect',
    // Python
    'Depends', 'login_required', 'fixture',
    // Java
    '@Autowired', '@Transactional', '@GetMapping',
    // C#
    'GetService', 'GetRequiredService', '[Authorize]',
    // PHP
    'Auth::', 'Cache::', 'DB::',
  ];

  return knownPrimitives.some((kp) => name.toLowerCase().includes(kp.toLowerCase()));
}

// =============================================================================
// Naming Detection
// =============================================================================

/**
 * Detect naming patterns in wrapper members
 */
export function detectNamingPatterns(members: WrapperFunction[]): string[] {
  const patterns: string[] = [];
  const names = members.map((m) => m.name);

  // Check for common prefixes
  const prefixes = ['use', 'with', 'create', 'make', 'get', 'fetch', 'load', 'handle', 'on'];
  for (const prefix of prefixes) {
    const matching = names.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()));
    if (matching.length >= members.length * 0.5) {
      patterns.push(`${prefix}*`);
    }
  }

  // Check for common suffixes
  const suffixes = ['Hook', 'Query', 'Mutation', 'Handler', 'Service', 'Provider', 'Factory', 'Wrapper'];
  for (const suffix of suffixes) {
    const matching = names.filter((n) => n.endsWith(suffix));
    if (matching.length >= members.length * 0.5) {
      patterns.push(`*${suffix}`);
    }
  }

  return patterns;
}

// =============================================================================
// Name Generation
// =============================================================================

/**
 * Generate a unique cluster ID
 */
function generateClusterId(signature: string): string {
  // Create a short hash-like ID
  const hash = signature
    .split('+')
    .map((p) => p.slice(0, 3).toLowerCase())
    .join('-');

  return `cluster-${hash}-${signature.length}`;
}

/**
 * Generate a human-readable cluster name
 */
function generateClusterName(
  primitives: string[],
  category: WrapperCategory,
  members: WrapperFunction[]
): string {
  // Try to infer from member names
  const namingPatterns = detectNamingPatterns(members);
  if (namingPatterns.length > 0) {
    const pattern = namingPatterns[0];
    if (pattern.startsWith('use')) return 'Custom Hooks';
    if (pattern.endsWith('Service')) return 'Service Wrappers';
    if (pattern.endsWith('Handler')) return 'Event Handlers';
    if (pattern.endsWith('Query')) return 'Query Hooks';
  }

  // Fall back to category + primitives
  const categoryName = category
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  if (primitives.length <= 2) {
    return `${categoryName} (${primitives.join(' + ')})`;
  }

  return `${categoryName} Wrappers`;
}

/**
 * Generate a description for the cluster
 */
function generateDescription(
  primitives: string[],
  members: WrapperFunction[],
  category: WrapperCategory
): string {
  const memberCount = members.length;
  const fileCount = new Set(members.map((m) => m.file)).size;
  const usageCount = members.reduce((sum, m) => sum + m.calledBy.length, 0);

  const primitiveStr = primitives.length <= 3
    ? primitives.join(', ')
    : `${primitives.slice(0, 3).join(', ')} and ${primitives.length - 3} more`;

  return `${memberCount} wrappers across ${fileCount} files wrapping ${primitiveStr}. Used ${usageCount} times total.`;
}

/**
 * Generate suggested names for the pattern
 */
function generateNameSuggestions(
  primitives: string[],
  category: WrapperCategory,
  members: WrapperFunction[]
): string[] {
  const suggestions: string[] = [];

  // Based on primitives
  if (primitives.includes('useState') && primitives.includes('useEffect')) {
    suggestions.push('Stateful Effect Hooks');
  }
  if (primitives.some((p) => p.toLowerCase().includes('query'))) {
    suggestions.push('Data Query Hooks');
  }
  if (primitives.some((p) => p.toLowerCase().includes('auth'))) {
    suggestions.push('Auth Wrappers');
  }

  // Based on naming patterns
  const patterns = detectNamingPatterns(members);
  for (const pattern of patterns) {
    if (pattern.startsWith('use')) suggestions.push('Custom Hooks');
    if (pattern.endsWith('Service')) suggestions.push('Service Layer');
    if (pattern.endsWith('Repository')) suggestions.push('Repository Pattern');
    if (pattern.endsWith('Factory')) suggestions.push('Factory Pattern');
  }

  // Based on category
  const categoryName = category
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  suggestions.push(`${categoryName} Pattern`);

  return [...new Set(suggestions)];
}

// =============================================================================
// Cluster Utilities
// =============================================================================

/**
 * Get clusters by category
 */
export function getClustersByCategory(
  clusters: WrapperCluster[]
): Map<WrapperCategory, WrapperCluster[]> {
  const byCategory = new Map<WrapperCategory, WrapperCluster[]>();

  for (const cluster of clusters) {
    const existing = byCategory.get(cluster.category) || [];
    byCategory.set(cluster.category, [...existing, cluster]);
  }

  return byCategory;
}

/**
 * Get the most common primitives across all clusters
 */
export function getMostCommonPrimitives(
  clusters: WrapperCluster[],
  limit = 10
): { primitive: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const cluster of clusters) {
    for (const primitive of cluster.primitiveSignature) {
      counts.set(primitive, (counts.get(primitive) || 0) + cluster.wrappers.length);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([primitive, count]) => ({ primitive, count }));
}

/**
 * Find clusters that share primitives
 */
export function findRelatedClusters(
  cluster: WrapperCluster,
  allClusters: WrapperCluster[]
): WrapperCluster[] {
  const clusterPrimitives = new Set(cluster.primitiveSignature);

  return allClusters.filter((c) => {
    if (c.id === cluster.id) return false;
    return c.primitiveSignature.some((p) => clusterPrimitives.has(p));
  });
}
