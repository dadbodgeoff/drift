/**
 * Response Cache
 * 
 * Multi-level caching for MCP responses:
 * - L1: In-memory LRU cache (fast, limited size)
 * - L2: File-based cache (slower, larger, persistent)
 * 
 * Features:
 * - Automatic invalidation on pattern changes
 * - TTL-based expiration
 * - Cache key generation from tool + args
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CachedResponse<T = unknown> {
  data: T;
  createdAt: number;
  expiresAt: number;
  source?: 'l1' | 'l2';
  invalidationKeys?: string[] | undefined;
}

export interface CacheConfig {
  l1MaxSize: number;
  l1TtlMs: number;
  l2Enabled: boolean;
  l2TtlMs: number;
  l2CacheDir?: string | undefined;
}

const DEFAULT_CONFIG: CacheConfig = {
  l1MaxSize: 100,
  l1TtlMs: 300000, // 5 minutes
  l2Enabled: false,
  l2TtlMs: 3600000, // 1 hour
};

/**
 * Simple LRU Cache implementation
 */
class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  
  constructor(private maxSize: number) {}
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    // Delete if exists to update position
    this.cache.delete(key);
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, value);
  }
  
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  *entries(): IterableIterator<[K, V]> {
    yield* this.cache.entries();
  }
  
  get size(): number {
    return this.cache.size;
  }
}

export class ResponseCache {
  private l1: LRUCache<string, CachedResponse>;
  private config: CacheConfig;
  private invalidationIndex: Map<string, Set<string>> = new Map();
  
  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.l1 = new LRUCache(this.config.l1MaxSize);
  }
  
  /**
   * Get cached response
   */
  async get<T>(key: string): Promise<CachedResponse<T> | null> {
    // Try L1 first
    const l1Result = this.l1.get(key) as CachedResponse<T> | undefined;
    if (l1Result && !this.isExpired(l1Result)) {
      return { ...l1Result, source: 'l1' };
    }
    
    // Try L2 if enabled
    if (this.config.l2Enabled && this.config.l2CacheDir) {
      const l2Result = await this.getFromL2<T>(key);
      if (l2Result && !this.isExpired(l2Result)) {
        // Promote to L1
        this.l1.set(key, l2Result);
        return { ...l2Result, source: 'l2' };
      }
    }
    
    return null;
  }
  
  /**
   * Set cached response
   */
  async set<T>(
    key: string, 
    data: T, 
    options: { 
      ttlMs?: number; 
      invalidationKeys?: string[];
    } = {}
  ): Promise<void> {
    const ttlMs = options.ttlMs ?? this.config.l1TtlMs;
    const now = Date.now();
    
    const cached: CachedResponse<T> = {
      data,
      createdAt: now,
      expiresAt: now + ttlMs,
      invalidationKeys: options.invalidationKeys,
    };
    
    // Store in L1
    this.l1.set(key, cached);
    
    // Update invalidation index
    if (options.invalidationKeys) {
      for (const invKey of options.invalidationKeys) {
        if (!this.invalidationIndex.has(invKey)) {
          this.invalidationIndex.set(invKey, new Set());
        }
        this.invalidationIndex.get(invKey)!.add(key);
      }
    }
    
    // Store in L2 if enabled
    if (this.config.l2Enabled && this.config.l2CacheDir) {
      await this.setToL2(key, {
        ...cached,
        expiresAt: now + this.config.l2TtlMs,
      });
    }
  }
  
  /**
   * Delete cached response
   */
  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    
    if (this.config.l2Enabled && this.config.l2CacheDir) {
      await this.deleteFromL2(key);
    }
  }
  
  /**
   * Invalidate all caches matching an invalidation key
   */
  async invalidate(invalidationKey: string): Promise<number> {
    const cacheKeys = this.invalidationIndex.get(invalidationKey);
    if (!cacheKeys) {
      return 0;
    }
    
    let count = 0;
    for (const key of cacheKeys) {
      await this.delete(key);
      count++;
    }
    
    this.invalidationIndex.delete(invalidationKey);
    return count;
  }
  
  /**
   * Invalidate caches for specific categories
   */
  async invalidateCategories(categories: string[]): Promise<number> {
    let count = 0;
    for (const category of categories) {
      count += await this.invalidate(`category:${category}`);
    }
    return count;
  }
  
  /**
   * Invalidate all pattern-related caches
   */
  async invalidatePatterns(): Promise<number> {
    return this.invalidate('patterns');
  }
  
  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.l1.clear();
    this.invalidationIndex.clear();
    
    if (this.config.l2Enabled && this.config.l2CacheDir) {
      await this.clearL2();
    }
  }
  
  /**
   * Generate cache key from tool name, arguments, and project root
   * 
   * IMPORTANT: The projectRoot is included to ensure different projects
   * have separate cache entries. This prevents stale data when switching
   * between projects.
   */
  generateKey(tool: string, args: Record<string, unknown>, projectRoot?: string): string {
    // Remove undefined values and sort keys for consistency
    const normalized = Object.keys(args)
      .filter(k => args[k] !== undefined)
      .sort()
      .reduce((acc, key) => {
        acc[key] = args[key];
        return acc;
      }, {} as Record<string, unknown>);
    
    // Include project root in the hash to ensure project isolation
    const keyData = projectRoot 
      ? `${projectRoot}:${tool}:${JSON.stringify(normalized)}`
      : `${tool}:${JSON.stringify(normalized)}`;
    
    const hash = createHash('sha256')
      .update(keyData)
      .digest('hex')
      .slice(0, 16);
    
    return `drift:${tool}:${hash}`;
  }
  
  /**
   * Invalidate all caches (used when switching projects)
   */
  async invalidateAll(): Promise<number> {
    const count = this.l1.size;
    await this.clear();
    return count;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    l1Size: number;
    l1MaxSize: number;
    invalidationKeys: number;
  } {
    return {
      l1Size: this.l1.size,
      l1MaxSize: this.config.l1MaxSize,
      invalidationKeys: this.invalidationIndex.size,
    };
  }
  
  // Private methods
  
  private isExpired(cached: CachedResponse): boolean {
    return Date.now() > cached.expiresAt;
  }
  
  private async getFromL2<T>(key: string): Promise<CachedResponse<T> | null> {
    if (!this.config.l2CacheDir) {return null;}
    
    try {
      const filePath = this.getL2Path(key);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  
  private async setToL2(key: string, cached: CachedResponse): Promise<void> {
    if (!this.config.l2CacheDir) {return;}
    
    try {
      const filePath = this.getL2Path(key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(cached));
    } catch {
      // Ignore L2 write errors
    }
  }
  
  private async deleteFromL2(key: string): Promise<void> {
    if (!this.config.l2CacheDir) {return;}
    
    try {
      const filePath = this.getL2Path(key);
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
  
  private async clearL2(): Promise<void> {
    if (!this.config.l2CacheDir) {return;}
    
    try {
      await fs.rm(this.config.l2CacheDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  }
  
  private getL2Path(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return path.join(
      this.config.l2CacheDir!,
      hash.slice(0, 2),
      `${hash}.json`
    );
  }
}

/**
 * Create a cache instance with project-specific L2 directory
 */
export function createCache(projectRoot: string, config: Partial<CacheConfig> = {}): ResponseCache {
  return new ResponseCache({
    ...config,
    l2CacheDir: config.l2Enabled 
      ? path.join(projectRoot, '.drift', 'cache', 'mcp')
      : undefined,
  });
}
