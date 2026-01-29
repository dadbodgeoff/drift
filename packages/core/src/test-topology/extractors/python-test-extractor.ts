/**
 * Python Test Extractor
 *
 * Extracts test information from pytest, unittest, and other Python test frameworks.
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
// Framework Detection
// ============================================================================

const FRAMEWORK_IMPORTS: Record<string, TestFramework> = {
  'pytest': 'pytest',
  'unittest': 'unittest',
  'nose': 'nose',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class PythonTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'python');
  }

  extract(content: string, filePath: string): TestExtraction {
    const tree = this.parser.parse(content);
    const root = tree.rootNode;

    const framework = this.detectFramework(root);
    const testCases = this.extractTestCases(root);
    const mocks = this.extractMocks(root, framework);
    const setupBlocks = this.extractSetupBlocks(root);
    const fixtures = framework === 'pytest' ? this.extractFixtures(root) : undefined;

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
      language: 'python',
      testCases,
      mocks,
      setupBlocks,
      fixtures,
    };
  }

  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);

    for (const imp of imports) {
      const framework = FRAMEWORK_IMPORTS[imp];
      if (framework) {return framework;}
    }

    // Check for pytest fixtures
    const text = root.text;
    if (text.includes('@pytest.fixture') || text.includes('@fixture')) {
      return 'pytest';
    }

    // Check for unittest.TestCase
    if (text.includes('TestCase') || text.includes('unittest')) {
      return 'unittest';
    }

    // Default to pytest if we see test_ functions
    if (/def\s+test_/.test(text)) {
      return 'pytest';
    }

    return 'unknown';
  }

  extractTestCases(root: Parser.SyntaxNode): TestCase[] {
    const testCases: TestCase[] = [];
    let currentClass: string | undefined;

    this.walkNode(root, (node) => {
      // Track class context
      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          currentClass = nameNode.text;
        }
      }

      // Find test functions
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          
          // Check if it's a test function
          if (name.startsWith('test_') || name.startsWith('test')) {
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
      // @patch decorator
      if (node.type === 'decorator') {
        const text = node.text;
        
        // @patch('module.path')
        const patchMatch = text.match(/@(?:mock\.)?patch\s*\(\s*['"]([^'"]+)['"]/);
        if (patchMatch) {
          mocks.push({
            target: patchMatch[1]!,
            mockType: '@patch',
            line: node.startPosition.row + 1,
            isExternal: this.isExternalPythonModule(patchMatch[1]!),
          });
        }

        // @patch.object(obj, 'method')
        const patchObjMatch = text.match(/@patch\.object\s*\(\s*(\w+)\s*,\s*['"](\w+)['"]/);
        if (patchObjMatch) {
          mocks.push({
            target: `${patchObjMatch[1]}.${patchObjMatch[2]}`,
            mockType: '@patch.object',
            line: node.startPosition.row + 1,
            isExternal: false,
          });
        }
      }

      // mocker.patch() calls (pytest-mock)
      if (node.type === 'call') {
        const fnNode = node.childForFieldName('function');
        
        if (fnNode?.type === 'attribute') {
          const objNode = fnNode.childForFieldName('object');
          const attrNode = fnNode.childForFieldName('attribute');
          
          if (objNode?.text === 'mocker' && attrNode?.text === 'patch') {
            const argsNode = node.childForFieldName('arguments');
            const targetNode = argsNode?.namedChild(0);
            
            if (targetNode) {
              const target = this.extractStringValue(targetNode);
              mocks.push({
                target,
                mockType: 'mocker.patch',
                line: node.startPosition.row + 1,
                isExternal: this.isExternalPythonModule(target),
              });
            }
          }
        }
      }

      // MagicMock() / Mock() instantiation
      if (node.type === 'call') {
        const fnNode = node.childForFieldName('function');
        if (fnNode?.type === 'identifier') {
          const name = fnNode.text;
          if (name === 'MagicMock' || name === 'Mock') {
            mocks.push({
              target: 'inline_mock',
              mockType: name,
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
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode) {
          const name = nameNode.text;
          let type: SetupBlock['type'] | null = null;

          // unittest style
          if (name === 'setUp') {type = 'setUp';}
          else if (name === 'tearDown') {type = 'tearDown';}
          else if (name === 'setUpClass') {type = 'beforeAll';}
          else if (name === 'tearDownClass') {type = 'afterAll';}

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
      if (node.type === 'decorated_definition') {
        const decorators = node.namedChildren.filter(c => c.type === 'decorator');
        const definition = node.namedChildren.find(c => c.type === 'function_definition');

        for (const decorator of decorators) {
          const text = decorator.text;
          
          if (text.includes('fixture') || text.includes('@pytest.fixture')) {
            const nameNode = definition?.childForFieldName('name');
            
            if (nameNode) {
              // Extract scope if specified
              const scopeMatch = text.match(/scope\s*=\s*['"](\w+)['"]/);
              
              fixtures.push({
                name: nameNode.text,
                scope: scopeMatch?.[1] ?? 'function',
                line: node.startPosition.row + 1,
              });
            }
          }
        }
      }
    });

    return fixtures;
  }

  protected findImports(root: Parser.SyntaxNode): string[] {
    const imports: string[] = [];

    this.walkNode(root, (node) => {
      // import module
      if (node.type === 'import_statement') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          imports.push(nameNode.text.split('.')[0]!);
        }
      }

      // from module import ...
      if (node.type === 'import_from_statement') {
        const moduleNode = node.childForFieldName('module_name');
        if (moduleNode) {
          imports.push(moduleNode.text.split('.')[0]!);
        }
      }
    });

    return imports;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      // assert statement
      if (child.type === 'assert_statement') {
        const text = child.text;
        assertions.push({
          matcher: 'assert',
          line: child.startPosition.row + 1,
          isErrorAssertion: text.includes('raises') || text.includes('Exception'),
          isEdgeCaseAssertion: text.includes('None') || text.includes('is None') || 
                              text.includes('== []') || text.includes('== {}'),
        });
      }

      // pytest.raises context manager
      if (child.type === 'with_statement') {
        const text = child.text;
        if (text.includes('pytest.raises') || text.includes('assertRaises')) {
          assertions.push({
            matcher: 'raises',
            line: child.startPosition.row + 1,
            isErrorAssertion: true,
            isEdgeCaseAssertion: false,
          });
        }
      }

      // self.assert* calls (unittest)
      if (child.type === 'call') {
        const fnNode = child.childForFieldName('function');
        if (fnNode?.type === 'attribute') {
          const attrNode = fnNode.childForFieldName('attribute');
          if (attrNode?.text.startsWith('assert')) {
            const matcher = attrNode.text;
            assertions.push({
              matcher,
              line: child.startPosition.row + 1,
              isErrorAssertion: matcher.includes('Raises'),
              isEdgeCaseAssertion: matcher.includes('None') || matcher.includes('Empty'),
            });
          }
        }
      }
    });

    return assertions;
  }

  private isExternalPythonModule(modulePath: string): boolean {
    const firstPart = modulePath.split('.')[0]!;
    
    // Standard library modules
    const stdlib = [
      'os', 'sys', 'json', 'datetime', 'collections', 'itertools',
      'functools', 'typing', 'pathlib', 'logging', 're', 'math',
      'io', 'time', 'random', 'copy', 'pickle', 'sqlite3',
      'http', 'urllib', 'email', 'html', 'xml', 'csv',
    ];
    
    // Common third-party packages
    const thirdParty = [
      'requests', 'numpy', 'pandas', 'django', 'flask', 'fastapi',
      'sqlalchemy', 'celery', 'redis', 'boto3', 'aiohttp',
    ];

    return stdlib.includes(firstPart) || thirdParty.includes(firstPart);
  }

  private extractStringValue(node: Parser.SyntaxNode): string {
    let text = node.text;
    // Remove quotes
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'")) ||
        (text.startsWith('"""') && text.endsWith('"""')) ||
        (text.startsWith("'''") && text.endsWith("'''"))) {
      if (text.startsWith('"""') || text.startsWith("'''")) {
        text = text.slice(3, -3);
      } else {
        text = text.slice(1, -1);
      }
    }
    return text;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPythonTestExtractor(parser: Parser): PythonTestExtractor {
  return new PythonTestExtractor(parser);
}
