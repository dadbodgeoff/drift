/**
 * Python Analysis MCP Tool
 *
 * Analyze Python projects: routes, error handling, data access, async patterns.
 */

import {
  createPythonAnalyzer,
  type PythonAnalysisResult,
  type PyRoutesResult,
  type PyErrorHandlingResult,
  type PyDataAccessResult,
  type PyDecoratorsResult,
  type PyAsyncResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type PythonAction =
  | 'status'       // Project status overview
  | 'routes'       // HTTP routes analysis
  | 'errors'       // Error handling patterns
  | 'data-access'  // Database access patterns
  | 'decorators'   // Decorator usage
  | 'async';       // Async patterns

export interface PythonArgs {
  action: PythonAction;
  path?: string;
  framework?: string;
  limit?: number;
}

export interface ToolContext {
  projectRoot: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export async function executePythonTool(
  args: PythonArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createPythonAnalyzer({
    rootDir: projectPath,
    verbose: false,
  });

  let result: unknown;

  switch (args.action) {
    case 'status': {
      const analysisResult = await analyzer.analyze();
      result = formatStatusResult(analysisResult, limit);
      break;
    }

    case 'routes': {
      const routesResult = await analyzer.analyzeRoutes();
      result = formatRoutesResult(routesResult, args.framework, limit);
      break;
    }

    case 'errors': {
      const errorsResult = await analyzer.analyzeErrorHandling();
      result = formatErrorsResult(errorsResult, limit);
      break;
    }

    case 'data-access': {
      const dataAccessResult = await analyzer.analyzeDataAccess();
      result = formatDataAccessResult(dataAccessResult, limit);
      break;
    }

    case 'decorators': {
      const decoratorsResult = await analyzer.analyzeDecorators();
      result = formatDecoratorsResult(decoratorsResult, limit);
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
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

// ============================================================================
// Result Formatters
// ============================================================================

function formatStatusResult(result: PythonAnalysisResult, _limit: number): unknown {
  return {
    project: {
      name: result.projectInfo.name,
      version: result.projectInfo.version,
      files: result.projectInfo.files,
    },
    frameworks: result.detectedFrameworks,
    stats: {
      functions: result.stats.functionCount,
      classes: result.stats.classCount,
      asyncFunctions: result.stats.asyncFunctionCount,
      decorators: result.stats.decoratorCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    summary: `Python project with ${result.stats.fileCount} files, ${result.stats.functionCount} functions, ${result.stats.classCount} classes`,
  };
}

function formatRoutesResult(
  result: PyRoutesResult,
  framework: string | undefined,
  limit: number
): unknown {
  let routes = result.routes;

  if (framework) {
    routes = routes.filter((r) => r.framework === framework);
  }

  return {
    total: routes.length,
    byFramework: result.byFramework,
    routes: routes.slice(0, limit).map((r) => ({
      method: r.method,
      path: r.path,
      handler: r.handler,
      framework: r.framework,
      file: r.file,
      line: r.line,
      decorators: r.decorators,
    })),
    truncated: routes.length > limit,
    summary: `${routes.length} HTTP routes across ${Object.keys(result.byFramework).length} framework(s)`,
  };
}

function formatErrorsResult(result: PyErrorHandlingResult, limit: number): unknown {
  return {
    stats: {
      tryExceptBlocks: result.stats.tryExceptBlocks,
      raiseStatements: result.stats.raiseStatements,
      customExceptions: result.stats.customExceptions,
      contextManagers: result.stats.contextManagers,
    },
    patterns: {
      'try-except': result.patterns.filter((p) => p.type === 'try-except').length,
      'raise': result.patterns.filter((p) => p.type === 'raise').length,
      'custom-exception': result.patterns.filter((p) => p.type === 'custom-exception').length,
      'context-manager': result.patterns.filter((p) => p.type === 'context-manager').length,
    },
    issues: result.issues.slice(0, limit).map((i) => ({
      type: i.type,
      file: i.file,
      line: i.line,
      message: i.message,
      suggestion: i.suggestion,
    })),
    summary: `${result.stats.tryExceptBlocks} try-except blocks, ${result.issues.length} potential issues`,
  };
}

function formatDataAccessResult(result: PyDataAccessResult, limit: number): unknown {
  return {
    total: result.accessPoints.length,
    byFramework: result.byFramework,
    byOperation: result.byOperation,
    models: result.models,
    accessPoints: result.accessPoints.slice(0, limit).map((a) => ({
      model: a.model,
      operation: a.operation,
      framework: a.framework,
      file: a.file,
      line: a.line,
      isRawSql: a.isRawSql,
    })),
    truncated: result.accessPoints.length > limit,
    summary: `${result.accessPoints.length} data access points across ${result.models.length} models`,
  };
}

function formatDecoratorsResult(result: PyDecoratorsResult, limit: number): unknown {
  return {
    total: result.decorators.length,
    byName: result.byName,
    decorators: result.decorators.slice(0, limit).map((d) => ({
      name: d.name,
      file: d.file,
      line: d.line,
      arguments: d.arguments,
    })),
    truncated: result.decorators.length > limit,
    summary: `${result.decorators.length} decorators across ${Object.keys(result.byName).length} unique names`,
  };
}

function formatAsyncResult(result: PyAsyncResult, limit: number): unknown {
  return {
    asyncFunctions: result.asyncFunctions.slice(0, limit).map((f) => ({
      name: f.name,
      file: f.file,
      line: f.line,
      awaitCount: f.awaitCount,
    })),
    stats: {
      asyncFunctions: result.asyncFunctions.length,
      awaitCalls: result.awaitCalls,
      asyncContextManagers: result.asyncContextManagers,
    },
    truncated: result.asyncFunctions.length > limit,
    summary: `${result.asyncFunctions.length} async functions with ${result.awaitCalls} await calls`,
  };
}
