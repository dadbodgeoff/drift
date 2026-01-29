/**
 * Trends Command - drift trends
 *
 * View pattern regressions and improvements over time.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { HistoryStore } from 'driftdetect-core';

export interface TrendsCommandOptions {
  period?: '7d' | '30d' | '90d';
  verbose?: boolean;
}

async function trendsAction(options: TrendsCommandOptions): Promise<void> {
  const rootDir = process.cwd();
  const period = options.period ?? '7d';
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('📊 Pattern Trends'));
  console.log();

  const historyStore = new HistoryStore({ rootDir });
  await historyStore.initialize();

  const trends = await historyStore.getTrendSummary(period);

  if (!trends) {
    console.log(chalk.yellow('Not enough history data to show trends.'));
    console.log(chalk.gray('Run more scans over time to see pattern trends.'));
    console.log();
    return;
  }

  // Overall trend
  const trendIcon = trends.overallTrend === 'improving' ? '📈' 
                  : trends.overallTrend === 'declining' ? '📉' 
                  : '➡️';
  const trendColor = trends.overallTrend === 'improving' ? chalk.green 
                   : trends.overallTrend === 'declining' ? chalk.red 
                   : chalk.gray;

  console.log(`Overall: ${trendIcon} ${trendColor(trends.overallTrend.toUpperCase())}`);
  console.log(chalk.gray(`Period: ${trends.startDate} → ${trends.endDate}`));
  console.log();

  // Summary
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Regressions:   ${chalk.red(trends.regressions.length)}`);
  console.log(`  Improvements:  ${chalk.green(trends.improvements.length)}`);
  console.log(`  Stable:        ${chalk.gray(trends.stable)}`);
  console.log(chalk.gray('─'.repeat(50)));
  console.log();

  // Regressions
  if (trends.regressions.length > 0) {
    console.log(chalk.bold.red(`📉 Regressions (${trends.regressions.length}):`));
    console.log();

    const critical = trends.regressions.filter(r => r.severity === 'critical');
    const warning = trends.regressions.filter(r => r.severity === 'warning');

    if (critical.length > 0) {
      console.log(chalk.red('  Critical:'));
      for (const r of critical.slice(0, 5)) {
        const change = r.changePercent < 0 ? r.changePercent.toFixed(0) : `+${r.changePercent.toFixed(0)}`;
        console.log(chalk.red(`    • ${r.patternName} (${r.category})`));
        console.log(chalk.gray(`      ${r.details} (${change}%)`));
      }
      if (critical.length > 5) {
        console.log(chalk.gray(`      ... and ${critical.length - 5} more`));
      }
      console.log();
    }

    if (warning.length > 0) {
      console.log(chalk.yellow('  Warning:'));
      for (const r of warning.slice(0, 5)) {
        const change = r.changePercent < 0 ? r.changePercent.toFixed(0) : `+${r.changePercent.toFixed(0)}`;
        console.log(chalk.yellow(`    • ${r.patternName} (${r.category})`));
        console.log(chalk.gray(`      ${r.details} (${change}%)`));
      }
      if (warning.length > 5) {
        console.log(chalk.gray(`      ... and ${warning.length - 5} more`));
      }
      console.log();
    }
  }

  // Improvements
  if (trends.improvements.length > 0 && verbose) {
    console.log(chalk.bold.green(`📈 Improvements (${trends.improvements.length}):`));
    console.log();
    for (const r of trends.improvements.slice(0, 5)) {
      const change = r.changePercent > 0 ? `+${r.changePercent.toFixed(0)}` : r.changePercent.toFixed(0);
      console.log(chalk.green(`    • ${r.patternName} (${r.category})`));
      console.log(chalk.gray(`      ${r.details} (${change}%)`));
    }
    if (trends.improvements.length > 5) {
      console.log(chalk.gray(`      ... and ${trends.improvements.length - 5} more`));
    }
    console.log();
  }

  // Category breakdown
  if (verbose && Object.keys(trends.categoryTrends).length > 0) {
    console.log(chalk.bold('Category Trends:'));
    console.log();
    for (const [category, catTrend] of Object.entries(trends.categoryTrends)) {
      const icon = catTrend.trend === 'improving' ? '↑' 
                 : catTrend.trend === 'declining' ? '↓' 
                 : '→';
      const color = catTrend.trend === 'improving' ? chalk.green 
                  : catTrend.trend === 'declining' ? chalk.red 
                  : chalk.gray;
      console.log(`  ${color(icon)} ${category}: ${color(catTrend.trend)}`);
    }
    console.log();
  }

  // Hint
  if (!verbose && trends.improvements.length > 0) {
    console.log(chalk.gray(`Use --verbose to see ${trends.improvements.length} improvements`));
  }

  console.log(chalk.gray('View full details in the dashboard:'));
  console.log(chalk.cyan('  drift dashboard'));
  console.log();
}

export const trendsCommand = new Command('trends')
  .description('View pattern regressions and improvements over time')
  .option('-p, --period <period>', 'Time period: 7d, 30d, or 90d', '7d')
  .option('--verbose', 'Show detailed output including improvements')
  .action(trendsAction);
