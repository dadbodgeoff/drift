/**
 * C# AST Converter
 *
 * Converts tree-sitter AST nodes to drift's ASTNode format.
 * Preserves position information and handles all C# node types.
 *
 * @requirements 3.5 - Unified AST query interface
 */

import type { ASTNode, Position } from '../types.js';
import type { TreeSitterNode, TreeSitterPoint } from './types.js';

// ============================================
// Node Type Mapping
// ============================================

/**
 * Mapping of tree-sitter C# node types to drift node types.
 * This provides semantic normalization across different parsers.
 */
const NODE_TYPE_MAP: Record<string, string> = {
  // Compilation unit
  compilation_unit: 'Program',
  
  // Declarations
  class_declaration: 'ClassDeclaration',
  record_declaration: 'RecordDeclaration',
  struct_declaration: 'StructDeclaration',
  interface_declaration: 'InterfaceDeclaration',
  enum_declaration: 'EnumDeclaration',
  delegate_declaration: 'DelegateDeclaration',
  namespace_declaration: 'NamespaceDeclaration',
  file_scoped_namespace_declaration: 'NamespaceDeclaration',
  
  // Members
  method_declaration: 'MethodDeclaration',
  constructor_declaration: 'ConstructorDeclaration',
  destructor_declaration: 'DestructorDeclaration',
  property_declaration: 'PropertyDeclaration',
  field_declaration: 'FieldDeclaration',
  event_declaration: 'EventDeclaration',
  indexer_declaration: 'IndexerDeclaration',
  operator_declaration: 'OperatorDeclaration',
  conversion_operator_declaration: 'ConversionOperatorDeclaration',
  
  // Statements
  block: 'Block',
  local_declaration_statement: 'VariableDeclaration',
  expression_statement: 'ExpressionStatement',
  if_statement: 'IfStatement',
  switch_statement: 'SwitchStatement',
  while_statement: 'WhileStatement',
  do_statement: 'DoStatement',
  for_statement: 'ForStatement',
  foreach_statement: 'ForEachStatement',
  return_statement: 'ReturnStatement',
  throw_statement: 'ThrowStatement',
  try_statement: 'TryStatement',
  using_statement: 'UsingStatement',
  lock_statement: 'LockStatement',
  yield_statement: 'YieldStatement',
  break_statement: 'BreakStatement',
  continue_statement: 'ContinueStatement',
  goto_statement: 'GotoStatement',
  labeled_statement: 'LabeledStatement',
  checked_statement: 'CheckedStatement',
  unchecked_statement: 'UncheckedStatement',
  fixed_statement: 'FixedStatement',
  unsafe_statement: 'UnsafeStatement',
  local_function_statement: 'LocalFunctionStatement',

  // Expressions
  invocation_expression: 'CallExpression',
  member_access_expression: 'MemberExpression',
  element_access_expression: 'IndexExpression',
  object_creation_expression: 'NewExpression',
  array_creation_expression: 'ArrayExpression',
  anonymous_object_creation_expression: 'AnonymousObjectExpression',
  anonymous_method_expression: 'AnonymousMethodExpression',
  lambda_expression: 'ArrowFunctionExpression',
  assignment_expression: 'AssignmentExpression',
  binary_expression: 'BinaryExpression',
  unary_expression: 'UnaryExpression',
  prefix_unary_expression: 'PrefixUnaryExpression',
  postfix_unary_expression: 'PostfixUnaryExpression',
  conditional_expression: 'ConditionalExpression',
  cast_expression: 'CastExpression',
  await_expression: 'AwaitExpression',
  typeof_expression: 'TypeOfExpression',
  sizeof_expression: 'SizeOfExpression',
  nameof_expression: 'NameOfExpression',
  default_expression: 'DefaultExpression',
  checked_expression: 'CheckedExpression',
  unchecked_expression: 'UncheckedExpression',
  is_expression: 'IsExpression',
  as_expression: 'AsExpression',
  is_pattern_expression: 'IsPatternExpression',
  switch_expression: 'SwitchExpression',
  with_expression: 'WithExpression',
  range_expression: 'RangeExpression',
  index_expression: 'IndexExpression',
  throw_expression: 'ThrowExpression',
  ref_expression: 'RefExpression',
  tuple_expression: 'TupleExpression',
  parenthesized_expression: 'ParenthesizedExpression',
  interpolated_string_expression: 'TemplateLiteral',
  query_expression: 'QueryExpression',
  
  // Literals
  integer_literal: 'NumericLiteral',
  real_literal: 'NumericLiteral',
  character_literal: 'StringLiteral',
  string_literal: 'StringLiteral',
  verbatim_string_literal: 'StringLiteral',
  raw_string_literal: 'StringLiteral',
  boolean_literal: 'BooleanLiteral',
  null_literal: 'NullLiteral',
  
  // Types
  predefined_type: 'PredefinedType',
  identifier_name: 'Identifier',
  generic_name: 'GenericType',
  qualified_name: 'QualifiedName',
  alias_qualified_name: 'AliasQualifiedName',
  nullable_type: 'NullableType',
  array_type: 'ArrayType',
  tuple_type: 'TupleType',
  pointer_type: 'PointerType',
  function_pointer_type: 'FunctionPointerType',
  ref_type: 'RefType',
  
  // Attributes
  attribute_list: 'AttributeList',
  attribute: 'Attribute',
  attribute_argument_list: 'AttributeArgumentList',
  attribute_argument: 'AttributeArgument',
  
  // Parameters
  parameter_list: 'ParameterList',
  parameter: 'Parameter',
  type_parameter_list: 'TypeParameterList',
  type_parameter: 'TypeParameter',
  type_parameter_constraints_clause: 'TypeParameterConstraint',
  
  // Using directives
  using_directive: 'UsingDirective',
  global_attribute_list: 'GlobalAttributeList',
  extern_alias_directive: 'ExternAliasDirective',
  
  // Accessors
  accessor_list: 'AccessorList',
  accessor_declaration: 'AccessorDeclaration',
  
  // Patterns
  declaration_pattern: 'DeclarationPattern',
  constant_pattern: 'ConstantPattern',
  var_pattern: 'VarPattern',
  discard_pattern: 'DiscardPattern',
  recursive_pattern: 'RecursivePattern',
  positional_pattern_clause: 'PositionalPatternClause',
  property_pattern_clause: 'PropertyPatternClause',
  relational_pattern: 'RelationalPattern',
  negation_pattern: 'NegationPattern',
  and_pattern: 'AndPattern',
  or_pattern: 'OrPattern',
  type_pattern: 'TypePattern',
  parenthesized_pattern: 'ParenthesizedPattern',
  list_pattern: 'ListPattern',
  slice_pattern: 'SlicePattern',
  
  // Comments
  comment: 'Comment',
  
  // Misc
  argument_list: 'ArgumentList',
  argument: 'Argument',
  base_list: 'BaseList',
  type_argument_list: 'TypeArgumentList',
  initializer_expression: 'InitializerExpression',
  equals_value_clause: 'EqualsValueClause',
  arrow_expression_clause: 'ArrowExpressionClause',
  catch_clause: 'CatchClause',
  finally_clause: 'FinallyClause',
  when_clause: 'WhenClause',
  switch_section: 'SwitchSection',
  case_switch_label: 'CaseSwitchLabel',
  default_switch_label: 'DefaultSwitchLabel',
  case_pattern_switch_label: 'CasePatternSwitchLabel',
  switch_expression_arm: 'SwitchExpressionArm',
  interpolation: 'Interpolation',
  interpolation_alignment_clause: 'InterpolationAlignmentClause',
  interpolation_format_clause: 'InterpolationFormatClause',
};


