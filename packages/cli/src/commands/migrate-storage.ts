/**
 * Migrate Storage Command - drift migrate-storage
 *
 * Migrates pattern storage from legacy status-based format to unified
 * category-based format (Phase 3 of Pattern System Consolidation).
 *
 * Also supports migration to SQLite unified database format for cloud-ready
 * storage (Phase 4 - Unified Database Architecture).
 *
 * Legacy format:
 * .drift/patterns/
 *   ├── discovered/
 *   │   ├── api.json
 *   │   └── security.json
 *   ├── approved/
 *   └── ignored/
 *
 * Unified JSON format:
 * .drift/patterns/
 *   ├── api.json        # Contains all statuses
 *   ├── security.json
 *   └── ...
 *
 * Unified SQLite format:
 * .drift/drift.db       # Single database with all metadata
 */

import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import { UnifiedFilePatternRepository } from 'driftdetect-core';

import { confirmPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

// ============================================================================
// Helpers
// ============================================================================

function hasLegacyFormat(rootDir: string): boolean {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');
  const legacyDirs = ['discovered', 'approved', 'ignored'];

  for (const dir of legacyDirs) {
    const statusDir = path.join(patternsDir, dir);
    if (fs.existsSync(statusDir) && fs.statSync(statusDir).isDirectory()) {
      return true;
    }
  }
  return false;
}

function hasUnifiedFormat(rootDir: string): boolean {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');
  const categories = ['api', 'auth', 'security', 'errors', 'logging', 'data-access', 'config', 'testing', 'performance', 'components', 'styling', 'structural', 'types', 'accessibility', 'documentation'];

  for (const category of categories) {
    const filePath = path.join(patternsDir, `${category}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        if (data.version?.startsWith('2.')) {
          return true;
        }
      } catch {
        // Not valid unified format
      }
    }
  }
  return false;
}

async function createBackup(rootDir: string): Promise<string> {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(rootDir, '.drift', 'backups', `patterns-${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  // Copy entire patterns directory
  copyDirSync(patternsDir, backupDir);

  return backupDir;
}

function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(src)) {return;}

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ============================================================================
// Migration Action
// ============================================================================

interface MigrateOptions {
  force?: boolean;
  backup?: boolean;
  keepLegacy?: boolean;
  dryRun?: boolean;
}

async function migrateAction(options: MigrateOptions): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('🔄 Pattern Storage Migration'));
  console.log();

  // Check if drift is initialized
  if (!fs.existsSync(path.join(rootDir, '.drift'))) {
    status.error('Drift is not initialized in this directory.');
    console.log(chalk.gray('Run `drift init` first.'));
    process.exit(1);
  }

  // Check current format
  const hasLegacy = hasLegacyFormat(rootDir);
  const hasUnified = hasUnifiedFormat(rootDir);

  if (!hasLegacy && !hasUnified) {
    status.info('No patterns found. Nothing to migrate.');
    return;
  }

  if (hasUnified && !hasLegacy) {
    status.success('Already using unified format. No migration needed.');
    return;
  }

  if (hasUnified && hasLegacy) {
    console.log(chalk.yellow('⚠️  Both legacy and unified formats detected.'));
    console.log(chalk.gray('This may indicate a partial migration.'));
    console.log();

    if (!options.force) {
      const proceed = await confirmPrompt('Continue with migration? (will merge patterns)', false);
      if (!proceed) {
        status.info('Migration cancelled.');
        return;
      }
    }
  }

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.cyan('🔍 Dry run mode - no changes will be made'));
    console.log();

    // Count patterns in legacy format
    let totalPatterns = 0;
    const categories = new Set<string>();

    for (const statusDir of ['discovered', 'approved', 'ignored']) {
      const dir = path.join(rootDir, '.drift', 'patterns', statusDir);
      if (!fs.existsSync(dir)) {continue;}

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const data = JSON.parse(content);
          totalPatterns += data.patterns?.length || 0;
          categories.add(file.replace('.json', ''));
        } catch {
          // Skip invalid files
        }
      }
    }

    console.log(`  Patterns to migrate: ${chalk.cyan(totalPatterns)}`);
    console.log(`  Categories: ${chalk.cyan(Array.from(categories).join(', '))}`);
    console.log();
    console.log(chalk.gray('Run without --dry-run to perform migration.'));
    return;
  }

  // Create backup if requested
  let backupPath: string | undefined;
  if (options.backup !== false) {
    const backupSpinner = createSpinner('Creating backup...');
    backupSpinner.start();

    try {
      backupPath = await createBackup(rootDir);
      backupSpinner.succeed(`Backup created: ${chalk.gray(path.relative(rootDir, backupPath))}`);
    } catch (error) {
      backupSpinner.fail('Failed to create backup');
      console.error(chalk.red((error as Error).message));

      if (!options.force) {
        status.error('Migration aborted. Use --force to skip backup.');
        process.exit(1);
      }
    }
  }

  // Perform migration
  const migrateSpinner = createSpinner('Migrating patterns...');
  migrateSpinner.start();

  try {
    const repository = new UnifiedFilePatternRepository({
      rootDir,
      autoSave: false,
      autoMigrate: true,
      keepLegacyFiles: options.keepLegacy ?? false,
    });

    await repository.initialize();
    await repository.saveAll();

    const stats = await repository.getStorageStats();
    await repository.close();

    migrateSpinner.succeed(`Migrated ${chalk.cyan(stats.totalPatterns)} patterns`);

    // Show summary
    console.log();
    console.log(chalk.bold('📊 Migration Summary'));
    console.log();
    console.log(`  Total patterns: ${chalk.cyan(stats.totalPatterns)}`);
    console.log(`  Categories: ${chalk.cyan(stats.fileCount)}`);
    console.log();
    console.log('  By status:');
    console.log(`    Discovered: ${chalk.yellow(stats.byStatus.discovered)}`);
    console.log(`    Approved: ${chalk.green(stats.byStatus.approved)}`);
    console.log(`    Ignored: ${chalk.gray(stats.byStatus.ignored)}`);

    if (backupPath) {
      console.log();
      console.log(chalk.gray(`Backup saved to: ${path.relative(rootDir, backupPath)}`));
    }

    if (!options.keepLegacy) {
      console.log();
      console.log(chalk.green('✓ Legacy format directories removed.'));
    } else {
      console.log();
      console.log(chalk.yellow('⚠️  Legacy format directories preserved (--keep-legacy).'));
      console.log(chalk.gray('  You can manually remove them after verifying the migration.'));
    }

  } catch (error) {
    migrateSpinner.fail('Migration failed');
    console.error(chalk.red((error as Error).message));

    if (backupPath) {
      console.log();
      console.log(chalk.yellow(`Restore from backup: ${path.relative(rootDir, backupPath)}`));
    }

    process.exit(1);
  }

  console.log();
  status.success('Migration complete!');
  console.log();
}

