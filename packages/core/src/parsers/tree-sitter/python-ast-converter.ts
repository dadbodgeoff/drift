/**
 * Python AST Converter
 *
 * Converts tree-sitter AST nodes to drift's ASTNode format.
 * Preserves position information and handles all Python node types.
 *
 * @requirements 3.5 - Unified AST query interface
 */

import type { ASTNode, AST, Position } from '../types.js';
import type { TreeSitterNode, TreeSitterTree, TreeSitterPoint } from './types.js';

/**
 * Mapping of tree-sitter Python node types to drift node types.
 * This provides semantic normalization across different parsers.
 */
const NODE_TYPE_MAP: Record<string, string> = {
  // Module level
  module: 'Module',

  // Imports
  import_statement: 'Import',
  import_from_statement: 'ImportFrom',
  aliased_import: 'alias',
  dotted_name: 'module',
  relative_import: 'relative_import',

  // Definitions
  function_definition: 'FunctionDef',
  async_function_definition: 'AsyncFunctionDef',
  class_definition: 'ClassDef',
  decorated_definition: 'decorated',

  // Function components
  parameters: 'arguments',
  default_parameter: 'arg',
  typed_parameter: 'arg',
  typed_default_parameter: 'arg',
  list_splat_pattern: 'arg',
  dictionary_splat_pattern: 'arg',
  keyword_separator: 'keyword_separator',
  positional_separator: 'positional_separator',

  // Statements
  expression_statement: 'Expr',
  return_statement: 'Return',
  pass_statement: 'Pass',
  break_statement: 'Break',
  continue_statement: 'Continue',
  raise_statement: 'Raise',
  assert_statement: 'Assert',
  global_statement: 'Global',
  nonlocal_statement: 'Nonlocal',
  delete_statement: 'Delete',

  // Control flow
  if_statement: 'If',
  elif_clause: 'elif',
  else_clause: 'else',
  for_statement: 'For',
  while_statement: 'While',
  try_statement: 'Try',
  except_clause: 'ExceptHandler',
  finally_clause: 'finally',
  with_statement: 'With',
  with_clause: 'withitem',
  match_statement: 'Match',
  case_clause: 'match_case',

  // Expressions
  assignment: 'Assign',
  augmented_assignment: 'AugAssign',
  named_expression: 'NamedExpr',
  binary_operator: 'BinOp',
  unary_operator: 'UnaryOp',
  comparison_operator: 'Compare',
  boolean_operator: 'BoolOp',
  not_operator: 'Not',
  lambda: 'Lambda',
  conditional_expression: 'IfExp',
  await: 'Await',
  yield: 'Yield',

  // Subscripts and attributes
  subscript: 'Subscript',
  slice: 'Slice',
  attribute: 'Attribute',

  // Calls
  call: 'Call',
  argument_list: 'arguments',
  keyword_argument: 'keyword',

  // Comprehensions
  list_comprehension: 'ListComp',
  dictionary_comprehension: 'DictComp',
  set_comprehension: 'SetComp',
  generator_expression: 'GeneratorExp',
  for_in_clause: 'comprehension',
  if_clause: 'comp_if',

  // Literals
  string: 'Str',
  concatenated_string: 'JoinedStr',
  integer: 'Num',
  float: 'Num',
  true: 'NameConstant',
  false: 'NameConstant',
  none: 'NameConstant',

  // Collections
  list: 'List',
  tuple: 'Tuple',
  dictionary: 'Dict',
  set: 'Set',
  pair: 'dict_item',

  // Identifiers and names
  identifier: 'Name',
  type: 'annotation',

  // Decorators
  decorator: 'decorator',

  // Comments and docstrings
  comment: 'Comment',
  expression_statement_string: 'Docstring',
};

/**
 * Options for AST conversion.
 */
