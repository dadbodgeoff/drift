/**
 * Rust Test Extractor
 *
 * Extracts test information from Rust test frameworks.
 * 
 * Supports:
 * - #[test] attribute (built-in)
 * - #[tokio::test] (async tests)
 * - proptest! macro (property-based testing)
 * - criterion benchmarks
 * - rstest parameterized tests
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

export class RustTestExtractor extends BaseTestExtractor {
  private sourceContent: string = '';

  constructor(parser: Parser) {
    // Use 'go' as proxy since 'rust' isn't in the type union
    super(parser, 'go');
  }

  extract(content: string, filePath: string): TestExtraction {
    this.sourceContent = content;
    const tree = this.parser.parse(content);
    const root = tree.rootNode;

    const framework = this.detectFramework(root);
    const testCases = this.extractTestCases(root);
    const mocks = this.extractMocks(root, framework);
    const setupBlocks = this.extractSetupBlocks(root);
    const fixtures = framework === 'rstest' ? this.extractFixtures(root) : undefined;

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
      language: 'rust' as any,
      testCases,
      mocks,
      setupBlocks,
      fixtures,
    };
  }

  detectFramework(_root: Parser.SyntaxNode): TestFramework {
    const content = this.sourceContent;
    
    // Check for tokio::test
    if (content.includes('#[tokio::test]') || content.includes('#[async_std::test]')) {
      return 'tokio-test';
    }

    // Check for rstest
    if (content.includes('#[rstest]') || content.includes('use rstest::')) {
      return 'rstest';
    }

    // Check for proptest
    if (content.includes('proptest!') || content.includes('use proptest::')) {
      return 'proptest';
    }

    // Check for criterion
    if (content.includes('criterion_group!') || content.includes('use criterion::')) {
      return 'criterion';
    }

    // Default to built-in test
    if (content.includes('#[test]')) {
      return 'rust-test';
    }

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];
    let currentModule: string | undefined;

    this.walkNode(root, (node) => {
      // Track module context
      if (node.type === 'mod_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          currentModule = nameNode.text;
        }
      }

      // Find test functions (functions with #[test] or similar attributes)
      if (node.type === 'function_item') {
        const attributes = this.getAttributes(node);
        const isTest = this.isTestFunction(attributes);
        
        if (isTest) {
          const nameNode = node.childForFieldName('name');
          const bodyNode = node.childForFieldName('body');

          if (nameNode && bodyNode) {
            const name = nameNode.text;
            const qualifiedName = currentModule 
              ? `${currentModule}::${name}`
              : name;

            const directCalls = this.extractFunctionCalls(bodyNode);
            const assertions = this.extractAssertions(bodyNode);

            testCases.push({
              id: this.generateTestId('', name, node.startPosition.row),
              name,
              parentBlock: currentModule,
              qualifiedName,
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
      }
    });

    // Also extract proptest! macro tests
    this.extractProptestCases(testCases);

    return testCases;
  }

  /**
   * Extract proptest! macro test cases
   */
  private extractProptestCases(testCases: TestCase[]): void {
    const content = this.sourceContent;
    // Pattern: proptest! { #[test] fn test_name(...) { ... } }
    const proptestPattern = /proptest!\s*\{[\s\S]*?fn\s+(\w+)\s*\(/g;
    let match;

    while ((match = proptestPattern.exec(content)) !== null) {
      const name = match[1];
      if (!name) {continue;}

      const line = this.getLineNumber(content, match.index);

      // Skip if already captured
      if (testCases.some(t => t.name === name)) {
        continue;
      }

      testCases.push({
        id: this.generateTestId('', name, line),
        name,
        qualifiedName: name,
        file: '',
        line,
        directCalls: [],
        transitiveCalls: [],
        assertions: [{
          matcher: 'proptest',
          line,
          isErrorAssertion: false,
          isEdgeCaseAssertion: false,
        }],
        quality: {
          assertionCount: 1,
          hasErrorCases: false,
          hasEdgeCases: true, // Property tests are edge case tests
          mockRatio: 0,
          setupRatio: 0,
          score: 70,
        },
      });
    }
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
  }

  /**
   * Get attributes from a function item
   */
  private getAttributes(node: Parser.SyntaxNode): string[] {
    const attributes: string[] = [];
    
    // Look for attribute_item siblings before the function
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'attribute_item') {
        attributes.push(sibling.text);
      } else if (sibling.type !== 'line_comment' && sibling.type !== 'block_comment') {
        break;
      }
      sibling = sibling.previousSibling;
    }

    return attributes;
  }

  /**
   * Check if function has test attribute
   */
  private isTestFunction(attributes: string[]): boolean {
    for (const attr of attributes) {
      if (attr.includes('#[test]') ||
          attr.includes('#[tokio::test]') ||
          attr.includes('#[async_std::test]') ||
          attr.includes('#[rstest]') ||
          attr.includes('#[case]')) {
        return true;
      }
    }
    return false;
  }

  extractMocks(root: Parser.SyntaxNode, _framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];

    this.walkNode(root, (node) => {
      // mockall patterns: mock! macro
      if (node.type === 'macro_invocation') {
        const macroNode = node.childForFieldName('macro');
        if (macroNode?.text === 'mock') {
          mocks.push({
            target: 'mock_struct',
            mockType: 'mockall',
            line: node.startPosition.row + 1,
            isExternal: false,
          });
        }
      }

      // #[automock] attribute
      if (node.type === 'attribute_item') {
        const text = node.text;
        if (text.includes('automock')) {
          mocks.push({
            target: 'automock_trait',
            mockType: '#[automock]',
            line: node.startPosition.row + 1,
            isExternal: false,
          });
        }
      }

      // MockXxx::new() calls
      if (node.type === 'call_expression') {
        const fnNode = node.childForFieldName('function');
        if (fnNode?.type === 'scoped_identifier') {
          const text = fnNode.text;
          if (text.startsWith('Mock') && text.endsWith('::new')) {
            const mockName = text.replace('::new', '');
            mocks.push({
              target: mockName,
              mockType: 'mockall',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }

      // .expect() calls on mocks
      if (node.type === 'method_call_expression') {
        const methodNode = node.childForFieldName('name');
        if (methodNode?.text === 'expect') {
          mocks.push({
            target: 'mock_expectation',
            mockType: 'expect',
            line: node.startPosition.row + 1,
            isExternal: false,
          });
        }
      }
    });

    return mocks;
  }

  extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];

    this.walkNode(root, (node) => {
      // Look for setup/teardown functions in test modules
      if (node.type === 'function_item') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          let type: SetupBlock['type'] | null = null;

          // Common setup function names
          if (name === 'setup' || name === 'before_each' || name === 'init') {
            type = 'setUp';
          } else if (name === 'teardown' || name === 'after_each' || name === 'cleanup') {
            type = 'tearDown';
          } else if (name === 'setup_all' || name === 'before_all') {
            type = 'beforeAll';
          } else if (name === 'teardown_all' || name === 'after_all') {
            type = 'afterAll';
          }

          if (type) {
            const calls = this.extractFunctionCalls(bodyNode);
            blocks.push({
              type,
              line: node.startPosition.row + 1,
              calls,
            });
          }
        }
      }
    });

    return blocks;
  }

  private extractFixtures(root: Parser.SyntaxNode): FixtureInfo[] {
    const fixtures: FixtureInfo[] = [];

    this.walkNode(root, (node) => {
      // rstest fixtures: #[fixture] fn fixture_name() -> Type { ... }
      if (node.type === 'function_item') {
        const attributes = this.getAttributes(node);
        const isFixture = attributes.some(a => a.includes('#[fixture]'));

        if (isFixture) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            fixtures.push({
              name: nameNode.text,
              scope: 'function',
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    });

    return fixtures;
  }

  protected findImports(root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];

    this.walkNode(root, (node) => {
      // use crate::module;
      if (node.type === 'use_declaration') {
        const pathNode = node.childForFieldName('argument');
        if (pathNode) {
          const firstPart = pathNode.text.split('::')[0];
          if (firstPart) {
            imports.push(firstPart);
          }
        }
      }

      // extern crate name;
      if (node.type === 'extern_crate_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          imports.push(nameNode.text);
        }
      }
    });

    return imports;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      // Macro invocations: assert!, assert_eq!, assert_ne!, etc.
      if (child.type === 'macro_invocation') {
        const macroNode = child.childForFieldName('macro');
        const macroName = macroNode?.text ?? '';

        if (this.isAssertionMacro(macroName)) {
          const text = child.text;
          assertions.push({
            matcher: macroName,
            line: child.startPosition.row + 1,
            isErrorAssertion: macroName === 'panic' || 
                             text.includes('should_panic') ||
                             text.includes('Error') ||
                             text.includes('Err('),
            isEdgeCaseAssertion: text.includes('None') || 
                                text.includes('is_empty') ||
                                text.includes('== 0') ||
                                text.includes('Vec::new()'),
          });
        }
      }

      // #[should_panic] attribute
      if (child.type === 'attribute_item') {
        const text = child.text;
        if (text.includes('should_panic')) {
          assertions.push({
            matcher: 'should_panic',
            line: child.startPosition.row + 1,
            isErrorAssertion: true,
            isEdgeCaseAssertion: false,
          });
        }
      }

      // .unwrap() and .expect() calls (implicit assertions)
      if (child.type === 'method_call_expression') {
        const methodNode = child.childForFieldName('name');
        const methodName = methodNode?.text;
        
        if (methodName === 'unwrap' || methodName === 'expect') {
          assertions.push({
            matcher: methodName,
            line: child.startPosition.row + 1,
            isErrorAssertion: false,
            isEdgeCaseAssertion: false,
          });
        }
      }
    });

    return assertions;
  }

  /**
   * Check if macro is an assertion macro
   */
  private isAssertionMacro(name: string): boolean {
    const assertionMacros = [
      'assert',
      'assert_eq',
      'assert_ne',
      'debug_assert',
      'debug_assert_eq',
      'debug_assert_ne',
      'panic',
      'unreachable',
      'todo',
      'unimplemented',
      // proptest
      'prop_assert',
      'prop_assert_eq',
      'prop_assert_ne',
    ];
    return assertionMacros.includes(name);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createRustTestExtractor(parser: Parser): RustTestExtractor {
  return new RustTestExtractor(parser);
}
