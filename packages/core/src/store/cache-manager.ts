/**
 * Cache Manager - Analysis result caching
 *
 * LRU cache for analysis results with file hash-based keys.
 * Handles cache invalidation on file changes.
 *
 * @requirements 2.5 - THE Scanner SHALL cache analysis results using file content hashes
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Configuration options for the CacheManager
 */
export interface CacheManagerOptions {
  /** Maximum number of entries in the cache (default: 1000) */
  maxSize: number;
  /** Time-to-live in milliseconds (default: 1 hour, 0 = no expiry) */
  ttl: number;
  /** Path to persist cache to disk (optional) */
  persistPath?: string;
  /** Whether to enable statistics tracking (default: true) */
  enableStats: boolean;
}

/**
 * A single cache entry with metadata
 */
export interface CacheEntry<T> {
  /** The cached value */
  value: T;
  /** File content hash used as key */
  hash: string;
  /** Timestamp when entry was created */
  timestamp: number;
  /** Number of times this entry has been accessed */
  hits: number;
  /** Size estimate in bytes (for memory tracking) */
  size: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Total number of evictions due to size limit */
  evictions: number;
  /** Total number of expirations due to TTL */
  expirations: number;
  /** Current number of entries in cache */
  size: number;
  /** Maximum size of cache */
  maxSize: number;
  /** Cache hit ratio (hits / (hits + misses)) */
  hitRatio: number;
}

/**
 * Internal node for the doubly-linked list used in LRU implementation
 */
interface LRUNode<T> {
  key: string;
  entry: CacheEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

/**
 * Persisted cache format for disk storage
 */
interface PersistedCache<T> {
  version: string;
  createdAt: string;
  entries: Array<{ key: string; entry: CacheEntry<T> }>;
}

const DEFAULT_OPTIONS: CacheManagerOptions = {
  maxSize: 1000,
  ttl: 3600000, // 1 hour
  enableStats: true,
};

/**
 * LRU Cache Manager for analysis results
 *
 * Implements a Least Recently Used (LRU) eviction strategy with:
 * - File hash-based cache keys
 * - Configurable maximum size
 * - Optional TTL-based expiration
 * - Statistics tracking (hits, misses, evictions)
 * - Optional persistence to disk
 */
export class CacheManager<T = unknown> {
  private readonly options: CacheManagerOptions;
  private readonly cache: Map<string, LRUNode<T>>;
  private head: LRUNode<T> | null = null;
  private tail: LRUNode<T> | null = null;
  private stats: CacheStats;

  constructor(options: Partial<CacheManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      size: 0,
      maxSize: this.options.maxSize,
      hitRatio: 0,
    };
  }

  /**
   * Get a value from the cache by its hash key
   *
   * @param hash - The file content hash to look up
   * @returns The cached value or undefined if not found/expired
   */
  get(hash: string): T | undefined {
    const node = this.cache.get(hash);

    if (!node) {
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRatio();
      }
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(node.entry)) {
      this.delete(hash);
      if (this.options.enableStats) {
        this.stats.misses++;
        this.stats.expirations++;
        this.updateHitRatio();
      }
      return undefined;
    }

    // Move to front (most recently used)
    this.moveToFront(node);

    // Update stats
    if (this.options.enableStats) {
      node.entry.hits++;
      this.stats.hits++;
      this.updateHitRatio();
    }

