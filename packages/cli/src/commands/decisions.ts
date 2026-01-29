/**
 * Decision Mining Command - drift decisions
 *
 * Mine architectural decisions from git history.
 * Analyzes commits to discover and synthesize ADRs (Architecture Decision Records).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createDecisionMiningAnalyzer,
  type MinedDecision,
  type DecisionMiningResult,
  type DecisionMiningSummary,
  type DecisionCategory,
  type DecisionConfidence,
  type DecisionStatus,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface DecisionsOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  limit?: number;
  since?: string;
  until?: string;
  minConfidence?: string;
  category?: string;
  status?: string;
}

const DRIFT_DIR = '.drift';
const DECISIONS_DIR = 'decisions';

/**
 * Check if decisions data exists
 */
async function decisionsExist(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, 'index.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when decisions not mined
 */
function showNotMinedMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No decisions mined yet.'));
  console.log();
  console.log(chalk.gray('Mine decisions from git history:'));
  console.log();
  console.log(chalk.cyan('  drift decisions mine'));
  console.log();
}

/**
 * Load decisions from disk
 */
async function loadDecisions(rootDir: string): Promise<{ decisions: MinedDecision[]; summary: DecisionMiningSummary } | null> {
  try {
    const indexPath = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, 'index.json');
    const indexData = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    
    const decisions: MinedDecision[] = [];
    for (const id of indexData.decisionIds) {
      const decisionPath = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, `${id}.json`);
      try {
        const decision = JSON.parse(await fs.readFile(decisionPath, 'utf-8'));
        decisions.push(decision);
      } catch {
        // Skip missing decisions
      }
    }
    
    return { decisions, summary: indexData.summary };
  } catch {
    return null;
  }
}

/**
 * Save decisions to disk
 */
async function saveDecisions(rootDir: string, result: DecisionMiningResult): Promise<void> {
  const decisionsDir = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR);
  await fs.mkdir(decisionsDir, { recursive: true });
  
  // Save each decision
  for (const decision of result.decisions) {
    const decisionPath = path.join(decisionsDir, `${decision.id}.json`);
    await fs.writeFile(decisionPath, JSON.stringify(decision, null, 2));
  }
  
  // Build and save index
  const index = {
    version: '1.0.0',
    decisionIds: result.decisions.map(d => d.id),
    byStatus: {} as Record<DecisionStatus, string[]>,
    byCategory: {} as Record<DecisionCategory, string[]>,
    summary: result.summary,
    lastUpdated: new Date().toISOString(),
  };
  
  // Build status index
  for (const status of ['draft', 'confirmed', 'superseded', 'rejected'] as DecisionStatus[]) {
    index.byStatus[status] = result.decisions.filter(d => d.status === status).map(d => d.id);
  }
  
  // Build category index
  const categories: DecisionCategory[] = [
    'technology-adoption', 'technology-removal', 'pattern-introduction',
    'pattern-migration', 'architecture-change', 'api-change',
    'security-enhancement', 'performance-optimization', 'refactoring',
    'testing-strategy', 'infrastructure', 'other'
  ];
  for (const category of categories) {
    index.byCategory[category] = result.decisions.filter(d => d.category === category).map(d => d.id);
  }
  
  await fs.writeFile(
    path.join(decisionsDir, 'index.json'),
    JSON.stringify(index, null, 2)
  );
}

/**
 * Mine subcommand - analyze git history and mine decisions
 */
