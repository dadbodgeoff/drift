/**
 * Context Command - Generate package-scoped AI context
 *
 * @license Apache-2.0
 *
 * Generates AI-optimized context for specific packages in a monorepo.
 * Minimizes token usage by scoping patterns, constraints, and examples
 * to only what's relevant for the target package.
 *
 * Usage:
 *   drift context @drift/core              # Generate context for a package
 *   drift context packages/core            # By path
 *   drift context @drift/core --format ai  # AI-optimized format
 *   drift context @drift/core --snippets   # Include code snippets
 *   drift context --list                   # List all packages
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createPackageDetector,
  createPackageContextGenerator,
  type PackageContextOptions,
} from 'driftdetect-core';

export const contextCommand = new Command('context')
  .description('Generate package-scoped AI context for monorepos')
  .argument('[package]', 'Package name or path to generate context for')
  .option('-l, --list', 'List all detected packages')
  .option('-f, --format <format>', 'Output format: json, markdown, ai', 'json')
  .option('-o, --output <file>', 'Output file (stdout if not specified)')
  .option('--snippets', 'Include code snippets in context')
  .option('--deps', 'Include internal dependency patterns')
  .option('-c, --categories <categories>', 'Categories to include (comma-separated)')
  .option('--min-confidence <number>', 'Minimum pattern confidence (0.0-1.0)')
  .option('--max-tokens <number>', 'Maximum tokens for AI context', '8000')
  .option('--compact', 'Compact output (fewer details)')
  .action(async (packageArg, options) => {
    const cwd = process.cwd();

    // List packages mode
    if (options.list) {
      await listPackages(cwd);
      return;
    }

    // Require package argument for context generation
    if (!packageArg) {
      console.error(chalk.red('Error: Package name or path required'));
      console.error(chalk.dim('Use --list to see available packages'));
      console.error(chalk.dim('Example: drift context @drift/core'));
      process.exit(1);
    }

    // Generate context
    await generateContext(cwd, packageArg, options);
  });

/**
 * List all detected packages in the monorepo
 */
async function listPackages(cwd: string): Promise<void> {
  const detector = createPackageDetector(cwd);
  
  console.error(chalk.blue('Detecting packages...'));
  
  const structure = await detector.detect();

  if (structure.packages.length === 0) {
    console.error(chalk.yellow('No packages detected'));
    return;
  }

  console.log();
  console.log(chalk.bold(`Monorepo: ${structure.isMonorepo ? 'Yes' : 'No'}`));
  console.log(chalk.bold(`Package Manager: ${structure.packageManager}`));
  if (structure.workspaceConfig) {
    console.log(chalk.dim(`Config: ${structure.workspaceConfig}`));
  }
  console.log();

  console.log(chalk.bold(`Packages (${structure.packages.length}):`));
  console.log();

  for (const pkg of structure.packages) {
    const rootBadge = pkg.isRoot ? chalk.cyan(' [root]') : '';
    const langBadge = chalk.dim(` (${pkg.language})`);
    
    console.log(`  ${chalk.green(pkg.name)}${rootBadge}${langBadge}`);
    console.log(chalk.dim(`    Path: ${pkg.path}`));
    
    if (pkg.description) {
      console.log(chalk.dim(`    ${pkg.description}`));
    }
    
    if (pkg.internalDependencies.length > 0) {
      console.log(chalk.dim(`    Deps: ${pkg.internalDependencies.slice(0, 3).join(', ')}${pkg.internalDependencies.length > 3 ? '...' : ''}`));
    }
    
    console.log();
  }
}

/**
 * Generate context for a specific package
 */
