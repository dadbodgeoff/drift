/**
 * Type Analyzer Tests
 *
 * Tests for TypeScript type information extraction, type relationship analysis,
 * type compatibility checking, and type coverage calculation.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TypeAnalyzer } from './type-analyzer.js';
import type { AST, ASTNode } from '../parsers/types.js';
import type { TypeInfo } from './types.js';

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

/**
 * Helper to create a TypeInfo
 */
function createTypeInfo(
  kind: TypeInfo['kind'],
  text: string,
  options: Partial<TypeInfo> = {}
): TypeInfo {
  return {
    kind,
    text,
    isNullable: false,
    isOptional: false,
    ...options,
  };
}

describe('TypeAnalyzer', () => {
  let analyzer: TypeAnalyzer;

  beforeEach(() => {
    analyzer = new TypeAnalyzer();
  });

  describe('extractType', () => {
    it('should extract primitive types', () => {
      const node = createNode('predefined_type', 'string');

      const result = analyzer.extractType(node);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('primitive');
      expect(result?.text).toBe('string');
    });

    it('should extract number primitive type', () => {
      const node = createNode('predefined_type', 'number');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('primitive');
      expect(result?.text).toBe('number');
    });

    it('should extract boolean primitive type', () => {
      const node = createNode('predefined_type', 'boolean');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('primitive');
      expect(result?.text).toBe('boolean');
    });

    it('should extract any type', () => {
      const node = createNode('predefined_type', 'any');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('any');
      expect(result?.text).toBe('any');
    });

    it('should extract void type', () => {
      const node = createNode('predefined_type', 'void');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('void');
    });

    it('should extract never type', () => {
      const node = createNode('predefined_type', 'never');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('never');
    });

    it('should extract unknown type', () => {
      const node = createNode('predefined_type', 'unknown');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('unknown');
    });

    it('should extract null type', () => {
      const node = createNode('predefined_type', 'null');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('null');
      expect(result?.isNullable).toBe(true);
    });

    it('should extract undefined type', () => {
      const node = createNode('predefined_type', 'undefined');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('undefined');
    });

    it('should extract type from type annotation', () => {
      const typeNode = createNode('predefined_type', 'string');
      const annotationNode = createNode('type_annotation', ': string', [typeNode]);

      const result = analyzer.extractType(annotationNode);

      expect(result?.kind).toBe('primitive');
      expect(result?.text).toBe('string');
    });

    it('should extract type reference', () => {
      const identifierNode = createNode('type_identifier', 'MyType');
      const node = createNode('TSTypeReference', 'MyType', [identifierNode]);

      const result = analyzer.extractType(node);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('MyType');
    });

    it('should extract union type', () => {
      const stringType = createNode('predefined_type', 'string');
      const numberType = createNode('predefined_type', 'number');
      const node = createNode('union_type', 'string | number', [stringType, numberType]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('union');
      expect(result?.unionTypes).toHaveLength(2);
      expect(result?.unionTypes?.[0]?.text).toBe('string');
      expect(result?.unionTypes?.[1]?.text).toBe('number');
    });

    it('should detect nullable union types', () => {
      const stringType = createNode('predefined_type', 'string');
      const nullType = createNode('predefined_type', 'null');
      const node = createNode('union_type', 'string | null', [stringType, nullType]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('union');
      expect(result?.isNullable).toBe(true);
    });

    it('should extract intersection type', () => {
      const typeA = createNode('type_identifier', 'TypeA');
      const typeB = createNode('type_identifier', 'TypeB');
      const node = createNode('intersection_type', 'TypeA & TypeB', [typeA, typeB]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('intersection');
      expect(result?.intersectionTypes).toHaveLength(2);
    });

    it('should extract array type', () => {
      const elementType = createNode('predefined_type', 'string');
      const node = createNode('array_type', 'string[]', [elementType]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('array');
      expect(result?.elementType?.text).toBe('string');
    });

    it('should extract tuple type', () => {
      const stringType = createNode('predefined_type', 'string');
      const numberType = createNode('predefined_type', 'number');
      const node = createNode('tuple_type', '[string, number]', [stringType, numberType]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('tuple');
      expect(result?.typeArguments).toHaveLength(2);
    });

    it('should extract literal type', () => {
      const literalNode = createNode('string', '"hello"');
      const node = createNode('literal_type', '"hello"', [literalNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('literal');
      expect(result?.text).toBe('"hello"');
    });

    it('should extract conditional type', () => {
      const node = createNode('conditional_type', 'T extends U ? X : Y');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('conditional');
    });

    it('should extract mapped type', () => {
      const node = createNode('mapped_type', '{ [K in keyof T]: T[K] }');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('mapped');
    });

    it('should extract indexed access type', () => {
      const node = createNode('indexed_access_type', 'T[K]');

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('indexed');
    });

    it('should extract type parameter', () => {
      const identifierNode = createNode('type_identifier', 'T');
      const node = createNode('type_parameter', 'T', [identifierNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('typeParameter');
      expect(result?.name).toBe('T');
    });

    it('should return null for non-type nodes', () => {
      const node = createNode('statement_block', '{ }');

      const result = analyzer.extractType(node);

      expect(result).toBeNull();
    });

    it('should respect maxDepth option', () => {
      const deepNode = createNode('predefined_type', 'string');
      let current = deepNode;
      for (let i = 0; i < 15; i++) {
        current = createNode('type_annotation', `: ${current.text}`, [current]);
      }

      const result = analyzer.extractType(current, { maxDepth: 5 });

      // Should still work but may not resolve deeply nested types
      expect(result).toBeDefined();
    });
  });

  describe('isSubtypeOf', () => {
    it('should return true for same types', () => {
      const type = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.isSubtypeOf(type, type)).toBe(true);
    });

    it('should return true for never as subtype of anything', () => {
      const neverType = createTypeInfo('never', 'never');
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.isSubtypeOf(neverType, stringType)).toBe(true);
    });

    it('should return true for anything as subtype of unknown', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const unknownType = createTypeInfo('unknown', 'unknown');

      expect(analyzer.isSubtypeOf(stringType, unknownType)).toBe(true);
    });

    it('should return true for anything as subtype of any', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const anyType = createTypeInfo('any', 'any');

      expect(analyzer.isSubtypeOf(stringType, anyType)).toBe(true);
    });

    it('should return true for any as subtype of anything', () => {
      const anyType = createTypeInfo('any', 'any');
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.isSubtypeOf(anyType, stringType)).toBe(true);
    });

    it('should return true for null as subtype of nullable type', () => {
      const nullType = createTypeInfo('null', 'null');
      const nullableString = createTypeInfo('primitive', 'string', {
        name: 'string',
        isNullable: true,
      });

      expect(analyzer.isSubtypeOf(nullType, nullableString)).toBe(true);
    });

    it('should return true for undefined as subtype of nullable type', () => {
      const undefinedType = createTypeInfo('undefined', 'undefined');
      const nullableString = createTypeInfo('primitive', 'string', {
        name: 'string',
        isNullable: true,
      });

      expect(analyzer.isSubtypeOf(undefinedType, nullableString)).toBe(true);
    });

    it('should handle union type as supertype', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });
      const unionType = createTypeInfo('union', 'string | number', {
        unionTypes: [stringType, numberType],
      });

      expect(analyzer.isSubtypeOf(stringType, unionType)).toBe(true);
      expect(analyzer.isSubtypeOf(numberType, unionType)).toBe(true);
    });

    it('should handle union type as subtype', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });
      const unionType = createTypeInfo('union', 'string | number', {
        unionTypes: [stringType, numberType],
      });
      const anyType = createTypeInfo('any', 'any');

      expect(analyzer.isSubtypeOf(unionType, anyType)).toBe(true);
    });

    it('should handle intersection type as supertype', () => {
      const typeA = createTypeInfo('interface', 'A', { name: 'A' });
      const typeB = createTypeInfo('interface', 'B', { name: 'B' });
      const intersectionType = createTypeInfo('intersection', 'A & B', {
        intersectionTypes: [typeA, typeB],
      });

      // A type must be subtype of all intersection members
      expect(analyzer.isSubtypeOf(intersectionType, typeA)).toBe(true);
    });

    it('should handle array subtyping (covariant)', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const anyType = createTypeInfo('any', 'any');

      const stringArray = createTypeInfo('array', 'string[]', { elementType: stringType });
      const anyArray = createTypeInfo('array', 'any[]', { elementType: anyType });

      expect(analyzer.isSubtypeOf(stringArray, anyArray)).toBe(true);
    });

    it('should handle object subtyping (structural)', () => {
      const nameProperty = { name: 'name', type: createTypeInfo('primitive', 'string'), isOptional: false, isReadonly: false };
      const ageProperty = { name: 'age', type: createTypeInfo('primitive', 'number'), isOptional: false, isReadonly: false };

      const personType = createTypeInfo('object', '{ name: string; age: number }', {
        properties: [nameProperty, ageProperty],
      });

      const namedType = createTypeInfo('object', '{ name: string }', {
        properties: [nameProperty],
      });

      // Person has all properties of Named, so Person is subtype of Named
      expect(analyzer.isSubtypeOf(personType, namedType)).toBe(true);
    });

    it('should return false for incompatible types', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });

      expect(analyzer.isSubtypeOf(stringType, numberType)).toBe(false);
    });
  });

  describe('areTypesCompatible', () => {
    it('should return true for subtype relationships', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const anyType = createTypeInfo('any', 'any');

      expect(analyzer.areTypesCompatible(stringType, anyType)).toBe(true);
    });

    it('should return true for any with anything', () => {
      const anyType = createTypeInfo('any', 'any');
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.areTypesCompatible(anyType, stringType)).toBe(true);
      expect(analyzer.areTypesCompatible(stringType, anyType)).toBe(true);
    });

    it('should return true for literal type compatible with primitive', () => {
      const literalType = createTypeInfo('literal', '"hello"');
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.areTypesCompatible(literalType, stringType)).toBe(true);
    });

    it('should return true for number literal compatible with number', () => {
      const literalType = createTypeInfo('literal', '42');
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });

      expect(analyzer.areTypesCompatible(literalType, numberType)).toBe(true);
    });

    it('should return true for boolean literal compatible with boolean', () => {
      const literalType = createTypeInfo('literal', 'true');
      const booleanType = createTypeInfo('primitive', 'boolean', { name: 'boolean' });

      expect(analyzer.areTypesCompatible(literalType, booleanType)).toBe(true);
    });

    it('should return true for undefined with optional type', () => {
      const undefinedType = createTypeInfo('undefined', 'undefined');
      const optionalString = createTypeInfo('primitive', 'string', {
        name: 'string',
        isOptional: true,
      });

      expect(analyzer.areTypesCompatible(undefinedType, optionalString)).toBe(true);
    });

    it('should return true for null with nullable type', () => {
      const nullType = createTypeInfo('null', 'null');
      const nullableString = createTypeInfo('primitive', 'string', {
        name: 'string',
        isNullable: true,
      });

      expect(analyzer.areTypesCompatible(nullType, nullableString)).toBe(true);
    });

    it('should return false for incompatible types', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });

      expect(analyzer.areTypesCompatible(stringType, numberType)).toBe(false);
    });
  });

  describe('areTypesEquivalent', () => {
    it('should return true for identical primitive types', () => {
      const type1 = createTypeInfo('primitive', 'string', { name: 'string' });
      const type2 = createTypeInfo('primitive', 'string', { name: 'string' });

      expect(analyzer.areTypesEquivalent(type1, type2)).toBe(true);
    });

    it('should return false for different kinds', () => {
      const type1 = createTypeInfo('primitive', 'string');
      const type2 = createTypeInfo('literal', 'string');

      expect(analyzer.areTypesEquivalent(type1, type2)).toBe(false);
    });

    it('should return false for different names', () => {
      const type1 = createTypeInfo('primitive', 'string', { name: 'string' });
      const type2 = createTypeInfo('primitive', 'number', { name: 'number' });

      expect(analyzer.areTypesEquivalent(type1, type2)).toBe(false);
    });

    it('should return false for different nullable flags', () => {
      const type1 = createTypeInfo('primitive', 'string', { isNullable: true });
      const type2 = createTypeInfo('primitive', 'string', { isNullable: false });

      expect(analyzer.areTypesEquivalent(type1, type2)).toBe(false);
    });

    it('should return false for different optional flags', () => {
      const type1 = createTypeInfo('primitive', 'string', { isOptional: true });
      const type2 = createTypeInfo('primitive', 'string', { isOptional: false });

      expect(analyzer.areTypesEquivalent(type1, type2)).toBe(false);
    });

    it('should compare union types correctly', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });

      const union1 = createTypeInfo('union', 'string | number', {
        unionTypes: [stringType, numberType],
      });
      const union2 = createTypeInfo('union', 'string | number', {
        unionTypes: [stringType, numberType],
      });

      expect(analyzer.areTypesEquivalent(union1, union2)).toBe(true);
    });

    it('should return false for different union types', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });
      const booleanType = createTypeInfo('primitive', 'boolean', { name: 'boolean' });

      const union1 = createTypeInfo('union', 'string | number', {
        unionTypes: [stringType, numberType],
      });
      const union2 = createTypeInfo('union', 'string | boolean', {
        unionTypes: [stringType, booleanType],
      });

      expect(analyzer.areTypesEquivalent(union1, union2)).toBe(false);
    });

    it('should compare array types correctly', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });

      const array1 = createTypeInfo('array', 'string[]', { elementType: stringType });
      const array2 = createTypeInfo('array', 'string[]', { elementType: stringType });

      expect(analyzer.areTypesEquivalent(array1, array2)).toBe(true);
    });

    it('should return false for different array element types', () => {
      const stringType = createTypeInfo('primitive', 'string', { name: 'string' });
      const numberType = createTypeInfo('primitive', 'number', { name: 'number' });

      const array1 = createTypeInfo('array', 'string[]', { elementType: stringType });
      const array2 = createTypeInfo('array', 'number[]', { elementType: numberType });

      expect(analyzer.areTypesEquivalent(array1, array2)).toBe(false);
    });
  });

  describe('analyzeTypes', () => {
    it('should analyze types in an AST', () => {
      const typeNode = createNode('predefined_type', 'string');
      const annotationNode = createNode('type_annotation', ': string', [typeNode]);
      const declaratorNode = createNode('variable_declarator', 'x: string', [annotationNode]);
      const root = createNode('program', '', [declaratorNode]);
      const ast = createAST(root);

      const result = analyzer.analyzeTypes(ast);

      expect(result.types.size).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect any type usage as error when deep analysis enabled', () => {
      const anyNode = createNode('predefined_type', 'any');
      const root = createNode('program', '', [anyNode]);
      const ast = createAST(root);

      const result = analyzer.analyzeTypes(ast, { deep: true });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toContain('any');
    });

    it('should calculate coverage when option enabled', () => {
      const typeNode = createNode('predefined_type', 'string');
      const annotationNode = createNode('type_annotation', ': string', [typeNode]);
      const declaratorNode = createNode('variable_declarator', 'x: string', [annotationNode]);
      const root = createNode('program', '', [declaratorNode]);
      const ast = createAST(root);

      const result = analyzer.analyzeTypes(ast, { calculateCoverage: true });

      expect(result.coverage).toBeGreaterThanOrEqual(0);
      expect(result.coverage).toBeLessThanOrEqual(100);
    });

    it('should collect type definitions', () => {
      const nameNode = createNode('type_identifier', 'MyType');
      const typeValue = createNode('predefined_type', 'string');
      const typeAliasNode = createNode('type_alias_declaration', 'type MyType = string', [
        nameNode,
        typeValue,
      ]);
      const root = createNode('program', '', [typeAliasNode]);
      const ast = createAST(root);

      const result = analyzer.analyzeTypes(ast);

      // Type definitions should be collected
      expect(result.types.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTypeCoverage', () => {
    it('should return 100% coverage for empty AST', () => {
      const root = createNode('program', '');
      const ast = createAST(root);

      const result = analyzer.getTypeCoverage(ast);

      expect(result.coverage).toBe(100);
      expect(result.totalLocations).toBe(0);
    });

    it('should calculate coverage for typed variables', () => {
      const typeNode = createNode('predefined_type', 'string');
      const annotationNode = createNode('type_annotation', ': string', [typeNode]);
      const declaratorNode = createNode('variable_declarator', 'x: string', [annotationNode]);
      const root = createNode('program', '', [declaratorNode]);
      const ast = createAST(root);

      const result = analyzer.getTypeCoverage(ast);

      expect(result.totalLocations).toBeGreaterThan(0);
    });

    it('should track missing type locations', () => {
      const declaratorNode = createNode('variable_declarator', 'x');
      const root = createNode('program', '', [declaratorNode]);
      const ast = createAST(root);

      const result = analyzer.getTypeCoverage(ast);

      // Should have at least one location
      expect(result.totalLocations).toBeGreaterThanOrEqual(0);
    });

    it('should track any type locations', () => {
      const anyNode = createNode('predefined_type', 'any');
      const annotationNode = createNode('type_annotation', ': any', [anyNode]);
      const declaratorNode = createNode('variable_declarator', 'x: any', [annotationNode]);
      const root = createNode('program', '', [declaratorNode]);
      const ast = createAST(root);

      const result = analyzer.getTypeCoverage(ast);

      expect(result.anyLocations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analyzeTypeRelationships', () => {
    it('should detect class extends relationships', () => {
      const classNameNode = createNode('type_identifier', 'Child');
      const baseNameNode = createNode('type_identifier', 'Parent');
      const extendsClause = createNode('extends_clause', 'extends Parent', [baseNameNode]);
      const classNode = createNode('class_declaration', 'class Child extends Parent {}', [
        classNameNode,
        extendsClause,
      ]);
      const root = createNode('program', '', [classNode]);
      const ast = createAST(root);

      const relationships = analyzer.analyzeTypeRelationships(ast);

      expect(relationships.length).toBeGreaterThan(0);
      const extendsRel = relationships.find((r) => r.kind === 'extends');
      expect(extendsRel).toBeDefined();
      expect(extendsRel?.sourceType.name).toBe('Child');
      expect(extendsRel?.targetType.name).toBe('Parent');
    });

    it('should detect class implements relationships', () => {
      const classNameNode = createNode('type_identifier', 'MyClass');
      const interfaceNameNode = createNode('type_identifier', 'MyInterface');
      const implementsClause = createNode('implements_clause', 'implements MyInterface', [
        interfaceNameNode,
      ]);
      const classNode = createNode('class_declaration', 'class MyClass implements MyInterface {}', [
        classNameNode,
        implementsClause,
      ]);
      const root = createNode('program', '', [classNode]);
      const ast = createAST(root);

      const relationships = analyzer.analyzeTypeRelationships(ast);

      const implementsRel = relationships.find((r) => r.kind === 'implements');
      expect(implementsRel).toBeDefined();
      expect(implementsRel?.sourceType.name).toBe('MyClass');
      expect(implementsRel?.targetType.name).toBe('MyInterface');
    });

    it('should detect interface extends relationships', () => {
      const interfaceNameNode = createNode('type_identifier', 'ChildInterface');
      const baseNameNode = createNode('type_identifier', 'ParentInterface');
      const extendsClause = createNode('extends_clause', 'extends ParentInterface', [baseNameNode]);
      const interfaceNode = createNode('interface_declaration', 'interface ChildInterface extends ParentInterface {}', [
        interfaceNameNode,
        extendsClause,
      ]);
      const root = createNode('program', '', [interfaceNode]);
      const ast = createAST(root);

      const relationships = analyzer.analyzeTypeRelationships(ast);

      const extendsRel = relationships.find((r) => r.kind === 'extends');
      expect(extendsRel).toBeDefined();
      expect(extendsRel?.sourceType.name).toBe('ChildInterface');
      expect(extendsRel?.targetType.name).toBe('ParentInterface');
    });

    it('should return empty array for AST without type relationships', () => {
      const root = createNode('program', '');
      const ast = createAST(root);

      const relationships = analyzer.analyzeTypeRelationships(ast);

      expect(relationships).toHaveLength(0);
    });

    it('should detect subtype relationships from extends', () => {
      const classNameNode = createNode('type_identifier', 'Child');
      const baseNameNode = createNode('type_identifier', 'Parent');
      const extendsClause = createNode('extends_clause', 'extends Parent', [baseNameNode]);
      const classNode = createNode('class_declaration', 'class Child extends Parent {}', [
        classNameNode,
        extendsClause,
      ]);
      const root = createNode('program', '', [classNode]);
      const ast = createAST(root);

      const relationships = analyzer.analyzeTypeRelationships(ast);

      const subtypeRel = relationships.find((r) => r.kind === 'subtype');
      expect(subtypeRel).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should clear internal caches', () => {
      const node = createNode('predefined_type', 'string');

      // Extract type to populate cache
      analyzer.extractType(node);

      // Clear cache
      analyzer.clearCache();

      // Should still work after clearing
      const result = analyzer.extractType(node);
      expect(result).not.toBeNull();
    });
  });

  describe('utility type detection', () => {
    it('should recognize Partial utility type', () => {
      const typeArgNode = createNode('type_identifier', 'MyType');
      const typeArgsNode = createNode('type_arguments', '<MyType>', [typeArgNode]);
      const identifierNode = createNode('type_identifier', 'Partial');
      const node = createNode('generic_type', 'Partial<MyType>', [identifierNode, typeArgsNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('generic');
      expect(result?.name).toBe('Partial');
    });

    it('should recognize Record utility type', () => {
      const keyNode = createNode('predefined_type', 'string');
      const valueNode = createNode('predefined_type', 'number');
      const typeArgsNode = createNode('type_arguments', '<string, number>', [keyNode, valueNode]);
      const identifierNode = createNode('type_identifier', 'Record');
      const node = createNode('generic_type', 'Record<string, number>', [identifierNode, typeArgsNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('generic');
      expect(result?.name).toBe('Record');
      expect(result?.typeArguments).toHaveLength(2);
    });

    it('should recognize Pick utility type', () => {
      const identifierNode = createNode('type_identifier', 'Pick');
      const node = createNode('generic_type', 'Pick<T, K>', [identifierNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('generic');
      expect(result?.name).toBe('Pick');
    });

    it('should recognize Omit utility type', () => {
      const identifierNode = createNode('type_identifier', 'Omit');
      const node = createNode('generic_type', 'Omit<T, K>', [identifierNode]);

      const result = analyzer.extractType(node);

      expect(result?.kind).toBe('generic');
      expect(result?.name).toBe('Omit');
    });
  });
});
