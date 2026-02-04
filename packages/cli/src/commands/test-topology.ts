/**
 * Test Topology Command - drift test-topology
 *
 * Analyze test-to-code mappings, mock patterns, and test quality.
 * Answers: "Which tests cover this code?" and "What's the minimum test set?"
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createHybridTestTopologyAnalyzer,
  createCallGraphAnalyzer,
  type TestTopologySummary,
  type MockAnalysis,
  type MinimumTestSet,
  type UncoveredFunction,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface TestTopologyOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  limit?: number;
  minRisk?: 'low' | 'medium' | 'high';
}

const DRIFT_DIR = '.drift';
const TEST_TOPOLOGY_DIR = 'test-topology';

/**
 * Test file patterns (regex)
 */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.py$/,
  /test_.*\.py$/,
  /Test\.java$/,
  /Tests\.java$/,
  /Test\.cs$/,
  /Tests\.cs$/,
  /Test\.php$/,
];

/**
 * Directories to skip
 */
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '.drift',
  '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj',
]);

/**
 * Check if a filename matches test file patterns
 */
function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(filename));
}

/**
 * Recursively find test files
 */
async function findTestFiles(rootDir: string, subDir = ''): Promise<string[]> {
  const testFiles: string[] = [];
  const currentDir = path.join(rootDir, subDir);
  
  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {continue;}
      
      const relativePath = path.join(subDir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await findTestFiles(rootDir, relativePath);
        testFiles.push(...subFiles);
      } else if (entry.isFile() && isTestFile(entry.name)) {
        testFiles.push(relativePath);
      }
    }
  } catch {
    // Directory not readable, skip
  }
  
  return testFiles;
}

/**
 * Check if test topology data exists
 */
async function topologyExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when topology not built
 */
function showNotBuiltMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No test topology built yet.'));
  console.log();
  console.log(chalk.gray('Build test topology to analyze test coverage:'));
  console.log();
  console.log(chalk.cyan('  drift test-topology build'));
  console.log();
}

/**
 * Build subcommand - analyze test files and build mappings
 */
