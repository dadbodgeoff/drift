/**
 * AST Analyzer - AST pattern analysis
 *
 * Performs AST pattern matching, subtree comparison, and provides
 * traversal utilities for analyzing code structure.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import type {
  ASTAnalysisResult,
  ASTStats,
  PatternMatch,
  SourceLocation,
} from './types.js';
import type { AST, ASTNode, Position } from '../parsers/types.js';

/**
 * Pattern definition for AST matching
 */
export interface ASTPattern {
  /** Node type to match (e.g., 'FunctionDeclaration', 'ClassDeclaration') */
  type?: string;

  /** Text content to match (exact or regex) */
  text?: string | RegExp;

  /** Whether text matching should be exact */
  exactText?: boolean;

  /** Child patterns to match */
  children?: ASTPattern[];

  /** Minimum number of children required */
  minChildren?: number;

  /** Maximum number of children allowed */
  maxChildren?: number;

  /** Custom predicate for additional matching logic */
  predicate?: (node: ASTNode) => boolean;

  /** Whether to match any descendant (not just direct children) */
  matchDescendants?: boolean;

  /** Capture name for extracting matched nodes */
  capture?: string;
}

/**
 * Options for pattern matching
 */
export interface PatternMatchOptions {
  /** Maximum number of matches to return */
  limit?: number;

  /** Whether to include nested matches */
  includeNested?: boolean;

  /** Starting position for the search */
  startPosition?: Position;

  /** Ending position for the search */
  endPosition?: Position;

  /** Minimum confidence threshold for matches */
  minConfidence?: number;
}

/**
 * Result of a pattern match with captured nodes
 */
export interface PatternMatchResult {
  /** The matched node */
  node: ASTNode;

  /** Confidence score (0-1) */
  confidence: number;

  /** Captured nodes by name */
  captures: Map<string, ASTNode>;

  /** Location in source */
  location: SourceLocation;
}

/**
 * Options for subtree comparison
 */
export interface SubtreeCompareOptions {
  /** Whether to ignore node text differences */
  ignoreText?: boolean;

  /** Whether to ignore position differences */
  ignorePosition?: boolean;

  /** Node types to ignore during comparison */
  ignoreTypes?: string[];

  /** Maximum depth to compare */
  maxDepth?: number;

  /** Similarity threshold (0-1) for considering subtrees similar */
  similarityThreshold?: number;
}

/**
 * Result of subtree comparison
 */
export interface SubtreeCompareResult {
  /** Whether the subtrees are structurally identical */
  isIdentical: boolean;

  /** Similarity score (0-1) */
  similarity: number;

  /** Differences found between subtrees */
  differences: SubtreeDifference[];

  /** Statistics about the comparison */
  stats: {
    nodesCompared: number;
    matchingNodes: number;
    differentNodes: number;
  };
}

/**
 * A difference found between two subtrees
 */
export interface SubtreeDifference {
  /** Type of difference */
  type: 'type_mismatch' | 'text_mismatch' | 'children_count' | 'missing_child' | 'extra_child';

  /** Path to the difference in the first subtree */
  path1: number[];

  /** Path to the difference in the second subtree */
  path2: number[];

  /** Description of the difference */
  description: string;

  /** Node from first subtree (if applicable) */
  node1?: ASTNode;

  /** Node from second subtree (if applicable) */
  node2?: ASTNode;
}

/**
 * Visitor function for AST traversal
 */
export type ASTVisitorFn = (
  node: ASTNode,
  parent: ASTNode | null,
  depth: number,
  path: number[]
) => boolean | void;

/**
 * AST Analyzer class for pattern matching and subtree comparison.
 *
 * Provides a unified interface for analyzing AST structures across
 * all supported languages.
 *
 * @requirements 3.5 - Unified AST query interface across all languages
 */
