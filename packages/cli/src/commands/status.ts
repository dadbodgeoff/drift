/**
 * Status Command - drift status
 *
 * Show current drift status including patterns and violations.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 * Supports both SQLite and JSON storage backends.
 *
 * @requirements 29.4
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { createCLIPatternStore, getCLIStorageInfo } from '../services/pattern-service-factory.js';
import { createSpinner, status } from '../ui/spinner.js';
import {
  createPatternsTable,
  createStatusTable,
  createCategoryTable,
  type PatternRow,
  type StatusSummary,
  type CategoryBreakdown,
} from '../ui/table.js';

export interface StatusOptions {
  /** Show detailed information */
  detailed?: boolean;
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
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
 * Status command implementation
 */
async function statusAction(options: StatusOptions): Promise<void> {
  const rootDir = process.cwd();
  const detailed = options.detailed ?? false;
  const format = options.format ?? 'text';

  if (format === 'text') {
    console.log();
    console.log(chalk.bold('🔍 Drift - Status'));
    console.log();
  }

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Drift is not initialized' }));
    } else {
      status.error('Drift is not initialized. Run `drift init` first.');
    }
    process.exit(1);
  }

  // Initialize pattern store (auto-detects SQLite vs JSON)
  const spinner = format === 'text' ? createSpinner('Loading patterns...') : null;
  spinner?.start();

  const store = await createCLIPatternStore(rootDir);
  const stats = store.getStats();

  spinner?.succeed('Patterns loaded');

  // JSON output
  if (format === 'json') {
    const storageInfo = getCLIStorageInfo(rootDir);
    const output = {
      initialized: true,
      storage: {
        backend: storageInfo.backend,
        hasSqlite: storageInfo.hasSqlite,
        hasJson: storageInfo.hasJson,
      },
      patterns: {
        total: stats.totalPatterns,
        approved: stats.byStatus.approved,
        discovered: stats.byStatus.discovered,
        ignored: stats.byStatus.ignored,
      },
      byCategory: stats.byCategory,
      byConfidenceLevel: stats.byConfidenceLevel,
      healthScore: calculateHealthScore(stats),
    };

    if (detailed) {
      const patterns = store.getAll();
      (output as Record<string, unknown>)['patternDetails'] = patterns.slice(0, 1000).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        confidence: p.confidence.score,
        confidenceLevel: p.confidence.level,
        locations: p.locations.length,
        outliers: p.outliers.length,
      }));
    }

    console.log(JSON.stringify(output, null, 2));
    if (store.close) await store.close();
    return;
  }

  // Text output
  console.log();

  // Storage backend info
  const storageInfo = getCLIStorageInfo(rootDir);
  console.log(chalk.bold('Storage'));
  console.log(chalk.gray('─'.repeat(40)));
  const backendLabel = storageInfo.backend === 'sqlite' ? chalk.green('SQLite') : 
                       storageInfo.backend === 'json' ? chalk.yellow('JSON') : chalk.gray('None');
  console.log(`  Backend: ${backendLabel}`);
  if (storageInfo.hasSqlite && storageInfo.hasJson) {
    console.log(chalk.gray('  (Both SQLite and JSON available)'));
  }
  console.log();

  // Summary table
  const summary: StatusSummary = {
    totalPatterns: stats.totalPatterns,
    approvedPatterns: stats.byStatus.approved,
    discoveredPatterns: stats.byStatus.discovered,
    ignoredPatterns: stats.byStatus.ignored,
    totalViolations: 0,
    errors: 0,
    warnings: 0,
  };

  console.log(chalk.bold('Pattern Summary'));
  console.log(createStatusTable(summary));
  console.log();

  // Health score
  const healthScore = calculateHealthScore(stats);
  console.log(chalk.bold('Health Score'));
  console.log(chalk.gray('─'.repeat(40)));
  const healthColor = healthScore >= 80 ? chalk.green : 
                      healthScore >= 50 ? chalk.yellow : chalk.red;
  console.log(`  ${healthColor(healthScore + '/100')}`);
  console.log();

  // Category breakdown
  const categoryBreakdowns: CategoryBreakdown[] = Object.entries(stats.byCategory)
    .filter(([_, count]) => count > 0)
    .map(([category, count]) => ({
      category,
      patterns: count,
      violations: 0,
      coverage: 0,
    }))
    .sort((a, b) => b.patterns - a.patterns);

  if (categoryBreakdowns.length > 0) {
    console.log(chalk.bold('By Category'));
    console.log(createCategoryTable(categoryBreakdowns));
    console.log();
  }

  // Confidence breakdown
  console.log(chalk.bold('By Confidence Level'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ${chalk.green('High')}:      ${stats.byConfidenceLevel.high}`);
  console.log(`  ${chalk.yellow('Medium')}:    ${stats.byConfidenceLevel.medium}`);
  console.log(`  ${chalk.red('Low')}:       ${stats.byConfidenceLevel.low}`);
  console.log(`  ${chalk.gray('Uncertain')}: ${stats.byConfidenceLevel.uncertain}`);
  console.log();

  // Detailed pattern list
  if (detailed) {
    const discoveredPatterns = store.getDiscovered().slice(0, 20);
    
    if (discoveredPatterns.length > 0) {
      console.log(chalk.bold('Discovered Patterns (awaiting review)'));
      console.log();

      const rows: PatternRow[] = discoveredPatterns.map((p) => ({
        id: p.id.slice(0, 13),
        name: p.name.slice(0, 28),
        category: p.category,
        confidence: p.confidence.score,
        locations: p.locations.length,
        outliers: p.outliers.length,
      }));

      console.log(createPatternsTable(rows));

      const totalDiscovered = stats.byStatus.discovered;
      if (totalDiscovered > 20) {
        console.log(chalk.gray(`  ... and ${totalDiscovered - 20} more`));
      }
      console.log();
    }

    const approvedPatterns = store.getApproved().slice(0, 20);
    
    if (approvedPatterns.length > 0) {
      console.log(chalk.bold('Approved Patterns'));
      console.log();

      const rows: PatternRow[] = approvedPatterns.map((p) => ({
        id: p.id.slice(0, 13),
        name: p.name.slice(0, 28),
        category: p.category,
        confidence: p.confidence.score,
        locations: p.locations.length,
        outliers: p.outliers.length,
      }));

      console.log(createPatternsTable(rows));

      const totalApproved = stats.byStatus.approved;
      if (totalApproved > 20) {
        console.log(chalk.gray(`  ... and ${totalApproved - 20} more`));
      }
      console.log();
    }
  }

  // Quick actions
  if (stats.byStatus.discovered > 0) {
    console.log(chalk.gray('Quick actions:'));
    console.log(chalk.cyan('  drift approve <pattern-id>') + chalk.gray('  - Approve a pattern'));
    console.log(chalk.cyan('  drift ignore <pattern-id>') + chalk.gray('   - Ignore a pattern'));
    console.log(chalk.cyan('  drift check') + chalk.gray('                 - Check for violations'));
    console.log();
  }

  if (store.close) await store.close();
}

/**
 * Calculate health score from stats
 */
function calculateHealthScore(stats: { totalPatterns: number; byStatus: { approved: number }; byConfidenceLevel: { high: number } }): number {
  if (stats.totalPatterns === 0) return 100;
  
  // Simple health score based on approval rate and confidence
  const approvalRate = stats.byStatus.approved / stats.totalPatterns;
  const highConfidenceRate = stats.byConfidenceLevel.high / stats.totalPatterns;
  
  return Math.round((approvalRate * 50 + highConfidenceRate * 50) * 100) / 100;
}

export const statusCommand = new Command('status')
  .description('Show current drift status')
  .option('-d, --detailed', 'Show detailed information')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(statusAction);
