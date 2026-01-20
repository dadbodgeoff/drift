/**
 * Where Command - Find pattern locations
 *
 * Quickly find where patterns are located in the codebase.
 * Now reads from BOTH ManifestStore and PatternStore to ensure
 * all 15 categories are available.
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
  PatternStore,
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

    // Also load from PatternStore to get ALL 15 categories
    const patternStore = new PatternStore({ rootDir: cwd });
    await patternStore.initialize();
    const allPatterns = patternStore.getAll();

    if (!manifest && allPatterns.length === 0) {
      console.error(chalk.red('No patterns found. Run `drift scan` first.'));
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

    // Query patterns from manifest
    const manifestResults = manifest ? manifestStore.queryPatterns(query) : [];

    // Also search in PatternStore for patterns matching the query
    // This ensures all 15 categories are searched
    const patternStoreResults: Array<{
      patternId: string;
      patternName: string;
      category: PatternCategory;
      locations: Array<{
        file: string;
        range: { start: number; end: number };
        type: string;
        name: string;
        signature?: string;
      }>;
      totalCount: number;
    }> = [];

    const searchTerm = pattern.toLowerCase();
    const limit = parseInt(options.limit, 10);

    for (const p of allPatterns) {
      // Filter by pattern name/id
      if (!p.id.toLowerCase().includes(searchTerm) &&
          !p.name.toLowerCase().includes(searchTerm) &&
          !p.category.toLowerCase().includes(searchTerm) &&
          !p.subcategory.toLowerCase().includes(searchTerm)) {
        continue;
      }

      // Filter by category
      if (options.category && p.category !== options.category) {
        continue;
      }

      // Filter by status
      if (options.status && p.status !== options.status) {
        continue;
      }

      // Filter by confidence
      if (options.minConfidence && p.confidence.score < parseFloat(options.minConfidence)) {
        continue;
      }

      const locations = p.locations.slice(0, limit).map(loc => ({
        file: loc.file,
        range: { start: loc.line, end: loc.endLine || loc.line },
        type: 'block' as const,
        name: `line-${loc.line}`,
      }));

      patternStoreResults.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        locations,
        totalCount: p.locations.length,
      });
    }

    // Merge results (dedupe by pattern ID)
    const mergedResults = new Map<string, {
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
        signature?: string;
      }>;
      totalCount: number;
    }>();

    for (const r of manifestResults) {
      mergedResults.set(r.patternId, r);
    }

    for (const r of patternStoreResults) {
      if (!mergedResults.has(r.patternId)) {
        // Add required fields for SemanticLocation compatibility
        const locationsWithHash = r.locations.map(loc => ({
          ...loc,
          hash: '',
          confidence: 0.9,
        }));
        mergedResults.set(r.patternId, {
          ...r,
          locations: locationsWithHash,
        });
      }
    }

    const results = Array.from(mergedResults.values());

    if (results.length === 0) {
      console.log(chalk.yellow(`No patterns found matching "${pattern}"`));
      
      // Show available categories
      const categories = new Set(allPatterns.map(p => p.category));
      if (categories.size > 0) {
        console.log(chalk.dim('\nAvailable categories:'));
        for (const cat of categories) {
          const count = allPatterns.filter(p => p.category === cat).length;
          console.log(chalk.dim(`  ${cat}: ${count} patterns`));
        }
      }
      
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
