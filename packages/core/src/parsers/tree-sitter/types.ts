/**
 * Tree-sitter Type Definitions
 *
 * TypeScript types for tree-sitter integration, including
 * tree-sitter core types and Pydantic-specific types for
 * Python model extraction.
 *
 * @requirements 3.5 - Unified AST query interface
 */

import type { Position } from '../types.js';

// ============================================
// Tree-sitter Core Types
// ============================================

/**
 * Represents a tree-sitter syntax node.
 * This mirrors the tree-sitter Node interface.
 */
export interface TreeSitterNode {
  /** The type of the node (e.g., 'function_definition', 'class_definition') */
  type: string;
  /** The text content of the node */
  text: string;
  /** Start position in the source */
  startPosition: TreeSitterPoint;
  /** End position in the source */
  endPosition: TreeSitterPoint;
  /** Start byte offset in the source */
  startIndex: number;
  /** End byte offset in the source */
  endIndex: number;
  /** Whether this is a named node (vs anonymous) */
  isNamed: boolean;
  /** Whether this node has any errors */
  hasError: boolean;
  /** Whether this node is missing (error recovery) */
  isMissing: boolean;
  /** Child nodes */
  children: TreeSitterNode[];
  /** Named child nodes only */
  namedChildren: TreeSitterNode[];
  /** Number of children */
  childCount: number;
  /** Number of named children */
  namedChildCount: number;
  /** Parent node, if any */
  parent: TreeSitterNode | null;
  /** Next sibling node */
  nextSibling: TreeSitterNode | null;
  /** Previous sibling node */
  previousSibling: TreeSitterNode | null;
  /** Next named sibling node */
  nextNamedSibling: TreeSitterNode | null;
  /** Previous named sibling node */
  previousNamedSibling: TreeSitterNode | null;
  /** Get child by field name */
  childForFieldName(fieldName: string): TreeSitterNode | null;
  /** Get children by field name */
  childrenForFieldName(fieldName: string): TreeSitterNode[];
  /** Get the first child of a specific type */
  firstChildForType(type: string): TreeSitterNode | null;
  /** Get descendant for a position range */
  descendantForPosition(start: TreeSitterPoint, end?: TreeSitterPoint): TreeSitterNode;
  /** Get named descendant for a position range */
  namedDescendantForPosition(start: TreeSitterPoint, end?: TreeSitterPoint): TreeSitterNode;
  /** Walk the tree */
  walk(): TreeSitterTreeCursor;
}

/**
 * Represents a point (position) in tree-sitter.
 */
export interface TreeSitterPoint {
  /** Row (0-indexed line number) */
  row: number;
  /** Column (0-indexed character offset) */
  column: number;
}

/**
 * Represents a tree-sitter syntax tree.
 */
export interface TreeSitterTree {
  /** The root node of the tree */
  rootNode: TreeSitterNode;
  /** The language of the tree */
  language: TreeSitterLanguage;
  /** Walk the tree */
  walk(): TreeSitterTreeCursor;
  /** Edit the tree for incremental parsing */
  edit(edit: TreeSitterEdit): void;
  /** Get changed ranges after an edit */
  getChangedRanges(other: TreeSitterTree): TreeSitterRange[];
  /** Copy the tree */
  copy(): TreeSitterTree;
}

/**
 * Represents a tree-sitter parser.
 */
export interface TreeSitterParser {
  /** Set the language for parsing */
  setLanguage(language: TreeSitterLanguage): void;
  /** Get the current language */
  getLanguage(): TreeSitterLanguage | null;
  /** Parse source code */
  parse(input: string | TreeSitterInput, oldTree?: TreeSitterTree): TreeSitterTree;
  /** Reset the parser */
  reset(): void;
  /** Set timeout in microseconds */
  setTimeoutMicros(timeout: number): void;
  /** Get timeout in microseconds */
  getTimeoutMicros(): number;
  /** Set included ranges */
  setIncludedRanges(ranges: TreeSitterRange[]): void;
  /** Get included ranges */
  getIncludedRanges(): TreeSitterRange[];
}

/**
 * Represents a tree-sitter language.
 */
