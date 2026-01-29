/**
 * C# Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports xUnit, NUnit, MSTest, and Moq.
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

export class CSharpTestRegexExtractor {
  readonly language = 'csharp' as const;
  readonly extensions = ['.cs'];

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
      language: 'csharp',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  /**
   * Detect test framework
   */
  detectFramework(content: string): TestFramework {
    // Check using statements
    if (/using\s+Xunit/.test(content) || /using\s+xUnit/.test(content)) {return 'xunit';}
    if (/using\s+NUnit/.test(content)) {return 'nunit';}
    if (/using\s+Microsoft\.VisualStudio\.TestTools\.UnitTesting/.test(content)) {return 'mstest';}
    
    // Check attributes
    if (/\[Fact\]|\[Theory\]/.test(content)) {return 'xunit';}
    if (/\[Test\]|\[TestCase\(/.test(content)) {return 'nunit';}
    if (/\[TestMethod\]|\[DataTestMethod\]/.test(content)) {return 'mstest';}

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

    // Test attributes to look for
    const testAttributes = ['[Fact]', '[Theory]', '[Test]', '[TestCase(', '[TestMethod]', '[DataTestMethod]'];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Check for class definition
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        currentClass = classMatch[1];
        continue;
      }

      // Check for test attributes
      const hasTestAttribute = testAttributes.some(attr => line.includes(attr));
      if (hasTestAttribute) {
        // Find the method on this or next lines
        let methodLine = i;
        let methodMatch: RegExpMatchArray | null = null;
        
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          methodMatch = lines[j]!.match(/(?:public|private|protected|internal)?\s*(?:async\s+)?(?:Task|void|[A-Z]\w*)\s+(\w+)\s*\(/);
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

      // xUnit/NUnit Assert.*
      const assertMatch = line.match(/Assert\.(\w+)\s*[<(]/);
      if (assertMatch) {
        const method = assertMatch[1]!;
        assertions.push({
          matcher: `Assert.${method}`,
          line: lineNum,
          isErrorAssertion: method === 'Throws' || method === 'ThrowsAsync' ||
                           method === 'ThrowsAny' || method === 'ThrowsAnyAsync',
          isEdgeCaseAssertion: method === 'Null' || method === 'NotNull' ||
                              method === 'Empty' || method === 'NotEmpty' ||
                              method === 'IsNull' || method === 'IsNotNull',
        });
      }

      // FluentAssertions .Should()
      if (/\.Should\(\)/.test(line)) {
        assertions.push({
          matcher: 'Should',
          line: lineNum,
          isErrorAssertion: false,
          isEdgeCaseAssertion: false,
        });
      }

      // Moq Verify
      const verifyMatch = line.match(/\.(Verify|VerifyAll|VerifyNoOtherCalls)\s*\(/);
      if (verifyMatch) {
        assertions.push({
          matcher: `Mock.${verifyMatch[1]}`,
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

      // new Mock<T>() (Moq)
      const moqMatch = line.match(/new\s+Mock<([^>]+)>\s*\(/);
      if (moqMatch) {
        mocks.push({
          target: moqMatch[1]!,
          mockType: 'Mock<T>',
          line: lineNum,
          isExternal: this.isExternalCSharpType(moqMatch[1]!),
        });
      }

      // Substitute.For<T>() (NSubstitute)
      const nsubMatch = line.match(/Substitute\.For<([^>]+)>\s*\(/);
      if (nsubMatch) {
        mocks.push({
          target: nsubMatch[1]!,
          mockType: 'Substitute.For<T>',
          line: lineNum,
          isExternal: this.isExternalCSharpType(nsubMatch[1]!),
        });
      }

      // A.Fake<T>() (FakeItEasy)
      const fakeMatch = line.match(/A\.Fake<([^>]+)>\s*\(/);
      if (fakeMatch) {
        mocks.push({
          target: fakeMatch[1]!,
          mockType: 'A.Fake<T>',
          line: lineNum,
          isExternal: this.isExternalCSharpType(fakeMatch[1]!),
        });
      }

      // .Setup() calls (Moq)
      const setupMatch = line.match(/\.(Setup|SetupGet|SetupSet|SetupSequence)\s*\(/);
      if (setupMatch) {
        mocks.push({
          target: 'mock_setup',
          mockType: `Moq.${setupMatch[1]}`,
          line: lineNum,
          isExternal: false,
          hasImplementation: true,
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

    const setupAttributes: Record<string, SetupBlock['type']> = {
      // NUnit
      '[SetUp]': 'beforeEach',
      '[TearDown]': 'afterEach',
      '[OneTimeSetUp]': 'beforeAll',
      '[OneTimeTearDown]': 'afterAll',
      // MSTest
      '[TestInitialize]': 'beforeEach',
      '[TestCleanup]': 'afterEach',
      '[ClassInitialize]': 'beforeAll',
      '[ClassCleanup]': 'afterAll',
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      for (const [attribute, type] of Object.entries(setupAttributes)) {
        if (line.includes(attribute)) {
          // Find the method body
          let methodLine = i;
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (/(?:public|private|protected|internal)?\s*(?:async\s+)?(?:Task|void)\s+\w+\s*\(/.test(lines[j]!)) {
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

      // xUnit: constructor is setup
      if (/public\s+\w+\s*\(\s*\)/.test(line) && i > 0) {
        // Check if this is a constructor (class name matches)
        const prevLines = lines.slice(Math.max(0, i - 10), i).join('\n');
        const classMatch = prevLines.match(/class\s+(\w+)/);
        const ctorMatch = line.match(/public\s+(\w+)\s*\(/);
        
        if (classMatch && ctorMatch && classMatch[1] === ctorMatch[1]) {
          const body = this.extractMethodBody(lines, i);
          const calls = this.extractFunctionCalls(body);

          blocks.push({
            type: 'beforeEach',
            line: lineNum,
            calls,
          });
        }
      }
    }

    return blocks;
  }

  private isTestFrameworkCall(name: string): boolean {
    const frameworkCalls = [
      'Assert', 'Equal', 'True', 'False', 'Null', 'NotNull', 'Empty', 'NotEmpty',
      'Throws', 'ThrowsAsync', 'ThrowsAny', 'ThrowsAnyAsync', 'Same', 'NotSame',
      'Contains', 'DoesNotContain', 'InRange', 'NotInRange', 'IsType', 'IsNotType',
      'Should', 'Be', 'Have', 'Contain', 'Match', 'Verify', 'VerifyAll',
      'Setup', 'SetupGet', 'SetupSet', 'Returns', 'ReturnsAsync', 'Callback',
    ];
    return frameworkCalls.includes(name);
  }

  private isExternalCSharpType(typeName: string): boolean {
    // Interface naming convention - typically internal
    if (typeName.startsWith('I') && typeName.length > 1 && 
        typeName[1] === typeName[1]?.toUpperCase()) {
      return false;
    }
    
    // Common external types
    const externalPrefixes = [
      'System.', 'Microsoft.', 'Newtonsoft.', 'AutoMapper.',
      'Serilog.', 'NLog.', 'log4net.',
    ];
    
    return externalPrefixes.some(prefix => typeName.startsWith(prefix));
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
export function createCSharpTestRegexExtractor(): CSharpTestRegexExtractor {
  return new CSharpTestRegexExtractor();
}
