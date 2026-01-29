/**
 * Pattern Matcher - Match code against pattern definitions
 *
 * Provides pattern matching capabilities using AST-based, regex-based,
 * and structural matching methods. Supports caching of match results
 * for improved performance.
 *
 * @requirements 5.1 - Pattern matching with confidence scoring
 */

import type {
  PatternDefinition,
  PatternMatchResult,
  MatcherContext,
  MatcherConfig,
  MatchingResult,
  MatchingError,
  Location,
  ASTMatchConfig,
  RegexMatchConfig,
} from './types.js';
import type { ASTNode } from '../parsers/types.js';

/**
 * Cache entry for match results
 */
interface CacheEntry {
  /** Cached match results */
  results: PatternMatchResult[];
  /** Timestamp when cached */
  timestamp: number;
  /** Content hash for validation */
  contentHash: string;
}

/**
 * Options for matching operations
 */
export interface MatchOptions {
  /** Whether to use cached results */
  useCache?: boolean;
  /** Maximum matches to return */
  maxMatches?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
}

/**
 * PatternMatcher class for matching code against pattern definitions.
 *
 * Supports multiple matching methods:
 * - AST-based matching: Uses AST node types and properties
 * - Regex-based matching: Uses regular expressions
 * - Structural matching: Uses file paths and naming conventions
 *
 * @requirements 5.1 - Pattern matching with confidence scoring
 */
export class PatternMatcher {
  private config: MatcherConfig;
  private cache: Map<string, CacheEntry>;
  private cacheMaxSize: number;
  private cacheTTL: number;

  /**
   * Create a new PatternMatcher instance.
   *
   * @param config - Matcher configuration options
   */
  constructor(config: MatcherConfig = {}) {
    this.config = config;
    this.cache = new Map();
    this.cacheMaxSize = config.cache?.maxSize ?? 1000;
    this.cacheTTL = config.cache?.ttl ?? 60000; // 1 minute default
  }

  /**
   * Match code against a single pattern definition.
   *
   * @param context - The matcher context containing file info and AST
   * @param pattern - The pattern definition to match against
   * @param options - Optional matching options
   * @returns Array of pattern match results
   */
  match(
    context: MatcherContext,
    pattern: PatternDefinition,
    options: MatchOptions = {}
  ): PatternMatchResult[] {
    // Check if pattern is enabled
    if (!pattern.enabled) {
      return [];
    }

    // Check language filter
    if (pattern.languages && pattern.languages.length > 0) {
      if (!pattern.languages.includes(context.language)) {
        return [];
      }
    }

    // Check file include/exclude patterns
    if (!this.matchesFilePatterns(context.file, pattern)) {
      return [];
    }

    // Check cache if enabled
    const useCache = options.useCache ?? this.config.cache?.enabled ?? true;
    if (useCache) {
      const cached = this.getCachedResults(context, pattern);
      if (cached) {
        return this.filterResults(cached, options);
      }
    }

    // Perform matching based on match type
    let results: PatternMatchResult[];
    try {
      switch (pattern.matchType) {
        case 'ast':
          results = this.matchAST(context, pattern);
          break;
        case 'regex':
          results = this.matchRegex(context, pattern);
          break;
        case 'structural':
          results = this.matchStructural(context, pattern);
          break;
        case 'semantic':
          // Semantic matching falls back to AST for now
          results = this.matchAST(context, pattern);
          break;
        case 'custom':
          // Custom matching not implemented yet
          results = [];
          break;
        default:
          results = [];
      }
    } catch (error) {
      // Handle errors gracefully
      console.error(`Error matching pattern ${pattern.id}:`, error);
      results = [];
    }

    // Cache results
    if (useCache) {
      this.cacheResults(context, pattern, results);
    }

    return this.filterResults(results, options);
  }