async function mineAction(options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  try {
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('📜 Mining Architectural Decisions'));
      console.log(chalk.gray('═'.repeat(50)));
    }

    const spinner = isTextFormat ? createSpinner('Initializing...') : null;
    spinner?.start();

    // Parse date options
    const since = options.since ? new Date(options.since) : undefined;
    const until = options.until ? new Date(options.until) : undefined;
    const minConfidence = options.minConfidence ? parseFloat(options.minConfidence) : 0.5;

    // Create analyzer with only defined options
    spinner?.text('Analyzing git history...');
    const analyzerOpts: Parameters<typeof createDecisionMiningAnalyzer>[0] = {
      rootDir,
      minConfidence,
    };
    if (since !== undefined) {analyzerOpts.since = since;}
    if (until !== undefined) {analyzerOpts.until = until;}
    if (options.verbose !== undefined) {analyzerOpts.verbose = options.verbose;}
    
    const analyzer = createDecisionMiningAnalyzer(analyzerOpts);

    // Run mining
    spinner?.text('Mining decisions from commits...');
    const result = await analyzer.mine();

    // Save results
    spinner?.text('Saving decisions...');
    await saveDecisions(rootDir, result);

    spinner?.stop();

    // Output
    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        decisions: result.decisions.length,
        summary: result.summary,
        errors: result.errors,
        warnings: result.warnings,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Decision mining complete'));
    console.log();

    formatSummary(result.summary);

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`⚠️  ${result.errors.length} errors during mining`));
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift decisions status    ${chalk.white('View mining summary')}`));
    console.log(chalk.gray(`  • drift decisions list      ${chalk.white('List all decisions')}`));
    console.log(chalk.gray(`  • drift decisions show <id> ${chalk.white('View decision details')}`));
    console.log(chalk.gray(`  • drift decisions confirm   ${chalk.white('Confirm a draft decision')}`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Status subcommand - show decision mining summary
 */
async function statusAction(options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await decisionsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No decisions found' }));
    } else {
      showNotMinedMessage();
    }
    return;
  }

  try {
    const data = await loadDecisions(rootDir);
    if (!data) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Failed to load decisions' }));
      } else {
        console.log(chalk.red('Failed to load decisions'));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(data.summary, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('📜 Decision Mining Status'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatSummary(data.summary);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * List subcommand - list all decisions
 */
async function listAction(options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 20;

  if (!(await decisionsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No decisions found' }));
    } else {
      showNotMinedMessage();
    }
    return;
  }

  try {
    const data = await loadDecisions(rootDir);
    if (!data) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Failed to load decisions' }));
      } else {
        console.log(chalk.red('Failed to load decisions'));
      }
      return;
    }

    let decisions = data.decisions;

    // Filter by category
    if (options.category) {
      decisions = decisions.filter(d => d.category === options.category);
    }

    // Filter by status
    if (options.status) {
      decisions = decisions.filter(d => d.status === options.status);
    }

    // Sort by confidence (highest first)
    decisions.sort((a, b) => b.confidenceScore - a.confidenceScore);

    // Apply limit
    decisions = decisions.slice(0, limit);

    if (format === 'json') {
      console.log(JSON.stringify({ decisions, total: data.decisions.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('📜 Architectural Decisions'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (decisions.length === 0) {
      console.log(chalk.yellow('No decisions match the filters.'));
      console.log();
      return;
    }

    formatDecisionList(decisions);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Show subcommand - show decision details
 */
async function showAction(decisionId: string, options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const decisionPath = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, `${decisionId}.json`);
    const decision = JSON.parse(await fs.readFile(decisionPath, 'utf-8')) as MinedDecision;

    if (format === 'json') {
      console.log(JSON.stringify(decision, null, 2));
      return;
    }

    console.log();
    formatDecisionDetail(decision);

  } catch {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Decision not found: ${decisionId}` }));
    } else {
      console.log(chalk.yellow(`\n⚠️  Decision not found: ${decisionId}`));
    }
  }
}

/**
 * Export subcommand - export decisions as markdown ADRs
 */