async function generateContext(
  cwd: string,
  packageArg: string,
  options: {
    format: string;
    output?: string;
    snippets?: boolean;
    deps?: boolean;
    categories?: string;
    minConfidence?: string;
    maxTokens?: string;
    compact?: boolean;
  }
): Promise<void> {
  const generator = createPackageContextGenerator(cwd);

  // Parse categories
  let categories: string[] | undefined;
  if (options.categories) {
    categories = options.categories.split(',').map(c => c.trim());
  }

  // Build options - use explicit assignments to satisfy exactOptionalPropertyTypes
  const contextOptions: PackageContextOptions = {
    package: packageArg,
    format: options.format as 'json' | 'markdown' | 'ai-context',
  };
  
  // Only set optional properties if they have values
  if (options.snippets !== undefined) {
    contextOptions.includeSnippets = options.snippets;
  }
  if (options.deps !== undefined) {
    contextOptions.includeDependencies = options.deps;
    contextOptions.includeInternalDeps = options.deps;
  }
  if (categories !== undefined) {
    contextOptions.categories = categories;
  }
  if (options.minConfidence) {
    contextOptions.minConfidence = parseFloat(options.minConfidence);
  }
  if (options.maxTokens) {
    contextOptions.maxTokens = parseInt(options.maxTokens, 10);
  }

  console.error(chalk.blue(`Generating context for ${packageArg}...`));

  // Generate based on format
  let output: string;

  if (options.format === 'ai') {
    const aiContext = await generator.generateAIContext(contextOptions);
    
    if (aiContext.combined.startsWith('Error:')) {
      console.error(chalk.red(aiContext.combined));
      process.exit(1);
    }

    // Show token breakdown
    console.error(chalk.dim(`Token breakdown:`));
    console.error(chalk.dim(`  System prompt: ~${aiContext.tokens.systemPrompt}`));
    console.error(chalk.dim(`  Conventions:   ~${aiContext.tokens.conventions}`));
    console.error(chalk.dim(`  Examples:      ~${aiContext.tokens.examples}`));
    console.error(chalk.dim(`  Constraints:   ~${aiContext.tokens.constraints}`));
    console.error(chalk.dim(`  Total:         ~${aiContext.tokens.total}`));

    output = aiContext.combined;
  } else {
    const result = await generator.generate(contextOptions);

    if (!result.success) {
      console.error(chalk.red(`Error: ${result.error}`));
      process.exit(1);
    }

    // Show warnings
    for (const warning of result.warnings) {
      console.error(chalk.yellow(`⚠️  ${warning}`));
    }

    // Show summary
    const ctx = result.context!;
    console.error(chalk.dim(`Package: ${ctx.package.name} (${ctx.package.language})`));
    console.error(chalk.dim(`Patterns: ${ctx.summary.totalPatterns}`));
    console.error(chalk.dim(`Constraints: ${ctx.summary.totalConstraints}`));
    console.error(chalk.dim(`Entry points: ${ctx.summary.totalEntryPoints}`));
    console.error(chalk.dim(`Estimated tokens: ~${ctx.summary.estimatedTokens}`));

    if (options.format === 'markdown') {
      output = formatMarkdown(ctx);
    } else {
      // JSON format
      if (options.compact) {
        output = JSON.stringify(ctx);
      } else {
        output = JSON.stringify(ctx, null, 2);
      }
    }
  }

  // Write output
  if (options.output) {
    const outputPath = path.resolve(cwd, options.output);
    await fs.writeFile(outputPath, output, 'utf-8');
    console.error(chalk.green(`✔ Context written to ${options.output}`));
  } else {
    console.log(output);
  }
}

/**
 * Format context as markdown
 */
