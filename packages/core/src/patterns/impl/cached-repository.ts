/**
 * Cached Pattern Repository
 *
 * Decorator implementation of IPatternRepository that adds caching
 * on top of any other repository implementation.
 *
 * @module patterns/impl/cached-repository
 */

import { EventEmitter } from 'node:events';

import type {
  IPatternRepository,
  PatternRepositoryEventType,
  PatternRepositoryEventHandler,
  PatternQueryOptions,
  PatternQueryResult,
  PatternFilter,
} from '../repository.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  PatternSummary,
} from '../types.js';

// ============================================================================
// Cache Types
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheConfig {
  /** TTL for pattern cache in milliseconds */
  patternTtlMs: number;

  /** TTL for query cache in milliseconds */
  queryTtlMs: number;

  /** Maximum number of cached queries */
  maxCachedQueries: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  patternTtlMs: 60000, // 1 minute
  queryTtlMs: 30000, // 30 seconds
  maxCachedQueries: 100,
};

// ============================================================================
// Cached Pattern Repository
// ============================================================================

/**
 * Cached pattern repository decorator.
 *
 * Wraps any IPatternRepository implementation and adds caching.
 * Cache is automatically invalidated on write operations.
 */
export class CachedPatternRepository extends EventEmitter implements IPatternRepository {
  private readonly inner: IPatternRepository;
  private readonly config: CacheConfig;

  // Pattern cache: id -> Pattern
  private patternCache: Map<string, CacheEntry<Pattern>> = new Map();

  // Query cache: serialized query -> result
  private queryCache: Map<string, CacheEntry<PatternQueryResult>> = new Map();

  // All patterns cache
  private allPatternsCache: CacheEntry<Pattern[]> | null = null;

  // Count cache
  private countCache: Map<string, CacheEntry<number>> = new Map();

  constructor(inner: IPatternRepository, config: Partial<CacheConfig> = {}) {
    super();
    this.inner = inner;
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };

    // Forward events from inner repository
    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    const events: PatternRepositoryEventType[] = [
      'pattern:added',
      'pattern:updated',
      'pattern:deleted',
      'pattern:approved',
      'pattern:ignored',
      'patterns:loaded',
      'patterns:saved',
    ];

