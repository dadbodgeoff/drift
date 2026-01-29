/**
 * Simulate Command - drift simulate
 *
 * Speculative Execution Engine: Simulates multiple implementation approaches
 * BEFORE code generation, scoring them by friction, impact, and pattern alignment.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createSimulationEngine,
  createCallGraphAnalyzer,
  createPatternService,
  createPatternRepository,
  checkFeature,
  formatFeatureCheck,
  type SimulationTask,
  type SimulationResult,
  type SimulationConstraint,
  type SimulatedApproach,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface SimulateOptions {
  format?: 'text' | 'json' | undefined;
  verbose?: boolean | undefined;
  maxApproaches?: number | undefined;
  category?: string | undefined;
  target?: string | undefined;
  constraint?: string[] | undefined;
}

/**
 * Main simulate action
 */
async function simulateAction(
  description: string,
  options: SimulateOptions
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  // Check license for impact simulation feature
  const featureCheck = await checkFeature('gate:impact-simulation', rootDir);
  if (!featureCheck.allowed) {
    if (format === 'json') {
      console.log(JSON.stringify({
        error: 'Feature not licensed',
        feature: featureCheck.feature,
        requiredTier: featureCheck.requiredTier,
        currentTier: featureCheck.currentTier,
        upgradeUrl: featureCheck.upgradeUrl,
      }));
    } else {
      console.log();
      console.log(chalk.yellow('⚠️  Enterprise Feature Required'));
      console.log();
      console.log(formatFeatureCheck(featureCheck));
      console.log();
    }
    process.exit(1);
  }

  try {
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('🔮 Speculative Execution Engine'));
      console.log(chalk.gray('═'.repeat(60)));
      console.log();
      console.log(chalk.cyan('Task:'), description);
      console.log();
    }

    const spinner = isTextFormat ? createSpinner('Initializing simulation...') : null;
    spinner?.start();

    // Load call graph (optional but recommended)
    spinner?.text('Loading call graph...');
    let callGraph;
    try {
      const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
      await callGraphAnalyzer.initialize();
      callGraph = callGraphAnalyzer.getGraph();
    } catch {
      // Call graph not available
    }

    // Load pattern service (optional but recommended)
    spinner?.text('Loading patterns...');
    let patternService;
    try {
      const repository = await createPatternRepository({ rootDir });
      patternService = createPatternService(repository, rootDir);
    } catch {
      // Patterns not available
    }

    // Create simulation engine
    spinner?.text('Initializing simulation engine...');
    const engine = createSimulationEngine({
      projectRoot: rootDir,
      callGraph: callGraph ?? undefined,
      patternService: patternService ?? undefined,
      options: {
        maxApproaches: options.maxApproaches ?? 5,
      },
    });

    // Build task
    const constraints: SimulationConstraint[] | undefined = options.constraint?.map(c => ({
      type: 'custom' as const,
      value: c,
      description: c,
    }));
    
    const task: SimulationTask = {
      description,
    };
    
    if (options.category) {
      task.category = options.category as any;
    }
    if (options.target) {
      task.target = options.target;
    }
    if (constraints && constraints.length > 0) {
      task.constraints = constraints;
    }

    // Run simulation
    spinner?.text('Simulating approaches...');
    const result = await engine.simulate(task);

    spinner?.stop();

    // Output results
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    formatSimulationResult(result, options.verbose ?? false);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

// ============================================================================
// Formatters
// ============================================================================

