/**
 * Query Engine
 *
 * Unified query API that knows the optimal path to answer any query.
 * Routes queries to views, indexes, or raw data based on availability.
 *
 * Key features:
 * - Automatic view/index selection
 * - Fallback to raw data when views unavailable
 * - Pagination with cursor support
 * - Query result caching
 */

import { EventEmitter } from 'node:events';


import { IndexStore } from './index-store.js';
import { ManifestStore } from './manifest-store.js';
import { PatternShardStore } from './pattern-shard-store.js';
import { DEFAULT_DATA_LAKE_CONFIG } from './types.js';
import { ViewStore } from './view-store.js';

import type {
  StatusView,
  PatternSummary,
  SecuritySummaryView,
  TrendsView,
  DataLakeConfig,
  ViewType,
} from './types.js';
import type { Pattern, PatternCategory, PatternStatus } from '../store/types.js';

// ============================================================================
// Query Types
// ============================================================================

export interface PaginationOptions {
  limit?: number;
  cursor?: string;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string | undefined;
  executionTime: number;
  source: 'view' | 'index' | 'raw';
}

export interface PatternQueryOptions extends PaginationOptions {
  categories?: PatternCategory[];
  status?: PatternStatus;
  minConfidence?: number;
  search?: string;
  file?: string;
}

export interface QueryStats {
  viewHits: number;
  indexHits: number;
  rawHits: number;
  shardHits: number;
  avgResponseTime: number;
}

// ============================================================================
// Query Engine Class
// ============================================================================

