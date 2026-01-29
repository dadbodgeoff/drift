/**
 * Pattern Service Interface
 *
 * Defines the consumer-facing API for pattern operations. This is the
 * recommended interface for all consumers (MCP tools, CLI, Dashboard).
 *
 * The service layer provides:
 * - Higher-level operations than the repository
 * - Business logic (validation, enrichment)
 * - Caching integration
 * - Metrics collection
 *
 * @module patterns/service
 * @see PATTERN-SYSTEM-CONSOLIDATION.md
 */

import type { PatternQueryOptions, PatternQueryResult } from './repository.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  PatternSummary,
} from './types.js';

// ============================================================================
// Status Types
// ============================================================================

/**
 * Overall pattern system status
 */
export interface PatternSystemStatus {
  /** Total number of patterns */
  totalPatterns: number;

  /** Patterns by status */
  byStatus: Record<PatternStatus, number>;

  /** Patterns by category */
  byCategory: Record<PatternCategory, number>;

  /** Patterns by confidence level */
  byConfidence: Record<ConfidenceLevel, number>;

  /** Last scan timestamp */
  lastScanAt: Date | null;

  /** Overall health score (0-100) */
  healthScore: number;
}

/**
 * Category summary for exploration
 */
export interface CategorySummary {
  /** Category name */
  category: PatternCategory;

  /** Total patterns in category */
  count: number;

  /** Approved patterns */
  approvedCount: number;

  /** Discovered patterns */
  discoveredCount: number;

  /** High confidence patterns */
  highConfidenceCount: number;
}

// ============================================================================
// Pattern With Examples
// ============================================================================

/**
 * Code example from a pattern location
 */
export interface CodeExample {
  /** File path */
  file: string;

  /** Start line */
  startLine: number;

  /** End line */
  endLine: number;

  /** Code content */
  code: string;

  /** Programming language */
  language: string;
}

/**
 * Pattern with enriched code examples
 */
export interface PatternWithExamples extends Pattern {
  /** Code examples from pattern locations */
  codeExamples: CodeExample[];

  /** Related patterns */
  relatedPatterns: PatternSummary[];
}

// ============================================================================
// List Options
// ============================================================================

/**
 * Options for listing patterns
 */
export interface ListOptions {
  /** Number of results to skip */
  offset?: number;

  /** Maximum number of results */
  limit?: number;

  /** Sort field */
  sortBy?: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'locationCount';

  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  /** Items in this page */
  items: T[];

  /** Total count */
  total: number;

  /** Whether there are more results */
  hasMore: boolean;

  /** Current offset */
  offset: number;

  /** Current limit */
  limit: number;
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Categories to search in */
  categories?: PatternCategory[];

  /** Statuses to include */
  statuses?: PatternStatus[];

  /** Minimum confidence */
  minConfidence?: number;

  /** Maximum results */
  limit?: number;
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * Pattern Service Interface
 *
 * High-level API for pattern operations. All consumers should use this
 * interface instead of directly accessing the repository.
 */
export interface IPatternService {
  // === Discovery (instant, lightweight) ===

  /**
   * Get overall pattern system status.
   * Optimized for instant response.
   */
  getStatus(): Promise<PatternSystemStatus>;

  /**
   * Get category summaries.
   * Optimized for instant response.
   */
  getCategories(): Promise<CategorySummary[]>;

  // === Exploration (paginated) ===

  /**
   * List patterns with pagination.
   * @param options List options
   */
  listPatterns(options?: ListOptions): Promise<PaginatedResult<PatternSummary>>;

  /**
   * List patterns in a category.
   * @param category The category
   * @param options List options
   */
  listByCategory(
    category: PatternCategory,
    options?: ListOptions
  ): Promise<PaginatedResult<PatternSummary>>;

  /**
   * List patterns with a specific status.
   * @param status The status
   * @param options List options
   */
  listByStatus(
    status: PatternStatus,
    options?: ListOptions
  ): Promise<PaginatedResult<PatternSummary>>;

  // === Detail (focused) ===

  /**
   * Get a pattern by ID.
   * @param id The pattern ID
   */
  getPattern(id: string): Promise<Pattern | null>;

  /**
   * Get a pattern with code examples.
   * @param id The pattern ID
   * @param maxExamples Maximum examples to include
   */
  getPatternWithExamples(id: string, maxExamples?: number): Promise<PatternWithExamples | null>;

  /**
   * Get patterns in a specific file.
   * @param file The file path
   */
  getPatternsByFile(file: string): Promise<Pattern[]>;

  // === Actions ===

  /**
   * Approve a pattern.
   * @param id The pattern ID
   * @param approvedBy Optional user who approved
   */
  approvePattern(id: string, approvedBy?: string): Promise<Pattern>;

  /**
   * Ignore a pattern.
   * @param id The pattern ID
   */
  ignorePattern(id: string): Promise<Pattern>;

  /**
   * Approve multiple patterns.
   * @param ids The pattern IDs
   * @param approvedBy Optional user who approved
   */
  approveMany(ids: string[], approvedBy?: string): Promise<Pattern[]>;

  /**
   * Ignore multiple patterns.
   * @param ids The pattern IDs
   */
  ignoreMany(ids: string[]): Promise<Pattern[]>;

  // === Search ===

  /**
   * Search patterns by name/description.
   * @param query Search query
   * @param options Search options
   */
  search(query: string, options?: SearchOptions): Promise<PatternSummary[]>;

  // === Advanced Queries ===

  /**
   * Execute a custom query.
   * @param options Query options
   */
  query(options: PatternQueryOptions): Promise<PatternQueryResult>;

  // === Write Operations (for producers like scan) ===

  /**
   * Add a new pattern.
   * @param pattern The pattern to add
   */
  addPattern(pattern: Pattern): Promise<void>;

  /**
   * Add multiple patterns.
   * @param patterns The patterns to add
   */
  addPatterns(patterns: Pattern[]): Promise<void>;

  /**
   * Update an existing pattern.
   * @param id The pattern ID
   * @param updates Partial pattern updates
   */
  updatePattern(id: string, updates: Partial<Pattern>): Promise<Pattern>;

  /**
   * Delete a pattern.
   * @param id The pattern ID
   */
  deletePattern(id: string): Promise<boolean>;

  /**
   * Save all pending changes.
   */
  save(): Promise<void>;

  /**
   * Clear all patterns.
   */
  clear(): Promise<void>;
}

// ============================================================================
// Service Configuration
// ============================================================================

/**
 * Pattern service configuration
 */
export interface PatternServiceConfig {
  /** Enable caching */
  enableCache?: boolean;

  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;

  /** Enable metrics collection */
  enableMetrics?: boolean;

  /** Context lines for code examples */
  codeExampleContextLines?: number;
}

/**
 * Default service configuration
 */
export const DEFAULT_SERVICE_CONFIG: Required<PatternServiceConfig> = {
  enableCache: true,
  cacheTtlMs: 60000, // 1 minute
  enableMetrics: true,
  codeExampleContextLines: 5,
};
