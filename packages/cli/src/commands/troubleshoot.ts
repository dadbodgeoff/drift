/**
 * Troubleshoot Command - drift troubleshoot
 *
 * Diagnoses common issues and provides targeted fixes.
 * Helps users resolve problems without searching documentation.
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { createSpinner } from '../ui/spinner.js';

export interface TroubleshootOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  fix?: boolean;
}

const DRIFT_DIR = '.drift';

interface Issue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  fix?: string;
  autoFixable: boolean;
  fixCommand?: string;
}

interface DiagnosticResult {
  healthy: boolean;
  issues: Issue[];
  suggestions: string[];
  systemInfo: {
    nodeVersion: string;
    platform: string;
    cwd: string;
    driftVersion: string | undefined;
  };
}

/**
 * Check if drift is initialized
 */
async function checkInitialized(rootDir: string): Promise<Issue | null> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    return null;
  } catch {
    return {
      id: 'not-initialized',
      severity: 'error',
      title: 'Drift not initialized',
      description: 'The .drift/ directory does not exist. Drift needs to be initialized before use.',
      fix: 'Run `drift init` to initialize Drift in this project.',
      autoFixable: true,
      fixCommand: 'drift init -y',
    };
  }
}

/**
 * Check if config is valid
 */
async function checkConfig(rootDir: string): Promise<Issue | null> {
  const configPath = path.join(rootDir, DRIFT_DIR, 'config.json');
  
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    JSON.parse(content);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        id: 'missing-config',
        severity: 'error',
        title: 'Missing config.json',
        description: 'The .drift/config.json file is missing.',
        fix: 'Run `drift init` to recreate the configuration.',
        autoFixable: true,
        fixCommand: 'drift init -y',
      };
    }
    
    return {
      id: 'invalid-config',
      severity: 'error',
      title: 'Invalid config.json',
      description: `The .drift/config.json file contains invalid JSON: ${(error as Error).message}`,
      fix: 'Check the config file for syntax errors or run `drift init` to recreate it.',
      autoFixable: false,
    };
  }
}

/**
 * Check if patterns exist
 */
async function checkPatterns(rootDir: string): Promise<Issue | null> {
  const patternsDir = path.join(rootDir, DRIFT_DIR, 'patterns');
  const lakeDir = path.join(rootDir, DRIFT_DIR, 'lake', 'patterns');
  
  let hasPatterns = false;
  
  try {
    const discoveredDir = path.join(patternsDir, 'discovered');
    const files = await fs.readdir(discoveredDir);
    hasPatterns = files.some(f => f.endsWith('.json'));
  } catch { /* */ }
  
  if (!hasPatterns) {
    try {
      const files = await fs.readdir(lakeDir);
      hasPatterns = files.some(f => f.endsWith('.json'));
    } catch { /* */ }
  }
  
  if (!hasPatterns) {
    return {
      id: 'no-patterns',
      severity: 'warning',
      title: 'No patterns found',
      description: 'No patterns have been discovered yet. The codebase needs to be scanned.',
      fix: 'Run `drift scan` to discover patterns in your codebase.',
      autoFixable: true,
      fixCommand: 'drift scan',
    };
  }
  
  return null;
}

/**
 * Check .driftignore for common issues
 */
async function checkDriftignore(rootDir: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const driftignorePath = path.join(rootDir, '.driftignore');
  
  try {
    await fs.access(driftignorePath);
  } catch {
    issues.push({
      id: 'missing-driftignore',
      severity: 'info',
      title: 'No .driftignore file',
      description: 'Consider adding a .driftignore file to exclude files from scanning.',
      fix: 'Create a .driftignore file with patterns like node_modules/, dist/, etc.',
      autoFixable: false,
    });
    return issues;
  }
  
  // Check for common missing patterns
  const content = await fs.readFile(driftignorePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim());
  
  const recommendedPatterns = [
    { pattern: 'node_modules', check: () => fs.access(path.join(rootDir, 'node_modules')).then(() => true).catch(() => false) },
    { pattern: 'dist', check: () => fs.access(path.join(rootDir, 'dist')).then(() => true).catch(() => false) },
    { pattern: 'build', check: () => fs.access(path.join(rootDir, 'build')).then(() => true).catch(() => false) },
    { pattern: '.git', check: () => fs.access(path.join(rootDir, '.git')).then(() => true).catch(() => false) },
    { pattern: 'vendor', check: () => fs.access(path.join(rootDir, 'vendor')).then(() => true).catch(() => false) },
    { pattern: '__pycache__', check: () => fs.access(path.join(rootDir, '__pycache__')).then(() => true).catch(() => false) },
  ];
  
  for (const { pattern, check } of recommendedPatterns) {
    const exists = await check();
    const isIgnored = lines.some(l => l.includes(pattern));
    
    if (exists && !isIgnored) {
      issues.push({
        id: `missing-ignore-${pattern}`,
        severity: 'warning',
        title: `${pattern}/ not in .driftignore`,
        description: `The ${pattern}/ directory exists but is not ignored. This may slow down scans.`,
        fix: `Add "${pattern}/" to your .driftignore file.`,
        autoFixable: false,
      });
    }
  }
  
  return issues;
}

