/**
 * drift_test_topology - Test Topology Analysis
 * 
 * Analysis tool for test-to-code mappings, mock patterns, and test quality.
 * Answers: "Which tests cover this code?" and "What's the minimum test set?"
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createTestTopologyAnalyzer,
  createCallGraphAnalyzer,
  shouldIgnoreDirectory,
  type TestTopologySummary,
  type MockAnalysis,
  type MinimumTestSet,
  type UncoveredFunction,
  type TestCoverage,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type TestTopologyAction = 
  | 'status'
  | 'coverage'
  | 'uncovered'
  | 'mocks'
  | 'affected'
  | 'quality';

export interface TestTopologyArgs {
  action: TestTopologyAction;
  file?: string;
  files?: string[];
  limit?: number;
  minRisk?: 'low' | 'medium' | 'high';
}

export interface TestTopologyStatusData {
  summary: TestTopologySummary;
  mockAnalysis: MockAnalysis;
  generatedAt?: string;
}

export interface TestTopologyCoverageData {
  file: string;
  coverage: TestCoverage;
}

export interface TestTopologyUncoveredData {
  uncovered: UncoveredFunction[];
  total: number;
}

export interface TestTopologyMocksData {
  analysis: MockAnalysis;
  warnings: string[];
}

export interface TestTopologyAffectedData {
  changedFiles: string[];
  result: MinimumTestSet;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const TEST_TOPOLOGY_DIR = 'test-topology';

// ============================================================================
// Handler
// ============================================================================

export async function handleTestTopology(
  projectRoot: string,
  args: TestTopologyArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'status':
      return handleStatus(projectRoot);
    case 'coverage':
      return handleCoverage(projectRoot, args.file);
    case 'uncovered':
      return handleUncovered(projectRoot, args.limit, args.minRisk);
    case 'mocks':
      return handleMocks(projectRoot);
    case 'affected':
      return handleAffected(projectRoot, args.files ?? []);
    case 'quality':
      return handleQuality(projectRoot, args.file);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid actions: status, coverage, uncovered, mocks, affected, quality`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleStatus(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TestTopologyStatusData>();

  // Try to load cached data first
  const summaryPath = path.join(projectRoot, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json');
  
  try {
    const data = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    
    const { summary, mockAnalysis } = data;
    
    let summaryText = `🧪 ${summary.testCases} tests in ${summary.testFiles} files. `;
    summaryText += `Coverage: ${summary.functionCoveragePercent}% functions. `;
    summaryText += `Quality: ${summary.avgQualityScore}/100.`;
    
    const hints = {
      nextActions: [
        summary.functionCoveragePercent < 50 
          ? 'Run drift_test_topology action="uncovered" to find gaps'
          : 'Good coverage - consider drift_test_topology action="mocks" for quality',
      ],
      relatedTools: ['drift_test_topology action="uncovered"', 'drift_test_topology action="mocks"'],
    };
    
    return builder
      .withSummary(summaryText)
      .withData({ summary, mockAnalysis, generatedAt: data.generatedAt })
      .withHints(hints)
      .buildContent();
      
  } catch {
    // No cached data - try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      const summary = analyzer.getSummary();
      const mockAnalysis = analyzer.analyzeMocks();
      
      let summaryText = `🧪 ${summary.testCases} tests in ${summary.testFiles} files. `;
      summaryText += `Coverage: ${summary.functionCoveragePercent}% functions. `;
      summaryText += `Quality: ${summary.avgQualityScore}/100.`;
      
      const hints = {
        nextActions: [
          summary.functionCoveragePercent < 50 
            ? 'Run drift_test_topology action="uncovered" to find gaps'
            : 'Good coverage - consider drift_test_topology action="mocks" for quality',
        ],
        relatedTools: ['drift_test_topology action="uncovered"', 'drift_test_topology action="mocks"'],
      };
      
      return builder
        .withSummary(summaryText)
        .withData({ summary, mockAnalysis })
        .withHints(hints)
        .buildContent();
    } catch {
      // Return graceful empty state
      return builder
        .withSummary('🧪 Test topology analysis not available. Run a scan first.')
        .withData({ 
          summary: { testCases: 0, testFiles: 0, functionCoveragePercent: 0, avgQualityScore: 0, byFramework: {}, avgMockRatio: 0 } as unknown as TestTopologySummary,
          mockAnalysis: { totalMocks: 0, externalMocks: 0, internalMocks: 0, externalPercent: 0, internalPercent: 0, avgMockRatio: 0, highMockRatioTests: [], topMockedModules: [] } as MockAnalysis
        })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase first'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }
}

async function handleCoverage(
  projectRoot: string,
  file?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TestTopologyCoverageData>();

  if (!file) {
    throw Errors.missingParameter('file');
  }

  // Build analyzer on-demand
  const analyzer = await buildAnalyzer(projectRoot);
  const coverage = analyzer.getCoverage(file);

  if (!coverage) {
    throw Errors.custom(
      'NO_COVERAGE_DATA',
      `No coverage data for ${file}. Ensure call graph is built.`,
      ['drift callgraph build']
    );
  }

  const coveredCount = coverage.functions.filter((f: { isCovered: boolean }) => f.isCovered).length;
  let summaryText = `📊 ${file}: ${coverage.coveragePercent}% coverage. `;
  summaryText += `${coveredCount}/${coverage.functions.length} functions tested.`;

  const uncoveredFunctions = coverage.functions
    .filter((f: { isCovered: boolean; name: string }) => !f.isCovered && f.name !== '__module__')
    .map((f: { name: string }) => f.name);

  const hints = {
    nextActions: uncoveredFunctions.length > 0
      ? [`Add tests for: ${uncoveredFunctions.slice(0, 3).join(', ')}`]
      : ['Full coverage achieved!'],
    relatedTools: ['drift_test_topology action="uncovered"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ file, coverage })
    .withHints(hints)
    .buildContent();
}

async function handleUncovered(
  projectRoot: string,
  limit?: number,
  minRisk?: 'low' | 'medium' | 'high'
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TestTopologyUncoveredData>();

  const analyzer = await buildAnalyzer(projectRoot);
  const rawUncovered = analyzer.getUncoveredFunctions({
    limit: (limit ?? 20) + 20, // Request extra to account for filtering
    minRisk: minRisk ?? 'medium',
    includeReasons: true,
  });

  // Filter out __module__ entries - they're not useful for test coverage
  const uncovered = rawUncovered
    .filter((f: { qualifiedName: string }) => f.qualifiedName !== '__module__')
    .slice(0, limit ?? 20);

  const highRisk = uncovered.filter((f: { riskScore: number }) => f.riskScore >= 60);
  const mediumRisk = uncovered.filter((f: { riskScore: number }) => f.riskScore >= 30 && f.riskScore < 60);

  let summaryText = `🔍 ${uncovered.length} uncovered functions. `;
  if (highRisk.length > 0) {
    summaryText += `🔴 ${highRisk.length} high risk. `;
  }
  if (mediumRisk.length > 0) {
    summaryText += `🟡 ${mediumRisk.length} medium risk.`;
  }

  const hints = {
    nextActions: highRisk.length > 0
      ? [`Priority: Add tests for ${highRisk[0]?.qualifiedName === '__module__' ? 'module-level code' : (highRisk[0]?.qualifiedName ?? 'high-risk functions')}`]
      : ['Consider adding tests for medium-risk functions'],
    warnings: highRisk.filter((f: { accessesSensitiveData: boolean }) => f.accessesSensitiveData).length > 0
      ? ['Some uncovered functions access sensitive data']
      : undefined,
    relatedTools: ['drift_impact_analysis', 'drift_reachability'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ uncovered, total: uncovered.length })
    .withHints(hints)
    .buildContent();
}

async function handleMocks(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TestTopologyMocksData>();

  // First try cached data
  const summaryPath = path.join(projectRoot, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json');
  
  let mockAnalysis: MockAnalysis;
  
  try {
    const data = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    mockAnalysis = data.mockAnalysis;
  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      mockAnalysis = analyzer.analyzeMocks();
    } catch {
      // Return empty state
      return builder
        .withSummary('🎭 No mock analysis available. Run a scan first.')
        .withData({ 
          analysis: { totalMocks: 0, externalMocks: 0, internalMocks: 0, externalPercent: 0, internalPercent: 0, avgMockRatio: 0, highMockRatioTests: [], topMockedModules: [] } as MockAnalysis, 
          warnings: [] 
        })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }

  const warnings: string[] = [];
  
  if (mockAnalysis.internalPercent > 50) {
    warnings.push('High internal mocking (>50%) may indicate tight coupling');
  }
  if (mockAnalysis.avgMockRatio > 0.7) {
    warnings.push('High average mock ratio - tests may be brittle');
  }
  if (mockAnalysis.highMockRatioTests.length > 5) {
    warnings.push(`${mockAnalysis.highMockRatioTests.length} tests have >70% mock ratio`);
  }

  let summaryText = `🎭 ${mockAnalysis.totalMocks} mocks. `;
  summaryText += `${mockAnalysis.externalPercent}% external, ${mockAnalysis.internalPercent}% internal. `;
  summaryText += `Avg ratio: ${Math.round(mockAnalysis.avgMockRatio * 100)}%.`;

  const hints = {
    nextActions: warnings.length > 0
      ? ['Review high-mock tests for potential refactoring']
      : ['Mock patterns look healthy'],
    warnings: warnings.length > 0 ? warnings : undefined,
    relatedTools: ['drift_test_topology action="quality"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ analysis: mockAnalysis, warnings })
    .withHints(hints)
    .buildContent();
}

async function handleAffected(
  projectRoot: string,
  files: string[]
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TestTopologyAffectedData>();

  if (files.length === 0) {
    throw Errors.missingParameter('files');
  }

  const analyzer = await buildAnalyzer(projectRoot);
  const result = analyzer.getMinimumTestSet(files);

  let summaryText = `🎯 ${result.selectedTests}/${result.totalTests} tests needed. `;
  summaryText += `Coverage: ${result.changedCodeCoverage}%. `;
  summaryText += `Time saved: ~${result.timeSaved}.`;

  const hints = {
    nextActions: result.tests.length > 0
      ? [`Run: ${result.tests.slice(0, 3).map((t: { name: string }) => t.name).join(', ')}`]
      : ['No tests found for changed files - consider adding coverage'],
    relatedTools: ['drift_test_topology action="uncovered"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ changedFiles: files, result })
    .withHints(hints)
    .buildContent();
}

async function handleQuality(
  projectRoot: string,
  file?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ file: string | undefined; summary: TestTopologySummary }>();

  // First try cached data
  const summaryPath = path.join(projectRoot, DRIFT_DIR, TEST_TOPOLOGY_DIR, 'summary.json');
  
  let summary: TestTopologySummary;
  
  try {
    const data = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    summary = data.summary;
  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      summary = analyzer.getSummary();
    } catch {
      // Return empty state
      return builder
        .withSummary('📈 Test quality analysis not available. Run a scan first.')
        .withData({ 
          file, 
          summary: { testCases: 0, testFiles: 0, functionCoveragePercent: 0, avgQualityScore: 0, byFramework: {}, avgMockRatio: 0 } as unknown as TestTopologySummary 
        })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }

  let summaryText = `📈 Test Quality: ${summary.avgQualityScore}/100. `;
  summaryText += `Mock ratio: ${Math.round((summary.avgMockRatio ?? 0) * 100)}%.`;

  const hints = {
    nextActions: summary.avgQualityScore < 50
      ? ['Improve test quality by adding assertions and error cases']
      : ['Test quality is good'],
    relatedTools: ['drift_test_topology action="mocks"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ file, summary })
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

async function buildAnalyzer(projectRoot: string) {
  const analyzer = createTestTopologyAnalyzer({});

  // Load call graph
  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    if (graph) {
      analyzer.setCallGraph(graph);
    }
  } catch {
    // Continue without call graph
  }

  // Extract tests by walking directory
  const testFiles = await findTestFiles(projectRoot);

  for (const testFile of testFiles) {
    try {
      const content = await fs.readFile(path.join(projectRoot, testFile), 'utf-8');
      analyzer.extractFromFile(content, testFile);
    } catch {
      // Skip files that can't be read
    }
  }

  analyzer.buildMappings();
  return analyzer;
}

/**
 * Find test files by walking the directory tree
 */
async function findTestFiles(rootDir: string, subDir = ''): Promise<string[]> {
  const testFiles: string[] = [];
  const currentDir = path.join(rootDir, subDir);
  
  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const relativePath = path.join(subDir, entry.name);
      
      // Skip directories using enterprise-grade ignore list
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) {
          continue;
        }
        // Recurse into subdirectories
        const subFiles = await findTestFiles(rootDir, relativePath);
        testFiles.push(...subFiles);
      } else if (entry.isFile()) {
        // Check if it's a test file
        if (isTestFile(entry.name)) {
          testFiles.push(relativePath);
        }
      }
    }
  } catch {
    // Directory not readable, skip
  }
  
  return testFiles;
}

/**
 * Check if a filename matches test file patterns
 */
function isTestFile(filename: string): boolean {
  const testPatterns = [
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
  
  return testPatterns.some(pattern => pattern.test(filename));
}
