/**
 * Base Call Chain Normalizer
 *
 * Shared logic for all language-specific normalizers.
 * Provides common utilities for AST traversal and normalization.
 */

import type { TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  UnifiedLanguage,
  UnifiedCallChain,
  CallChainSegment,
  NormalizedArg,
  UnifiedFunction,
  UnifiedClass,
  UnifiedImport,
  UnifiedExport,
  UnifiedParameter,
  CallChainNormalizer,
} from '../types.js';

/**
 * Base normalizer with shared functionality
 */
export abstract class BaseNormalizer implements CallChainNormalizer {
  abstract readonly language: UnifiedLanguage;

  /**
   * Extract and normalize call chains from an AST node
   */
  abstract normalizeCallChains(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string
  ): UnifiedCallChain[];

  /**
   * Extract functions from an AST node
   */
  abstract extractFunctions(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string
  ): UnifiedFunction[];

  /**
   * Extract classes from an AST node
   */
  abstract extractClasses(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string
  ): UnifiedClass[];

  /**
   * Extract imports from an AST node
   */
  abstract extractImports(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string
  ): UnifiedImport[];

  /**
   * Extract exports from an AST node
   */
  abstract extractExports(
    rootNode: TreeSitterNode,
    source: string,
    filePath: string
  ): UnifiedExport[];

  // ============================================================================
  // Shared Utilities
  // ============================================================================

  /**
   * Create a call chain segment
   */
  protected createSegment(
    name: string,
    isCall: boolean,
    args: NormalizedArg[],
    line: number,
    column: number
  ): CallChainSegment {
    return { name, isCall, args, line, column };
  }

  /**
   * Create a unified call chain
   */
  protected createCallChain(
    receiver: string,
    segments: CallChainSegment[],
    fullExpression: string,
    file: string,
    line: number,
    column: number,
    endLine: number,
    endColumn: number,
    rawNode?: TreeSitterNode
  ): UnifiedCallChain {
    return {
      receiver,
      segments,
      fullExpression,
      file,
      line,
      column,
      endLine,
      endColumn,
      language: this.language,
      rawNode,
    };
  }

  /**
   * Create a normalized argument from a string literal
   */
  protected createStringArg(value: string, line: number, column: number): NormalizedArg {
    // Remove quotes
    const stringValue = value.replace(/^['"`]|['"`]$/g, '');
    return {
      type: 'string',
      value,
      stringValue,
      line,
      column,
    };
  }

  /**
   * Create a normalized argument from a number literal
   */
  protected createNumberArg(value: string, line: number, column: number): NormalizedArg {
    return {
      type: 'number',
      value,
      numberValue: parseFloat(value),
      line,
      column,
    };
  }

  /**
   * Create a normalized argument from a boolean literal
   */
  protected createBooleanArg(value: string, line: number, column: number): NormalizedArg {
    return {
      type: 'boolean',
      value,
      booleanValue: value.toLowerCase() === 'true',
      line,
      column,
    };
  }

  /**
   * Create a normalized argument from an identifier
   */
  protected createIdentifierArg(value: string, line: number, column: number): NormalizedArg {
    return {
      type: 'identifier',
      value,
      line,
      column,
    };
  }

  /**
   * Create a normalized argument from an object literal
   */
  protected createObjectArg(
    value: string,
    properties: Record<string, NormalizedArg>,
    line: number,
    column: number
  ): NormalizedArg {
    return {
      type: 'object',
      value,
      properties,
      line,
      column,
    };
  }

  /**
   * Create a normalized argument from an array literal
   */
  protected createArrayArg(
    value: string,
    elements: NormalizedArg[],
    line: number,
    column: number
  ): NormalizedArg {
    return {
      type: 'array',
      value,
      elements,
      line,
      column,
    };
  }

  /**
   * Create an unknown argument
   */
  protected createUnknownArg(value: string, line: number, column: number): NormalizedArg {
    return {
      type: 'unknown',
      value,
      line,
      column,
    };
  }

  /**
   * Create a unified function
   */
  protected createFunction(opts: {
    name: string;
    qualifiedName?: string | undefined;
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number | undefined;
    endColumn?: number | undefined;
    parameters?: UnifiedParameter[] | undefined;
    returnType?: string | undefined;
    isMethod?: boolean | undefined;
    isStatic?: boolean | undefined;
    isExported?: boolean | undefined;
    isConstructor?: boolean | undefined;
    isAsync?: boolean | undefined;
    className?: string | undefined;
    decorators?: string[] | undefined;
    bodyStartLine?: number | undefined;
    bodyEndLine?: number | undefined;
  }): UnifiedFunction {
    return {
      name: opts.name,
      qualifiedName: opts.qualifiedName ?? opts.name,
      file: opts.file,
      startLine: opts.startLine,
      endLine: opts.endLine,
      startColumn: opts.startColumn ?? 0,
      endColumn: opts.endColumn ?? 0,
      parameters: opts.parameters ?? [],
      returnType: opts.returnType,
      isMethod: opts.isMethod ?? false,
      isStatic: opts.isStatic ?? false,
      isExported: opts.isExported ?? false,
      isConstructor: opts.isConstructor ?? false,
      isAsync: opts.isAsync ?? false,
      className: opts.className,
      decorators: opts.decorators ?? [],
      bodyStartLine: opts.bodyStartLine ?? opts.startLine,
      bodyEndLine: opts.bodyEndLine ?? opts.endLine,
      language: this.language,
    };
  }

  /**
   * Create a unified class
   */
  protected createClass(opts: {
    name: string;
    file: string;
    startLine: number;
    endLine: number;
    baseClasses?: string[];
    methods?: string[];
    isExported?: boolean;
  }): UnifiedClass {
    return {
      name: opts.name,
      file: opts.file,
      startLine: opts.startLine,
      endLine: opts.endLine,
      baseClasses: opts.baseClasses ?? [],
      methods: opts.methods ?? [],
      isExported: opts.isExported ?? false,
      language: this.language,
    };
  }

  /**
   * Create a unified import
   */
  protected createImport(opts: {
    source: string;
    names: Array<{
      imported: string;
      local?: string;
      isDefault?: boolean;
      isNamespace?: boolean;
    }>;
    line: number;
    isTypeOnly?: boolean;
  }): UnifiedImport {
    return {
      source: opts.source,
      names: opts.names.map(n => ({
        imported: n.imported,
        local: n.local ?? n.imported,
        isDefault: n.isDefault ?? false,
        isNamespace: n.isNamespace ?? false,
      })),
      line: opts.line,
      isTypeOnly: opts.isTypeOnly ?? false,
      language: this.language,
    };
  }

  /**
   * Create a unified export
   */
  protected createExport(opts: {
    name: string;
    isDefault?: boolean | undefined;
    isReExport?: boolean | undefined;
    source?: string | undefined;
    line: number;
  }): UnifiedExport {
    return {
      name: opts.name,
      isDefault: opts.isDefault ?? false,
      isReExport: opts.isReExport ?? false,
      source: opts.source,
      line: opts.line,
      language: this.language,
    };
  }

  /**
   * Create a parameter
   */
  protected createParameter(
    name: string,
    type?: string,
    hasDefault = false,
    isRest = false
  ): UnifiedParameter {
    return { name, type, hasDefault, isRest };
  }

  // ============================================================================
  // AST Traversal Utilities
  // ============================================================================

  /**
   * Find all nodes of a specific type
   */
  protected findNodesOfType(node: TreeSitterNode, types: string[]): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];
    this.traverseNode(node, n => {
      if (types.includes(n.type)) {
        results.push(n);
      }
    });
    return results;
  }

