/**
 * drift_error_handling - Error Handling Analysis
 * 
 * Analysis tool for error handling patterns, boundaries, and gaps.
 * Detects unhandled error paths and swallowed exceptions.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createErrorHandlingAnalyzer,
  createCallGraphAnalyzer,
  type ErrorHandlingSummary,
  type ErrorHandlingMetrics,
  type ErrorHandlingGap,
  type ErrorBoundary,
  type UnhandledErrorPath,
  type FunctionErrorAnalysis,
  type ErrorSeverity,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type ErrorHandlingAction = 
  | 'status'
  | 'gaps'
  | 'boundaries'
  | 'unhandled'
  | 'analyze';

export interface ErrorHandlingArgs {
  action: ErrorHandlingAction;
  function?: string;
  limit?: number;
  minSeverity?: ErrorSeverity;
}

export interface ErrorHandlingStatusData {
  summary: ErrorHandlingSummary;
  metrics: ErrorHandlingMetrics;
  generatedAt?: string;
}

export interface ErrorHandlingGapsData {
  gaps: ErrorHandlingGap[];
  total: number;
  bySeverity: Record<ErrorSeverity, number>;
}

export interface ErrorHandlingBoundariesData {
  boundaries: ErrorBoundary[];
  total: number;
  frameworkBoundaries: number;
}

export interface ErrorHandlingUnhandledData {
  paths: UnhandledErrorPath[];
  total: number;
  bySeverity: Record<ErrorSeverity, number>;
}

export interface ErrorHandlingAnalyzeData {
  function: string;
  analysis: FunctionErrorAnalysis;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const ERROR_HANDLING_DIR = 'error-handling';

// ============================================================================
// Handler
// ============================================================================

export async function handleErrorHandling(
  projectRoot: string,
  args: ErrorHandlingArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'status':
      return handleStatus(projectRoot);
    case 'gaps':
      return handleGaps(projectRoot, args.limit, args.minSeverity);
    case 'boundaries':
      return handleBoundaries(projectRoot);
    case 'unhandled':
      return handleUnhandled(projectRoot, args.minSeverity);
    case 'analyze':
      return handleAnalyze(projectRoot, args.function);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid: status, gaps, boundaries, unhandled, analyze`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleStatus(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ErrorHandlingStatusData>();

  // First try to load cached data
  const dataPath = path.join(projectRoot, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json');
  
  try {
    const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
    const { summary, metrics, topology } = data;
    
    let summaryText = `🛡️ ${summary.totalFunctions} functions. `;
    summaryText += `Coverage: ${summary.coveragePercent}%. `;
    summaryText += `Quality: ${summary.avgQuality}/100. `;
    summaryText += `${summary.unhandledPaths} unhandled paths.`;
    
    const warnings: string[] = [];
    if (summary.criticalUnhandled > 0) {
      warnings.push(`${summary.criticalUnhandled} critical unhandled error paths`);
    }
    if (metrics.swallowedErrorCount > 0) {
      warnings.push(`${metrics.swallowedErrorCount} swallowed errors`);
    }
    
    const hints = {
      nextActions: summary.unhandledPaths > 0
        ? ['Run drift_error_handling action="gaps" to see specific issues']
        : ['Error handling looks good'],
      warnings: warnings.length > 0 ? warnings : undefined,
      relatedTools: ['drift_error_handling action="gaps"', 'drift_error_handling action="boundaries"'],
    };
    
    return builder
      .withSummary(summaryText)
      .withData({ summary, metrics, generatedAt: topology.generatedAt })
      .withHints(hints)
      .buildContent();
      
  } catch {
    // No cached data - try to build on-demand from call graph
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      const summary = analyzer.getSummary();
      const metrics = analyzer.getMetrics();
      
      if (!summary || !metrics) {
        throw new Error('No analysis data available');
      }
      
      let summaryText = `🛡️ ${summary.totalFunctions} functions. `;
      summaryText += `Coverage: ${summary.coveragePercent}%. `;
      summaryText += `Quality: ${summary.avgQuality}/100. `;
      summaryText += `${summary.unhandledPaths} unhandled paths.`;
      
      const warnings: string[] = [];
      if (summary.criticalUnhandled > 0) {
        warnings.push(`${summary.criticalUnhandled} critical unhandled error paths`);
      }
      if (metrics.swallowedErrorCount > 0) {
        warnings.push(`${metrics.swallowedErrorCount} swallowed errors`);
      }
      
      const hints = {
        nextActions: summary.unhandledPaths > 0
          ? ['Run drift_error_handling action="gaps" to see specific issues']
          : ['Error handling looks good'],
        warnings: warnings.length > 0 ? warnings : undefined,
        relatedTools: ['drift_error_handling action="gaps"', 'drift_error_handling action="boundaries"'],
      };
      
      return builder
        .withSummary(summaryText)
        .withData({ summary, metrics })
        .withHints(hints)
        .buildContent();
    } catch {
      // No call graph available - return graceful empty state
      return builder
        .withSummary('🛡️ Error handling analysis not available. Run a scan first.')
        .withData({ 
          summary: { totalFunctions: 0, coveragePercent: 0, avgQuality: 0, unhandledPaths: 0, criticalUnhandled: 0, boundaryCount: 0, avgBoundaryDepth: 0 } as unknown as ErrorHandlingSummary,
          metrics: { swallowedErrorCount: 0, totalTryCatch: 0, totalThrows: 0, totalFunctions: 0, functionsWithTryCatch: 0, functionsThatThrow: 0, boundaryCount: 0, avgCatchBlockSize: 0, avgThrowsPerFunction: 0, rethrowRate: 0, emptyHandlerCount: 0 } as unknown as ErrorHandlingMetrics
        })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase first'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }
}

async function handleGaps(
  projectRoot: string,
  limit?: number,
  minSeverity?: ErrorSeverity
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ErrorHandlingGapsData>();

  const analyzer = await buildAnalyzer(projectRoot);
  const gaps = analyzer.getGaps({
    limit: limit ?? 20,
    minSeverity: minSeverity ?? 'medium',
    includeSuggestions: true,
  });

  const bySeverity: Record<ErrorSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const gap of gaps) {
    bySeverity[gap.severity]++;
  }

  let summaryText = `🔍 ${gaps.length} error handling gaps. `;
  if (bySeverity.critical > 0) {summaryText += `🔴 ${bySeverity.critical} critical. `;}
  if (bySeverity.high > 0) {summaryText += `🟡 ${bySeverity.high} high. `;}

  const hints = {
    nextActions: gaps.length > 0
      ? [`Fix: ${gaps[0]?.suggestion ?? 'Add error handling'}`]
      : ['No gaps found - good error handling!'],
    relatedTools: ['drift_error_handling action="analyze"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ gaps, total: gaps.length, bySeverity })
    .withHints(hints)
    .buildContent();
}

async function handleBoundaries(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ErrorHandlingBoundariesData>();

  // First try cached data
  const dataPath = path.join(projectRoot, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json');
  
  try {
    const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
    const boundaries: ErrorBoundary[] = data.topology.boundaries;
    const frameworkBoundaries = boundaries.filter(b => b.isFrameworkBoundary).length;

    let summaryText = `🛡️ ${boundaries.length} error boundaries. `;
    summaryText += `${frameworkBoundaries} framework boundaries.`;

    const hints = {
      nextActions: boundaries.length === 0
        ? ['Consider adding error boundaries to protect critical paths']
        : ['Review boundary coverage'],
      relatedTools: ['drift_error_handling action="unhandled"'],
    };

    return builder
      .withSummary(summaryText)
      .withData({ boundaries, total: boundaries.length, frameworkBoundaries })
      .withHints(hints)
      .buildContent();

  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      const boundaries = analyzer.getBoundaries();
      const frameworkBoundaries = boundaries.filter(b => b.isFrameworkBoundary).length;

      let summaryText = `🛡️ ${boundaries.length} error boundaries. `;
      summaryText += `${frameworkBoundaries} framework boundaries.`;

      const hints = {
        nextActions: boundaries.length === 0
          ? ['Consider adding error boundaries to protect critical paths']
          : ['Review boundary coverage'],
        relatedTools: ['drift_error_handling action="unhandled"'],
      };

      return builder
        .withSummary(summaryText)
        .withData({ boundaries, total: boundaries.length, frameworkBoundaries })
        .withHints(hints)
        .buildContent();
    } catch {
      // Return empty state
      return builder
        .withSummary('🛡️ No error boundaries detected. Run a scan first.')
        .withData({ boundaries: [], total: 0, frameworkBoundaries: 0 })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }
}

async function handleUnhandled(
  projectRoot: string,
  minSeverity?: ErrorSeverity
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ErrorHandlingUnhandledData>();

  // First try cached data
  const dataPath = path.join(projectRoot, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json');
  
  let paths: UnhandledErrorPath[] = [];
  
  try {
    const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
    paths = data.topology.unhandledPaths;
  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      paths = analyzer.getUnhandledPaths();
    } catch {
      // Return empty state
      return builder
        .withSummary('⚠️ No unhandled error path analysis available. Run a scan first.')
        .withData({ paths: [], total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }

  // Filter by severity
  if (minSeverity) {
    const severityOrder: Record<ErrorSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const minOrder = severityOrder[minSeverity];
    paths = paths.filter(p => severityOrder[p.severity] <= minOrder);
  }

  const bySeverity: Record<ErrorSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const p of paths) {
    bySeverity[p.severity]++;
  }

  let summaryText = `⚠️ ${paths.length} unhandled error paths. `;
  if (bySeverity.critical > 0) {summaryText += `🔴 ${bySeverity.critical} critical. `;}
  if (bySeverity.high > 0) {summaryText += `🟡 ${bySeverity.high} high.`;}

  const hints = {
    nextActions: paths.length > 0
      ? [`Add error boundary at: ${paths[0]?.suggestedBoundary ?? 'entry point'}`]
      : ['All error paths are handled!'],
    warnings: bySeverity.critical > 0
      ? ['Critical unhandled paths can cause application crashes']
      : undefined,
    relatedTools: ['drift_error_handling action="boundaries"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ paths, total: paths.length, bySeverity })
    .withHints(hints)
    .buildContent();
}

async function handleAnalyze(
  projectRoot: string,
  funcPath?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ErrorHandlingAnalyzeData>();

  if (!funcPath) {
    throw Errors.missingParameter('function');
  }

  const analyzer = await buildAnalyzer(projectRoot);
  const analysis = analyzer.getFunctionAnalysis(funcPath);

  if (!analysis) {
    throw Errors.custom(
      'FUNCTION_NOT_FOUND',
      `Function not found: ${funcPath}`,
      ['Check the function path']
    );
  }

  const { profile, issues } = analysis;
  
  let summaryText = `🔍 ${funcPath}: `;
  summaryText += profile.hasTryCatch ? 'Has error handling. ' : 'No error handling. ';
  summaryText += `Quality: ${profile.qualityScore}/100. `;
  summaryText += `${issues.length} issues.`;

  const hints = {
    nextActions: analysis.suggestions,
    warnings: issues.length > 0
      ? issues.map(i => i.message)
      : undefined,
    relatedTools: ['drift_error_handling action="gaps"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ function: funcPath, analysis })
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

async function buildAnalyzer(projectRoot: string) {
  const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
  await callGraphAnalyzer.initialize();
  const callGraph = callGraphAnalyzer.getGraph();

  if (!callGraph) {
    throw Errors.custom(
      'NO_CALL_GRAPH',
      'Call graph required for error handling analysis',
      ['drift callgraph build']
    );
  }

  const analyzer = createErrorHandlingAnalyzer({ rootDir: projectRoot });
  analyzer.setCallGraph(callGraph);
  analyzer.build();

  return analyzer;
}
