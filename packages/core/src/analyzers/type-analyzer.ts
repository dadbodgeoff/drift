/**
 * Type Analyzer - TypeScript type information extraction and analysis
 *
 * Provides type extraction from AST nodes, type relationship analysis,
 * type compatibility checking, and type coverage calculation.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import type {
  TypeInfo,
  TypeKind,
  TypePropertyInfo,
  TypeAnalysisResult,
  TypeAnalysisError,
  SourceLocation,
} from './types.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Options for type extraction
 */
export interface TypeExtractionOptions {
  /** Whether to resolve type aliases */
  resolveAliases?: boolean;

  /** Whether to include inferred types */
  includeInferred?: boolean;

  /** Maximum depth for recursive type resolution */
  maxDepth?: number;
}

/**
 * Options for type analysis
 */
export interface TypeAnalysisOptions {
  /** Whether to perform deep type analysis */
  deep?: boolean;

  /** Whether to track type relationships */
  trackRelationships?: boolean;

  /** Whether to calculate type coverage */
  calculateCoverage?: boolean;
}

/**
 * Type relationship information
 */
export interface TypeRelationship {
  /** The source type */
  sourceType: TypeInfo;

  /** The target type */
  targetType: TypeInfo;

  /** Kind of relationship */
  kind: TypeRelationshipKind;

  /** Confidence in the relationship (0-1) */
  confidence: number;
}

/**
 * Kind of type relationship
 */
export type TypeRelationshipKind =
  | 'subtype'       // A is a subtype of B
  | 'supertype'     // A is a supertype of B
  | 'equivalent'    // A and B are equivalent types
  | 'compatible'    // A is compatible with B (assignable)
  | 'incompatible'  // A is not compatible with B
  | 'extends'       // A extends B (class/interface inheritance)
  | 'implements';   // A implements B (interface implementation)

/**
 * Type coverage information
 */
export interface TypeCoverageInfo {
  /** Total number of type-able locations */
  totalLocations: number;

  /** Number of locations with explicit types */
  typedLocations: number;

  /** Number of locations with inferred types */
  inferredLocations: number;

  /** Number of locations with 'any' type */
  anyLocations: number;

  /** Number of locations without types */
  untypedLocations: number;

  /** Overall coverage percentage (0-100) */
  coverage: number;

  /** Locations missing types */
  missingTypeLocations: SourceLocation[];
}

/**
 * Primitive type names
 */
const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'never',
  'any',
  'unknown',
]);

/**
 * TypeScript utility types
 */
const UTILITY_TYPES = new Set([
  'Partial',
  'Required',
  'Readonly',
  'Record',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'Parameters',
  'ConstructorParameters',
  'ReturnType',
  'InstanceType',
  'ThisParameterType',
  'OmitThisParameter',
  'ThisType',
  'Awaited',
]);

/**
 * Type Analyzer class for TypeScript type information extraction and analysis.
 *
 * Provides a unified interface for analyzing type information across
 * TypeScript and JavaScript code.
 *
 * @requirements 3.5 - Unified AST query interface across all languages
 */
export class TypeAnalyzer {
  /** Cache for resolved types */
  private typeCache: Map<string, TypeInfo> = new Map();

  /** Type definitions found during analysis */
  private typeDefinitions: Map<string, TypeInfo> = new Map();

  /**
   * Extract type information from an AST node.
   *
   * @param node - The AST node to extract type from
   * @param options - Extraction options
   * @returns Type information or null if no type found
   */
  extractType(node: ASTNode, options: TypeExtractionOptions = {}): TypeInfo | null {
    const { maxDepth = 10 } = options;

    return this.extractTypeFromNode(node, 0, maxDepth);
  }

  /**
   * Analyze all types in an AST.
   *
   * @param ast - The AST to analyze
   * @param options - Analysis options
   * @returns Type analysis result
   */
  analyzeTypes(ast: AST, options: TypeAnalysisOptions = {}): TypeAnalysisResult {
    const types = new Map<string, TypeInfo>();
    const errors: TypeAnalysisError[] = [];

    // Clear caches for fresh analysis
    this.typeCache.clear();
    this.typeDefinitions.clear();

    // First pass: collect type definitions
    this.collectTypeDefinitions(ast.rootNode);

    // Second pass: analyze all nodes
    this.traverseForTypes(ast.rootNode, types, errors, options);

    // Calculate coverage if requested
    const coverage = options.calculateCoverage
      ? this.calculateCoverageFromTypes(types)
      : 0;

    return { types, errors, coverage };
  }

