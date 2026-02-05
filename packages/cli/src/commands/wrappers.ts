/**
 * Wrappers Command
 *
 * Detect framework wrapper patterns in the codebase.
 *
 * Usage:
 *   drift wrappers                    # Scan current directory
 *   drift wrappers --json             # Output as JSON
 *   drift wrappers --verbose          # Show detailed output
 *   drift wrappers --include-tests    # Include test files
 *   drift wrappers --min-confidence 0.8  # Filter by confidence
 */

import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  isNativeAvailable,
  analyzeWrappersWithFallback,
} from 'driftdetect-core';

// =============================================================================
// Local Type Definitions (to avoid subpath import issues)
// =============================================================================

type WrapperCategory = 
  | 'state-management'
  | 'data-fetching'
  | 'side-effects'
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'dependency-injection'
  | 'middleware'
  | 'testing'
  | 'logging'
  | 'caching'
  | 'error-handling'
  | 'async-utilities'
  | 'form-handling'
  | 'routing'
  | 'factory'
  | 'decorator'
  | 'utility'
  | 'other';

interface WrapperFunction {
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  language: 'typescript' | 'python' | 'java' | 'csharp' | 'php' | 'rust' | 'cpp';
  directPrimitives: string[];
  transitivePrimitives: string[];
  primitiveSignature: string[];
  depth: number;
  callsWrappers: string[];
  calledBy: string[];
  isFactory: boolean;
  isHigherOrder: boolean;
  isDecorator: boolean;
  isAsync: boolean;
}

interface WrapperCluster {
  id: string;
  name: string;
  category: WrapperCategory;
  description: string;
  confidence: number;
  primitiveSignature: string[];
  wrappers: WrapperFunction[];
  avgDepth: number;
  maxDepth: number;
  totalUsages: number;
  fileSpread: number;
  suggestedNames: string[];
}

interface FrameworkInfo {
  name: string;
  primitiveCount: number;
}

interface WrapperScanResult {
  analysis: {
    clusters: WrapperCluster[];
    wrappers: WrapperFunction[];
    frameworks: FrameworkInfo[];
    primitives: unknown[];
    factories: unknown[];
    decoratorWrappers: unknown[];
    asyncWrappers: unknown[];
    summary: {
      totalWrappers: number;
      totalClusters: number;
      avgDepth: number;
      maxDepth: number;
      mostWrappedPrimitive: string;
      mostUsedWrapper: string;
      wrappersByLanguage: Record<string, number>;
      wrappersByCategory: Record<WrapperCategory, number>;
    };
  };
  stats: {
    totalFiles: number;
    totalFunctions: number;
    totalCalls: number;
    totalImports: number;
    byLanguage: Record<string, number>;
  };
  duration: number;
  errors: string[];
}

// =============================================================================
// Command Definition
// =============================================================================

