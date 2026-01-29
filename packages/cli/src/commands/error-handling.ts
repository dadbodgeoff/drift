/**
 * Error Handling Command - drift error-handling
 *
 * Analyze error handling patterns, detect gaps, and find unhandled error paths.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createErrorHandlingAnalyzer,
  createCallGraphAnalyzer,
  isNativeAvailable,
  analyzeErrorHandlingWithFallback,
  type ErrorHandlingSummary,
  type ErrorHandlingGap,
  type ErrorBoundary,
  type UnhandledErrorPath,
  type FunctionErrorAnalysis,
  type ErrorSeverity,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface ErrorHandlingOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  limit?: number;
  minSeverity?: ErrorSeverity;
}

const DRIFT_DIR = '.drift';
const ERROR_HANDLING_DIR = 'error-handling';

/**
 * Check if error handling data exists
 */
async function dataExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when data not built
 */
function showNotBuiltMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No error handling analysis built yet.'));
  console.log();
  console.log(chalk.gray('Build error handling analysis:'));
  console.log();
  console.log(chalk.cyan('  drift error-handling build'));
  console.log();
}

/**
 * Build subcommand - analyze error handling patterns
 */
async function buildAction(options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const verbose = options.verbose ?? false;
  const isTextFormat = format === 'text';

  try {
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('🛡️  Building Error Handling Analysis'));
      console.log(chalk.gray('═'.repeat(50)));
    }

    const spinner = isTextFormat ? createSpinner('Initializing...') : null;
    spinner?.start();

    // Try native analyzer first (much faster)
    if (isNativeAvailable()) {
      try {
        spinner?.text('Analyzing error handling patterns (native)...');
        
        // Get file list
        const files = await getSourceFiles(rootDir);
        const nativeResult = await analyzeErrorHandlingWithFallback(rootDir, files);
        
        // Save results
        spinner?.text('Saving results...');
        const errorDir = path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR);
        await fs.mkdir(errorDir, { recursive: true });
        
        // Convert native result to topology format
        const topology = {
          functions: {},
          boundaries: nativeResult.boundaries,
          unhandledPaths: [],
          propagationChains: [],
          generatedAt: new Date().toISOString(),
          projectRoot: rootDir,
        };
        
        const summary: ErrorHandlingSummary = {
          totalFunctions: nativeResult.filesAnalyzed,
          coveragePercent: nativeResult.boundaries.length > 0 ? 50 : 0,
          avgQuality: 70,
          unhandledPaths: nativeResult.gaps.length,
          criticalUnhandled: nativeResult.gaps.filter(g => g.severity === 'critical').length,
          qualityDistribution: {
            excellent: 0,
            good: nativeResult.boundaries.length,
            fair: 0,
            poor: nativeResult.gaps.length,
          },
          topIssues: nativeResult.gaps.slice(0, 5).map(g => ({
            type: (g.gapType === 'swallowed-error' ? 'swallowed' : 
                   g.gapType === 'unhandled-async' ? 'unhandled-async' :
                   g.gapType === 'missing-boundary' ? 'no-boundary' :
                   g.gapType === 'bare-catch' ? 'bare-catch' : 'swallowed'),
            count: 1,
            severity: g.severity as ErrorSeverity,
          })),
        };
        
        const metrics = {
          functionsWithTryCatch: nativeResult.boundaries.length,
          functionsThatThrow: nativeResult.gaps.length,
          boundaryCount: nativeResult.boundaries.length,
          frameworkBoundaries: nativeResult.boundaries.filter(b => b.boundaryType !== 'try-catch').length,
          swallowedErrorCount: nativeResult.boundaries.filter(b => b.isSwallowed).length,
          unhandledAsyncCount: nativeResult.gaps.filter(g => g.gapType === 'unhandled-async').length,
        };
        
        await fs.writeFile(
          path.join(errorDir, 'topology.json'),
          JSON.stringify({ topology, summary, metrics }, null, 2)
        );
        
        spinner?.stop();
        
        // Output
        if (format === 'json') {
          console.log(JSON.stringify({
            success: true,
            native: true,
            boundaries: nativeResult.boundaries.length,
            gaps: nativeResult.gaps.length,
            filesAnalyzed: nativeResult.filesAnalyzed,
            durationMs: nativeResult.durationMs,
          }, null, 2));
          return;
        }
        
        // Text output
        console.log();
        console.log(chalk.green.bold('✓ Error handling analysis built successfully (native)'));
        console.log();
        console.log(`Files analyzed: ${chalk.cyan(nativeResult.filesAnalyzed)}`);
        console.log(`Error boundaries: ${chalk.cyan(nativeResult.boundaries.length)}`);
        console.log(`Gaps found: ${chalk.yellow(nativeResult.gaps.length)}`);
        console.log(`Duration: ${chalk.gray(`${nativeResult.durationMs}ms`)}`);
        console.log();
        
        if (summary) {
          formatSummary(summary);
        }
        
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.bold('📌 Next Steps:'));
        console.log(chalk.gray(`  • drift error-handling status     ${chalk.white('View error handling overview')}`));
        console.log(chalk.gray(`  • drift error-handling gaps       ${chalk.white('Find error handling gaps')}`));
        console.log(chalk.gray(`  • drift error-handling boundaries ${chalk.white('List error boundaries')}`));
        console.log();
        return;
        
      } catch (nativeError) {
        if (verbose) {
          spinner?.text(chalk.gray(`Native analyzer failed, using TypeScript fallback: ${(nativeError as Error).message}`));
        }
        // Fall through to TypeScript implementation
      }
    }

    // TypeScript fallback
    // Load call graph (required)
    spinner?.text('Loading call graph...');
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const callGraph = callGraphAnalyzer.getGraph();

    if (!callGraph) {
      spinner?.stop();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Call graph required. Run: drift callgraph build' }));
      } else {
        console.log(chalk.yellow('\n⚠️  Call graph required. Run: drift callgraph build'));
      }
      return;
    }

    // Initialize error handling analyzer
    spinner?.text('Analyzing error handling patterns...');
    const analyzer = createErrorHandlingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);

    // Build the topology
    spinner?.text('Building error handling topology...');
    const topology = analyzer.build();

    // Get summary
    const summary = analyzer.getSummary();
    const metrics = analyzer.getMetrics();

    // Save results
    spinner?.text('Saving results...');
    const errorDir = path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR);
    await fs.mkdir(errorDir, { recursive: true });

    // Serialize the topology (convert Map to object)
    const serializedTopology = {
      functions: Object.fromEntries(topology.functions),
      boundaries: topology.boundaries,
      unhandledPaths: topology.unhandledPaths,
      propagationChains: topology.propagationChains,
      generatedAt: topology.generatedAt,
      projectRoot: topology.projectRoot,
    };

    await fs.writeFile(
      path.join(errorDir, 'topology.json'),
      JSON.stringify({ topology: serializedTopology, summary, metrics }, null, 2)
    );

    spinner?.stop();

    // Output
    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        functions: topology.functions.size,
        boundaries: topology.boundaries.length,
        unhandledPaths: topology.unhandledPaths.length,
        summary,
        metrics,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Error handling analysis built successfully'));
    console.log();

    if (summary) {
      formatSummary(summary);
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift error-handling status     ${chalk.white('View error handling overview')}`));
    console.log(chalk.gray(`  • drift error-handling gaps       ${chalk.white('Find error handling gaps')}`));
    console.log(chalk.gray(`  • drift error-handling boundaries ${chalk.white('List error boundaries')}`));
    console.log(chalk.gray(`  • drift error-handling unhandled  ${chalk.white('Find unhandled error paths')}`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
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
 * Status subcommand - show error handling overview
 */
async function statusAction(options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await dataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No error handling analysis found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json'), 'utf-8')
    );

    if (format === 'json') {
      console.log(JSON.stringify({ summary: data.summary, metrics: data.metrics }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🛡️  Error Handling Status'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatSummary(data.summary);
    formatMetrics(data.metrics);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Gaps subcommand - find error handling gaps
 */
async function gapsAction(options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 20;
  const minSeverity = options.minSeverity ?? 'medium';

  const spinner = format === 'text' ? createSpinner('Finding error handling gaps...') : null;
  spinner?.start();

  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const callGraph = callGraphAnalyzer.getGraph();

    if (!callGraph) {
      spinner?.stop();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Call graph required' }));
      } else {
        console.log(chalk.yellow('\n⚠️  Call graph required. Run: drift callgraph build'));
      }
      return;
    }

    const analyzer = createErrorHandlingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);
    analyzer.build();

    const gaps = analyzer.getGaps({ limit, minSeverity, includeSuggestions: true });

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ gaps, total: gaps.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔍 Error Handling Gaps'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (gaps.length === 0) {
      console.log(chalk.green('✓ No error handling gaps found!'));
      console.log();
      return;
    }

    formatGaps(gaps);

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
 * Boundaries subcommand - list error boundaries
 */
async function boundariesAction(options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await dataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No error handling analysis found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json'), 'utf-8')
    );

    const boundaries: ErrorBoundary[] = data.topology.boundaries;

    if (format === 'json') {
      console.log(JSON.stringify({ boundaries, total: boundaries.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🛡️  Error Boundaries'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (boundaries.length === 0) {
      console.log(chalk.yellow('⚠️  No error boundaries found.'));
      console.log(chalk.gray('Consider adding try/catch blocks to protect critical paths.'));
      console.log();
      return;
    }

    formatBoundaries(boundaries);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Unhandled subcommand - find unhandled error paths
 */
async function unhandledAction(options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const minSeverity = options.minSeverity ?? 'medium';

  if (!(await dataExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No error handling analysis found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, ERROR_HANDLING_DIR, 'topology.json'), 'utf-8')
    );

    let paths: UnhandledErrorPath[] = data.topology.unhandledPaths;

    // Filter by severity
    const severityOrder: Record<ErrorSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const minOrder = severityOrder[minSeverity];
    paths = paths.filter(p => severityOrder[p.severity] <= minOrder);

    if (format === 'json') {
      console.log(JSON.stringify({ paths, total: paths.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('⚠️  Unhandled Error Paths'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (paths.length === 0) {
      console.log(chalk.green('✓ No unhandled error paths found!'));
      console.log();
      return;
    }

    formatUnhandledPaths(paths);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Analyze subcommand - analyze specific function
 */
async function analyzeAction(funcPath: string, options: ErrorHandlingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Analyzing function...') : null;
  spinner?.start();

  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const callGraph = callGraphAnalyzer.getGraph();

    if (!callGraph) {
      spinner?.stop();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Call graph required' }));
      } else {
        console.log(chalk.yellow('\n⚠️  Call graph required. Run: drift callgraph build'));
      }
      return;
    }

    const analyzer = createErrorHandlingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);
    analyzer.build();

    const analysis = analyzer.getFunctionAnalysis(funcPath);

    spinner?.stop();

    if (!analysis) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: `Function not found: ${funcPath}` }));
      } else {
        console.log(chalk.yellow(`\n⚠️  Function not found: ${funcPath}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`🔍 Function Analysis: ${funcPath}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatFunctionAnalysis(analysis);

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

function formatSummary(summary: ErrorHandlingSummary): void {
  console.log(chalk.bold('📊 Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Functions:       ${chalk.cyan.bold(summary.totalFunctions)}`);
  console.log(`  Coverage:        ${getCoverageColor(summary.coveragePercent)}`);
  console.log(`  Avg Quality:     ${getQualityColor(summary.avgQuality)}`);
  console.log(`  Unhandled Paths: ${getUnhandledColor(summary.unhandledPaths)}`);
  if (summary.criticalUnhandled > 0) {
    console.log(`  Critical:        ${chalk.red.bold(summary.criticalUnhandled)}`);
  }
  console.log();

  // Quality distribution
  console.log(chalk.bold('📈 Quality Distribution'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  ${chalk.green('●')} Excellent: ${summary.qualityDistribution.excellent}`);
  console.log(`  ${chalk.cyan('●')} Good:      ${summary.qualityDistribution.good}`);
  console.log(`  ${chalk.yellow('●')} Fair:      ${summary.qualityDistribution.fair}`);
  console.log(`  ${chalk.red('●')} Poor:      ${summary.qualityDistribution.poor}`);
  console.log();

  // Top issues
  if (summary.topIssues.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Top Issues'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const issue of summary.topIssues) {
      const icon = getSeverityIcon(issue.severity);
      const label = getIssueLabel(issue.type);
      console.log(`  ${icon} ${label}: ${chalk.bold(issue.count)}`);
    }
    console.log();
  }
}

function formatMetrics(metrics: any): void {
  console.log(chalk.bold('📊 Detailed Metrics'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  With try/catch:     ${chalk.cyan(metrics.functionsWithTryCatch)}`);
  console.log(`  Can throw:          ${chalk.cyan(metrics.functionsThatThrow)}`);
  console.log(`  Error boundaries:   ${chalk.cyan(metrics.boundaryCount)}`);
  console.log(`  Framework bounds:   ${chalk.cyan(metrics.frameworkBoundaries)}`);
  console.log(`  Swallowed errors:   ${metrics.swallowedErrorCount > 0 ? chalk.yellow(metrics.swallowedErrorCount) : chalk.green('0')}`);
  console.log(`  Unhandled async:    ${metrics.unhandledAsyncCount > 0 ? chalk.yellow(metrics.unhandledAsyncCount) : chalk.green('0')}`);
  console.log();
}

