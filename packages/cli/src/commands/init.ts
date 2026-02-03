/**
 * Init Command - drift init
 *
 * Initialize Drift in a project by creating the .drift/ directory
 * and running an initial scan.
 *
 * @requirements 29.1, 38.1
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { getProjectRegistry, generateInstallationId, type TelemetryConfig } from 'driftdetect-core';
import { createPatternStore, type PatternStoreInterface } from 'driftdetect-core/storage';

import { promptInitOptions, confirmPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

export interface InitOptions {
  /** Initialize from Cheatcode2026 scaffold */
  fromScaffold?: boolean;
  /** Skip interactive prompts */
  yes?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Subdirectories to create */
const DRIFT_SUBDIRS = [
  'patterns/discovered',
  'patterns/approved',
  'patterns/ignored',
  'patterns/variants',
  'history',
  'cache',
  'reports',
];

/**
 * Check if drift is already initialized
 */
async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the .drift directory structure
 */
async function createDriftDirectory(rootDir: string, verbose: boolean): Promise<void> {
  const driftDir = path.join(rootDir, DRIFT_DIR);

  // Create main .drift directory
  await fs.mkdir(driftDir, { recursive: true });

  // Create subdirectories
  for (const subdir of DRIFT_SUBDIRS) {
    const subdirPath = path.join(driftDir, subdir);
    await fs.mkdir(subdirPath, { recursive: true });
    if (verbose) {
      status.info(`Created ${path.relative(rootDir, subdirPath)}`);
    }
  }

  // Create default config file with project metadata
  const configPath = path.join(driftDir, 'config.json');
  const projectId = crypto.randomUUID();
  const projectName = path.basename(rootDir);
  const now = new Date().toISOString();
  
  const defaultConfig = {
    version: '2.0.0',
    project: {
      id: projectId,
      name: projectName,
      initializedAt: now,
    },
    severity: {},
    ignore: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.git/**',
      'coverage/**',
      '*.min.js',
      '*.bundle.js',
      'vendor/**',
      '__pycache__/**',
      '.venv/**',
      'target/**',
      'bin/**',
      'obj/**',
    ],
    ci: {
      failOn: 'error',
      reportFormat: 'text',
    },
    learning: {
      autoApproveThreshold: 0.95,
      minOccurrences: 3,
      semanticLearning: true,
    },
    performance: {
      maxWorkers: 4,
      cacheEnabled: true,
      incrementalAnalysis: true,
      cacheTTL: 3600,
    },
    features: {
      callGraph: true,
      boundaries: true,
      dna: true,
      contracts: true,
    },
  };

  await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  if (verbose) {
    status.info(`Created ${path.relative(rootDir, configPath)}`);
  }

  // Create .driftignore file
  const driftignorePath = path.join(rootDir, '.driftignore');
  const driftignoreContent = `# Drift ignore patterns
# Add files and directories to ignore during scanning

# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
out/
.next/

# Test coverage
coverage/

# IDE and editor files
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Temporary files
tmp/
temp/
`;

  try {
    await fs.access(driftignorePath);
    // File exists, don't overwrite
  } catch {
    await fs.writeFile(driftignorePath, driftignoreContent);
    if (verbose) {
      status.info(`Created .driftignore`);
    }
  }
}

/**
 * Detect Cheatcode2026 scaffold markers
 */
async function detectCheatcode2026(rootDir: string): Promise<boolean> {
  // Check for common Cheatcode2026 markers
  const markers = [
    '2026cheatcode/scaffolding/00-MANIFEST.md',
    'apps/web/lib/resilience',
    'packages/backend/src',
  ];

  for (const marker of markers) {
    try {
      await fs.access(path.join(rootDir, marker));
      return true;
    } catch {
      // Continue checking other markers
    }
  }

  return false;
}

/**
 * Load Cheatcode2026 presets
 */
async function loadCheatcode2026Presets(
  store: PatternStoreInterface,
  verbose: boolean
): Promise<number> {
  // Cheatcode2026 enterprise patterns to auto-approve
  const cheatcodePatterns = [
    { id: 'cc2026-exception-taxonomy', name: 'Exception Taxonomy', category: 'errors' },
    { id: 'cc2026-circuit-breaker', name: 'Circuit Breaker Pattern', category: 'errors' },
    { id: 'cc2026-auth-middleware', name: 'Auth Middleware', category: 'auth' },
    { id: 'cc2026-structured-logging', name: 'Structured Logging', category: 'logging' },
    { id: 'cc2026-design-tokens', name: 'Design Tokens', category: 'styling' },
    { id: 'cc2026-job-state-machine', name: 'Job State Machine', category: 'data-access' },
    { id: 'cc2026-response-helpers', name: 'Response Helpers', category: 'api' },
    { id: 'cc2026-input-sanitization', name: 'Input Sanitization', category: 'security' },
    { id: 'cc2026-csp-headers', name: 'CSP Headers', category: 'security' },
    { id: 'cc2026-rate-limiting', name: 'Rate Limiting', category: 'security' },
    { id: 'cc2026-env-validation', name: 'Environment Validation', category: 'config' },
    { id: 'cc2026-feature-flags', name: 'Feature Flags', category: 'config' },
    { id: 'cc2026-test-structure', name: 'Test Structure (AAA)', category: 'testing' },
    { id: 'cc2026-api-routes', name: 'API Route Structure', category: 'api' },
    { id: 'cc2026-error-responses', name: 'Error Response Format', category: 'api' },
    { id: 'cc2026-rbac', name: 'Role-Based Access Control', category: 'auth' },
    { id: 'cc2026-correlation-ids', name: 'Correlation IDs', category: 'logging' },
    { id: 'cc2026-health-checks', name: 'Health Check Patterns', category: 'logging' },
  ];

  let loadedCount = 0;

  for (const preset of cheatcodePatterns) {
    // Create a pattern entry for each preset
    const now = new Date().toISOString();
    const pattern = {
      id: preset.id,
      category: preset.category as import('driftdetect-core').PatternCategory,
      subcategory: 'cheatcode2026',
      name: preset.name,
      description: `Cheatcode2026 enterprise pattern: ${preset.name}`,
      detector: {
        type: 'custom' as const,
        config: { source: 'cheatcode2026' },
      },
      confidence: {
        frequency: 1.0,
        consistency: 1.0,
        age: 0,
        spread: 1,
        score: 1.0,
        level: 'high' as const,
      },
      locations: [],
      outliers: [],
      metadata: {
        firstSeen: now,
        lastSeen: now,
        approvedAt: now,
        source: 'cheatcode2026',
        tags: ['cheatcode2026', 'enterprise', 'preset'],
      },
      severity: 'warning' as const,
      autoFixable: false,
      status: 'approved' as const,
    };

    try {
      store.add(pattern);
      loadedCount++;
      if (verbose) {
        status.info(`Loaded preset: ${preset.name}`);
      }
    } catch {
      // Pattern might already exist
      if (verbose) {
        status.warning(`Skipped existing preset: ${preset.name}`);
      }
    }
  }

  return loadedCount;
}

/**
 * Init command implementation
 */
async function initAction(options: InitOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🔍 Drift - Architectural Drift Detection'));
  console.log();

  // Check if already initialized
  if (await isDriftInitialized(rootDir)) {
    if (!options.yes) {
      const overwrite = await confirmPrompt(
        'Drift is already initialized. Reinitialize?',
        false
      );
      if (!overwrite) {
        status.info('Initialization cancelled');
        return;
      }
    }
  }

  // Create directory structure
  const spinner = createSpinner('Creating .drift directory structure...');
  spinner.start();

  try {
    await createDriftDirectory(rootDir, verbose);
    spinner.succeed('Created .drift directory structure');
  } catch (error) {
    spinner.fail('Failed to create .drift directory');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Initialize pattern store (Phase 3: SQLite is default for new projects)
  const store = await createPatternStore({ rootDir });

  // Handle Cheatcode2026 scaffold
  let isCheatcode = false;
  if (options.fromScaffold) {
    isCheatcode = true;
  } else {
    // Auto-detect Cheatcode2026
    isCheatcode = await detectCheatcode2026(rootDir);
    if (isCheatcode && !options.yes) {
      const usePresets = await confirmPrompt(
        'Cheatcode2026 scaffold detected. Load enterprise presets?',
        true
      );
      isCheatcode = usePresets;
    }
  }

  if (isCheatcode) {
    const presetSpinner = createSpinner('Loading Cheatcode2026 presets...');
    presetSpinner.start();

    try {
      const count = await loadCheatcode2026Presets(store, verbose);
      await store.saveAll();
      presetSpinner.succeed(`Loaded ${count} Cheatcode2026 enterprise patterns`);
    } catch (error) {
      presetSpinner.fail('Failed to load presets');
      console.error(chalk.red((error as Error).message));
    }
  }

  // Get init options
  let initOpts = { scanNow: true, autoApprove: false };
  if (!options.yes) {
    initOpts = await promptInitOptions();
  }

  // Guide user to next steps
  console.log();
  if (initOpts.scanNow) {
    if (initOpts.autoApprove) {
      console.log(chalk.gray('To scan and auto-approve high-confidence patterns:'));
      console.log(chalk.cyan('  drift scan'));
      console.log(chalk.cyan('  drift approve --auto'));
      console.log();
      console.log(chalk.gray('Or use the guided setup wizard:'));
      console.log(chalk.cyan('  drift setup'));
    } else {
      console.log(chalk.gray('To run an initial scan, use:'));
      console.log(chalk.cyan('  drift scan'));
      console.log();
      console.log(chalk.gray('Or use the guided setup wizard (recommended):'));
      console.log(chalk.cyan('  drift setup'));
    }
    console.log();
    console.log(chalk.gray('To check for violations:'));
    console.log(chalk.cyan('  drift check'));
  } else {
    console.log(chalk.gray('When ready, use the guided setup wizard:'));
    console.log(chalk.cyan('  drift setup'));
  }

  // Summary
  console.log();
  status.success('Drift initialized successfully!');
  console.log();
  console.log(chalk.gray('Configuration: .drift/config.json'));
  console.log(chalk.gray('Patterns: .drift/patterns/'));
  console.log(chalk.gray('Ignore rules: .driftignore'));
  console.log();
  
  // Suggest .gitignore additions
  console.log(chalk.bold('📝 Add to your .gitignore:'));
  console.log();
  console.log(chalk.gray('  # Drift: ignore caches and temporary data'));
  console.log(chalk.gray('  .drift/lake/'));
  console.log(chalk.gray('  .drift/cache/'));
  console.log(chalk.gray('  .drift/history/'));
  console.log(chalk.gray('  .drift/call-graph/'));
  console.log(chalk.gray('  .drift/patterns/discovered/'));
  console.log(chalk.gray('  .drift/patterns/ignored/'));
  console.log(chalk.gray('  .drift/patterns/variants/'));
  console.log(chalk.gray('  .drift/constraints/discovered/'));
  console.log(chalk.gray('  .drift/constraints/ignored/'));
  console.log(chalk.gray('  .drift/contracts/discovered/'));
  console.log(chalk.gray('  .drift/contracts/ignored/'));
  console.log(chalk.gray('  .drift/contracts/mismatch/'));
  console.log(chalk.gray('  .drift/**/.backups/'));
  console.log();

  // Register project in global registry
  const registrySpinner = createSpinner('Registering project...');
  registrySpinner.start();

  try {
    const registry = await getProjectRegistry();
    const project = await registry.register(rootDir);
    await registry.setActive(project.id);
    registrySpinner.succeed(`Registered as ${chalk.cyan(project.name)}`);
    
    if (verbose) {
      console.log(chalk.gray(`  ID: ${project.id}`));
      console.log(chalk.gray(`  Language: ${project.language}`));
      console.log(chalk.gray(`  Framework: ${project.framework}`));
    }
    
    console.log();
    console.log(chalk.gray('Manage projects with:'));
    console.log(chalk.cyan('  drift projects list'));
    console.log();
  } catch (error) {
    registrySpinner.warn('Could not register project in global registry');
    if (verbose) {
      console.error(chalk.gray((error as Error).message));
    }
  }

  // Telemetry opt-in prompt (only on interactive init)
  if (!options.yes) {
    console.log();
    console.log(chalk.bold('📊 Help Improve Drift'));
    console.log();
    console.log(chalk.gray('  Drift can collect anonymized telemetry to improve pattern detection.'));
    console.log(chalk.gray('  • No source code is ever sent'));
    console.log(chalk.gray('  • Only pattern signatures and aggregate statistics'));
    console.log(chalk.gray('  • You can change this anytime with `drift telemetry`'));
    console.log();

    const enableTelemetry = await confirmPrompt(
      'Enable telemetry to help improve Drift?',
      false
    );

    if (enableTelemetry) {
      try {
        const configPath = path.join(rootDir, DRIFT_DIR, 'config.json');
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        const telemetryConfig: TelemetryConfig = {
          enabled: true,
          sharePatternSignatures: true,
          shareAggregateStats: true,
          shareUserActions: false,
          installationId: generateInstallationId(),
          enabledAt: new Date().toISOString(),
        };

        config.telemetry = telemetryConfig;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        status.success('Telemetry enabled - thank you! 🙏');
        console.log(chalk.gray('  Run `drift telemetry setup` to customize settings'));
      } catch (error) {
        if (verbose) {
          console.error(chalk.gray(`Could not enable telemetry: ${(error as Error).message}`));
        }
      }
    } else {
      console.log(chalk.gray('  No problem! You can enable it later with `drift telemetry enable`'));
    }
    console.log();
  }
}

export const initCommand = new Command('init')
  .description('Initialize Drift in the current directory')
  .option('--from-scaffold', 'Initialize with Cheatcode2026 presets')
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option('--verbose', 'Enable verbose output')
  .action(initAction);
