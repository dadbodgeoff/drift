/**
 * Rust Analysis MCP Tool
 *
 * Analyze Rust projects: routes, error handling, traits, data access, async patterns.
 *
 * @license Apache-2.0
 */

import {
  createRustAnalyzer,
  type RustAnalyzerOptions,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type RustAction =
  | 'status'        // Project status overview
  | 'routes'        // HTTP route analysis
  | 'errors'        // Error handling patterns
  | 'traits'        // Trait analysis
  | 'data-access'   // Database access patterns
  | 'async';        // Async pattern analysis

export interface RustArgs {
  action: RustAction;
  path?: string;
  limit?: number;
  framework?: string;  // Filter by framework
}

export interface ToolContext {
  projectRoot: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export async function executeRustTool(
  args: RustArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const options: RustAnalyzerOptions = {
    rootDir: projectPath,
    verbose: false,
  };

  const analyzer = createRustAnalyzer(options);

  let result: unknown;

  switch (args.action) {
    case 'status': {
      const analysisResult = await analyzer.analyze();
      result = formatStatusResult(analysisResult, limit);
      break;
    }

    case 'routes': {
      const routeResult = await analyzer.analyzeRoutes();
      result = formatRoutesResult(routeResult, args.framework, limit);
      break;
    }

    case 'errors': {
      const errorResult = await analyzer.analyzeErrorHandling();
      result = formatErrorsResult(errorResult, limit);
      break;
    }

    case 'traits': {
      const traitResult = await analyzer.analyzeTraits();
      result = formatTraitsResult(traitResult, limit);
      break;
    }

    case 'data-access': {
      const dataResult = await analyzer.analyzeDataAccess();
      result = formatDataAccessResult(dataResult, args.framework, limit);
      break;
    }

    case 'async': {
      const asyncResult = await analyzer.analyzeAsync();
      result = formatAsyncResult(asyncResult, limit);
      break;
    }

    default:
      throw new Error(`Unknown action: ${args.action}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// ============================================================================
// Result Formatters
// ============================================================================

function formatStatusResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyze']>>,
  _limit: number
): object {
  return {
    project: {
      name: result.crateName ?? 'unknown',
      edition: result.edition ?? 'unknown',
      frameworks: result.detectedFrameworks,
    },
    stats: {
      files: result.stats.fileCount,
      functions: result.stats.functionCount,
      structs: result.stats.structCount,
      traits: result.stats.traitCount,
      enums: result.stats.enumCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      testFunctions: result.stats.testFunctionCount,
    },
    crates: result.crates.map(c => ({
      name: c.name,
      files: c.files.length,
      functions: c.functions.length,
    })),
    analysisTimeMs: result.stats.analysisTimeMs,
  };
}

function formatRoutesResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyzeRoutes']>>,
  framework: string | undefined,
  limit: number
): object {
  let routes = result.routes;

  // Filter by framework if specified
  if (framework) {
    routes = routes.filter(r => r.framework === framework);
  }

  return {
    summary: {
      totalRoutes: routes.length,
      byFramework: result.byFramework,
    },
    routes: routes.slice(0, limit).map(r => ({
      method: r.method,
      path: r.path,
      handler: r.handler,
      file: r.file,
      line: r.line,
      framework: r.framework,
    })),
    truncated: routes.length > limit,
  };
}

function formatErrorsResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyzeErrorHandling']>>,
  limit: number
): object {
  return {
    summary: {
      resultTypes: result.stats.resultTypes,
      customErrors: result.stats.customErrors,
      thiserrorDerives: result.stats.thiserrorDerives,
      anyhowUsage: result.stats.anyhowUsage,
      unwrapCalls: result.stats.unwrapCalls,
      expectCalls: result.stats.expectCalls,
    },
    patterns: result.patterns.slice(0, limit).map(p => ({
      type: p.type,
      file: p.file,
      line: p.line,
      context: p.context.slice(0, 100),
    })),
    customErrors: result.customErrors.slice(0, limit).map(e => ({
      name: e.name,
      file: e.file,
      line: e.line,
      variants: e.variants,
    })),
    issues: result.issues.slice(0, limit).map(i => ({
      message: i.message,
      file: i.file,
      line: i.line,
      suggestion: i.suggestion,
    })),
    truncated: result.patterns.length > limit || result.issues.length > limit,
  };
}

function formatTraitsResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyzeTraits']>>,
  limit: number
): object {
  return {
    summary: {
      totalTraits: result.traits.length,
      totalImplementations: result.implementations.length,
    },
    traits: result.traits.slice(0, limit).map(t => ({
      name: t.name,
      file: t.file,
      line: t.line,
      methods: t.methods,
      implementations: t.implementations,
    })),
    implementations: result.implementations.slice(0, limit).map(i => ({
      trait: i.traitName,
      for: i.forType,
      file: i.file,
      line: i.line,
    })),
    truncated: result.traits.length > limit || result.implementations.length > limit,
  };
}

function formatDataAccessResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyzeDataAccess']>>,
  framework: string | undefined,
  limit: number
): object {
  let accessPoints = result.accessPoints;

  // Filter by framework if specified
  if (framework) {
    accessPoints = accessPoints.filter(a => a.framework === framework);
  }

  return {
    summary: {
      totalAccessPoints: accessPoints.length,
      tables: result.tables,
      byFramework: result.byFramework,
      byOperation: result.byOperation,
    },
    accessPoints: accessPoints.slice(0, limit).map(a => ({
      table: a.table,
      operation: a.operation,
      framework: a.framework,
      file: a.file,
      line: a.line,
    })),
    truncated: accessPoints.length > limit,
  };
}

function formatAsyncResult(
  result: Awaited<ReturnType<ReturnType<typeof createRustAnalyzer>['analyzeAsync']>>,
  limit: number
): object {
  return {
    summary: {
      runtime: result.runtime ?? 'unknown',
      asyncFunctions: result.stats.asyncFunctions,
      awaitPoints: result.stats.awaitPoints,
      spawnedTasks: result.stats.spawnedTasks,
      channels: result.stats.channels,
      mutexes: result.stats.mutexes,
    },
    asyncFunctions: result.asyncFunctions.slice(0, limit).map(f => ({
      name: f.name,
      file: f.file,
      line: f.line,
      hasAwait: f.hasAwait,
    })),
    issues: result.issues.slice(0, limit).map(i => ({
      message: i.message,
      file: i.file,
      line: i.line,
      type: i.type,
    })),
    truncated: result.asyncFunctions.length > limit,
  };
}

// ============================================================================
// Tool Definition
// ============================================================================

export const rustToolDefinition = {
  name: 'drift_rust',
  description: `Analyze Rust projects for patterns, routes, error handling, and data access.

Actions:
- status: Project overview with stats and detected frameworks
- routes: HTTP route analysis (Actix, Axum, Rocket, Warp)
- errors: Error handling patterns (Result, thiserror, anyhow)
- traits: Trait definitions and implementations
- data-access: Database access patterns (SQLx, Diesel, SeaORM)
- async: Async patterns and runtime analysis`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'routes', 'errors', 'traits', 'data-access', 'async'],
        description: 'Analysis action to perform',
      },
      path: {
        type: 'string',
        description: 'Project path (defaults to current project)',
      },
      limit: {
        type: 'number',
        description: 'Maximum items to return (default: 50)',
      },
      framework: {
        type: 'string',
        description: 'Filter by framework (for routes and data-access)',
      },
    },
    required: ['action'],
  },
};
