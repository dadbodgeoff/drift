/**
 * Setup Command - drift setup
 *
 * Enterprise-grade guided onboarding that creates a Source of Truth
 * for your codebase. Every feature runs REAL analysis.
 *
 * DESIGN DECISIONS:
 * - Core scan features: Optional with explicit yes/no for each
 * - Deep analysis: All run by default with -y, prompts in interactive
 * - Timing: Stream results in real-time (no estimates)
 * - SQLite sync: After each phase (safer, incremental)
 * - Memory: Opt-in but prominently displayed
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
import { confirm, select } from '@inquirer/prompts';

import {
  getProjectRegistry,
  FileWalker,
  getDefaultIgnorePatterns,
  mergeIgnorePatterns,
  createWorkspaceManager,
  type Pattern,
  type PatternCategory,
  type ConfidenceInfo,
  type PatternLocation,
  type ScanOptions,
} from 'driftdetect-core';
import { createPatternStore, StoreSyncService } from 'driftdetect-core/storage';

import { createSpinner } from '../../ui/spinner.js';
import { createCLIPatternServiceAsync } from '../../services/pattern-service-factory.js';
import { createScannerService, type ProjectContext } from '../../services/scanner-service.js';
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
  createDriftDirectory,
  createDefaultConfig,
  createDriftignore,
  loadSourceOfTruth,
  saveSourceOfTruth,
  loadSetupState,
  saveSetupState,
  clearSetupState,
  countSourceFiles,
  computeChecksum,
  isScannableFile,
} from './utils.js';

import { printWelcome, printPhase, printSuccess, printSkip, printInfo } from './ui.js';

import {
  CallGraphRunner, TestTopologyRunner, CouplingRunner, DNARunner, MemoryRunner,
  BoundariesRunner, ContractsRunner, EnvironmentRunner, ConstantsRunner,
  ErrorHandlingRunner, ConstraintsRunner, AuditRunner,
  type RunnerContext,
} from './runners/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(rootDir, '.driftignore'), 'utf-8');
    const userPatterns = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    return mergeIgnorePatterns(userPatterns);
  } catch {
    return getDefaultIgnorePatterns();
  }
}

function mapToPatternCategory(category: string): PatternCategory {
  const mapping: Record<string, PatternCategory> = {
    'api': 'api', 'auth': 'auth', 'security': 'security', 'errors': 'errors',
    'structural': 'structural', 'components': 'components', 'styling': 'styling',
    'logging': 'logging', 'testing': 'testing', 'data-access': 'data-access',
    'config': 'config', 'types': 'types', 'performance': 'performance',
    'accessibility': 'accessibility', 'documentation': 'documentation',
  };
  return mapping[category] || 'structural';
}

function createDefaultState(): SetupState {
  return {
    phase: 0,
    completed: [],
    choices: {
      runCoreScan: true, autoApprove: false, approveThreshold: 0.85,
      scanBoundaries: false, scanContracts: false, scanEnvironment: false, scanConstants: false,
      buildCallGraph: false, buildTestTopology: false, buildCoupling: false,
      scanDna: false, analyzeErrorHandling: false, initMemory: false,
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
// PHASE 0: DETECT EXISTING
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDetect(rootDir: string, autoYes: boolean): Promise<{ isNew: boolean; sot: SourceOfTruth | null; shouldContinue: boolean }> {
  printPhase(0, 'Detection', 'Checking for existing installation');

  const initialized = await isDriftInitialized(rootDir);
  const sot = initialized ? await loadSourceOfTruth(rootDir) : null;

  if (!initialized) {
    printInfo('No existing installation. Starting fresh.');
    return { isNew: true, sot: null, shouldContinue: true };
  }

  if (sot) {
    console.log(chalk.yellow('  ⚡ Existing Source of Truth detected'));
    console.log(chalk.gray(`     Project: ${sot.project.name} | Patterns: ${sot.baseline.patternCount} (${sot.baseline.approvedCount} approved)`));
    console.log();

    if (autoYes) {
      printInfo('Rescanning with existing data (--yes flag)');
      return { isNew: false, sot, shouldContinue: true };
    }

    const choice = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'rescan', name: 'Rescan and update (keeps approved patterns)' },
        { value: 'fresh', name: 'Start fresh (creates backup)' },
        { value: 'cancel', name: 'Cancel' },
      ],
    });

    if (choice === 'cancel') return { isNew: false, sot, shouldContinue: false };

    if (choice === 'fresh') {
      const spinner = createSpinner('Creating backup...');
      spinner.start();
      try {
        const manager = createWorkspaceManager(rootDir);
        await manager.initialize({ driftVersion: VERSION });
        await manager.createBackup('pre_destructive_operation');
        spinner.succeed('Backup created');
      } catch (error) {
        spinner.fail(`Backup failed: ${(error as Error).message}`);
        const proceed = await confirm({ message: 'Continue without backup?', default: false });
        if (!proceed) return { isNew: false, sot, shouldContinue: false };
      }
      return { isNew: true, sot: null, shouldContinue: true };
    }

    return { isNew: false, sot, shouldContinue: true };
  }

  printInfo('Legacy installation detected. Will create Source of Truth.');
  return { isNew: false, sot: null, shouldContinue: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════

async function phaseInit(rootDir: string, isNew: boolean): Promise<string> {
  printPhase(1, 'Initialize', 'Setting up project structure');

  const projectId = crypto.randomUUID();

  if (isNew) {
    const spinner = createSpinner('Creating .drift directory...');
    spinner.start();
    await createDriftDirectory(rootDir);
    await createDefaultConfig(rootDir, projectId);
    await createDriftignore(rootDir);
    spinner.succeed('Project structure created');
  } else {
    printInfo('Using existing structure');
  }

  try {
    const registry = await getProjectRegistry();
    const existing = registry.findByPath(rootDir);
    if (existing) {
      await registry.setActive(existing.id);
      printSuccess(`Registered: ${chalk.cyan(existing.name)}`);
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
// PHASE 2: PATTERN SCAN (Required)
// ═══════════════════════════════════════════════════════════════════════════

async function phasePatternScan(rootDir: string, verbose: boolean): Promise<{ patternCount: number; categories: Record<string, number> }> {
  printPhase(2, 'Pattern Scan', 'Discovering coding patterns');

  const spinner = createSpinner('Scanning for patterns...');
  spinner.start();

  try {
    const store = await createPatternStore({ rootDir });
    const ignorePatterns = await loadIgnorePatterns(rootDir);
    const walker = new FileWalker();
    const scanOptions: ScanOptions = {
      rootDir, ignorePatterns, respectGitignore: true, respectDriftignore: true,
      followSymlinks: false, maxDepth: 50, maxFileSize: 1048576,
    };

    const result = await walker.walk(scanOptions);
    const files = result.files.map(f => f.relativePath).filter(isScannableFile);

    const scannerService = createScannerService({
      rootDir, verbose, criticalOnly: false, categories: [],
      generateManifest: false, incremental: false,
    });
    await scannerService.initialize();

    const projectContext: ProjectContext = { rootDir, files, config: {} };
    const scanResults = await scannerService.scanFiles(files, projectContext);

    const now = new Date().toISOString();
    const categories: Record<string, number> = {};

    for (const aggPattern of scanResults.patterns) {
      categories[aggPattern.category] = (categories[aggPattern.category] ?? 0) + aggPattern.occurrences;

      const id = crypto.createHash('sha256').update(`${aggPattern.patternId}-${rootDir}`).digest('hex').slice(0, 16);
      const spread = new Set(aggPattern.locations.map((l: { file: string }) => l.file)).size;
      const confidenceScore = Math.min(0.95, aggPattern.confidence);
      const confidenceInfo: ConfidenceInfo = {
        frequency: Math.min(1, aggPattern.occurrences / 100), consistency: 0.9, age: 0, spread,
        score: confidenceScore,
        level: confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : confidenceScore >= 0.45 ? 'low' : 'uncertain',
      };

      const locations: PatternLocation[] = aggPattern.locations.slice(0, 100).map((l: { file: string; line: number; column?: number; snippet?: string }) => ({
        file: l.file, line: l.line, column: l.column ?? 0, snippet: l.snippet,
      }));

      const pattern: Pattern = {
        id, category: mapToPatternCategory(aggPattern.category), subcategory: aggPattern.subcategory,
        name: aggPattern.name, description: aggPattern.description,
        detector: { type: 'regex', config: { detectorId: aggPattern.detectorId, patternId: aggPattern.patternId } },
        confidence: confidenceInfo, locations, outliers: [],
        metadata: { firstSeen: now, lastSeen: now },
        severity: 'warning', autoFixable: false, status: 'discovered',
      };

      if (!store.has(pattern.id)) store.add(pattern);
    }

    await store.saveAll();
    spinner.succeed(`Found ${chalk.cyan(scanResults.patterns.length)} patterns in ${chalk.cyan(Object.keys(categories).length)} categories`);

    return { patternCount: scanResults.patterns.length, categories };
  } catch (error) {
    spinner.fail('Pattern scan failed');
    if (verbose) console.error(chalk.red(`  ${(error as Error).message}`));
    return { patternCount: 0, categories: {} };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: CORE FEATURES (Optional - User chooses each)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseCoreFeatures(
  rootDir: string, autoYes: boolean, verbose: boolean, state: SetupState
): Promise<Record<string, FeatureResult>> {
  printPhase(3, 'Core Features', 'Additional analysis (choose each)');

  console.log(chalk.gray('  Each feature provides unique insights. Choose what you need:'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const results: Record<string, FeatureResult> = {};

  // Boundaries
  const boundariesRunner = new BoundariesRunner(ctx);
  console.log(`  ${boundariesRunner.icon} ${chalk.bold(boundariesRunner.name)}`);
  console.log(chalk.gray(`     ${boundariesRunner.description}`));
  state.choices.scanBoundaries = autoYes || await confirm({ message: 'Scan data boundaries?', default: true });
  if (state.choices.scanBoundaries) {
    results['boundaries'] = await boundariesRunner.run();
    state.completed.push('boundaries');
  } else {
    printSkip('Skipped');
  }

  // Contracts
  const contractsRunner = new ContractsRunner(ctx);
  console.log(`  ${contractsRunner.icon} ${chalk.bold(contractsRunner.name)}`);
  console.log(chalk.gray(`     ${contractsRunner.description}`));
  state.choices.scanContracts = autoYes || await confirm({ message: 'Scan BE↔FE contracts?', default: true });
  if (state.choices.scanContracts) {
    results['contracts'] = await contractsRunner.run();
    state.completed.push('contracts');
  } else {
    printSkip('Skipped');
  }

  // Environment
  const envRunner = new EnvironmentRunner(ctx);
  console.log(`  ${envRunner.icon} ${chalk.bold(envRunner.name)}`);
  console.log(chalk.gray(`     ${envRunner.description}`));
  state.choices.scanEnvironment = autoYes || await confirm({ message: 'Scan environment variables?', default: true });
  if (state.choices.scanEnvironment) {
    results['environment'] = await envRunner.run();
    state.completed.push('environment');
  } else {
    printSkip('Skipped');
  }

  // Constants
  const constantsRunner = new ConstantsRunner(ctx);
  console.log(`  ${constantsRunner.icon} ${chalk.bold(constantsRunner.name)}`);
  console.log(chalk.gray(`     ${constantsRunner.description}`));
  state.choices.scanConstants = autoYes || await confirm({ message: 'Extract constants?', default: true });
  if (state.choices.scanConstants) {
    results['constants'] = await constantsRunner.run();
    state.completed.push('constants');
  } else {
    printSkip('Skipped');
  }

  // Sync after core features
  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: PATTERN APPROVAL
// ═══════════════════════════════════════════════════════════════════════════

async function phaseApproval(rootDir: string, autoYes: boolean, patternCount: number, state: SetupState): Promise<number> {
  if (patternCount === 0) return 0;

  printPhase(4, 'Approval', 'Establish coding standards');

  console.log(chalk.gray('  Approved patterns become your "golden standard":'));
  console.log(chalk.green('    → AI follows them when generating code'));
  console.log(chalk.green('    → Violations flagged in CI/CD'));
  console.log();

  const choice = autoYes ? 'auto-85' : await select({
    message: 'How to handle approval?',
    choices: [
      { value: 'auto-85', name: '✓ Auto-approve ≥85% confidence (recommended)' },
      { value: 'auto-90', name: '✓ Auto-approve ≥90% confidence (conservative)' },
      { value: 'all', name: '✓ Approve all patterns' },
      { value: 'skip', name: '○ Skip (review later with drift approve)' },
    ],
  });

  if (choice === 'skip') {
    printSkip('Review later: drift approve all');
    return 0;
  }

  const threshold = choice === 'auto-90' ? 0.90 : choice === 'auto-85' ? 0.85 : 0;
  state.choices.autoApprove = true;
  state.choices.approveThreshold = threshold;

  const spinner = createSpinner('Approving patterns...');
  spinner.start();

  try {
    const service = await createCLIPatternServiceAsync(rootDir);
    const discovered = await service.listByStatus('discovered', { limit: 5000 });
    const eligible = choice === 'all' ? discovered.items : discovered.items.filter(p => p.confidence >= threshold);

    let approved = 0;
    for (const pattern of eligible) {
      try { await service.approvePattern(pattern.id); approved++; } catch { /* skip */ }
    }

    spinner.succeed(`Approved ${chalk.cyan(approved)} patterns`);
    state.completed.push('approval');

    // Sync after approval
    await syncToSqlite(rootDir, false);

    return approved;
  } catch {
    spinner.fail('Approval failed');
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: DEEP ANALYSIS (Optional - User chooses each)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDeepAnalysis(
  rootDir: string, autoYes: boolean, verbose: boolean, state: SetupState
): Promise<Record<string, FeatureResult>> {
  printPhase(5, 'Deep Analysis', 'Advanced features (choose each)');

  console.log(chalk.gray('  These provide deeper insights using native Rust analysis:'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const results: Record<string, FeatureResult> = {};

  // Call Graph
  const cgRunner = new CallGraphRunner(ctx);
  console.log(`  ${cgRunner.icon} ${chalk.bold(cgRunner.name)}`);
  console.log(chalk.gray(`     ${cgRunner.benefit}`));
  state.choices.buildCallGraph = autoYes || await confirm({ message: 'Build call graph?', default: true });
  if (state.choices.buildCallGraph) {
    results['callGraph'] = await cgRunner.run();
    state.completed.push('callgraph');
  } else {
    printSkip('Skipped');
  }

  // Test Topology
  const ttRunner = new TestTopologyRunner(ctx);
  console.log(`  ${ttRunner.icon} ${chalk.bold(ttRunner.name)}`);
  console.log(chalk.gray(`     ${ttRunner.benefit}`));
  state.choices.buildTestTopology = autoYes || await confirm({ message: 'Build test topology?', default: true });
  if (state.choices.buildTestTopology) {
    results['testTopology'] = await ttRunner.run();
    state.completed.push('test-topology');
  } else {
    printSkip('Skipped');
  }

  // Coupling
  const couplingRunner = new CouplingRunner(ctx);
  console.log(`  ${couplingRunner.icon} ${chalk.bold(couplingRunner.name)}`);
  console.log(chalk.gray(`     ${couplingRunner.benefit}`));
  state.choices.buildCoupling = autoYes || await confirm({ message: 'Analyze coupling?', default: true });
  if (state.choices.buildCoupling) {
    results['coupling'] = await couplingRunner.run();
    state.completed.push('coupling');
  } else {
    printSkip('Skipped');
  }

  // Error Handling
  const ehRunner = new ErrorHandlingRunner(ctx);
  console.log(`  ${ehRunner.icon} ${chalk.bold(ehRunner.name)}`);
  console.log(chalk.gray(`     ${ehRunner.benefit}`));
  state.choices.analyzeErrorHandling = autoYes || await confirm({ message: 'Analyze error handling?', default: true });
  if (state.choices.analyzeErrorHandling) {
    results['errorHandling'] = await ehRunner.run();
    state.completed.push('error-handling');
  } else {
    printSkip('Skipped');
  }

  // DNA
  const dnaRunner = new DNARunner(ctx);
  console.log(`  ${dnaRunner.icon} ${chalk.bold(dnaRunner.name)}`);
  console.log(chalk.gray(`     ${dnaRunner.benefit}`));
  state.choices.scanDna = autoYes || await confirm({ message: 'Scan styling DNA?', default: true });
  if (state.choices.scanDna) {
    results['dna'] = await dnaRunner.run();
    state.completed.push('dna');
  } else {
    printSkip('Skipped');
  }

  // Sync after deep analysis
  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: DERIVED ANALYSIS (Auto - Constraints + Audit)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDerived(rootDir: string, verbose: boolean, approvedCount: number, state: SetupState): Promise<Record<string, FeatureResult>> {
  printPhase(6, 'Derived Analysis', 'Extracting constraints and health snapshot');

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

  // Sync after derived
  await syncToSqlite(rootDir, verbose);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: MEMORY (Opt-in - Prominently displayed)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseMemory(rootDir: string, autoYes: boolean, verbose: boolean, state: SetupState): Promise<FeatureResult | undefined> {
  printPhase(7, 'Cortex Memory', 'Living knowledge system');

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

  // Always prompt explicitly - this is important
  state.choices.initMemory = await confirm({ 
    message: 'Initialize Cortex memory? (recommended for AI-assisted development)', 
    default: !autoYes // Default yes in interactive, no in auto mode to be explicit
  });

  if (state.choices.initMemory) {
    const result = await memoryRunner.run();
    state.completed.push('memory');
    console.log();
    printInfo('Add knowledge: drift memory add tribal "your insight"');
    return result;
  }

  printSkip('Run `drift memory init` later to enable');
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: FINALIZE
// ═══════════════════════════════════════════════════════════════════════════

async function phaseFinalize(
  rootDir: string, projectId: string, patternCount: number, approvedCount: number,
  categories: Record<string, number>, allResults: Record<string, FeatureResult | undefined>, state: SetupState
): Promise<SourceOfTruth> {
  printPhase(8, 'Finalize', 'Creating Source of Truth');

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

  printWelcome();

  let state = createDefaultState();

  // Resume support
  if (options.resume) {
    const savedState = await loadSetupState(rootDir);
    if (savedState) {
      console.log(chalk.yellow('  Resuming previous setup...'));
      state = savedState;
    }
  }

  // Phase 0: Detect
  const { isNew, shouldContinue } = await phaseDetect(rootDir, autoYes);
  if (!shouldContinue) {
    console.log(chalk.gray('  Setup cancelled.'));
    return;
  }

  // Phase 1: Initialize
  const projectId = await phaseInit(rootDir, isNew);
  state.phase = 1;
  await saveSetupState(rootDir, state);

  // Phase 2: Pattern Scan (always runs)
  const { patternCount, categories } = await phasePatternScan(rootDir, verbose);
  state.phase = 2;
  state.completed.push('patterns');
  await saveSetupState(rootDir, state);
  await syncToSqlite(rootDir, verbose);

  // Phase 3: Core Features (user chooses each)
  const coreResults = await phaseCoreFeatures(rootDir, autoYes, verbose, state);
  state.phase = 3;
  await saveSetupState(rootDir, state);

  // Phase 4: Approval
  const approvedCount = await phaseApproval(rootDir, autoYes, patternCount, state);
  state.phase = 4;
  await saveSetupState(rootDir, state);

  // Phase 5: Deep Analysis (user chooses each)
  const deepResults = await phaseDeepAnalysis(rootDir, autoYes, verbose, state);
  state.phase = 5;
  await saveSetupState(rootDir, state);

  // Phase 6: Derived (auto)
  const derivedResults = await phaseDerived(rootDir, verbose, approvedCount, state);
  state.phase = 6;
  await saveSetupState(rootDir, state);

  // Phase 7: Memory (opt-in, prominently displayed)
  const memoryResult = await phaseMemory(rootDir, autoYes, verbose, state);
  state.phase = 7;
  await saveSetupState(rootDir, state);

  // Combine all results
  const allResults: Record<string, FeatureResult | undefined> = {
    ...coreResults,
    ...deepResults,
    ...derivedResults,
    memory: memoryResult,
  };

  // Phase 8: Finalize
  const sot = await phaseFinalize(rootDir, projectId, patternCount, approvedCount, categories, allResults, state);

  // Summary
  printFinalSummary(sot, state);
}

export const setupCommand = new Command('setup')
  .description('Enterprise-grade setup wizard - create your codebase Source of Truth')
  .option('-y, --yes', 'Accept defaults and run all features')
  .option('--verbose', 'Enable verbose output')
  .option('--resume', 'Resume interrupted setup')
  .action(setupAction);
