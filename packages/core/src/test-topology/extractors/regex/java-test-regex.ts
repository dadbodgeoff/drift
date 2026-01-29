/**
 * Java Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports JUnit 4/5, TestNG, and Mockito.
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

export class JavaTestRegexExtractor {
  readonly language = 'java' as const;
  readonly extensions = ['.java'];

  /**
   * Extract test information using regex patterns
   */
  extract(content: string, filePath: string): TestExtraction {
    const framework = this.detectFramework(content);
    const testCases = this.extractTestCases(content, filePath);
    const mocks = this.extractMocks(content);
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
      language: 'java',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  /**
   * Detect test framework
   */
  detectFramework(content: string): TestFramework {
    // Check imports
    if (/import\s+org\.junit\.jupiter/.test(content)) {return 'junit5';}
    if (/import\s+org\.junit\./.test(content)) {return 'junit4';}
    if (/import\s+org\.testng\./.test(content)) {return 'testng';}
    
    // Check annotations
    if (/@Test/.test(content)) {
      if (/org\.junit\.jupiter/.test(content)) {return 'junit5';}
      return 'junit4';
    }

    return 'unknown';
  }

  /**
   * Extract test cases
   */
  extractTestCases(content: string, filePath: string): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n');
    
    // Track current class
    let currentClass: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Check for class definition
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        currentClass = classMatch[1];
        continue;
      }

      // Check for @Test annotation
      if (/@Test/.test(line)) {
        // Find the method on this or next lines
        let methodLine = i;
        let methodMatch: RegExpMatchArray | null = null;
        
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          methodMatch = lines[j]!.match(/(?:public|private|protected)?\s*(?:void|[A-Z]\w*)\s+(\w+)\s*\(/);
          if (methodMatch) {
            methodLine = j;
            break;
          }
        }

        if (methodMatch) {
          const testName = methodMatch[1]!;
          const qualifiedName = currentClass 
            ? `${currentClass}.${testName}`
            : testName;

          // Extract test body
          const testBody = this.extractMethodBody(lines, methodLine);
          const directCalls = this.extractFunctionCalls(testBody);
          const assertions = this.extractAssertions(testBody, lineNum);

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
    }

    return testCases;
  }

  /**
   * Extract method body based on braces
   */
  private extractMethodBody(lines: string[], startIndex: number): string {
    const bodyLines: string[] = [];
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < Math.min(startIndex + 200, lines.length); i++) {
      const line = lines[i]!;
      
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
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

    // Pattern for method calls
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

    return calls;
  }

  /**
   * Extract assertions
   */
  private extractAssertions(body: string, baseLineNum: number): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = baseLineNum + i;

      // JUnit assertions: assert*, fail
      const assertMatch = line.match(/\b(assert\w+|fail)\s*\(/);
      if (assertMatch) {
        const matcher = assertMatch[1]!;
        assertions.push({
          matcher,
          line: lineNum,
          isErrorAssertion: matcher === 'assertThrows' || matcher === 'assertDoesNotThrow',
          isEdgeCaseAssertion: matcher === 'assertNull' || matcher === 'assertNotNull' ||
                              matcher === 'assertTrue' || matcher === 'assertFalse',
        });
      }

      // Mockito verify
      if (/\bverify\s*\(/.test(line)) {
        assertions.push({
          matcher: 'verify',
          line: lineNum,
          isErrorAssertion: false,
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

      // @Mock annotation
      if (/@Mock\b/.test(line)) {
        // Get field from next line
        const nextLine = lines[i + 1];
        if (nextLine) {
          const fieldMatch = nextLine.match(/(\w+)\s+(\w+)\s*;/);
          if (fieldMatch) {
            mocks.push({
              target: `${fieldMatch[1]}.${fieldMatch[2]}`,
              mockType: '@Mock',
              line: lineNum,
              isExternal: false,
            });
          }
        }
      }

      // @MockBean annotation (Spring)
      if (/@MockBean\b/.test(line)) {
        const nextLine = lines[i + 1];
        if (nextLine) {
          const fieldMatch = nextLine.match(/(\w+)\s+(\w+)\s*;/);
          if (fieldMatch) {
            mocks.push({
              target: `${fieldMatch[1]}.${fieldMatch[2]}`,
              mockType: '@MockBean',
              line: lineNum,
              isExternal: false,
            });
          }
        }
      }

      // @Spy annotation
      if (/@Spy\b/.test(line)) {
        const nextLine = lines[i + 1];
        if (nextLine) {
          const fieldMatch = nextLine.match(/(\w+)\s+(\w+)\s*;/);
          if (fieldMatch) {
            mocks.push({
              target: `${fieldMatch[1]}.${fieldMatch[2]}`,
              mockType: '@Spy',
              line: lineNum,
              isExternal: false,
            });
          }
        }
      }

      // Mockito.mock() calls
      const mockCallMatch = line.match(/Mockito\.mock\s*\(\s*(\w+)\.class\s*\)/);
      if (mockCallMatch) {
        mocks.push({
          target: mockCallMatch[1]!,
          mockType: 'Mockito.mock',
          line: lineNum,
          isExternal: false,
        });
      }

      // Mockito.spy() calls
      const spyCallMatch = line.match(/Mockito\.spy\s*\(\s*(\w+)/);
      if (spyCallMatch) {
        mocks.push({
          target: spyCallMatch[1]!,
          mockType: 'Mockito.spy',
          line: lineNum,
          isExternal: false,
        });
      }

      // mock() static import
      const staticMockMatch = line.match(/\bmock\s*\(\s*(\w+)\.class\s*\)/);
      if (staticMockMatch && !line.includes('Mockito.')) {
        mocks.push({
          target: staticMockMatch[1]!,
          mockType: 'mock',
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

    const setupAnnotations: Record<string, SetupBlock['type']> = {
      '@BeforeEach': 'beforeEach',
      '@AfterEach': 'afterEach',
      '@BeforeAll': 'beforeAll',
      '@AfterAll': 'afterAll',
      '@Before': 'beforeEach',  // JUnit 4
      '@After': 'afterEach',    // JUnit 4
      '@BeforeClass': 'beforeAll',  // JUnit 4
      '@AfterClass': 'afterAll',    // JUnit 4
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      for (const [annotation, type] of Object.entries(setupAnnotations)) {
        if (line.includes(annotation)) {
          // Find the method body
          let methodLine = i;
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (/(?:public|private|protected)?\s*(?:void|static\s+void)\s+\w+\s*\(/.test(lines[j]!)) {
              methodLine = j;
              break;
            }
          }

          const body = this.extractMethodBody(lines, methodLine);
          const calls = this.extractFunctionCalls(body);

          blocks.push({
            type,
            line: lineNum,
            calls,
          });
          break;
        }
      }
    }

    return blocks;
  }

  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      'assertEquals', 'assertTrue', 'assertFalse', 'assertNull', 'assertNotNull',
      'assertThrows', 'assertDoesNotThrow', 'assertArrayEquals', 'assertSame',
      'assertNotSame', 'assertAll', 'fail', 'verify', 'when', 'given', 'then',
      'mock', 'spy', 'doReturn', 'doThrow', 'doNothing', 'doAnswer',
    ];
    return frameworkCalls.includes(name);
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
export function createJavaTestRegexExtractor(): JavaTestRegexExtractor {
  return new JavaTestRegexExtractor();
}
