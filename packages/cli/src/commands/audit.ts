/**
 * Audit Command - drift audit
 *
 * Run pattern audit to detect duplicates, validate cross-references,
 * and generate approval recommendations.
 *
 * @requirements AUDIT-SYSTEM.md
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  AuditEngine,
  AuditStore,
  type AuditResult,
  type AuditOptions,
} from 'driftdetect-core';
import {
  createPatternStore,
  getStorageInfo,
} from 'driftdetect-core/storage';

import { createSpinner, status } from '../ui/spinner.js';

export interface AuditCommandOptions {
  /** Generate review report (for agent or human) */
  review?: boolean;
  /** Compare to previous audit */
  compare?: string;
  /** CI mode - exit 1 if health below threshold */
  ci?: boolean;
  /** Health score threshold for CI (default: 85) */
  threshold?: number;
  /** Output format */
  format?: 'text' | 'json' | 'markdown';
  /** Export audit to file */
  export?: string;
  /** Enable verbose output */
  verbose?: boolean;
  /** Project root directory */
  root?: string;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/**
 * Check if drift is initialized
 */
async function isDriftInitialized(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the project root directory
 */
async function resolveProjectRoot(rootOption?: string): Promise<string> {
  if (rootOption) {
    return path.resolve(rootOption);
  }

  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    try {
      await fs.access(path.join(current, DRIFT_DIR));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }

  return process.cwd();
}

/**
 * Format health score with color
 */
function formatHealthScore(score: number): string {
  if (score >= 85) {return chalk.green(`${score}/100`);}
  if (score >= 70) {return chalk.yellow(`${score}/100`);}
  return chalk.red(`${score}/100`);
}

/**
 * Format recommendation with color
 */
function formatRecommendation(rec: string): string {
  switch (rec) {
    case 'auto-approve':
      return chalk.green('✓ Auto-approve');
    case 'review':
      return chalk.yellow('⚠ Review');
    case 'likely-false-positive':
      return chalk.red('✗ Likely false positive');
    default:
      return rec;
  }
}

/**
 * Print audit summary in text format
 */
function printTextSummary(result: AuditResult, verbose: boolean): void {
  console.log();
  console.log(chalk.bold('📊 Audit Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Total patterns:        ${chalk.cyan(result.summary.totalPatterns)}`);
  console.log(`  Auto-approve eligible: ${chalk.green(result.summary.autoApproveEligible)} (≥90% confidence)`);
  console.log(`  Needs review:          ${chalk.yellow(result.summary.flaggedForReview)}`);
  console.log(`  Likely false positives:${chalk.red(result.summary.likelyFalsePositives)}`);
  console.log(`  Duplicate candidates:  ${chalk.magenta(result.summary.duplicateCandidates)}`);
  console.log();
  console.log(`  Health Score:          ${formatHealthScore(result.summary.healthScore)}`);
  console.log();

  // Category breakdown
  const categories = Object.entries(result.summary.byCategory)
    .filter(([_, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  if (categories.length > 0) {
    console.log(chalk.bold('By Category'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const [category, data] of categories) {
      const avgConf = (data.avgConfidence * 100).toFixed(0);
      console.log(
        `  ${category.padEnd(15)} ${String(data.total).padStart(3)} patterns ` +
        `(${chalk.green(data.autoApproveEligible)} auto, ` +
        `${chalk.yellow(data.flaggedForReview)} review, ` +
        `${chalk.red(data.likelyFalsePositives)} fp) ` +
        `avg: ${avgConf}%`
      );
    }
    console.log();
  }

  // Duplicates
  if (result.duplicates.length > 0) {
    console.log(chalk.bold.magenta(`⚠️  ${result.duplicates.length} Duplicate Groups Detected`));
    console.log(chalk.gray('─'.repeat(50)));
    for (const group of result.duplicates.slice(0, 5)) {
      console.log(`  ${chalk.magenta(group.id)}: ${group.patternNames.join(', ')}`);
      console.log(chalk.gray(`    Similarity: ${(group.similarity * 100).toFixed(0)}% | ${group.reason}`));
      console.log(chalk.gray(`    Recommendation: ${group.recommendation}`));
    }
    if (result.duplicates.length > 5) {
      console.log(chalk.gray(`  ... and ${result.duplicates.length - 5} more`));
    }
    console.log();
  }

  // Cross-validation issues
  const issues = result.crossValidation.issues.filter(i => i.severity !== 'info');
  if (issues.length > 0) {
    console.log(chalk.bold.yellow(`⚠️  ${issues.length} Cross-Validation Issues`));
    console.log(chalk.gray('─'.repeat(50)));
    for (const issue of issues.slice(0, 5)) {
      const icon = issue.severity === 'error' ? '🔴' : '🟡';
      console.log(`  ${icon} ${issue.message}`);
    }
    if (issues.length > 5) {
      console.log(chalk.gray(`  ... and ${issues.length - 5} more`));
    }
    console.log();
  }

  // Degradation
  if (result.degradation) {
    const deg = result.degradation;
    const trendIcon = deg.trend === 'improving' ? '📈' : deg.trend === 'declining' ? '📉' : '➡️';
    console.log(chalk.bold(`${trendIcon} Trend: ${deg.trend}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Health delta:     ${deg.healthScoreDelta >= 0 ? '+' : ''}${deg.healthScoreDelta}`);
    console.log(`  Confidence delta: ${deg.confidenceDelta >= 0 ? '+' : ''}${(deg.confidenceDelta * 100).toFixed(1)}%`);
    if (deg.newIssues.length > 0) {
      console.log(`  New issues:       ${deg.newIssues.length}`);
    }
    if (deg.resolvedIssues.length > 0) {
      console.log(`  Resolved issues:  ${deg.resolvedIssues.length}`);
    }
    console.log();
  }

  // Verbose: show all patterns
  if (verbose) {
    console.log(chalk.bold('Pattern Details'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const p of result.patterns.slice(0, 20)) {
      console.log(`  ${p.id.slice(0, 8)} ${p.name.slice(0, 30).padEnd(30)} ${formatRecommendation(p.recommendation)}`);
      if (p.reasons.length > 0) {
        console.log(chalk.gray(`           ${p.reasons[0]}`));
      }
    }
    if (result.patterns.length > 20) {
      console.log(chalk.gray(`  ... and ${result.patterns.length - 20} more`));
    }
    console.log();
  }
}

/**
 * Print review report for agent assistance
 */
function printReviewReport(result: AuditResult): void {
  console.log();
  console.log(chalk.bold('🤖 Audit Review Report'));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();
  console.log(`Generated: ${result.generatedAt}`);
  console.log(`Scan Hash: ${result.scanHash}`);
  console.log(`Health Score: ${result.summary.healthScore}/100`);
  console.log();

  // Auto-approve candidates
  const autoApprove = result.patterns.filter(p => p.recommendation === 'auto-approve');
  if (autoApprove.length > 0) {
    console.log(chalk.bold.green(`✓ Auto-Approve Candidates (${autoApprove.length})`));
    console.log(chalk.gray('─'.repeat(60)));
    for (const p of autoApprove) {
      console.log(`  ${chalk.green('•')} ${p.name} (${p.category})`);
      console.log(chalk.gray(`    ID: ${p.id}`));
      console.log(chalk.gray(`    Confidence: ${(p.confidence * 100).toFixed(0)}% | Locations: ${p.locationCount}`));
      console.log(chalk.gray(`    Reasons: ${p.reasons.join(', ')}`));
      console.log();
    }
  }

  // Review candidates
  const review = result.patterns.filter(p => p.recommendation === 'review');
  if (review.length > 0) {
    console.log(chalk.bold.yellow(`⚠ Needs Review (${review.length})`));
    console.log(chalk.gray('─'.repeat(60)));
    for (const p of review.slice(0, 10)) {
      console.log(`  ${chalk.yellow('•')} ${p.name} (${p.category})`);
      console.log(chalk.gray(`    ID: ${p.id}`));
      console.log(chalk.gray(`    Confidence: ${(p.confidence * 100).toFixed(0)}% | Locations: ${p.locationCount} | Outliers: ${p.outlierCount}`));
      console.log(chalk.gray(`    Reasons: ${p.reasons.join(', ')}`));
      console.log();
    }
    if (review.length > 10) {
      console.log(chalk.gray(`  ... and ${review.length - 10} more`));
      console.log();
    }
  }

  // Likely false positives
  const falsePositives = result.patterns.filter(p => p.recommendation === 'likely-false-positive');
  if (falsePositives.length > 0) {
    console.log(chalk.bold.red(`✗ Likely False Positives (${falsePositives.length})`));
    console.log(chalk.gray('─'.repeat(60)));
    for (const p of falsePositives.slice(0, 5)) {
      console.log(`  ${chalk.red('•')} ${p.name} (${p.category})`);
      console.log(chalk.gray(`    ID: ${p.id}`));
      console.log(chalk.gray(`    Confidence: ${(p.confidence * 100).toFixed(0)}%`));
      console.log(chalk.gray(`    Reasons: ${p.reasons.join(', ')}`));
      console.log();
    }
    if (falsePositives.length > 5) {
      console.log(chalk.gray(`  ... and ${falsePositives.length - 5} more`));
      console.log();
    }
  }

  // Agent instructions
  console.log(chalk.bold('📋 Recommended Actions'));
  console.log(chalk.gray('─'.repeat(60)));
  if (autoApprove.length > 0) {
    console.log(`  1. Run ${chalk.cyan('drift approve --auto')} to approve ${autoApprove.length} high-confidence patterns`);
  }
  if (review.length > 0) {
    console.log(`  2. Review ${review.length} patterns manually or with agent assistance`);
  }
  if (falsePositives.length > 0) {
    console.log(`  3. Consider ignoring ${falsePositives.length} likely false positives with ${chalk.cyan('drift ignore <id>')}`);
  }
  if (result.duplicates.length > 0) {
    console.log(`  4. Review ${result.duplicates.length} duplicate groups for potential merging`);
  }
  console.log();
}

/**
 * Audit command implementation
 */
async function auditAction(options: AuditCommandOptions): Promise<void> {
  const rootDir = await resolveProjectRoot(options.root);
  const verbose = options.verbose ?? false;
  const format = options.format ?? 'text';
  const ciMode = options.ci ?? false;
  const threshold = options.threshold ?? 85;

  if (format === 'text' && !ciMode) {
    console.log();
    console.log(chalk.bold('🔍 Drift - Pattern Audit'));
    console.log(chalk.dim(`Project: ${rootDir}`));
    console.log();
  }

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Drift is not initialized' }));
    } else {
      status.error('Drift is not initialized. Run `drift init` first.');
    }
    process.exit(1);
  }

  // Load patterns (auto-detects SQLite vs JSON backend)
  const spinner = format === 'text' ? createSpinner('Loading patterns...') : null;
  spinner?.start();

  const patternStore = await createPatternStore({ rootDir });
  const patterns = patternStore.getAll();
  
  const storageInfo = getStorageInfo(rootDir);
  if (verbose && format === 'text') {
    const backendLabel = storageInfo.backend === 'sqlite' ? chalk.green('SQLite') : chalk.yellow('JSON');
    console.log(chalk.gray(`  Storage backend: ${backendLabel}`));
  }

  spinner?.succeed(`Loaded ${patterns.length} patterns`);

  if (patterns.length === 0) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No patterns found', patterns: 0 }));
    } else {
      status.info('No patterns found. Run `drift scan` first.');
    }
    return;
  }

  // Run audit
  const auditSpinner = format === 'text' ? createSpinner('Running audit...') : null;
  auditSpinner?.start();

  const auditEngine = new AuditEngine({ rootDir });
  const auditStore = new AuditStore({ rootDir });

  const auditOptions: AuditOptions = {
    crossValidateCallGraph: true,
    crossValidateConstraints: true,
    compareToPrevious: true,
  };

  const result = await auditEngine.runAudit(patterns, auditOptions);

  // Compare to previous if requested
  if (options.compare || auditOptions.compareToPrevious) {
    const previousDate = options.compare;
    const previous = previousDate 
      ? await auditStore.loadSnapshot(previousDate)
      : await auditStore.loadLatest();
    
    if (previous) {
      result.degradation = auditStore.compareAudits(result, previous);
    }
  }

  // Save audit
  await auditStore.saveAudit(result);

  auditSpinner?.succeed('Audit complete');

  // Output based on format
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'markdown') {
    // Markdown output for export
    console.log(`# Drift Audit Report\n`);
    console.log(`Generated: ${result.generatedAt}\n`);
    console.log(`## Summary\n`);
    console.log(`- Total Patterns: ${result.summary.totalPatterns}`);
    console.log(`- Health Score: ${result.summary.healthScore}/100`);
    console.log(`- Auto-approve Eligible: ${result.summary.autoApproveEligible}`);
    console.log(`- Needs Review: ${result.summary.flaggedForReview}`);
    console.log(`- Likely False Positives: ${result.summary.likelyFalsePositives}`);
    console.log(`- Duplicate Candidates: ${result.summary.duplicateCandidates}\n`);
  } else if (options.review) {
    printReviewReport(result);
  } else {
    printTextSummary(result, verbose);
  }

  // Export to file if requested
  if (options.export) {
    const exportPath = path.resolve(options.export);
    await fs.writeFile(exportPath, JSON.stringify(result, null, 2));
    if (format === 'text') {
      status.success(`Exported audit to ${exportPath}`);
    }
  }

  // CI mode: exit with error if below threshold
  if (ciMode) {
    if (result.summary.healthScore < threshold) {
      console.log(chalk.red(`\n❌ Health score ${result.summary.healthScore} is below threshold ${threshold}`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\n✓ Health score ${result.summary.healthScore} meets threshold ${threshold}`));
    }
  }

  // Show next steps
  if (format === 'text' && !ciMode && !options.review) {
    console.log(chalk.gray('Next steps:'));
    if (result.summary.autoApproveEligible > 0) {
      console.log(chalk.cyan(`  drift approve --auto`) + chalk.gray(`  - Auto-approve ${result.summary.autoApproveEligible} high-confidence patterns`));
    }
    console.log(chalk.cyan(`  drift audit --review`) + chalk.gray(`  - Generate detailed review report`));
    console.log();
  }

  // Sync audit data to SQLite
  try {
    const { createSyncService } = await import('driftdetect-core/storage');
    const syncService = createSyncService({ rootDir, verbose: false });
    await syncService.initialize();
    await syncService.syncAudit();
    await syncService.close();
    if (verbose) {
      console.log(chalk.gray('  Audit data synced to drift.db'));
    }
  } catch (syncError) {
    if (verbose) {
      console.log(chalk.yellow(`  Warning: Could not sync to SQLite: ${(syncError as Error).message}`));
    }
  }
}

/**
 * Status subcommand - show current audit status
 */
async function auditStatusAction(options: AuditCommandOptions): Promise<void> {
  const rootDir = await resolveProjectRoot(options.root);
  const format = options.format ?? 'text';

  if (!(await isDriftInitialized(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Drift is not initialized' }));
    } else {
      status.error('Drift is not initialized. Run `drift init` first.');
    }
    process.exit(1);
  }

  const auditStore = new AuditStore({ rootDir });
  const latest = await auditStore.loadLatest();

  if (!latest) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No audit found', hasAudit: false }));
    } else {
      status.info('No audit found. Run `drift audit` first.');
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify({
      hasAudit: true,
      generatedAt: latest.generatedAt,
      healthScore: latest.summary.healthScore,
      totalPatterns: latest.summary.totalPatterns,
      autoApproveEligible: latest.summary.autoApproveEligible,
      flaggedForReview: latest.summary.flaggedForReview,
      likelyFalsePositives: latest.summary.likelyFalsePositives,
      duplicateCandidates: latest.summary.duplicateCandidates,
    }));
  } else {
    console.log();
    console.log(chalk.bold('📊 Last Audit Status'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Generated:             ${latest.generatedAt}`);
    console.log(`  Health Score:          ${formatHealthScore(latest.summary.healthScore)}`);
    console.log(`  Total Patterns:        ${latest.summary.totalPatterns}`);
    console.log(`  Auto-approve Eligible: ${chalk.green(latest.summary.autoApproveEligible)}`);
    console.log(`  Needs Review:          ${chalk.yellow(latest.summary.flaggedForReview)}`);
    console.log(`  Likely False Positives:${chalk.red(latest.summary.likelyFalsePositives)}`);
    console.log(`  Duplicate Candidates:  ${chalk.magenta(latest.summary.duplicateCandidates)}`);
    console.log();
  }
}

/**
 * Trends subcommand - show quality trends over time
 */
async function auditTrendsAction(options: AuditCommandOptions): Promise<void> {
  const rootDir = await resolveProjectRoot(options.root);
  const format = options.format ?? 'text';

  if (!(await isDriftInitialized(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Drift is not initialized' }));
    } else {
      status.error('Drift is not initialized. Run `drift init` first.');
    }
    process.exit(1);
  }

  const auditStore = new AuditStore({ rootDir });
  const tracking = await auditStore.getDegradationTracking();

  if (!tracking || tracking.history.length === 0) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No audit history found', hasHistory: false }));
    } else {
      status.info('No audit history found. Run `drift audit` multiple times to build history.');
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(tracking, null, 2));
  } else {
    console.log();
    console.log(chalk.bold('📈 Audit Trends'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Health Trend:     ${tracking.trends.healthTrend}`);
    console.log(`  Confidence Trend: ${tracking.trends.confidenceTrend}`);
    console.log(`  Pattern Growth:   ${tracking.trends.patternGrowth}`);
    console.log();

    if (tracking.alerts.length > 0) {
      console.log(chalk.bold.yellow('⚠️  Active Alerts'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const alert of tracking.alerts) {
        const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
        console.log(`  ${icon} ${alert.message}`);
      }
      console.log();
    }

    console.log(chalk.bold('History (last 7 entries)'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const entry of tracking.history.slice(-7).reverse()) {
      console.log(
        `  ${entry.date}  Health: ${String(entry.healthScore).padStart(3)}  ` +
        `Patterns: ${String(entry.totalPatterns).padStart(4)}  ` +
        `Approved: ${String(entry.approvedCount).padStart(3)}`
      );
    }
    console.log();
  }
}

// Main command
export const auditCommand = new Command('audit')
  .description('Run pattern audit to detect duplicates, validate cross-references, and generate recommendations')
  .option('-r, --root <path>', 'Project root directory')
  .option('--review', 'Generate detailed review report (for agent or human)')
  .option('--compare <date>', 'Compare to audit from specific date (YYYY-MM-DD)')
  .option('--ci', 'CI mode - exit 1 if health below threshold')
  .option('--threshold <number>', 'Health score threshold for CI (default: 85)', '85')
  .option('-f, --format <format>', 'Output format (text, json, markdown)', 'text')
  .option('-e, --export <file>', 'Export audit to file')
  .option('--verbose', 'Enable verbose output')
  .action((options: AuditCommandOptions) => {
    if (typeof options.threshold === 'string') {
      options.threshold = parseInt(options.threshold, 10);
    }
    return auditAction(options);
  });

// Subcommands
auditCommand
  .command('status')
  .description('Show current audit status')
  .option('-r, --root <path>', 'Project root directory')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(auditStatusAction);

auditCommand
  .command('trends')
  .description('Show quality trends over time')
  .option('-r, --root <path>', 'Project root directory')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(auditTrendsAction);