    for (const event of events) {
      this.inner.on(event, (pattern, metadata) => {
        this.emit(event, pattern, metadata);
      });
    }
  }

  // ==========================================================================
  // Cache Utilities
  // ==========================================================================

  private isExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  private setPatternCache(pattern: Pattern): void {
    this.patternCache.set(pattern.id, {
      value: pattern,
      expiresAt: Date.now() + this.config.patternTtlMs,
    });
  }

  private getPatternCache(id: string): Pattern | null {
    const entry = this.patternCache.get(id);
    if (!entry || this.isExpired(entry)) {
      this.patternCache.delete(id);
      return null;
    }
    return entry.value;
  }

  private setQueryCache(key: string, result: PatternQueryResult): void {
    // Evict oldest entries if at capacity
    if (this.queryCache.size >= this.config.maxCachedQueries) {
      const oldestKey = this.queryCache.keys().next().value;
      if (oldestKey) {
        this.queryCache.delete(oldestKey);
      }
    }

    this.queryCache.set(key, {
      value: result,
      expiresAt: Date.now() + this.config.queryTtlMs,
    });
  }

  private getQueryCache(key: string): PatternQueryResult | null {
    const entry = this.queryCache.get(key);
    if (!entry || this.isExpired(entry)) {
      this.queryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private serializeQueryOptions(options: PatternQueryOptions): string {
    return JSON.stringify(options);
  }

  private invalidateAllCaches(): void {
    this.patternCache.clear();
    this.queryCache.clear();
    this.allPatternsCache = null;
    this.countCache.clear();
  }

  private invalidatePatternCaches(id: string): void {
    this.patternCache.delete(id);
    this.queryCache.clear(); // Queries may include this pattern
    this.allPatternsCache = null;
    this.countCache.clear();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    await this.inner.initialize();
  }

  async close(): Promise<void> {
    this.invalidateAllCaches();
    await this.inner.close();
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  async add(pattern: Pattern): Promise<void> {
    await this.inner.add(pattern);
    this.setPatternCache(pattern);
    this.invalidatePatternCaches(pattern.id);
  }

  async addMany(patterns: Pattern[]): Promise<void> {
    await this.inner.addMany(patterns);
    for (const pattern of patterns) {
      this.setPatternCache(pattern);
    }
    this.invalidateAllCaches();
  }

  async get(id: string): Promise<Pattern | null> {
    // Check cache first
    const cached = this.getPatternCache(id);
    if (cached) {
      return cached;
    }

    // Fetch from inner repository
    const pattern = await this.inner.get(id);
    if (pattern) {
      this.setPatternCache(pattern);
    }
    return pattern;
  }

  async update(id: string, updates: Partial<Pattern>): Promise<Pattern> {
    const updated = await this.inner.update(id, updates);
    this.setPatternCache(updated);
    this.invalidatePatternCaches(id);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.inner.delete(id);
    if (result) {
      this.invalidatePatternCaches(id);
    }
    return result;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  async query(options: PatternQueryOptions): Promise<PatternQueryResult> {
    const cacheKey = this.serializeQueryOptions(options);

    // Check cache first
    const cached = this.getQueryCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from inner repository
    const result = await this.inner.query(options);
    this.setQueryCache(cacheKey, result);

    // Also cache individual patterns
    for (const pattern of result.patterns) {
      this.setPatternCache(pattern);
    }

    return result;
  }

  async getByCategory(category: PatternCategory): Promise<Pattern[]> {
    return this.inner.getByCategory(category);
  }

  async getByStatus(status: PatternStatus): Promise<Pattern[]> {
    return this.inner.getByStatus(status);
  }

  async getByFile(file: string): Promise<Pattern[]> {
    return this.inner.getByFile(file);
  }

  async getAll(): Promise<Pattern[]> {
    // Check cache first
    if (this.allPatternsCache && !this.isExpired(this.allPatternsCache)) {
      return this.allPatternsCache.value;
    }

    // Fetch from inner repository
    const patterns = await this.inner.getAll();
    this.allPatternsCache = {
      value: patterns,
      expiresAt: Date.now() + this.config.queryTtlMs,
    };

    // Also cache individual patterns
    for (const pattern of patterns) {
      this.setPatternCache(pattern);
    }

    return patterns;
  }

  async count(filter?: PatternFilter): Promise<number> {
    const cacheKey = filter ? JSON.stringify(filter) : '__all__';

    // Check cache first
    const entry = this.countCache.get(cacheKey);
    if (entry && !this.isExpired(entry)) {
      return entry.value;
    }

    // Fetch from inner repository
    const count = await this.inner.count(filter);
    this.countCache.set(cacheKey, {
      value: count,
      expiresAt: Date.now() + this.config.queryTtlMs,
    });

    return count;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  async approve(id: string, approvedBy?: string): Promise<Pattern> {
    const updated = await this.inner.approve(id, approvedBy);
    this.setPatternCache(updated);
    this.invalidatePatternCaches(id);
    return updated;
  }

  async ignore(id: string): Promise<Pattern> {
    const updated = await this.inner.ignore(id);
    this.setPatternCache(updated);
    this.invalidatePatternCaches(id);
    return updated;
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  async saveAll(): Promise<void> {
    await this.inner.saveAll();
  }

  async clear(): Promise<void> {
    await this.inner.clear();
    this.invalidateAllCaches();
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  override on(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): this {
    return super.on(event, handler);
  }

  override off(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): this {
    return super.off(event, handler);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  async exists(id: string): Promise<boolean> {
    // Check cache first
    if (this.patternCache.has(id)) {
      const entry = this.patternCache.get(id)!;
      if (!this.isExpired(entry)) {
        return true;
      }
    }

    return this.inner.exists(id);
  }

  async getSummaries(options?: PatternQueryOptions): Promise<PatternSummary[]> {
    return this.inner.getSummaries(options);
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.invalidateAllCaches();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): {
    patternCacheSize: number;
    queryCacheSize: number;
    countCacheSize: number;
    hasAllPatternsCache: boolean;
  } {
    return {
      patternCacheSize: this.patternCache.size,
      queryCacheSize: this.queryCache.size,
      countCacheSize: this.countCache.size,
      hasAllPatternsCache: this.allPatternsCache !== null,
    };
  }
}
