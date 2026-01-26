/**
 * Rust Command - drift rust
 *
 * Analyze Rust projects: routes, error handling, traits, data access.
 *
 * @requirements Rust Language Support
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createRustAnalyzer, type RustRoute, type RustErrorPattern, type RustCrate } from 'driftdetect-core';
import { createSpinner } from '../ui/spinner.js';

export interface RustOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Filter by framework */
  framework?: string;
}

/**
 * Create the Rust command
 */
export function createRustCommand(): Command {
  const rust = new Command('rust')
    .description('Rust language analysis commands');

  // drift rust routes
  rust
    .command('routes [path]')
    .description('List all HTTP routes (Actix, Axum, Rocket, Warp)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await routesAction(targetPath, options);
    });

  // drift rust errors
  rust
    .command('errors [path]')
    .description('Analyze error handling patterns (Result, thiserror, anyhow)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift rust traits
  rust
    .command('traits [path]')
    .description('List traits and their implementations')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await traitsAction(targetPath, options);
    });

  // drift rust data-access
  rust
    .command('data-access [path]')
    .description('Analyze database access patterns (SQLx, Diesel, SeaORM)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift rust async
  rust
    .command('async [path]')
    .description('Analyze async patterns and runtime usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await asyncAction(targetPath, options);
    });

  // drift rust status
  rust
    .command('status [path]')
    .description('Show Rust project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: RustOptions) => {
      await statusAction(targetPath, options);
    });

  return rust;
}

/**
 * Routes subcommand
 */
async function routesAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Rust routes...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    // Filter by framework if specified
    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: RustRoute) => r.framework === options.framework);
    }

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        total: routes.length,
        byFramework: result.byFramework,
        routes,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🦀 Rust HTTP Routes'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (routes.length === 0) {
      console.log(chalk.gray('No routes found'));
      console.log();
      return;
    }

    // Group by framework
    const byFramework = new Map<string, typeof routes>();
    for (const route of routes) {
      const existing = byFramework.get(route.framework) ?? [];
      existing.push(route);
      byFramework.set(route.framework, existing);
    }

    for (const [framework, frameworkRoutes] of byFramework) {
      console.log(chalk.bold(`${framework} (${frameworkRoutes.length} routes)`));

      for (const route of frameworkRoutes) {
        const methodColor = getMethodColor(route.method);
        console.log(`  ${methodColor(route.method.padEnd(7))} ${route.path}`);
        console.log(chalk.gray(`    → ${route.handler} (${route.file}:${route.line})`));
      }
      console.log();
    }

    console.log(`Total: ${chalk.cyan(routes.length)} routes`);
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Errors subcommand
 */
