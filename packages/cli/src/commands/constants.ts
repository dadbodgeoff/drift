/**
 * Constants Command - drift constants
 *
 * Analyze constants, enums, and exported values across the codebase.
 * Detects hardcoded secrets, inconsistent values, and magic numbers.
 *
 * @requirements Constant & Enum Extraction Feature
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  ConstantStore,
  ConstantSecurityScanner,
  ConsistencyAnalyzer,
  type ConstantCategory,
  type ConstantLanguage,
  type IssueSeverity,
} from 'driftdetect-core';

export interface ConstantsOptions {
  /** Output format */
  format?: 'text' | 'json' | 'csv';
  /** Filter by category */
  category?: ConstantCategory;
  /** Filter by language */
  language?: ConstantLanguage;
  /** Filter by file path */
  file?: string;
  /** Search by name */
  search?: string;
  /** Filter by exported status */
  exported?: boolean;
  /** Minimum severity for secrets */
  severity?: IssueSeverity;
  /** Limit results */
  limit?: number;
  /** Enable verbose output */
  verbose?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for constants data */
const CONSTANTS_DIR = 'constants';

/**
 * Check if constants data exists
 */
async function constantsDataExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, CONSTANTS_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when constants data not initialized
 */
function showNotInitializedMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No constant data discovered yet.'));
  console.log();
  console.log(chalk.gray('Constant tracking extracts constants, enums, and exported values.'));
  console.log(chalk.gray('Run a scan to discover constants:'));
  console.log();
  console.log(chalk.cyan('  drift scan'));
  console.log();
}

/**
 * Get color for severity level
 */
function getSeverityColor(severity: IssueSeverity): typeof chalk.red {
  switch (severity) {
    case 'critical':
      return chalk.red;
    case 'high':
      return chalk.redBright;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    default:
      return chalk.gray;
  }
}

/**
 * Get color for category
 */
function getCategoryColor(category: ConstantCategory): typeof chalk.cyan {
  switch (category) {
    case 'security':
      return chalk.red;
    case 'api':
      return chalk.blue;
    case 'config':
      return chalk.green;
    case 'error':
      return chalk.yellow;
    case 'feature_flag':
      return chalk.magenta;
    case 'limit':
      return chalk.cyan;
    default:
      return chalk.gray;
  }
}

/**
 * Overview action - default view showing summary
 */