// ============================================================================
// Rollback Action
// ============================================================================

async function rollbackAction(): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('⏪ Rollback Pattern Storage'));
  console.log();

  // Find backups
  const backupsDir = path.join(rootDir, '.drift', 'backups');
  if (!fs.existsSync(backupsDir)) {
    status.error('No backups found.');
    return;
  }

  const backups = fs.readdirSync(backupsDir)
    .filter(d => d.startsWith('patterns-'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    status.error('No pattern backups found.');
    return;
  }

  console.log('Available backups:');
  for (const backup of backups.slice(0, 5)) {
    console.log(`  ${chalk.cyan(backup)}`);
  }
  if (backups.length > 5) {
    console.log(chalk.gray(`  ... and ${backups.length - 5} more`));
  }
  console.log();

  const latestBackup = backups[0];
  if (!latestBackup) {
    status.error('No pattern backups found.');
    return;
  }
  
  const confirmed = await confirmPrompt(`Restore from ${latestBackup}?`, false);

  if (!confirmed) {
    status.info('Rollback cancelled.');
    return;
  }

  const rollbackSpinner = createSpinner('Rolling back...');
  rollbackSpinner.start();

  try {
    const patternsDir = path.join(rootDir, '.drift', 'patterns');
    const backupPath = path.join(backupsDir, latestBackup);

    // Remove current patterns
    if (fs.existsSync(patternsDir)) {
      fs.rmSync(patternsDir, { recursive: true });
    }

    // Restore from backup
    copyDirSync(backupPath, patternsDir);

    rollbackSpinner.succeed('Rollback complete');
    console.log();
    console.log(chalk.gray(`Restored from: ${latestBackup}`));

  } catch (error) {
    rollbackSpinner.fail('Rollback failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ============================================================================
// Status Action
// ============================================================================

async function statusAction(): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('📦 Pattern Storage Status'));
  console.log();

  if (!fs.existsSync(path.join(rootDir, '.drift'))) {
    status.error('Drift is not initialized in this directory.');
    return;
  }

  const hasLegacy = hasLegacyFormat(rootDir);
  const hasUnified = hasUnifiedFormat(rootDir);

  if (!hasLegacy && !hasUnified) {
    console.log('  Format: ' + chalk.gray('No patterns stored'));
    return;
  }

  if (hasUnified && !hasLegacy) {
    console.log('  Format: ' + chalk.green('Unified (v2.0)'));
    console.log('  Status: ' + chalk.green('Up to date'));
  } else if (hasLegacy && !hasUnified) {
    console.log('  Format: ' + chalk.yellow('Legacy (v1.0)'));
    console.log('  Status: ' + chalk.yellow('Migration available'));
    console.log();
    console.log(chalk.gray('  Run `drift migrate-storage` to upgrade.'));
  } else {
    console.log('  Format: ' + chalk.red('Mixed (legacy + unified)'));
    console.log('  Status: ' + chalk.red('Needs cleanup'));
    console.log();
    console.log(chalk.gray('  Run `drift migrate-storage --force` to complete migration.'));
  }

  console.log();
}

// ============================================================================
// SQLite Migration Action
// ============================================================================

interface SqliteMigrateOptions {
  force?: boolean;
  keepJson?: boolean;
  dryRun?: boolean;
}

async function sqliteMigrateAction(options: SqliteMigrateOptions): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('🗄️  SQLite Database Migration'));
  console.log();

  // Check if drift is initialized
  if (!fs.existsSync(path.join(rootDir, '.drift'))) {
    status.error('Drift is not initialized in this directory.');
    console.log(chalk.gray('Run `drift init` first.'));
    process.exit(1);
  }

  // Check if SQLite database already exists
  const dbPath = path.join(rootDir, '.drift', 'drift.db');
  if (fs.existsSync(dbPath)) {
    console.log(chalk.yellow('⚠️  SQLite database already exists.'));
    
    if (!options.force) {
      const proceed = await confirmPrompt('Overwrite existing database?', false);
      if (!proceed) {
        status.info('Migration cancelled.');
        return;
      }
    }
    
    // Backup existing database
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(rootDir, '.drift', 'backups', `drift-${timestamp}.db`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(dbPath, backupPath);
    console.log(chalk.gray(`Backed up existing database to: ${path.relative(rootDir, backupPath)}`));
  }

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.cyan('🔍 Dry run mode - no changes will be made'));
    console.log();

    // Count items to migrate
    const counts = {
      patterns: 0,
      contracts: 0,
      constraints: 0,
      boundaries: 0,
      envVariables: 0,
    };

    // Count patterns
    const patternsDir = path.join(rootDir, '.drift', 'patterns');
    if (fs.existsSync(patternsDir)) {
      for (const statusDir of ['discovered', 'approved', 'ignored']) {
        const dir = path.join(patternsDir, statusDir);
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(dir, file), 'utf-8');
            const data = JSON.parse(content);
            counts.patterns += data.patterns?.length || 0;
          } catch {
            // Skip invalid files
          }
        }
      }
    }

    // Count contracts
    const contractsDir = path.join(rootDir, '.drift', 'contracts');
    if (fs.existsSync(contractsDir)) {
      for (const statusDir of ['discovered', 'verified', 'mismatch', 'ignored']) {
        const dir = path.join(contractsDir, statusDir);
        if (fs.existsSync(dir)) {
          counts.contracts += fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        }
      }
    }

    // Count constraints
    const constraintsDir = path.join(rootDir, '.drift', 'constraints');
    if (fs.existsSync(constraintsDir)) {
      for (const statusDir of ['discovered', 'approved', 'ignored', 'custom']) {
        const dir = path.join(constraintsDir, statusDir);
        if (fs.existsSync(dir)) {
          counts.constraints += fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
        }
      }
    }

    // Count boundaries
    const boundariesPath = path.join(rootDir, '.drift', 'boundaries', 'access-map.json');
    if (fs.existsSync(boundariesPath)) {
      try {
        const content = fs.readFileSync(boundariesPath, 'utf-8');
        const data = JSON.parse(content);
        counts.boundaries = Object.keys(data.tables || {}).length;
      } catch {
        // Skip
      }
    }

    // Count env variables
    const envPath = path.join(rootDir, '.drift', 'environment', 'variables.json');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        const data = JSON.parse(content);
        counts.envVariables = Object.keys(data.variables || {}).length;
      } catch {
        // Skip
      }
    }

    console.log('  Items to migrate:');
    console.log(`    Patterns: ${chalk.cyan(counts.patterns)}`);
    console.log(`    Contracts: ${chalk.cyan(counts.contracts)}`);
    console.log(`    Constraints: ${chalk.cyan(counts.constraints)}`);
    console.log(`    Boundaries: ${chalk.cyan(counts.boundaries)}`);
    console.log(`    Env Variables: ${chalk.cyan(counts.envVariables)}`);
    console.log();
    console.log(chalk.gray('Run without --dry-run to perform migration.'));
    return;
  }

  // Perform migration
  const migrateSpinner = createSpinner('Migrating to SQLite...');
  migrateSpinner.start();

  try {
    // Dynamic import to avoid loading SQLite unless needed
    const { migrateFromJson } = await import('driftdetect-core/storage');

    const result = await migrateFromJson({
      rootDir,
      keepJsonFiles: options.keepJson ?? true,
      dryRun: false,
      onProgress: (message, current, total) => {
        migrateSpinner.text(`${message} (${current}/${total})`);
      },
    });

    if (!result.success) {
      migrateSpinner.fail('Migration failed');
      for (const error of result.errors) {
        console.error(chalk.red(`  ${error}`));
      }
      process.exit(1);
    }

    migrateSpinner.succeed('Migration complete');

    // Show summary
    console.log();
    console.log(chalk.bold('📊 Migration Summary'));
    console.log();
    console.log(`  Patterns: ${chalk.cyan(result.patternsImported)}`);
    console.log(`  Contracts: ${chalk.cyan(result.contractsImported)}`);
    console.log(`  Constraints: ${chalk.cyan(result.constraintsImported)}`);
    console.log(`  Boundaries: ${chalk.cyan(result.boundariesImported)}`);
    console.log(`  Env Variables: ${chalk.cyan(result.envVariablesImported)}`);

    if (result.warnings.length > 0) {
      console.log();
      console.log(chalk.yellow('Warnings:'));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  ⚠️  ${warning}`));
      }
    }

    console.log();
    console.log(chalk.green(`✓ Database created: ${chalk.gray('.drift/drift.db')}`));

    if (options.keepJson) {
      console.log();
      console.log(chalk.gray('JSON files preserved. You can remove them after verifying the migration.'));
    }

  } catch (error) {
    migrateSpinner.fail('Migration failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  console.log();
  status.success('SQLite migration complete!');
  console.log();
}

// ============================================================================
// Command Registration
// ============================================================================

export const migrateStorageCommand = new Command('migrate-storage')
  .description('Migrate pattern storage to unified format');

// Pattern migration (default behavior, now as explicit subcommand)
migrateStorageCommand
  .command('patterns')
  .description('Migrate patterns from legacy status-based format to unified format')
  .option('-f, --force', 'Force migration without confirmation')
  .option('--no-backup', 'Skip creating backup')
  .option('--keep-legacy', 'Keep legacy format files after migration')
  .option('--dry-run', 'Show what would be migrated without making changes')
  .action(migrateAction);

migrateStorageCommand
  .command('rollback')
  .description('Rollback to previous pattern storage backup')
  .action(rollbackAction);

migrateStorageCommand
  .command('status')
  .description('Show current storage format status')
  .action(statusAction);

migrateStorageCommand
  .command('sqlite')
  .description('Migrate all metadata to unified SQLite database (cloud-ready)')
  .option('-f, --force', 'Force migration without confirmation')
  .option('--keep-json', 'Keep JSON files after migration (default: true)')
  .option('--no-keep-json', 'Remove JSON files after migration')
  .option('--dry-run', 'Show what would be migrated without making changes')
  .action(sqliteMigrateAction);

// ============================================================================
// Sync All Action - Syncs ALL data sources to SQLite
// ============================================================================

interface SyncAllOptions {
  verbose?: boolean;
  domains?: string;
}

async function syncAllAction(options: SyncAllOptions): Promise<void> {
  const rootDir = process.cwd();

  console.log();
  console.log(chalk.bold('🔄 Sync All Data to SQLite'));
  console.log();

  // Check if drift is initialized
  if (!fs.existsSync(path.join(rootDir, '.drift'))) {
    status.error('Drift is not initialized in this directory.');
    console.log(chalk.gray('Run `drift init` first.'));
    process.exit(1);
  }

  const syncSpinner = createSpinner('Syncing data to SQLite...');
  syncSpinner.start();

  try {
    // Dynamic import to avoid loading SQLite unless needed
    const { createSyncService } = await import('driftdetect-core/storage');

    const syncService = createSyncService({
      rootDir,
      verbose: options.verbose ?? false,
    });

    await syncService.initialize();
    const result = await syncService.syncAll();
    await syncService.close();

    if (!result.success) {
      syncSpinner.fail('Sync failed');
      for (const error of result.errors) {
        console.error(chalk.red(`  ${error}`));
      }
      process.exit(1);
    }

    syncSpinner.succeed('Sync complete');

    // Show summary
    console.log();
    console.log(chalk.bold('📊 Sync Summary'));
    console.log();
    console.log(`  Boundaries: ${chalk.cyan(result.synced.boundaries)} items`);
    console.log(`  Environment: ${chalk.cyan(result.synced.environment)} items`);
    console.log(`  Call Graph:`);
    console.log(`    Functions: ${chalk.cyan(result.synced.callGraph.functions)}`);
    console.log(`    Calls: ${chalk.cyan(result.synced.callGraph.calls)}`);
    console.log(`    Data Access: ${chalk.cyan(result.synced.callGraph.dataAccess)}`);
    console.log(`  Audit:`);
    console.log(`    Snapshots: ${chalk.cyan(result.synced.audit.snapshots)}`);
    console.log(`    Trends: ${chalk.cyan(result.synced.audit.trends)}`);
    console.log(`  DNA:`);
    console.log(`    Genes: ${chalk.cyan(result.synced.dna.genes)}`);
    console.log(`    Mutations: ${chalk.cyan(result.synced.dna.mutations)}`);
    console.log(`  Test Topology:`);
    console.log(`    Files: ${chalk.cyan(result.synced.testTopology.files)}`);
    console.log(`    Coverage: ${chalk.cyan(result.synced.testTopology.coverage)}`);
    console.log(`  Contracts:`);
    console.log(`    Contracts: ${chalk.cyan(result.synced.contracts.contracts)}`);
    console.log(`    Frontends: ${chalk.cyan(result.synced.contracts.frontends)}`);
    console.log(`  Constraints: ${chalk.cyan(result.synced.constraints)} items`);
    console.log(`  History: ${chalk.cyan(result.synced.history)} snapshots`);

    console.log();
    console.log(chalk.green(`✓ All data synced to: ${chalk.gray('.drift/drift.db')}`));

  } catch (error) {
    syncSpinner.fail('Sync failed');
    console.error(chalk.red((error as Error).message));
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log();
  status.success('Sync complete! drift.db is now the source of truth.');
  console.log();
}

migrateStorageCommand
  .command('sync')
  .description('Sync ALL data (boundaries, callgraph, env, audit, dna, tests) to SQLite')
  .option('-v, --verbose', 'Show detailed progress')
  .action(syncAllAction);

