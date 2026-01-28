/**
 * Data Lake Types
 *
 * Type definitions for the unified data lake architecture.
 * The data lake provides:
 * - Materialized views for instant queries
 * - Sharded storage for large datasets
 * - Pre-computed indexes for fast lookups
 * - Incremental updates for efficient rebuilds
 */

import type { PatternCategory, PatternStatus, ConfidenceLevel } from '../store/types.js';

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * The manifest is the quick-load index of everything in the data lake.
 * Reading this single file gives you all stats needed for drift_status.
 */
export interface DriftManifest {
  /** Schema version for forward compatibility */
  version: string;
  /** When the manifest was last generated */
  generatedAt: string;
  /** Absolute path to project root */
  projectRoot: string;

  /** Quick stats for drift_status */
  stats: ManifestStats;

  /** File hashes for cache invalidation */
  fileHashes: Record<string, string>;

  /** Last scan information */
  lastScan: LastScanInfo;

  /** View freshness markers */
  views: ViewFreshness;
}

export interface ManifestStats {
  patterns: PatternStats;
  security: SecurityStats;
  callGraph: CallGraphStats;
  contracts: ContractStats;
  dna: DNAStats;
}

export interface PatternStats {
  total: number;
  byCategory: Record<PatternCategory, number>;
  byStatus: Record<PatternStatus, number>;
  byConfidence: Record<ConfidenceLevel, number>;
  totalLocations: number;
  totalOutliers: number;
}

export interface SecurityStats {
  totalTables: number;
  totalAccessPoints: number;
  sensitiveFields: number;
  violations: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface CallGraphStats {
  totalFunctions: number;
  totalCalls: number;
  entryPoints: number;
  dataAccessors: number;
  avgDepth: number;
}

export interface ContractStats {
  verified: number;
  mismatch: number;
  discovered: number;
  ignored: number;
}

export interface DNAStats {
  healthScore: number;
  geneticDiversity: number;
  mutations: number;
  dominantGenes: string[];
}

export interface LastScanInfo {
  timestamp: string;
  duration: number;
  filesScanned: number;
  patternsFound: number;
  errors: number;
}

export interface ViewFreshness {
  status: ViewMeta;
  patternIndex: ViewMeta;
  securitySummary: ViewMeta;
  trends: ViewMeta;
  examples: ViewMeta;
}

export interface ViewMeta {
  generatedAt: string;
  stale: boolean;
  invalidatedBy?: string[];
}

// ============================================================================
// View Types - Pre-computed responses
// ============================================================================

/**
 * Pre-computed status view - instant drift_status response
 */
export interface StatusView {
  generatedAt: string;
  health: {
    score: number;
    trend: 'improving' | 'stable' | 'declining';
    factors: HealthFactor[];
  };
  patterns: {
    total: number;
    approved: number;
    discovered: number;
    ignored: number;
    byCategory: Record<string, number>;
  };
  issues: {
    critical: number;
    warnings: number;
    topIssues: TopIssue[];
  };
  security: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    violations: number;
    sensitiveExposures: number;
  };
  lastScan: LastScanInfo;
}

export interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  trend: 'up' | 'down' | 'stable';
}

export interface TopIssue {
  id: string;
  type: 'regression' | 'violation' | 'outlier';
  severity: 'critical' | 'warning';
  message: string;
  file?: string;
  patternId?: string;
}

/**
 * Pattern index view - lightweight pattern listing
 */
export interface PatternIndexView {
  generatedAt: string;
  total: number;
  patterns: PatternSummary[];
}

export interface PatternSummary {
  id: string;
  name: string;
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  locationCount: number;
  outlierCount: number;
  severity: string;
  /** Hash of locations for change detection */
  locationsHash: string;
}

/**
 * Security summary view - instant security overview
 */
