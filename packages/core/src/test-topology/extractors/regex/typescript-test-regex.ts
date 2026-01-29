/**
 * TypeScript/JavaScript Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports Jest, Vitest, Mocha, and other JS test frameworks.
 */

import type {
  TestExtraction,
  TestCase,
  MockStatement,
  SetupBlock,
  AssertionInfo,
  TestQualitySignals,
  TestFramework,
} from '../../types.js';

// ============================================================================
// Patterns
// ============================================================================

const FRAMEWORK_PATTERNS: Record<string, TestFramework> = {
  'vitest': 'vitest',
  '@jest/globals': 'jest',
  'jest': 'jest',
  'mocha': 'mocha',
  'chai': 'mocha',
  'ava': 'ava',
  'tape': 'tape',
};

// ============================================================================
// Extractor
// ============================================================================

export class TypeScriptTestRegexExtractor {
  readonly language = 'typescript' as const;
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  /**
   * Extract test information using regex patterns
   */
  extract(content: string, filePath: string): TestExtraction {
    const framework = this.detectFramework(content);
    const testCases = this.extractTestCases(content, filePath);
    const mocks = this.extractMocks(content, framework);
    const setupBlocks = this.extractSetupBlocks(content);

    // Enrich test cases with quality
    for (const test of testCases) {
      const testMocks = mocks.filter(m => 
        m.line >= test.line && m.line <= test.line + 100
      );
      test.quality = this.calculateQuality(test.assertions, testMocks, test.directCalls);
    }

    return {
      file: filePath,
      framework,
      language: this.getLanguageFromPath(filePath),
      testCases,
      mocks,
      setupBlocks,
    };
  }

  private getLanguageFromPath(filePath: string): 'typescript' | 'javascript' {
    return filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
  }

  /**
   * Detect test framework from imports
   */
  detectFramework(content: string): TestFramework {
    // Check imports
    const importPattern = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const source = match[1]!;
      const framework = FRAMEWORK_PATTERNS[source];
      if (framework) {return framework;}
    }

