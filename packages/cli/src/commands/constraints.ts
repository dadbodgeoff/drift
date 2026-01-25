/**
 * Constraints Command - drift constraints
 *
 * Manage architectural constraints learned from the codebase.
 * Constraints are invariants that MUST be satisfied by code.
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  createConstraintStore,
  createInvariantDetector,
  createConstraintSynthesizer,
  createConstraintVerifier,
  type Constraint,
  type ConstraintCategory,
  type VerificationResult,
} from 'driftdetect-core';
import { createSpinner } from '../ui/spinner.js';

export interface ConstraintsOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  category?: string;
  status?: string;
  limit?: number;
  minConfidence?: number;
}

const DRIFT_DIR = '.drift';
const CONSTRAINTS_DIR = 'constraints';

/**
 * Check if constraints exist
 */
async function constraintsExist(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, CONSTRAINTS_DIR, 'index.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when no constraints
 */
function showNoConstraintsMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No constraints found.'));
  console.log();
  console.log(chalk.gray('Extract constraints from your codebase:'));
  console.log();
  console.log(chalk.cyan('  drift constraints extract'));
  console.log();
}


/**
 * Extract subcommand - discover constraints from codebase
 */
async function extractAction(options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  if (isTextFormat) {
    console.log();
    console.log(chalk.bold('🔍 Extracting Constraints'));
    console.log(chalk.gray('═'.repeat(50)));
  }

  const spinner = isTextFormat ? createSpinner('Initializing...') : null;
  spinner?.start();

  try {

    // Initialize store
    spinner?.text('Loading constraint store...');
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    // Initialize detector
    spinner?.text('Initializing invariant detector...');
    const detector = createInvariantDetector({ rootDir });

    // Initialize synthesizer
    const synthesizer = createConstraintSynthesizer({ store, detector });

    // Extract constraints
    spinner?.text('Analyzing codebase for invariants...');
    const synthesisOptions: Parameters<typeof synthesizer.synthesize>[0] = {
      minConfidence: options.minConfidence ?? 0.85,
    };
    if (options.verbose) {
      synthesisOptions.includeViolationDetails = true;
    }
    if (options.category) {
      synthesisOptions.categories = [options.category as ConstraintCategory];
    }
    const result = await synthesizer.synthesize(synthesisOptions);

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Constraint extraction complete'));
    console.log();

    console.log(chalk.bold('📊 Results'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Discovered:   ${chalk.cyan.bold(result.discovered.length)}`);
    console.log(`  Updated:      ${chalk.cyan(result.updated.length)}`);
    console.log(`  Invalidated:  ${chalk.yellow(result.invalidated.length)}`);
    console.log(`  Time:         ${chalk.gray(result.stats.executionTimeMs + 'ms')}`);
    console.log();

    if (result.discovered.length > 0) {
      console.log(chalk.bold('🆕 New Constraints'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const c of result.discovered.slice(0, 10)) {
        formatConstraintBrief(c);
      }
      if (result.discovered.length > 10) {
        console.log(chalk.gray(`  ... and ${result.discovered.length - 10} more`));
      }
      console.log();
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift constraints list      ${chalk.white('View all constraints')}`));
    console.log(chalk.gray(`  • drift constraints approve   ${chalk.white('Approve a constraint')}`));
    console.log(chalk.gray(`  • drift constraints verify    ${chalk.white('Verify code against constraints')}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * List subcommand - show all constraints
 */
async function listAction(options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await constraintsExist(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No constraints found' }));
    } else {
      showNoConstraintsMessage();
    }
    return;
  }

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const queryOptions: Parameters<typeof store.query>[0] = {
      limit: options.limit ?? 50,
    };
    if (options.category) {
      queryOptions.category = options.category as ConstraintCategory;
    }
    if (options.status) {
      queryOptions.status = options.status as any;
    }
    if (options.minConfidence !== undefined) {
      queryOptions.minConfidence = options.minConfidence;
    }
    const result = store.query(queryOptions);

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('📋 Constraints'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (result.constraints.length === 0) {
      console.log(chalk.yellow('No constraints match the filters.'));
      console.log();
      return;
    }

    // Group by category
    const byCategory = new Map<string, Constraint[]>();
    for (const c of result.constraints) {
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }

    for (const [category, constraints] of byCategory) {
      console.log(chalk.bold(`${getCategoryIcon(category)} ${category.toUpperCase()}`));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const c of constraints) {
        formatConstraintBrief(c);
      }
      console.log();
    }

    console.log(chalk.gray(`Showing ${result.constraints.length} of ${result.total} constraints`));
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
 * Show subcommand - show constraint details
 */
async function showAction(id: string, options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const constraint = store.get(id);

    if (!constraint) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Constraint not found' }));
      } else {
        console.log(chalk.red(`Constraint not found: ${id}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(constraint, null, 2));
      return;
    }

    formatConstraintDetailed(constraint);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Approve subcommand - approve a constraint
 */
async function approveAction(id: string, options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const result = await store.approve(id);

    if (!result) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Constraint not found' }));
      } else {
        console.log(chalk.red(`Constraint not found: ${id}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, constraint: result }));
      return;
    }

    console.log();
    console.log(chalk.green(`✓ Approved: ${result.name}`));
    console.log(chalk.gray(`  ID: ${result.id}`));
    console.log(chalk.gray(`  Status: ${chalk.green('approved')}`));
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
 * Ignore subcommand - ignore a constraint
 */
async function ignoreAction(id: string, reason: string | undefined, options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const result = await store.ignore(id, reason);

    if (!result) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Constraint not found' }));
      } else {
        console.log(chalk.red(`Constraint not found: ${id}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, constraint: result }));
      return;
    }

    console.log();
    console.log(chalk.yellow(`✓ Ignored: ${result.name}`));
    console.log(chalk.gray(`  ID: ${result.id}`));
    if (reason) {
      console.log(chalk.gray(`  Reason: ${reason}`));
    }
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
 * Verify subcommand - verify a file against constraints
 */
async function verifyAction(file: string, options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Verifying...') : null;
  spinner?.start();

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const verifier = createConstraintVerifier({ rootDir, store });

    // Read file content
    const filePath = path.resolve(rootDir, file);
    const content = await fs.readFile(filePath, 'utf-8');

    const verifyOptions: Parameters<typeof verifier.verifyFile>[2] = {
      includeFixes: true,
    };
    if (options.category) {
      verifyOptions.categories = [options.category];
    }
    if (options.minConfidence !== undefined) {
      verifyOptions.minConfidence = options.minConfidence;
    }
    if (options.verbose) {
      verifyOptions.includeExamples = true;
    }

    const result = await verifier.verifyFile(file, content, verifyOptions);

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    formatVerificationResult(result);

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Check subcommand - verify all files against constraints
 */
async function checkAction(options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Checking codebase...') : null;
  spinner?.start();

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const verifier = createConstraintVerifier({ rootDir, store });

    // Find source files
    const files = await findSourceFiles(rootDir);
    
    let totalViolations = 0;
    let totalErrors = 0;
    let totalWarnings = 0;
    const fileResults: Array<{ file: string; result: VerificationResult }> = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(rootDir, file), 'utf-8');
        const verifyOptions: Parameters<typeof verifier.verifyFile>[2] = {};
        if (options.category) {
          verifyOptions.categories = [options.category];
        }
        if (options.minConfidence !== undefined) {
          verifyOptions.minConfidence = options.minConfidence;
        }
        const result = await verifier.verifyFile(file, content, verifyOptions);

        if (result.violations.length > 0) {
          fileResults.push({ file, result });
          totalViolations += result.violations.length;
          totalErrors += result.violations.filter(v => v.severity === 'error').length;
          totalWarnings += result.violations.filter(v => v.severity === 'warning').length;
        }
      } catch {
        // Skip files that can't be read
      }
    }

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        passed: totalViolations === 0,
        filesChecked: files.length,
        totalViolations,
        errors: totalErrors,
        warnings: totalWarnings,
        files: fileResults,
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔍 Constraint Check'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    console.log(`Files checked: ${chalk.cyan(files.length)}`);
    console.log();

    if (totalViolations === 0) {
      console.log(chalk.green.bold('✓ All constraints satisfied!'));
      console.log();
      return;
    }

    console.log(chalk.bold('Violations:'));
    console.log(`  ${chalk.red('Errors:')}   ${totalErrors}`);
    console.log(`  ${chalk.yellow('Warnings:')} ${totalWarnings}`);
    console.log();

    // Show violations by file
    for (const { file, result } of fileResults.slice(0, 10)) {
      console.log(chalk.bold(file));
      for (const v of result.violations.slice(0, 5)) {
        const icon = v.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
        console.log(`  ${icon} Line ${v.location.line}: ${v.message}`);
        console.log(chalk.gray(`    ${v.constraintName}`));
      }
      if (result.violations.length > 5) {
        console.log(chalk.gray(`    ... and ${result.violations.length - 5} more`));
      }
      console.log();
    }

    if (fileResults.length > 10) {
      console.log(chalk.gray(`... and ${fileResults.length - 10} more files with violations`));
    }

    // Exit with error if there are errors
    if (totalErrors > 0) {
      process.exit(1);
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Export subcommand - export constraints
 */
async function exportAction(output: string, options: ConstraintsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const store = createConstraintStore({ rootDir });
    await store.initialize();

    const constraints = store.getAll();

    // Filter if needed
    let filtered = constraints;
    if (options.category) {
      filtered = filtered.filter(c => c.category === options.category);
    }
    if (options.status) {
      filtered = filtered.filter(c => c.status === options.status);
    }

    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      constraints: filtered,
    };

    await fs.writeFile(output, JSON.stringify(exportData, null, 2));

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, count: filtered.length, output }));
    } else {
      console.log(chalk.green(`✓ Exported ${filtered.length} constraints to ${output}`));
    }

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