  /**
   * Match code against multiple pattern definitions.
   *
   * @param context - The matcher context containing file info and AST
   * @param patterns - Array of pattern definitions to match against
   * @param options - Optional matching options
   * @returns Matching result with all matches and errors
   */
  matchAll(
    context: MatcherContext,
    patterns: PatternDefinition[],
    options: MatchOptions = {}
  ): MatchingResult {
    const startTime = Date.now();
    const allMatches: PatternMatchResult[] = [];
    const errors: MatchingError[] = [];

    for (const pattern of patterns) {
      try {
        const matches = this.match(context, pattern, options);
        allMatches.push(...matches);
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : String(error),
          patternId: pattern.id,
          recoverable: true,
        });
      }
    }

    return {
      file: context.file,
      matches: allMatches,
      outliers: [], // Outlier detection is handled by OutlierDetector
      duration: Date.now() - startTime,
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Clear the match cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.cacheMaxSize,
    };
  }

  // ============================================================================
  // AST-based Matching
  // ============================================================================

  /**
   * Perform AST-based pattern matching.
   */
  private matchAST(
    context: MatcherContext,
    pattern: PatternDefinition
  ): PatternMatchResult[] {
    if (!context.ast) {
      return [];
    }

    const config = pattern.astConfig;
    if (!config) {
      return [];
    }

    const results: PatternMatchResult[] = [];
    this.traverseAST(context.ast.rootNode, (node, depth) => {
      // Check depth constraints
      if (config.minDepth !== undefined && depth < config.minDepth) {
        return;
      }
      if (config.maxDepth !== undefined && depth > config.maxDepth) {
        return;
      }

      const matchResult = this.matchASTNode(node, config);
      if (matchResult.matches) {
        const result: PatternMatchResult = {
          patternId: pattern.id,
          location: this.nodeToLocation(node, context.file),
          confidence: matchResult.confidence,
          isOutlier: false,
          matchType: 'ast',
          timestamp: new Date(),
        };

        if (this.config.includeAstNodes) {
          result.matchedNode = node;
        }
        if (this.config.includeMatchedText) {
          result.matchedText = node.text;
        }

        results.push(result);
      }
    });

    return results;
  }

  /**
   * Match a single AST node against an AST match config.
   */
  private matchASTNode(
    node: ASTNode,
    config: ASTMatchConfig
  ): { matches: boolean; confidence: number } {
    let confidence = 1.0;
    let matchCount = 0;
    let totalChecks = 0;

    // Check node type
    if (config.nodeType) {
      totalChecks++;
      if (node.type === config.nodeType) {
        matchCount++;
      } else {
        return { matches: false, confidence: 0 };
      }
    }

    // Check properties
    if (config.properties) {
      for (const [key, value] of Object.entries(config.properties)) {
        totalChecks++;
        const nodeValue = (node as unknown as Record<string, unknown>)[key];
        if (this.matchPropertyValue(nodeValue, value)) {
          matchCount++;
        } else {
          return { matches: false, confidence: 0 };
        }
      }
    }

    // Check children patterns
    if (config.children && config.children.length > 0) {
      const childResults = this.matchASTChildren(node, config.children, config.matchDescendants);
      if (!childResults.matches) {
        return { matches: false, confidence: 0 };
      }
      confidence *= childResults.confidence;
    }

    // Calculate final confidence
    if (totalChecks > 0) {
      confidence *= matchCount / totalChecks;
    }

    return { matches: true, confidence };
  }

  /**
   * Match AST children against child patterns.
   */
  private matchASTChildren(
    node: ASTNode,
    childPatterns: ASTMatchConfig[],
    matchDescendants?: boolean
  ): { matches: boolean; confidence: number } {
    const nodesToSearch = matchDescendants
      ? this.getAllDescendants(node)
      : node.children;

    let matchedCount = 0;
    for (const childPattern of childPatterns) {
      let found = false;
      for (const child of nodesToSearch) {
        const result = this.matchASTNode(child, childPattern);
        if (result.matches) {
          found = true;
          matchedCount++;
          break;
        }
      }
      if (!found) {
        return { matches: false, confidence: 0 };
      }
    }

    return {
      matches: true,
      confidence: matchedCount / childPatterns.length,
    };
  }

  /**
   * Get all descendants of an AST node.
   */
  private getAllDescendants(node: ASTNode): ASTNode[] {
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
   * Traverse AST depth-first.
   */
  private traverseAST(
    node: ASTNode,
    visitor: (node: ASTNode, depth: number) => void,
    depth = 0
  ): void {
    visitor(node, depth);
    for (const child of node.children) {
      this.traverseAST(child, visitor, depth + 1);
    }
  }

  /**
   * Match a property value against an expected value.
   */
  private matchPropertyValue(actual: unknown, expected: unknown): boolean {
    if (expected instanceof RegExp) {
      return typeof actual === 'string' && expected.test(actual);
    }
    if (typeof expected === 'object' && expected !== null) {
      if (typeof actual !== 'object' || actual === null) {
        return false;
      }
      // Deep comparison for objects
      return JSON.stringify(actual) === JSON.stringify(expected);
    }
    return actual === expected;
  }

  // ============================================================================
  // Regex-based Matching
  // ============================================================================

  /**
   * Perform regex-based pattern matching.
   */
  private matchRegex(
    context: MatcherContext,
    pattern: PatternDefinition
  ): PatternMatchResult[] {
    const config = pattern.regexConfig;
    if (!config) {
      return [];
    }

    const results: PatternMatchResult[] = [];
    const regex = this.createRegex(config);
    if (!regex) {
      return [];
    }

    const lines = context.content.split('\n');
    let match: RegExpExecArray | null;

    // Reset regex state for global matching
    regex.lastIndex = 0;

    while ((match = regex.exec(context.content)) !== null) {
      const location = this.indexToLocation(match.index, lines, context.file);
      const captures = this.extractCaptures(match, config.captureGroups);

      const result: PatternMatchResult = {
        patternId: pattern.id,
        location,
        confidence: 1.0, // Regex matches are binary
        isOutlier: false,
        matchType: 'regex',
        timestamp: new Date(),
      };

      if (this.config.includeMatchedText) {
        result.matchedText = match[0];
      }
      if (captures) {
        result.captures = captures;
      }

      results.push(result);

      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    return results;
  }

  /**
   * Create a RegExp from regex config.
   */
  private createRegex(config: RegexMatchConfig): RegExp | null {
    try {
      let flags = config.flags ?? 'g';
      if (!flags.includes('g')) {
        flags += 'g'; // Always use global flag for multiple matches
      }
      if (config.multiline && !flags.includes('m')) {
        flags += 'm';
      }
      return new RegExp(config.pattern, flags);
    } catch {
      return null;
    }
  }

  /**
   * Extract named captures from a regex match.
   */
  private extractCaptures(
    match: RegExpExecArray,
    captureGroups?: string[]
  ): Record<string, string> | undefined {
    if (!captureGroups || captureGroups.length === 0) {
      return undefined;
    }

    const captures: Record<string, string> = {};
    for (let i = 0; i < captureGroups.length; i++) {
      const groupName = captureGroups[i];
      const groupValue = match[i + 1]; // Groups start at index 1
      if (groupName && groupValue !== undefined) {
        captures[groupName] = groupValue;
      }
    }

    return Object.keys(captures).length > 0 ? captures : undefined;
  }

  /**
   * Convert a string index to a location.
   */
  private indexToLocation(
    index: number,
    lines: string[],
    file: string
  ): Location {
    let currentIndex = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (line === undefined) {continue;}
      
      const lineLength = line.length + 1; // +1 for newline
      if (currentIndex + lineLength > index) {
        return {
          file,
          line: lineNum + 1, // 1-indexed
          column: index - currentIndex + 1, // 1-indexed
        };
      }
      currentIndex += lineLength;
    }

    // Default to end of file
    return {
      file,
      line: lines.length,
      column: 1,
    };
  }

  // ============================================================================
  // Structural Matching
  // ============================================================================

  /**
   * Perform structural pattern matching.
   */
  private matchStructural(
    context: MatcherContext,
    pattern: PatternDefinition
  ): PatternMatchResult[] {
    const config = pattern.structuralConfig;
    if (!config) {
      return [];
    }

    const results: PatternMatchResult[] = [];
    let confidence = 1.0;
    let matchCount = 0;
    let totalChecks = 0;

    // Check path pattern
    if (config.pathPattern) {
      totalChecks++;
      if (this.matchGlobPattern(context.file, config.pathPattern)) {
        matchCount++;
      } else {
        return []; // Path pattern is required to match
      }
    }

    // Check directory pattern
    if (config.directoryPattern) {
      totalChecks++;
      const dir = this.getDirectory(context.file);
      if (this.matchGlobPattern(dir, config.directoryPattern)) {
        matchCount++;
      } else {
        return [];
      }
    }

    // Check naming pattern
    if (config.namingPattern) {
      totalChecks++;
      const fileName = this.getFileName(context.file);
      if (this.matchNamingPattern(fileName, config.namingPattern)) {
        matchCount++;
      } else {
        return [];
      }
    }

    // Check extension
    if (config.extension) {
      totalChecks++;
      const ext = this.getExtension(context.file);
      if (ext === config.extension || ext === `.${config.extension}`) {
        matchCount++;
      } else {
        return [];
      }
    }

    // Calculate confidence
    if (totalChecks > 0) {
      confidence = matchCount / totalChecks;
    }

    // If all checks passed, add a match for the file
    if (matchCount === totalChecks && totalChecks > 0) {
      results.push({
        patternId: pattern.id,
        location: {
          file: context.file,
          line: 1,
          column: 1,
        },
        confidence,
        isOutlier: false,
        matchType: 'structural',
        timestamp: new Date(),
      });
    }

    return results;
  }

  /**
   * Match a path against a glob pattern.
   */
  private matchGlobPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{GLOBSTAR}}/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Match a filename against a naming pattern.
   */
  private matchNamingPattern(fileName: string, pattern: string): boolean {
    // Support common naming conventions
    switch (pattern.toLowerCase()) {
      case 'pascalcase':
        return /^[A-Z][a-zA-Z0-9]*$/.test(fileName);
      case 'camelcase':
        return /^[a-z][a-zA-Z0-9]*$/.test(fileName);
      case 'kebab-case':
        return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(fileName);
      case 'snake_case':
        return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(fileName);
      case 'screaming_snake_case':
        return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(fileName);
      default:
        // Treat as regex pattern
        try {
          const regex = new RegExp(pattern);
          return regex.test(fileName);
        } catch {
          return false;
        }
    }
  }

  /**
   * Get the directory part of a path.
   */
  private getDirectory(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.substring(0, lastSlash) : '';
  }

  /**
   * Get the filename without extension.
   */
  private getFileName(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    const fileName = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    const lastDot = fileName.lastIndexOf('.');
    return lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;
  }

  /**
   * Get the file extension.
   */
  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot >= 0 ? path.substring(lastDot) : '';
  }

  // ============================================================================
  // File Pattern Matching
  // ============================================================================

  /**
   * Check if a file matches the pattern's include/exclude patterns.
   */
  private matchesFilePatterns(file: string, pattern: PatternDefinition): boolean {
    // Check exclude patterns first
    if (pattern.excludePatterns && pattern.excludePatterns.length > 0) {
      for (const excludePattern of pattern.excludePatterns) {
        if (this.matchGlobPattern(file, excludePattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (pattern.includePatterns && pattern.includePatterns.length > 0) {
      for (const includePattern of pattern.includePatterns) {
        if (this.matchGlobPattern(file, includePattern)) {
          return true;
        }
      }
      return false; // No include pattern matched
    }

    return true; // No include patterns means include all
  }

  // ============================================================================
  // Caching
  // ============================================================================

  /**
   * Generate a cache key for a context and pattern.
   */
  private getCacheKey(context: MatcherContext, pattern: PatternDefinition): string {
    return `${context.file}:${pattern.id}`;
  }

  /**
   * Generate a content hash for cache validation.
   */
  private getContentHash(content: string): string {
    // Simple hash function for cache validation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Get cached results if available and valid.
   */
  private getCachedResults(
    context: MatcherContext,
    pattern: PatternDefinition
  ): PatternMatchResult[] | null {
    const key = this.getCacheKey(context, pattern);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    // Check content hash
    const currentHash = this.getContentHash(context.content);
    if (entry.contentHash !== currentHash) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  /**
   * Cache match results.
   */
  private cacheResults(
    context: MatcherContext,
    pattern: PatternDefinition,
    results: PatternMatchResult[]
  ): void {
    // Evict old entries if cache is full
    if (this.cache.size >= this.cacheMaxSize) {
      this.evictOldestEntry();
    }

    const key = this.getCacheKey(context, pattern);
    this.cache.set(key, {
      results,
      timestamp: Date.now(),
      contentHash: this.getContentHash(context.content),
    });
  }

  /**
   * Evict the oldest cache entry.
   */
  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  // ============================================================================
  // Result Filtering
  // ============================================================================

  /**
   * Filter results based on options.
   */
  private filterResults(
    results: PatternMatchResult[],
    options: MatchOptions
  ): PatternMatchResult[] {
    let filtered = results;

    // Filter by minimum confidence
    const minConfidence = options.minConfidence ?? this.config.minConfidence ?? 0;
    if (minConfidence > 0) {
      filtered = filtered.filter((r) => r.confidence >= minConfidence);
    }

    // Limit results
    const maxMatches = options.maxMatches ?? this.config.maxMatchesPerPattern;
    if (maxMatches !== undefined && filtered.length > maxMatches) {
      filtered = filtered.slice(0, maxMatches);
    }

    return filtered;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Convert an AST node to a Location.
   */
  private nodeToLocation(node: ASTNode, file: string): Location {
    return {
      file,
      line: node.startPosition.row + 1, // Convert to 1-indexed
      column: node.startPosition.column + 1, // Convert to 1-indexed
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
    };
  }
}
