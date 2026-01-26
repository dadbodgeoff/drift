/**
 * Java Analysis MCP Tool
 *
 * Analyze Java projects: routes, error handling, data access, annotations.
 */

import {
  createJavaAnalyzer,
  type JavaAnalysisResult,
  type JavaRoutesResult,
  type JavaErrorHandlingResult,
  type JavaDataAccessResult,
  type JavaAnnotationsResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type JavaAction =
  | 'status'       // Project status overview
  | 'routes'       // HTTP routes analysis
  | 'errors'       // Error handling patterns
  | 'data-access'  // Database access patterns
  | 'annotations'; // Annotation usage

export interface JavaArgs {
  action: JavaAction;
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

export async function executeJavaTool(
  args: JavaArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createJavaAnalyzer({
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

    case 'annotations': {
      const annotationsResult = await analyzer.analyzeAnnotations();
      result = formatAnnotationsResult(annotationsResult, limit);
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

function formatStatusResult(result: JavaAnalysisResult, _limit: number): unknown {
  return {
    project: {
      name: result.projectInfo.name,
      version: result.projectInfo.version,
      files: result.projectInfo.files,
      buildTool: result.projectInfo.buildTool,
    },
    frameworks: result.detectedFrameworks,
    stats: {
      classes: result.stats.classCount,
      interfaces: result.stats.interfaceCount,
      methods: result.stats.methodCount,
      annotations: result.stats.annotationCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    summary: `Java project with ${result.stats.fileCount} files, ${result.stats.classCount} classes, ${result.stats.methodCount} methods`,
  };
}

function formatRoutesResult(
  result: JavaRoutesResult,
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
      annotations: r.annotations,
    })),
    truncated: routes.length > limit,
    summary: `${routes.length} HTTP routes across ${Object.keys(result.byFramework).length} framework(s)`,
  };
}

function formatErrorsResult(result: JavaErrorHandlingResult, limit: number): unknown {
  return {
    stats: {
      tryCatchBlocks: result.stats.tryCatchBlocks,
      throwStatements: result.stats.throwStatements,
      customExceptions: result.stats.customExceptions,
      exceptionHandlers: result.stats.exceptionHandlers,
    },
    patterns: {
      'try-catch': result.patterns.filter((p) => p.type === 'try-catch').length,
      'throw': result.patterns.filter((p) => p.type === 'throw').length,
      'custom-exception': result.patterns.filter((p) => p.type === 'custom-exception').length,
      'exception-handler': result.patterns.filter((p) => p.type === 'exception-handler').length,
    },
    issues: result.issues.slice(0, limit).map((i) => ({
      type: i.type,
      file: i.file,
      line: i.line,
      message: i.message,
      suggestion: i.suggestion,
    })),
    summary: `${result.stats.tryCatchBlocks} try-catch blocks, ${result.issues.length} potential issues`,
  };
}

function formatDataAccessResult(result: JavaDataAccessResult, limit: number): unknown {
  return {
    total: result.accessPoints.length,
    byFramework: result.byFramework,
    byOperation: result.byOperation,
    repositories: result.repositories,
    accessPoints: result.accessPoints.slice(0, limit).map((a) => ({
      entity: a.entity,
      operation: a.operation,
      framework: a.framework,
      file: a.file,
      line: a.line,
      isRawSql: a.isRawSql,
    })),
    truncated: result.accessPoints.length > limit,
    summary: `${result.accessPoints.length} data access points across ${result.repositories.length} repositories`,
  };
}

function formatAnnotationsResult(result: JavaAnnotationsResult, limit: number): unknown {
  const byTarget = {
    class: result.annotations.filter((a) => a.target === 'class').length,
    method: result.annotations.filter((a) => a.target === 'method').length,
    field: result.annotations.filter((a) => a.target === 'field').length,
    parameter: result.annotations.filter((a) => a.target === 'parameter').length,
  };

  return {
    total: result.annotations.length,
    byName: result.byName,
    byTarget,
    annotations: result.annotations.slice(0, limit).map((a) => ({
      name: a.name,
      target: a.target,
      file: a.file,
      line: a.line,
      arguments: a.arguments,
    })),
    truncated: result.annotations.length > limit,
    summary: `${result.annotations.length} annotations (${byTarget.class} class, ${byTarget.method} method, ${byTarget.field} field)`,
  };
}