export interface ConversionOptions {
  /** Whether to include anonymous nodes */
  includeAnonymous: boolean;
  /** Whether to include comment nodes */
  includeComments: boolean;
  /** Maximum depth to traverse (0 = unlimited) */
  maxDepth: number;
  /** Node types to skip */
  skipTypes: Set<string>;
}

/**
 * Default conversion options.
 */
export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  includeAnonymous: false,
  includeComments: true,
  maxDepth: 0,
  skipTypes: new Set(['ERROR']),
};

/**
 * Convert a tree-sitter point to drift Position.
 *
 * @param point - Tree-sitter point
 * @returns Drift Position
 */
export function convertPoint(point: TreeSitterPoint): Position {
  return {
    row: point.row,
    column: point.column,
  };
}

/**
 * Convert a tree-sitter node type to drift node type.
 *
 * @param treeSitterType - Tree-sitter node type
 * @returns Drift node type
 */
export function convertNodeType(treeSitterType: string): string {
  return NODE_TYPE_MAP[treeSitterType] ?? treeSitterType;
}

/**
 * Python AST Converter class.
 *
 * Converts tree-sitter Python AST to drift's unified AST format.
 */
export class PythonASTConverter {
  private readonly options: ConversionOptions;

  constructor(options: Partial<ConversionOptions> = {}) {
    this.options = { ...DEFAULT_CONVERSION_OPTIONS, ...options };
  }

  /**
   * Convert a tree-sitter tree to drift AST.
   *
   * @param tree - Tree-sitter tree
   * @param source - Original source code
   * @returns Drift AST
   */
  convertTree(tree: TreeSitterTree, source: string): AST {
    const rootNode = this.convertNode(tree.rootNode, source, 0);
    return {
      rootNode,
      text: source,
    };
  }

  /**
   * Convert a tree-sitter node to drift ASTNode.
   *
   * @param node - Tree-sitter node
   * @param source - Original source code
   * @param depth - Current depth in the tree
   * @returns Drift ASTNode
   */
  convertNode(node: TreeSitterNode, source: string, depth: number = 0): ASTNode {
    // Check depth limit
    if (this.options.maxDepth > 0 && depth >= this.options.maxDepth) {
      return this.createLeafNode(node, source);
    }

    // Skip certain node types
    if (this.options.skipTypes.has(node.type)) {
      return this.createErrorNode(node);
    }

    // Convert children
    const children: ASTNode[] = [];
    const childNodes = this.options.includeAnonymous ? node.children : node.namedChildren;

    for (const child of childNodes) {
      // Skip comments if not included
      if (!this.options.includeComments && child.type === 'comment') {
        continue;
      }

      // Skip error nodes
      if (this.options.skipTypes.has(child.type)) {
        continue;
      }

      children.push(this.convertNode(child, source, depth + 1));
    }

    return {
      type: convertNodeType(node.type),
      text: node.text,
      startPosition: convertPoint(node.startPosition),
      endPosition: convertPoint(node.endPosition),
      children,
    };
  }

  /**
   * Create a leaf node (no children converted).
   */
  private createLeafNode(node: TreeSitterNode, _source: string): ASTNode {
    return {
      type: convertNodeType(node.type),
      text: node.text,
      startPosition: convertPoint(node.startPosition),
      endPosition: convertPoint(node.endPosition),
      children: [],
    };
  }

  /**
   * Create an error placeholder node.
   */
  private createErrorNode(node: TreeSitterNode): ASTNode {
    return {
      type: 'ERROR',
      text: node.text,
      startPosition: convertPoint(node.startPosition),
      endPosition: convertPoint(node.endPosition),
      children: [],
    };
  }

  /**
   * Convert a specific node by field name.
   *
   * @param node - Parent tree-sitter node
   * @param fieldName - Field name to extract
   * @param source - Original source code
   * @param depth - Current depth
   * @returns Converted node or null if field doesn't exist
   */
  convertField(
    node: TreeSitterNode,
    fieldName: string,
    source: string,
    depth: number = 0
  ): ASTNode | null {
    const fieldNode = node.childForFieldName(fieldName);
    if (!fieldNode) {
      return null;
    }
    return this.convertNode(fieldNode, source, depth);
  }

