/**
 * C++ Command - drift cpp
 *
 * Analyze C++ projects: classes, memory, templates, virtual functions.
 *
 * @requirements C++ Language Support
 * @license Apache-2.0
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { createCppAnalyzer, type CppClass, type CppMemoryPattern, type CppModule, type CppTemplate } from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface CppOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Filter by framework */
  framework?: string;
}

/**
 * Create the C++ command
 */
export function createCppCommand(): Command {
  const cpp = new Command('cpp')
    .description('C++ language analysis commands');

  // drift cpp status
  cpp
    .command('status [path]')
    .description('Show C++ project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: CppOptions) => {
      await statusAction(targetPath, options);
    });

  // drift cpp classes
  cpp
    .command('classes [path]')
    .description('List all classes and structs with inheritance')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: CppOptions) => {
      await classesAction(targetPath, options);
    });

  // drift cpp memory
  cpp
    .command('memory [path]')
    .description('Analyze memory management patterns (smart pointers, RAII)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: CppOptions) => {
      await memoryAction(targetPath, options);
    });

  // drift cpp templates
  cpp
    .command('templates [path]')
    .description('List template classes and functions')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: CppOptions) => {
      await templatesAction(targetPath, options);
    });

  // drift cpp virtual
  cpp
    .command('virtual [path]')
    .description('Analyze virtual functions and polymorphism')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: CppOptions) => {
      await virtualAction(targetPath, options);
    });

  return cpp;
}

/**
 * Status subcommand
 */
