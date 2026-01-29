/**
 * Java Command - drift java
 *
 * Analyze Java projects: routes, error handling, data access, annotations.
 *
 * @requirements Java Language Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createJavaAnalyzer,
  type JavaRoute,
  type JavaErrorPattern,
  type JavaAnnotation,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface JavaOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  framework?: string;
}

export function createJavaCommand(): Command {
  const java = new Command('java')
    .description('Java language analysis commands');

  // drift java status
  java
    .command('status [path]')
    .description('Show Java project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: JavaOptions) => {
      await statusAction(targetPath, options);
    });

  // drift java routes
  java
    .command('routes [path]')
    .description('List all HTTP routes (Spring MVC, JAX-RS, Micronaut, Quarkus)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--framework <framework>', 'Filter by framework')
    .action(async (targetPath: string | undefined, options: JavaOptions) => {
      await routesAction(targetPath, options);
    });

  // drift java errors
  java
    .command('errors [path]')
    .description('Analyze error handling patterns')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: JavaOptions) => {
      await errorsAction(targetPath, options);
    });

  // drift java data-access
  java
    .command('data-access [path]')
    .description('Analyze database access patterns (Spring Data JPA, Hibernate, JDBC, MyBatis)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: JavaOptions) => {
      await dataAccessAction(targetPath, options);
    });

  // drift java annotations
  java
    .command('annotations [path]')
    .description('Analyze annotation usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: JavaOptions) => {
      await annotationsAction(targetPath, options);
    });

  return java;
}

async function statusAction(targetPath: string | undefined, options: JavaOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing Java project...') : null;
  spinner?.start();

  try {
    const analyzer = createJavaAnalyzer({ rootDir, verbose: options.verbose });
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
    console.log(chalk.bold('☕ Java Project Status'));
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
    if (result.projectInfo.buildTool) {
      console.log(`  Build Tool: ${chalk.cyan(result.projectInfo.buildTool)}`);
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
    console.log(`  Interfaces: ${chalk.cyan(result.stats.interfaceCount)}`);
    console.log(`  Methods: ${chalk.cyan(result.stats.methodCount)}`);
    console.log(`  Annotations: ${chalk.cyan(result.stats.annotationCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift java routes       ${chalk.white('View HTTP routes')}`));
    console.log(chalk.gray(`  • drift java errors       ${chalk.white('Analyze error handling')}`));
    console.log(chalk.gray(`  • drift java data-access  ${chalk.white('View data access patterns')}`));
    console.log(chalk.gray(`  • drift java annotations  ${chalk.white('View annotation usage')}`));
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

async function routesAction(targetPath: string | undefined, options: JavaOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing routes...') : null;
  spinner?.start();

  try {
    const analyzer = createJavaAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeRoutes();

    spinner?.stop();

    let routes = result.routes;
    if (options.framework) {
      routes = routes.filter((r: JavaRoute) => r.framework === options.framework);
    }

    if (format === 'json') {
      console.log(JSON.stringify({ total: routes.length, byFramework: result.byFramework, routes }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🛣️  Java HTTP Routes'));
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

async function errorsAction(targetPath: string | undefined, options: JavaOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing error handling...') : null;
  spinner?.start();

  try {
    const analyzer = createJavaAnalyzer({ rootDir, verbose: options.verbose });
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
    console.log(`Exception Handlers: ${chalk.cyan(result.stats.exceptionHandlers)}`);
    console.log();

    const patternCounts = {
      'try-catch': result.patterns.filter((p: JavaErrorPattern) => p.type === 'try-catch').length,
      'throw': result.patterns.filter((p: JavaErrorPattern) => p.type === 'throw').length,
      'custom-exception': result.patterns.filter((p: JavaErrorPattern) => p.type === 'custom-exception').length,
      'exception-handler': result.patterns.filter((p: JavaErrorPattern) => p.type === 'exception-handler').length,
    };

    console.log(chalk.bold('Pattern Breakdown:'));
    console.log(`  Try-Catch: ${chalk.cyan(patternCounts['try-catch'])}`);
    console.log(`  Throw: ${chalk.yellow(patternCounts['throw'])}`);
    console.log(`  Custom Exception: ${chalk.blue(patternCounts['custom-exception'])}`);
    console.log(`  Exception Handler: ${chalk.green(patternCounts['exception-handler'])}`);
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

async function dataAccessAction(targetPath: string | undefined, options: JavaOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing data access patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createJavaAnalyzer({ rootDir, verbose: options.verbose });
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
    console.log(`Repositories: ${chalk.cyan(result.repositories.length)}`);
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

    if (result.repositories.length > 0) {
      console.log(chalk.bold('Repositories:'));
      for (const repo of result.repositories) {
        console.log(`  • ${repo}`);
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

async function annotationsAction(targetPath: string | undefined, options: JavaOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing annotations...') : null;
  spinner?.start();

  try {
    const analyzer = createJavaAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyzeAnnotations();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🎀 Annotation Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Annotations: ${chalk.cyan(result.annotations.length)}`);
    console.log();

    if (result.annotations.length === 0) {
      console.log(chalk.gray('No annotations found'));
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

    // By target
    const byTarget = {
      class: result.annotations.filter((a: JavaAnnotation) => a.target === 'class').length,
      method: result.annotations.filter((a: JavaAnnotation) => a.target === 'method').length,
      field: result.annotations.filter((a: JavaAnnotation) => a.target === 'field').length,
      parameter: result.annotations.filter((a: JavaAnnotation) => a.target === 'parameter').length,
    };

    console.log(chalk.bold('By Target:'));
    console.log(`  Class: ${chalk.cyan(byTarget.class)}`);
    console.log(`  Method: ${chalk.cyan(byTarget.method)}`);
    console.log(`  Field: ${chalk.cyan(byTarget.field)}`);
    console.log(`  Parameter: ${chalk.cyan(byTarget.parameter)}`);
    console.log();

    if (options.verbose) {
      console.log(chalk.bold('Annotations:'));
      for (const ann of result.annotations.slice(0, 20)) {
        console.log(`  @${chalk.cyan(ann.name)} (${ann.target})`);
        console.log(chalk.gray(`    ${ann.file}:${ann.line}`));
      }
      if (result.annotations.length > 20) {
        console.log(chalk.gray(`  ... and ${result.annotations.length - 20} more`));
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
