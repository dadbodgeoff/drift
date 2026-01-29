/**
 * Module Coupling Command - drift coupling
 *
 * Analyze module dependencies, detect cycles, and calculate coupling metrics.
 * Based on Robert C. Martin's coupling metrics (Ca, Ce, Instability, Abstractness, Distance).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  createModuleCouplingAnalyzer,
  createCallGraphAnalyzer,
  isNativeAvailable,
  analyzeCouplingWithFallback,
  type ModuleCouplingGraph,
  type DependencyCycle,
  type ModuleCouplingAnalysis,
  type RefactorImpact,
  type UnusedExportAnalysis,
  type CouplingMetrics,
} from 'driftdetect-core';

import { createSpinner } from '../ui/spinner.js';

export interface CouplingOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
  limit?: number;
  minCoupling?: number;
  maxCycleLength?: number;
  minSeverity?: 'info' | 'warning' | 'critical';
}

const DRIFT_DIR = '.drift';
const COUPLING_DIR = 'module-coupling';

/**
 * Check if coupling data exists
 */
async function couplingExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, COUPLING_DIR, 'graph.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when coupling not built
 */
function showNotBuiltMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  No module coupling graph built yet.'));
  console.log();
  console.log(chalk.gray('Build coupling graph to analyze dependencies:'));
  console.log();
  console.log(chalk.cyan('  drift coupling build'));
  console.log();
}

/**
 * Build subcommand - analyze modules and build coupling graph
 */
