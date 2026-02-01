/**
 * Setup UI - Console output helpers
 * 
 * @module commands/setup/ui
 */

import chalk from 'chalk';

import type { BaseRunner } from './runners/base.js';
import type { SourceOfTruth, FeatureResult } from './types.js';

export function printWelcome(): void {
  console.log();
  console.log(chalk.bold.magenta('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.magenta('║') + chalk.bold('           🔍 Drift Setup Wizard                           ') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('║') + chalk.gray('   Create your codebase Source of Truth                    ') + chalk.bold.magenta('║'));
  console.log(chalk.bold.magenta('╚════════════════════════════════════════════════════════════╝'));
  console.log();
}

export function printPhase(num: number, title: string, description: string): void {
  console.log();
  console.log(chalk.bold.cyan(`━━━ Phase ${num}: ${title} ━━━`));
  console.log(chalk.gray(`    ${description}`));
  console.log();
}

export function printFeature(runner: BaseRunner): void {
  console.log(`  ${runner.icon} ${chalk.bold(runner.name)}`);
  console.log(chalk.gray(`     ${runner.description}`));
  console.log(chalk.green(`     → ${runner.benefit}`));
  console.log();
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

export function printSkip(message: string): void {
  console.log(chalk.gray(`  ○ ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.gray(`    ${message}`));
}

export function printSummary(sot: SourceOfTruth): void {
  console.log();
  console.log(chalk.bold.green('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.green('║') + chalk.bold('                    Setup Complete! 🎉                      ') + chalk.bold.green('║'));
  console.log(chalk.bold.green('╚════════════════════════════════════════════════════════════╝'));
  console.log();

  console.log(chalk.bold('  Source of Truth Created'));
  console.log(chalk.gray(`    ID: ${sot.baseline.scanId}`));
  console.log(chalk.gray(`    Checksum: ${sot.baseline.checksum}`));
  console.log();

  console.log(chalk.bold('  What was configured:'));
  printSuccess(`Project: ${sot.project.name}`);

  if (sot.baseline.patternCount > 0) {
    printSuccess(`${sot.baseline.patternCount} patterns discovered`);
  }
  if (sot.baseline.approvedCount > 0) {
    printSuccess(`${sot.baseline.approvedCount} patterns approved`);
  }

  // Show stats from each feature
  printFeatureStats('Call graph', sot.features.callGraph, ['functions', 'entryPoints']);
  printFeatureStats('Test topology', sot.features.testTopology, ['totalTests', 'testFiles']);
  printFeatureStats('Coupling', sot.features.coupling, ['modules', 'cycles', 'healthScore']);
  printFeatureStats('DNA', sot.features.dna, ['genes', 'healthScore']);

  if (sot.features.memory.enabled) {
    printSuccess('Memory system initialized');
  }

  console.log();
  console.log(chalk.bold('  What happens next:'));
  console.log(chalk.gray('    • All data is pre-computed for fast CLI/MCP access'));
  console.log(chalk.gray('    • Future scans are tracked against this baseline'));
  console.log(chalk.gray('    • Changes require explicit approval'));
  console.log(chalk.gray('    • Backups are created before destructive operations'));
  console.log();

  console.log(chalk.bold('  Quick commands:'));
  console.log(chalk.cyan('    drift status') + chalk.gray('          - See current state'));
  console.log(chalk.cyan('    drift dashboard') + chalk.gray('       - Visual pattern browser'));
  console.log(chalk.cyan('    drift check') + chalk.gray('           - Check for violations'));
  if (sot.baseline.approvedCount === 0 && sot.baseline.patternCount > 0) {
    console.log(chalk.cyan('    drift approve all') + chalk.gray('     - Review patterns'));
  }
  console.log();

  console.log(chalk.bold('  For AI integration:'));
  console.log(chalk.gray('    Install: ') + chalk.cyan('npm install -g driftdetect-mcp'));
  console.log(chalk.gray('    Then configure your AI tool (Claude, Cursor, Kiro)'));
  console.log();
}

function printFeatureStats(
  name: string,
  config: { enabled: boolean; stats?: Record<string, number> },
  keys: string[]
): void {
  if (!config.enabled || !config.stats) return;

  const parts: string[] = [];
  for (const key of keys) {
    const value = config.stats[key];
    if (value !== undefined) {
      parts.push(`${value} ${key}`);
    }
  }

  if (parts.length > 0) {
    printSuccess(`${name}: ${parts.join(', ')}`);
  }
}

export function formatFeatureResult(name: string, result: FeatureResult): string {
  if (!result.success) {
    return chalk.red(`${name}: Failed - ${result.error}`);
  }

  if (!result.stats) {
    return chalk.green(`${name}: Initialized`);
  }

  const parts = Object.entries(result.stats)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');

  return chalk.green(`${name}: ${parts}`);
}