async function buildAction(options: TestTopologyOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  try {
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('🧪 Building Test Topology'));
      console.log(chalk.gray('═'.repeat(50)));
    }

    const spinner = isTextFormat ? createSpinner('Initializing...') : null;
    spinner?.start();

    // Initialize analyzer with available parsers
    spinner?.text('Loading parsers...');
    const analyzer = createHybridTestTopologyAnalyzer({});

    // Try to load call graph for transitive analysis
    spinner?.text('Loading call graph...');
    try {
      const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
      await callGraphAnalyzer.initialize();
      const graph = callGraphAnalyzer.getGraph();
      if (graph) {
        analyzer.setCallGraph(graph);
        if (isTextFormat) {
          spinner?.text('Call graph loaded for transitive analysis');
        }
      }
    } catch {
      if (isTextFormat) {
        spinner?.text('No call graph found, using direct analysis only');
      }
    }

    // Find test files
    spinner?.text('Finding test files...');
    const testFiles = await findTestFiles(rootDir);

    if (testFiles.length === 0) {
      spinner?.stop();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'No test files found' }));
      } else {
        console.log(chalk.yellow('\n⚠️  No test files found matching common patterns.'));
      }
      return;
    }

    // Extract tests from each file
    spinner?.text(`Extracting tests from ${testFiles.length} files...`);
    let extractedCount = 0;
    let errorCount = 0;

    for (const testFile of testFiles) {
      try {
        const content = await fs.readFile(path.join(rootDir, testFile), 'utf-8');
        const extraction = analyzer.extractFromFile(content, testFile);
        if (extraction) {
          extractedCount++;
        }
      } catch (err) {
        errorCount++;
        if (options.verbose) {
          console.error(`Error extracting ${testFile}:`, err);
        }
      }
    }

    // Build mappings
    spinner?.text('Building test-to-code mappings...');
    analyzer.buildMappings();

    // Get results
    const summary = analyzer.getSummary();
    const mockAnalysis = analyzer.analyzeMocks();

    // Save results
    spinner?.text('Saving results...');
    const topologyDir = path.join(rootDir, DRIFT_DIR, TEST_TOPOLOGY_DIR);
    await fs.mkdir(topologyDir, { recursive: true });

    await fs.writeFile(
      path.join(topologyDir, 'summary.json'),
      JSON.stringify({ summary, mockAnalysis, generatedAt: new Date().toISOString() }, null, 2)
    );

    // Save test files index for SQLite sync
    const testFilesIndex = testFiles.map(file => ({
      file,
      framework: 'unknown', // Framework detection would need per-file analysis
      testCount: 0,
      status: 'discovered',
    }));
    await fs.writeFile(
      path.join(topologyDir, 'index.json'),
      JSON.stringify({ testFiles: testFilesIndex, generatedAt: new Date().toISOString() }, null, 2)
    );

    // Generate coverage mappings if call graph is available
    // Coverage maps test files to source files they cover
    const coverageMappings: Array<{
      testFile: string;
      sourceFile: string;
      functionId?: string;
      coverageType: string;
      confidence: number;
    }> = [];
    
    // Get coverage for each source file from the call graph
    if (summary.totalFiles > 0) {
      // The analyzer tracks which tests cover which functions via buildMappings()
      // We can extract this from the summary
      for (const testFile of testFiles) {
        // Each test file potentially covers source files
        // This is a simplified mapping - full coverage would need per-function analysis
        coverageMappings.push({
          testFile,
          sourceFile: testFile.replace(/\.(test|spec)\.[jt]sx?$/, '.$1'),
          coverageType: 'unit',
          confidence: 0.8,
        });
      }
    }
    
    if (coverageMappings.length > 0) {
      await fs.writeFile(
        path.join(topologyDir, 'coverage.json'),
        JSON.stringify({ mappings: coverageMappings, generatedAt: new Date().toISOString() }, null, 2)
      );
    }

    spinner?.stop();

    // Output
    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        filesScanned: testFiles.length,
        filesExtracted: extractedCount,
        errors: errorCount,
        summary,
        mockAnalysis,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Test topology built successfully'));
    console.log();

    formatSummary(summary);
    formatMockAnalysis(mockAnalysis);

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift test-topology status     ${chalk.white('View test coverage summary')}`));
    console.log(chalk.gray(`  • drift test-topology uncovered  ${chalk.white('Find untested functions')}`));
    console.log(chalk.gray(`  • drift test-topology mocks      ${chalk.white('Analyze mock patterns')}`));
    console.log(chalk.gray(`  • drift test-topology affected   ${chalk.white('Get minimum test set for changes')}`));
    console.log();

    // Sync test topology data to SQLite
    try {
      const { createSyncService } = await import('driftdetect-core/storage');
      const syncService = createSyncService({ rootDir, verbose: false });
      await syncService.initialize();
      await syncService.syncTestTopology();
      await syncService.close();
      if (options.verbose) {
        console.log(chalk.gray('  Test topology synced to drift.db'));
      }
    } catch (syncError) {
      if (options.verbose) {
        console.log(chalk.yellow(`  Warning: Could not sync to SQLite: ${(syncError as Error).message}`));
      }
    }

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Status subcommand - show test topology overview
 */
async function statusAction(options: TestTopologyOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await topologyExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No test topology found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json'), 'utf-8')
    );

    if (format === 'json') {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🧪 Test Topology Status'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatSummary(data.summary);
    formatMockAnalysis(data.mockAnalysis);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Uncovered subcommand - find untested functions
 */
async function uncoveredAction(options: TestTopologyOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 20;
  const minRisk = options.minRisk ?? 'medium';

  const spinner = format === 'text' ? createSpinner('Analyzing uncovered functions...') : null;
  spinner?.start();

  try {
    // Re-run analysis to get uncovered functions
    const analyzer = createHybridTestTopologyAnalyzer({});

    // Load call graph
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    
    if (!graph) {
      spinner?.stop();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Call graph required for uncovered analysis' }));
      } else {
        console.log(chalk.yellow('\n⚠️  Call graph required. Run: drift callgraph build'));
      }
      return;
    }

    analyzer.setCallGraph(graph);

    // Extract tests
    const testFiles = await findTestFiles(rootDir);

    for (const testFile of testFiles) {
      try {
        const content = await fs.readFile(path.join(rootDir, testFile), 'utf-8');
        analyzer.extractFromFile(content, testFile);
      } catch {
        // Skip files that can't be read
      }
    }

    analyzer.buildMappings();

    const uncovered = analyzer.getUncoveredFunctions({
      minRisk,
      limit,
      includeReasons: true,
    });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ uncovered }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔍 Uncovered Functions'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (uncovered.length === 0) {
      console.log(chalk.green('✓ All functions have test coverage!'));
      console.log();
      return;
    }

    formatUncoveredFunctions(uncovered);

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
 * Mocks subcommand - analyze mock patterns
 */
async function mocksAction(options: TestTopologyOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await topologyExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No test topology found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json'), 'utf-8')
    );

    if (format === 'json') {
      console.log(JSON.stringify({ mockAnalysis: data.mockAnalysis }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🎭 Mock Analysis'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatMockAnalysisDetailed(data.mockAnalysis);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Affected subcommand - get minimum test set for changed files
 */
async function affectedAction(files: string[], options: TestTopologyOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (files.length === 0) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No files specified' }));
    } else {
      console.log(chalk.yellow('Usage: drift test-topology affected <file1> [file2] ...'));
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Calculating affected tests...') : null;
  spinner?.start();

  try {
    const analyzer = createHybridTestTopologyAnalyzer({});

    // Load call graph
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    
    if (graph) {
      analyzer.setCallGraph(graph);
    }

    // Extract tests
    const testFiles = await findTestFiles(rootDir);

    for (const testFile of testFiles) {
      try {
        const content = await fs.readFile(path.join(rootDir, testFile), 'utf-8');
        analyzer.extractFromFile(content, testFile);
      } catch {
        // Skip
      }
    }

    analyzer.buildMappings();

    const result = analyzer.getMinimumTestSet(files);

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🎯 Minimum Test Set'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatMinimumTestSet(result, files);

  } catch (error) {
    spinner?.stop();
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

function formatSummary(summary: TestTopologySummary): void {
  console.log(chalk.bold('📊 Test Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Test Files:      ${chalk.cyan.bold(summary.testFiles)}`);
  console.log(`  Test Cases:      ${chalk.cyan.bold(summary.testCases)}`);
  console.log(`  Avg Quality:     ${getQualityColor(summary.avgQualityScore)}`);
  console.log();

  if (summary.totalFiles > 0) {
    console.log(chalk.bold('📈 Coverage'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Files:     ${chalk.cyan(summary.coveredFiles)}/${summary.totalFiles} (${getCoverageColor(summary.coveragePercent)})`);
    console.log(`  Functions: ${chalk.cyan(summary.coveredFunctions)}/${summary.totalFunctions} (${getCoverageColor(summary.functionCoveragePercent)})`);
    console.log();
  }

  // Framework breakdown
  const frameworks = Object.entries(summary.byFramework)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (frameworks.length > 0) {
    console.log(chalk.bold('🔧 By Framework'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const [framework, count] of frameworks) {
      const icon = getFrameworkIcon(framework);
      console.log(`  ${icon} ${framework.padEnd(12)} ${chalk.cyan(count)} tests`);
    }
    console.log();
  }
}

function formatMockAnalysis(analysis: MockAnalysis): void {
  if (analysis.totalMocks === 0) {return;}

  console.log(chalk.bold('🎭 Mock Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Total Mocks:     ${chalk.cyan(analysis.totalMocks)}`);
  console.log(`  External:        ${chalk.green(analysis.externalMocks)} (${analysis.externalPercent}%)`);
  console.log(`  Internal:        ${chalk.yellow(analysis.internalMocks)} (${analysis.internalPercent}%)`);
  console.log(`  Avg Mock Ratio:  ${getMockRatioColor(analysis.avgMockRatio)}`);
  console.log();
}

function formatMockAnalysisDetailed(analysis: MockAnalysis): void {
  formatMockAnalysis(analysis);

  if (analysis.topMockedModules.length > 0) {
    console.log(chalk.bold('📦 Most Mocked Modules'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const { module, count } of analysis.topMockedModules.slice(0, 10)) {
      const bar = '█'.repeat(Math.min(20, Math.ceil(count / analysis.topMockedModules[0]!.count * 20)));
      console.log(`  ${module.padEnd(25)} ${chalk.cyan(bar)} ${count}`);
    }
    console.log();
  }

  if (analysis.highMockRatioTests.length > 0) {
    console.log(chalk.bold.yellow('⚠️  High Mock Ratio Tests'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const { file, testName, mockRatio } of analysis.highMockRatioTests.slice(0, 10)) {
      console.log(`  ${chalk.yellow('●')} ${testName}`);
      console.log(chalk.gray(`    ${file} (${Math.round(mockRatio * 100)}% mocked)`));
    }
    console.log();
  }
}

function formatUncoveredFunctions(uncovered: UncoveredFunction[]): void {
  for (const func of uncovered) {
    // Skip __module__ entries - they're not useful for test coverage
    if (func.qualifiedName === '__module__') {continue;}
    
    const riskColor = func.riskScore >= 60 ? chalk.red : 
                     func.riskScore >= 30 ? chalk.yellow : chalk.gray;
    
    console.log(`${riskColor('●')} ${chalk.white(func.qualifiedName)}`);
    console.log(chalk.gray(`  ${func.file}:${func.line}`));
    console.log(`  Risk: ${riskColor(func.riskScore + '/100')}`);
    
    if (func.isEntryPoint) {
      console.log(chalk.magenta('  🚪 Entry point'));
    }
    if (func.accessesSensitiveData) {
      console.log(chalk.yellow('  💾 Accesses data'));
    }
    if (func.possibleReasons.length > 0) {
      console.log(chalk.gray(`  Possible reasons: ${func.possibleReasons.join(', ')}`));
    }
    console.log();
  }
}

function formatMinimumTestSet(result: MinimumTestSet, changedFiles: string[]): void {
  console.log(`Changed Files: ${chalk.cyan(changedFiles.length)}`);
  console.log(`Changed Code Coverage: ${getCoverageColor(result.changedCodeCoverage)}`);
  console.log();

  console.log(`Tests to Run: ${chalk.cyan.bold(result.selectedTests)}/${result.totalTests}`);
  console.log(`Time Saved: ${chalk.green('~' + result.timeSaved)}`);
  console.log();

  if (result.tests.length > 0) {
    console.log(chalk.bold('Selected Tests:'));
    for (const test of result.tests.slice(0, 20)) {
      console.log(`  ${chalk.green('✓')} ${test.name}`);
      console.log(chalk.gray(`    ${test.file}`));
    }
    if (result.tests.length > 20) {
      console.log(chalk.gray(`  ... and ${result.tests.length - 20} more`));
    }
  } else {
    console.log(chalk.yellow('No tests found covering the changed files.'));
  }
  console.log();
}

// ============================================================================
// Helpers
// ============================================================================

function getQualityColor(score: number): string {
  if (score >= 70) {return chalk.green(`${score}/100`);}
  if (score >= 50) {return chalk.yellow(`${score}/100`);}
  return chalk.red(`${score}/100`);
}

function getCoverageColor(percent: number): string {
  if (percent >= 80) {return chalk.green(`${percent}%`);}
  if (percent >= 50) {return chalk.yellow(`${percent}%`);}
  return chalk.red(`${percent}%`);
}

function getMockRatioColor(ratio: number): string {
  if (ratio <= 0.3) {return chalk.green(`${Math.round(ratio * 100)}%`);}
  if (ratio <= 0.5) {return chalk.yellow(`${Math.round(ratio * 100)}%`);}
  return chalk.red(`${Math.round(ratio * 100)}%`);
}

function getFrameworkIcon(framework: string): string {
  const icons: Record<string, string> = {
    jest: '🃏',
    vitest: '⚡',
    mocha: '☕',
    pytest: '🐍',
    unittest: '🐍',
    junit4: '☕',
    junit5: '☕',
    testng: '☕',
    xunit: '🟣',
    nunit: '🟣',
    mstest: '🟣',
    phpunit: '🐘',
    pest: '🐘',
  };
  return icons[framework] ?? '📋';
}

// ============================================================================
// Command Registration
// ============================================================================

export function createTestTopologyCommand(): Command {
  const cmd = new Command('test-topology')
    .description('Analyze test-to-code mappings and test quality')
    .option('-f, --format <format>', 'Output format (text, json)', 'text');

  const buildCmd = cmd
    .command('build')
    .description('Build test topology from test files')
    .option('--verbose', 'Enable verbose output')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .action(() => {
      const opts = buildCmd.opts();
      buildAction(opts);
    });

  cmd
    .command('status')
    .description('Show test topology overview')
    .action(() => statusAction(cmd.opts()));

  cmd
    .command('uncovered')
    .description('Find functions without test coverage')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .option('-r, --min-risk <level>', 'Minimum risk level (low, medium, high)', 'medium')
    .action((opts) => uncoveredAction({ ...cmd.opts(), ...opts } as TestTopologyOptions));

  cmd
    .command('mocks')
    .description('Analyze mock patterns')
    .action(() => mocksAction(cmd.opts()));

  cmd
    .command('affected <files...>')
    .description('Get minimum test set for changed files')
    .action((files) => affectedAction(files, cmd.opts()));

  return cmd;
}
