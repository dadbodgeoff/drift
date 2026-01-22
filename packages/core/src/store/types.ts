/**
 * Store type definitions
 *
 * Provides comprehensive types for pattern storage, history tracking,
 * and querying. Patterns are stored as JSON in .drift/patterns/ directory.
 *
 * @requirements 4.1 - Patterns SHALL be stored in .drift/patterns/ directory
 * @requirements 4.2 - Pattern files SHALL use JSON format with defined schema
 * @requirements 4.3 - Patterns SHALL be organized by category subdirectories
 * @requirements 4.4 - Pattern history SHALL be tracked in .drift/history/
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 * @requirements 4.6 - Patterns SHALL support querying by category, confidence, status
 * @requirements 4.7 - drift.lock SHALL snapshot approved patterns
 */

// ============================================================================
// Pattern Status Types
// ============================================================================

/**
 * Status of a pattern in the system
 *
 * - discovered: Pattern found but not yet reviewed
 * - approved: Pattern approved for enforcement
 * - ignored: Pattern explicitly ignored by user
 *
 * @requirements 4.3 - Patterns organized by status subdirectories
 */
export type PatternStatus = 'discovered' | 'approved' | 'ignored';

/**
 * Valid state transitions for patterns
 *
 * @requirements 4.3 - Pattern state management
 */
export const VALID_STATUS_TRANSITIONS: Record<PatternStatus, PatternStatus[]> = {
  discovered: ['approved', 'ignored'],
  approved: ['ignored'],
  ignored: ['approved'],
};

// ============================================================================
// Pattern Category Types
// ============================================================================

/**
 * Categories of patterns that can be detected
 *
 * Each category corresponds to a detector category and maps to
 * a subdirectory in .drift/patterns/
 *
 * @requirements 4.3 - Patterns organized by category subdirectories
 */
export type PatternCategory =
  | 'structural'
  | 'components'
  | 'styling'
  | 'api'
  | 'auth'
  | 'errors'
  | 'data-access'
  | 'testing'
  | 'logging'
  | 'security'
  | 'config'
  | 'types'
  | 'performance'
  | 'accessibility'
  | 'documentation';

/**
 * Array of all valid pattern categories
 */
export const PATTERN_CATEGORIES: PatternCategory[] = [
  'structural',
  'components',
  'styling',
  'api',
  'auth',
  'errors',
  'data-access',
  'testing',
  'logging',
  'security',
  'config',
  'types',
  'performance',
  'accessibility',
  'documentation',
];

// ============================================================================
// Severity Types
// ============================================================================

/**
 * Severity levels for pattern violations
 *
 * - error: Blocks commits and merges
 * - warning: Displayed but doesn't block
 * - info: Informational only
 * - hint: Subtle suggestion
 */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Severity level ordering (higher = more severe)
 */
export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

// ============================================================================
// Confidence Types
// ============================================================================

/**
 * Confidence level classification based on score thresholds
 *
 * @requirements 5.3 - High confidence: score >= 0.85
 * @requirements 5.4 - Medium confidence: score >= 0.70 and < 0.85
 * @requirements 5.5 - Low confidence: score >= 0.50 and < 0.70
 * @requirements 5.6 - Uncertain: score < 0.50 (fuzzy matches, guesses)
 * 
 * Note: Thresholds raised in v1.1 to reduce false positives.
 * Uncertain level now explicitly excludes from high-confidence reports.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

/**
 * Confidence information for a pattern
 *
 * @requirements 5.1 - Confidence scoring with frequency, consistency, age, spread
 * @requirements 5.2 - Confidence score between 0.0 and 1.0
 */
export interface ConfidenceInfo {
  /** Frequency score (0.0 to 1.0) - % of applicable locations */
  frequency: number;

  /** Consistency score (0.0 to 1.0) - variance measure */
  consistency: number;

  /** Age in days since first observation */
  age: number;

  /** Spread - number of files containing the pattern */
  spread: number;

  /** Weighted overall score (0.0 to 1.0) */
  score: number;

  /** Confidence level classification */
  level: ConfidenceLevel;
}

// ============================================================================
// Location Types
// ============================================================================

/**
 * Location of a pattern occurrence in source code
 */
export interface PatternLocation {
  /** File path (relative to project root) */
  file: string;

  /** Line number (1-indexed) */
  line: number;

  /** Column number (1-indexed) */
  column: number;

  /** End line number (optional, 1-indexed) */
  endLine?: number;

  /** End column number (optional, 1-indexed) */
  endColumn?: number;
}

/**
 * Location of an outlier with reason for deviation
 */
export interface OutlierLocation extends PatternLocation {
  /** Reason why this location is an outlier */
  reason: string;

