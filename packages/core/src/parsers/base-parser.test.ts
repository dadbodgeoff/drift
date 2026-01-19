/**
 * Unit tests for BaseParser
 *
 * Tests the abstract base parser class including AST traversal,
 * querying, and utility methods.
 *
 * @requirements 3.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BaseParser,
  type ParseOptions,
  type QueryOptions,
  type ASTVisitor,
  type TraversalResult,
} from './base-parser.js';
import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Concrete implementation of BaseParser for testing purposes.
 * Implements a simple parser that creates AST from a basic structure.
 */
class TestParser extends BaseParser {
  readonly language: Language = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx'];

  parse(source: string, filePath?: string): ParseResult {
    // Simple parser that creates a basic AST structure
    // For testing, we'll parse a simple format: "type:text[children]"
    try {
      const rootNode = this.parseNode(source, { row: 0, column: 0 });
      const ast = this.createAST(rootNode, source);
      return this.createSuccessResult(ast);
    } catch (error) {
      return this.createFailureResult([
        this.createError(error instanceof Error ? error.message : 'Parse error', { row: 0, column: 0 }),
      ]);
    }
  }

  query(ast: AST, pattern: string): ASTNode[] {
    // Simple query implementation: pattern is just a node type
    return this.findNodesByType(ast, pattern);
  }

  private parseNode(text: string, startPos: Position): ASTNode {
    // Create a simple node structure for testing
    return this.createNode('program', text, startPos, { row: 0, column: text.length }, []);
  }
}

/**
 * Helper to create a test AST with a specific structure
 */
function createTestAST(): AST {
  const leaf1: ASTNode = {
    type: 'identifier',
    text: 'foo',
    startPosition: { row: 0, column: 6 },
    endPosition: { row: 0, column: 9 },
    children: [],
  };

  const leaf2: ASTNode = {
    type: 'number',
    text: '42',
    startPosition: { row: 0, column: 12 },
    endPosition: { row: 0, column: 14 },
    children: [],
  };

  const assignment: ASTNode = {
    type: 'assignment',
    text: 'foo = 42',
    startPosition: { row: 0, column: 6 },
    endPosition: { row: 0, column: 14 },
    children: [leaf1, leaf2],
  };

  const declaration: ASTNode = {
    type: 'variable_declaration',
    text: 'const foo = 42',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 14 },
    children: [assignment],
  };

  const root: ASTNode = {
    type: 'program',
    text: 'const foo = 42;',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 15 },
    children: [declaration],
  };

  return {
    rootNode: root,
    text: 'const foo = 42;',
  };
}

/**
 * Helper to create a multi-line test AST
 */
function createMultiLineAST(): AST {
  const id1: ASTNode = {
    type: 'identifier',
    text: 'x',
    startPosition: { row: 0, column: 6 },
    endPosition: { row: 0, column: 7 },
    children: [],
  };

  const num1: ASTNode = {
    type: 'number',
    text: '1',
    startPosition: { row: 0, column: 10 },
    endPosition: { row: 0, column: 11 },
    children: [],
  };

  const decl1: ASTNode = {
    type: 'variable_declaration',
    text: 'const x = 1',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 11 },
    children: [id1, num1],
  };

  const id2: ASTNode = {
    type: 'identifier',
    text: 'y',
    startPosition: { row: 1, column: 6 },
    endPosition: { row: 1, column: 7 },
    children: [],
  };

  const num2: ASTNode = {
    type: 'number',
    text: '2',
    startPosition: { row: 1, column: 10 },
    endPosition: { row: 1, column: 11 },
    children: [],
  };

  const decl2: ASTNode = {
    type: 'variable_declaration',
    text: 'const y = 2',
    startPosition: { row: 1, column: 0 },
    endPosition: { row: 1, column: 11 },
    children: [id2, num2],
  };

  const root: ASTNode = {
    type: 'program',
    text: 'const x = 1\nconst y = 2',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 1, column: 11 },
    children: [decl1, decl2],
  };

  return {
    rootNode: root,
    text: 'const x = 1\nconst y = 2',
  };
}

