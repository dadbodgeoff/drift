/**
 * TypeScript Command - drift ts
 *
 * Analyze TypeScript/JavaScript projects: routes, components, hooks, error handling, data access.
 *
 * @requirements TypeScript Language Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createTypeScriptAnalyzer,
  type TSRoute,
  type TSErrorPattern,
  type TSDecorator,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface TsOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Filter by framework */
  framework?: string;
}

/**
 * Create the TypeScript command
 */
export function createTsCommand(): Command {
  const ts = new Command('ts')
    .description('TypeScript/JavaScript language analysis commands');

  // drift ts status
  ts
    .command('status [path]')
    .description('Show TypeScript/JavaScript project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await statusAction(targetPath, options);
    });

  // drift ts routes
  ts
    .command('routes [path]')
    .description('List all HTTP routes (Express, NestJS, Next.js, Fastify)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await routesAction(targetPath, options);
    });

  // drift ts components
  ts
    .command('components [path]')
    .description('List React components')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await componentsAction(targetPath, options);
    });

  // drift ts hooks
  ts
    .command('hooks [path]')
    .description('Analyze React hooks usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await hooksAction(targetPath, options);
    });

  // drift ts errors
  ts
    .command('errors [path]')
    .description('Analyze error handling patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift ts data-access
  ts
    .command('data-access [path]')
    .description('Analyze database access patterns (Prisma, TypeORM, Drizzle, Sequelize, Mongoose)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift ts decorators
  ts
    .command('decorators [path]')
    .description('Analyze decorator usage (NestJS, TypeORM, etc.)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: TsOptions) => {
      await decoratorsAction(targetPath, options);
    });

  return ts;
}


/**
 * Status subcommand
 */
async function statusAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing TypeScript project...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        project: result.projectInfo,
        frameworks: result.detectedFrameworks,
        stats: result.stats,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 TypeScript/JavaScript Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    if (result.projectInfo.name) {
      console.log(`  Name: ${chalk.cyan(result.projectInfo.name)}`);
    }
    if (result.projectInfo.version) {
      console.log(`  Version: ${chalk.cyan(result.projectInfo.version)}`);
    }
    console.log(`  Files: ${chalk.cyan(result.projectInfo.files)} (${result.projectInfo.tsFiles} .ts, ${result.projectInfo.jsFiles} .js)`);
    console.log(`  TypeScript: ${result.projectInfo.hasTypeScript ? chalk.green('Yes') : chalk.gray('No')}`);
    console.log(`  JavaScript: ${result.projectInfo.hasJavaScript ? chalk.green('Yes') : chalk.gray('No')}`);
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
    console.log(`  Classes: ${chalk.cyan(result.stats.classCount)}`);
    console.log(`  Components: ${chalk.cyan(result.stats.componentCount)}`);
    console.log(`  Hooks: ${chalk.cyan(result.stats.hookCount)}`);
    console.log(`  Async Functions: ${chalk.cyan(result.stats.asyncFunctionCount)}`);
    console.log(`  Decorators: ${chalk.cyan(result.stats.decoratorCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift ts routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift ts components   ${chalk.white('View React components')}`));
    console.log(chalk.gray(`  • drift ts hooks        ${chalk.white('Analyze hooks usage')}`));
    console.log(chalk.gray(`  • drift ts errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift ts data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift ts decorators   ${chalk.white('View decorator usage')}`));
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
 * Routes subcommand
 */
async function routesAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing routes...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    // Filter by framework if specified
    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: TSRoute) => r.framework === options.framework);
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
    console.log(chalk.bold('🛣️  TypeScript HTTP Routes'));
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
 * Components subcommand
 */
async function componentsAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing components...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeComponents();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚛️  React Components'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Components: ${chalk.cyan(result.components.length)}`);
    console.log(`  Functional: ${chalk.green(result.byType['functional'])}`);
    console.log(`  Class: ${chalk.blue(result.byType['class'])}`);
    console.log();

    if (result.components.length === 0) {
      console.log(chalk.gray('No components found'));
      console.log();
      return;
    }

    for (const comp of result.components.slice(0, 20)) {
      const typeIcon = comp.type === 'functional' ? chalk.green('ƒ') : chalk.blue('C');
      const exportIcon = comp.isExported ? chalk.yellow('↗') : ' ';
      console.log(`  ${typeIcon} ${exportIcon} ${chalk.white(comp.name)}`);
      if (comp.props.length > 0) {
        console.log(chalk.gray(`      Props: ${comp.props.join(', ')}`));
      }
      if (comp.hooks.length > 0) {
        console.log(chalk.gray(`      Hooks: ${comp.hooks.join(', ')}`));
      }
      console.log(chalk.gray(`      ${comp.file}:${comp.line}`));
    }

    if (result.components.length > 20) {
      console.log(chalk.gray(`  ... and ${result.components.length - 20} more`));
    }
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
 * Hooks subcommand
 */
