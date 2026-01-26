/**
 * PHP Analysis MCP Tool
 *
 * Analyze PHP projects: routes, error handling, data access, traits.
 */

import {
  createPhpAnalyzer,
  type PhpAnalysisResult,
  type PhpRoutesResult,
  type PhpErrorHandlingResult,
  type PhpDataAccessResult,
  type PhpTraitsResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type PhpAction =
  | 'status'       // Project status overview
  | 'routes'       // HTTP routes analysis
  | 'errors'       // Error handling patterns
  | 'data-access'  // Database access patterns
  | 'traits';      // Trait usage

export interface PhpArgs {
  action: PhpAction;
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

export async function executePhpTool(
  args: PhpArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createPhpAnalyzer({
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

    case 'traits': {
      const traitsResult = await analyzer.analyzeTraits();
      result = formatTraitsResult(traitsResult, limit);
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

function formatStatusResult(result: PhpAnalysisResult, _limit: number): unknown {
  return {
    project: {
      name: result.projectInfo.name,
      version: result.projectInfo.version,
      files: result.projectInfo.files,
      framework: result.projectInfo.framework,
    },
    frameworks: result.detectedFrameworks,
    stats: {
      classes: result.stats.classCount,
      traits: result.stats.traitCount,
      interfaces: result.stats.interfaceCount,
      functions: result.stats.functionCount,
      methods: result.stats.methodCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    summary: `PHP project with ${result.stats.fileCount} files, ${result.stats.classCount} classes, ${result.stats.methodCount} methods`,
  };
}

function formatRoutesResult(
  result: PhpRoutesResult,
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
      middleware: r.middleware,
    })),
    truncated: routes.length > limit,
    summary: `${routes.length} HTTP routes across ${Object.keys(result.byFramework).length} framework(s)`,
  };
}

function formatErrorsResult(result: PhpErrorHandlingResult, limit: number): unknown {
  return {
    stats: {
      tryCatchBlocks: result.stats.tryCatchBlocks,
      throwStatements: result.stats.throwStatements,
      customExceptions: result.stats.customExceptions,
      errorHandlers: result.stats.errorHandlers,
    },
    patterns: {
      'try-catch': result.patterns.filter((p) => p.type === 'try-catch').length,
      'throw': result.patterns.filter((p) => p.type === 'throw').length,
      'custom-exception': result.patterns.filter((p) => p.type === 'custom-exception').length,
      'error-handler': result.patterns.filter((p) => p.type === 'error-handler').length,
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

function formatDataAccessResult(result: PhpDataAccessResult, limit: number): unknown {
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

function formatTraitsResult(result: PhpTraitsResult, limit: number): unknown {
  return {
    traits: result.traits.slice(0, limit).map((t) => ({
      name: t.name,
      file: t.file,
      line: t.line,
      methods: t.methods,
    })),
    usages: result.usages.slice(0, limit).map((u) => ({
      trait: u.trait,
      usedIn: u.usedIn,
      file: u.file,
      line: u.line,
    })),
    stats: {
      traitsDefined: result.traits.length,
      traitUsages: result.usages.length,
    },
    truncated: result.traits.length > limit || result.usages.length > limit,
    summary: `${result.traits.length} traits defined, ${result.usages.length} trait usages`,
  };
}