async function statusAction(targetPath: string | undefined, options: CppOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing C++ project...') : null;
  spinner?.start();

  try {
    const analyzer = createCppAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        project: {
          projectName: result.projectName,
          cppStandard: result.cppStandard,
          modules: result.modules.length,
          files: result.stats.fileCount,
          functions: result.stats.functionCount,
          classes: result.stats.classCount,
          structs: result.stats.structCount,
        },
        frameworks: result.detectedFrameworks,
        stats: result.stats,
        topModules: result.modules.slice(0, 10).map((module: CppModule) => ({
          name: module.name,
          files: module.files.length,
          functions: module.functions.length,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 C++ Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    if (result.projectName) {
      console.log(`  Name: ${chalk.cyan(result.projectName)}`);
    }
    if (result.cppStandard) {
      console.log(`  Standard: ${chalk.cyan(result.cppStandard)}`);
    }
    console.log(`  Modules: ${chalk.cyan(result.modules.length)}`);
    console.log(`  Files: ${chalk.cyan(result.stats.fileCount)} (${result.stats.headerCount} headers, ${result.stats.sourceCount} sources)`);
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
    console.log(`  Structs: ${chalk.cyan(result.stats.structCount)}`);
    console.log(`  Templates: ${chalk.cyan(result.stats.templateCount)}`);
    console.log(`  Virtual Methods: ${chalk.cyan(result.stats.virtualMethodCount)}`);
    console.log(`  Lines of Code: ${chalk.cyan(result.stats.linesOfCode.toLocaleString())}`);
    console.log(`  Test Files: ${chalk.cyan(result.stats.testFileCount)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    // Top modules
    if (result.modules.length > 0) {
      console.log(chalk.bold('Top Modules'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const module of result.modules.slice(0, 5)) {
        console.log(`  ${chalk.white(module.name)}`);
        console.log(chalk.gray(`    ${module.files.length} files, ${module.functions.length} functions`));
      }
      if (result.modules.length > 5) {
        console.log(chalk.gray(`  ... and ${result.modules.length - 5} more modules`));
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift cpp classes     ${chalk.white('View classes and inheritance')}`));
    console.log(chalk.gray(`  • drift cpp memory      ${chalk.white('Analyze memory patterns')}`));
    console.log(chalk.gray(`  • drift cpp templates   ${chalk.white('View templates')}`));
    console.log(chalk.gray(`  • drift cpp virtual     ${chalk.white('Analyze virtual functions')}`));
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
 * Classes subcommand
 */
async function classesAction(targetPath: string | undefined, options: CppOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing C++ classes...') : null;
  spinner?.start();

  try {
    const analyzer = createCppAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeClasses();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🏗️  C++ Classes'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Classes: ${chalk.cyan(result.byKind['class'] ?? 0)}`);
    console.log(`Total Structs: ${chalk.cyan(result.byKind['struct'] ?? 0)}`);
    console.log();

    if (result.classes.length === 0) {
      console.log(chalk.gray('No classes found'));
      console.log();
      return;
    }

    // Group by kind
    const classes = result.classes.filter((c: CppClass) => c.kind === 'class');
    const structs = result.classes.filter((c: CppClass) => c.kind === 'struct');

    if (classes.length > 0) {
      console.log(chalk.bold(`Classes (${classes.length})`));
      for (const cls of classes.slice(0, 20)) {
        const templateBadge = cls.isTemplate ? chalk.magenta(' [template]') : '';
        const baseBadge = cls.baseClasses.length > 0 ? chalk.gray(` : ${cls.baseClasses.join(', ')}`) : '';
        const virtualBadge = cls.virtualMethods.length > 0 ? chalk.yellow(` (${cls.virtualMethods.length} virtual)`) : '';

        console.log(`  ${chalk.bold(cls.name)}${templateBadge}${baseBadge}${virtualBadge}`);
        console.log(chalk.gray(`    ${cls.file}:${cls.line}`));
      }
      if (classes.length > 20) {
        console.log(chalk.gray(`  ... and ${classes.length - 20} more classes`));
      }
      console.log();
    }

    if (structs.length > 0 && options.verbose) {
      console.log(chalk.bold(`Structs (${structs.length})`));
      for (const s of structs.slice(0, 10)) {
        console.log(`  ${chalk.bold(s.name)}`);
        console.log(chalk.gray(`    ${s.file}:${s.line}`));
      }
      if (structs.length > 10) {
        console.log(chalk.gray(`  ... and ${structs.length - 10} more structs`));
      }
      console.log();
    }

    // Inheritance depth
    const deepInheritance = Object.entries(result.inheritanceDepth)
      .filter(([, depth]) => (depth) > 2)
      .sort((a, b) => (b[1]) - (a[1]));

    if (deepInheritance.length > 0) {
      console.log(chalk.bold('Deep Inheritance (depth > 2):'));
      for (const [name, depth] of deepInheritance.slice(0, 5)) {
        console.log(`  ${name}: ${chalk.yellow(depth)} levels`);
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
 * Memory subcommand
 */
async function memoryAction(targetPath: string | undefined, options: CppOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing memory patterns...') : null;
  spinner?.start();

  try {
    const analyzer = createCppAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeMemory();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🧠 C++ Memory Management'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    // Smart pointers (good)
    console.log(chalk.bold('Smart Pointers (Modern C++):'));
    console.log(`  unique_ptr: ${chalk.green(result.stats.uniquePtrs)}`);
    console.log(`  shared_ptr: ${chalk.green(result.stats.sharedPtrs)}`);
    console.log(`  weak_ptr: ${chalk.green(result.stats.weakPtrs)}`);
    console.log();

    // Manual memory (potential issues)
    console.log(chalk.bold('Manual Memory Management:'));
    console.log(`  new calls: ${chalk.yellow(result.stats.newCalls)}`);
    console.log(`  delete calls: ${chalk.yellow(result.stats.deleteCalls)}`);
    console.log(`  malloc calls: ${chalk.red(result.stats.mallocCalls)}`);
    console.log(`  free calls: ${chalk.red(result.stats.freeCalls)}`);
    console.log(`  Raw pointers: ${chalk.gray(result.stats.rawPointers)}`);
    console.log();

    // RAII classes
    if (result.raiiClasses.length > 0) {
      console.log(chalk.bold('RAII Classes (with destructors):'));
      for (const cls of result.raiiClasses.slice(0, 10)) {
        console.log(`  • ${cls}`);
      }
      if (result.raiiClasses.length > 10) {
        console.log(chalk.gray(`  ... and ${result.raiiClasses.length - 10} more`));
      }
      console.log();
    }

    // Issues
    if (result.issues.length > 0) {
      console.log(chalk.bold('Potential Issues:'));
      for (const issue of result.issues.slice(0, 10)) {
        console.log(`  ${chalk.yellow('⚠')} ${issue.message}`);
        if (issue.file !== 'project') {
          console.log(chalk.gray(`    ${issue.file}:${issue.line}`));
        }
        if (issue.suggestion) {
          console.log(chalk.gray(`    → ${issue.suggestion}`));
        }
      }
      if (result.issues.length > 10) {
        console.log(chalk.gray(`  ... and ${result.issues.length - 10} more issues`));
      }
      console.log();
    }

    // Patterns (verbose)
    if (options.verbose && result.patterns.length > 0) {
      console.log(chalk.bold('Memory Patterns:'));
      const issuePatterns = result.patterns.filter((p: CppMemoryPattern) => p.isIssue);
      for (const pattern of issuePatterns.slice(0, 10)) {
        console.log(`  ${chalk.yellow(pattern.type)} ${pattern.file}:${pattern.line}`);
        if (pattern.suggestion) {
          console.log(chalk.gray(`    → ${pattern.suggestion}`));
        }
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
 * Templates subcommand
 */
async function templatesAction(targetPath: string | undefined, options: CppOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing templates...') : null;
  spinner?.start();

  try {
    const analyzer = createCppAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeTemplates();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📐 C++ Templates'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Template Classes: ${chalk.cyan(result.byKind['class'] ?? 0)}`);
    console.log(`Template Functions: ${chalk.cyan(result.byKind['function'] ?? 0)}`);
    console.log();

    if (result.templates.length === 0) {
      console.log(chalk.gray('No templates found'));
      console.log();
      return;
    }

    // Template classes
    const templateClasses = result.templates.filter((t: CppTemplate) => t.kind === 'class');
    if (templateClasses.length > 0) {
      console.log(chalk.bold('Template Classes:'));
      for (const tmpl of templateClasses.slice(0, 15)) {
        const params = tmpl.parameters.join(', ');
        console.log(`  ${chalk.bold(tmpl.name)}<${chalk.magenta(params)}>`);
        console.log(chalk.gray(`    ${tmpl.file}:${tmpl.line}`));
      }
      if (templateClasses.length > 15) {
        console.log(chalk.gray(`  ... and ${templateClasses.length - 15} more`));
      }
      console.log();
    }

    // Template functions
    const templateFunctions = result.templates.filter((t: CppTemplate) => t.kind === 'function');
    if (templateFunctions.length > 0) {
      console.log(chalk.bold('Template Functions:'));
      for (const tmpl of templateFunctions.slice(0, 15)) {
        const params = tmpl.parameters.join(', ');
        console.log(`  ${chalk.bold(tmpl.name)}<${chalk.magenta(params)}>`);
        console.log(chalk.gray(`    ${tmpl.file}:${tmpl.line}`));
      }
      if (templateFunctions.length > 15) {
        console.log(chalk.gray(`  ... and ${templateFunctions.length - 15} more`));
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
 * Virtual subcommand
 */
async function virtualAction(targetPath: string | undefined, options: CppOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing virtual functions...') : null;
  spinner?.start();

  try {
    const analyzer = createCppAnalyzer({ rootDir, verbose: options.verbose ?? false });
    const result = await analyzer.analyzeVirtual();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔌 C++ Virtual Functions & Polymorphism'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Virtual Methods: ${chalk.cyan(result.virtualMethods.length)}`);
    console.log(`Abstract Classes: ${chalk.cyan(result.abstractClasses.length)}`);
    console.log(`Polymorphic Hierarchies: ${chalk.cyan(result.polymorphicHierarchies.length)}`);
    console.log();

    // Abstract classes
    if (result.abstractClasses.length > 0) {
      console.log(chalk.bold('Abstract Classes:'));
      for (const cls of result.abstractClasses.slice(0, 10)) {
        console.log(`  • ${cls}`);
      }
      if (result.abstractClasses.length > 10) {
        console.log(chalk.gray(`  ... and ${result.abstractClasses.length - 10} more`));
      }
      console.log();
    }

    // Polymorphic hierarchies
    if (result.polymorphicHierarchies.length > 0) {
      console.log(chalk.bold('Polymorphic Hierarchies:'));
      for (const hierarchy of result.polymorphicHierarchies.slice(0, 10)) {
        const depthBadge = hierarchy.depth > 3 ? chalk.yellow(` (depth: ${hierarchy.depth})`) : '';
        console.log(`  ${chalk.bold(hierarchy.baseClass)}${depthBadge}`);
        console.log(chalk.gray(`    → ${hierarchy.derivedClasses.join(', ')}`));
      }
      if (result.polymorphicHierarchies.length > 10) {
        console.log(chalk.gray(`  ... and ${result.polymorphicHierarchies.length - 10} more`));
      }
      console.log();
    }

    // Virtual methods (verbose)
    if (options.verbose && result.virtualMethods.length > 0) {
      console.log(chalk.bold('Virtual Methods:'));
      for (const method of result.virtualMethods.slice(0, 20)) {
        const pureVirtualBadge = method.isPureVirtual ? chalk.red(' = 0') : '';
        console.log(`  ${chalk.bold(method.className)}::${method.name}${pureVirtualBadge}`);
        console.log(chalk.gray(`    ${method.file}:${method.line}`));
      }
      if (result.virtualMethods.length > 20) {
        console.log(chalk.gray(`  ... and ${result.virtualMethods.length - 20} more`));
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
