/**
 * Pydantic Type Resolver
 *
 * Resolves Python type annotations to TypeInfo structures.
 * Handles Optional, Union, List, Dict, Literal, and nested generics.
 *
 * @module pydantic/type-resolver
 */

import { PYTHON_TYPE_MAP } from './types.js';

import type { TypeInfo } from '../types.js';
import type { ExtractionContext, ParsedType } from './types.js';

// ============================================
// Type Resolver Class
// ============================================

/**
 * Resolves Python type annotations to TypeInfo.
 *
 * Handles:
 * - Simple types: `str`, `int`, `bool`
 * - Optional: `Optional[str]`, `str | None`
 * - Union: `Union[str, int]`, `str | int`
 * - List/Dict: `List[str]`, `Dict[str, int]`
 * - Literal: `Literal['a', 'b', 'c']`
 * - Nested: `List[Dict[str, Optional[int]]]`
 */
export class TypeResolver {
  /**
   * Resolve a type annotation string to TypeInfo.
   *
   * @param typeStr - The type annotation string
   * @param context - Extraction context
   * @param depth - Current recursion depth
   * @returns Resolved TypeInfo
   */
  resolve(
    typeStr: string,
    context: ExtractionContext,
    depth: number = 0
  ): TypeInfo {
    // Prevent infinite recursion
    if (depth > context.maxTypeDepth) {
      return this.createUnknownType(typeStr);
    }

    // Normalize whitespace
    const normalized = typeStr.trim();

    // Check for type alias
    const aliased = context.typeAliases.get(normalized);
    if (aliased) {
      return this.resolve(aliased, context, depth + 1);
    }

    // Parse the type structure
    const parsed = this.parseTypeString(normalized);

    // Convert to TypeInfo
    return this.parsedToTypeInfo(parsed, context, depth);
  }

