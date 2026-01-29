/**
 * Data Lake Module
 *
 * Enterprise-grade data storage with materialized views, indexes, and query optimization.
 *
 * Architecture:
 * - ManifestStore: Quick-load index of everything (instant drift_status)
 * - ViewStore: Pre-computed views for common queries
 * - IndexStore: Fast lookups by file, category, table, entry point
 * - QueryEngine: Unified query API with automatic view/index selection
 * - ViewMaterializer: Rebuilds views after scans
 *
 * Usage:
 * ```typescript
 * import { createDataLake } from './lake';
 *
 * const lake = createDataLake({ rootDir: '/path/to/project' });
 * await lake.initialize();
 *
 * // Instant status (reads pre-computed view)
 * const status = await lake.query.getStatus();
 *
 * // Fast pattern listing (uses index + view)
 * const patterns = await lake.query.getPatterns({ categories: ['api'] });
 *
 * // After scan, materialize views
 * await lake.materializer.materialize(patterns, {}, { lastScan: scanInfo });
 * ```
 */

// Types - Use Lake prefix to avoid conflicts with existing exports
export type {
  // Manifest types
  DriftManifest,
  ManifestStats,
  PatternStats as LakePatternStats,
  SecurityStats as LakeSecurityStats,
  CallGraphStats as LakeCallGraphStats,
  ContractStats as LakeContractStats,
  DNAStats as LakeDNAStats,
  LastScanInfo,
  ViewFreshness,
  ViewMeta,

  // View types
  StatusView,
  PatternIndexView,
  PatternSummary as LakePatternSummary,
  SecuritySummaryView,
  TrendsView,
  HealthFactor,
  TopIssue,
  SensitiveTableSummary,
  ViolationSummary,
  TrendItem,
  CategoryTrend,

  // Index types
  FileIndex,
  CategoryIndex,
  TableIndex,
  EntryPointIndex,

  // Shard types
  Shard,
  PatternShard,
  PatternShardEntry,
  PatternLocation as LakePatternLocation,
  PatternMetadata as LakePatternMetadata,
  AccessMapShard,
  SensitiveFieldInfo,
  AccessPointEntry,
  CallGraphShard,
  FunctionEntry,
  DataAccessRef,

  // Example types
  PatternExamples,
  CodeExample,

  // Update types
  IncrementalUpdate,
  ViewType,
  IndexType,

  // Config types
  DataLakeConfig,
} from './types.js';

export {
  LAKE_VERSION,
  LAKE_DIRS,
  VIEW_FILES,
  INDEX_FILES,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

// Stores - Use Lake prefix to avoid conflicts
export { ManifestStore as LakeManifestStore, createManifestStore } from './manifest-store.js';
export { ViewStore, createViewStore } from './view-store.js';
export { IndexStore, createIndexStore } from './index-store.js';
export { PatternShardStore, createPatternShardStore } from './pattern-shard-store.js';
export {
  SecurityShardStore,
  createSecurityShardStore,
  type SecurityIndex,
  type TableIndexEntry,
  type SensitiveTableEntry,
  type ViolationEntry,
  type SensitiveFieldRegistry,
  type SensitiveFieldRecord,
} from './security-shard-store.js';

export {
  ExamplesStore,
  createExamplesStore,
  type ExamplesIndex,
  type ExampleIndexEntry,
  type ExampleExtractionOptions,
} from './examples-store.js';

export {
  CallGraphShardStore,
  createCallGraphShardStore,
  type CallGraphIndex,
  type FileIndexEntry as CallGraphFileIndexEntry,
  type EntryPointSummary,
  type DataAccessorSummary,
  type EntryPointsData,
  type EntryPointDetail,
} from './callgraph-shard-store.js';

// Query Engine
export {
  QueryEngine,
  createQueryEngine,
  type PaginationOptions,
  type PaginatedResult,
  type PatternQueryOptions,
  type QueryStats,
} from './query-engine.js';

// View Materializer
export {
  ViewMaterializer,
  createViewMaterializer,
  type MaterializeOptions,
  type MaterializeResult,
} from './view-materializer.js';

// ============================================================================
// Data Lake Facade
// ============================================================================

import { CallGraphShardStore } from './callgraph-shard-store.js';
import { ExamplesStore } from './examples-store.js';
import { IndexStore } from './index-store.js';
import { ManifestStore } from './manifest-store.js';
import { PatternShardStore } from './pattern-shard-store.js';
import { QueryEngine } from './query-engine.js';
import { SecurityShardStore } from './security-shard-store.js';
import { DEFAULT_DATA_LAKE_CONFIG } from './types.js';
import { ViewMaterializer } from './view-materializer.js';
import { ViewStore } from './view-store.js';

import type { DataLakeConfig } from './types.js';
import type { Pattern } from '../store/types.js';

/**
 * Data Lake - Unified interface for all data lake operations
 */
export class DataLake {
  readonly config: DataLakeConfig;
  readonly manifest: ManifestStore;
  readonly views: ViewStore;
  readonly indexes: IndexStore;
  readonly patternShards: PatternShardStore;
  readonly securityShards: SecurityShardStore;
  readonly examples: ExamplesStore;
  readonly callGraphShards: CallGraphShardStore;
  readonly query: QueryEngine;
  readonly materializer: ViewMaterializer;

  private initialized = false;

  constructor(config: Partial<DataLakeConfig> = {}) {
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };

    // Create stores
    this.manifest = new ManifestStore(this.config);
    this.views = new ViewStore(this.config);
    this.indexes = new IndexStore(this.config);
    this.patternShards = new PatternShardStore(this.config);
    this.securityShards = new SecurityShardStore(this.config);
    this.examples = new ExamplesStore(this.config);
    this.callGraphShards = new CallGraphShardStore(this.config);

    // Create query engine with stores
    this.query = new QueryEngine(
      this.config,
      this.manifest,
      this.views,
      this.indexes,
      this.patternShards
    );

    // Create materializer with stores
    this.materializer = new ViewMaterializer(
      this.config,
      this.manifest,
      this.views,
      this.indexes
    );
  }

  /**
   * Initialize the data lake
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    await Promise.all([
      this.manifest.initialize(),
      this.views.initialize(),
      this.indexes.initialize(),
      this.patternShards.initialize(),
      this.securityShards.initialize(),
      this.examples.initialize(),
      this.callGraphShards.initialize(),
    ]);

    this.initialized = true;
  }

  /**
   * Set the raw pattern loader for fallback queries
   */
  setPatternLoader(loader: () => Promise<Pattern[]>): void {
    this.query.setRawPatternLoader(loader);
  }

  /**
   * Check if the data lake has been initialized with data
   */
  hasData(): boolean {
    const stats = this.manifest.getStats();
    return stats.patterns.total > 0;
  }

  /**
   * Get quick stats (instant, from manifest)
   */
  getQuickStats() {
    return this.manifest.getStats();
  }

  /**
   * Invalidate all caches and views
   */
  invalidateAll(): void {
    this.manifest.markAllViewsStale('full invalidation');
    this.views.invalidateCache();
    this.indexes.invalidateCache();
    this.patternShards.invalidateCache();
    this.securityShards.invalidateCache();
    this.examples.invalidateCache();
    this.callGraphShards.invalidateCache();
  }
}

/**
 * Create a new DataLake instance
 */
export function createDataLake(config: Partial<DataLakeConfig> = {}): DataLake {
  return new DataLake(config);
}