/**
 * Check for large directories that might slow scans
 */
async function checkLargeDirectories(rootDir: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  
  // Check if node_modules is being scanned
  const driftignorePath = path.join(rootDir, '.driftignore');
  let driftignoreContent = '';
  
  try {
    driftignoreContent = await fs.readFile(driftignorePath, 'utf-8');
  } catch { /* */ }
  
  const largeDirs = ['node_modules', '.git', 'vendor', '__pycache__', '.venv', 'target'];
  
  for (const dir of largeDirs) {
    try {
      await fs.access(path.join(rootDir, dir));
      if (!driftignoreContent.includes(dir)) {
        issues.push({
          id: `large-dir-${dir}`,
          severity: 'warning',
          title: `Large directory not ignored: ${dir}/`,
          description: `The ${dir}/ directory is not in .driftignore and may significantly slow down scans.`,
          fix: `Add "${dir}/" to your .driftignore file.`,
          autoFixable: false,
        });
      }
    } catch { /* */ }
  }
  
  return issues;
}

/**
 * Check for stale cache
 */
async function checkCache(rootDir: string): Promise<Issue | null> {
  const cacheDir = path.join(rootDir, DRIFT_DIR, 'cache');
  
  try {
    const files = await fs.readdir(cacheDir);
    
    // Check for very old cache files
    for (const file of files) {
      const filePath = path.join(cacheDir, file);
      const stats = await fs.stat(filePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      
      if (ageInDays > 30) {
        return {
          id: 'stale-cache',
          severity: 'info',
          title: 'Stale cache detected',
          description: `Cache files are over 30 days old. Consider clearing the cache for fresh analysis.`,
          fix: 'Delete the .drift/cache/ directory and run `drift scan` again.',
          autoFixable: true,
          fixCommand: 'rm -rf .drift/cache && drift scan',
        };
      }
    }
  } catch { /* */ }
  
  return null;
}

/**
 * Check Node.js version
 */
function checkNodeVersion(): Issue | null {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
  
  if (major < 18) {
    return {
      id: 'old-node',
      severity: 'error',
      title: 'Node.js version too old',
      description: `Drift requires Node.js 18 or higher. You have ${version}.`,
      fix: 'Upgrade Node.js to version 18 or higher.',
      autoFixable: false,
    };
  }
  
  if (major >= 25) {
    return {
      id: 'new-node',
      severity: 'warning',
      title: 'Node.js version not officially supported',
      description: `You're using Node.js ${version}. Drift is tested on Node.js 18-24.`,
      fix: 'Consider using Node.js 18-24 if you encounter issues.',
      autoFixable: false,
    };
  }
  
  return null;
}

/**
 * Check for common MCP issues
 */
async function checkMcpSetup(rootDir: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  
  // Check if MCP config exists in common locations
  const mcpConfigPaths = [
    path.join(rootDir, '.cursor', 'mcp.json'),
    path.join(rootDir, '.kiro', 'settings', 'mcp.json'),
  ];
  
  for (const configPath of mcpConfigPaths) {
    try {
      await fs.access(configPath);
      
      // Check if drift is configured
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      if (!config.mcpServers?.drift) {
        issues.push({
          id: 'mcp-drift-not-configured',
          severity: 'info',
          title: 'Drift not in MCP config',
          description: `Found MCP config at ${path.relative(rootDir, configPath)} but Drift is not configured.`,
          fix: 'Add Drift to your MCP configuration. See: drift wiki MCP-Setup',
          autoFixable: false,
        });
      }
    } catch { /* */ }
  }
  
  return issues;
}

/**
 * Run all diagnostics
 */
async function runDiagnostics(rootDir: string): Promise<DiagnosticResult> {
  const issues: Issue[] = [];
  const suggestions: string[] = [];
  
  // System info
  const systemInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    cwd: rootDir,
    driftVersion: undefined as string | undefined,
  };
  
  // Try to get drift version
  try {
    const pkgPath = path.join(rootDir, 'node_modules', 'driftdetect', 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    systemInfo.driftVersion = pkg.version;
  } catch { /* */ }
  
  // Run checks
  const nodeIssue = checkNodeVersion();
  if (nodeIssue) issues.push(nodeIssue);
  
  const initIssue = await checkInitialized(rootDir);
  if (initIssue) {
    issues.push(initIssue);
    // If not initialized, skip other checks
    return {
      healthy: false,
      issues,
      suggestions: ['Run `drift init` to get started.'],
      systemInfo,
    };
  }
  
  const configIssue = await checkConfig(rootDir);
  if (configIssue) issues.push(configIssue);
  
  const patternsIssue = await checkPatterns(rootDir);
  if (patternsIssue) issues.push(patternsIssue);
  
  const driftignoreIssues = await checkDriftignore(rootDir);
  issues.push(...driftignoreIssues);
  
  const largeDirIssues = await checkLargeDirectories(rootDir);
  issues.push(...largeDirIssues);
  
  const cacheIssue = await checkCache(rootDir);
  if (cacheIssue) issues.push(cacheIssue);
  
  const mcpIssues = await checkMcpSetup(rootDir);
  issues.push(...mcpIssues);
  
  // Generate suggestions
  if (issues.length === 0) {
    suggestions.push('Everything looks good! Run `drift next-steps` for recommendations.');
  } else {
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    
    if (errorCount > 0) {
      suggestions.push(`Fix ${errorCount} error(s) first before using Drift.`);
    }
    if (warningCount > 0) {
      suggestions.push(`Address ${warningCount} warning(s) to improve performance.`);
    }
  }
  
  return {
    healthy: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    suggestions,
    systemInfo,
  };
}

/**
 * Troubleshoot command action
 */
async function troubleshootAction(options: TroubleshootOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Running diagnostics...') : null;
  spinner?.start();

  const result = await runDiagnostics(rootDir);

  spinner?.stop();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔧 Drift - Troubleshoot'));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  // System info
  console.log(chalk.bold('System Information'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Node.js:  ${chalk.cyan(result.systemInfo.nodeVersion)}`);
  console.log(`  Platform: ${chalk.cyan(result.systemInfo.platform)}`);
  console.log(`  CWD:      ${chalk.cyan(result.systemInfo.cwd)}`);
  if (result.systemInfo.driftVersion) {
    console.log(`  Drift:    ${chalk.cyan(result.systemInfo.driftVersion)}`);
  }
  console.log();

  // Health status
  const healthIcon = result.healthy ? chalk.green('✓') : chalk.red('✗');
  const healthText = result.healthy ? chalk.green('Healthy') : chalk.red('Issues Found');
  console.log(chalk.bold('Health Status'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ${healthIcon} ${healthText}`);
  console.log();

  // Issues
  if (result.issues.length > 0) {
    console.log(chalk.bold('Issues'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log();

    const errors = result.issues.filter(i => i.severity === 'error');
    const warnings = result.issues.filter(i => i.severity === 'warning');
    const infos = result.issues.filter(i => i.severity === 'info');

    if (errors.length > 0) {
      console.log(chalk.red.bold('  🔴 Errors'));
      for (const issue of errors) {
        console.log();
        console.log(`     ${chalk.red(issue.title)}`);
        console.log(chalk.gray(`     ${issue.description}`));
        if (issue.fix) {
          console.log(chalk.cyan(`     Fix: ${issue.fix}`));
        }
        if (issue.fixCommand && options.verbose) {
          console.log(chalk.gray(`     Command: ${issue.fixCommand}`));
        }
      }
      console.log();
    }

    if (warnings.length > 0) {
      console.log(chalk.yellow.bold('  🟡 Warnings'));
      for (const issue of warnings) {
        console.log();
        console.log(`     ${chalk.yellow(issue.title)}`);
        console.log(chalk.gray(`     ${issue.description}`));
        if (issue.fix) {
          console.log(chalk.cyan(`     Fix: ${issue.fix}`));
        }
      }
      console.log();
    }

    if (infos.length > 0 && options.verbose) {
      console.log(chalk.blue.bold('  🔵 Info'));
      for (const issue of infos) {
        console.log();
        console.log(`     ${chalk.blue(issue.title)}`);
        console.log(chalk.gray(`     ${issue.description}`));
        if (issue.fix) {
          console.log(chalk.cyan(`     Fix: ${issue.fix}`));
        }
      }
      console.log();
    }
  } else {
    console.log(chalk.green('  ✓ No issues found!'));
    console.log();
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    console.log(chalk.bold('Suggestions'));
    console.log(chalk.gray('─'.repeat(40)));
    for (const suggestion of result.suggestions) {
      console.log(`  → ${suggestion}`);
    }
    console.log();
  }

  // Quick links
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('Need more help?'));
  console.log(chalk.gray('  • Wiki: https://github.com/dadbodgeoff/drift/wiki'));
  console.log(chalk.gray('  • FAQ: https://github.com/dadbodgeoff/drift/wiki/FAQ'));
  console.log(chalk.gray('  • Issues: https://github.com/dadbodgeoff/drift/issues'));
  console.log();
}

export const troubleshootCommand = new Command('troubleshoot')
  .description('Diagnose common issues and get targeted fixes')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-v, --verbose', 'Show all issues including info-level')
  .option('--fix', 'Attempt to auto-fix issues where possible')
  .action(troubleshootAction);
