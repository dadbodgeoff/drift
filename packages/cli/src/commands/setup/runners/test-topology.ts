/**
 * Test Topology Runner - Analyzes test-to-code mappings
 * 
 * Uses the same analysis flow as `drift test-topology build` to ensure
 * the saved format is compatible with `drift test-topology status`.
 * 
 * @module commands/setup/runners/test-topology
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { BaseRunner, type RunnerContext } from './base.js';
import { createSpinner } from '../../../ui/spinner.js';
import { DRIFT_DIR, type FeatureResult } from '../types.js';
import { findSourceFiles } from '../utils.js';

import {
  createTestTopologyAnalyzer,
  createCallGraphAnalyzer,
} from 'driftdetect-core';

/**
 * Test file patterns (regex) - matches common test file naming conventions
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

function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(filename));
}

export class TestTopologyRunner extends BaseRunner {
  constructor(ctx: RunnerContext) {
    super(ctx);
  }

  get name(): string {
    return 'Test Topology';
  }

  get icon(): string {
    return '🧪';
  }

  get description(): string {
    return 'Maps tests to code, finds untested functions.';
  }

  get benefit(): string {
    return 'Answer: "Which tests cover this?" and "What\'s untested?"';
  }

  get manualCommand(): string {
    return 'drift test-topology build';
  }

  async run(): Promise<FeatureResult> {
    const spinner = createSpinner('Building test topology...');
    spinner.start();

    try {
      spinner.text('Finding source files...');
      const allFiles = await findSourceFiles(this.rootDir);
      const testFiles = allFiles.filter(f => isTestFile(f));

      if (testFiles.length === 0) {
        spinner.succeed('No test files found');
        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: { totalTests: 0, testFiles: 0, filesAnalyzed: allFiles.length },
        };
      }

      // Initialize analyzer (same as drift test-topology build)
      spinner.text('Loading parsers...');
      const analyzer = createTestTopologyAnalyzer({});

      // Try to load call graph for transitive analysis
      spinner.text('Loading call graph...');
      try {
        const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: this.rootDir });
        await callGraphAnalyzer.initialize();
        const graph = callGraphAnalyzer.getGraph();
        if (graph) {
          analyzer.setCallGraph(graph);
        }
      } catch {
        // Continue without call graph
      }

      // Extract tests from each file
      spinner.text(`Extracting tests from ${testFiles.length} files...`);
      let extractedCount = 0;

      for (const testFile of testFiles) {
        try {
          const content = await fs.readFile(path.join(this.rootDir, testFile), 'utf-8');
          const extraction = analyzer.extractFromFile(content, testFile);
          if (extraction) {
            extractedCount++;
          }
        } catch {
          // Skip unreadable files
        }
      }

      // Build mappings
      spinner.text('Building test-to-code mappings...');
      analyzer.buildMappings();

      // Get results
      const summary = analyzer.getSummary();
      const mockAnalysis = analyzer.analyzeMocks();

      // Save results in the SAME FORMAT as `drift test-topology build`
      // This ensures `drift test-topology status` works correctly
      const topologyDir = path.join(this.rootDir, DRIFT_DIR, 'test-topology');
      await fs.mkdir(topologyDir, { recursive: true });
      await fs.writeFile(
        path.join(topologyDir, 'summary.json'),
        JSON.stringify({ summary, mockAnalysis, generatedAt: new Date().toISOString() }, null, 2)
      );

      spinner.succeed(`Test topology built: ${summary.testCases} tests in ${summary.testFiles} files`);

      return {
        enabled: true,
        success: true,
        timestamp: new Date().toISOString(),
        stats: {
          totalTests: summary.testCases,
          testFiles: summary.testFiles,
          filesAnalyzed: allFiles.length,
          extractedFiles: extractedCount,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.fail(`Test topology failed: ${msg}`);

      if (this.verbose && error instanceof Error) {
        console.error(error.stack);
      }

      return {
        enabled: true,
        success: false,
        error: msg,
      };
    }
  }
}
