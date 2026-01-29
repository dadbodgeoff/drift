/**
 * Boundaries Command - drift boundaries
 *
 * Show data access boundaries and check for violations.
 * Tracks which code accesses which database tables/fields.
 *
 * @requirements Data Boundaries Feature
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createBoundaryStore,
  type BoundaryRules,
  type SensitiveField,
} from 'driftdetect-core';

export interface BoundariesOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for boundaries */
const BOUNDARIES_DIR = 'boundaries';

/** Rules file name */
const RULES_FILE = 'rules.json';

/**
 * Check if boundaries directory exists
 */
async function boundariesExist(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, BOUNDARIES_DIR));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when boundaries not initialized
 */
function showNotInitializedMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No data boundaries discovered yet.'));
  console.log();
  console.log(chalk.gray('Data boundaries track which code accesses which database tables.'));
  console.log(chalk.gray('Run a scan to discover data access patterns:'));
  console.log();
  console.log(chalk.cyan('  drift scan'));
  console.log();
}

/**
 * Overview subcommand - default view
 */
async function overviewAction(options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const accessMap = store.getAccessMap();
  const sensitiveFields = store.getSensitiveAccess();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      tables: accessMap.stats.totalTables,
      accessPoints: accessMap.stats.totalAccessPoints,
      sensitiveFields: accessMap.stats.totalSensitiveFields,
      models: accessMap.stats.totalModels,
      tableList: Object.keys(accessMap.tables),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🗄️  Data Boundaries'));
  console.log();

  // Summary stats
  console.log(`Tables Discovered: ${chalk.cyan(accessMap.stats.totalTables)}`);
  console.log(`Access Points: ${chalk.cyan(accessMap.stats.totalAccessPoints)}`);
  console.log(`Sensitive Fields: ${chalk.cyan(accessMap.stats.totalSensitiveFields)}`);
  console.log();

  // Top accessed tables
  const tableEntries = Object.entries(accessMap.tables)
    .map(([name, info]) => ({
      name,
      accessCount: info.accessedBy.length,
      fileCount: new Set(info.accessedBy.map(ap => ap.file)).size,
    }))
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, 5);

  if (tableEntries.length > 0) {
    console.log(chalk.bold('Top Accessed Tables:'));
    for (const table of tableEntries) {
      const name = table.name.padEnd(16);
      console.log(`  ${chalk.white(name)} ${chalk.gray(`${table.accessCount} access points (${table.fileCount} files)`)}`);
    }
    console.log();
  }

  // Sensitive field access
  if (sensitiveFields.length > 0) {
    console.log(chalk.bold('Sensitive Field Access:'));
    
    // Group by field name and count locations
    const fieldCounts = new Map<string, number>();
    for (const field of sensitiveFields) {
      const key = field.table ? `${field.table}.${field.field}` : field.field;
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    }

    const sortedFields = Array.from(fieldCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [fieldName, count] of sortedFields) {
      const name = fieldName.padEnd(24);
      console.log(`  ${chalk.yellow(name)} ${chalk.gray(`${count} locations`)}`);
    }
    console.log();
  }

  // Quick actions
  console.log(chalk.gray("Run 'drift boundaries table <name>' for details"));
  console.log();
}

/**
 * Tables subcommand - list all discovered tables
 */