  /**
   * Check if type1 is a subtype of type2.
   *
   * @param type1 - The potential subtype
   * @param type2 - The potential supertype
   * @returns true if type1 is a subtype of type2
   */
  isSubtypeOf(type1: TypeInfo, type2: TypeInfo): boolean {
    // Same type is always a subtype of itself
    if (this.areTypesEquivalent(type1, type2)) {
      return true;
    }

    // 'never' is a subtype of everything
    if (type1.kind === 'never') {
      return true;
    }

    // Everything is a subtype of 'unknown'
    if (type2.kind === 'unknown') {
      return true;
    }

    // Everything is a subtype of 'any' (and 'any' is a subtype of everything)
    if (type2.kind === 'any' || type1.kind === 'any') {
      return true;
    }

    // null and undefined are subtypes of nullable types
    if ((type1.kind === 'null' || type1.kind === 'undefined') && type2.isNullable) {
      return true;
    }

    // Union type: type1 is subtype if it's a subtype of any union member
    if (type2.kind === 'union' && type2.unionTypes) {
      return type2.unionTypes.some((t) => this.isSubtypeOf(type1, t));
    }

    // type1 union: all members must be subtypes of type2
    if (type1.kind === 'union' && type1.unionTypes) {
      return type1.unionTypes.every((t) => this.isSubtypeOf(t, type2));
    }

    // Intersection type as supertype: type1 is subtype if it's a subtype of all intersection members
    if (type2.kind === 'intersection' && type2.intersectionTypes) {
      return type2.intersectionTypes.every((t) => this.isSubtypeOf(type1, t));
    }

    // Intersection type as subtype: A & B is a subtype of A and a subtype of B
    if (type1.kind === 'intersection' && type1.intersectionTypes) {
      return type1.intersectionTypes.some((t) => this.isSubtypeOf(t, type2));
    }

    // Array subtyping (covariant)
    if (type1.kind === 'array' && type2.kind === 'array') {
      if (type1.elementType && type2.elementType) {
        return this.isSubtypeOf(type1.elementType, type2.elementType);
      }
    }

    // Object subtyping (structural)
    if (type1.kind === 'object' && type2.kind === 'object') {
      return this.isObjectSubtype(type1, type2);
    }

    // Function subtyping (contravariant in parameters, covariant in return)
    if (type1.kind === 'function' && type2.kind === 'function') {
      return this.isFunctionSubtype(type1, type2);
    }

    // Class/interface inheritance
    if ((type1.kind === 'class' || type1.kind === 'interface') &&
        (type2.kind === 'class' || type2.kind === 'interface')) {
      // Check by name for now (would need full type resolution for accurate check)
      if (type1.name && type2.name && type1.name === type2.name) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if two types are compatible (assignable).
   *
   * @param type1 - The source type (being assigned)
   * @param type2 - The target type (being assigned to)
   * @returns true if type1 is compatible with type2
   */
  areTypesCompatible(type1: TypeInfo, type2: TypeInfo): boolean {
    // Subtype relationship implies compatibility
    if (this.isSubtypeOf(type1, type2)) {
      return true;
    }

    // 'any' is compatible with everything
    if (type1.kind === 'any' || type2.kind === 'any') {
      return true;
    }

    // Check for literal type compatibility with primitive
    if (type1.kind === 'literal' && type2.kind === 'primitive') {
      const literalPrimitive = this.getLiteralPrimitiveType(type1);
      return literalPrimitive === type2.name;
    }

    // Optional types are compatible with undefined
    if (type2.isOptional && (type1.kind === 'undefined' || type1.kind === 'void')) {
      return true;
    }

    // Nullable types are compatible with null
    if (type2.isNullable && type1.kind === 'null') {
      return true;
    }

    return false;
  }

  /**
   * Get type coverage information for an AST.
   *
   * @param ast - The AST to analyze
   * @returns Type coverage information
   */
  getTypeCoverage(ast: AST): TypeCoverageInfo {
    const locations = this.collectTypeableLocations(ast.rootNode);
    const missingTypeLocations: SourceLocation[] = [];

    let typedLocations = 0;
    let inferredLocations = 0;
    let anyLocations = 0;
    let untypedLocations = 0;

    for (const loc of locations) {
      const typeInfo = this.extractType(loc.node);

      if (!typeInfo) {
        untypedLocations++;
        missingTypeLocations.push(loc.location);
      } else if (typeInfo.kind === 'any') {
        anyLocations++;
      } else if (loc.isInferred) {
        inferredLocations++;
      } else {
        typedLocations++;
      }
    }

    const totalLocations = locations.length;
    const coverage = totalLocations > 0
      ? ((typedLocations + inferredLocations) / totalLocations) * 100
      : 100;

    return {
      totalLocations,
      typedLocations,
      inferredLocations,
      anyLocations,
      untypedLocations,
      coverage,
      missingTypeLocations,
    };
  }

  /**
   * Analyze type relationships in an AST.
   *
   * @param ast - The AST to analyze
   * @returns Array of type relationships found
   */
  analyzeTypeRelationships(ast: AST): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];

    // Collect all type definitions first
    this.collectTypeDefinitions(ast.rootNode);

    // Find extends/implements relationships
    this.traverseNode(ast.rootNode, (node) => {
      // Class declarations with extends
      if (node.type === 'class_declaration' || node.type === 'ClassDeclaration') {
        const extendsClause = this.findChildByType(node, 'extends_clause') ||
                              this.findChildByType(node, 'heritage_clause');
        if (extendsClause) {
          const className = this.getClassName(node);
          const baseClassName = this.getExtendsName(extendsClause);

          if (className && baseClassName) {
            const classType = this.createNamedType(className, 'class');
            const baseType = this.createNamedType(baseClassName, 'class');

            relationships.push({
              sourceType: classType,
              targetType: baseType,
              kind: 'extends',
              confidence: 1.0,
            });

            relationships.push({
              sourceType: classType,
              targetType: baseType,
              kind: 'subtype',
              confidence: 1.0,
            });
          }
        }

        // Implements clause
        const implementsClause = this.findChildByType(node, 'implements_clause');
        if (implementsClause) {
          const className = this.getClassName(node);
          const interfaceNames = this.getImplementsNames(implementsClause);

          if (className) {
            const classType = this.createNamedType(className, 'class');

            for (const interfaceName of interfaceNames) {
              const interfaceType = this.createNamedType(interfaceName, 'interface');

              relationships.push({
                sourceType: classType,
                targetType: interfaceType,
                kind: 'implements',
                confidence: 1.0,
              });
            }
          }
        }
      }

      // Interface declarations with extends
      if (node.type === 'interface_declaration' || node.type === 'TSInterfaceDeclaration') {
        const extendsClause = this.findChildByType(node, 'extends_clause') ||
                              this.findChildByType(node, 'extends_type_clause');
        if (extendsClause) {
          const interfaceName = this.getInterfaceName(node);
          const baseNames = this.getExtendsNames(extendsClause);

          if (interfaceName) {
            const interfaceType = this.createNamedType(interfaceName, 'interface');

            for (const baseName of baseNames) {
              const baseType = this.createNamedType(baseName, 'interface');

              relationships.push({
                sourceType: interfaceType,
                targetType: baseType,
                kind: 'extends',
                confidence: 1.0,
              });
            }
          }
        }
      }
    });

    return relationships;
  }

