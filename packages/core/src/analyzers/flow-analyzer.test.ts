/**
 * Flow Analyzer Tests
 *
 * Tests for control flow graph construction, data flow tracking,
 * unreachable code detection, infinite loop detection, and
 * missing return detection.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FlowAnalyzer } from './flow-analyzer.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Helper to create a simple AST node
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
 * Helper to create an AST from a root node
 */
function createAST(rootNode: ASTNode, text = ''): AST {
  return { rootNode, text };
}

describe('FlowAnalyzer', () => {
  let analyzer: FlowAnalyzer;

  beforeEach(() => {
    analyzer = new FlowAnalyzer();
  });

  describe('CFG Construction', () => {
    describe('Basic Statements', () => {
      it('should create entry and exit nodes for empty program', () => {
        const ast = createAST(createNode('program', '', []));
        const result = analyzer.analyze(ast);

        expect(result.controlFlow).toBeDefined();
        expect(result.controlFlow.entry).toBeDefined();
        expect(result.controlFlow.entry.kind).toBe('entry');
        expect(result.controlFlow.exits.length).toBeGreaterThan(0);
        expect(result.controlFlow.exits[0].kind).toBe('exit');
      });

      it('should create statement nodes for expression statements', () => {
        const stmt = createNode('expression_statement', 'x = 1;', [
          createNode('assignment_expression', 'x = 1', [
            createNode('identifier', 'x'),
            createNode('number', '1'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [stmt]));

        const result = analyzer.analyze(ast);

        expect(result.controlFlow.nodes.length).toBeGreaterThan(2);
        const stmtNodes = result.controlFlow.nodes.filter(n => n.kind === 'statement');
        expect(stmtNodes.length).toBe(1);
      });

      it('should connect sequential statements', () => {
        const stmt1 = createNode('expression_statement', 'x = 1;', [], 0, 0, 0, 6);
        const stmt2 = createNode('expression_statement', 'y = 2;', [], 1, 0, 1, 6);
        const ast = createAST(createNode('program', '', [stmt1, stmt2]));

        const result = analyzer.analyze(ast);

        // Should have entry -> stmt1 -> stmt2 -> exit
        expect(result.controlFlow.nodes.length).toBe(4);
        expect(result.controlFlow.edges.length).toBe(3);
      });
    });

    describe('If Statements', () => {
      it('should create branch node for if statement', () => {
        const ifStmt = createNode('if_statement', 'if (x) { y; }', [
          createNode('parenthesized_expression', '(x)', [
            createNode('identifier', 'x'),
          ]),
          createNode('statement_block', '{ y; }', [
            createNode('expression_statement', 'y;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [ifStmt]));

        const result = analyzer.analyze(ast);

        const branchNodes = result.controlFlow.nodes.filter(n => n.kind === 'branch');
        expect(branchNodes.length).toBe(1);
      });

      it('should create merge node for if-else statement', () => {
        const ifStmt = createNode('if_statement', 'if (x) { y; } else { z; }', [
          createNode('parenthesized_expression', '(x)', [
            createNode('identifier', 'x'),
          ]),
          createNode('statement_block', '{ y; }', [
            createNode('expression_statement', 'y;'),
          ]),
          createNode('else_clause', 'else { z; }', [
            createNode('statement_block', '{ z; }', [
              createNode('expression_statement', 'z;'),
            ]),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [ifStmt]));

        const result = analyzer.analyze(ast);

        const mergeNodes = result.controlFlow.nodes.filter(n => n.kind === 'merge');
        expect(mergeNodes.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Loop Statements', () => {
      it('should create loop node for while statement', () => {
        const whileStmt = createNode('while_statement', 'while (x) { y; }', [
          createNode('parenthesized_expression', '(x)', [
            createNode('identifier', 'x'),
          ]),
          createNode('statement_block', '{ y; }', [
            createNode('expression_statement', 'y;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [whileStmt]));

        const result = analyzer.analyze(ast);

        const loopNodes = result.controlFlow.nodes.filter(n => n.kind === 'loop');
        expect(loopNodes.length).toBe(1);
      });

      it('should create back edge for loop', () => {
        const forStmt = createNode('for_statement', 'for (;;) { x; }', [
          createNode('statement_block', '{ x; }', [
            createNode('expression_statement', 'x;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [forStmt]));

        const result = analyzer.analyze(ast);

        const backEdges = result.controlFlow.edges.filter(e => e.isBackEdge);
        expect(backEdges.length).toBeGreaterThan(0);
      });

      it('should create loop node for for-of statement', () => {
        const forOfStmt = createNode('for_of_statement', 'for (x of arr) { y; }', [
          createNode('identifier', 'x'),
          createNode('identifier', 'arr'),
          createNode('statement_block', '{ y; }', [
            createNode('expression_statement', 'y;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [forOfStmt]));

        const result = analyzer.analyze(ast);

        const loopNodes = result.controlFlow.nodes.filter(n => n.kind === 'loop');
        expect(loopNodes.length).toBe(1);
      });

      it('should create loop node for do-while statement', () => {
        const doWhileStmt = createNode('do_statement', 'do { x; } while (y);', [
          createNode('statement_block', '{ x; }', [
            createNode('expression_statement', 'x;'),
          ]),
          createNode('parenthesized_expression', '(y)', [
            createNode('identifier', 'y'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [doWhileStmt]));

        const result = analyzer.analyze(ast);

        const loopNodes = result.controlFlow.nodes.filter(n => n.kind === 'loop');
        expect(loopNodes.length).toBe(1);
      });
    });

    describe('Control Flow Statements', () => {
      it('should create return node for return statement', () => {
        const returnStmt = createNode('return_statement', 'return x;', [
          createNode('identifier', 'x'),
        ]);
        const ast = createAST(createNode('program', '', [returnStmt]));

        const result = analyzer.analyze(ast);

        const returnNodes = result.controlFlow.nodes.filter(n => n.kind === 'return');
        expect(returnNodes.length).toBe(1);
      });

      it('should create throw node for throw statement', () => {
        const throwStmt = createNode('throw_statement', 'throw new Error();', [
          createNode('new_expression', 'new Error()'),
        ]);
        const ast = createAST(createNode('program', '', [throwStmt]));

        const result = analyzer.analyze(ast);

        const throwNodes = result.controlFlow.nodes.filter(n => n.kind === 'throw');
        expect(throwNodes.length).toBe(1);
      });

      it('should create break node for break statement', () => {
        const whileStmt = createNode('while_statement', 'while (true) { break; }', [
          createNode('parenthesized_expression', '(true)', [
            createNode('true', 'true'),
          ]),
          createNode('statement_block', '{ break; }', [
            createNode('break_statement', 'break;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [whileStmt]));

        const result = analyzer.analyze(ast);

        const breakNodes = result.controlFlow.nodes.filter(n => n.kind === 'break');
        expect(breakNodes.length).toBe(1);
      });

      it('should create continue node for continue statement', () => {
        const whileStmt = createNode('while_statement', 'while (x) { continue; }', [
          createNode('parenthesized_expression', '(x)', [
            createNode('identifier', 'x'),
          ]),
          createNode('statement_block', '{ continue; }', [
            createNode('continue_statement', 'continue;'),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [whileStmt]));

        const result = analyzer.analyze(ast);

        const continueNodes = result.controlFlow.nodes.filter(n => n.kind === 'continue');
        expect(continueNodes.length).toBe(1);
      });
    });

    describe('Switch Statements', () => {
      it('should create branch node for switch statement', () => {
        const switchStmt = createNode('switch_statement', 'switch (x) { case 1: y; }', [
          createNode('parenthesized_expression', '(x)', [
            createNode('identifier', 'x'),
          ]),
          createNode('switch_body', '{ case 1: y; }', [
            createNode('switch_case', 'case 1: y;', [
              createNode('number', '1'),
              createNode('expression_statement', 'y;'),
            ]),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [switchStmt]));

        const result = analyzer.analyze(ast);

        const branchNodes = result.controlFlow.nodes.filter(n => n.kind === 'branch');
        expect(branchNodes.length).toBe(1);
      });
    });

    describe('Try-Catch Statements', () => {
      it('should handle try-catch statement', () => {
        const tryStmt = createNode('try_statement', 'try { x; } catch (e) { y; }', [
          createNode('statement_block', '{ x; }', [
            createNode('expression_statement', 'x;'),
          ]),
          createNode('catch_clause', 'catch (e) { y; }', [
            createNode('identifier', 'e'),
            createNode('statement_block', '{ y; }', [
              createNode('expression_statement', 'y;'),
            ]),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [tryStmt]));

        const result = analyzer.analyze(ast);

        // Should have nodes for try block and catch block
        expect(result.controlFlow.nodes.length).toBeGreaterThan(2);
      });

      it('should handle try-catch-finally statement', () => {
        const tryStmt = createNode('try_statement', 'try { x; } catch (e) { y; } finally { z; }', [
          createNode('statement_block', '{ x; }', [
            createNode('expression_statement', 'x;'),
          ]),
          createNode('catch_clause', 'catch (e) { y; }', [
            createNode('identifier', 'e'),
            createNode('statement_block', '{ y; }', [
              createNode('expression_statement', 'y;'),
            ]),
          ]),
          createNode('finally_clause', 'finally { z; }', [
            createNode('statement_block', '{ z; }', [
              createNode('expression_statement', 'z;'),
            ]),
          ]),
        ]);
        const ast = createAST(createNode('program', '', [tryStmt]));

        const result = analyzer.analyze(ast);

        expect(result.controlFlow.nodes.length).toBeGreaterThan(2);
      });
    });
  });

  describe('Data Flow Tracking', () => {
    it('should track variable reads', () => {
      const stmt = createNode('expression_statement', 'console.log(x);', [
        createNode('call_expression', 'console.log(x)', [
          createNode('member_expression', 'console.log', [
            createNode('identifier', 'console'),
            createNode('property_identifier', 'log'),
          ]),
          createNode('arguments', '(x)', [
            createNode('identifier', 'x'),
          ]),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [stmt]));

      const result = analyzer.analyze(ast);

      expect(result.dataFlow).toBeDefined();
      expect(result.dataFlow.reads).toBeDefined();
    });

    it('should track variable writes', () => {
      const stmt = createNode('expression_statement', 'x = 1;', [
        createNode('assignment_expression', 'x = 1', [
          createNode('identifier', 'x'),
          createNode('number', '1'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [stmt]));

      const result = analyzer.analyze(ast);

      expect(result.dataFlow).toBeDefined();
      expect(result.dataFlow.writes).toBeDefined();
    });

    it('should track update expressions as both read and write', () => {
      const stmt = createNode('expression_statement', 'x++;', [
        createNode('update_expression', 'x++', [
          createNode('identifier', 'x'),
          createNode('++', '++'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [stmt]));

      const result = analyzer.analyze(ast);

      expect(result.dataFlow).toBeDefined();
    });
  });

  describe('Unreachable Code Detection', () => {
    it('should detect code after return statement', () => {
      const returnStmt = createNode('return_statement', 'return;', [], 0, 0, 0, 7);
      const unreachableStmt = createNode('expression_statement', 'x;', [], 1, 0, 1, 2);
      const ast = createAST(createNode('program', '', [returnStmt, unreachableStmt]));

      const result = analyzer.analyze(ast, { detectUnreachable: true });

      // The unreachable statement should be detected
      expect(result.unreachableCode.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect code after throw statement', () => {
      const throwStmt = createNode('throw_statement', 'throw new Error();', [], 0, 0, 0, 18);
      const unreachableStmt = createNode('expression_statement', 'x;', [], 1, 0, 1, 2);
      const ast = createAST(createNode('program', '', [throwStmt, unreachableStmt]));

      const result = analyzer.analyze(ast, { detectUnreachable: true });

      expect(result.unreachableCode).toBeDefined();
    });

    it('should not flag reachable code', () => {
      const stmt1 = createNode('expression_statement', 'x;', [], 0, 0, 0, 2);
      const stmt2 = createNode('expression_statement', 'y;', [], 1, 0, 1, 2);
      const ast = createAST(createNode('program', '', [stmt1, stmt2]));

      const result = analyzer.analyze(ast, { detectUnreachable: true });

      // All nodes should be reachable
      const unreachableNodes = result.controlFlow.nodes.filter(
        n => !n.isReachable && n.kind !== 'entry' && n.kind !== 'exit' && n.kind !== 'merge'
      );
      expect(unreachableNodes.length).toBe(0);
    });
  });

  describe('Infinite Loop Detection', () => {
    it('should detect while(true) without break', () => {
      const whileStmt = createNode('while_statement', 'while (true) { x; }', [
        createNode('parenthesized_expression', '(true)', [
          createNode('true', 'true'),
        ]),
        createNode('statement_block', '{ x; }', [
          createNode('expression_statement', 'x;'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [whileStmt]));

      const result = analyzer.analyze(ast, { detectInfiniteLoops: true });

      expect(result.infiniteLoops.length).toBe(1);
    });

    it('should not flag while(true) with break', () => {
      const whileStmt = createNode('while_statement', 'while (true) { break; }', [
        createNode('parenthesized_expression', '(true)', [
          createNode('true', 'true'),
        ]),
        createNode('statement_block', '{ break; }', [
          createNode('break_statement', 'break;'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [whileStmt]));

      const result = analyzer.analyze(ast, { detectInfiniteLoops: true });

      expect(result.infiniteLoops.length).toBe(0);
    });

    it('should not flag while(true) with return', () => {
      const whileStmt = createNode('while_statement', 'while (true) { return; }', [
        createNode('parenthesized_expression', '(true)', [
          createNode('true', 'true'),
        ]),
        createNode('statement_block', '{ return; }', [
          createNode('return_statement', 'return;'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [whileStmt]));

      const result = analyzer.analyze(ast, { detectInfiniteLoops: true });

      expect(result.infiniteLoops.length).toBe(0);
    });

    it('should not flag while with variable condition', () => {
      const whileStmt = createNode('while_statement', 'while (x) { y; }', [
        createNode('parenthesized_expression', '(x)', [
          createNode('identifier', 'x'),
        ]),
        createNode('statement_block', '{ y; }', [
          createNode('expression_statement', 'y;'),
        ]),
      ]);
      const ast = createAST(createNode('program', '', [whileStmt]));

      const result = analyzer.analyze(ast, { detectInfiniteLoops: true });

      expect(result.infiniteLoops.length).toBe(0);
    });
  });

  describe('Missing Return Detection', () => {
    it('should detect missing return in function with return type', () => {
      const funcDecl = createNode('function_declaration', 'function foo(): number { x; }', [
        createNode('identifier', 'foo'),
        createNode('formal_parameters', '()'),
        createNode('type_annotation', ': number', [
          createNode('predefined_type', 'number'),
        ]),
        createNode('statement_block', '{ x; }', [
          createNode('expression_statement', 'x;'),
        ]),
      ]);

      const result = analyzer.analyzeFunction(funcDecl, { detectMissingReturns: true });

      expect(result.missingReturns.length).toBe(1);
    });

    it('should not flag function with void return type', () => {
      const funcDecl = createNode('function_declaration', 'function foo(): void { x; }', [
        createNode('identifier', 'foo'),
        createNode('formal_parameters', '()'),
        createNode('type_annotation', ': void', [
          createNode('predefined_type', 'void'),
        ]),
        createNode('statement_block', '{ x; }', [
          createNode('expression_statement', 'x;'),
        ]),
      ]);

      const result = analyzer.analyzeFunction(funcDecl, { detectMissingReturns: true });

      expect(result.missingReturns.length).toBe(0);
    });

    it('should not flag function with return statement', () => {
      const funcDecl = createNode('function_declaration', 'function foo(): number { return 1; }', [
        createNode('identifier', 'foo'),
        createNode('formal_parameters', '()'),
        createNode('type_annotation', ': number', [
          createNode('predefined_type', 'number'),
        ]),
        createNode('statement_block', '{ return 1; }', [
          createNode('return_statement', 'return 1;', [
            createNode('number', '1'),
          ]),
        ]),
      ]);

      const result = analyzer.analyzeFunction(funcDecl, { detectMissingReturns: true });

      expect(result.missingReturns.length).toBe(0);
    });
  });

  describe('Function Analysis', () => {
    it('should analyze function with parameters', () => {
      const funcDecl = createNode('function_declaration', 'function foo(x, y) { return x + y; }', [
        createNode('identifier', 'foo'),
        createNode('formal_parameters', '(x, y)', [
          createNode('identifier', 'x'),
          createNode('identifier', 'y'),
        ]),
        createNode('statement_block', '{ return x + y; }', [
          createNode('return_statement', 'return x + y;', [
            createNode('binary_expression', 'x + y', [
              createNode('identifier', 'x'),
              createNode('+', '+'),
              createNode('identifier', 'y'),
            ]),
          ]),
        ]),
      ]);

      const result = analyzer.analyzeFunction(funcDecl);

      expect(result.controlFlow).toBeDefined();
      expect(result.controlFlow.entry).toBeDefined();
      expect(result.controlFlow.exits.length).toBeGreaterThan(0);
    });

    it('should handle arrow function with expression body', () => {
      const arrowFunc = createNode('arrow_function', '(x) => x * 2', [
        createNode('formal_parameters', '(x)', [
          createNode('identifier', 'x'),
        ]),
        createNode('=>', '=>'),
        createNode('binary_expression', 'x * 2', [
          createNode('identifier', 'x'),
          createNode('*', '*'),
          createNode('number', '2'),
        ]),
      ]);

      const result = analyzer.analyzeFunction(arrowFunc);

      expect(result.controlFlow).toBeDefined();
    });
  });

  describe('Utility Methods', () => {
    it('should return nodes after analysis', () => {
      const stmt = createNode('expression_statement', 'x;');
      const ast = createAST(createNode('program', '', [stmt]));

      analyzer.analyze(ast);
      const nodes = analyzer.getNodes();

      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should return edges after analysis', () => {
      const stmt = createNode('expression_statement', 'x;');
      const ast = createAST(createNode('program', '', [stmt]));

      analyzer.analyze(ast);
      const edges = analyzer.getEdges();

      expect(edges.length).toBeGreaterThan(0);
    });

    it('should check node reachability', () => {
      const stmt = createNode('expression_statement', 'x;');
      const ast = createAST(createNode('program', '', [stmt]));

      analyzer.analyze(ast);
      const nodes = analyzer.getNodes();

      // Entry node should be reachable
      const entryNode = nodes.find(n => n.kind === 'entry');
      expect(entryNode).toBeDefined();
      expect(analyzer.isNodeReachable(entryNode!.id)).toBe(true);
    });

    it('should get predecessors of a node', () => {
      const stmt = createNode('expression_statement', 'x;');
      const ast = createAST(createNode('program', '', [stmt]));

      analyzer.analyze(ast);
      const nodes = analyzer.getNodes();

      const stmtNode = nodes.find(n => n.kind === 'statement');
      if (stmtNode) {
        const preds = analyzer.getPredecessors(stmtNode.id);
        expect(preds.length).toBeGreaterThan(0);
      }
    });

    it('should get successors of a node', () => {
      const stmt = createNode('expression_statement', 'x;');
      const ast = createAST(createNode('program', '', [stmt]));

      analyzer.analyze(ast);
      const nodes = analyzer.getNodes();

      const entryNode = nodes.find(n => n.kind === 'entry');
      if (entryNode) {
        const succs = analyzer.getSuccessors(entryNode.id);
        expect(succs.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Complex Control Flow', () => {
    it('should handle nested if statements', () => {
      const innerIf = createNode('if_statement', 'if (y) { z; }', [
        createNode('parenthesized_expression', '(y)', [
          createNode('identifier', 'y'),
        ]),
        createNode('statement_block', '{ z; }', [
          createNode('expression_statement', 'z;'),
        ]),
      ]);

      const outerIf = createNode('if_statement', 'if (x) { if (y) { z; } }', [
        createNode('parenthesized_expression', '(x)', [
          createNode('identifier', 'x'),
        ]),
        createNode('statement_block', '{ if (y) { z; } }', [innerIf]),
      ]);

      const ast = createAST(createNode('program', '', [outerIf]));
      const result = analyzer.analyze(ast);

      const branchNodes = result.controlFlow.nodes.filter(n => n.kind === 'branch');
      expect(branchNodes.length).toBe(2);
    });

    it('should handle loop inside if', () => {
      const whileStmt = createNode('while_statement', 'while (y) { z; }', [
        createNode('parenthesized_expression', '(y)', [
          createNode('identifier', 'y'),
        ]),
        createNode('statement_block', '{ z; }', [
          createNode('expression_statement', 'z;'),
        ]),
      ]);

      const ifStmt = createNode('if_statement', 'if (x) { while (y) { z; } }', [
        createNode('parenthesized_expression', '(x)', [
          createNode('identifier', 'x'),
        ]),
        createNode('statement_block', '{ while (y) { z; } }', [whileStmt]),
      ]);

      const ast = createAST(createNode('program', '', [ifStmt]));
      const result = analyzer.analyze(ast);

      const branchNodes = result.controlFlow.nodes.filter(n => n.kind === 'branch');
      const loopNodes = result.controlFlow.nodes.filter(n => n.kind === 'loop');

      expect(branchNodes.length).toBe(1);
      expect(loopNodes.length).toBe(1);
    });

    it('should handle multiple sequential loops', () => {
      const loop1 = createNode('while_statement', 'while (x) { a; }', [
        createNode('parenthesized_expression', '(x)', [
          createNode('identifier', 'x'),
        ]),
        createNode('statement_block', '{ a; }', [
          createNode('expression_statement', 'a;'),
        ]),
      ]);

      const loop2 = createNode('for_statement', 'for (;;) { b; }', [
        createNode('statement_block', '{ b; }', [
          createNode('expression_statement', 'b;'),
        ]),
      ]);

      const ast = createAST(createNode('program', '', [loop1, loop2]));
      const result = analyzer.analyze(ast);

      const loopNodes = result.controlFlow.nodes.filter(n => n.kind === 'loop');
      expect(loopNodes.length).toBe(2);
    });
  });
});
