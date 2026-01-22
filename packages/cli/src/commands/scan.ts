/**
 * Scan Command - drift scan
 *
 * Perform a full codebase scan to discover patterns using
 * enterprise-grade detectors from driftdetect-detectors.
 *
 * @requirements 29.2
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import chalk from 'chalk';
import {
  PatternStore,
  HistoryStore,
  FileWalker,
  createDataLake,
  loadProjectConfig,
  getProjectRegistry,
  type ScanOptions,
  type Pattern,
  type PatternCategory,
  type PatternLocation,
  type ConfidenceInfo,
  type DetectorConfig,
} from 'driftdetect-core';
import { createSpinner, status } from '../ui/spinner.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';
import { createScannerService, type ProjectContext, type AggregatedPattern, type AggregatedViolation } from '../services/scanner-service.js';
import { createContractScanner } from '../services/contract-scanner.js';
import { createBoundaryScanner } from '../services/boundary-scanner.js';

export interface ScanCommandOptions {
  /** Specific paths to scan */
  paths?: string[];
  /** Enable verbose output */
  verbose?: boolean;
  /** Force rescan even if cache is valid */
  force?: boolean;
  /** Only run critical detectors */
  critical?: boolean;
  /** Filter by categories */
  categories?: string[];
  /** Generate manifest with semantic locations */
  manifest?: boolean;
  /** Incremental scan (only changed files) */
  incremental?: boolean;
  /** Skip BE↔FE contract scanning (contracts enabled by default) */
  contracts?: boolean;
  /** Skip data boundary scanning (boundaries enabled by default) */
  boundaries?: boolean;
  /** Scan a specific registered project by name */
  project?: string;
  /** Scan all registered projects */
  allProjects?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/**
 * Check if drift is initialized
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
 * Load ignore patterns from .driftignore
 */
async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  const defaultIgnores = [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '.drift/**',
    '__pycache__/**',
    '.venv/**',
    'venv/**',
  ];

  try {
    const driftignorePath = path.join(rootDir, '.driftignore');
    const content = await fs.readFile(driftignorePath, 'utf-8');
    const patterns = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    return [...defaultIgnores, ...patterns];
  } catch {
    return defaultIgnores;
  }
}

/**
 * Get file extension
 */
function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

/**
 * Check if file is scannable
 */
function isScannableFile(filePath: string): boolean {
  const scannableExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'pyw',
    'cs', // C#
    'java', // Java/Spring Boot
    'php', // PHP/Laravel
    'css', 'scss', 'sass', 'less',
    'json', 'yaml', 'yml',
    'md', 'mdx',
    'html', 'htm',
    'vue', 'svelte',
  ];
  const ext = getExtension(filePath);
  return scannableExtensions.includes(ext);
}

/**
 * Group files by type for reporting
 */
function groupFilesByType(files: string[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const file of files) {
    const ext = getExtension(file) || 'other';
    groups.set(ext, (groups.get(ext) ?? 0) + 1);
  }
  return groups;
}

/**
 * Map detector category to PatternCategory
 */
function mapToPatternCategory(category: string): PatternCategory {
  const mapping: Record<string, PatternCategory> = {
    'api': 'api',
    'auth': 'auth',
    'security': 'security',
    'errors': 'errors',
    'structural': 'structural',
    'components': 'components',
    'styling': 'styling',
    'logging': 'logging',
    'testing': 'testing',
    'data-access': 'data-access',
    'config': 'config',
    'types': 'types',
    'performance': 'performance',
    'accessibility': 'accessibility',
    'documentation': 'documentation',
  };
  return mapping[category] || 'structural';
}

/**
 * Convert aggregated pattern to Pattern for storage
 */