async function errorsAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeErrorHandling();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚠️  Rust Error Handling Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Result Types: ${chalk.cyan(result.stats.resultTypes)}`);
    console.log(`Custom Errors: ${chalk.green(result.stats.customErrors)}`);
    console.log(`thiserror Derives: ${chalk.blue(result.stats.thiserrorDerives)}`);
    console.log(`anyhow Usage: ${chalk.magenta(result.stats.anyhowUsage)}`);
    console.log(`Unwrap Calls: ${chalk.yellow(result.stats.unwrapCalls)}`);
    console.log(`Expect Calls: ${chalk.yellow(result.stats.expectCalls)}`);
    console.log();

    // Pattern breakdown
    const patternCounts = {
      propagated: result.patterns.filter((p: RustErrorPattern) => p.type === 'propagated').length,
      wrapped: result.patterns.filter((p: RustErrorPattern) => p.type === 'wrapped').length,
      logged: result.patterns.filter((p: RustErrorPattern) => p.type === 'logged').length,
      ignored: result.patterns.filter((p: RustErrorPattern) => p.type === 'ignored').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Propagated (?): ${chalk.cyan(patternCounts.propagated)}`);
    console.log(`  Wrapped (.map_err): ${chalk.green(patternCounts.wrapped)}`);
    console.log(`  Logged: ${chalk.blue(patternCounts.logged)}`);
    console.log(`  Ignored: ${chalk.yellow(patternCounts.ignored)}`);
    console.log();

    // Issues
    if (result.issues.length > 0) {
      console.log(chalk.bold('Issues:'));
      for (const issue of result.issues.slice(0, 10)) {
        console.log(`  ${chalk.yellow('⚠')} ${issue.file}:${issue.line}`);
        console.log(chalk.gray(`    ${issue.message}`));
        if (issue.suggestion) {
          console.log(chalk.gray(`    → ${issue.suggestion}`));
        }
      }
      if (result.issues.length > 10) {
        console.log(chalk.gray(`  ... and ${result.issues.length - 10} more`));
      }
      console.log();
    }

    // Custom error types
    if (result.customErrors.length > 0 && options.verbose) {
      console.log(chalk.bold('Custom Error Types:'));
      for (const err of result.customErrors.slice(0, 10)) {
        console.log(`  ${chalk.blue(err.name)}`);
        console.log(chalk.gray(`    ${err.file}:${err.line}`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Traits subcommand
 */
async function traitsAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing traits...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeTraits();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔌 Rust Traits'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Traits: ${chalk.cyan(result.traits.length)}`);
    console.log(`Total Implementations: ${chalk.cyan(result.implementations.length)}`);
    console.log();

    if (result.traits.length === 0) {
      console.log(chalk.gray('No traits found'));
      console.log();
      return;
    }

    for (const trait of result.traits) {
      const implCount = trait.implementations.length;
      const implBadge = implCount > 0 ? chalk.green(`(${implCount} impl)`) : chalk.gray('(no impl)');

      console.log(`${chalk.bold(trait.name)} ${implBadge}`);
      console.log(chalk.gray(`  Methods: ${trait.methods.join(', ') || 'none'}`));

      if (trait.implementations.length > 0) {
        console.log(chalk.gray(`  Implementations: ${trait.implementations.join(', ')}`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Data access subcommand
 */
async function dataAccessAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeDataAccess();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🗄️  Rust Data Access Patterns'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Access Points: ${chalk.cyan(result.accessPoints.length)}`);
    console.log(`Tables: ${chalk.cyan(result.tables.length)}`);
    console.log();

    // By framework
    console.log(chalk.bold('By Framework:'));
    for (const [framework, count] of Object.entries(result.byFramework)) {
      console.log(`  ${framework}: ${chalk.cyan(count)}`);
    }
    console.log();

    // By operation
    console.log(chalk.bold('By Operation:'));
    for (const [operation, count] of Object.entries(result.byOperation)) {
      const opColor = operation === 'read' ? chalk.green :
                      operation === 'write' ? chalk.blue :
                      operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`  ${opColor(operation)}: ${chalk.cyan(count)}`);
    }
    console.log();

    // Tables
    if (result.tables.length > 0) {
      console.log(chalk.bold('Tables Accessed:'));
      for (const table of result.tables) {
        console.log(`  • ${table}`);
      }
      console.log();
    }

    // Access points (verbose)
    if (options.verbose && result.accessPoints.length > 0) {
      console.log(chalk.bold('Access Points:'));
      for (const ap of result.accessPoints.slice(0, 20)) {
        const opColor = ap.operation === 'read' ? chalk.green :
                        ap.operation === 'write' ? chalk.blue :
                        ap.operation === 'delete' ? chalk.red : chalk.gray;
        console.log(`  ${opColor(ap.operation.padEnd(6))} ${ap.table} (${ap.framework})`);
        console.log(chalk.gray(`    ${ap.file}:${ap.line}`));
      }
      if (result.accessPoints.length > 20) {
        console.log(chalk.gray(`  ... and ${result.accessPoints.length - 20} more`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Async subcommand
 */
async function asyncAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing async patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeAsync();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚡ Rust Async Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Async Functions: ${chalk.cyan(result.stats.asyncFunctions)}`);
    console.log(`Await Points: ${chalk.cyan(result.stats.awaitPoints)}`);
    console.log(`Spawned Tasks: ${chalk.cyan(result.stats.spawnedTasks)}`);
    console.log(`Channels: ${chalk.cyan(result.stats.channels)}`);
    console.log(`Mutexes: ${chalk.cyan(result.stats.mutexes)}`);
    console.log();

    // Runtime detection
    if (result.runtime) {
      console.log(chalk.bold('Detected Runtime:'));
      console.log(`  ${chalk.cyan(result.runtime)}`);
      console.log();
    }

    // Issues
    if (result.issues.length > 0) {
      console.log(chalk.bold('Potential Issues:'));
      for (const issue of result.issues.slice(0, 10)) {
        console.log(`  ${chalk.yellow('⚠')} ${issue.message}`);
        console.log(chalk.gray(`    ${issue.file}:${issue.line}`));
      }
      if (result.issues.length > 10) {
        console.log(chalk.gray(`  ... and ${result.issues.length - 10} more`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Status subcommand
 */
async function statusAction(targetPath: string | undefined, options: RustOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Rust project...') : null;
  spinner?.start();

  try {
    const analyzer = createRustAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        project: {
          crateName: result.crateName,
          edition: result.edition,
          crates: result.crates.length,
          files: result.stats.fileCount,
          functions: result.stats.functionCount,
          structs: result.stats.structCount,
          traits: result.stats.traitCount,
        },
        frameworks: result.detectedFrameworks,
        stats: result.stats,
        topCrates: result.crates.slice(0, 10).map((crate: RustCrate) => ({
          name: crate.name,
          files: crate.files.length,
          functions: crate.functions.length,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 Rust Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    if (result.crateName) {
      console.log(`  Crate: ${chalk.cyan(result.crateName)}`);
    }
    if (result.edition) {
      console.log(`  Edition: ${chalk.cyan(result.edition)}`);
    }
    console.log(`  Crates: ${chalk.cyan(result.crates.length)}`);
    console.log(`  Files: ${chalk.cyan(result.stats.fileCount)}`);
    console.log();

    // Detected frameworks
    if (result.detectedFrameworks.length > 0) {
      console.log(chalk.bold('Detected Frameworks'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const fw of result.detectedFrameworks) {
        console.log(`  • ${fw}`);
      }
      console.log();
    }

    // Statistics
    console.log(chalk.bold('Statistics'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Functions: ${chalk.cyan(result.stats.functionCount)}`);
    console.log(`  Structs: ${chalk.cyan(result.stats.structCount)}`);
    console.log(`  Traits: ${chalk.cyan(result.stats.traitCount)}`);
    console.log(`  Enums: ${chalk.cyan(result.stats.enumCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Test Functions: ${chalk.cyan(result.stats.testFunctionCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    // Top crates
    if (result.crates.length > 0) {
      console.log(chalk.bold('Top Crates'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const crate of result.crates.slice(0, 5)) {
        console.log(`  ${chalk.white(crate.name)}`);
        console.log(chalk.gray(`    ${crate.files.length} files, ${crate.functions.length} functions`));
      }
      if (result.crates.length > 5) {
        console.log(chalk.gray(`  ... and ${result.crates.length - 5} more crates`));
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift rust routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift rust errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift rust traits       ${chalk.white('View traits')}`));
    console.log(chalk.gray(`  • drift rust data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift rust async        ${chalk.white('Analyze async patterns')}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Get color for HTTP method
 */
function getMethodColor(method: string): (text: string) => string {
  const colors: Record<string, (text: string) => string> = {
    GET: chalk.green,
    POST: chalk.blue,
    PUT: chalk.yellow,
    DELETE: chalk.red,
    PATCH: chalk.magenta,
    HEAD: chalk.cyan,
    OPTIONS: chalk.gray,
    ANY: chalk.white,
  };
  return colors[method] ?? chalk.white;
}
