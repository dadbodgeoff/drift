/**
 * C++ Test Extractor
 *
 * Extracts test information from C++ test frameworks.
 * 
 * Supports:
 * - Google Test (gtest)
 * - Catch2
 * - Boost.Test
 * - doctest
 * - CppUnit
 */

import { BaseTestExtractor } from './base-test-extractor.js';

import type {
  TestExtraction,
  TestCase,
  MockStatement,
  SetupBlock,
  AssertionInfo,
  TestFramework,
  FixtureInfo,
} from '../types.js';
import type Parser from 'tree-sitter';

// ============================================================================
// Extractor Implementation
// ============================================================================

export class CppTestExtractor extends BaseTestExtractor {
  private sourceContent: string = '';
  private detectedFramework: TestFramework = 'unknown';

  constructor(parser: Parser) {
    // Use 'go' as proxy since 'cpp' isn't in the base type union
    super(parser, 'go');
  }

  extract(content: string, filePath: string): TestExtraction {
    this.sourceContent = content;
    const tree = this.parser.parse(content);
    const root = tree.rootNode;

    this.detectedFramework = this.detectFramework(root);
    const testCases = this.extractTestCases(root);
    const mocks = this.extractMocks(root, this.detectedFramework);
    const setupBlocks = this.extractSetupBlocks(root);
    const fixtures = this.extractFixtures(root);

    // Enrich test cases with quality
    for (const test of testCases) {
      const testMocks = mocks.filter(m => 
        m.line >= test.line && m.line <= test.line + 100
      );
      test.quality = this.calculateQuality(test.assertions, testMocks, test.directCalls);
    }

    return {
      file: filePath,
      framework: this.detectedFramework,
      language: 'cpp',
      testCases,
      mocks,
      setupBlocks,
      fixtures,
    };
  }

  detectFramework(_root: Parser.SyntaxNode): TestFramework {
    const content = this.sourceContent;
    
    // Check for Google Test
    if (content.includes('TEST(') || content.includes('TEST_F(') ||
        content.includes('#include <gtest/') || content.includes('#include "gtest/')) {
      return 'gtest';
    }

    // Check for Catch2
    if (content.includes('TEST_CASE(') || content.includes('SECTION(') ||
        content.includes('#include <catch2/') || content.includes('#include "catch.hpp"')) {
      return 'catch2';
    }

    // Check for Boost.Test
    if (content.includes('BOOST_AUTO_TEST_CASE') || content.includes('BOOST_TEST_SUITE') ||
        content.includes('#include <boost/test/')) {
      return 'boost-test';
    }

    // Check for doctest
    if (content.includes('DOCTEST_TEST_CASE') || content.includes('SUBCASE(') ||
        content.includes('#include "doctest.h"') || content.includes('#include <doctest/')) {
      return 'doctest';
    }

    // Check for CppUnit
    if (content.includes('CPPUNIT_TEST') || content.includes('CPPUNIT_ASSERT') ||
        content.includes('#include <cppunit/')) {
      return 'cppunit';
    }

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];
    const framework = this.detectedFramework;

    // Extract macro-based tests (most C++ test frameworks use macros)
    this.extractMacroTests(testCases, framework);