  /**
   * Check if two types are equivalent.
   *
   * @param type1 - First type
   * @param type2 - Second type
   * @returns true if types are equivalent
   */
  areTypesEquivalent(type1: TypeInfo, type2: TypeInfo): boolean {
    // Same kind check
    if (type1.kind !== type2.kind) {
      return false;
    }

    // Same name for named types
    if (type1.name !== type2.name) {
      return false;
    }

    // Same text representation
    if (type1.text !== type2.text) {
      return false;
    }

    // Check nullable/optional flags
    if (type1.isNullable !== type2.isNullable || type1.isOptional !== type2.isOptional) {
      return false;
    }

    // Check union types
    if (type1.kind === 'union') {
      if (!type1.unionTypes || !type2.unionTypes) {
        return type1.unionTypes === type2.unionTypes;
      }
      if (type1.unionTypes.length !== type2.unionTypes.length) {
        return false;
      }
      return type1.unionTypes.every((t1, i) =>
        this.areTypesEquivalent(t1, type2.unionTypes![i]!)
      );
    }

    // Check intersection types
    if (type1.kind === 'intersection') {
      if (!type1.intersectionTypes || !type2.intersectionTypes) {
        return type1.intersectionTypes === type2.intersectionTypes;
      }
      if (type1.intersectionTypes.length !== type2.intersectionTypes.length) {
        return false;
      }
      return type1.intersectionTypes.every((t1, i) =>
        this.areTypesEquivalent(t1, type2.intersectionTypes![i]!)
      );
    }

    // Check array element types
    if (type1.kind === 'array') {
      if (!type1.elementType || !type2.elementType) {
        return type1.elementType === type2.elementType;
      }
      return this.areTypesEquivalent(type1.elementType, type2.elementType);
    }

    // Check function types
    if (type1.kind === 'function') {
      return this.areFunctionTypesEquivalent(type1, type2);
    }

    // Check object types
    if (type1.kind === 'object') {
      return this.areObjectTypesEquivalent(type1, type2);
    }

    return true;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Extract type from an AST node recursively.
   */
  private extractTypeFromNode(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo | null {
    if (depth > maxDepth) {
      return null;
    }

    // Check cache first - include text in key to differentiate nodes at same position
    const cacheKey = `${node.startPosition.row}:${node.startPosition.column}:${node.type}:${node.text}`;
    if (this.typeCache.has(cacheKey)) {
      return this.typeCache.get(cacheKey)!;
    }

    const typeInfo = this.extractTypeFromNodeInternal(node, depth, maxDepth);

    if (typeInfo) {
      this.typeCache.set(cacheKey, typeInfo);
    }

    return typeInfo;
  }

  /**
   * Internal type extraction logic.
   */
  private extractTypeFromNodeInternal(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo | null {
    const nodeType = node.type;

    // Type annotation nodes
    if (nodeType === 'type_annotation' || nodeType === 'TSTypeAnnotation') {
      const typeNode = node.children[0];
      if (typeNode) {
        return this.extractTypeFromNode(typeNode, depth + 1, maxDepth);
      }
    }

    // Primitive types
    if (nodeType === 'predefined_type' || nodeType === 'TSStringKeyword' ||
        nodeType === 'TSNumberKeyword' || nodeType === 'TSBooleanKeyword' ||
        nodeType === 'TSAnyKeyword' || nodeType === 'TSVoidKeyword' ||
        nodeType === 'TSNeverKeyword' || nodeType === 'TSUnknownKeyword' ||
        nodeType === 'TSNullKeyword' || nodeType === 'TSUndefinedKeyword') {
      return this.createPrimitiveType(node.text);
    }

    // Type reference (named types)
    if (nodeType === 'type_identifier' || nodeType === 'TSTypeReference' ||
        nodeType === 'generic_type') {
      return this.extractTypeReference(node, depth, maxDepth);
    }

    // Union types
    if (nodeType === 'union_type' || nodeType === 'TSUnionType') {
      return this.extractUnionType(node, depth, maxDepth);
    }

    // Intersection types
    if (nodeType === 'intersection_type' || nodeType === 'TSIntersectionType') {
      return this.extractIntersectionType(node, depth, maxDepth);
    }

    // Array types
    if (nodeType === 'array_type' || nodeType === 'TSArrayType') {
      return this.extractArrayType(node, depth, maxDepth);
    }

    // Tuple types
    if (nodeType === 'tuple_type' || nodeType === 'TSTupleType') {
      return this.extractTupleType(node, depth, maxDepth);
    }

    // Function types
    if (nodeType === 'function_type' || nodeType === 'TSFunctionType') {
      return this.extractFunctionType(node, depth, maxDepth);
    }

    // Object/interface types
    if (nodeType === 'object_type' || nodeType === 'TSTypeLiteral') {
      return this.extractObjectType(node, depth, maxDepth);
    }

    // Literal types
    if (nodeType === 'literal_type' || nodeType === 'TSLiteralType') {
      return this.extractLiteralType(node);
    }

    // Conditional types
    if (nodeType === 'conditional_type' || nodeType === 'TSConditionalType') {
      return this.createTypeInfo('conditional', node.text);
    }

    // Mapped types
    if (nodeType === 'mapped_type' || nodeType === 'TSMappedType') {
      return this.createTypeInfo('mapped', node.text);
    }

    // Indexed access types
    if (nodeType === 'indexed_access_type' || nodeType === 'TSIndexedAccessType') {
      return this.createTypeInfo('indexed', node.text);
    }

    // Type parameters
    if (nodeType === 'type_parameter' || nodeType === 'TSTypeParameter') {
      return this.extractTypeParameter(node);
    }

    // Variable declarations with type annotations
    if (nodeType === 'variable_declarator' || nodeType === 'VariableDeclarator') {
      const typeAnnotation = this.findChildByType(node, 'type_annotation') ||
                             this.findChildByType(node, 'TSTypeAnnotation');
      if (typeAnnotation) {
        return this.extractTypeFromNode(typeAnnotation, depth + 1, maxDepth);
      }
    }

    // Function declarations
    if (nodeType === 'function_declaration' || nodeType === 'FunctionDeclaration' ||
        nodeType === 'method_definition' || nodeType === 'MethodDefinition') {
      return this.extractFunctionDeclarationType(node, depth, maxDepth);
    }

    // Parameter declarations
    if (nodeType === 'required_parameter' || nodeType === 'optional_parameter' ||
        nodeType === 'Identifier') {
      const typeAnnotation = this.findChildByType(node, 'type_annotation') ||
                             this.findChildByType(node, 'TSTypeAnnotation');
      if (typeAnnotation) {
        return this.extractTypeFromNode(typeAnnotation, depth + 1, maxDepth);
      }
    }

    return null;
  }

  /**
   * Extract type reference (named type).
   */
  private extractTypeReference(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const typeName = this.getTypeName(node);
    const typeArgs = this.extractTypeArguments(node, depth, maxDepth);

    // Check if it's a primitive type
    if (PRIMITIVE_TYPES.has(typeName)) {
      return this.createPrimitiveType(typeName);
    }

    // Check if it's a utility type
    if (UTILITY_TYPES.has(typeName)) {
      const result: TypeInfo = {
        kind: 'generic',
        name: typeName,
        text: node.text,
        isNullable: false,
        isOptional: false,
      };
      if (typeArgs.length > 0) {
        result.typeArguments = typeArgs;
      }
      return result;
    }

    // Check if we have a definition for this type
    const definition = this.typeDefinitions.get(typeName);
    if (definition) {
      const result: TypeInfo = { ...definition };
      if (typeArgs.length > 0) {
        result.typeArguments = typeArgs;
      }
      return result;
    }

    // Return as a generic named type
    const kind = this.inferTypeKind(typeName);
    const result: TypeInfo = {
      kind,
      name: typeName,
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
    if (typeArgs.length > 0) {
      result.typeArguments = typeArgs;
    }
    return result;
  }

  /**
   * Extract union type.
   */
  private extractUnionType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const unionTypes: TypeInfo[] = [];

    for (const child of node.children) {
      if (child.type !== '|') {
        const childType = this.extractTypeFromNode(child, depth + 1, maxDepth);
        if (childType) {
          unionTypes.push(childType);
        }
      }
    }

    const isNullable = unionTypes.some(
      (t) => t.kind === 'null' || t.kind === 'undefined'
    );

    return {
      kind: 'union',
      text: node.text,
      unionTypes,
      isNullable,
      isOptional: false,
    };
  }

  /**
   * Extract intersection type.
   */
  private extractIntersectionType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const intersectionTypes: TypeInfo[] = [];

    for (const child of node.children) {
      if (child.type !== '&') {
        const childType = this.extractTypeFromNode(child, depth + 1, maxDepth);
        if (childType) {
          intersectionTypes.push(childType);
        }
      }
    }

    return {
      kind: 'intersection',
      text: node.text,
      intersectionTypes,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Extract array type.
   */
  private extractArrayType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const elementTypeNode = node.children[0];
    const elementType = elementTypeNode
      ? this.extractTypeFromNode(elementTypeNode, depth + 1, maxDepth)
      : null;

    const result: TypeInfo = {
      kind: 'array',
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
    if (elementType) {
      result.elementType = elementType;
    }
    return result;
  }

  /**
   * Extract tuple type.
   */
  private extractTupleType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const elementTypes: TypeInfo[] = [];

    for (const child of node.children) {
      if (child.type !== '[' && child.type !== ']' && child.type !== ',') {
        const childType = this.extractTypeFromNode(child, depth + 1, maxDepth);
        if (childType) {
          elementTypes.push(childType);
        }
      }
    }

    return {
      kind: 'tuple',
      text: node.text,
      typeArguments: elementTypes,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Extract function type.
   */
  private extractFunctionType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const parameters: TypeInfo[] = [];
    let returnType: TypeInfo | null = null;

    // Find parameters
    const paramsNode = this.findChildByType(node, 'formal_parameters') ||
                       this.findChildByType(node, 'parameters');
    if (paramsNode) {
      for (const param of paramsNode.children) {
        if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
          const paramType = this.extractTypeFromNode(param, depth + 1, maxDepth);
          if (paramType) {
            parameters.push(paramType);
          }
        }
      }
    }

    // Find return type
    const returnTypeNode = this.findChildByType(node, 'type_annotation') ||
                           this.findChildByType(node, 'return_type');
    if (returnTypeNode) {
      returnType = this.extractTypeFromNode(returnTypeNode, depth + 1, maxDepth);
    }

    const result: TypeInfo = {
      kind: 'function',
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
    if (parameters.length > 0) {
      result.parameters = parameters;
    }
    if (returnType) {
      result.returnType = returnType;
    }
    return result;
  }

  /**
   * Extract object type.
   */
  private extractObjectType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const properties: TypePropertyInfo[] = [];

    for (const child of node.children) {
      if (child.type === 'property_signature' || child.type === 'TSPropertySignature') {
        const prop = this.extractPropertySignature(child, depth, maxDepth);
        if (prop) {
          properties.push(prop);
        }
      }
    }

    const result: TypeInfo = {
      kind: 'object',
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
    if (properties.length > 0) {
      result.properties = properties;
    }
    return result;
  }

  /**
   * Extract property signature.
   */
  private extractPropertySignature(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypePropertyInfo | null {
    const nameNode = this.findChildByType(node, 'property_identifier') ||
                     this.findChildByType(node, 'Identifier');
    if (!nameNode) {
      return null;
    }

    const typeAnnotation = this.findChildByType(node, 'type_annotation') ||
                           this.findChildByType(node, 'TSTypeAnnotation');
    const type = typeAnnotation
      ? this.extractTypeFromNode(typeAnnotation, depth + 1, maxDepth)
      : this.createTypeInfo('any', 'any');

    const isOptional = node.children.some((c) => c.text === '?');
    const isReadonly = node.children.some(
      (c) => c.type === 'readonly' || c.text === 'readonly'
    );

    return {
      name: nameNode.text,
      type: type || this.createTypeInfo('any', 'any'),
      isOptional,
      isReadonly,
    };
  }

  /**
   * Extract literal type.
   */
  private extractLiteralType(node: ASTNode): TypeInfo {
    const literalNode = node.children[0];
    const text = literalNode?.text || node.text;

    return {
      kind: 'literal',
      text,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Extract type parameter.
   */
  private extractTypeParameter(node: ASTNode): TypeInfo {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text || node.text;

    return {
      kind: 'typeParameter',
      name,
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Extract function declaration type.
   */
  private extractFunctionDeclarationType(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo {
    const parameters: TypeInfo[] = [];
    let returnType: TypeInfo | null = null;

    // Find parameters
    const paramsNode = this.findChildByType(node, 'formal_parameters') ||
                       this.findChildByType(node, 'parameters');
    if (paramsNode) {
      for (const param of paramsNode.children) {
        const paramType = this.extractTypeFromNode(param, depth + 1, maxDepth);
        if (paramType) {
          parameters.push(paramType);
        }
      }
    }

    // Find return type annotation
    const returnTypeAnnotation = this.findChildByType(node, 'type_annotation') ||
                                  this.findChildByType(node, 'return_type');
    if (returnTypeAnnotation) {
      returnType = this.extractTypeFromNode(returnTypeAnnotation, depth + 1, maxDepth);
    }

    const result: TypeInfo = {
      kind: 'function',
      text: node.text,
      isNullable: false,
      isOptional: false,
    };
    if (parameters.length > 0) {
      result.parameters = parameters;
    }
    if (returnType) {
      result.returnType = returnType;
    }
    return result;
  }

  /**
   * Extract type arguments from a generic type.
   */
  private extractTypeArguments(
    node: ASTNode,
    depth: number,
    maxDepth: number
  ): TypeInfo[] {
    const typeArgs: TypeInfo[] = [];

    const typeArgsNode = this.findChildByType(node, 'type_arguments') ||
                         this.findChildByType(node, 'TSTypeParameterInstantiation');
    if (typeArgsNode) {
      for (const child of typeArgsNode.children) {
        if (child.type !== '<' && child.type !== '>' && child.type !== ',') {
          const argType = this.extractTypeFromNode(child, depth + 1, maxDepth);
          if (argType) {
            typeArgs.push(argType);
          }
        }
      }
    }

    return typeArgs;
  }

  /**
   * Collect type definitions from the AST.
   */
  private collectTypeDefinitions(node: ASTNode): void {
    // Type alias declarations
    if (node.type === 'type_alias_declaration' || node.type === 'TSTypeAliasDeclaration') {
      const nameNode = this.findChildByType(node, 'type_identifier') ||
                       this.findChildByType(node, 'Identifier');
      if (nameNode) {
        const typeNode = node.children.find(
          (c) => c.type !== 'type_identifier' && c.type !== 'Identifier' &&
                 c.type !== '=' && c.type !== 'type'
        );
        if (typeNode) {
          const typeInfo = this.extractTypeFromNode(typeNode, 0, 10);
          if (typeInfo) {
            this.typeDefinitions.set(nameNode.text, {
              ...typeInfo,
              name: nameNode.text,
            });
          }
        }
      }
    }

    // Interface declarations
    if (node.type === 'interface_declaration' || node.type === 'TSInterfaceDeclaration') {
      const nameNode = this.findChildByType(node, 'type_identifier') ||
                       this.findChildByType(node, 'Identifier');
      if (nameNode) {
        this.typeDefinitions.set(nameNode.text, {
          kind: 'interface',
          name: nameNode.text,
          text: node.text,
          isNullable: false,
          isOptional: false,
        });
      }
    }

    // Class declarations
    if (node.type === 'class_declaration' || node.type === 'ClassDeclaration') {
      const nameNode = this.findChildByType(node, 'type_identifier') ||
                       this.findChildByType(node, 'Identifier');
      if (nameNode) {
        this.typeDefinitions.set(nameNode.text, {
          kind: 'class',
          name: nameNode.text,
          text: node.text,
          isNullable: false,
          isOptional: false,
        });
      }
    }

    // Enum declarations
    if (node.type === 'enum_declaration' || node.type === 'TSEnumDeclaration') {
      const nameNode = this.findChildByType(node, 'identifier') ||
                       this.findChildByType(node, 'Identifier');
      if (nameNode) {
        this.typeDefinitions.set(nameNode.text, {
          kind: 'enum',
          name: nameNode.text,
          text: node.text,
          isNullable: false,
          isOptional: false,
        });
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.collectTypeDefinitions(child);
    }
  }

  /**
   * Traverse AST for type analysis.
   */
  private traverseForTypes(
    node: ASTNode,
    types: Map<string, TypeInfo>,
    errors: TypeAnalysisError[],
    options: TypeAnalysisOptions
  ): void {
    // Extract type from this node if applicable
    const typeInfo = this.extractTypeFromNode(node, 0, 10);
    if (typeInfo) {
      const key = `${node.startPosition.row}:${node.startPosition.column}`;
      types.set(key, typeInfo);
    }

    // Check for type errors
    if (options.deep) {
      this.checkTypeErrors(node, errors);
    }

    // Recurse into children
    for (const child of node.children) {
      this.traverseForTypes(child, types, errors, options);
    }
  }

  /**
   * Check for type errors in a node.
   */
  private checkTypeErrors(node: ASTNode, errors: TypeAnalysisError[]): void {
    // Check for explicit 'any' usage
    if (node.type === 'predefined_type' && node.text === 'any') {
      errors.push({
        message: "Explicit 'any' type usage",
        location: {
          start: node.startPosition,
          end: node.endPosition,
        },
      });
    }

    // Check for type assertions to 'any'
    if ((node.type === 'as_expression' || node.type === 'TSAsExpression') &&
        node.text.includes(' as any')) {
      errors.push({
        message: "Type assertion to 'any'",
        location: {
          start: node.startPosition,
          end: node.endPosition,
        },
      });
    }
  }

  /**
   * Collect typeable locations from AST.
   */
  private collectTypeableLocations(
    node: ASTNode
  ): Array<{ node: ASTNode; location: SourceLocation; isInferred: boolean }> {
    const locations: Array<{ node: ASTNode; location: SourceLocation; isInferred: boolean }> = [];

    this.traverseNode(node, (n) => {
      // Variable declarations
      if (n.type === 'variable_declarator' || n.type === 'VariableDeclarator') {
        const hasTypeAnnotation = this.findChildByType(n, 'type_annotation') ||
                                   this.findChildByType(n, 'TSTypeAnnotation');
        const initializerNode = this.findChildByType(n, 'initializer');
        const hasInitializer = initializerNode !== null || n.children.some((c) => c.type === '=');

        locations.push({
          node: n,
          location: { start: n.startPosition, end: n.endPosition },
          isInferred: !hasTypeAnnotation && hasInitializer,
        });
      }

      // Function parameters
      if (n.type === 'required_parameter' || n.type === 'optional_parameter') {
        const hasTypeAnnotation = this.findChildByType(n, 'type_annotation') ||
                                   this.findChildByType(n, 'TSTypeAnnotation');
        locations.push({
          node: n,
          location: { start: n.startPosition, end: n.endPosition },
          isInferred: !hasTypeAnnotation,
        });
      }

      // Function return types
      if (n.type === 'function_declaration' || n.type === 'FunctionDeclaration' ||
          n.type === 'arrow_function' || n.type === 'ArrowFunctionExpression') {
        const hasReturnType = this.findChildByType(n, 'type_annotation') ||
                              this.findChildByType(n, 'return_type');
        locations.push({
          node: n,
          location: { start: n.startPosition, end: n.endPosition },
          isInferred: !hasReturnType,
        });
      }
    });

    return locations;
  }

  /**
   * Calculate coverage from analyzed types.
   */
  private calculateCoverageFromTypes(types: Map<string, TypeInfo>): number {
    if (types.size === 0) {
      return 100;
    }

    let typedCount = 0;
    let anyCount = 0;

    for (const typeInfo of types.values()) {
      if (typeInfo.kind === 'any') {
        anyCount++;
      } else {
        typedCount++;
      }
    }

    return (typedCount / types.size) * 100;
  }

  /**
   * Check if object type1 is a subtype of object type2.
   */
  private isObjectSubtype(type1: TypeInfo, type2: TypeInfo): boolean {
    if (!type2.properties) {
      return true; // Empty object type is supertype of all objects
    }

    if (!type1.properties) {
      return false;
    }

    // All properties in type2 must exist in type1 with compatible types
    for (const prop2 of type2.properties) {
      const prop1 = type1.properties.find((p) => p.name === prop2.name);

      if (!prop1) {
        if (!prop2.isOptional) {
          return false; // Required property missing
        }
        continue;
      }

      if (!this.isSubtypeOf(prop1.type, prop2.type)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if function type1 is a subtype of function type2.
   */
  private isFunctionSubtype(type1: TypeInfo, type2: TypeInfo): boolean {
    // Check return type (covariant)
    if (type1.returnType && type2.returnType) {
      if (!this.isSubtypeOf(type1.returnType, type2.returnType)) {
        return false;
      }
    }

    // Check parameters (contravariant)
    const params1 = type1.parameters || [];
    const params2 = type2.parameters || [];

    // type1 can have fewer required parameters
    for (let i = 0; i < params2.length; i++) {
      const param1 = params1[i];
      const param2 = params2[i];

      if (!param1) {
        if (!param2?.isOptional) {
          return false;
        }
        continue;
      }

      if (param2 && !this.isSubtypeOf(param2, param1)) {
        return false; // Contravariant
      }
    }

    return true;
  }

  /**
   * Check if two function types are equivalent.
   */
  private areFunctionTypesEquivalent(type1: TypeInfo, type2: TypeInfo): boolean {
    // Check return types
    if (type1.returnType && type2.returnType) {
      if (!this.areTypesEquivalent(type1.returnType, type2.returnType)) {
        return false;
      }
    } else if (type1.returnType !== type2.returnType) {
      return false;
    }

    // Check parameters
    const params1 = type1.parameters || [];
    const params2 = type2.parameters || [];

    if (params1.length !== params2.length) {
      return false;
    }

    for (let i = 0; i < params1.length; i++) {
      if (!this.areTypesEquivalent(params1[i]!, params2[i]!)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if two object types are equivalent.
   */
  private areObjectTypesEquivalent(type1: TypeInfo, type2: TypeInfo): boolean {
    const props1 = type1.properties || [];
    const props2 = type2.properties || [];

    if (props1.length !== props2.length) {
      return false;
    }

    for (const prop1 of props1) {
      const prop2 = props2.find((p) => p.name === prop1.name);
      if (!prop2) {
        return false;
      }

      if (prop1.isOptional !== prop2.isOptional ||
          prop1.isReadonly !== prop2.isReadonly) {
        return false;
      }

      if (!this.areTypesEquivalent(prop1.type, prop2.type)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the primitive type for a literal type.
   */
  private getLiteralPrimitiveType(type: TypeInfo): string {
    const text = type.text;

    if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
      return 'string';
    }

    if (/^-?\d+(\.\d+)?$/.test(text)) {
      return 'number';
    }

    if (text === 'true' || text === 'false') {
      return 'boolean';
    }

    if (text.endsWith('n')) {
      return 'bigint';
    }

    return 'unknown';
  }

  /**
   * Traverse AST nodes with a callback.
   */
  private traverseNode(node: ASTNode, callback: (node: ASTNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.traverseNode(child, callback);
    }
  }

  /**
   * Find a child node by type.
   */
  private findChildByType(node: ASTNode, type: string): ASTNode | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Get type name from a type reference node.
   */
  private getTypeName(node: ASTNode): string {
    const identifierNode = this.findChildByType(node, 'type_identifier') ||
                           this.findChildByType(node, 'Identifier');
    if (identifierNode) {
      return identifierNode.text;
    }

    // For simple type identifiers
    if (node.type === 'type_identifier' || node.type === 'Identifier') {
      return node.text;
    }

    // Extract name from text (remove type arguments)
    const text = node.text;
    const angleIndex = text.indexOf('<');
    return angleIndex > 0 ? text.substring(0, angleIndex) : text;
  }

  /**
   * Infer type kind from name.
   */
  private inferTypeKind(name: string): TypeKind {
    // Interface naming convention (I prefix)
    if (name.startsWith('I') && name.length > 1 && name[1] === name[1]?.toUpperCase()) {
      return 'interface';
    }

    // Type naming convention (T prefix for type parameters)
    if (name.length === 1 && name >= 'A' && name <= 'Z') {
      return 'typeParameter';
    }

    // Default to class for PascalCase names
    if (name[0] === name[0]?.toUpperCase()) {
      return 'class';
    }

    return 'unknown';
  }

  /**
   * Create a primitive type info.
   */
  private createPrimitiveType(name: string): TypeInfo {
    const kind = this.getPrimitiveKind(name);
    return {
      kind,
      name,
      text: name,
      isNullable: name === 'null',
      isOptional: false,
    };
  }

  /**
   * Get the TypeKind for a primitive type name.
   */
  private getPrimitiveKind(name: string): TypeKind {
    switch (name) {
      case 'null':
        return 'null';
      case 'undefined':
        return 'undefined';
      case 'void':
        return 'void';
      case 'never':
        return 'never';
      case 'any':
        return 'any';
      case 'unknown':
        return 'unknown';
      default:
        return 'primitive';
    }
  }

  /**
   * Create a basic type info.
   */
  private createTypeInfo(kind: TypeKind, text: string): TypeInfo {
    return {
      kind,
      text,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Create a named type info.
   */
  private createNamedType(name: string, kind: TypeKind): TypeInfo {
    return {
      kind,
      name,
      text: name,
      isNullable: false,
      isOptional: false,
    };
  }

  /**
   * Get class name from a class declaration node.
   */
  private getClassName(node: ASTNode): string | null {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    return nameNode?.text || null;
  }

  /**
   * Get interface name from an interface declaration node.
   */
  private getInterfaceName(node: ASTNode): string | null {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    return nameNode?.text || null;
  }

  /**
   * Get the extended class/interface name from an extends clause.
   */
  private getExtendsName(node: ASTNode): string | null {
    const typeNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier') ||
                     this.findChildByType(node, 'generic_type');
    if (typeNode) {
      return this.getTypeName(typeNode);
    }
    return null;
  }

  /**
   * Get all extended interface names from an extends clause.
   */
  private getExtendsNames(node: ASTNode): string[] {
    const names: string[] = [];

    for (const child of node.children) {
      if (child.type === 'type_identifier' || child.type === 'Identifier' ||
          child.type === 'generic_type') {
        const name = this.getTypeName(child);
        if (name) {
          names.push(name);
        }
      }
    }

    return names;
  }

  /**
   * Get implemented interface names from an implements clause.
   */
  private getImplementsNames(node: ASTNode): string[] {
    const names: string[] = [];

    for (const child of node.children) {
      if (child.type === 'type_identifier' || child.type === 'Identifier' ||
          child.type === 'generic_type') {
        const name = this.getTypeName(child);
        if (name) {
          names.push(name);
        }
      }
    }

    return names;
  }

  /**
   * Clear internal caches.
   */
  clearCache(): void {
    this.typeCache.clear();
    this.typeDefinitions.clear();
  }
}
