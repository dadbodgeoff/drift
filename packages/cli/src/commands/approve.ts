/**
 * Approve Command - drift approve
 *
 * Approve a discovered pattern to enforce it.
 *
 * @requirements 29.5
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  PatternStore,
  InvalidStateTransitionError,
  type PatternCategory,
} from '@drift/core';
import { createSpinner, status } from '../ui/spinner.js';
import { confirmPrompt, promptBatchPatternApproval, type PatternChoice } from '../ui/prompts.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';

export interface ApproveOptions {
  /** Approve all patterns matching a category */
  category?: string;
  /** Skip confirmation prompt */
  yes?: boolean;
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
 * Approve command implementation
 */
async function approveAction(
  patternId: string,
  options: ApproveOptions
): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🔍 Drift - Approve Pattern'));
  console.log();

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  // Initialize pattern store
  const spinner = createSpinner('Loading patterns...');
  spinner.start();

  const store = new PatternStore({ rootDir });
  await store.initialize();

  spinner.succeed('Patterns loaded');

  // Handle category-based approval
  if (options.category) {
    const category = options.category as PatternCategory;
    const discovered = store.getDiscovered().filter((p) => p.category === category);

    if (discovered.length === 0) {
      status.info(`No discovered patterns in category: ${category}`);
      return;
    }

    console.log();
    console.log(chalk.bold(`Discovered patterns in ${category}:`));
    console.log();

    const rows: PatternRow[] = discovered.map((p) => ({
      id: p.id.slice(0, 13),
      name: p.name.slice(0, 28),
      category: p.category,
      confidence: p.confidence.score,
      locations: p.locations.length,
      outliers: p.outliers.length,
    }));

    console.log(createPatternsTable(rows));
    console.log();

    // Confirm approval
    if (!options.yes) {
      const confirm = await confirmPrompt(
        `Approve all ${discovered.length} patterns in ${category}?`,
        false
      );
      if (!confirm) {
        status.info('Approval cancelled');
        return;
      }
    }

    // Approve all patterns in category
    const approveSpinner = createSpinner('Approving patterns...');
    approveSpinner.start();

    let approvedCount = 0;
    for (const pattern of discovered) {
      try {
        store.approve(pattern.id);
        approvedCount++;
        if (verbose) {
          console.log(chalk.gray(`  Approved: ${pattern.name}`));
        }
      } catch (error) {
        if (error instanceof InvalidStateTransitionError) {
          if (verbose) {
            console.log(chalk.yellow(`  Skipped (already approved): ${pattern.name}`));
          }
        } else {
          throw error;
        }
      }
    }

    await store.saveAll();
    approveSpinner.succeed(`Approved ${approvedCount} patterns`);
    console.log();
    return;
  }

  // Handle single pattern approval
  // Check for special pattern IDs
  if (patternId === 'all') {
    const discovered = store.getDiscovered();

    if (discovered.length === 0) {
      status.info('No discovered patterns to approve');
      return;
    }

    // Interactive batch approval
    if (!options.yes) {
      const choices: PatternChoice[] = discovered.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        confidence: p.confidence.score,
      }));

      const selectedIds = await promptBatchPatternApproval(choices);

      if (selectedIds.length === 0) {
        status.info('No patterns selected');
        return;
      }

      const approveSpinner = createSpinner('Approving patterns...');
      approveSpinner.start();

      let approvedCount = 0;
      for (const id of selectedIds) {
        try {
          store.approve(id);
          approvedCount++;
        } catch {
          // Skip errors
        }
      }

      await store.saveAll();
      approveSpinner.succeed(`Approved ${approvedCount} patterns`);
      console.log();
      return;
    }

    // Non-interactive: approve all
    const approveSpinner = createSpinner('Approving all patterns...');
    approveSpinner.start();

    let approvedCount = 0;
    for (const pattern of discovered) {
      try {
        store.approve(pattern.id);
        approvedCount++;
      } catch {
        // Skip errors
      }
    }

    await store.saveAll();
    approveSpinner.succeed(`Approved ${approvedCount} patterns`);
    console.log();
    return;
  }

  // Approve single pattern by ID
  const pattern = store.get(patternId);

  if (!pattern) {
    // Try to find by partial ID match
    const allPatterns = store.getAll();
    const matches = allPatterns.filter(
      (p) => p.id.includes(patternId) || p.name.toLowerCase().includes(patternId.toLowerCase())
    );

    if (matches.length === 0) {
      status.error(`Pattern not found: ${patternId}`);
      console.log();
      console.log(chalk.gray('Use `drift status -d` to see available patterns'));
      process.exit(1);
    }

    if (matches.length === 1) {
      // Single match, use it
      const match = matches[0]!;
      console.log(chalk.gray(`Found pattern: ${match.id}`));
      console.log();

      if (!options.yes) {
        const confirm = await confirmPrompt(`Approve pattern "${match.name}"?`, true);
        if (!confirm) {
          status.info('Approval cancelled');
          return;
        }
      }

      try {
        store.approve(match.id);
        await store.saveAll();
        status.success(`Approved pattern: ${match.name}`);
      } catch (error) {
        if (error instanceof InvalidStateTransitionError) {
          status.warning(`Pattern is already approved: ${match.name}`);
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

    const rows: PatternRow[] = matches.slice(0, 10).map((p) => ({
      id: p.id.slice(0, 13),
      name: p.name.slice(0, 28),
      category: p.category,
      confidence: p.confidence.score,
      locations: p.locations.length,
      outliers: p.outliers.length,
    }));

    console.log(createPatternsTable(rows));

    if (matches.length > 10) {
      console.log(chalk.gray(`  ... and ${matches.length - 10} more`));
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
  console.log(`  Confidence:  ${(pattern.confidence.score * 100).toFixed(0)}% (${pattern.confidence.level})`);
  console.log(`  Locations:   ${pattern.locations.length}`);
  console.log(`  Outliers:    ${pattern.outliers.length}`);
  console.log(`  Severity:    ${pattern.severity}`);
  console.log();

  // Check if already approved
  if (pattern.status === 'approved') {
    status.warning('Pattern is already approved');
    console.log();
    return;
  }

  // Confirm approval
  if (!options.yes) {
    const confirm = await confirmPrompt(`Approve pattern "${pattern.name}"?`, true);
    if (!confirm) {
      status.info('Approval cancelled');
      return;
    }
  }

  // Approve the pattern
  try {
    store.approve(patternId);
    await store.saveAll();
    status.success(`Approved pattern: ${pattern.name}`);
  } catch (error) {
    if (error instanceof InvalidStateTransitionError) {
      status.error(`Cannot approve pattern from status: ${pattern.status}`);
    } else {
      throw error;
    }
  }

  console.log();
}

export const approveCommand = new Command('approve')
  .description('Approve a pattern by ID')
  .argument('<pattern-id>', 'Pattern ID to approve (or "all" for batch approval)')
  .option('-c, --category <category>', 'Approve all patterns in category')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--verbose', 'Enable verbose output')
  .action(approveAction);
