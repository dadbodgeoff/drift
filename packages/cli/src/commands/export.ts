/**
 * Export Command - Export manifest in various formats
 *
 * Exports the pattern manifest for AI consumption or reporting.
 *
 * Usage:
 *   drift export                    # Export as JSON to stdout
 *   drift export --format ai-context # Export optimized for LLMs
 *   drift export --format summary   # Human-readable summary
 *   drift export -o report.md       # Write to file
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  ManifestStore,
  exportManifest,
  estimateTokens,
  type ExportFormat,
  type ExportOptions,
  type PatternCategory,
} from 'driftdetect-core';

const VALID_FORMATS: ExportFormat[] = ['json', 'ai-context', 'summary', 'markdown'];
const VALID_CATEGORIES: PatternCategory[] = [
  'api', 'auth', 'security', 'errors', 'logging', 'testing',
  'data-access', 'config', 'types', 'structural', 'components',
  'styling', 'accessibility', 'documentation', 'performance',
];

export const exportCommand = new Command('export')
  .description('Export manifest in various formats')
  .option('-f, --format <format>', `Output format: ${VALID_FORMATS.join(', ')}`, 'json')
  .option('-o, --output <file>', 'Output file (stdout if not specified)')
  .option('-c, --categories <categories>', 'Categories to include (comma-separated)')
  .option('--status <status>', 'Filter by status: discovered, approved, ignored')
  .option('--min-confidence <number>', 'Minimum confidence threshold (0.0-1.0)')
  .option('--compact', 'Compact output (fewer details)')
  .option('--max-tokens <number>', 'Maximum tokens for AI context format')
  .option('--snippets', 'Include code snippets')
  .action(async (options) => {
    const cwd = process.cwd();

    // Validate format
    if (!VALID_FORMATS.includes(options.format)) {
      console.error(chalk.red(`Invalid format: ${options.format}`));
      console.error(`Valid formats: ${VALID_FORMATS.join(', ')}`);
      process.exit(1);
    }

    // Load manifest
    const manifestStore = new ManifestStore(cwd);
    const manifest = await manifestStore.load();

    if (!manifest) {
      console.error(chalk.red('No manifest found. Run `drift scan` first.'));
      process.exit(1);
    }

    // Parse categories
    let categories: PatternCategory[] | undefined;
    if (options.categories) {
      categories = options.categories.split(',').map((c: string) => c.trim()) as PatternCategory[];
      const invalid = categories.filter(c => !VALID_CATEGORIES.includes(c));
      if (invalid.length > 0) {
        console.error(chalk.red(`Invalid categories: ${invalid.join(', ')}`));
        console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
    }

    // Parse status
    let statuses: Array<'discovered' | 'approved' | 'ignored'> | undefined;
    if (options.status) {
      statuses = options.status.split(',').map((s: string) => s.trim()) as typeof statuses;
    }

    // Build export options
    const exportOptions: ExportOptions = {
      format: options.format as ExportFormat,
    };
    
    if (options.output) {
      exportOptions.output = options.output;
    }
    if (categories) {
      exportOptions.categories = categories;
    }
    if (statuses) {
      exportOptions.statuses = statuses;
    }
    if (options.minConfidence) {
      exportOptions.minConfidence = parseFloat(options.minConfidence);
    }
    if (options.compact) {
      exportOptions.compact = options.compact;
    }
    if (options.maxTokens) {
      exportOptions.maxTokens = parseInt(options.maxTokens, 10);
    }
    if (options.snippets) {
      exportOptions.includeSnippets = options.snippets;
    }

    // Export
    const output = exportManifest(manifest, exportOptions);

    // Estimate tokens for AI context
    if (options.format === 'ai-context') {
      const estimate = estimateTokens(output);
      if (estimate.warning) {
        console.error(chalk.yellow(`⚠️  ${estimate.warning}`));
      }
      console.error(chalk.dim(`Estimated tokens: ~${estimate.tokens}`));
    }

    // Write output
    if (options.output) {
      const outputPath = path.resolve(cwd, options.output);
      await fs.writeFile(outputPath, output, 'utf-8');
      console.error(chalk.green(`✔ Exported to ${options.output}`));
    } else {
      console.log(output);
    }
  });
