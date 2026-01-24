/**
 * WPF Analysis MCP Tool
 *
 * Analyze WPF applications: bindings, MVVM compliance, data flow.
 */

import {
  createWpfAnalyzer,
  createWpfDataFlowTracer,
  createValueConverterExtractor,
  type WpfAnalysisResult,
  type MvvmComplianceResult,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type WpfAction = 
  | 'status'       // Project status overview
  | 'bindings'     // List all bindings
  | 'mvvm'         // MVVM compliance check
  | 'datacontext'  // DataContext resolution
  | 'commands'     // Command analysis
  | 'flow'         // Data flow tracing
  | 'converters';  // Value converter analysis

export interface WpfArgs {
  action: WpfAction;
  path?: string;
  unresolvedOnly?: boolean;
  limit?: number;
  element?: string;  // For flow action
}

export interface ToolContext {
  projectRoot: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export async function executeWpfTool(
  args: WpfArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const analyzer = createWpfAnalyzer({
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

    case 'bindings': {
      const analysisResult = await analyzer.analyze();
      result = formatBindingsResult(analysisResult, args.unresolvedOnly, limit);
      break;
    }

    case 'mvvm': {
      const complianceResult = await analyzer.checkMvvmCompliance();
      result = formatMvvmResult(complianceResult, limit);
      break;
    }

    case 'datacontext': {
      const analysisResult = await analyzer.analyze();
      result = formatDataContextResult(analysisResult, limit);
      break;
    }

    case 'commands': {
      const analysisResult = await analyzer.analyze();
      result = formatCommandsResult(analysisResult, limit);
      break;
    }

    case 'flow': {
      if (!args.element) {
        throw new Error('Element name required for flow tracing');
      }
      const analysisResult = await analyzer.analyze();
      const tracer = createWpfDataFlowTracer();
      tracer.initialize(analysisResult.xamlFiles, analysisResult.viewModels, analysisResult.links);
      const flow = tracer.trace(args.element);
      result = {
        element: flow.element,
        steps: flow.steps.map(s => ({
          type: s.type,
          location: s.location,
          file: s.file,
          line: s.line,
          details: s.details,
        })),
        reachesDatabase: flow.reachesDatabase,
        sensitiveDataAccessed: flow.sensitiveDataAccessed,
        depth: flow.depth,
        confidence: flow.confidence,
        summary: `Data flow trace for '${args.element}': ${flow.steps.length} steps, ${flow.reachesDatabase ? 'reaches database' : 'no database access'}`,
      };
      break;
    }

    case 'converters': {
      const extractor = createValueConverterExtractor();
      const converterResult = await extractor.analyzeProject(projectPath);
      result = {
        total: converterResult.converters.length,
        totalUsages: converterResult.totalUsages,
        converters: converterResult.converters.slice(0, limit).map(c => ({
          className: c.className,
          qualifiedName: c.qualifiedName,
          type: c.converterType,
          resourceKeys: c.resourceKeys,
          hasConvert: c.convertMethod?.hasImplementation ?? false,
          hasConvertBack: c.convertBackMethod?.hasImplementation ?? false,
          usageCount: c.usages.length,
          file: c.filePath,
          line: c.location.line,
        })),
        truncated: converterResult.converters.length > limit,
        summary: `${converterResult.converters.length} value converters with ${converterResult.totalUsages} total usages`,
      };
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

function formatStatusResult(result: WpfAnalysisResult, limit: number): unknown {
  return {
    project: result.project ? {
      projectFile: result.project.projectFile,
      targetFramework: result.project.targetFramework,
      xamlFileCount: result.project.xamlFiles.length,
      viewModelCount: result.project.viewModels.length,
      converterCount: result.project.converters.length,
    } : null,
    stats: {
      xamlFilesAnalyzed: result.stats.xamlFileCount,
      viewModelsFound: result.stats.viewModelCount,
      totalBindings: result.stats.totalBindings,
      resolvedBindings: result.stats.resolvedBindings,
      unresolvedBindings: result.stats.unresolvedBindings,
      totalCommands: result.stats.totalCommands,
      analysisTimeMs: Math.round(result.stats.analysisTimeMs),
    },
    viewModels: Array.from(result.viewModels.values())
      .slice(0, limit)
      .map(vm => ({
        name: vm.className,
        qualifiedName: vm.qualifiedName,
        properties: vm.properties.length,
        commands: vm.commands.length,
        implementsINPC: vm.implementsINPC,
        file: vm.filePath,
      })),
    summary: `WPF project with ${result.stats.xamlFileCount} XAML files, ${result.stats.viewModelCount} ViewModels, ${result.stats.totalBindings} bindings (${result.stats.resolvedBindings} resolved, ${result.stats.unresolvedBindings} unresolved)`,
  };
}

function formatBindingsResult(
  result: WpfAnalysisResult,
  unresolvedOnly: boolean | undefined,
  limit: number
): unknown {
  const resolved = result.links.map(link => ({
    xamlFile: link.xamlFile,
    element: link.xamlElement,
    bindingPath: link.bindingPath,
    viewModel: link.viewModelClass,
    property: link.viewModelProperty,
    propertyType: link.propertyType,
    notifiesChange: link.notifiesChange,
    confidence: link.confidence,
    resolved: true,
  }));

  const unresolved = result.bindingErrors.map(error => ({
    xamlFile: error.xamlFile,
    bindingPath: error.bindingPath,
    line: error.line,
    error: error.message,
    suggestion: error.suggestion,
    resolved: false,
  }));

  const bindings = unresolvedOnly
    ? unresolved
    : [...resolved, ...unresolved];

  return {
    total: result.stats.totalBindings,
    resolved: result.stats.resolvedBindings,
    unresolved: result.stats.unresolvedBindings,
    resolutionRate: result.stats.totalBindings > 0
      ? Math.round((result.stats.resolvedBindings / result.stats.totalBindings) * 100)
      : 100,
    bindings: bindings.slice(0, limit),
    truncated: bindings.length > limit,
  };
}

function formatMvvmResult(result: MvvmComplianceResult, limit: number): unknown {
  return {
    score: result.score,
    status: result.score >= 80 ? 'good' : result.score >= 60 ? 'needs-improvement' : 'poor',
    violationCount: result.violations.length,
    violations: result.violations.slice(0, limit).map(v => ({
      type: v.type,
      severity: v.severity,
      file: v.file,
      line: v.line,
      message: v.message,
      suggestion: v.suggestion,
    })),
    recommendations: result.recommendations,
    summary: `MVVM compliance score: ${result.score}/100 with ${result.violations.length} violation(s)`,
  };
}

function formatDataContextResult(result: WpfAnalysisResult, limit: number): unknown {
  const resolutions = result.dataContexts.map(dc => ({
    xamlFile: dc.xamlFile,
    resolvedType: dc.resolvedType,
    confidence: dc.confidence,
    resolutionPath: dc.resolutionPath.map(step => ({
      source: step.source,
      type: step.type,
    })),
  }));

  const resolved = resolutions.filter(r => r.resolvedType !== null);
  const unresolved = resolutions.filter(r => r.resolvedType === null);

  return {
    total: resolutions.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
    views: resolutions.slice(0, limit),
    truncated: resolutions.length > limit,
    summary: `${resolved.length}/${resolutions.length} views have resolved DataContext`,
  };
}

interface CommandInfo {
  name: string;
  viewModel: string;
  executeMethod: string | undefined;
  canExecuteMethod: string | undefined;
  isAsync: boolean | undefined;
  commandType: string;
  file: string;
  line: number;
}

function formatCommandsResult(result: WpfAnalysisResult, limit: number): unknown {
  const commands: CommandInfo[] = [];

  for (const vm of result.viewModels.values()) {
    for (const cmd of vm.commands) {
      commands.push({
        name: cmd.name,
        viewModel: vm.className,
        executeMethod: cmd.executeMethod,
        canExecuteMethod: cmd.canExecuteMethod,
        isAsync: cmd.isAsync,
        commandType: cmd.commandType,
        file: vm.filePath,
        line: cmd.location.line,
      });
    }
  }

  // Group by ViewModel
  const byViewModel = new Map<string, CommandInfo[]>();
  for (const cmd of commands) {
    const existing = byViewModel.get(cmd.viewModel) ?? [];
    existing.push(cmd);
    byViewModel.set(cmd.viewModel, existing);
  }

  return {
    total: commands.length,
    byViewModel: Object.fromEntries(
      Array.from(byViewModel.entries())
        .slice(0, limit)
        .map(([vm, cmds]) => [vm, cmds])
    ),
    commands: commands.slice(0, limit),
    truncated: commands.length > limit,
    summary: `${commands.length} commands across ${byViewModel.size} ViewModels`,
  };
}