function convertToPattern(
  aggPattern: AggregatedPattern,
  violations: AggregatedViolation[],
  rootDir: string,
  isFirstPatternForDetector: boolean
): Pattern {
  const now = new Date().toISOString();
  
  // Generate unique ID
  const id = crypto.createHash('sha256')
    .update(`${aggPattern.patternId}-${rootDir}`)
    .digest('hex')
    .slice(0, 16);

  // Calculate confidence
  const spread = new Set(aggPattern.locations.map(l => l.file)).size;
  const confidenceScore = Math.min(0.95, aggPattern.confidence);
  const confidenceInfo: ConfidenceInfo = {
    frequency: Math.min(1, aggPattern.occurrences / 100),
    consistency: 0.9,
    age: 0,
    spread,
    score: confidenceScore,
    level: confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : confidenceScore >= 0.45 ? 'low' : 'uncertain',
  };

  // Create detector config
  const detectorConfig: DetectorConfig = {
    type: 'regex', // Most detectors are regex-based
    config: { 
      detectorId: aggPattern.detectorId,
      patternId: aggPattern.patternId,
    },
  };

  // Only attach violations to the FIRST pattern for each detector
  // This prevents the same violations from appearing multiple times
  let outliers: Array<{
    file: string;
    line: number;
    column: number;
    reason: string;
    deviationScore: number;
  }> = [];
  
  if (isFirstPatternForDetector) {
    const patternViolations = violations.filter(v => v.detectorId === aggPattern.detectorId);
    outliers = patternViolations.map(v => ({
      file: v.file,
      line: v.line,
      column: v.column,
      reason: v.message,
      deviationScore: v.severity === 'error' ? 1.0 : v.severity === 'warning' ? 0.7 : 0.4,
    }));
  }

  // Limit locations to prevent huge files
  const locations: PatternLocation[] = aggPattern.locations.slice(0, 100);

  return {
    id,
    category: mapToPatternCategory(aggPattern.category),
    subcategory: aggPattern.subcategory,
    name: aggPattern.name,
    description: aggPattern.description,
    detector: detectorConfig,
    confidence: confidenceInfo,
    locations,
    outliers,
    metadata: {
      firstSeen: now,
      lastSeen: now,
      source: 'auto-detected',
      tags: [aggPattern.category, aggPattern.subcategory],
    },
    severity: outliers.length > 0 ? 
      (outliers.some(o => o.deviationScore >= 1.0) ? 'error' : 'warning') : 
      'info',
    autoFixable: false,
    status: 'discovered',
  };
}

/**
 * Scan command implementation
 */
async function scanAction(options: ScanCommandOptions): Promise<void> {
  // Handle --all-projects: scan each registered project
  if (options.allProjects) {
    await scanAllProjects(options);
    return;
  }

  // Resolve root directory (--project flag or cwd)
  let rootDir = process.cwd();
  
  if (options.project) {
    const registry = await getProjectRegistry();
    const project = registry.findByName(options.project) ?? registry.findByPath(options.project);
    
    if (!project) {
      status.error(`Project not found: ${options.project}`);
      console.log(chalk.gray('Run `drift projects list` to see registered projects.'));
      process.exit(1);
    }
    
    if (project.isValid === false) {
      status.error(`Project path no longer exists: ${project.path}`);
      process.exit(1);
    }
    
    rootDir = project.path;
    await registry.updateLastAccessed(project.id);
  }

  await scanSingleProject(rootDir, options);
}

/**
 * Scan all registered projects
 */
