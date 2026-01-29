/**
 * Gate Command
 * 
 * @license Apache-2.0
 * 
 * CLI command for running quality gates on code changes.
 * 
 * Usage:
 *   drift gate                    # Run with default policy
 *   drift gate --policy strict    # Run with strict policy
 *   drift gate --format sarif     # Output in SARIF format
 *   drift gate --ci               # CI mode with JSON output
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  GateOrchestrator,
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  SarifReporter,
  type QualityGateOptions,
  type QualityGateResult,
  type OutputFormat,
  type GateId,
} from 'driftdetect-core';

/**
 * Resolve the project root directory.
 * Priority: --root option > detect .drift folder > cwd
 */
async function resolveProjectRoot(rootOption?: string): Promise<string> {
  // If --root is specified, use it
  if (rootOption) {
    const resolved = path.resolve(rootOption);
    try {
      await fs.access(path.join(resolved, '.drift'));
      return resolved;
    } catch {
      // .drift doesn't exist at specified root, but use it anyway
      return resolved;
    }
  }

  // Try to find .drift folder starting from cwd and going up
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    try {
      await fs.access(path.join(current, '.drift'));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }

  // Fall back to cwd
  return process.cwd();
}

export interface GateCommandOptions {
  policy?: string;
  gates?: string;
  format?: string;
  ci?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  staged?: boolean;
  output?: string;
  failOn?: string;
  files?: string[];
  root?: string;
}

/**
 * Gate command implementation.
 */
async function gateAction(
  files: string[] | undefined,
  options: GateCommandOptions
): Promise<void> {
  // Resolve project root - use --root option, or detect from .drift folder, or use cwd
  const rootDir = await resolveProjectRoot(options.root);
  const isCi = options.ci ?? !!process.env['CI'];
  const format = (options.format ?? (isCi ? 'json' : 'text')) as OutputFormat;
  const showProgress = !isCi && format === 'text';

  if (showProgress) {
    console.log();
    console.log(chalk.bold('🔍 Drift Quality Gate'));
    console.log(chalk.dim(`Project: ${rootDir}`));
    console.log();
  }

  // Parse gates if provided
  let gates: GateId[] | undefined;
  if (options.gates) {
    gates = options.gates.split(',').map(g => g.trim()) as GateId[];
  }

  // Build options - only include defined values
  const gateOptions: QualityGateOptions = {
    projectRoot: rootDir,
    format,
    ci: isCi,
    branch: process.env['GITHUB_HEAD_REF'] ?? process.env['CI_COMMIT_BRANCH'] ?? 'main',
  };

  // Add optional properties only if defined
  if (files && files.length > 0) {
    gateOptions.files = files;
  }
  if (options.policy) {
    gateOptions.policy = options.policy;
  }
  if (gates) {
    gateOptions.gates = gates;
  }
  if (options.verbose !== undefined) {
    gateOptions.verbose = options.verbose;
  }
  if (options.dryRun !== undefined) {
    gateOptions.dryRun = options.dryRun;
  }
  const baseBranch = process.env['GITHUB_BASE_REF'] ?? process.env['CI_MERGE_REQUEST_TARGET_BRANCH_NAME'];
  if (baseBranch) {
    gateOptions.baseBranch = baseBranch;
  }
  const commitSha = process.env['GITHUB_SHA'] ?? process.env['CI_COMMIT_SHA'];
  if (commitSha) {
    gateOptions.commitSha = commitSha;
  }

  // Dry run
  if (options.dryRun) {
    console.log(chalk.yellow('Dry run mode - showing what would be checked:'));
    console.log(JSON.stringify(gateOptions, null, 2));
    return;
  }

  // Run quality gates
  if (showProgress) {
    console.log(chalk.dim('Running quality gates...'));
  }

  try {
    const orchestrator = new GateOrchestrator(rootDir);
    const result = await orchestrator.run(gateOptions);

    // Generate report
    const reporter = getReporter(format);
    const reporterOptions: { verbose?: boolean } = {};
    if (options.verbose !== undefined) {
      reporterOptions.verbose = options.verbose;
    }
    const report = reporter.generate(result, reporterOptions);

    // Output report
    if (options.output) {
      await reporter.write(report, { outputPath: options.output });
      if (showProgress) {
        console.log(chalk.green(`✓ Report written to ${options.output}`));
      }
    } else {
      console.log(report);
    }

    // Determine exit code
    const failOn = (options.failOn ?? 'error') as 'error' | 'warning' | 'none';
    const exitCode = determineExitCode(result, failOn);
    
    if (showProgress) {
      console.log();
      if (exitCode === 0) {
        console.log(chalk.green('✓ Quality gate passed!'));
      } else {
        console.log(chalk.red('✗ Quality gate failed'));
      }
    }

    process.exit(exitCode);
  } catch (error) {
    if (showProgress) {
      console.log(chalk.red('✗ Quality gate failed'));
    }
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

/**
 * Get reporter for format.
 */
function getReporter(format: OutputFormat) {
  switch (format) {
    case 'json': return new JsonReporter();
    case 'github': return new GitHubReporter();
    case 'gitlab': return new GitLabReporter();
    case 'sarif': return new SarifReporter();
    case 'text':
    default: return new TextReporter();
  }
}

/**
 * Determine exit code based on result and fail-on setting.
 */
function determineExitCode(
  result: QualityGateResult,
  failOn: 'error' | 'warning' | 'none'
): number {
  if (failOn === 'none') {return 0;}
  
  if (failOn === 'warning') {
    return result.status === 'passed' ? 0 : 1;
  }
  
  // failOn === 'error'
  return result.passed ? 0 : 1;
}

/**
 * Create the gate command.
 */
export function createGateCommand(): Command {
  return new Command('gate')
    .description('Run quality gates on code changes')
    .argument('[files...]', 'Specific files to check (defaults to changed files)')
    .option('-r, --root <path>', 'Project root directory (auto-detects .drift folder if not specified)')
    .option('-p, --policy <policy>', 'Policy to use (default, strict, relaxed, ci-fast, or custom ID)')
    .option('-g, --gates <gates>', 'Specific gates to run (comma-separated: pattern-compliance,constraint-verification,regression-detection,impact-simulation,security-boundary,custom-rules)')
    .option('-f, --format <format>', 'Output format (text, json, github, gitlab, sarif)', 'text')
    .option('--ci', 'Run in CI mode (implies --format json)')
    .option('-v, --verbose', 'Verbose output with details')
    .option('--dry-run', 'Show what would be checked without running')
    .option('--staged', 'Check only staged files')
    .option('-o, --output <file>', 'Write report to file')
    .option('--fail-on <level>', 'Fail threshold: error (default), warning, or none', 'error')
    .action(gateAction);
}

export default createGateCommand;
