/**
 * Semantic Analyzer Tests
 *
 * Tests for symbol resolution, scope analysis, detection of unresolved
 * references, and detection of shadowed variables.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticAnalyzer } from './semantic-analyzer.js';
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

describe('SemanticAnalyzer', () => {
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    analyzer = new SemanticAnalyzer();
  });

  describe('analyze', () => {
    it('should create global scope for empty program', () => {
      const root = createNode('program', '', [], 0, 0, 10, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast);

      expect(result.scopes).toHaveLength(1);
      expect(result.scopes[0]?.kind).toBe('global');
      expect(result.scopes[0]?.depth).toBe(0);
      expect(result.scopes[0]?.parentId).toBeNull();
    });

    it('should include built-in symbols by default', () => {
      const root = createNode('program', '', [], 0, 0, 10, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast);

      // Check that some built-in symbols are present
      const symbolNames = Array.from(result.symbols.values()).map((s) => s.name);
      expect(symbolNames).toContain('console');
      expect(symbolNames).toContain('Object');
      expect(symbolNames).toContain('Array');
    });

    it('should exclude built-in symbols when option is false', () => {
      const root = createNode('program', '', [], 0, 0, 10, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      expect(result.symbols.size).toBe(0);
    });
  });

  describe('symbol resolution - variables', () => {
    it('should collect variable declarations', () => {
      const identifier = createNode('identifier', 'myVar', [], 0, 6, 0, 11);
      const declarator = createNode('variable_declarator', 'myVar = 1', [identifier], 0, 6, 0, 15);
      const declaration = createNode('variable_declaration', 'const myVar = 1', [declarator], 0, 0, 0, 15);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const myVarSymbol = symbols.find((s) => s.name === 'myVar');
      expect(myVarSymbol).toBeDefined();
      expect(myVarSymbol?.kind).toBe('variable');
    });

    it('should collect multiple variable declarations', () => {
      const id1 = createNode('identifier', 'a', [], 0, 6, 0, 7);
      const id2 = createNode('identifier', 'b', [], 0, 13, 0, 14);
      const decl1 = createNode('variable_declarator', 'a = 1', [id1], 0, 6, 0, 11);
      const decl2 = createNode('variable_declarator', 'b = 2', [id2], 0, 13, 0, 18);
      const declaration = createNode('variable_declaration', 'const a = 1, b = 2', [decl1, decl2], 0, 0, 0, 18);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'a')).toBeDefined();
      expect(symbols.find((s) => s.name === 'b')).toBeDefined();
    });

    it('should handle object destructuring', () => {
      const shorthand = createNode('shorthand_property_identifier_pattern', 'x', [], 0, 8, 0, 9);
      const pattern = createNode('object_pattern', '{ x }', [shorthand], 0, 6, 0, 11);
      const declarator = createNode('variable_declarator', '{ x } = obj', [pattern], 0, 6, 0, 17);
      const declaration = createNode('variable_declaration', 'const { x } = obj', [declarator], 0, 0, 0, 17);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'x')).toBeDefined();
    });

    it('should handle array destructuring', () => {
      const id1 = createNode('identifier', 'first', [], 0, 7, 0, 12);
      const id2 = createNode('identifier', 'second', [], 0, 14, 0, 20);
      const pattern = createNode('array_pattern', '[first, second]', [id1, id2], 0, 6, 0, 21);
      const declarator = createNode('variable_declarator', '[first, second] = arr', [pattern], 0, 6, 0, 27);
      const declaration = createNode('variable_declaration', 'const [first, second] = arr', [declarator], 0, 0, 0, 27);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'first')).toBeDefined();
      expect(symbols.find((s) => s.name === 'second')).toBeDefined();
    });
  });

  describe('symbol resolution - functions', () => {
    it('should collect function declarations', () => {
      const funcName = createNode('identifier', 'myFunc', [], 0, 9, 0, 15);
      const params = createNode('formal_parameters', '()', [], 0, 15, 0, 17);
      const body = createNode('statement_block', '{}', [], 0, 18, 0, 20);
      const funcDecl = createNode('function_declaration', 'function myFunc() {}', [funcName, params, body], 0, 0, 0, 20);
      const root = createNode('program', '', [funcDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const funcSymbol = symbols.find((s) => s.name === 'myFunc');
      expect(funcSymbol).toBeDefined();
      expect(funcSymbol?.kind).toBe('function');
    });

    it('should collect function parameters', () => {
      const funcName = createNode('identifier', 'add', [], 0, 9, 0, 12);
      const param1 = createNode('identifier', 'a', [], 0, 13, 0, 14);
      const param2 = createNode('identifier', 'b', [], 0, 16, 0, 17);
      const params = createNode('formal_parameters', '(a, b)', [param1, param2], 0, 12, 0, 18);
      const body = createNode('statement_block', '{ return a + b; }', [], 0, 19, 0, 36);
      const funcDecl = createNode('function_declaration', 'function add(a, b) { return a + b; }', [funcName, params, body], 0, 0, 0, 36);
      const root = createNode('program', '', [funcDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'a' && s.kind === 'parameter')).toBeDefined();
      expect(symbols.find((s) => s.name === 'b' && s.kind === 'parameter')).toBeDefined();
    });

    it('should create function scope', () => {
      const funcName = createNode('identifier', 'myFunc', [], 0, 9, 0, 15);
      const params = createNode('formal_parameters', '()', [], 0, 15, 0, 17);
      const body = createNode('statement_block', '{}', [], 0, 18, 2, 1);
      const funcDecl = createNode('function_declaration', 'function myFunc() {}', [funcName, params, body], 0, 0, 2, 1);
      const root = createNode('program', '', [funcDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const functionScopes = result.scopes.filter((s) => s.kind === 'function');
      expect(functionScopes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle arrow functions', () => {
      const param = createNode('identifier', 'x', [], 0, 1, 0, 2);
      const params = createNode('formal_parameters', '(x)', [param], 0, 0, 0, 3);
      const body = createNode('statement_block', '{ return x * 2; }', [], 0, 7, 0, 24);
      const arrow = createNode('arrow_function', '(x) => { return x * 2; }', [params, body], 0, 0, 0, 24);
      const root = createNode('program', '', [arrow], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'x' && s.kind === 'parameter')).toBeDefined();
    });
  });

  describe('symbol resolution - classes', () => {
    it('should collect class declarations', () => {
      const className = createNode('type_identifier', 'MyClass', [], 0, 6, 0, 13);
      const classBody = createNode('class_body', '{}', [], 0, 14, 0, 16);
      const classDecl = createNode('class_declaration', 'class MyClass {}', [className, classBody], 0, 0, 0, 16);
      const root = createNode('program', '', [classDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const classSymbol = symbols.find((s) => s.name === 'MyClass');
      expect(classSymbol).toBeDefined();
      expect(classSymbol?.kind).toBe('class');
    });

    it('should create class scope', () => {
      const className = createNode('type_identifier', 'MyClass', [], 0, 6, 0, 13);
      const classBody = createNode('class_body', '{}', [], 0, 14, 2, 1);
      const classDecl = createNode('class_declaration', 'class MyClass {}', [className, classBody], 0, 0, 2, 1);
      const root = createNode('program', '', [classDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const classScopes = result.scopes.filter((s) => s.kind === 'class');
      expect(classScopes.length).toBeGreaterThanOrEqual(1);
    });

    it('should collect class methods', () => {
      const methodName = createNode('property_identifier', 'doSomething', [], 1, 2, 1, 13);
      const params = createNode('formal_parameters', '()', [], 1, 13, 1, 15);
      const body = createNode('statement_block', '{}', [], 1, 16, 1, 18);
      const method = createNode('method_definition', 'doSomething() {}', [methodName, params, body], 1, 2, 1, 18);
      const classBody = createNode('class_body', '{ doSomething() {} }', [method], 0, 14, 2, 1);
      const className = createNode('type_identifier', 'MyClass', [], 0, 6, 0, 13);
      const classDecl = createNode('class_declaration', 'class MyClass { doSomething() {} }', [className, classBody], 0, 0, 2, 1);
      const root = createNode('program', '', [classDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const methodSymbol = symbols.find((s) => s.name === 'doSomething');
      expect(methodSymbol).toBeDefined();
      expect(methodSymbol?.kind).toBe('method');
    });

    it('should collect class fields', () => {
      const fieldName = createNode('property_identifier', 'myField', [], 1, 2, 1, 9);
      const field = createNode('public_field_definition', 'myField = 0', [fieldName], 1, 2, 1, 13);
      const classBody = createNode('class_body', '{ myField = 0 }', [field], 0, 14, 2, 1);
      const className = createNode('type_identifier', 'MyClass', [], 0, 6, 0, 13);
      const classDecl = createNode('class_declaration', 'class MyClass { myField = 0 }', [className, classBody], 0, 0, 2, 1);
      const root = createNode('program', '', [classDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const fieldSymbol = symbols.find((s) => s.name === 'myField');
      expect(fieldSymbol).toBeDefined();
      expect(fieldSymbol?.kind).toBe('property');
    });
  });

  describe('scope analysis - nested scopes', () => {
    it('should create nested scopes for nested functions', () => {
      // Inner function
      const innerName = createNode('identifier', 'inner', [], 2, 11, 2, 16);
      const innerParams = createNode('formal_parameters', '()', [], 2, 16, 2, 18);
      const innerBody = createNode('statement_block', '{}', [], 2, 19, 2, 21);
      const innerFunc = createNode('function_declaration', 'function inner() {}', [innerName, innerParams, innerBody], 2, 2, 2, 21);

      // Outer function body containing inner function
      const outerBody = createNode('statement_block', '{ function inner() {} }', [innerFunc], 1, 18, 3, 1);
      const outerName = createNode('identifier', 'outer', [], 1, 9, 1, 14);
      const outerParams = createNode('formal_parameters', '()', [], 1, 14, 1, 16);
      const outerFunc = createNode('function_declaration', 'function outer() { function inner() {} }', [outerName, outerParams, outerBody], 1, 0, 3, 1);

      const root = createNode('program', '', [outerFunc], 0, 0, 4, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      // Should have global scope + outer function scope + inner function scope
      const functionScopes = result.scopes.filter((s) => s.kind === 'function');
      expect(functionScopes.length).toBeGreaterThanOrEqual(2);

      // Check depth
      const depths = result.scopes.map((s) => s.depth);
      expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
    });

    it('should create block scopes for if statements', () => {
      const blockBody = createNode('statement_block', '{ const x = 1; }', [], 0, 8, 0, 24);
      const ifStmt = createNode('if_statement', 'if (true) { const x = 1; }', [blockBody], 0, 0, 0, 26);
      const root = createNode('program', '', [ifStmt], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const conditionalScopes = result.scopes.filter((s) => s.kind === 'conditional');
      expect(conditionalScopes.length).toBeGreaterThanOrEqual(1);
    });

    it('should create loop scopes for for statements', () => {
      const loopBody = createNode('statement_block', '{}', [], 0, 20, 0, 22);
      const forStmt = createNode('for_statement', 'for (let i = 0; i < 10; i++) {}', [loopBody], 0, 0, 0, 30);
      const root = createNode('program', '', [forStmt], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const loopScopes = result.scopes.filter((s) => s.kind === 'loop');
      expect(loopScopes.length).toBeGreaterThanOrEqual(1);
    });

    it('should create catch scopes for try-catch', () => {
      const catchParam = createNode('identifier', 'error', [], 1, 10, 1, 15);
      const catchBody = createNode('statement_block', '{}', [], 1, 17, 1, 19);
      const catchClause = createNode('catch_clause', 'catch (error) {}', [catchParam, catchBody], 1, 2, 1, 19);
      const tryBody = createNode('statement_block', '{}', [], 0, 4, 0, 6);
      const tryStmt = createNode('try_statement', 'try {} catch (error) {}', [tryBody, catchClause], 0, 0, 1, 19);
      const root = createNode('program', '', [tryStmt], 0, 0, 2, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const catchScopes = result.scopes.filter((s) => s.kind === 'catch');
      expect(catchScopes.length).toBeGreaterThanOrEqual(1);
    });

    it('should create switch scopes', () => {
      const switchBody = createNode('switch_body', '{}', [], 0, 12, 0, 14);
      const switchStmt = createNode('switch_statement', 'switch (x) {}', [switchBody], 0, 0, 0, 14);
      const root = createNode('program', '', [switchStmt], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const switchScopes = result.scopes.filter((s) => s.kind === 'switch');
      expect(switchScopes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detection of shadowed variables', () => {
    it('should detect variable shadowing in nested scope', () => {
      // Outer variable
      const outerId = createNode('identifier', 'x', [], 0, 6, 0, 7);
      const outerDeclarator = createNode('variable_declarator', 'x = 1', [outerId], 0, 6, 0, 11);
      const outerDecl = createNode('variable_declaration', 'const x = 1', [outerDeclarator], 0, 0, 0, 11);

      // Inner variable (shadows outer)
      const innerId = createNode('identifier', 'x', [], 2, 8, 2, 9);
      const innerDeclarator = createNode('variable_declarator', 'x = 2', [innerId], 2, 8, 2, 13);
      const innerDecl = createNode('variable_declaration', 'const x = 2', [innerDeclarator], 2, 2, 2, 13);

      // Function containing inner variable
      const funcBody = createNode('statement_block', '{ const x = 2; }', [innerDecl], 1, 16, 3, 1);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcParams = createNode('formal_parameters', '()', [], 1, 12, 1, 14);
      const funcDecl = createNode('function_declaration', 'function foo() { const x = 2; }', [funcName, funcParams, funcBody], 1, 0, 3, 1);

      const root = createNode('program', '', [outerDecl, funcDecl], 0, 0, 4, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false, detectShadowing: true });

      expect(result.shadowedVariables.length).toBeGreaterThanOrEqual(1);
      const shadowedX = result.shadowedVariables.find((s) => s.name === 'x');
      expect(shadowedX).toBeDefined();
    });

    it('should detect parameter shadowing outer variable', () => {
      // Outer variable
      const outerId = createNode('identifier', 'value', [], 0, 6, 0, 11);
      const outerDeclarator = createNode('variable_declarator', 'value = 1', [outerId], 0, 6, 0, 15);
      const outerDecl = createNode('variable_declaration', 'const value = 1', [outerDeclarator], 0, 0, 0, 15);

      // Function with parameter that shadows outer variable
      const param = createNode('identifier', 'value', [], 1, 13, 1, 18);
      const funcParams = createNode('formal_parameters', '(value)', [param], 1, 12, 1, 19);
      const funcBody = createNode('statement_block', '{}', [], 1, 20, 1, 22);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcDecl = createNode('function_declaration', 'function foo(value) {}', [funcName, funcParams, funcBody], 1, 0, 1, 22);

      const root = createNode('program', '', [outerDecl, funcDecl], 0, 0, 2, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false, detectShadowing: true });

      expect(result.shadowedVariables.length).toBeGreaterThanOrEqual(1);
      const shadowedValue = result.shadowedVariables.find((s) => s.name === 'value');
      expect(shadowedValue).toBeDefined();
    });

    it('should not report shadowing when disabled', () => {
      // Outer variable
      const outerId = createNode('identifier', 'x', [], 0, 6, 0, 7);
      const outerDeclarator = createNode('variable_declarator', 'x = 1', [outerId], 0, 6, 0, 11);
      const outerDecl = createNode('variable_declaration', 'const x = 1', [outerDeclarator], 0, 0, 0, 11);

      // Inner variable (shadows outer)
      const innerId = createNode('identifier', 'x', [], 2, 8, 2, 9);
      const innerDeclarator = createNode('variable_declarator', 'x = 2', [innerId], 2, 8, 2, 13);
      const innerDecl = createNode('variable_declaration', 'const x = 2', [innerDeclarator], 2, 2, 2, 13);

      const funcBody = createNode('statement_block', '{ const x = 2; }', [innerDecl], 1, 16, 3, 1);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcParams = createNode('formal_parameters', '()', [], 1, 12, 1, 14);
      const funcDecl = createNode('function_declaration', 'function foo() { const x = 2; }', [funcName, funcParams, funcBody], 1, 0, 3, 1);

      const root = createNode('program', '', [outerDecl, funcDecl], 0, 0, 4, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false, detectShadowing: false });

      expect(result.shadowedVariables).toHaveLength(0);
    });
  });

  describe('imports and exports', () => {
    it('should collect import declarations', () => {
      const importId = createNode('identifier', 'React', [], 0, 7, 0, 12);
      const importClause = createNode('import_clause', 'React', [importId], 0, 7, 0, 12);
      const importDecl = createNode('import_statement', "import React from 'react'", [importClause], 0, 0, 0, 25);
      const root = createNode('program', '', [importDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const reactSymbol = symbols.find((s) => s.name === 'React');
      expect(reactSymbol).toBeDefined();
      expect(reactSymbol?.isImported).toBe(true);
    });

    it('should collect named imports', () => {
      const useState = createNode('identifier', 'useState', [], 0, 9, 0, 17);
      const useEffect = createNode('identifier', 'useEffect', [], 0, 19, 0, 28);
      const spec1 = createNode('import_specifier', 'useState', [useState], 0, 9, 0, 17);
      const spec2 = createNode('import_specifier', 'useEffect', [useEffect], 0, 19, 0, 28);
      const namedImports = createNode('named_imports', '{ useState, useEffect }', [spec1, spec2], 0, 7, 0, 30);
      const importClause = createNode('import_clause', '{ useState, useEffect }', [namedImports], 0, 7, 0, 30);
      const importDecl = createNode('import_statement', "import { useState, useEffect } from 'react'", [importClause], 0, 0, 0, 43);
      const root = createNode('program', '', [importDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      expect(symbols.find((s) => s.name === 'useState')).toBeDefined();
      expect(symbols.find((s) => s.name === 'useEffect')).toBeDefined();
    });

    it('should collect namespace imports', () => {
      const nsName = createNode('identifier', 'utils', [], 0, 12, 0, 17);
      const nsImport = createNode('namespace_import', '* as utils', [nsName], 0, 7, 0, 17);
      const importClause = createNode('import_clause', '* as utils', [nsImport], 0, 7, 0, 17);
      const importDecl = createNode('import_statement', "import * as utils from './utils'", [importClause], 0, 0, 0, 32);
      const root = createNode('program', '', [importDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const utilsSymbol = symbols.find((s) => s.name === 'utils');
      expect(utilsSymbol).toBeDefined();
      expect(utilsSymbol?.kind).toBe('namespace');
      expect(utilsSymbol?.isImported).toBe(true);
    });

    it('should mark exported functions', () => {
      const funcName = createNode('identifier', 'myFunc', [], 0, 16, 0, 22);
      const params = createNode('formal_parameters', '()', [], 0, 22, 0, 24);
      const body = createNode('statement_block', '{}', [], 0, 25, 0, 27);
      const funcDecl = createNode('function_declaration', 'function myFunc() {}', [funcName, params, body], 0, 7, 0, 27);
      const exportDecl = createNode('export_statement', 'export function myFunc() {}', [funcDecl], 0, 0, 0, 27);
      const root = createNode('program', '', [exportDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const funcSymbol = symbols.find((s) => s.name === 'myFunc');
      expect(funcSymbol).toBeDefined();
      expect(funcSymbol?.isExported).toBe(true);
    });
  });

  describe('TypeScript declarations', () => {
    it('should collect interface declarations', () => {
      const interfaceName = createNode('type_identifier', 'MyInterface', [], 0, 10, 0, 21);
      const interfaceDecl = createNode('interface_declaration', 'interface MyInterface {}', [interfaceName], 0, 0, 0, 24);
      const root = createNode('program', '', [interfaceDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const interfaceSymbol = symbols.find((s) => s.name === 'MyInterface');
      expect(interfaceSymbol).toBeDefined();
      expect(interfaceSymbol?.kind).toBe('interface');
    });

    it('should collect type alias declarations', () => {
      const typeName = createNode('type_identifier', 'MyType', [], 0, 5, 0, 11);
      const typeDecl = createNode('type_alias_declaration', 'type MyType = string', [typeName], 0, 0, 0, 20);
      const root = createNode('program', '', [typeDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const typeSymbol = symbols.find((s) => s.name === 'MyType');
      expect(typeSymbol).toBeDefined();
      expect(typeSymbol?.kind).toBe('type');
    });

    it('should collect enum declarations', () => {
      const enumName = createNode('identifier', 'Status', [], 0, 5, 0, 11);
      const enumBody = createNode('enum_body', '{ Active, Inactive }', [], 0, 12, 0, 32);
      const enumDecl = createNode('enum_declaration', 'enum Status { Active, Inactive }', [enumName, enumBody], 0, 0, 0, 32);
      const root = createNode('program', '', [enumDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const symbols = Array.from(result.symbols.values());
      const enumSymbol = symbols.find((s) => s.name === 'Status');
      expect(enumSymbol).toBeDefined();
      expect(enumSymbol?.kind).toBe('enum');
    });
  });

  describe('resolveSymbol', () => {
    it('should resolve symbol in current scope', () => {
      const id = createNode('identifier', 'myVar', [], 0, 6, 0, 11);
      const declarator = createNode('variable_declarator', 'myVar = 1', [id], 0, 6, 0, 15);
      const declaration = createNode('variable_declaration', 'const myVar = 1', [declarator], 0, 0, 0, 15);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      analyzer.analyze(ast, { includeBuiltins: false });

      const globalScopeId = 'scope_0';
      const resolved = analyzer.resolveSymbol('myVar', globalScopeId);
      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe('myVar');
    });

    it('should resolve symbol from parent scope', () => {
      // Outer variable
      const outerId = createNode('identifier', 'outer', [], 0, 6, 0, 11);
      const outerDeclarator = createNode('variable_declarator', 'outer = 1', [outerId], 0, 6, 0, 15);
      const outerDecl = createNode('variable_declaration', 'const outer = 1', [outerDeclarator], 0, 0, 0, 15);

      // Function (creates new scope)
      const funcBody = createNode('statement_block', '{}', [], 1, 16, 1, 18);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcParams = createNode('formal_parameters', '()', [], 1, 12, 1, 14);
      const funcDecl = createNode('function_declaration', 'function foo() {}', [funcName, funcParams, funcBody], 1, 0, 1, 18);

      const root = createNode('program', '', [outerDecl, funcDecl], 0, 0, 2, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      // Find the function scope
      const funcScope = result.scopes.find((s) => s.kind === 'function');
      expect(funcScope).toBeDefined();

      // Should be able to resolve 'outer' from function scope
      const resolved = analyzer.resolveSymbol('outer', funcScope!.id);
      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe('outer');
    });

    it('should return null for unresolved symbol', () => {
      const root = createNode('program', '', [], 0, 0, 1, 0);
      const ast = createAST(root);

      analyzer.analyze(ast, { includeBuiltins: false });

      const resolved = analyzer.resolveSymbol('nonexistent', 'scope_0');
      expect(resolved).toBeNull();
    });
  });

  describe('getVisibleSymbols', () => {
    it('should return all visible symbols from scope chain', () => {
      // Outer variable
      const outerId = createNode('identifier', 'outer', [], 0, 6, 0, 11);
      const outerDeclarator = createNode('variable_declarator', 'outer = 1', [outerId], 0, 6, 0, 15);
      const outerDecl = createNode('variable_declaration', 'const outer = 1', [outerDeclarator], 0, 0, 0, 15);

      // Inner variable in function
      const innerId = createNode('identifier', 'inner', [], 2, 8, 2, 13);
      const innerDeclarator = createNode('variable_declarator', 'inner = 2', [innerId], 2, 8, 2, 17);
      const innerDecl = createNode('variable_declaration', 'const inner = 2', [innerDeclarator], 2, 2, 2, 17);

      const funcBody = createNode('statement_block', '{ const inner = 2; }', [innerDecl], 1, 16, 3, 1);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcParams = createNode('formal_parameters', '()', [], 1, 12, 1, 14);
      const funcDecl = createNode('function_declaration', 'function foo() { const inner = 2; }', [funcName, funcParams, funcBody], 1, 0, 3, 1);

      const root = createNode('program', '', [outerDecl, funcDecl], 0, 0, 4, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      // Find the function scope
      const funcScope = result.scopes.find((s) => s.kind === 'function');
      expect(funcScope).toBeDefined();

      const visible = analyzer.getVisibleSymbols(funcScope!.id);
      expect(visible.has('inner')).toBe(true);
      expect(visible.has('outer')).toBe(true);
      expect(visible.has('foo')).toBe(true);
    });
  });

  describe('getScopeAtPosition', () => {
    it('should return the most specific scope at position', () => {
      const funcBody = createNode('statement_block', '{}', [], 0, 16, 2, 1);
      const funcName = createNode('identifier', 'foo', [], 0, 9, 0, 12);
      const funcParams = createNode('formal_parameters', '()', [], 0, 12, 0, 14);
      const funcDecl = createNode('function_declaration', 'function foo() {}', [funcName, funcParams, funcBody], 0, 0, 2, 1);
      const root = createNode('program', '', [funcDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      analyzer.analyze(ast, { includeBuiltins: false });

      // Position inside function body
      const scope = analyzer.getScopeAtPosition({ row: 1, column: 0 });
      expect(scope).toBeDefined();
      expect(scope?.kind).toBe('function');
    });

    it('should return global scope for position outside functions', () => {
      const funcBody = createNode('statement_block', '{}', [], 1, 16, 1, 18);
      const funcName = createNode('identifier', 'foo', [], 1, 9, 1, 12);
      const funcParams = createNode('formal_parameters', '()', [], 1, 12, 1, 14);
      const funcDecl = createNode('function_declaration', 'function foo() {}', [funcName, funcParams, funcBody], 1, 0, 1, 18);
      const root = createNode('program', '', [funcDecl], 0, 0, 3, 0);
      const ast = createAST(root);

      analyzer.analyze(ast, { includeBuiltins: false });

      // Position at start of file (before function)
      const scope = analyzer.getScopeAtPosition({ row: 0, column: 0 });
      expect(scope).toBeDefined();
      expect(scope?.kind).toBe('global');
    });
  });

  describe('different scope kinds', () => {
    it('should correctly identify global scope', () => {
      const root = createNode('program', '', [], 0, 0, 10, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const globalScope = result.scopes.find((s) => s.kind === 'global');
      expect(globalScope).toBeDefined();
      expect(globalScope?.parentId).toBeNull();
      expect(globalScope?.depth).toBe(0);
    });

    it('should correctly identify function scope', () => {
      const funcBody = createNode('statement_block', '{}', [], 0, 16, 0, 18);
      const funcName = createNode('identifier', 'foo', [], 0, 9, 0, 12);
      const funcParams = createNode('formal_parameters', '()', [], 0, 12, 0, 14);
      const funcDecl = createNode('function_declaration', 'function foo() {}', [funcName, funcParams, funcBody], 0, 0, 0, 18);
      const root = createNode('program', '', [funcDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const funcScope = result.scopes.find((s) => s.kind === 'function');
      expect(funcScope).toBeDefined();
      expect(funcScope?.depth).toBe(1);
    });

    it('should correctly identify class scope', () => {
      const className = createNode('type_identifier', 'MyClass', [], 0, 6, 0, 13);
      const classBody = createNode('class_body', '{}', [], 0, 14, 0, 16);
      const classDecl = createNode('class_declaration', 'class MyClass {}', [className, classBody], 0, 0, 0, 16);
      const root = createNode('program', '', [classDecl], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const classScope = result.scopes.find((s) => s.kind === 'class');
      expect(classScope).toBeDefined();
    });

    it('should correctly identify block scope', () => {
      const block = createNode('statement_block', '{ const x = 1; }', [], 0, 0, 0, 16);
      const root = createNode('program', '', [block], 0, 0, 1, 0);
      const ast = createAST(root);

      const result = analyzer.analyze(ast, { includeBuiltins: false });

      const blockScope = result.scopes.find((s) => s.kind === 'block');
      expect(blockScope).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should clear internal state', () => {
      const id = createNode('identifier', 'myVar', [], 0, 6, 0, 11);
      const declarator = createNode('variable_declarator', 'myVar = 1', [id], 0, 6, 0, 15);
      const declaration = createNode('variable_declaration', 'const myVar = 1', [declarator], 0, 0, 0, 15);
      const root = createNode('program', '', [declaration], 0, 0, 1, 0);
      const ast = createAST(root);

      analyzer.analyze(ast, { includeBuiltins: false });
      analyzer.clearCache();

      // After clearing, resolving should fail
      const resolved = analyzer.resolveSymbol('myVar', 'scope_0');
      expect(resolved).toBeNull();
    });
  });
});
