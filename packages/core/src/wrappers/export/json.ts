/**
 * JSON Export Format for Wrapper Analysis
 *
 * Provides structured JSON output for wrapper detection results.
 */

import type {
  WrapperAnalysisResult,
  WrapperFunction,
  WrapperCluster,
  DetectedPrimitive,
  FrameworkInfo,
  WrapperCategory,
  SupportedLanguage,
} from '../types.js';

// =============================================================================
// Export Types
// =============================================================================

export interface WrapperExportOptions {
  /** Include full wrapper details (default: true) */
  includeWrappers?: boolean | undefined;
  /** Include primitive details (default: true) */
  includePrimitives?: boolean | undefined;
  /** Include cluster details (default: true) */
  includeClusters?: boolean | undefined;
  /** Include summary statistics (default: true) */
  includeSummary?: boolean | undefined;
  /** Pretty print JSON (default: false) */
  prettyPrint?: boolean | undefined;
  /** Indent size for pretty print (default: 2) */
  indentSize?: number | undefined;
}

export interface WrapperExportResult {
  /** Export format version */
  version: string;
  /** Export timestamp */
  exportedAt: string;
  /** Project metadata */
  project: ProjectMetadata;
  /** Framework information */
  frameworks: FrameworkExport[];
  /** Detected primitives */
  primitives?: PrimitiveExport[] | undefined;
  /** Detected wrappers */
  wrappers?: WrapperExport[] | undefined;
  /** Wrapper clusters */
  clusters?: ClusterExport[] | undefined;
  /** Summary statistics */
  summary?: SummaryExport | undefined;
}

export interface ProjectMetadata {
  /** Project root path */
  path?: string | undefined;
  /** Primary language */
  language: SupportedLanguage;
  /** Total files analyzed */
  filesAnalyzed?: number | undefined;
}

export interface FrameworkExport {
  name: string;
  version?: string | undefined;
  primitiveCount: number;
  language: SupportedLanguage;
}

export interface PrimitiveExport {
  name: string;
  framework: string;
  category: string;
  usageCount: number;
  confidence: number;
}

export interface WrapperExport {
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  depth: number;
  primitives: string[];
  calledBy: string[];
  callsWrappers: string[];
  flags: WrapperFlags;
}

export interface WrapperFlags {
  isFactory: boolean;
  isHigherOrder: boolean;
  isDecorator: boolean;
  isAsync: boolean;
}

export interface ClusterExport {
  id: string;
  name: string;
  description: string;
  category: WrapperCategory;
  confidence: number;
  primitiveSignature: string[];
  wrapperCount: number;
  wrappers: string[];
  metrics: ClusterMetrics;
  suggestedNames: string[];
}

export interface ClusterMetrics {
  avgDepth: number;
  maxDepth: number;
  totalUsages: number;
  fileSpread: number;
}

export interface SummaryExport {
  totalWrappers: number;
  totalClusters: number;
  avgDepth: number;
  maxDepth: number;
  mostWrappedPrimitive: string;
  mostUsedWrapper: string;
  wrappersByLanguage: Record<SupportedLanguage, number>;
  wrappersByCategory: Record<WrapperCategory, number>;
}

// =============================================================================
// Export Functions
// =============================================================================

const EXPORT_VERSION = '1.0.0';

/**
 * Export wrapper analysis results to JSON format
 */
export function exportToJson(
  result: WrapperAnalysisResult,
  options: WrapperExportOptions = {}
): string {
  const {
    includeWrappers = true,
    includePrimitives = true,
    includeClusters = true,
    includeSummary = true,
    prettyPrint = false,
    indentSize = 2,
  } = options;

  const exportResult = buildExportResult(result, {
    includeWrappers,
    includePrimitives,
    includeClusters,
    includeSummary,
  });

  return prettyPrint
    ? JSON.stringify(exportResult, null, indentSize)
    : JSON.stringify(exportResult);
}

/**
 * Build the export result object
 */
