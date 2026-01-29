/**
 * Java Test Extractor
 *
 * Extracts test information from JUnit 4/5, TestNG, and Mockito.
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
  'org.junit.jupiter': 'junit5',
  'org.junit.jupiter.api': 'junit5',
  'org.junit': 'junit4',
  'org.junit.Test': 'junit4',
  'org.testng': 'testng',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class JavaTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'java');
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
      language: 'java',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);

    for (const imp of imports) {
      for (const [pattern, framework] of Object.entries(FRAMEWORK_IMPORTS)) {
        if (imp.startsWith(pattern)) {
          return framework;
        }
      }
    }

    // Check for annotations
    const text = root.text;
    if (text.includes('@Test') && text.includes('org.junit.jupiter')) {
      return 'junit5';
    }
    if (text.includes('@Test')) {
      return 'junit4';
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

      // Find @Test annotated methods
      if (node.type === 'method_declaration') {
        const modifiers = node.childForFieldName('modifiers');
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (modifiers && nameNode && bodyNode) {
          // Check for @Test annotation
          let hasTestAnnotation = false;
          this.walkNode(modifiers, (child) => {
            if (child.type === 'marker_annotation' || child.type === 'annotation') {
              const annotationName = child.text;
              if (annotationName.includes('Test')) {
                hasTestAnnotation = true;
              }
            }
          });

          if (hasTestAnnotation) {
            const name = nameNode.text;
            const qualifiedName = currentClass 
              ? `${currentClass}.${name}`
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
    });

    return testCases;
  }

  extractMocks(root: Parser.SyntaxNode, _framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];

    this.walkNode(root, (node) => {
      // @Mock annotation on fields
      if (node.type === 'field_declaration') {
        const modifiers = node.childForFieldName('modifiers');
        
        if (modifiers) {
          let mockAnnotation: string | null = null;
          
          this.walkNode(modifiers, (child) => {
            if (child.type === 'marker_annotation' || child.type === 'annotation') {
              const text = child.text;
              if (text.includes('@Mock')) {mockAnnotation = '@Mock';}
              else if (text.includes('@MockBean')) {mockAnnotation = '@MockBean';}
              else if (text.includes('@Spy')) {mockAnnotation = '@Spy';}
              else if (text.includes('@InjectMocks')) {mockAnnotation = '@InjectMocks';}
            }
          });

          if (mockAnnotation) {
            const declarator = node.namedChildren.find(c => c.type === 'variable_declarator');
            const typeNode = node.childForFieldName('type');
            
            if (declarator && typeNode) {
              const fieldName = declarator.childForFieldName('name')?.text ?? 'unknown';
              const fieldType = typeNode.text;
              
              mocks.push({
                target: `${fieldType}.${fieldName}`,
                mockType: mockAnnotation,
                line: node.startPosition.row + 1,
                isExternal: false,
              });
            }
          }
        }
      }

      // Mockito.mock() calls
      if (node.type === 'method_invocation') {
        const objNode = node.childForFieldName('object');
        const nameNode = node.childForFieldName('name');
        
        if (objNode?.text === 'Mockito' && nameNode) {
          const method = nameNode.text;
          if (method === 'mock' || method === 'spy') {
            const argsNode = node.childForFieldName('arguments');
            const targetNode = argsNode?.namedChild(0);
            
            mocks.push({
              target: targetNode?.text ?? 'unknown',
              mockType: `Mockito.${method}`,
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }
    });

    return mocks;
  }

  extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];

    this.walkNode(root, (node) => {
      if (node.type === 'method_declaration') {
        const modifiers = node.childForFieldName('modifiers');
        const bodyNode = node.childForFieldName('body');

        if (modifiers && bodyNode) {
          let setupType: SetupBlock['type'] | null = null;

          this.walkNode(modifiers, (child) => {
            if (child.type === 'marker_annotation' || child.type === 'annotation') {
              const text = child.text;
              // JUnit 5
              if (text.includes('@BeforeEach')) {setupType = 'beforeEach';}
              else if (text.includes('@AfterEach')) {setupType = 'afterEach';}
              else if (text.includes('@BeforeAll')) {setupType = 'beforeAll';}
              else if (text.includes('@AfterAll')) {setupType = 'afterAll';}
              // JUnit 4
              else if (text.includes('@Before')) {setupType = 'beforeEach';}
              else if (text.includes('@After')) {setupType = 'afterEach';}
              else if (text.includes('@BeforeClass')) {setupType = 'beforeAll';}
              else if (text.includes('@AfterClass')) {setupType = 'afterAll';}
            }
          });

          if (setupType) {
            const calls = this.extractFunctionCalls(bodyNode);
            blocks.push({
              type: setupType,
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
      if (node.type === 'import_declaration') {
        const pathNode = node.namedChild(0);
        if (pathNode) {
          imports.push(pathNode.text);
        }
      }
    });

    return imports;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      if (child.type === 'method_invocation') {
        const nameNode = child.childForFieldName('name');
        
        if (nameNode) {
          const name = nameNode.text;
          
          // JUnit assertions
          if (name.startsWith('assert') || name === 'fail') {
            assertions.push({
              matcher: name,
              line: child.startPosition.row + 1,
              isErrorAssertion: name === 'assertThrows' || name === 'assertDoesNotThrow',
              isEdgeCaseAssertion: name === 'assertNull' || name === 'assertNotNull' ||
                                  name === 'assertTrue' || name === 'assertFalse',
            });
          }

          // Mockito verify
          if (name === 'verify') {
            assertions.push({
              matcher: 'verify',
              line: child.startPosition.row + 1,
              isErrorAssertion: false,
              isEdgeCaseAssertion: false,
            });
          }
        }
      }
    });

    return assertions;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createJavaTestExtractor(parser: Parser): JavaTestExtractor {
  return new JavaTestExtractor(parser);
}
