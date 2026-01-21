/**
 * Pydantic Module Types
 *
 * Type definitions specific to Pydantic model extraction.
 * Extends the base types with additional extraction-specific interfaces.
 *
 * @module pydantic/types
 */

import type { Position } from '../../types.js';
import type { TreeSitterNode } from '../types.js';

// ============================================
// Extraction Context
// ============================================

/**
 * Context passed during extraction operations.
 * Contains shared state and configuration.
 */
export interface ExtractionContext {
  /** Source code being parsed */
  source: string;
  /** Maximum depth for type resolution */
  maxTypeDepth: number;
  /** Known model names in the file */
  knownModels: Set<string>;
  /** Type aliases defined in the file */
  typeAliases: Map<string, string>;
  /** Import mappings (alias -> full path) */
  imports: Map<string, string>;
  /** Whether to include position information */
  includePositions: boolean;
}

/**
 * Create a default extraction context.
 */
export function createExtractionContext(
  source: string,
  options: Partial<ExtractionContext> = {}
): ExtractionContext {
  return {
    source,
    maxTypeDepth: options.maxTypeDepth ?? 10,
    knownModels: options.knownModels ?? new Set(),
    typeAliases: options.typeAliases ?? new Map(),
    imports: options.imports ?? new Map(),
    includePositions: options.includePositions ?? true,
  };
}

// ============================================
// Field Extraction Types
// ============================================

/**
 * Raw field data extracted from AST before processing.
 */
export interface RawFieldData {
  /** Field name */
  name: string;
  /** Raw type annotation string */
  typeAnnotation: string | null;
  /** Default value expression */
  defaultValue: string | null;
  /** Whether Field() is used */
  usesField: boolean;
  /** Field() arguments if present */
  fieldArguments: FieldArgument[];
  /** AST node for the field */
  node: TreeSitterNode;
}

/**
 * A single argument from Field() call.
 */
export interface FieldArgument {
  /** Argument name (null for positional) */
  name: string | null;
  /** Argument value as string */
  value: string;
  /** Whether this is a keyword argument */
  isKeyword: boolean;
}

// ============================================
// Type Resolution Types
// ============================================

/**
 * Result of parsing a type annotation.
 */
export interface ParsedType {
  /** The base type name */
  base: string;
  /** Generic type arguments */
  args: ParsedType[];
  /** Original raw string */
  raw: string;
  /** Whether wrapped in Optional */
  isOptional: boolean;
  /** Whether this is a Union type */
  isUnion: boolean;
  /** Union members if isUnion */
  unionMembers: ParsedType[];
}

/**
 * Python to contract type mapping.
 */
export const PYTHON_TYPE_MAP: Record<string, string> = {
  // Primitives
  str: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  bytes: 'string',
  
  // None/null
  None: 'null',
  NoneType: 'null',
  
  // Collections
  list: 'array',
  List: 'array',
  tuple: 'array',
  Tuple: 'array',
  set: 'array',
  Set: 'array',
  frozenset: 'array',
  FrozenSet: 'array',
  Sequence: 'array',
  Iterable: 'array',
  
  // Mappings
  dict: 'object',
  Dict: 'object',
  Mapping: 'object',
  MutableMapping: 'object',
  
  // Any
  Any: 'any',
  object: 'any',
  
  // Date/time (serialized as strings)
  date: 'string',
  datetime: 'string',
  time: 'string',
  timedelta: 'string',
  
  // Other common types
  UUID: 'string',
  Decimal: 'number',
  Path: 'string',
  EmailStr: 'string',
  HttpUrl: 'string',
  AnyUrl: 'string',
  SecretStr: 'string',
  SecretBytes: 'string',
  Json: 'any',
};

// ============================================
// Constraint Types
// ============================================

/**
 * Numeric constraint names.
 */
export const NUMERIC_CONSTRAINTS = ['ge', 'le', 'gt', 'lt', 'multiple_of'] as const;
export type NumericConstraint = typeof NUMERIC_CONSTRAINTS[number];

/**
 * String constraint names.
 */
export const STRING_CONSTRAINTS = ['min_length', 'max_length', 'pattern', 'regex'] as const;
export type StringConstraint = typeof STRING_CONSTRAINTS[number];

/**
 * All constraint names.
 */
export const ALL_CONSTRAINTS = [
  ...NUMERIC_CONSTRAINTS,
  ...STRING_CONSTRAINTS,
  'alias',
  'title',
  'description',
  'examples',
  'deprecated',
  'frozen',
  'exclude',
  'include',
  'discriminator',
  'json_schema_extra',
  'strict',
  'default',
  'default_factory',
] as const;

// ============================================
// Validator Types
// ============================================

/**
 * Validator decorator types.
 */
export type ValidatorDecoratorType = 
  | 'validator'           // Pydantic v1
  | 'root_validator'      // Pydantic v1
  | 'field_validator'     // Pydantic v2
  | 'model_validator'     // Pydantic v2
  | 'computed_field';     // Pydantic v2

/**
 * Validator mode for v2 validators.
 */
export type ValidatorMode = 'before' | 'after' | 'wrap' | 'plain';

/**
 * Raw validator data from AST.
 */
export interface RawValidatorData {
  /** Function name */
  name: string;
  /** Decorator type */
  decoratorType: ValidatorDecoratorType;
  /** Fields this validator applies to (for field validators) */
  fields: string[];
  /** Validator mode */
  mode: ValidatorMode | null;
  /** Whether pre=True (v1) */
  isPre: boolean;
  /** Whether always=True (v1) */
  isAlways: boolean;
  /** Whether check_fields=False */
  skipOnFailure: boolean;
  /** AST node */
  node: TreeSitterNode;
}

// ============================================
// Config Types
// ============================================

/**
 * Raw config data from AST.
 */
export interface RawConfigData {
  /** Whether this is v1 Config class or v2 model_config */
  version: 1 | 2;
  /** Config values as key-value pairs */
  values: Map<string, ConfigValue>;
  /** AST node */
  node: TreeSitterNode;
}

/**
 * A config value (can be various types).
 */
export interface ConfigValue {
  /** Raw string representation */
  raw: string;
  /** Parsed value if simple type */
  parsed: string | number | boolean | null;
  /** Whether this is a complex expression */
  isComplex: boolean;
}

// ============================================
// Inheritance Types
// ============================================

/**
 * Information about a base class.
 */
export interface BaseClassInfo {
  /** Base class name */
  name: string;
  /** Full qualified name if available */
  fullName: string | null;
  /** Generic type arguments if any */
  typeArgs: string[];
  /** Whether this is a Pydantic base */
  isPydanticBase: boolean;
  /** Whether this is Generic[T] */
  isGeneric: boolean;
}

/**
 * Known Pydantic base classes.
 */
export const PYDANTIC_BASE_CLASSES = new Set([
  'BaseModel',
  'BaseSettings',
  'GenericModel',
  'pydantic.BaseModel',
  'pydantic.BaseSettings',
  'pydantic.generics.GenericModel',
]);

// ============================================
// Position Helpers
// ============================================

/**
 * Extract position from a tree-sitter node.
 */
export function extractPosition(node: TreeSitterNode): Position {
  return {
    row: node.startPosition.row,
    column: node.startPosition.column,
  };
}

/**
 * Extract start and end positions from a node.
 */
export function extractPositionRange(node: TreeSitterNode): {
  startPosition: Position;
  endPosition: Position;
} {
  return {
    startPosition: {
      row: node.startPosition.row,
      column: node.startPosition.column,
    },
    endPosition: {
      row: node.endPosition.row,
      column: node.endPosition.column,
    },
  };
}