async function overviewAction(options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });

  try {
    const stats = await store.getStats();
    const index = await store.getIndex();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        totalConstants: stats.totalConstants,
        totalEnums: stats.totalEnums,
        byLanguage: stats.byLanguage,
        byCategory: stats.byCategory,
        issues: stats.issues,
        lastScanAt: index.generatedAt,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.bold('📊 Constants Overview'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Total Constants: ${chalk.cyan(stats.totalConstants)}`);
    console.log(`Total Enums: ${chalk.cyan(stats.totalEnums)}`);
    console.log();

    // By language
    if (Object.keys(stats.byLanguage).length > 0) {
      console.log(chalk.bold('By Language:'));
      for (const [lang, count] of Object.entries(stats.byLanguage)) {
        console.log(`  ${chalk.white(lang.padEnd(12))} ${chalk.cyan(count)}`);
      }
      console.log();
    }

    // By category
    if (Object.keys(stats.byCategory).length > 0) {
      console.log(chalk.bold('By Category:'));
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        const color = getCategoryColor(cat as ConstantCategory);
        console.log(`  ${color(cat.padEnd(16))} ${chalk.cyan(count)}`);
      }
      console.log();
    }

    // Issues
    const totalIssues = stats.issues.magicValues + stats.issues.deadConstants +
      stats.issues.potentialSecrets + stats.issues.inconsistentValues;

    if (totalIssues > 0) {
      console.log(chalk.bold('Issues:'));
      if (stats.issues.potentialSecrets > 0) {
        console.log(`  ${chalk.red('●')} Potential Secrets: ${chalk.red(stats.issues.potentialSecrets)}`);
      }
      if (stats.issues.inconsistentValues > 0) {
        console.log(`  ${chalk.yellow('●')} Inconsistent Values: ${chalk.yellow(stats.issues.inconsistentValues)}`);
      }
      if (stats.issues.deadConstants > 0) {
        console.log(`  ${chalk.gray('●')} Dead Constants: ${chalk.gray(stats.issues.deadConstants)}`);
      }
      if (stats.issues.magicValues > 0) {
        console.log(`  ${chalk.blue('●')} Magic Values: ${chalk.blue(stats.issues.magicValues)}`);
      }
      console.log();
    }

    // Quick actions
    console.log(chalk.gray("Run 'drift constants list' to browse constants"));
    if (stats.issues.potentialSecrets > 0) {
      console.log(chalk.yellow("Run 'drift constants secrets' to review potential secrets"));
    }
    console.log();

  } catch {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Failed to load constants data' }));
    } else {
      showNotInitializedMessage();
    }
  }
}

/**
 * List action - list all constants with filtering
 */
async function listAction(options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 50;

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found', constants: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });

  let constants = await store.getAllConstants();
  let enums = await store.getAllEnums();

  // Apply filters
  if (options.category) {
    constants = constants.filter(c => c.category === options.category);
  }
  if (options.language) {
    constants = constants.filter(c => c.language === options.language);
    enums = enums.filter(e => e.language === options.language);
  }
  if (options.file) {
    constants = constants.filter(c => c.file.includes(options.file!));
    enums = enums.filter(e => e.file.includes(options.file!));
  }
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    constants = constants.filter(c =>
      c.name.toLowerCase().includes(searchLower) ||
      c.qualifiedName.toLowerCase().includes(searchLower)
    );
    enums = enums.filter(e => e.name.toLowerCase().includes(searchLower));
  }
  if (options.exported !== undefined) {
    constants = constants.filter(c => c.isExported === options.exported);
    enums = enums.filter(e => e.isExported === options.exported);
  }

  // Limit results
  const paginatedConstants = constants.slice(0, limit);
  const paginatedEnums = enums.slice(0, Math.max(0, limit - paginatedConstants.length));

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      constants: paginatedConstants.map(c => ({
        id: c.id,
        name: c.name,
        qualifiedName: c.qualifiedName,
        file: c.file,
        line: c.line,
        language: c.language,
        kind: c.kind,
        category: c.category,
        value: c.value,
        isExported: c.isExported,
      })),
      enums: paginatedEnums.map(e => ({
        id: e.id,
        name: e.name,
        file: e.file,
        line: e.line,
        memberCount: e.members.length,
      })),
      total: constants.length + enums.length,
    }, null, 2));
    return;
  }

  // CSV output
  if (format === 'csv') {
    console.log('id,name,file,line,language,kind,category,value,exported');
    for (const c of paginatedConstants) {
      const value = c.value !== undefined ? String(c.value).replace(/,/g, ';') : '';
      console.log(`${c.id},${c.name},${c.file},${c.line},${c.language},${c.kind},${c.category},"${value}",${c.isExported}`);
    }
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('📋 Constants'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log();

  if (paginatedConstants.length === 0 && paginatedEnums.length === 0) {
    console.log(chalk.gray('  No constants found matching filters.'));
    console.log();
    return;
  }

  // Constants
  for (const c of paginatedConstants) {
    const categoryColor = getCategoryColor(c.category);
    const name = chalk.white(c.name.padEnd(30));
    const category = categoryColor(c.category.padEnd(12));
    const exported = c.isExported ? chalk.green('✓') : chalk.gray('·');
    const value = c.value !== undefined
      ? chalk.gray(String(c.value).slice(0, 30) + (String(c.value).length > 30 ? '...' : ''))
      : '';

    console.log(`  ${exported} ${name} ${category} ${value}`);
    console.log(chalk.gray(`      ${c.file}:${c.line}`));
  }

  // Enums
  if (paginatedEnums.length > 0) {
    console.log();
    console.log(chalk.bold('📦 Enums'));
    console.log();
    for (const e of paginatedEnums) {
      const name = chalk.white(e.name.padEnd(30));
      const members = chalk.cyan(`${e.members.length} members`);
      console.log(`  ${name} ${members}`);
      console.log(chalk.gray(`      ${e.file}:${e.line}`));
    }
  }

  console.log();
  console.log(chalk.gray(`Showing ${paginatedConstants.length + paginatedEnums.length} of ${constants.length + enums.length} items`));
  console.log();
}

/**
 * Get action - show details for a specific constant
 */
async function getAction(nameOrId: string, options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });

  // Try to find by ID first, then by name
  let constant = await store.getConstantById(nameOrId);
  if (!constant) {
    const results = await store.searchByName(nameOrId);
    constant = results[0] ?? null;
  }

  let enumDef = null;
  if (!constant) {
    enumDef = await store.getEnumById(nameOrId);
    if (!enumDef) {
      const enums = await store.getAllEnums();
      enumDef = enums.find(e => e.name === nameOrId) ?? null;
    }
  }

  if (!constant && !enumDef) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Constant or enum not found: ${nameOrId}` }));
    } else {
      console.log();
      console.log(chalk.red(`Constant or enum '${nameOrId}' not found.`));
      console.log(chalk.gray("Run 'drift constants list' to see available constants."));
      console.log();
    }
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      constant: constant ?? undefined,
      enum: enumDef ?? undefined,
    }, null, 2));
    return;
  }

  // Text output
  console.log();

  if (constant) {
    console.log(chalk.bold(`📌 Constant: ${constant.name}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Qualified Name: ${chalk.cyan(constant.qualifiedName)}`);
    console.log(`File: ${chalk.white(constant.file)}:${constant.line}`);
    console.log(`Language: ${chalk.white(constant.language)}`);
    console.log(`Kind: ${chalk.white(constant.kind)}`);
    console.log(`Category: ${getCategoryColor(constant.category)(constant.category)}`);
    console.log(`Exported: ${constant.isExported ? chalk.green('yes') : chalk.gray('no')}`);

    if (constant.value !== undefined) {
      console.log();
      console.log(chalk.bold('Value:'));
      console.log(`  ${chalk.cyan(String(constant.value))}`);
    }

    if (constant.docComment) {
      console.log();
      console.log(chalk.bold('Documentation:'));
      console.log(`  ${chalk.gray(constant.docComment)}`);
    }
  }

  if (enumDef) {
    console.log(chalk.bold(`📦 Enum: ${enumDef.name}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`File: ${chalk.white(enumDef.file)}:${enumDef.line}`);
    console.log(`Language: ${chalk.white(enumDef.language)}`);
    console.log(`Exported: ${enumDef.isExported ? chalk.green('yes') : chalk.gray('no')}`);
    console.log(`Members: ${chalk.cyan(enumDef.members.length)}`);

    if (enumDef.members.length > 0) {
      console.log();
      console.log(chalk.bold('Members:'));
      for (const member of enumDef.members.slice(0, 20)) {
        const value = member.value !== undefined ? ` = ${chalk.cyan(String(member.value))}` : '';
        console.log(`  ${chalk.white(member.name)}${value}`);
      }
      if (enumDef.members.length > 20) {
        console.log(chalk.gray(`  ... and ${enumDef.members.length - 20} more`));
      }
    }
  }

  console.log();
}

/**
 * Secrets action - show potential hardcoded secrets
 */
async function secretsAction(options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 50;
  const minSeverity = options.severity;

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found', secrets: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });
  const scanner = new ConstantSecurityScanner();

  const constants = await store.getAllConstants();
  const result = scanner.scan(constants);

  // Filter by severity
  let secrets = result.secrets;
  if (minSeverity) {
    const severityOrder: IssueSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIndex = severityOrder.indexOf(minSeverity);
    secrets = secrets.filter(s => severityOrder.indexOf(s.severity) >= minIndex);
  }

  const paginatedSecrets = secrets.slice(0, limit);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      secrets: paginatedSecrets,
      total: secrets.length,
      bySeverity: {
        critical: secrets.filter(s => s.severity === 'critical').length,
        high: secrets.filter(s => s.severity === 'high').length,
        medium: secrets.filter(s => s.severity === 'medium').length,
        low: secrets.filter(s => s.severity === 'low').length,
        info: secrets.filter(s => s.severity === 'info').length,
      },
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔐 Potential Hardcoded Secrets'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (secrets.length === 0) {
    console.log(chalk.green('  ✓ No hardcoded secrets detected.'));
    console.log();
    return;
  }

  // Summary
  const critical = secrets.filter(s => s.severity === 'critical').length;
  const high = secrets.filter(s => s.severity === 'high').length;

  if (critical > 0) {
    console.log(chalk.red(`  🔴 ${critical} CRITICAL secrets found!`));
  }
  if (high > 0) {
    console.log(chalk.redBright(`  🟠 ${high} HIGH severity secrets found`));
  }
  console.log();

  // List secrets
  for (const secret of paginatedSecrets) {
    const severityColor = getSeverityColor(secret.severity);
    const severity = severityColor(secret.severity.toUpperCase().padEnd(8));
    const name = chalk.white(secret.name.padEnd(30));

    console.log(`  ${severity} ${name}`);
    console.log(chalk.gray(`      ${secret.file}:${secret.line}`));
    console.log(chalk.gray(`      Type: ${secret.secretType}`));
    console.log();
  }

  console.log(chalk.gray(`Showing ${paginatedSecrets.length} of ${secrets.length} potential secrets`));
  console.log();
  console.log(chalk.yellow('⚠️  Move secrets to environment variables or a secrets manager'));
  console.log();
}

/**
 * Inconsistent action - show constants with inconsistent values
 */
async function inconsistentAction(options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 50;

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found', inconsistencies: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });
  const analyzer = new ConsistencyAnalyzer();

  const constants = await store.getAllConstants();
  const result = analyzer.analyze(constants);

  const paginatedInconsistencies = result.inconsistencies.slice(0, limit);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      inconsistencies: paginatedInconsistencies,
      total: result.inconsistencies.length,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('⚡ Inconsistent Constants'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (result.inconsistencies.length === 0) {
    console.log(chalk.green('  ✓ No inconsistent constants found.'));
    console.log();
    return;
  }

  for (const inc of paginatedInconsistencies) {
    console.log(chalk.yellow(`  ${inc.name}`));
    console.log(chalk.gray(`      Found ${inc.instances.length} different values:`));
    for (const inst of inc.instances.slice(0, 5)) {
      console.log(`        ${chalk.cyan(String(inst.value))} in ${chalk.gray(inst.file)}:${inst.line}`);
    }
    if (inc.instances.length > 5) {
      console.log(chalk.gray(`        ... and ${inc.instances.length - 5} more`));
    }
    console.log();
  }

  console.log(chalk.gray(`Showing ${paginatedInconsistencies.length} of ${result.inconsistencies.length} inconsistencies`));
  console.log();
}

/**
 * Dead action - show potentially unused constants
 */
async function deadAction(options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 50;

  if (!(await constantsDataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constants data found', dead: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = new ConstantStore({ rootDir });

  // Get constants that are not exported and uncategorized (likely unused)
  const constants = await store.getAllConstants();
  const potentiallyDead = constants
    .filter(c => !c.isExported && c.category === 'uncategorized')
    .slice(0, limit);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      dead: potentiallyDead.map(c => ({
        id: c.id,
        name: c.name,
        file: c.file,
        line: c.line,
        confidence: 0.5,
        reason: 'not_exported_uncategorized',
      })),
      total: potentiallyDead.length,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('💀 Potentially Unused Constants'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (potentiallyDead.length === 0) {
    console.log(chalk.green('  ✓ No obvious dead constants found.'));
    console.log();
    return;
  }

  console.log(chalk.gray('  Note: Full dead code detection requires reference analysis.'));
  console.log();

  for (const c of potentiallyDead) {
    console.log(`  ${chalk.gray('●')} ${chalk.white(c.name)}`);
    console.log(chalk.gray(`      ${c.file}:${c.line}`));
  }

  console.log();
  console.log(chalk.gray(`Found ${potentiallyDead.length} potentially unused constants`));
  console.log();
}

/**
 * Export action - export constants to file
 */
async function exportAction(outputPath: string, options: ConstantsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'json';

  if (!(await constantsDataExists(rootDir))) {
    console.log(chalk.red('No constants data found. Run drift scan first.'));
    process.exit(1);
  }

  const store = new ConstantStore({ rootDir });

  let constants = await store.getAllConstants();
  const enums = await store.getAllEnums();

  // Apply filters
  if (options.category) {
    constants = constants.filter(c => c.category === options.category);
  }
  if (options.language) {
    constants = constants.filter(c => c.language === options.language);
  }

  let content: string;

  if (format === 'csv') {
    const lines = ['id,name,qualifiedName,file,line,language,kind,category,value,exported'];
    for (const c of constants) {
      const value = c.value !== undefined ? String(c.value).replace(/"/g, '""') : '';
      lines.push(`"${c.id}","${c.name}","${c.qualifiedName}","${c.file}",${c.line},"${c.language}","${c.kind}","${c.category}","${value}",${c.isExported}`);
    }
    content = lines.join('\n');
  } else {
    content = JSON.stringify({ constants, enums }, null, 2);
  }

  await fs.writeFile(outputPath, content, 'utf-8');
  console.log(chalk.green(`✓ Exported ${constants.length} constants to ${outputPath}`));
}

/**
 * Create the constants command with subcommands
 */
export const constantsCommand = new Command('constants')
  .description('Analyze constants, enums, and exported values')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(overviewAction);

// Subcommands
constantsCommand
  .command('list')
  .description('List all constants with filtering')
  .option('-f, --format <format>', 'Output format (text, json, csv)', 'text')
  .option('-c, --category <category>', 'Filter by category')
  .option('-l, --language <language>', 'Filter by language')
  .option('--file <path>', 'Filter by file path')
  .option('-s, --search <query>', 'Search by name')
  .option('--exported', 'Show only exported constants')
  .option('--limit <n>', 'Limit results', parseInt)
  .action(listAction);

constantsCommand
  .command('get <nameOrId>')
  .description('Show details for a specific constant or enum')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(getAction);

constantsCommand
  .command('secrets')
  .description('Show potential hardcoded secrets')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--severity <level>', 'Minimum severity (info, low, medium, high, critical)')
  .option('--limit <n>', 'Limit results', parseInt)
  .action(secretsAction);

constantsCommand
  .command('inconsistent')
  .description('Show constants with inconsistent values across files')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--limit <n>', 'Limit results', parseInt)
  .action(inconsistentAction);

constantsCommand
  .command('dead')
  .description('Show potentially unused constants')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--limit <n>', 'Limit results', parseInt)
  .action(deadAction);

constantsCommand
  .command('export <output>')
  .description('Export constants to file')
  .option('-f, --format <format>', 'Output format (json, csv)', 'json')
  .option('-c, --category <category>', 'Filter by category')
  .option('-l, --language <language>', 'Filter by language')
  .action(exportAction);