function formatConstraintBrief(c: Constraint): void {
  const statusIcon = getStatusIcon(c.status);
  const severityColor = c.enforcement.level === 'error' ? chalk.red :
                       c.enforcement.level === 'warning' ? chalk.yellow : chalk.gray;
  
  console.log(`  ${statusIcon} ${chalk.white(c.name)}`);
  console.log(chalk.gray(`    ${c.id}`));
  console.log(`    ${severityColor(c.enforcement.level)} | ${getConfidenceColor(c.confidence.score)} | ${c.confidence.evidence} evidence`);
}

function formatConstraintDetailed(c: Constraint): void {
  console.log();
  console.log(chalk.bold(`${getCategoryIcon(c.category)} ${c.name}`));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  console.log(chalk.bold('Details'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ID:          ${chalk.cyan(c.id)}`);
  console.log(`  Category:    ${c.category}`);
  console.log(`  Status:      ${getStatusIcon(c.status)} ${c.status}`);
  console.log(`  Language:    ${c.language}`);
  console.log(`  Enforcement: ${c.enforcement.level}`);
  console.log();

  console.log(chalk.bold('Description'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  ${c.description}`);
  console.log();

  console.log(chalk.bold('Invariant'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Type:      ${c.invariant.type}`);
  console.log(`  Condition: ${c.invariant.condition}`);
  console.log();

  console.log(chalk.bold('Confidence'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Score:      ${getConfidenceColor(c.confidence.score)}`);
  console.log(`  Evidence:   ${c.confidence.evidence} conforming instances`);
  console.log(`  Violations: ${c.confidence.violations} violations`);
  console.log();

  if (c.enforcement.guidance) {
    console.log(chalk.bold('Guidance'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  ${c.enforcement.guidance}`);
    console.log();
  }
}

function formatVerificationResult(result: VerificationResult): void {
  console.log();
  console.log(chalk.bold('🔍 Verification Result'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  if (result.passed) {
    console.log(chalk.green.bold('✓ All constraints satisfied'));
  } else {
    console.log(chalk.red.bold('✗ Constraint violations found'));
  }
  console.log();

  console.log(`  Checked:    ${result.metadata.constraintsChecked} constraints`);
  console.log(`  Satisfied:  ${chalk.green(result.satisfied.length)}`);
  console.log(`  Violations: ${chalk.red(result.violations.length)}`);
  console.log(`  Skipped:    ${chalk.gray(result.skipped.length)}`);
  console.log(`  Time:       ${result.metadata.executionTimeMs}ms`);
  console.log();

  if (result.violations.length > 0) {
    console.log(chalk.bold('Violations'));
    console.log(chalk.gray('─'.repeat(40)));
    
    for (const v of result.violations) {
      const icon = v.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
      console.log(`${icon} ${chalk.white(v.constraintName)}`);
      console.log(chalk.gray(`  Line ${v.location.line}: ${v.message}`));
      if (v.guidance) {
        console.log(chalk.cyan(`  → ${v.guidance}`));
      }
      console.log();
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getStatusIcon(status: string): string {
  switch (status) {
    case 'approved': return chalk.green('✓');
    case 'discovered': return chalk.blue('○');
    case 'ignored': return chalk.gray('⊘');
    case 'custom': return chalk.magenta('★');
    default: return '?';
  }
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    api: '🌐',
    auth: '🔐',
    data: '💾',
    error: '⚠️',
    test: '🧪',
    security: '🛡️',
    structural: '🏗️',
    performance: '⚡',
    logging: '📝',
    validation: '✅',
  };
  return icons[category] ?? '📋';
}

function getConfidenceColor(score: number): string {
  const percent = Math.round(score * 100);
  if (score >= 0.9) return chalk.green(`${percent}%`);
  if (score >= 0.7) return chalk.yellow(`${percent}%`);
  return chalk.red(`${percent}%`);
}

const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '.drift',
  '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.cs', '.php',
]);

async function findSourceFiles(rootDir: string, subDir = ''): Promise<string[]> {
  const files: string[] = [];
  const currentDir = path.join(rootDir, subDir);

  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const relativePath = path.join(subDir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await findSourceFiles(rootDir, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(relativePath);
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return files;
}

// ============================================================================
// Command Registration
// ============================================================================

export function createConstraintsCommand(): Command {
  const cmd = new Command('constraints')
    .description('Manage architectural constraints')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Enable verbose output');

  cmd
    .command('extract')
    .description('Extract constraints from codebase')
    .option('-c, --category <category>', 'Filter by category')
    .option('--min-confidence <number>', 'Minimum confidence threshold', '0.85')
    .action((opts) => extractAction({ ...cmd.opts(), ...opts } as ConstraintsOptions));

  cmd
    .command('list')
    .description('List all constraints')
    .option('-c, --category <category>', 'Filter by category')
    .option('-s, --status <status>', 'Filter by status (discovered, approved, ignored)')
    .option('-l, --limit <number>', 'Maximum results', '50')
    .option('--min-confidence <number>', 'Minimum confidence')
    .action((opts) => listAction({ ...cmd.opts(), ...opts } as ConstraintsOptions));

  cmd
    .command('show <id>')
    .description('Show constraint details')
    .action((id) => showAction(id, cmd.opts() as ConstraintsOptions));

  cmd
    .command('approve <id>')
    .description('Approve a discovered constraint')
    .action((id) => approveAction(id, cmd.opts() as ConstraintsOptions));

  cmd
    .command('ignore <id> [reason]')
    .description('Ignore a constraint')
    .action((id, reason) => ignoreAction(id, reason, cmd.opts() as ConstraintsOptions));

  cmd
    .command('verify <file>')
    .description('Verify a file against constraints')
    .option('-c, --category <category>', 'Filter by category')
    .option('--min-confidence <number>', 'Minimum confidence')
    .action((file, opts) => verifyAction(file, { ...cmd.opts(), ...opts } as ConstraintsOptions));

  cmd
    .command('check')
    .description('Check all files against constraints')
    .option('-c, --category <category>', 'Filter by category')
    .option('--min-confidence <number>', 'Minimum confidence')
    .action((opts) => checkAction({ ...cmd.opts(), ...opts } as ConstraintsOptions));

  cmd
    .command('export <output>')
    .description('Export constraints to JSON file')
    .option('-c, --category <category>', 'Filter by category')
    .option('-s, --status <status>', 'Filter by status')
    .action((output, opts) => exportAction(output, { ...cmd.opts(), ...opts } as ConstraintsOptions));

  return cmd;
}
