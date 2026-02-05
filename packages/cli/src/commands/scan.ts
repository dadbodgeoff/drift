/**
 * Scan Command - drift scan
 *
 * Perform a full codebase scan to discover patterns using
 * enterprise-grade detectors from driftdetect-detectors.
 *
 * @requirements 29.2
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  HistoryStore,
  FileWalker,
  createDataLake,
  loadProjectConfig,
  getProjectRegistry,
  createTelemetryClient,
  createTestTopologyAnalyzer,
  createCallGraphAnalyzer,
  getDefaultIgnorePatterns,
  mergeIgnorePatterns,
  // Native adapters with TypeScript fallback
  isNativeAvailable,
  analyzeTestTopologyWithFallback,
  scanBoundariesWithFallback,
  analyzeConstantsWithFallback,
  buildCallGraph,
  ConstantStore,
  type ScanOptions,
  type Pattern,
  type PatternCategory,
  type PatternLocation,
  type ConfidenceInfo,
  type DetectorConfig,
  type TelemetryConfig,
  type BuildConfig,
} from 'driftdetect-core';
import {
  createPatternStore,
  getStorageInfo,
} from 'driftdetect-core/storage';

import { createBoundaryScanner, type BoundaryScanResult } from '../services/boundary-scanner.js';
import { createContractScanner } from '../services/contract-scanner.js';
import { createScannerService, type AggregatedPattern, type AggregatedViolation } from '../services/scanner-service.js';
import { createSpinner, status } from '../ui/spinner.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';

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
  /** Build test topology during scan */
  testTopology?: boolean;
  /** Extract constants during scan */
  constants?: boolean;
  /** Build call graph during scan */
  callgraph?: boolean;
  /** Scan a specific registered project by name */
  project?: string;
  /** Scan all registered projects */
  allProjects?: boolean;
  /** Scan timeout in seconds (default: 300 = 5 minutes) */
  timeout?: number;
  /** Maximum file size in bytes to scan (default: 1MB) */
  maxFileSize?: number;
}

/** Interval for progress updates when scan is slow (10 seconds) */
const PROGRESS_UPDATE_INTERVAL_MS = 10 * 1000;

/** Time after which we warn about slow scan (30 seconds) */
const SLOW_SCAN_WARNING_MS = 30 * 1000;

/**
 * Scan health monitor - tracks progress and detects stalls/timeouts
 */
class ScanHealthMonitor {
  private startTime: number;
  private timeoutMs: number;
  private progressInterval: NodeJS.Timeout | null = null;
  private slowWarningTimeout: NodeJS.Timeout | null = null;
  private hasWarnedSlow = false;
  private fileCount: number;
  private spinner: ReturnType<typeof createSpinner>;

  constructor(
    fileCount: number,
    spinner: ReturnType<typeof createSpinner>,
    timeoutMs: number,
    _verbose: boolean
  ) {
    this.startTime = Date.now();
    this.timeoutMs = timeoutMs;
    this.fileCount = fileCount;
    this.spinner = spinner;
  }

  start(): void {
    // Set up slow scan warning
    this.slowWarningTimeout = setTimeout(() => {
      if (!this.hasWarnedSlow) {
        this.hasWarnedSlow = true;
        this.spinner.text(chalk.yellow(
          `Analyzing ${this.fileCount} files... (taking longer than expected)`
        ));
      }
    }, SLOW_SCAN_WARNING_MS);

    // Set up progress updates for long scans
    this.progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - this.startTime) / 1000);
      this.spinner.text(`Analyzing ${this.fileCount} files... (${elapsed}s elapsed)`);
    }, PROGRESS_UPDATE_INTERVAL_MS);
  }

  stop(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    if (this.slowWarningTimeout) {
      clearTimeout(this.slowWarningTimeout);
      this.slowWarningTimeout = null;
    }
  }

  /**
   * Wrap a promise with timeout and health monitoring
   */
  async withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.stop();
        reject(new ScanTimeoutError(this.fileCount, this.timeoutMs));
      }, this.timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          this.stop();
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          this.stop();
          reject(error);
        });
    });
  }
}

/**
 * Custom error for scan timeout with helpful diagnostics
 */
class ScanTimeoutError extends Error {
  constructor(fileCount: number, timeoutMs: number) {
    const timeoutSec = Math.round(timeoutMs / 1000);
    const message = `Scan timed out after ${timeoutSec} seconds while processing ${fileCount} files.`;
    super(message);
    this.name = 'ScanTimeoutError';
  }

