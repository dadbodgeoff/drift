/**
 * Where Command - Find pattern locations
 *
 * Quickly find where patterns are located in the codebase.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * Usage:
 *   drift where auth           # Find patterns matching "auth"
 *   drift where middleware     # Find middleware patterns
 *   drift where --json         # Output as JSON
 */

import chalk from 'chalk';
import { Command } from 'commander';

import { createCLIPatternService } from '../services/pattern-service-factory.js';

import type { PatternCategory, PatternStatus } from 'driftdetect-core';


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

    // Initialize pattern service
    const service = createCLIPatternService(cwd);

    // Search for patterns using the service
    const searchOptions: {
      categories?: PatternCategory[];
      statuses?: PatternStatus[];
      minConfidence?: number;
      limit?: number;
    } = {
      limit: 100, // Get more results for filtering
    };

    if (options.category) {
      searchOptions.categories = [options.category as PatternCategory];
    }
    if (options.status) {
      searchOptions.statuses = [options.status as PatternStatus];
    }
    if (options.minConfidence) {
      searchOptions.minConfidence = parseFloat(options.minConfidence);
    }

    // Use the search method to find matching patterns
    const searchResults = await service.search(pattern, searchOptions);

    if (searchResults.length === 0) {
      // Get all patterns to show available categories
      const allPatternsResult = await service.listPatterns({ limit: 1000 });
      
      console.log(chalk.yellow(`No patterns found matching "${pattern}"`));
      
      // Show available categories
      const categories = new Set(allPatternsResult.items.map((p: { category: string }) => p.category));
      if (categories.size > 0) {
        console.log(chalk.dim('\nAvailable categories:'));
        for (const cat of categories) {
          const count = allPatternsResult.items.filter((p: { category: string }) => p.category === cat).length;
          console.log(chalk.dim(`  ${cat}: ${count} patterns`));
        }
      }
      
      process.exit(0);
    }

    // Fetch full pattern details for results
    const limit = parseInt(options.limit, 10);
    const results: Array<{
      patternId: string;
      patternName: string;
      category: PatternCategory;
      locations: Array<{
        file: string;
        hash: string;
        range: { start: number; end: number };
        type: string;
        name: string;
        confidence: number;
      }>;
      totalCount: number;
    }> = [];

    for (const summary of searchResults) {
      const fullPattern = await service.getPattern(summary.id);
      if (!fullPattern) {continue;}

      const locations = fullPattern.locations.slice(0, limit).map((loc) => ({
        file: loc.file,
        hash: '',
        range: { start: loc.line, end: loc.endLine ?? loc.line },
        type: 'block' as const,
        name: `line-${loc.line}`,
        confidence: fullPattern.confidence,
      }));

      results.push({
        patternId: fullPattern.id,
        patternName: fullPattern.name,
        category: fullPattern.category,
        locations,
        totalCount: fullPattern.locations.length,
      });
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
        }

        if (result.totalCount > result.locations.length) {
          console.log(chalk.dim(`  ... and ${result.totalCount - result.locations.length} more`));
        }

        console.log('');
      }
    }
  });