async function buildAction(options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const verbose = options.verbose ?? false;
  const isTextFormat = format === 'text';

  try {
    if (isTextFormat) {
      console.log();
      console.log(chalk.bold('🔗 Building Module Coupling Graph'));
      console.log(chalk.gray('═'.repeat(50)));
    }

    const spinner = isTextFormat ? createSpinner('Initializing...') : null;
    spinner?.start();

    // Try native analyzer first (much faster)
    if (isNativeAvailable()) {
      try {
        spinner?.text('Analyzing module coupling (native)...');
        
        // Get file list
        const files = await getSourceFiles(rootDir);
        const nativeResult = await analyzeCouplingWithFallback(rootDir, files);
        
        // Save results
        spinner?.text('Saving results...');
        const couplingDir = path.join(rootDir, DRIFT_DIR, COUPLING_DIR);
        await fs.mkdir(couplingDir, { recursive: true });
        
        // Convert native result to graph format
        const serializedGraph = {
          modules: Object.fromEntries(nativeResult.modules.map(m => [m.path, {
            path: m.path,
            imports: [],
            importedBy: [],
            exports: [],
            metrics: {
              Ca: m.ca,
              Ce: m.ce,
              instability: m.instability,
              abstractness: m.abstractness,
              distance: m.distance,
            },
            role: 'balanced',
            isEntryPoint: false,
            isLeaf: m.ce === 0,
          }])),
          edges: [],
          cycles: nativeResult.cycles.map((c, i) => ({
            id: `cycle-${i}`,
            path: c.modules,
            length: c.modules.length,
            severity: c.severity,
            totalWeight: c.filesAffected,
            breakPoints: [],
          })),
          metrics: {
            totalModules: nativeResult.modules.length,
            totalEdges: 0,
            cycleCount: nativeResult.cycles.length,
            avgInstability: nativeResult.modules.reduce((sum, m) => sum + m.instability, 0) / Math.max(1, nativeResult.modules.length),
            avgDistance: nativeResult.modules.reduce((sum, m) => sum + m.distance, 0) / Math.max(1, nativeResult.modules.length),
            zoneOfPain: [] as string[],
            zoneOfUselessness: [] as string[],
            hotspots: nativeResult.hotspots.map(h => ({ path: h.module, coupling: h.totalCoupling })),
            isolatedModules: [] as string[],
          },
          generatedAt: new Date().toISOString(),
          projectRoot: rootDir,
        };
        
        await fs.writeFile(
          path.join(couplingDir, 'graph.json'),
          JSON.stringify(serializedGraph, null, 2)
        );
        
        spinner?.stop();
        
        // Output
        if (format === 'json') {
          console.log(JSON.stringify({
            success: true,
            native: true,
            modules: nativeResult.modules.length,
            cycles: nativeResult.cycles.length,
            hotspots: nativeResult.hotspots.length,
            healthScore: nativeResult.healthScore,
            filesAnalyzed: nativeResult.filesAnalyzed,
            durationMs: nativeResult.durationMs,
          }, null, 2));
          return;
        }
        
        // Text output
        console.log();
        console.log(chalk.green.bold('✓ Module coupling graph built successfully (native)'));
        console.log();
        console.log(`Files analyzed: ${chalk.cyan(nativeResult.filesAnalyzed)}`);
        console.log(`Modules: ${chalk.cyan(nativeResult.modules.length)}`);
        console.log(`Cycles: ${nativeResult.cycles.length > 0 ? chalk.yellow(nativeResult.cycles.length) : chalk.green('0')}`);
        console.log(`Health score: ${chalk.cyan(nativeResult.healthScore)}/100`);
        console.log(`Duration: ${chalk.gray(`${nativeResult.durationMs}ms`)}`);
        console.log();
        
        formatMetrics(serializedGraph.metrics);
        formatCycleSummary(serializedGraph.cycles);
        
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.bold('📌 Next Steps:'));
        console.log(chalk.gray(`  • drift coupling status       ${chalk.white('View coupling overview')}`));
        console.log(chalk.gray(`  • drift coupling cycles       ${chalk.white('List dependency cycles')}`));
        console.log(chalk.gray(`  • drift coupling hotspots     ${chalk.white('Find highly coupled modules')}`));
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

    // Initialize coupling analyzer
    spinner?.text('Analyzing module dependencies...');
    const analyzer = createModuleCouplingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);

    // Build the graph
    spinner?.text('Building coupling graph...');
    const graph = analyzer.build();

    // Save results
    spinner?.text('Saving results...');
    const couplingDir = path.join(rootDir, DRIFT_DIR, COUPLING_DIR);
    await fs.mkdir(couplingDir, { recursive: true });

    // Serialize the graph (convert Map to object)
    const serializedGraph = {
      modules: Object.fromEntries(graph.modules),
      edges: graph.edges,
      cycles: graph.cycles,
      metrics: graph.metrics,
      generatedAt: graph.generatedAt,
      projectRoot: graph.projectRoot,
    };

    await fs.writeFile(
      path.join(couplingDir, 'graph.json'),
      JSON.stringify(serializedGraph, null, 2)
    );

    spinner?.stop();

    // Output
    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        modules: graph.modules.size,
        edges: graph.edges.length,
        cycles: graph.cycles.length,
        metrics: graph.metrics,
      }, null, 2));
      return;
    }

    // Text output
    console.log();
    console.log(chalk.green.bold('✓ Module coupling graph built successfully'));
    console.log();

    formatMetrics(graph.metrics);
    formatCycleSummary(graph.cycles);

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift coupling status       ${chalk.white('View coupling overview')}`));
    console.log(chalk.gray(`  • drift coupling cycles       ${chalk.white('List dependency cycles')}`));
    console.log(chalk.gray(`  • drift coupling hotspots     ${chalk.white('Find highly coupled modules')}`));
    console.log(chalk.gray(`  • drift coupling analyze <m>  ${chalk.white('Analyze specific module')}`));
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
 * Status subcommand - show coupling overview
 */
async function statusAction(options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await couplingExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No coupling graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, COUPLING_DIR, 'graph.json'), 'utf-8')
    );

    if (format === 'json') {
      console.log(JSON.stringify(data.metrics, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔗 Module Coupling Status'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatMetrics(data.metrics);
    formatCycleSummary(data.cycles);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Cycles subcommand - list dependency cycles
 */
async function cyclesAction(options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const maxLength = options.maxCycleLength ?? 10;
  const minSeverity = options.minSeverity ?? 'info';

  if (!(await couplingExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No coupling graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, COUPLING_DIR, 'graph.json'), 'utf-8')
    );

    let cycles: DependencyCycle[] = data.cycles;

    // Filter by length
    cycles = cycles.filter(c => c.length <= maxLength);

    // Filter by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const minOrder = severityOrder[minSeverity];
    cycles = cycles.filter(c => severityOrder[c.severity] <= minOrder);

    if (format === 'json') {
      console.log(JSON.stringify({ cycles, total: cycles.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔄 Dependency Cycles'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (cycles.length === 0) {
      console.log(chalk.green('✓ No dependency cycles found!'));
      console.log();
      return;
    }

    formatCycles(cycles);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Hotspots subcommand - find highly coupled modules
 */
async function hotspotsAction(options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 15;
  const minCoupling = options.minCoupling ?? 3;

  if (!(await couplingExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'No coupling graph found' }));
    } else {
      showNotBuiltMessage();
    }
    return;
  }

  try {
    const data = JSON.parse(
      await fs.readFile(path.join(rootDir, DRIFT_DIR, COUPLING_DIR, 'graph.json'), 'utf-8')
    ) as { modules: Record<string, { metrics: { Ca: number; Ce: number; instability: number; abstractness: number; distance: number } }> };

    const modules = Object.entries(data.modules);
    const hotspots = modules
      .map(([modPath, mod]) => ({
        path: modPath,
        coupling: mod.metrics.Ca + mod.metrics.Ce,
        metrics: mod.metrics,
      }))
      .filter(h => h.coupling >= minCoupling)
      .sort((a, b) => b.coupling - a.coupling)
      .slice(0, limit);

    if (format === 'json') {
      console.log(JSON.stringify({ hotspots }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔥 Coupling Hotspots'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (hotspots.length === 0) {
      console.log(chalk.green('✓ No highly coupled modules found!'));
      console.log();
      return;
    }

    formatHotspots(hotspots);

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Analyze subcommand - analyze specific module
 */
async function analyzeAction(modulePath: string, options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Analyzing module...') : null;
  spinner?.start();

  try {
    // Load call graph and rebuild analyzer
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

    const analyzer = createModuleCouplingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);
    analyzer.build();

    const analysis = analyzer.analyzeModule(modulePath);

    spinner?.stop();

    if (!analysis) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: `Module not found: ${modulePath}` }));
      } else {
        console.log(chalk.yellow(`\n⚠️  Module not found: ${modulePath}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`📦 Module Analysis: ${modulePath}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatModuleAnalysis(analysis);

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
 * Refactor-impact subcommand - analyze impact of refactoring a module
 */
async function refactorImpactAction(modulePath: string, options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Analyzing refactor impact...') : null;
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

    const analyzer = createModuleCouplingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);
    analyzer.build();

    const impact = analyzer.analyzeRefactorImpact(modulePath);

    spinner?.stop();

    if (!impact) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: `Module not found: ${modulePath}` }));
      } else {
        console.log(chalk.yellow(`\n⚠️  Module not found: ${modulePath}`));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify(impact, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`🔧 Refactor Impact: ${modulePath}`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    formatRefactorImpact(impact);

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
 * Unused-exports subcommand - find unused exports
 */
async function unusedExportsAction(options: CouplingOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = options.limit ?? 20;

  const spinner = format === 'text' ? createSpinner('Finding unused exports...') : null;
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

    const analyzer = createModuleCouplingAnalyzer({ rootDir });
    analyzer.setCallGraph(callGraph);
    analyzer.build();

    const unused = analyzer.getUnusedExports().slice(0, limit);

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ unused, total: unused.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('📤 Unused Exports'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (unused.length === 0) {
      console.log(chalk.green('✓ No unused exports found!'));
      console.log();
      return;
    }

    formatUnusedExports(unused);

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

function formatMetrics(metrics: ModuleCouplingGraph['metrics']): void {
  console.log(chalk.bold('📊 Overview'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Modules:         ${chalk.cyan.bold(metrics.totalModules)}`);
  console.log(`  Dependencies:    ${chalk.cyan.bold(metrics.totalEdges)}`);
  console.log(`  Cycles:          ${getCycleColor(metrics.cycleCount)}`);
  console.log();

  console.log(chalk.bold('📈 Metrics'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Avg Instability: ${getInstabilityColor(metrics.avgInstability)}`);
  console.log(`  Avg Distance:    ${getDistanceColor(metrics.avgDistance)}`);
  console.log();

  if (metrics.zoneOfPain.length > 0) {
    console.log(chalk.bold.red('⚠️  Zone of Pain (stable + concrete)'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const mod of metrics.zoneOfPain.slice(0, 5)) {
      console.log(`  ${chalk.red('●')} ${mod}`);
    }
    if (metrics.zoneOfPain.length > 5) {
      console.log(chalk.gray(`  ... and ${metrics.zoneOfPain.length - 5} more`));
    }
    console.log();
  }

  if (metrics.zoneOfUselessness.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Zone of Uselessness (unstable + abstract)'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const mod of metrics.zoneOfUselessness.slice(0, 5)) {
      console.log(`  ${chalk.yellow('●')} ${mod}`);
    }
    if (metrics.zoneOfUselessness.length > 5) {
      console.log(chalk.gray(`  ... and ${metrics.zoneOfUselessness.length - 5} more`));
    }
    console.log();
  }
}

function formatCycleSummary(cycles: DependencyCycle[]): void {
  if (cycles.length === 0) {
    console.log(chalk.green('✓ No dependency cycles detected'));
    console.log();
    return;
  }

  const critical = cycles.filter(c => c.severity === 'critical').length;
  const warning = cycles.filter(c => c.severity === 'warning').length;
  const info = cycles.filter(c => c.severity === 'info').length;

  console.log(chalk.bold('🔄 Cycle Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  if (critical > 0) {console.log(`  ${chalk.red('●')} Critical: ${chalk.red.bold(critical)}`);}
  if (warning > 0) {console.log(`  ${chalk.yellow('●')} Warning:  ${chalk.yellow.bold(warning)}`);}
  if (info > 0) {console.log(`  ${chalk.gray('●')} Info:     ${chalk.gray(info)}`);}
  console.log();
}

function formatCycles(cycles: DependencyCycle[]): void {
  for (const cycle of cycles) {
    const severityIcon = cycle.severity === 'critical' ? chalk.red('🔴') :
                        cycle.severity === 'warning' ? chalk.yellow('🟡') : chalk.gray('⚪');
    
    console.log(`${severityIcon} ${chalk.bold(`Cycle ${cycle.id}`)} (${cycle.length} modules)`);
    console.log(chalk.gray('  Path:'));
    for (let i = 0; i < cycle.path.length; i++) {
      const mod = cycle.path[i];
      const arrow = i < cycle.path.length - 1 ? '→' : '↩';
      console.log(`    ${mod} ${chalk.gray(arrow)}`);
    }

    if (cycle.breakPoints.length > 0) {
      const best = cycle.breakPoints[0]!;
      console.log(chalk.gray('  Suggested break:'));
      console.log(`    ${chalk.cyan(best.edge.from)} → ${chalk.cyan(best.edge.to)}`);
      console.log(chalk.gray(`    ${best.rationale}`));
      console.log(chalk.gray(`    Approach: ${best.approach}`));
    }
    console.log();
  }
}

function formatHotspots(hotspots: Array<{ path: string; coupling: number; metrics: CouplingMetrics }>): void {
  const maxCoupling = hotspots[0]?.coupling ?? 1;

  for (const { path: modPath, coupling, metrics } of hotspots) {
    const barLength = Math.ceil((coupling / maxCoupling) * 20);
    const bar = '█'.repeat(barLength);
    const couplingColor = coupling > 15 ? chalk.red : coupling > 8 ? chalk.yellow : chalk.green;

    console.log(`${couplingColor(bar)} ${chalk.white(modPath)}`);
    console.log(chalk.gray(`  Ca: ${metrics.Ca} (dependents) | Ce: ${metrics.Ce} (dependencies) | I: ${metrics.instability}`));
    console.log();
  }
}

function formatModuleAnalysis(analysis: ModuleCouplingAnalysis): void {
  const { module, directDependencies, directDependents, cyclesInvolved, health } = analysis;

  // Module info
  console.log(chalk.bold('Module Info'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Role:        ${getRoleIcon(module.role)} ${module.role}`);
  console.log(`  Exports:     ${module.exports.length}`);
  console.log(`  Entry Point: ${module.isEntryPoint ? chalk.green('Yes') : 'No'}`);
  console.log(`  Leaf:        ${module.isLeaf ? chalk.green('Yes') : 'No'}`);
  console.log();

  // Metrics
  console.log(chalk.bold('Coupling Metrics'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Ca (Afferent):   ${module.metrics.Ca} modules depend on this`);
  console.log(`  Ce (Efferent):   ${module.metrics.Ce} dependencies`);
  console.log(`  Instability:     ${getInstabilityColor(module.metrics.instability)}`);
  console.log(`  Abstractness:    ${module.metrics.abstractness}`);
  console.log(`  Distance:        ${getDistanceColor(module.metrics.distance)}`);
  console.log();

  // Dependencies
  if (directDependencies.length > 0) {
    console.log(chalk.bold('Dependencies'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const dep of directDependencies.slice(0, 10)) {
      console.log(`  → ${dep.path}`);
      if (dep.symbols.length > 0) {
        console.log(chalk.gray(`    Imports: ${dep.symbols.slice(0, 5).join(', ')}${dep.symbols.length > 5 ? '...' : ''}`));
      }
    }
    if (directDependencies.length > 10) {
      console.log(chalk.gray(`  ... and ${directDependencies.length - 10} more`));
    }
    console.log();
  }

  // Dependents
  if (directDependents.length > 0) {
    console.log(chalk.bold('Dependents'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const dep of directDependents.slice(0, 10)) {
      console.log(`  ← ${dep.path}`);
    }
    if (directDependents.length > 10) {
      console.log(chalk.gray(`  ... and ${directDependents.length - 10} more`));
    }
    console.log();
  }

  // Cycles
  if (cyclesInvolved.length > 0) {
    console.log(chalk.bold.yellow('⚠️  Involved in Cycles'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const cycle of cyclesInvolved) {
      console.log(`  ${cycle.id}: ${cycle.path.join(' → ')}`);
    }
    console.log();
  }

  // Health
  console.log(chalk.bold('Health Assessment'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Score: ${getHealthColor(health.score)}`);
  if (health.issues.length > 0) {
    console.log(chalk.gray('  Issues:'));
    for (const issue of health.issues) {
      console.log(`    ${chalk.yellow('•')} ${issue}`);
    }
  }
  if (health.suggestions.length > 0) {
    console.log(chalk.gray('  Suggestions:'));
    for (const suggestion of health.suggestions) {
      console.log(`    ${chalk.cyan('→')} ${suggestion}`);
    }
  }
  console.log();
}

function formatRefactorImpact(impact: RefactorImpact): void {
  const riskColor = impact.risk === 'critical' ? chalk.red :
                   impact.risk === 'high' ? chalk.yellow :
                   impact.risk === 'medium' ? chalk.cyan : chalk.green;

  console.log(chalk.bold('Impact Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  Affected Modules: ${chalk.cyan.bold(impact.totalAffected)}`);
  console.log(`  Risk Level:       ${riskColor(impact.risk.toUpperCase())}`);
  console.log();

  if (impact.affectedModules.length > 0) {
    console.log(chalk.bold('Affected Modules'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const mod of impact.affectedModules.slice(0, 15)) {
      const effortIcon = mod.effort === 'high' ? chalk.red('●') :
                        mod.effort === 'medium' ? chalk.yellow('●') : chalk.green('●');
      console.log(`  ${effortIcon} ${mod.path}`);
      console.log(chalk.gray(`    ${mod.reason}`));
    }
    if (impact.affectedModules.length > 15) {
      console.log(chalk.gray(`  ... and ${impact.affectedModules.length - 15} more`));
    }
    console.log();
  }

  if (impact.suggestions.length > 0) {
    console.log(chalk.bold('Suggestions'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const suggestion of impact.suggestions) {
      console.log(`  ${chalk.cyan('→')} ${suggestion}`);
    }
    console.log();
  }
}

function formatUnusedExports(unused: UnusedExportAnalysis[]): void {
  for (const { module, unusedExports, possibleReasons } of unused) {
    console.log(`${chalk.yellow('●')} ${module}`);
    for (const exp of unusedExports.slice(0, 5)) {
      console.log(chalk.gray(`  • ${exp.name} (${exp.kind})`));
    }
    if (unusedExports.length > 5) {
      console.log(chalk.gray(`  ... and ${unusedExports.length - 5} more`));
    }
    if (possibleReasons.length > 0) {
      console.log(chalk.gray(`  Possible: ${possibleReasons.join(', ')}`));
    }
    console.log();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getCycleColor(count: number): string {
  if (count === 0) {return chalk.green.bold('0');}
  if (count <= 3) {return chalk.yellow.bold(String(count));}
  return chalk.red.bold(String(count));
}

function getInstabilityColor(value: number): string {
  // Instability near 0.5 is ideal (balanced)
  const distance = Math.abs(value - 0.5);
  if (distance <= 0.2) {return chalk.green(value.toFixed(2));}
  if (distance <= 0.35) {return chalk.yellow(value.toFixed(2));}
  return chalk.red(value.toFixed(2));
}

function getDistanceColor(value: number): string {
  // Distance near 0 is ideal
  if (value <= 0.2) {return chalk.green(value.toFixed(2));}
  if (value <= 0.4) {return chalk.yellow(value.toFixed(2));}
  return chalk.red(value.toFixed(2));
}

function getHealthColor(score: number): string {
  if (score >= 70) {return chalk.green(`${score}/100`);}
  if (score >= 50) {return chalk.yellow(`${score}/100`);}
  return chalk.red(`${score}/100`);
}

function getRoleIcon(role: string): string {
  switch (role) {
    case 'hub': return '🎯';
    case 'authority': return '📚';
    case 'balanced': return '⚖️';
    case 'isolated': return '🏝️';
    default: return '📦';
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function createCouplingCommand(): Command {
  const cmd = new Command('coupling')
    .description('Analyze module dependencies and coupling metrics')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Enable verbose output');

  cmd
    .command('build')
    .description('Build module coupling graph')
    .action(() => buildAction(cmd.opts()));

  cmd
    .command('status')
    .description('Show coupling overview')
    .action(() => statusAction(cmd.opts()));

  cmd
    .command('cycles')
    .description('List dependency cycles')
    .option('-l, --max-cycle-length <number>', 'Maximum cycle length', '10')
    .option('-s, --min-severity <level>', 'Minimum severity (info, warning, critical)', 'info')
    .action((opts) => cyclesAction({ ...cmd.opts(), ...opts } as CouplingOptions));

  cmd
    .command('hotspots')
    .description('Find highly coupled modules')
    .option('-l, --limit <number>', 'Maximum results', '15')
    .option('-m, --min-coupling <number>', 'Minimum coupling threshold', '3')
    .action((opts) => hotspotsAction({ ...cmd.opts(), ...opts } as CouplingOptions));

  cmd
    .command('analyze <module>')
    .description('Analyze specific module coupling')
    .action((module) => analyzeAction(module, cmd.opts()));

  cmd
    .command('refactor-impact <module>')
    .description('Analyze impact of refactoring a module')
    .action((module) => refactorImpactAction(module, cmd.opts()));

  cmd
    .command('unused-exports')
    .description('Find unused exports')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .action((opts) => unusedExportsAction({ ...cmd.opts(), ...opts } as CouplingOptions));

  return cmd;
}
