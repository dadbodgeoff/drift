/**
 * Go Command - drift go
 *
 * Analyze Go projects: routes, error handling, interfaces, data access.
 *
 * @requirements Go Language Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { createGoAnalyzer, type GoRoute, type GoErrorPattern, type GoPackage } from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface GoOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Filter by framework */
  framework?: string;
}

/**
 * Create the Go command
 */
export function createGoCommand(): Command {
  const go = new Command('go')
    .description('Go language analysis commands');

  // drift go routes
  go
    .command('routes [path]')
    .description('List all HTTP routes (Gin, Echo, Chi, Fiber, net/http)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await routesAction(targetPath, options);
    });

  // drift go errors
  go
    .command('errors [path]')
    .description('Analyze error handling patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift go interfaces
  go
    .command('interfaces [path]')
    .description('List interfaces and their implementations')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await interfacesAction(targetPath, options);
    });

  // drift go data-access
  go
    .command('data-access [path]')
    .description('Analyze database access patterns (GORM, sqlx, database/sql, Ent, Bun)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift go goroutines
  go
    .command('goroutines [path]')
    .description('Analyze goroutines and concurrency patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await goroutinesAction(targetPath, options);
    });

  // drift go status
  go
    .command('status [path]')
    .description('Show Go project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: GoOptions) => {
      await statusAction(targetPath, options);
    });

  return go;
}

/**
 * Routes subcommand
 */
async function routesAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Go routes...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    // Filter by framework if specified
    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: GoRoute) => r.framework === options.framework);
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
    console.log(chalk.bold('🛣️  Go HTTP Routes'));
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
async function errorsAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeErrorHandling();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚠️  Go Error Handling Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Error Checks: ${chalk.cyan(result.stats.errorChecks)}`);
    console.log(`Wrapped Errors: ${chalk.green(result.stats.wrappedErrors)}`);
    console.log(`Sentinel Errors: ${chalk.blue(result.stats.sentinelErrors)}`);
    console.log(`Custom Error Types: ${chalk.magenta(result.stats.customErrorTypes)}`);
    console.log(`Unchecked Errors: ${chalk.yellow(result.stats.uncheckedErrors)}`);
    console.log();

    // Pattern breakdown
    const patternCounts = {
      propagated: result.patterns.filter((p: GoErrorPattern) => p.type === 'propagated').length,
      wrapped: result.patterns.filter((p: GoErrorPattern) => p.type === 'wrapped').length,
      logged: result.patterns.filter((p: GoErrorPattern) => p.type === 'logged').length,
      ignored: result.patterns.filter((p: GoErrorPattern) => p.type === 'ignored').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Propagated: ${chalk.cyan(patternCounts.propagated)}`);
    console.log(`  Wrapped: ${chalk.green(patternCounts.wrapped)}`);
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

    // Sentinel errors
    if (result.sentinelErrors.length > 0 && options.verbose) {
      console.log(chalk.bold('Sentinel Errors:'));
      for (const err of result.sentinelErrors.slice(0, 10)) {
        console.log(`  ${chalk.blue(err.name)}: "${err.message}"`);
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
 * Interfaces subcommand
 */
async function interfacesAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing interfaces...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeInterfaces();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔌 Go Interfaces'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Interfaces: ${chalk.cyan(result.interfaces.length)}`);
    console.log(`Total Implementations: ${chalk.cyan(result.implementations.length)}`);
    console.log();

    if (result.interfaces.length === 0) {
      console.log(chalk.gray('No interfaces found'));
      console.log();
      return;
    }

    for (const iface of result.interfaces) {
      const implCount = iface.implementations.length;
      const implBadge = implCount > 0 ? chalk.green(`(${implCount} impl)`) : chalk.gray('(no impl)');

      console.log(`${chalk.bold(iface.name)} ${implBadge}`);
      console.log(chalk.gray(`  Methods: ${iface.methods.join(', ') || 'none'}`));

      if (iface.implementations.length > 0) {
        console.log(chalk.gray(`  Implementations: ${iface.implementations.join(', ')}`));
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
async function dataAccessAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeDataAccess();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🗄️  Go Data Access Patterns'));
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
 * Goroutines subcommand
 */
async function goroutinesAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing goroutines...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeGoroutines();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔄 Go Concurrency Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Go Statements: ${chalk.cyan(result.stats.goStatements)}`);
    console.log(`Channels: ${chalk.cyan(result.stats.channels)}`);
    console.log(`Mutexes: ${chalk.cyan(result.stats.mutexes)}`);
    console.log(`WaitGroups: ${chalk.cyan(result.stats.waitGroups)}`);
    console.log();

    // Goroutines
    if (result.goroutines.length > 0) {
      console.log(chalk.bold('Goroutines:'));
      for (const g of result.goroutines.slice(0, 15)) {
        const recoverIcon = g.hasRecover ? chalk.green('✓') : chalk.yellow('⚠');
        console.log(`  ${recoverIcon} ${g.function}`);
        console.log(chalk.gray(`    ${g.file}:${g.line}`));
      }
      if (result.goroutines.length > 15) {
        console.log(chalk.gray(`  ... and ${result.goroutines.length - 15} more`));
      }
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
async function statusAction(targetPath: string | undefined, options: GoOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Go project...') : null;
  spinner?.start();

  try {
    const analyzer = createGoAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
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
        stats: result.stats,
        topPackages: result.packages.slice(0, 10).map((pkg: GoPackage) => ({
          name: pkg.name,
          files: pkg.files.length,
          functions: pkg.functions.length,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 Go Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    if (result.moduleName) {
      console.log(`  Module: ${chalk.cyan(result.moduleName)}`);
    }
    if (result.goVersion) {
      console.log(`  Go Version: ${chalk.cyan(result.goVersion)}`);
    }
    console.log(`  Packages: ${chalk.cyan(result.packages.length)}`);
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
    console.log(`  Interfaces: ${chalk.cyan(result.stats.interfaceCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Test Functions: ${chalk.cyan(result.stats.testFunctionCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    // Top packages
    if (result.packages.length > 0) {
      console.log(chalk.bold('Top Packages'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const pkg of result.packages.slice(0, 5)) {
        console.log(`  ${chalk.white(pkg.name)}`);
        console.log(chalk.gray(`    ${pkg.files.length} files, ${pkg.functions.length} functions`));
      }
      if (result.packages.length > 5) {
        console.log(chalk.gray(`  ... and ${result.packages.length - 5} more packages`));
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift go routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift go errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift go interfaces   ${chalk.white('View interfaces')}`));
    console.log(chalk.gray(`  • drift go data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift go goroutines   ${chalk.white('Analyze concurrency')}`));
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
