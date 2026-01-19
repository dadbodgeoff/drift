/**
 * Status Command - drift status
 *
 * Show current drift status including patterns and violations.
 *
 * @requirements 29.4
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { PatternStore, type PatternCategory } from '@drift/core';
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

  // Initialize pattern store
  const spinner = format === 'text' ? createSpinner('Loading patterns...') : null;
  spinner?.start();

  const store = new PatternStore({ rootDir });
  await store.initialize();

  spinner?.succeed('Patterns loaded');

  // Get statistics
  const stats = store.getStats();

  // JSON output
  if (format === 'json') {
    const output = {
      initialized: true,
      patterns: {
        total: stats.totalPatterns,
        approved: stats.byStatus.approved,
        discovered: stats.byStatus.discovered,
        ignored: stats.byStatus.ignored,
      },
      byCategory: stats.byCategory,
      byConfidenceLevel: stats.byConfidenceLevel,
      locations: stats.totalLocations,
      outliers: stats.totalOutliers,
      lastUpdated: stats.lastUpdated,
    };

    if (detailed) {
      const allPatterns = store.getAll();
      (output as Record<string, unknown>)['patternDetails'] = allPatterns.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        confidence: p.confidence.score,
        confidenceLevel: p.confidence.level,
        locations: p.locations.length,
        outliers: p.outliers.length,
        severity: p.severity,
      }));
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Text output
  console.log();

  // Summary table
  const summary: StatusSummary = {
    totalPatterns: stats.totalPatterns,
    approvedPatterns: stats.byStatus.approved,
    discoveredPatterns: stats.byStatus.discovered,
    ignoredPatterns: stats.byStatus.ignored,
    totalViolations: stats.totalOutliers,
    errors: 0,
    warnings: stats.totalOutliers,
  };

  console.log(chalk.bold('Pattern Summary'));
  console.log(createStatusTable(summary));
  console.log();

  // Category breakdown
  const categories: CategoryBreakdown[] = Object.entries(stats.byCategory)
    .filter(([_, count]) => count > 0)
    .map(([category, count]) => {
      const categoryPatterns = store.getByCategory(category as PatternCategory);
      const violations = categoryPatterns.reduce((sum, p) => sum + p.outliers.length, 0);
      const avgConfidence =
        categoryPatterns.length > 0
          ? categoryPatterns.reduce((sum, p) => sum + p.confidence.score, 0) / categoryPatterns.length
          : 0;

      return {
        category,
        patterns: count,
        violations,
        coverage: avgConfidence,
      };
    })
    .sort((a, b) => b.patterns - a.patterns);

  if (categories.length > 0) {
    console.log(chalk.bold('By Category'));
    console.log(createCategoryTable(categories));
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
    // Show discovered patterns awaiting review
    const discovered = store.getDiscovered();
    if (discovered.length > 0) {
      console.log(chalk.bold('Discovered Patterns (awaiting review)'));
      console.log();

      const rows: PatternRow[] = discovered
        .sort((a, b) => b.confidence.score - a.confidence.score)
        .slice(0, 20)
        .map((p) => ({
          id: p.id.slice(0, 13),
          name: p.name.slice(0, 28),
          category: p.category,
          confidence: p.confidence.score,
          locations: p.locations.length,
          outliers: p.outliers.length,
        }));

      console.log(createPatternsTable(rows));

      if (discovered.length > 20) {
        console.log(chalk.gray(`  ... and ${discovered.length - 20} more`));
      }
      console.log();
    }

    // Show approved patterns
    const approved = store.getApproved();
    if (approved.length > 0) {
      console.log(chalk.bold('Approved Patterns'));
      console.log();

      const rows: PatternRow[] = approved
        .sort((a, b) => b.outliers.length - a.outliers.length)
        .slice(0, 20)
        .map((p) => ({
          id: p.id.slice(0, 13),
          name: p.name.slice(0, 28),
          category: p.category,
          confidence: p.confidence.score,
          locations: p.locations.length,
          outliers: p.outliers.length,
        }));

      console.log(createPatternsTable(rows));

      if (approved.length > 20) {
        console.log(chalk.gray(`  ... and ${approved.length - 20} more`));
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
}

export const statusCommand = new Command('status')
  .description('Show current drift status')
  .option('-d, --detailed', 'Show detailed information')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(statusAction);
