/**
 * C# Test Extractor
 *
 * Extracts test information from xUnit, NUnit, MSTest, and Moq.
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
  'Xunit': 'xunit',
  'xUnit': 'xunit',
  'NUnit': 'nunit',
  'NUnit.Framework': 'nunit',
  'Microsoft.VisualStudio.TestTools.UnitTesting': 'mstest',
};

const FRAMEWORK_ATTRIBUTES: Record<string, TestFramework> = {
  'Fact': 'xunit',
  'Theory': 'xunit',
  'Test': 'nunit',
  'TestCase': 'nunit',
  'TestMethod': 'mstest',
  'DataTestMethod': 'mstest',
};

// ============================================================================
// Extractor Implementation
// ============================================================================

export class CSharpTestExtractor extends BaseTestExtractor {
  constructor(parser: Parser) {
    super(parser, 'csharp');
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
      language: 'csharp',
      testCases,
      mocks,
      setupBlocks,
    };
  }

  detectFramework(root: Parser.SyntaxNode): TestFramework {
    const imports = this.findImports(root);

    // Check using statements
    for (const imp of imports) {
      for (const [pattern, framework] of Object.entries(FRAMEWORK_NAMESPACES)) {
        if (imp.includes(pattern)) {
          return framework;
        }
      }
    }

    // Check for test attributes in the code
    const text = root.text;
    for (const [attr, framework] of Object.entries(FRAMEWORK_ATTRIBUTES)) {
      if (text.includes(`[${attr}]`) || text.includes(`[${attr}(`)) {
        return framework;
      }
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

      // Find methods with test attributes
      if (node.type === 'method_declaration') {
        const attributeList = this.findAttributeList(node);
        const nameNode = node.childForFieldName('name');
        const bodyNode = node.childForFieldName('body');

        if (nameNode && bodyNode && this.hasTestAttribute(attributeList)) {
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
    });

    return testCases;
  }

  extractMocks(root: Parser.SyntaxNode, _framework: TestFramework): MockStatement[] {
    const mocks: MockStatement[] = [];

    this.walkNode(root, (node) => {
      // new Mock<T>() pattern (Moq)
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type');
        
        if (typeNode) {
          const typeText = typeNode.text;
          
          // Mock<IService>
          if (typeText.startsWith('Mock<')) {
            const mockTarget = typeText.slice(5, -1); // Extract type from Mock<Type>
            mocks.push({
              target: mockTarget,
              mockType: 'Mock<T>',
              line: node.startPosition.row + 1,
              isExternal: this.isExternalCSharpType(mockTarget),
            });
          }
          
          // Substitute.For<IService>() (NSubstitute)
          if (typeText.includes('Substitute')) {
            mocks.push({
              target: typeText,
              mockType: 'NSubstitute',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }

      // Substitute.For<T>() pattern (NSubstitute)
      if (node.type === 'invocation_expression') {
        const fnNode = node.childForFieldName('function');
        
        if (fnNode?.type === 'member_access_expression') {
          const text = fnNode.text;
          
          if (text.includes('Substitute.For')) {
            const typeMatch = text.match(/For<([^>]+)>/);
            mocks.push({
              target: typeMatch?.[1] ?? 'unknown',
              mockType: 'Substitute.For<T>',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
          
          // A.Fake<T>() (FakeItEasy)
          if (text.includes('A.Fake')) {
            const typeMatch = text.match(/Fake<([^>]+)>/);
            mocks.push({
              target: typeMatch?.[1] ?? 'unknown',
              mockType: 'A.Fake<T>',
              line: node.startPosition.row + 1,
              isExternal: false,
            });
          }
        }
      }

      // .Setup() calls on mocks (Moq)
      if (node.type === 'invocation_expression') {
        const fnNode = node.childForFieldName('function');
        
        if (fnNode?.type === 'member_access_expression') {
          const nameNode = fnNode.childForFieldName('name');
          
          if (nameNode?.text === 'Setup' || nameNode?.text === 'SetupGet' || 
              nameNode?.text === 'SetupSet' || nameNode?.text === 'SetupSequence') {
            mocks.push({
              target: 'mock_setup',
              mockType: `Moq.${nameNode.text}`,
              line: node.startPosition.row + 1,
              isExternal: false,
              hasImplementation: true,
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
        const attributeList = this.findAttributeList(node);
        const bodyNode = node.childForFieldName('body');

        if (bodyNode) {
          let setupType: SetupBlock['type'] | null = null;

          // Check for setup/teardown attributes
          for (const attr of attributeList) {
            const attrText = attr.text;
            
            // xUnit: constructor is setup, IDisposable.Dispose is teardown
            // NUnit
            if (attrText.includes('[SetUp]')) {setupType = 'beforeEach';}
            else if (attrText.includes('[TearDown]')) {setupType = 'afterEach';}
            else if (attrText.includes('[OneTimeSetUp]')) {setupType = 'beforeAll';}
            else if (attrText.includes('[OneTimeTearDown]')) {setupType = 'afterAll';}
            // MSTest
            else if (attrText.includes('[TestInitialize]')) {setupType = 'beforeEach';}
            else if (attrText.includes('[TestCleanup]')) {setupType = 'afterEach';}
            else if (attrText.includes('[ClassInitialize]')) {setupType = 'beforeAll';}
            else if (attrText.includes('[ClassCleanup]')) {setupType = 'afterAll';}
          }

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

      // xUnit: constructor is setup
      if (node.type === 'constructor_declaration') {
        const bodyNode = node.childForFieldName('body');
        if (bodyNode) {
          const calls = this.extractFunctionCalls(bodyNode);
          blocks.push({
            type: 'beforeEach',
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
      if (node.type === 'using_directive') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          imports.push(nameNode.text);
        }
      }
    });

    return imports;
  }

  private findAttributeList(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const attributes: Parser.SyntaxNode[] = [];
    
    // Look for attribute_list siblings before the method
    let sibling = node.previousNamedSibling;
    while (sibling?.type === 'attribute_list') {
      attributes.push(sibling);
      sibling = sibling.previousNamedSibling;
    }

    // Also check children
    this.walkNode(node, (child) => {
      if (child.type === 'attribute_list') {
        attributes.push(child);
      }
    });

    return attributes;
  }

  private hasTestAttribute(attributeList: Parser.SyntaxNode[]): boolean {
    const testAttributes = ['Fact', 'Theory', 'Test', 'TestCase', 'TestMethod', 'DataTestMethod'];
    
    for (const attrList of attributeList) {
      const text = attrList.text;
      for (const attr of testAttributes) {
        if (text.includes(`[${attr}]`) || text.includes(`[${attr}(`)) {
          return true;
        }
      }
    }
    
    return false;
  }

  private extractAssertions(node: Parser.SyntaxNode): AssertionInfo[] {
    const assertions: AssertionInfo[] = [];

    this.walkNode(node, (child) => {
      if (child.type === 'invocation_expression') {
        const fnNode = child.childForFieldName('function');
        
        if (fnNode?.type === 'member_access_expression') {
          const objNode = fnNode.childForFieldName('expression');
          const nameNode = fnNode.childForFieldName('name');
          
          if (objNode && nameNode) {
            const obj = objNode.text;
            const method = nameNode.text;
            
            // xUnit Assert
            if (obj === 'Assert') {
              assertions.push({
                matcher: `Assert.${method}`,
                line: child.startPosition.row + 1,
                isErrorAssertion: method === 'Throws' || method === 'ThrowsAsync' ||
                                 method === 'ThrowsAny' || method === 'ThrowsAnyAsync',
                isEdgeCaseAssertion: method === 'Null' || method === 'NotNull' ||
                                    method === 'Empty' || method === 'NotEmpty',
              });
            }

            // NUnit Assert
            if (obj === 'Assert' || obj.endsWith('.Assert')) {
              assertions.push({
                matcher: method,
                line: child.startPosition.row + 1,
                isErrorAssertion: method === 'Throws' || method === 'ThrowsAsync' ||
                                 method === 'Catch' || method === 'CatchAsync',
                isEdgeCaseAssertion: method === 'IsNull' || method === 'IsNotNull' ||
                                    method === 'IsEmpty' || method === 'IsNotEmpty',
              });
            }

            // FluentAssertions: .Should()
            if (method === 'Should') {
              assertions.push({
                matcher: 'Should',
                line: child.startPosition.row + 1,
                isErrorAssertion: false,
                isEdgeCaseAssertion: false,
              });
            }

            // Moq Verify
            if (method === 'Verify' || method === 'VerifyAll' || method === 'VerifyNoOtherCalls') {
              assertions.push({
                matcher: `Mock.${method}`,
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
}

// ============================================================================
// Factory
// ============================================================================

export function createCSharpTestExtractor(parser: Parser): CSharpTestExtractor {
  return new CSharpTestExtractor(parser);
}
