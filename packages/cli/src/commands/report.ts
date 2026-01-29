/**
 * Report Command - drift report
 *
 * Generate reports in various formats.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * @requirements 29.7
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';


import {
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  type Reporter,
  type ReportData,
} from '../reporters/index.js';
import { createCLIPatternService } from '../services/pattern-service-factory.js';
import { promptReportFormat, promptCategorySelection } from '../ui/prompts.js';
import { createSpinner, status } from '../ui/spinner.js';

import type { Violation } from 'driftdetect-core';

export interface ReportOptions {
  /** Output format */
  format?: 'text' | 'json' | 'github' | 'gitlab';
  /** Output file path */
  output?: string;
  /** Include only specific categories */
  categories?: string[];
  /** Enable verbose output */
  verbose?: boolean;
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
 * Get reporter based on format
 */
function getReporter(format: string): Reporter {
  switch (format) {
    case 'json':
      return new JsonReporter();
    case 'github':
      return new GitHubReporter();
    case 'gitlab':
      return new GitLabReporter();
    case 'text':
    default:
      return new TextReporter();
  }
}

/**
 * Get file extension for format
 */
function getExtension(format: string): string {
  switch (format) {
    case 'json':
    case 'gitlab':
      return 'json';
    case 'github':
    case 'text':
    default:
      return 'txt';
  }
}

/**
 * Report command implementation
 */
async function reportAction(options: ReportOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;

  console.log();
  console.log(chalk.bold('🔍 Drift - Generate Report'));
  console.log();

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    status.error('Drift is not initialized. Run `drift init` first.');
    process.exit(1);
  }

  // Initialize pattern service
  const spinner = createSpinner('Loading patterns...');
  spinner.start();

  const service = createCLIPatternService(rootDir);

  // Get status to understand available categories (auto-initializes)
  const systemStatus = await service.getStatus();

  spinner.succeed('Patterns loaded');

  // Get format
  let format = options.format;
  if (!format) {
    format = await promptReportFormat();
  }

  // Get categories to include
  let categories = options.categories;
  if (!categories || categories.length === 0) {
    const availableCategories = Object.entries(systemStatus.byCategory)
      .filter(([_, count]) => count > 0)
      .map(([category]) => category);

    if (availableCategories.length > 1 && !options.output) {
      // Interactive category selection
      categories = await promptCategorySelection(availableCategories);
    } else {
      categories = availableCategories;
    }
  }

  // Get approved patterns
  const approvedResult = await service.listByStatus('approved', { limit: 10000 });
  
  // Fetch full pattern details
  const approvedPatterns = await Promise.all(
    approvedResult.items.map(async (summary) => {
      const pattern = await service.getPattern(summary.id);
      return pattern;
    })
  );
  
  // Filter out nulls and by category
  let patterns = approvedPatterns.filter((p): p is NonNullable<typeof p> => p !== null);
  if (categories && categories.length > 0) {
    patterns = patterns.filter((p) => categories.includes(p.category));
  }

  if (patterns.length === 0) {
    status.info('No approved patterns to report on');
    console.log(chalk.gray('Run `drift scan` and `drift approve` to add patterns'));
    return;
  }

  // Collect violations from outliers
  const violations: Violation[] = [];
  for (const pattern of patterns) {
    for (const outlier of pattern.outliers) {
      const violation: Violation = {
        id: `${pattern.id}-${outlier.file}-${outlier.line}`,
        patternId: pattern.id,
        severity: pattern.severity,
        file: outlier.file,
        range: {
          start: { line: outlier.line, character: outlier.column },
          end: { line: outlier.endLine ?? outlier.line, character: outlier.endColumn ?? outlier.column },
        },
        message: `Deviation from pattern: ${pattern.name}`,
        explanation: outlier.reason,
        expected: pattern.description,
        actual: `Code at line ${outlier.line} deviates from the established pattern`,
        aiExplainAvailable: true,
        aiFixAvailable: pattern.autoFixable,
        firstSeen: new Date(),
        occurrences: 1,
      };
      violations.push(violation);
    }
  }

  // Calculate summary
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;
  const infoCount = violations.filter((v) => v.severity === 'info').length;
  const hintCount = violations.filter((v) => v.severity === 'hint').length;

  // Prepare report data - cast patterns to legacy format
  const reportData: ReportData = {
    violations,
    summary: {
      total: violations.length,
      errors: errorCount,
      warnings: warningCount,
      infos: infoCount,
      hints: hintCount,
    },
    patterns: patterns as unknown as ReportData['patterns'],
    timestamp: new Date().toISOString(),
    rootDir,
  };

  // Generate report
  const generateSpinner = createSpinner('Generating report...');
  generateSpinner.start();

  const reporter = getReporter(format);
  const report = reporter.generate(reportData);

  generateSpinner.succeed('Report generated');

  // Output report
  if (options.output) {
    // Write to file
    const outputPath = path.resolve(rootDir, options.output);
    const outputDir = path.dirname(outputPath);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, report);

    status.success(`Report saved to ${path.relative(rootDir, outputPath)}`);
  } else {
    // Print to console
    console.log();
    console.log(report);
  }

  // Save to reports directory
  const reportsDir = path.join(rootDir, DRIFT_DIR, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-${timestamp}.${getExtension(format)}`);
  await fs.writeFile(reportPath, report);

  if (verbose) {
    status.info(`Report also saved to ${path.relative(rootDir, reportPath)}`);
  }

  // Summary
  console.log();
  console.log(chalk.bold('Report Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Format:      ${format}`);
  console.log(`  Patterns:    ${patterns.length}`);
  console.log(`  Violations:  ${violations.length}`);
  if (categories && categories.length > 0) {
    console.log(`  Categories:  ${categories.join(', ')}`);
  }
  console.log();
}

export const reportCommand = new Command('report')
  .description('Generate a report')
  .option('-f, --format <format>', 'Output format (text, json, github, gitlab)')
  .option('-o, --output <path>', 'Output file path')
  .option('-c, --categories <categories...>', 'Include only specific categories')
  .option('--verbose', 'Enable verbose output')
  .action(reportAction);
