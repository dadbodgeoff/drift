/**
 * Environment Command - drift env
 *
 * Show environment variable access patterns across the codebase.
 * Tracks which code accesses which environment variables/config.
 *
 * @requirements Environment Variable Detection Feature
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createEnvScanner,
  createEnvStore,
  isNativeAvailable,
  analyzeEnvironmentWithFallback,
  type EnvSensitivity,
} from 'driftdetect-core';

export interface EnvOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Filter by sensitivity */
  sensitivity?: EnvSensitivity;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for environment data */
const ENV_DIR = 'environment';

/**
 * Check if environment data exists
 */
async function envDataExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, ENV_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when env data not initialized
 */
function showNotInitializedMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No environment variable data discovered yet.'));
  console.log();
  console.log(chalk.gray('Environment tracking detects which code accesses which env vars.'));
  console.log(chalk.gray('Run a scan to discover environment access patterns:'));
  console.log();
  console.log(chalk.cyan('  drift env scan'));
  console.log();
}

/**
 * Scan subcommand - scan for environment variable access
 */
async function scanAction(options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const verbose = options.verbose ?? false;

  if (format !== 'json') {
    console.log();
    console.log(chalk.bold('🔍 Scanning for environment variable access...'));
    console.log();
  }

  // Try native analyzer first (much faster)
  if (isNativeAvailable()) {
    try {
      const files = await getSourceFiles(rootDir);
      const nativeResult = await analyzeEnvironmentWithFallback(rootDir, files);
      
      // Use TypeScript scanner to save results (handles format conversion)
      const scanner = createEnvScanner({ rootDir, verbose });
      const tsResult = await scanner.scanFiles(files);
      
      const store = createEnvStore({ rootDir });
      await store.initialize();
      await store.updateAccessMap(tsResult.accessMap);

      // JSON output
      if (format === 'json') {
        console.log(JSON.stringify({
          stats: nativeResult.stats,
          variables: nativeResult.variables.length,
          secrets: nativeResult.stats.secretsCount,
          credentials: nativeResult.stats.credentialsCount,
          native: true,
        }, null, 2));
        return;
      }

      // Text output
      console.log(chalk.green('✓ Scan complete (native)'));
      console.log();
      console.log(`Files scanned: ${chalk.cyan(nativeResult.stats.filesAnalyzed)}`);
      console.log(`Variables found: ${chalk.cyan(nativeResult.stats.uniqueVariables)}`);
      console.log(`Access points: ${chalk.cyan(nativeResult.stats.totalAccesses)}`);
      console.log(`Secrets detected: ${chalk.yellow(nativeResult.stats.secretsCount)}`);
      console.log(`Duration: ${chalk.gray(`${nativeResult.stats.durationMs}ms`)}`);
      console.log();

      if (nativeResult.stats.secretsCount > 0) {
        console.log(chalk.yellow(`⚠️  ${nativeResult.stats.secretsCount} secret variables detected`));
        console.log(chalk.gray("Run 'drift env secrets' to see details"));
        console.log();
      }
      return;
    } catch (nativeError) {
      if (verbose) {
        console.log(chalk.gray(`Native analyzer failed, using TypeScript fallback: ${(nativeError as Error).message}`));
      }
      // Fall through to TypeScript implementation
    }
  }

  // TypeScript fallback
  const scanner = createEnvScanner({ rootDir, verbose });
  const result = await scanner.scanDirectory();

  // Save results
  const store = createEnvStore({ rootDir });
  await store.initialize();
  await store.updateAccessMap(result.accessMap);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      stats: result.stats,
      variables: Object.keys(result.accessMap.variables).length,
      secrets: result.accessMap.stats.secretVariables,
      credentials: result.accessMap.stats.credentialVariables,
    }, null, 2));
    return;
  }

  // Text output
  console.log(chalk.green('✓ Scan complete'));
  console.log();
  console.log(`Files scanned: ${chalk.cyan(result.stats.filesScanned)}`);
  console.log(`Variables found: ${chalk.cyan(result.stats.variablesFound)}`);
  console.log(`Access points: ${chalk.cyan(result.stats.accessPointsFound)}`);
  console.log(`Secrets detected: ${chalk.yellow(result.stats.secretsFound)}`);
  console.log(`Duration: ${chalk.gray(`${result.stats.scanDurationMs}ms`)}`);
  console.log();

  if (result.accessMap.stats.secretVariables > 0) {
    console.log(chalk.yellow(`⚠️  ${result.accessMap.stats.secretVariables} secret variables detected`));
    console.log(chalk.gray("Run 'drift env secrets' to see details"));
    console.log();
  }

  // Sync environment data to SQLite
  try {
    const { createSyncService } = await import('driftdetect-core/storage');
    const syncService = createSyncService({ rootDir, verbose: false });
    await syncService.initialize();
    await syncService.syncEnvironment();
    await syncService.close();
    if (options.verbose) {
      console.log(chalk.gray('  Environment data synced to drift.db'));
    }
  } catch (syncError) {
    if (options.verbose) {
      console.log(chalk.yellow(`  Warning: Could not sync to SQLite: ${(syncError as Error).message}`));
    }
  }
}

