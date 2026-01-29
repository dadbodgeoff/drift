/**
 * drift_package_context - Package-Scoped AI Context Generation
 * 
 * @license Apache-2.0
 * 
 * Generates AI-optimized context for specific packages in a monorepo.
 * Minimizes token usage by scoping patterns, constraints, and examples
 * to only what's relevant for the target package.
 * 
 * This tool is essential for monorepo workflows where you want to:
 * - Focus AI context on a specific package
 * - Reduce token usage by excluding irrelevant patterns
 * - Get package-specific guidance and constraints
 */

import {
  createPackageDetector,
  createPackageContextGenerator,
  type PackageContextOptions,
  type PackageContext,
} from 'driftdetect-core';

import { createResponseBuilder, resolveProject, formatProjectContext } from '../../infrastructure/index.js';

// =============================================================================
// Types
// =============================================================================

export interface PackageContextInput {
  /** Package name or path to generate context for */
  package?: string;
  /** List all packages instead of generating context */
  list?: boolean;
  /** Include code snippets in context */
  includeSnippets?: boolean;
  /** Include internal dependency patterns */
  includeDependencies?: boolean;
  /** Categories to include (empty = all) */
  categories?: string[];
  /** Minimum pattern confidence (0.0-1.0) */
  minConfidence?: number;
  /** Maximum tokens for context */
  maxTokens?: number;
  /** Output format: json, ai */
  format?: 'json' | 'ai';
  /** Optional: Target a specific registered project */
  project?: string;
}

export interface PackageListResult {
  isMonorepo: boolean;
  packageManager: string;
  workspaceConfig?: string;
  packages: Array<{
    name: string;
    path: string;
    language: string;
    isRoot: boolean;
    description?: string;
    internalDependencies: string[];
  }>;
}

export interface PackageContextOutput {
  /** Summary of the context */
  summary: string;
  /** Package information */
  package?: {
    name: string;
    path: string;
    language: string;
    description?: string;
  };
  /** Statistics */
  stats?: {
    patterns: number;
    constraints: number;
    entryPoints: number;
    dataAccessors: number;
    estimatedTokens: number;
  };
  /** Full context (for json format) */
  context?: PackageContext;
  /** AI-formatted context (for ai format) */
  aiContext?: string;
  /** Package list (for list mode) */
  packages?: PackageListResult;
  /** Warnings */
  warnings: string[];
  /** Project context if using multi-project */
  projectContext?: Record<string, unknown>;
}

// =============================================================================
// Handler
// =============================================================================

export async function handlePackageContext(
  projectRoot: string,
  args: PackageContextInput
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<PackageContextOutput>();
  
  // Resolve project - allows targeting different registered projects
  const resolution = await resolveProject(args.project, projectRoot);
  const effectiveRoot = resolution.projectRoot;
  
  // List mode
  if (args.list) {
    return handleListPackages(effectiveRoot, resolution, builder);
  }
  
  // Context generation mode - requires package
  if (!args.package) {
    return builder
      .withSummary('Package name or path required. Use list=true to see available packages.')
      .withData({
        summary: 'Package name or path required',
        warnings: ['Use list=true to see available packages, then specify a package name'],
      })
      .buildContent();
  }
  
  return handleGenerateContext(effectiveRoot, args, resolution, builder);
}

/**
 * List all packages in the monorepo
 */
async function handleListPackages(
  projectRoot: string,
  resolution: Awaited<ReturnType<typeof resolveProject>>,
  builder: ReturnType<typeof createResponseBuilder<PackageContextOutput>>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const detector = createPackageDetector(projectRoot);
  const structure = await detector.detect();
  
  const packages: PackageListResult = {
    isMonorepo: structure.isMonorepo,
    packageManager: structure.packageManager,
    ...(structure.workspaceConfig && { workspaceConfig: structure.workspaceConfig }),
    packages: structure.packages.map((pkg: { name: string; path: string; language: string; isRoot: boolean; description?: string; internalDependencies: string[] }) => ({
      name: pkg.name,
      path: pkg.path,
      language: pkg.language,
      isRoot: pkg.isRoot,
      ...(pkg.description && { description: pkg.description }),
      internalDependencies: pkg.internalDependencies,
    })),
  };
  
  const summary = structure.isMonorepo
    ? `Monorepo with ${structure.packages.length} packages (${structure.packageManager})`
    : `Single package project (${structure.packageManager})`;
  
  const projectContext = formatProjectContext(resolution);
  
  return builder
    .withSummary(summary)
    .withData({
      summary,
      packages,
      warnings: [],
      projectContext,
    })
    .withHints({
      nextActions: structure.packages.slice(0, 3).map((p: { name: string }) => 
        `drift_package_context package="${p.name}" to get context for ${p.name}`
      ),
      relatedTools: ['drift_context', 'drift_status'],
    })
    .buildContent();
}

/**
 * Generate context for a specific package
 */