  /** Deviation score (0.0 to 1.0, higher = more deviation) */
  deviationScore?: number;
}

// ============================================================================
// Detector Configuration Types
// ============================================================================

/**
 * Type of detection method used by a detector
 */
export type DetectorType = 'ast' | 'regex' | 'semantic' | 'structural' | 'custom';

/**
 * Configuration for a pattern detector
 */
export interface DetectorConfig {
  /** Type of detection method */
  type: DetectorType;

  /** Detector-specific configuration */
  config: Record<string, unknown>;

  /** AST-specific configuration (when type is 'ast') */
  ast?: ASTDetectorConfig;

  /** Regex-specific configuration (when type is 'regex') */
  regex?: RegexDetectorConfig;

  /** Structural-specific configuration (when type is 'structural') */
  structural?: StructuralDetectorConfig;

  /** Custom detector configuration (when type is 'custom') */
  custom?: CustomDetectorConfig;
}

/**
 * Configuration for AST-based detection
 */
export interface ASTDetectorConfig {
  /** AST node type to match */
  nodeType: string;

  /** Tree-sitter query (optional) */
  query?: string;

  /** Properties to match on the node */
  properties?: Record<string, unknown>;

  /** Child patterns to match */
  children?: ASTDetectorConfig[];
}

/**
 * Configuration for regex-based detection
 */
export interface RegexDetectorConfig {
  /** Regular expression pattern */
  pattern: string;

  /** Regex flags */
  flags?: string;

  /** Named capture groups */
  captureGroups?: string[];
}

/**
 * Configuration for structural detection
 */
export interface StructuralDetectorConfig {
  /** File path pattern (glob) */
  pathPattern?: string;

  /** Directory structure pattern */
  directoryPattern?: string;

  /** File naming convention pattern */
  namingPattern?: string;

  /** Required sibling files */
  requiredSiblings?: string[];
}

/**
 * Configuration for custom detection
 */
export interface CustomDetectorConfig {
  /** Custom detector identifier */
  detectorId: string;

  /** Custom configuration options */
  options?: Record<string, unknown>;
}

// ============================================================================
// Pattern Metadata Types
// ============================================================================

/**
 * Metadata for a pattern
 */
export interface PatternMetadata {
  /** ISO timestamp when pattern was first detected */
  firstSeen: string;

  /** ISO timestamp when pattern was last seen */
  lastSeen: string;

  /** ISO timestamp when pattern was approved (if approved) */
  approvedAt?: string;

  /** User who approved the pattern (if approved) */
  approvedBy?: string;

  /** Version of the pattern definition */
  version?: string;

  /** Tags for additional categorization */
  tags?: string[];

  /** Related pattern IDs */
  relatedPatterns?: string[];

  /** Source of the pattern (e.g., 'auto-detected', 'imported', 'cheatcode2026') */
  source?: string;

  /** Custom metadata fields */
  custom?: Record<string, unknown>;
}

// ============================================================================
// Pattern Types
// ============================================================================

/**
 * A pattern stored in the pattern store
 *
 * This is the primary pattern type used throughout the store module.
 *
 * @requirements 4.2 - Pattern JSON schema
 */
export interface Pattern {
  /** Unique pattern identifier */
  id: string;

  /** Pattern category */
  category: PatternCategory;

  /** Pattern subcategory for more specific classification */
  subcategory: string;

  /** Human-readable pattern name */
  name: string;

  /** Detailed pattern description */
  description: string;

  /** Detector configuration */
  detector: DetectorConfig;

  /** Confidence information */
  confidence: ConfidenceInfo;

  /** Locations where pattern is found */
  locations: PatternLocation[];

  /** Outlier locations that deviate from the pattern */
  outliers: OutlierLocation[];

  /** Pattern metadata */
  metadata: PatternMetadata;

  /** Severity level for violations */
  severity: Severity;

  /** Whether the pattern can be auto-fixed */
  autoFixable: boolean;

  /** Current status of the pattern */
  status: PatternStatus;
}

/**
 * Stored pattern format (used in JSON files)
 *
 * Similar to Pattern but with string dates for JSON serialization.
 *
 * @requirements 4.2 - Pattern files use JSON format
 */
export interface StoredPattern {
  /** Unique pattern ID */
  id: string;

  /** Pattern subcategory */
  subcategory: string;

  /** Human-readable name */
  name: string;

  /** Pattern description */
  description: string;

  /** Detector configuration */
  detector: DetectorConfig;

  /** Confidence information */
  confidence: ConfidenceInfo;

  /** Locations where pattern is found */
  locations: PatternLocation[];

  /** Outlier locations */
  outliers: OutlierLocation[];

  /** Pattern metadata */
  metadata: PatternMetadata;

  /** Severity level */
  severity: Severity;

