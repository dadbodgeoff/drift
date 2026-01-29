/**
 * License Command - drift license
 *
 * Display license status and available features.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import {
  getLicenseManager,
  getLicenseStatus,
  FEATURE_TIERS,
  TIER_HIERARCHY,
  type EnterpriseFeature,
  type LicenseTier,
} from 'driftdetect-core';

export interface LicenseOptions {
  /** Output format */
  format?: 'text' | 'json';
}

/**
 * Format tier with color
 */
function formatTier(tier: LicenseTier): string {
  switch (tier) {
    case 'enterprise':
      return chalk.magenta.bold(tier);
    case 'team':
      return chalk.blue.bold(tier);
    case 'community':
    default:
      return chalk.green.bold(tier);
  }
}

/**
 * Group features by tier
 */
function groupFeaturesByTier(): Record<LicenseTier, EnterpriseFeature[]> {
  const grouped: Record<LicenseTier, EnterpriseFeature[]> = {
    community: [],
    team: [],
    enterprise: [],
  };

  for (const [feature, tier] of Object.entries(FEATURE_TIERS)) {
    grouped[tier].push(feature as EnterpriseFeature);
  }

  return grouped;
}

/**
 * License command implementation
 */
async function licenseAction(options: LicenseOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const status = await getLicenseStatus(rootDir);
    const manager = getLicenseManager(rootDir);
    const source = manager.getSource();

    if (format === 'json') {
      console.log(JSON.stringify({
        ...status,
        source,
        allFeatures: groupFeaturesByTier(),
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('🔑 Drift License Status'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();

    // Current tier
    console.log(`  Tier:         ${formatTier(status.tier)}`);
    
    // License source
    const sourceLabel = {
      environment: 'DRIFT_LICENSE_KEY env var',
      file: '.drift/license.key file',
      config: '.drift/config.json',
      none: 'No license (Community)',
    }[source];
    console.log(`  Source:       ${chalk.gray(sourceLabel)}`);

    // Organization (if licensed)
    if (status.organization) {
      console.log(`  Organization: ${chalk.cyan(status.organization)}`);
    }

    // Expiration
    if (status.expiresAt) {
      const daysLabel = status.daysRemaining !== null
        ? status.daysRemaining > 0
          ? chalk.yellow(`(${status.daysRemaining} days remaining)`)
          : chalk.red('(EXPIRED)')
        : '';
      console.log(`  Expires:      ${status.expiresAt} ${daysLabel}`);
    }

    // Warnings
    if (status.warnings.length > 0) {
      console.log();
      console.log(chalk.yellow('  ⚠️  Warnings:'));
      for (const warning of status.warnings) {
        console.log(chalk.yellow(`      • ${warning}`));
      }
    }

    // Available features
    console.log();
    console.log(chalk.bold('  Available Features:'));
    console.log();

    const grouped = groupFeaturesByTier();
    const currentLevel = TIER_HIERARCHY[status.tier];

    for (const tier of ['community', 'team', 'enterprise'] as LicenseTier[]) {
      const tierLevel = TIER_HIERARCHY[tier];
      const isAvailable = tierLevel <= currentLevel;
      const features = grouped[tier];

      if (features.length === 0) {continue;}

      const tierLabel = isAvailable
        ? chalk.green(`✓ ${tier.toUpperCase()}`)
        : chalk.gray(`○ ${tier.toUpperCase()}`);
      
      console.log(`  ${tierLabel}`);

      for (const feature of features) {
        const featureLabel = isAvailable
          ? chalk.green(`    ✓ ${feature}`)
          : chalk.gray(`    ○ ${feature}`);
        console.log(featureLabel);
      }
      console.log();
    }

    // Upgrade prompt for non-enterprise
    if (status.tier !== 'enterprise') {
      console.log(chalk.gray('─'.repeat(50)));
      console.log();
      console.log(`  ${chalk.cyan('Upgrade to unlock more features:')}`);
      console.log(`  ${chalk.underline('https://driftscan.dev/pricing')}`);
      console.log();
    }

  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

export const licenseCommand = new Command('license')
  .description('Display license status and available features')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(licenseAction);