describe('BaseParser', () => {
  let parser: TestParser;

  beforeEach(() => {
    parser = new TestParser();
  });

  describe('abstract properties', () => {
    it('should expose language property', () => {
      expect(parser.language).toBe('typescript');
    });

    it('should expose extensions property', () => {
      expect(parser.extensions).toEqual(['.ts', '.tsx']);
    });
  });

  describe('canHandle', () => {
    it('should return true for supported extensions', () => {
      expect(parser.canHandle('.ts')).toBe(true);
      expect(parser.canHandle('.tsx')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(parser.canHandle('.js')).toBe(false);
      expect(parser.canHandle('.py')).toBe(false);
    });

    it('should handle extensions without leading dot', () => {
      expect(parser.canHandle('ts')).toBe(true);
      expect(parser.canHandle('tsx')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(parser.canHandle('.TS')).toBe(true);
      expect(parser.canHandle('.Tsx')).toBe(true);
    });
  });

  describe('parse', () => {
    it('should return successful parse result', () => {
      const result = parser.parse('const x = 1;');

      expect(result.success).toBe(true);
      expect(result.ast).not.toBeNull();
      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);
    });

    it('should include source text in AST', () => {
      const source = 'const x = 1;';
      const result = parser.parse(source);

      expect(result.ast?.text).toBe(source);
    });
  });

  describe('parseWithOptions', () => {
    it('should pass filePath to parse', () => {
      const result = parser.parseWithOptions('const x = 1;', {
        filePath: 'test.ts',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('query', () => {
    it('should find nodes by type', () => {
      const ast = createTestAST();
      const results = parser.query(ast, 'identifier');

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('foo');
    });

    it('should return empty array for non-matching pattern', () => {
      const ast = createTestAST();
      const results = parser.query(ast, 'nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('queryWithOptions', () => {
    it('should limit results', () => {
      const ast = createMultiLineAST();
      const results = parser.queryWithOptions(ast, 'identifier', { limit: 1 });

      expect(results).toHaveLength(1);
    });

    it('should filter by start position', () => {
      const ast = createMultiLineAST();
      const results = parser.queryWithOptions(ast, 'identifier', {
        startPosition: { row: 1, column: 0 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('y');
    });

    it('should filter by end position', () => {
      const ast = createMultiLineAST();
      const results = parser.queryWithOptions(ast, 'identifier', {
        endPosition: { row: 0, column: 20 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('x');
    });

    it('should filter by position range', () => {
      const ast = createMultiLineAST();
      const results = parser.queryWithOptions(ast, 'number', {
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 20 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('1');
    });
  });

  describe('traverse', () => {
    it('should visit all nodes depth-first', () => {
      const ast = createTestAST();
      const visited: string[] = [];

      parser.traverse(ast, ({ node }) => {
        visited.push(node.type);
      });

      expect(visited).toEqual(['program', 'variable_declaration', 'assignment', 'identifier', 'number']);
    });

    it('should provide parent information', () => {
      const ast = createTestAST();
      const parentTypes: (string | null)[] = [];

      parser.traverse(ast, ({ node, parent }) => {
        if (node.type === 'identifier') {
          parentTypes.push(parent?.type ?? null);
        }
      });

      expect(parentTypes).toEqual(['assignment']);
    });

    it('should provide depth information', () => {
      const ast = createTestAST();
      const depths: Record<string, number> = {};

      parser.traverse(ast, ({ node, depth }) => {
        depths[node.type] = depth;
      });

      expect(depths['program']).toBe(0);
      expect(depths['variable_declaration']).toBe(1);
      expect(depths['assignment']).toBe(2);
      expect(depths['identifier']).toBe(3);
    });

    it('should stop traversal when visitor returns false', () => {
      const ast = createTestAST();
      const visited: string[] = [];

      parser.traverse(ast, ({ node }) => {
        visited.push(node.type);
        if (node.type === 'assignment') {
          return false;
        }
      });

      expect(visited).toEqual(['program', 'variable_declaration', 'assignment']);
    });

    it('should provide path information', () => {
      const ast = createTestAST();
      let identifierPath: number[] = [];

      parser.traverse(ast, ({ node, path }) => {
        if (node.type === 'identifier') {
          identifierPath = path;
        }
      });

      expect(identifierPath).toEqual([0, 0, 0]); // First child at each level
    });
  });

  describe('findNodesByType', () => {
    it('should find all nodes of a type', () => {
      const ast = createMultiLineAST();
      const results = parser.findNodesByType(ast, 'identifier');

      expect(results).toHaveLength(2);
      expect(results.map((n) => n.text)).toEqual(['x', 'y']);
    });

    it('should return empty array when no matches', () => {
      const ast = createTestAST();
      const results = parser.findNodesByType(ast, 'nonexistent');

      expect(results).toHaveLength(0);
    });
  });

  describe('findFirstNodeByType', () => {
    it('should find first node of a type', () => {
      const ast = createMultiLineAST();
      const result = parser.findFirstNodeByType(ast, 'identifier');

      expect(result).not.toBeNull();
      expect(result?.text).toBe('x');
    });

    it('should return null when no matches', () => {
      const ast = createTestAST();
      const result = parser.findFirstNodeByType(ast, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findNodeAtPosition', () => {
    it('should find node at position', () => {
      const ast = createTestAST();
      const result = parser.findNodeAtPosition(ast, { row: 0, column: 7 });

      expect(result).not.toBeNull();
      expect(result?.type).toBe('identifier');
    });

    it('should find most specific node', () => {
      const ast = createTestAST();
      // Position 7 is within identifier "foo" which is within assignment
      const result = parser.findNodeAtPosition(ast, { row: 0, column: 7 });

      expect(result?.type).toBe('identifier');
    });

    it('should return null for position outside AST', () => {
      const ast = createTestAST();
      const result = parser.findNodeAtPosition(ast, { row: 10, column: 0 });

      expect(result).toBeNull();
    });
  });

  describe('getParentChain', () => {
    it('should return parent chain from root', () => {
      const ast = createTestAST();
      const identifier = parser.findFirstNodeByType(ast, 'identifier')!;
      const chain = parser.getParentChain(ast, identifier);

      expect(chain.map((n) => n.type)).toEqual(['program', 'variable_declaration', 'assignment']);
    });

    it('should return empty array for root node', () => {
      const ast = createTestAST();
      const chain = parser.getParentChain(ast, ast.rootNode);

      expect(chain).toHaveLength(0);
    });
  });

  describe('getDescendants', () => {
    it('should return all descendants', () => {
      const ast = createTestAST();
      const descendants = parser.getDescendants(ast.rootNode);

      expect(descendants).toHaveLength(4); // declaration, assignment, identifier, number
    });

    it('should return empty array for leaf node', () => {
      const ast = createTestAST();
      const identifier = parser.findFirstNodeByType(ast, 'identifier')!;
      const descendants = parser.getDescendants(identifier);

      expect(descendants).toHaveLength(0);
    });
  });

  describe('getSiblings', () => {
    it('should return sibling nodes', () => {
      const ast = createMultiLineAST();
      const decl1 = ast.rootNode.children[0];
      const siblings = parser.getSiblings(ast, decl1);

      expect(siblings).toHaveLength(1);
      expect(siblings[0].children[0].text).toBe('y');
    });

    it('should return empty array for root node', () => {
      const ast = createTestAST();
      const siblings = parser.getSiblings(ast, ast.rootNode);

      expect(siblings).toHaveLength(0);
    });
  });

  describe('getNodeDepth', () => {
    it('should return correct depth', () => {
      const ast = createTestAST();

      expect(parser.getNodeDepth(ast, ast.rootNode)).toBe(0);

      const declaration = ast.rootNode.children[0];
      expect(parser.getNodeDepth(ast, declaration)).toBe(1);

      const identifier = parser.findFirstNodeByType(ast, 'identifier')!;
      expect(parser.getNodeDepth(ast, identifier)).toBe(3);
    });
  });

  describe('isLeafNode', () => {
    it('should return true for leaf nodes', () => {
      const ast = createTestAST();
      const identifier = parser.findFirstNodeByType(ast, 'identifier')!;

      expect(parser.isLeafNode(identifier)).toBe(true);
    });

    it('should return false for non-leaf nodes', () => {
      const ast = createTestAST();

      expect(parser.isLeafNode(ast.rootNode)).toBe(false);
    });
  });

  describe('countNodes', () => {
    it('should count all nodes in AST', () => {
      const ast = createTestAST();
      const count = parser.countNodes(ast);

      expect(count).toBe(5); // program, declaration, assignment, identifier, number
    });

    it('should count nodes in multi-line AST', () => {
      const ast = createMultiLineAST();
      const count = parser.countNodes(ast);

      expect(count).toBe(7); // program, 2x(declaration, identifier, number)
    });
  });
});

describe('BaseParser protected methods', () => {
  /**
   * Extended test parser to expose protected methods for testing
   */
  class ExposedTestParser extends TestParser {
    public testCreateError(message: string, position: Position) {
      return this.createError(message, position);
    }

    public testCreateSuccessResult(ast: AST) {
      return this.createSuccessResult(ast);
    }

    public testCreateFailureResult(errors: { message: string; position: Position }[]) {
      return this.createFailureResult(errors);
    }

    public testCreatePartialResult(ast: AST, errors: { message: string; position: Position }[]) {
      return this.createPartialResult(ast, errors);
    }

    public testPositionInRange(position: Position, start: Position, end: Position) {
      return this.positionInRange(position, start, end);
    }

    public testComparePositions(a: Position, b: Position) {
      return this.comparePositions(a, b);
    }

    public testGetTextBetween(source: string, start: Position, end: Position) {
      return this.getTextBetween(source, start, end);
    }

    public testCreateNode(
      type: string,
      text: string,
      startPosition: Position,
      endPosition: Position,
      children: ASTNode[] = []
    ) {
      return this.createNode(type, text, startPosition, endPosition, children);
    }

    public testCreateAST(rootNode: ASTNode, text: string) {
      return this.createAST(rootNode, text);
    }

    public testNodesEqual(a: ASTNode, b: ASTNode) {
      return this.nodesEqual(a, b);
    }
  }

  let parser: ExposedTestParser;

  beforeEach(() => {
    parser = new ExposedTestParser();
  });

  describe('createError', () => {
    it('should create error object', () => {
      const error = parser.testCreateError('Test error', { row: 1, column: 5 });

      expect(error.message).toBe('Test error');
      expect(error.position).toEqual({ row: 1, column: 5 });
    });
  });

  describe('createSuccessResult', () => {
    it('should create success result', () => {
      const ast = createTestAST();
      const result = parser.testCreateSuccessResult(ast);

      expect(result.success).toBe(true);
      expect(result.ast).toBe(ast);
      expect(result.errors).toHaveLength(0);
      expect(result.language).toBe('typescript');
    });
  });

  describe('createFailureResult', () => {
    it('should create failure result', () => {
      const errors = [{ message: 'Error 1', position: { row: 0, column: 0 } }];
      const result = parser.testCreateFailureResult(errors);

      expect(result.success).toBe(false);
      expect(result.ast).toBeNull();
      expect(result.errors).toEqual(errors);
    });
  });

  describe('createPartialResult', () => {
    it('should create partial result', () => {
      const ast = createTestAST();
      const errors = [{ message: 'Warning', position: { row: 0, column: 0 } }];
      const result = parser.testCreatePartialResult(ast, errors);

      expect(result.success).toBe(true);
      expect(result.ast).toBe(ast);
      expect(result.errors).toEqual(errors);
    });
  });

  describe('positionInRange', () => {
    it('should return true for position within range', () => {
      const start = { row: 0, column: 0 };
      const end = { row: 2, column: 10 };

      expect(parser.testPositionInRange({ row: 1, column: 5 }, start, end)).toBe(true);
      expect(parser.testPositionInRange({ row: 0, column: 0 }, start, end)).toBe(true);
      expect(parser.testPositionInRange({ row: 2, column: 10 }, start, end)).toBe(true);
    });

    it('should return false for position outside range', () => {
      const start = { row: 1, column: 5 };
      const end = { row: 2, column: 10 };

      expect(parser.testPositionInRange({ row: 0, column: 0 }, start, end)).toBe(false);
      expect(parser.testPositionInRange({ row: 3, column: 0 }, start, end)).toBe(false);
      expect(parser.testPositionInRange({ row: 1, column: 4 }, start, end)).toBe(false);
      expect(parser.testPositionInRange({ row: 2, column: 11 }, start, end)).toBe(false);
    });
  });

  describe('comparePositions', () => {
    it('should return -1 when a < b', () => {
      expect(parser.testComparePositions({ row: 0, column: 0 }, { row: 1, column: 0 })).toBe(-1);
      expect(parser.testComparePositions({ row: 0, column: 0 }, { row: 0, column: 1 })).toBe(-1);
    });

    it('should return 1 when a > b', () => {
      expect(parser.testComparePositions({ row: 1, column: 0 }, { row: 0, column: 0 })).toBe(1);
      expect(parser.testComparePositions({ row: 0, column: 1 }, { row: 0, column: 0 })).toBe(1);
    });

    it('should return 0 when a === b', () => {
      expect(parser.testComparePositions({ row: 1, column: 5 }, { row: 1, column: 5 })).toBe(0);
    });
  });

  describe('getTextBetween', () => {
    it('should extract text from single line', () => {
      const source = 'const x = 1;';
      const text = parser.testGetTextBetween(source, { row: 0, column: 6 }, { row: 0, column: 7 });

      expect(text).toBe('x');
    });

    it('should extract text across multiple lines', () => {
      const source = 'line1\nline2\nline3';
      const text = parser.testGetTextBetween(source, { row: 0, column: 3 }, { row: 2, column: 3 });

      expect(text).toBe('e1\nline2\nlin');
    });
  });

  describe('createNode', () => {
    it('should create node with all properties', () => {
      const node = parser.testCreateNode(
        'identifier',
        'foo',
        { row: 0, column: 0 },
        { row: 0, column: 3 },
        []
      );

      expect(node.type).toBe('identifier');
      expect(node.text).toBe('foo');
      expect(node.startPosition).toEqual({ row: 0, column: 0 });
      expect(node.endPosition).toEqual({ row: 0, column: 3 });
      expect(node.children).toEqual([]);
    });
  });

  describe('createAST', () => {
    it('should create AST with root node and text', () => {
      const rootNode = parser.testCreateNode('program', 'test', { row: 0, column: 0 }, { row: 0, column: 4 });
      const ast = parser.testCreateAST(rootNode, 'test');

      expect(ast.rootNode).toBe(rootNode);
      expect(ast.text).toBe('test');
    });
  });

  describe('nodesEqual', () => {
    it('should return true for equal nodes', () => {
      const node1 = parser.testCreateNode('id', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });
      const node2 = parser.testCreateNode('id', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });

      expect(parser.testNodesEqual(node1, node2)).toBe(true);
    });

    it('should return false for different types', () => {
      const node1 = parser.testCreateNode('id', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });
      const node2 = parser.testCreateNode('num', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });

      expect(parser.testNodesEqual(node1, node2)).toBe(false);
    });

    it('should return false for different text', () => {
      const node1 = parser.testCreateNode('id', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });
      const node2 = parser.testCreateNode('id', 'y', { row: 0, column: 0 }, { row: 0, column: 1 });

      expect(parser.testNodesEqual(node1, node2)).toBe(false);
    });

    it('should return false for different positions', () => {
      const node1 = parser.testCreateNode('id', 'x', { row: 0, column: 0 }, { row: 0, column: 1 });
      const node2 = parser.testCreateNode('id', 'x', { row: 1, column: 0 }, { row: 1, column: 1 });

      expect(parser.testNodesEqual(node1, node2)).toBe(false);
    });
  });
});
