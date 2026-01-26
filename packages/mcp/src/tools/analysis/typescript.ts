/**
 * TypeScript Analysis MCP Tool
 *
 * Analyze TypeScript/JavaScript projects: routes, components, hooks, error handling, data access.
 */

import {
  createTypeScriptAnalyzer,
  type TypeScriptAnalysisResult,
  type TSRoutesResult,
  type TSComponentsResult,
  type TSHooksResult,
  type TSErrorHandlingResult,
  type TSDataAccessResult,
  type TSDecoratorsResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type TypeScriptAction =
  | 'status'       // Project status overview
  | 'routes'       // HTTP routes analysis
  | 'components'   // React components
  | 'hooks'        // React hooks usage
  | 'errors'       // Error handling patterns
  | 'data-access'  // Database access patterns
  | 'decorators';  // Decorator usage

export interface TypeScriptArgs {
  action: TypeScriptAction;
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

export async function executeTypeScriptTool(
  args: TypeScriptArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createTypeScriptAnalyzer({
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

    case 'components': {
      const componentsResult = await analyzer.analyzeComponents();
      result = formatComponentsResult(componentsResult, limit);
      break;
    }

    case 'hooks': {
      const hooksResult = await analyzer.analyzeHooks();
      result = formatHooksResult(hooksResult, limit);
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

function formatStatusResult(result: TypeScriptAnalysisResult, _limit: number): unknown {
  return {
    project: {
      name: result.projectInfo.name,
      version: result.projectInfo.version,
      files: result.projectInfo.files,
      tsFiles: result.projectInfo.tsFiles,
      jsFiles: result.projectInfo.jsFiles,
      hasTypeScript: result.projectInfo.hasTypeScript,
      hasJavaScript: result.projectInfo.hasJavaScript,
    },
    frameworks: result.detectedFrameworks,
    stats: {
      functions: result.stats.functionCount,
      classes: result.stats.classCount,
      components: result.stats.componentCount,
      hooks: result.stats.hookCount,
      asyncFunctions: result.stats.asyncFunctionCount,
      decorators: result.stats.decoratorCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    summary: `TypeScript/JS project with ${result.stats.fileCount} files, ${result.stats.functionCount} functions, ${result.stats.componentCount} components`,
  };
}

function formatRoutesResult(
  result: TSRoutesResult,
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
      decorators: r.decorators,
    })),
    truncated: routes.length > limit,
    summary: `${routes.length} HTTP routes across ${Object.keys(result.byFramework).length} framework(s)`,
  };
}

function formatComponentsResult(result: TSComponentsResult, limit: number): unknown {
  return {
    total: result.components.length,
    byType: result.byType,
    components: result.components.slice(0, limit).map((c) => ({
      name: c.name,
      type: c.type,
      file: c.file,
      line: c.line,
      props: c.props,
      hooks: c.hooks,
      isExported: c.isExported,
    })),
    truncated: result.components.length > limit,
    summary: `${result.components.length} React components (${result.byType['functional']} functional, ${result.byType['class']} class)`,
  };
}

function formatHooksResult(result: TSHooksResult, limit: number): unknown {
  // Count hook usage
  const hookCounts: Record<string, number> = {};
  for (const hook of result.hooks) {
    hookCounts[hook.name] = (hookCounts[hook.name] ?? 0) + 1;
  }

  return {
    total: result.hooks.length,
    byType: result.byType,
    customHooks: result.customHooks,
    hookUsage: Object.entries(hookCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count })),
    hooks: result.hooks.slice(0, limit).map((h) => ({
      name: h.name,
      type: h.type,
      file: h.file,
      line: h.line,
      dependencies: h.dependencies,
    })),
    truncated: result.hooks.length > limit,
    summary: `${result.hooks.length} hook calls (${result.byType['builtin']} builtin, ${result.byType['custom']} custom), ${result.customHooks.length} custom hooks defined`,
  };
}

function formatErrorsResult(result: TSErrorHandlingResult, limit: number): unknown {
  return {
    stats: {
      tryCatchBlocks: result.stats.tryCatchBlocks,
      promiseCatches: result.stats.promiseCatches,
      errorBoundaries: result.stats.errorBoundaries,
      throwStatements: result.stats.throwStatements,
    },
    patterns: {
      'try-catch': result.patterns.filter((p) => p.type === 'try-catch').length,
      'promise-catch': result.patterns.filter((p) => p.type === 'promise-catch').length,
      'error-boundary': result.patterns.filter((p) => p.type === 'error-boundary').length,
      'throw': result.patterns.filter((p) => p.type === 'throw').length,
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

function formatDataAccessResult(result: TSDataAccessResult, limit: number): unknown {
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

function formatDecoratorsResult(result: TSDecoratorsResult, limit: number): unknown {
  // Count by target
  const byTarget = {
    class: result.decorators.filter((d) => d.target === 'class').length,
    method: result.decorators.filter((d) => d.target === 'method').length,
    property: result.decorators.filter((d) => d.target === 'property').length,
    parameter: result.decorators.filter((d) => d.target === 'parameter').length,
  };

  return {
    total: result.decorators.length,
    byName: result.byName,
    byTarget,
    decorators: result.decorators.slice(0, limit).map((d) => ({
      name: d.name,
      target: d.target,
      file: d.file,
      line: d.line,
      arguments: d.arguments,
    })),
    truncated: result.decorators.length > limit,
    summary: `${result.decorators.length} decorators (${byTarget.class} class, ${byTarget.method} method, ${byTarget.property} property)`,
  };
}
