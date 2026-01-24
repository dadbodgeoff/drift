/**
 * Go Analysis MCP Tool
 *
 * Analyze Go projects: routes, error handling, interfaces, data access, goroutines.
 */

import {
  createGoAnalyzer,
  type GoAnalysisResult,
  type GoRoutesResult,
  type GoErrorHandlingResult,
  type GoInterfacesResult,
  type GoDataAccessResult,
  type GoGoroutinesResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type GoAction =
  | 'status'       // Project status overview
  | 'routes'       // HTTP routes analysis
  | 'errors'       // Error handling patterns
  | 'interfaces'   // Interface analysis
  | 'data-access'  // Database access patterns
  | 'goroutines';  // Goroutine/concurrency analysis

export interface GoArgs {
  action: GoAction;
  path?: string;
  framework?: string;  // Filter by framework
  limit?: number;
}

export interface ToolContext {
  projectRoot: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export async function executeGoTool(
  args: GoArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createGoAnalyzer({
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

    case 'interfaces': {
      const interfacesResult = await analyzer.analyzeInterfaces();
      result = formatInterfacesResult(interfacesResult, limit);
      break;
    }

    case 'data-access': {
      const dataAccessResult = await analyzer.analyzeDataAccess();
      result = formatDataAccessResult(dataAccessResult, limit);
      break;
    }

    case 'goroutines': {
      const goroutinesResult = await analyzer.analyzeGoroutines();
      result = formatGoroutinesResult(goroutinesResult, limit);
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

function formatStatusResult(result: GoAnalysisResult, limit: number): unknown {
  return {
    project: {
      moduleName: result.moduleName,
      goVersion: result.goVersion,
      packages: result.packages.length,
      files: result.stats.fileCount,
      functions: result.stats.functionCount,
      structs: result.stats.structCount,
      interfaces: result.stats.interfaceCount,
    },
    frameworks: result.detectedFrameworks,
    stats: {
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      testFunctions: result.stats.testFunctionCount,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    topPackages: result.packages
      .slice(0, limit)
      .map((pkg) => ({
        name: pkg.name,
        path: pkg.path,
        files: pkg.files.length,
        functions: pkg.functions.length,
      })),
    summary: `Go project with ${result.stats.fileCount} files, ${result.stats.functionCount} functions, ${result.stats.structCount} structs`,
  };
}

function formatRoutesResult(
  result: GoRoutesResult,
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

function formatErrorsResult(result: GoErrorHandlingResult, limit: number): unknown {
  return {
    stats: {
      errorChecks: result.stats.errorChecks,
      wrappedErrors: result.stats.wrappedErrors,
      sentinelErrors: result.stats.sentinelErrors,
      customErrorTypes: result.stats.customErrorTypes,
      uncheckedErrors: result.stats.uncheckedErrors,
    },
    patterns: {
      propagated: result.patterns.filter((p) => p.type === 'propagated').length,
      wrapped: result.patterns.filter((p) => p.type === 'wrapped').length,
      logged: result.patterns.filter((p) => p.type === 'logged').length,
      ignored: result.patterns.filter((p) => p.type === 'ignored').length,
    },
    issues: result.issues.slice(0, limit).map((i) => ({
      type: i.type,
      file: i.file,
      line: i.line,
      message: i.message,
      suggestion: i.suggestion,
    })),
    sentinelErrors: result.sentinelErrors.slice(0, limit).map((e) => ({
      name: e.name,
      message: e.message,
      file: e.file,
      line: e.line,
    })),
    customErrors: result.customErrors.slice(0, limit).map((e) => ({
      name: e.name,
      implementsError: e.implementsError,
      file: e.file,
      line: e.line,
    })),
    summary: `${result.stats.errorChecks} error checks, ${result.issues.length} potential issues`,
  };
}

function formatInterfacesResult(result: GoInterfacesResult, limit: number): unknown {
  return {
    total: result.interfaces.length,
    interfaces: result.interfaces.slice(0, limit).map((i) => ({
      name: i.name,
      package: i.package,
      methods: i.methods,
      implementations: i.implementations,
      file: i.file,
      line: i.line,
    })),
    implementations: result.implementations.slice(0, limit).map((impl) => ({
      struct: impl.struct,
      interface: impl.interface,
      file: impl.file,
      line: impl.line,
    })),
    truncated: result.interfaces.length > limit,
    summary: `${result.interfaces.length} interfaces with ${result.implementations.length} implementations`,
  };
}

function formatDataAccessResult(result: GoDataAccessResult, limit: number): unknown {
  return {
    total: result.accessPoints.length,
    byFramework: result.byFramework,
    byOperation: result.byOperation,
    tables: result.tables,
    accessPoints: result.accessPoints.slice(0, limit).map((a) => ({
      table: a.table,
      operation: a.operation,
      framework: a.framework,
      file: a.file,
      line: a.line,
      isRawSql: a.isRawSql,
    })),
    truncated: result.accessPoints.length > limit,
    summary: `${result.accessPoints.length} data access points across ${result.tables.length} tables`,
  };
}

function formatGoroutinesResult(result: GoGoroutinesResult, limit: number): unknown {
  return {
    total: result.goroutines.length,
    stats: {
      goStatements: result.stats.goStatements,
      channels: result.stats.channels,
      mutexes: result.stats.mutexes,
      waitGroups: result.stats.waitGroups,
    },
    goroutines: result.goroutines.slice(0, limit).map((g) => ({
      file: g.file,
      line: g.line,
      function: g.function,
      hasRecover: g.hasRecover,
      channelOps: g.channelOps,
    })),
    potentialIssues: result.issues.slice(0, limit).map((i) => ({
      type: i.type,
      file: i.file,
      line: i.line,
      message: i.message,
    })),
    truncated: result.goroutines.length > limit,
    summary: `${result.goroutines.length} goroutines, ${result.issues.length} potential concurrency issues`,
  };
}