export interface SecuritySummaryView {
  generatedAt: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: {
    totalTables: number;
    sensitiveTablesCount: number;
    totalAccessPoints: number;
    violationCount: number;
  };
  topSensitiveTables: SensitiveTableSummary[];
  topViolations: ViolationSummary[];
  recentChanges: SecurityChange[];
}

export interface SensitiveTableSummary {
  table: string;
  sensitiveFields: number;
  accessPoints: number;
  riskScore: number;
}

export interface ViolationSummary {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  file: string;
  table: string;
}

export interface SecurityChange {
  type: 'new_access' | 'new_sensitive' | 'violation_added' | 'violation_resolved';
  timestamp: string;
  description: string;
}

/**
 * Trends view - pre-computed trend analysis
 */
export interface TrendsView {
  generatedAt: string;
  period: '7d' | '30d' | '90d';
  overallTrend: 'improving' | 'stable' | 'declining';
  healthDelta: number;
  regressions: TrendItem[];
  improvements: TrendItem[];
  stableCount: number;
  categoryTrends: Record<string, CategoryTrend>;
}

export interface TrendItem {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  metric: 'confidence' | 'compliance' | 'outliers';
  previousValue: number;
  currentValue: number;
  change: number;
  severity: 'critical' | 'warning' | 'info';
}

export interface CategoryTrend {
  trend: 'improving' | 'stable' | 'declining';
  avgConfidenceChange: number;
  complianceChange: number;
}

// ============================================================================
// Index Types - Fast lookups
// ============================================================================

/**
 * File-to-patterns index
 */
export interface FileIndex {
  generatedAt: string;
  /** file path -> pattern IDs */
  patterns: Record<string, string[]>;
  /** file path -> access point IDs */
  accessPoints: Record<string, string[]>;
  /** file path -> function IDs */
  functions: Record<string, string[]>;
}

/**
 * Category-to-patterns index
 */
export interface CategoryIndex {
  generatedAt: string;
  /** category -> pattern IDs */
  patterns: Record<PatternCategory, string[]>;
  /** category -> pattern count */
  counts: Record<PatternCategory, number>;
}

/**
 * Table-to-access index
 */
export interface TableIndex {
  generatedAt: string;
  /** table name -> access point IDs */
  accessPoints: Record<string, string[]>;
  /** table name -> function IDs that access it */
  accessors: Record<string, string[]>;
  /** table name -> sensitive field names */
  sensitiveFields: Record<string, string[]>;
}

/**
 * Entry point reachability index
 */
export interface EntryPointIndex {
  generatedAt: string;
  /** entry point ID -> reachable function IDs */
  reachable: Record<string, string[]>;
  /** entry point ID -> reachable tables */
  tables: Record<string, string[]>;
  /** entry point ID -> reachable sensitive fields */
  sensitiveData: Record<string, string[]>;
}

// ============================================================================
// Shard Types - Partitioned storage
// ============================================================================

/**
 * A shard contains a subset of data for a specific key
 */
export interface Shard<T> {
  version: string;
  generatedAt: string;
  key: string;
  data: T;
  checksum: string;
}

/**
 * Pattern shard - patterns for a single category
 */
export interface PatternShard {
  category: PatternCategory;
  patterns: PatternShardEntry[];
}

export interface PatternShardEntry {
  id: string;
  name: string;
  description: string;
  /** The pattern category - stored explicitly for query retrieval */
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: {
    score: number;
    level: ConfidenceLevel;
  };
  severity: string;
  locations: PatternLocation[];
  outliers: PatternLocation[];
  metadata: PatternMetadata;
}

export interface PatternLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;
}

export interface PatternMetadata {
  firstSeen: string;
  lastSeen: string;
  approvedAt?: string;
  approvedBy?: string;
  tags?: string[];
}

/**
 * Access map shard - access points for a single table
 */
export interface AccessMapShard {
  table: string;
  model?: string;
  fields: string[];
  sensitiveFields: SensitiveFieldInfo[];
  accessPoints: AccessPointEntry[];
}