async function exportAction(options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await decisionsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No decisions found' }));
    } else {
      showNotMinedMessage();
    }
    return;
  }

  try {
    const data = await loadDecisions(rootDir);
    if (!data) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Failed to load decisions' }));
      } else {
        console.log(chalk.red('Failed to load decisions'));
      }
      return;
    }

    // Create ADR directory
    const adrDir = path.join(rootDir, 'docs', 'adr');
    await fs.mkdir(adrDir, { recursive: true });

    // Export each decision as markdown
    let exported = 0;
    for (const decision of data.decisions) {
      const markdown = generateADRMarkdown(decision);
      const filename = `${decision.id.toLowerCase()}-${slugify(decision.title)}.md`;
      await fs.writeFile(path.join(adrDir, filename), markdown);
      exported++;
    }

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, exported, directory: adrDir }));
      return;
    }

    console.log();
    console.log(chalk.green.bold(`✓ Exported ${exported} decisions to docs/adr/`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Confirm subcommand - confirm a draft decision
 */
async function confirmAction(decisionId: string, options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const decisionPath = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, `${decisionId}.json`);
    const decision = JSON.parse(await fs.readFile(decisionPath, 'utf-8')) as MinedDecision;

    if (decision.status !== 'draft') {
      if (format === 'json') {
        console.log(JSON.stringify({ error: `Decision ${decisionId} is not a draft` }));
      } else {
        console.log(chalk.yellow(`\n⚠️  Decision ${decisionId} is already ${decision.status}`));
      }
      return;
    }

    // Update status
    decision.status = 'confirmed';
    decision.lastUpdated = new Date();

    // Save
    await fs.writeFile(decisionPath, JSON.stringify(decision, null, 2));

    // Update index
    const indexPath = path.join(rootDir, DRIFT_DIR, DECISIONS_DIR, 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    index.byStatus.draft = index.byStatus.draft.filter((id: string) => id !== decisionId);
    index.byStatus.confirmed.push(decisionId);
    index.lastUpdated = new Date().toISOString();
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, decision }));
      return;
    }

    console.log();
    console.log(chalk.green.bold(`✓ Decision ${decisionId} confirmed`));
    console.log();

  } catch {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Decision not found: ${decisionId}` }));
    } else {
      console.log(chalk.yellow(`\n⚠️  Decision not found: ${decisionId}`));
    }
  }
}

/**
 * For-file subcommand - find decisions affecting a file
 */
async function forFileAction(filePath: string, options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await decisionsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No decisions found' }));
    } else {
      showNotMinedMessage();
    }
    return;
  }

  try {
    const data = await loadDecisions(rootDir);
    if (!data) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Failed to load decisions' }));
      } else {
        console.log(chalk.red('Failed to load decisions'));
      }
      return;
    }

    // Find decisions affecting this file
    const matching = data.decisions.filter(d =>
      d.cluster.filesAffected.some(f => f.includes(filePath) || filePath.includes(f))
    );

    if (format === 'json') {
      console.log(JSON.stringify({ file: filePath, decisions: matching }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`📜 Decisions affecting: ${filePath}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (matching.length === 0) {
      console.log(chalk.gray('No decisions found affecting this file.'));
      console.log();
      return;
    }

    formatDecisionList(matching);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Timeline subcommand - show decisions timeline
 */
async function timelineAction(options: DecisionsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 20;

  if (!(await decisionsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No decisions found' }));
    } else {
      showNotMinedMessage();
    }
    return;
  }

  try {
    const data = await loadDecisions(rootDir);
    if (!data) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Failed to load decisions' }));
      } else {
        console.log(chalk.red('Failed to load decisions'));
      }
      return;
    }

    // Sort by date (newest first)
    const sorted = [...data.decisions].sort(
      (a, b) => new Date(b.dateRange.end).getTime() - new Date(a.dateRange.end).getTime()
    ).slice(0, limit);

    if (format === 'json') {
      console.log(JSON.stringify({ timeline: sorted }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('📅 Decision Timeline'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatTimeline(sorted);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

// ============================================================================
// Formatters
// ============================================================================

function formatSummary(summary: DecisionMiningSummary): void {
  console.log(chalk.bold('📊 Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Total Decisions:     ${chalk.cyan.bold(summary.totalDecisions)}`);
  console.log(`  Commits Analyzed:    ${chalk.cyan(summary.totalCommitsAnalyzed)}`);
  console.log(`  Significant Commits: ${chalk.cyan(summary.significantCommits)}`);
  console.log(`  Avg Cluster Size:    ${chalk.cyan(summary.avgClusterSize.toFixed(1))}`);
  console.log();

  // By status
  console.log(chalk.bold('📋 By Status'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Draft:      ${chalk.yellow(summary.byStatus.draft)}`);
  console.log(`  Confirmed:  ${chalk.green(summary.byStatus.confirmed)}`);
  console.log(`  Superseded: ${chalk.gray(summary.byStatus.superseded)}`);
  console.log(`  Rejected:   ${chalk.red(summary.byStatus.rejected)}`);
  console.log();

  // By confidence
  console.log(chalk.bold('🎯 By Confidence'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  High:   ${chalk.green(summary.byConfidence.high)}`);
  console.log(`  Medium: ${chalk.yellow(summary.byConfidence.medium)}`);
  console.log(`  Low:    ${chalk.gray(summary.byConfidence.low)}`);
  console.log();

  // Top categories
  const topCategories = Object.entries(summary.byCategory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topCategories.length > 0) {
    console.log(chalk.bold('🏷️  Top Categories'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const [category, count] of topCategories) {
      console.log(`  ${getCategoryIcon(category as DecisionCategory)} ${category.padEnd(25)} ${chalk.cyan(count)}`);
    }
    console.log();
  }
}

function formatDecisionList(decisions: MinedDecision[]): void {
  for (const decision of decisions) {
    const statusIcon = getStatusIcon(decision.status);
    const confidenceColor = getConfidenceColor(decision.confidence);
    
    console.log(`${statusIcon} ${chalk.bold(decision.id)} ${confidenceColor(`[${decision.confidence}]`)}`);
    console.log(`  ${decision.title}`);
    console.log(chalk.gray(`  ${getCategoryIcon(decision.category)} ${decision.category} | ${decision.cluster.commits.length} commits | ${decision.duration}`));
    console.log();
  }
}

function formatDecisionDetail(decision: MinedDecision): void {
  const statusIcon = getStatusIcon(decision.status);
  const confidenceColor = getConfidenceColor(decision.confidence);

  console.log(chalk.bold(`${statusIcon} ${decision.id}: ${decision.title}`));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  // Metadata
  console.log(chalk.bold('📋 Metadata'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Status:     ${decision.status}`);
  console.log(`  Category:   ${getCategoryIcon(decision.category)} ${decision.category}`);
  console.log(`  Confidence: ${confidenceColor(`${decision.confidence} (${(decision.confidenceScore * 100).toFixed(0)}%)`)}`);
  console.log(`  Duration:   ${decision.duration}`);
  console.log(`  Commits:    ${decision.cluster.commits.length}`);
  console.log(`  Files:      ${decision.cluster.filesAffected.length}`);
  console.log(`  Languages:  ${decision.cluster.languages.join(', ')}`);
  console.log();

  // ADR Content
  console.log(chalk.bold('📜 Architecture Decision Record'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log();
  console.log(chalk.bold('Context:'));
  console.log(chalk.white(`  ${decision.adr.context}`));
  console.log();
  console.log(chalk.bold('Decision:'));
  console.log(chalk.white(`  ${decision.adr.decision}`));
  console.log();
  console.log(chalk.bold('Consequences:'));
  for (const consequence of decision.adr.consequences) {
    console.log(chalk.white(`  • ${consequence}`));
  }
  console.log();

  // Evidence
  if (decision.adr.evidence.length > 0) {
    console.log(chalk.bold('📎 Evidence'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const evidence of decision.adr.evidence.slice(0, 5)) {
      console.log(`  ${getEvidenceIcon(evidence.type)} ${evidence.description}`);
      console.log(chalk.gray(`    Source: ${evidence.source}`));
    }
    console.log();
  }

  // Commits
  console.log(chalk.bold('📝 Commits'));
  console.log(chalk.gray('─'.repeat(50)));
  for (const commit of decision.cluster.commits.slice(0, 5)) {
    console.log(`  ${chalk.cyan(commit.shortSha)} ${commit.subject}`);
    console.log(chalk.gray(`    ${commit.authorName} | ${new Date(commit.date).toLocaleDateString()}`));
  }
  if (decision.cluster.commits.length > 5) {
    console.log(chalk.gray(`  ... and ${decision.cluster.commits.length - 5} more commits`));
  }
  console.log();
}

function formatTimeline(decisions: MinedDecision[]): void {
  let lastMonth = '';
  
  for (const decision of decisions) {
    const date = new Date(decision.dateRange.end);
    const month = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    
    if (month !== lastMonth) {
      console.log(chalk.bold.cyan(`\n${month}`));
      console.log(chalk.gray('─'.repeat(40)));
      lastMonth = month;
    }
    
    const day = date.toLocaleDateString('en-US', { day: 'numeric' });
    const statusIcon = getStatusIcon(decision.status);
    
    console.log(`  ${chalk.gray(day.padStart(2))} ${statusIcon} ${decision.id}: ${decision.title}`);
    console.log(chalk.gray(`      ${getCategoryIcon(decision.category)} ${decision.category}`));
  }
  console.log();
}

// ============================================================================
// Helpers
// ============================================================================

function getStatusIcon(status: DecisionStatus): string {
  switch (status) {
    case 'draft': return chalk.yellow('○');
    case 'confirmed': return chalk.green('●');
    case 'superseded': return chalk.gray('◐');
    case 'rejected': return chalk.red('✗');
    default: return '○';
  }
}

function getConfidenceColor(confidence: DecisionConfidence): (text: string) => string {
  switch (confidence) {
    case 'high': return chalk.green;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.gray;
    default: return chalk.white;
  }
}

function getCategoryIcon(category: DecisionCategory): string {
  const icons: Record<DecisionCategory, string> = {
    'technology-adoption': '📦',
    'technology-removal': '🗑️',
    'pattern-introduction': '🎨',
    'pattern-migration': '🔄',
    'architecture-change': '🏗️',
    'api-change': '🔌',
    'security-enhancement': '🔒',
    'performance-optimization': '⚡',
    'refactoring': '♻️',
    'testing-strategy': '🧪',
    'infrastructure': '🔧',
    'other': '📋',
  };
  return icons[category] ?? '📋';
}

function getEvidenceIcon(type: string): string {
  switch (type) {
    case 'commit-message': return '💬';
    case 'code-change': return '📝';
    case 'dependency-change': return '📦';
    case 'pattern-change': return '🎨';
    default: return '📎';
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function generateADRMarkdown(decision: MinedDecision): string {
  const lines: string[] = [];
  
  lines.push(`# ${decision.id}: ${decision.title}`);
  lines.push('');
  lines.push(`**Status:** ${decision.status}`);
  lines.push(`**Category:** ${decision.category}`);
  lines.push(`**Confidence:** ${decision.confidence} (${(decision.confidenceScore * 100).toFixed(0)}%)`);
  lines.push(`**Date:** ${new Date(decision.dateRange.start).toLocaleDateString()} - ${new Date(decision.dateRange.end).toLocaleDateString()}`);
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(decision.adr.context);
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(decision.adr.decision);
  lines.push('');
  lines.push('## Consequences');
  lines.push('');
  for (const consequence of decision.adr.consequences) {
    lines.push(`- ${consequence}`);
  }
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  for (const evidence of decision.adr.evidence) {
    lines.push(`- **${evidence.type}**: ${evidence.description}`);
  }
  lines.push('');
  lines.push('## Related Commits');
  lines.push('');
  for (const commit of decision.cluster.commits.slice(0, 10)) {
    lines.push(`- \`${commit.shortSha}\` ${commit.subject}`);
  }
  lines.push('');
  lines.push('---');
  lines.push(`*Mined by Drift on ${new Date(decision.minedAt).toLocaleDateString()}*`);
  
  return lines.join('\n');
}

// ============================================================================
// Command Registration
// ============================================================================

export function createDecisionsCommand(): Command {
  const cmd = new Command('decisions')
    .description('Mine architectural decisions from git history')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Enable verbose output');

  cmd
    .command('mine')
    .description('Mine decisions from git history')
    .option('-s, --since <date>', 'Start date (ISO format)')
    .option('-u, --until <date>', 'End date (ISO format)')
    .option('-c, --min-confidence <number>', 'Minimum confidence (0-1)', '0.5')
    .action((opts) => mineAction({ ...cmd.opts(), ...opts } as DecisionsOptions));

  cmd
    .command('status')
    .description('Show decision mining summary')
    .action(() => statusAction(cmd.opts()));

  cmd
    .command('list')
    .description('List all decisions')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .option('--category <category>', 'Filter by category')
    .option('--status <status>', 'Filter by status (draft, confirmed, superseded, rejected)')
    .action((opts) => listAction({ ...cmd.opts(), ...opts } as DecisionsOptions));

  cmd
    .command('show <id>')
    .description('Show decision details')
    .action((id) => showAction(id, cmd.opts()));

  cmd
    .command('export')
    .description('Export decisions as markdown ADRs')
    .action(() => exportAction(cmd.opts()));

  cmd
    .command('confirm <id>')
    .description('Confirm a draft decision')
    .action((id) => confirmAction(id, cmd.opts()));

  cmd
    .command('for-file <file>')
    .description('Find decisions affecting a file')
    .action((file) => forFileAction(file, cmd.opts()));

  cmd
    .command('timeline')
    .description('Show decisions timeline')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .action((opts) => timelineAction({ ...cmd.opts(), ...opts } as DecisionsOptions));

  return cmd;
}