export const wrappersCommand = new Command('wrappers')
  .description('Detect framework wrapper patterns in the codebase')
  .option('-d, --dir <path>', 'Project directory', '.')
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show detailed output')
  .option('--include-tests', 'Include test files in analysis')
  .option('--min-confidence <number>', 'Minimum cluster confidence (0-1)', '0.5')
  .option('--min-cluster-size <number>', 'Minimum cluster size', '2')
  .option('--max-depth <number>', 'Maximum wrapper depth to traverse', '10')
  .option('--category <category>', 'Filter by category')
  .action(async (options) => {
    const rootDir = path.resolve(options.dir);
    const verbose = options.verbose || false;
    const jsonOutput = options.json || false;
    // Note: includeTests and maxDepth options are parsed but not yet used
    // They are reserved for future implementation
    const minConfidence = parseFloat(options.minConfidence);
    const minClusterSize = parseInt(options.minClusterSize, 10);
    const categoryFilter = options.category;

    if (!jsonOutput) {
      console.log(chalk.cyan('\n🔍 Scanning for framework wrappers...\n'));
    }

    try {
      // Try native analyzer first (much faster)
      if (isNativeAvailable()) {
        try {
          const files = await getSourceFiles(rootDir);
          const nativeResult = await analyzeWrappersWithFallback(rootDir, files);
          
          // Convert native WrapperInfo to WrapperFunction format
          const convertedWrappers: WrapperFunction[] = nativeResult.wrappers.map(w => ({
            name: w.name,
            qualifiedName: w.name,
            file: w.file,
            line: w.line,
            language: 'typescript' as const,
            directPrimitives: w.wraps,
            transitivePrimitives: [],
            primitiveSignature: w.wraps,
            depth: 1,
            callsWrappers: [],
            calledBy: [],
            isFactory: false,
            isHigherOrder: false,
            isDecorator: false,
            isAsync: false,
          }));
          
          // Convert native WrapperCluster to TypeScript WrapperCluster format
          let clusters: WrapperCluster[] = nativeResult.clusters.map(c => ({
            id: c.id,
            name: c.wrappedPrimitive, // Use wrappedPrimitive as name
            category: c.category as WrapperCluster['category'],
            description: `Wrappers for ${c.wrappedPrimitive}`,
            confidence: c.confidence,
            primitiveSignature: [c.wrappedPrimitive],
            wrappers: c.wrappers.map(w => ({
              name: w.name,
              qualifiedName: w.name,
              file: w.file,
              line: w.line,
              language: 'typescript' as const,
              directPrimitives: w.wraps,
              transitivePrimitives: [],
              primitiveSignature: w.wraps,
              depth: 1,
              callsWrappers: [],
              calledBy: [],
              isFactory: false,
              isHigherOrder: false,
              isDecorator: false,
              isAsync: false,
            })),
            avgDepth: 1,
            maxDepth: 1,
            totalUsages: c.totalUsage,
            fileSpread: new Set(c.wrappers.map(w => w.file)).size,
            suggestedNames: [],
          }));
          
          // Filter by category if specified
          if (categoryFilter) {
            clusters = clusters.filter(c => c.category === categoryFilter);
          }
          
          // Filter by confidence and cluster size
          clusters = clusters.filter(c => 
            c.confidence >= minConfidence && 
            c.wrappers.length >= minClusterSize
          );
          
          // Build category counts with proper typing
          const wrappersByCategory: Record<WrapperCluster['category'], number> = {
            'state-management': 0,
            'data-fetching': 0,
            'side-effects': 0,
            'authentication': 0,
            'authorization': 0,
            'validation': 0,
            'dependency-injection': 0,
            'middleware': 0,
            'testing': 0,
            'logging': 0,
            'caching': 0,
            'error-handling': 0,
            'async-utilities': 0,
            'form-handling': 0,
            'routing': 0,
            'factory': 0,
            'decorator': 0,
            'utility': 0,
            'other': 0,
          };
          for (const cat of nativeResult.stats.byCategory) {
            if (cat.category in wrappersByCategory) {
              wrappersByCategory[cat.category as WrapperCluster['category']] = cat.count;
            }
          }
          
          // Find most wrapped primitive and most used wrapper
          const topPrimitive = nativeResult.stats.topPrimitives?.[0];
          const firstWrapper = convertedWrappers[0];
          const mostUsedWrapper = firstWrapper?.name ?? '';
          
          const result: WrapperScanResult = {
            analysis: {
              clusters,
              wrappers: convertedWrappers,
              frameworks: [],
              primitives: [],
              factories: [],
              decoratorWrappers: [],
              asyncWrappers: [],
              summary: {
                totalWrappers: nativeResult.stats.totalWrappers,
                totalClusters: nativeResult.stats.clusterCount,
                avgDepth: 1,
                maxDepth: 1,
                mostWrappedPrimitive: topPrimitive?.primitive ?? '',
                mostUsedWrapper,
                wrappersByLanguage: { 
                  typescript: nativeResult.wrappers.length,
                  python: 0,
                  java: 0,
                  csharp: 0,
                  php: 0,
                  rust: 0,
                  cpp: 0,
                },
                wrappersByCategory,
              },
            },
            stats: {
              totalFiles: nativeResult.stats.filesAnalyzed,
              totalFunctions: nativeResult.wrappers.length,
              totalCalls: 0,
              totalImports: 0,
              byLanguage: {},
            },
            duration: nativeResult.stats.durationMs,
            errors: [],
          };

          if (jsonOutput) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            if (!jsonOutput) {
              console.log(chalk.gray(`  (native analyzer, ${nativeResult.stats.durationMs}ms)\n`));
            }
            printResults(result, verbose);
          }
          return;
        } catch (nativeError) {
          if (verbose) {
            console.log(chalk.gray(`Native analyzer failed: ${(nativeError as Error).message}\n`));
          }
          throw nativeError;
        }
      } else {
        // Native analyzer not available
        throw new Error('Native wrapper analyzer not available. Please ensure the Rust native module is built.');
      }
    } catch (error) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: (error as Error).message }));
      } else {
        console.error(chalk.red(`Error: ${(error as Error).message}`));
      }
      process.exit(1);
    }
  });

/**
 * Get source files for scanning
 */
