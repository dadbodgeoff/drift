/**
 * Pattern Repository Interface
 *
 * Defines the storage abstraction layer for patterns. All pattern storage
 * implementations must implement this interface, enabling:
 * - Swappable storage backends (file, sharded, in-memory, etc.)
 * - Consistent API for all consumers
 * - Easy testing with mock implementations
 * - Caching decorators
 *
 * @module patterns/repository
 * @see PATTERN-SYSTEM-CONSOLIDATION.md
 */

import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  Severity,
  PatternSummary,
} from './types.js';

// ============================================================================
// Query Types
// ============================================================================

/**
 * Filter options for pattern queries
 */
export interface PatternFilter {
  /** Filter by pattern IDs */
  ids?: string[] | undefined;

  /** Filter by categories */
  categories?: PatternCategory[] | undefined;

  /** Filter by statuses */
  statuses?: PatternStatus[] | undefined;

  /** Filter by minimum confidence score */
  minConfidence?: number | undefined;

  /** Filter by maximum confidence score */
  maxConfidence?: number | undefined;

  /** Filter by confidence levels */
  confidenceLevels?: ConfidenceLevel[] | undefined;

  /** Filter by severities */
  severities?: Severity[] | undefined;

  /** Filter by files (patterns that have locations in any of these files) */
  files?: string[] | undefined;

  /** Filter patterns with outliers */
  hasOutliers?: boolean | undefined;

  /** Filter by tags */
  tags?: string[] | undefined;

  /** Search in name and description */
  search?: string | undefined;

  /** Filter by date range (firstSeen after) */
  createdAfter?: Date | undefined;

  /** Filter by date range (firstSeen before) */
  createdBefore?: Date | undefined;
}

/**
 * Sort options for pattern queries
 */
export interface PatternSort {
  /** Field to sort by */
  field: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'locationCount';

  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Pagination options
 */
export interface PatternPagination {
  /** Number of results to skip */
  offset: number;

  /** Maximum number of results to return */
  limit: number;
}

/**
 * Complete query options
 */
export interface PatternQueryOptions {
  /** Filter criteria */
  filter?: PatternFilter | undefined;

  /** Sort options */
  sort?: PatternSort | undefined;

  /** Pagination options */
  pagination?: PatternPagination | undefined;
}

/**
 * Result of a pattern query
 */
export interface PatternQueryResult {
  /** Matching patterns */
  patterns: Pattern[];

  /** Total count (before pagination) */
  total: number;

  /** Whether there are more results */
  hasMore: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Pattern repository event types
 */
export type PatternRepositoryEventType =
  | 'pattern:added'
  | 'pattern:updated'
  | 'pattern:deleted'
  | 'pattern:approved'
  | 'pattern:ignored'
  | 'patterns:loaded'
  | 'patterns:saved';

/**
 * Pattern repository event handler
 */
export type PatternRepositoryEventHandler = (pattern?: Pattern, metadata?: Record<string, unknown>) => void;

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Pattern Repository Interface
 *
 * Defines the contract for pattern storage implementations.
 * All storage backends (file, sharded, in-memory, cached) must implement this interface.
 */
export interface IPatternRepository {
  // === Lifecycle ===

  /**
   * Initialize the repository.
   * Creates necessary directories/structures and loads existing data.
   */
  initialize(): Promise<void>;

  /**
   * Close the repository and release resources.
   */
  close(): Promise<void>;

  // === CRUD Operations ===

  /**
   * Add a new pattern to the repository.
   * @param pattern The pattern to add
   * @throws If pattern with same ID already exists
   */
  add(pattern: Pattern): Promise<void>;

  /**
   * Add multiple patterns to the repository.
   * @param patterns The patterns to add
   */
  addMany(patterns: Pattern[]): Promise<void>;

  /**
   * Get a pattern by ID.
   * @param id The pattern ID
   * @returns The pattern or null if not found
   */
  get(id: string): Promise<Pattern | null>;

  /**
   * Update an existing pattern.
   * @param id The pattern ID
   * @param updates Partial pattern updates
   * @returns The updated pattern
   * @throws If pattern not found
   */
  update(id: string, updates: Partial<Pattern>): Promise<Pattern>;

  /**
   * Delete a pattern by ID.
   * @param id The pattern ID
   * @returns True if deleted, false if not found
   */
  delete(id: string): Promise<boolean>;

  // === Querying ===

  /**
   * Query patterns with filtering, sorting, and pagination.
   * @param options Query options
   * @returns Query result with patterns and metadata
   */
  query(options: PatternQueryOptions): Promise<PatternQueryResult>;

  /**
   * Get all patterns in a category.
   * @param category The category to filter by
   * @returns Patterns in the category
   */
  getByCategory(category: PatternCategory): Promise<Pattern[]>;

  /**
   * Get all patterns with a specific status.
   * @param status The status to filter by
   * @returns Patterns with the status
   */
  getByStatus(status: PatternStatus): Promise<Pattern[]>;

  /**
   * Get all patterns that have locations in a specific file.
   * @param file The file path to filter by
   * @returns Patterns with locations in the file
   */
  getByFile(file: string): Promise<Pattern[]>;

  /**
   * Get all patterns.
   * @returns All patterns in the repository
   */
  getAll(): Promise<Pattern[]>;

  /**
   * Count patterns matching a filter.
   * @param filter Optional filter criteria
   * @returns Count of matching patterns
   */
  count(filter?: PatternFilter): Promise<number>;

  // === Status Transitions ===

  /**
   * Approve a pattern.
   * @param id The pattern ID
   * @param approvedBy Optional user who approved
   * @returns The updated pattern
   * @throws If pattern not found or invalid transition
   */
  approve(id: string, approvedBy?: string): Promise<Pattern>;

  /**
   * Ignore a pattern.
   * @param id The pattern ID
   * @returns The updated pattern
   * @throws If pattern not found or invalid transition
   */
  ignore(id: string): Promise<Pattern>;

  // === Batch Operations ===

  /**
   * Save all pending changes to persistent storage.
   */
  saveAll(): Promise<void>;

  /**
   * Clear all patterns from the repository.
   */
  clear(): Promise<void>;

  // === Events ===

  /**
   * Subscribe to repository events.
   * @param event The event type
   * @param handler The event handler
   */
  on(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): void;

  /**
   * Unsubscribe from repository events.
   * @param event The event type
   * @param handler The event handler
   */
  off(event: PatternRepositoryEventType, handler: PatternRepositoryEventHandler): void;

  // === Utilities ===

  /**
   * Check if a pattern exists.
   * @param id The pattern ID
   * @returns True if exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get pattern summaries (lightweight listing).
   * @param options Query options
   * @returns Pattern summaries
   */
  getSummaries(options?: PatternQueryOptions): Promise<PatternSummary[]>;
}

// ============================================================================
// Repository Configuration
// ============================================================================

/**
 * Base configuration for pattern repositories
 */
export interface PatternRepositoryConfig {
  /** Root directory for storage */
  rootDir: string;

  /** Enable auto-save on changes */
  autoSave?: boolean;

  /** Auto-save debounce delay in milliseconds */
  autoSaveDelayMs?: number;

  /** Enable schema validation */
  validateSchema?: boolean;
}

/**
 * Default repository configuration
 */
export const DEFAULT_REPOSITORY_CONFIG: Required<PatternRepositoryConfig> = {
  rootDir: '.',
  autoSave: true,
  autoSaveDelayMs: 1000,
  validateSchema: true,
};
