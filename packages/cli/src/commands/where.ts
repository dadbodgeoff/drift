/**
 * Where Command - Find pattern locations
 *
 * Quickly find where patterns are located in the codebase.
 *
 * Usage:
 *   drift where auth           # Find patterns matching "auth"
 *   drift where middleware     # Find middleware patterns
 *   drift where --json         # Output as JSON
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  ManifestStore,
  type PatternQuery,
  type PatternCategory,
} from 'driftdetect-core';

export const whereCommand = new Command('where')
  .description('Find pattern locations')
  .argument('<pattern>', 'Pattern name or ID (supports partial matching)')
  .option('-c, --category <category>', 'Filter by category')
  .option('--status <status>', 'Filter by status: discovered, approved, ignored')
  .option('--min-confidence <number>', 'Minimum confidence threshold')
  .option('-l, --limit <number>', 'Limit number of locations shown', '10')
  .option('--json', 'Output as JSON')
  .action(async (pattern, options) => {
    const cwd = process.cwd();

    // Load manifest
    const manifestStore = new ManifestStore(cwd);
    const manifest = await manifestStore.load();

    if (!manifest) {
      console.error(chalk.red('No manifest found. Run `drift scan` first.'));
      process.exit(1);
    }

    // Build query
    const query: PatternQuery = {
      pattern,
      limit: parseInt(options.limit, 10),
    };
    if (options.category) {
      query.category = options.category as PatternCategory;
    }
    if (options.status) {
      query.status = options.status;
    }
    if (options.minConfidence) {
      query.minConfidence = parseFloat(options.minConfidence);
    }

    // Query patterns
    const results = manifestStore.queryPatterns(query);

    if (results.length === 0) {
      console.log(chalk.yellow(`No patterns found matching "${pattern}"`));
      process.exit(0);
    }

    // Output
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(chalk.bold(`\n🔍 Patterns matching "${pattern}":\n`));

      for (const result of results) {
        console.log(chalk.cyan(`${result.patternName}`));
        console.log(chalk.dim(`  ID: ${result.patternId}`));
        console.log(chalk.dim(`  Category: ${result.category}`));
        console.log(chalk.dim(`  Locations: ${result.totalCount}`));
        console.log('');

        for (const loc of result.locations) {
          const range = `${loc.range.start}-${loc.range.end}`;
          console.log(`  → ${chalk.green(loc.file)}:${chalk.yellow(range)}`);
          
          if (loc.type !== 'file' && loc.type !== 'block') {
            console.log(`    ${chalk.dim(loc.type)}: ${chalk.white(loc.name)}`);
          }
          
          if (loc.signature) {
            console.log(`    ${chalk.dim(loc.signature.substring(0, 60))}`);
          }
        }

        if (result.totalCount > result.locations.length) {
          console.log(chalk.dim(`  ... and ${result.totalCount - result.locations.length} more`));
        }

        console.log('');
      }
    }
  });