export class ASTAnalyzer {
  /**
   * Find all nodes matching a pattern in the AST.
   *
   * @param ast - The AST to search
   * @param pattern - The pattern to match
   * @param options - Matching options
   * @returns Array of pattern match results
   */
  findPattern(
    ast: AST,
    pattern: ASTPattern,
    options: PatternMatchOptions = {}
  ): PatternMatchResult[] {
    const results: PatternMatchResult[] = [];
    const { limit, includeNested = true, startPosition, endPosition, minConfidence = 0 } = options;
    let limitReached = false;

    this.traverse(ast, (node, _parent, _depth, _path) => {
      // Check if limit already reached
      if (limitReached) {
        return false;
      }

      // Check position constraints
      if (startPosition && !this.isAfterPosition(node.startPosition, startPosition)) {
        return undefined;
      }
      if (endPosition && !this.isBeforePosition(node.endPosition, endPosition)) {
        return undefined;
      }

      // Try to match the pattern
      const captures = new Map<string, ASTNode>();
      const confidence = this.matchPattern(node, pattern, captures);

      if (confidence >= minConfidence && confidence > 0) {
        results.push({
          node,
          confidence,
          captures,
          location: {
            start: node.startPosition,
            end: node.endPosition,
          },
        });

        // Check limit after adding
        if (limit !== undefined && results.length >= limit) {
          limitReached = true;
          return false;
        }

        // If not including nested matches, skip children of matched nodes
        if (!includeNested) {
          return false;
        }
      }

      return undefined;
    });

    return results;
  }

  /**
   * Compare two AST subtrees for similarity.
   *
   * @param node1 - First subtree root
   * @param node2 - Second subtree root
   * @param options - Comparison options
   * @returns Comparison result with similarity score and differences
   */
  compareSubtrees(
    node1: ASTNode,
    node2: ASTNode,
    options: SubtreeCompareOptions = {}
  ): SubtreeCompareResult {
    const differences: SubtreeDifference[] = [];
    const stats = { nodesCompared: 0, matchingNodes: 0, differentNodes: 0 };

    const similarity = this.compareNodes(node1, node2, [], [], options, differences, stats, 0);

    return {
      isIdentical: differences.length === 0 && similarity === 1,
      similarity,
      differences,
      stats,
    };
  }

  /**
   * Get statistics about an AST.
   *
   * @param ast - The AST to analyze
   * @returns Statistics about the AST structure
   */
  getStats(ast: AST): ASTStats {
    const nodesByType: Record<string, number> = {};
    let nodeCount = 0;
    let maxDepth = 0;
    let totalChildren = 0;
    let nonLeafNodes = 0;

    this.traverse(ast, (node, _parent, depth) => {
      nodeCount++;
      maxDepth = Math.max(maxDepth, depth);

      // Count by type
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;

      // Track children for average calculation
      if (node.children.length > 0) {
        totalChildren += node.children.length;
        nonLeafNodes++;
      }
    });

    return {
      nodeCount,
      nodesByType,
      maxDepth,
      avgChildren: nonLeafNodes > 0 ? totalChildren / nonLeafNodes : 0,
    };
  }