export interface SensitiveFieldInfo {
  field: string;
  sensitivity: 'pii' | 'financial' | 'auth' | 'health' | 'custom';
  reason: string;
}

export interface AccessPointEntry {
  id: string;
  file: string;
  line: number;
  column: number;
  operation: 'read' | 'write' | 'delete';
  fields: string[];
  functionId?: string;
  confidence: number;
}

/**
 * Call graph shard - functions in a single file
 */
export interface CallGraphShard {
  file: string;
  functions: FunctionEntry[];
}

export interface FunctionEntry {
  id: string;
  name: string;
  startLine: number;
  endLine: number;
  isEntryPoint: boolean;
  isDataAccessor: boolean;
  calls: CallEntry[];
  calledBy: string[];
  dataAccess: DataAccessRef[];
}

/**
 * A call entry with resolution information
 */
export interface CallEntry {
  /** Target function name (as written in code) */
  target: string;
  /** Resolved function ID (if resolved) */
  resolvedId?: string;
  /** Whether the call was resolved */
  resolved: boolean;
  /** Resolution confidence (0-1) */
  confidence: number;
  /** Line number of the call */
  line: number;
}

export interface DataAccessRef {
  table: string;
  fields: string[];
  operation: 'read' | 'write' | 'delete';
  line: number;
}

// ============================================================================
// Example Types - Pre-extracted code examples
// ============================================================================

export interface PatternExamples {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  generatedAt: string;
  examples: CodeExample[];
}

export interface CodeExample {
  file: string;
  line: number;
  endLine: number;
  code: string;
  context: string;
  quality: number;
  isOutlier: boolean;
}

// ============================================================================
// Incremental Update Types
// ============================================================================

export interface IncrementalUpdate {
  timestamp: string;
  changedFiles: string[];
  addedPatterns: string[];
  removedPatterns: string[];
  modifiedPatterns: string[];
  affectedTables: string[];
  affectedCategories: PatternCategory[];
  affectedViews: ViewType[];
}

export type ViewType = 
  | 'status'
  | 'patternIndex'
  | 'securitySummary'
  | 'trends'
  | 'examples';

export type IndexType =
  | 'byFile'
  | 'byCategory'
  | 'byTable'
  | 'byEntryPoint';

// ============================================================================
// Configuration Types
// ============================================================================

export interface DataLakeConfig {
  rootDir: string;
  /** Enable sharding for large datasets */
  enableSharding: boolean;
  /** Threshold for sharding (number of items) */
  shardThreshold: number;
  /** Enable pre-computed views */
  enableViews: boolean;
  /** Enable indexes */
  enableIndexes: boolean;
  /** Auto-rebuild stale views */
  autoRebuild: boolean;
  /** View TTL in milliseconds */
  viewTtlMs: number;
}

export const DEFAULT_DATA_LAKE_CONFIG: DataLakeConfig = {
  rootDir: '.',
  enableSharding: true,
  shardThreshold: 100,
  enableViews: true,
  enableIndexes: true,
  autoRebuild: true,
  viewTtlMs: 3600000, // 1 hour
};

// ============================================================================
// Constants
// ============================================================================

export const LAKE_VERSION = '1.0.0';

export const LAKE_DIRS = {
  root: '.drift',
  lake: 'lake',
  views: 'views',
  indexes: 'indexes',
  shards: 'shards',
  examples: 'examples',
  cursors: 'cursors',
  meta: 'meta',
} as const;

export const VIEW_FILES = {
  status: 'status.json',
  patternIndex: 'pattern-index.json',
  securitySummary: 'security-summary.json',
  trends: 'trends.json',
} as const;

export const INDEX_FILES = {
  byFile: 'by-file.json',
  byCategory: 'by-category.json',
  byTable: 'by-table.json',
  byEntryPoint: 'by-entry-point.json',
} as const;