  getHelpfulMessage(): string {
    return `
${chalk.red('⏱️  Scan Timeout')}

The scan took too long and was stopped to prevent hanging.

${chalk.bold('Common causes:')}
  • Scanning a very large codebase (try scanning a subdirectory first)
  • Build artifacts or dependencies not being ignored
  • Large generated files (migrations, bundles)

${chalk.bold('Try these fixes:')}
  1. Check your ${chalk.cyan('.driftignore')} file excludes build artifacts:
     ${chalk.gray('# .NET/C#')}
     ${chalk.gray('bin/')}
     ${chalk.gray('obj/')}
     ${chalk.gray('packages/')}
     ${chalk.gray('')}
     ${chalk.gray('# Java')}
     ${chalk.gray('target/')}
     ${chalk.gray('.gradle/')}
     ${chalk.gray('')}
     ${chalk.gray('# Node')}
     ${chalk.gray('node_modules/')}
     ${chalk.gray('dist/')}

  2. Scan a specific directory instead:
     ${chalk.cyan('drift scan src/')}

  3. Increase the timeout:
     ${chalk.cyan('drift scan --timeout 600')}  ${chalk.gray('# 10 minutes')}

  4. Limit file size (skip large generated files):
     ${chalk.cyan('drift scan --max-file-size 500000')}  ${chalk.gray('# 500KB')}

  5. Run with verbose mode to see what's happening:
     ${chalk.cyan('drift scan --verbose')}

${chalk.bold('Still stuck?')}
  Please report this issue with your codebase details:
  ${chalk.cyan('https://github.com/dadbodgeoff/drift/issues/new')}

  Include: language, framework, approximate file count, and any error messages.
`;
  }
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
 * Uses enterprise-grade defaults from @driftdetect/core
 */
async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  try {
    const driftignorePath = path.join(rootDir, '.driftignore');
    const content = await fs.readFile(driftignorePath, 'utf-8');
    const userPatterns = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    return mergeIgnorePatterns(userPatterns);
  } catch {
    return getDefaultIgnorePatterns();
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
 * Detect frameworks from project files
 */
async function detectFrameworks(rootDir: string): Promise<string[]> {
  const frameworks: string[] = [];

  // Helper to check package.json for JS frameworks
  async function checkPackageJson(pkgPath: string): Promise<void> {
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next'] && !frameworks.includes('nextjs')) {frameworks.push('nextjs');}
      if (deps['react'] && !deps['next'] && !frameworks.includes('react')) {frameworks.push('react');}
      if (deps['vue'] && !frameworks.includes('vue')) {frameworks.push('vue');}
      if (deps['@angular/core'] && !frameworks.includes('angular')) {frameworks.push('angular');}
      if (deps['express'] && !frameworks.includes('express')) {frameworks.push('express');}
      if (deps['fastify'] && !frameworks.includes('fastify')) {frameworks.push('fastify');}
      if (deps['@nestjs/core'] && !frameworks.includes('nestjs')) {frameworks.push('nestjs');}
      if ((deps['svelte'] || deps['@sveltejs/kit']) && !frameworks.includes('svelte')) {frameworks.push('svelte');}
    } catch {
      // No package.json at this path
    }
  }

  // Check root package.json
  await checkPackageJson(path.join(rootDir, 'package.json'));

  // Check common subdirectory package.json files (monorepo/fullstack patterns)
  const commonSubdirs = ['frontend', 'client', 'web', 'app', 'packages/web', 'packages/frontend'];
  for (const subdir of commonSubdirs) {
    await checkPackageJson(path.join(rootDir, subdir, 'package.json'));
  }

  // Check Python frameworks
  try {
    const reqPath = path.join(rootDir, 'requirements.txt');
    const content = await fs.readFile(reqPath, 'utf-8');
    if (content.includes('fastapi')) {frameworks.push('fastapi');}
    if (content.includes('django')) {frameworks.push('django');}
    if (content.includes('flask')) {frameworks.push('flask');}
  } catch {
    // No requirements.txt - try pyproject.toml
    try {
      const pyprojectPath = path.join(rootDir, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      if (content.includes('fastapi')) {frameworks.push('fastapi');}
      if (content.includes('django')) {frameworks.push('django');}
      if (content.includes('flask')) {frameworks.push('flask');}
    } catch {
      // No pyproject.toml
    }
  }

  // Check for Spring (Java)
  try {
    const pomPath = path.join(rootDir, 'pom.xml');
    const content = await fs.readFile(pomPath, 'utf-8');
    if (content.includes('spring-boot')) {frameworks.push('spring');}
  } catch {
    // No pom.xml - try build.gradle
    try {
      const gradlePath = path.join(rootDir, 'build.gradle');
      const content = await fs.readFile(gradlePath, 'utf-8');
      if (content.includes('spring')) {frameworks.push('spring');}
    } catch {
      // No build.gradle
    }
  }

  // Check for ASP.NET
  try {
    const files = await fs.readdir(rootDir);
    for (const file of files) {
      if (file.endsWith('.csproj')) {
        const content = await fs.readFile(path.join(rootDir, file), 'utf-8');
        if (content.includes('Microsoft.AspNetCore')) {
          frameworks.push('aspnet');
          break;
        }
      }
    }
  } catch {
    // No csproj
  }

  // Check for Laravel
  try {
    await fs.access(path.join(rootDir, 'artisan'));
    frameworks.push('laravel');
  } catch {
    // No artisan
  }

  // Check for Rails
  try {
    await fs.access(path.join(rootDir, 'config', 'routes.rb'));
    frameworks.push('rails');
  } catch {
    // No routes.rb
  }

  return frameworks;
}

/**
 * Check if file is scannable
 * Aligned with file-walker.ts EXTENSION_LANGUAGE_MAP
 */
function isScannableFile(filePath: string): boolean {
  const scannableExtensions = [
    // TypeScript / JavaScript
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
    // Python
    'py', 'pyw',
    // C#
    'cs',
    // Java
    'java',
    // PHP
    'php',
    // Go
    'go',
    // Rust
    'rs',
    // C / C++
    'c', 'cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'h',
    // Web / Styling
    'css', 'scss', 'sass', 'less',
    // Config / Data
    'json', 'yaml', 'yml',
    // Documentation
    'md', 'mdx',
    // HTML / Templates
    'html', 'htm',
    // Frontend frameworks
    'vue', 'svelte',
    // Blazor / Razor (C# in templates)
    'razor', 'cshtml',
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

  // Initialize pattern store (auto-detects SQLite vs JSON backend)
  // Phase 3: SQLite is now the default storage backend
  const store = await createPatternStore({ rootDir });
  const storageInfo = getStorageInfo(rootDir);
  
  if (verbose) {
    const backendLabel = storageInfo.backend === 'sqlite' ? chalk.green('SQLite') : chalk.yellow('JSON');
    status.info(`Storage backend: ${backendLabel}`);
  }

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
      maxFileSize: options.maxFileSize ?? 1048576, // 1MB default
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
    
    // Pre-scan warning for large codebases
    if (files.length > 500) {
      const estimatedMinutes = Math.ceil(files.length / 200); // ~200 files/min estimate
      console.log();
      console.log(chalk.yellow(`  ⚠️  Large codebase detected (${files.length} files)`));
      console.log(chalk.gray(`     Estimated scan time: ${estimatedMinutes}-${estimatedMinutes * 2} minutes`));
      if (files.length > 2000) {
        console.log(chalk.gray(`     Consider: drift scan src/ or increase --timeout ${Math.ceil(files.length / 100) * 60}`));
      }
    }
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
    const counts = await scannerService.getDetectorCounts();
    const totalAvailable = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const workerInfo = scannerService.isUsingWorkerThreads() 
      ? chalk.green(` [${scannerService.getWorkerThreadCount()} worker threads]`)
      : chalk.yellow(' [single-threaded]');
    initSpinner.succeed(`Loaded ${scannerService.getDetectorCount()} detectors (${totalAvailable} available)${workerInfo}`);
  } catch (error) {
    initSpinner.fail('Failed to load detectors');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Create project context for scanner service
  const scannerProjectContext = {
    rootDir,
    files,
    config: {},
  };

  // Scan files with progress and health monitoring
  const scanSpinner = createSpinner('Analyzing patterns with enterprise detectors...');
  scanSpinner.start();

  const startTime = Date.now();
  const timeoutMs = (options.timeout ?? 300) * 1000; // Default 5 minutes
  const healthMonitor = new ScanHealthMonitor(files.length, scanSpinner, timeoutMs, verbose);

  try {
    healthMonitor.start();
    const scanResults = await healthMonitor.withTimeout(
      scannerService.scanFiles(files, scannerProjectContext)
    );
    
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
          await store.update(pattern.id, {
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
        await store.add(pattern);
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

    // Record telemetry (if enabled) - inside try block where scanResults is in scope
    try {
      const projectConfig = await loadProjectConfig(rootDir);
      if (projectConfig.telemetry?.enabled) {
        const driftDir = path.join(rootDir, DRIFT_DIR);
        const telemetryClient = createTelemetryClient(driftDir, projectConfig.telemetry as TelemetryConfig);
        await telemetryClient.initialize();
        
        // Record scan completion
        const scanDuration = Date.now() - startTime;
        await telemetryClient.recordScanCompletion({
          durationMs: scanDuration,
          filesScanned: files.length,
          newPatternsDiscovered: addedCount,
          isIncremental: options.incremental ?? false,
          workerCount: scannerService.getWorkerThreadCount(),
        });
        
        // Record pattern signatures for discovered patterns (limit to 50)
        for (const aggPattern of scanResults.patterns.slice(0, 50)) {
          // Get actual detection method from pattern, default to 'ast' for modern detectors
          const detectionMethod = (aggPattern as any).detectionMethod ?? 
            (aggPattern as any).detector?.type ?? 'ast';
          
          await telemetryClient.recordPatternSignature({
            patternName: aggPattern.name,
            detectorConfig: { detectorId: aggPattern.detectorId },
            category: aggPattern.category,
            confidence: aggPattern.confidence,
            locationCount: aggPattern.locations.length,
            outlierCount: 0,
            detectionMethod: detectionMethod as 'ast' | 'regex' | 'hybrid' | 'semantic',
            language: getExtension(aggPattern.locations[0]?.file ?? 'ts'),
          });
        }
        
        // Record aggregate stats
        const telemetryPatterns = store.getAll();
        const patternsByCategory: Record<string, number> = {};
        for (const p of telemetryPatterns) {
          patternsByCategory[p.category] = (patternsByCategory[p.category] ?? 0) + 1;
        }
        
        const languages = new Set<string>();
        for (const file of files) {
          languages.add(getExtension(file));
        }

        // Detect frameworks from project files
        const detectedFrameworks = await detectFrameworks(rootDir);
        
        await telemetryClient.recordAggregateStats({
          totalPatterns: telemetryPatterns.length,
          patternsByStatus: {
            discovered: store.getDiscovered().length,
            approved: store.getApproved().length,
            ignored: store.getIgnored().length,
          },
          patternsByCategory,
          languages: Array.from(languages),
          frameworks: detectedFrameworks,
          featuresEnabled: [
            options.contracts !== false ? 'contracts' : '',
            options.boundaries !== false ? 'boundaries' : '',
            options.manifest ? 'manifest' : '',
          ].filter(Boolean),
          fileCount: files.length,
        });
        
        await telemetryClient.shutdown();
        
        if (verbose) {
          console.log(chalk.gray('  Telemetry events submitted'));
        }
      }
    } catch (telemetryError) {
      // Telemetry should never block - silently ignore errors
      if (verbose) {
        console.log(chalk.gray(`  Telemetry: ${(telemetryError as Error).message}`));
      }
    }

  } catch (error) {
    scanSpinner.fail('Scan failed');
    
    // Show helpful message for timeout errors
    if (error instanceof ScanTimeoutError) {
      console.log(error.getHelpfulMessage());
    } else {
      console.error(chalk.red((error as Error).message));
      console.log();
      console.log(chalk.gray('If this error persists, please report it:'));
      console.log(chalk.cyan('  https://github.com/dadbodgeoff/drift/issues/new'));
    }
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

  // Variable to hold boundary scan result for passing to materializer
  let scanBoundaryResult: BoundaryScanResult | undefined;

  // Data boundary scanning (Backend ↔ Database access tracking) - enabled by default
  if (options.boundaries !== false) {
    console.log();
    const boundarySpinner = createSpinner('Scanning for data boundaries...');
    boundarySpinner.start();
    try {
      // Try native analyzer first (much faster)
      if (isNativeAvailable()) {
        try {
          const nativeResult = await scanBoundariesWithFallback(rootDir, files);
          
          // Convert native result to BoundaryScanResult format
          // Note: Native types may differ slightly, so we convert carefully
          const accessPointsMap: Record<string, import('driftdetect-core').DataAccessPoint> = {};
          for (const ap of nativeResult.accessPoints) {
            const id = `${ap.file}:${ap.line}:0:${ap.table}`;
            accessPointsMap[id] = {
              id,
              table: ap.table,
              fields: ap.fields,
              operation: ap.operation,
              file: ap.file,
              line: ap.line,
              column: 0,
              context: '',
              isRawSql: false,
              confidence: ap.confidence,
            };
          }
          
          const sensitiveFields: import('driftdetect-core').SensitiveField[] = nativeResult.sensitiveFields.map(sf => ({
            field: sf.field,
            table: sf.table ?? null,
            sensitivityType: sf.sensitivityType,
            file: sf.file,
            line: sf.line,
            confidence: sf.confidence,
          }));
          
          const models: import('driftdetect-core').ORMModel[] = nativeResult.models.map(m => ({
            name: m.name,
            tableName: m.tableName,
            fields: m.fields,
            file: m.file,
            line: m.line,
            framework: m.framework as import('driftdetect-core').ORMFramework,
            confidence: m.confidence,
          }));
          
          // Build tables map from access points
          const tablesMap: Record<string, import('driftdetect-core').TableAccessInfo> = {};
          for (const ap of nativeResult.accessPoints) {
            let tableInfo = tablesMap[ap.table];
            if (!tableInfo) {
              tableInfo = {
                name: ap.table,
                model: null,
                fields: [],
                sensitiveFields: [],
                accessedBy: [],
              };
              tablesMap[ap.table] = tableInfo;
            }
            const apId = `${ap.file}:${ap.line}:0:${ap.table}`;
            const fullAp = accessPointsMap[apId];
            if (fullAp) {
              tableInfo.accessedBy.push(fullAp);
            }
          }
          
          scanBoundaryResult = {
            accessMap: {
              version: '1.0',
              generatedAt: new Date().toISOString(),
              projectRoot: rootDir,
              tables: tablesMap,
              accessPoints: accessPointsMap,
              sensitiveFields,
              models,
              stats: {
                totalTables: Object.keys(tablesMap).length,
                totalAccessPoints: nativeResult.accessPoints.length,
                totalSensitiveFields: nativeResult.sensitiveFields.length,
                totalModels: nativeResult.models.length,
              },
            },
            violations: [],
            stats: {
              filesScanned: nativeResult.filesScanned,
              tablesFound: Object.keys(tablesMap).length,
              accessPointsFound: nativeResult.accessPoints.length,
              sensitiveFieldsFound: nativeResult.sensitiveFields.length,
              violationsFound: 0,
              scanDurationMs: nativeResult.durationMs,
            },
          };

          boundarySpinner.succeed(
            `Found ${scanBoundaryResult.stats.tablesFound} tables, ` +
            `${scanBoundaryResult.stats.accessPointsFound} access points (native)`
          );

          // Show sensitive field access warnings
          if (scanBoundaryResult.stats.sensitiveFieldsFound > 0) {
            console.log();
            console.log(chalk.bold.yellow(`⚠️  ${scanBoundaryResult.stats.sensitiveFieldsFound} Sensitive Field Access Detected:`));
            
            const sensFields = scanBoundaryResult.accessMap.sensitiveFields.slice(0, 5);
            for (const field of sensFields) {
              const fieldName = field.table ? `${field.table}.${field.field}` : field.field;
              console.log(chalk.yellow(`    ${fieldName} (${field.sensitivityType}) - ${field.file}:${field.line}`));
            }
            if (scanBoundaryResult.accessMap.sensitiveFields.length > 5) {
              console.log(chalk.gray(`    ... and ${scanBoundaryResult.accessMap.sensitiveFields.length - 5} more`));
            }
          }

          console.log();
          console.log(chalk.gray('View data boundaries:'));
          console.log(chalk.cyan('  drift boundaries'));
          console.log(chalk.cyan('  drift boundaries table <name>'));

        } catch (nativeError) {
          if (verbose) {
            boundarySpinner.text(chalk.gray(`Native boundary scanner failed, using TypeScript fallback`));
          }
          // Fall through to TypeScript implementation
          throw nativeError; // Re-throw to trigger fallback
        }
      } else {
        // TypeScript fallback
        const boundaryScanner = createBoundaryScanner({ rootDir, verbose });
        await boundaryScanner.initialize();
        const boundaryResult = await boundaryScanner.scanFiles(files);
        
        // Store result for materializer
        scanBoundaryResult = boundaryResult;

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
      }
    } catch (error) {
      // If native failed, try TypeScript fallback
      try {
        const boundaryScanner = createBoundaryScanner({ rootDir, verbose });
        await boundaryScanner.initialize();
        const boundaryResult = await boundaryScanner.scanFiles(files);
        scanBoundaryResult = boundaryResult;

        boundarySpinner.succeed(
          `Found ${boundaryResult.stats.tablesFound} tables, ` +
          `${boundaryResult.stats.accessPointsFound} access points`
        );
      } catch (fallbackError) {
        boundarySpinner.fail('Boundary scanning failed');
        if (verbose) {
          console.error(chalk.red((fallbackError as Error).message));
        }
      }
    }
  }

  // Test topology scanning (test-to-code mappings) - opt-in
  if (options.testTopology) {
    console.log();
    const testTopologySpinner = createSpinner('Building test topology...');
    testTopologySpinner.start();

    try {
      // Try native analyzer first (much faster)
      if (isNativeAvailable()) {
        try {
          const nativeResult = await analyzeTestTopologyWithFallback(rootDir, files);
          
          // Save results
          const testTopologyDir = path.join(rootDir, DRIFT_DIR, 'test-topology');
          await fs.mkdir(testTopologyDir, { recursive: true });
          
          // Convert native result to summary format
          const summary = {
            testFiles: nativeResult.testFiles.length,
            testCases: nativeResult.totalTests,
            coveredFunctions: nativeResult.coverage.length,
            totalFunctions: nativeResult.coverage.length + nativeResult.uncoveredFiles.length,
            functionCoveragePercent: nativeResult.coverage.length > 0 
              ? Math.round((nativeResult.coverage.length / (nativeResult.coverage.length + nativeResult.uncoveredFiles.length)) * 100)
              : 0,
            coveragePercent: 0,
            avgQualityScore: 0,
            byFramework: {} as Record<string, number>,
          };
          
          // Count by framework
          for (const tf of nativeResult.testFiles) {
            summary.byFramework[tf.framework] = (summary.byFramework[tf.framework] ?? 0) + tf.testCount;
          }
          
          const mockAnalysis = {
            totalMocks: nativeResult.testFiles.reduce((sum, tf) => sum + tf.mockCount, 0),
            externalMocks: 0,
            internalMocks: 0,
            externalPercent: 0,
            internalPercent: 0,
            avgMockRatio: 0,
            highMockRatioTests: [] as string[],
            topMockedModules: [] as string[],
          };
          
          await fs.writeFile(
            path.join(testTopologyDir, 'summary.json'),
            JSON.stringify({ summary, mockAnalysis, generatedAt: new Date().toISOString() }, null, 2)
          );

          testTopologySpinner.succeed(
            `Built test topology (native): ${summary.testFiles} test files, ${summary.testCases} tests`
          );

          if (verbose) {
            console.log(chalk.gray(`  Native analyzer used for faster analysis`));
            console.log(chalk.gray(`  Files analyzed: ${nativeResult.filesAnalyzed}`));
          }
          
        } catch (nativeError) {
          // Native failed, fall through to TypeScript implementation
          if (verbose) {
            console.log(chalk.gray(`  Native analyzer failed, using TypeScript fallback`));
          }
          await runTypeScriptTestTopology(rootDir, files, verbose, testTopologySpinner);
        }
      } else {
        // Native not available, use TypeScript
        await runTypeScriptTestTopology(rootDir, files, verbose, testTopologySpinner);
      }

    } catch (error) {
      testTopologySpinner.fail('Test topology build failed');
      if (verbose) {
        console.error(chalk.red((error as Error).message));
      }
    }
  }

  // Constants extraction (opt-in)
  if (options.constants) {
    console.log();
    const constantsSpinner = createSpinner('Extracting constants...');
    constantsSpinner.start();

    try {
      const constantsResult = await analyzeConstantsWithFallback(rootDir, files);
      
      // Save to ConstantStore
      const constantStore = new ConstantStore({ rootDir });
      await constantStore.initialize();
      
      // Group constants by file and save
      const constantsByFile = new Map<string, typeof constantsResult.constants>();
      for (const constant of constantsResult.constants) {
        const existing = constantsByFile.get(constant.file) ?? [];
        existing.push(constant);
        constantsByFile.set(constant.file, existing);
      }
      
      // Map native language to ConstantLanguage
      const mapLanguage = (lang: string): 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp' => {
        const validLangs = ['typescript', 'javascript', 'python', 'java', 'csharp', 'php', 'go', 'rust', 'cpp'];
        return validLangs.includes(lang) ? lang as 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp' : 'typescript';
      };
      
      // Map native kind to ConstantKind
      const mapKind = (kind: string): 'primitive' | 'enum' | 'enum_member' | 'object' | 'array' | 'computed' | 'class_constant' | 'interface_constant' => {
        const kindMap: Record<string, 'primitive' | 'enum' | 'enum_member' | 'object' | 'array' | 'computed' | 'class_constant' | 'interface_constant'> = {
          'const': 'primitive',
          'let': 'primitive',
          'var': 'primitive',
          'readonly': 'primitive',
          'static': 'class_constant',
          'final': 'class_constant',
          'define': 'primitive',
          'enum_member': 'enum_member',
          'primitive': 'primitive',
          'enum': 'enum',
          'object': 'object',
          'array': 'array',
          'computed': 'computed',
          'class_constant': 'class_constant',
          'interface_constant': 'interface_constant',
        };
        return kindMap[kind] ?? 'primitive';
      };
      
      // Map native category to ConstantCategory
      const mapCategory = (cat: string): 'config' | 'api' | 'status' | 'error' | 'feature_flag' | 'limit' | 'regex' | 'path' | 'env' | 'security' | 'uncategorized' => {
        const validCats = ['config', 'api', 'status', 'error', 'feature_flag', 'limit', 'regex', 'path', 'env', 'security', 'uncategorized'];
        return validCats.includes(cat) ? cat as 'config' | 'api' | 'status' | 'error' | 'feature_flag' | 'limit' | 'regex' | 'path' | 'env' | 'security' | 'uncategorized' : 'uncategorized';
      };
      
      // Save each file's constants
      for (const [file, fileConstants] of constantsByFile) {
        const firstLang = fileConstants[0]?.language;
        await constantStore.saveFileResult({
          file,
          language: mapLanguage(firstLang ?? 'typescript'),
          constants: fileConstants.map(c => ({
            id: `${file}:${c.line}:${c.name}`,
            name: c.name,
            qualifiedName: c.name,
            file,
            line: c.line,
            column: 0,
            endLine: c.line,
            language: mapLanguage(c.language),
            kind: mapKind(c.declarationType ?? 'const'),
            category: mapCategory(c.category),
            value: c.value,
            isExported: c.isExported,
            decorators: [],
            modifiers: [],
            confidence: 0.9,
          })),
          enums: [],
          references: [],
          errors: [],
          quality: {
            method: 'regex',
            confidence: 0.9,
            coveragePercent: 100,
            itemsExtracted: fileConstants.length,
            parseErrors: 0,
            warnings: [],
            usedFallback: !isNativeAvailable(),
            extractionTimeMs: constantsResult.stats.durationMs,
          },
        });
      }
      
      // Rebuild index
      await constantStore.rebuildIndex();
      
      const nativeIndicator = isNativeAvailable() ? ' (native)' : '';
      constantsSpinner.succeed(
        `Extracted ${constantsResult.stats.totalConstants} constants from ${constantsResult.stats.filesAnalyzed} files${nativeIndicator}`
      );
      
      // Show secrets warning if any found
      if (constantsResult.secrets.length > 0) {
        console.log();
        console.log(chalk.bold.red(`🔐 ${constantsResult.secrets.length} Potential Hardcoded Secrets Detected!`));
        
        const critical = constantsResult.secrets.filter(s => s.severity === 'critical' || s.severity === 'high');
        if (critical.length > 0) {
          for (const secret of critical.slice(0, 3)) {
            console.log(chalk.red(`    ${secret.name} (${secret.secretType}) - ${secret.file}:${secret.line}`));
          }
          if (critical.length > 3) {
            console.log(chalk.gray(`    ... and ${critical.length - 3} more`));
          }
        }
        
        console.log();
        console.log(chalk.yellow("Run 'drift constants secrets' to review all potential secrets"));
      }
      
      if (verbose) {
        console.log(chalk.gray(`  Duration: ${constantsResult.stats.durationMs}ms`));
        console.log(chalk.gray(`  Exported: ${constantsResult.stats.exportedCount}`));
      }
      
      console.log();
      console.log(chalk.gray('View constants:'));
      console.log(chalk.cyan('  drift constants'));
      console.log(chalk.cyan('  drift constants list'));
      
    } catch (error) {
      constantsSpinner.fail('Constants extraction failed');
      if (verbose) {
        console.error(chalk.red((error as Error).message));
      }
    }
  }

  // Call graph building (opt-in) - uses native Rust for memory safety
  if (options.callgraph) {
    console.log();
    const callgraphSpinner = createSpinner('Building call graph...');
    callgraphSpinner.start();

    try {
      if (isNativeAvailable()) {
        const callgraphConfig: BuildConfig = {
          root: rootDir,
          patterns: [
            '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
            '**/*.py', '**/*.cs', '**/*.java', '**/*.php',
          ],
          resolutionBatchSize: 50,
        };

        const callgraphResult = await buildCallGraph(callgraphConfig);

        callgraphSpinner.succeed(
          `Built call graph (native): ${callgraphResult.filesProcessed} files, ` +
          `${callgraphResult.totalFunctions.toLocaleString()} functions, ` +
          `${callgraphResult.resolvedCalls.toLocaleString()}/${callgraphResult.totalCalls.toLocaleString()} calls resolved`
        );

        if (verbose) {
          console.log(chalk.gray(`  Entry points: ${callgraphResult.entryPoints}`));
          console.log(chalk.gray(`  Data accessors: ${callgraphResult.dataAccessors}`));
          console.log(chalk.gray(`  Resolution rate: ${Math.round(callgraphResult.resolutionRate * 100)}%`));
          console.log(chalk.gray(`  Duration: ${(callgraphResult.durationMs / 1000).toFixed(2)}s`));
        }

        if (callgraphResult.errors.length > 0 && verbose) {
          console.log(chalk.yellow(`  ⚠️  ${callgraphResult.errors.length} files had parse errors`));
        }

        console.log();
        console.log(chalk.gray('Query the call graph:'));
        console.log(chalk.cyan('  drift callgraph status'));
        console.log(chalk.cyan('  drift callgraph reach <function>'));
        console.log(chalk.cyan('  drift callgraph inverse <table>'));
      } else {
        callgraphSpinner.fail('Call graph requires native module (not available)');
        console.log(chalk.gray('  Run `drift callgraph build` for TypeScript fallback (may OOM on large codebases)'));
      }
    } catch (error) {
      callgraphSpinner.fail('Call graph build failed');
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
    
    // Materialize views and indexes
    // NOTE: We no longer call dataLake.patternShards.saveAll() because PatternStore
    // already writes to .drift/patterns/{status}/{category}.json which is the
    // single source of truth for pattern storage. The lake's pattern shards
    // (.drift/lake/patterns/) were a duplicate that caused confusion.
    const materializeResult = await dataLake.materializer.materialize(
      allPatterns,
      { force: options.force ?? false },
      { 
        lastScan: lastScanInfo,
        // Pass boundary data for manifest stats sync (only if available)
        ...(scanBoundaryResult ? {
          accessMap: scanBoundaryResult.accessMap,
          violations: scanBoundaryResult.violations,
        } : {}),
      }
    );
    
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
    
    // Count auto-approve eligible (≥90% confidence)
    const autoApproveEligible = discovered.filter((p) => p.confidence.score >= 0.90).length;
    
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

    // Post-scan summary with agent assistance prompt
    console.log(chalk.bold('📊 Pattern Review'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Patterns discovered:     ${chalk.cyan(stats.byStatus.discovered)}`);
    console.log(`  Auto-approve eligible:   ${chalk.green(autoApproveEligible)} (≥90% confidence)`);
    console.log(`  Needs review:            ${chalk.yellow(stats.byStatus.discovered - autoApproveEligible)}`);
    console.log();
    
    console.log(chalk.gray('Quick actions:'));
    if (autoApproveEligible > 0) {
      console.log(chalk.cyan(`  drift approve --auto`) + chalk.gray(`     - Auto-approve ${autoApproveEligible} high-confidence patterns`));
    }
    console.log(chalk.cyan(`  drift audit --review`) + chalk.gray(`     - Generate detailed review report`));
    console.log(chalk.cyan(`  drift approve <id>`) + chalk.gray(`       - Approve a specific pattern`));
    console.log();
    
    console.log(chalk.gray('For agent assistance, copy this to your AI assistant:'));
    console.log(chalk.cyan('┌─────────────────────────────────────────────────────────────┐'));
    console.log(chalk.cyan('│') + ' Run `drift audit --review` and approve high-confidence     ' + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ' patterns that match codebase conventions. Flag any that    ' + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ' look like false positives or duplicates.                   ' + chalk.cyan('│'));
    console.log(chalk.cyan('└─────────────────────────────────────────────────────────────┘'));
    console.log();
    
    // Suggest running setup for advanced features
    console.log(chalk.bold.yellow('💡 Next Step: Run advanced analysis'));
    console.log(chalk.gray('  Compute call graphs, test topology, coupling, and more:'));
    console.log(chalk.cyan('    drift setup -y'));
    console.log();
  }

  // Close the store (important for SQLite to flush WAL)
  if (store.close) {
    await store.close();
  }

  // Sync all data to SQLite (ensures drift.db is the source of truth)
  try {
    const { createSyncService } = await import('driftdetect-core/storage');
    const syncService = createSyncService({ rootDir, verbose: false });
    await syncService.initialize();
    await syncService.syncAll();
    await syncService.close();
    if (verbose) {
      console.log(chalk.gray('  All data synced to drift.db'));
    }
  } catch (syncError) {
    if (verbose) {
      console.log(chalk.yellow(`  Warning: Could not sync to SQLite: ${(syncError as Error).message}`));
    }
  }

  console.log();
}

/**
 * Run TypeScript test topology analyzer (fallback when native is unavailable)
 */
async function runTypeScriptTestTopology(
  rootDir: string,
  files: string[],
  verbose: boolean,
  spinner: ReturnType<typeof createSpinner>
): Promise<void> {
  // Initialize test topology analyzer
  const testAnalyzer = createTestTopologyAnalyzer({});

  // Try to load call graph for transitive analysis
  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    if (graph) {
      testAnalyzer.setCallGraph(graph);
    }
  } catch {
    // No call graph available, continue with direct analysis
  }

  // Find test files from the already-discovered files
  const testFilePatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.py$/,
    /test_.*\.py$/,
    /Test\.java$/,
    /Tests\.java$/,
    /Test\.cs$/,
    /Tests\.cs$/,
    /Test\.php$/,
  ];
  
  const testFiles = files.filter(f => testFilePatterns.some(p => p.test(f)));
  
  if (testFiles.length === 0) {
    spinner.succeed('No test files found');
  } else {
    // Extract tests from each file
    let extractedCount = 0;
    for (const testFile of testFiles) {
      try {
        const content = await fs.readFile(path.join(rootDir, testFile), 'utf-8');
        const extraction = testAnalyzer.extractFromFile(content, testFile);
        if (extraction) {extractedCount++;}
      } catch {
        // Skip files that can't be read
      }
    }

    // Build mappings
    testAnalyzer.buildMappings();

    // Get results
    const summary = testAnalyzer.getSummary();
    const mockAnalysis = testAnalyzer.analyzeMocks();

    // Save results
    const testTopologyDir = path.join(rootDir, DRIFT_DIR, 'test-topology');
    await fs.mkdir(testTopologyDir, { recursive: true });
    await fs.writeFile(
      path.join(testTopologyDir, 'summary.json'),
      JSON.stringify({ summary, mockAnalysis, generatedAt: new Date().toISOString() }, null, 2)
    );

    spinner.succeed(
      `Built test topology: ${summary.testFiles} test files, ${summary.testCases} tests, ` +
      `${summary.coveredFunctions}/${summary.totalFunctions} functions covered`
    );

    if (verbose) {
      console.log(chalk.gray(`  Test files extracted: ${extractedCount}/${testFiles.length}`));
      console.log(chalk.gray(`  Coverage: ${summary.coveragePercent}%`));
      if (mockAnalysis.totalMocks > 0) {
        console.log(chalk.gray(`  Mocks: ${mockAnalysis.totalMocks} (${mockAnalysis.externalPercent}% external)`));
      }
    }

    // Show uncovered functions warning
    if (summary.totalFunctions > 0 && summary.functionCoveragePercent < 50) {
      console.log();
      console.log(chalk.yellow(`⚠️  Low test coverage: ${summary.functionCoveragePercent}% of functions covered`));
      console.log(chalk.gray('  Run `drift test-topology uncovered` to find untested code'));
    }

    console.log();
    console.log(chalk.gray('View test topology:'));
    console.log(chalk.cyan('  drift test-topology status'));
    console.log(chalk.cyan('  drift test-topology uncovered'));
  }
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
  .option('--test-topology', 'Build test topology (test-to-code mappings)')
  .option('--constants', 'Extract constants, enums, and detect hardcoded secrets')
  .option('--callgraph', 'Build call graph for reachability analysis (native Rust)')
  .option('-p, --project <name>', 'Scan a specific registered project by name')
  .option('--all-projects', 'Scan all registered projects')
  .option('-t, --timeout <seconds>', 'Scan timeout in seconds (default: 300)', '300')
  .option('--max-file-size <bytes>', 'Max file size to scan in bytes (default: 1MB)', '1048576')
  .action((paths: string[], options: ScanCommandOptions) => {
    // Merge positional paths with options
    if (paths && paths.length > 0) {
      options.paths = paths;
    }
    // Parse timeout as number
    if (typeof options.timeout === 'string') {
      options.timeout = parseInt(options.timeout, 10);
    }
    // Parse maxFileSize as number
    if (typeof options.maxFileSize === 'string') {
      options.maxFileSize = parseInt(options.maxFileSize, 10);
    }
    return scanAction(options);
  });
