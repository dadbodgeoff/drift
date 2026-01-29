/**
 * Telemetry Command - drift telemetry
 *
 * Manage telemetry settings for Drift.
 * All telemetry is opt-in and privacy-first.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createTelemetryClient,
  generateInstallationId,
  DEFAULT_TELEMETRY_CONFIG,
  type TelemetryConfig,
} from 'driftdetect-core';

import { confirmPrompt } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const CONFIG_FILE = 'config.json';

// ============================================================================
// Helpers
// ============================================================================

async function loadConfig(rootDir: string): Promise<Record<string, unknown>> {
  const configPath = path.join(rootDir, DRIFT_DIR, CONFIG_FILE);
  const content = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

async function saveConfig(rootDir: string, config: Record<string, unknown>): Promise<void> {
  const configPath = path.join(rootDir, DRIFT_DIR, CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

function formatEnabled(enabled: boolean): string {
  return enabled ? chalk.green('✓ enabled') : chalk.gray('✗ disabled');
}

// ============================================================================
// Status Action
// ============================================================================

async function statusAction(): Promise<void> {
  const rootDir = process.cwd();

  try {
    const config = await loadConfig(rootDir);
    const telemetry = (config['telemetry'] as TelemetryConfig) ?? DEFAULT_TELEMETRY_CONFIG;

    console.log();
    console.log(chalk.bold('📊 Telemetry Status'));
    console.log();

    console.log(`  Master switch:        ${formatEnabled(telemetry.enabled)}`);
    console.log(`  Pattern signatures:   ${formatEnabled(telemetry.sharePatternSignatures)}`);
    console.log(`  Aggregate stats:      ${formatEnabled(telemetry.shareAggregateStats)}`);
    console.log(`  User actions:         ${formatEnabled(telemetry.shareUserActions)}`);

    if (telemetry.installationId) {
      console.log();
      console.log(chalk.gray(`  Installation ID: ${telemetry.installationId.substring(0, 8)}...`));
    }

    if (telemetry.enabledAt) {
      console.log(chalk.gray(`  Enabled since: ${new Date(telemetry.enabledAt).toLocaleDateString()}`));
    }

    // Show queue status
    const driftDir = path.join(rootDir, DRIFT_DIR);
    const client = createTelemetryClient(driftDir, telemetry);
    await client.initialize();
    const clientStatus = await client.getStatus();

    if (clientStatus.queuedEvents > 0) {
      console.log();
      console.log(chalk.yellow(`  Queued events: ${clientStatus.queuedEvents}`));
    }

    console.log();
    console.log(chalk.gray('  Run `drift telemetry --help` for options'));
    console.log();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      status.error('Drift not initialized. Run `drift init` first.');
    } else {
      status.error(`Failed to read config: ${(error as Error).message}`);
    }
    process.exit(1);
  }
}

// ============================================================================
// Enable Action
// ============================================================================

async function enableAction(options: { all?: boolean; yes?: boolean }): Promise<void> {
  const rootDir = process.cwd();

  try {
    const config = await loadConfig(rootDir);
    const telemetry = (config['telemetry'] as TelemetryConfig) ?? { ...DEFAULT_TELEMETRY_CONFIG };

    console.log();
    console.log(chalk.bold('🔒 Enable Telemetry'));
    console.log();
    console.log(chalk.gray('  Drift telemetry is privacy-first:'));
    console.log(chalk.gray('  • No source code is ever sent'));
    console.log(chalk.gray('  • Only anonymized pattern signatures and counts'));
    console.log(chalk.gray('  • Helps improve pattern detection for everyone'));
    console.log();

    if (!options.yes) {
      const confirm = await confirmPrompt(
        'Enable telemetry to help improve Drift?',
        true
      );
      if (!confirm) {
        status.info('Telemetry not enabled');
        return;
      }
    }

    // Enable telemetry
    telemetry.enabled = true;
    telemetry.enabledAt = new Date().toISOString();

    if (!telemetry.installationId) {
      telemetry.installationId = generateInstallationId();
    }

    if (options.all) {
      // Enable all sharing options
      telemetry.sharePatternSignatures = true;
      telemetry.shareAggregateStats = true;
      telemetry.shareUserActions = true;
    } else if (!options.yes) {
      // Interactive selection
      console.log();
      console.log(chalk.bold('Select what to share:'));
      console.log();

      telemetry.sharePatternSignatures = await confirmPrompt(
        'Share pattern signatures (anonymized hashes, categories, confidence)?',
        true
      );

      telemetry.shareAggregateStats = await confirmPrompt(
        'Share aggregate statistics (pattern counts, languages detected)?',
        true
      );

      telemetry.shareUserActions = await confirmPrompt(
        'Share user actions (approve/ignore decisions, no code)?',
        false
      );
    } else {
      // Default to pattern signatures and stats only
      telemetry.sharePatternSignatures = true;
      telemetry.shareAggregateStats = true;
      telemetry.shareUserActions = false;
    }

    config['telemetry'] = telemetry;
    await saveConfig(rootDir, config);

    console.log();
    status.success('Telemetry enabled');
    console.log();
    console.log(chalk.gray('  Thank you for helping improve Drift! 🙏'));
    console.log(chalk.gray('  Run `drift telemetry` to see current settings'));
    console.log();
  } catch (error) {
    status.error(`Failed to enable telemetry: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ============================================================================
// Disable Action
// ============================================================================

async function disableAction(options: { yes?: boolean }): Promise<void> {
  const rootDir = process.cwd();

  try {
    const config = await loadConfig(rootDir);
    const telemetry = (config['telemetry'] as TelemetryConfig) ?? { ...DEFAULT_TELEMETRY_CONFIG };

    if (!telemetry.enabled) {
      status.info('Telemetry is already disabled');
      return;
    }

    if (!options.yes) {
      const confirm = await confirmPrompt(
        'Disable telemetry?',
        false
      );
      if (!confirm) {
        status.info('Telemetry remains enabled');
        return;
      }
    }

    // Disable everything
    telemetry.enabled = false;
    telemetry.sharePatternSignatures = false;
    telemetry.shareAggregateStats = false;
    telemetry.shareUserActions = false;

    config['telemetry'] = telemetry;
    await saveConfig(rootDir, config);

    // Clear any queued events
    const driftDir = path.join(rootDir, DRIFT_DIR);
    const queuePath = path.join(driftDir, 'telemetry-queue.json');
    try {
      await fs.unlink(queuePath);
    } catch {
      // Queue file might not exist
    }

    console.log();
    status.success('Telemetry disabled');
    console.log();
    console.log(chalk.gray('  All queued events have been cleared'));
    console.log(chalk.gray('  No data will be sent'));
    console.log();
  } catch (error) {
    status.error(`Failed to disable telemetry: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ============================================================================
// Setup Action (Interactive)
// ============================================================================

async function setupAction(): Promise<void> {
  const rootDir = process.cwd();

  try {
    const config = await loadConfig(rootDir);
    const telemetry = (config['telemetry'] as TelemetryConfig) ?? { ...DEFAULT_TELEMETRY_CONFIG };

    console.log();
    console.log(chalk.bold('⚙️  Telemetry Setup'));
    console.log();
    console.log(chalk.gray('  Configure what telemetry data Drift can collect.'));
    console.log(chalk.gray('  All data is anonymized and no source code is ever sent.'));
    console.log();

    // Master switch
    telemetry.enabled = await confirmPrompt(
      'Enable telemetry?',
      telemetry.enabled
    );

    if (telemetry.enabled) {
      if (!telemetry.installationId) {
        telemetry.installationId = generateInstallationId();
        telemetry.enabledAt = new Date().toISOString();
      }

      console.log();
      console.log(chalk.bold('Select data to share:'));
      console.log();

      telemetry.sharePatternSignatures = await confirmPrompt(
        'Pattern signatures (anonymized hashes, categories, confidence)',
        telemetry.sharePatternSignatures
      );

      telemetry.shareAggregateStats = await confirmPrompt(
        'Aggregate statistics (pattern counts, languages, frameworks)',
        telemetry.shareAggregateStats
      );

      telemetry.shareUserActions = await confirmPrompt(
        'User actions (approve/ignore decisions, helps ML training)',
        telemetry.shareUserActions
      );
    }

    config['telemetry'] = telemetry;
    await saveConfig(rootDir, config);

    console.log();
    status.success('Telemetry settings saved');
    console.log();
  } catch (error) {
    status.error(`Failed to setup telemetry: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ============================================================================
// Flush Action
// ============================================================================

async function flushAction(): Promise<void> {
  const rootDir = process.cwd();

  try {
    const config = await loadConfig(rootDir);
    const telemetry = (config['telemetry'] as TelemetryConfig) ?? DEFAULT_TELEMETRY_CONFIG;

    if (!telemetry.enabled) {
      status.info('Telemetry is disabled. Nothing to flush.');
      return;
    }

    const driftDir = path.join(rootDir, DRIFT_DIR);
    const client = createTelemetryClient(driftDir, telemetry);
    await client.initialize();

    const statusBefore = await client.getStatus();
    if (statusBefore.queuedEvents === 0) {
      status.info('No queued events to flush');
      return;
    }

    const spinner = createSpinner(`Flushing ${statusBefore.queuedEvents} events...`);
    spinner.start();

    const result = await client.flush();

    if (result.success) {
      spinner.succeed(`Flushed ${result.eventsSubmitted} events`);
    } else {
      spinner.fail(`Flush failed: ${result.error}`);
    }
  } catch (error) {
    status.error(`Failed to flush: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ============================================================================
// Command Definition
// ============================================================================

export const telemetryCommand = new Command('telemetry')
  .description('Manage telemetry settings (opt-in, privacy-first)')
  .action(statusAction);

telemetryCommand
  .command('enable')
  .description('Enable telemetry')
  .option('--all', 'Enable all telemetry options')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(enableAction);

telemetryCommand
  .command('disable')
  .description('Disable telemetry and clear queued data')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(disableAction);

telemetryCommand
  .command('setup')
  .description('Interactive telemetry configuration')
  .action(setupAction);

telemetryCommand
  .command('flush')
  .description('Manually flush queued telemetry events')
  .action(flushAction);
