/**
 * PHP Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports PHPUnit, Pest, and Codeception.
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

export class PHPTestRegexExtractor {
  readonly language = 'php' as const;
  readonly extensions = ['.php'];

  /**
   * Extract test information using regex patterns
   */
  extract(content: string, filePath: string): TestExtraction {
    const framework = this.detectFramework(content);
    const testCases = this.extractTestCases(content, filePath, framework);
    const mocks = this.extractMocks(content);
    const setupBlocks = this.extractSetupBlocks(content, framework);

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
      language: 'php',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  /**
   * Detect test framework
   */
  detectFramework(content: string): TestFramework {
    // Check use statements
    if (/use\s+PHPUnit\\/.test(content)) {return 'phpunit';}
    if (/use\s+.*\\Pest/.test(content) || /use\s+function\s+Pest\\/.test(content)) {return 'pest';}
    if (/use\s+Codeception\\/.test(content)) {return 'codeception';}
    
    // Check for Pest-style tests
    if (/\b(?:test|it)\s*\(\s*['"]/.test(content)) {
      if (/pest/i.test(content)) {return 'pest';}
    }
    
    // Check for PHPUnit TestCase
    if (/extends\s+TestCase/.test(content) || /extends\s+PHPUnit/.test(content)) {
      return 'phpunit';
    }
    
    // Check for @test annotation or test* methods
    if (/@test\b/.test(content) || /function\s+test\w+/.test(content)) {
      return 'phpunit';
    }

    return 'unknown';
  }

  /**
   * Extract test cases
   */
  extractTestCases(content: string, filePath: string, framework: TestFramework): TestCase[] {
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

      // PHPUnit: methods starting with test or having @test annotation
      if (framework === 'phpunit' || framework === 'unknown') {
        // Check for @test in docblock
        let hasTestAnnotation = false;
        for (let j = Math.max(0, i - 10); j < i; j++) {
          if (/@test\b/.test(lines[j]!)) {
            hasTestAnnotation = true;
            break;
          }
        }

        // Check for test* method
        const methodMatch = line.match(/(?:public|protected|private)?\s*function\s+(test\w+)\s*\(/);
        if (methodMatch || (hasTestAnnotation && /function\s+(\w+)\s*\(/.test(line))) {
          const nameMatch = line.match(/function\s+(\w+)\s*\(/);
          if (nameMatch) {
            const testName = nameMatch[1]!;
            const qualifiedName = currentClass 
              ? `${currentClass}::${testName}`
              : testName;

            // Extract test body
            const testBody = this.extractMethodBody(lines, i);
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

      // Pest: test() or it() function calls
      if (framework === 'pest' || framework === 'unknown') {
        const pestMatch = line.match(/\b(test|it)\s*\(\s*['"]([^'"]+)['"]/);
        if (pestMatch) {
          const testName = pestMatch[2]!;

          // Extract test body
          const testBody = this.extractPestBody(lines, i);
          const directCalls = this.extractFunctionCalls(testBody);
          const assertions = this.extractAssertions(testBody, lineNum);

          testCases.push({
            id: `${filePath}:${testName}:${lineNum}`,
            name: testName,
            qualifiedName: testName,
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
   * Extract Pest test body (closure-based)
   */
  private extractPestBody(lines: string[], startIndex: number): string {
    const bodyLines: string[] = [];
    let parenCount = 0;
    let started = false;

    for (let i = startIndex; i < Math.min(startIndex + 100, lines.length); i++) {
      const line = lines[i]!;
      
      for (const char of line) {
        if (char === '(') {
          parenCount++;
          started = true;
        } else if (char === ')') {
          parenCount--;
        }
      }

      bodyLines.push(line);

      if (started && parenCount <= 0) {
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

    // Pattern for method calls: $this->method() or $obj->method()
    const methodPattern = /->\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
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
  private extractAssertions(body: string, baseLineNum: number): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = baseLineNum + i;

      // PHPUnit $this->assert*()
      const assertMatch = line.match(/\$this->(assert\w+|expect\w*)\s*\(/);
      if (assertMatch) {
        const method = assertMatch[1]!;
        assertions.push({
          matcher: method,
          line: lineNum,
          isErrorAssertion: method === 'expectException' || 
                           method === 'expectExceptionMessage' ||
                           method === 'expectExceptionCode',
          isEdgeCaseAssertion: method === 'assertNull' || method === 'assertNotNull' ||
                              method === 'assertEmpty' || method === 'assertNotEmpty',
        });
      }

      // Pest expect() chains
      if (/\bexpect\s*\(/.test(line)) {
        assertions.push({
          matcher: 'expect',
          line: lineNum,
          isErrorAssertion: false,
          isEdgeCaseAssertion: false,
        });
      }

      // Static Assert::* calls
      const staticAssertMatch = line.match(/Assert::(\w+)\s*\(/);
      if (staticAssertMatch) {
        const method = staticAssertMatch[1]!;
        assertions.push({
          matcher: `Assert::${method}`,
          line: lineNum,
          isErrorAssertion: method.includes('Exception') || method.includes('Throws'),
          isEdgeCaseAssertion: method.includes('Null') || method.includes('Empty'),
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

      // $this->createMock()
      const createMockMatch = line.match(/\$this->createMock\s*\(\s*([^)]+)\s*\)/);
      if (createMockMatch) {
        const target = this.extractClassReference(createMockMatch[1]!);
        mocks.push({
          target,
          mockType: 'PHPUnit.createMock',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // $this->createPartialMock()
      const partialMockMatch = line.match(/\$this->createPartialMock\s*\(\s*([^,)]+)/);
      if (partialMockMatch) {
        const target = this.extractClassReference(partialMockMatch[1]!);
        mocks.push({
          target,
          mockType: 'PHPUnit.createPartialMock',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // $this->createStub()
      const stubMatch = line.match(/\$this->createStub\s*\(\s*([^)]+)\s*\)/);
      if (stubMatch) {
        const target = this.extractClassReference(stubMatch[1]!);
        mocks.push({
          target,
          mockType: 'PHPUnit.createStub',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // $this->getMockBuilder()
      const mockBuilderMatch = line.match(/\$this->getMockBuilder\s*\(\s*([^)]+)\s*\)/);
      if (mockBuilderMatch) {
        const target = this.extractClassReference(mockBuilderMatch[1]!);
        mocks.push({
          target,
          mockType: 'PHPUnit.getMockBuilder',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // $this->prophesize() (Prophecy)
      const prophesizeMatch = line.match(/\$this->prophesize\s*\(\s*([^)]+)\s*\)/);
      if (prophesizeMatch) {
        const target = this.extractClassReference(prophesizeMatch[1]!);
        mocks.push({
          target,
          mockType: 'Prophecy.prophesize',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // Mockery::mock()
      const mockeryMatch = line.match(/Mockery::mock\s*\(\s*([^)]+)\s*\)/);
      if (mockeryMatch) {
        const target = this.extractClassReference(mockeryMatch[1]!);
        mocks.push({
          target,
          mockType: 'Mockery.mock',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
        });
      }

      // mock() function (Pest)
      const pestMockMatch = line.match(/\bmock\s*\(\s*([^)]+)\s*\)/);
      if (pestMockMatch && !line.includes('Mockery::') && !line.includes('$this->')) {
        const target = this.extractClassReference(pestMockMatch[1]!);
        mocks.push({
          target,
          mockType: 'Pest.mock',
          line: lineNum,
          isExternal: this.isExternalPHPClass(target),
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

    // PHPUnit setup methods
    const phpunitSetup: Record<string, SetupBlock['type']> = {
      'setUp': 'setUp',
      'tearDown': 'tearDown',
      'setUpBeforeClass': 'beforeAll',
      'tearDownAfterClass': 'afterAll',
    };

    // Pest setup functions
    const pestSetup: Record<string, SetupBlock['type']> = {
      'beforeEach': 'beforeEach',
      'afterEach': 'afterEach',
      'beforeAll': 'beforeAll',
      'afterAll': 'afterAll',
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // PHPUnit: setUp, tearDown, etc.
      if (framework === 'phpunit' || framework === 'unknown') {
        for (const [method, type] of Object.entries(phpunitSetup)) {
          const pattern = new RegExp(`function\\s+${method}\\s*\\(`);
          if (pattern.test(line)) {
            const body = this.extractMethodBody(lines, i);
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

      // Pest: beforeEach(), afterEach(), etc.
      if (framework === 'pest' || framework === 'unknown') {
        for (const [fn, type] of Object.entries(pestSetup)) {
          const pattern = new RegExp(`\\b${fn}\\s*\\(`);
          if (pattern.test(line)) {
            const body = this.extractPestBody(lines, i);
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
    }

    return blocks;
  }

  private extractClassReference(text: string): string {
    let result = text.trim();
    // Remove ::class suffix
    if (result.endsWith('::class')) {
      result = result.slice(0, -7);
    }
    // Remove quotes
    if ((result.startsWith('"') && result.endsWith('"')) ||
        (result.startsWith("'") && result.endsWith("'"))) {
      result = result.slice(1, -1);
    }
    // Remove leading backslash
    if (result.startsWith('\\')) {
      result = result.slice(1);
    }
    return result;
  }

  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      'test', 'it', 'describe', 'expect', 'beforeEach', 'afterEach',
      'beforeAll', 'afterAll', 'setUp', 'tearDown', 'setUpBeforeClass',
      'tearDownAfterClass', 'mock', 'createMock', 'createStub', 'prophesize',
      'assertTrue', 'assertFalse', 'assertEquals', 'assertNull', 'assertNotNull',
      'assertEmpty', 'assertNotEmpty', 'assertSame', 'assertNotSame',
      'expectException', 'expectExceptionMessage', 'expectExceptionCode',
    ];
    return frameworkCalls.includes(name);
  }

  private isExternalPHPClass(className: string): boolean {
    // Common external namespaces
    const externalPrefixes = [
      'Illuminate\\', 'Laravel\\', 'Symfony\\', 'Doctrine\\',
      'GuzzleHttp\\', 'Monolog\\', 'Carbon\\', 'League\\',
      'Psr\\', 'PHPUnit\\', 'Mockery\\',
    ];
    
    return externalPrefixes.some(prefix => className.startsWith(prefix));
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
export function createPHPTestRegexExtractor(): PHPTestRegexExtractor {
  return new PHPTestRegexExtractor();
}
