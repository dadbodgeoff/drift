/**
 * AST Analyzer Tests
 *
 * Tests for AST pattern matching, subtree comparison, and traversal utilities.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ASTAnalyzer, type ASTPattern } from './ast-analyzer.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Helper to create an AST node
 */
function createNode(
  type: string,
  text: string,
  children: ASTNode[] = [],
  startRow = 0,
  startCol = 0,
  endRow = 0,
  endCol = 0
): ASTNode {
  return {
    type,
    text,
    children,
    startPosition: { row: startRow, column: startCol },
    endPosition: { row: endRow, column: endCol },
  };
}

/**
 * Helper to create an AST
 */
function createAST(rootNode: ASTNode, text = ''): AST {
  return { rootNode, text };
}

describe('ASTAnalyzer', () => {
  let analyzer: ASTAnalyzer;

  beforeEach(() => {
    analyzer = new ASTAnalyzer();
  });

  describe('traverse', () => {
    it('should traverse all nodes in depth-first order', () => {
      const child1 = createNode('Child', 'child1');
      const child2 = createNode('Child', 'child2');
      const root = createNode('Root', 'root', [child1, child2]);
      const ast = createAST(root);

      const visited: string[] = [];
      analyzer.traverse(ast, (node) => {
        visited.push(node.text);
      });

      expect(visited).toEqual(['root', 'child1', 'child2']);
    });

    it('should provide correct depth information', () => {
      const grandchild = createNode('Grandchild', 'grandchild');
      const child = createNode('Child', 'child', [grandchild]);
      const root = createNode('Root', 'root', [child]);
      const ast = createAST(root);

      const depths: number[] = [];
      analyzer.traverse(ast, (_node, _parent, depth) => {
        depths.push(depth);
      });

      expect(depths).toEqual([0, 1, 2]);
    });

    it('should provide correct path information', () => {
      const child1 = createNode('Child', 'child1');
      const child2 = createNode('Child', 'child2');
      const root = createNode('Root', 'root', [child1, child2]);
      const ast = createAST(root);

      const paths: number[][] = [];
      analyzer.traverse(ast, (_node, _parent, _depth, path) => {
        paths.push([...path]);
      });

      expect(paths).toEqual([[], [0], [1]]);
    });

    it('should skip children when visitor returns false', () => {
      const grandchild = createNode('Grandchild', 'grandchild');
      const child = createNode('Child', 'child', [grandchild]);
      const root = createNode('Root', 'root', [child]);
      const ast = createAST(root);

      const visited: string[] = [];
      analyzer.traverse(ast, (node) => {
        visited.push(node.text);
        if (node.type === 'Child') {
          return false; // Skip grandchild
        }
      });

      expect(visited).toEqual(['root', 'child']);
    });
  });

  describe('findNodesByType', () => {
    it('should find all nodes of a specific type', () => {
      const func1 = createNode('FunctionDeclaration', 'function foo() {}');
      const func2 = createNode('FunctionDeclaration', 'function bar() {}');
      const variable = createNode('VariableDeclaration', 'const x = 1');
      const root = createNode('Program', '', [func1, variable, func2]);
      const ast = createAST(root);

      const functions = analyzer.findNodesByType(ast, 'FunctionDeclaration');

      expect(functions).toHaveLength(2);
      expect(functions[0]?.text).toBe('function foo() {}');
      expect(functions[1]?.text).toBe('function bar() {}');
    });

    it('should return empty array when no nodes match', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);

      const results = analyzer.findNodesByType(ast, 'NonExistent');

      expect(results).toEqual([]);
    });
  });

  describe('findFirstNodeByType', () => {
    it('should find the first node of a specific type', () => {
      const func1 = createNode('FunctionDeclaration', 'function foo() {}');
      const func2 = createNode('FunctionDeclaration', 'function bar() {}');
      const root = createNode('Program', '', [func1, func2]);
      const ast = createAST(root);

      const result = analyzer.findFirstNodeByType(ast, 'FunctionDeclaration');

      expect(result?.text).toBe('function foo() {}');
    });

    it('should return null when no node matches', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);

      const result = analyzer.findFirstNodeByType(ast, 'NonExistent');

      expect(result).toBeNull();
    });
  });

  describe('findNodeAtPosition', () => {
    it('should find the most specific node at a position', () => {
      const innerNode = createNode('Identifier', 'x', [], 1, 5, 1, 6);
      const outerNode = createNode('VariableDeclaration', 'const x = 1', [innerNode], 1, 0, 1, 11);
      const root = createNode('Program', '', [outerNode], 0, 0, 2, 0);
      const ast = createAST(root);

      const result = analyzer.findNodeAtPosition(ast, { row: 1, column: 5 });

      expect(result?.type).toBe('Identifier');
    });

    it('should return null when position is outside AST', () => {
      const root = createNode('Program', '', [], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.findNodeAtPosition(ast, { row: 10, column: 0 });

      expect(result).toBeNull();
    });
  });

  describe('getDescendants', () => {
    it('should return all descendants of a node', () => {
      const grandchild1 = createNode('Grandchild', 'gc1');
      const grandchild2 = createNode('Grandchild', 'gc2');
      const child1 = createNode('Child', 'c1', [grandchild1]);
      const child2 = createNode('Child', 'c2', [grandchild2]);
      const root = createNode('Root', 'root', [child1, child2]);

      const descendants = analyzer.getDescendants(root);

      expect(descendants).toHaveLength(4);
      expect(descendants.map((n) => n.text)).toEqual(['c1', 'gc1', 'c2', 'gc2']);
    });

    it('should return empty array for leaf nodes', () => {
      const leaf = createNode('Leaf', 'leaf');

      const descendants = analyzer.getDescendants(leaf);

      expect(descendants).toEqual([]);
    });
  });

  describe('getNodeDepth', () => {
    it('should return correct depth for nodes', () => {
      const grandchild = createNode('Grandchild', 'grandchild');
      const child = createNode('Child', 'child', [grandchild]);
      const root = createNode('Root', 'root', [child]);
      const ast = createAST(root);

      expect(analyzer.getNodeDepth(ast, root)).toBe(0);
      expect(analyzer.getNodeDepth(ast, child)).toBe(1);
      expect(analyzer.getNodeDepth(ast, grandchild)).toBe(2);
    });

    it('should return -1 for nodes not in the AST', () => {
      const root = createNode('Root', 'root');
      const ast = createAST(root);
      const otherNode = createNode('Other', 'other');

      expect(analyzer.getNodeDepth(ast, otherNode)).toBe(-1);
    });
  });

  describe('getParentChain', () => {
    it('should return parent chain from root to immediate parent', () => {
      const grandchild = createNode('Grandchild', 'grandchild');
      const child = createNode('Child', 'child', [grandchild]);
      const root = createNode('Root', 'root', [child]);
      const ast = createAST(root);

      const parents = analyzer.getParentChain(ast, grandchild);

      expect(parents).toHaveLength(2);
      expect(parents[0]).toBe(root);
      expect(parents[1]).toBe(child);
    });

    it('should return empty array for root node', () => {
      const root = createNode('Root', 'root');
      const ast = createAST(root);

      const parents = analyzer.getParentChain(ast, root);

      expect(parents).toEqual([]);
    });
  });

  describe('isLeafNode', () => {
    it('should return true for nodes without children', () => {
      const leaf = createNode('Leaf', 'leaf');

      expect(analyzer.isLeafNode(leaf)).toBe(true);
    });

    it('should return false for nodes with children', () => {
      const child = createNode('Child', 'child');
      const parent = createNode('Parent', 'parent', [child]);

      expect(analyzer.isLeafNode(parent)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should calculate correct statistics', () => {
      const leaf1 = createNode('Leaf', 'leaf1');
      const leaf2 = createNode('Leaf', 'leaf2');
      const leaf3 = createNode('Leaf', 'leaf3');
      const child1 = createNode('Child', 'child1', [leaf1, leaf2]);
      const child2 = createNode('Child', 'child2', [leaf3]);
      const root = createNode('Root', 'root', [child1, child2]);
      const ast = createAST(root);

      const stats = analyzer.getStats(ast);

      expect(stats.nodeCount).toBe(6);
      expect(stats.maxDepth).toBe(2);
      expect(stats.nodesByType['Root']).toBe(1);
      expect(stats.nodesByType['Child']).toBe(2);
      expect(stats.nodesByType['Leaf']).toBe(3);
      // avgChildren: root has 2, child1 has 2, child2 has 1 = 5/3 ≈ 1.67
      expect(stats.avgChildren).toBeCloseTo(5 / 3, 2);
    });

    it('should handle empty AST', () => {
      const root = createNode('Root', 'root');
      const ast = createAST(root);

      const stats = analyzer.getStats(ast);

      expect(stats.nodeCount).toBe(1);
      expect(stats.maxDepth).toBe(0);
      expect(stats.avgChildren).toBe(0);
    });
  });

  describe('findPattern', () => {
    it('should find nodes matching type pattern', () => {
      const func1 = createNode('FunctionDeclaration', 'function foo() {}');
      const func2 = createNode('FunctionDeclaration', 'function bar() {}');
      const root = createNode('Program', '', [func1, func2]);
      const ast = createAST(root);

      const pattern: ASTPattern = { type: 'FunctionDeclaration' };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(2);
      expect(results[0]?.confidence).toBe(1);
    });

    it('should find nodes matching text pattern', () => {
      const node1 = createNode('Identifier', 'foo');
      const node2 = createNode('Identifier', 'fooBar');
      const node3 = createNode('Identifier', 'bar');
      const root = createNode('Program', '', [node1, node2, node3]);
      const ast = createAST(root);

      const pattern: ASTPattern = { text: 'foo' };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(2);
    });

    it('should find nodes matching exact text pattern', () => {
      const node1 = createNode('Identifier', 'foo');
      const node2 = createNode('Identifier', 'fooBar');
      const root = createNode('Program', '', [node1, node2]);
      const ast = createAST(root);

      const pattern: ASTPattern = { text: 'foo', exactText: true };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.node.text).toBe('foo');
    });

    it('should find nodes matching regex pattern', () => {
      const node1 = createNode('Identifier', 'handleClick');
      const node2 = createNode('Identifier', 'handleSubmit');
      const node3 = createNode('Identifier', 'onClick');
      const root = createNode('Program', '', [node1, node2, node3]);
      const ast = createAST(root);

      const pattern: ASTPattern = { text: /^handle/ };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(2);
    });

    it('should find nodes matching children count constraints', () => {
      const leaf = createNode('Leaf', 'leaf');
      const parent1 = createNode('Parent', 'p1', [leaf]);
      const parent2 = createNode('Parent', 'p2', [leaf, leaf]);
      const root = createNode('Program', '', [parent1, parent2]);
      const ast = createAST(root);

      const pattern: ASTPattern = { type: 'Parent', minChildren: 2 };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.node.text).toBe('p2');
    });

    it('should find nodes matching custom predicate', () => {
      const node1 = createNode('Identifier', 'short');
      const node2 = createNode('Identifier', 'veryLongIdentifierName');
      const root = createNode('Program', '', [node1, node2]);
      const ast = createAST(root);

      const pattern: ASTPattern = {
        type: 'Identifier',
        predicate: (node) => node.text.length > 10,
      };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.node.text).toBe('veryLongIdentifierName');
    });

    it('should respect limit option', () => {
      const nodes = Array.from({ length: 10 }, (_, i) =>
        createNode('Item', `item${i}`)
      );
      const root = createNode('Program', '', nodes);
      const ast = createAST(root);

      const pattern: ASTPattern = { type: 'Item' };
      const results = analyzer.findPattern(ast, pattern, { limit: 3 });

      expect(results).toHaveLength(3);
    });

    it('should capture nodes with capture option', () => {
      const identifier = createNode('Identifier', 'myFunc');
      const func = createNode('FunctionDeclaration', 'function myFunc() {}', [identifier]);
      const root = createNode('Program', '', [func]);
      const ast = createAST(root);

      const pattern: ASTPattern = {
        type: 'FunctionDeclaration',
        capture: 'function',
        children: [{ type: 'Identifier', capture: 'name' }],
      };
      const results = analyzer.findPattern(ast, pattern);

      expect(results).toHaveLength(1);
      expect(results[0]?.captures.get('function')?.type).toBe('FunctionDeclaration');
      expect(results[0]?.captures.get('name')?.text).toBe('myFunc');
    });

    it('should filter by position constraints', () => {
      const node1 = createNode('Item', 'item1', [], 0, 0, 0, 5);
      const node2 = createNode('Item', 'item2', [], 5, 0, 5, 5);
      const node3 = createNode('Item', 'item3', [], 10, 0, 10, 5);
      const root = createNode('Program', '', [node1, node2, node3], 0, 0, 15, 0);
      const ast = createAST(root);

      const pattern: ASTPattern = { type: 'Item' };
      const results = analyzer.findPattern(ast, pattern, {
        startPosition: { row: 3, column: 0 },
        endPosition: { row: 8, column: 0 },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.node.text).toBe('item2');
    });
  });

  describe('compareSubtrees', () => {
    it('should identify identical subtrees', () => {
      const node1 = createNode('Type', 'text', [
        createNode('Child', 'child1'),
        createNode('Child', 'child2'),
      ]);
      const node2 = createNode('Type', 'text', [
        createNode('Child', 'child1'),
        createNode('Child', 'child2'),
      ]);

      const result = analyzer.compareSubtrees(node1, node2);

      expect(result.isIdentical).toBe(true);
      expect(result.similarity).toBe(1);
      expect(result.differences).toHaveLength(0);
    });

    it('should detect type mismatches', () => {
      const node1 = createNode('TypeA', 'text');
      const node2 = createNode('TypeB', 'text');

      const result = analyzer.compareSubtrees(node1, node2);

      expect(result.isIdentical).toBe(false);
      expect(result.similarity).toBeLessThan(1);
      expect(result.differences.some((d) => d.type === 'type_mismatch')).toBe(true);
    });

    it('should detect text mismatches', () => {
      const node1 = createNode('Type', 'text1');
      const node2 = createNode('Type', 'text2');

      const result = analyzer.compareSubtrees(node1, node2);

      expect(result.isIdentical).toBe(false);
      expect(result.differences.some((d) => d.type === 'text_mismatch')).toBe(true);
    });

    it('should ignore text when option is set', () => {
      const node1 = createNode('Type', 'text1');
      const node2 = createNode('Type', 'text2');

      const result = analyzer.compareSubtrees(node1, node2, { ignoreText: true });

      expect(result.isIdentical).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it('should detect children count differences', () => {
      const node1 = createNode('Type', 'text', [
        createNode('Child', 'c1'),
        createNode('Child', 'c2'),
      ]);
      const node2 = createNode('Type', 'text', [createNode('Child', 'c1')]);

      const result = analyzer.compareSubtrees(node1, node2);

      expect(result.isIdentical).toBe(false);
      expect(result.differences.some((d) => d.type === 'children_count')).toBe(true);
    });

    it('should ignore specified node types', () => {
      const node1 = createNode('Type', 'text', [createNode('Comment', '// comment')]);
      const node2 = createNode('Type', 'text', [createNode('Comment', '// different')]);

      const result = analyzer.compareSubtrees(node1, node2, { ignoreTypes: ['Comment'] });

      expect(result.similarity).toBe(1);
    });

    it('should respect maxDepth option', () => {
      const deep1 = createNode('Deep', 'different1');
      const deep2 = createNode('Deep', 'different2');
      const node1 = createNode('Type', 'text', [createNode('Child', 'child', [deep1])]);
      const node2 = createNode('Type', 'text', [createNode('Child', 'child', [deep2])]);

      const result = analyzer.compareSubtrees(node1, node2, { maxDepth: 1 });

      // Should not compare deep nodes
      expect(result.differences.filter((d) => d.type === 'text_mismatch')).toHaveLength(0);
    });

    it('should track comparison statistics', () => {
      const node1 = createNode('Type', 'text', [
        createNode('Child', 'c1'),
        createNode('Child', 'c2'),
      ]);
      const node2 = createNode('Type', 'text', [
        createNode('Child', 'c1'),
        createNode('Child', 'c2'),
      ]);

      const result = analyzer.compareSubtrees(node1, node2);

      expect(result.stats.nodesCompared).toBe(3);
      expect(result.stats.matchingNodes).toBe(3);
      expect(result.stats.differentNodes).toBe(0);
    });
  });

  describe('analyze', () => {
    it('should analyze AST with multiple patterns', () => {
      const func = createNode('FunctionDeclaration', 'function foo() {}');
      const cls = createNode('ClassDeclaration', 'class Bar {}');
      const root = createNode('Program', '', [func, cls]);
      const ast = createAST(root);

      const patterns = new Map<string, ASTPattern>([
        ['functions', { type: 'FunctionDeclaration' }],
        ['classes', { type: 'ClassDeclaration' }],
      ]);

      const result = analyzer.analyze(ast, patterns);

      expect(result.matches).toHaveLength(2);
      expect(result.matches.some((m) => m.patternId === 'functions')).toBe(true);
      expect(result.matches.some((m) => m.patternId === 'classes')).toBe(true);
      expect(result.stats.nodeCount).toBe(3);
    });

    it('should return empty matches for no patterns', () => {
      const root = createNode('Program', '');
      const ast = createAST(root);

      const result = analyzer.analyze(ast, new Map());

      expect(result.matches).toHaveLength(0);
      expect(result.stats.nodeCount).toBe(1);
    });
  });
});