  /**
   * Create an unknown type placeholder.
   */
  createUnknownType(raw: string = 'unknown'): TypeInfo {
    return {
      raw,
      base: 'unknown',
      args: [],
      isOptional: false,
      isUnion: false,
      isList: false,
      isDict: false,
      isLiteral: false,
      literalValues: [],
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  // ============================================
  // Type String Parsing
  // ============================================

  /**
   * Parse a type string into a structured format.
   */
  private parseTypeString(typeStr: string): ParsedType {
    // Handle union syntax: str | int | None
    if (this.containsUnionOperator(typeStr)) {
      return this.parseUnionType(typeStr);
    }

    // Handle generic types: List[str], Dict[str, int]
    const genericMatch = typeStr.match(/^(\w+(?:\.\w+)*)\s*\[(.+)\]$/);
    if (genericMatch) {
      const [, base, argsStr] = genericMatch;
      const args = this.parseGenericArgs(argsStr ?? '');
      return {
        base: base ?? '',
        args,
        raw: typeStr,
        isOptional: false,
        isUnion: false,
        unionMembers: [],
      };
    }

    // Simple type
    return {
      base: typeStr,
      args: [],
      raw: typeStr,
      isOptional: false,
      isUnion: false,
      unionMembers: [],
    };
  }

  /**
   * Check if type string contains union operator (|) outside brackets.
   */
  private containsUnionOperator(typeStr: string): boolean {
    let depth = 0;
    for (const char of typeStr) {
      if (char === '[' || char === '(') {depth++;}
      else if (char === ']' || char === ')') {depth--;}
      else if (char === '|' && depth === 0) {return true;}
    }
    return false;
  }

  /**
   * Parse a union type (str | int | None).
   */
  private parseUnionType(typeStr: string): ParsedType {
    const members = this.splitUnionMembers(typeStr);
    const parsedMembers = members.map((m) => this.parseTypeString(m.trim()));

    // Check if this is Optional (has None member)
    const hasNone = parsedMembers.some(
      (m) => m.base === 'None' || m.base === 'NoneType'
    );
    const nonNoneMembers = parsedMembers.filter(
      (m) => m.base !== 'None' && m.base !== 'NoneType'
    );

    // If only one non-None member, treat as Optional[T]
    if (hasNone && nonNoneMembers.length === 1) {
      const inner = nonNoneMembers[0]!;
      return {
        ...inner,
        isOptional: true,
        raw: typeStr,
      };
    }

    return {
      base: 'Union',
      args: parsedMembers,
      raw: typeStr,
      isOptional: hasNone,
      isUnion: true,
      unionMembers: parsedMembers,
    };
  }

  /**
   * Split union members respecting bracket depth.
   */
  private splitUnionMembers(typeStr: string): string[] {
    const members: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of typeStr) {
      if (char === '[' || char === '(') {
        depth++;
        current += char;
      } else if (char === ']' || char === ')') {
        depth--;
        current += char;
      } else if (char === '|' && depth === 0) {
        members.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      members.push(current.trim());
    }

    return members;
  }

  /**
   * Parse generic type arguments.
   */
  private parseGenericArgs(argsStr: string): ParsedType[] {
    const args: ParsedType[] = [];
    let current = '';
    let depth = 0;

    for (const char of argsStr) {
      if (char === '[' || char === '(') {
        depth++;
        current += char;
      } else if (char === ']' || char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          args.push(this.parseTypeString(current.trim()));
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(this.parseTypeString(current.trim()));
    }

    return args;
  }

  // ============================================
  // Type Conversion
  // ============================================

  /**
   * Convert ParsedType to TypeInfo.
   */
  private parsedToTypeInfo(
    parsed: ParsedType,
    context: ExtractionContext,
    depth: number
  ): TypeInfo {
    const base = parsed.base;

    // Handle Optional[T]
    if (base === 'Optional') {
      const inner = parsed.args[0];
      if (inner) {
        const innerInfo = this.parsedToTypeInfo(inner, context, depth + 1);
        return {
          ...innerInfo,
          isOptional: true,
          raw: parsed.raw,
        };
      }
    }

    // Handle Union[T, U, ...]
    if (base === 'Union' || parsed.isUnion) {
      return this.handleUnionType(parsed, context, depth);
    }

    // Handle Literal['a', 'b']
    if (base === 'Literal') {
      return this.handleLiteralType(parsed);
    }

    // Handle List/Sequence types
    if (this.isListType(base)) {
      return this.handleListType(parsed, context, depth);
    }

    // Handle Dict/Mapping types
    if (this.isDictType(base)) {
      return this.handleDictType(parsed, context, depth);
    }

    // Handle Tuple
    if (base === 'Tuple' || base === 'tuple') {
      return this.handleTupleType(parsed, context, depth);
    }

    // Check if this is a known Pydantic model
    const isPydanticModel = context.knownModels.has(base);

    // Map Python type to contract type
    const mappedBase = PYTHON_TYPE_MAP[base] ?? base;

    return {
      raw: parsed.raw,
      base: mappedBase,
      args: parsed.args.map((a) => this.parsedToTypeInfo(a, context, depth + 1)),
      isOptional: parsed.isOptional,
      isUnion: false,
      isList: false,
      isDict: false,
      isLiteral: false,
      literalValues: [],
      isPydanticModel,
      referencedModel: isPydanticModel ? base : null,
    };
  }

  /**
   * Handle Union type conversion.
   */
  private handleUnionType(
    parsed: ParsedType,
    context: ExtractionContext,
    depth: number
  ): TypeInfo {
    const members = parsed.unionMembers.length > 0
      ? parsed.unionMembers
      : parsed.args;

    // Filter out None for display
    const nonNoneMembers = members.filter(
      (m) => m.base !== 'None' && m.base !== 'NoneType'
    );

    // If single non-None member, return it as optional
    if (nonNoneMembers.length === 1 && parsed.isOptional) {
      const inner = this.parsedToTypeInfo(nonNoneMembers[0]!, context, depth + 1);
      return {
        ...inner,
        isOptional: true,
        raw: parsed.raw,
      };
    }

    // True union type
    return {
      raw: parsed.raw,
      base: 'union',
      args: nonNoneMembers.map((m) => this.parsedToTypeInfo(m, context, depth + 1)),
      isOptional: parsed.isOptional,
      isUnion: true,
      isList: false,
      isDict: false,
      isLiteral: false,
      literalValues: [],
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  /**
   * Handle Literal type conversion.
   */
  private handleLiteralType(parsed: ParsedType): TypeInfo {
    // Extract literal values from args
    const literalValues = parsed.args.map((arg) => {
      // Remove quotes from string literals
      const val = arg.base;
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
      }
      return val;
    });

    // Determine base type from first value
    const firstValue = literalValues[0];
    let base = 'string';
    if (firstValue !== undefined) {
      if (/^-?\d+$/.test(firstValue)) {base = 'number';}
      else if (firstValue === 'True' || firstValue === 'False') {base = 'boolean';}
    }

    return {
      raw: parsed.raw,
      base,
      args: [],
      isOptional: false,
      isUnion: false,
      isList: false,
      isDict: false,
      isLiteral: true,
      literalValues,
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  /**
   * Handle List/Sequence type conversion.
   */
  private handleListType(
    parsed: ParsedType,
    context: ExtractionContext,
    depth: number
  ): TypeInfo {
    const itemType = parsed.args[0];
    const itemInfo = itemType
      ? this.parsedToTypeInfo(itemType, context, depth + 1)
      : this.createUnknownType();

    return {
      raw: parsed.raw,
      base: 'array',
      args: [itemInfo],
      isOptional: parsed.isOptional,
      isUnion: false,
      isList: true,
      isDict: false,
      isLiteral: false,
      literalValues: [],
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  /**
   * Handle Dict/Mapping type conversion.
   */
  private handleDictType(
    parsed: ParsedType,
    context: ExtractionContext,
    depth: number
  ): TypeInfo {
    const keyType = parsed.args[0];
    const valueType = parsed.args[1];

    const keyInfo = keyType
      ? this.parsedToTypeInfo(keyType, context, depth + 1)
      : this.createUnknownType();
    const valueInfo = valueType
      ? this.parsedToTypeInfo(valueType, context, depth + 1)
      : this.createUnknownType();

    return {
      raw: parsed.raw,
      base: 'object',
      args: [keyInfo, valueInfo],
      isOptional: parsed.isOptional,
      isUnion: false,
      isList: false,
      isDict: true,
      isLiteral: false,
      literalValues: [],
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  /**
   * Handle Tuple type conversion.
   */
  private handleTupleType(
    parsed: ParsedType,
    context: ExtractionContext,
    depth: number
  ): TypeInfo {
    return {
      raw: parsed.raw,
      base: 'array',
      args: parsed.args.map((a) => this.parsedToTypeInfo(a, context, depth + 1)),
      isOptional: parsed.isOptional,
      isUnion: false,
      isList: true,
      isDict: false,
      isLiteral: false,
      literalValues: [],
      isPydanticModel: false,
      referencedModel: null,
    };
  }

  // ============================================
  // Type Classification Helpers
  // ============================================

  /**
   * Check if a type name is a list-like type.
   */
  private isListType(typeName: string): boolean {
    return [
      'List', 'list',
      'Sequence', 'MutableSequence',
      'Set', 'set', 'FrozenSet', 'frozenset',
      'Iterable', 'Iterator', 'Generator',
      'Collection', 'AbstractSet',
    ].includes(typeName);
  }

  /**
   * Check if a type name is a dict-like type.
   */
  private isDictType(typeName: string): boolean {
    return [
      'Dict', 'dict',
      'Mapping', 'MutableMapping',
      'OrderedDict', 'DefaultDict',
      'Counter', 'ChainMap',
    ].includes(typeName);
  }
}
