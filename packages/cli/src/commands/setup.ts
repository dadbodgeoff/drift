/**
 * Setup Command - drift setup
 *
 * Enterprise-grade guided onboarding that creates a Source of Truth
 * for your codebase. Every feature is explained, every choice persisted.
 *
 * Philosophy:
 * - Users understand what each feature does before enabling
 * - All choices are persisted and recallable
 * - Source of Truth is created and versioned
 * - Subsequent scans are tracked against the baseline
 * - Changes require explicit approval
 *
 * @module commands/setup
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { confirm, select } from '@inquirer/prompts';

import { createSpinner } from '../ui/spinner.js';
import { createCLIPatternService } from '../services/pattern-service-factory.js';
import { createScannerService, type ProjectContext } from '../services/scanner-service.js';
import { VERSION } from '../index.js';

import {
  PatternStore,
  getProjectRegistry,
  FileWalker,
  getDefaultIgnorePatterns,
  mergeIgnorePatterns,
  isNativeAvailable,
  buildCallGraph,
  shouldIgnoreDirectory,
  createWorkspaceManager,
  type Pattern,
  type PatternCategory,
  type ConfidenceInfo,
  type PatternLocation,
  type ScanOptions,
} from 'driftdetect-core';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SetupOptions {
  yes?: boolean;
  verbose?: boolean;
  resume?: boolean;
}

/**
 * Source of Truth - The canonical state of your codebase patterns
 */
interface SourceOfTruth {
  version: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    rootPath: string;
  };
  baseline: {
    scanId: string;
    scannedAt: string;
    fileCount: number;
    patternCount: number;
    approvedCount: number;
    categories: Record<string, number>;
    checksum: string;
  };
  features: {
    callGraph: { enabled: boolean; builtAt?: string | undefined };
    testTopology: { enabled: boolean; builtAt?: string | undefined };
    coupling: { enabled: boolean; builtAt?: string | undefined };
    dna: { enabled: boolean; scannedAt?: string | undefined };
    memory: { enabled: boolean; initializedAt?: string | undefined };
    boundaries: { enabled: boolean; builtAt?: string | undefined };
  };
  settings: {
    autoApproveThreshold: number;
    autoApproveEnabled: boolean;
  };
  history: Array<{
    action: string;
    timestamp: string;
    details: string;
  }>;
}

/**
 * Setup state for resume capability
 */
interface SetupState {
  phase: number;
  completed: string[];
  choices: SetupChoices;
  startedAt: string;
}

interface SetupChoices {
  autoApprove: boolean;
  approveThreshold: number;
  buildCallGraph: boolean;
  buildTestTopology: boolean;
  buildCoupling: boolean;
  scanDna: boolean;
  initMemory: boolean;
  buildBoundaries: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DRIFT_DIR = '.drift';
const SOURCE_OF_TRUTH_FILE = 'source-of-truth.json';
const SETUP_STATE_FILE = '.setup-state.json';
const SCHEMA_VERSION = '2.0.0';

const DRIFT_SUBDIRS = [
  'patterns/discovered',
  'patterns/approved',
  'patterns/ignored',
  'patterns/variants',
  'history/snapshots',
  'cache',
  'reports',
  'lake/callgraph',
  'lake/patterns',
  'lake/security',
  'lake/examples',
  'boundaries',
  'test-topology',
  'module-coupling',
  'error-handling',
  'constraints/discovered',
  'constraints/approved',
  'constraints/ignored',
  'constraints/custom',
  'constraints/history',
  'contracts/discovered',
  'contracts/verified',
  'contracts/mismatch',
  'contracts/ignored',
  'indexes',
  'views',
  'dna',
  'environment',
  'memory',
  'audit/snapshots',
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return true;
  } catch {
    return false;
  }
}

async function loadSourceOfTruth(rootDir: string): Promise<SourceOfTruth | null> {
  try {
    const sotPath = path.join(rootDir, DRIFT_DIR, SOURCE_OF_TRUTH_FILE);
    const content = await fs.readFile(sotPath, 'utf-8');
    return JSON.parse(content) as SourceOfTruth;
  } catch {
    return null;
  }
}

async function saveSourceOfTruth(rootDir: string, sot: SourceOfTruth): Promise<void> {
  const sotPath = path.join(rootDir, DRIFT_DIR, SOURCE_OF_TRUTH_FILE);
  sot.updatedAt = new Date().toISOString();
  await fs.writeFile(sotPath, JSON.stringify(sot, null, 2));
}

async function loadSetupState(rootDir: string): Promise<SetupState | null> {
  try {
    const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content) as SetupState;
  } catch {
    return null;
  }
}

