/**
 * Wrappers Tool
 *
 * MCP tool for detecting framework wrapper patterns.
 * Identifies custom abstractions built on top of framework primitives.
 */

import {
  createWrapperScanner,
  type WrapperCategory,
} from 'driftdetect-core/wrappers';

import { createResponseBuilder } from '../../infrastructure/index.js';

// =============================================================================
// Types
// =============================================================================

export interface WrappersArgs {
  /** Filter by category */
  category?: WrapperCategory;
  /** Minimum cluster confidence (0-1) */
  minConfidence?: number;
  /** Minimum cluster size */
  minClusterSize?: number;
  /** Maximum wrapper depth */
  maxDepth?: number;
  /** Include test files */
  includeTests?: boolean;
  /** Maximum clusters to return */
  limit?: number;
}

export interface WrappersData {
  /** Summary statistics */
  summary: {
    totalWrappers: number;
    totalClusters: number;
    avgDepth: number;
    maxDepth: number;
    mostWrappedPrimitive: string;
    mostUsedWrapper: string;
  };
  /** Detected frameworks */
  frameworks: Array<{
    name: string;
    primitiveCount: number;
  }>;
  /** Wrapper clusters */
  clusters: ClusterSummary[];
  /** Top wrappers by usage */
  topWrappers: WrapperSummary[];
  /** Category breakdown */
  byCategory: Record<string, number>;
  /** Scan duration */
  duration: number;
}

export interface ClusterSummary {
  id: string;
  name: string;
  description: string;
  category: WrapperCategory;
  confidence: number;
  wrapperCount: number;
  avgDepth: number;
  totalUsages: number;
  primitives: string[];
  suggestedNames: string[];
  /** Sample wrappers (first 3) */
  sampleWrappers: Array<{
    name: string;
    file: string;
    line: number;
    depth: number;
    usages: number;
  }>;
}

export interface WrapperSummary {
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  depth: number;
  usages: number;
  primitives: string[];
  category?: WrapperCategory | undefined;
  isFactory: boolean;
  isHigherOrder: boolean;
  isDecorator: boolean;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Handle wrappers tool request
 */
export async function handleWrappers(
  args: WrappersArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<WrappersData>();
  
  const {
    category,
    minConfidence = 0.5,
    minClusterSize = 2,
    maxDepth = 10,
    includeTests = false,
    limit = 20,
  } = args;

  // Create scanner
  const scanner = createWrapperScanner({
    rootDir,
    includeTestFiles: includeTests,
    verbose: false,
  });

  // Run scan
  const result = await scanner.scan({
    minConfidence,
    minClusterSize,
    maxDepth,
    includeTestFiles: includeTests,
  });

  // Filter by category if specified
  let clusters = result.analysis.clusters;
  if (category) {
    clusters = clusters.filter((c) => c.category === category);
  }

  // Sort by confidence and limit
  clusters = clusters
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);

  // Build cluster summaries
  const clusterSummaries: ClusterSummary[] = clusters.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    confidence: c.confidence,
    wrapperCount: c.wrappers.length,
    avgDepth: c.avgDepth,
    totalUsages: c.totalUsages,
    primitives: c.primitiveSignature.slice(0, 5),
    suggestedNames: c.suggestedNames,
    sampleWrappers: c.wrappers.slice(0, 3).map((w) => ({
      name: w.name,
      file: w.file,
      line: w.line,
      depth: w.depth,
      usages: w.calledBy.length,
    })),
  }));

  // Get top wrappers by usage
  const topWrappers = [...result.analysis.wrappers]
    .sort((a, b) => b.calledBy.length - a.calledBy.length)
    .slice(0, 10)
    .map((w) => {
      // Find which cluster this wrapper belongs to
      const cluster = result.analysis.clusters.find((c) =>
        c.wrappers.some((cw) => cw.qualifiedName === w.qualifiedName)
      );

      return {
        name: w.name,
        qualifiedName: w.qualifiedName,
        file: w.file,
        line: w.line,
        depth: w.depth,
        usages: w.calledBy.length,
        primitives: w.primitiveSignature.slice(0, 3),
        category: cluster?.category,
        isFactory: w.isFactory,
        isHigherOrder: w.isHigherOrder,
        isDecorator: w.isDecorator,
      };
    });

  // Build category breakdown
  const byCategory: Record<string, number> = {};
  for (const [cat, count] of Object.entries(result.analysis.summary.wrappersByCategory)) {
    if (count > 0) {
      byCategory[cat] = count;
    }
  }

  const data: WrappersData = {
    summary: {
      totalWrappers: result.analysis.summary.totalWrappers,
      totalClusters: result.analysis.summary.totalClusters,
      avgDepth: result.analysis.summary.avgDepth,
      maxDepth: result.analysis.summary.maxDepth,
      mostWrappedPrimitive: result.analysis.summary.mostWrappedPrimitive,
      mostUsedWrapper: result.analysis.summary.mostUsedWrapper,
    },
    frameworks: result.analysis.frameworks.map((f) => ({
      name: f.name,
      primitiveCount: f.primitiveCount,
    })),
    clusters: clusterSummaries,
    topWrappers,
    byCategory,
    duration: result.duration,
  };

  const summary = `Found ${data.summary.totalWrappers} wrappers in ${data.summary.totalClusters} clusters. Avg depth: ${data.summary.avgDepth.toFixed(1)}`;

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: data.summary.totalWrappers > 0
        ? ['Review wrapper clusters for potential consolidation']
        : ['No wrappers detected'],
      relatedTools: ['drift_patterns_list', 'drift_code_examples'],
    })
    .buildContent();
}

/**
 * Handle wrappers tool with project config lookup
 */
export async function handleWrappersWithConfig(
  args: WrappersArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return handleWrappers(args, rootDir);
}
