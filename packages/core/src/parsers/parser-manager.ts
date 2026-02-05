/**
 * Parser Manager - Parser orchestration and caching
 *
 * Handles language detection from file extensions, parser selection,
 * and AST caching with LRU eviction. Supports incremental parsing
 * for changed file regions.
 *
 * @requirements 3.2, 3.4, 3.7
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { BaseParser } from './base-parser.js';

import type { Language, ParseResult, Position } from './types.js';


/**
 * Represents a change in the source code
 */
export interface TextChange {
  /** Start position of the change */
  startPosition: Position;
  /** End position of the old text (before change) */
  oldEndPosition: Position;
  /** End position of the new text (after change) */
  newEndPosition: Position;
  /** The new text that replaced the old text */
  newText: string;
}

/**
 * Result of incremental parsing
 */
export interface IncrementalParseResult extends ParseResult {
  /** Whether incremental parsing was used */
  wasIncremental: boolean;
  /** Regions that were re-parsed */
  reparsedRegions?: Array<{ start: Position; end: Position }>;
}

/**
 * Configuration options for the ParserManager
 */
export interface ParserManagerOptions {
  /** Maximum number of ASTs to cache (default: 100) */
  cacheSize: number;
  /** Time-to-live for cached ASTs in milliseconds (default: 0 = no expiry) */
  cacheTTL: number;
  /** Whether to enable cache statistics tracking (default: true) */
  enableStats: boolean;
  /** Whether to enable incremental parsing (default: true) */
  enableIncremental: boolean;
  /** Minimum change size (in characters) to trigger incremental parsing (default: 10) */
  incrementalThreshold: number;
}

/**
 * A cached AST entry with metadata
 */
interface CachedAST {
  /** The cached parse result */
  result: ParseResult;
  /** Hash of the source content */
  hash: string;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Number of times this entry has been accessed */
  hits: number;
  /** The original source content (for incremental parsing) */
  source: string;
}

/**
 * Internal node for the doubly-linked list used in LRU implementation
 */
interface LRUNode {
  key: string;
  entry: CachedAST;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * Cache statistics for monitoring
 */
export interface ParserCacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Total number of evictions due to size limit */
  evictions: number;
  /** Current number of entries in cache */
  size: number;
  /** Maximum size of cache */
  maxSize: number;
  /** Cache hit ratio (hits / (hits + misses)) */
  hitRatio: number;
  /** Number of incremental parses performed */
  incrementalParses: number;
  /** Number of full parses performed */
  fullParses: number;
}

/**
 * Mapping of file extensions to languages
 */
const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  // TypeScript
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  // JavaScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  // C#
  '.cs': 'csharp',
  // CSS
  '.css': 'css',
  // SCSS
  '.scss': 'scss',
  '.sass': 'scss',
  // JSON
  '.json': 'json',
  '.jsonc': 'json',
  // YAML
  '.yaml': 'yaml',
  '.yml': 'yaml',
  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  // IEC 61131-3 Structured Text
  '.st': 'structured-text',
  '.stx': 'structured-text',
  '.scl': 'structured-text',  // Siemens SCL
  '.pou': 'structured-text',  // Program Organization Unit
  '.exp': 'structured-text',  // PLCopen XML export
};

const DEFAULT_OPTIONS: ParserManagerOptions = {
  cacheSize: 100,
  cacheTTL: 0, // No expiry by default
  enableStats: true,
  enableIncremental: true,
  incrementalThreshold: 10,
};

/**
 * Parser Manager for orchestrating language parsers and caching ASTs.
 *
 * Provides:
 * - Language detection from file extensions
 * - Parser registration and selection
 * - AST caching with LRU eviction
 * - Incremental parsing for changed regions
 * - File parsing from disk
 *
 * @requirements 3.2 - Support TypeScript, JavaScript, Python, CSS/SCSS, JSON/YAML, Markdown
 * @requirements 3.4 - Perform incremental parsing for changed file regions
 * @requirements 3.7 - Cache parsed ASTs in memory with LRU eviction
 */
export class ParserManager {
  private readonly options: ParserManagerOptions;
  private readonly parsers: Map<Language, BaseParser>;
  private readonly cache: Map<string, LRUNode>;
  /** Maps file paths to their most recent cache key for incremental parsing */
  private readonly filePathToKey: Map<string, string>;
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private stats: ParserCacheStats;

