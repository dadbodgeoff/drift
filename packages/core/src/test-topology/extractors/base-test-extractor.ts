/**
 * Base Test Extractor
 *
 * Abstract base class for language-specific test extractors.
 * Provides common utilities and defines the extraction interface.
 */

import type {
  TestExtraction,
  TestCase,
  MockStatement,
  SetupBlock,
  AssertionInfo,
  TestQualitySignals,
  TestFramework,
} from '../types.js';
import type Parser from 'tree-sitter';

// ============================================================================
// Types
// ============================================================================

export interface QueryMatch {
  pattern: number;
  captures: Array<{
    name: string;
    node: Parser.SyntaxNode;
  }>;
}

export interface TestFrameworkConfig {
  imports: string[];
  testFunctions: string[];
  mockFunctions: string[];
  setupFunctions: string[];
  teardownFunctions: string[];
  assertionPatterns: RegExp[];
}

// ============================================================================
// Base Extractor
// ============================================================================

export abstract class BaseTestExtractor {
  protected parser: Parser;
  protected language: 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go';

  constructor(parser: Parser, language: BaseTestExtractor['language']) {
    this.parser = parser;
    this.language = language;
  }

  /**
   * Extract test information from file content
   */
  abstract extract(content: string, filePath: string): TestExtraction;

  /**
   * Detect the test framework used
   */
  abstract detectFramework(root: Parser.SyntaxNode): TestFramework;

  /**
   * Extract test cases from AST
   */
  abstract extractTestCases(root: Parser.SyntaxNode): TestCase[];

  /**
   * Extract mock statements from AST
   */
  abstract extractMocks(root: Parser.SyntaxNode, framework: TestFramework): MockStatement[];

  /**
   * Extract setup/teardown blocks
   */
  abstract extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[];

  // ============================================================================
  // Common Utilities
  // ============================================================================

  /**
   * Run a tree-sitter query and return matches
   */
  protected runQuery(node: Parser.SyntaxNode, queryString: string): QueryMatch[] {
    try {
      const query = this.parser.getLanguage().query(queryString);
      const matches = query.matches(node);
      return matches.map((m: { pattern: number; captures: Array<{ name: string; node: Parser.SyntaxNode }> }) => ({
        pattern: m.pattern,
        captures: m.captures.map((c: { name: string; node: Parser.SyntaxNode }) => ({
          name: c.name,
          node: c.node,
        })),
      }));
    } catch {
      // Query syntax error or unsupported - return empty
      return [];
    }
  }

  /**
   * Find all imports in the file
   */
  protected abstract findImports(root: Parser.SyntaxNode): string[];

  /**
   * Extract function calls from a node
   */
  protected extractFunctionCalls(node: Parser.SyntaxNode): string[] {
    const calls: string[] = [];
    this.walkNode(node, (child) => {
      if (this.isCallExpression(child)) {
        const name = this.getCallName(child);
        if (name && !this.isTestFrameworkCall(name)) {
          calls.push(name);
        }
      }
    });
    return [...new Set(calls)];
  }

  /**
   * Check if a node is a call expression
   */
  protected isCallExpression(node: Parser.SyntaxNode): boolean {
    return node.type === 'call_expression' || 
           node.type === 'call' ||
           node.type === 'method_invocation' ||
           node.type === 'invocation_expression' ||
           node.type === 'function_call_expression' ||
           node.type === 'member_call_expression';
  }

  /**
   * Get the name of a call expression
   */
  protected getCallName(node: Parser.SyntaxNode): string | null {
    // Try different child types for different languages
    const functionChild = node.childForFieldName('function') ||
                         node.childForFieldName('name') ||
                         node.namedChild(0);
    
    if (!functionChild) {return null;}

    // Handle member expressions (obj.method)
    if (functionChild.type === 'member_expression' ||
        functionChild.type === 'attribute' ||
        functionChild.type === 'member_access_expression') {
      const property = functionChild.childForFieldName('property') ||
                      functionChild.childForFieldName('attribute') ||
                      functionChild.childForFieldName('name');
      return property?.text ?? null;
    }

    // Handle identifiers
    if (functionChild.type === 'identifier' || functionChild.type === 'name') {
      return functionChild.text;
    }

    return functionChild.text;
  }

  /**
   * Check if a call is a test framework call (should be excluded from coverage)
   */
  protected isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      // Jest/Vitest/Mocha
      'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
      'beforeAll', 'afterAll', 'jest', 'vi', 'mock', 'spyOn',
      // Pytest
      'pytest', 'fixture', 'mark', 'parametrize',
      // JUnit
      'assertEquals', 'assertTrue', 'assertFalse', 'assertNull',
      'assertNotNull', 'assertThrows', 'verify', 'when',
      // xUnit/NUnit
      'Assert', 'Fact', 'Theory', 'Mock', 'Setup',
      // PHPUnit
      'assertEquals', 'assertTrue', 'assertFalse', 'createMock',
    ];
    return frameworkCalls.includes(name);
  }

  /**
   * Walk AST nodes recursively
   */
  protected walkNode(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
    callback(node);
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.walkNode(child, callback);
      }
    }
  }

  /**
   * Calculate test quality signals
   */
  protected calculateQuality(
    assertions: AssertionInfo[],
    mocks: MockStatement[],
    directCalls: string[]
  ): TestQualitySignals {
    const assertionCount = assertions.length;
    const hasErrorCases = assertions.some(a => a.isErrorAssertion);
    const hasEdgeCases = assertions.some(a => a.isEdgeCaseAssertion);
    
    // Mock ratio: mocks / (mocks + real calls)
    const totalCalls = mocks.length + directCalls.length;
    const mockRatio = totalCalls > 0 ? mocks.length / totalCalls : 0;
    
    // Setup ratio would need more context, default to 0
    const setupRatio = 0;
    
    // Calculate score
    let score = 50; // Base score
    
    // Assertions
    if (assertionCount >= 1) {score += 10;}
    if (assertionCount >= 3) {score += 10;}
    
    // Error cases
    if (hasErrorCases) {score += 15;}
    
    // Edge cases
    if (hasEdgeCases) {score += 10;}
    
    // Mock ratio penalty (high mocking = potentially brittle)
    if (mockRatio > 0.7) {score -= 15;}
    else if (mockRatio > 0.5) {score -= 5;}
    
    // No assertions is bad
    if (assertionCount === 0) {score -= 20;}
    
    return {
      assertionCount,
      hasErrorCases,
      hasEdgeCases,
      mockRatio: Math.round(mockRatio * 100) / 100,
      setupRatio,
      score: Math.max(0, Math.min(100, score)),
    };
  }

  /**
   * Check if a module path is external (node_modules, stdlib, etc.)
   */
  protected isExternalModule(modulePath: string): boolean {
    // Relative paths are internal
    if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
      return false;
    }
    // Alias paths (like @/) are internal
    if (modulePath.startsWith('@/') || modulePath.startsWith('~/')) {
      return false;
    }
    // Everything else is external
    return true;
  }

  /**
   * Generate a unique test ID
   */
  protected generateTestId(file: string, name: string, line: number): string {
    return `${file}:${name}:${line}`;
  }
}