export class QueryEngine extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly manifestStore: ManifestStore;
  private readonly viewStore: ViewStore;
  private readonly indexStore: IndexStore;
  private readonly patternShardStore: PatternShardStore;

  // Stats tracking
  private stats: QueryStats = {
    viewHits: 0,
    indexHits: 0,
    rawHits: 0,
    shardHits: 0,
    avgResponseTime: 0,
  };
  private queryCount: number = 0;

  // Raw data loader (injected)
  private rawPatternLoader?: () => Promise<Pattern[]>;

  constructor(
    config: Partial<DataLakeConfig> = {},
    manifestStore?: ManifestStore,
    viewStore?: ViewStore,
    indexStore?: IndexStore,
    patternShardStore?: PatternShardStore
  ) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.manifestStore = manifestStore ?? new ManifestStore(this.config);
    this.viewStore = viewStore ?? new ViewStore(this.config);
    this.indexStore = indexStore ?? new IndexStore(this.config);
    this.patternShardStore = patternShardStore ?? new PatternShardStore(this.config);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await Promise.all([
      this.manifestStore.initialize(),
      this.viewStore.initialize(),
      this.indexStore.initialize(),
      this.patternShardStore.initialize(),
    ]);
  }

  /**
   * Set the raw pattern loader for fallback queries
   */
  setRawPatternLoader(loader: () => Promise<Pattern[]>): void {
    this.rawPatternLoader = loader;
  }

  // ==========================================================================
  // Status Query
  // ==========================================================================

  /**
   * Get status - uses pre-computed view if available
   */
  async getStatus(): Promise<StatusView | null> {
    const startTime = Date.now();

    // Try view first
    if (!this.manifestStore.isViewStale('status')) {
      const view = await this.viewStore.getStatusView();
      if (view) {
        this.recordQuery('view', startTime);
        return view;
      }
    }

    // Fallback: build from raw data
    if (this.rawPatternLoader) {
      const patterns = await this.rawPatternLoader();
      const view = this.viewStore.buildStatusView(patterns);
      
      // Cache for next time
      if (this.config.enableViews) {
        await this.viewStore.saveStatusView(view);
        this.manifestStore.markViewFresh('status');
      }

      this.recordQuery('raw', startTime);
      return view;
    }

    return null;
  }

  // ==========================================================================
  // Pattern Queries
  // ==========================================================================

  /**
   * Get pattern list with pagination
   * 
   * Query strategy:
   * 1. If pattern index view is fresh, use it (fastest for full list)
   * 2. If querying specific categories, use pattern shards (loads only needed data)
   * 3. Fall back to raw data loader
   */
  async getPatterns(
    options: PatternQueryOptions = {}
  ): Promise<PaginatedResult<PatternSummary>> {
    const startTime = Date.now();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    // Try pattern index view first (best for unfiltered or search queries)
    if (!this.manifestStore.isViewStale('patternIndex') && !options.categories?.length) {
      const indexView = await this.viewStore.getPatternIndexView();
      if (indexView) {
        let patterns = indexView.patterns;
        patterns = this.filterPatternSummaries(patterns, options);

        const total = patterns.length;
        const paged = patterns.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        this.recordQuery('view', startTime);
        return {
          items: paged,
          total,
          hasMore,
          nextCursor: hasMore ? this.encodeCursor({ offset: offset + limit }) : undefined,
          executionTime: Date.now() - startTime,
          source: 'view',
        };
      }
    }

    // For category-specific queries, use pattern shards (loads only needed categories)
    if (options.categories?.length) {
      const shardPatterns = await this.patternShardStore.getByCategories(options.categories);
      if (shardPatterns.length > 0) {
        let summaries = shardPatterns.map(p => this.shardEntryToSummary(p));
        
        // Apply additional filters
        if (options.status) {
          summaries = summaries.filter(p => p.status === options.status);
        }
        if (options.minConfidence !== undefined) {
          summaries = summaries.filter(p => p.confidence >= options.minConfidence!);
        }
        if (options.search) {
          const searchLower = options.search.toLowerCase();
          summaries = summaries.filter(p =>
            p.name.toLowerCase().includes(searchLower) ||
            p.subcategory.toLowerCase().includes(searchLower)
          );
        }

        // Sort by confidence
        summaries.sort((a, b) => b.confidence - a.confidence);

        const total = summaries.length;
        const paged = summaries.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        this.recordQuery('shard', startTime);
        return {
          items: paged,
          total,
          hasMore,
          nextCursor: hasMore ? this.encodeCursor({ offset: offset + limit }) : undefined,
          executionTime: Date.now() - startTime,
          source: 'index', // Report as index since shards are a form of indexed storage
        };
      }
    }

    // Try the full pattern index view as fallback
    if (!this.manifestStore.isViewStale('patternIndex')) {
      const indexView = await this.viewStore.getPatternIndexView();
      if (indexView) {
        let patterns = indexView.patterns;
        patterns = this.filterPatternSummaries(patterns, options);

        const total = patterns.length;
        const paged = patterns.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        this.recordQuery('view', startTime);
        return {
          items: paged,
          total,
          hasMore,
          nextCursor: hasMore ? this.encodeCursor({ offset: offset + limit }) : undefined,
          executionTime: Date.now() - startTime,
          source: 'view',
        };
      }
    }

    // Fallback: build from raw data
    if (this.rawPatternLoader) {
      const patterns = await this.rawPatternLoader();
      const indexView = this.viewStore.buildPatternIndexView(patterns);
      
      // Cache for next time
      if (this.config.enableViews) {
        await this.viewStore.savePatternIndexView(indexView);
        this.manifestStore.markViewFresh('patternIndex');
      }

      // Also save to shards for future category queries
      if (this.config.enableSharding) {
        await this.patternShardStore.saveAll(patterns);
      }

      let summaries = indexView.patterns;
      summaries = this.filterPatternSummaries(summaries, options);

      const total = summaries.length;
      const paged = summaries.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      this.recordQuery('raw', startTime);
      return {
        items: paged,
        total,
        hasMore,
        nextCursor: hasMore ? this.encodeCursor({ offset: offset + limit }) : undefined,
        executionTime: Date.now() - startTime,
        source: 'raw',
      };
    }

    return {
      items: [],
      total: 0,
      hasMore: false,
      executionTime: Date.now() - startTime,
      source: 'raw',
    };
  }

  /**
   * Get patterns for a specific file
   */
  async getFilePatterns(file: string): Promise<PatternSummary[]> {
    const startTime = Date.now();

    // Try file index first
    const fileIndex = await this.indexStore.getFileIndex();
    if (fileIndex) {
      const patternIds = fileIndex.patterns[file] ?? [];
      if (patternIds.length > 0) {
        // Get pattern summaries from index view
        const indexView = await this.viewStore.getPatternIndexView();
        if (indexView) {
          const patterns = indexView.patterns.filter(p => patternIds.includes(p.id));
          this.recordQuery('index', startTime);
          return patterns;
        }
      }
    }

    // Fallback: filter from full list
    const result = await this.getPatterns({ file });
    return result.items;
  }

  /**
   * Get patterns by category (uses shards for efficiency)
   */
  async getCategoryPatterns(category: PatternCategory): Promise<PatternSummary[]> {
    const startTime = Date.now();

    // Try pattern shards first (most efficient for single category)
    const shardPatterns = await this.patternShardStore.getByCategory(category);
    if (shardPatterns.length > 0) {
      const summaries = shardPatterns.map(p => this.shardEntryToSummary(p));
      this.recordQuery('shard', startTime);
      return summaries;
    }

    // Try category index + view
    const categoryIndex = await this.indexStore.getCategoryIndex();
    if (categoryIndex) {
      const patternIds = categoryIndex.patterns[category] ?? [];
      if (patternIds.length > 0) {
        const indexView = await this.viewStore.getPatternIndexView();
        if (indexView) {
          const patterns = indexView.patterns.filter(p => patternIds.includes(p.id));
          this.recordQuery('index', startTime);
          return patterns;
        }
      }
    }

    // Fallback: filter from full list
    const result = await this.getPatterns({ categories: [category] });
    return result.items;
  }

  // ==========================================================================
  // Security Queries
  // ==========================================================================

  /**
   * Get security summary - uses pre-computed view if available
   */
  async getSecuritySummary(): Promise<SecuritySummaryView | null> {
    const startTime = Date.now();

    // Try view first
    if (!this.manifestStore.isViewStale('securitySummary')) {
      const view = await this.viewStore.getSecuritySummaryView();
      if (view) {
        this.recordQuery('view', startTime);
        return view;
      }
    }

    // No fallback for security summary - needs boundary data
    return null;
  }

  // ==========================================================================
  // Trend Queries
  // ==========================================================================

  /**
   * Get trends - uses pre-computed view if available
   */
  async getTrends(): Promise<TrendsView | null> {
    const startTime = Date.now();

    // Try view first
    if (!this.manifestStore.isViewStale('trends')) {
      const view = await this.viewStore.getTrendsView();
      if (view) {
        this.recordQuery('view', startTime);
        return view;
      }
    }

    // No fallback for trends - needs history data
    return null;
  }

  // ==========================================================================
  // Quick Stats
  // ==========================================================================

  /**
   * Get quick stats from manifest (instant)
   */
  getQuickStats() {
    return this.manifestStore.getStats();
  }

  /**
   * Get pattern stats from manifest (instant)
   */
  getPatternStats() {
    return this.manifestStore.getPatternStats();
  }

  /**
   * Get security stats from manifest (instant)
   */
  getSecurityStats() {
    return this.manifestStore.getSecurityStats();
  }

  // ==========================================================================
  // View Management
  // ==========================================================================

  /**
   * Check if a view is stale
   */
  isViewStale(view: ViewType): boolean {
    return this.manifestStore.isViewStale(view as keyof ReturnType<typeof this.manifestStore.getViewFreshness>);
  }

  /**
   * Invalidate views (triggers rebuild on next query)
   */
  invalidateViews(views?: ViewType[]): void {
    if (!views) {
      this.manifestStore.markAllViewsStale('manual invalidation');
      this.viewStore.invalidateCache();
    } else {
      for (const view of views) {
        this.manifestStore.markViewStale(view as keyof ReturnType<typeof this.manifestStore.getViewFreshness>, 'manual invalidation');
        this.viewStore.invalidateCache(view);
      }
    }
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  getQueryStats(): QueryStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      viewHits: 0,
      indexHits: 0,
      rawHits: 0,
      shardHits: 0,
      avgResponseTime: 0,
    };
    this.queryCount = 0;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Convert a PatternShardEntry to PatternSummary
   */
  private shardEntryToSummary(entry: import('./types.js').PatternShardEntry): PatternSummary {
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      subcategory: entry.subcategory,
      status: entry.status,
      confidence: entry.confidence.score,
      confidenceLevel: entry.confidence.level,
      locationCount: entry.locations.length,
      outlierCount: entry.outliers.length,
      severity: entry.severity,
      locationsHash: '', // Not needed for queries
    };
  }

  private filterPatternSummaries(
    patterns: PatternSummary[],
    options: PatternQueryOptions
  ): PatternSummary[] {
    let result = patterns;

    if (options.categories?.length) {
      result = result.filter(p => options.categories!.includes(p.category));
    }

    if (options.status) {
      result = result.filter(p => p.status === options.status);
    }

    if (options.minConfidence !== undefined) {
      result = result.filter(p => p.confidence >= options.minConfidence!);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        p.subcategory.toLowerCase().includes(searchLower)
      );
    }

    // Note: file filtering requires the full pattern data or file index
    // For now, we skip it in the summary filter

    return result;
  }

  private encodeCursor(data: { offset: number }): string {
    return Buffer.from(JSON.stringify(data)).toString('base64url');
  }

  /** Decode cursor - kept for future pagination implementation */
  // @ts-expect-error - Will be used when pagination is fully implemented
   
  private decodeCursor(cursor: string): { offset: number } | null {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString());
    } catch {
      return null;
    }
  }

  private recordQuery(source: 'view' | 'index' | 'raw' | 'shard', startTime: number): void {
    const duration = Date.now() - startTime;
    this.queryCount++;

    switch (source) {
      case 'view':
        this.stats.viewHits++;
        break;
      case 'index':
        this.stats.indexHits++;
        break;
      case 'raw':
        this.stats.rawHits++;
        break;
      case 'shard':
        this.stats.shardHits++;
        break;
    }

    // Update rolling average
    this.stats.avgResponseTime =
      (this.stats.avgResponseTime * (this.queryCount - 1) + duration) / this.queryCount;

    this.emit('query', { source, duration });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createQueryEngine(
  config: Partial<DataLakeConfig> = {},
  manifestStore?: ManifestStore,
  viewStore?: ViewStore,
  indexStore?: IndexStore,
  patternShardStore?: PatternShardStore
): QueryEngine {
  return new QueryEngine(config, manifestStore, viewStore, indexStore, patternShardStore);
}