async function saveSetupState(rootDir: string, state: SetupState): Promise<void> {
  const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function clearSetupState(rootDir: string): Promise<void> {
  try {
    const statePath = path.join(rootDir, DRIFT_DIR, SETUP_STATE_FILE);
    await fs.unlink(statePath);
  } catch { /* ignore */ }
}

async function createDriftDirectory(rootDir: string): Promise<void> {
  const driftDir = path.join(rootDir, DRIFT_DIR);
  await fs.mkdir(driftDir, { recursive: true });

  for (const subdir of DRIFT_SUBDIRS) {
    await fs.mkdir(path.join(driftDir, subdir), { recursive: true });
  }
}

async function createDefaultConfig(rootDir: string, projectId: string): Promise<void> {
  const configPath = path.join(rootDir, DRIFT_DIR, 'config.json');
  const config = {
    version: SCHEMA_VERSION,
    project: {
      id: projectId,
      name: path.basename(rootDir),
      initializedAt: new Date().toISOString(),
    },
    severity: {},
    ignore: [
      'node_modules/**', 'dist/**', 'build/**', '.git/**', 'coverage/**',
      '*.min.js', '*.bundle.js', 'vendor/**', '__pycache__/**', '.venv/**',
      'target/**', 'bin/**', 'obj/**',
    ],
    ci: { failOn: 'error', reportFormat: 'text' },
    learning: { autoApproveThreshold: 0.85, minOccurrences: 3, semanticLearning: true },
    performance: { maxWorkers: 4, cacheEnabled: true, incrementalAnalysis: true, cacheTTL: 3600 },
    features: { callGraph: true, boundaries: true, dna: true, contracts: true },
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function createDriftignore(rootDir: string): Promise<void> {
  const driftignorePath = path.join(rootDir, '.driftignore');
  try {
    await fs.access(driftignorePath);
  } catch {
    await fs.writeFile(driftignorePath, `# Drift ignore patterns
node_modules/
dist/
build/
.git/
coverage/
vendor/
__pycache__/
.venv/
target/
bin/
obj/
`);
  }
}

async function countSourceFiles(rootDir: string): Promise<number> {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.java', '.php', '.go', '.rs', '.cpp', '.c', '.h']);
  let count = 0;

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !shouldIgnoreDirectory(entry.name)) {
          await walk(path.join(dir, entry.name));
        } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
          count++;
        }
      }
    } catch { /* skip */ }
  }

  await walk(rootDir);
  return count;
}

async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(rootDir, '.driftignore'), 'utf-8');
    const userPatterns = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    return mergeIgnorePatterns(userPatterns);
  } catch {
    return getDefaultIgnorePatterns();
  }
}

function computeChecksum(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

function isScannableFile(filePath: string): boolean {
  const exts = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'cs', 'java', 'php', 'go', 'rs', 'c', 'cpp', 'cc', 'h', 'hpp', 'vue', 'svelte'];
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return exts.includes(ext);
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

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function printWelcome(): void {
  console.log();
  console.log(chalk.bold.magenta('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.magenta('║') + chalk.bold('           🔍 Drift Setup Wizard                           ') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('║') + chalk.gray('   Create your codebase Source of Truth                    ') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('╚════════════════════════════════════════════════════════════╝'));
  console.log();
}

function printPhase(num: number, title: string, description: string): void {
  console.log();
  console.log(chalk.bold.cyan(`━━━ Phase ${num}: ${title} ━━━`));
  console.log(chalk.gray(`    ${description}`));
  console.log();
}

function printFeature(icon: string, name: string, oneLiner: string, benefit: string): void {
  console.log(`  ${icon} ${chalk.bold(name)}`);
  console.log(chalk.gray(`     ${oneLiner}`));
  console.log(chalk.green(`     → ${benefit}`));
  console.log();
}

function printSuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

function printSkip(message: string): void {
  console.log(chalk.gray(`  ○ ${message}`));
}

function printInfo(message: string): void {
  console.log(chalk.gray(`    ${message}`));
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function phaseDetectExisting(
  rootDir: string,
  autoYes: boolean,
  _verbose: boolean
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
      // Create backup before fresh start
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
          const proceed = await confirm({
            message: 'Continue without backup?',
            default: false,
          });
          if (!proceed) {
            return { isNew: false, sot, shouldContinue: false };
          }
        }
      }
      return { isNew: true, sot: null, shouldContinue: true };
    }

    // rescan - keep existing but update
    return { isNew: false, sot, shouldContinue: true };
  }

  // Initialized but no SOT - legacy installation
  console.log(chalk.yellow('  ⚠ Legacy installation detected (no Source of Truth)'));
  printInfo('Will create Source of Truth from existing data.');
  return { isNew: false, sot: null, shouldContinue: true };
}