    // Check require
    const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      const source = match[1]!;
      const framework = FRAMEWORK_PATTERNS[source];
      if (framework) {return framework;}
    }

    // Check for global usage
    if (/\bvi\.(mock|spyOn|fn)\b/.test(content)) {return 'vitest';}
    if (/\bjest\.(mock|spyOn|fn)\b/.test(content)) {return 'jest';}
    
    // Default to jest if we see test/describe/it
    if (/\b(describe|it|test)\s*\(/.test(content)) {return 'jest';}

    return 'unknown';
  }

  /**
   * Extract test cases using regex
   */
  extractTestCases(content: string, filePath: string): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n');
    
    // Track describe blocks for qualified names
    const describeStack: { name: string; line: number }[] = [];
    
    // Pattern for describe blocks
    const describePattern = /^\s*(describe|context)\s*\(\s*['"`]([^'"`]+)['"`]/;
    // Pattern for test blocks
    const testPattern = /^\s*(it|test)\s*\(\s*['"`]([^'"`]+)['"`]/;
    // Pattern for closing braces (simplified)
    const closePattern = /^\s*\}\s*\)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Check for describe
      const describeMatch = line.match(describePattern);
      if (describeMatch) {
        describeStack.push({ name: describeMatch[2]!, line: lineNum });
        continue;
      }

      // Check for test
      const testMatch = line.match(testPattern);
      if (testMatch) {
        const testName = testMatch[2]!;
        const parentBlock = describeStack.length > 0 
          ? describeStack[describeStack.length - 1]!.name 
          : undefined;
        const qualifiedName = describeStack.length > 0
          ? `${describeStack.map(d => d.name).join(' > ')} > ${testName}`
          : testName;

        // Find the test body (rough approximation)
        const testBody = this.extractTestBody(lines, i);
        const directCalls = this.extractFunctionCalls(testBody);
        const assertions = this.extractAssertions(testBody, lineNum);

        testCases.push({
          id: `${filePath}:${testName}:${lineNum}`,
          name: testName,
          parentBlock,
          qualifiedName,
          file: filePath,
          line: lineNum,
          directCalls,
          transitiveCalls: [],
          assertions,
          quality: {
            assertionCount: assertions.length,
            hasErrorCases: false,
            hasEdgeCases: false,
            mockRatio: 0,
            setupRatio: 0,
            score: 50,
          },
        });
        continue;
      }

      // Check for closing (pop describe stack)
      if (closePattern.test(line) && describeStack.length > 0) {
        // This is a rough heuristic - we pop when we see }); at the right indentation
        const indent = line.search(/\S/);
        const lastDescribe = describeStack[describeStack.length - 1];
        if (lastDescribe) {
          const describeIndent = (lines[lastDescribe.line - 1] ?? '').search(/\S/);
          if (indent <= describeIndent) {
            describeStack.pop();
          }
        }
      }
    }

    return testCases;
  }


  /**
   * Extract the body of a test (rough approximation)
   */
  private extractTestBody(lines: string[], startIndex: number): string {
    const bodyLines: string[] = [];
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < Math.min(startIndex + 100, lines.length); i++) {
      const line = lines[i]!;
      
      for (const char of line) {
        if (char === '{' || char === '(') {
          braceCount++;
          started = true;
        } else if (char === '}' || char === ')') {
          braceCount--;
        }
      }

      bodyLines.push(line);

      if (started && braceCount <= 0) {
        break;
      }
    }

    return bodyLines.join('\n');
  }

  /**
   * Extract function calls from test body
   */
  private extractFunctionCalls(body: string): string[] {
    const calls: string[] = [];
    const seen = new Set<string>();

    // Pattern for function calls: identifier(
    const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;

    while ((match = callPattern.exec(body)) !== null) {
      const name = match[1]!;
      
      // Skip test framework calls
      if (this.isTestFrameworkCall(name)) {continue;}
      
      if (!seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }

    // Pattern for method calls: obj.method(
    const methodPattern = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    while ((match = methodPattern.exec(body)) !== null) {
      const name = match[1]!;
      if (this.isTestFrameworkCall(name)) {continue;}
      if (!seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }

    return calls;
  }

  /**
   * Extract assertions from test body
   */
  private extractAssertions(body: string, baseLineNum: number): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    // Pattern for expect(...).matcher
    const expectPattern = /expect\s*\([^)]*\)\s*\.(\w+)/g;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let match;
      
      while ((match = expectPattern.exec(line)) !== null) {
        const matcher = match[1]!;
        assertions.push({
          matcher,
          line: baseLineNum + i,
          isErrorAssertion: this.isErrorMatcher(matcher),
          isEdgeCaseAssertion: this.isEdgeCaseMatcher(matcher),
        });
      }
    }

    return assertions;
  }

  /**
   * Extract mock statements
   */
  extractMocks(content: string, framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];
    const lines = content.split('\n');
    const mockObj = framework === 'vitest' ? 'vi' : 'jest';

    // Pattern for jest.mock() or vi.mock()
    const mockPattern = new RegExp(`${mockObj}\\.mock\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    // Pattern for jest.spyOn() or vi.spyOn()
    const spyPattern = new RegExp(`${mockObj}\\.spyOn\\s*\\(\\s*(\\w+)\\s*,\\s*['"\`]([^'"\`]+)['"\`]`, 'g');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      let match;

      // Check for mock
      while ((match = mockPattern.exec(line)) !== null) {
        const target = match[1]!;
        mocks.push({
          target,
          mockType: `${mockObj}.mock`,
          line: lineNum,
          isExternal: this.isExternalModule(target),
          hasImplementation: line.includes(','),
        });
      }

      // Check for spyOn
      while ((match = spyPattern.exec(line)) !== null) {
        const obj = match[1]!;
        const method = match[2]!;
        mocks.push({
          target: `${obj}.${method}`,
          mockType: `${mockObj}.spyOn`,
          line: lineNum,
          isExternal: false,
        });
      }
    }

    return mocks;
  }

  /**
   * Extract setup blocks
   */
  extractSetupBlocks(content: string): SetupBlock[] {
    const blocks: SetupBlock[] = [];
    const lines = content.split('\n');
    const setupFns = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      for (const fn of setupFns) {
        const pattern = new RegExp(`^\\s*${fn}\\s*\\(`);
        if (pattern.test(line)) {
          const body = this.extractTestBody(lines, i);
          const calls = this.extractFunctionCalls(body);
          
          blocks.push({
            type: fn as SetupBlock['type'],
            line: lineNum,
            calls,
          });
          break;
        }
      }
    }

    return blocks;
  }

  /**
   * Check if a call is a test framework call
   */
  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
      'beforeAll', 'afterAll', 'jest', 'vi', 'mock', 'spyOn', 'fn',
      'toBe', 'toEqual', 'toHaveBeenCalled', 'toThrow', 'toMatch',
      'toContain', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined',
      'toHaveLength', 'toHaveProperty', 'toMatchSnapshot', 'toMatchInlineSnapshot',
    ];
    return frameworkCalls.includes(name);
  }

  private isErrorMatcher(matcher: string): boolean {
    const errorMatchers = ['toThrow', 'toThrowError', 'toThrowErrorMatchingSnapshot', 'rejects', 'toReject'];
    return errorMatchers.some(m => matcher.includes(m));
  }

  private isEdgeCaseMatcher(matcher: string): boolean {
    const edgeCaseMatchers = ['toBeNull', 'toBeUndefined', 'toBeFalsy', 'toBeNaN', 'toHaveLength', 'toBeEmpty'];
    return edgeCaseMatchers.some(m => matcher.includes(m));
  }

  private isExternalModule(modulePath: string): boolean {
    if (modulePath.startsWith('.') || modulePath.startsWith('/')) {return false;}
    if (modulePath.startsWith('@/') || modulePath.startsWith('~/')) {return false;}
    return true;
  }

  /**
   * Calculate test quality signals
   */
  private calculateQuality(
    assertions: AssertionInfo[],
    mocks: MockStatement[],
    directCalls: string[]
  ): TestQualitySignals {
    const assertionCount = assertions.length;
    const hasErrorCases = assertions.some(a => a.isErrorAssertion);
    const hasEdgeCases = assertions.some(a => a.isEdgeCaseAssertion);
    
    const totalCalls = mocks.length + directCalls.length;
    const mockRatio = totalCalls > 0 ? mocks.length / totalCalls : 0;
    
    let score = 50;
    if (assertionCount >= 1) {score += 10;}
    if (assertionCount >= 3) {score += 10;}
    if (hasErrorCases) {score += 15;}
    if (hasEdgeCases) {score += 10;}
    if (mockRatio > 0.7) {score -= 15;}
    else if (mockRatio > 0.5) {score -= 5;}
    if (assertionCount === 0) {score -= 20;}
    
    return {
      assertionCount,
      hasErrorCases,
      hasEdgeCases,
      mockRatio: Math.round(mockRatio * 100) / 100,
      setupRatio: 0,
      score: Math.max(0, Math.min(100, score)),
    };
  }
}

/**
 * Factory function
 */
export function createTypeScriptTestRegexExtractor(): TypeScriptTestRegexExtractor {
  return new TypeScriptTestRegexExtractor();
}
