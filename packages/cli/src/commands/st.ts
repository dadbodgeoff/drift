/**
 * ST Command - drift st
 *
 * Analyze IEC 61131-3 Structured Text code: docstrings, state machines, safety interlocks, tribal knowledge.
 * 
 * This is the CLI-first implementation. MCP is a thin wrapper around this.
 * Following architecture doc Part 11: CLI-First Design
 *
 * @requirements IEC 61131-3 Code Factory
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { IEC61131Analyzer } from 'driftdetect-core/iec61131';

import { createSpinner } from '../ui/spinner.js';

// ============================================================================
// Types
// ============================================================================

export interface STOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  limit?: string;
  includeRaw?: boolean;
  strict?: boolean;
  target?: string;
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Create the ST command with all subcommands
 */
function createSTCommand(): Command {
  const st = new Command('st')
    .description('Analyze IEC 61131-3 Structured Text code');

  // drift st status
  st
    .command('status [path]')
    .description('Show ST project analysis summary')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(statusAction);

  // drift st docstrings
  st
    .command('docstrings [path]')
    .description('Extract documentation from ST files (PhD primary request)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-l, --limit <n>', 'Limit results', '50')
    .option('--include-raw', 'Include raw docstring text')
    .action(docstringsAction);

  // drift st blocks
  st
    .command('blocks [path]')
    .description('List all POUs (PROGRAM, FUNCTION_BLOCK, FUNCTION)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(blocksAction);

  // drift st state-machines
  st
    .command('state-machines [path]')
    .description('Detect CASE-based state machines')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(stateMachinesAction);

  // drift st safety
  st
    .command('safety [path]')
    .description('Analyze safety interlocks and bypasses (CRITICAL)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--strict', 'Exit with error if bypasses detected')
    .action(safetyAction);

  // drift st tribal
  st
    .command('tribal [path]')
    .description('Extract tribal knowledge (warnings, workarounds, gotchas)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(tribalAction);

  // drift st variables
  st
    .command('variables [path]')
    .description('Extract all variables with types and comments')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-l, --limit <n>', 'Limit results', '100')
    .action(variablesAction);

  // drift st io-map
  st
    .command('io-map [path]')
    .description('Extract I/O address mappings')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(ioMapAction);

  // drift st diagram
  st
    .command('diagram [path]')
    .description('Generate state machine diagrams (Mermaid)')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(diagramAction);

  // drift st migration
  st
    .command('migration [path]')
    .description('Calculate migration readiness scores')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(migrationAction);

  // drift st ai-context
  st
    .command('ai-context [path]')
    .description('Generate AI context package for migration')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-t, --target <language>', 'Target language: python, rust, typescript, csharp, cpp, go, java', 'python')
    .option('--max-tokens <n>', 'Maximum tokens for context', '50000')
    .action(aiContextAction);

  // drift st call-graph
  st
    .command('call-graph [path]')
    .description('Build and display call graph')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(callGraphAction);

  // drift st all
  st
    .command('all [path]')
    .description('Run full analysis pipeline')
    .option('-f, --format <format>', 'Output format: text, json', 'text')
    .option('-v, --verbose', 'Enable verbose output')
    .action(allAction);

  return st;
}

// Export as stCommand for consistency with other commands
export const stCommand = createSTCommand();

// ============================================================================
// Action Implementations
// ============================================================================

/**
 * Status subcommand - Project overview
 */
async function statusAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing ST project...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.status();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🏭 IEC 61131-3 Project Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Path: ${chalk.cyan(result.project.path)}`);
    console.log(`  Name: ${chalk.cyan(result.project.name)}`);
    if (result.project.vendor) {
      console.log(`  Vendor: ${chalk.cyan(result.project.vendor)}`);
    }
    if (result.project.plcType) {
      console.log(`  PLC Type: ${chalk.cyan(result.project.plcType)}`);
    }
    console.log();

    // Files
    console.log(chalk.bold('Files'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.files.total)}`);
    console.log(`  Lines: ${chalk.cyan(result.files.totalLines.toLocaleString())}`);
    for (const [ext, count] of Object.entries(result.files.byExtension)) {
      console.log(`    ${ext}: ${chalk.cyan(count)}`);
    }
    console.log();

    // Analysis
    console.log(chalk.bold('Analysis'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  POUs: ${chalk.cyan(result.analysis.pous)}`);
    console.log(`  State Machines: ${chalk.cyan(result.analysis.stateMachines)}`);
    console.log(`  Safety Interlocks: ${chalk.cyan(result.analysis.safetyInterlocks)}`);
    console.log(`  Tribal Knowledge: ${chalk.cyan(result.analysis.tribalKnowledge)}`);
    console.log(`  Docstrings: ${chalk.cyan(result.analysis.docstrings)}`);
    console.log();

    // Health
    console.log(chalk.bold('Health'));
    console.log(chalk.gray('─'.repeat(40)));
    const healthColor = result.health.score >= 70 ? chalk.green :
                        result.health.score >= 40 ? chalk.yellow : chalk.red;
    console.log(`  Score: ${healthColor(`${result.health.score}/100`)}`);
    if (result.health.issues.length > 0) {
      for (const issue of result.health.issues) {
        console.log(chalk.yellow(`  ⚠ ${issue}`));
      }
    }
    console.log();

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift st docstrings     ${chalk.white('Extract documentation')}`));
    console.log(chalk.gray(`  • drift st state-machines ${chalk.white('Detect state machines')}`));
    console.log(chalk.gray(`  • drift st safety         ${chalk.white('Analyze safety interlocks')}`));
    console.log(chalk.gray(`  • drift st tribal         ${chalk.white('Extract tribal knowledge')}`));
    console.log(chalk.gray(`  • drift st blocks         ${chalk.white('List all POUs')}`));
    console.log(chalk.gray(`  • drift st all            ${chalk.white('Run full analysis')}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Docstrings subcommand - Extract documentation (PhD's primary request)
 */
async function docstringsAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const limit = parseInt(options.limit ?? '50', 10);
  const includeRaw = options.includeRaw ?? false;

  const spinner = isTextFormat ? createSpinner('Extracting docstrings...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.docstrings(undefined, { includeRaw, limit });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.summary.total,
        byBlock: result.summary.byBlock,
        withParams: result.summary.withParams,
        withHistory: result.summary.withHistory,
        withWarnings: result.summary.withWarnings,
        averageQuality: Math.round(result.summary.averageQuality),
        docstrings: result.docstrings,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📚 Extracted Docstrings'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.summary.total)}`);
    console.log(`  With Parameters: ${chalk.cyan(result.summary.withParams)}`);
    console.log(`  With History: ${chalk.cyan(result.summary.withHistory)}`);
    console.log(`  With Warnings: ${chalk.yellow(result.summary.withWarnings)}`);
    console.log(`  Average Quality: ${getQualityColor(result.summary.averageQuality)}`);
    console.log();

    // By block type
    if (Object.keys(result.summary.byBlock).length > 0) {
      console.log(chalk.bold('By Block Type'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const [block, count] of Object.entries(result.summary.byBlock)) {
        console.log(`  ${block}: ${chalk.cyan(count)}`);
      }
      console.log();
    }

    // Docstrings
    if (result.docstrings.length > 0) {
      console.log(chalk.bold('Docstrings'));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const doc of result.docstrings) {
        const blockInfo = doc.associatedBlock ? chalk.cyan(doc.associatedBlock) : chalk.gray('standalone');
        console.log(`  📄 ${blockInfo} ${chalk.gray(`(${doc.file}:${doc.location.line})`)}`);
        console.log(`     ${chalk.white(doc.summary || doc.description?.slice(0, 80) || 'No summary')}`);
        
        if (doc.params.length > 0 && options.verbose) {
          console.log(chalk.gray(`     Params: ${doc.params.map((p: { name: string }) => p.name).join(', ')}`));
        }
        if (doc.warnings.length > 0) {
          console.log(chalk.yellow(`     ⚠ ${doc.warnings.length} warning(s)`));
        }
        console.log();
      }

      if (result.summary.total > result.docstrings.length) {
        console.log(chalk.gray(`  ... and ${result.summary.total - result.docstrings.length} more (use --limit to see more)`));
        console.log();
      }
    } else {
      console.log(chalk.gray('No docstrings found'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Blocks subcommand - List all POUs
 */
async function blocksAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const limit = parseInt(options.limit ?? '50', 10);

  const spinner = isTextFormat ? createSpinner('Listing POUs...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.blocks(undefined, { limit });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🧱 Program Organization Units (POUs)'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.summary.total)}`);
    for (const [type, count] of Object.entries(result.summary.byType)) {
      const icon = type === 'PROGRAM' ? '📋' : type === 'FUNCTION_BLOCK' ? '🧩' : 'ƒ';
      console.log(`    ${icon} ${type}: ${chalk.cyan(count)}`);
    }
    console.log();

    // Blocks
    if (result.blocks.length > 0) {
      console.log(chalk.bold('Blocks'));
      console.log(chalk.gray('─'.repeat(40)));
      
      // Group by type
      const byType = new Map<string, typeof result.blocks>();
      for (const block of result.blocks) {
        const existing = byType.get(block.type) ?? [];
        existing.push(block);
        byType.set(block.type, existing);
      }

      for (const [type, blocks] of byType) {
        const icon = type === 'PROGRAM' ? '📋' : type === 'FUNCTION_BLOCK' ? '🧩' : 'ƒ';
        console.log();
        console.log(chalk.bold(`  ${icon} ${type}`));
        
        for (const block of blocks.slice(0, 20)) {
          console.log(`    ${chalk.cyan(block.name)} ${chalk.gray(`(${block.file}:${block.line})`)}`);
        }
        
        if (blocks.length > 20) {
          console.log(chalk.gray(`    ... and ${blocks.length - 20} more`));
        }
      }
      console.log();
    } else {
      console.log(chalk.gray('No POUs found'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * State Machines subcommand - Detect CASE-based state machines
 */
async function stateMachinesAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const limit = parseInt(options.limit ?? '20', 10);

  const spinner = isTextFormat ? createSpinner('Detecting state machines...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.stateMachines(undefined, { limit });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.summary.total,
        totalStates: result.summary.totalStates,
        byVariable: result.summary.byVariable,
        withDeadlocks: result.summary.withDeadlocks,
        withGaps: result.summary.withGaps,
        machines: result.stateMachines.map(sm => ({
          name: sm.name,
          file: sm.file,
          variable: sm.stateVariable,
          states: sm.states,
          transitions: sm.transitions,
          verification: sm.verification,
          diagram: sm.visualizations.mermaid,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔄 State Machines'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.summary.total)}`);
    console.log(`  Total States: ${chalk.cyan(result.summary.totalStates)}`);
    if (result.summary.withDeadlocks > 0) {
      console.log(`  With Deadlocks: ${chalk.red(result.summary.withDeadlocks)}`);
    }
    if (result.summary.withGaps > 0) {
      console.log(`  With Gaps: ${chalk.yellow(result.summary.withGaps)}`);
    }
    console.log();

    // State machines
    if (result.stateMachines.length > 0) {
      for (const sm of result.stateMachines) {
        console.log(chalk.bold(`  🔄 ${sm.name}`));
        console.log(chalk.gray(`     File: ${sm.file}`));
        console.log(chalk.gray(`     Variable: ${sm.stateVariable}`));
        console.log(`     States: ${chalk.cyan(sm.states.length)}`);
        console.log(`     Transitions: ${chalk.cyan(sm.transitions.length)}`);
        
        // Verification warnings
        if (sm.verification.hasDeadlocks) {
          console.log(chalk.red(`     ⚠ Has deadlocks`));
        }
        if (sm.verification.hasGaps) {
          console.log(chalk.yellow(`     ⚠ Has gaps in state values`));
        }
        if (sm.verification.unreachableStates.length > 0) {
          console.log(chalk.yellow(`     ⚠ Unreachable states: ${sm.verification.unreachableStates.join(', ')}`));
        }

        // States list
        if (options.verbose) {
          console.log(chalk.gray('     States:'));
          for (const state of sm.states) {
            const initial = state.isInitial ? chalk.green(' (initial)') : '';
            const final = state.isFinal ? chalk.blue(' (final)') : '';
            console.log(chalk.gray(`       ${state.value}: ${state.name || 'unnamed'}${initial}${final}`));
          }
        }

        // Mermaid diagram
        console.log();
        console.log(chalk.gray('     Diagram (Mermaid):'));
        console.log(chalk.gray('     ```mermaid'));
        for (const line of sm.visualizations.mermaid.split('\n')) {
          console.log(chalk.gray(`     ${line}`));
        }
        console.log(chalk.gray('     ```'));
        console.log();
      }
    } else {
      console.log(chalk.gray('No state machines found'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Safety subcommand - Analyze safety interlocks and bypasses (CRITICAL)
 */
async function safetyAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Analyzing safety interlocks...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.safety();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        interlocks: result.interlocks,
        bypasses: result.bypasses,
        criticalWarnings: result.criticalWarnings,
        summary: result.summary,
      }, null, 2));
      
      // Exit with error if strict mode and bypasses found
      if (options.strict && result.bypasses.length > 0) {
        process.exit(1);
      }
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🛡️  Safety Analysis'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total Interlocks: ${chalk.cyan(result.summary.totalInterlocks)}`);
    for (const [type, count] of Object.entries(result.summary.byType)) {
      if (count > 0) {
        const color = type === 'bypass' ? chalk.red : 
                      type === 'estop' ? chalk.yellow : chalk.green;
        console.log(`    ${type}: ${color(count)}`);
      }
    }
    console.log();

    // CRITICAL: Bypasses
    if (result.bypasses.length > 0) {
      console.log(chalk.red.bold('🚨 CRITICAL: SAFETY BYPASSES DETECTED'));
      console.log(chalk.red('─'.repeat(40)));
      
      for (const bypass of result.bypasses) {
        console.log(chalk.red(`  ⚠ ${bypass.name}`));
        console.log(chalk.red(`    File: ${bypass.location.file}:${bypass.location.line}`));
        console.log(chalk.red(`    Severity: ${bypass.severity}`));
        if (bypass.condition) {
          console.log(chalk.red(`    Condition: ${bypass.condition}`));
        }
        console.log();
      }
      
      console.log(chalk.red.bold('  ⚠ REVIEW WITH SAFETY ENGINEER BEFORE MIGRATION'));
      console.log();
    }

    // Critical warnings
    if (result.criticalWarnings.length > 0) {
      console.log(chalk.yellow.bold('⚠ Critical Warnings'));
      console.log(chalk.yellow('─'.repeat(40)));
      
      for (const warning of result.criticalWarnings) {
        const severityColor = warning.severity === 'critical' ? chalk.red :
                              warning.severity === 'high' ? chalk.yellow : chalk.white;
        console.log(`  ${severityColor(`[${warning.severity}]`)} ${warning.message}`);
        console.log(chalk.gray(`    ${warning.location.file}:${warning.location.line}`));
      }
      console.log();
    }

    // Interlocks
    if (result.interlocks.length > 0) {
      console.log(chalk.bold('Interlocks'));
      console.log(chalk.gray('─'.repeat(40)));
      
      // Group by type
      const byType = new Map<string, typeof result.interlocks>();
      for (const il of result.interlocks) {
        const existing = byType.get(il.type) ?? [];
        existing.push(il);
        byType.set(il.type, existing);
      }

      for (const [type, interlocks] of byType) {
        const icon = type === 'estop' ? '🛑' : 
                     type === 'permissive' ? '✅' :
                     type === 'safety-relay' ? '⚡' : '🔒';
        console.log();
        console.log(chalk.bold(`  ${icon} ${type.toUpperCase()}`));
        
        for (const il of interlocks.slice(0, 10)) {
          console.log(`    ${chalk.cyan(il.name)} ${chalk.gray(`(${il.location.file}:${il.location.line})`)}`);
          if (options.verbose) {
            console.log(chalk.gray(`      Confidence: ${il.confidence}`));
          }
        }
        
        if (interlocks.length > 10) {
          console.log(chalk.gray(`    ... and ${interlocks.length - 10} more`));
        }
      }
      console.log();
    }

    // Exit with error if strict mode and bypasses found
    if (options.strict && result.bypasses.length > 0) {
      console.log(chalk.red('Exiting with error due to --strict flag and bypasses detected'));
      process.exit(1);
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Tribal subcommand - Extract tribal knowledge
 */
async function tribalAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const limit = parseInt(options.limit ?? '50', 10);

  const spinner = isTextFormat ? createSpinner('Extracting tribal knowledge...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.tribalKnowledge(undefined, { limit });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.summary.total,
        byType: result.summary.byType,
        byImportance: result.summary.byImportance,
        criticalCount: result.summary.criticalCount,
        items: result.items,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🧠 Tribal Knowledge'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.summary.total)}`);
    console.log(`  Critical: ${result.summary.criticalCount > 0 ? chalk.red(result.summary.criticalCount) : chalk.green('0')}`);
    console.log();

    // By type
    if (Object.keys(result.summary.byType).length > 0) {
      console.log(chalk.bold('By Type'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const [type, count] of Object.entries(result.summary.byType)) {
        const icon = getTribalIcon(type);
        console.log(`  ${icon} ${type}: ${chalk.cyan(count)}`);
      }
      console.log();
    }

    // By importance
    console.log(chalk.bold('By Importance'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Critical: ${chalk.red(result.summary.byImportance.critical)}`);
    console.log(`  High: ${chalk.yellow(result.summary.byImportance.high)}`);
    console.log(`  Medium: ${chalk.white(result.summary.byImportance.medium)}`);
    console.log(`  Low: ${chalk.gray(result.summary.byImportance.low)}`);
    console.log();

    // Items
    if (result.items.length > 0) {
      console.log(chalk.bold('Knowledge Items'));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const item of result.items) {
        const icon = getTribalIcon(item.type);
        const importanceColor = item.importance === 'critical' ? chalk.red :
                                item.importance === 'high' ? chalk.yellow :
                                item.importance === 'medium' ? chalk.white : chalk.gray;
        
        console.log(`  ${icon} ${importanceColor(`[${item.importance}]`)} ${item.type}`);
        console.log(`     ${chalk.white(item.content.slice(0, 100))}${item.content.length > 100 ? '...' : ''}`);
        console.log(chalk.gray(`     ${item.file}:${item.location.line}`));
        console.log();
      }

      if (result.summary.total > result.items.length) {
        console.log(chalk.gray(`  ... and ${result.summary.total - result.items.length} more (use --limit to see more)`));
        console.log();
      }
    } else {
      console.log(chalk.gray('No tribal knowledge found'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Variables subcommand - Extract all variables
 */
async function variablesAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const limit = parseInt(options.limit ?? '100', 10);

  const spinner = isTextFormat ? createSpinner('Extracting variables...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.variables(undefined, { limit });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.summary.total,
        bySection: result.summary.bySection,
        withComments: result.summary.withComments,
        withIOAddress: result.summary.withIOAddress,
        safetyCritical: result.summary.safetyCritical,
        variables: result.variables,
        ioMappings: result.ioMappings,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 Variables'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.summary.total)}`);
    console.log(`  With Comments: ${chalk.cyan(result.summary.withComments)}`);
    console.log(`  With I/O Address: ${chalk.cyan(result.summary.withIOAddress)}`);
    console.log(`  Safety Critical: ${result.summary.safetyCritical > 0 ? chalk.yellow(result.summary.safetyCritical) : chalk.green('0')}`);
    console.log();

    // By section
    if (Object.keys(result.summary.bySection).length > 0) {
      console.log(chalk.bold('By Section'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const [section, count] of Object.entries(result.summary.bySection)) {
        const icon = getSectionIcon(section);
        console.log(`  ${icon} ${section}: ${chalk.cyan(count)}`);
      }
      console.log();
    }

    // Variables (verbose only)
    if (options.verbose && result.variables.length > 0) {
      console.log(chalk.bold('Variables'));
      console.log(chalk.gray('─'.repeat(40)));
      
      // Group by section
      const bySection = new Map<string, typeof result.variables>();
      for (const v of result.variables) {
        const existing = bySection.get(v.section) ?? [];
        existing.push(v);
        bySection.set(v.section, existing);
      }

      for (const [section, vars] of bySection) {
        console.log();
        console.log(chalk.bold(`  ${section}`));
        
        for (const v of vars.slice(0, 15)) {
          const safetyIcon = v.isSafetyCritical ? chalk.yellow('⚠') : ' ';
          const ioInfo = v.ioAddress ? chalk.magenta(` AT ${v.ioAddress}`) : '';
          console.log(`    ${safetyIcon} ${chalk.cyan(v.name)}: ${v.dataType}${ioInfo}`);
          if (v.comment) {
            console.log(chalk.gray(`       // ${v.comment}`));
          }
        }
        
        if (vars.length > 15) {
          console.log(chalk.gray(`    ... and ${vars.length - 15} more`));
        }
      }
      console.log();
    }

    // I/O Mappings
    if (result.ioMappings.length > 0) {
      console.log(chalk.bold('I/O Mappings'));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const io of result.ioMappings.slice(0, 20)) {
        const dirIcon = io.isInput ? chalk.green('→') : chalk.blue('←');
        console.log(`  ${dirIcon} ${chalk.magenta(io.address)} ${chalk.cyan(io.variableName || 'unnamed')}`);
        if (io.description) {
          console.log(chalk.gray(`     // ${io.description}`));
        }
      }
      
      if (result.ioMappings.length > 20) {
        console.log(chalk.gray(`  ... and ${result.ioMappings.length - 20} more`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * IO Map subcommand - Extract I/O address mappings
 */
async function ioMapAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Extracting I/O mappings...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.variables();

    spinner?.stop();

    const ioMappings = result.ioMappings;
    const inputs = ioMappings.filter(io => io.isInput);
    const outputs = ioMappings.filter(io => !io.isInput);

    if (format === 'json') {
      console.log(JSON.stringify({
        total: ioMappings.length,
        inputs: inputs.length,
        outputs: outputs.length,
        mappings: ioMappings,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📍 I/O Address Mappings'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(ioMappings.length)}`);
    console.log(`  Inputs: ${chalk.green(inputs.length)}`);
    console.log(`  Outputs: ${chalk.blue(outputs.length)}`);
    console.log();

    // Inputs
    if (inputs.length > 0) {
      console.log(chalk.bold('Inputs'));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const io of inputs) {
        console.log(`  ${chalk.green('→')} ${chalk.magenta(io.address.padEnd(12))} ${chalk.cyan(io.variableName || 'unnamed')}`);
        if (io.description) {
          console.log(chalk.gray(`     // ${io.description}`));
        }
      }
      console.log();
    }

    // Outputs
    if (outputs.length > 0) {
      console.log(chalk.bold('Outputs'));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const io of outputs) {
        console.log(`  ${chalk.blue('←')} ${chalk.magenta(io.address.padEnd(12))} ${chalk.cyan(io.variableName || 'unnamed')}`);
        if (io.description) {
          console.log(chalk.gray(`     // ${io.description}`));
        }
      }
      console.log();
    }

    if (ioMappings.length === 0) {
      console.log(chalk.gray('No I/O mappings found'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Diagram subcommand - Generate state machine diagrams
 */
async function diagramAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Generating diagrams...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.stateMachines();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total: result.stateMachines.length,
        diagrams: result.stateMachines.map(sm => ({
          name: sm.name,
          file: sm.file,
          mermaid: sm.visualizations.mermaid,
          ascii: sm.visualizations.ascii,
        })),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 State Machine Diagrams'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    if (result.stateMachines.length === 0) {
      console.log(chalk.gray('No state machines found'));
      console.log();
      return;
    }

    for (const sm of result.stateMachines) {
      console.log(chalk.bold(`🔄 ${sm.name}`));
      console.log(chalk.gray(`   File: ${sm.file}`));
      console.log(chalk.gray(`   States: ${sm.states.length}, Transitions: ${sm.transitions.length}`));
      console.log();
      
      // Mermaid diagram
      console.log(chalk.gray('   Mermaid:'));
      console.log('   ```mermaid');
      for (const line of sm.visualizations.mermaid.split('\n')) {
        console.log(`   ${line}`);
      }
      console.log('   ```');
      console.log();

      // ASCII diagram (if verbose)
      if (options.verbose && sm.visualizations.ascii) {
        console.log(chalk.gray('   ASCII:'));
        for (const line of sm.visualizations.ascii.split('\n')) {
          console.log(`   ${line}`);
        }
        console.log();
      }
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * All subcommand - Run full analysis pipeline
 */
async function allAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Running full analysis...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.fullAnalysis();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output - comprehensive summary
    console.log();
    console.log(chalk.bold('🏭 Full IEC 61131-3 Analysis'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project Status
    console.log(chalk.bold('📋 Project Status'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Files: ${chalk.cyan(result.status.files.total)}`);
    console.log(`  Lines: ${chalk.cyan(result.status.files.totalLines.toLocaleString())}`);
    console.log(`  POUs: ${chalk.cyan(result.status.analysis.pous)}`);
    console.log(`  Health: ${getHealthColor(result.status.health.score)}`);
    console.log();

    // Docstrings
    console.log(chalk.bold('📚 Documentation'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Docstrings: ${chalk.cyan(result.docstrings.summary.total)}`);
    console.log(`  With Params: ${chalk.cyan(result.docstrings.summary.withParams)}`);
    console.log(`  Avg Quality: ${getQualityColor(result.docstrings.summary.averageQuality)}`);
    console.log();

    // State Machines
    console.log(chalk.bold('🔄 State Machines'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.stateMachines.summary.total)}`);
    console.log(`  States: ${chalk.cyan(result.stateMachines.summary.totalStates)}`);
    if (result.stateMachines.summary.withDeadlocks > 0) {
      console.log(`  With Deadlocks: ${chalk.red(result.stateMachines.summary.withDeadlocks)}`);
    }
    console.log();

    // Safety
    console.log(chalk.bold('🛡️  Safety'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Interlocks: ${chalk.cyan(result.safety.summary.totalInterlocks)}`);
    if (result.safety.bypasses.length > 0) {
      console.log(chalk.red(`  ⚠ BYPASSES: ${result.safety.bypasses.length}`));
    } else {
      console.log(`  Bypasses: ${chalk.green('0')}`);
    }
    if (result.safety.criticalWarnings.length > 0) {
      console.log(chalk.yellow(`  Warnings: ${result.safety.criticalWarnings.length}`));
    }
    console.log();

    // Tribal Knowledge
    console.log(chalk.bold('🧠 Tribal Knowledge'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.tribalKnowledge.summary.total)}`);
    console.log(`  Critical: ${result.tribalKnowledge.summary.criticalCount > 0 ? chalk.red(result.tribalKnowledge.summary.criticalCount) : chalk.green('0')}`);
    console.log();

    // Variables
    console.log(chalk.bold('📊 Variables'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(result.variables.summary.total)}`);
    console.log(`  I/O Mapped: ${chalk.cyan(result.variables.summary.withIOAddress)}`);
    console.log(`  Safety Critical: ${result.variables.summary.safetyCritical > 0 ? chalk.yellow(result.variables.summary.safetyCritical) : chalk.green('0')}`);
    console.log();

    // Critical issues
    if (result.safety.bypasses.length > 0 || result.safety.criticalWarnings.length > 0) {
      console.log(chalk.red.bold('🚨 CRITICAL ISSUES'));
      console.log(chalk.red('─'.repeat(40)));
      
      for (const bypass of result.safety.bypasses) {
        console.log(chalk.red(`  ⚠ BYPASS: ${bypass.name} (${bypass.location.file}:${bypass.location.line})`));
      }
      
      for (const warning of result.safety.criticalWarnings.filter(w => w.severity === 'critical')) {
        console.log(chalk.red(`  ⚠ ${warning.message}`));
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('📌 Detailed Commands:'));
    console.log(chalk.gray(`  • drift st docstrings     ${chalk.white('View all documentation')}`));
    console.log(chalk.gray(`  • drift st state-machines ${chalk.white('View state machine diagrams')}`));
    console.log(chalk.gray(`  • drift st safety         ${chalk.white('Detailed safety analysis')}`));
    console.log(chalk.gray(`  • drift st tribal         ${chalk.white('View tribal knowledge')}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle errors consistently
 */
function handleError(error: unknown, format: string): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  
  if (format === 'json') {
    console.log(JSON.stringify({ error: true, message }));
  } else {
    console.log(chalk.red(`\n❌ Error: ${message}`));
  }
}

/**
 * Migration subcommand - Calculate migration readiness scores
 */
async function migrationAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Calculating migration readiness...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.migrationReadiness();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 Migration Readiness Report'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Overall score
    const gradeColor = result.overallGrade === 'A' ? chalk.green :
                       result.overallGrade === 'B' ? chalk.cyan :
                       result.overallGrade === 'C' ? chalk.yellow :
                       result.overallGrade === 'D' ? chalk.magenta : chalk.red;
    
    console.log(chalk.bold('Overall Score'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Grade: ${gradeColor(result.overallGrade)}`);
    console.log(`  Score: ${gradeColor(`${Math.round(result.overallScore)}/100`)}`);
    console.log();

    // Risks
    if (result.risks.length > 0) {
      console.log(chalk.bold('Risks'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const risk of result.risks) {
        const severityColor = risk.severity === 'critical' ? chalk.red :
                              risk.severity === 'high' ? chalk.yellow : chalk.white;
        console.log(`  ${severityColor(`[${risk.severity}]`)} ${risk.description}`);
        console.log(chalk.gray(`    Mitigation: ${risk.mitigation}`));
      }
      console.log();
    }

    // Migration order
    if (result.migrationOrder.length > 0) {
      console.log(chalk.bold('Recommended Migration Order'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const item of result.migrationOrder.slice(0, 10)) {
        const hasBlockers = result.pouScores.find(s => s.pouId === item.pouId)?.blockers.length ?? 0;
        const icon = hasBlockers > 0 ? chalk.red('⚠') : chalk.green('✓');
        console.log(`  ${item.order}. ${icon} ${chalk.cyan(item.pouName)} - ${item.estimatedEffort}`);
        console.log(chalk.gray(`     ${item.reason}`));
      }
      if (result.migrationOrder.length > 10) {
        console.log(chalk.gray(`  ... and ${result.migrationOrder.length - 10} more`));
      }
      console.log();
    }

    // POU scores (verbose)
    if (options.verbose && result.pouScores.length > 0) {
      console.log(chalk.bold('POU Scores'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const score of result.pouScores) {
        const scoreColor = score.overallScore >= 80 ? chalk.green :
                          score.overallScore >= 60 ? chalk.yellow : chalk.red;
        console.log(`  ${chalk.cyan(score.pouName)} (${score.pouType})`);
        console.log(`    Score: ${scoreColor(`${Math.round(score.overallScore)}/100`)} Grade: ${score.grade}`);
        console.log(chalk.gray(`    Doc: ${Math.round(score.dimensionScores.documentation)} | Safety: ${Math.round(score.dimensionScores.safety)} | Complexity: ${Math.round(score.dimensionScores.complexity)}`));
        if (score.blockers.length > 0) {
          console.log(chalk.red(`    ⚠ ${score.blockers.length} blocker(s)`));
        }
        console.log();
      }
    }

    // Effort estimate
    console.log(chalk.bold('Effort Estimate'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total: ${chalk.cyan(`${result.estimatedEffort.totalHours} hours`)}`);
    console.log(`  Confidence: ${chalk.cyan(`${Math.round(result.estimatedEffort.confidence * 100)}%`)}`);
    console.log();

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * AI Context subcommand - Generate AI context package
 */
async function aiContextAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';
  const targetLanguage = (options.target ?? 'python') as 'python' | 'rust' | 'typescript' | 'csharp' | 'cpp' | 'go' | 'java';

  const spinner = isTextFormat ? createSpinner(`Generating AI context for ${targetLanguage}...`) : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.generateAIContext(targetLanguage);

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output - summary
    console.log();
    console.log(chalk.bold('🤖 AI Context Package'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Project info
    console.log(chalk.bold('Project'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Name: ${chalk.cyan(result.project.name)}`);
    console.log(`  Target Language: ${chalk.cyan(result.targetLanguage)}`);
    console.log(`  POUs: ${chalk.cyan(result.project.totalPOUs)}`);
    console.log(`  Lines: ${chalk.cyan(result.project.totalLines)}`);
    console.log();

    // Type mappings
    console.log(chalk.bold('Type Mappings'));
    console.log(chalk.gray('─'.repeat(40)));
    const mappings = Object.entries(result.types.plcToTarget).slice(0, 10);
    for (const [plc, target] of mappings) {
      console.log(`  ${chalk.yellow(plc)} → ${chalk.green(target)}`);
    }
    if (Object.keys(result.types.plcToTarget).length > 10) {
      console.log(chalk.gray(`  ... and ${Object.keys(result.types.plcToTarget).length - 10} more`));
    }
    console.log();

    // Safety context
    if (result.safety.interlocks.length > 0) {
      console.log(chalk.bold('Safety Context'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Interlocks: ${chalk.yellow(result.safety.interlocks.length)}`);
      console.log(`  Must Preserve: ${chalk.yellow(result.safety.mustPreserve.length)} items`);
      console.log();
    }

    // POUs
    console.log(chalk.bold('POU Contexts'));
    console.log(chalk.gray('─'.repeat(40)));
    for (const pou of result.pous.slice(0, 5)) {
      console.log(`  ${chalk.cyan(pou.pouName)} (${pou.pouType})`);
      console.log(chalk.gray(`    ${pou.purpose.slice(0, 60)}${pou.purpose.length > 60 ? '...' : ''}`));
      console.log(chalk.gray(`    Inputs: ${pou.interface.inputs.length}, Outputs: ${pou.interface.outputs.length}`));
      if (pou.safety.isSafetyCritical) {
        console.log(chalk.yellow(`    ⚠ Safety Critical`));
      }
    }
    if (result.pous.length > 5) {
      console.log(chalk.gray(`  ... and ${result.pous.length - 5} more`));
    }
    console.log();

    // Verification requirements
    if (result.verificationRequirements.length > 0) {
      console.log(chalk.bold('Verification Requirements'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const req of result.verificationRequirements) {
        console.log(`  [${req.category}] ${req.requirement}`);
      }
      console.log();
    }

    // Usage hint
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('💡 Usage:'));
    console.log(chalk.gray(`  Use --format json to get the full context package for AI consumption`));
    console.log(chalk.gray(`  Example: drift st ai-context --format json --target rust > context.json`));
    console.log();

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Call Graph subcommand - Build and display call graph
 */
async function callGraphAction(targetPath: string | undefined, options: STOptions): Promise<void> {
  const rootDir = targetPath ?? process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  const spinner = isTextFormat ? createSpinner('Building call graph...') : null;
  spinner?.start();

  try {
    const analyzer = new IEC61131Analyzer();
    await analyzer.initialize(rootDir);
    const result = await analyzer.buildCallGraph();

    spinner?.stop();

    const nodes = Array.from(result.nodes.values());
    const edges = result.edges;

    if (format === 'json') {
      console.log(JSON.stringify({
        nodes: nodes.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
          file: n.file,
          line: n.line,
          inputs: n.inputs.length,
          outputs: n.outputs.length,
        })),
        edges: edges.map(e => ({
          from: e.callerId,
          to: e.calleeName,
          type: e.callType,
          line: e.location.line,
        })),
        summary: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
        },
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔗 Call Graph'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Summary
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Nodes (POUs): ${chalk.cyan(nodes.length)}`);
    console.log(`  Edges (Calls): ${chalk.cyan(edges.length)}`);
    console.log();

    // Nodes by type
    const byType: Record<string, number> = {};
    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }
    console.log(chalk.bold('By Type'));
    console.log(chalk.gray('─'.repeat(40)));
    for (const [type, count] of Object.entries(byType)) {
      const icon = type === 'PROGRAM' ? '📋' : type === 'FUNCTION_BLOCK' ? '🧩' : 'ƒ';
      console.log(`  ${icon} ${type}: ${chalk.cyan(count)}`);
    }
    console.log();

    // Most called
    const callCounts: Record<string, number> = {};
    for (const edge of edges) {
      callCounts[edge.calleeName] = (callCounts[edge.calleeName] || 0) + 1;
    }
    const mostCalled = Object.entries(callCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (mostCalled.length > 0) {
      console.log(chalk.bold('Most Called'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const [name, count] of mostCalled) {
        console.log(`  ${chalk.cyan(name)}: ${count} call(s)`);
      }
      console.log();
    }

    // Entry points
    const calledNodes = new Set(edges.map(e => e.calleeName.toLowerCase()));
    const entryPoints = nodes.filter(n => !calledNodes.has(n.name.toLowerCase()));

    if (entryPoints.length > 0) {
      console.log(chalk.bold('Entry Points (not called by others)'));
      console.log(chalk.gray('─'.repeat(40)));
      for (const ep of entryPoints.slice(0, 10)) {
        console.log(`  ${chalk.green('→')} ${chalk.cyan(ep.name)} (${ep.type})`);
      }
      if (entryPoints.length > 10) {
        console.log(chalk.gray(`  ... and ${entryPoints.length - 10} more`));
      }
      console.log();
    }

    // Mermaid diagram (verbose)
    if (options.verbose && nodes.length > 0 && nodes.length <= 20) {
      console.log(chalk.bold('Mermaid Diagram'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log('```mermaid');
      console.log('graph TD');
      for (const node of nodes) {
        const shape = node.type === 'PROGRAM' ? `[${node.name}]` :
                      node.type === 'FUNCTION_BLOCK' ? `[[${node.name}]]` :
                      `(${node.name})`;
        console.log(`  ${node.name}${shape}`);
      }
      const seenEdges = new Set<string>();
      for (const edge of edges) {
        const callerName = edge.callerId.split(':').pop() || edge.callerId;
        const edgeKey = `${callerName}->${edge.calleeName}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          console.log(`  ${callerName}-->${edge.calleeName}`);
        }
      }
      console.log('```');
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    handleError(error, format);
  }
}

/**
 * Get color for quality score
 */
function getQualityColor(score: number): string {
  if (score >= 80) return chalk.green(`${Math.round(score)}%`);
  if (score >= 50) return chalk.yellow(`${Math.round(score)}%`);
  return chalk.red(`${Math.round(score)}%`);
}

/**
 * Get color for health score
 */
function getHealthColor(score: number): string {
  if (score >= 70) return chalk.green(`${score}/100`);
  if (score >= 40) return chalk.yellow(`${score}/100`);
  return chalk.red(`${score}/100`);
}

/**
 * Get icon for tribal knowledge type
 */
function getTribalIcon(type: string): string {
  const icons: Record<string, string> = {
    'warning': '⚠️',
    'danger': '🚨',
    'caution': '⚡',
    'note': '📝',
    'todo': '📋',
    'fixme': '🔧',
    'hack': '🔨',
    'workaround': '🔄',
    'history': '📅',
    'author': '👤',
    'magic-number': '🔢',
    'dead-code': '💀',
    'timing': '⏱️',
    'calibration': '🎯',
    'undocumented': '❓',
  };
  return icons[type] ?? '📌';
}

/**
 * Get icon for variable section
 */
function getSectionIcon(section: string): string {
  const icons: Record<string, string> = {
    'VAR_INPUT': '→',
    'VAR_OUTPUT': '←',
    'VAR_IN_OUT': '↔',
    'VAR': '•',
    'VAR_GLOBAL': '🌐',
    'VAR_TEMP': '⏳',
    'VAR_CONSTANT': '🔒',
    'VAR_EXTERNAL': '🔗',
  };
  return icons[section] ?? '•';
}