function formatGaps(gaps: ErrorHandlingGap[]): void {
  for (const gap of gaps) {
    const icon = getSeverityIcon(gap.severity);
    const riskColor = gap.riskScore >= 70 ? chalk.red : gap.riskScore >= 50 ? chalk.yellow : chalk.gray;

    console.log(`${icon} ${chalk.white(gap.name)}`);
    console.log(chalk.gray(`  ${gap.file}:${gap.line}`));
    console.log(`  Type: ${getGapTypeLabel(gap.gapType)}`);
    console.log(`  Risk: ${riskColor(gap.riskScore + '/100')}`);
    console.log(chalk.gray(`  ${gap.description}`));
    if (gap.suggestion) {
      console.log(chalk.cyan(`  → ${gap.suggestion}`));
    }
    console.log();
  }
}

function formatBoundaries(boundaries: ErrorBoundary[]): void {
  for (const boundary of boundaries) {
    const icon = boundary.isFrameworkBoundary ? '🏗️' : '🛡️';
    const coverageColor = boundary.coverage >= 80 ? chalk.green : 
                         boundary.coverage >= 50 ? chalk.yellow : chalk.red;

    console.log(`${icon} ${chalk.white(boundary.name)}`);
    console.log(chalk.gray(`  ${boundary.file}:${boundary.line}`));
    console.log(`  Coverage: ${coverageColor(boundary.coverage + '%')}`);
    console.log(`  Catches from: ${chalk.cyan(boundary.catchesFrom.length)} functions`);
    console.log(`  Handles: ${boundary.handledTypes.join(', ') || 'all errors'}`);
    if (boundary.frameworkType) {
      console.log(chalk.magenta(`  Framework: ${boundary.frameworkType}`));
    }
    console.log();
  }
}

