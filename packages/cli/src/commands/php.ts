/**
 * PHP Command - drift php
 *
 * Analyze PHP projects: routes, error handling, data access, traits.
 *
 * @requirements PHP Language Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createPhpAnalyzer,
  type PhpRoute,
  type PhpErrorPattern,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface PhpOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  framework?: string;
}

export function createPhpCommand(): Command {
  const php = new Command('php')
    .description('PHP language analysis commands');

  // drift php status
  php
    .command('status [path]')
    .description('Show PHP project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PhpOptions) => {
      await statusAction(targetPath, options);
    });

  // drift php routes
  php
    .command('routes [path]')
    .description('List all HTTP routes (Laravel, Symfony, Slim, Lumen)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: PhpOptions) => {
      await routesAction(targetPath, options);
    });

  // drift php errors
  php
    .command('errors [path]')
    .description('Analyze error handling patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PhpOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift php data-access
  php
    .command('data-access [path]')
    .description('Analyze database access patterns (Eloquent, Doctrine, PDO)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PhpOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift php traits
  php
    .command('traits [path]')
    .description('Analyze trait definitions and usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: PhpOptions) => {
      await traitsAction(targetPath, options);
    });

  return php;
}

async function statusAction(targetPath: string | undefined, options: PhpOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing PHP project...') : null;
  spinner?.start();

  try {
    const analyzer = createPhpAnalyzer({ rootDir, verbose: options.verbose });
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
    console.log(chalk.bold('🐘 PHP Project Status'));
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
    if (result.projectInfo.framework) {
      console.log(`  Framework: ${chalk.cyan(result.projectInfo.framework)}`);
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
    console.log(`  Classes: ${chalk.cyan(result.stats.classCount)}`);
    console.log(`  Traits: ${chalk.cyan(result.stats.traitCount)}`);
    console.log(`  Interfaces: ${chalk.cyan(result.stats.interfaceCount)}`);
    console.log(`  Functions: ${chalk.cyan(result.stats.functionCount)}`);
    console.log(`  Methods: ${chalk.cyan(result.stats.methodCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift php routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift php errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift php data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift php traits       ${chalk.white('View trait usage')}`));
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

async function routesAction(targetPath: string | undefined, options: PhpOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing routes...') : null;
  spinner?.start();

  try {
    const analyzer = createPhpAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: PhpRoute) => r.framework === options.framework);
    }

    if (format === 'json') {
      console.log(JSON.stringify({ total: routes.length, byFramework: result.byFramework, routes }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🛣️  PHP HTTP Routes'));
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
        if (route.middleware.length > 0) {
          console.log(chalk.gray(`    middleware: ${route.middleware.join(', ')}`));
        }
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

async function errorsAction(targetPath: string | undefined, options: PhpOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createPhpAnalyzer({ rootDir, verbose: options.verbose });
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

    console.log(`Try-Catch Blocks: ${chalk.cyan(result.stats.tryCatchBlocks)}`);
    console.log(`Throw Statements: ${chalk.cyan(result.stats.throwStatements)}`);
    console.log(`Custom Exceptions: ${chalk.cyan(result.stats.customExceptions)}`);
    console.log(`Error Handlers: ${chalk.cyan(result.stats.errorHandlers)}`);
    console.log();

    const patternCounts = {
      'try-catch': result.patterns.filter((p: PhpErrorPattern) => p.type === 'try-catch').length,
      'throw': result.patterns.filter((p: PhpErrorPattern) => p.type === 'throw').length,
      'custom-exception': result.patterns.filter((p: PhpErrorPattern) => p.type === 'custom-exception').length,
      'error-handler': result.patterns.filter((p: PhpErrorPattern) => p.type === 'error-handler').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Try-Catch: ${chalk.cyan(patternCounts['try-catch'])}`);
    console.log(`  Throw: ${chalk.yellow(patternCounts['throw'])}`);
    console.log(`  Custom Exception: ${chalk.blue(patternCounts['custom-exception'])}`);
    console.log(`  Error Handler: ${chalk.green(patternCounts['error-handler'])}`);
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

async function dataAccessAction(targetPath: string | undefined, options: PhpOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createPhpAnalyzer({ rootDir, verbose: options.verbose });
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

async function traitsAction(targetPath: string | undefined, options: PhpOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing traits...') : null;
  spinner?.start();

  try {
    const analyzer = createPhpAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeTraits();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🧩 Trait Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Traits Defined: ${chalk.cyan(result.traits.length)}`);
    console.log(`Trait Usages: ${chalk.cyan(result.usages.length)}`);
    console.log();

    if (result.traits.length === 0) {
      console.log(chalk.gray('No traits found'));
      console.log();
      return;
    }

    console.log(chalk.bold('Traits:'));
    for (const trait of result.traits.slice(0, 15)) {
      console.log(`  ${chalk.cyan(trait.name)} (${trait.methods.length} methods)`);
      console.log(chalk.gray(`    ${trait.file}:${trait.line}`));
      if (trait.methods.length > 0 && options.verbose) {
        console.log(chalk.gray(`    methods: ${trait.methods.join(', ')}`));
      }
    }
    if (result.traits.length > 15) {
      console.log(chalk.gray(`  ... and ${result.traits.length - 15} more`));
    }
    console.log();

    if (result.usages.length > 0) {
      console.log(chalk.bold('Trait Usages:'));
      for (const usage of result.usages.slice(0, 15)) {
        console.log(`  ${chalk.cyan(usage.trait)} → ${usage.usedIn}`);
        console.log(chalk.gray(`    ${usage.file}:${usage.line}`));
      }
      if (result.usages.length > 15) {
        console.log(chalk.gray(`  ... and ${result.usages.length - 15} more`));
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
    ANY: chalk.white,
  };
  return colors[method] ?? chalk.white;
}
