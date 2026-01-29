/**
 * PHP Test Extractor
 *
 * Extracts test information from PHPUnit, Pest, and Codeception.
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

const FRAMEWORK_NAMESPACES: Record<string, TestFramework> = {
  'PHPUnit': 'phpunit',
  'PHPUnit\\Framework': 'phpunit',
  'Pest': 'pest',
  'Codeception': 'codeception',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class PHPTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'php');
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

  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);
    const text = root.text;

    // Check use statements
    for (const imp of imports) {
      for (const [pattern, framework] of Object.entries(FRAMEWORK_NAMESPACES)) {
        if (imp.includes(pattern)) {
          return framework;
        }
      }
    }

    // Check for Pest-style tests (function calls)
    if (text.includes('test(') || text.includes('it(') || text.includes('describe(')) {
      if (text.includes('pest') || text.includes('Pest')) {
        return 'pest';
      }
    }

    // Check for PHPUnit TestCase extension
    if (text.includes('extends TestCase') || text.includes('extends PHPUnit')) {
      return 'phpunit';
    }

    // Check for @test annotation
    if (text.includes('@test') || /function\s+test\w+/.test(text)) {
      return 'phpunit';
    }

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];
    let currentClass: string | undefined;

    this.walkNode(root, (node) => {
      // Track class context
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          currentClass = nameNode.text;
        }
      }

      // PHPUnit: methods starting with test or having @test annotation
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          const isTestMethod = name.startsWith('test') || 
                              this.hasTestAnnotation(node);

          if (isTestMethod) {
            const qualifiedName = currentClass 
              ? `${currentClass}::${name}`
              : name;

            const directCalls = this.extractFunctionCalls(bodyNode);
            const assertions = this.extractAssertions(bodyNode);

            testCases.push({
              id: this.generateTestId('', name, node.startPosition.row),
              name,
              parentBlock: currentClass,
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

      // Pest: test() or it() function calls
      if (node.type === 'function_call_expression') {
        const fnNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');

        if (fnNode?.type === 'name' && argsNode) {
          const fnName = fnNode.text;

          if (fnName === 'test' || fnName === 'it') {
            const nameArg = argsNode.namedChild(0);
            const bodyArg = argsNode.namedChildren.find(c => 
              c.type === 'argument' && 
              (c.text.includes('function') || c.text.includes('=>'))
            );

            if (nameArg) {
              const testName = this.extractStringValue(nameArg);
              const directCalls = bodyArg ? this.extractFunctionCalls(bodyArg) : [];
              const assertions = bodyArg ? this.extractAssertions(bodyArg) : [];

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
    });

    return testCases;
  }

  extractMocks(root: Parser.SyntaxNode, _framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];

    this.walkNode(root, (node) => {
      // $this->createMock() or $this->getMockBuilder()
      if (node.type === 'member_call_expression') {
        const objNode = node.childForFieldName('object');
        const nameNode = node.childForFieldName('name');
        const argsNode = node.childForFieldName('arguments');

        if (objNode?.text === '$this' && nameNode) {
          const method = nameNode.text;

          if (method === 'createMock' || method === 'createPartialMock' ||
              method === 'createStub' || method === 'getMockBuilder') {
            const targetArg = argsNode?.namedChild(0);
            const target = targetArg ? this.extractClassReference(targetArg) : 'unknown';

            mocks.push({
              target,
              mockType: `PHPUnit.${method}`,
              line: node.startPosition.row + 1,
              isExternal: this.isExternalPHPClass(target),
            });
          }

          // prophecy: $this->prophesize()
          if (method === 'prophesize') {
            const targetArg = argsNode?.namedChild(0);
            const target = targetArg ? this.extractClassReference(targetArg) : 'unknown';

            mocks.push({
              target,
              mockType: 'Prophecy.prophesize',
              line: node.startPosition.row + 1,
              isExternal: this.isExternalPHPClass(target),
            });
          }
        }
      }

      // Mockery::mock()
      if (node.type === 'scoped_call_expression') {
        const scopeNode = node.childForFieldName('scope');
        const nameNode = node.childForFieldName('name');
        const argsNode = node.childForFieldName('arguments');

        if (scopeNode?.text === 'Mockery' && nameNode?.text === 'mock') {
          const targetArg = argsNode?.namedChild(0);
          const target = targetArg ? this.extractStringValue(targetArg) : 'unknown';

          mocks.push({
            target,
            mockType: 'Mockery.mock',
            line: node.startPosition.row + 1,
            isExternal: this.isExternalPHPClass(target),
          });
        }
      }

      // mock() function (Pest)
      if (node.type === 'function_call_expression') {
        const fnNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');

        if (fnNode?.type === 'name' && fnNode.text === 'mock') {
          const targetArg = argsNode?.namedChild(0);
          const target = targetArg ? this.extractClassReference(targetArg) : 'unknown';

          mocks.push({
            target,
            mockType: 'Pest.mock',
            line: node.startPosition.row + 1,
            isExternal: this.isExternalPHPClass(target),
          });
        }
      }
    });

    return mocks;
  }

  extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];

    this.walkNode(root, (node) => {
      // PHPUnit: setUp, tearDown, setUpBeforeClass, tearDownAfterClass
      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          let type: SetupBlock['type'] | null = null;

          if (name === 'setUp') {type = 'setUp';}
          else if (name === 'tearDown') {type = 'tearDown';}
          else if (name === 'setUpBeforeClass') {type = 'beforeAll';}
          else if (name === 'tearDownAfterClass') {type = 'afterAll';}

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

      // Pest: beforeEach(), afterEach(), beforeAll(), afterAll()
      if (node.type === 'function_call_expression') {
        const fnNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');

        if (fnNode?.type === 'name') {
          const fnName = fnNode.text;
          let type: SetupBlock['type'] | null = null;

          if (fnName === 'beforeEach') {type = 'beforeEach';}
          else if (fnName === 'afterEach') {type = 'afterEach';}
          else if (fnName === 'beforeAll') {type = 'beforeAll';}
          else if (fnName === 'afterAll') {type = 'afterAll';}

          if (type && argsNode) {
            const bodyArg = argsNode.namedChild(0);
            const calls = bodyArg ? this.extractFunctionCalls(bodyArg) : [];
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

  protected findImports(root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];

    this.walkNode(root, (node) => {
      // use statements
      if (node.type === 'namespace_use_declaration') {
        this.walkNode(node, (child) => {
          if (child.type === 'namespace_use_clause' || child.type === 'qualified_name') {
            imports.push(child.text);
          }
        });
      }
    });

    return imports;
  }

  private hasTestAnnotation(node: Parser.SyntaxNode): boolean {
    // Look for docblock with @test
    let sibling = node.previousNamedSibling;
    while (sibling) {
      if (sibling.type === 'comment') {
        if (sibling.text.includes('@test')) {
          return true;
        }
      }
      sibling = sibling.previousNamedSibling;
    }
    return false;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      // $this->assert*() calls
      if (child.type === 'member_call_expression') {
        const objNode = child.childForFieldName('object');
        const nameNode = child.childForFieldName('name');

        if (objNode?.text === '$this' && nameNode) {
          const method = nameNode.text;

          if (method.startsWith('assert') || method === 'expect') {
            assertions.push({
              matcher: method,
              line: child.startPosition.row + 1,
              isErrorAssertion: method === 'expectException' || 
                               method === 'expectExceptionMessage' ||
                               method === 'expectExceptionCode',
              isEdgeCaseAssertion: method === 'assertNull' || method === 'assertNotNull' ||
                                  method === 'assertEmpty' || method === 'assertNotEmpty',
            });
          }
        }
      }

      // Pest expect() chains
      if (child.type === 'function_call_expression') {
        const fnNode = child.childForFieldName('function');
        if (fnNode?.type === 'name' && fnNode.text === 'expect') {
          assertions.push({
            matcher: 'expect',
            line: child.startPosition.row + 1,
            isErrorAssertion: false,
            isEdgeCaseAssertion: false,
          });
        }
      }

      // Static Assert::* calls
      if (child.type === 'scoped_call_expression') {
        const scopeNode = child.childForFieldName('scope');
        const nameNode = child.childForFieldName('name');

        if (scopeNode?.text === 'Assert' && nameNode) {
          const method = nameNode.text;
          assertions.push({
            matcher: `Assert::${method}`,
            line: child.startPosition.row + 1,
            isErrorAssertion: method.includes('Exception') || method.includes('Throws'),
            isEdgeCaseAssertion: method.includes('Null') || method.includes('Empty'),
          });
        }
      }
    });

    return assertions;
  }

  private extractStringValue(node: Parser.SyntaxNode): string {
    let text = node.text;
    // Handle argument wrapper
    if (node.type === 'argument') {
      const child = node.namedChild(0);
      if (child) {text = child.text;}
    }
    // Remove quotes
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1);
    }
    return text;
  }

  private extractClassReference(node: Parser.SyntaxNode): string {
    let text = node.text;
    // Handle argument wrapper
    if (node.type === 'argument') {
      const child = node.namedChild(0);
      if (child) {text = child.text;}
    }
    // Handle ::class syntax
    if (text.endsWith('::class')) {
      text = text.slice(0, -7);
    }
    // Remove leading backslash
    if (text.startsWith('\\')) {
      text = text.slice(1);
    }
    return text;
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
}

// ============================================================================
// Factory
// ============================================================================

export function createPHPTestExtractor(parser: Parser): PHPTestExtractor {
  return new PHPTestExtractor(parser);
}