function formatMarkdown(ctx: import('driftdetect-core').PackageContext): string {
  const lines: string[] = [];

  lines.push(`# Package Context: ${ctx.package.name}`);
  lines.push('');
  
  if (ctx.package.description) {
    lines.push(ctx.package.description);
    lines.push('');
  }

  lines.push(`- **Language:** ${ctx.package.language}`);
  lines.push(`- **Path:** ${ctx.package.path}`);
  lines.push(`- **Patterns:** ${ctx.summary.totalPatterns}`);
  lines.push(`- **Constraints:** ${ctx.summary.totalConstraints}`);
  lines.push(`- **Entry Points:** ${ctx.summary.totalEntryPoints}`);
  lines.push(`- **Estimated Tokens:** ~${ctx.summary.estimatedTokens}`);
  lines.push('');

  // Key Insights
  if (ctx.guidance.keyInsights.length > 0) {
    lines.push('## Key Insights');
    lines.push('');
    for (const insight of ctx.guidance.keyInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  // Warnings
  if (ctx.guidance.warnings.length > 0) {
    lines.push('## ⚠️ Warnings');
    lines.push('');
    for (const warning of ctx.guidance.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  // Patterns
  if (ctx.patterns.length > 0) {
    lines.push('## Patterns');
    lines.push('');
    lines.push('| Pattern | Category | Confidence | Occurrences |');
    lines.push('|---------|----------|------------|-------------|');
    for (const pattern of ctx.patterns.slice(0, 15)) {
      lines.push(`| ${pattern.name} | ${pattern.category} | ${Math.round(pattern.confidence * 100)}% | ${pattern.occurrences} |`);
    }
    if (ctx.patterns.length > 15) {
      lines.push(`| ... | ... | ... | ... |`);
      lines.push(`| *${ctx.patterns.length - 15} more patterns* | | | |`);
    }
    lines.push('');
  }

  // Entry Points
  if (ctx.entryPoints.length > 0) {
    lines.push('## Entry Points');
    lines.push('');
    for (const ep of ctx.entryPoints.slice(0, 10)) {
      const methodPath = ep.method && ep.path ? ` [${ep.method} ${ep.path}]` : '';
      lines.push(`- \`${ep.name}\` (${ep.type})${methodPath}`);
      lines.push(`  - File: ${ep.file}`);
    }
    if (ctx.entryPoints.length > 10) {
      lines.push(`- *...and ${ctx.entryPoints.length - 10} more*`);
    }
    lines.push('');
  }

  // Data Accessors
  if (ctx.dataAccessors.length > 0) {
    lines.push('## Data Accessors');
    lines.push('');
    for (const da of ctx.dataAccessors.slice(0, 10)) {
      const sensitive = da.accessesSensitive ? ' ⚠️ **SENSITIVE**' : '';
      lines.push(`- \`${da.name}\` → ${da.tables.join(', ')}${sensitive}`);
    }
    if (ctx.dataAccessors.length > 10) {
      lines.push(`- *...and ${ctx.dataAccessors.length - 10} more*`);
    }
    lines.push('');
  }

  // Constraints
  if (ctx.constraints.length > 0) {
    lines.push('## Constraints');
    lines.push('');
    
    const errorConstraints = ctx.constraints.filter((c: { enforcement: string; name: string; guidance: string }) => c.enforcement === 'error');
    const warningConstraints = ctx.constraints.filter((c: { enforcement: string; name: string; guidance: string }) => c.enforcement === 'warning');
    const infoConstraints = ctx.constraints.filter((c: { enforcement: string; name: string; guidance: string }) => c.enforcement === 'info');

    if (errorConstraints.length > 0) {
      lines.push('### 🔴 Mandatory');
      for (const c of errorConstraints) {
        lines.push(`- **${c.name}**: ${c.guidance}`);
      }
      lines.push('');
    }

    if (warningConstraints.length > 0) {
      lines.push('### 🟡 Recommended');
      for (const c of warningConstraints) {
        lines.push(`- **${c.name}**: ${c.guidance}`);
      }
      lines.push('');
    }

    if (infoConstraints.length > 0) {
      lines.push('### 🔵 Guidelines');
      for (const c of infoConstraints) {
        lines.push(`- **${c.name}**: ${c.guidance}`);
      }
      lines.push('');
    }
  }

  // Key Files
  if (ctx.keyFiles.length > 0) {
    lines.push('## Key Files');
    lines.push('');
    for (const kf of ctx.keyFiles.slice(0, 10)) {
      lines.push(`- \`${kf.file}\``);
      lines.push(`  - ${kf.reason}`);
      if (kf.patterns.length > 0) {
        lines.push(`  - Patterns: ${kf.patterns.join(', ')}`);
      }
    }
    lines.push('');
  }

  // Metadata
  lines.push('---');
  lines.push(`*Generated: ${ctx.metadata.generatedAt}*`);
  lines.push(`*Drift Version: ${ctx.metadata.driftVersion}*`);

  return lines.join('\n');
}
