/**
 * C++ Analysis MCP Tool
 *
 * Analyze C++ projects: classes, memory management, templates, virtual functions.
 *
 * @license Apache-2.0
 */

import {
  createCppAnalyzer,
  type CppAnalyzerOptions,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export type CppAction =
  | 'status'        // Project status overview
  | 'classes'       // Class and struct analysis
  | 'memory'        // Memory management patterns
  | 'templates'     // Template analysis
  | 'virtual';      // Virtual function analysis

export interface CppArgs {
  action: CppAction;
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

export async function executeCppTool(
  args: CppArgs,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;

  const options: CppAnalyzerOptions = {
    rootDir: projectPath,
    verbose: false,
  };

  const analyzer = createCppAnalyzer(options);

  let result: unknown;

  switch (args.action) {
    case 'status': {
      const analysisResult = await analyzer.analyze();
      result = formatStatusResult(analysisResult, limit);
      break;
    }

    case 'classes': {
      const classResult = await analyzer.analyzeClasses();
      result = formatClassesResult(classResult, limit);
      break;
    }

    case 'memory': {
      const memoryResult = await analyzer.analyzeMemory();
      result = formatMemoryResult(memoryResult, limit);
      break;
    }

    case 'templates': {
      const templateResult = await analyzer.analyzeTemplates();
      result = formatTemplatesResult(templateResult, limit);
      break;
    }

    case 'virtual': {
      const virtualResult = await analyzer.analyzeVirtual();
      result = formatVirtualResult(virtualResult, limit);
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
  result: Awaited<ReturnType<ReturnType<typeof createCppAnalyzer>['analyze']>>,
  _limit: number
): object {
  return {
    project: {
      name: result.projectName ?? 'unknown',
      cppStandard: result.cppStandard ?? 'unknown',
      frameworks: result.detectedFrameworks,
    },
    stats: {
      files: result.stats.fileCount,
      headers: result.stats.headerCount,
      sources: result.stats.sourceCount,
      functions: result.stats.functionCount,
      classes: result.stats.classCount,
      structs: result.stats.structCount,
      templates: result.stats.templateCount,
      virtualMethods: result.stats.virtualMethodCount,
      linesOfCode: result.stats.linesOfCode,
      testFiles: result.stats.testFileCount,
    },
    modules: result.modules.map(m => ({
      name: m.name,
      files: m.files.length,
      functions: m.functions.length,
    })),
    analysisTimeMs: result.stats.analysisTimeMs,
  };
}

function formatClassesResult(
  result: Awaited<ReturnType<ReturnType<typeof createCppAnalyzer>['analyzeClasses']>>,
  limit: number
): object {
  return {
    summary: {
      totalClasses: result.byKind['class'] ?? 0,
      totalStructs: result.byKind['struct'] ?? 0,
    },
    classes: result.classes.slice(0, limit).map(c => ({
      name: c.name,
      kind: c.kind,
      file: c.file,
      line: c.line,
      baseClasses: c.baseClasses,
      virtualMethods: c.virtualMethods,
      isTemplate: c.isTemplate,
    })),
    inheritanceDepth: Object.fromEntries(
      Object.entries(result.inheritanceDepth)
        .filter(([, depth]) => depth > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
    ),
    truncated: result.classes.length > limit,
  };
}

function formatMemoryResult(
  result: Awaited<ReturnType<ReturnType<typeof createCppAnalyzer>['analyzeMemory']>>,
  limit: number
): object {
  return {
    summary: {
      smartPointers: {
        uniquePtr: result.stats.uniquePtrs,
        sharedPtr: result.stats.sharedPtrs,
        weakPtr: result.stats.weakPtrs,
      },
      manualMemory: {
        newCalls: result.stats.newCalls,
        deleteCalls: result.stats.deleteCalls,
        mallocCalls: result.stats.mallocCalls,
        freeCalls: result.stats.freeCalls,
        rawPointers: result.stats.rawPointers,
      },
    },
    raiiClasses: result.raiiClasses.slice(0, limit),
    issues: result.issues.slice(0, limit).map(i => ({
      type: i.type,
      message: i.message,
      file: i.file,
      line: i.line,
      suggestion: i.suggestion,
    })),
    patterns: result.patterns
      .filter(p => p.isIssue)
      .slice(0, limit)
      .map(p => ({
        type: p.type,
        file: p.file,
        line: p.line,
        suggestion: p.suggestion,
      })),
    truncated: result.patterns.length > limit,
  };
}

function formatTemplatesResult(
  result: Awaited<ReturnType<ReturnType<typeof createCppAnalyzer>['analyzeTemplates']>>,
  limit: number
): object {
  return {
    summary: {
      templateClasses: result.byKind['class'] ?? 0,
      templateFunctions: result.byKind['function'] ?? 0,
    },
    templates: result.templates.slice(0, limit).map(t => ({
      name: t.name,
      kind: t.kind,
      file: t.file,
      line: t.line,
      parameters: t.parameters,
    })),
    mostSpecialized: result.mostSpecialized,
    truncated: result.templates.length > limit,
  };
}

function formatVirtualResult(
  result: Awaited<ReturnType<ReturnType<typeof createCppAnalyzer>['analyzeVirtual']>>,
  limit: number
): object {
  return {
    summary: {
      virtualMethods: result.virtualMethods.length,
      abstractClasses: result.abstractClasses.length,
      polymorphicHierarchies: result.polymorphicHierarchies.length,
    },
    abstractClasses: result.abstractClasses.slice(0, limit),
    polymorphicHierarchies: result.polymorphicHierarchies.slice(0, limit).map(h => ({
      baseClass: h.baseClass,
      derivedClasses: h.derivedClasses,
      depth: h.depth,
    })),
    virtualMethods: result.virtualMethods.slice(0, limit).map(m => ({
      name: m.name,
      className: m.className,
      file: m.file,
      line: m.line,
      isPureVirtual: m.isPureVirtual,
    })),
    truncated: result.virtualMethods.length > limit,
  };
}

// ============================================================================
// Tool Definition
// ============================================================================

export const cppToolDefinition = {
  name: 'drift_cpp',
  description: `Analyze C++ projects for patterns, classes, memory management, and polymorphism.

Actions:
- status: Project overview with stats and detected frameworks
- classes: Class and struct analysis with inheritance
- memory: Memory management patterns (smart pointers, RAII, manual allocation)
- templates: Template classes and functions
- virtual: Virtual functions and polymorphic hierarchies`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'classes', 'memory', 'templates', 'virtual'],
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
        description: 'Filter by framework (Qt, Boost, Unreal Engine)',
      },
    },
    required: ['action'],
  },
};