// ============================================
// Conversion Options
// ============================================

/**
 * Options for AST conversion.
 */
export interface CSharpConversionOptions {
  /** Whether to include position information */
  includePositions: boolean;
  /** Whether to include anonymous nodes */
  includeAnonymous: boolean;
  /** Maximum depth to convert (0 = unlimited) */
  maxDepth: number;
}

/**
 * Default conversion options.
 */
export const DEFAULT_CSHARP_CONVERSION_OPTIONS: CSharpConversionOptions = {
  includePositions: true,
  includeAnonymous: false,
  maxDepth: 0,
};

// ============================================
// Conversion Functions
// ============================================

/**
 * Convert a tree-sitter point to drift Position.
 *
 * @param point - Tree-sitter point
 * @returns Drift Position
 */
export function convertCSharpPoint(point: TreeSitterPoint): Position {
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
export function convertCSharpNodeType(treeSitterType: string): string {
  return NODE_TYPE_MAP[treeSitterType] ?? treeSitterType;
}

/**
 * C# AST Converter class.
 *
 * Converts tree-sitter C# AST to drift's unified AST format.
 */
export class CSharpASTConverter {
  private options: CSharpConversionOptions;

  constructor(options: Partial<CSharpConversionOptions> = {}) {
    this.options = { ...DEFAULT_CSHARP_CONVERSION_OPTIONS, ...options };
  }

  /**
   * Convert a tree-sitter node to drift ASTNode.
   *
   * @param node - Tree-sitter node
   * @param depth - Current depth (for maxDepth limiting)
   * @returns Drift ASTNode
   */
  convert(node: TreeSitterNode, depth: number = 0): ASTNode {
    // Check depth limit
    if (this.options.maxDepth > 0 && depth >= this.options.maxDepth) {
      return this.createLeafNode(node);
    }

    // Convert children
    const children: ASTNode[] = [];
    for (const child of node.children) {
      // Skip anonymous nodes if configured
      if (!this.options.includeAnonymous && !child.isNamed) {
        continue;
      }
      children.push(this.convert(child, depth + 1));
    }

    return {
      type: convertCSharpNodeType(node.type),
      text: node.text,
      startPosition: this.options.includePositions
        ? convertCSharpPoint(node.startPosition)
        : { row: 0, column: 0 },
      endPosition: this.options.includePositions
        ? convertCSharpPoint(node.endPosition)
        : { row: 0, column: 0 },
      children,
    };
  }

  /**
   * Create a leaf node (no children converted).
   *
   * @param node - Tree-sitter node
   * @returns Drift ASTNode with no children
   */
  private createLeafNode(node: TreeSitterNode): ASTNode {
    return {
      type: convertCSharpNodeType(node.type),
      text: node.text,
      startPosition: this.options.includePositions
        ? convertCSharpPoint(node.startPosition)
        : { row: 0, column: 0 },
      endPosition: this.options.includePositions
        ? convertCSharpPoint(node.endPosition)
        : { row: 0, column: 0 },
      children: [],
    };
  }
}