  /**
   * Convert all nodes for a field name.
   *
   * @param node - Parent tree-sitter node
   * @param fieldName - Field name to extract
   * @param source - Original source code
   * @param depth - Current depth
   * @returns Array of converted nodes
   */
  convertFieldAll(
    node: TreeSitterNode,
    fieldName: string,
    source: string,
    depth: number = 0
  ): ASTNode[] {
    const fieldNodes = node.childrenForFieldName(fieldName);
    return fieldNodes.map((n) => this.convertNode(n, source, depth));
  }

  /**
   * Find all nodes of a specific type in a tree-sitter tree.
   *
   * @param node - Root node to search from
   * @param type - Node type to find
   * @returns Array of matching tree-sitter nodes
   */
  findNodesByType(node: TreeSitterNode, type: string): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];
    this.walkTree(node, (n) => {
      if (n.type === type) {
        results.push(n);
      }
    });
    return results;
  }

  /**
   * Find all nodes matching a predicate.
   *
   * @param node - Root node to search from
   * @param predicate - Function to test each node
   * @returns Array of matching tree-sitter nodes
   */
  findNodes(
    node: TreeSitterNode,
    predicate: (n: TreeSitterNode) => boolean
  ): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];
    this.walkTree(node, (n) => {
      if (predicate(n)) {
        results.push(n);
      }
    });
    return results;
  }

  /**
   * Walk the tree and call a visitor for each node.
   *
   * @param node - Root node to walk from
   * @param visitor - Function called for each node
   */
  walkTree(node: TreeSitterNode, visitor: (n: TreeSitterNode) => void): void {
    visitor(node);
    for (const child of node.children) {
      this.walkTree(child, visitor);
    }
  }

  /**
   * Get the text of a specific field from a node.
   *
   * @param node - Tree-sitter node
   * @param fieldName - Field name
   * @returns Field text or null
   */
  getFieldText(node: TreeSitterNode, fieldName: string): string | null {
    const fieldNode = node.childForFieldName(fieldName);
    return fieldNode?.text ?? null;
  }

  /**
   * Extract function information from a function_definition node.
   *
   * @param node - Tree-sitter function_definition node
   * @returns Function information object
   */
  extractFunctionInfo(node: TreeSitterNode): {
    name: string;
    parameters: string[];
    returnType: string | null;
    isAsync: boolean;
    decorators: string[];
  } {
    const name = this.getFieldText(node, 'name') ?? '';
    const returnType = this.getFieldText(node, 'return_type');
    const isAsync = node.type === 'async_function_definition';

    // Extract parameters
    const parameters: string[] = [];
    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      for (const child of paramsNode.namedChildren) {
        if (child.type === 'identifier') {
          parameters.push(child.text);
        } else if (
          child.type === 'typed_parameter' ||
          child.type === 'default_parameter' ||
          child.type === 'typed_default_parameter'
        ) {
          const paramName = child.childForFieldName('name');
          if (paramName) {
            parameters.push(paramName.text);
          }
        } else if (
          child.type === 'list_splat_pattern' ||
          child.type === 'dictionary_splat_pattern'
        ) {
          parameters.push(child.text);
        }
      }
    }

    // Extract decorators (need to look at parent if decorated)
    const decorators: string[] = [];
    const parent = node.parent;
    if (parent?.type === 'decorated_definition') {
      for (const child of parent.namedChildren) {
        if (child.type === 'decorator') {
          const decoratorName = child.namedChildren[0];
          if (decoratorName) {
            decorators.push(decoratorName.text);
          }
        }
      }
    }

    return { name, parameters, returnType, isAsync, decorators };
  }
}
