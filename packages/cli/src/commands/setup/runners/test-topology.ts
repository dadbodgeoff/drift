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

import {
  createHybridTestTopologyAnalyzer,
  createCallGraphAnalyzer,
} from 'driftdetect-core';

/**
 * Directories to skip when searching for test files
 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', '.svn', '.hg',
  'coverage', '.next', '.nuxt', '.turbo', '__pycache__', 'venv',
  '.venv', 'env', '.env', 'vendor', 'target', 'bin', 'obj',
  '.idea', '.vscode', '.vs',
]);

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

/**
 * Recursively find test files (same as CLI command)
 */
async function findTestFiles(rootDir: string, subDir = ''): Promise<string[]> {
  const testFiles: string[] = [];
  const currentDir = path.join(rootDir, subDir);
  
  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      
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
      // Find test files (same as CLI command)
      spinner.text('Finding test files...');
      const testFiles = await findTestFiles(this.rootDir);

      if (testFiles.length === 0) {
        spinner.succeed('No test files found');
        return {
          enabled: true,
          success: true,
          timestamp: new Date().toISOString(),
          stats: { totalTests: 0, testFiles: 0 },
        };
      }

      // Initialize analyzer (same as CLI command - use hybrid analyzer)
      spinner.text('Loading parsers...');
      const analyzer = createHybridTestTopologyAnalyzer({});

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
