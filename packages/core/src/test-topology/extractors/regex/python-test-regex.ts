/**
 * Python Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports pytest, unittest, and nose frameworks.
 */

import type {
  TestExtraction,
  TestCase,
  MockStatement,
  SetupBlock,
  AssertionInfo,
  TestQualitySignals,
  TestFramework,
  FixtureInfo,
} from '../../types.js';

// ============================================================================
// Extractor
// ============================================================================

export class PythonTestRegexExtractor {
  readonly language = 'python' as const;
  readonly extensions = ['.py'];

  /**
   * Extract test information using regex patterns
   */
  extract(content: string, filePath: string): TestExtraction {
    const framework = this.detectFramework(content);
    const testCases = this.extractTestCases(content, filePath, framework);
    const mocks = this.extractMocks(content);
    const setupBlocks = this.extractSetupBlocks(content, framework);
    const fixtures = framework === 'pytest' ? this.extractFixtures(content) : undefined;

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
      language: 'python',
      testCases,
      mocks,
      setupBlocks,
      fixtures,
    };
  }

  /**
   * Detect test framework
   */
  detectFramework(content: string): TestFramework {
    // Check imports
    if (/import\s+pytest|from\s+pytest/.test(content)) {return 'pytest';}
    if (/import\s+unittest|from\s+unittest/.test(content)) {return 'unittest';}
    if (/import\s+nose|from\s+nose/.test(content)) {return 'nose';}
    
    // Check for pytest fixtures
    if (/@pytest\.fixture/.test(content)) {return 'pytest';}
    
    // Check for unittest class
    if (/class\s+\w+\s*\(\s*(?:unittest\.)?TestCase\s*\)/.test(content)) {return 'unittest';}
    
    // Check for test_ functions (pytest style)
    if (/^def\s+test_/m.test(content)) {return 'pytest';}

    return 'unknown';
  }

  /**
   * Extract test cases
   */
  extractTestCases(content: string, filePath: string, framework: TestFramework): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n');
    
    // Track current class for unittest style
    let currentClass: string | undefined;
    let classIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      const indent = line.search(/\S/);

      // Check for class definition
      const classMatch = line.match(/^(\s*)class\s+(\w+)/);
      if (classMatch) {
        currentClass = classMatch[2];
        classIndent = classMatch[1]!.length;
        continue;
      }

      // Reset class if we're back at base indent
      if (indent <= classIndent && currentClass && line.trim() && !line.trim().startsWith('#')) {
        currentClass = undefined;
      }

      // Check for test function
      const testMatch = line.match(/^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(/);
      if (testMatch) {
        const testName = testMatch[2]!;
        const qualifiedName = currentClass 
          ? `${currentClass}.${testName}`
          : testName;

        // Extract test body
        const testBody = this.extractFunctionBody(lines, i);
        const directCalls = this.extractFunctionCalls(testBody);
        const assertions = this.extractAssertions(testBody, lineNum, framework);

        testCases.push({
          id: `${filePath}:${testName}:${lineNum}`,
          name: testName,
          parentBlock: currentClass,
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
      }
    }

    return testCases;
  }

  /**
   * Extract function body based on indentation
   */
  private extractFunctionBody(lines: string[], startIndex: number): string {
    const bodyLines: string[] = [];
    const defLine = lines[startIndex]!;
    const defIndent = defLine.search(/\S/);
    
    // Start from next line
    for (let i = startIndex + 1; i < Math.min(startIndex + 100, lines.length); i++) {
      const line = lines[i]!;
      const lineIndent = line.search(/\S/);
      
      // Empty lines are okay
      if (line.trim() === '') {
        bodyLines.push(line);
        continue;
      }
      
      // If we're back to same or less indent, we're done
      if (lineIndent <= defIndent) {
        break;
      }
      
      bodyLines.push(line);
    }

    return bodyLines.join('\n');
  }

  /**
   * Extract function calls from test body
   */
  private extractFunctionCalls(body: string): string[] {
    const calls: string[] = [];
    const seen = new Set<string>();

    // Pattern for function calls
    const callPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let match;

    while ((match = callPattern.exec(body)) !== null) {
      const name = match[1]!;
      if (this.isTestFrameworkCall(name)) {continue;}
      if (!seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }

    // Pattern for method calls
    const methodPattern = /\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
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
   * Extract assertions
   */
  private extractAssertions(body: string, baseLineNum: number, _framework: TestFramework): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = baseLineNum + i + 1;

      // pytest assert
      if (/\bassert\s+/.test(line)) {
        const isError = /raises|exception/i.test(line);
        const isEdge = /None|is\s+None|==\s*None|==\s*\[\]|==\s*\{\}|==\s*''|==\s*0/.test(line);
        assertions.push({
          matcher: 'assert',
          line: lineNum,
          isErrorAssertion: isError,
          isEdgeCaseAssertion: isEdge,
        });
      }

      // unittest assertions
      const unittestMatch = line.match(/self\.(assert\w+)/);
      if (unittestMatch) {
        const matcher = unittestMatch[1]!;
        assertions.push({
          matcher,
          line: lineNum,
          isErrorAssertion: this.isErrorMatcher(matcher),
          isEdgeCaseAssertion: this.isEdgeCaseMatcher(matcher),
        });
      }

      // pytest.raises
      if (/pytest\.raises/.test(line)) {
        assertions.push({
          matcher: 'pytest.raises',
          line: lineNum,
          isErrorAssertion: true,
          isEdgeCaseAssertion: false,
        });
      }
    }

    return assertions;
  }

  /**
   * Extract mock statements
   */
  extractMocks(content: string): MockStatement[] {
    const mocks: MockStatement[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // @patch decorator
      const patchMatch = line.match(/@(?:mock\.)?patch\s*\(\s*['"]([^'"]+)['"]/);
      if (patchMatch) {
        mocks.push({
          target: patchMatch[1]!,
          mockType: '@patch',
          line: lineNum,
          isExternal: this.isExternalModule(patchMatch[1]!),
        });
      }

      // patch() context manager or function
      const patchCallMatch = line.match(/(?:mock\.)?patch\s*\(\s*['"]([^'"]+)['"]/);
      if (patchCallMatch && !line.includes('@')) {
        mocks.push({
          target: patchCallMatch[1]!,
          mockType: 'patch()',
          line: lineNum,
          isExternal: this.isExternalModule(patchCallMatch[1]!),
        });
      }

      // MagicMock / Mock
      const mockMatch = line.match(/(\w+)\s*=\s*(?:Mock|MagicMock)\s*\(/);
      if (mockMatch) {
        mocks.push({
          target: mockMatch[1]!,
          mockType: 'Mock',
          line: lineNum,
          isExternal: false,
        });
      }

      // mocker.patch (pytest-mock)
      const mockerMatch = line.match(/mocker\.patch\s*\(\s*['"]([^'"]+)['"]/);
      if (mockerMatch) {
        mocks.push({
          target: mockerMatch[1]!,
          mockType: 'mocker.patch',
          line: lineNum,
          isExternal: this.isExternalModule(mockerMatch[1]!),
        });
      }
    }

    return mocks;
  }

  /**
   * Extract setup blocks
   */
  extractSetupBlocks(content: string, framework: TestFramework): SetupBlock[] {
    const blocks: SetupBlock[] = [];
    const lines = content.split('\n');

    const setupFns = framework === 'unittest' 
      ? ['setUp', 'tearDown', 'setUpClass', 'tearDownClass']
      : ['setup_method', 'teardown_method', 'setup_function', 'teardown_function'];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      for (const fn of setupFns) {
        const pattern = new RegExp(`def\\s+${fn}\\s*\\(`);
        if (pattern.test(line)) {
          const body = this.extractFunctionBody(lines, i);
          const calls = this.extractFunctionCalls(body);
          
          const type = fn.toLowerCase().includes('setup') ? 'setUp' : 'tearDown';
          blocks.push({
            type: type as SetupBlock['type'],
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
   * Extract pytest fixtures
   */
  private extractFixtures(content: string): FixtureInfo[] {
    const fixtures: FixtureInfo[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // @pytest.fixture
      const fixtureMatch = line.match(/@pytest\.fixture(?:\s*\(\s*(?:scope\s*=\s*['"](\w+)['"])?\s*\))?/);
      if (fixtureMatch) {
        // Get the function name from next line
        const nextLine = lines[i + 1];
        if (nextLine) {
          const fnMatch = nextLine.match(/def\s+(\w+)\s*\(/);
          if (fnMatch) {
            fixtures.push({
              name: fnMatch[1]!,
              scope: fixtureMatch[1] ?? 'function',
              line: lineNum,
            });
          }
        }
      }
    }

    return fixtures;
  }

  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      'assert', 'assertEqual', 'assertTrue', 'assertFalse', 'assertIsNone',
      'assertIsNotNone', 'assertRaises', 'assertIn', 'assertNotIn',
      'pytest', 'fixture', 'mark', 'parametrize', 'raises',
      'patch', 'Mock', 'MagicMock', 'mocker',
    ];
    return frameworkCalls.includes(name);
  }

  private isErrorMatcher(matcher: string): boolean {
    return /raises|exception/i.test(matcher);
  }

  private isEdgeCaseMatcher(matcher: string): boolean {
    return /none|null|empty|zero|false/i.test(matcher);
  }

  private isExternalModule(modulePath: string): boolean {
    if (modulePath.startsWith('.')) {return false;}
    return true;
  }

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
export function createPythonTestRegexExtractor(): PythonTestRegexExtractor {
  return new PythonTestRegexExtractor();
}
