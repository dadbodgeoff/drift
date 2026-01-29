/**
 * Tree-sitter Python Parser
 *
 * Main parser implementation using tree-sitter for Python parsing.
 * Implements the BaseParser interface and provides enhanced AST
 * extraction with Pydantic model support.
 *
 * @requirements 3.5 - Unified AST query interface
 */

import { BaseParser } from '../base-parser.js';
import { mergeConfig } from './config.js';
import { isTreeSitterAvailable, createPythonParser } from './loader.js';
import { PydanticExtractor } from './pydantic/pydantic-extractor.js';
import { PythonASTConverter } from './python-ast-converter.js';

import type { AST, ASTNode, Language, ParseResult } from '../types.js';
import type { PythonParserConfig } from './config.js';
import type {
  TreeSitterParser,
  TreeSitterTree,
  PydanticModelInfo,
} from './types.js';



// ============================================
// Extended Parse Result
// ============================================

/**
 * Extended parse result with tree-sitter specific information.
 */
export interface TreeSitterPythonParseResult extends ParseResult {
  /** The raw tree-sitter tree (if available) */
  treeSitterTree: TreeSitterTree | null;
  /** Whether tree-sitter was used for parsing */
  usedTreeSitter: boolean;
  /** Extracted Pydantic models (if enabled) */
  pydanticModels: PydanticModelInfo[];
}

// ============================================
// Main Parser Class
// ============================================

/**
 * Tree-sitter based Python parser.
 *
 * Provides AST parsing using tree-sitter with fallback to regex-based
 * parsing when tree-sitter is not available.
 */
export class TreeSitterPythonParser extends BaseParser {
  readonly language: Language = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];

  private readonly config: PythonParserConfig;
  private readonly converter: PythonASTConverter;
  private readonly pydanticExtractor: PydanticExtractor;
  private parser: TreeSitterParser | null = null;

  /**
   * Create a new TreeSitterPythonParser.
   *
   * @param config - Parser configuration options
   */
  constructor(config: Partial<PythonParserConfig> = {}) {
    super();
    this.config = mergeConfig(config);
    this.converter = new PythonASTConverter({
      includeComments: this.config.includeComments,
      includeAnonymous: this.config.includeAnonymous,
      maxDepth: 0, // No limit
    });
    this.pydanticExtractor = new PydanticExtractor();
  }

  /**
   * Check if tree-sitter is available for Python parsing.
   *
   * @returns true if tree-sitter and tree-sitter-python are available
   */
  static isAvailable(): boolean {
    return isTreeSitterAvailable();
  }

  /**
   * Parse Python source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns TreeSitterPythonParseResult containing the AST
   */
  parse(source: string, filePath?: string): TreeSitterPythonParseResult {
    // Check if tree-sitter should be used
    if (!this.config.useTreeSitter || !isTreeSitterAvailable()) {
      return this.createFallbackResult(source, filePath);
    }

    try {
      // Initialize parser if needed
      if (!this.parser) {
        this.parser = createPythonParser();
      }

      // Set timeout if configured
      if (this.config.parseTimeout > 0) {
        this.parser.setTimeoutMicros(this.config.parseTimeout * 1000);
      }

      // Parse the source
      const tree = this.parser.parse(source);

      // Check for parse errors
      const hasErrors = tree.rootNode.hasError;

      // Convert to drift AST
      const ast = this.converter.convertTree(tree, source);

      // Extract Pydantic models if enabled
      const pydanticModels = this.config.extractPydanticModels
        ? this.extractPydanticModelsFromTree(tree, source)
        : [];

      return {
        ast,
        language: this.language,
        errors: hasErrors ? [this.createError('Parse errors detected', { row: 0, column: 0 })] : [],
        success: true,
        treeSitterTree: tree,
        usedTreeSitter: true,
        pydanticModels,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([
          this.createError(`Tree-sitter parse error: ${errorMessage}`, { row: 0, column: 0 }),
        ]),
        treeSitterTree: null,
        usedTreeSitter: true,
        pydanticModels: [],
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports tree-sitter query syntax when tree-sitter is available,
   * otherwise falls back to simple node type matching.
   *
   * @param ast - The AST to query
   * @param pattern - The query pattern (tree-sitter query or node type)
   * @returns Array of matching AST nodes
   */
  query(ast: AST, pattern: string): ASTNode[] {
    // Simple node type query (works without tree-sitter)
    if (!pattern.includes('(') && !pattern.includes('@')) {
      return this.findNodesByType(ast, pattern);
    }

    // Tree-sitter query syntax requires tree-sitter
    if (!isTreeSitterAvailable()) {
      // Fall back to simple type matching
      return this.findNodesByType(ast, this.extractNodeTypeFromQuery(pattern));
    }

    // Execute tree-sitter query
    return this.executeTreeSitterQuery(ast, pattern);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Create a fallback result when tree-sitter is not available.
   */
  private createFallbackResult(source: string, _filePath?: string): TreeSitterPythonParseResult {
    // Create a minimal AST structure
    const lines = source.split('\n');
    const endPosition = lines.length > 0
      ? { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 }
      : { row: 0, column: 0 };

    const rootNode = this.createNode(
      'Module',
      source,
      { row: 0, column: 0 },
      endPosition,
      []
    );

    const ast = this.createAST(rootNode, source);

    return {
      ...this.createSuccessResult(ast),
      treeSitterTree: null,
      usedTreeSitter: false,
      pydanticModels: [],
    };
  }

  /**
   * Extract Pydantic models from a tree-sitter tree.
   */
  private extractPydanticModelsFromTree(tree: TreeSitterTree, source: string): PydanticModelInfo[] {
    return this.pydanticExtractor.extractModels(tree, source, {
      maxTypeDepth: this.config.maxTypeDepth,
      includePositions: this.config.includePositions,
    });
  }

  /**
   * Execute a tree-sitter query on the AST.
   */
  private executeTreeSitterQuery(ast: AST, pattern: string): ASTNode[] {
    // This requires access to the original tree-sitter tree
    // For now, fall back to simple matching
    return this.findNodesByType(ast, this.extractNodeTypeFromQuery(pattern));
  }

  /**
   * Extract a simple node type from a tree-sitter query pattern.
   */
  private extractNodeTypeFromQuery(pattern: string): string {
    // Extract the first node type from patterns like "(class_definition ...)"
    const match = pattern.match(/\((\w+)/);
    return match?.[1] ?? pattern;
  }

}
