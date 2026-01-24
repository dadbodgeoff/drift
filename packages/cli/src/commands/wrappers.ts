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

import { Command } from 'commander';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  createWrapperScanner,
  type WrapperScanResult,
  type WrapperCluster,
  type WrapperFunction,
} from 'driftdetect-core/wrappers';

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
    const includeTests = options.includeTests || false;
    const minConfidence = parseFloat(options.minConfidence);
    const minClusterSize = parseInt(options.minClusterSize, 10);
    const maxDepth = parseInt(options.maxDepth, 10);
    const categoryFilter = options.category;

    if (!jsonOutput) {
      console.log(chalk.cyan('\n🔍 Scanning for framework wrappers...\n'));
    }

    try {
      const scanner = createWrapperScanner({
        rootDir,
        includeTestFiles: includeTests,
        verbose,
      });

      const result = await scanner.scan({
        minConfidence,
        minClusterSize,
        maxDepth,
        includeTestFiles: includeTests,
      });

      // Filter by category if specified
      if (categoryFilter) {
        result.analysis.clusters = result.analysis.clusters.filter(
          (c: WrapperCluster) => c.category === categoryFilter
        );
      }

      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printResults(result, verbose);
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
    .filter(([, count]) => (count as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number));

  if (categoryBreakdown.length > 0) {
    console.log(chalk.bold('📈 Wrappers by Category\n'));
    for (const [category, count] of categoryBreakdown) {
      const numCount = count as number;
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
