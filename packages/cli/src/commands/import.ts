/**
 * Import Command - Import database from backup
 *
 * Phase 3: Import database from JSON or SQLite backup.
 *
 * Usage:
 *   drift import db backup.json    # Import from JSON backup
 *   drift import db backup.db      # Import from SQLite backup
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  UnifiedStore,
  hasSqliteDatabase,
} from 'driftdetect-core/storage';

import { createSpinner } from '../ui/spinner.js';

/**
 * Database import subcommand
 */
const dbImportCommand = new Command('db')
  .description('Import database from backup')
  .argument('<input>', 'Input file path')
  .option('--db-format <format>', 'Import format: json, sqlite (auto-detected from extension)')
  .option('--force', 'Overwrite existing database without confirmation')
  .action(async (input, options) => {
    const cwd = process.cwd();
    
    const inputPath = path.resolve(cwd, input);
    
    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      console.error(chalk.red(`Input file not found: ${input}`));
      process.exit(1);
    }
    
    // Auto-detect format from extension
    let format: 'json' | 'sqlite' = options.dbFormat;
    if (!format) {
      const ext = path.extname(inputPath).toLowerCase();
      if (ext === '.json') {
        format = 'json';
      } else if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
        format = 'sqlite';
      } else {
        console.error(chalk.red(`Cannot auto-detect format from extension: ${ext}`));
        console.error(chalk.gray('Use --db-format json or --db-format sqlite'));
        process.exit(1);
      }
    }
    
    // Validate format
    const validFormats = ['json', 'sqlite'];
    if (!validFormats.includes(format)) {
      console.error(chalk.red(`Invalid format: ${format}`));
      console.error(`Valid formats: ${validFormats.join(', ')}`);
      process.exit(1);
    }
    
    // Check if database already exists
    if (hasSqliteDatabase(cwd) && !options.force) {
      console.error(chalk.yellow('⚠️  SQLite database already exists.'));
      console.error(chalk.gray('Use --force to overwrite.'));
      process.exit(1);
    }
    
    console.log();
    console.log(chalk.bold('📥 Drift Database Import'));
    console.log();
    
    const spinner = createSpinner('Importing database...');
    spinner.start();
    
    try {
      // Read input file
      const data = await fs.readFile(inputPath);
      
      // Initialize store and import
      const store = new UnifiedStore({ rootDir: cwd });
      await store.initialize();
      await store.import(data, format);
      
      // Get stats after import
      const stats = await store.getStats();
      await store.close();
      
      spinner.succeed('Database imported successfully');
      
      console.log();
      console.log(chalk.bold('Import Summary'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Patterns:      ${chalk.cyan(stats.patterns)}`);
      console.log(`  Contracts:     ${chalk.cyan(stats.contracts)}`);
      console.log(`  Constraints:   ${chalk.cyan(stats.constraints)}`);
      console.log(`  Functions:     ${chalk.cyan(stats.functions)}`);
      console.log(`  Access Points: ${chalk.cyan(stats.accessPoints)}`);
      console.log(`  Env Variables: ${chalk.cyan(stats.envVariables)}`);
      console.log(`  Test Files:    ${chalk.cyan(stats.testFiles)}`);
      console.log();
      
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.cyan('  drift status') + chalk.gray('  - View imported data'));
      console.log(chalk.cyan('  drift scan') + chalk.gray('    - Update with fresh scan'));
      console.log();
      
    } catch (error) {
      spinner.fail('Import failed');
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

export const importCommand = new Command('import')
  .description('Import data from backup')
  .addCommand(dbImportCommand);