/**
 * Get source files for scanning
 */
async function getSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.php', '.go'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.drift', 'vendor', 'target', '.venv', 'venv'];
  
  async function walk(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  
  await walk(rootDir);
  return files;
}

/**
 * Overview subcommand - default view
 */
async function overviewAction(options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const accessMap = store.getAccessMap();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      variables: accessMap.stats.totalVariables,
      accessPoints: accessMap.stats.totalAccessPoints,
      secrets: accessMap.stats.secretVariables,
      credentials: accessMap.stats.credentialVariables,
      config: accessMap.stats.configVariables,
      byLanguage: accessMap.stats.byLanguage,
      byMethod: accessMap.stats.byMethod,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔐 Environment Variable Access'));
  console.log();

  // Summary stats
  console.log(`Variables Discovered: ${chalk.cyan(accessMap.stats.totalVariables)}`);
  console.log(`Access Points: ${chalk.cyan(accessMap.stats.totalAccessPoints)}`);
  console.log();

  // Sensitivity breakdown
  console.log(chalk.bold('By Sensitivity:'));
  console.log(`  ${chalk.red('●')} Secrets: ${chalk.red(accessMap.stats.secretVariables)}`);
  console.log(`  ${chalk.yellow('●')} Credentials: ${chalk.yellow(accessMap.stats.credentialVariables)}`);
  console.log(`  ${chalk.blue('●')} Config: ${chalk.blue(accessMap.stats.configVariables)}`);
  console.log();

  // Top accessed variables
  const varEntries = Object.values(accessMap.variables)
    .sort((a, b) => b.accessedBy.length - a.accessedBy.length)
    .slice(0, 5);

  if (varEntries.length > 0) {
    console.log(chalk.bold('Most Accessed Variables:'));
    for (const varInfo of varEntries) {
      const name = varInfo.name.padEnd(24);
      const sensitivityColor = getSensitivityColor(varInfo.sensitivity);
      console.log(`  ${sensitivityColor(name)} ${chalk.gray(`${varInfo.accessedBy.length} access points (${varInfo.files.length} files)`)}`);
    }
    console.log();
  }

  // Quick actions
  console.log(chalk.gray("Run 'drift env secrets' to see secret variables"));
  console.log(chalk.gray("Run 'drift env var <name>' for variable details"));
  console.log();
}

/**
 * List subcommand - list all discovered variables
 */