async function getSourceFiles(rootDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
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

// =============================================================================
// Output Formatting
// =============================================================================

function printResults(result: WrapperScanResult, verbose: boolean): void {
  const { analysis, stats, duration, errors } = result;

  // Summary header
  console.log(chalk.bold('📊 Wrapper Analysis Summary\n'));
  console.log(`  Files scanned:     ${chalk.cyan(stats.totalFiles)}`);
  console.log(`  Functions found:   ${chalk.cyan(stats.totalFunctions)}`);
  console.log(`  Wrappers detected: ${chalk.green(analysis.summary.totalWrappers)}`);
  console.log(`  Clusters found:    ${chalk.green(analysis.summary.totalClusters)}`);
  console.log(`  Duration:          ${chalk.gray(`${duration}ms`)}`);
  console.log();

  // Frameworks detected
  if (analysis.frameworks.length > 0) {
    console.log(chalk.bold('🔧 Frameworks Detected\n'));
    for (const fw of analysis.frameworks) {
      console.log(`  ${chalk.cyan(fw.name)} - ${fw.primitiveCount} primitives`);
    }
    console.log();
  }

  // Clusters
  if (analysis.clusters.length > 0) {
    console.log(chalk.bold('📦 Wrapper Clusters\n'));

    for (const cluster of analysis.clusters) {
      printCluster(cluster, verbose);
    }
  } else {
    console.log(chalk.yellow('  No wrapper clusters found.\n'));
    console.log(chalk.gray('  This could mean:'));
    console.log(chalk.gray('  - No framework primitives are being wrapped'));
    console.log(chalk.gray('  - The codebase uses primitives directly'));
    console.log(chalk.gray('  - Try lowering --min-confidence or --min-cluster-size'));
    console.log();
  }

  // Top wrappers by usage
  if (analysis.wrappers.length > 0 && verbose) {
    console.log(chalk.bold('🏆 Most Used Wrappers\n'));

    const topWrappers = [...analysis.wrappers]
      .sort((a, b) => b.calledBy.length - a.calledBy.length)
      .slice(0, 10);

    for (const wrapper of topWrappers) {
      printWrapper(wrapper);
    }
    console.log();
  }

  // Errors
  if (errors.length > 0) {
    console.log(chalk.yellow(`⚠️  ${errors.length} errors during scan\n`));
    if (verbose) {
      for (const error of errors) {
        console.log(chalk.gray(`  ${error}`));
      }
      console.log();
    }
  }

  // Category breakdown
  const categoryBreakdown = Object.entries(analysis.summary.wrappersByCategory)
    .filter(([, count]) => (count) > 0)
    .sort((a, b) => (b[1]) - (a[1]));

  if (categoryBreakdown.length > 0) {
    console.log(chalk.bold('📈 Wrappers by Category\n'));
    for (const [category, count] of categoryBreakdown) {
      const numCount = count;
      const bar = '█'.repeat(Math.min(numCount, 30));
      console.log(`  ${chalk.cyan(category.padEnd(20))} ${bar} ${numCount}`);
    }
    console.log();
  }
}

function printCluster(cluster: WrapperCluster, verbose: boolean): void {
  const confidenceColor =
    cluster.confidence >= 0.8
      ? chalk.green
      : cluster.confidence >= 0.5
        ? chalk.yellow
        : chalk.red;

  console.log(
    `  ${chalk.bold(cluster.name)} ${chalk.gray(`(${cluster.category})`)} ` +
      `${confidenceColor(`${Math.round(cluster.confidence * 100)}%`)}`
  );
  console.log(chalk.gray(`    ${cluster.description}`));
  console.log(
    chalk.gray(
      `    Primitives: ${cluster.primitiveSignature.slice(0, 5).join(', ')}` +
        (cluster.primitiveSignature.length > 5
          ? ` +${cluster.primitiveSignature.length - 5} more`
          : '')
    )
  );
  console.log(
    chalk.gray(
      `    ${cluster.wrappers.length} wrappers, avg depth ${cluster.avgDepth.toFixed(1)}, ` +
        `${cluster.totalUsages} usages`
    )
  );

  if (verbose && cluster.wrappers.length > 0) {
    console.log(chalk.gray('    Members:'));
    for (const wrapper of cluster.wrappers.slice(0, 5)) {
      console.log(
        chalk.gray(`      - ${wrapper.name} (${wrapper.file}:${wrapper.line})`)
      );
    }
    if (cluster.wrappers.length > 5) {
      console.log(chalk.gray(`      ... +${cluster.wrappers.length - 5} more`));
    }
  }

  console.log();
}

function printWrapper(wrapper: WrapperFunction): void {
  const usageCount = wrapper.calledBy.length;
  const depthIndicator = '→'.repeat(wrapper.depth);

  console.log(
    `  ${chalk.cyan(wrapper.name)} ${chalk.gray(depthIndicator)} ` +
      `${chalk.green(`${usageCount} usages`)}`
  );
  console.log(chalk.gray(`    ${wrapper.file}:${wrapper.line}`));
  console.log(
    chalk.gray(`    Wraps: ${wrapper.primitiveSignature.slice(0, 3).join(', ')}`)
  );
}

export default wrappersCommand;
