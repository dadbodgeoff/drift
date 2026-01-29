/**
 * TypeScript/JavaScript Test Extractor
 *
 * Extracts test information from Jest, Vitest, Mocha, and other JS test frameworks.
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
  'jest': 'jest',
  '@jest/globals': 'jest',
  'vitest': 'vitest',
  'mocha': 'mocha',
  'chai': 'mocha',
  'ava': 'ava',
  'tape': 'tape',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class TypeScriptTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'typescript');
  }

  extract(content: string, filePath: string): TestExtraction {
    const tree = this.parser.parse(content);
    const root = tree.rootNode;

    const framework = this.detectFramework(root);
    const testCases = this.extractTestCases(root);
    const mocks = this.extractMocks(root, framework);
    const setupBlocks = this.extractSetupBlocks(root);

    // Enrich test cases with calls and quality
    for (const test of testCases) {
      const testMocks = mocks.filter(m => 
        m.line >= test.line && m.line <= test.line + 100 // Rough scope
      );
      test.quality = this.calculateQuality(test.assertions, testMocks, test.directCalls);
    }

    return {
      file: filePath,
      framework,
      language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);

    // Check imports first
    for (const imp of imports) {
      const framework = FRAMEWORK_IMPORTS[imp];
      if (framework) {return framework;}
    }

    // Check for global usage
    const text = root.text;
    if (text.includes('vi.mock') || text.includes('vi.spyOn')) {return 'vitest';}
    if (text.includes('jest.mock') || text.includes('jest.spyOn')) {return 'jest';}
    
    // Default to jest if we see test/describe/it
    if (/\b(describe|it|test)\s*\(/.test(text)) {return 'jest';}

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];
    const describeStack: string[] = [];

    // Walk the tree to find test calls within describe blocks
    this.walkTestTree(root, describeStack, testCases);

    return testCases;
  }

  private walkTestTree(
    node: Parser.SyntaxNode,
    describeStack: string[],
    testCases: TestCase[]
  ): void {
    if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName('function');
      const argsNode = node.childForFieldName('arguments');

      if (fnNode?.type === 'identifier' && argsNode) {
        const fnName = fnNode.text;

        if (fnName === 'describe' || fnName === 'context') {
          // Enter describe block
          const nameNode = argsNode.namedChild(0);
          const bodyNode = argsNode.namedChild(1);
          
          if (nameNode && bodyNode) {
            const describeName = this.extractStringValue(nameNode);
            describeStack.push(describeName);
            
            // Process children
            this.walkTestTree(bodyNode, describeStack, testCases);
            
            describeStack.pop();
            return; // Don't process children again
          }
        }

        if (fnName === 'test' || fnName === 'it') {
          const nameNode = argsNode.namedChild(0);
          const bodyNode = argsNode.namedChild(1);

          if (nameNode && bodyNode) {
            const testName = this.extractStringValue(nameNode);
            const qualifiedName = describeStack.length > 0
              ? `${describeStack.join(' > ')} > ${testName}`
              : testName;

            const directCalls = this.extractFunctionCalls(bodyNode);
            const assertions = this.extractAssertions(bodyNode);

            testCases.push({
              id: this.generateTestId(node.tree.rootNode.text.substring(0, 50), testName, node.startPosition.row),
              name: testName,
              parentBlock: describeStack[describeStack.length - 1],
              qualifiedName,
              file: '', // Will be set by caller
              line: node.startPosition.row + 1,
              directCalls,
              transitiveCalls: [], // Filled later by analyzer
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

    // Recurse into children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.walkTestTree(child, describeStack, testCases);
      }
    }
  }

  extractMocks(root: Parser.SyntaxNode, framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];
    const mockObj = framework === 'vitest' ? 'vi' : 'jest';

    // Find jest.mock() or vi.mock() calls
    this.walkNode(root, (node) => {
      if (node.type === 'call_expression') {
        const fnNode = node.childForFieldName('function');
        
        if (fnNode?.type === 'member_expression') {
          const objNode = fnNode.childForFieldName('object');
          const propNode = fnNode.childForFieldName('property');
          
          if (objNode?.text === mockObj && propNode?.text === 'mock') {
            const argsNode = node.childForFieldName('arguments');
            const targetNode = argsNode?.namedChild(0);
            
            if (targetNode) {
              const target = this.extractStringValue(targetNode);
              mocks.push({
                target,
                mockType: `${mockObj}.mock`,
                line: node.startPosition.row + 1,
                isExternal: this.isExternalModule(target),
                hasImplementation: argsNode !== null && argsNode.namedChildCount > 1,
              });
            }
          }

          if (objNode?.text === mockObj && propNode?.text === 'spyOn') {
            const argsNode = node.childForFieldName('arguments');
            const targetNode = argsNode?.namedChild(0);
            const methodNode = argsNode?.namedChild(1);
            
            if (targetNode && methodNode) {
              const target = `${targetNode.text}.${this.extractStringValue(methodNode)}`;
              mocks.push({
                target,
                mockType: `${mockObj}.spyOn`,
                line: node.startPosition.row + 1,
                isExternal: false, // spyOn is typically on local objects
              });
            }
          }
        }
      }
    });

    return mocks;
  }

  extractSetupBlocks(root: Parser.SyntaxNode): SetupBlock[] {
    const blocks: SetupBlock[] = [];
    const setupFns = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'];

    this.walkNode(root, (node) => {
      if (node.type === 'call_expression') {
        const fnNode = node.childForFieldName('function');
        
        if (fnNode?.type === 'identifier' && setupFns.includes(fnNode.text)) {
          const argsNode = node.childForFieldName('arguments');
          const bodyNode = argsNode?.namedChild(0);
          
          const calls = bodyNode ? this.extractFunctionCalls(bodyNode) : [];
          
          blocks.push({
            type: fnNode.text as SetupBlock['type'],
            line: node.startPosition.row + 1,
            calls,
          });
        }
      }
    });

    return blocks;
  }

  protected findImports(root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];

    this.walkNode(root, (node) => {
      if (node.type === 'import_statement') {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) {
          imports.push(this.extractStringValue(sourceNode));
        }
      }
    });

    return imports;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      if (child.type === 'call_expression') {
        const fnNode = child.childForFieldName('function');
        
        // expect(...).matcher pattern
        if (fnNode?.type === 'member_expression') {
          const objNode = fnNode.childForFieldName('object');
          const propNode = fnNode.childForFieldName('property');
          
          if (objNode?.type === 'call_expression') {
            const expectFn = objNode.childForFieldName('function');
            if (expectFn?.text === 'expect' && propNode) {
              const matcher = propNode.text;
              assertions.push({
                matcher,
                line: child.startPosition.row + 1,
                isErrorAssertion: this.isErrorMatcher(matcher),
                isEdgeCaseAssertion: this.isEdgeCaseMatcher(matcher),
              });
            }
          }
        }
      }
    });

    return assertions;
  }

  private isErrorMatcher(matcher: string): boolean {
    const errorMatchers = [
      'toThrow', 'toThrowError', 'toThrowErrorMatchingSnapshot',
      'rejects', 'toReject',
    ];
    return errorMatchers.some(m => matcher.includes(m));
  }

  private isEdgeCaseMatcher(matcher: string): boolean {
    const edgeCaseMatchers = [
      'toBeNull', 'toBeUndefined', 'toBeFalsy', 'toBeNaN',
      'toHaveLength', 'toBeEmpty', 'toBeNil',
    ];
    return edgeCaseMatchers.some(m => matcher.includes(m));
  }

  private extractStringValue(node: Parser.SyntaxNode): string {
    let text = node.text;
    // Remove quotes
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")) ||
        (text.startsWith('`') && text.endsWith('`'))) {
      text = text.slice(1, -1);
    }
    return text;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTypeScriptTestExtractor(parser: Parser): TypeScriptTestExtractor {
  return new TypeScriptTestExtractor(parser);
}