async function listAction(options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const sensitivity = options.sensitivity;

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found', variables: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const accessMap = store.getAccessMap();
  let variables = Object.values(accessMap.variables);

  // Filter by sensitivity if specified
  if (sensitivity) {
    variables = variables.filter(v => v.sensitivity === sensitivity);
  }

  // Sort by access count
  variables.sort((a, b) => b.accessedBy.length - a.accessedBy.length);

  // JSON output
  if (format === 'json') {
    const output = variables.map(v => ({
      name: v.name,
      sensitivity: v.sensitivity,
      accessCount: v.accessedBy.length,
      fileCount: v.files.length,
      hasDefault: v.hasDefault,
      isRequired: v.isRequired,
    }));
    console.log(JSON.stringify({ variables: output }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔐 Environment Variables'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (variables.length === 0) {
    console.log(chalk.gray('  No variables found.'));
    console.log();
    return;
  }

  for (const varInfo of variables) {
    const sensitivityColor = getSensitivityColor(varInfo.sensitivity);
    const name = sensitivityColor(varInfo.name);
    const required = varInfo.isRequired && !varInfo.hasDefault ? chalk.red(' (required)') : '';
    
    console.log(`  ${name}${required}`);
    console.log(chalk.gray(`    ${varInfo.accessedBy.length} access points in ${varInfo.files.length} files`));
    console.log();
  }
}

/**
 * Var subcommand - show details for a specific variable
 */
async function varAction(varName: string, options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const varInfo = store.getVariable(varName);

  if (!varInfo) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Variable '${varName}' not found` }));
    } else {
      console.log();
      console.log(chalk.red(`Variable '${varName}' not found.`));
      console.log(chalk.gray("Run 'drift env list' to see all discovered variables."));
      console.log();
    }
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      name: varInfo.name,
      sensitivity: varInfo.sensitivity,
      hasDefault: varInfo.hasDefault,
      isRequired: varInfo.isRequired,
      files: varInfo.files,
      accessPoints: varInfo.accessedBy,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold(`🔐 Variable: ${varName}`));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  const sensitivityColor = getSensitivityColor(varInfo.sensitivity);
  console.log(`Sensitivity: ${sensitivityColor(varInfo.sensitivity)}`);
  console.log(`Has Default: ${varInfo.hasDefault ? chalk.green('yes') : chalk.yellow('no')}`);
  console.log(`Required: ${varInfo.isRequired ? chalk.red('yes') : chalk.green('no')}`);
  console.log(`Access Points: ${chalk.cyan(varInfo.accessedBy.length)}`);
  console.log();

  // Access points grouped by file
  const byFile = new Map<string, typeof varInfo.accessedBy>();
  for (const ap of varInfo.accessedBy) {
    if (!byFile.has(ap.file)) {
      byFile.set(ap.file, []);
    }
    byFile.get(ap.file)!.push(ap);
  }

  console.log(chalk.bold('Access Points:'));
  for (const [file, accessPoints] of byFile) {
    console.log(`  ${chalk.cyan(file)}`);
    for (const ap of accessPoints) {
      const methodColor = chalk.gray;
      console.log(`    Line ${ap.line}: ${methodColor(ap.method)} ${ap.hasDefault ? chalk.green('(has default)') : ''}`);
    }
  }
  console.log();
}

/**
 * Secrets subcommand - show all secret variables
 */
async function secretsAction(options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found', secrets: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const secrets = store.getSecrets();
  const credentials = store.getCredentials();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      secrets: secrets.map(s => ({
        name: s.name,
        accessCount: s.accessedBy.length,
        files: s.files,
        hasDefault: s.hasDefault,
      })),
      credentials: credentials.map(c => ({
        name: c.name,
        accessCount: c.accessedBy.length,
        files: c.files,
        hasDefault: c.hasDefault,
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔒 Sensitive Environment Variables'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (secrets.length === 0 && credentials.length === 0) {
    console.log(chalk.green('  ✓ No sensitive variables detected.'));
    console.log();
    return;
  }

  if (secrets.length > 0) {
    console.log(chalk.red.bold(`Secrets (${secrets.length}):`));
    for (const secret of secrets) {
      const name = secret.name.padEnd(32);
      const required = secret.isRequired && !secret.hasDefault ? chalk.red(' ⚠ required') : '';
      console.log(`  ${chalk.red('●')} ${chalk.white(name)}${required}`);
      console.log(chalk.gray(`      ${secret.accessedBy.length} access points in ${secret.files.length} files`));
    }
    console.log();
  }

  if (credentials.length > 0) {
    console.log(chalk.yellow.bold(`Credentials (${credentials.length}):`));
    for (const cred of credentials) {
      const name = cred.name.padEnd(32);
      const required = cred.isRequired && !cred.hasDefault ? chalk.red(' ⚠ required') : '';
      console.log(`  ${chalk.yellow('●')} ${chalk.white(name)}${required}`);
      console.log(chalk.gray(`      ${cred.accessedBy.length} access points in ${cred.files.length} files`));
    }
    console.log();
  }
}

/**
 * Required subcommand - show required variables without defaults
 */
async function requiredAction(options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found', required: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const required = store.getRequiredVariables();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      required: required.map(r => ({
        name: r.name,
        sensitivity: r.sensitivity,
        accessCount: r.accessedBy.length,
        files: r.files,
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('⚠️  Required Environment Variables'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (required.length === 0) {
    console.log(chalk.green('  ✓ All variables have defaults or are optional.'));
    console.log();
    return;
  }

  console.log(chalk.gray('These variables must be set for the application to work:'));
  console.log();

  for (const varInfo of required) {
    const sensitivityColor = getSensitivityColor(varInfo.sensitivity);
    const name = varInfo.name.padEnd(32);
    console.log(`  ${sensitivityColor('●')} ${chalk.white(name)} ${chalk.gray(`(${varInfo.sensitivity})`)}`);
  }
  console.log();
}

/**
 * File subcommand - show what env vars a file accesses
 */
async function fileAction(pattern: string, options: EnvOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await envDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No environment data found', files: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createEnvStore({ rootDir });
  await store.initialize();

  const fileAccess = store.getFileAccess(pattern);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({ files: fileAccess }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold(`📁 Environment Access: ${pattern}`));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (fileAccess.length === 0) {
    console.log(chalk.gray(`  No environment access found for pattern '${pattern}'.`));
    console.log();
    return;
  }

  for (const fileInfo of fileAccess) {
    console.log(chalk.cyan(fileInfo.file));
    console.log(`  Variables: ${chalk.white(fileInfo.variables.join(', '))}`);
    
    if (fileInfo.sensitiveVars.length > 0) {
      console.log(`  ${chalk.yellow('⚠ Sensitive:')} ${chalk.yellow(fileInfo.sensitiveVars.join(', '))}`);
    }
    
    for (const ap of fileInfo.accessPoints) {
      const sensitivityColor = getSensitivityColor(ap.sensitivity);
      console.log(`    Line ${ap.line}: ${sensitivityColor(ap.varName)} ${chalk.gray(`via ${ap.method}`)}`);
    }
    console.log();
  }
}

/**
 * Get color function for sensitivity level
 */
function getSensitivityColor(sensitivity: EnvSensitivity): typeof chalk.red {
  switch (sensitivity) {
    case 'secret':
      return chalk.red;
    case 'credential':
      return chalk.yellow;
    case 'config':
      return chalk.blue;
    default:
      return chalk.gray;
  }
}

/**
 * Create the env command with subcommands
 */
export const envCommand = new Command('env')
  .description('Show environment variable access patterns')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(overviewAction);

// Subcommands
envCommand
  .command('scan')
  .description('Scan codebase for environment variable access')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(scanAction);

envCommand
  .command('list')
  .description('List all discovered environment variables')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-s, --sensitivity <type>', 'Filter by sensitivity (secret, credential, config)')
  .action(listAction);

envCommand
  .command('var <name>')
  .description('Show details for a specific variable')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(varAction);

envCommand
  .command('secrets')
  .description('Show all secret and credential variables')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(secretsAction);

envCommand
  .command('required')
  .description('Show required variables without defaults')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(requiredAction);

envCommand
  .command('file <pattern>')
  .description('Show what env vars a file or pattern accesses')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(fileAction);
