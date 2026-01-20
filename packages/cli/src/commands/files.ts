/**
 * Files Command - Show patterns in a file
 *
 * Show what patterns are found in a specific file.
 *
 * Usage:
 *   drift files src/auth/middleware.py
 *   drift files 'src/api/*.ts'
 *   drift files --json src/api/
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  ManifestStore,
  type FileQuery,
  type PatternCategory,
} from 'driftdetect-core';

export const filesCommand = new Command('files')
  .description('Show patterns in a file')
  .argument('<path>', 'File path (supports glob patterns)')
  .option('-c, --category <category>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (filePath, options) => {
    const cwd = process.cwd();

    // Load manifest
    const manifestStore = new ManifestStore(cwd);
    const manifest = await manifestStore.load();

    if (!manifest) {
      console.error(chalk.red('No manifest found. Run `drift scan` first.'));
      process.exit(1);
    }

    // Build query
    const query: FileQuery = {
      path: filePath,
    };
    if (options.category) {
      query.category = options.category as PatternCategory;
    }

    // Query file
    const result = manifestStore.queryFile(query);

    if (!result) {
      console.log(chalk.yellow(`No patterns found in "${filePath}"`));
      
      // Show available files
      const allFiles = Object.keys(manifest.files).slice(0, 10);
      if (allFiles.length > 0) {
        console.log(chalk.dim('\nAvailable files:'));
        for (const f of allFiles) {
          console.log(chalk.dim(`  ${f}`));
        }
        if (Object.keys(manifest.files).length > 10) {
          console.log(chalk.dim(`  ... and ${Object.keys(manifest.files).length - 10} more`));
        }
      }
      
      process.exit(0);
    }

    // Output
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold(`\n📄 Patterns in ${result.file}:\n`));
      console.log(chalk.dim(`  Hash: ${result.metadata.hash}`));
      console.log(chalk.dim(`  Last scanned: ${result.metadata.lastScanned}`));
      console.log('');

      if (result.patterns.length === 0) {
        console.log(chalk.yellow('  No patterns found'));
      } else {
        // Group by category
        const byCategory = new Map<string, typeof result.patterns>();
        for (const p of result.patterns) {
          if (!byCategory.has(p.category)) {
            byCategory.set(p.category, []);
          }
          byCategory.get(p.category)!.push(p);
        }

        for (const [category, patterns] of byCategory) {
          console.log(chalk.cyan(`  ${category.toUpperCase()}`));
          
          for (const p of patterns) {
            console.log(`    • ${chalk.white(p.name)}`);
            
            for (const loc of p.locations) {
              const range = `${loc.range.start}-${loc.range.end}`;
              console.log(`      ${chalk.dim('lines')} ${chalk.yellow(range)}: ${loc.type} ${chalk.green(loc.name)}`);
            }
          }
          
          console.log('');
        }
      }

      console.log(chalk.dim(`Total: ${result.patterns.length} patterns`));
    }
  });