  /** Whether auto-fixable */
  autoFixable: boolean;
}

// ============================================================================
// Pattern File Types
// ============================================================================

/**
 * Format of a pattern file stored in .drift/patterns/
 *
 * Each category has its own JSON file containing all patterns
 * of that category.
 *
 * @requirements 4.2 - Pattern files use JSON format with defined schema
 */
export interface PatternFile {
  /** Schema version for migration support */
  version: string;

  /** Pattern category this file contains */
  category: PatternCategory;

  /** Patterns in this file */
  patterns: StoredPattern[];

  /** ISO timestamp of last update */
  lastUpdated: string;

  /** Checksum for integrity verification */
  checksum?: string;
}

/**
 * Current schema version for pattern files
 */
export const PATTERN_FILE_VERSION = '1.0.0';

// ============================================================================
// Pattern History Types
// ============================================================================

/**
 * Type of history event
 */
export type HistoryEventType =
  | 'created'
  | 'approved'
  | 'ignored'
  | 'updated'
  | 'deleted'
  | 'confidence_changed'
  | 'locations_changed'
  | 'severity_changed';

/**
 * A single history event for a pattern
 *
 * @requirements 4.4 - Pattern history tracked in .drift/history/
 */
export interface PatternHistoryEvent {
  /** ISO timestamp of the event */
  timestamp: string;

  /** Type of event */
  type: HistoryEventType;

  /** Pattern ID this event relates to */
  patternId: string;

  /** User who triggered the event (if applicable) */
  user?: string;

  /** Previous value (for updates) */
  previousValue?: unknown;

  /** New value (for updates) */
  newValue?: unknown;

  /** Additional event details */
  details?: Record<string, unknown>;
}

/**
 * History record for a pattern
 *
 * @requirements 4.4 - Pattern history tracking
 */
export interface PatternHistory {
  /** Pattern ID */
  patternId: string;

  /** Pattern category */
  category: PatternCategory;

  /** All history events for this pattern */
  events: PatternHistoryEvent[];

  /** ISO timestamp of first event */
  createdAt: string;

  /** ISO timestamp of last event */
  lastModified: string;
}

/**
 * Format of the history file stored in .drift/history/
 */
export interface HistoryFile {
  /** Schema version */
  version: string;

  /** All pattern histories */
  patterns: PatternHistory[];

  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Current schema version for history files
 */
export const HISTORY_FILE_VERSION = '1.0.0';

// ============================================================================
// Pattern Query Types
// ============================================================================

/**
 * Query options for filtering patterns
 *
 * @requirements 4.6 - Patterns support querying by category, confidence, status
 */
export interface PatternQuery {
  /** Filter by pattern IDs */
  ids?: string[];

  /** Filter by category */
  category?: PatternCategory | PatternCategory[];

  /** Filter by subcategory */
  subcategory?: string | string[];

  /** Filter by status */
  status?: PatternStatus | PatternStatus[];

  /** Filter by minimum confidence score */
  minConfidence?: number;

  /** Filter by maximum confidence score */
  maxConfidence?: number;

  /** Filter by confidence level */
  confidenceLevel?: ConfidenceLevel | ConfidenceLevel[];

  /** Filter by severity */
  severity?: Severity | Severity[];

  /** Filter by auto-fixable */
  autoFixable?: boolean;

  /** Filter by file path (patterns that have locations in this file) */
  file?: string;

  /** Filter by files (patterns that have locations in any of these files) */
  files?: string[];

  /** Filter patterns with outliers */
  hasOutliers?: boolean;

  /** Filter by minimum outlier count */
  minOutliers?: number;

  /** Filter by tag */
  tags?: string[];

  /** Filter by source */
  source?: string;

  /** Search in name and description */
  search?: string;

  /** Filter by date range (firstSeen) */
  createdAfter?: string;

  /** Filter by date range (firstSeen) */
  createdBefore?: string;

  /** Filter by date range (lastSeen) */
  seenAfter?: string;

  /** Filter by date range (lastSeen) */
  seenBefore?: string;
}

/**
 * Sort options for pattern queries
 */
export interface PatternSortOptions {
  /** Field to sort by */
  field: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'outlierCount' | 'locationCount';

  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Pagination options for pattern queries
 */
export interface PatternPaginationOptions {
  /** Number of results to skip */
  offset?: number;

  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Complete query options including filtering, sorting, and pagination
 */
export interface PatternQueryOptions {
  /** Filter criteria */
  filter?: PatternQuery;

  /** Sort options */
  sort?: PatternSortOptions;

  /** Pagination options */
  pagination?: PatternPaginationOptions;
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

