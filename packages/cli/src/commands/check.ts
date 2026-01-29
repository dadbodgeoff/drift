/**
 * Check Command - drift check
 *
 * Check for violations against approved patterns.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * @requirements 29.3
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';


import { getStagedFiles } from '../git/staged-files.js';
import {
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  type Reporter,
  type ReportData,
} from '../reporters/index.js';
import { createCLIPatternService } from '../services/pattern-service-factory.js';
import { createSpinner, status } from '../ui/spinner.js';

import type { Violation, Severity } from 'driftdetect-core';

export interface CheckOptions {
  /** Check only staged files */
  staged?: boolean;
  /** Run in CI mode */
  ci?: boolean;
  /** Output format */
  format?: 'text' | 'json' | 'github' | 'gitlab';
  /** Fail threshold (error, warning, none) */
  failOn?: 'error' | 'warning' | 'none';
  /** Enable verbose output */
  verbose?: boolean;
}

export interface CheckResult {
  /** Number of violations */
  violationCount: number;
  /** Number of errors */
  errorCount: number;
  /** Number of warnings */
  warningCount: number;
  /** Exit code */
  exitCode: number;
  /** Violations found */
  violations: Violation[];
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Severity order for comparison */
const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

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
 * Determine exit code based on violations and threshold
 */
export function getExitCode(
  violations: Violation[],
  failOn: 'error' | 'warning' | 'none'
): number {
  if (failOn === 'none') {
    return 0;
  }

  const threshold = SEVERITY_ORDER[failOn];
  const hasViolationsAboveThreshold = violations.some(
    (v) => SEVERITY_ORDER[v.severity] >= threshold
  );

  return hasViolationsAboveThreshold ? 1 : 0;
}

/**
 * Check command implementation
 */
async function checkAction(options: CheckOptions): Promise<void> {
  const rootDir = process.cwd();
  const isCi = options.ci ?? !!process.env['CI'];
  const format = options.format ?? (isCi ? 'json' : 'text');
  const failOn = options.failOn ?? 'error';

  // In CI mode, suppress decorative output
  const showProgress = !isCi && format === 'text';

  if (showProgress) {
    console.log();
    console.log(chalk.bold('🔍 Drift - Checking for Violations'));
    console.log();
  }

  // Check if initialized
  if (!(await isDriftInitialized(rootDir))) {
    if (isCi) {
      console.error(JSON.stringify({ error: 'Drift is not initialized' }));
    } else {
      status.error('Drift is not initialized. Run `drift init` first.');
    }
    process.exit(1);
  }

  // Initialize pattern service
  const service = createCLIPatternService(rootDir);

  // Get approved patterns (service auto-initializes)
  const approvedResult = await service.listByStatus('approved', { limit: 10000 });
  
  // Fetch full pattern details for each approved pattern
  const approvedPatterns = await Promise.all(
    approvedResult.items.map(async (summary) => {
      const pattern = await service.getPattern(summary.id);
      return pattern;
    })
  );
  
  // Filter out any null patterns
  const validPatterns = approvedPatterns.filter((p): p is NonNullable<typeof p> => p !== null);

  if (validPatterns.length === 0) {
    if (showProgress) {
      status.info('No approved patterns to check against.');
      console.log(chalk.gray('Run `drift scan` to discover patterns, then `drift approve` to approve them.'));
    } else if (isCi) {
      console.log(JSON.stringify({ violations: [], summary: { total: 0, errors: 0, warnings: 0 } }));
    }
    process.exit(0);
  }

  // Determine files to check
  let filesToCheck: string[] = [];
  
  if (options.staged) {
    const spinner = showProgress ? createSpinner('Getting staged files...') : null;
    spinner?.start();

    try {
      filesToCheck = await getStagedFiles(rootDir);
      spinner?.succeed(`Found ${filesToCheck.length} staged files`);
    } catch (error) {
      spinner?.fail('Failed to get staged files');
      if (!isCi) {
        console.error(chalk.red((error as Error).message));
      }
      process.exit(1);
    }

    if (filesToCheck.length === 0) {
      if (showProgress) {
        status.info('No staged files to check.');
      } else if (isCi) {
        console.log(JSON.stringify({ violations: [], summary: { total: 0, errors: 0, warnings: 0 } }));
      }
      process.exit(0);
    }
  } else {
    // Get all files from pattern locations
    const allFiles = new Set<string>();
    for (const pattern of validPatterns) {
      for (const location of pattern.locations) {
        allFiles.add(location.file);
      }
      for (const outlier of pattern.outliers) {
        allFiles.add(outlier.file);
      }
    }
    filesToCheck = Array.from(allFiles);
  }

  // Run evaluation
  const spinner = showProgress ? createSpinner('Checking for violations...') : null;
  spinner?.start();

  const violations: Violation[] = [];

  try {
    for (const file of filesToCheck) {
      const filePath = path.join(rootDir, file);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        continue; // File doesn't exist, skip
      }

      // Check against each approved pattern
      for (const pattern of validPatterns) {
        // Check if this file has outliers for this pattern
        const outliers = pattern.outliers.filter((o) => o.file === file);
        
        for (const outlier of outliers) {
          // Create violation for each outlier
          const violation: Violation = {
            id: `${pattern.id}-${file}-${outlier.line}`,
            patternId: pattern.id,
            severity: pattern.severity,
            file,
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
    }

    spinner?.succeed(`Checked ${filesToCheck.length} files`);
  } catch (error) {
    spinner?.fail('Check failed');
    if (!isCi) {
      console.error(chalk.red((error as Error).message));
    }
    process.exit(1);
  }

  // Calculate summary
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;
  const infoCount = violations.filter((v) => v.severity === 'info').length;
  const hintCount = violations.filter((v) => v.severity === 'hint').length;

  // Prepare report data - convert unified Pattern to legacy format for reporters
  // The reporters expect the legacy Pattern type with confidence as an object
  const reportData: ReportData = {
    violations,
    summary: {
      total: violations.length,
      errors: errorCount,
      warnings: warningCount,
      infos: infoCount,
      hints: hintCount,
    },
    // Cast to unknown first since the types are structurally different
    patterns: validPatterns as unknown as ReportData['patterns'],
    timestamp: new Date().toISOString(),
    rootDir,
  };

  // Generate report
  const reporter = getReporter(format);
  const report = reporter.generate(reportData);

  // Output report
  console.log(report);

  // Save report to file in CI mode
  if (isCi) {
    const reportsDir = path.join(rootDir, DRIFT_DIR, 'reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `check-${timestamp}.${format === 'json' ? 'json' : 'txt'}`);
    await fs.writeFile(reportPath, report);
  }

  // Show summary in text mode
  if (showProgress && violations.length > 0) {
    console.log();
    console.log(chalk.bold('Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Total violations: ${chalk.cyan(violations.length)}`);
    if (errorCount > 0) {console.log(`  Errors:           ${chalk.red(errorCount)}`);}
    if (warningCount > 0) {console.log(`  Warnings:         ${chalk.yellow(warningCount)}`);}
    if (infoCount > 0) {console.log(`  Info:             ${chalk.blue(infoCount)}`);}
    if (hintCount > 0) {console.log(`  Hints:            ${chalk.gray(hintCount)}`);}
    console.log();
  }

  // Determine exit code
  const exitCode = getExitCode(violations, failOn);

  if (showProgress) {
    if (exitCode === 0) {
      if (violations.length === 0) {
        status.success('No violations found!');
      } else {
        status.success(`Check passed (${violations.length} violations below threshold)`);
      }
    } else {
      status.error(`Check failed with ${errorCount} errors`);
    }
    console.log();
  }

  process.exit(exitCode);
}

export const checkCommand = new Command('check')
  .description('Check for violations')
  .option('--staged', 'Check only staged files')
  .option('--ci', 'Run in CI mode with machine-readable output')
  .option('-f, --format <format>', 'Output format (text, json, github, gitlab)', 'text')
  .option('--fail-on <level>', 'Fail threshold (error, warning, none)', 'error')
  .option('--verbose', 'Enable verbose output')
  .action(checkAction);
