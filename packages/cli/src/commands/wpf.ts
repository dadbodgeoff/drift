/**
 * WPF Command - drift wpf
 *
 * Analyze WPF applications: bindings, MVVM compliance, data flow.
 *
 * @requirements WPF Framework Support
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createWpfAnalyzer,
  createWpfDataFlowTracer,
  createValueConverterExtractor,
  type ViewModelLink,
  type BindingError,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface WpfOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Show only unresolved bindings */
  unresolvedOnly?: boolean;
}

/**
 * Create the WPF command
 */
export function createWpfCommand(): Command {
  const wpf = new Command('wpf')
    .description('WPF framework analysis commands');

  // drift wpf bindings
  wpf
    .command('bindings [path]')
    .description('List all XAML bindings and their targets')
    .option('--unresolved', 'Show only unresolved bindings')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions) => {
      await bindingsAction(targetPath, options);
    });

  // drift wpf mvvm
  wpf
    .command('mvvm [path]')
    .description('Check MVVM compliance')
    .option('--strict', 'Fail on any violation')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions & { strict?: boolean }) => {
      await mvvmAction(targetPath, options);
    });

  // drift wpf datacontext
  wpf
    .command('datacontext [path]')
    .description('Show DataContext resolution for views')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions) => {
      await datacontextAction(targetPath, options);
    });

  // drift wpf commands
  wpf
    .command('commands [path]')
    .description('List all commands and their handlers')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions) => {
      await commandsAction(targetPath, options);
    });

  // drift wpf status
  wpf
    .command('status [path]')
    .description('Show WPF project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions) => {
      await statusAction(targetPath, options);
    });

  // drift wpf flow
  wpf
    .command('flow <element>')
    .description('Trace data flow from UI element to database')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--max-depth <depth>', 'Maximum trace depth', '10')
    .action(async (element: string, options: WpfOptions & { maxDepth?: string }) => {
      await flowAction(element, options);
    });

  // drift wpf converters
  wpf
    .command('converters [path]')
    .description('List all value converters and their usage')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(async (targetPath: string | undefined, options: WpfOptions) => {
      await convertersAction(targetPath, options);
    });

  return wpf;
}

/**
 * Bindings subcommand
 */
