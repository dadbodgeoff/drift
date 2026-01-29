/**
 * drift_errors - Error Types Lookup
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 800 max
 * 
 * Returns custom error classes and error handling patterns.
 * Solves: AI needs to know existing error types when adding error handling.
 */

import { createErrorHandlingAnalyzer } from 'driftdetect-core';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, ErrorHandlingGap, ErrorBoundary } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface ErrorsArgs {
  /** Action: types, gaps, boundaries */
  action?: 'types' | 'gaps' | 'boundaries';
  /** Filter by severity for gaps: critical, high, medium, low */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Max results */
  limit?: number;
}

export interface ErrorTypeInfo {
  name: string;
  file: string;
  line: number;
  extends?: string | undefined;
  properties: string[];
  usages: number;
}

export interface ErrorGapInfo {
  function: string;
  file: string;
  line: number;
  gapType: string;
  severity: string;
  suggestion: string;
}

export interface ErrorBoundaryInfo {
  function: string;
  file: string;
  line: number;
  handledTypes: string[];
  coverage: number;
  isFramework: boolean;
}

export interface ErrorsData {
  action: string;
  errorTypes?: ErrorTypeInfo[] | undefined;
  gaps?: ErrorGapInfo[] | undefined;
  boundaries?: ErrorBoundaryInfo[] | undefined;
  stats: {
    totalTypes?: number | undefined;
    totalGaps?: number | undefined;
    totalBoundaries?: number | undefined;
    criticalGaps?: number | undefined;
    avgCoverage?: number | undefined;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleErrors(
  store: CallGraphStore,
  args: ErrorsArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<ErrorsData>();
  
  const action = args.action ?? 'types';
  const severityFilter = args.severity ?? 'medium';
  const limit = args.limit ?? 20;
  
  // Initialize call graph
  await store.initialize();
  const graph = store.getGraph();
  
  if (!graph) {
    throw Errors.custom(
      'CALLGRAPH_NOT_BUILT',
      'Call graph has not been built. Run "drift callgraph build" first.',
      ['drift_status']
    );
  }
  
  // Create error handling analyzer
  const analyzer = createErrorHandlingAnalyzer({ rootDir });
  analyzer.setCallGraph(graph);
  
  let data: ErrorsData;
  
  switch (action) {
    case 'types':
      data = await getErrorTypes(graph, limit);
      break;
    case 'gaps':
      data = getErrorGaps(analyzer, severityFilter, limit);
      break;
    case 'boundaries':
      data = getErrorBoundaries(analyzer, limit);
      break;
    default:
      throw Errors.invalidArgument('action', `Unknown action: ${action}`, 'Use: types, gaps, or boundaries');
  }
  
  // Build summary based on action
  let summary: string;
  switch (action) {
    case 'types':
      summary = data.errorTypes?.length
        ? `Found ${data.errorTypes.length} custom error types`
        : 'No custom error types found';
      break;
    case 'gaps':
      summary = data.gaps?.length
        ? `Found ${data.gaps.length} error handling gaps (${data.stats.criticalGaps ?? 0} critical)`
        : 'No error handling gaps found';
      break;
    case 'boundaries':
      summary = data.boundaries?.length
        ? `Found ${data.boundaries.length} error boundaries (avg coverage: ${data.stats.avgCoverage?.toFixed(0) ?? 0}%)`
        : 'No error boundaries found';
      break;
    default:
      summary = 'Error analysis complete';
  }
  
  // Record metrics
  metrics.recordRequest('drift_errors', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: getNextActions(action, data),
      relatedTools: ['drift_error_handling', 'drift_signature', 'drift_imports'],
    })
    .buildContent();
}

// ============================================================================
// Action Handlers
// ============================================================================

async function getErrorTypes(
  graph: { functions: Map<string, any>; classes?: Map<string, any> },
  limit: number
): Promise<ErrorsData> {
  const errorTypes: ErrorTypeInfo[] = [];
  
  // Find error classes from the call graph
  // Look for classes that extend Error or have Error in name
  for (const [, func] of graph.functions) {
    // Check if this is a class constructor for an error
    if (func.className && isErrorClass(func.className)) {
      // Check if we already have this error type
      if (!errorTypes.some(e => e.name === func.className)) {
        errorTypes.push({
          name: func.className,
          file: func.file,
          line: func.startLine,
          extends: detectErrorBase(func),
          properties: extractErrorProperties(func),
          usages: countErrorUsages(graph, func.className),
        });
      }
    }
    
    // Also check for throw statements with custom errors
    if (func.name === 'constructor' && func.className && isErrorClass(func.className)) {
      if (!errorTypes.some(e => e.name === func.className)) {
        errorTypes.push({
          name: func.className,
          file: func.file,
          line: func.startLine,
          extends: 'Error',
          properties: extractErrorProperties(func),
          usages: countErrorUsages(graph, func.className),
        });
      }
    }
  }
  
  // Sort by usages
  errorTypes.sort((a, b) => b.usages - a.usages);
  
  return {
    action: 'types',
    errorTypes: errorTypes.slice(0, limit),
    stats: {
      totalTypes: errorTypes.length,
    },
  };
}

function getErrorGaps(
  analyzer: ReturnType<typeof createErrorHandlingAnalyzer>,
  severity: string,
  limit: number
): ErrorsData {
  // Build topology first
  try {
    analyzer.build();
  } catch {
    // Topology might already be built or graph issues
  }
  
  const gaps = analyzer.getGaps({
    minSeverity: severity as any,
    limit,
    includeSuggestions: true,
  });
  
  const gapInfos: ErrorGapInfo[] = gaps.map((gap: ErrorHandlingGap) => ({
    function: gap.name,
    file: gap.file,
    line: gap.line,
    gapType: gap.gapType,
    severity: gap.severity,
    suggestion: gap.suggestion,
  }));
  
  const criticalCount = gaps.filter((g: ErrorHandlingGap) => g.severity === 'critical').length;
  
  return {
    action: 'gaps',
    gaps: gapInfos,
    stats: {
      totalGaps: gaps.length,
      criticalGaps: criticalCount,
    },
  };
}

function getErrorBoundaries(
  analyzer: ReturnType<typeof createErrorHandlingAnalyzer>,
  limit: number
): ErrorsData {
  // Build topology first
  try {
    analyzer.build();
  } catch {
    // Topology might already be built or graph issues
  }
  
  const boundaries = analyzer.getBoundaries({ includeFramework: true });
  
  const boundaryInfos: ErrorBoundaryInfo[] = boundaries.slice(0, limit).map((b: ErrorBoundary) => ({
    function: b.name,
    file: b.file,
    line: b.line,
    handledTypes: b.handledTypes,
    coverage: b.coverage,
    isFramework: b.isFrameworkBoundary,
  }));
  
  const avgCoverage = boundaries.length > 0
    ? boundaries.reduce((sum: number, b: ErrorBoundary) => sum + b.coverage, 0) / boundaries.length
    : 0;
  
  return {
    action: 'boundaries',
    boundaries: boundaryInfos,
    stats: {
      totalBoundaries: boundaries.length,
      avgCoverage,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isErrorClass(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('error') || 
         lower.includes('exception') ||
         lower.endsWith('err');
}

function detectErrorBase(func: any): string | undefined {
  // Try to detect what the error extends
  if (func.extends) {return func.extends;}
  
  // Common patterns
  const name = func.className?.toLowerCase() ?? '';
  if (name.includes('http')) {return 'HttpError';}
  if (name.includes('validation')) {return 'ValidationError';}
  if (name.includes('auth')) {return 'AuthError';}
  if (name.includes('notfound')) {return 'NotFoundError';}
  
  return 'Error';
}

function extractErrorProperties(func: any): string[] {
  const props: string[] = [];
  
  // Extract from parameters
  if (func.parameters) {
    for (const param of func.parameters) {
      if (param !== 'message' && param !== 'options') {
        props.push(param);
      }
    }
  }
  
  return props.slice(0, 5);
}

function countErrorUsages(graph: { functions: Map<string, any> }, errorName: string): number {
  let count = 0;
  
  for (const [, func] of graph.functions) {
    // Check if function throws this error type
    for (const call of func.calls ?? []) {
      if (call.calleeName === errorName || call.calleeName?.includes(errorName)) {
        count++;
      }
    }
  }
  
  return count;
}

function getNextActions(action: string, data: ErrorsData): string[] {
  switch (action) {
    case 'types':
      return data.errorTypes?.length
        ? ['Use existing error types instead of creating new ones', 'Check error hierarchy for consistency']
        : ['Consider creating custom error types for better error handling'];
    case 'gaps':
      return data.gaps?.length
        ? ['Address critical gaps first', 'Add try/catch blocks to unprotected functions']
        : ['Error handling coverage looks good'];
    case 'boundaries':
      return data.boundaries?.length
        ? ['Review boundary coverage', 'Ensure all entry points have error boundaries']
        : ['Consider adding error boundaries at API entry points'];
    default:
      return [];
  }
}

/**
 * Tool definition for MCP registration
 */
export const errorsToolDefinition = {
  name: 'drift_errors',
  description: 'Find custom error types, error handling gaps, and error boundaries. Use action="types" for error classes, action="gaps" for missing error handling, action="boundaries" for catch locations.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['types', 'gaps', 'boundaries'],
        description: 'What to look up: types (error classes), gaps (missing handling), boundaries (catch locations). Default: types',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Minimum severity for gaps (default: medium)',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 20)',
      },
    },
  },
};