  /**
   * Traverse the AST depth-first, calling the visitor for each node.
   *
   * @param ast - The AST to traverse
   * @param visitor - Function called for each node. Return false to stop traversal of subtree.
   */
  traverse(ast: AST, visitor: ASTVisitorFn): void {
    this.traverseNode(ast.rootNode, null, 0, [], visitor);
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

    this.traverse(ast, (node) => {
      if (node.type === nodeType) {
        results.push(node);
      }
      return undefined;
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

    this.traverse(ast, (node) => {
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

    this.traverse(ast, (node) => {
      if (this.positionInRange(position, node.startPosition, node.endPosition)) {
        result = node; // Keep updating to get the most specific (deepest) node
      }
      return undefined;
    });

    return result;
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
   * Get the depth of a node in the AST.
   *
   * @param ast - The AST containing the node
   * @param targetNode - The node to get depth for
   * @returns The depth (0 for root), or -1 if not found
   */
  getNodeDepth(ast: AST, targetNode: ASTNode): number {
    let foundDepth = -1;

    this.traverse(ast, (node, _parent, depth) => {
      if (node === targetNode) {
        foundDepth = depth;
        return false;
      }
      return undefined;
    });

    return foundDepth;
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

    const findParents = (node: ASTNode, chain: ASTNode[]): boolean => {
      if (node === targetNode) {
        parents.push(...chain);
        return true;
      }

      for (const child of node.children) {
        if (findParents(child, [...chain, node])) {
          return true;
        }
      }

      return false;
    };

    findParents(ast.rootNode, []);
    return parents;
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
   * Analyze an AST and return analysis results.
   *
   * @param ast - The AST to analyze
   * @param patterns - Patterns to search for
   * @returns Analysis result with matches and statistics
   */
  analyze(ast: AST, patterns: Map<string, ASTPattern>): ASTAnalysisResult {
    const matches: PatternMatch[] = [];
    const stats = this.getStats(ast);

    for (const [patternId, pattern] of patterns) {
      const patternMatches = this.findPattern(ast, pattern);

      for (const match of patternMatches) {
        matches.push({
          patternId,
          location: match.location,
          confidence: match.confidence,
          isOutlier: false,
          node: match.node,
        });
      }
    }

    return { matches, stats };
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Internal recursive traversal helper.
   */
  private traverseNode(
    node: ASTNode,
    parent: ASTNode | null,
    depth: number,
    path: number[],
    visitor: ASTVisitorFn
  ): boolean {
    const result = visitor(node, parent, depth, path);

    // If visitor returns false, stop entire traversal
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
   * Match a pattern against a node and return confidence score.
   */
  private matchPattern(
    node: ASTNode,
    pattern: ASTPattern,
    captures: Map<string, ASTNode>
  ): number {
    let score = 1.0;
    let matchCount = 0;
    let totalChecks = 0;

    // Check type
    if (pattern.type !== undefined) {
      totalChecks++;
      if (node.type === pattern.type) {
        matchCount++;
      } else {
        return 0; // Type mismatch is a hard failure
      }
    }

    // Check text
    if (pattern.text !== undefined) {
      totalChecks++;
      const textMatches = this.matchText(node.text, pattern.text, pattern.exactText);
      if (textMatches) {
        matchCount++;
      } else {
        return 0; // Text mismatch is a hard failure
      }
    }

    // Check children count constraints
    if (pattern.minChildren !== undefined) {
      totalChecks++;
      if (node.children.length >= pattern.minChildren) {
        matchCount++;
      } else {
        return 0;
      }
    }

    if (pattern.maxChildren !== undefined) {
      totalChecks++;
      if (node.children.length <= pattern.maxChildren) {
        matchCount++;
      } else {
        return 0;
      }
    }

    // Check custom predicate
    if (pattern.predicate !== undefined) {
      totalChecks++;
      if (pattern.predicate(node)) {
        matchCount++;
      } else {
        return 0;
      }
    }

    // Check child patterns
    if (pattern.children !== undefined && pattern.children.length > 0) {
      const childScore = this.matchChildPatterns(node, pattern.children, pattern.matchDescendants, captures);
      if (childScore === 0) {
        return 0;
      }
      score *= childScore;
    }

    // Capture the node if requested
    if (pattern.capture !== undefined) {
      captures.set(pattern.capture, node);
    }

    // Calculate final confidence
    if (totalChecks > 0) {
      score *= matchCount / totalChecks;
    }

    return score;
  }

  /**
   * Match text against a pattern (string or regex).
   */
  private matchText(text: string, pattern: string | RegExp, exact?: boolean): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(text);
    }

    if (exact) {
      return text === pattern;
    }

    return text.includes(pattern);
  }

  /**
   * Match child patterns against node children.
   */
  private matchChildPatterns(
    node: ASTNode,
    childPatterns: ASTPattern[],
    matchDescendants?: boolean,
    captures?: Map<string, ASTNode>
  ): number {
    const nodesToSearch = matchDescendants ? this.getDescendants(node) : node.children;
    let matchedCount = 0;

    for (const childPattern of childPatterns) {
      let found = false;

      for (const child of nodesToSearch) {
        const childCaptures = captures || new Map<string, ASTNode>();
        const confidence = this.matchPattern(child, childPattern, childCaptures);

        if (confidence > 0) {
          found = true;
          matchedCount++;

          // Merge captures
          if (captures) {
            for (const [key, value] of childCaptures) {
              captures.set(key, value);
            }
          }
          break;
        }
      }

      if (!found) {
        return 0; // Required child pattern not found
      }
    }

    return matchedCount / childPatterns.length;
  }

  /**
   * Compare two nodes recursively.
   */
  private compareNodes(
    node1: ASTNode,
    node2: ASTNode,
    path1: number[],
    path2: number[],
    options: SubtreeCompareOptions,
    differences: SubtreeDifference[],
    stats: { nodesCompared: number; matchingNodes: number; differentNodes: number },
    depth: number
  ): number {
    // Check max depth
    if (options.maxDepth !== undefined && depth > options.maxDepth) {
      return 1;
    }

    stats.nodesCompared++;

    // Check if type should be ignored
    if (options.ignoreTypes?.includes(node1.type) || options.ignoreTypes?.includes(node2.type)) {
      stats.matchingNodes++;
      return 1;
    }

    let similarity = 1.0;
    let isMatch = true;

    // Compare types
    if (node1.type !== node2.type) {
      differences.push({
        type: 'type_mismatch',
        path1,
        path2,
        description: `Type mismatch: '${node1.type}' vs '${node2.type}'`,
        node1,
        node2,
      });
      isMatch = false;
      similarity *= 0.5;
    }

    // Compare text (unless ignored)
    if (!options.ignoreText && node1.text !== node2.text) {
      differences.push({
        type: 'text_mismatch',
        path1,
        path2,
        description: `Text mismatch at ${node1.type}`,
        node1,
        node2,
      });
      isMatch = false;
      similarity *= 0.8;
    }

    // Compare children count
    if (node1.children.length !== node2.children.length) {
      differences.push({
        type: 'children_count',
        path1,
        path2,
        description: `Children count mismatch: ${node1.children.length} vs ${node2.children.length}`,
        node1,
        node2,
      });
      isMatch = false;
    }

    // Compare children
    const maxChildren = Math.max(node1.children.length, node2.children.length);
    if (maxChildren > 0) {
      let childSimilaritySum = 0;
      let childCount = 0;

      for (let i = 0; i < maxChildren; i++) {
        const child1 = node1.children[i];
        const child2 = node2.children[i];

        if (child1 && child2) {
          const childSimilarity = this.compareNodes(
            child1,
            child2,
            [...path1, i],
            [...path2, i],
            options,
            differences,
            stats,
            depth + 1
          );
          childSimilaritySum += childSimilarity;
          childCount++;
        } else if (child1 && !child2) {
          differences.push({
            type: 'extra_child',
            path1: [...path1, i],
            path2,
            description: `Extra child in first subtree at index ${i}`,
            node1: child1,
          });
          childCount++;
        } else if (!child1 && child2) {
          differences.push({
            type: 'missing_child',
            path1,
            path2: [...path2, i],
            description: `Missing child in first subtree at index ${i}`,
            node2: child2,
          });
          childCount++;
        }
      }

      if (childCount > 0) {
        similarity *= childSimilaritySum / childCount;
      }
    }

    if (isMatch) {
      stats.matchingNodes++;
    } else {
      stats.differentNodes++;
    }

    return similarity;
  }

  /**
   * Check if a position is within a range.
   */
  private positionInRange(position: Position, start: Position, end: Position): boolean {
    // Check if position is after start
    if (position.row < start.row) {return false;}
    if (position.row === start.row && position.column < start.column) {return false;}

    // Check if position is before end
    if (position.row > end.row) {return false;}
    if (position.row === end.row && position.column > end.column) {return false;}

    return true;
  }

  /**
   * Check if position a is after position b.
   */
  private isAfterPosition(a: Position, b: Position): boolean {
    if (a.row > b.row) {return true;}
    if (a.row === b.row && a.column >= b.column) {return true;}
    return false;
  }

  /**
   * Check if position a is before position b.
   */
  private isBeforePosition(a: Position, b: Position): boolean {
    if (a.row < b.row) {return true;}
    if (a.row === b.row && a.column <= b.column) {return true;}
    return false;
  }
}