async function bindingsAction(targetPath: string | undefined, options: WpfOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing XAML bindings...') : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.stats.totalBindings,
        resolved: result.stats.resolvedBindings,
        unresolved: result.stats.unresolvedBindings,
        bindings: options.unresolvedOnly
          ? result.bindingErrors
          : [...result.links, ...result.bindingErrors.map(e => ({ ...e, resolved: false }))],
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 XAML Bindings Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Bindings: ${chalk.cyan(result.stats.totalBindings)}`);
    console.log(`Resolved: ${chalk.green(result.stats.resolvedBindings)}`);
    console.log(`Unresolved: ${chalk.yellow(result.stats.unresolvedBindings)}`);
    console.log();

    // Group by XAML file
    const byFile = new Map<string, { links: ViewModelLink[]; errors: BindingError[] }>();

    for (const link of result.links) {
      const existing = byFile.get(link.xamlFile) ?? { links: [], errors: [] };
      existing.links.push(link);
      byFile.set(link.xamlFile, existing);
    }

    for (const error of result.bindingErrors) {
      const existing = byFile.get(error.xamlFile) ?? { links: [], errors: [] };
      existing.errors.push(error);
      byFile.set(error.xamlFile, existing);
    }

    // Display by file
    for (const [file, data] of byFile) {
      const total = data.links.length + data.errors.length;
      console.log(chalk.bold(`${file} (${total} bindings)`));

      if (!options.unresolvedOnly) {
        for (const link of data.links) {
          console.log(`  ${chalk.green('✓')} ${link.xamlElement}.${link.bindingPath} → ${chalk.cyan(link.viewModelClass)}.${link.viewModelProperty}`);
        }
      }

      for (const error of data.errors) {
        console.log(`  ${chalk.yellow('⚠')} ${error.bindingPath} - ${error.message}`);
        if (error.suggestion) {
          console.log(chalk.gray(`    ${error.suggestion}`));
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
 * MVVM compliance subcommand
 */
async function mvvmAction(
  targetPath: string | undefined,
  options: WpfOptions & { strict?: boolean }
): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Checking MVVM compliance...') : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.checkMvvmCompliance();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        score: result.score,
        violationCount: result.violations.length,
        violations: result.violations,
        recommendations: result.recommendations,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🏗️  MVVM Compliance Check'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    // Score with color
    const scoreColor = result.score >= 80 ? chalk.green :
                       result.score >= 60 ? chalk.yellow : chalk.red;
    console.log(`Score: ${scoreColor.bold(`${result.score}/100`)}`);
    console.log();

    // Violations
    if (result.violations.length > 0) {
      console.log(chalk.bold('Violations:'));
      for (const v of result.violations) {
        const severityIcon = v.severity === 'error' ? chalk.red('✗') :
                            v.severity === 'warning' ? chalk.yellow('⚠') : chalk.gray('ℹ');
        console.log(`  ${severityIcon} ${chalk.white(v.file)}:${v.line}`);
        console.log(`    ${v.message}`);
        if (v.suggestion) {
          console.log(chalk.gray(`    → ${v.suggestion}`));
        }
      }
      console.log();
    } else {
      console.log(chalk.green('✓ No violations found'));
      console.log();
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      console.log(chalk.bold('Recommendations:'));
      for (const rec of result.recommendations) {
        console.log(`  • ${rec}`);
      }
      console.log();
    }

    // Exit with error if strict mode and violations exist
    if (options.strict && result.violations.length > 0) {
      process.exit(1);
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
 * DataContext subcommand
 */
async function datacontextAction(targetPath: string | undefined, options: WpfOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Resolving DataContexts...') : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        views: result.dataContexts.map(dc => ({
          view: dc.xamlFile,
          dataContext: dc.resolvedType,
          confidence: dc.confidence,
          resolutionPath: dc.resolutionPath,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔗 DataContext Resolution'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    for (const dc of result.dataContexts) {
      const confidenceIcon = dc.confidence === 'high' ? chalk.green('●') :
                            dc.confidence === 'medium' ? chalk.yellow('●') : chalk.red('●');
      const vmDisplay = dc.resolvedType ?? chalk.gray('UNRESOLVED');

      console.log(`${confidenceIcon} ${chalk.white(dc.xamlFile)}`);
      console.log(`  DataContext: ${chalk.cyan(vmDisplay)}`);
      console.log(`  Confidence: ${dc.confidence}`);

      if (options.verbose && dc.resolutionPath.length > 0) {
        console.log(chalk.gray('  Resolution path:'));
        for (const step of dc.resolutionPath) {
          console.log(chalk.gray(`    ${step.source}: ${step.type}`));
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
 * Commands subcommand
 */
async function commandsAction(targetPath: string | undefined, options: WpfOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Extracting commands...') : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // Collect all commands from ViewModels
    const commands: Array<{
      name: string;
      viewModel: string;
      executeMethod?: string | undefined;
      canExecuteMethod?: string | undefined;
      isAsync?: boolean | undefined;
      file: string;
      line: number;
    }> = [];

    for (const vm of result.viewModels.values()) {
      for (const cmd of vm.commands) {
        commands.push({
          name: cmd.name,
          viewModel: vm.className,
          executeMethod: cmd.executeMethod,
          canExecuteMethod: cmd.canExecuteMethod,
          isAsync: cmd.isAsync,
          file: vm.filePath,
          line: cmd.location.line,
        });
      }
    }

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        total: commands.length,
        commands,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('⚡ Commands'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Commands: ${chalk.cyan(commands.length)}`);
    console.log();

    // Group by ViewModel
    const byViewModel = new Map<string, typeof commands>();
    for (const cmd of commands) {
      const existing = byViewModel.get(cmd.viewModel) ?? [];
      existing.push(cmd);
      byViewModel.set(cmd.viewModel, existing);
    }

    for (const [vmName, vmCommands] of byViewModel) {
      console.log(chalk.bold(`${vmName} (${vmCommands.length} commands)`));

      for (const cmd of vmCommands) {
        const asyncBadge = cmd.isAsync ? chalk.blue(' [async]') : '';
        console.log(`  ${chalk.cyan(cmd.name)}${asyncBadge}`);
        if (cmd.executeMethod) {
          console.log(chalk.gray(`    Execute: ${cmd.executeMethod}()`));
        }
        if (cmd.canExecuteMethod) {
          console.log(chalk.gray(`    CanExecute: ${cmd.canExecuteMethod}()`));
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
 * Status subcommand
 */
async function statusAction(targetPath: string | undefined, options: WpfOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing WPF project...') : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        project: result.project,
        stats: result.stats,
        viewModels: Array.from(result.viewModels.values()).map(vm => ({
          name: vm.className,
          properties: vm.properties.length,
          commands: vm.commands.length,
          implementsINPC: vm.implementsINPC,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 WPF Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    if (result.project) {
      console.log(chalk.bold('Project'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  File: ${chalk.cyan(result.project.projectFile)}`);
      console.log(`  Framework: ${chalk.cyan(result.project.targetFramework)}`);
      console.log(`  XAML Files: ${chalk.cyan(result.project.xamlFiles.length)}`);
      console.log(`  ViewModels: ${chalk.cyan(result.project.viewModels.length)}`);
      console.log(`  Converters: ${chalk.cyan(result.project.converters.length)}`);
      console.log();
    } else {
      console.log(chalk.yellow('⚠ No WPF project detected'));
      console.log();
    }

    // Statistics
    console.log(chalk.bold('Statistics'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  XAML Files Analyzed: ${chalk.cyan(result.stats.xamlFileCount)}`);
    console.log(`  ViewModels Found: ${chalk.cyan(result.stats.viewModelCount)}`);
    console.log(`  Total Bindings: ${chalk.cyan(result.stats.totalBindings)}`);
    console.log(`  Resolved Bindings: ${chalk.green(result.stats.resolvedBindings)}`);
    console.log(`  Unresolved Bindings: ${chalk.yellow(result.stats.unresolvedBindings)}`);
    console.log(`  Total Commands: ${chalk.cyan(result.stats.totalCommands)}`);
    console.log(`  Analysis Time: ${chalk.gray(`${result.stats.analysisTimeMs.toFixed(0)}ms`)}`);
    console.log();

    // ViewModels summary
    if (result.viewModels.size > 0) {
      console.log(chalk.bold('ViewModels'));
      console.log(chalk.gray('─'.repeat(40)));

      for (const vm of result.viewModels.values()) {
        const inpcIcon = vm.implementsINPC ? chalk.green('✓') : chalk.yellow('⚠');
        console.log(`  ${inpcIcon} ${chalk.white(vm.className)}`);
        console.log(chalk.gray(`    ${vm.properties.length} properties, ${vm.commands.length} commands`));
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift wpf bindings     ${chalk.white('View all bindings')}`));
    console.log(chalk.gray(`  • drift wpf mvvm         ${chalk.white('Check MVVM compliance')}`));
    console.log(chalk.gray(`  • drift wpf datacontext  ${chalk.white('View DataContext resolution')}`));
    console.log(chalk.gray(`  • drift wpf commands     ${chalk.white('List all commands')}`));
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
 * Flow subcommand - trace data flow from UI element
 */
async function flowAction(
  element: string,
  options: WpfOptions & { maxDepth?: string }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  // maxDepth option is available for future depth-limited tracing
  void options.maxDepth;

  const spinner = isTextFormat ? createSpinner(`Tracing data flow for '${element}'...`) : null;
  spinner?.start();

  try {
    const analyzer = createWpfAnalyzer({ rootDir, verbose: options.verbose });
    const result = await analyzer.analyze();

    // Create data flow tracer
    const tracer = createWpfDataFlowTracer();
    tracer.initialize(result.xamlFiles, result.viewModels, result.links);

    const flow = tracer.trace(element);

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        element: flow.element,
        steps: flow.steps,
        reachesDatabase: flow.reachesDatabase,
        sensitiveDataAccessed: flow.sensitiveDataAccessed,
        depth: flow.depth,
        confidence: flow.confidence,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold(`🔍 Data Flow: ${element}`));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    if (flow.steps.length === 0 || flow.confidence === 0) {
      console.log(chalk.yellow(`⚠ Could not trace data flow for '${element}'`));
      console.log();
      return;
    }

    // Display flow steps
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i]!;
      const prefix = i === flow.steps.length - 1 ? '└─' : '├─';
      const typeIcon = getStepIcon(step.type);

      console.log(`${prefix} ${typeIcon} ${chalk.bold(step.type)}`);
      console.log(`   ${chalk.gray(step.location)}`);

      if (step.details) {
        if (step.details.bindingPath) {
          console.log(chalk.gray(`   Binding: ${step.details.bindingPath}`));
        }
        if (step.details.table) {
          console.log(chalk.gray(`   Table: ${step.details.table}`));
        }
      }
    }

    console.log();

    // Summary
    if (flow.reachesDatabase) {
      console.log(chalk.green('✓ Reaches database'));
    } else {
      console.log(chalk.gray('○ Does not reach database'));
    }

    if (flow.sensitiveDataAccessed.length > 0) {
      console.log(chalk.yellow(`⚠ Sensitive data: ${flow.sensitiveDataAccessed.join(', ')}`));
    }

    console.log(chalk.gray(`Confidence: ${(flow.confidence * 100).toFixed(0)}%`));
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
 * Get icon for flow step type
 */
function getStepIcon(type: string): string {
  switch (type) {
    case 'xaml-element': return '🖼️';
    case 'binding': return '🔗';
    case 'viewmodel-property': return '📦';
    case 'viewmodel-command': return '⚡';
    case 'method-call': return '📞';
    case 'service-call': return '🔧';
    case 'ef-query': return '🗄️';
    case 'database-table': return '📊';
    default: return '•';
  }
}

/**
 * Converters subcommand - list value converters
 */
async function convertersAction(targetPath: string | undefined, options: WpfOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing value converters...') : null;
  spinner?.start();

  try {
    const extractor = createValueConverterExtractor();
    const result = await extractor.analyzeProject(rootDir);

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.converters.length,
        totalUsages: result.totalUsages,
        converters: result.converters.map(c => ({
          className: c.className,
          qualifiedName: c.qualifiedName,
          type: c.converterType,
          resourceKeys: c.resourceKeys,
          hasConvert: c.convertMethod?.hasImplementation ?? false,
          hasConvertBack: c.convertBackMethod?.hasImplementation ?? false,
          usageCount: c.usages.length,
          file: c.filePath,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔄 Value Converters'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(`Total Converters: ${chalk.cyan(result.converters.length)}`);
    console.log(`Total Usages: ${chalk.cyan(result.totalUsages)}`);
    console.log();

    if (result.converters.length === 0) {
      console.log(chalk.gray('No value converters found'));
      console.log();
      return;
    }

    for (const converter of result.converters) {
      const typeLabel = converter.converterType === 'IMultiValueConverter'
        ? chalk.blue('[Multi]')
        : chalk.green('[Single]');

      console.log(`${chalk.bold(converter.className)} ${typeLabel}`);
      console.log(chalk.gray(`  File: ${converter.filePath}`));

      if (converter.resourceKeys.length > 0) {
        console.log(chalk.gray(`  Resource Keys: ${converter.resourceKeys.join(', ')}`));
      }

      const convertStatus = converter.convertMethod?.hasImplementation
        ? chalk.green('✓')
        : chalk.yellow('○');
      const convertBackStatus = converter.convertBackMethod?.hasImplementation
        ? chalk.green('✓')
        : chalk.gray('○');

      console.log(`  Convert: ${convertStatus}  ConvertBack: ${convertBackStatus}`);
      console.log(`  Usages: ${chalk.cyan(converter.usages.length)}`);

      if (options.verbose && converter.usages.length > 0) {
        for (const usage of converter.usages.slice(0, 5)) {
          console.log(chalk.gray(`    • ${usage.xamlFile}:${usage.line}`));
        }
        if (converter.usages.length > 5) {
          console.log(chalk.gray(`    ... and ${converter.usages.length - 5} more`));
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