  /** Query execution time in milliseconds */
  executionTime: number;
}

// ============================================================================
// Variant Types
// ============================================================================

/**
 * Scope of a variant
 */
export type VariantScope = 'global' | 'directory' | 'file';

/**
 * An intentional deviation from a pattern
 *
 * @requirements 26.1 - Variant system for intentional deviations
 */
export interface PatternVariant {
  /** Unique variant identifier */
  id: string;

  /** Pattern ID this variant applies to */
  patternId: string;

  /** Human-readable name for the variant */
  name: string;

  /** Reason explaining why this deviation is intentional */
  reason: string;

  /** Scope of the variant */
  scope: VariantScope;

  /** Scope value (directory path or file path, depending on scope) */
  scopeValue?: string;

  /** Locations covered by this variant */
  locations: PatternLocation[];

  /** ISO timestamp when variant was created */
  createdAt: string;

  /** User who created the variant */
  createdBy?: string;

  /** Whether the variant is active */
  active: boolean;
}

/**
 * Format of the variants file stored in .drift/patterns/variants/
 */
export interface VariantsFile {
  /** Schema version */
  version: string;

  /** All variants */
  variants: PatternVariant[];

  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Current schema version for variants files
 */
export const VARIANTS_FILE_VERSION = '1.0.0';

// ============================================================================
// Lock File Types
// ============================================================================

/**
 * Snapshot of an approved pattern for the lock file
 *
 * @requirements 4.7 - drift.lock snapshots approved patterns
 */
export interface LockedPattern {
  /** Pattern ID */
  id: string;

  /** Pattern category */
  category: PatternCategory;

  /** Pattern name */
  name: string;

  /** Confidence score at time of lock */
  confidenceScore: number;

  /** Severity level */
  severity: Severity;

  /** Hash of the pattern definition for change detection */
  definitionHash: string;

  /** ISO timestamp when locked */
  lockedAt: string;
}

/**
 * Format of the drift.lock file
 *
 * @requirements 4.7 - drift.lock for version control
 */
export interface LockFile {
  /** Schema version */
  version: string;

  /** Locked patterns */
  patterns: LockedPattern[];

  /** ISO timestamp when lock file was generated */
  generatedAt: string;

  /** Hash of the entire lock file for integrity */
  checksum: string;
}

/**
 * Current schema version for lock files
 */
export const LOCK_FILE_VERSION = '1.0.0';

// ============================================================================
// Store Configuration Types
// ============================================================================

/**
 * Configuration options for the pattern store
 */
export interface PatternStoreConfig {
  /** Root directory for .drift folder (defaults to project root) */
  rootDir: string;

  /** Whether to validate schemas on load/save */
  validateSchema: boolean;

  /** Whether to track history */
  trackHistory: boolean;

  /** Whether to auto-save changes */
  autoSave: boolean;

  /** Debounce time for auto-save in milliseconds */
  autoSaveDebounce: number;

  /** Whether to create backup before save */
  createBackup: boolean;

  /** Maximum number of backups to keep */
  maxBackups: number;
}

/**
 * Default pattern store configuration
 */
export const DEFAULT_PATTERN_STORE_CONFIG: PatternStoreConfig = {
  rootDir: '.',
  validateSchema: true,
  trackHistory: true,
  autoSave: false,
  autoSaveDebounce: 1000,
  createBackup: true,
  maxBackups: 5,
};

// ============================================================================
// Store Event Types
// ============================================================================

/**
 * Events emitted by the pattern store
 */
export type PatternStoreEventType =
  | 'pattern:created'
  | 'pattern:updated'
  | 'pattern:deleted'
  | 'pattern:approved'
  | 'pattern:ignored'
  | 'file:loaded'
  | 'file:saved'
  | 'error';

/**
 * Event payload for pattern store events
 */
export interface PatternStoreEvent {
  /** Event type */
  type: PatternStoreEventType;

  /** Pattern ID (if applicable) */
  patternId?: string;

  /** Pattern category (if applicable) */
  category?: PatternCategory;

  /** Additional event data */
  data?: Record<string, unknown>;

  /** ISO timestamp of the event */
  timestamp: string;
}

// ============================================================================
// Store Statistics Types
// ============================================================================

/**
 * Statistics about the pattern store
 */
export interface PatternStoreStats {
  /** Total number of patterns */
  totalPatterns: number;

  /** Patterns by status */
  byStatus: Record<PatternStatus, number>;

  /** Patterns by category */
  byCategory: Record<PatternCategory, number>;

  /** Patterns by confidence level */
  byConfidenceLevel: Record<ConfidenceLevel, number>;

  /** Total number of locations */
  totalLocations: number;

  /** Total number of outliers */
  totalOutliers: number;

  /** Total number of variants */
  totalVariants: number;

  /** ISO timestamp of last update */
  lastUpdated: string;
}
