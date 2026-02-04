/**
 * Hybrid Test Topology Analyzer
 *
 * Test topology analyzer with regex fallback when tree-sitter is unavailable.
 * Provides enterprise-grade test extraction coverage.
 */

import { BaseTestExtractor } from './extractors/base-test-extractor.js';
import { CSharpTestExtractor } from './extractors/csharp-test-extractor.js';
import { JavaTestExtractor } from './extractors/java-test-extractor.js';
import { PHPTestExtractor } from './extractors/php-test-extractor.js';
import { PythonTestExtractor } from './extractors/python-test-extractor.js';
import { getTestRegexExtractor } from './extractors/regex/index.js';
import { TypeScriptTestExtractor } from './extractors/typescript-test-extractor.js';

import type {
  TestExtraction,
  TestCase,
  TestCoverage,
  TestCoverageInfo,
  FunctionCoverageInfo,
  UncoveredFunction,
  MockAnalysis,
  MinimumTestSet,
  TestTopologySummary,
  UncoveredOptions,
  TestFramework,
  ReachType,
} from './types.js';
import type { CallGraph, FunctionNode } from '../call-graph/types.js';
import type Parser from 'tree-sitter';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../native/index.js';

// ============================================================================
// Types
// ============================================================================

export interface HybridTestTopologyResult {
  /** All test extractions */
  extractions: TestExtraction[];
  /** Test coverage by source file */
  coverage: Map<string, TestCoverage>;
  /** Mock analysis */
  mockAnalysis: MockAnalysis;
  /** Summary statistics */
  summary: TestTopologySummary;
  /** Extraction quality info */
  quality: {
    treeSitterFiles: number;
    regexFallbackFiles: number;
    failedFiles: number;
  };
}

interface ExtractorMap {
  typescript: TypeScriptTestExtractor | null;
  javascript: TypeScriptTestExtractor | null;
  python: PythonTestExtractor | null;
  java: JavaTestExtractor | null;
  csharp: CSharpTestExtractor | null;
  php: PHPTestExtractor | null;
}

// ============================================================================
// Analyzer
// ============================================================================

export class HybridTestTopologyAnalyzer {
  private extractors: ExtractorMap;
  private callGraph: CallGraph | null = null;
  private testExtractions: Map<string, TestExtraction> = new Map();
  private testToFunctions: Map<string, Set<string>> = new Map();
  private functionToTests: Map<string, Set<string>> = new Map();
  private useNativeQueries: boolean = false;
  private projectRoot: string | undefined;
  
  // Quality tracking
  private treeSitterFiles = 0;
  private regexFallbackFiles = 0;
  private failedFiles = 0;

  constructor(parsers: {
    typescript?: Parser;
    python?: Parser;
    java?: Parser;
    csharp?: Parser;
    php?: Parser;
  } = {}) {
    this.extractors = {
      typescript: parsers.typescript ? new TypeScriptTestExtractor(parsers.typescript) : null,
      javascript: parsers.typescript ? new TypeScriptTestExtractor(parsers.typescript) : null,
      python: parsers.python ? new PythonTestExtractor(parsers.python) : null,
      java: parsers.java ? new JavaTestExtractor(parsers.java) : null,
      csharp: parsers.csharp ? new CSharpTestExtractor(parsers.csharp) : null,
      php: parsers.php ? new PHPTestExtractor(parsers.php) : null,
    };
  }