async function handleGenerateContext(
  projectRoot: string,
  args: PackageContextInput,
  resolution: Awaited<ReturnType<typeof resolveProject>>,
  builder: ReturnType<typeof createResponseBuilder<PackageContextOutput>>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const generator = createPackageContextGenerator(projectRoot);
  
  const options: PackageContextOptions = {
    package: args.package!,
    ...(args.includeSnippets !== undefined && { includeSnippets: args.includeSnippets }),
    ...(args.includeDependencies !== undefined && { includeDependencies: args.includeDependencies }),
    ...(args.includeDependencies !== undefined && { includeInternalDeps: args.includeDependencies }),
    ...(args.categories && { categories: args.categories }),
    ...(args.minConfidence !== undefined && { minConfidence: args.minConfidence }),
    ...(args.maxTokens !== undefined && { maxTokens: args.maxTokens }),
  };
  
  // Generate based on format
  if (args.format === 'ai') {
    const aiContext = await generator.generateAIContext(options);
    
    if (aiContext.combined.startsWith('Error:')) {
      return builder
        .withSummary(`Error generating context: ${aiContext.combined}`)
        .withData({
          summary: aiContext.combined,
          warnings: [],
        })
        .buildContent();
    }
    
    const summary = `AI context for ${args.package} (~${aiContext.tokens.total} tokens)`;
    const projectContext = formatProjectContext(resolution);
    
    return builder
      .withSummary(summary)
      .withData({
        summary,
        aiContext: aiContext.combined,
        stats: {
          patterns: 0, // Not available in AI format
          constraints: 0,
          entryPoints: 0,
          dataAccessors: 0,
          estimatedTokens: aiContext.tokens.total,
        },
        warnings: [],
        projectContext,
      })
      .withHints({
        nextActions: [
          'Use the aiContext field directly in your system prompt',
          'drift_code_examples for more detailed examples',
        ],
        relatedTools: ['drift_context', 'drift_code_examples'],
      })
      .buildContent();
  }
  
  // JSON format (default)
  const result = await generator.generate(options);
  
  if (!result.success || !result.context) {
    return builder
      .withSummary(`Error: ${result.error}`)
      .withData({
        summary: result.error || 'Unknown error',
        warnings: result.warnings,
      })
      .buildContent();
  }
  
  const ctx = result.context;
  const summary = buildSummary(ctx, result.warnings);
  const projectContext = formatProjectContext(resolution);
  
  return builder
    .withSummary(summary)
    .withData({
      summary,
      package: ctx.package,
      stats: {
        patterns: ctx.summary.totalPatterns,
        constraints: ctx.summary.totalConstraints,
        entryPoints: ctx.summary.totalEntryPoints,
        dataAccessors: ctx.summary.totalDataAccessors,
        estimatedTokens: ctx.summary.estimatedTokens,
      },
      context: ctx,
      warnings: result.warnings,
      projectContext,
    })
    .withHints({
      nextActions: generateNextActions(ctx),
      relatedTools: ['drift_context', 'drift_code_examples', 'drift_file_patterns'],
    })
    .buildContent();
}

/**
 * Build summary string
 */
function buildSummary(ctx: PackageContext, warnings: string[]): string {
  let summary = `Context for ${ctx.package.name} (${ctx.package.language}): `;
  summary += `${ctx.summary.totalPatterns} patterns, `;
  summary += `${ctx.summary.totalConstraints} constraints, `;
  summary += `${ctx.summary.totalEntryPoints} entry points. `;
  summary += `~${ctx.summary.estimatedTokens} tokens.`;
  
  if (warnings.length > 0) {
    summary += ` ⚠️ ${warnings.length} warning(s).`;
  }
  
  return summary;
}

/**
 * Generate next action suggestions
 */
function generateNextActions(ctx: PackageContext): string[] {
  const actions: string[] = [];
  
  if (ctx.patterns.length > 0) {
    actions.push(`drift_code_examples pattern="${ctx.patterns[0]?.id}" for more examples`);
  }
  
  if (ctx.keyFiles.length > 0) {
    actions.push(`drift_file_patterns file="${ctx.keyFiles[0]?.file}" for file details`);
  }
  
  if (ctx.entryPoints.length > 0) {
    actions.push(`drift_impact_analysis target="${ctx.entryPoints[0]?.file}" for impact analysis`);
  }
  
  return actions;
}

// =============================================================================
// Tool Definition
// =============================================================================

export const packageContextToolDefinition = {
  name: 'drift_package_context',
  description: `Generate AI-optimized context for a specific package in a monorepo.

This tool minimizes token usage by scoping patterns, constraints, and examples to only what's relevant for the target package.

Use cases:
- Focus AI context on a specific package in a monorepo
- Reduce token usage by excluding irrelevant patterns
- Get package-specific guidance and constraints
- List all packages in a monorepo

Examples:
- List packages: list=true
- Get context: package="@drift/core"
- AI format: package="@drift/core", format="ai"
- With snippets: package="@drift/core", includeSnippets=true`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      package: {
        type: 'string',
        description: 'Package name or path to generate context for',
      },
      list: {
        type: 'boolean',
        description: 'List all packages instead of generating context',
      },
      includeSnippets: {
        type: 'boolean',
        description: 'Include code snippets in context',
      },
      includeDependencies: {
        type: 'boolean',
        description: 'Include internal dependency patterns',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories to include (empty = all)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum pattern confidence (0.0-1.0)',
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum tokens for context (default: 8000)',
      },
      format: {
        type: 'string',
        enum: ['json', 'ai'],
        description: 'Output format: json (structured) or ai (markdown for prompts)',
      },
      project: {
        type: 'string',
        description: 'Optional: Target a specific registered project by name',
      },
    },
    required: [],
  },
};