async function scanAllProjects(options: ScanCommandOptions): Promise<void> {
  const registry = await getProjectRegistry();
  const projects = registry.getValid();
  
  if (projects.length === 0) {
    status.error('No projects registered.');
    console.log(chalk.gray('Run `drift projects add <path>` to register projects.'));
    process.exit(1);
  }
  
  console.log();
  console.log(chalk.bold(`🔍 Drift - Scanning ${projects.length} Projects`));
  console.log();
  
  const results: Array<{ name: string; patterns: number; violations: number; duration: number; error?: string }> = [];
  
  for (const project of projects) {
    console.log(chalk.cyan(`\n━━━ ${project.name} ━━━`));
    console.log(chalk.gray(`    ${project.path}`));
    
    try {
      const startTime = Date.now();
      // Create a copy of options without allProjects to avoid recursion
      const { allProjects: _, project: __, ...projectOptions } = options;
      await scanSingleProject(project.path, projectOptions, true);
      
      // Update registry with last scan time
      await registry.updateLastAccessed(project.id);
      
      results.push({
        name: project.name,
        patterns: 0, // Would need to capture from scan
        violations: 0,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      results.push({
        name: project.name,
        patterns: 0,
        violations: 0,
        duration: 0,
        error: (error as Error).message,
      });
    }
  }
  
  // Summary
  console.log();
  console.log(chalk.bold('━━━ All Projects Summary ━━━'));
  console.log();
  
  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  
  console.log(`  Projects scanned: ${chalk.cyan(successful.length)}/${projects.length}`);
  
  if (failed.length > 0) {
    console.log(chalk.red(`  Failed: ${failed.length}`));
    for (const f of failed) {
      console.log(chalk.red(`    - ${f.name}: ${f.error}`));
    }
  }
  
  console.log();
}

/**
 * Scan a single project
 */
async function scanSingleProject(rootDir: string, options: ScanCommandOptions, quiet = false): Promise<void> {
  const verbose = options.verbose ?? false;

  if (!quiet) {
    console.log();
    console.log(chalk.bold('🔍 Drift - Enterprise Pattern Scanner'));
    if (options.project) {
      console.log(chalk.gray(`    Project: ${options.project}`));
    }
    console.log();
  }

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  // Initialize pattern store
  const store = new PatternStore({ rootDir });
  await store.initialize();

  // Load ignore patterns
  const ignorePatterns = await loadIgnorePatterns(rootDir);
  if (verbose) {
    status.info(`Loaded ${ignorePatterns.length} ignore patterns`);
  }

  // Load project config for include patterns (allowlist)
  let includePatterns: string[] | undefined;
  try {
    const projectConfig = await loadProjectConfig(rootDir);
    if (projectConfig.include && projectConfig.include.length > 0) {
      includePatterns = projectConfig.include;
      if (verbose) {
        status.info(`Using allowlist: ${includePatterns.join(', ')}`);
      }
    }
  } catch {
    // Config not found or invalid - continue without include patterns
  }

  // Initialize file walker
  const walker = new FileWalker();

  // Discover files
  const discoverSpinner = createSpinner('Discovering files...');
  discoverSpinner.start();

  let files: string[];
  try {
    const scanOptions: ScanOptions = {
      rootDir,
      ignorePatterns,
      respectGitignore: true,
      respectDriftignore: true,
      followSymlinks: false,
      maxDepth: 50,
    };

    // Add include patterns if configured (allowlist mode)
    if (includePatterns && includePatterns.length > 0) {
      scanOptions.includePatterns = includePatterns;
    }

    // If specific paths provided, use those
    if (options.paths && options.paths.length > 0) {
      files = [];
      for (const p of options.paths) {
        const fullPath = path.resolve(rootDir, p);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const subResult = await walker.walk({
            ...scanOptions,
            rootDir: fullPath,
          });
          files.push(...subResult.files.map((f) => path.relative(rootDir, f.path)));
        } else {
          files.push(path.relative(rootDir, fullPath));
        }
      }
    } else {
      const result = await walker.walk(scanOptions);
      files = result.files.map((f) => f.relativePath);
    }

    // Filter to scannable files
    files = files.filter(isScannableFile);
    discoverSpinner.succeed(`Discovered ${files.length} files`);
  } catch (error) {
    discoverSpinner.fail('Failed to discover files');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Show file type breakdown
  if (verbose) {
    const fileGroups = groupFilesByType(files);
    console.log();
    console.log(chalk.gray('File types:'));
    for (const [ext, count] of Array.from(fileGroups.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(chalk.gray(`  .${ext}: ${count}`));
    }
    console.log();
  }

  // Initialize scanner service with real detectors
  const scannerService = createScannerService({ 
    rootDir, 
    verbose,
    criticalOnly: options.critical ?? false,
    categories: options.categories ?? [],
    generateManifest: options.manifest ?? false,
    incremental: options.incremental ?? false,
  });
  
  const initSpinner = createSpinner('Loading detectors...');
  initSpinner.start();
  
  try {
    await scannerService.initialize();
    const counts = scannerService.getDetectorCounts();
    const workerInfo = scannerService.isUsingWorkerThreads() 
      ? chalk.green(` [${scannerService.getWorkerThreadCount()} worker threads]`)
      : chalk.yellow(' [single-threaded]');
    initSpinner.succeed(`Loaded ${scannerService.getDetectorCount()} detectors (${counts.total} available)${workerInfo}`);
  } catch (error) {
    initSpinner.fail('Failed to load detectors');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Create project context
  const projectContext: ProjectContext = {
    rootDir,
    files,
    config: {},
  };

  // Scan files with progress
  const scanSpinner = createSpinner('Analyzing patterns with enterprise detectors...');
  scanSpinner.start();

  const startTime = Date.now();

  try {
    const scanResults = await scannerService.scanFiles(files, projectContext);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    scanSpinner.succeed(
      `Analyzed ${scanResults.totalFiles} files in ${duration}s ` +
      `(${scanResults.patterns.length} pattern types, ${scanResults.totalViolations} violations)`
    );

    if (verbose) {
      console.log(chalk.gray(`  Detectors ran: ${scanResults.detectorStats.ran}`));
      console.log(chalk.gray(`  Detectors skipped: ${scanResults.detectorStats.skipped}`));
      if (scanResults.errors.length > 0) {
        console.log(chalk.yellow(`  Warnings: ${scanResults.errors.length}`));
      }
    }

    // Show detected patterns by category
    if (scanResults.patterns.length > 0) {
      console.log();
      console.log(chalk.bold('Patterns detected by category:'));
      
      const byCategory = new Map<string, number>();
      for (const pattern of scanResults.patterns) {
        byCategory.set(pattern.category, (byCategory.get(pattern.category) ?? 0) + pattern.occurrences);
      }
      
      for (const [category, count] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${chalk.cyan(category)}: ${count} occurrences`);
      }
    }

    // Show violations (HIGH VALUE)
    if (scanResults.violations.length > 0) {
      console.log();
      console.log(chalk.bold.red(`⚠️  ${scanResults.violations.length} Violations Found:`));
      
      // Group by severity
      const errors = scanResults.violations.filter(v => v.severity === 'error');
      const warnings = scanResults.violations.filter(v => v.severity === 'warning');
      const infos = scanResults.violations.filter(v => v.severity === 'info');
      
      if (errors.length > 0) {
        console.log();
        console.log(chalk.red(`  Errors (${errors.length}):`));
        for (const v of errors.slice(0, 5)) {
          console.log(chalk.red(`    ${v.file}:${v.line} - ${v.message}`));
        }
        if (errors.length > 5) {
          console.log(chalk.gray(`    ... and ${errors.length - 5} more errors`));
        }
      }
      
      if (warnings.length > 0) {
        console.log();
        console.log(chalk.yellow(`  Warnings (${warnings.length}):`));
        for (const v of warnings.slice(0, 5)) {
          console.log(chalk.yellow(`    ${v.file}:${v.line} - ${v.message}`));
        }
        if (warnings.length > 5) {
          console.log(chalk.gray(`    ... and ${warnings.length - 5} more warnings`));
        }
      }
      
      if (verbose && infos.length > 0) {
        console.log();
        console.log(chalk.blue(`  Info (${infos.length}):`));
        for (const v of infos.slice(0, 3)) {
          console.log(chalk.blue(`    ${v.file}:${v.line} - ${v.message}`));
        }
        if (infos.length > 3) {
          console.log(chalk.gray(`    ... and ${infos.length - 3} more`));
        }
      }
    }

    // Convert and store patterns
    const saveSpinner = createSpinner('Saving patterns...');
    saveSpinner.start();

    let addedCount = 0;
    let skippedCount = 0;
    
    // Track which detectors we've already attached violations to
    const detectorsWithViolations = new Set<string>();

    for (const aggPattern of scanResults.patterns) {
      const isFirstPatternForDetector = !detectorsWithViolations.has(aggPattern.detectorId);
      if (isFirstPatternForDetector) {
        detectorsWithViolations.add(aggPattern.detectorId);
      }
      
      const pattern = convertToPattern(aggPattern, scanResults.violations, rootDir, isFirstPatternForDetector);
      
      // Check if pattern already exists
      if (store.has(pattern.id)) {
        // Update existing pattern with fresh locations and outliers
        try {
          store.update(pattern.id, {
            locations: pattern.locations,
            outliers: pattern.outliers,
            confidence: pattern.confidence,
            metadata: {
              ...pattern.metadata,
              lastSeen: new Date().toISOString(),
            },
          });
        } catch (e) {
          if (verbose) {
            console.log(chalk.yellow(`  Warning: Could not update pattern ${aggPattern.patternId}: ${(e as Error).message}`));
          }
        }
        skippedCount++;
        continue;
      }
      
      try {
        store.add(pattern);
        addedCount++;
      } catch (e) {
        if (verbose) {
          console.log(chalk.yellow(`  Warning: Could not add pattern ${aggPattern.patternId}: ${(e as Error).message}`));
        }
      }
    }

    await store.saveAll();
    saveSpinner.succeed(`Saved ${addedCount} new patterns (${skippedCount} already existed)`);

    // Create history snapshot for trend tracking
    try {
      const historyStore = new HistoryStore({ rootDir });
      await historyStore.initialize();
      const allPatterns = store.getAll();
      if (verbose) {
        console.log(chalk.gray(`  Creating history snapshot with ${allPatterns.length} patterns...`));
      }
      await historyStore.createSnapshot(allPatterns);
      
      // Check for regressions
      const trends = await historyStore.getTrendSummary('7d');
      if (trends && trends.regressions.length > 0) {
        console.log();
        console.log(chalk.bold.yellow(`📉 ${trends.regressions.length} Pattern Regressions Detected:`));
        
        const criticalRegressions = trends.regressions.filter(r => r.severity === 'critical');
        const warningRegressions = trends.regressions.filter(r => r.severity === 'warning');
        
        if (criticalRegressions.length > 0) {
          console.log();
          console.log(chalk.red(`  Critical (${criticalRegressions.length}):`));
          for (const r of criticalRegressions.slice(0, 3)) {
            console.log(chalk.red(`    ${r.patternName}: ${r.details}`));
          }
        }
        
        if (warningRegressions.length > 0) {
          console.log();
          console.log(chalk.yellow(`  Warning (${warningRegressions.length}):`));
          for (const r of warningRegressions.slice(0, 3)) {
            console.log(chalk.yellow(`    ${r.patternName}: ${r.details}`));
          }
        }
        
        if (trends.regressions.length > 6) {
          console.log(chalk.gray(`    ... and ${trends.regressions.length - 6} more`));
        }
      }
      
      if (trends && trends.improvements.length > 0 && verbose) {
        console.log();
        console.log(chalk.green(`📈 ${trends.improvements.length} patterns improved since last week`));
      }
    } catch (historyError) {
      if (verbose) {
        console.log(chalk.yellow(`  Warning: Could not create history snapshot: ${(historyError as Error).message}`));
      }
    }

    // Show manifest info if generated
    if (options.manifest && scanResults.manifest) {
      console.log();
      console.log(chalk.bold('📋 Manifest Generated:'));
      console.log(chalk.gray(`  Location: .drift/index/manifest.json`));
      console.log(chalk.gray(`  Patterns: ${scanResults.manifest.summary.totalPatterns}`));
      console.log(chalk.gray(`  Files: ${scanResults.manifest.summary.totalFiles}`));
      console.log(chalk.gray(`  Locations: ${scanResults.manifest.summary.totalLocations}`));
      console.log();
      console.log(chalk.gray('Use these commands to explore:'));
      console.log(chalk.cyan('  drift export --format ai-context'));
      console.log(chalk.cyan('  drift where <pattern>'));
      console.log(chalk.cyan('  drift files <path>'));
    }

  } catch (error) {
    scanSpinner.fail('Scan failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Contract scanning (BE↔FE mismatch detection) - enabled by default
  if (options.contracts !== false) {
    console.log();
    const contractSpinner = createSpinner('Scanning for BE↔FE contracts...');
    contractSpinner.start();

    try {
      const contractScanner = createContractScanner({ rootDir, verbose });
      await contractScanner.initialize();
      const contractResult = await contractScanner.scanFiles(files);

      contractSpinner.succeed(
        `Found ${contractResult.stats.matchedContracts} contracts ` +
        `(${contractResult.stats.backendEndpoints} BE endpoints, ${contractResult.stats.frontendCalls} FE calls)`
      );

      if (contractResult.stats.mismatches > 0) {
        console.log();
        console.log(chalk.bold.red(`⚠️  ${contractResult.stats.mismatches} Contract Mismatches Found:`));
        
        for (const contract of contractResult.contracts.filter(c => c.mismatches.length > 0).slice(0, 5)) {
          console.log();
          console.log(chalk.yellow(`  ${contract.method} ${contract.endpoint}`));
          for (const mismatch of contract.mismatches.slice(0, 3)) {
            const icon = mismatch.severity === 'error' ? '🔴' : mismatch.severity === 'warning' ? '🟡' : '🔵';
            console.log(chalk.gray(`    ${icon} ${mismatch.fieldPath}: ${mismatch.description}`));
          }
          if (contract.mismatches.length > 3) {
            console.log(chalk.gray(`    ... and ${contract.mismatches.length - 3} more`));
          }
        }

        const contractsWithMismatches = contractResult.contracts.filter(c => c.mismatches.length > 0);
        if (contractsWithMismatches.length > 5) {
          console.log(chalk.gray(`\n  ... and ${contractsWithMismatches.length - 5} more contracts with mismatches`));
        }
      }

      if (contractResult.unmatchedBackend.length > 0 && verbose) {
        console.log();
        console.log(chalk.gray(`  Unmatched backend endpoints: ${contractResult.unmatchedBackend.length}`));
        for (const ep of contractResult.unmatchedBackend.slice(0, 3)) {
          console.log(chalk.gray(`    ${ep.method} ${ep.path} (${ep.file}:${ep.line})`));
        }
      }

      if (contractResult.unmatchedFrontend.length > 0 && verbose) {
        console.log();
        console.log(chalk.gray(`  Unmatched frontend calls: ${contractResult.unmatchedFrontend.length}`));
        for (const call of contractResult.unmatchedFrontend.slice(0, 3)) {
          console.log(chalk.gray(`    ${call.method} ${call.path} (${call.file}:${call.line})`));
        }
      }

      console.log();
      console.log(chalk.gray('View contracts in the dashboard:'));
      console.log(chalk.cyan('  drift dashboard'));

    } catch (error) {
      contractSpinner.fail('Contract scanning failed');
      if (verbose) {
        console.error(chalk.red((error as Error).message));
      }
    }
  }

  // Data boundary scanning (Backend ↔ Database access tracking) - enabled by default
  if (options.boundaries !== false) {
    console.log();
    const boundarySpinner = createSpinner('Scanning for data boundaries...');
    boundarySpinner.start();

    try {
      const boundaryScanner = createBoundaryScanner({ rootDir, verbose });
      await boundaryScanner.initialize();
      const boundaryResult = await boundaryScanner.scanFiles(files);

      boundarySpinner.succeed(
        `Found ${boundaryResult.stats.tablesFound} tables, ` +
        `${boundaryResult.stats.accessPointsFound} access points`
      );

      // Show sensitive field access warnings
      if (boundaryResult.stats.sensitiveFieldsFound > 0) {
        console.log();
        console.log(chalk.bold.yellow(`⚠️  ${boundaryResult.stats.sensitiveFieldsFound} Sensitive Field Access Detected:`));
        
        const sensitiveFields = boundaryResult.accessMap.sensitiveFields.slice(0, 5);
        for (const field of sensitiveFields) {
          const fieldName = field.table ? `${field.table}.${field.field}` : field.field;
          console.log(chalk.yellow(`    ${fieldName} (${field.sensitivityType}) - ${field.file}:${field.line}`));
        }
        if (boundaryResult.accessMap.sensitiveFields.length > 5) {
          console.log(chalk.gray(`    ... and ${boundaryResult.accessMap.sensitiveFields.length - 5} more`));
        }
      }

      // Check violations if rules exist
      if (boundaryResult.stats.violationsFound > 0) {
        console.log();
        console.log(chalk.bold.red(`🚫 ${boundaryResult.stats.violationsFound} Boundary Violations:`));
        
        for (const violation of boundaryResult.violations.slice(0, 5)) {
          const icon = violation.severity === 'error' ? '🔴' : violation.severity === 'warning' ? '🟡' : '🔵';
          console.log(chalk.red(`    ${icon} ${violation.file}:${violation.line} - ${violation.message}`));
        }
        if (boundaryResult.violations.length > 5) {
          console.log(chalk.gray(`    ... and ${boundaryResult.violations.length - 5} more`));
        }
      }

      // Show top accessed tables in verbose mode
      if (verbose && boundaryResult.stats.tablesFound > 0) {
        console.log();
        console.log(chalk.gray('  Top accessed tables:'));
        const tableEntries = Object.entries(boundaryResult.accessMap.tables)
          .map(([name, info]) => ({ name, count: info.accessedBy.length }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        for (const table of tableEntries) {
          console.log(chalk.gray(`    ${table.name}: ${table.count} access points`));
        }
      }

      console.log();
      console.log(chalk.gray('View data boundaries:'));
      console.log(chalk.cyan('  drift boundaries'));
      console.log(chalk.cyan('  drift boundaries table <name>'));

    } catch (error) {
      boundarySpinner.fail('Boundary scanning failed');
      if (verbose) {
        console.error(chalk.red((error as Error).message));
      }
    }
  }

  // Materialize data lake views for fast queries
  const lakeSpinner = createSpinner('Building data lake views...');
  lakeSpinner.start();

  try {
    const dataLake = createDataLake({ rootDir });
    await dataLake.initialize();
    
    // Get all patterns for materialization
    const allPatterns = store.getAll();
    
    // Build scan info for the manifest
    const lastScanInfo = {
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      filesScanned: files.length,
      patternsFound: allPatterns.length,
      errors: 0,
    };
    
    // Materialize views, indexes, and shards
    const materializeResult = await dataLake.materializer.materialize(
      allPatterns,
      { force: options.force ?? false },
      { lastScan: lastScanInfo }
    );
    
    // Also save patterns to shards for category-based queries
    await dataLake.patternShards.saveAll(allPatterns);
    
    lakeSpinner.succeed(
      `Built ${materializeResult.viewsRebuilt.length} views, ` +
      `${materializeResult.indexesRebuilt.length} indexes in ${materializeResult.duration}ms`
    );
    
    if (verbose) {
      console.log(chalk.gray(`  Views: ${materializeResult.viewsRebuilt.join(', ')}`));
      console.log(chalk.gray(`  Indexes: ${materializeResult.indexesRebuilt.join(', ')}`));
    }
  } catch (lakeError) {
    lakeSpinner.fail('Data lake materialization failed');
    if (verbose) {
      console.error(chalk.red((lakeError as Error).message));
    }
  }

  // Summary
  console.log();
  const stats = store.getStats();
  
  console.log(chalk.bold('Scan Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Files scanned:      ${chalk.cyan(files.length)}`);
  console.log(`  Total patterns:     ${chalk.cyan(stats.totalPatterns)}`);
  console.log(`    Discovered:       ${chalk.yellow(stats.byStatus.discovered)}`);
  console.log(`    Approved:         ${chalk.green(stats.byStatus.approved)}`);
  console.log(`    Ignored:          ${chalk.gray(stats.byStatus.ignored)}`);
  console.log();

  // Show discovered patterns if any
  if (stats.byStatus.discovered > 0) {
    const discovered = store.getDiscovered();
    const highConfidence = discovered.filter((p) => p.confidence.level === 'high');
    
    if (highConfidence.length > 0) {
      console.log(chalk.bold('High Confidence Patterns (ready for approval):'));
      console.log();
      
      const rows: PatternRow[] = highConfidence.slice(0, 10).map((p) => ({
        id: p.id.slice(0, 13),
        name: p.name.slice(0, 28),
        category: p.category,
        confidence: p.confidence.score,
        locations: p.locations.length,
        outliers: p.outliers.length,
      }));
      
      console.log(createPatternsTable(rows));
      
      if (highConfidence.length > 10) {
        console.log(chalk.gray(`  ... and ${highConfidence.length - 10} more`));
      }
      console.log();
    }

    console.log(chalk.gray('To review and approve patterns:'));
    console.log(chalk.cyan('  drift status'));
    console.log(chalk.cyan('  drift approve <pattern-id>'));
  }

  console.log();
}

export const scanCommand = new Command('scan')
  .description('Scan codebase for patterns using enterprise detectors')
  .argument('[paths...]', 'Paths to scan (defaults to current directory)')
  .option('--force', 'Force rescan even if cache is valid')
  .option('--verbose', 'Enable verbose output')
  .option('--critical', 'Only run critical/high-value detectors')
  .option('-c, --categories <categories...>', 'Filter by categories (api, auth, security, etc.)')
  .option('--manifest', 'Generate manifest with semantic locations')
  .option('--incremental', 'Only scan changed files')
  .option('--no-contracts', 'Skip BE↔FE contract scanning')
  .option('--no-boundaries', 'Skip data boundary scanning')
  .option('-p, --project <name>', 'Scan a specific registered project by name')
  .option('--all-projects', 'Scan all registered projects')
  .action((paths: string[], options: ScanCommandOptions) => {
    // Merge positional paths with options
    if (paths && paths.length > 0) {
      options.paths = paths;
    }
    return scanAction(options);
  });