  /**
   * Set the call graph for transitive coverage analysis
   */
  setCallGraph(graph: CallGraph): void {
    this.callGraph = graph;
    
    // Check if we should use native SQLite queries
    this.projectRoot = graph.projectRoot;
    const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);
  }

  /**
   * Get callers for a function (using native query if available)
   */
  private getFunctionCallers(funcId: string, funcName: string): Array<{ callerId: string }> {
    const func = this.callGraph?.functions.get(funcId);
    
    // If calledBy is populated, use it
    if (func && func.calledBy.length > 0) {
      return func.calledBy;
    }
    
    // If using native queries, check SQLite
    if (this.useNativeQueries && this.projectRoot) {
      const callers = getCallGraphCallers(this.projectRoot, funcName);
      return callers.map(c => ({ callerId: c.callerId }));
    }
    
    return func?.calledBy ?? [];
  }

  /**
   * Extract tests from a single file with regex fallback
   */
  extractFromFile(content: string, filePath: string): TestExtraction | null {
    // Try tree-sitter first
    const treeSitterExtractor = this.getExtractorForFile(filePath);
    if (treeSitterExtractor) {
      try {
        const extraction = treeSitterExtractor.extract(content, filePath);
        
        // Update file path in test cases
        for (const test of extraction.testCases) {
          test.file = filePath;
          test.id = `${filePath}:${test.name}:${test.line}`;
        }

        this.testExtractions.set(filePath, extraction);
        this.treeSitterFiles++;
        return extraction;
      } catch (error) {
        // Tree-sitter failed, try regex fallback
        console.warn(`Tree-sitter extraction failed for ${filePath}, trying regex fallback`);
      }
    }

    // Try regex fallback
    const regexExtractor = getTestRegexExtractor(filePath);
    if (!regexExtractor) {
      // No extractor available for this file type
      this.failedFiles++;
      return null;
    }
    
    try {
      const extraction = regexExtractor.extract(content, filePath);
      
      // Update file path in test cases
      for (const test of extraction.testCases) {
        test.file = filePath;
        test.id = `${filePath}:${test.name}:${test.line}`;
      }

      this.testExtractions.set(filePath, extraction);
      this.regexFallbackFiles++;
      return extraction;
    } catch (error) {
      console.warn(`Regex extraction failed for ${filePath}: ${error}`);
      this.failedFiles++;
      return null;
    }
  }


  /**
   * Build test-to-code mappings after extracting all tests
   */
  buildMappings(): void {
    this.testToFunctions.clear();
    this.functionToTests.clear();

    for (const [_file, extraction] of this.testExtractions) {
      for (const test of extraction.testCases) {
        const testId = test.id;
        const functions = new Set<string>();

        // Direct calls
        for (const call of test.directCalls) {
          const funcId = this.resolveFunctionId(call, test.file);
          if (funcId) {
            functions.add(funcId);
            this.addFunctionToTest(funcId, testId);
          }
        }

        // Transitive calls (if call graph available)
        if (this.callGraph) {
          const transitive = this.findTransitiveCalls(functions);
          for (const funcId of transitive) {
            functions.add(funcId);
            this.addFunctionToTest(funcId, testId);
            test.transitiveCalls.push(funcId);
          }
        }

        this.testToFunctions.set(testId, functions);
      }
    }
  }

  /**
   * Get coverage for a source file
   */
  getCoverage(sourceFile: string): TestCoverage | null {
    if (!this.callGraph) {return null;}

    const functions: FunctionCoverageInfo[] = [];
    const tests: TestCoverageInfo[] = [];
    const seenTests = new Set<string>();

    for (const [funcId, func] of this.callGraph.functions) {
      if (func.file !== sourceFile) {continue;}

      const coveringTests = this.functionToTests.get(funcId);
      const isCovered = coveringTests !== undefined && coveringTests.size > 0;

      functions.push({
        functionId: funcId,
        name: func.name,
        line: func.startLine,
        isCovered,
        coveringTests: coveringTests ? Array.from(coveringTests) : [],
        isMockedOnly: this.isMockedOnly(funcId, coveringTests),
      });

      if (coveringTests) {
        for (const testId of coveringTests) {
          if (seenTests.has(testId)) {continue;}
          seenTests.add(testId);

          const testInfo = this.getTestInfo(testId);
          if (testInfo) {
            tests.push({
              testFile: testInfo.file,
              testName: testInfo.name,
              reachType: this.getReachType(testId, funcId),
              depth: this.getCallDepth(testId, funcId),
              confidence: this.calculateConfidence(testId, funcId),
              coveredFunctions: Array.from(this.testToFunctions.get(testId) ?? [])
                .filter(f => this.callGraph?.functions.get(f)?.file === sourceFile),
            });
          }
        }
      }
    }

    const coveredCount = functions.filter(f => f.isCovered).length;
    const coveragePercent = functions.length > 0 
      ? Math.round((coveredCount / functions.length) * 100) 
      : 0;

    return {
      sourceFile,
      tests,
      functions,
      coveragePercent,
    };
  }

  /**
   * Get uncovered functions
   */
  getUncoveredFunctions(options: UncoveredOptions = {}): UncoveredFunction[] {
    const { minRisk = 'low', limit = 50, includeReasons = true } = options;
    const uncovered: UncoveredFunction[] = [];

    if (!this.callGraph) {return uncovered;}

    const riskThresholds = { low: 0, medium: 30, high: 60 };
    const minRiskScore = riskThresholds[minRisk];

    for (const [funcId, func] of this.callGraph.functions) {
      if (this.isTestFile(func.file)) {continue;}

      const coveringTests = this.functionToTests.get(funcId);
      if (coveringTests && coveringTests.size > 0) {continue;}

      const riskScore = this.calculateRiskScore(func);
      if (riskScore < minRiskScore) {continue;}

      const possibleReasons = includeReasons 
        ? this.inferUncoveredReasons(func)
        : [];

      uncovered.push({
        functionId: funcId,
        name: func.name,
        qualifiedName: func.qualifiedName,
        file: func.file,
        line: func.startLine,
        possibleReasons,
        riskScore,
        isEntryPoint: this.callGraph.entryPoints.includes(funcId),
        accessesSensitiveData: func.dataAccess.length > 0,
      });
    }

    uncovered.sort((a, b) => b.riskScore - a.riskScore);
    return uncovered.slice(0, limit);
  }

  /**
   * Get minimum test set for changed files
   */
  getMinimumTestSet(changedFiles: string[]): MinimumTestSet {
    const selectedTests = new Map<string, { file: string; name: string; reason: string }>();
    const changedFunctions = new Set<string>();

    if (this.callGraph) {
      for (const [funcId, func] of this.callGraph.functions) {
        if (changedFiles.includes(func.file)) {
          changedFunctions.add(funcId);
        }
      }
    }

    for (const funcId of changedFunctions) {
      const tests = this.functionToTests.get(funcId);
      if (!tests) {continue;}

      for (const testId of tests) {
        if (selectedTests.has(testId)) {continue;}

        const testInfo = this.getTestInfo(testId);
        if (testInfo) {
          selectedTests.set(testId, {
            file: testInfo.file,
            name: testInfo.qualifiedName,
            reason: `Covers function in ${this.callGraph?.functions.get(funcId)?.file ?? 'unknown'}`,
          });
        }
      }
    }

    let totalTests = 0;
    for (const extraction of this.testExtractions.values()) {
      totalTests += extraction.testCases.length;
    }

    const skippedTests = totalTests - selectedTests.size;
    const timeSavedMs = skippedTests * 100;
    const timeSaved = timeSavedMs > 60000 
      ? `${Math.round(timeSavedMs / 60000)}m`
      : `${Math.round(timeSavedMs / 1000)}s`;

    let coveredChangedFunctions = 0;
    for (const funcId of changedFunctions) {
      const tests = this.functionToTests.get(funcId);
      if (tests && tests.size > 0) {
        coveredChangedFunctions++;
      }
    }
    const changedCodeCoverage = changedFunctions.size > 0
      ? Math.round((coveredChangedFunctions / changedFunctions.size) * 100)
      : 100;

    return {
      tests: Array.from(selectedTests.values()),
      totalTests,
      selectedTests: selectedTests.size,
      timeSaved,
      changedCodeCoverage,
    };
  }

  /**
   * Analyze mock usage patterns
   */
  analyzeMocks(): MockAnalysis {
    let totalMocks = 0;
    let externalMocks = 0;
    let internalMocks = 0;
    const mockRatios: number[] = [];
    const highMockRatioTests: MockAnalysis['highMockRatioTests'] = [];
    const mockedModules = new Map<string, number>();

    for (const [file, extraction] of this.testExtractions) {
      for (const mock of extraction.mocks) {
        totalMocks++;
        if (mock.isExternal) {
          externalMocks++;
        } else {
          internalMocks++;
        }

        const module = mock.target.split('.')[0] ?? mock.target;
        mockedModules.set(module, (mockedModules.get(module) ?? 0) + 1);
      }

      for (const test of extraction.testCases) {
        mockRatios.push(test.quality.mockRatio);
        
        if (test.quality.mockRatio > 0.7) {
          highMockRatioTests.push({
            file,
            testName: test.name,
            mockRatio: test.quality.mockRatio,
          });
        }
      }
    }

    const avgMockRatio = mockRatios.length > 0
      ? mockRatios.reduce((a, b) => a + b, 0) / mockRatios.length
      : 0;

    const topMockedModules = Array.from(mockedModules.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([module, count]) => ({ module, count }));

    return {
      totalMocks,
      externalMocks,
      internalMocks,
      externalPercent: totalMocks > 0 ? Math.round((externalMocks / totalMocks) * 100) : 0,
      internalPercent: totalMocks > 0 ? Math.round((internalMocks / totalMocks) * 100) : 0,
      avgMockRatio: Math.round(avgMockRatio * 100) / 100,
      highMockRatioTests,
      topMockedModules,
    };
  }

  /**
   * Get summary statistics
   */
  getSummary(): TestTopologySummary {
    const byFramework: Record<TestFramework, number> = {
      jest: 0, vitest: 0, mocha: 0, ava: 0, tape: 0,
      pytest: 0, unittest: 0, nose: 0,
      junit4: 0, junit5: 0, testng: 0,
      xunit: 0, nunit: 0, mstest: 0,
      phpunit: 0, pest: 0, codeception: 0,
      'go-testing': 0, testify: 0, ginkgo: 0, gomega: 0,
      'rust-test': 0, 'tokio-test': 0, proptest: 0, criterion: 0, rstest: 0,
      gtest: 0, catch2: 0, 'boost-test': 0, doctest: 0, cppunit: 0,
      unknown: 0,
    };

    let testFiles = 0;
    let testCases = 0;
    let totalQualityScore = 0;
    let totalMockRatio = 0;

    for (const extraction of this.testExtractions.values()) {
      testFiles++;
      testCases += extraction.testCases.length;
      byFramework[extraction.framework]++;

      for (const test of extraction.testCases) {
        totalQualityScore += test.quality.score;
        totalMockRatio += test.quality.mockRatio;
      }
    }

    let coveredFiles = 0;
    let totalFiles = 0;
    let coveredFunctions = 0;
    let totalFunctions = 0;

    if (this.callGraph) {
      const sourceFiles = new Set<string>();
      const coveredSourceFiles = new Set<string>();

      for (const [funcId, func] of this.callGraph.functions) {
        if (this.isTestFile(func.file)) {continue;}

        sourceFiles.add(func.file);
        totalFunctions++;

        const tests = this.functionToTests.get(funcId);
        if (tests && tests.size > 0) {
          coveredSourceFiles.add(func.file);
          coveredFunctions++;
        }
      }

      totalFiles = sourceFiles.size;
      coveredFiles = coveredSourceFiles.size;
    }

    return {
      testFiles,
      testCases,
      coveredFiles,
      totalFiles,
      coveragePercent: totalFiles > 0 ? Math.round((coveredFiles / totalFiles) * 100) : 0,
      coveredFunctions,
      totalFunctions,
      functionCoveragePercent: totalFunctions > 0 
        ? Math.round((coveredFunctions / totalFunctions) * 100) 
        : 0,
      avgMockRatio: testCases > 0 
        ? Math.round((totalMockRatio / testCases) * 100) / 100 
        : 0,
      avgQualityScore: testCases > 0 
        ? Math.round(totalQualityScore / testCases) 
        : 0,
      byFramework,
    };
  }

  /**
   * Get extraction quality info
   */
  getQuality(): HybridTestTopologyResult['quality'] {
    return {
      treeSitterFiles: this.treeSitterFiles,
      regexFallbackFiles: this.regexFallbackFiles,
      failedFiles: this.failedFiles,
    };
  }


  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getExtractorForFile(filePath: string): BaseTestExtractor | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'ts':
      case 'tsx':
        return this.extractors.typescript;
      case 'js':
      case 'jsx':
      case 'mjs':
        return this.extractors.javascript;
      case 'py':
        return this.extractors.python;
      case 'java':
        return this.extractors.java;
      case 'cs':
        return this.extractors.csharp;
      case 'php':
        return this.extractors.php;
      default:
        return null;
    }
  }

  private resolveFunctionId(callName: string, fromFile: string): string | null {
    if (!this.callGraph) {return null;}

    for (const [funcId, func] of this.callGraph.functions) {
      if (func.name === callName || func.qualifiedName.endsWith(callName)) {
        return funcId;
      }
    }

    const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
    for (const [funcId, func] of this.callGraph.functions) {
      if (func.file.startsWith(dir) && func.name === callName) {
        return funcId;
      }
    }

    return null;
  }

  private findTransitiveCalls(directCalls: Set<string>): Set<string> {
    const transitive = new Set<string>();
    if (!this.callGraph) {return transitive;}

    const visited = new Set<string>();
    const queue = Array.from(directCalls);

    while (queue.length > 0) {
      const funcId = queue.shift()!;
      if (visited.has(funcId)) {continue;}
      visited.add(funcId);

      const func = this.callGraph.functions.get(funcId);
      if (!func) {continue;}

      for (const call of func.calls) {
        for (const candidate of call.resolvedCandidates) {
          if (!directCalls.has(candidate) && !transitive.has(candidate)) {
            transitive.add(candidate);
            queue.push(candidate);
          }
        }
      }
    }

    return transitive;
  }

  private addFunctionToTest(funcId: string, testId: string): void {
    let tests = this.functionToTests.get(funcId);
    if (!tests) {
      tests = new Set();
      this.functionToTests.set(funcId, tests);
    }
    tests.add(testId);
  }

  private getTestInfo(testId: string): TestCase | null {
    for (const extraction of this.testExtractions.values()) {
      for (const test of extraction.testCases) {
        if (test.id === testId) {return test;}
      }
    }
    return null;
  }

  private getReachType(testId: string, funcId: string): ReachType {
    const testFunctions = this.testToFunctions.get(testId);
    if (!testFunctions) {return 'transitive';}

    const testInfo = this.getTestInfo(testId);
    if (testInfo?.directCalls.some(c => this.resolveFunctionId(c, testInfo.file) === funcId)) {
      return 'direct';
    }

    return 'transitive';
  }

  private getCallDepth(testId: string, funcId: string): number {
    return this.getReachType(testId, funcId) === 'direct' ? 1 : 2;
  }

  private calculateConfidence(testId: string, funcId: string): number {
    const reachType = this.getReachType(testId, funcId);
    return reachType === 'direct' ? 0.9 : 0.6;
  }

  private isMockedOnly(funcId: string, coveringTests: Set<string> | undefined): boolean {
    if (!coveringTests) {return false;}

    for (const testId of coveringTests) {
      const testInfo = this.getTestInfo(testId);
      if (!testInfo) {continue;}

      const extraction = this.testExtractions.get(testInfo.file);
      if (!extraction) {continue;}

      const func = this.callGraph?.functions.get(funcId);
      if (!func) {continue;}

      const isMocked = extraction.mocks.some(m => 
        m.target.includes(func.name) || m.target.includes(func.qualifiedName)
      );

      if (!isMocked) {return false;}
    }

    return true;
  }

  private calculateRiskScore(func: FunctionNode): number {
    let score = 30;

    if (this.callGraph?.entryPoints.includes(`${func.file}:${func.name}`)) {
      score += 30;
    }

    if (func.dataAccess.length > 0) {
      score += 20;
    }

    const callers = this.getFunctionCallers(func.id, func.name);
    if (callers.length > 5) {
      score += 15;
    }

    if (func.calls.length > 10) {
      score += 10;
    }

    return Math.min(100, score);
  }

  private inferUncoveredReasons(func: FunctionNode): UncoveredFunction['possibleReasons'] {
    const reasons: UncoveredFunction['possibleReasons'] = [];

    const callers = this.getFunctionCallers(func.id, func.name);
    if (callers.length === 0 && !this.callGraph?.entryPoints.includes(`${func.file}:${func.name}`)) {
      reasons.push('dead-code');
    }

    const hookPatterns = ['componentDidMount', 'useEffect', 'ngOnInit', 'setUp', 'tearDown'];
    if (hookPatterns.some(p => func.name.includes(p))) {
      reasons.push('framework-hook');
    }

    if (func.name.startsWith('get') || func.name.startsWith('set')) {
      reasons.push('trivial');
    }

    return reasons;
  }

  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\./i, /\.spec\./i, /_test\./i, /test_/i,
      /tests?\//i, /specs?\//i, /__tests__\//i,
    ];
    return testPatterns.some(p => p.test(filePath));
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createHybridTestTopologyAnalyzer(parsers: {
  typescript?: Parser;
  python?: Parser;
  java?: Parser;
  csharp?: Parser;
  php?: Parser;
} = {}): HybridTestTopologyAnalyzer {
  return new HybridTestTopologyAnalyzer(parsers);
}
