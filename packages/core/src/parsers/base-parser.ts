/**
 * Base Parser - Abstract parser interface
 *
 * Defines the common interface for all language parsers.
 * Provides a unified AST query interface across all languages.
 *
 * @requirements 3.5
 */

import type { AST, ASTNode, Language, ParseError, ParseResult, Position } from './types.js';

/**
 * Options for parsing source code
 */
export interface ParseOptions {
  /** Optional file path for error reporting */
  filePath?: string;
  /** Whether to include comments in the AST */
  includeComments?: boolean;
  /** Whether to perform incremental parsing */
  incremental?: boolean;
  /** Previous AST for incremental parsing */
  previousAst?: AST;
}

/**
 * Options for querying the AST
 */
export interface QueryOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Whether to include nested matches */
  includeNested?: boolean;
  /** Starting position for the search */
  startPosition?: Position;
  /** Ending position for the search */
  endPosition?: Position;
}

/**
 * Result of an AST traversal
 */
export interface TraversalResult {
  /** The visited node */
  node: ASTNode;
  /** Parent node, if any */
  parent: ASTNode | null;
  /** Depth in the tree */
  depth: number;
  /** Path from root to this node (indices) */
  path: number[];
}

/**
 * Visitor function for AST traversal
 */
export type ASTVisitor = (result: TraversalResult) => boolean | void;

/**
 * Abstract base class for all language parsers.
 *
 * Provides a unified interface for parsing source code and querying ASTs
 * across different languages. Concrete implementations should extend this
 * class and implement the abstract methods.
 *
 * @requirements 3.5 - Unified AST query interface across all languages
 */
export abstract class BaseParser {
  /**
   * The language this parser handles
   */
  abstract readonly language: Language;

  /**
   * File extensions this parser can handle
   */
  abstract readonly extensions: string[];

  /**
   * Parse source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns ParseResult containing the AST or errors
   *
   * @requirements 3.5
   */
  abstract parse(source: string, filePath?: string): ParseResult;

