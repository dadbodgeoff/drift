/**
 * drift_impact_analysis - Code Change Impact Analysis
 * 
 * Detail tool that analyzes the impact of changing a file or function.
 * Shows affected callers, entry points, and sensitive data paths.
 */

import {
  createCallGraphAnalyzer,
  createImpactAnalyzer,
  type ImpactAnalysisResult,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

export interface AffectedCaller {
  name: string;
  file: string;
  line: number;
  depth: number;
  isEntryPoint: boolean;
  accessesSensitiveData: boolean;
}

export interface SensitivePath {
  table: string;
  fields: string[];
  operation: string;
  sensitivity: string;
  entryPoint: string;
  pathLength: number;
}

export interface ImpactData {
  target: {
    type: 'file' | 'function';
    name: string;
  };
  risk: {
    level: string;
    score: number;
  };
  summary: {
    directCallers: number;
    transitiveCallers: number;
    affectedEntryPoints: number;
    sensitiveDataPaths: number;
    maxDepth: number;
  };
  entryPoints: AffectedCaller[];
  sensitiveDataPaths: SensitivePath[];
  directCallers: AffectedCaller[];
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_LIMIT = 10;

export async function handleImpactAnalysis(
  projectRoot: string,
  args: {
    target: string;
    maxDepth?: number;
    limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ImpactData>();
  
  if (!args.target) {
    throw Errors.missingParameter('target');
  }
  
  const maxDepth = args.maxDepth ?? DEFAULT_MAX_DEPTH;
  const limit = args.limit ?? DEFAULT_LIMIT;
  
  // Initialize call graph analyzer
  const analyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
  await analyzer.initialize();
  
  const graph = analyzer.getGraph();
  if (!graph) {
    throw Errors.custom(
      'NO_CALL_GRAPH',
      'No call graph found. Run drift_callgraph action="build" first.',
      ['drift_callgraph action="build"']
    );
  }
  
  // Create impact analyzer
  const impactAnalyzer = createImpactAnalyzer(graph);
  
  // Determine if target is a file or function
  const isFile = args.target.includes('/') || 
                 args.target.endsWith('.py') || 
                 args.target.endsWith('.ts') || 
                 args.target.endsWith('.tsx') ||
                 args.target.endsWith('.js') ||
                 args.target.endsWith('.jsx');
  
  let result: ImpactAnalysisResult;
  if (isFile) {
    result = impactAnalyzer.analyzeFile(args.target, { maxDepth });
  } else {
    result = impactAnalyzer.analyzeFunctionByName(args.target, { maxDepth });
  }
  
  // Map entry points
  // Transform __module__ to <module-level> for cleaner display
  const entryPoints: AffectedCaller[] = result.entryPoints
    .slice(0, limit)
    .map(ep => ({
      name: ep.qualifiedName === '__module__' ? '<module-level>' : ep.qualifiedName,
      file: ep.file,
      line: ep.line,
      depth: ep.depth,
      isEntryPoint: true,
      accessesSensitiveData: ep.accessesSensitiveData,
    }));
  
  // Map sensitive data paths
  const sensitiveDataPaths: SensitivePath[] = result.sensitiveDataPaths
    .slice(0, limit)
    .map(dp => ({
      table: dp.table,
      fields: dp.fields,
      operation: dp.operation,
      sensitivity: dp.sensitivity,
      entryPoint: dp.entryPoint,
      pathLength: dp.fullPath.length,
    }));
  
  // Map direct callers
  // Transform __module__ to <module-level> for cleaner display
  const directCallers: AffectedCaller[] = result.affected
    .filter(a => a.depth === 1)
    .slice(0, limit)
    .map(c => ({
      name: c.qualifiedName === '__module__' ? '<module-level>' : c.qualifiedName,
      file: c.file,
      line: c.line,
      depth: c.depth,
      isEntryPoint: c.isEntryPoint,
      accessesSensitiveData: c.accessesSensitiveData,
    }));
  
  const data: ImpactData = {
    target: {
      type: isFile ? 'file' : 'function',
      name: args.target,
    },
    risk: {
      level: result.risk,
      score: result.riskScore,
    },
    summary: {
      directCallers: result.summary.directCallers,
      transitiveCallers: result.summary.transitiveCallers,
      affectedEntryPoints: result.summary.affectedEntryPoints,
      sensitiveDataPaths: result.summary.affectedDataPaths,
      maxDepth: result.summary.maxDepth,
    },
    entryPoints,
    sensitiveDataPaths,
    directCallers,
  };
  
  // Build summary
  const riskEmoji = result.risk === 'critical' ? '🔴' :
                    result.risk === 'high' ? '🟠' :
                    result.risk === 'medium' ? '🟡' : '🟢';
  
  let summary = `${riskEmoji} ${result.risk.toUpperCase()} risk (${result.riskScore}/100). `;
  summary += `${result.summary.directCallers} direct callers, `;
  summary += `${result.summary.affectedEntryPoints} entry points affected`;
  if (result.summary.affectedDataPaths > 0) {
    summary += `, ${result.summary.affectedDataPaths} sensitive data paths`;
  }
  summary += '.';
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      result.summary.affectedEntryPoints > 0 
        ? 'Review affected entry points before merging'
        : 'Low impact - safe to proceed',
      'Use drift_reachability to trace data access paths',
    ],
    relatedTools: ['drift_reachability', 'drift_callgraph'],
  };
  
  if (result.risk === 'critical' || result.risk === 'high') {
    hints.warnings = [];
    if (result.sensitiveDataPaths.length > 0) {
      hints.warnings.push('Sensitive data paths affected - review security implications');
    }
    if (result.summary.affectedEntryPoints > 5) {
      hints.warnings.push('Many entry points affected - consider incremental rollout');
    }
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}