    // Also try to extract from AST for function-based tests
    this.walkNode(root, (node) => {
      if (node.type === 'function_definition') {
        const nameNode = this.findFunctionName(node);
        if (nameNode && this.isTestFunction(nameNode.text)) {
          const bodyNode = node.childForFieldName('body');
          const directCalls = bodyNode ? this.extractFunctionCalls(bodyNode) : [];
          const assertions = bodyNode ? this.extractAssertionsFromNode(bodyNode) : [];

          testCases.push({
            id: this.generateTestId('', nameNode.text, node.startPosition.row),
            name: nameNode.text,
            qualifiedName: nameNode.text,
            file: '',
            line: node.startPosition.row + 1,
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
    });

    return testCases;
  }


  /**
   * Extract macro-based test cases
   */
  private extractMacroTests(testCases: TestCase[], framework: TestFramework): void {
    const content = this.sourceContent;
    
    // Google Test patterns
    if (framework === 'gtest') {
      // TEST(TestSuite, TestName)
      const testPattern = /TEST\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
      let match;
      while ((match = testPattern.exec(content)) !== null) {
        const suite = match[1]!;
        const name = match[2]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(`${suite}.${name}`, name, suite, line));
      }

      // TEST_F(Fixture, TestName)
      const testFPattern = /TEST_F\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
      while ((match = testFPattern.exec(content)) !== null) {
        const fixture = match[1]!;
        const name = match[2]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(`${fixture}.${name}`, name, fixture, line));
      }

      // TEST_P(Fixture, TestName) - parameterized
      const testPPattern = /TEST_P\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
      while ((match = testPPattern.exec(content)) !== null) {
        const fixture = match[1]!;
        const name = match[2]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(`${fixture}.${name}`, name, fixture, line));
      }
    }

    // Catch2 patterns
    if (framework === 'catch2') {
      // TEST_CASE("name", "[tags]")
      const testCasePattern = /TEST_CASE\s*\(\s*"([^"]+)"/g;
      let match;
      while ((match = testCasePattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(name, name, undefined, line));
      }

      // SCENARIO("name")
      const scenarioPattern = /SCENARIO\s*\(\s*"([^"]+)"/g;
      while ((match = scenarioPattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(`Scenario: ${name}`, name, undefined, line));
      }
    }

    // Boost.Test patterns
    if (framework === 'boost-test') {
      // BOOST_AUTO_TEST_CASE(name)
      const autoTestPattern = /BOOST_AUTO_TEST_CASE\s*\(\s*(\w+)\s*\)/g;
      let match;
      while ((match = autoTestPattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(name, name, undefined, line));
      }

      // BOOST_FIXTURE_TEST_CASE(name, fixture)
      const fixtureTestPattern = /BOOST_FIXTURE_TEST_CASE\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g;
      while ((match = fixtureTestPattern.exec(content)) !== null) {
        const name = match[1]!;
        const fixture = match[2]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(`${fixture}.${name}`, name, fixture, line));
      }
    }

    // doctest patterns
    if (framework === 'doctest') {
      // TEST_CASE("name")
      const testCasePattern = /(?:DOCTEST_)?TEST_CASE\s*\(\s*"([^"]+)"/g;
      let match;
      while ((match = testCasePattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        
        testCases.push(this.createTestCase(name, name, undefined, line));
      }
    }
  }

  private createTestCase(
    qualifiedName: string,
    name: string,
    parentBlock: string | undefined,
    line: number
  ): TestCase {
    return {
      id: this.generateTestId('', name, line),
      name,
      parentBlock,
      qualifiedName,
      file: '',
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
    };
  }

  private getLineNumber(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
  }

  private findFunctionName(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    const declarator = node.childForFieldName('declarator');
    if (!declarator) {return null;}

    const visit = (n: Parser.SyntaxNode): Parser.SyntaxNode | null => {
      if (n.type === 'identifier' || n.type === 'field_identifier') {
        return n;
      }
      for (const child of n.children) {
        const result = visit(child);
        if (result) {return result;}
      }
      return null;
    };

    return visit(declarator);
  }

  private isTestFunction(name: string): boolean {
    // Common test function naming patterns
    return name.startsWith('test_') || 
           name.startsWith('Test') ||
           name.endsWith('_test') ||
           name.endsWith('Test');
  }

  extractMocks(_root: Parser.SyntaxNode, framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];
    const content = this.sourceContent;

    // Google Mock patterns
    if (framework === 'gtest') {
      // MOCK_METHOD(return_type, name, (args))
      const mockMethodPattern = /MOCK_METHOD\s*\([^,]+,\s*(\w+)/g;
      let match;
      while ((match = mockMethodPattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        mocks.push({
          target: name,
          mockType: 'gmock',
          line,
          isExternal: false,
        });
      }

      // EXPECT_CALL(mock, method)
      const expectCallPattern = /EXPECT_CALL\s*\(\s*(\w+)\s*,\s*(\w+)/g;
      while ((match = expectCallPattern.exec(content)) !== null) {
        const mockObj = match[1]!;
        const method = match[2]!;
        const line = this.getLineNumber(content, match.index);
        mocks.push({
          target: `${mockObj}.${method}`,
          mockType: 'expect_call',
          line,
          isExternal: false,
        });
      }

      // ON_CALL(mock, method)
      const onCallPattern = /ON_CALL\s*\(\s*(\w+)\s*,\s*(\w+)/g;
      while ((match = onCallPattern.exec(content)) !== null) {
        const mockObj = match[1]!;
        const method = match[2]!;
        const line = this.getLineNumber(content, match.index);
        mocks.push({
          target: `${mockObj}.${method}`,
          mockType: 'on_call',
          line,
          isExternal: false,
        });
      }
    }

    // FakeIt patterns (header-only mocking)
    const fakeItPattern = /Mock<(\w+)>/g;
    let match;
    while ((match = fakeItPattern.exec(content)) !== null) {
      const type = match[1]!;
      const line = this.getLineNumber(content, match.index);
      mocks.push({
        target: type,
        mockType: 'fakeit',
        line,
        isExternal: false,
      });
    }

    // Trompeloeil patterns
    const trompeloeilPattern = /MAKE_MOCK\d*\s*\(\s*(\w+)/g;
    while ((match = trompeloeilPattern.exec(content)) !== null) {
      const name = match[1]!;
      const line = this.getLineNumber(content, match.index);
      mocks.push({
        target: name,
        mockType: 'trompeloeil',
        line,
        isExternal: false,
      });
    }

    return mocks;
  }

  extractSetupBlocks(_root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];
    const content = this.sourceContent;
    const framework = this.detectedFramework;

    // Google Test fixture SetUp/TearDown
    if (framework === 'gtest') {
      // void SetUp() override
      const setUpPattern = /void\s+SetUp\s*\(\s*\)\s*(?:override)?\s*\{/g;
      let match;
      while ((match = setUpPattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        blocks.push({
          type: 'setUp',
          line,
          calls: [],
        });
      }

      // void TearDown() override
      const tearDownPattern = /void\s+TearDown\s*\(\s*\)\s*(?:override)?\s*\{/g;
      while ((match = tearDownPattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        blocks.push({
          type: 'tearDown',
          line,
          calls: [],
        });
      }

      // static void SetUpTestSuite()
      const setUpSuitePattern = /static\s+void\s+SetUpTestSuite\s*\(\s*\)/g;
      while ((match = setUpSuitePattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        blocks.push({
          type: 'beforeAll',
          line,
          calls: [],
        });
      }

      // static void TearDownTestSuite()
      const tearDownSuitePattern = /static\s+void\s+TearDownTestSuite\s*\(\s*\)/g;
      while ((match = tearDownSuitePattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        blocks.push({
          type: 'afterAll',
          line,
          calls: [],
        });
      }
    }

    // Boost.Test fixture
    if (framework === 'boost-test') {
      // BOOST_FIXTURE_TEST_SUITE
      const suitePattern = /BOOST_FIXTURE_TEST_SUITE\s*\(\s*\w+\s*,\s*(\w+)\s*\)/g;
      let match;
      while ((match = suitePattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        blocks.push({
          type: 'setUp',
          line,
          calls: [],
        });
      }
    }

    return blocks;
  }

  private extractFixtures(_root: Parser.SyntaxNode): FixtureInfo[] {
    const fixtures: FixtureInfo[] = [];
    const content = this.sourceContent;
    const framework = this.detectedFramework;

    // Google Test fixtures (classes inheriting from ::testing::Test)
    if (framework === 'gtest') {
      const fixturePattern = /class\s+(\w+)\s*:\s*public\s+::?testing::Test/g;
      let match;
      while ((match = fixturePattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        fixtures.push({
          name,
          scope: 'class',
          line,
        });
      }
    }

    // Boost.Test fixtures
    if (framework === 'boost-test') {
      const fixturePattern = /struct\s+(\w+)\s*\{[^}]*BOOST_/g;
      let match;
      while ((match = fixturePattern.exec(content)) !== null) {
        const name = match[1]!;
        const line = this.getLineNumber(content, match.index);
        fixtures.push({
          name,
          scope: 'class',
          line,
        });
      }
    }

    return fixtures;
  }

  protected findImports(_root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];
    const content = this.sourceContent;

    // #include patterns
    const includePattern = /#include\s*[<"]([^>"]+)[>"]/g;
    let match;
    while ((match = includePattern.exec(content)) !== null) {
      imports.push(match[1]!);
    }

    return imports;
  }

  private extractAssertionsFromNode(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];
    const content = this.sourceContent;
    const framework = this.detectedFramework;

    // Get the text range for this node
    const startIndex = node.startIndex;
    const endIndex = node.endIndex;
    const nodeContent = content.slice(startIndex, endIndex);

    // Google Test assertions
    if (framework === 'gtest') {
      const gtestAssertions = [
        'ASSERT_TRUE', 'ASSERT_FALSE', 'ASSERT_EQ', 'ASSERT_NE',
        'ASSERT_LT', 'ASSERT_LE', 'ASSERT_GT', 'ASSERT_GE',
        'ASSERT_STREQ', 'ASSERT_STRNE', 'ASSERT_THROW', 'ASSERT_NO_THROW',
        'EXPECT_TRUE', 'EXPECT_FALSE', 'EXPECT_EQ', 'EXPECT_NE',
        'EXPECT_LT', 'EXPECT_LE', 'EXPECT_GT', 'EXPECT_GE',
        'EXPECT_STREQ', 'EXPECT_STRNE', 'EXPECT_THROW', 'EXPECT_NO_THROW',
      ];

      for (const assertion of gtestAssertions) {
        const pattern = new RegExp(`${assertion}\\s*\\(`, 'g');
        let match;
        while ((match = pattern.exec(nodeContent)) !== null) {
          const line = this.getLineNumber(content, startIndex + match.index);
          assertions.push({
            matcher: assertion,
            line,
            isErrorAssertion: assertion.includes('THROW'),
            isEdgeCaseAssertion: assertion.includes('NULL') || assertion.includes('EMPTY'),
          });
        }
      }
    }

    // Catch2 assertions
    if (framework === 'catch2') {
      const catch2Assertions = [
        'REQUIRE', 'CHECK', 'REQUIRE_FALSE', 'CHECK_FALSE',
        'REQUIRE_THROWS', 'CHECK_THROWS', 'REQUIRE_NOTHROW', 'CHECK_NOTHROW',
        'REQUIRE_THAT', 'CHECK_THAT',
      ];

      for (const assertion of catch2Assertions) {
        const pattern = new RegExp(`${assertion}\\s*\\(`, 'g');
        let match;
        while ((match = pattern.exec(nodeContent)) !== null) {
          const line = this.getLineNumber(content, startIndex + match.index);
          assertions.push({
            matcher: assertion,
            line,
            isErrorAssertion: assertion.includes('THROW'),
            isEdgeCaseAssertion: false,
          });
        }
      }
    }

    // Boost.Test assertions
    if (framework === 'boost-test') {
      const boostAssertions = [
        'BOOST_CHECK', 'BOOST_REQUIRE', 'BOOST_CHECK_EQUAL', 'BOOST_REQUIRE_EQUAL',
        'BOOST_CHECK_NE', 'BOOST_REQUIRE_NE', 'BOOST_CHECK_THROW', 'BOOST_REQUIRE_THROW',
        'BOOST_CHECK_NO_THROW', 'BOOST_REQUIRE_NO_THROW',
      ];

      for (const assertion of boostAssertions) {
        const pattern = new RegExp(`${assertion}\\s*\\(`, 'g');
        let match;
        while ((match = pattern.exec(nodeContent)) !== null) {
          const line = this.getLineNumber(content, startIndex + match.index);
          assertions.push({
            matcher: assertion,
            line,
            isErrorAssertion: assertion.includes('THROW'),
            isEdgeCaseAssertion: false,
          });
        }
      }
    }

    return assertions;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCppTestExtractor(parser: Parser): CppTestExtractor {
  return new CppTestExtractor(parser);
}