async function tablesAction(options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found', tables: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const accessMap = store.getAccessMap();

  // JSON output
  if (format === 'json') {
    const tables = Object.entries(accessMap.tables).map(([name, info]) => ({
      name,
      model: info.model,
      fields: info.fields,
      accessCount: info.accessedBy.length,
      sensitiveFields: info.sensitiveFields.map(f => f.field),
    }));
    console.log(JSON.stringify({ tables }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🗄️  Discovered Tables'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  const tableEntries = Object.entries(accessMap.tables)
    .sort((a, b) => b[1].accessedBy.length - a[1].accessedBy.length);

  if (tableEntries.length === 0) {
    console.log(chalk.gray('  No tables discovered yet.'));
    console.log();
    return;
  }

  for (const [name, info] of tableEntries) {
    const fileCount = new Set(info.accessedBy.map(ap => ap.file)).size;
    const hasSensitive = info.sensitiveFields.length > 0;
    
    const tableName = hasSensitive ? chalk.yellow(name) : chalk.white(name);
    const modelInfo = info.model ? chalk.gray(` (${info.model})`) : '';
    
    console.log(`  ${tableName}${modelInfo}`);
    console.log(chalk.gray(`    ${info.accessedBy.length} access points in ${fileCount} files`));
    
    if (info.sensitiveFields.length > 0) {
      console.log(chalk.yellow(`    ⚠ ${info.sensitiveFields.length} sensitive fields`));
    }
    console.log();
  }
}

/**
 * Table subcommand - show access to specific table
 */
async function tableAction(tableName: string, options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const tableInfo = store.getTableAccess(tableName);

  if (!tableInfo) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Table '${tableName}' not found` }));
    } else {
      console.log();
      console.log(chalk.red(`Table '${tableName}' not found.`));
      console.log(chalk.gray("Run 'drift boundaries tables' to see all discovered tables."));
      console.log();
    }
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      name: tableInfo.name,
      model: tableInfo.model,
      fields: tableInfo.fields,
      sensitiveFields: tableInfo.sensitiveFields,
      accessPoints: tableInfo.accessedBy,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold(`🗄️  Table: ${tableName}`));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (tableInfo.model) {
    console.log(`Model: ${chalk.cyan(tableInfo.model)}`);
  }

  console.log(`Fields: ${chalk.gray(tableInfo.fields.join(', ') || 'none detected')}`);
  console.log(`Access Points: ${chalk.cyan(tableInfo.accessedBy.length)}`);
  console.log();

  // Sensitive fields
  if (tableInfo.sensitiveFields.length > 0) {
    console.log(chalk.bold.yellow('Sensitive Fields:'));
    for (const field of tableInfo.sensitiveFields) {
      console.log(`  ${chalk.yellow('⚠')} ${field.field} ${chalk.gray(`(${field.sensitivityType})`)}`);
    }
    console.log();
  }

  // Access points grouped by file
  const byFile = new Map<string, typeof tableInfo.accessedBy>();
  for (const ap of tableInfo.accessedBy) {
    if (!byFile.has(ap.file)) {
      byFile.set(ap.file, []);
    }
    byFile.get(ap.file)!.push(ap);
  }

  console.log(chalk.bold('Access Points:'));
  for (const [file, accessPoints] of byFile) {
    console.log(`  ${chalk.cyan(file)}`);
    for (const ap of accessPoints) {
      const opColor = ap.operation === 'write' ? chalk.yellow : 
                      ap.operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`    Line ${ap.line}: ${opColor(ap.operation)} ${chalk.gray(ap.fields.join(', ') || '')}`);
    }
  }
  console.log();
}

/**
 * File subcommand - show what data a file/pattern accesses
 */
async function fileAction(pattern: string, options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found', files: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const fileAccess = store.getFileAccess(pattern);

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({ files: fileAccess }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold(`📁 Data Access: ${pattern}`));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (fileAccess.length === 0) {
    console.log(chalk.gray(`  No data access found for pattern '${pattern}'.`));
    console.log();
    return;
  }

  for (const fileInfo of fileAccess) {
    console.log(chalk.cyan(fileInfo.file));
    console.log(`  Tables: ${chalk.white(fileInfo.tables.join(', '))}`);
    console.log(`  Access Points: ${fileInfo.accessPoints.length}`);
    
    for (const ap of fileInfo.accessPoints) {
      const opColor = ap.operation === 'write' ? chalk.yellow : 
                      ap.operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`    Line ${ap.line}: ${opColor(ap.operation)} ${chalk.white(ap.table)} ${chalk.gray(ap.fields.join(', '))}`);
    }
    console.log();
  }
}

/**
 * Sensitive subcommand - show all sensitive field access
 */
async function sensitiveAction(options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found', sensitiveFields: [] }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const sensitiveFields = store.getSensitiveAccess();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({ sensitiveFields }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔒 Sensitive Field Access'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (sensitiveFields.length === 0) {
    console.log(chalk.gray('  No sensitive fields detected.'));
    console.log();
    return;
  }

  // Group by sensitivity type
  const byType = new Map<string, SensitiveField[]>();
  for (const field of sensitiveFields) {
    const type = field.sensitivityType;
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(field);
  }

  const typeColors: Record<string, typeof chalk.red> = {
    pii: chalk.yellow,
    credentials: chalk.red,
    financial: chalk.magenta,
    health: chalk.cyan,
    unknown: chalk.gray,
  };

  for (const [type, fields] of byType) {
    const color = typeColors[type] ?? chalk.gray;
    console.log(color.bold(`${type.toUpperCase()} (${fields.length}):`));
    
    for (const field of fields) {
      const fieldName = field.table ? `${field.table}.${field.field}` : field.field;
      console.log(`  ${color('●')} ${chalk.white(fieldName)}`);
      console.log(chalk.gray(`    ${field.file}:${field.line}`));
    }
    console.log();
  }
}

/**
 * Check subcommand - check for boundary violations
 */
async function checkAction(options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await boundariesExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No boundaries data found' }));
    } else {
      showNotInitializedMessage();
    }
    return;
  }

  const store = createBoundaryStore({ rootDir });
  await store.initialize();

  const rules = store.getRules();

  if (!rules) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No rules.json found', violations: [] }));
    } else {
      console.log();
      console.log(chalk.yellow('⚠️  No boundary rules configured.'));
      console.log();
      console.log(chalk.gray('Create rules to enforce data access boundaries:'));
      console.log(chalk.cyan('  drift boundaries init-rules'));
      console.log();
    }
    return;
  }

  const violations = store.checkAllViolations();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      rulesCount: rules.boundaries.length,
      violations,
      violationCount: violations.length,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔍 Boundary Check'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  console.log(`Rules: ${chalk.cyan(rules.boundaries.length)}`);
  console.log(`Violations: ${violations.length > 0 ? chalk.red(violations.length) : chalk.green(0)}`);
  console.log();

  if (violations.length === 0) {
    console.log(chalk.green('✓ No boundary violations found.'));
    console.log();
    return;
  }

  // Group violations by severity
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');
  const infos = violations.filter(v => v.severity === 'info');

  if (errors.length > 0) {
    console.log(chalk.red.bold(`Errors (${errors.length}):`));
    for (const v of errors) {
      console.log(chalk.red(`  ✗ ${v.file}:${v.line}`));
      console.log(chalk.gray(`    ${v.message}`));
      if (v.suggestion) {
        console.log(chalk.gray(`    → ${v.suggestion}`));
      }
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold(`Warnings (${warnings.length}):`));
    for (const v of warnings) {
      console.log(chalk.yellow(`  ⚠ ${v.file}:${v.line}`));
      console.log(chalk.gray(`    ${v.message}`));
    }
    console.log();
  }

  if (infos.length > 0) {
    console.log(chalk.blue.bold(`Info (${infos.length}):`));
    for (const v of infos) {
      console.log(chalk.blue(`  ℹ ${v.file}:${v.line}`));
      console.log(chalk.gray(`    ${v.message}`));
    }
    console.log();
  }
}

/**
 * Init-rules subcommand - generate starter rules.json
 */
async function initRulesAction(options: BoundariesOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const rulesPath = path.join(rootDir, DRIFT_DIR, BOUNDARIES_DIR, RULES_FILE);

  // Check if rules already exist
  try {
    await fs.access(rulesPath);
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'rules.json already exists', path: rulesPath }));
    } else {
      console.log();
      console.log(chalk.yellow(`⚠️  ${rulesPath} already exists.`));
      console.log(chalk.gray('Delete it first if you want to regenerate.'));
      console.log();
    }
    return;
  } catch {
    // File doesn't exist, continue
  }

  // Ensure directory exists
  await fs.mkdir(path.join(rootDir, DRIFT_DIR, BOUNDARIES_DIR), { recursive: true });

  // Generate starter rules
  const starterRules: BoundaryRules = {
    version: '1.0',
    sensitivity: {
      critical: [
        'users.password_hash',
        'users.ssn',
        'payments.card_number',
      ],
      sensitive: [
        'users.email',
        'users.phone',
        'users.address',
      ],
      general: [],
    },
    boundaries: [
      {
        id: 'sensitive-data-access',
        description: 'Sensitive user data should only be accessed from user services',
        tables: ['users'],
        fields: ['users.email', 'users.phone', 'users.address'],
        allowedPaths: [
          '**/services/user*.ts',
          '**/services/user*.js',
          '**/repositories/user*.ts',
        ],
        excludePaths: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**'],
        severity: 'warning',
        enabled: true,
      },
      {
        id: 'credentials-access',
        description: 'Credentials should only be accessed from auth services',
        fields: ['users.password_hash', 'users.ssn'],
        allowedPaths: [
          '**/services/auth*.ts',
          '**/auth/**',
        ],
        excludePaths: ['**/*.test.ts', '**/*.spec.ts'],
        severity: 'error',
        enabled: true,
      },
      {
        id: 'payment-data-access',
        description: 'Payment data should only be accessed from payment services',
        tables: ['payments', 'transactions'],
        allowedPaths: [
          '**/services/payment*.ts',
          '**/services/billing*.ts',
          '**/payments/**',
        ],
        excludePaths: ['**/*.test.ts', '**/*.spec.ts'],
        severity: 'error',
        enabled: true,
      },
    ],
    globalExcludes: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts',
    ],
  };

  await fs.writeFile(rulesPath, JSON.stringify(starterRules, null, 2));

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({ success: true, path: rulesPath, rules: starterRules }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.green('✓ Created starter rules.json'));
  console.log();
  console.log(chalk.gray(`Location: ${rulesPath}`));
  console.log();
  console.log(chalk.bold('Included rules:'));
  for (const rule of starterRules.boundaries) {
    const severityColor = rule.severity === 'error' ? chalk.red : 
                          rule.severity === 'warning' ? chalk.yellow : chalk.blue;
    console.log(`  ${severityColor('●')} ${rule.id}`);
    console.log(chalk.gray(`    ${rule.description}`));
  }
  console.log();
  console.log(chalk.gray('Edit the rules.json file to customize boundaries for your project.'));
  console.log(chalk.gray("Then run 'drift boundaries check' to validate."));
  console.log();
}

/**
 * Create the boundaries command with subcommands
 */
export const boundariesCommand = new Command('boundaries')
  .description('Show data access boundaries and check for violations')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(overviewAction);

// Subcommands
boundariesCommand
  .command('tables')
  .description('List all discovered tables')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(tablesAction);

boundariesCommand
  .command('table <name>')
  .description('Show access to a specific table')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(tableAction);

boundariesCommand
  .command('file <pattern>')
  .description('Show what data a file or pattern accesses')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(fileAction);

boundariesCommand
  .command('sensitive')
  .description('Show all sensitive field access')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(sensitiveAction);

boundariesCommand
  .command('check')
  .description('Check for boundary violations (requires rules.json)')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(checkAction);

boundariesCommand
  .command('init-rules')
  .description('Generate a starter rules.json file')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(initRulesAction);
