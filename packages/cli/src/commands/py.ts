/**
 * Python Command - drift py
 *
 * Analyze Python projects: routes, error handling, data access, async patterns.
 *
 * @requirements Python Language Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createPythonAnalyzer,
  type PyRoute,
  type PyErrorPattern,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface PyOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  framework?: string;
}

export function createPyCommand(): Command {
  const py = new Command('py')
    .description('Python language analysis commands');

  // drift py status
  py
    .command('status [path]')
    .description('Show Python project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await statusAction(targetPath, options);
    });

  // drift py routes
  py
    .command('routes [path]')
    .description('List all HTTP routes (Flask, FastAPI, Django, Starlette)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await routesAction(targetPath, options);
    });

  // drift py errors
  py
    .command('errors [path]')
    .description('Analyze error handling patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift py data-access
  py
    .command('data-access [path]')
    .description('Analyze database access patterns (Django ORM, SQLAlchemy, Tortoise, Peewee)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift py decorators
  py
    .command('decorators [path]')
    .description('Analyze decorator usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await decoratorsAction(targetPath, options);
    });

  // drift py async
  py
    .command('async [path]')
    .description('Analyze async patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PyOptions) => {
      await asyncAction(targetPath, options);
    });

  return py;
}

async function statusAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Python project...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        project: result.projectInfo,
        frameworks: result.detectedFrameworks,
        stats: result.stats,
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🐍 Python Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    if (result.projectInfo.name) {
      console.log(`  Name: ${chalk.cyan(result.projectInfo.name)}`);
    }
    if (result.projectInfo.version) {
      console.log(`  Version: ${chalk.cyan(result.projectInfo.version)}`);
    }
    console.log(`  Files: ${chalk.cyan(result.projectInfo.files)}`);
    console.log();

    if (result.detectedFrameworks.length > 0) {
      console.log(chalk.bold('Detected Frameworks'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const fw of result.detectedFrameworks) {
        console.log(`  • ${fw}`);
      }
      console.log();
    }

    console.log(chalk.bold('Statistics'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Functions: ${chalk.cyan(result.stats.functionCount)}`);
    console.log(`  Classes: ${chalk.cyan(result.stats.classCount)}`);
    console.log(`  Async Functions: ${chalk.cyan(result.stats.asyncFunctionCount)}`);
    console.log(`  Decorators: ${chalk.cyan(result.stats.decoratorCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift py routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift py errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift py data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift py decorators   ${chalk.white('View decorator usage')}`));
    console.log(chalk.gray(`  • drift py async        ${chalk.white('Analyze async patterns')}`));
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

async function routesAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing routes...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: PyRoute) => r.framework === options.framework);
    }

    if (format === 'json') {
      console.log(JSON.stringify({ total: routes.length, byFramework: result.byFramework, routes }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🛣️  Python HTTP Routes'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (routes.length === 0) {
      console.log(chalk.gray('No routes found'));
      console.log();
      return;
    }

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

async function errorsAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeErrorHandling();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('⚠️  Error Handling Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Try-Except Blocks: ${chalk.cyan(result.stats.tryExceptBlocks)}`);
    console.log(`Raise Statements: ${chalk.cyan(result.stats.raiseStatements)}`);
    console.log(`Custom Exceptions: ${chalk.cyan(result.stats.customExceptions)}`);
    console.log(`Context Managers: ${chalk.cyan(result.stats.contextManagers)}`);
    console.log();

    const patternCounts = {
      'try-except': result.patterns.filter((p: PyErrorPattern) => p.type === 'try-except').length,
      'raise': result.patterns.filter((p: PyErrorPattern) => p.type === 'raise').length,
      'custom-exception': result.patterns.filter((p: PyErrorPattern) => p.type === 'custom-exception').length,
      'context-manager': result.patterns.filter((p: PyErrorPattern) => p.type === 'context-manager').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Try-Except: ${chalk.cyan(patternCounts['try-except'])}`);
    console.log(`  Raise: ${chalk.yellow(patternCounts['raise'])}`);
    console.log(`  Custom Exception: ${chalk.blue(patternCounts['custom-exception'])}`);
    console.log(`  Context Manager: ${chalk.green(patternCounts['context-manager'])}`);
    console.log();

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

async function dataAccessAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeDataAccess();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🗄️  Data Access Patterns'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Access Points: ${chalk.cyan(result.accessPoints.length)}`);
    console.log(`Models: ${chalk.cyan(result.models.length)}`);
    console.log();

    console.log(chalk.bold('By Framework:'));
    for (const [framework, count] of Object.entries(result.byFramework)) {
      console.log(`  ${framework}: ${chalk.cyan(count)}`);
    }
    console.log();

    console.log(chalk.bold('By Operation:'));
    for (const [operation, count] of Object.entries(result.byOperation)) {
      const opColor = operation === 'read' ? chalk.green :
                      operation === 'write' ? chalk.blue :
                      operation === 'update' ? chalk.yellow :
                      operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`  ${opColor(operation)}: ${chalk.cyan(count)}`);
    }
    console.log();

    if (result.models.length > 0) {
      console.log(chalk.bold('Models Accessed:'));
      for (const model of result.models) {
        console.log(`  • ${model}`);
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

async function decoratorsAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing decorators...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeDecorators();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

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

    console.log(chalk.bold('By Name:'));
    const sortedByName = Object.entries(result.byName).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedByName.slice(0, 15)) {
      console.log(`  @${name}: ${chalk.cyan(count)}`);
    }
    if (sortedByName.length > 15) {
      console.log(chalk.gray(`  ... and ${sortedByName.length - 15} more`));
    }
    console.log();

    if (options.verbose) {
      console.log(chalk.bold('Decorators:'));
      for (const dec of result.decorators.slice(0, 20)) {
        console.log(`  @${chalk.cyan(dec.name)}`);
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

async function asyncAction(targetPath: string | undefined, options: PyOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing async patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createPythonAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeAsync();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('⚡ Async Pattern Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Async Functions: ${chalk.cyan(result.asyncFunctions.length)}`);
    console.log(`Await Calls: ${chalk.cyan(result.awaitCalls)}`);
    console.log(`Async Context Managers: ${chalk.cyan(result.asyncContextManagers)}`);
    console.log();

    if (result.asyncFunctions.length > 0) {
      console.log(chalk.bold('Async Functions:'));
      for (const func of result.asyncFunctions.slice(0, 20)) {
        console.log(`  ${chalk.cyan(func.name)} (${func.awaitCount} awaits)`);
        console.log(chalk.gray(`    ${func.file}:${func.line}`));
      }
      if (result.asyncFunctions.length > 20) {
        console.log(chalk.gray(`  ... and ${result.asyncFunctions.length - 20} more`));
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