export interface TreeSitterLanguage {
  /** Language version */
  version: number;
  /** Number of node types */
  nodeTypeCount: number;
  /** Get node type name by ID */
  nodeTypeForId(id: number): string | null;
  /** Get node type ID by name */
  nodeTypeIdForName(name: string, isNamed: boolean): number | null;
  /** Number of fields */
  fieldCount: number;
  /** Get field name by ID */
  fieldNameForId(id: number): string | null;
  /** Get field ID by name */
  fieldIdForName(name: string): number | null;
}

/**
 * Represents a tree-sitter tree cursor for efficient traversal.
 */
export interface TreeSitterTreeCursor {
  /** Current node */
  currentNode: TreeSitterNode;
  /** Current field name */
  currentFieldName: string | null;
  /** Current field ID */
  currentFieldId: number;
  /** Go to parent */
  gotoParent(): boolean;
  /** Go to first child */
  gotoFirstChild(): boolean;
  /** Go to first child for a byte offset */
  gotoFirstChildForIndex(index: number): boolean;
  /** Go to next sibling */
  gotoNextSibling(): boolean;
  /** Reset to a node */
  reset(node: TreeSitterNode): void;
}

/**
 * Input function for incremental parsing.
 */
export type TreeSitterInput = (
  startIndex: number,
  startPoint: TreeSitterPoint | null,
  endIndex: number | null
) => string | null;

/**
 * Represents an edit for incremental parsing.
 */
export interface TreeSitterEdit {
  /** Start byte offset */
  startIndex: number;
  /** Old end byte offset */
  oldEndIndex: number;
  /** New end byte offset */
  newEndIndex: number;
  /** Start position */
  startPosition: TreeSitterPoint;
  /** Old end position */
  oldEndPosition: TreeSitterPoint;
  /** New end position */
  newEndPosition: TreeSitterPoint;
}

/**
 * Represents a range in the source.
 */
export interface TreeSitterRange {
  /** Start position */
  startPosition: TreeSitterPoint;
  /** End position */
  endPosition: TreeSitterPoint;
  /** Start byte offset */
  startIndex: number;
  /** End byte offset */
  endIndex: number;
}

/**
 * Represents a tree-sitter query.
 */
export interface TreeSitterQuery {
  /** Execute the query on a node */
  matches(node: TreeSitterNode, options?: TreeSitterQueryOptions): TreeSitterQueryMatch[];
  /** Execute the query and get captures */
  captures(node: TreeSitterNode, options?: TreeSitterQueryOptions): TreeSitterQueryCapture[];
  /** Pattern count */
  patternCount: number;
  /** Capture names */
  captureNames: string[];
}

/**
 * Options for query execution.
 */
export interface TreeSitterQueryOptions {
  /** Start position */
  startPosition?: TreeSitterPoint;
  /** End position */
  endPosition?: TreeSitterPoint;
  /** Start byte offset */
  startIndex?: number;
  /** End byte offset */
  endIndex?: number;
  /** Match limit */
  matchLimit?: number;
}

/**
 * Represents a query match.
 */
export interface TreeSitterQueryMatch {
  /** Pattern index */
  pattern: number;
  /** Captures in this match */
  captures: TreeSitterQueryCapture[];
}

/**
 * Represents a query capture.
 */
export interface TreeSitterQueryCapture {
  /** Capture name */
  name: string;
  /** Captured node */
  node: TreeSitterNode;
}

// ============================================
// Pydantic-specific Types
// ============================================

/**
 * Information about a Pydantic model.
 */
