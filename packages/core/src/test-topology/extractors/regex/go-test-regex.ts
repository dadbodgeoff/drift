/**
 * Go Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports Go testing package, testify, ginkgo, and gomock frameworks.
 *
 * @requirements Go Language Support
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
// Extractor
// ============================================================================

export class GoTestRegexExtractor {
  readonly language = 'go' as const;
  readonly extensions = ['.go'];

  /**
   * Extract test information using regex patterns
   */
  extract(content: string, filePath: string): TestExtraction {
    const framework = this.detectFramework(content);
    const testCases = this.extractTestCases(content, filePath, framework);
    const mocks = this.extractMocks(content);
    const setupBlocks = this.extractSetupBlocks(content);

    // Enrich test cases with quality signals
    for (const test of testCases) {
      const testBody = this.extractTestBody(content, test.line);
      const assertions = this.extractAssertions(testBody, test.line, framework);
      const testMocks = mocks.filter(m =>
        m.line >= test.line && m.line <= test.line + 100
      );
      test.assertions = assertions;
      test.quality = this.calculateQuality(assertions, testMocks, test.directCalls);
    }

    return {
      file: filePath,
      framework,
      language: 'go',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  /**
   * Detect test framework from imports and patterns
   */
  detectFramework(content: string): TestFramework {
    // Check imports
    if (content.includes('github.com/stretchr/testify')) {return 'testify';}
    if (content.includes('github.com/onsi/ginkgo')) {return 'ginkgo';}
    if (content.includes('github.com/onsi/gomega')) {return 'gomega';}

    // Check for standard testing package
    if (content.includes('*testing.T') || content.includes('*testing.B')) {return 'go-testing';}
    if (content.includes('testing.T') || content.includes('testing.B')) {return 'go-testing';}

    // Check for test function patterns
    if (/func\s+Test\w+\s*\(/.test(content)) {return 'go-testing';}
    if (/func\s+Benchmark\w+\s*\(/.test(content)) {return 'go-testing';}

    return 'unknown';
  }

  /**
   * Extract test cases from content
   */
  extractTestCases(content: string, filePath: string, framework: TestFramework): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n');

    // Pattern 1: func TestXxx(t *testing.T) {
    const testFuncPattern = /func\s+(Test\w+)\s*\(\s*(\w+)\s+\*testing\.[TB]\s*\)\s*\{/g;
    let match;

    while ((match = testFuncPattern.exec(content)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(content, match.index);
      const testBody = this.extractTestBody(content, line);
      const directCalls = this.extractFunctionCalls(testBody);

      testCases.push({
        id: `${filePath}:${name}:${line}`,
        name,
        qualifiedName: name,
        file: filePath,
        line,
        directCalls,
        transitiveCalls: [],
        assertions: [],
        quality: {
          assertionCount: 0,
          hasErrorCases: false,
          hasEdgeCases: false,
          mockRatio: 0,
          setupRatio: 0,
          score: 50,
        },
      });
    }

    // Pattern 2: func BenchmarkXxx(b *testing.B) {
    const benchmarkPattern = /func\s+(Benchmark\w+)\s*\(\s*(\w+)\s+\*testing\.B\s*\)\s*\{/g;

    while ((match = benchmarkPattern.exec(content)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(content, match.index);
      const testBody = this.extractTestBody(content, line);
      const directCalls = this.extractFunctionCalls(testBody);

      testCases.push({
        id: `${filePath}:${name}:${line}`,
        name,
        qualifiedName: name,
        file: filePath,
        line,
        directCalls,
        transitiveCalls: [],
        assertions: [],
        // Note: isBenchmark not in TestCase type, tracked via name prefix
        quality: {
          assertionCount: 0,
          hasErrorCases: false,
          hasEdgeCases: false,
          mockRatio: 0,
          setupRatio: 0,
          score: 50,
        },
      });
    }

    // Pattern 3: t.Run("name", func(t *testing.T) { - subtests
    const subtestPattern = /(\w+)\.Run\s*\(\s*"([^"]+)"\s*,\s*func\s*\(\s*\w+\s+\*testing\.[TB]\s*\)/g;

    while ((match = subtestPattern.exec(content)) !== null) {
      const name = match[2]!;
      const line = this.getLineNumber(content, match.index);

      // Find parent test
      let parentTest: string | undefined;
      for (let i = line - 1; i >= 0; i--) {
        const parentMatch = lines[i]?.match(/func\s+(Test\w+)\s*\(/);
        if (parentMatch) {
          parentTest = parentMatch[1];
          break;
        }
      }

      testCases.push({
        id: `${filePath}:subtest:${name}:${line}`,
        name,
        qualifiedName: parentTest ? `${parentTest}/${name}` : name,
        parentBlock: parentTest,
        file: filePath,
        line,
        directCalls: [],
        transitiveCalls: [],
        assertions: [],
        // Note: isSubtest tracked via parentBlock and id prefix
        quality: {
          assertionCount: 0,
          hasErrorCases: false,
          hasEdgeCases: false,
          mockRatio: 0,
          setupRatio: 0,
          score: 50,
        },
      });
    }

    // Pattern 4: Ginkgo It/Describe/Context blocks
    if (framework === 'ginkgo') {
      const ginkgoItPattern = /It\s*\(\s*"([^"]+)"/g;
      while ((match = ginkgoItPattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);

        testCases.push({
          id: `${filePath}:ginkgo:${name}:${line}`,
          name,
          qualifiedName: name,
          file: filePath,
          line,
          directCalls: [],
          transitiveCalls: [],
          assertions: [],
          quality: {
            assertionCount: 0,
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
   * Extract test body based on brace matching
   */
  private extractTestBody(content: string, startLine: number): string {
    const lines = content.split('\n');
    const bodyLines: string[] = [];
    let braceCount = 0;
    let started = false;

    for (let i = startLine - 1; i < Math.min(startLine + 200, lines.length); i++) {
      const line = lines[i]!;

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (started) {
        bodyLines.push(line);
      }

      if (started && braceCount === 0) {
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

    // Pattern for function calls: funcName(
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

    // Pattern for method calls: obj.Method(
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
   * Extract assertions from test body
   */
  private extractAssertions(body: string, baseLineNum: number, framework: TestFramework): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = baseLineNum + i;

      // Standard testing.T assertions: t.Error, t.Errorf, t.Fatal, t.Fatalf
      const tErrorMatch = line.match(/\b(\w+)\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/);
      if (tErrorMatch) {
        assertions.push({
          matcher: tErrorMatch[2]!,
          line: lineNum,
          isErrorAssertion: true,
          isEdgeCaseAssertion: false,
        });
      }

      // testify assert: assert.Equal, assert.NoError, etc.
      const assertMatch = line.match(/\b(assert|require)\.(Equal|NotEqual|True|False|Nil|NotNil|NoError|Error|Contains|Empty|NotEmpty|Zero|Len|Greater|Less|Panics)\s*\(/);
      if (assertMatch) {
        const pkg = assertMatch[1]!;
        const method = assertMatch[2]!;
        assertions.push({
          matcher: `${pkg}.${method}`,
          line: lineNum,
          isErrorAssertion: method === 'Error' || method === 'NoError' || method === 'Panics',
          isEdgeCaseAssertion: method === 'Nil' || method === 'NotNil' ||
                              method === 'Empty' || method === 'NotEmpty' ||
                              method === 'Zero' || method === 'True' || method === 'False',
        });
      }

      // testify suite assertions: s.Equal, s.NoError, etc.
      const suiteMatch = line.match(/\b(\w+)\.(Equal|NotEqual|True|False|Nil|NotNil|NoError|Error|Contains|Empty|NotEmpty|Zero)\s*\(/);
      if (suiteMatch && !assertMatch && !tErrorMatch) {
        const method = suiteMatch[2]!;
        assertions.push({
          matcher: `suite.${method}`,
          line: lineNum,
          isErrorAssertion: method === 'Error' || method === 'NoError',
          isEdgeCaseAssertion: method === 'Nil' || method === 'NotNil' ||
                              method === 'Empty' || method === 'NotEmpty' ||
                              method === 'Zero' || method === 'True' || method === 'False',
        });
      }

      // gomega Expect: Expect(x).To(Equal(y))
      if (framework === 'gomega' || framework === 'ginkgo') {
        const gomegaMatch = line.match(/Expect\s*\([^)]+\)\s*\.\s*(To|ToNot|NotTo)\s*\(/);
        if (gomegaMatch) {
          assertions.push({
            matcher: `Expect.${gomegaMatch[1]}`,
            line: lineNum,
            isErrorAssertion: line.includes('HaveOccurred') || line.includes('Panic'),
            isEdgeCaseAssertion: line.includes('BeNil') || line.includes('BeEmpty') ||
                                line.includes('BeZero') || line.includes('BeTrue') ||
                                line.includes('BeFalse'),
          });
        }
      }

      // Simple if err != nil check (common Go pattern)
      if (/if\s+err\s*!=\s*nil/.test(line)) {
        assertions.push({
          matcher: 'err != nil',
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

    // gomock: ctrl.EXPECT()
    const gomockPattern = /(\w+)\.EXPECT\(\)/g;
    let match;

    while ((match = gomockPattern.exec(content)) !== null) {
      mocks.push({
        target: match[1]!,
        mockType: 'gomock',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // gomock: NewMockXxx(ctrl)
    const newMockPattern = /NewMock(\w+)\s*\(\s*(\w+)\s*\)/g;
    while ((match = newMockPattern.exec(content)) !== null) {
      mocks.push({
        target: `Mock${match[1]}`,
        mockType: 'gomock',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // testify mock: mock.On("Method"
    const testifyMockPattern = /(\w+)\.On\s*\(\s*"(\w+)"/g;
    while ((match = testifyMockPattern.exec(content)) !== null) {
      mocks.push({
        target: `${match[1]}.${match[2]}`,
        mockType: 'testify-mock',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // testify mock: mock.AssertExpectations
    const assertExpectPattern = /(\w+)\.AssertExpectations\s*\(/g;
    while ((match = assertExpectPattern.exec(content)) !== null) {
      mocks.push({
        target: match[1]!,
        mockType: 'testify-mock',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // httptest.NewServer
    const httptestPattern = /httptest\.NewServer\s*\(/g;
    while ((match = httptestPattern.exec(content)) !== null) {
      mocks.push({
        target: 'httptest.Server',
        mockType: 'httptest',
        line: this.getLineNumber(content, match.index),
        isExternal: true,
      });
    }

    // httptest.NewRecorder
    const recorderPattern = /httptest\.NewRecorder\s*\(/g;
    while ((match = recorderPattern.exec(content)) !== null) {
      mocks.push({
        target: 'httptest.Recorder',
        mockType: 'httptest',
        line: this.getLineNumber(content, match.index),
        isExternal: true,
      });
    }

    return mocks;
  }

  /**
   * Extract setup blocks
   */
  extractSetupBlocks(content: string): SetupBlock[] {
    const blocks: SetupBlock[] = [];

    // TestMain function
    const testMainPattern = /func\s+TestMain\s*\(\s*\w+\s+\*testing\.M\s*\)\s*\{/g;
    let match;

    while ((match = testMainPattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const body = this.extractTestBody(content, line);
      const calls = this.extractFunctionCalls(body);

      blocks.push({
        type: 'beforeAll',
        line,
        calls,
      });
    }

    // t.Cleanup()
    const cleanupPattern = /(\w+)\.Cleanup\s*\(\s*func\s*\(\s*\)/g;
    while ((match = cleanupPattern.exec(content)) !== null) {
      blocks.push({
        type: 'afterEach',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    // defer statements in tests (common cleanup pattern)
    const deferPattern = /defer\s+(\w+)\s*\(/g;
    while ((match = deferPattern.exec(content)) !== null) {
      blocks.push({
        type: 'afterEach',
        line: this.getLineNumber(content, match.index),
        calls: [match[1]!],
      });
    }

    // Ginkgo BeforeEach/AfterEach
    const ginkgoBeforePattern = /BeforeEach\s*\(\s*func\s*\(\s*\)/g;
    while ((match = ginkgoBeforePattern.exec(content)) !== null) {
      blocks.push({
        type: 'beforeEach',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    const ginkgoAfterPattern = /AfterEach\s*\(\s*func\s*\(\s*\)/g;
    while ((match = ginkgoAfterPattern.exec(content)) !== null) {
      blocks.push({
        type: 'afterEach',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    // Ginkgo BeforeSuite/AfterSuite
    const ginkgoBeforeSuitePattern = /BeforeSuite\s*\(\s*func\s*\(\s*\)/g;
    while ((match = ginkgoBeforeSuitePattern.exec(content)) !== null) {
      blocks.push({
        type: 'beforeAll',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    const ginkgoAfterSuitePattern = /AfterSuite\s*\(\s*func\s*\(\s*\)/g;
    while ((match = ginkgoAfterSuitePattern.exec(content)) !== null) {
      blocks.push({
        type: 'afterAll',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    return blocks;
  }

  /**
   * Check if a function name is a test framework call
   */
  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      // Standard testing
      'Error', 'Errorf', 'Fatal', 'Fatalf', 'Fail', 'FailNow',
      'Log', 'Logf', 'Skip', 'Skipf', 'SkipNow',
      'Run', 'Parallel', 'Helper', 'Cleanup',
      // testify
      'Equal', 'NotEqual', 'True', 'False', 'Nil', 'NotNil',
      'NoError', 'Error', 'Contains', 'Empty', 'NotEmpty',
      'Zero', 'Len', 'Greater', 'Less', 'Panics',
      'On', 'Return', 'AssertExpectations', 'AssertCalled',
      // gomock
      'EXPECT', 'Return', 'Times', 'AnyTimes', 'Do', 'DoAndReturn',
      // ginkgo/gomega
      'Describe', 'Context', 'It', 'Specify', 'By',
      'BeforeEach', 'AfterEach', 'BeforeSuite', 'AfterSuite',
      'Expect', 'To', 'ToNot', 'NotTo', 'Should', 'ShouldNot',
      // common
      'New', 'NewMock',
    ];
    return frameworkCalls.includes(name);
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
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
export function createGoTestRegexExtractor(): GoTestRegexExtractor {
  return new GoTestRegexExtractor();
}
