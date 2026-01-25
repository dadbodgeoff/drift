/**
 * Call Graph Command - drift callgraph
 *
 * Build and query call graphs to understand code reachability.
 * Answers: "What data can this code access?" and "Who can reach this data?"
 *
 * @requirements Call Graph Feature
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  createCallGraphAnalyzer,
  createStreamingCallGraphBuilder,
  createBoundaryScanner,
  createSecurityPrioritizer,
  createImpactAnalyzer,
  createDeadCodeDetector,
  createCoverageAnalyzer,
  createUnifiedScanner,
  detectProjectStack,
  type ReachabilityResult,
  type InverseReachabilityResult,
  type ImpactAnalysisResult,
  type DeadCodeResult,
  type DeadCodeConfidence,
  type CoverageAnalysisResult,
  type DetectedStack,
} from 'driftdetect-core';
import { createSpinner } from '../ui/spinner.js';

export interface CallGraphOptions {
  /** Output format */
  format?: 'text' | 'json';
  /** Enable verbose output */
  verbose?: boolean;
  /** Maximum depth for reachability queries */
  maxDepth?: number;
  /** Show security-prioritized view */
  security?: boolean;
}

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for call graph data */
const CALLGRAPH_DIR = 'callgraph';

/**
 * Check if call graph data exists
 */
async function callGraphExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, CALLGRAPH_DIR, 'graph.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when call graph not built
 */
function showNotBuiltMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No call graph built yet.'));
  console.log();
  console.log(chalk.gray('Build a call graph to analyze code reachability:'));
  console.log();
  console.log(chalk.cyan('  drift callgraph build'));
  console.log();
}

/**
 * Format detected stack for display
 */
function formatDetectedStack(stack: DetectedStack): void {
  console.log();
  console.log(chalk.bold('🔍 Detected Project Stack'));
  console.log(chalk.gray('─'.repeat(50)));
  
  if (stack.languages.length > 0) {
    const langIcons: Record<string, string> = {
      'typescript': '🟦',
      'javascript': '🟨',
      'python': '🐍',
      'csharp': '🟣',
      'java': '☕',
      'php': '🐘',
    };
    const langs = stack.languages.map(l => `${langIcons[l] ?? '📄'} ${l}`).join('  ');
    console.log(`  Languages: ${langs}`);
  }
  
  if (stack.orms.length > 0) {
    const ormColors: Record<string, (s: string) => string> = {
      'supabase': chalk.green,
      'prisma': chalk.cyan,
      'django': chalk.green,
      'sqlalchemy': chalk.yellow,
      'ef-core': chalk.magenta,
      'dapper': chalk.blue,
      'spring-data-jpa': chalk.green,
      'hibernate': chalk.yellow,
      'eloquent': chalk.red,
      'doctrine': chalk.blue,
    };
    const orms = stack.orms.map(o => {
      const color = ormColors[o] ?? chalk.gray;
      return color(o);
    }).join(', ');
    console.log(`  ORMs/Data: ${orms}`);
  }
  
  if (stack.frameworks.length > 0) {
    console.log(`  Frameworks: ${chalk.cyan(stack.frameworks.join(', '))}`);
  }
  
  console.log();
}

/**
 * Show tree-sitter availability warnings
 */
function showParserWarnings(detectedLanguages: string[]): void {
  // Languages with tree-sitter support
  const treeSitterSupported = ['typescript', 'javascript', 'python', 'csharp', 'java', 'php'];
  
  // Check for unsupported languages
  const unsupported = detectedLanguages.filter(l => !treeSitterSupported.includes(l));
  
  if (unsupported.length > 0) {
    console.log(chalk.yellow('⚠️  Parser Warnings:'));
    for (const lang of unsupported) {
      console.log(chalk.yellow(`   • ${lang}: No tree-sitter parser available, using regex fallback`));
    }
    console.log();
  }
}

/**
 * Build subcommand - build the call graph
 */