  /**
   * Traverse all nodes in the tree
   */
  protected traverseNode(node: TreeSitterNode, callback: (node: TreeSitterNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.traverseNode(child, callback);
    }
  }

  /**
   * Get child by field name (type-safe wrapper)
   */
  protected getChildByField(node: TreeSitterNode, fieldName: string): TreeSitterNode | null {
    return node.childForFieldName(fieldName) ?? null;
  }

  /**
   * Get all children of a specific type
   */
  protected getChildrenOfType(node: TreeSitterNode, type: string): TreeSitterNode[] {
    return node.children.filter(c => c.type === type);
  }

  /**
   * Check if node has a specific child type
   */
  protected hasChildOfType(node: TreeSitterNode, type: string): boolean {
    return node.children.some(c => c.type === type);
  }

  /**
   * Get text content of a node, handling null
   */
  protected getNodeText(node: TreeSitterNode | null): string {
    return node?.text ?? '';
  }

  /**
   * Get position info from a node
   */
  protected getPosition(node: TreeSitterNode): { line: number; column: number } {
    return {
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    };
  }

  /**
   * Get end position info from a node
   */
  protected getEndPosition(node: TreeSitterNode): { line: number; column: number } {
    return {
      line: node.endPosition.row + 1,
      column: node.endPosition.column,
    };
  }

  // ============================================================================
  // String Extraction Utilities
  // ============================================================================

  /**
   * Extract string value from various string node types
   */
  protected extractStringValue(node: TreeSitterNode): string | null {
    const type = node.type;

    // Common string types across languages
    if (type === 'string' || type === 'string_literal' ||
        type === 'interpreted_string_literal' || type === 'raw_string_literal') {
      return this.unquoteString(node.text);
    }

    // Template strings
    if (type === 'template_string' || type === 'template_literal') {
      return this.unquoteString(node.text);
    }

    // Python strings
    if (type === 'string_content') {
      return node.text;
    }

    // Check for string child
    const stringChild = node.children.find(c =>
      c.type === 'string_content' ||
      c.type === 'string_fragment' ||
      c.type === 'escape_sequence'
    );
    if (stringChild) {
      return stringChild.text;
    }

    return null;
  }

  /**
   * Remove quotes from a string
   */
  protected unquoteString(str: string): string {
    // Handle triple quotes (Python)
    if (str.startsWith('"""') || str.startsWith("'''")) {
      return str.slice(3, -3);
    }
    // Handle single/double quotes and backticks
    if (str.startsWith('"') || str.startsWith("'") || str.startsWith('`')) {
      return str.slice(1, -1);
    }
    return str;
  }

  /**
   * Check if a string looks like a table name
   */
  protected looksLikeTableName(str: string): boolean {
    // Table names are typically lowercase, snake_case, and don't contain spaces
    return /^[a-z][a-z0-9_]*$/i.test(str) && !str.includes(' ');
  }

  /**
   * Infer table name from a variable/class name
   */
  protected inferTableName(name: string): string {
    // Common patterns: userRepository -> users, UserModel -> users
    const cleaned = name
      .replace(/Repository$/i, '')
      .replace(/Model$/i, '')
      .replace(/Service$/i, '')
      .replace(/DAO$/i, '')
      .replace(/Entity$/i, '')
      .replace(/^_+/, '');

    // Convert to snake_case
    const snakeCase = cleaned
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');

    // Simple pluralization
    if (!snakeCase.endsWith('s')) {
      return snakeCase + 's';
    }
    return snakeCase;
  }
}