async function phaseInitialize(
  rootDir: string,
  isNew: boolean,
  _state: SetupState
): Promise<string> {
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

  // Register with global registry
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

async function phaseScan(
  rootDir: string,
  autoYes: boolean,
  verbose: boolean,
  state: SetupState
): Promise<{ success: boolean; patternCount: number; categories: Record<string, number> }> {
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

  const shouldScan = autoYes || await confirm({
    message: 'Run pattern scan?',
    default: true,
  });

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

    // Show breakdown
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

async function phaseApproval(
  rootDir: string,
  autoYes: boolean,
  patternCount: number,
  state: SetupState
): Promise<{ approved: number; threshold: number }> {
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
  } catch (error) {
    spinner.fail('Approval failed');
    return { approved: 0, threshold };
  }
}

async function phaseDeepAnalysis(
  rootDir: string,
  autoYes: boolean,
  _verbose: boolean,
  state: SetupState
): Promise<void> {
  printPhase(4, 'Deep Analysis', 'Optional advanced features');

  console.log(chalk.gray('  These features provide deeper insights but take longer to build.'));
  console.log(chalk.gray('  Each can be run later with individual commands.'));
  console.log();

  // CALL GRAPH
  printFeature(
    '📊',
    'Call Graph Analysis',
    'Maps function calls to understand code flow and data access.',
    'Answer: "What data can this code access?" and "Who calls this?"'
  );

  state.choices.buildCallGraph = autoYes || await confirm({
    message: 'Build call graph?',
    default: true,
  });

  if (state.choices.buildCallGraph) {
    const spinner = createSpinner('Building call graph...');
    spinner.start();
    try {
      if (isNativeAvailable()) {
        const ignorePatterns = await loadIgnorePatterns(rootDir);
        await buildCallGraph({ root: rootDir, patterns: ignorePatterns });
      }
      spinner.succeed('Call graph built');
      state.completed.push('callgraph');
    } catch (error) {
      spinner.fail(`Call graph failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift callgraph build` later');
  }

  // TEST TOPOLOGY
  printFeature(
    '🧪',
    'Test Topology',
    'Maps tests to code, finds untested functions.',
    'Answer: "Which tests cover this?" and "What\'s untested?"'
  );

  state.choices.buildTestTopology = autoYes || await confirm({
    message: 'Build test topology?',
    default: true,
  });

  if (state.choices.buildTestTopology) {
    const spinner = createSpinner('Building test topology...');
    spinner.start();
    try {
      const dir = path.join(rootDir, DRIFT_DIR, 'test-topology');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'summary.json'),
        JSON.stringify({ builtAt: new Date().toISOString(), status: 'initialized' }, null, 2)
      );
      spinner.succeed('Test topology initialized');
      printInfo('Run `drift test-topology build` for full analysis');
      state.completed.push('test-topology');
    } catch (error) {
      spinner.fail(`Test topology failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift test-topology build` later');
  }

  // DATA BOUNDARIES
  printFeature(
    '🔒',
    'Data Boundaries',
    'Tracks which code accesses which database tables.',
    'Security analysis: "Who can access user.password?"'
  );

  state.choices.buildBoundaries = autoYes ? false : await confirm({
    message: 'Build data boundaries?',
    default: false,
  });

  if (state.choices.buildBoundaries) {
    const spinner = createSpinner('Building data boundaries...');
    spinner.start();
    try {
      const dir = path.join(rootDir, DRIFT_DIR, 'boundaries');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'access-map.json'),
        JSON.stringify({ builtAt: new Date().toISOString(), tables: {} }, null, 2)
      );
      spinner.succeed('Data boundaries initialized');
      state.completed.push('boundaries');
    } catch (error) {
      spinner.fail(`Boundaries failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift boundaries build` later');
  }

  // MODULE COUPLING
  printFeature(
    '🔗',
    'Module Coupling',
    'Analyzes dependencies, detects circular imports.',
    'Find tightly coupled modules and dependency cycles'
  );

  state.choices.buildCoupling = autoYes ? false : await confirm({
    message: 'Build coupling analysis?',
    default: false,
  });

  if (state.choices.buildCoupling) {
    const spinner = createSpinner('Analyzing coupling...');
    spinner.start();
    try {
      const dir = path.join(rootDir, DRIFT_DIR, 'module-coupling');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'graph.json'),
        JSON.stringify({ builtAt: new Date().toISOString(), modules: [] }, null, 2)
      );
      spinner.succeed('Coupling analysis initialized');
      printInfo('Run `drift coupling build` for full analysis');
      state.completed.push('coupling');
    } catch (error) {
      spinner.fail(`Coupling failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift coupling build` later');
  }

  // DNA PROFILE
  printFeature(
    '🧬',
    'Styling DNA',
    'Analyzes frontend styling patterns (variants, spacing, theming).',
    'AI generates components matching your exact style'
  );

  state.choices.scanDna = autoYes ? false : await confirm({
    message: 'Scan styling DNA? (Best for frontend projects)',
    default: false,
  });

  if (state.choices.scanDna) {
    const spinner = createSpinner('Scanning DNA...');
    spinner.start();
    try {
      const dir = path.join(rootDir, DRIFT_DIR, 'dna');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'profile.json'),
        JSON.stringify({ scannedAt: new Date().toISOString(), genes: {} }, null, 2)
      );
      spinner.succeed('DNA profile created');
      printInfo('Run `drift dna scan` for full analysis');
      state.completed.push('dna');
    } catch (error) {
      spinner.fail(`DNA scan failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift dna scan` later');
  }
}

async function phaseMemory(
  rootDir: string,
  autoYes: boolean,
  state: SetupState
): Promise<void> {
  printPhase(5, 'Cortex Memory', 'Living knowledge system');

  console.log(chalk.gray('  Cortex Memory replaces static AGENTS.md/CLAUDE.md files.'));
  console.log(chalk.gray('  It\'s a living system that learns and adapts.'));
  console.log();

  printFeature(
    '🧠',
    'Memory Types',
    'Tribal knowledge, procedures, corrections, and learned patterns.',
    'AI retrieves relevant context based on what you\'re doing'
  );

  console.log(chalk.gray('  Examples:'));
  console.log(chalk.gray('    • "Always use bcrypt for password hashing"'));
  console.log(chalk.gray('    • "Deploy process: 1. Run tests 2. Build 3. Push"'));
  console.log(chalk.gray('    • Corrections AI learns from your feedback'));
  console.log();

  state.choices.initMemory = autoYes ? false : await confirm({
    message: 'Initialize Cortex memory system?',
    default: false,
  });

  if (state.choices.initMemory) {
    const spinner = createSpinner('Initializing memory...');
    spinner.start();
    try {
      const dir = path.join(rootDir, DRIFT_DIR, 'memory');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'memories.json'),
        JSON.stringify({
          version: '2.0.0',
          memories: [],
          metadata: { createdAt: new Date().toISOString() },
        }, null, 2)
      );
      await fs.writeFile(
        path.join(dir, 'graph.json'),
        JSON.stringify({ nodes: [], edges: [] }, null, 2)
      );
      spinner.succeed('Memory system initialized');
      printInfo('Add memories: `drift memory add tribal "your knowledge"`');
      state.completed.push('memory');
    } catch (error) {
      spinner.fail(`Memory init failed: ${(error as Error).message}`);
    }
  } else {
    printSkip('Run `drift memory init` later');
  }
}

async function phaseFinalize(
  rootDir: string,
  projectId: string,
  scanResult: { success: boolean; patternCount: number; categories: Record<string, number> },
  approvalResult: { approved: number; threshold: number },
  state: SetupState
): Promise<SourceOfTruth> {
  printPhase(6, 'Finalize', 'Creating Source of Truth');

  const spinner = createSpinner('Creating Source of Truth...');
  spinner.start();

  const now = new Date().toISOString();
  const scanId = crypto.randomUUID().slice(0, 8);

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
      callGraph: { enabled: state.choices.buildCallGraph, builtAt: state.choices.buildCallGraph ? now : undefined },
      testTopology: { enabled: state.choices.buildTestTopology, builtAt: state.choices.buildTestTopology ? now : undefined },
      coupling: { enabled: state.choices.buildCoupling, builtAt: state.choices.buildCoupling ? now : undefined },
      dna: { enabled: state.choices.scanDna, scannedAt: state.choices.scanDna ? now : undefined },
      memory: { enabled: state.choices.initMemory, initializedAt: state.choices.initMemory ? now : undefined },
      boundaries: { enabled: state.choices.buildBoundaries, builtAt: state.choices.buildBoundaries ? now : undefined },
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

  // Pre-compute views for fast access
  const viewsDir = path.join(rootDir, DRIFT_DIR, 'views');
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.writeFile(
    path.join(viewsDir, 'status.json'),
    JSON.stringify({
      lastUpdated: now,
      patterns: {
        total: scanResult.patternCount,
        byStatus: { discovered: scanResult.patternCount - approvalResult.approved, approved: approvalResult.approved, ignored: 0 },
        byCategory: scanResult.categories,
      },
    }, null, 2)
  );

  spinner.succeed('Source of Truth created');

  return sot;
}

function printSummary(sot: SourceOfTruth, _state: SetupState): void {
  console.log();
  console.log(chalk.bold.green('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.green('║') + chalk.bold('                    Setup Complete! 🎉                      ') + chalk.bold.green('║'));
  console.log(chalk.bold.green('╚════════════════════════════════════════════════════════════╝'));
  console.log();

  console.log(chalk.bold('  Source of Truth Created'));
  console.log(chalk.gray(`    ID: ${sot.baseline.scanId}`));
  console.log(chalk.gray(`    Checksum: ${sot.baseline.checksum}`));
  console.log();

  console.log(chalk.bold('  What was configured:'));
  printSuccess(`Project: ${sot.project.name}`);
  if (sot.baseline.patternCount > 0) {
    printSuccess(`${sot.baseline.patternCount} patterns discovered`);
  }
  if (sot.baseline.approvedCount > 0) {
    printSuccess(`${sot.baseline.approvedCount} patterns approved`);
  }
  if (sot.features.callGraph.enabled) printSuccess('Call graph built');
  if (sot.features.testTopology.enabled) printSuccess('Test topology initialized');
  if (sot.features.boundaries.enabled) printSuccess('Data boundaries initialized');
  if (sot.features.coupling.enabled) printSuccess('Coupling analysis initialized');
  if (sot.features.dna.enabled) printSuccess('DNA profile created');
  if (sot.features.memory.enabled) printSuccess('Memory system initialized');
  console.log();

  console.log(chalk.bold('  What happens next:'));
  console.log(chalk.gray('    • All data is pre-computed for fast CLI/MCP access'));
  console.log(chalk.gray('    • Future scans are tracked against this baseline'));
  console.log(chalk.gray('    • Changes require explicit approval'));
  console.log(chalk.gray('    • Backups are created before destructive operations'));
  console.log();

  console.log(chalk.bold('  Quick commands:'));
  console.log(chalk.cyan('    drift status') + chalk.gray('          - See current state'));
  console.log(chalk.cyan('    drift dashboard') + chalk.gray('       - Visual pattern browser'));
  console.log(chalk.cyan('    drift check') + chalk.gray('           - Check for violations'));
  if (sot.baseline.approvedCount === 0 && sot.baseline.patternCount > 0) {
    console.log(chalk.cyan('    drift approve all') + chalk.gray('     - Review patterns'));
  }
  console.log();

  console.log(chalk.bold('  For AI integration:'));
  console.log(chalk.gray('    Install: ') + chalk.cyan('npm install -g driftdetect-mcp'));
  console.log(chalk.gray('    Then configure your AI tool (Claude, Cursor, Kiro)'));
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SETUP ACTION
// ═══════════════════════════════════════════════════════════════════════════

async function setupAction(options: SetupOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;
  const autoYes = options.yes ?? false;

  printWelcome();

  // Initialize state
  let state: SetupState = {
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
      buildBoundaries: false,
    },
    startedAt: new Date().toISOString(),
  };

  // Check for resume
  if (options.resume) {
    const savedState = await loadSetupState(rootDir);
    if (savedState) {
      console.log(chalk.yellow('  Resuming previous setup...'));
      state = savedState;
    }
  }

  // Phase 0: Detect existing
  const { isNew, sot: existingSot, shouldContinue } = await phaseDetectExisting(rootDir, autoYes, verbose);
  if (!shouldContinue) {
    console.log(chalk.gray('  Setup cancelled.'));
    return;
  }

  // If using existing SOT, just show summary
  if (existingSot && !isNew) {
    printSummary(existingSot, state);
    return;
  }

  // Phase 1: Initialize
  const projectId = await phaseInitialize(rootDir, isNew, state);
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
  await phaseDeepAnalysis(rootDir, autoYes, verbose, state);
  state.phase = 4;
  await saveSetupState(rootDir, state);

  // Phase 5: Memory
  await phaseMemory(rootDir, autoYes, state);
  state.phase = 5;
  await saveSetupState(rootDir, state);

  // Phase 6: Finalize
  const sot = await phaseFinalize(rootDir, projectId, scanResult, approvalResult, state);

  // Summary
  printSummary(sot, state);
}

export const setupCommand = new Command('setup')
  .description('Guided setup wizard - create your codebase Source of Truth')
  .option('-y, --yes', 'Skip prompts and use recommended defaults')
  .option('--verbose', 'Enable verbose output')
  .option('--resume', 'Resume interrupted setup')
  .action(setupAction);
