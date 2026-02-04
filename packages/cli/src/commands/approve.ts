/**
 * Approve Command - drift approve
 *
 * Approve a discovered pattern to enforce it.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * @requirements 29.5
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { createCLIPatternServiceAsync } from '../services/pattern-service-factory.js';
import { confirmPrompt, promptBatchPatternApproval, type PatternChoice } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';
import { createPatternsTable, type PatternRow } from '../ui/table.js';

import { loadProjectConfig, createTelemetryClient } from 'driftdetect-core';
import type { PatternCategory, TelemetryConfig } from 'driftdetect-core';

export interface ApproveOptions {
  /** Approve all patterns matching a category */
  category?: string;
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Enable verbose output */
  verbose?: boolean;
  /** Project root directory */
  root?: string;
  /** Auto-approve patterns with ≥90% confidence */
  auto?: boolean;
  /** Custom confidence threshold for auto-approve (default: 0.90) */
  threshold?: number;
  /** Dry run - show what would be approved */
  dryRun?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/**
 * Record telemetry for approve action (if enabled)
 */
async function recordApproveTelemetry(
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
      action: 'approve',
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
 * Resolve the project root directory.
 * Priority: --root option > detect .drift folder > cwd
 */
async function resolveProjectRoot(rootOption?: string): Promise<string> {
  // If --root is specified, use it
  if (rootOption) {
    const resolved = path.resolve(rootOption);
    try {
      await fs.access(path.join(resolved, DRIFT_DIR));
      return resolved;
    } catch {
      // .drift doesn't exist at specified root, but use it anyway
      return resolved;
    }
  }

  // Try to find .drift folder starting from cwd and going up
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    try {
      await fs.access(path.join(current, DRIFT_DIR));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }

  // Fall back to cwd
  return process.cwd();
}

/**
 * Approve command implementation
 */
async function approveAction(
  patternId: string,
  options: ApproveOptions
): Promise<void> {
  const rootDir = await resolveProjectRoot(options.root);
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🔍 Drift - Approve Pattern'));
  console.log(chalk.dim(`Project: ${rootDir}`));
  console.log();

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  // Initialize pattern service
  const spinner = createSpinner('Loading patterns...');
  spinner.start();

  // Use async service to read from SQLite (the source of truth)
  const service = await createCLIPatternServiceAsync(rootDir);

  // Get discovered patterns (auto-initializes)
  const discoveredResult = await service.listByStatus('discovered', { limit: 1000 });
  
  spinner.succeed('Patterns loaded');

  // Handle auto-approve (≥90% confidence by default)
  if (options.auto) {
    const threshold = options.threshold ?? 0.90;
    const discovered = discoveredResult.items;
    
    // Filter by confidence threshold
    const eligible = discovered.filter(p => p.confidence >= threshold);
    
    if (eligible.length === 0) {
      status.info(`No patterns with ≥${(threshold * 100).toFixed(0)}% confidence to auto-approve`);
      console.log();
      console.log(chalk.gray(`Found ${discovered.length} discovered patterns, but none meet the threshold.`));
      console.log(chalk.gray(`Try lowering the threshold with --threshold 0.80`));
      return;
    }

    console.log();
    console.log(chalk.bold(`Auto-Approve Candidates (≥${(threshold * 100).toFixed(0)}% confidence)`));
    console.log();

    const rows: PatternRow[] = eligible.slice(0, 20).map((p) => ({
      id: p.id.slice(0, 13),
      name: p.name.slice(0, 28),
      category: p.category,
      confidence: p.confidence,
      locations: p.locationCount,
      outliers: p.outlierCount,
    }));

    console.log(createPatternsTable(rows));
    
    if (eligible.length > 20) {
      console.log(chalk.gray(`  ... and ${eligible.length - 20} more`));
    }
    console.log();

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.yellow('Dry run mode - no patterns were approved'));
      console.log(chalk.gray(`Would approve ${eligible.length} patterns`));
      return;
    }

    // Confirm unless --yes
    if (!options.yes) {
      const confirm = await confirmPrompt(
        `Auto-approve ${eligible.length} patterns with ≥${(threshold * 100).toFixed(0)}% confidence?`,
        true
      );
      if (!confirm) {
        status.info('Auto-approval cancelled');
        return;
      }
    }

    // Approve all eligible patterns
    const approveSpinner = createSpinner('Auto-approving patterns...');
    approveSpinner.start();

    let approvedCount = 0;
    for (const pattern of eligible) {
      try {
        await service.approvePattern(pattern.id);
        approvedCount++;
        await recordApproveTelemetry(rootDir, {
          category: pattern.category,
          confidence: pattern.confidence,
        }, true);
        if (verbose) {
          console.log(chalk.gray(`  ✓ ${pattern.name} (${(pattern.confidence * 100).toFixed(0)}%)`));
        }
      } catch (error) {
        if (verbose) {
          console.log(chalk.yellow(`  ✗ ${pattern.name}: ${(error as Error).message}`));
        }
      }
    }

    approveSpinner.succeed(`Auto-approved ${approvedCount} patterns (≥${(threshold * 100).toFixed(0)}% confidence)`);
    console.log();
    
    // Show remaining patterns
    const remaining = discovered.length - approvedCount;
    if (remaining > 0) {
      console.log(chalk.gray(`${remaining} patterns remain below threshold. Run \`drift audit --review\` for details.`));
      console.log();
    }
    return;
  }

  // Handle category-based approval
  if (options.category) {
    const category = options.category as PatternCategory;
    const categoryResult = await service.listByCategory(category, { limit: 1000 });
    const discovered = categoryResult.items.filter((p) => p.status === 'discovered');

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
      confidence: p.confidence,
      locations: p.locationCount,
      outliers: p.outlierCount,
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
        await service.approvePattern(pattern.id);
        approvedCount++;
        // Record telemetry for each approved pattern
        await recordApproveTelemetry(rootDir, {
          category: pattern.category,
          confidence: pattern.confidence,
        }, true);
        if (verbose) {
          console.log(chalk.gray(`  Approved: ${pattern.name}`));
        }
      } catch (error) {
        if (verbose) {
          console.log(chalk.yellow(`  Skipped: ${pattern.name}`));
        }
      }
    }

    approveSpinner.succeed(`Approved ${approvedCount} patterns`);
    console.log();
    return;
  }

  // Handle single pattern approval
  // Check for special pattern IDs
  if (patternId === 'all') {
    const discovered = discoveredResult.items;

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
        confidence: p.confidence,
      }));

      const selectedIds = await promptBatchPatternApproval(choices);

      if (selectedIds.length === 0) {
        status.info('No patterns selected');
        return;
      }

      const approveSpinner = createSpinner('Approving patterns...');
      approveSpinner.start();

      const approved = await service.approveMany(selectedIds);
      
      // Record telemetry for batch approval
      for (const p of approved) {
        await recordApproveTelemetry(rootDir, {
          category: p.category,
          confidence: p.confidence,
          metadata: { firstSeen: p.metadata?.firstSeen },
        }, true);
      }

      approveSpinner.succeed(`Approved ${approved.length} patterns`);
      console.log();
      return;
    }

    // Non-interactive: approve all
    const approveSpinner = createSpinner('Approving all patterns...');
    approveSpinner.start();

    const ids = discovered.map((p) => p.id);
    const approved = await service.approveMany(ids);
    
    // Record telemetry for batch approval
    for (const p of approved) {
      await recordApproveTelemetry(rootDir, {
        category: p.category,
        confidence: p.confidence,
        metadata: { firstSeen: p.metadata?.firstSeen },
      }, true);
    }

    approveSpinner.succeed(`Approved ${approved.length} patterns`);
    console.log();
    return;
  }

  // Approve single pattern by ID
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

      if (!options.yes) {
        const confirm = await confirmPrompt(`Approve pattern "${match.name}"?`, true);
        if (!confirm) {
          status.info('Approval cancelled');
          return;
        }
      }

      try {
        await service.approvePattern(match.id);
        // Record telemetry
        await recordApproveTelemetry(rootDir, {
          category: match.category,
          confidence: match.confidence,
        }, false);
        status.success(`Approved pattern: ${match.name}`);
      } catch (error) {
        status.warning(`Could not approve pattern: ${match.name}`);
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
    await service.approvePattern(patternId);
    // Record telemetry
    await recordApproveTelemetry(rootDir, {
      category: pattern.category,
      confidence: pattern.confidence,
      metadata: { firstSeen: pattern.metadata?.firstSeen },
    }, false);
    status.success(`Approved pattern: ${pattern.name}`);
  } catch (error) {
    status.error(`Cannot approve pattern from status: ${pattern.status}`);
  }

  console.log();
}

export const approveCommand = new Command('approve')
  .description('Approve a pattern by ID')
  .argument('[pattern-id]', 'Pattern ID to approve (or "all" for batch approval)')
  .option('-r, --root <path>', 'Project root directory (auto-detects .drift folder if not specified)')
  .option('-c, --category <category>', 'Approve all patterns in category')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--verbose', 'Enable verbose output')
  .option('--auto', 'Auto-approve patterns with ≥90% confidence')
  .option('--threshold <number>', 'Custom confidence threshold for auto-approve (default: 0.90)', '0.90')
  .option('--dry-run', 'Show what would be approved without making changes')
  .action((patternId: string | undefined, options: ApproveOptions) => {
    // Parse threshold as number
    if (typeof options.threshold === 'string') {
      options.threshold = parseFloat(options.threshold);
    }
    // If --auto is used without pattern-id, that's fine
    if (!patternId && !options.auto && !options.category) {
      console.error('Error: pattern-id is required unless using --auto or --category');
      process.exit(1);
    }
    return approveAction(patternId ?? '', options);
  });
