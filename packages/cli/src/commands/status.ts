/**
 * Status Command - drift status
 *
 * Show current drift status including patterns and violations.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * @requirements 29.4
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { createCLIPatternService } from '../services/pattern-service-factory.js';
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

  // Initialize pattern service
  const spinner = format === 'text' ? createSpinner('Loading patterns...') : null;
  spinner?.start();

  const service = createCLIPatternService(rootDir);

  // Get status (auto-initializes)
  const patternStatus = await service.getStatus();
  const categories = await service.getCategories();

  spinner?.succeed('Patterns loaded');

  // JSON output
  if (format === 'json') {
    const output = {
      initialized: true,
      patterns: {
        total: patternStatus.totalPatterns,
        approved: patternStatus.byStatus.approved,
        discovered: patternStatus.byStatus.discovered,
        ignored: patternStatus.byStatus.ignored,
      },
      byCategory: patternStatus.byCategory,
      byConfidenceLevel: patternStatus.byConfidence,
      healthScore: patternStatus.healthScore,
      lastUpdated: patternStatus.lastScanAt?.toISOString(),
    };

    if (detailed) {
      const result = await service.listPatterns({ limit: 1000 });
      (output as Record<string, unknown>)['patternDetails'] = result.items.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        confidence: p.confidence,
        confidenceLevel: p.confidenceLevel,
        locations: p.locationCount,
        outliers: p.outlierCount,
      }));
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Text output
  console.log();

  // Summary table
  const summary: StatusSummary = {
    totalPatterns: patternStatus.totalPatterns,
    approvedPatterns: patternStatus.byStatus.approved,
    discoveredPatterns: patternStatus.byStatus.discovered,
    ignoredPatterns: patternStatus.byStatus.ignored,
    totalViolations: 0, // Would need to query for this
    errors: 0,
    warnings: 0,
  };

  console.log(chalk.bold('Pattern Summary'));
  console.log(createStatusTable(summary));
  console.log();

  // Health score
  console.log(chalk.bold('Health Score'));
  console.log(chalk.gray('─'.repeat(40)));
  const healthColor = patternStatus.healthScore >= 80 ? chalk.green : 
                      patternStatus.healthScore >= 50 ? chalk.yellow : chalk.red;
  console.log(`  ${healthColor(patternStatus.healthScore + '/100')}`);
  console.log();

  // Category breakdown
  const categoryBreakdowns: CategoryBreakdown[] = categories
    .filter((c) => c.count > 0)
    .map((c) => ({
      category: c.category,
      patterns: c.count,
      violations: 0, // Would need to calculate
      coverage: c.highConfidenceCount / Math.max(1, c.count),
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
  console.log(`  ${chalk.green('High')}:      ${patternStatus.byConfidence.high}`);
  console.log(`  ${chalk.yellow('Medium')}:    ${patternStatus.byConfidence.medium}`);
  console.log(`  ${chalk.red('Low')}:       ${patternStatus.byConfidence.low}`);
  console.log(`  ${chalk.gray('Uncertain')}: ${patternStatus.byConfidence.uncertain}`);
  console.log();

  // Detailed pattern list
  if (detailed) {
    // Show discovered patterns awaiting review
    const discoveredResult = await service.listByStatus('discovered', { 
      limit: 20,
      sortBy: 'confidence',
      sortDirection: 'desc',
    });
    
    if (discoveredResult.items.length > 0) {
      console.log(chalk.bold('Discovered Patterns (awaiting review)'));
      console.log();

      const rows: PatternRow[] = discoveredResult.items.map((p) => ({
        id: p.id.slice(0, 13),
        name: p.name.slice(0, 28),
        category: p.category,
        confidence: p.confidence,
        locations: p.locationCount,
        outliers: p.outlierCount,
      }));

      console.log(createPatternsTable(rows));

      if (discoveredResult.total > 20) {
        console.log(chalk.gray(`  ... and ${discoveredResult.total - 20} more`));
      }
      console.log();
    }

    // Show approved patterns
    const approvedResult = await service.listByStatus('approved', {
      limit: 20,
      sortBy: 'confidence',
      sortDirection: 'desc',
    });
    
    if (approvedResult.items.length > 0) {
      console.log(chalk.bold('Approved Patterns'));
      console.log();

      const rows: PatternRow[] = approvedResult.items.map((p) => ({
        id: p.id.slice(0, 13),
        name: p.name.slice(0, 28),
        category: p.category,
        confidence: p.confidence,
        locations: p.locationCount,
        outliers: p.outlierCount,
      }));

      console.log(createPatternsTable(rows));

      if (approvedResult.total > 20) {
        console.log(chalk.gray(`  ... and ${approvedResult.total - 20} more`));
      }
      console.log();
    }
  }

  // Quick actions
  if (patternStatus.byStatus.discovered > 0) {
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