function formatUnhandledPaths(paths: UnhandledErrorPath[]): void {
  for (const path of paths) {
    const icon = getSeverityIcon(path.severity);

    console.log(`${icon} ${chalk.white(path.entryPoint)}`);
    console.log(chalk.gray(`  ${path.reason}`));
    console.log(`  Path length: ${chalk.cyan(path.path.length)} functions`);
    console.log(`  Error type: ${path.errorType}`);
    console.log(chalk.cyan(`  → Suggested boundary: ${path.suggestedBoundary}`));
    console.log();
  }
}

function formatFunctionAnalysis(analysis: FunctionErrorAnalysis): void {
  const { profile, incomingErrors, outgoingErrors, isProtected, issues, suggestions } = analysis;

  // Profile
  console.log(chalk.bold('Function Info'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Has try/catch: ${profile.hasTryCatch ? chalk.green('Yes') : chalk.red('No')}`);
  console.log(`  Can throw:     ${profile.canThrow ? chalk.yellow('Yes') : chalk.green('No')}`);
  console.log(`  Is async:      ${profile.isAsync ? 'Yes' : 'No'}`);
  console.log(`  Quality:       ${getQualityColor(profile.qualityScore)}`);
  console.log(`  Protected:     ${isProtected ? chalk.green('Yes') : chalk.yellow('No')}`);
  console.log();

  // Catch clauses
  if (profile.catchClauses.length > 0) {
    console.log(chalk.bold('Catch Clauses'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const clause of profile.catchClauses) {
      const actionColor = clause.action === 'swallow' ? chalk.red :
                         clause.action === 'rethrow' ? chalk.yellow :
                         clause.action === 'recover' ? chalk.green : chalk.gray;
      console.log(`  Line ${clause.line}: catches ${clause.errorType} → ${actionColor(clause.action)}`);
    }
    console.log();
  }

  // Error flow
  if (incomingErrors.length > 0) {
    console.log(chalk.bold('Incoming Errors'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const err of incomingErrors.slice(0, 5)) {
      console.log(`  ← ${err.from} (${err.errorType})`);
    }
    if (incomingErrors.length > 5) {
      console.log(chalk.gray(`  ... and ${incomingErrors.length - 5} more`));
    }
    console.log();
  }

  if (outgoingErrors.length > 0) {
    console.log(chalk.bold('Outgoing Errors'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const err of outgoingErrors.slice(0, 5)) {
      const status = err.caught ? chalk.green('caught') : chalk.red('uncaught');
      console.log(`  → ${err.to} (${status})`);
    }
    if (outgoingErrors.length > 5) {
      console.log(chalk.gray(`  ... and ${outgoingErrors.length - 5} more`));
    }
    console.log();
  }

  // Issues
  if (issues.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Issues'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const issue of issues) {
      const icon = getSeverityIcon(issue.severity);
      console.log(`  ${icon} ${issue.message}`);
    }
    console.log();
  }

  // Suggestions
  if (suggestions.length > 0) {
    console.log(chalk.bold('💡 Suggestions'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const suggestion of suggestions) {
      console.log(`  ${chalk.cyan('→')} ${suggestion}`);
    }
    console.log();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getCoverageColor(percent: number): string {
  if (percent >= 80) {return chalk.green(`${percent}%`);}
  if (percent >= 50) {return chalk.yellow(`${percent}%`);}
  return chalk.red(`${percent}%`);
}

function getQualityColor(score: number): string {
  if (score >= 70) {return chalk.green(`${score}/100`);}
  if (score >= 50) {return chalk.yellow(`${score}/100`);}
  return chalk.red(`${score}/100`);
}

function getUnhandledColor(count: number): string {
  if (count === 0) {return chalk.green.bold('0');}
  if (count <= 5) {return chalk.yellow.bold(String(count));}
  return chalk.red.bold(String(count));
}

function getSeverityIcon(severity: ErrorSeverity): string {
  switch (severity) {
    case 'critical': return chalk.red('🔴');
    case 'high': return chalk.yellow('🟡');
    case 'medium': return chalk.cyan('🔵');
    case 'low': return chalk.gray('⚪');
  }
}

function getIssueLabel(type: string): string {
  switch (type) {
    case 'swallowed': return 'Swallowed errors';
    case 'unhandled-async': return 'Unhandled async';
    case 'no-boundary': return 'Missing boundaries';
    case 'bare-catch': return 'Bare catch clauses';
    default: return type;
  }
}

function getGapTypeLabel(type: string): string {
  switch (type) {
    case 'no-try-catch': return chalk.red('No error handling');
    case 'swallowed-error': return chalk.yellow('Swallowed error');
    case 'unhandled-async': return chalk.yellow('Unhandled async');
    case 'bare-catch': return chalk.gray('Bare catch');
    case 'missing-boundary': return chalk.red('Missing boundary');
    default: return type;
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function createErrorHandlingCommand(): Command {
  const cmd = new Command('error-handling')
    .description('Analyze error handling patterns and gaps')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Enable verbose output');

  cmd
    .command('build')
    .description('Build error handling analysis')
    .action(() => buildAction(cmd.opts()));

  cmd
    .command('status')
    .description('Show error handling overview')
    .action(() => statusAction(cmd.opts()));

  cmd
    .command('gaps')
    .description('Find error handling gaps')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .option('-s, --min-severity <level>', 'Minimum severity (low, medium, high, critical)', 'medium')
    .action((opts) => gapsAction({ ...cmd.opts(), ...opts } as ErrorHandlingOptions));

  cmd
    .command('boundaries')
    .description('List error boundaries')
    .action(() => boundariesAction(cmd.opts()));

  cmd
    .command('unhandled')
    .description('Find unhandled error paths')
    .option('-s, --min-severity <level>', 'Minimum severity (low, medium, high, critical)', 'medium')
    .action((opts) => unhandledAction({ ...cmd.opts(), ...opts } as ErrorHandlingOptions));

  cmd
    .command('analyze <function>')
    .description('Analyze specific function error handling')
    .action((func) => analyzeAction(func, cmd.opts()));

  return cmd;
}
