/**
 * Rust Test Regex Extractor
 *
 * Regex-based fallback for extracting test information when tree-sitter is unavailable.
 * Supports Rust's built-in test framework, tokio-test, and common testing patterns.
 *
 * @requirements Rust Language Support
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

export class RustTestRegexExtractor {
  readonly language = 'rust' as const;
  readonly extensions = ['.rs'];

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
      language: 'rust',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  /**
   * Detect test framework from imports and patterns
   */
  detectFramework(content: string): TestFramework {
    // Check for tokio test
    if (content.includes('#[tokio::test]')) {return 'tokio-test';}

    // Check for proptest
    if (content.includes('proptest!') || content.includes('use proptest')) {return 'proptest';}

    // Check for criterion benchmarks
    if (content.includes('criterion_group!') || content.includes('use criterion')) {return 'criterion';}

    // Check for rstest
    if (content.includes('#[rstest]') || content.includes('use rstest')) {return 'rstest';}

    // Check for standard test attribute
    if (content.includes('#[test]') || content.includes('#[cfg(test)]')) {return 'rust-test';}

    return 'unknown';
  }

  /**
   * Extract test cases from content
   */
  extractTestCases(content: string, filePath: string, _framework: TestFramework): TestCase[] {
    const testCases: TestCase[] = [];

    // Pattern 1: #[test] fn test_name() {
    const testFuncPattern = /#\[test\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+([a-zA-Z_]\w*)\s*\(\s*\)/g;
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

    // Pattern 2: #[tokio::test] async fn test_name() {
    const tokioTestPattern = /#\[tokio::test(?:\([^\)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*async\s+fn\s+([a-zA-Z_]\w*)\s*\(\s*\)/g;

    while ((match = tokioTestPattern.exec(content)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(content, match.index);
      const testBody = this.extractTestBody(content, line);
      const directCalls = this.extractFunctionCalls(testBody);

      // Check if already added by previous pattern
      if (testCases.some(t => t.name === name && t.line === line)) {continue;}

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

    // Pattern 3: #[rstest] fn test_name(params) {
    const rstestPattern = /#\[rstest(?:\([^\)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+([a-zA-Z_]\w*)\s*\([^)]*\)/g;

    while ((match = rstestPattern.exec(content)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(content, match.index);
      const testBody = this.extractTestBody(content, line);
      const directCalls = this.extractFunctionCalls(testBody);

      // Check if already added
      if (testCases.some(t => t.name === name && t.line === line)) {continue;}

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

    // Pattern 4: mod tests { ... } - find tests inside test modules
    const testModPattern = /#\[cfg\(test\)\]\s*mod\s+(\w+)\s*\{/g;

    while ((match = testModPattern.exec(content)) !== null) {
      const modStart = match.index;
      const modEnd = this.findBlockEnd(content, modStart);
      const modBody = content.slice(modStart, modEnd);

      // Find tests within the module
      const innerTestPattern = /#\[test\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+([a-zA-Z_]\w*)\s*\(\s*\)/g;
      let innerMatch;

      while ((innerMatch = innerTestPattern.exec(modBody)) !== null) {
        const name = innerMatch[1]!;
        const absoluteIndex = modStart + innerMatch.index;
        const line = this.getLineNumber(content, absoluteIndex);

        // Check if already added
        if (testCases.some(t => t.name === name && t.line === line)) {continue;}

        const testBody = this.extractTestBody(content, line);
        const directCalls = this.extractFunctionCalls(testBody);

        testCases.push({
          id: `${filePath}:${name}:${line}`,
          name,
          qualifiedName: `tests::${name}`,
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
   * Find the end of a block starting at given index
   */
  private findBlockEnd(content: string, startIndex: number): number {
    let braceCount = 0;
    let started = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      if (char === '{') {
        braceCount++;
        started = true;
      } else if (char === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          return i + 1;
        }
      }
    }

    return content.length;
  }

  /**
   * Extract function calls from test body
   */
  private extractFunctionCalls(body: string): string[] {
    const calls: string[] = [];
    const seen = new Set<string>();

    // Pattern for function calls: func_name(
    const callPattern = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    let match;

    while ((match = callPattern.exec(body)) !== null) {
      const name = match[1]!;
      if (this.isTestFrameworkCall(name)) {continue;}
      if (!seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }

    // Pattern for method calls: .method_name(
    const methodPattern = /\.([a-z_][a-z0-9_]*)\s*\(/g;
    while ((match = methodPattern.exec(body)) !== null) {
      const name = match[1]!;
      if (this.isTestFrameworkCall(name)) {continue;}
      if (!seen.has(name)) {
        seen.add(name);
        calls.push(name);
      }
    }

    // Pattern for path calls: Path::func(
    const pathPattern = /::([a-z_][a-z0-9_]*)\s*\(/g;
    while ((match = pathPattern.exec(body)) !== null) {
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
  private extractAssertions(body: string, baseLineNum: number, _framework: TestFramework): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const lines = body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = baseLineNum + i;

      // Standard assert macros
      const assertMatch = line.match(/\b(assert|assert_eq|assert_ne|assert_matches|debug_assert|debug_assert_eq|debug_assert_ne)!\s*\(/);
      if (assertMatch) {
        const macro = assertMatch[1]!;
        assertions.push({
          matcher: macro,
          line: lineNum,
          isErrorAssertion: false,
          isEdgeCaseAssertion: macro === 'assert_ne' || macro === 'debug_assert_ne',
        });
      }

      // panic! and unreachable!
      const panicMatch = line.match(/\b(panic|unreachable|unimplemented|todo)!\s*\(/);
      if (panicMatch) {
        assertions.push({
          matcher: panicMatch[1]!,
          line: lineNum,
          isErrorAssertion: true,
          isEdgeCaseAssertion: false,
        });
      }

      // Result assertions: .unwrap(), .expect(), .is_ok(), .is_err()
      const resultMatch = line.match(/\.(unwrap|expect|is_ok|is_err|unwrap_err|unwrap_or|unwrap_or_else)\s*\(/);
      if (resultMatch) {
        const method = resultMatch[1]!;
        assertions.push({
          matcher: method,
          line: lineNum,
          isErrorAssertion: method === 'is_err' || method === 'unwrap_err',
          isEdgeCaseAssertion: method === 'is_ok' || method === 'is_err',
        });
      }

      // Option assertions: .is_some(), .is_none()
      const optionMatch = line.match(/\.(is_some|is_none|unwrap|expect)\s*\(/);
      if (optionMatch && !resultMatch) {
        const method = optionMatch[1]!;
        assertions.push({
          matcher: method,
          line: lineNum,
          isErrorAssertion: false,
          isEdgeCaseAssertion: method === 'is_none',
        });
      }

      // #[should_panic] attribute (check in test attributes)
      if (line.includes('#[should_panic')) {
        assertions.push({
          matcher: 'should_panic',
          line: lineNum,
          isErrorAssertion: true,
          isEdgeCaseAssertion: false,
        });
      }

      // proptest assertions
      if (line.includes('prop_assert!') || line.includes('prop_assert_eq!')) {
        const propMatch = line.match(/\b(prop_assert|prop_assert_eq|prop_assert_ne)!\s*\(/);
        if (propMatch) {
          assertions.push({
            matcher: propMatch[1]!,
            line: lineNum,
            isErrorAssertion: false,
            isEdgeCaseAssertion: false,
          });
        }
      }
    }

    return assertions;
  }

  /**
   * Extract mock statements
   */
  extractMocks(content: string): MockStatement[] {
    const mocks: MockStatement[] = [];

    // mockall: #[automock] or mock! macro
    const automockPattern = /#\[automock\]/g;
    let match;

    while ((match = automockPattern.exec(content)) !== null) {
      mocks.push({
        target: 'automock',
        mockType: 'mockall',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // mockall: mock! macro
    const mockMacroPattern = /mock!\s*\{/g;
    while ((match = mockMacroPattern.exec(content)) !== null) {
      mocks.push({
        target: 'mock!',
        mockType: 'mockall',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // mockall: MockXxx::new()
    const mockNewPattern = /Mock([A-Z]\w*)::new\s*\(/g;
    while ((match = mockNewPattern.exec(content)) !== null) {
      mocks.push({
        target: `Mock${match[1]}`,
        mockType: 'mockall',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // mockall: .expect_method()
    const expectPattern = /\.expect_([a-z_]\w*)\s*\(/g;
    while ((match = expectPattern.exec(content)) !== null) {
      mocks.push({
        target: `expect_${match[1]}`,
        mockType: 'mockall',
        line: this.getLineNumber(content, match.index),
        isExternal: false,
      });
    }

    // wiremock: MockServer::start()
    const wiremockPattern = /MockServer::start\s*\(/g;
    while ((match = wiremockPattern.exec(content)) !== null) {
      mocks.push({
        target: 'MockServer',
        mockType: 'wiremock',
        line: this.getLineNumber(content, match.index),
        isExternal: true,
      });
    }

    // httpmock: MockServer::start()
    const httpmockPattern = /httpmock::MockServer/g;
    while ((match = httpmockPattern.exec(content)) !== null) {
      mocks.push({
        target: 'httpmock::MockServer',
        mockType: 'httpmock',
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

    // #[fixture] attribute (rstest)
    const fixturePattern = /#\[fixture\]\s*(?:pub\s+)?fn\s+([a-zA-Z_]\w*)/g;
    let match;

    while ((match = fixturePattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const body = this.extractTestBody(content, line);
      const calls = this.extractFunctionCalls(body);

      blocks.push({
        type: 'beforeEach',
        line,
        calls,
      });
    }

    // setup() or setup_*() functions in test modules
    const setupFnPattern = /fn\s+(setup(?:_\w+)?)\s*\(\s*\)/g;
    while ((match = setupFnPattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const body = this.extractTestBody(content, line);
      const calls = this.extractFunctionCalls(body);

      blocks.push({
        type: 'beforeEach',
        line,
        calls,
      });
    }

    // teardown() or teardown_*() functions
    const teardownFnPattern = /fn\s+(teardown(?:_\w+)?)\s*\(\s*\)/g;
    while ((match = teardownFnPattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const body = this.extractTestBody(content, line);
      const calls = this.extractFunctionCalls(body);

      blocks.push({
        type: 'afterEach',
        line,
        calls,
      });
    }

    // Drop implementations (cleanup)
    const dropPattern = /impl\s+Drop\s+for\s+(\w+)/g;
    while ((match = dropPattern.exec(content)) !== null) {
      blocks.push({
        type: 'afterEach',
        line: this.getLineNumber(content, match.index),
        calls: ['drop'],
      });
    }

    // ctor (constructor) crate for global setup
    const ctorPattern = /#\[ctor\]/g;
    while ((match = ctorPattern.exec(content)) !== null) {
      blocks.push({
        type: 'beforeAll',
        line: this.getLineNumber(content, match.index),
        calls: [],
      });
    }

    // dtor (destructor) crate for global teardown
    const dtorPattern = /#\[dtor\]/g;
    while ((match = dtorPattern.exec(content)) !== null) {
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
      // Standard assertions
      'assert', 'assert_eq', 'assert_ne', 'assert_matches',
      'debug_assert', 'debug_assert_eq', 'debug_assert_ne',
      'panic', 'unreachable', 'unimplemented', 'todo',
      // Result/Option methods
      'unwrap', 'expect', 'is_ok', 'is_err', 'is_some', 'is_none',
      'unwrap_err', 'unwrap_or', 'unwrap_or_else', 'unwrap_or_default',
      'ok', 'err', 'map', 'map_err', 'and_then', 'or_else',
      // proptest
      'prop_assert', 'prop_assert_eq', 'prop_assert_ne',
      // Common test utilities
      'setup', 'teardown', 'before', 'after',
      // mockall
      'expect', 'returning', 'times', 'with', 'withf',
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
export function createRustTestRegexExtractor(): RustTestRegexExtractor {
  return new RustTestRegexExtractor();
}
