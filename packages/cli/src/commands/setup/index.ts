/**
 * Setup Command - drift setup
 *
 * Enterprise-grade guided onboarding that creates a Source of Truth
 * for your codebase. Every feature runs REAL analysis.
 *
 * Architecture:
 * - types.ts: Shared type definitions
 * - utils.ts: File system and helper utilities
 * - ui.ts: Console output formatting
 * - runners/: Individual feature runners (single responsibility)
 *
 * @module commands/setup
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

// Increase max listeners to avoid warnings with multiple prompts
EventEmitter.defaultMaxListeners = 50;

import chalk from 'chalk';
import { Command } from 'commander';
import { confirm, select } from '@inquirer/prompts';

import {
  PatternStore,
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

import { createSpinner } from '../../ui/spinner.js';
import { createCLIPatternService } from '../../services/pattern-service-factory.js';
import { createScannerService, type ProjectContext } from '../../services/scanner-service.js';
import { VERSION } from '../../index.js';

import {
  type SetupOptions,
  type SetupState,
  type ScanResult,
  type ApprovalResult,
  type AnalysisResults,
  type SourceOfTruth,
  type FeatureConfig,
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

import {
  printWelcome,
  printPhase,
  printFeature,
  printSuccess,
  printSkip,
  printInfo,
  printSummary,
} from './ui.js';

import {
  CallGraphRunner,
  TestTopologyRunner,
  CouplingRunner,
  DNARunner,
  MemoryRunner,
  type RunnerContext,
} from './runners/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
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
      autoApprove: false,
      approveThreshold: 0.85,
      buildCallGraph: false,
      buildTestTopology: false,
      buildCoupling: false,
      scanDna: false,
      initMemory: false,
    },
    startedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 0: DETECT EXISTING
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDetectExisting(
  rootDir: string,
  autoYes: boolean
): Promise<{ isNew: boolean; sot: SourceOfTruth | null; shouldContinue: boolean }> {
  printPhase(0, 'Detection', 'Checking for existing Drift installation');

  const initialized = await isDriftInitialized(rootDir);
  const sot = initialized ? await loadSourceOfTruth(rootDir) : null;

  if (!initialized) {
    printInfo('No existing installation found. Starting fresh setup.');
    return { isNew: true, sot: null, shouldContinue: true };
  }

  if (sot) {
    console.log(chalk.yellow('  ⚡ Existing Source of Truth detected!'));
    console.log();
    console.log(chalk.gray(`     Project: ${sot.project.name}`));
    console.log(chalk.gray(`     Created: ${new Date(sot.createdAt).toLocaleDateString()}`));
    console.log(chalk.gray(`     Patterns: ${sot.baseline.patternCount} (${sot.baseline.approvedCount} approved)`));
    console.log();

    if (autoYes) {
      printInfo('Using existing Source of Truth (--yes flag)');
      return { isNew: false, sot, shouldContinue: true };
    }

    const choice = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'use', name: 'Use existing Source of Truth (recommended)' },
        { value: 'rescan', name: 'Rescan and update baseline (keeps approved patterns)' },
        { value: 'fresh', name: 'Start fresh (creates backup first)' },
        { value: 'cancel', name: 'Cancel setup' },
      ],
    });

    if (choice === 'cancel') {
      return { isNew: false, sot, shouldContinue: false };
    }

    if (choice === 'use') {
      printSuccess('Using existing Source of Truth');
      return { isNew: false, sot, shouldContinue: true };
    }

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
        if (!autoYes) {
          const proceed = await confirm({ message: 'Continue without backup?', default: false });
          if (!proceed) {
            return { isNew: false, sot, shouldContinue: false };
          }
        }
      }
      return { isNew: true, sot: null, shouldContinue: true };
    }

    return { isNew: false, sot, shouldContinue: true };
  }

  console.log(chalk.yellow('  ⚠ Legacy installation detected (no Source of Truth)'));
  printInfo('Will create Source of Truth from existing data.');
  return { isNew: false, sot: null, shouldContinue: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: INITIALIZE
// ═══════════════════════════════════════════════════════════════════════════

async function phaseInitialize(rootDir: string, isNew: boolean): Promise<string> {
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
    printInfo('Using existing project structure');
  }

  try {
    const registry = await getProjectRegistry();
    const existing = registry.findByPath(rootDir);
    if (existing) {
      await registry.setActive(existing.id);
      printSuccess(`Project registered: ${chalk.cyan(existing.name)}`);
      return existing.id;
    } else {
      const project = await registry.register(rootDir);
      await registry.setActive(project.id);
      printSuccess(`Project registered: ${chalk.cyan(project.name)}`);
      return project.id;
    }
  } catch {
    printInfo('Global registry unavailable (single-project mode)');
    return projectId;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: PATTERN SCAN
// ═══════════════════════════════════════════════════════════════════════════

async function phaseScan(
  rootDir: string,
  autoYes: boolean,
  verbose: boolean,
  state: SetupState
): Promise<ScanResult> {
  printPhase(2, 'Pattern Discovery', 'Scanning your codebase for patterns');

  console.log(chalk.gray('  Drift analyzes your code to discover:'));
  console.log(chalk.gray('    • API patterns (routes, endpoints, middleware)'));
  console.log(chalk.gray('    • Auth patterns (authentication, authorization)'));
  console.log(chalk.gray('    • Error handling patterns'));
  console.log(chalk.gray('    • Data access patterns (queries, ORM usage)'));
  console.log(chalk.gray('    • Structural patterns (naming, organization)'));
  console.log(chalk.gray('    • And 10+ more categories...'));
  console.log();

  const fileCount = await countSourceFiles(rootDir);
  console.log(`  Found ${chalk.cyan(fileCount.toLocaleString())} source files.`);
  console.log();

  const shouldScan = autoYes || await confirm({ message: 'Run pattern scan?', default: true });

  if (!shouldScan) {
    printSkip('Skipping scan. Run `drift scan` later.');
    return { success: false, patternCount: 0, categories: {} };
  }

  const spinner = createSpinner(`Scanning ${fileCount.toLocaleString()} files...`);
  spinner.start();

  try {
    const store = new PatternStore({ rootDir });
    await store.initialize();

    const ignorePatterns = await loadIgnorePatterns(rootDir);
    const walker = new FileWalker();
    const scanOptions: ScanOptions = {
      rootDir,
      ignorePatterns,
      respectGitignore: true,
      respectDriftignore: true,
      followSymlinks: false,
      maxDepth: 50,
      maxFileSize: 1048576,
    };

    const result = await walker.walk(scanOptions);
    const files = result.files.map(f => f.relativePath).filter(isScannableFile);

    const scannerService = createScannerService({
      rootDir,
      verbose,
      criticalOnly: false,
      categories: [],
      generateManifest: false,
      incremental: false,
    });

    await scannerService.initialize();

    const projectContext: ProjectContext = { rootDir, files, config: {} };
    const scanResults = await scannerService.scanFiles(files, projectContext);

    const now = new Date().toISOString();
    const categories: Record<string, number> = {};

    for (const aggPattern of scanResults.patterns) {
      const cat = aggPattern.category;
      categories[cat] = (categories[cat] ?? 0) + aggPattern.occurrences;

      const id = crypto.createHash('sha256')
        .update(`${aggPattern.patternId}-${rootDir}`)
        .digest('hex')
        .slice(0, 16);

      const spread = new Set(aggPattern.locations.map((l: { file: string }) => l.file)).size;
      const confidenceScore = Math.min(0.95, aggPattern.confidence);
      const confidenceInfo: ConfidenceInfo = {
        frequency: Math.min(1, aggPattern.occurrences / 100),
        consistency: 0.9,
        age: 0,
        spread,
        score: confidenceScore,
        level: confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : confidenceScore >= 0.45 ? 'low' : 'uncertain',
      };

      const locations: PatternLocation[] = aggPattern.locations.slice(0, 100).map((l: { file: string; line: number; column?: number; snippet?: string }) => ({
        file: l.file,
        line: l.line,
        column: l.column ?? 0,
        snippet: l.snippet,
      }));

      const pattern: Pattern = {
        id,
        category: mapToPatternCategory(aggPattern.category),
        subcategory: aggPattern.subcategory,
        name: aggPattern.name,
        description: aggPattern.description,
        detector: { type: 'regex', config: { detectorId: aggPattern.detectorId, patternId: aggPattern.patternId } },
        confidence: confidenceInfo,
        locations,
        outliers: [],
        metadata: { firstSeen: now, lastSeen: now },
        severity: 'warning',
        autoFixable: false,
        status: 'discovered',
      };

      if (!store.has(pattern.id)) {
        store.add(pattern);
      }
    }

    await store.saveAll();
    const patternCount = scanResults.patterns.length;

    spinner.succeed(`Discovered ${chalk.cyan(patternCount)} patterns across ${chalk.cyan(Object.keys(categories).length)} categories`);

    if (Object.keys(categories).length > 0) {
      console.log();
      const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 6);
      for (const [cat, count] of sorted) {
        console.log(chalk.gray(`    ${cat}: ${count} occurrences`));
      }
      if (Object.keys(categories).length > 6) {
        console.log(chalk.gray(`    ... and ${Object.keys(categories).length - 6} more categories`));
      }
    }

    state.completed.push('scan');
    return { success: true, patternCount, categories };
  } catch (error) {
    spinner.fail('Scan failed');
    if (verbose) console.error(chalk.red(`  ${(error as Error).message}`));
    return { success: false, patternCount: 0, categories: {} };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: PATTERN APPROVAL
// ═══════════════════════════════════════════════════════════════════════════

async function phaseApproval(
  rootDir: string,
  autoYes: boolean,
  patternCount: number,
  state: SetupState
): Promise<ApprovalResult> {
  if (patternCount === 0) {
    return { approved: 0, threshold: 0.85 };
  }

  printPhase(3, 'Pattern Approval', 'Establish your coding standards');

  console.log(chalk.gray('  Patterns define your coding conventions.'));
  console.log(chalk.gray('  Approved patterns become your "golden standard".'));
  console.log();
  console.log(chalk.bold('  Why approve patterns?'));
  console.log(chalk.green('    → AI follows approved patterns when generating code'));
  console.log(chalk.green('    → Violations are flagged in CI/CD pipelines'));
  console.log(chalk.green('    → New code is checked against your standards'));
  console.log();

  const choice = autoYes ? 'auto-85' : await select({
    message: 'How would you like to handle pattern approval?',
    choices: [
      { value: 'auto-85', name: '✓ Auto-approve high confidence (≥85%) - Recommended' },
      { value: 'auto-90', name: '✓ Auto-approve very high confidence (≥90%) - Conservative' },
      { value: 'all', name: '✓ Approve all discovered patterns - Trust the scan' },
      { value: 'skip', name: '○ Skip - Review manually with `drift approve all`' },
    ],
  });

  if (choice === 'skip') {
    printSkip('Skipping approval. Review with `drift approve all` or `drift dashboard`.');
    state.choices.autoApprove = false;
    return { approved: 0, threshold: 0 };
  }

  const threshold = choice === 'auto-90' ? 0.90 : choice === 'auto-85' ? 0.85 : 0;
  state.choices.autoApprove = true;
  state.choices.approveThreshold = threshold;

  const spinner = createSpinner('Approving patterns...');
  spinner.start();

  try {
    const service = createCLIPatternService(rootDir);
    const discovered = await service.listByStatus('discovered', { limit: 5000 });
    const eligible = choice === 'all'
      ? discovered.items
      : discovered.items.filter(p => p.confidence >= threshold);

    let approved = 0;
    for (const pattern of eligible) {
      try {
        await service.approvePattern(pattern.id);
        approved++;
      } catch { /* skip */ }
    }

    spinner.succeed(`Approved ${chalk.cyan(approved)} patterns`);

    const remaining = discovered.items.length - approved;
    if (remaining > 0 && choice !== 'all') {
      printInfo(`${remaining} patterns below threshold - review with \`drift approve all\``);
    }

    state.completed.push('approval');
    return { approved, threshold };
  } catch {
    spinner.fail('Approval failed');
    return { approved: 0, threshold };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: DEEP ANALYSIS (using runners)
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDeepAnalysis(
  rootDir: string,
  autoYes: boolean,
  verbose: boolean,
  state: SetupState
): Promise<AnalysisResults> {
  printPhase(4, 'Deep Analysis', 'Build advanced analysis features');

  console.log(chalk.gray('  These features provide deeper insights into your codebase.'));
  console.log(chalk.gray('  Each runs REAL analysis using native Rust or TypeScript.'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const results: AnalysisResults = {};

  // Call Graph
  const callGraphRunner = new CallGraphRunner(ctx);
  printFeature(callGraphRunner);
  state.choices.buildCallGraph = autoYes || await confirm({ message: 'Build call graph?', default: true });

  if (state.choices.buildCallGraph) {
    results.callGraph = await callGraphRunner.run();
    state.completed.push('callgraph');
  } else {
    printSkip(`Run \`${callGraphRunner.manualCommand}\` later`);
  }

  // Test Topology
  const testTopologyRunner = new TestTopologyRunner(ctx);
  printFeature(testTopologyRunner);
  state.choices.buildTestTopology = autoYes || await confirm({ message: 'Build test topology?', default: true });

  if (state.choices.buildTestTopology) {
    results.testTopology = await testTopologyRunner.run();
    state.completed.push('test-topology');
  } else {
    printSkip(`Run \`${testTopologyRunner.manualCommand}\` later`);
  }

  // Coupling
  const couplingRunner = new CouplingRunner(ctx);
  printFeature(couplingRunner);
  state.choices.buildCoupling = autoYes || await confirm({ message: 'Build coupling analysis?', default: true });

  if (state.choices.buildCoupling) {
    results.coupling = await couplingRunner.run();
    state.completed.push('coupling');
  } else {
    printSkip(`Run \`${couplingRunner.manualCommand}\` later`);
  }

  // DNA
  const dnaRunner = new DNARunner(ctx);
  printFeature(dnaRunner);
  state.choices.scanDna = autoYes || await confirm({ message: 'Scan styling DNA?', default: true });

  if (state.choices.scanDna) {
    results.dna = await dnaRunner.run();
    state.completed.push('dna');
  } else {
    printSkip(`Run \`${dnaRunner.manualCommand}\` later`);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: MEMORY
// ═══════════════════════════════════════════════════════════════════════════

async function phaseMemory(
  rootDir: string,
  autoYes: boolean,
  verbose: boolean,
  state: SetupState
): Promise<AnalysisResults['memory']> {
  printPhase(5, 'Cortex Memory', 'Living knowledge system');

  console.log(chalk.gray('  Cortex Memory replaces static AGENTS.md/CLAUDE.md files.'));
  console.log(chalk.gray('  It\'s a living system that learns and adapts.'));
  console.log();

  const ctx: RunnerContext = { rootDir, verbose };
  const memoryRunner = new MemoryRunner(ctx);
  printFeature(memoryRunner);

  console.log(chalk.gray('  Examples:'));
  console.log(chalk.gray('    • "Always use bcrypt for password hashing"'));
  console.log(chalk.gray('    • "Deploy process: 1. Run tests 2. Build 3. Push"'));
  console.log(chalk.gray('    • Corrections AI learns from your feedback'));
  console.log();

  state.choices.initMemory = autoYes || await confirm({ message: 'Initialize Cortex memory system?', default: true });

  if (state.choices.initMemory) {
    const result = await memoryRunner.run();
    state.completed.push('memory');
    printInfo('Add memories: `drift memory add tribal "your knowledge"`');
    return result;
  } else {
    printSkip(`Run \`${memoryRunner.manualCommand}\` later`);
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: FINALIZE
// ═══════════════════════════════════════════════════════════════════════════

async function phaseFinalize(
  rootDir: string,
  projectId: string,
  scanResult: ScanResult,
  approvalResult: ApprovalResult,
  analysisResults: AnalysisResults,
  state: SetupState
): Promise<SourceOfTruth> {
  printPhase(6, 'Finalize', 'Creating Source of Truth');

  const spinner = createSpinner('Creating Source of Truth...');
  spinner.start();

  const now = new Date().toISOString();
  const scanId = crypto.randomUUID().slice(0, 8);

  // Build feature configs from results
  const buildFeatureConfig = (
    enabled: boolean,
    result?: { success: boolean; timestamp?: string; stats?: Record<string, number> }
  ): FeatureConfig => {
    if (!enabled || !result) {
      return { enabled };
    }
    const config: FeatureConfig = { enabled };
    if (result.timestamp) {
      config.builtAt = result.timestamp;
    }
    if (result.stats) {
      config.stats = result.stats;
    }
    return config;
  };

  const sot: SourceOfTruth = {
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    project: {
      id: projectId,
      name: path.basename(rootDir),
      rootPath: rootDir,
    },
    baseline: {
      scanId,
      scannedAt: now,
      fileCount: await countSourceFiles(rootDir),
      patternCount: scanResult.patternCount,
      approvedCount: approvalResult.approved,
      categories: scanResult.categories,
      checksum: computeChecksum({
        patterns: scanResult.patternCount,
        categories: scanResult.categories,
        approved: approvalResult.approved,
      }),
    },
    features: {
      callGraph: buildFeatureConfig(state.choices.buildCallGraph, analysisResults.callGraph),
      testTopology: buildFeatureConfig(state.choices.buildTestTopology, analysisResults.testTopology),
      coupling: buildFeatureConfig(state.choices.buildCoupling, analysisResults.coupling),
      dna: buildFeatureConfig(state.choices.scanDna, analysisResults.dna),
      memory: buildFeatureConfig(state.choices.initMemory, analysisResults.memory),
    },
    settings: {
      autoApproveThreshold: state.choices.approveThreshold,
      autoApproveEnabled: state.choices.autoApprove,
    },
    history: [
      {
        action: 'setup_complete',
        timestamp: now,
        details: `Initial setup: ${scanResult.patternCount} patterns, ${approvalResult.approved} approved`,
      },
    ],
  };

  await saveSourceOfTruth(rootDir, sot);
  await clearSetupState(rootDir);

  // Update manifest
  const manifestPath = path.join(rootDir, DRIFT_DIR, 'manifest.json');
  const manifest = {
    version: SCHEMA_VERSION,
    driftVersion: VERSION,
    lastUpdatedAt: now,
    sourceOfTruthId: scanId,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Pre-compute views
  const viewsDir = path.join(rootDir, DRIFT_DIR, 'views');
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.writeFile(
    path.join(viewsDir, 'status.json'),
    JSON.stringify({
      lastUpdated: now,
      patterns: {
        total: scanResult.patternCount,
        byStatus: {
          discovered: scanResult.patternCount - approvalResult.approved,
          approved: approvalResult.approved,
          ignored: 0,
        },
        byCategory: scanResult.categories,
      },
    }, null, 2)
  );

  spinner.succeed('Source of Truth created');

  return sot;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SETUP ACTION
// ═══════════════════════════════════════════════════════════════════════════

async function setupAction(options: SetupOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;
  const autoYes = options.yes ?? false;

  printWelcome();

  let state = createDefaultState();

  // Check for resume
  if (options.resume) {
    const savedState = await loadSetupState(rootDir);
    if (savedState) {
      console.log(chalk.yellow('  Resuming previous setup...'));
      state = savedState;
    }
  }

  // Phase 0: Detect existing
  const { isNew, sot: existingSot, shouldContinue } = await phaseDetectExisting(rootDir, autoYes);
  if (!shouldContinue) {
    console.log(chalk.gray('  Setup cancelled.'));
    return;
  }

  // If using existing SOT, just show summary
  if (existingSot && !isNew) {
    printSummary(existingSot);
    return;
  }

  // Phase 1: Initialize
  const projectId = await phaseInitialize(rootDir, isNew);
  state.phase = 1;
  await saveSetupState(rootDir, state);

  // Phase 2: Scan
  const scanResult = await phaseScan(rootDir, autoYes, verbose, state);
  state.phase = 2;
  await saveSetupState(rootDir, state);

  // Phase 3: Approval
  const approvalResult = await phaseApproval(rootDir, autoYes, scanResult.patternCount, state);
  state.phase = 3;
  await saveSetupState(rootDir, state);

  // Phase 4: Deep Analysis
  const analysisResults = await phaseDeepAnalysis(rootDir, autoYes, verbose, state);
  state.phase = 4;
  await saveSetupState(rootDir, state);

  // Phase 5: Memory
  const memoryResult = await phaseMemory(rootDir, autoYes, verbose, state);
  if (memoryResult) {
    analysisResults.memory = memoryResult;
  }
  state.phase = 5;
  await saveSetupState(rootDir, state);

  // Phase 6: Finalize
  const sot = await phaseFinalize(rootDir, projectId, scanResult, approvalResult, analysisResults, state);

  // Summary
  printSummary(sot);
}

export const setupCommand = new Command('setup')
  .description('Guided setup wizard - create your codebase Source of Truth')
  .option('-y, --yes', 'Skip prompts and use recommended defaults')
  .option('--verbose', 'Enable verbose output')
  .option('--resume', 'Resume interrupted setup')
  .action(setupAction);
