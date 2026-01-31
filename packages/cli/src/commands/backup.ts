/**
 * Backup Command - drift backup
 *
 * Enterprise-grade backup and restore for .drift data.
 * Ensures data safety during version upgrades and migrations.
 *
 * Commands:
 * - drift backup create    - Create a backup
 * - drift backup list      - List all backups
 * - drift backup restore   - Restore from a backup
 * - drift backup delete    - Delete a backup (requires confirmation)
 * - drift backup info      - Show backup details
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createWorkspaceManager,
  type BackupMetadata,
} from 'driftdetect-core';

import { confirmPrompt, selectPrompt, inputPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';
import { VERSION } from '../index.js';

// ============================================================================
// Formatters
// ============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString();
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(isoDate);
}

function formatReason(reason: string): string {
  const labels: Record<string, string> = {
    version_upgrade: '🔄 Version Upgrade',
    schema_migration: '📦 Schema Migration',
    user_requested: '👤 User Requested',
    pre_destructive_operation: '⚠️ Pre-Destructive',
    scheduled: '⏰ Scheduled',
    auto_save: '💾 Auto Save',
  };
  return labels[reason] ?? reason;
}

// ============================================================================
// Create Command
// ============================================================================

interface CreateOptions {
  reason?: string;
  format?: 'text' | 'json';
}

async function createAction(options: CreateOptions): Promise<void> {
  const cwd = process.cwd();
  const manager = createWorkspaceManager(cwd);
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Creating backup...') : null;
  spinner?.start();

  try {
    await manager.initialize({ driftVersion: VERSION });
    
    const reason = (options.reason ?? 'user_requested') as 'user_requested' | 'pre_destructive_operation' | 'scheduled';
    const result = await manager.createBackup(reason);

    spinner?.stop();

    if (result.success) {
      if (format === 'json') {
        console.log(JSON.stringify({
          success: true,
          backupId: result.backupId,
          path: result.backupPath,
          size: result.metadata.sizeBytes,
          files: result.metadata.files.length,
          checksum: result.metadata.checksum,
        }));
        return;
      }
      
      spinner?.succeed(`Backup created: ${chalk.cyan(result.backupId)}`);
      console.log();
      console.log(chalk.gray(`  Path: ${result.backupPath}`));
      console.log(chalk.gray(`  Size: ${formatSize(result.metadata.sizeBytes)}`));
      console.log(chalk.gray(`  Files: ${result.metadata.files.length}`));
      console.log(chalk.gray(`  Checksum: ${result.metadata.checksum.slice(0, 16)}...`));
      console.log();
    } else {
      if (format === 'json') {
        console.log(JSON.stringify({ success: false, error: result.error }));
        return;
      }
      spinner?.fail(`Backup failed: ${result.error}`);
    }
  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ success: false, error: (error as Error).message }));
      return;
    }
    spinner?.fail(`Backup failed: ${(error as Error).message}`);
  }
}

// ============================================================================
// List Command
// ============================================================================

interface ListOptions {
  json?: boolean;
  limit?: string;
}

async function listAction(options: ListOptions): Promise<void> {
  const cwd = process.cwd();
  const manager = createWorkspaceManager(cwd);

  try {
    await manager.initialize({ skipMigration: true });
    const backups = await manager.listBackups();

    if (options.json) {
      console.log(JSON.stringify(backups, null, 2));
      return;
    }

    if (backups.length === 0) {
      console.log();
      console.log(chalk.yellow('No backups found.'));
      console.log(chalk.gray('Run `drift backup create` to create one.'));
      console.log();
      return;
    }

    const limit = options.limit ? parseInt(options.limit, 10) : backups.length;
    const displayBackups = backups.slice(0, limit);

    console.log();
    console.log(chalk.bold(`📦 Backups (${backups.length} total)`));
    console.log();

    // Table header
    console.log(
      chalk.gray(
        '  ' +
          'ID'.padEnd(10) +
          'Created'.padEnd(18) +
          'Reason'.padEnd(22) +
          'Size'.padEnd(10) +
          'Version'
      )
    );
    console.log(chalk.gray('  ' + '─'.repeat(75)));

    for (const backup of displayBackups) {
      console.log(
        '  ' +
          chalk.cyan(backup.id.padEnd(10)) +
          chalk.gray(formatRelativeDate(backup.createdAt).padEnd(18)) +
          formatReason(backup.reason).padEnd(22) +
          chalk.white(formatSize(backup.sizeBytes).padEnd(10)) +
          chalk.gray(backup.driftVersion)
      );
    }

    console.log();
    
    if (backups.length > limit) {
      console.log(chalk.gray(`  ... and ${backups.length - limit} more. Use --limit to see more.`));
      console.log();
    }
  } catch (error) {
    status.error(`Failed to list backups: ${(error as Error).message}`);
  }
}

// ============================================================================
// Restore Command
// ============================================================================

async function restoreAction(backupId?: string): Promise<void> {
  const cwd = process.cwd();
  const manager = createWorkspaceManager(cwd);

  try {
    await manager.initialize({ skipMigration: true });
    const backups = await manager.listBackups();

    if (backups.length === 0) {
      status.error('No backups available');
      return;
    }

    let targetBackup: BackupMetadata | undefined;

    if (backupId) {
      targetBackup = backups.find(b => b.id === backupId);
      if (!targetBackup) {
        status.error(`Backup not found: ${backupId}`);
        return;
      }
    } else {
      // Interactive selection
      const choices = backups.map(b => ({
        name: `${b.id} - ${formatRelativeDate(b.createdAt)} - ${formatReason(b.reason)} (${formatSize(b.sizeBytes)})`,
        value: b.id,
      }));

      const selectedId = await selectPrompt('Select backup to restore:', choices);
      targetBackup = backups.find(b => b.id === selectedId);
    }

    if (!targetBackup) {
      status.error('Backup not found');
      return;
    }

    // Confirm restore
    console.log();
    console.log(chalk.yellow('⚠️  This will replace your current .drift data with the backup.'));
    console.log(chalk.gray(`   A backup of the current state will be created first.`));
    console.log();

    const confirmed = await confirmPrompt(
      `Restore from backup ${targetBackup.id}?`,
      false
    );

    if (!confirmed) {
      status.info('Cancelled');
      return;
    }

    const spinner = createSpinner('Restoring backup...');
    spinner.start();

    const result = await manager.restore(targetBackup.id);

    if (result.success) {
      spinner.succeed(`Restored ${result.filesRestored} files from backup`);
      console.log(chalk.gray(`  From: ${result.restoredFrom}`));
    } else {
      spinner.fail(`Restore failed: ${result.error}`);
    }
  } catch (error) {
    status.error(`Restore failed: ${(error as Error).message}`);
  }
}

// ============================================================================
// Delete Command
// ============================================================================

async function deleteAction(backupId?: string): Promise<void> {
  const cwd = process.cwd();
  const manager = createWorkspaceManager(cwd);

  try {
    await manager.initialize({ skipMigration: true });
    const backups = await manager.listBackups();

    if (backups.length === 0) {
      status.error('No backups available');
      return;
    }

    let targetBackup: BackupMetadata | undefined;

    if (backupId) {
      targetBackup = backups.find(b => b.id === backupId);
      if (!targetBackup) {
        status.error(`Backup not found: ${backupId}`);
        return;
      }
    } else {
      // Interactive selection
      const choices = backups.map(b => ({
        name: `${b.id} - ${formatRelativeDate(b.createdAt)} - ${formatReason(b.reason)}`,
        value: b.id,
      }));

      const selectedId = await selectPrompt('Select backup to delete:', choices);
      targetBackup = backups.find(b => b.id === selectedId);
    }

    if (!targetBackup) {
      status.error('Backup not found');
      return;
    }

    // Require explicit confirmation
    console.log();
    console.log(chalk.red('⚠️  This action is irreversible!'));
    console.log(chalk.gray(`   Backup: ${targetBackup.id}`));
    console.log(chalk.gray(`   Created: ${formatDate(targetBackup.createdAt)}`));
    console.log(chalk.gray(`   Size: ${formatSize(targetBackup.sizeBytes)}`));
    console.log();

    const confirmation = await inputPrompt(
      'Type DELETE to confirm deletion:',
      ''
    );

    if (confirmation !== 'DELETE') {
      status.info('Deletion cancelled (confirmation token not provided)');
      return;
    }

    const spinner = createSpinner('Deleting backup...');
    spinner.start();

    const success = await manager.deleteBackup(targetBackup.id, 'DELETE');

    if (success) {
      spinner.succeed(`Deleted backup ${targetBackup.id}`);
    } else {
      spinner.fail('Failed to delete backup');
    }
  } catch (error) {
    status.error(`Delete failed: ${(error as Error).message}`);
  }
}

// ============================================================================
// Info Command
// ============================================================================

interface InfoOptions {
  format?: 'text' | 'json';
}

async function infoAction(backupId?: string, options?: InfoOptions): Promise<void> {
  const cwd = process.cwd();
  const manager = createWorkspaceManager(cwd);
  const format = options?.format ?? 'text';

  try {
    await manager.initialize({ skipMigration: true });
    const backups = await manager.listBackups();

    if (backups.length === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'No backups available' }));
        return;
      }
      status.error('No backups available');
      return;
    }

    let targetBackup: BackupMetadata | undefined;

    if (backupId) {
      targetBackup = backups.find(b => b.id === backupId);
    } else {
      // Show most recent
      targetBackup = backups[0];
    }

    if (!targetBackup) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: `Backup not found: ${backupId}` }));
        return;
      }
      status.error(`Backup not found: ${backupId}`);
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(targetBackup, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`📦 Backup: ${targetBackup.id}`));
    console.log();
    console.log(chalk.gray('  Created:       ') + formatDate(targetBackup.createdAt));
    console.log(chalk.gray('  Reason:        ') + formatReason(targetBackup.reason));
    console.log(chalk.gray('  Size:          ') + formatSize(targetBackup.sizeBytes));
    console.log(chalk.gray('  Drift Version: ') + targetBackup.driftVersion);
    console.log(chalk.gray('  Schema:        ') + targetBackup.schemaVersion);
    console.log(chalk.gray('  Compressed:    ') + (targetBackup.compressed ? 'Yes' : 'No'));
    console.log(chalk.gray('  Checksum:      ') + targetBackup.checksum);
    console.log(chalk.gray('  Project:       ') + targetBackup.projectName);
    console.log(chalk.gray('  Original Path: ') + targetBackup.originalPath);
    console.log();
    console.log(chalk.gray(`  Files (${targetBackup.files.length}):`));
    
    const maxFiles = 10;
    const displayFiles = targetBackup.files.slice(0, maxFiles);
    for (const file of displayFiles) {
      console.log(chalk.gray(`    - ${file}`));
    }
    if (targetBackup.files.length > maxFiles) {
      console.log(chalk.gray(`    ... and ${targetBackup.files.length - maxFiles} more`));
    }
    console.log();
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: (error as Error).message }));
      return;
    }
    status.error(`Failed to get backup info: ${(error as Error).message}`);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export const backupCommand = new Command('backup')
  .description('Manage .drift backups')
  .addCommand(
    new Command('create')
      .description('Create a backup of .drift data')
      .option('-r, --reason <reason>', 'Backup reason (user_requested, scheduled)')
      .option('--format <format>', 'Output format (text, json)', 'text')
      .action(createAction)
  )
  .addCommand(
    new Command('list')
      .alias('ls')
      .description('List all backups')
      .option('--json', 'Output as JSON')
      .option('--format <format>', 'Output format (text, json)', 'text')
      .option('-l, --limit <n>', 'Limit number of backups shown')
      .action((opts) => listAction({ ...opts, json: opts.json || opts.format === 'json' }))
  )
  .addCommand(
    new Command('restore')
      .description('Restore from a backup')
      .argument('[backup-id]', 'Backup ID to restore')
      .action(restoreAction)
  )
  .addCommand(
    new Command('delete')
      .alias('rm')
      .description('Delete a backup (requires typing DELETE)')
      .argument('[backup-id]', 'Backup ID to delete')
      .action(deleteAction)
  )
  .addCommand(
    new Command('info')
      .description('Show backup details')
      .argument('[backup-id]', 'Backup ID (default: most recent)')
      .option('--format <format>', 'Output format (text, json)', 'text')
      .action(infoAction)
  );

// Default action (list)
backupCommand.action(listAction);