async function buildAction(options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  try {
    // Step 0: Detect project stack first
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('🚀 Building Call Graph'));
      console.log(chalk.gray('═'.repeat(50)));
    }

    const detectedStack = await detectProjectStack(rootDir);
    
    if (isTextFormat && (detectedStack.languages.length > 0 || detectedStack.orms.length > 0)) {
      formatDetectedStack(detectedStack);
      showParserWarnings(detectedStack.languages);
    }

    const spinner = isTextFormat ? createSpinner('Initializing...') : null;
    spinner?.start();

    // File patterns to scan - include all supported languages
    const filePatterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.cs',
      '**/*.java',
      '**/*.php',
    ];

    // Step 1: Run unified data access scanner (tree-sitter based)
    spinner?.text('🌳 Scanning with tree-sitter (semantic analysis)...');
    const unifiedScanner = createUnifiedScanner({ 
      rootDir, 
      verbose: options.verbose ?? false,
      autoDetect: true,
    });
    const semanticResult = await unifiedScanner.scanDirectory({ patterns: filePatterns });

    // Use semantic results as primary source
    const dataAccessPoints = semanticResult.accessPoints;
    const semanticStats = semanticResult.stats;

    // Step 2: Fall back to boundary scanner for additional coverage (regex-based)
    spinner?.text('🔍 Scanning for additional patterns (regex fallback)...');
    const boundaryScanner = createBoundaryScanner({ rootDir, verbose: options.verbose ?? false });
    await boundaryScanner.initialize();

    const boundaryResult = await boundaryScanner.scanDirectory({ patterns: filePatterns });

    // Merge boundary results with semantic results (semantic takes precedence)
    let regexAdditions = 0;
    for (const [, accessPoint] of Object.entries(boundaryResult.accessMap.accessPoints)) {
      const existing = dataAccessPoints.get(accessPoint.file) ?? [];
      // Only add if not already detected by semantic scanner
      const isDuplicate = existing.some(ap => 
        ap.line === accessPoint.line && ap.table === accessPoint.table
      );
      if (!isDuplicate) {
        existing.push(accessPoint);
        dataAccessPoints.set(accessPoint.file, existing);
        regexAdditions++;
      }
    }

    // Step 3: Build call graph with streaming/sharded storage (memory optimized)
    spinner?.text('📊 Building call graph (streaming mode)...');
    
    const streamingBuilder = createStreamingCallGraphBuilder({
      rootDir,
      onProgress: (current: number, total: number, _file: string) => {
        if (isTextFormat && spinner) {
          spinner.text(`📊 Building call graph... ${current}/${total} files`);
        }
      },
      onError: (file: string, error: Error) => {
        if (options.verbose) {
          console.error(chalk.yellow(`  Warning: ${file}: ${error.message}`));
        }
      },
    });

    const buildResult = await streamingBuilder.build(filePatterns, dataAccessPoints);

    spinner?.stop();

    // JSON output
    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        detectedStack,
        stats: {
          totalFunctions: buildResult.totalFunctions,
          totalCallSites: buildResult.totalCalls,
          entryPoints: buildResult.entryPoints,
          dataAccessors: buildResult.dataAccessors,
        },
        filesProcessed: buildResult.filesProcessed,
        semanticStats: semanticStats,
        boundaryStats: boundaryResult.stats,
        regexAdditions,
        errors: buildResult.errors.length,
        durationMs: buildResult.durationMs,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Call graph built successfully'));
    console.log();

    // Main statistics box
    console.log(chalk.bold('📊 Graph Statistics'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Files:         ${chalk.cyan.bold(buildResult.filesProcessed.toLocaleString())}`);
    console.log(`  Functions:     ${chalk.cyan.bold(buildResult.totalFunctions.toLocaleString())}`);
    console.log(`  Call Sites:    ${chalk.cyan(buildResult.totalCalls.toLocaleString())}`);
    console.log(`  Entry Points:  ${chalk.magenta.bold(buildResult.entryPoints.toLocaleString())} ${chalk.gray('(API routes, exports)')}`);
    console.log(`  Data Accessors: ${chalk.yellow.bold(buildResult.dataAccessors.toLocaleString())} ${chalk.gray('(functions with DB access)')}`);
    console.log(`  Duration:      ${chalk.gray((buildResult.durationMs / 1000).toFixed(2) + 's')}`);
    console.log();

    // Data access detection summary
    const totalAccessPoints = semanticStats.accessPointsFound + regexAdditions;
    if (totalAccessPoints > 0) {
      console.log(chalk.bold('💾 Data Access Detection'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  ${chalk.green('🌳 Tree-sitter:')} ${chalk.cyan(semanticStats.accessPointsFound)} access points ${chalk.gray(`(${semanticStats.filesScanned} files)`)}`);
      if (regexAdditions > 0) {
        console.log(`  ${chalk.yellow('🔍 Regex fallback:')} ${chalk.cyan(regexAdditions)} additional points`);
      }
      
      // ORM breakdown
      if (Object.keys(semanticStats.byOrm).length > 0) {
        console.log();
        console.log(chalk.gray('  By ORM/Framework:'));
        const sortedOrms = Object.entries(semanticStats.byOrm)
          .sort((a, b) => b[1] - a[1]);
        for (const [orm, count] of sortedOrms) {
          const bar = '█'.repeat(Math.min(20, Math.ceil(count / Math.max(...sortedOrms.map(([,c]) => c)) * 20)));
          console.log(`    ${chalk.gray(orm.padEnd(15))} ${chalk.cyan(bar)} ${count}`);
        }
      }
      console.log();
    }

    // Errors summary
    if (buildResult.errors.length > 0) {
      console.log(chalk.yellow(`⚠️  ${buildResult.errors.length} file(s) had errors during extraction`));
      if (options.verbose) {
        for (const errorFile of buildResult.errors.slice(0, 10)) {
          console.log(chalk.gray(`    • ${errorFile}`));
        }
        if (buildResult.errors.length > 10) {
          console.log(chalk.gray(`    ... and ${buildResult.errors.length - 10} more`));
        }
      }
      console.log();
    }

    // Next steps
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift callgraph status     ${chalk.white('View entry points & data accessors')}`));
    console.log(chalk.gray(`  • drift callgraph status -s  ${chalk.white('Security-prioritized view (P0-P4)')}`));
    console.log(chalk.gray(`  • drift callgraph reach <fn> ${chalk.white('What data can this code access?')}`));
    console.log(chalk.gray(`  • drift callgraph coverage   ${chalk.white('Test coverage for sensitive data')}`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
      if (options.verbose && error instanceof Error && error.stack) {
        console.log(chalk.gray(error.stack));
      }
    }
  }
}

/**
 * Status subcommand - show call graph overview
 */
async function statusAction(options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const showSecurity = options.security ?? false;

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const graph = analyzer.getGraph();
  if (!graph) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Failed to load call graph' }));
    } else {
      console.log(chalk.red('Failed to load call graph'));
    }
    return;
  }

  // If security flag is set, run boundary scan and prioritize
  if (showSecurity) {
    await showSecurityPrioritizedStatus(rootDir, graph, format);
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      stats: graph.stats,
      entryPoints: graph.entryPoints.map(id => {
        const func = graph.functions.get(id);
        return func ? { id, name: func.qualifiedName, file: func.file, line: func.startLine } : { id };
      }),
      dataAccessors: graph.dataAccessors.map(id => {
        const func = graph.functions.get(id);
        return func ? {
          id,
          name: func.qualifiedName,
          file: func.file,
          line: func.startLine,
          tables: [...new Set(func.dataAccess.map(d => d.table))],
        } : { id };
      }),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('📊 Call Graph Status'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  console.log(`Functions: ${chalk.cyan(graph.stats.totalFunctions)}`);
  console.log(`Call Sites: ${chalk.cyan(graph.stats.totalCallSites)} (${chalk.green(graph.stats.resolvedCallSites)} resolved)`);
  console.log(`Entry Points: ${chalk.cyan(graph.entryPoints.length)}`);
  console.log(`Data Accessors: ${chalk.cyan(graph.dataAccessors.length)}`);
  console.log();

  // Entry points
  if (graph.entryPoints.length > 0) {
    console.log(chalk.bold('Entry Points (API Routes, Exports):'));
    for (const id of graph.entryPoints.slice(0, 10)) {
      const func = graph.functions.get(id);
      if (func) {
        console.log(`  ${chalk.magenta('🚪')} ${chalk.white(func.qualifiedName)}`);
        console.log(chalk.gray(`     ${func.file}:${func.startLine}`));
      }
    }
    if (graph.entryPoints.length > 10) {
      console.log(chalk.gray(`  ... and ${graph.entryPoints.length - 10} more`));
    }
    console.log();
  }

  // Data accessors
  if (graph.dataAccessors.length > 0) {
    console.log(chalk.bold('Data Accessors (Functions with DB access):'));
    for (const id of graph.dataAccessors.slice(0, 10)) {
      const func = graph.functions.get(id);
      if (func) {
        const tables = [...new Set(func.dataAccess.map(d => d.table))];
        console.log(`  ${chalk.blue('💾')} ${chalk.white(func.qualifiedName)} → [${tables.join(', ')}]`);
        console.log(chalk.gray(`     ${func.file}:${func.startLine}`));
      }
    }
    if (graph.dataAccessors.length > 10) {
      console.log(chalk.gray(`  ... and ${graph.dataAccessors.length - 10} more`));
    }
    console.log();
  }

  console.log(chalk.gray("Tip: Use 'drift callgraph status --security' to see security-prioritized view"));
  console.log();
}

/**
 * Show security-prioritized status view
 */
async function showSecurityPrioritizedStatus(
  rootDir: string,
  _graph: ReturnType<ReturnType<typeof createCallGraphAnalyzer>['getGraph']>,
  format: string
): Promise<void> {
  // Only show spinner for text format
  const isTextFormat = format === 'text';
  const spinner = isTextFormat ? createSpinner('Analyzing security priorities...') : null;
  spinner?.start();

  // Run boundary scan
  const boundaryScanner = createBoundaryScanner({ rootDir, verbose: false });
  await boundaryScanner.initialize();

  const filePatterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'];
  const boundaryResult = await boundaryScanner.scanDirectory({ patterns: filePatterns });

  // Prioritize by security
  const prioritizer = createSecurityPrioritizer();
  const prioritized = prioritizer.prioritize(boundaryResult.accessMap);

  spinner?.stop();

  // JSON output
  if (!isTextFormat) {
    console.log(JSON.stringify({
      summary: prioritized.summary,
      critical: prioritized.critical.map(p => ({
        table: p.accessPoint.table,
        fields: p.accessPoint.fields,
        operation: p.accessPoint.operation,
        file: p.accessPoint.file,
        line: p.accessPoint.line,
        tier: p.security.tier,
        riskScore: p.security.riskScore,
        sensitivity: p.security.maxSensitivity,
        regulations: p.security.regulations,
        rationale: p.security.rationale,
      })),
      high: prioritized.high.slice(0, 20).map(p => ({
        table: p.accessPoint.table,
        fields: p.accessPoint.fields,
        operation: p.accessPoint.operation,
        file: p.accessPoint.file,
        line: p.accessPoint.line,
        tier: p.security.tier,
        riskScore: p.security.riskScore,
        sensitivity: p.security.maxSensitivity,
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔒 Security-Prioritized Data Access'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Summary
  const { summary } = prioritized;
  console.log(chalk.bold('Summary:'));
  console.log(`  Total Access Points: ${chalk.cyan(summary.totalAccessPoints)}`);
  console.log(`  ${chalk.red('🔴 Critical (P0/P1):')} ${chalk.red(summary.criticalCount)}`);
  console.log(`  ${chalk.yellow('🟡 High (P2):')} ${chalk.yellow(summary.highCount)}`);
  console.log(`  ${chalk.gray('⚪ Low (P3/P4):')} ${chalk.gray(summary.lowCount)}`);
  console.log(`  ${chalk.gray('📦 Noise (filtered):')} ${chalk.gray(summary.noiseCount)}`);
  console.log();

  // Regulations
  if (summary.regulations.length > 0) {
    console.log(chalk.bold('Regulatory Implications:'));
    console.log(`  ${summary.regulations.map(r => chalk.magenta(r.toUpperCase())).join(', ')}`);
    console.log();
  }

  // Critical items (P0/P1)
  if (prioritized.critical.length > 0) {
    console.log(chalk.bold.red('🚨 Critical Security Items (P0/P1):'));
    for (const p of prioritized.critical.slice(0, 15)) {
      const tierColor = p.security.tier === 'P0' ? chalk.bgRed.white : chalk.red;
      const sensitivityIcon = getSensitivityIcon(p.security.maxSensitivity);
      const opColor = p.accessPoint.operation === 'write' ? chalk.yellow :
                      p.accessPoint.operation === 'delete' ? chalk.red : chalk.gray;

      console.log(`  ${tierColor(` ${p.security.tier} `)} ${sensitivityIcon} ${chalk.white(p.accessPoint.table)}`);
      console.log(`       ${opColor(p.accessPoint.operation)} ${p.accessPoint.fields.join(', ') || '*'}`);
      console.log(chalk.gray(`       ${p.accessPoint.file}:${p.accessPoint.line}`));
      console.log(chalk.gray(`       ${p.security.rationale}`));
      if (p.security.regulations.length > 0) {
        console.log(chalk.magenta(`       Regulations: ${p.security.regulations.join(', ')}`));
      }
    }
    if (prioritized.critical.length > 15) {
      console.log(chalk.gray(`  ... and ${prioritized.critical.length - 15} more critical items`));
    }
    console.log();
  }

  // High priority items (P2)
  if (prioritized.high.length > 0) {
    console.log(chalk.bold.yellow('⚠️  High Priority Items (P2):'));
    for (const p of prioritized.high.slice(0, 10)) {
      const sensitivityIcon = getSensitivityIcon(p.security.maxSensitivity);
      console.log(`  ${chalk.yellow('P2')} ${sensitivityIcon} ${chalk.white(p.accessPoint.table)}.${p.accessPoint.fields.join(', ') || '*'}`);
      console.log(chalk.gray(`     ${p.accessPoint.file}:${p.accessPoint.line}`));
    }
    if (prioritized.high.length > 10) {
      console.log(chalk.gray(`  ... and ${prioritized.high.length - 10} more high priority items`));
    }
    console.log();
  }

  // Sensitivity breakdown
  console.log(chalk.bold('By Sensitivity Type:'));
  if (summary.bySensitivity.credentials > 0) {
    console.log(`  ${chalk.red('🔑 Credentials:')} ${summary.bySensitivity.credentials}`);
  }
  if (summary.bySensitivity.financial > 0) {
    console.log(`  ${chalk.magenta('💰 Financial:')} ${summary.bySensitivity.financial}`);
  }
  if (summary.bySensitivity.health > 0) {
    console.log(`  ${chalk.blue('🏥 Health:')} ${summary.bySensitivity.health}`);
  }
  if (summary.bySensitivity.pii > 0) {
    console.log(`  ${chalk.yellow('👤 PII:')} ${summary.bySensitivity.pii}`);
  }
  console.log(`  ${chalk.gray('❓ Unknown:')} ${summary.bySensitivity.unknown}`);
  console.log();
}

/**
 * Get icon for sensitivity type
 */
function getSensitivityIcon(sensitivity: string): string {
  switch (sensitivity) {
    case 'credentials': return chalk.red('🔑');
    case 'financial': return chalk.magenta('💰');
    case 'health': return chalk.blue('🏥');
    case 'pii': return chalk.yellow('👤');
    default: return chalk.gray('❓');
  }
}

/**
 * Reach subcommand - what data can this code reach?
 */
async function reachAction(location: string, options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const maxDepth = options.maxDepth ?? 10;

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  // Parse location: file:line or function name
  let file: string | undefined;
  let line: number | undefined;
  let functionName: string | undefined;

  if (location.includes(':')) {
    const parts = location.split(':');
    const filePart = parts[0];
    const linePart = parts[1];
    if (filePart && linePart) {
      const parsedLine = parseInt(linePart, 10);
      if (!isNaN(parsedLine)) {
        file = filePart;
        line = parsedLine;
      } else {
        functionName = location;
      }
    } else {
      functionName = location;
    }
  } else {
    functionName = location;
  }

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  let result: ReachabilityResult;

  if (file !== undefined && line !== undefined) {
    result = analyzer.getReachableData(file, line, { maxDepth });
  } else if (functionName) {
    // Find function by name
    const graph = analyzer.getGraph();
    if (!graph) {
      console.log(format === 'json' 
        ? JSON.stringify({ error: 'Failed to load call graph' })
        : chalk.red('Failed to load call graph'));
      return;
    }

    let funcId: string | undefined;
    for (const [id, func] of graph.functions) {
      if (func.name === functionName || func.qualifiedName === functionName) {
        funcId = id;
        break;
      }
    }

    if (!funcId) {
      console.log(format === 'json'
        ? JSON.stringify({ error: `Function '${functionName}' not found` })
        : chalk.red(`Function '${functionName}' not found`));
      return;
    }

    result = analyzer.getReachableDataFromFunction(funcId, { maxDepth });
  } else {
    console.log(format === 'json'
      ? JSON.stringify({ error: 'Invalid location format. Use file:line or function_name' })
      : chalk.red('Invalid location format. Use file:line or function_name'));
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      origin: result.origin,
      tables: result.tables,
      sensitiveFields: result.sensitiveFields.map(sf => ({
        field: `${sf.field.table}.${sf.field.field}`,
        type: sf.field.sensitivityType,
        accessCount: sf.accessCount,
      })),
      maxDepth: result.maxDepth,
      functionsTraversed: result.functionsTraversed,
      accessPoints: result.reachableAccess.map(ra => ({
        table: ra.access.table,
        fields: ra.access.fields,
        operation: ra.access.operation,
        depth: ra.depth,
        path: ra.path.map(p => p.functionName),
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔎 Reachability Analysis'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  console.log(`Origin: ${chalk.cyan(file ? `${file}:${line}` : functionName)}`);
  console.log(`Tables Reachable: ${chalk.yellow(result.tables.join(', ') || 'none')}`);
  console.log(`Functions Traversed: ${chalk.cyan(result.functionsTraversed)}`);
  console.log(`Max Depth: ${chalk.cyan(result.maxDepth)}`);
  console.log();

  // Sensitive fields
  if (result.sensitiveFields.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Sensitive Fields Accessible:'));
    for (const sf of result.sensitiveFields) {
      const typeColor = sf.field.sensitivityType === 'credentials' ? chalk.red :
                        sf.field.sensitivityType === 'pii' ? chalk.yellow :
                        sf.field.sensitivityType === 'financial' ? chalk.magenta : chalk.gray;
      console.log(`  ${typeColor('●')} ${sf.field.table}.${sf.field.field} (${sf.field.sensitivityType})`);
      console.log(chalk.gray(`    ${sf.accessCount} access point(s), ${sf.paths.length} path(s)`));
    }
    console.log();
  }

  // Access points
  if (result.reachableAccess.length > 0) {
    console.log(chalk.bold('Data Access Points:'));
    for (const ra of result.reachableAccess.slice(0, 15)) {
      const opColor = ra.access.operation === 'write' ? chalk.yellow :
                      ra.access.operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`  ${opColor(ra.access.operation)} ${chalk.white(ra.access.table)}.${ra.access.fields.join(', ')}`);
      console.log(chalk.gray(`    Path: ${ra.path.map(p => p.functionName).join(' → ')}`));
    }
    if (result.reachableAccess.length > 15) {
      console.log(chalk.gray(`  ... and ${result.reachableAccess.length - 15} more`));
    }
    console.log();
  } else {
    console.log(chalk.gray('No data access points found from this location.'));
    console.log();
  }
}

/**
 * Inverse subcommand - who can reach this data?
 */
async function inverseAction(target: string, options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const maxDepth = options.maxDepth ?? 10;

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  // Parse target: table or table.field
  const parts = target.split('.');
  const table = parts[0] ?? '';
  const field = parts.length > 1 ? parts.slice(1).join('.') : undefined;

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const result: InverseReachabilityResult = analyzer.getCodePathsToData(
    field ? { table, field, maxDepth } : { table, maxDepth }
  );

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      target: result.target,
      totalAccessors: result.totalAccessors,
      entryPoints: result.entryPoints,
      accessPaths: result.accessPaths.map(ap => ({
        entryPoint: ap.entryPoint,
        path: ap.path.map(p => p.functionName),
        accessPoint: ap.accessPoint ? {
          table: ap.accessPoint.table,
          fields: ap.accessPoint.fields,
          operation: ap.accessPoint.operation,
        } : null,
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🔄 Inverse Reachability'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  console.log(`Target: ${chalk.cyan(field ? `${table}.${field}` : table)}`);
  console.log(`Direct Accessors: ${chalk.cyan(result.totalAccessors)}`);
  console.log(`Entry Points That Can Reach: ${chalk.cyan(result.entryPoints.length)}`);
  console.log();

  if (result.accessPaths.length > 0) {
    console.log(chalk.bold('Access Paths:'));
    
    const graph = analyzer.getGraph();
    for (const ap of result.accessPaths.slice(0, 10)) {
      const entryFunc = graph?.functions.get(ap.entryPoint);
      if (entryFunc) {
        console.log(`  ${chalk.magenta('🚪')} ${chalk.white(entryFunc.qualifiedName)}`);
        console.log(chalk.gray(`     Path: ${ap.path.map(p => p.functionName).join(' → ')}`));
      }
    }
    if (result.accessPaths.length > 10) {
      console.log(chalk.gray(`  ... and ${result.accessPaths.length - 10} more paths`));
    }
    console.log();
  } else {
    console.log(chalk.gray('No entry points can reach this data.'));
    console.log();
  }
}

/**
 * Function subcommand - show details about a function
 */
async function functionAction(name: string, options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const graph = analyzer.getGraph();
  if (!graph) {
    console.log(format === 'json'
      ? JSON.stringify({ error: 'Failed to load call graph' })
      : chalk.red('Failed to load call graph'));
    return;
  }

  // Find function by name
  let func;
  for (const [, f] of graph.functions) {
    if (f.name === name || f.qualifiedName === name || f.id.includes(name)) {
      func = f;
      break;
    }
  }

  if (!func) {
    console.log(format === 'json'
      ? JSON.stringify({ error: `Function '${name}' not found` })
      : chalk.red(`Function '${name}' not found`));
    return;
  }

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      id: func.id,
      name: func.name,
      qualifiedName: func.qualifiedName,
      file: func.file,
      line: func.startLine,
      language: func.language,
      className: func.className,
      isExported: func.isExported,
      isAsync: func.isAsync,
      parameters: func.parameters,
      returnType: func.returnType,
      calls: func.calls.map(c => ({
        callee: c.calleeName,
        resolved: c.resolved,
        line: c.line,
      })),
      calledBy: func.calledBy.map(c => ({
        caller: c.callerId,
        line: c.line,
      })),
      dataAccess: func.dataAccess.map(d => ({
        table: d.table,
        fields: d.fields,
        operation: d.operation,
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold(`📋 Function: ${func.qualifiedName}`));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  console.log(`File: ${chalk.cyan(func.file)}:${func.startLine}`);
  console.log(`Language: ${chalk.cyan(func.language)}`);
  if (func.className) console.log(`Class: ${chalk.cyan(func.className)}`);
  console.log(`Exported: ${func.isExported ? chalk.green('yes') : chalk.gray('no')}`);
  console.log(`Async: ${func.isAsync ? chalk.green('yes') : chalk.gray('no')}`);
  console.log();

  // Parameters
  if (func.parameters.length > 0) {
    console.log(chalk.bold('Parameters:'));
    for (const p of func.parameters) {
      console.log(`  ${chalk.white(p.name)}${p.type ? `: ${chalk.gray(p.type)}` : ''}`);
    }
    console.log();
  }

  // Calls
  if (func.calls.length > 0) {
    console.log(chalk.bold(`Calls (${func.calls.length}):`));
    for (const c of func.calls.slice(0, 10)) {
      const status = c.resolved ? chalk.green('✓') : chalk.gray('?');
      console.log(`  ${status} ${chalk.white(c.calleeName)} ${chalk.gray(`line ${c.line}`)}`);
    }
    if (func.calls.length > 10) {
      console.log(chalk.gray(`  ... and ${func.calls.length - 10} more`));
    }
    console.log();
  }

  // Called by
  if (func.calledBy.length > 0) {
    console.log(chalk.bold(`Called By (${func.calledBy.length}):`));
    for (const c of func.calledBy.slice(0, 10)) {
      const caller = graph.functions.get(c.callerId);
      console.log(`  ${chalk.white(caller?.qualifiedName ?? c.callerId)}`);
    }
    if (func.calledBy.length > 10) {
      console.log(chalk.gray(`  ... and ${func.calledBy.length - 10} more`));
    }
    console.log();
  }

  // Data access
  if (func.dataAccess.length > 0) {
    console.log(chalk.bold('Data Access:'));
    for (const d of func.dataAccess) {
      const opColor = d.operation === 'write' ? chalk.yellow :
                      d.operation === 'delete' ? chalk.red : chalk.gray;
      console.log(`  ${opColor(d.operation)} ${chalk.white(d.table)}.${d.fields.join(', ')}`);
    }
    console.log();
  }
}

/**
 * Impact subcommand - what breaks if I change this?
 */
async function impactAction(target: string, options: CallGraphOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Analyzing impact...') : null;
  spinner?.start();

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const graph = analyzer.getGraph();
  if (!graph) {
    spinner?.stop();
    console.log(format === 'json'
      ? JSON.stringify({ error: 'Failed to load call graph' })
      : chalk.red('Failed to load call graph'));
    return;
  }

  const impactAnalyzer = createImpactAnalyzer(graph);
  let result: ImpactAnalysisResult;

  // Determine if target is a file or function
  if (target.includes('/') || target.includes('.py') || target.includes('.ts') || target.includes('.js')) {
    // It's a file path
    result = impactAnalyzer.analyzeFile(target);
  } else {
    // It's a function name
    result = impactAnalyzer.analyzeFunctionByName(target);
  }

  spinner?.stop();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      target: result.target,
      risk: result.risk,
      riskScore: result.riskScore,
      summary: result.summary,
      affected: result.affected.slice(0, 50).map(a => ({
        name: a.qualifiedName,
        file: a.file,
        line: a.line,
        depth: a.depth,
        isEntryPoint: a.isEntryPoint,
        accessesSensitiveData: a.accessesSensitiveData,
        path: a.pathToChange.map(p => p.functionName),
      })),
      entryPoints: result.entryPoints.map(e => ({
        name: e.qualifiedName,
        file: e.file,
        line: e.line,
        path: e.pathToChange.map(p => p.functionName),
      })),
      sensitiveDataPaths: result.sensitiveDataPaths.map(p => ({
        table: p.table,
        fields: p.fields,
        operation: p.operation,
        sensitivity: p.sensitivity,
        entryPoint: p.entryPoint,
        path: p.fullPath.map(n => n.functionName),
      })),
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('💥 Impact Analysis'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Target info
  if (result.target.type === 'file') {
    console.log(`Target: ${chalk.cyan(result.target.file)} (${result.changedFunctions.length} functions)`);
  } else {
    console.log(`Target: ${chalk.cyan(result.target.functionName ?? result.target.functionId ?? 'unknown')}`);
  }
  console.log();

  // Risk assessment
  const riskColor = result.risk === 'critical' ? chalk.bgRed.white :
                    result.risk === 'high' ? chalk.red :
                    result.risk === 'medium' ? chalk.yellow : chalk.green;
  console.log(`Risk Level: ${riskColor(` ${result.risk.toUpperCase()} `)} (score: ${result.riskScore}/100)`);
  console.log();

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Direct Callers: ${chalk.cyan(result.summary.directCallers)}`);
  console.log(`  Transitive Callers: ${chalk.cyan(result.summary.transitiveCallers)}`);
  console.log(`  Affected Entry Points: ${chalk.yellow(result.summary.affectedEntryPoints)}`);
  console.log(`  Sensitive Data Paths: ${chalk.red(result.summary.affectedDataPaths)}`);
  console.log(`  Max Call Depth: ${chalk.gray(result.summary.maxDepth)}`);
  console.log();

  // Entry points affected
  if (result.entryPoints.length > 0) {
    console.log(chalk.bold.yellow('🚪 Affected Entry Points (User-Facing Impact):'));
    for (const ep of result.entryPoints.slice(0, 10)) {
      console.log(`  ${chalk.magenta('●')} ${chalk.white(ep.qualifiedName)}`);
      console.log(chalk.gray(`    ${ep.file}:${ep.line}`));
      console.log(chalk.gray(`    Path: ${ep.pathToChange.map(p => p.functionName).join(' → ')}`));
    }
    if (result.entryPoints.length > 10) {
      console.log(chalk.gray(`  ... and ${result.entryPoints.length - 10} more entry points`));
    }
    console.log();
  }

  // Sensitive data paths
  if (result.sensitiveDataPaths.length > 0) {
    console.log(chalk.bold.red('🔒 Sensitive Data Paths Affected:'));
    for (const dp of result.sensitiveDataPaths.slice(0, 10)) {
      const sensitivityIcon = dp.sensitivity === 'credentials' ? '🔑' :
                              dp.sensitivity === 'financial' ? '💰' :
                              dp.sensitivity === 'health' ? '🏥' : '👤';
      const sensitivityColor = dp.sensitivity === 'credentials' ? chalk.red :
                               dp.sensitivity === 'financial' ? chalk.magenta :
                               dp.sensitivity === 'health' ? chalk.blue : chalk.yellow;
      console.log(`  ${sensitivityIcon} ${sensitivityColor(dp.sensitivity)} ${chalk.white(dp.table)}.${dp.fields.join(', ')}`);
      console.log(chalk.gray(`    Entry: ${dp.entryPoint}`));
      console.log(chalk.gray(`    Path: ${dp.fullPath.map(n => n.functionName).join(' → ')}`));
    }
    if (result.sensitiveDataPaths.length > 10) {
      console.log(chalk.gray(`  ... and ${result.sensitiveDataPaths.length - 10} more sensitive paths`));
    }
    console.log();
  }

  // Direct callers
  const directCallers = result.affected.filter(a => a.depth === 1);
  if (directCallers.length > 0) {
    console.log(chalk.bold('📞 Direct Callers (Immediate Impact):'));
    for (const caller of directCallers.slice(0, 10)) {
      const icon = caller.accessesSensitiveData ? chalk.red('●') : chalk.gray('○');
      console.log(`  ${icon} ${chalk.white(caller.qualifiedName)}`);
      console.log(chalk.gray(`    ${caller.file}:${caller.line}`));
    }
    if (directCallers.length > 10) {
      console.log(chalk.gray(`  ... and ${directCallers.length - 10} more direct callers`));
    }
    console.log();
  }

  // Transitive callers (depth > 1)
  const transitiveCallers = result.affected.filter(a => a.depth > 1);
  if (transitiveCallers.length > 0) {
    console.log(chalk.bold('🔗 Transitive Callers (Ripple Effect):'));
    for (const caller of transitiveCallers.slice(0, 8)) {
      const depthIndicator = chalk.gray(`[depth ${caller.depth}]`);
      console.log(`  ${depthIndicator} ${chalk.white(caller.qualifiedName)}`);
    }
    if (transitiveCallers.length > 8) {
      console.log(chalk.gray(`  ... and ${transitiveCallers.length - 8} more transitive callers`));
    }
    console.log();
  }

  // Recommendations
  if (result.risk === 'critical' || result.risk === 'high') {
    console.log(chalk.bold('⚠️  Recommendations:'));
    if (result.sensitiveDataPaths.length > 0) {
      console.log(chalk.yellow('  • Review all sensitive data paths before merging'));
    }
    if (result.entryPoints.length > 5) {
      console.log(chalk.yellow('  • Consider incremental rollout - many entry points affected'));
    }
    if (result.summary.maxDepth > 5) {
      console.log(chalk.yellow('  • Deep call chain - test thoroughly for regressions'));
    }
    console.log();
  }
}

