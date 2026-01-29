/**
 * Go Test Extractor
 *
 * Extracts test information from Go testing frameworks:
 * - Standard library testing package
 * - testify (assert, require, suite)
 * - ginkgo/gomega
 * - gomock
 */

import { BaseTestExtractor } from './base-test-extractor.js';

import type {
  TestExtraction,
  TestCase,
  MockStatement,
  SetupBlock,
  AssertionInfo,
  TestFramework,
} from '../types.js';
import type Parser from 'tree-sitter';

// ============================================================================
// Framework Detection
// ============================================================================

const FRAMEWORK_IMPORTS: Record<string, TestFramework> = {
  testing: 'go-testing',
  'github.com/stretchr/testify': 'testify',
  'github.com/stretchr/testify/assert': 'testify',
  'github.com/stretchr/testify/require': 'testify',
  'github.com/stretchr/testify/suite': 'testify',
  'github.com/onsi/ginkgo': 'ginkgo',
  'github.com/onsi/ginkgo/v2': 'ginkgo',
  'github.com/onsi/gomega': 'gomega',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class GoTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'go');
  }

  extract(content: string, filePath: string): TestExtraction {
    const tree = this.parser.parse(content);
    const root = tree.rootNode;

    const framework = this.detectFramework(root);
    const testCases = this.extractTestCases(root);
    const mocks = this.extractMocks(root, framework);
    const setupBlocks = this.extractSetupBlocks(root);

    // Enrich test cases with quality
    for (const test of testCases) {
      const testMocks = mocks.filter((m) => m.line >= test.line && m.line <= test.line + 100);
      test.quality = this.calculateQuality(test.assertions, testMocks, test.directCalls);
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


  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);

    for (const imp of imports) {
      for (const [pattern, framework] of Object.entries(FRAMEWORK_IMPORTS)) {
        if (imp.includes(pattern)) {
          return framework;
        }
      }
    }

    // Check for test function patterns
    const text = root.text;
    if (text.includes('func Test') && text.includes('*testing.T')) {
      return 'go-testing';
    }

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];

    this.walkNode(root, (node) => {
      // Find test functions: func TestXxx(t *testing.T)
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        const parametersNode = node.childForFieldName('parameters');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && parametersNode && bodyNode) {
          const name = nameNode.text;

          // Check if it's a test function
          if (name.startsWith('Test') && this.hasTestingTParam(parametersNode)) {
            const directCalls = this.extractFunctionCalls(bodyNode);
            const assertions = this.extractAssertions(bodyNode);

            testCases.push({
              id: this.generateTestId('', name, node.startPosition.row),
              name,
              qualifiedName: name,
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

          // Check for benchmark functions: func BenchmarkXxx(b *testing.B)
          if (name.startsWith('Benchmark') && this.hasTestingBParam(parametersNode)) {
            const directCalls = this.extractFunctionCalls(bodyNode);

            testCases.push({
              id: this.generateTestId('', name, node.startPosition.row),
              name,
              qualifiedName: name,
              file: '',
              line: node.startPosition.row + 1,
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
      }

      // Find table-driven test cases: t.Run("name", func(t *testing.T) {...})
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');

        if (funcNode?.type === 'selector_expression') {
          const fieldNode = funcNode.childForFieldName('field');

          if (fieldNode?.text === 'Run') {
            const argsNode = node.childForFieldName('arguments');
            if (argsNode) {
              const args = argsNode.namedChildren;
              if (args.length >= 2) {
                const nameArg = args[0];
                const funcArg = args[1];

                if (nameArg && funcArg?.type === 'func_literal') {
                  const testName = nameArg.text.replace(/^"|"$/g, '');
                  const bodyNode = funcArg.childForFieldName('body');

                  if (bodyNode) {
                    const directCalls = this.extractFunctionCalls(bodyNode);
                    const assertions = this.extractAssertions(bodyNode);

                    testCases.push({
                      id: this.generateTestId('', testName, node.startPosition.row),
                      name: testName,
                      qualifiedName: testName,
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
            }
          }
        }
      }
    });

    return testCases;
  }


  private hasTestingTParam(parametersNode: Parser.SyntaxNode): boolean {
    for (const child of parametersNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode?.text.includes('testing.T')) {
          return true;
        }
        // Also check children for pointer types
        for (const typeChild of child.children) {
          if (typeChild.text.includes('testing.T')) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private hasTestingBParam(parametersNode: Parser.SyntaxNode): boolean {
    for (const child of parametersNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode?.text.includes('testing.B')) {
          return true;
        }
        for (const typeChild of child.children) {
          if (typeChild.text.includes('testing.B')) {
            return true;
          }
        }
      }
    }
    return false;
  }

  extractMocks(root: Parser.SyntaxNode, _framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];

    this.walkNode(root, (node) => {
      // gomock: ctrl.EXPECT().Method().Return(...)
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');

        if (funcNode?.type === 'selector_expression') {
          const fieldNode = funcNode.childForFieldName('field');

          if (fieldNode?.text === 'EXPECT') {
            mocks.push({
              target: funcNode.text,
              mockType: 'gomock',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }

      // testify mock: mock.On("Method", args).Return(...)
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');

        if (funcNode?.type === 'selector_expression') {
          const fieldNode = funcNode.childForFieldName('field');

          if (fieldNode?.text === 'On') {
            mocks.push({
              target: funcNode.text,
              mockType: 'testify-mock',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }

      // gomock.NewController
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode?.text.includes('NewController')) {
          mocks.push({
            target: 'gomock.Controller',
            mockType: 'gomock',
            line: node.startPosition.row + 1,
            isExternal: true,
          });
        }
      }
    });

    return mocks;
  }

  extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];

    this.walkNode(root, (node) => {
      // Find TestMain function
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode?.text === 'TestMain' && bodyNode) {
          const calls = this.extractFunctionCalls(bodyNode);
          blocks.push({
            type: 'beforeAll',
            line: node.startPosition.row + 1,
            calls,
          });
        }
      }

      // Find t.Cleanup() calls
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');

        if (funcNode?.type === 'selector_expression') {
          const fieldNode = funcNode.childForFieldName('field');

          if (fieldNode?.text === 'Cleanup') {
            blocks.push({
              type: 'afterEach',
              line: node.startPosition.row + 1,
              calls: [],
            });
          }
        }
      }

      // Find suite setup methods (testify/suite)
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          if (name === 'SetupSuite' || name === 'SetupTest') {
            const calls = this.extractFunctionCalls(bodyNode);
            blocks.push({
              type: name === 'SetupSuite' ? 'beforeAll' : 'beforeEach',
              line: node.startPosition.row + 1,
              calls,
            });
          }
          if (name === 'TearDownSuite' || name === 'TearDownTest') {
            const calls = this.extractFunctionCalls(bodyNode);
            blocks.push({
              type: name === 'TearDownSuite' ? 'afterAll' : 'afterEach',
              line: node.startPosition.row + 1,
              calls,
            });
          }
        }
      }
    });

    return blocks;
  }


  protected findImports(root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];

    this.walkNode(root, (node) => {
      if (node.type === 'import_spec') {
        const pathNode = node.childForFieldName('path');
        if (pathNode) {
          imports.push(pathNode.text.replace(/^"|"$/g, ''));
        }
      }
    });

    return imports;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      if (child.type === 'call_expression') {
        const funcNode = child.childForFieldName('function');

        if (funcNode?.type === 'selector_expression') {
          const operandNode = funcNode.childForFieldName('operand');
          const fieldNode = funcNode.childForFieldName('field');

          if (fieldNode) {
            const method = fieldNode.text;
            const receiver = operandNode?.text ?? '';

            // Standard testing.T assertions
            if (
              method === 'Error' ||
              method === 'Errorf' ||
              method === 'Fatal' ||
              method === 'Fatalf' ||
              method === 'Fail' ||
              method === 'FailNow'
            ) {
              assertions.push({
                matcher: method,
                line: child.startPosition.row + 1,
                isErrorAssertion: true,
                isEdgeCaseAssertion: false,
              });
            }

            // testify assertions (assert.* or require.*)
            if (receiver.includes('assert') || receiver.includes('require')) {
              assertions.push({
                matcher: `${receiver}.${method}`,
                line: child.startPosition.row + 1,
                isErrorAssertion: method.includes('Error') || method.includes('Panic'),
                isEdgeCaseAssertion:
                  method === 'Nil' ||
                  method === 'NotNil' ||
                  method === 'Empty' ||
                  method === 'NotEmpty' ||
                  method === 'Zero' ||
                  method === 'True' ||
                  method === 'False' ||
                  method === 'Len' ||
                  method === 'Contains',
              });
            }

            // gomega assertions
            if (method === 'Expect' || method === 'Should' || method === 'To' || method === 'Ω') {
              assertions.push({
                matcher: method,
                line: child.startPosition.row + 1,
                isErrorAssertion: false,
                isEdgeCaseAssertion: false,
              });
            }
          }
        }
      }
    });

    return assertions;
  }

  /**
   * Override to add Go-specific test framework calls
   */
  protected override isTestFrameworkCall(name: string): boolean {
    const goTestCalls = [
      // Standard testing
      'Error',
      'Errorf',
      'Fatal',
      'Fatalf',
      'Fail',
      'FailNow',
      'Log',
      'Logf',
      'Skip',
      'Skipf',
      'Run',
      'Cleanup',
      'Helper',
      'Parallel',
      // testify
      'Equal',
      'NotEqual',
      'True',
      'False',
      'Nil',
      'NotNil',
      'NoError',
      'Error',
      'Contains',
      'Len',
      'Empty',
      'NotEmpty',
      // gomock
      'EXPECT',
      'Return',
      'Times',
      'AnyTimes',
      'DoAndReturn',
      // ginkgo
      'Describe',
      'Context',
      'It',
      'BeforeEach',
      'AfterEach',
      'BeforeSuite',
      'AfterSuite',
      'Expect',
    ];

    return goTestCalls.includes(name) || super.isTestFrameworkCall(name);
  }
}

/**
 * Create a Go test extractor instance
 */
export function createGoTestExtractor(parser: Parser): GoTestExtractor {
  return new GoTestExtractor(parser);
}