function formatSimulationResult(result: SimulationResult, verbose: boolean): void {
  // Summary
  console.log(chalk.bold('📊 Simulation Summary'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.white(result.summary));
  console.log();

  // Confidence
  const confColor = result.confidence.score >= 70 ? chalk.green :
                   result.confidence.score >= 50 ? chalk.yellow : chalk.red;
  console.log(`${chalk.gray('Confidence:')} ${confColor(`${result.confidence.score}%`)}`);
  if (result.confidence.limitations.length > 0) {
    for (const limitation of result.confidence.limitations) {
      console.log(chalk.gray(`  ⚠ ${limitation}`));
    }
  }
  console.log();

  // Recommended approach
  console.log(chalk.bold.green('✨ Recommended Approach'));
  console.log(chalk.gray('─'.repeat(60)));
  formatApproach(result.recommended, true);

  // Alternative approaches
  if (result.approaches.length > 1) {
    console.log();
    console.log(chalk.bold('📋 Alternative Approaches'));
    console.log(chalk.gray('─'.repeat(60)));
    
    for (const approach of result.approaches.slice(1)) {
      formatApproach(approach, verbose);
      console.log();
    }
  }

  // Tradeoffs
  if (result.tradeoffs.length > 0 && verbose) {
    console.log();
    console.log(chalk.bold('⚖️  Tradeoff Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    
    for (const tradeoff of result.tradeoffs) {
      console.log(`${chalk.cyan(tradeoff.approach1)} vs ${chalk.cyan(tradeoff.approach2)}`);
      console.log(chalk.gray(`  ${tradeoff.comparison}`));
      if (tradeoff.winner) {
        console.log(chalk.green(`  Winner: ${tradeoff.winner}`));
      }
      console.log();
    }
  }

  // Metadata
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray(`Simulated ${result.metadata.approachesSimulated} approaches in ${result.metadata.executionTimeMs}ms`));
  console.log(chalk.gray(`Data sources: ${result.metadata.dataSourcesUsed.join(', ') || 'none'}`));
  console.log();
}

function formatApproach(simulated: SimulatedApproach, detailed: boolean): void {
  const { approach, score, rank } = simulated;

  // Header
  const rankBadge = rank === 1 ? chalk.green('🥇') :
                   rank === 2 ? chalk.yellow('🥈') :
                   rank === 3 ? chalk.cyan('🥉') : chalk.gray(`#${rank}`);
  
  console.log(`${rankBadge} ${chalk.bold(approach.name)} ${chalk.gray(`(${approach.strategy})`)}`);
  console.log(chalk.gray(`   ${approach.description}`));
  console.log();

  // Score breakdown
  const scoreColor = score >= 70 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
  console.log(`   ${chalk.gray('Score:')} ${scoreColor(`${Math.round(score)}/100`)}`);

  // Metrics bar
  const frictionBar = getMetricBar(100 - simulated.friction.overall, 'Friction');
  const impactBar = getMetricBar(100 - simulated.impact.riskScore, 'Impact');
  const alignmentBar = getMetricBar(simulated.patternAlignment.alignmentScore, 'Alignment');
  const securityBar = getMetricBar(100 - simulated.security.securityRisk, 'Security');

  console.log(`   ${frictionBar}`);
  console.log(`   ${impactBar}`);
  console.log(`   ${alignmentBar}`);
  console.log(`   ${securityBar}`);

  if (detailed) {
    // Pros
    if (simulated.pros.length > 0) {
      console.log();
      console.log(chalk.green('   ✓ Pros:'));
      for (const pro of simulated.pros.slice(0, 4)) {
        console.log(chalk.green(`     • ${pro}`));
      }
    }

    // Cons
    if (simulated.cons.length > 0) {
      console.log(chalk.red('   ✗ Cons:'));
      for (const con of simulated.cons.slice(0, 4)) {
        console.log(chalk.red(`     • ${con}`));
      }
    }

    // Warnings
    if (simulated.warnings.length > 0) {
      console.log(chalk.yellow('   ⚠ Warnings:'));
      for (const warning of simulated.warnings.slice(0, 3)) {
        console.log(chalk.yellow(`     • ${warning}`));
      }
    }

    // Target files
    if (approach.targetFiles.length > 0) {
      console.log();
      console.log(chalk.gray('   Target files:'));
      for (const file of approach.targetFiles.slice(0, 5)) {
        console.log(chalk.gray(`     • ${file}`));
      }
      if (approach.targetFiles.length > 5) {
        console.log(chalk.gray(`     ... and ${approach.targetFiles.length - 5} more`));
      }
    }

    // Next steps
    if (simulated.nextSteps.length > 0) {
      console.log();
      console.log(chalk.cyan('   Next steps:'));
      for (const step of simulated.nextSteps.slice(0, 3)) {
        console.log(chalk.cyan(`     → ${step}`));
      }
    }
  }
}

function getMetricBar(value: number, label: string): string {
  const barLength = 20;
  const filled = Math.round((value / 100) * barLength);
  const empty = barLength - filled;
  
  const color = value >= 70 ? chalk.green : value >= 50 ? chalk.yellow : chalk.red;
  const bar = color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  
  return `${chalk.gray(label.padEnd(10))} ${bar} ${chalk.white(Math.round(value))}`;
}

// ============================================================================
// Command Registration
// ============================================================================

export function createSimulateCommand(): Command {
  const cmd = new Command('simulate')
    .description('Simulate implementation approaches before coding')
    .argument('<description>', 'Task description (e.g., "add rate limiting to API")')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Show detailed analysis')
    .option('-n, --max-approaches <number>', 'Maximum approaches to simulate', '5')
    .option('-c, --category <category>', 'Task category (rate-limiting, authentication, etc.)')
    .option('-t, --target <target>', 'Target file or function')
    .option('--constraint <constraint...>', 'Constraints (e.g., "must work with existing auth")')
    .action((description, opts) => {
      const options: SimulateOptions = {
        format: opts.format,
        verbose: opts.verbose,
        category: opts.category,
        target: opts.target,
        constraint: opts.constraint,
      };
      if (opts.maxApproaches) {
        options.maxApproaches = parseInt(opts.maxApproaches, 10);
      }
      return simulateAction(description, options);
    });

  return cmd;
}