  /**
   * Parse source code with additional options.
   *
   * @param source - The source code to parse
   * @param options - Parsing options
   * @returns ParseResult containing the AST or errors
   */
  parseWithOptions(source: string, options: ParseOptions = {}): ParseResult {
    return this.parse(source, options.filePath);
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * The pattern syntax depends on the parser implementation but typically
   * supports Tree-sitter query syntax or similar.
   *
   * @param ast - The AST to query
   * @param pattern - The query pattern (e.g., Tree-sitter query string)
   * @returns Array of matching AST nodes
   *
   * @requirements 3.5
   */
  abstract query(ast: AST, pattern: string): ASTNode[];

  /**
   * Query the AST with additional options.
   *
   * @param ast - The AST to query
   * @param pattern - The query pattern
   * @param options - Query options
   * @returns Array of matching AST nodes
   */
  queryWithOptions(ast: AST, pattern: string, options: QueryOptions = {}): ASTNode[] {
    let results = this.query(ast, pattern);

    // Apply position filtering
    if (options.startPosition || options.endPosition) {
      results = results.filter((node) => {
        if (options.startPosition) {
          if (
            node.endPosition.row < options.startPosition.row ||
            (node.endPosition.row === options.startPosition.row &&
              node.endPosition.column < options.startPosition.column)
          ) {
            return false;
          }
        }
        if (options.endPosition) {
          if (
            node.startPosition.row > options.endPosition.row ||
            (node.startPosition.row === options.endPosition.row &&
              node.startPosition.column > options.endPosition.column)
          ) {
            return false;
          }
        }
        return true;
      });
    }

    // Apply limit
    if (options.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Check if this parser can handle the given file extension.
   *
   * @param extension - File extension (with or without leading dot)
   * @returns true if this parser can handle the extension
   */
  canHandle(extension: string): boolean {
    const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    return this.extensions.includes(normalizedExt.toLowerCase());
  }

  // ============================================
  // AST Traversal Utilities
  // ============================================

  /**
   * Traverse the AST depth-first, calling the visitor for each node.
   *
   * @param ast - The AST to traverse
   * @param visitor - Function called for each node. Return false to stop traversal.
   */
  traverse(ast: AST, visitor: ASTVisitor): void {
    this.traverseNode(ast.rootNode, null, 0, [], visitor);
  }

  /**
   * Internal recursive traversal helper.
   */
  private traverseNode(
    node: ASTNode,
    parent: ASTNode | null,
    depth: number,
    path: number[],
    visitor: ASTVisitor
  ): boolean {
    const result = visitor({ node, parent, depth, path });

    // If visitor returns false, stop traversal
    if (result === false) {
      return false;
    }

    // Traverse children
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) {
        const shouldContinue = this.traverseNode(child, node, depth + 1, [...path, i], visitor);
        if (!shouldContinue) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Find all nodes of a specific type in the AST.
   *
   * @param ast - The AST to search
   * @param nodeType - The type of node to find
   * @returns Array of matching nodes
   */
  findNodesByType(ast: AST, nodeType: string): ASTNode[] {
    const results: ASTNode[] = [];

    this.traverse(ast, ({ node }) => {
      if (node.type === nodeType) {
        results.push(node);
      }
    });

    return results;
  }

  /**
   * Find the first node of a specific type in the AST.
   *
   * @param ast - The AST to search
   * @param nodeType - The type of node to find
   * @returns The first matching node, or null if not found
   */
  findFirstNodeByType(ast: AST, nodeType: string): ASTNode | null {
    let result: ASTNode | null = null;

    this.traverse(ast, ({ node }): boolean | void => {
      if (node.type === nodeType) {
        result = node;
        return false; // Stop traversal
      }
      return undefined;
    });

    return result;
  }

  /**
   * Find the node at a specific position in the source.
   *
   * @param ast - The AST to search
   * @param position - The position to find
   * @returns The most specific node at that position, or null
   */
  findNodeAtPosition(ast: AST, position: Position): ASTNode | null {
    let result: ASTNode | null = null;

    this.traverse(ast, ({ node }) => {
      if (this.positionInRange(position, node.startPosition, node.endPosition)) {
        result = node; // Keep updating to get the most specific (deepest) node
      }
    });

    return result;
  }

  /**
   * Get the parent chain from root to a specific node.
   *
   * @param ast - The AST to search
   * @param targetNode - The node to find parents for
   * @returns Array of parent nodes from root to immediate parent
   */
  getParentChain(ast: AST, targetNode: ASTNode): ASTNode[] {
    const parents: ASTNode[] = [];
    let found = false;

    const findParents = (node: ASTNode, chain: ASTNode[]): boolean => {
      if (node === targetNode) {
        parents.push(...chain);
        found = true;
        return false;
      }

      for (const child of node.children) {
        if (findParents(child, [...chain, node])) {
          return true;
        }
      }

      return found;
    };

    findParents(ast.rootNode, []);
    return parents;
  }

  /**
   * Get all descendants of a node.
   *
   * @param node - The node to get descendants of
   * @returns Array of all descendant nodes
   */
  getDescendants(node: ASTNode): ASTNode[] {
    const descendants: ASTNode[] = [];

    const collect = (n: ASTNode): void => {
      for (const child of n.children) {
        descendants.push(child);
        collect(child);
      }
    };

    collect(node);
    return descendants;
  }

  /**
   * Get siblings of a node (nodes with the same parent).
   *
   * @param ast - The AST containing the node
   * @param node - The node to get siblings for
   * @returns Array of sibling nodes (excluding the node itself)
   */
  getSiblings(ast: AST, node: ASTNode): ASTNode[] {
    const parents = this.getParentChain(ast, node);
    if (parents.length === 0) {
      return []; // Root node has no siblings
    }

    const parent = parents[parents.length - 1];
    if (!parent) {
      return [];
    }
    return parent.children.filter((child) => child !== node);
  }

  // ============================================
  // Error Handling Utilities
  // ============================================

  /**
   * Create a parse error object.
   *
   * @param message - Error message
   * @param position - Position where the error occurred
   * @returns ParseError object
   */
  protected createError(message: string, position: Position): ParseError {
    return { message, position };
  }

  /**
   * Create a successful parse result.
   *
   * @param ast - The parsed AST
   * @returns ParseResult with success=true
   */
  protected createSuccessResult(ast: AST): ParseResult {
    return {
      ast,
      language: this.language,
      errors: [],
      success: true,
    };
  }

  /**
   * Create a failed parse result.
   *
   * @param errors - Array of parse errors
   * @returns ParseResult with success=false
   */
  protected createFailureResult(errors: ParseError[]): ParseResult {
    return {
      ast: null,
      language: this.language,
      errors,
      success: false,
    };
  }

  /**
   * Create a partial success result (parsed with errors).
   *
   * @param ast - The partially parsed AST
   * @param errors - Array of parse errors
   * @returns ParseResult with success=true but containing errors
   */
  protected createPartialResult(ast: AST, errors: ParseError[]): ParseResult {
    return {
      ast,
      language: this.language,
      errors,
      success: true,
    };
  }

  // ============================================
  // Position Utilities
  // ============================================

  /**
   * Check if a position is within a range.
   *
   * @param position - The position to check
   * @param start - Start of the range
   * @param end - End of the range
   * @returns true if position is within the range
   */
  protected positionInRange(position: Position, start: Position, end: Position): boolean {
    // Check if position is after start
    if (position.row < start.row) {return false;}
    if (position.row === start.row && position.column < start.column) {return false;}

    // Check if position is before end
    if (position.row > end.row) {return false;}
    if (position.row === end.row && position.column > end.column) {return false;}

    return true;
  }

  /**
   * Compare two positions.
   *
   * @param a - First position
   * @param b - Second position
   * @returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  protected comparePositions(a: Position, b: Position): number {
    if (a.row !== b.row) {
      return a.row < b.row ? -1 : 1;
    }
    if (a.column !== b.column) {
      return a.column < b.column ? -1 : 1;
    }
    return 0;
  }

  /**
   * Get the text between two positions in the source.
   *
   * @param source - The source text
   * @param start - Start position
   * @param end - End position
   * @returns The text between the positions
   */
  protected getTextBetween(source: string, start: Position, end: Position): string {
    const lines = source.split('\n');
    const result: string[] = [];

    for (let row = start.row; row <= end.row; row++) {
      if (row >= lines.length) {break;}

      const line = lines[row];
      if (line === undefined) {break;}
      
      const startCol = row === start.row ? start.column : 0;
      const endCol = row === end.row ? end.column : line.length;

      result.push(line.slice(startCol, endCol));
    }

    return result.join('\n');
  }

  // ============================================
  // AST Node Utilities
  // ============================================

  /**
   * Create an AST node.
   *
   * @param type - Node type
   * @param text - Node text
   * @param startPosition - Start position
   * @param endPosition - End position
   * @param children - Child nodes
   * @returns ASTNode object
   */
  protected createNode(
    type: string,
    text: string,
    startPosition: Position,
    endPosition: Position,
    children: ASTNode[] = []
  ): ASTNode {
    return {
      type,
      text,
      startPosition,
      endPosition,
      children,
    };
  }

  /**
   * Create an AST object.
   *
   * @param rootNode - The root node of the AST
   * @param text - The source text
   * @returns AST object
   */
  protected createAST(rootNode: ASTNode, text: string): AST {
    return {
      rootNode,
      text,
    };
  }

  /**
   * Check if two nodes are equal (same type, position, and text).
   *
   * @param a - First node
   * @param b - Second node
   * @returns true if nodes are equal
   */
  protected nodesEqual(a: ASTNode, b: ASTNode): boolean {
    return (
      a.type === b.type &&
      a.text === b.text &&
      a.startPosition.row === b.startPosition.row &&
      a.startPosition.column === b.startPosition.column &&
      a.endPosition.row === b.endPosition.row &&
      a.endPosition.column === b.endPosition.column
    );
  }

  /**
   * Get the depth of a node in the AST.
   *
   * @param ast - The AST containing the node
   * @param node - The node to get depth for
   * @returns The depth (0 for root)
   */
  getNodeDepth(ast: AST, node: ASTNode): number {
    return this.getParentChain(ast, node).length;
  }

  /**
   * Check if a node is a leaf node (has no children).
   *
   * @param node - The node to check
   * @returns true if the node has no children
   */
  isLeafNode(node: ASTNode): boolean {
    return node.children.length === 0;
  }

  /**
   * Count the total number of nodes in an AST.
   *
   * @param ast - The AST to count nodes in
   * @returns Total number of nodes
   */
  countNodes(ast: AST): number {
    let count = 0;
    this.traverse(ast, () => {
      count++;
    });
    return count;
  }
}