    return node.entry.value;
  }

  /**
   * Store a value in the cache with the given hash key
   *
   * @param hash - The file content hash to use as key
   * @param value - The value to cache
   * @param size - Optional size estimate in bytes
   */
  set(hash: string, value: T, size: number = 0): void {
    // Check if key already exists
    const existingNode = this.cache.get(hash);
    if (existingNode) {
      // Update existing entry
      existingNode.entry.value = value;
      existingNode.entry.timestamp = Date.now();
      existingNode.entry.size = size;
      this.moveToFront(existingNode);
      return;
    }

    // Evict if at capacity
    while (this.cache.size >= this.options.maxSize) {
      this.evictLRU();
    }

    // Create new entry
    const entry: CacheEntry<T> = {
      value,
      hash,
      timestamp: Date.now(),
      hits: 0,
      size,
    };

    const node: LRUNode<T> = {
      key: hash,
      entry,
      prev: null,
      next: null,
    };

    // Add to cache and front of list
    this.cache.set(hash, node);
    this.addToFront(node);
    this.stats.size = this.cache.size;
  }

  /**
   * Check if a hash key exists in the cache (without updating LRU order)
   *
   * @param hash - The file content hash to check
   * @returns True if the key exists and is not expired
   */
  has(hash: string): boolean {
    const node = this.cache.get(hash);
    if (!node) {
      return false;
    }

    // Check TTL expiration
    if (this.isExpired(node.entry)) {
      this.delete(hash);
      if (this.options.enableStats) {
        this.stats.expirations++;
      }
      return false;
    }

    return true;
  }

  /**
   * Delete an entry from the cache
   *
   * @param hash - The file content hash to delete
   * @returns True if the entry was deleted, false if not found
   */
  delete(hash: string): boolean {
    const node = this.cache.get(hash);
    if (!node) {
      return false;
    }

    this.removeFromList(node);
    this.cache.delete(hash);
    this.stats.size = this.cache.size;
    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.stats.size = 0;
  }

  /**
   * Get the current cache statistics
   *
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hitRatio: 0,
    };
  }

  /**
   * Get all cache entries (for debugging/persistence)
   *
   * @returns Array of all cache entries
   */
  entries(): Array<{ key: string; entry: CacheEntry<T> }> {
    const result: Array<{ key: string; entry: CacheEntry<T> }> = [];
    for (const [key, node] of this.cache) {
      if (!this.isExpired(node.entry)) {
        result.push({ key, entry: node.entry });
      }
    }
    return result;
  }

  /**
   * Get the current size of the cache
   *
   * @returns Number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Compute a SHA-256 hash of file content
   *
   * @param content - The file content to hash
   * @returns The hex-encoded SHA-256 hash
   */
  static computeHash(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Compute a SHA-256 hash of a file on disk
   *
   * @param filePath - Path to the file
   * @returns The hex-encoded SHA-256 hash
   */
  static async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return CacheManager.computeHash(content);
  }

  /**
   * Persist the cache to disk
   *
   * @param filePath - Path to save the cache (uses options.persistPath if not provided)
   */
  async persist(filePath?: string): Promise<void> {
    const targetPath = filePath ?? this.options.persistPath;
    if (!targetPath) {
      throw new Error('No persist path specified');
    }

    const persistedCache: PersistedCache<T> = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      entries: this.entries(),
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(persistedCache, null, 2));
  }

  /**
   * Load the cache from disk
   *
   * @param filePath - Path to load the cache from (uses options.persistPath if not provided)
   */
  async load(filePath?: string): Promise<void> {
    const targetPath = filePath ?? this.options.persistPath;
    if (!targetPath) {
      throw new Error('No persist path specified');
    }

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      const persistedCache: PersistedCache<T> = JSON.parse(content);

      if (!persistedCache.version) {
        throw new Error('Invalid cache file: missing version');
      }

      if (persistedCache.version !== '1.0.0') {
        throw new Error(`Unsupported cache version: ${persistedCache.version}`);
      }

      // Clear current cache and load entries
      this.clear();
      for (const { key, entry } of persistedCache.entries) {
        // Skip expired entries
        if (!this.isExpired(entry)) {
          this.set(key, entry.value, entry.size);
          // Restore original timestamp and hits
          const node = this.cache.get(key);
          if (node) {
            node.entry.timestamp = entry.timestamp;
            node.entry.hits = entry.hits;
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, start with empty cache
        return;
      }
      throw error;
    }
  }

  /**
   * Invalidate cache entries for a specific file and its dependents
   *
   * @param hash - The hash of the file that changed
   * @param dependentHashes - Hashes of files that depend on the changed file
   * @returns Number of entries invalidated
   */
  invalidate(hash: string, dependentHashes: string[] = []): number {
    let count = 0;

    if (this.delete(hash)) {
      count++;
    }

    for (const depHash of dependentHashes) {
      if (this.delete(depHash)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Prune expired entries from the cache
   *
   * @returns Number of entries pruned
   */
  prune(): number {
    let count = 0;
    const now = Date.now();

    for (const [key, node] of this.cache) {
      if (this.isExpiredAt(node.entry, now)) {
        this.delete(key);
        count++;
        if (this.options.enableStats) {
          this.stats.expirations++;
        }
      }
    }

    return count;
  }

  // Private helper methods

  private isExpired(entry: CacheEntry<T>): boolean {
    return this.isExpiredAt(entry, Date.now());
  }

  private isExpiredAt(entry: CacheEntry<T>, now: number): boolean {
    if (this.options.ttl === 0) {
      return false; // No expiration
    }
    return now - entry.timestamp > this.options.ttl;
  }

  private addToFront(node: LRUNode<T>): void {
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

  private removeFromList(node: LRUNode<T>): void {
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

  private moveToFront(node: LRUNode<T>): void {
    if (node === this.head) {
      return; // Already at front
    }
    this.removeFromList(node);
    this.addToFront(node);
  }

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

  private updateHitRatio(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0;
  }
}
