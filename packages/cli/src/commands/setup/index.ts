/**
 * Setup Command - drift setup
 *
 * Runs AFTER `drift scan` to compute all advanced features:
 * - Data boundaries, contracts, environment variables, constants
 * - Call graph, test topology, coupling analysis
 * - Error handling, styling DNA, constraints
 * - Cortex memory system
 *
 * NEW FLOW:
 * 1. User runs `drift scan` first (discovers patterns)
 * 2. User runs `drift setup` to compute everything else
 *
 * @module commands/setup
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

EventEmitter.defaultMaxListeners = 50;

import chalk from 'chalk';
import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';

import {
  getProjectRegistry,
} from 'driftdetect-core';
import { createPatternStore, StoreSyncService } from 'driftdetect-core/storage';

import { createSpinner } from '../../ui/spinner.js';
import { createCLIPatternServiceAsync } from '../../services/pattern-service-factory.js';
import { VERSION } from '../../index.js';

import {
  type SetupOptions,
  type SetupState,
  type SourceOfTruth,
  type FeatureConfig,
  type FeatureResult,
  DRIFT_DIR,
  SCHEMA_VERSION,
} from './types.js';

import {
  isDriftInitialized,
  saveSourceOfTruth,
  loadSetupState,
  saveSetupState,
  clearSetupState,
  countSourceFiles,
  computeChecksum,
} from './utils.js';

import { printPhase, printSuccess, printSkip, printInfo } from './ui.js';

import {
  CallGraphRunner, TestTopologyRunner, CouplingRunner, DNARunner, MemoryRunner,
  BoundariesRunner, ContractsRunner, EnvironmentRunner, ConstantsRunner,
  ErrorHandlingRunner, ConstraintsRunner, AuditRunner,
  type RunnerContext,
} from './runners/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function createDefaultState(): SetupState {
  return {
    phase: 0,
    completed: [],
    choices: {
      runCoreScan: false, autoApprove: true, approveThreshold: 0.85,
      scanBoundaries: true, scanContracts: true, scanEnvironment: true, scanConstants: true,
      buildCallGraph: true, buildTestTopology: true, buildCoupling: true,
      scanDna: true, analyzeErrorHandling: true, initMemory: false,
    },
    startedAt: new Date().toISOString(),
  };
}

/** Sync current state to SQLite after each phase */
async function syncToSqlite(rootDir: string, verbose: boolean): Promise<void> {
  try {
    const syncService = new StoreSyncService({ rootDir, verbose });
    await syncService.initialize();
    await syncService.syncAll();
    await syncService.close();
  } catch (error) {
    if (verbose) console.error(chalk.gray(`  SQLite sync: ${(error as Error).message}`));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 0: CHECK PREREQUISITES
// ═══════════════════════════════════════════════════════════════════════════

async function phaseCheckPrerequisites(rootDir: string): Promise<{ patternCount: number; categories: Record<string, number>; shouldContinue: boolean }> {
  printPhase(0, 'Prerequisites', 'Checking for existing scan data');

  const initialized = await isDriftInitialized(rootDir);
  
  if (!initialized) {
    console.log();
    console.log(chalk.red('  ✖ No drift data found'));
    console.log();
    console.log(chalk.yellow('  You need to run a scan first:'));
    console.log(chalk.cyan('    drift scan'));
    console.log();
    console.log(chalk.gray('  This discovers patterns in your codebase.'));
    console.log(chalk.gray('  Then run `drift setup` to compute advanced features.'));
    console.log();
    return { patternCount: 0, categories: {}, shouldContinue: false };
  }

  // Check for patterns
  const spinner = createSpinner('Loading patterns...');
  spinner.start();

  try {
    const store = await createPatternStore({ rootDir });
    const patterns = store.getAll();
    
    if (patterns.length === 0) {
      spinner.fail('No patterns found');
      console.log();
      console.log(chalk.yellow('  You need to run a scan first:'));
      console.log(chalk.cyan('    drift scan'));
      console.log();
      return { patternCount: 0, categories: {}, shouldContinue: false };
    }

    // Count by category
    const categories: Record<string, number> = {};
    for (const pattern of patterns) {
      categories[pattern.category] = (categories[pattern.category] ?? 0) + 1;
    }

    const approvedCount = patterns.filter(p => p.status === 'approved').length;
    spinner.succeed(`Found ${chalk.cyan(patterns.length)} patterns (${chalk.green(approvedCount)} approved)`);

    return { patternCount: patterns.length, categories, shouldContinue: true };
  } catch (error) {
    spinner.fail('Failed to load patterns');
    console.error(chalk.red(`  ${(error as Error).message}`));
    return { patternCount: 0, categories: {}, shouldContinue: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: INITIALIZE/REGISTER PROJECT
// ═══════════════════════════════════════════════════════════════════════════

async function phaseInit(rootDir: string): Promise<string> {
  printPhase(1, 'Initialize', 'Registering project');

  const projectId = crypto.randomUUID();

  try {
    const registry = await getProjectRegistry();
    const existing = registry.findByPath(rootDir);
    if (existing) {
      await registry.setActive(existing.id);
      printSuccess(`Project: ${chalk.cyan(existing.name)}`);
      return existing.id;
    }
    const project = await registry.register(rootDir);
    await registry.setActive(project.id);
    printSuccess(`Registered: ${chalk.cyan(project.name)}`);
    return project.id;
  } catch {
    printInfo('Single-project mode');
    return projectId;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: PATTERN APPROVAL
// ═══════════════════════════════════════════════════════════════════════════

async function phaseApproval(rootDir: string, autoYes: boolean, _patternCount: number, state: SetupState): Promise<number> {
  printPhase(2, 'Approval', 'Establish coding standards');

  // Check how many are already approved
  const service = await createCLIPatternServiceAsync(rootDir);
  const discovered = await service.listByStatus('discovered', { limit: 5000 });
  const alreadyApproved = await service.listByStatus('approved', { limit: 5000 });

  if (discovered.items.length === 0) {
    printSuccess(`All ${chalk.cyan(alreadyApproved.items.length)} patterns already approved`);
    return alreadyApproved.items.length;
  }

  console.log(chalk.gray('  Approved patterns become your "golden standard":'));
  console.log(chalk.green('    → AI follows them when generating code'));
  console.log(chalk.green('    → Violations flagged in CI/CD'));
  console.log();

  const threshold = 0.85;
  const eligible = discovered.items.filter(p => p.confidence >= threshold);

  if (eligible.length === 0) {
    printInfo(`No patterns with ≥85% confidence to auto-approve`);
    return alreadyApproved.items.length;
  }

  const shouldApprove = autoYes || await confirm({ 
    message: `Auto-approve ${eligible.length} high-confidence patterns (≥85%)?`, 
    default: true 
  });

  if (!shouldApprove) {
    printSkip('Review later: drift approve --auto');
    return alreadyApproved.items.length;
  }

  const spinner = createSpinner('Approving patterns...');
  spinner.start();

  try {
    let approved = 0;
    for (const pattern of eligible) {
      try { await service.approvePattern(pattern.id); approved++; } catch { /* skip */ }
    }

    spinner.succeed(`Approved ${chalk.cyan(approved)} patterns`);
    state.completed.push('approval');
    state.choices.autoApprove = true;
    state.choices.approveThreshold = threshold;

    await syncToSqlite(rootDir, false);

    return alreadyApproved.items.length + approved;
  } catch {
    spinner.fail('Approval failed');
    return alreadyApproved.items.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: CORE FEATURES (All run automatically)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseCoreFeatures(
  rootDir: string, verbose: boolean, state: SetupState
): Promise<Record<string, FeatureResult>> {
  printPhase(3, 'Core Analysis', 'Scanning boundaries, contracts, environment, constants');

  const ctx: RunnerContext = { rootDir, verbose };
  const results: Record<string, FeatureResult> = {};

  // Boundaries
  const boundariesRunner = new BoundariesRunner(ctx);
  results['boundaries'] = await boundariesRunner.run();
  state.completed.push('boundaries');

  // Contracts
  const contractsRunner = new ContractsRunner(ctx);
  results['contracts'] = await contractsRunner.run();
  state.completed.push('contracts');

  // Environment
  const envRunner = new EnvironmentRunner(ctx);
  results['environment'] = await envRunner.run();
  state.completed.push('environment');

  // Constants
  const constantsRunner = new ConstantsRunner(ctx);
  results['constants'] = await constantsRunner.run();
  state.completed.push('constants');

  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: DEEP ANALYSIS (All run automatically)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDeepAnalysis(
  rootDir: string, verbose: boolean, state: SetupState
): Promise<Record<string, FeatureResult>> {
  printPhase(4, 'Deep Analysis', 'Call graph, test topology, coupling, error handling, DNA');

  console.log(chalk.gray('  Building comprehensive codebase intelligence...'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const results: Record<string, FeatureResult> = {};

  // Call Graph
  const cgRunner = new CallGraphRunner(ctx);
  results['callGraph'] = await cgRunner.run();
  state.completed.push('callgraph');

  // Test Topology
  const ttRunner = new TestTopologyRunner(ctx);
  results['testTopology'] = await ttRunner.run();
  state.completed.push('test-topology');

  // Coupling
  const couplingRunner = new CouplingRunner(ctx);
  results['coupling'] = await couplingRunner.run();
  state.completed.push('coupling');

  // Error Handling
  const ehRunner = new ErrorHandlingRunner(ctx);
  results['errorHandling'] = await ehRunner.run();
  state.completed.push('error-handling');

  // DNA
  const dnaRunner = new DNARunner(ctx);
  results['dna'] = await dnaRunner.run();
  state.completed.push('dna');

  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: DERIVED ANALYSIS (Constraints + Audit)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDerived(rootDir: string, verbose: boolean, approvedCount: number, state: SetupState): Promise<Record<string, FeatureResult>> {
  printPhase(5, 'Derived Analysis', 'Extracting constraints and health snapshot');

  const ctx: RunnerContext = { rootDir, verbose };
  const results: Record<string, FeatureResult> = {};

  // Constraints (only if patterns approved)
  if (approvedCount > 0) {
    const constraintsRunner = new ConstraintsRunner(ctx);
    results['constraints'] = await constraintsRunner.run();
    state.completed.push('constraints');
  } else {
    printInfo('Skipping constraints (no approved patterns)');
  }

  // Audit
  const auditRunner = new AuditRunner(ctx);
  results['audit'] = await auditRunner.run();
  state.completed.push('audit');

  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: MEMORY (Opt-in)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseMemory(rootDir: string, autoYes: boolean, verbose: boolean, state: SetupState): Promise<FeatureResult | undefined> {
  printPhase(6, 'Cortex Memory', 'Living knowledge system');

  console.log();
  console.log(chalk.bold.cyan('  🧠 Cortex Memory - Your AI\'s Long-Term Memory'));
  console.log();
  console.log(chalk.gray('  Cortex replaces static AGENTS.md files with a living system:'));
  console.log(chalk.white('    • Store tribal knowledge: "Always use bcrypt for passwords"'));
  console.log(chalk.white('    • Track workflows: "Deploy: test → build → push"'));
  console.log(chalk.white('    • Learn from corrections: AI remembers your feedback'));
  console.log();
  console.log(chalk.gray('  This is NOT telemetry - data stays local in memory.db'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const memoryRunner = new MemoryRunner(ctx);

  // In auto mode, skip memory (user can enable later)
  // In interactive mode, ask
  const shouldInit = autoYes ? false : await confirm({ 
    message: 'Initialize Cortex memory?', 
    default: true 
  });

  if (shouldInit) {
    const result = await memoryRunner.run();
    state.completed.push('memory');
    state.choices.initMemory = true;
    console.log();
    printInfo('Add knowledge: drift memory add tribal "your insight"');
    return result;
  }

  printSkip('Run `drift memory init` later to enable');
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: FINALIZE
// ═══════════════════════════════════════════════════════════════════════════

async function phaseFinalize(
  rootDir: string, projectId: string, patternCount: number, approvedCount: number,
  categories: Record<string, number>, allResults: Record<string, FeatureResult | undefined>, state: SetupState
): Promise<SourceOfTruth> {
  printPhase(7, 'Finalize', 'Creating Source of Truth');

  const spinner = createSpinner('Finalizing...');
  spinner.start();

  const now = new Date().toISOString();
  const scanId = crypto.randomUUID().slice(0, 8);

  const buildConfig = (result?: FeatureResult): FeatureConfig => {
    if (!result) return { enabled: false };
    const config: FeatureConfig = { enabled: result.enabled };
    if (result.timestamp) config.builtAt = result.timestamp;
    if (result.stats) config.stats = result.stats;
    return config;
  };

  const sot: SourceOfTruth = {
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    project: { id: projectId, name: path.basename(rootDir), rootPath: rootDir },
    baseline: {
      scanId, scannedAt: now, fileCount: await countSourceFiles(rootDir),
      patternCount, approvedCount, categories,
      checksum: computeChecksum({ patterns: patternCount, categories, approved: approvedCount }),
    },
    features: {
      boundaries: buildConfig(allResults['boundaries']),
      contracts: buildConfig(allResults['contracts']),
      environment: buildConfig(allResults['environment']),
      constants: buildConfig(allResults['constants']),
      callGraph: buildConfig(allResults['callGraph']),
      testTopology: buildConfig(allResults['testTopology']),
      coupling: buildConfig(allResults['coupling']),
      dna: buildConfig(allResults['dna']),
      errorHandling: buildConfig(allResults['errorHandling']),
      constraints: buildConfig(allResults['constraints']),
      audit: buildConfig(allResults['audit']),
      memory: buildConfig(allResults['memory']),
      sqliteSync: { enabled: true, builtAt: now },
    },
    settings: { autoApproveThreshold: state.choices.approveThreshold, autoApproveEnabled: state.choices.autoApprove },
    history: [{ action: 'setup_complete', timestamp: now, details: `${patternCount} patterns, ${approvedCount} approved` }],
  };

  await saveSourceOfTruth(rootDir, sot);
  await clearSetupState(rootDir);

  // Final sync
  await syncToSqlite(rootDir, false);

  // Update manifest
  const manifestPath = path.join(rootDir, DRIFT_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ version: SCHEMA_VERSION, driftVersion: VERSION, lastUpdatedAt: now, sourceOfTruthId: scanId }, null, 2));

  // Pre-compute status view
  const viewsDir = path.join(rootDir, DRIFT_DIR, 'views');
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.writeFile(path.join(viewsDir, 'status.json'), JSON.stringify({
    lastUpdated: now,
    patterns: { total: patternCount, byStatus: { discovered: patternCount - approvedCount, approved: approvedCount, ignored: 0 }, byCategory: categories },
  }, null, 2));

  spinner.succeed('Source of Truth created');

  return sot;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

function printFinalSummary(sot: SourceOfTruth, state: SetupState): void {
  const duration = Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000);
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  console.log();
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.green('                      SETUP COMPLETE'));
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log();
  console.log(`  ${chalk.bold('Project:')}     ${sot.project.name}`);
  console.log(`  ${chalk.bold('Patterns:')}    ${sot.baseline.patternCount} (${sot.baseline.approvedCount} approved)`);
  console.log(`  ${chalk.bold('Duration:')}    ${timeStr}`);
  console.log();

  // Show enabled features
  const enabled = Object.entries(sot.features).filter(([, v]) => v.enabled).map(([k]) => k);
  if (enabled.length > 0) {
    console.log(`  ${chalk.bold('Features:')}    ${enabled.join(', ')}`);
    console.log();
  }

  console.log(chalk.gray('  Your codebase is ready for:'));
  console.log(chalk.white('    • AI-assisted development (patterns guide code generation)'));
  console.log(chalk.white('    • CI/CD integration (drift check --ci)'));
  console.log(chalk.white('    • Cloud sync (coming soon)'));
  console.log();
  console.log(chalk.gray('  Next steps:'));
  console.log(chalk.cyan('    drift status        ') + chalk.gray('View current state'));
  console.log(chalk.cyan('    drift dashboard     ') + chalk.gray('Launch web UI'));
  console.log(chalk.cyan('    drift check         ') + chalk.gray('Check for violations'));
  console.log();
  console.log(chalk.bold.green('═══════════════════════════════════════════════════════════════'));
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ACTION
// ═══════════════════════════════════════════════════════════════════════════

async function setupAction(options: SetupOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;
  const autoYes = options.yes ?? false;

  // New welcome message
  console.log();
  console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           🔍 Drift Setup - Advanced Features              ║'));
  console.log(chalk.bold.cyan('║   Compute call graphs, test topology, and more            ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝'));
  console.log();

  let state = createDefaultState();

  // Resume support
  if (options.resume) {
    const savedState = await loadSetupState(rootDir);
    if (savedState) {
      console.log(chalk.yellow('  Resuming previous setup...'));
      state = savedState;
    }
  }

  // Phase 0: Check prerequisites (patterns must exist)
  const { patternCount, categories, shouldContinue } = await phaseCheckPrerequisites(rootDir);
  if (!shouldContinue) {
    return;
  }

  // Phase 1: Initialize/Register
  const projectId = await phaseInit(rootDir);
  state.phase = 1;
  await saveSetupState(rootDir, state);

  // Phase 2: Approval
  const approvedCount = await phaseApproval(rootDir, autoYes, patternCount, state);
  state.phase = 2;
  await saveSetupState(rootDir, state);

  // Phase 3: Core Features (all run automatically)
  const coreResults = await phaseCoreFeatures(rootDir, verbose, state);
  state.phase = 3;
  await saveSetupState(rootDir, state);

  // Phase 4: Deep Analysis (all run automatically)
  const deepResults = await phaseDeepAnalysis(rootDir, verbose, state);
  state.phase = 4;
  await saveSetupState(rootDir, state);

  // Phase 5: Derived (auto)
  const derivedResults = await phaseDerived(rootDir, verbose, approvedCount, state);
  state.phase = 5;
  await saveSetupState(rootDir, state);

  // Phase 6: Memory (opt-in)
  const memoryResult = await phaseMemory(rootDir, autoYes, verbose, state);
  state.phase = 6;
  await saveSetupState(rootDir, state);

  // Combine all results
  const allResults: Record<string, FeatureResult | undefined> = {
    ...coreResults,
    ...deepResults,
    ...derivedResults,
    memory: memoryResult,
  };

  // Phase 7: Finalize
  const sot = await phaseFinalize(rootDir, projectId, patternCount, approvedCount, categories, allResults, state);

  // Summary
  printFinalSummary(sot, state);
}

export const setupCommand = new Command('setup')
  .description('Compute advanced features (run after drift scan)')
  .option('-y, --yes', 'Accept defaults and run all features')
  .option('--verbose', 'Enable verbose output')
  .option('--resume', 'Resume interrupted setup')
  .action(setupAction);