export interface PydanticModelInfo {
  /** Model class name */
  name: string;
  /** Base classes (e.g., BaseModel, BaseSettings) */
  bases: string[];
  /** Model fields */
  fields: PydanticFieldInfo[];
  /** Model validators */
  validators: PydanticValidatorInfo[];
  /** Model configuration (Config class or model_config) */
  config: PydanticConfigInfo | null;
  /** Decorators applied to the model */
  decorators: string[];
  /** Docstring if present */
  docstring: string | null;
  /** Whether this is a Pydantic v1 or v2 model */
  version: 1 | 2 | 'unknown';
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Information about a Pydantic field.
 */
export interface PydanticFieldInfo {
  /** Field name */
  name: string;
  /** Field type information */
  type: TypeInfo;
  /** Default value if any */
  defaultValue: string | null;
  /** Whether the field has a default */
  hasDefault: boolean;
  /** Whether the field uses Field() */
  usesField: boolean;
  /** Field constraints from Field() */
  constraints: FieldConstraints;
  /** Field alias if specified */
  alias: string | null;
  /** Field description if specified */
  description: string | null;
  /** Whether the field is required */
  required: boolean;
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Information about a type annotation.
 */
export interface TypeInfo {
  /** Raw type string as written in source */
  raw: string;
  /** Base type name (e.g., 'str', 'int', 'List') */
  base: string;
  /** Type arguments for generic types (e.g., ['str'] for List[str]) */
  args: TypeInfo[];
  /** Whether the type is Optional */
  isOptional: boolean;
  /** Whether the type is a Union */
  isUnion: boolean;
  /** Whether the type is a List/Sequence */
  isList: boolean;
  /** Whether the type is a Dict/Mapping */
  isDict: boolean;
  /** Whether the type is a literal type */
  isLiteral: boolean;
  /** Literal values if isLiteral is true */
  literalValues: string[];
  /** Whether the type references another Pydantic model */
  isPydanticModel: boolean;
  /** Referenced model name if isPydanticModel is true */
  referencedModel: string | null;
}

/**
 * Constraints that can be applied to a Pydantic field.
 */
export interface FieldConstraints {
  /** Minimum value for numeric types */
  ge: number | null;
  /** Maximum value for numeric types */
  le: number | null;
  /** Greater than (exclusive minimum) */
  gt: number | null;
  /** Less than (exclusive maximum) */
  lt: number | null;
  /** Minimum length for strings/sequences */
  minLength: number | null;
  /** Maximum length for strings/sequences */
  maxLength: number | null;
  /** Regex pattern for strings */
  pattern: string | null;
  /** Multiple of for numeric types */
  multipleOf: number | null;
  /** Whether the field is frozen (immutable) */
  frozen: boolean;
  /** Custom validation function names */
  validators: string[];
  /** JSON schema extra properties */
  jsonSchemaExtra: Record<string, unknown> | null;
}

/**
 * Information about a Pydantic validator.
 */
export interface PydanticValidatorInfo {
  /** Validator function name */
  name: string;
  /** Fields this validator applies to */
  fields: string[];
  /** Validator mode (before, after, wrap, plain) */
  mode: 'before' | 'after' | 'wrap' | 'plain' | 'unknown';
  /** Whether this is a field validator or model validator */
  type: 'field' | 'model' | 'root';
  /** Whether the validator is a classmethod */
  isClassmethod: boolean;
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Information about Pydantic model configuration.
 */
export interface PydanticConfigInfo {
  /** Whether extra fields are allowed */
  extra: 'allow' | 'forbid' | 'ignore' | null;
  /** Whether the model is frozen (immutable) */
  frozen: boolean | null;
  /** Whether to validate assignment */
  validateAssignment: boolean | null;
  /** Whether to use enum values */
  useEnumValues: boolean | null;
  /** Whether to validate default values */
  validateDefault: boolean | null;
  /** Whether to populate by name */
  populateByName: boolean | null;
  /** Arbitrary types allowed */
  arbitraryTypesAllowed: boolean | null;
  /** JSON schema extra */
  jsonSchemaExtra: Record<string, unknown> | null;
  /** All raw config values */
  raw: Record<string, unknown>;
}

// ============================================
// Parser Configuration Types
// ============================================

/**
 * Configuration options for the tree-sitter Python parser.
 */
export interface TreeSitterPythonParserConfig {
  /** Whether to extract Pydantic model information */
  extractPydanticModels: boolean;
  /** Maximum depth for type resolution */
  maxTypeDepth: number;
  /** Whether to include position information in extracted data */
  includePositions: boolean;
  /** Timeout for parsing in milliseconds (0 = no timeout) */
  parseTimeout: number;
  /** Whether to use incremental parsing when possible */
  useIncremental: boolean;
}

/**
 * Default configuration for tree-sitter Python parser.
 */
export const DEFAULT_TREE_SITTER_PYTHON_CONFIG: TreeSitterPythonParserConfig = {
  extractPydanticModels: true,
  maxTypeDepth: 10,
  includePositions: true,
  parseTimeout: 5000,
  useIncremental: true,
};
