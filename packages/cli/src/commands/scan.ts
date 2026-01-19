/**
 * Scan Command - drift scan
 *
 * Perform a full codebase scan to discover patterns.
 *
 * @requirements 29.2
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  PatternStore,
  FileWalker,
  type ScanOptions,
} from '@drift/core';
import { createSpinner, status } from '../ui/spinner.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';

export interface ScanCommandOptions {
  /** Specific paths to scan */
  paths?: string[];
  /** Enable verbose output */
  verbose?: boolean;
  /** Force rescan even if cache is valid */
  force?: boolean;
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
 * Scan command implementation
 */
async function scanAction(options: ScanCommandOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🔍 Drift - Scanning Codebase'));
  console.log();

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

  // Scan files with progress
  const scanSpinner = createSpinner('Analyzing patterns...');
  scanSpinner.start();

  let processedFiles = 0;
  const startTime = Date.now();

  try {
    // Process files in batches
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      for (const file of batch) {
        processedFiles++;
        
        // Update spinner text periodically
        if (processedFiles % 10 === 0) {
          scanSpinner.text(`Analyzing patterns... (${processedFiles}/${files.length})`);
        }

        // Read file content
        try {
          const filePath = path.join(rootDir, file);
          await fs.readFile(filePath, 'utf-8');
          
          // Pattern detection would happen here with detectors
          // For now, we just track the files
        } catch {
          // Failed to read file, skip
          if (verbose) {
            console.log(chalk.gray(`  Skipped unreadable file: ${file}`));
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    scanSpinner.succeed(`Analyzed ${processedFiles} files in ${duration}s`);
  } catch (error) {
    scanSpinner.fail('Scan failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Save patterns
  const saveSpinner = createSpinner('Saving patterns...');
  saveSpinner.start();

  try {
    await store.saveAll();
    saveSpinner.succeed('Patterns saved');
  } catch (error) {
    saveSpinner.fail('Failed to save patterns');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Summary
  console.log();
  const stats = store.getStats();
  
  console.log(chalk.bold('Scan Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Files scanned:      ${chalk.cyan(processedFiles)}`);
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
  .description('Scan codebase for patterns')
  .option('-p, --paths <paths...>', 'Specific paths to scan')
  .option('--force', 'Force rescan even if cache is valid')
  .option('--verbose', 'Enable verbose output')
  .action(scanAction);