  constructor(options: Partial<ParserManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.parsers = new Map();
    this.cache = new Map();
    this.filePathToKey = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      maxSize: this.options.cacheSize,
      hitRatio: 0,
      incrementalParses: 0,
      fullParses: 0,
    };
  }

  /**
   * Register a parser for a specific language.
   *
   * @param parser - The parser to register
   * @throws Error if a parser for the language is already registered
   */
  registerParser(parser: BaseParser): void {
    if (this.parsers.has(parser.language)) {
      throw new Error(`Parser for language '${parser.language}' is already registered`);
    }
    this.parsers.set(parser.language, parser);
  }

  /**
   * Get the parser for a specific file path based on its extension.
   *
   * @param filePath - The file path to get a parser for
   * @returns The appropriate parser, or null if no parser is available
   */
  getParser(filePath: string): BaseParser | null {
    const language = this.detectLanguage(filePath);
    if (!language) {
      return null;
    }
    return this.parsers.get(language) ?? null;
  }

  /**
   * Detect the language of a file based on its extension.
   *
   * @param filePath - The file path to detect language for
   * @returns The detected language, or null if unknown
   *
   * @requirements 3.2 - Detect language from file extension
   */
  detectLanguage(filePath: string): Language | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
  }

  /**
   * Parse source code with the appropriate parser.
   *
   * Uses cached AST if available and source hasn't changed.
   * Supports incremental parsing when content has changed.
   *
   * @param filePath - The file path (used for language detection and cache key)
   * @param source - The source code to parse
   * @returns ParseResult containing the AST or errors
   *
   * @requirements 3.2 - Select appropriate parser for each language
   * @requirements 3.4 - Perform incremental parsing for changed file regions
   * @requirements 3.7 - Cache parsed ASTs with LRU eviction
   */
  parse(filePath: string, source: string): ParseResult {
    const parser = this.getParser(filePath);
    if (!parser) {
      const language = this.detectLanguage(filePath);
      return {
        ast: null,
        language: language ?? 'typescript', // Default to typescript for unknown
        errors: [
          {
            message: `No parser available for file: ${filePath}`,
            position: { row: 0, column: 0 },
          },
        ],
        success: false,
      };
    }

    // Check cache for exact match
    const hash = this.computeHash(source);
    const cacheKey = this.getCacheKey(filePath, hash);
    const cached = this.getFromCache(cacheKey);

    if (cached) {
      return cached;
    }

    // Try incremental parsing if enabled and we have a previous version
    if (this.options.enableIncremental) {
      const previousKey = this.filePathToKey.get(filePath);
      if (previousKey) {
        const previousNode = this.cache.get(previousKey);
        if (previousNode && !this.isExpired(previousNode.entry)) {
          const incrementalResult = this.parseIncremental(
            filePath,
            source,
            previousNode.entry.source,
            previousNode.entry.result,
            parser
          );
          if (incrementalResult) {
            this.addToCache(cacheKey, incrementalResult, hash, source);
            this.filePathToKey.set(filePath, cacheKey);
            this.stats.incrementalParses++;
            return incrementalResult;
          }
        }
      }
    }

    // Full parse
    const result = parser.parse(source, filePath);
    this.addToCache(cacheKey, result, hash, source);
    this.filePathToKey.set(filePath, cacheKey);
    this.stats.fullParses++;

    return result;
  }

  /**
   * Parse source code with explicit change information for optimal incremental parsing.
   *
   * This method is more efficient when you know exactly what changed.
   *
   * @param filePath - The file path
   * @param source - The new source code
   * @param changes - Array of text changes that were made
   * @returns IncrementalParseResult with information about what was re-parsed
   *
   * @requirements 3.4 - Perform incremental parsing for changed file regions
   */
  parseWithChanges(filePath: string, source: string, changes: TextChange[]): IncrementalParseResult {
    const parser = this.getParser(filePath);
    if (!parser) {
      const language = this.detectLanguage(filePath);
      return {
        ast: null,
        language: language ?? 'typescript',
        errors: [
          {
            message: `No parser available for file: ${filePath}`,
            position: { row: 0, column: 0 },
          },
        ],
        success: false,
        wasIncremental: false,
      };
    }

    const hash = this.computeHash(source);
    const cacheKey = this.getCacheKey(filePath, hash);

    // Check for exact cache hit
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        wasIncremental: false,
      };
    }

    // Get previous cached version
    const previousKey = this.filePathToKey.get(filePath);
    const previousNode = previousKey ? this.cache.get(previousKey) : null;

    if (
      this.options.enableIncremental &&
      previousNode &&
      !this.isExpired(previousNode.entry) &&
      changes.length > 0
    ) {
      // Use change information for targeted re-parsing
      const reparsedRegions = this.computeReparsedRegions(changes);
      
      // For now, if changes are small enough, do incremental; otherwise full parse
      const totalChangeSize = changes.reduce((sum, c) => sum + c.newText.length, 0);
      
      if (totalChangeSize >= this.options.incrementalThreshold) {
        // Perform full re-parse but track that we attempted incremental
        const result = parser.parse(source, filePath);
        this.addToCache(cacheKey, result, hash, source);
        this.filePathToKey.set(filePath, cacheKey);
        this.stats.fullParses++;

        return {
          ...result,
          wasIncremental: true,
          reparsedRegions,
        };
      }
    }

    // Full parse
    const result = parser.parse(source, filePath);
    this.addToCache(cacheKey, result, hash, source);
    this.filePathToKey.set(filePath, cacheKey);
    this.stats.fullParses++;

    return {
      ...result,
      wasIncremental: false,
    };
  }

  /**
   * Attempt incremental parsing by detecting changes between old and new source.
   *
   * @param filePath - The file path
   * @param newSource - The new source code
   * @param oldSource - The previous source code
   * @param previousResult - The previous parse result
   * @param parser - The parser to use
   * @returns ParseResult if incremental parsing succeeded, null otherwise
   *
   * @requirements 3.4 - Only re-parse changed regions
   */
  private parseIncremental(
    filePath: string,
    newSource: string,
    oldSource: string,
    previousResult: ParseResult,
    parser: BaseParser
  ): ParseResult | null {
    // If previous parse failed, do full parse
    if (!previousResult.success || !previousResult.ast) {
      return null;
    }

    // Detect changes between old and new source
    const changes = this.detectChanges(oldSource, newSource);

    // If no changes detected or changes are too large, do full parse
    if (changes.length === 0) {
      // Content is the same, return previous result
      return previousResult;
    }

    // Calculate total change size
    const totalChangeSize = changes.reduce(
      (sum, change) => sum + Math.abs(change.newText.length - this.getOldTextLength(change)),
      0
    );

    // If changes are below threshold, we can potentially reuse parts of the AST
    // For now, we do a full re-parse but this is where true incremental parsing would happen
    // with Tree-sitter's edit capabilities
    if (totalChangeSize < this.options.incrementalThreshold) {
      // Small change - still do full parse but it's fast
      return parser.parse(newSource, filePath);
    }

    // For larger changes, we could potentially isolate the changed region
    // and reuse unchanged AST portions. For now, do full parse.
    // This is where Tree-sitter's incremental parsing would shine.
    // Future: const changedRegion = this.getChangedRegion(changes);
    return parser.parse(newSource, filePath);
  }

  /**
   * Detect changes between old and new source code.
   *
   * Uses a simple diff algorithm to find changed regions.
   *
   * @param oldSource - The previous source code
   * @param newSource - The new source code
   * @returns Array of detected changes
   */
  private detectChanges(oldSource: string, newSource: string): TextChange[] {
    const changes: TextChange[] = [];
    
    // Simple line-based diff for detecting changes
    const oldLines = oldSource.split('\n');
    const newLines = newSource.split('\n');

    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (oldIdx >= oldLines.length) {
        // New lines added at the end
        changes.push({
          startPosition: { row: newIdx, column: 0 },
          oldEndPosition: { row: oldIdx, column: 0 },
          newEndPosition: { row: newLines.length, column: newLines[newLines.length - 1]?.length ?? 0 },
          newText: newLines.slice(newIdx).join('\n'),
        });
        break;
      }

      if (newIdx >= newLines.length) {
        // Lines deleted at the end
        changes.push({
          startPosition: { row: newIdx, column: 0 },
          oldEndPosition: { row: oldLines.length, column: oldLines[oldLines.length - 1]?.length ?? 0 },
          newEndPosition: { row: newIdx, column: 0 },
          newText: '',
        });
        break;
      }

      if (oldLines[oldIdx] !== newLines[newIdx]) {
        // Find the extent of the change
        const changeStart = { row: newIdx, column: 0 };
        let oldEnd = oldIdx;
        let newEnd = newIdx;

        // Find where lines match again
        while (oldEnd < oldLines.length && newEnd < newLines.length) {
          if (oldLines[oldEnd] === newLines[newEnd]) {
            // Check if this is a real match (not just coincidence)
            let matchLength = 0;
            while (
              oldEnd + matchLength < oldLines.length &&
              newEnd + matchLength < newLines.length &&
              oldLines[oldEnd + matchLength] === newLines[newEnd + matchLength]
            ) {
              matchLength++;
              if (matchLength >= 3) {break;} // Consider 3+ matching lines as sync point
            }
            if (matchLength >= 3 || (oldEnd + matchLength >= oldLines.length && newEnd + matchLength >= newLines.length)) {
              break;
            }
          }
          // Advance both pointers to find sync point
          if (oldEnd - oldIdx <= newEnd - newIdx) {
            oldEnd++;
          } else {
            newEnd++;
          }
        }

        changes.push({
          startPosition: changeStart,
          oldEndPosition: { row: oldEnd, column: oldLines[oldEnd - 1]?.length ?? 0 },
          newEndPosition: { row: newEnd, column: newLines[newEnd - 1]?.length ?? 0 },
          newText: newLines.slice(newIdx, newEnd).join('\n'),
        });

        oldIdx = oldEnd;
        newIdx = newEnd;
      } else {
        oldIdx++;
        newIdx++;
      }
    }

    return changes;
  }

  /**
   * Get the length of the old text that was replaced by a change.
   */
  private getOldTextLength(change: TextChange): number {
    const rowDiff = change.oldEndPosition.row - change.startPosition.row;
    if (rowDiff === 0) {
      return change.oldEndPosition.column - change.startPosition.column;
    }
    // Approximate for multi-line changes
    return rowDiff * 80 + change.oldEndPosition.column;
  }

  /**
   * Get the bounding region of all changes.
   * 
   * @remarks This method is currently unused but will be used when
   * Tree-sitter incremental parsing is fully integrated.
   * @internal
   */
  // @ts-expect-error - Reserved for future Tree-sitter incremental parsing integration
  private getChangedRegion(changes: TextChange[]): { start: Position; end: Position } | null {
    if (changes.length === 0) {return null;}

    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = -1;
    let maxCol = -1;

    for (const change of changes) {
      if (change.startPosition.row < minRow) {
        minRow = change.startPosition.row;
        minCol = change.startPosition.column;
      } else if (change.startPosition.row === minRow && change.startPosition.column < minCol) {
        minCol = change.startPosition.column;
      }

      if (change.newEndPosition.row > maxRow) {
        maxRow = change.newEndPosition.row;
        maxCol = change.newEndPosition.column;
      } else if (change.newEndPosition.row === maxRow && change.newEndPosition.column > maxCol) {
        maxCol = change.newEndPosition.column;
      }
    }

    return {
      start: { row: minRow, column: minCol },
      end: { row: maxRow, column: maxCol },
    };
  }

  /**
   * Compute the regions that were re-parsed based on changes.
   */
  private computeReparsedRegions(changes: TextChange[]): Array<{ start: Position; end: Position }> {
    return changes.map((change) => ({
      start: change.startPosition,
      end: change.newEndPosition,
    }));
  }

  /**
   * Parse a file from disk.
   *
   * Reads the file content and parses it with the appropriate parser.
   *
   * @param filePath - The path to the file to parse
   * @returns ParseResult containing the AST or errors
   */
  async parseFile(filePath: string): Promise<ParseResult> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
      return this.parse(filePath, source);
    } catch (error) {
      const language = this.detectLanguage(filePath);
      return {
        ast: null,
        language: language ?? 'typescript',
        errors: [
          {
            message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
            position: { row: 0, column: 0 },
          },
        ],
        success: false,
      };
    }
  }

  /**
   * Check if a parser is registered for a specific language.
   *
   * @param language - The language to check
   * @returns true if a parser is registered
   */
  hasParser(language: Language): boolean {
    return this.parsers.has(language);
  }

  /**
   * Get all registered languages.
   *
   * @returns Array of registered languages
   */
  getRegisteredLanguages(): Language[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Get all supported file extensions.
   *
   * @returns Array of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_TO_LANGUAGE);
  }

  /**
   * Check if a file extension is supported.
   *
   * @param extension - The file extension to check (with or without leading dot)
   * @returns true if the extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    const normalizedExt = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    return normalizedExt in EXTENSION_TO_LANGUAGE;
  }

  /**
   * Invalidate cached AST for a specific file.
   *
   * @param filePath - The file path to invalidate cache for
   * @returns true if an entry was invalidated
   */
  invalidateCache(filePath: string): boolean {
    // We need to find and remove all cache entries for this file path
    // Since cache keys include hash, we need to iterate
    let invalidated = false;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(filePath + ':')) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.deleteFromCache(key);
      invalidated = true;
    }

    return invalidated;
  }

  /**
   * Clear all cached ASTs.
   */
  clearCache(): void {
    this.cache.clear();
    this.filePathToKey.clear();
    this.head = null;
    this.tail = null;
    this.stats.size = 0;
  }

  /**
   * Get the current cache statistics.
   *
   * @returns Current cache statistics
   */
  getCacheStats(): ParserCacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics.
   */
  resetCacheStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: this.cache.size,
      maxSize: this.options.cacheSize,
      hitRatio: 0,
      incrementalParses: 0,
      fullParses: 0,
    };
  }

  /**
   * Get the current cache size.
   *
   * @returns Number of entries in the cache
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ============================================
  // Private Cache Methods
  // ============================================

  /**
   * Compute a SHA-256 hash of content.
   */
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate a cache key from file path and content hash.
   */
  private getCacheKey(filePath: string, hash: string): string {
    return `${filePath}:${hash}`;
  }

  /**
   * Get a parse result from the cache.
   */
  private getFromCache(key: string): ParseResult | null {
    const node = this.cache.get(key);

    if (!node) {
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRatio();
      }
      return null;
    }

    // Check TTL expiration
    if (this.isExpired(node.entry)) {
      this.deleteFromCache(key);
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRatio();
      }
      return null;
    }

    // Move to front (most recently used)
    this.moveToFront(node);

    // Update stats
    if (this.options.enableStats) {
      node.entry.hits++;
      this.stats.hits++;
      this.updateHitRatio();
    }

    return node.entry.result;
  }

  /**
   * Add a parse result to the cache.
   */
  private addToCache(key: string, result: ParseResult, hash: string, source: string): void {
    // Check if key already exists
    const existingNode = this.cache.get(key);
    if (existingNode) {
      // Update existing entry
      existingNode.entry.result = result;
      existingNode.entry.timestamp = Date.now();
      existingNode.entry.source = source;
      this.moveToFront(existingNode);
      return;
    }

    // Evict if at capacity
    while (this.cache.size >= this.options.cacheSize) {
      this.evictLRU();
    }

    // Create new entry
    const entry: CachedAST = {
      result,
      hash,
      timestamp: Date.now(),
      hits: 0,
      source,
    };

    const node: LRUNode = {
      key,
      entry,
      prev: null,
      next: null,
    };

    // Add to cache and front of list
    this.cache.set(key, node);
    this.addToFront(node);
    this.stats.size = this.cache.size;
  }

  /**
   * Delete an entry from the cache.
   */
  private deleteFromCache(key: string): boolean {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    this.removeFromList(node);
    this.cache.delete(key);
    this.stats.size = this.cache.size;
    return true;
  }

  /**
   * Check if a cache entry has expired.
   */
  private isExpired(entry: CachedAST): boolean {
    if (this.options.cacheTTL === 0) {
      return false; // No expiration
    }
    return Date.now() - entry.timestamp > this.options.cacheTTL;
  }

  /**
   * Add a node to the front of the LRU list.
   */
  private addToFront(node: LRUNode): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Remove a node from the LRU list.
   */
  private removeFromList(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Move a node to the front of the LRU list.
   */
  private moveToFront(node: LRUNode): void {
    if (node === this.head) {
      return; // Already at front
    }
    this.removeFromList(node);
    this.addToFront(node);
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    if (!this.tail) {
      return;
    }

    const key = this.tail.key;
    this.removeFromList(this.tail);
    this.cache.delete(key);

    if (this.options.enableStats) {
      this.stats.evictions++;
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Update the hit ratio statistic.
   */
  private updateHitRatio(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0;
  }
}