async function hooksAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing hooks...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeHooks();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🪝 React Hooks Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Hook Calls: ${chalk.cyan(result.hooks.length)}`);
    console.log(`  Built-in: ${chalk.green(result.byType['builtin'])}`);
    console.log(`  Custom: ${chalk.blue(result.byType['custom'])}`);
    console.log();

    // Custom hooks defined
    if (result.customHooks.length > 0) {
      console.log(chalk.bold('Custom Hooks Defined:'));
      for (const hook of result.customHooks) {
        console.log(`  • ${chalk.cyan(hook)}`);
      }
      console.log();
    }

    // Hook usage breakdown
    const hookCounts = new Map<string, number>();
    for (const hook of result.hooks) {
      hookCounts.set(hook.name, (hookCounts.get(hook.name) ?? 0) + 1);
    }

    console.log(chalk.bold('Hook Usage:'));
    const sortedHooks = Array.from(hookCounts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedHooks.slice(0, 15)) {
      const typeIcon = result.customHooks.includes(name) ? chalk.blue('custom') : chalk.green('builtin');
      console.log(`  ${name}: ${chalk.cyan(count)} ${chalk.gray(`(${typeIcon})`)}`);
    }
    if (sortedHooks.length > 15) {
      console.log(chalk.gray(`  ... and ${sortedHooks.length - 15} more`));
    }
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
async function errorsAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeErrorHandling();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚠️  Error Handling Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Try-Catch Blocks: ${chalk.cyan(result.stats.tryCatchBlocks)}`);
    console.log(`Promise .catch(): ${chalk.cyan(result.stats.promiseCatches)}`);
    console.log(`Error Boundaries: ${chalk.cyan(result.stats.errorBoundaries)}`);
    console.log(`Throw Statements: ${chalk.cyan(result.stats.throwStatements)}`);
    console.log();

    // Pattern breakdown
    const patternCounts = {
      'try-catch': result.patterns.filter((p: TSErrorPattern) => p.type === 'try-catch').length,
      'promise-catch': result.patterns.filter((p: TSErrorPattern) => p.type === 'promise-catch').length,
      'error-boundary': result.patterns.filter((p: TSErrorPattern) => p.type === 'error-boundary').length,
      'throw': result.patterns.filter((p: TSErrorPattern) => p.type === 'throw').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Try-Catch: ${chalk.cyan(patternCounts['try-catch'])}`);
    console.log(`  Promise Catch: ${chalk.green(patternCounts['promise-catch'])}`);
    console.log(`  Error Boundary: ${chalk.blue(patternCounts['error-boundary'])}`);
    console.log(`  Throw: ${chalk.yellow(patternCounts['throw'])}`);
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
async function dataAccessAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeDataAccess();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🗄️  Data Access Patterns'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Access Points: ${chalk.cyan(result.accessPoints.length)}`);
    console.log(`Models: ${chalk.cyan(result.models.length)}`);
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
                      operation === 'update' ? chalk.yellow :
                      operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`  ${opColor(operation)}: ${chalk.cyan(count)}`);
    }
    console.log();

    // Models
    if (result.models.length > 0) {
      console.log(chalk.bold('Models Accessed:'));
      for (const model of result.models) {
        console.log(`  • ${model}`);
      }
      console.log();
    }

    // Access points (verbose)
    if (options.verbose && result.accessPoints.length > 0) {
      console.log(chalk.bold('Access Points:'));
      for (const ap of result.accessPoints.slice(0, 20)) {
        const opColor = ap.operation === 'read' ? chalk.green :
                        ap.operation === 'write' ? chalk.blue :
                        ap.operation === 'update' ? chalk.yellow :
                        ap.operation === 'delete' ? chalk.red : chalk.gray;
        console.log(`  ${opColor(ap.operation.padEnd(6))} ${ap.model} (${ap.framework})`);
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
 * Decorators subcommand
 */
async function decoratorsAction(targetPath: string | undefined, options: TsOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing decorators...') : null;
  spinner?.start();

  try {
    const analyzer = createTypeScriptAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeDecorators();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🎀 Decorator Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Decorators: ${chalk.cyan(result.decorators.length)}`);
    console.log();

    if (result.decorators.length === 0) {
      console.log(chalk.gray('No decorators found'));
      console.log();
      return;
    }

    // By name
    console.log(chalk.bold('By Name:'));
    const sortedByName = Object.entries(result.byName).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedByName.slice(0, 15)) {
      console.log(`  @${name}: ${chalk.cyan(count)}`);
    }
    if (sortedByName.length > 15) {
      console.log(chalk.gray(`  ... and ${sortedByName.length - 15} more`));
    }
    console.log();

    // By target
    const byTarget = {
      class: result.decorators.filter((d: TSDecorator) => d.target === 'class').length,
      method: result.decorators.filter((d: TSDecorator) => d.target === 'method').length,
      property: result.decorators.filter((d: TSDecorator) => d.target === 'property').length,
      parameter: result.decorators.filter((d: TSDecorator) => d.target === 'parameter').length,
    };

    console.log(chalk.bold('By Target:'));
    console.log(`  Class: ${chalk.cyan(byTarget.class)}`);
    console.log(`  Method: ${chalk.cyan(byTarget.method)}`);
    console.log(`  Property: ${chalk.cyan(byTarget.property)}`);
    console.log(`  Parameter: ${chalk.cyan(byTarget.parameter)}`);
    console.log();

    // Verbose: show individual decorators
    if (options.verbose) {
      console.log(chalk.bold('Decorators:'));
      for (const dec of result.decorators.slice(0, 20)) {
        console.log(`  @${chalk.cyan(dec.name)} (${dec.target})`);
        console.log(chalk.gray(`    ${dec.file}:${dec.line}`));
      }
      if (result.decorators.length > 20) {
        console.log(chalk.gray(`  ... and ${result.decorators.length - 20} more`));
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
    ALL: chalk.white,
  };
  return colors[method] ?? chalk.white;
}