/**
 * Dead code subcommand - find unused functions
 */
async function deadCodeAction(options: CallGraphOptions & { confidence?: string; includeExported?: boolean; includeTests?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const minConfidence = (options.confidence ?? 'low') as DeadCodeConfidence;
  const includeExported = options.includeExported ?? false;
  const includeTests = options.includeTests ?? false;

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Detecting dead code...') : null;
  spinner?.start();

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const graph = analyzer.getGraph();
  if (!graph) {
    spinner?.stop();
    console.log(format === 'json'
      ? JSON.stringify({ error: 'Failed to load call graph' })
      : chalk.red('Failed to load call graph'));
    return;
  }

  const detector = createDeadCodeDetector(graph);
  const result: DeadCodeResult = detector.detect({
    minConfidence,
    includeExported,
    includeTests,
  });

  spinner?.stop();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      summary: result.summary,
      candidates: result.candidates.slice(0, 100).map(c => ({
        name: c.qualifiedName,
        file: c.file,
        line: c.line,
        confidence: c.confidence,
        linesOfCode: c.linesOfCode,
        possibleFalsePositives: c.possibleFalsePositives,
        hasDataAccess: c.hasDataAccess,
      })),
      excluded: result.excluded,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🗑️  Dead Code Detection'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Summary
  const { summary } = result;
  console.log(chalk.bold('Summary:'));
  console.log(`  Total Functions: ${chalk.cyan(summary.totalFunctions)}`);
  console.log(`  Dead Code Candidates: ${chalk.yellow(summary.deadCandidates)}`);
  console.log(`  Estimated Dead Lines: ${chalk.red(summary.estimatedDeadLines)}`);
  console.log();

  // By confidence
  console.log(chalk.bold('By Confidence:'));
  console.log(`  ${chalk.red('🔴 High:')} ${summary.highConfidence} (safe to remove)`);
  console.log(`  ${chalk.yellow('🟡 Medium:')} ${summary.mediumConfidence} (review first)`);
  console.log(`  ${chalk.gray('⚪ Low:')} ${summary.lowConfidence} (might be false positive)`);
  console.log();

  // Excluded
  console.log(chalk.bold('Excluded from Analysis:'));
  console.log(`  Entry Points: ${chalk.gray(result.excluded.entryPoints)}`);
  console.log(`  Functions with Callers: ${chalk.gray(result.excluded.withCallers)}`);
  console.log(`  Framework Hooks: ${chalk.gray(result.excluded.frameworkHooks)}`);
  console.log();

  // High confidence candidates
  const highConf = result.candidates.filter(c => c.confidence === 'high');
  if (highConf.length > 0) {
    console.log(chalk.bold.red('🔴 High Confidence (Safe to Remove):'));
    for (const c of highConf.slice(0, 15)) {
      console.log(`  ${chalk.white(c.qualifiedName)} ${chalk.gray(`(${c.linesOfCode} lines)`)}`);
      console.log(chalk.gray(`    ${c.file}:${c.line}`));
    }
    if (highConf.length > 15) {
      console.log(chalk.gray(`  ... and ${highConf.length - 15} more`));
    }
    console.log();
  }

  // Medium confidence candidates
  const medConf = result.candidates.filter(c => c.confidence === 'medium');
  if (medConf.length > 0) {
    console.log(chalk.bold.yellow('🟡 Medium Confidence (Review First):'));
    for (const c of medConf.slice(0, 10)) {
      const reasons = c.possibleFalsePositives.slice(0, 2).join(', ');
      console.log(`  ${chalk.white(c.qualifiedName)} ${chalk.gray(`(${c.linesOfCode} lines)`)}`);
      console.log(chalk.gray(`    ${c.file}:${c.line}`));
      if (reasons) {
        console.log(chalk.gray(`    Might be: ${reasons}`));
      }
    }
    if (medConf.length > 10) {
      console.log(chalk.gray(`  ... and ${medConf.length - 10} more`));
    }
    console.log();
  }

  // Files with most dead code
  if (summary.byFile.length > 0) {
    console.log(chalk.bold('Files with Most Dead Code:'));
    for (const f of summary.byFile.slice(0, 10)) {
      console.log(`  ${chalk.cyan(f.count)} functions (${f.lines} lines): ${chalk.white(f.file)}`);
    }
    console.log();
  }

  // Recommendations
  if (summary.highConfidence > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    console.log(chalk.green(`  • ${summary.highConfidence} functions can likely be safely removed`));
    console.log(chalk.green(`  • This would remove ~${summary.estimatedDeadLines} lines of code`));
    if (summary.mediumConfidence > 0) {
      console.log(chalk.yellow(`  • Review ${summary.mediumConfidence} medium-confidence candidates before removing`));
    }
    console.log();
  }
}

/**
 * Coverage subcommand - analyze test coverage for sensitive data access
 */
async function coverageAction(options: CallGraphOptions & { sensitive?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const showSensitive = options.sensitive ?? true;

  if (!(await callGraphExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No call graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Analyzing test coverage for sensitive data...') : null;
  spinner?.start();

  const analyzer = createCallGraphAnalyzer({ rootDir });
  await analyzer.initialize();

  const graph = analyzer.getGraph();
  if (!graph) {
    spinner?.stop();
    console.log(format === 'json'
      ? JSON.stringify({ error: 'Failed to load call graph' })
      : chalk.red('Failed to load call graph'));
    return;
  }

  const coverageAnalyzer = createCoverageAnalyzer(graph);
  const result: CoverageAnalysisResult = coverageAnalyzer.analyze();

  spinner?.stop();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      summary: result.summary,
      fields: result.fields.map(f => ({
        field: f.fullName,
        sensitivity: f.sensitivity,
        totalPaths: f.totalPaths,
        testedPaths: f.testedPaths,
        coveragePercent: f.coveragePercent,
        status: f.status,
      })),
      uncoveredPaths: result.uncoveredPaths.slice(0, 50).map(p => ({
        field: `${p.table}.${p.field}`,
        sensitivity: p.sensitivity,
        entryPoint: p.entryPoint.name,
        accessor: p.accessor.name,
        depth: p.depth,
      })),
      testFiles: result.testFiles,
      testFunctions: result.testFunctions,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🧪 Sensitive Data Test Coverage'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Summary
  const { summary } = result;
  console.log(chalk.bold('Summary:'));
  console.log(`  Sensitive Fields: ${chalk.cyan(summary.totalSensitiveFields)}`);
  console.log(`  Access Paths: ${chalk.cyan(summary.totalAccessPaths)}`);
  console.log(`  Tested Paths: ${chalk.green(summary.testedAccessPaths)}`);
  console.log(`  Coverage: ${getCoverageColor(summary.coveragePercent)(`${summary.coveragePercent}%`)}`);
  console.log(`  Test Files: ${chalk.gray(result.testFiles.length)}`);
  console.log(`  Test Functions: ${chalk.gray(result.testFunctions)}`);
  console.log();

  // By sensitivity
  console.log(chalk.bold('Coverage by Sensitivity:'));
  const sensOrder: Array<'credentials' | 'financial' | 'health' | 'pii'> = ['credentials', 'financial', 'health', 'pii'];
  for (const sens of sensOrder) {
    const s = summary.bySensitivity[sens];
    if (s.fields > 0) {
      const icon = sens === 'credentials' ? '🔑' :
                   sens === 'financial' ? '💰' :
                   sens === 'health' ? '🏥' : '👤';
      const color = getCoverageColor(s.coveragePercent);
      console.log(`  ${icon} ${chalk.white(sens)}: ${color(`${s.coveragePercent}%`)} (${s.testedPaths}/${s.paths} paths)`);
    }
  }
  console.log();

  // Field coverage
  if (result.fields.length > 0 && showSensitive) {
    console.log(chalk.bold('Field Coverage:'));
    for (const f of result.fields.slice(0, 20)) {
      const statusIcon = f.status === 'covered' ? chalk.green('✓') :
                         f.status === 'partial' ? chalk.yellow('◐') :
                         chalk.red('✗');
      const coverageColor = getCoverageColor(f.coveragePercent);
      const sensIcon = f.sensitivity === 'credentials' ? '🔑' :
                       f.sensitivity === 'financial' ? '💰' :
                       f.sensitivity === 'health' ? '🏥' : '👤';
      console.log(`  ${statusIcon} ${sensIcon} ${chalk.white(f.fullName)}: ${coverageColor(`${f.testedPaths}/${f.totalPaths}`)} paths tested`);
    }
    if (result.fields.length > 20) {
      console.log(chalk.gray(`  ... and ${result.fields.length - 20} more fields`));
    }
    console.log();
  }

  // Uncovered paths (highest priority)
  const uncoveredByCredentials = result.uncoveredPaths.filter(p => p.sensitivity === 'credentials');
  const uncoveredByFinancial = result.uncoveredPaths.filter(p => p.sensitivity === 'financial');
  const uncoveredByHealth = result.uncoveredPaths.filter(p => p.sensitivity === 'health');
  const uncoveredByPii = result.uncoveredPaths.filter(p => p.sensitivity === 'pii');

  if (uncoveredByCredentials.length > 0) {
    console.log(chalk.bold.red('🔑 Untested Credential Access Paths:'));
    for (const p of uncoveredByCredentials.slice(0, 5)) {
      console.log(`  ${chalk.white(`${p.table}.${p.field}`)}`);
      console.log(chalk.gray(`    Entry: ${p.entryPoint.name} → Accessor: ${p.accessor.name}`));
      console.log(chalk.gray(`    ${p.entryPoint.file}:${p.entryPoint.line}`));
    }
    if (uncoveredByCredentials.length > 5) {
      console.log(chalk.gray(`  ... and ${uncoveredByCredentials.length - 5} more`));
    }
    console.log();
  }

  if (uncoveredByFinancial.length > 0) {
    console.log(chalk.bold.magenta('💰 Untested Financial Data Paths:'));
    for (const p of uncoveredByFinancial.slice(0, 5)) {
      console.log(`  ${chalk.white(`${p.table}.${p.field}`)}`);
      console.log(chalk.gray(`    Entry: ${p.entryPoint.name} → Accessor: ${p.accessor.name}`));
    }
    if (uncoveredByFinancial.length > 5) {
      console.log(chalk.gray(`  ... and ${uncoveredByFinancial.length - 5} more`));
    }
    console.log();
  }

  if (uncoveredByHealth.length > 0) {
    console.log(chalk.bold.blue('🏥 Untested Health Data Paths:'));
    for (const p of uncoveredByHealth.slice(0, 3)) {
      console.log(`  ${chalk.white(`${p.table}.${p.field}`)}`);
      console.log(chalk.gray(`    Entry: ${p.entryPoint.name} → Accessor: ${p.accessor.name}`));
    }
    if (uncoveredByHealth.length > 3) {
      console.log(chalk.gray(`  ... and ${uncoveredByHealth.length - 3} more`));
    }
    console.log();
  }

  if (uncoveredByPii.length > 0) {
    console.log(chalk.bold.yellow('👤 Untested PII Access Paths:'));
    for (const p of uncoveredByPii.slice(0, 3)) {
      console.log(`  ${chalk.white(`${p.table}.${p.field}`)}`);
      console.log(chalk.gray(`    Entry: ${p.entryPoint.name} → Accessor: ${p.accessor.name}`));
    }
    if (uncoveredByPii.length > 3) {
      console.log(chalk.gray(`  ... and ${uncoveredByPii.length - 3} more`));
    }
    console.log();
  }

  // Recommendations
  if (result.uncoveredPaths.length > 0) {
    console.log(chalk.bold('💡 Recommendations:'));
    if (uncoveredByCredentials.length > 0) {
      console.log(chalk.red(`  • ${uncoveredByCredentials.length} credential access paths need tests (highest priority)`));
    }
    if (uncoveredByFinancial.length > 0) {
      console.log(chalk.magenta(`  • ${uncoveredByFinancial.length} financial data paths need tests`));
    }
    if (summary.coveragePercent < 50) {
      console.log(chalk.yellow(`  • Overall coverage is ${summary.coveragePercent}% - consider adding integration tests`));
    }
    console.log();
  } else {
    console.log(chalk.green('✓ All sensitive data access paths are covered by tests!'));
    console.log();
  }
}

/**
 * Get color function based on coverage percentage
 */
function getCoverageColor(percent: number): (text: string) => string {
  if (percent >= 80) return chalk.green;
  if (percent >= 50) return chalk.yellow;
  return chalk.red;
}

/**
 * Create the callgraph command with subcommands
 */
export const callgraphCommand = new Command('callgraph')
  .description('Build and query call graphs for code reachability analysis')
  .option('--verbose', 'Enable verbose output')
  .action(statusAction);

// Subcommands
callgraphCommand
  .command('build')
  .description('Build the call graph from source files')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(buildAction);

callgraphCommand
  .command('status')
  .description('Show call graph overview and statistics')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-s, --security', 'Show security-prioritized view (P0-P4 tiers)')
  .action(statusAction);

callgraphCommand
  .command('reach <location>')
  .description('What data can this code reach? (file:line or function_name)')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-d, --max-depth <depth>', 'Maximum traversal depth', '10')
  .action((location, opts) => reachAction(location, { ...opts, maxDepth: parseInt(opts.maxDepth, 10) }));

callgraphCommand
  .command('inverse <target>')
  .description('Who can reach this data? (table or table.field)')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-d, --max-depth <depth>', 'Maximum traversal depth', '10')
  .action((target, opts) => inverseAction(target, { ...opts, maxDepth: parseInt(opts.maxDepth, 10) }));

callgraphCommand
  .command('function <name>')
  .description('Show details about a specific function')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(functionAction);

callgraphCommand
  .command('impact <target>')
  .description('What breaks if I change this? (file path or function name)')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .action(impactAction);

callgraphCommand
  .command('dead')
  .description('Find dead code (functions never called)')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-c, --confidence <level>', 'Minimum confidence (high, medium, low)', 'low')
  .option('--include-exported', 'Include exported functions (might be used externally)')
  .option('--include-tests', 'Include test files')
  .action(deadCodeAction);

callgraphCommand
  .command('coverage')
  .description('Analyze test coverage for sensitive data access paths')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--sensitive', 'Show sensitive field details (default: true)')
  .action(coverageAction);