export function buildExportResult(
  result: WrapperAnalysisResult,
  options: {
    includeWrappers: boolean;
    includePrimitives: boolean;
    includeClusters: boolean;
    includeSummary: boolean;
  }
): WrapperExportResult {
  const language = result.frameworks[0]?.language ?? 'typescript';

  const exportResult: WrapperExportResult = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      language,
    },
    frameworks: result.frameworks.map(exportFramework),
  };

  if (options.includePrimitives) {
    exportResult.primitives = result.primitives.map(exportPrimitive);
  }

  if (options.includeWrappers) {
    exportResult.wrappers = result.wrappers.map(exportWrapper);
  }

  if (options.includeClusters) {
    exportResult.clusters = result.clusters.map(exportCluster);
  }

  if (options.includeSummary) {
    exportResult.summary = exportSummary(result.summary);
  }

  return exportResult;
}

/**
 * Export a framework info object
 */
function exportFramework(fw: FrameworkInfo): FrameworkExport {
  return {
    name: fw.name,
    version: fw.version,
    primitiveCount: fw.primitiveCount,
    language: fw.language,
  };
}

/**
 * Export a primitive object
 */
function exportPrimitive(p: DetectedPrimitive): PrimitiveExport {
  return {
    name: p.name,
    framework: p.framework,
    category: p.category,
    usageCount: p.usageCount,
    confidence: p.source.confidence,
  };
}

/**
 * Export a wrapper function object
 */
function exportWrapper(w: WrapperFunction): WrapperExport {
  return {
    name: w.name,
    qualifiedName: w.qualifiedName,
    file: w.file,
    line: w.line,
    depth: w.depth,
    primitives: w.primitiveSignature,
    calledBy: w.calledBy,
    callsWrappers: w.callsWrappers,
    flags: {
      isFactory: w.isFactory,
      isHigherOrder: w.isHigherOrder,
      isDecorator: w.isDecorator,
      isAsync: w.isAsync,
    },
  };
}

/**
 * Export a cluster object
 */
function exportCluster(c: WrapperCluster): ClusterExport {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    confidence: c.confidence,
    primitiveSignature: c.primitiveSignature,
    wrapperCount: c.wrappers.length,
    wrappers: c.wrappers.map((w) => w.qualifiedName),
    metrics: {
      avgDepth: c.avgDepth,
      maxDepth: c.maxDepth,
      totalUsages: c.totalUsages,
      fileSpread: c.fileSpread,
    },
    suggestedNames: c.suggestedNames,
  };
}

/**
 * Export summary statistics
 */
function exportSummary(s: WrapperAnalysisResult['summary']): SummaryExport {
  return {
    totalWrappers: s.totalWrappers,
    totalClusters: s.totalClusters,
    avgDepth: s.avgDepth,
    maxDepth: s.maxDepth,
    mostWrappedPrimitive: s.mostWrappedPrimitive,
    mostUsedWrapper: s.mostUsedWrapper,
    wrappersByLanguage: { ...s.wrappersByLanguage },
    wrappersByCategory: { ...s.wrappersByCategory },
  };
}

// =============================================================================
// Import Functions (for loading saved results)
// =============================================================================

/**
 * Parse JSON export back to analysis result
 * Note: This is a partial reconstruction - some data may be lost
 */
export function parseJsonExport(json: string): Partial<WrapperExportResult> {
  const parsed = JSON.parse(json) as WrapperExportResult;

  // Validate version
  if (!parsed.version) {
    throw new Error('Invalid export format: missing version');
  }

  return parsed;
}

/**
 * Validate export format
 */
export function validateExport(data: unknown): data is WrapperExportResult {
  if (typeof data !== 'object' || data === null) {return false;}

  const obj = data as Record<string, unknown>;

  return (
    typeof obj['version'] === 'string' &&
    typeof obj['exportedAt'] === 'string' &&
    typeof obj['project'] === 'object' &&
    Array.isArray(obj['frameworks'])
  );
}
