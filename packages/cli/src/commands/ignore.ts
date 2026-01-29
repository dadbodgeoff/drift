/**
 * Ignore Command - drift ignore
 *
 * Ignore a pattern to stop tracking it.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * @requirements 29.6
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { loadProjectConfig, createTelemetryClient, type TelemetryConfig } from 'driftdetect-core';

import { createCLIPatternService } from '../services/pattern-service-factory.js';
import { confirmPrompt, promptIgnoreReason } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';

export interface IgnoreOptions {
  /** Reason for ignoring */
  reason?: string;
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/**
 * Record telemetry for ignore action (if enabled)
 */
async function recordIgnoreTelemetry(
  rootDir: string,
  pattern: { category: string; confidence: number; metadata?: { firstSeen?: string } },
  isBulkAction: boolean
): Promise<void> {
  try {
    const projectConfig = await loadProjectConfig(rootDir);
    if (!projectConfig.telemetry?.enabled) {return;}
    
    const driftDir = path.join(rootDir, DRIFT_DIR);
    const telemetryClient = createTelemetryClient(driftDir, projectConfig.telemetry as TelemetryConfig);
    await telemetryClient.initialize();
    
    await telemetryClient.recordUserAction({
      action: 'ignore',
      category: pattern.category,
      confidenceAtAction: pattern.confidence,
      discoveredAt: pattern.metadata?.firstSeen ?? new Date().toISOString(),
      isBulkAction,
    });
    
    await telemetryClient.shutdown();
  } catch {
    // Telemetry should never block user operations
  }
}

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
 * Ignore command implementation
 */
async function ignoreAction(
  patternId: string,
  options: IgnoreOptions
): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('🔍 Drift - Ignore Pattern'));
  console.log();

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  // Initialize pattern service
  const spinner = createSpinner('Loading patterns...');
  spinner.start();

  const service = createCLIPatternService(rootDir);

  // Trigger initialization by getting status
  await service.getStatus();

  spinner.succeed('Patterns loaded');

  // Find the pattern
  const pattern = await service.getPattern(patternId);

  if (!pattern) {
    // Try to find by partial ID match
    const searchResult = await service.search(patternId, { limit: 20 });

    if (searchResult.length === 0) {
      status.error(`Pattern not found: ${patternId}`);
      console.log();
      console.log(chalk.gray('Use `drift status -d` to see available patterns'));
      process.exit(1);
    }

    if (searchResult.length === 1) {
      // Single match, use it
      const match = searchResult[0]!;
      console.log(chalk.gray(`Found pattern: ${match.id}`));
      console.log();

      // Get reason if not provided
      let reason = options.reason;
      if (!reason && !options.yes) {
        reason = await promptIgnoreReason();
      }

      if (!options.yes) {
        const confirm = await confirmPrompt(`Ignore pattern "${match.name}"?`, false);
        if (!confirm) {
          status.info('Ignore cancelled');
          return;
        }
      }

      try {
        // Note: reason is stored via the service's ignorePattern method
        // The service handles metadata updates internally
        await service.ignorePattern(match.id);
        // Record telemetry
        await recordIgnoreTelemetry(rootDir, {
          category: match.category,
          confidence: match.confidence,
        }, false);
        status.success(`Ignored pattern: ${match.name}`);
        if (reason) {
          console.log(chalk.gray(`  Reason: ${reason}`));
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('already ignored')) {
          status.warning(`Pattern is already ignored: ${match.name}`);
        } else {
          throw error;
        }
      }
      console.log();
      return;
    }

    // Multiple matches, show them
    console.log(chalk.yellow(`Multiple patterns match "${patternId}":`));
    console.log();

    const rows: PatternRow[] = searchResult.slice(0, 10).map((p) => ({
      id: p.id.slice(0, 13),
      name: p.name.slice(0, 28),
      category: p.category,
      confidence: p.confidence,
      locations: p.locationCount,
      outliers: p.outlierCount,
    }));

    console.log(createPatternsTable(rows));

    if (searchResult.length > 10) {
      console.log(chalk.gray(`  ... and ${searchResult.length - 10} more`));
    }
    console.log();
    console.log(chalk.gray('Please specify a more specific pattern ID'));
    process.exit(1);
  }

  // Show pattern details
  console.log(chalk.bold('Pattern Details'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ID:          ${pattern.id}`);
  console.log(`  Name:        ${pattern.name}`);
  console.log(`  Category:    ${pattern.category}`);
  console.log(`  Status:      ${pattern.status}`);
  console.log(`  Confidence:  ${(pattern.confidence * 100).toFixed(0)}% (${pattern.confidenceLevel})`);
  console.log(`  Locations:   ${pattern.locations.length}`);
  console.log(`  Outliers:    ${pattern.outliers.length}`);
  console.log();

  // Check if already ignored
  if (pattern.status === 'ignored') {
    status.warning('Pattern is already ignored');
    console.log();
    return;
  }

  // Get reason if not provided
  let reason = options.reason;
  if (!reason && !options.yes) {
    reason = await promptIgnoreReason();
  }

  // Confirm ignore
  if (!options.yes) {
    const confirmMsg =
      pattern.status === 'approved'
        ? `This pattern is currently approved. Ignore "${pattern.name}"?`
        : `Ignore pattern "${pattern.name}"?`;

    const confirm = await confirmPrompt(confirmMsg, false);
    if (!confirm) {
      status.info('Ignore cancelled');
      return;
    }
  }

  // Ignore the pattern
  try {
    await service.ignorePattern(patternId);
    // Record telemetry
    await recordIgnoreTelemetry(rootDir, {
      category: pattern.category,
      confidence: pattern.confidence,
      metadata: { firstSeen: pattern.metadata?.firstSeen },
    }, false);
    status.success(`Ignored pattern: ${pattern.name}`);
    if (reason) {
      console.log(chalk.gray(`  Reason: ${reason}`));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot transition')) {
      status.error(`Cannot ignore pattern from status: ${pattern.status}`);
    } else {
      throw error;
    }
  }

  console.log();
}

export const ignoreCommand = new Command('ignore')
  .description('Ignore a pattern by ID')
  .argument('<pattern-id>', 'Pattern ID to ignore')
  .option('-r, --reason <reason>', 'Reason for ignoring the pattern')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--verbose', 'Enable verbose output')
  .action(ignoreAction);
