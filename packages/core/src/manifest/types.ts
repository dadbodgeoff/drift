/**
 * Manifest type definitions for pattern location discovery
 *
 * The manifest provides a complete architectural map of a codebase,
 * storing semantic locations for all detected patterns. This enables
 * AI agents to understand codebase architecture from a single file.
 *
 * @requirements PATTERN-LOCATION-DISCOVERY.md
 */

import type { PatternCategory } from '../store/types.js';

// ============================================================================
// Semantic Location Types
// ============================================================================

/**
 * Type of code element at a location
 */
export type SemanticType =
  | 'class'
  | 'function'
  | 'method'
  | 'variable'
  | 'constant'
  | 'interface'
  | 'type'
  | 'enum'
  | 'module'
  | 'decorator'
  | 'block'
  | 'file';

/**
 * Semantic location with rich metadata about code elements
 *
 * Unlike basic Location (file:line), SemanticLocation includes:
 * - What type of code element (class, function, method, etc.)
 * - The name and signature of the element
 * - Nested members (methods in a class, etc.)
 * - Content hash for change detection
 */
export interface SemanticLocation {
  /** Relative file path from project root */
  file: string;

  /** Content hash for change detection (first 12 chars of SHA-256) */
  hash: string;

  /** Line range in the file */
  range: {
    /** Start line (1-indexed) */
    start: number;
    /** End line (1-indexed) */
    end: number;
  };

  /** Type of code element */
  type: SemanticType;

  /** Name of the element (e.g., "AuthMiddleware", "authenticate") */
  name: string;

  /** Full signature (e.g., "class AuthMiddleware:", "async def authenticate(token: str)") */
  signature?: string;

  /** Confidence score for this location (0.0 to 1.0) */
  confidence: number;

  /** Nested members (e.g., methods in a class) */
  members?: SemanticLocation[];

  /** Code snippet (first few lines) */
  snippet?: string;

  /** Language of the file */
  language?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Manifest Types
// ============================================================================

/**
 * Pattern entry in the manifest
 */
export interface ManifestPattern {
  /** Pattern ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Pattern category */
  category: PatternCategory;

  /** Pattern subcategory */
  subcategory: string;

  /** Pattern status */
  status: 'discovered' | 'approved' | 'ignored';

  /** Overall confidence score (0.0 to 1.0) */
  confidence: number;

  /** Semantic locations where pattern is found */
  locations: SemanticLocation[];

  /** Outlier locations (violations) */
  outliers: SemanticLocation[];

  /** Pattern description */
  description?: string;

  /** When first detected */
  firstSeen: string;

  /** When last seen */
  lastSeen: string;
}

/**
 * File entry in the manifest (reverse index)
 */
export interface ManifestFile {
  /** Content hash for change detection */
  hash: string;

  /** Pattern IDs found in this file */
  patterns: string[];

  /** When this file was last scanned */
  lastScanned: string;

  /** File language */
  language?: string;

  /** Line count */
  lineCount?: number;
}

/**
 * Complete manifest structure
 *
 * The manifest contains:
 * 1. Forward index: pattern → locations
 * 2. Reverse index: file → patterns
 *
 * This enables efficient queries in both directions.
 */
export interface Manifest {
  /** Manifest format version */
  version: string;

  /** When the manifest was generated */
  generated: string;

  /** Hash of all tracked files (for quick change detection) */
  codebaseHash: string;

  /** Project root path */
  projectRoot: string;

  /** Summary statistics */
  summary: ManifestSummary;

  /** Forward index: pattern ID → pattern data with locations */
  patterns: Record<string, ManifestPattern>;

  /** Reverse index: file path → file data with pattern IDs */
  files: Record<string, ManifestFile>;
}

/**
 * Summary statistics for the manifest
 */
export interface ManifestSummary {
  /** Total number of patterns */
  totalPatterns: number;

  /** Patterns by status */
  patternsByStatus: {
    discovered: number;
    approved: number;
    ignored: number;
  };

  /** Patterns by category */
  patternsByCategory: Record<string, number>;

  /** Total number of files tracked */
  totalFiles: number;

  /** Total number of locations */
  totalLocations: number;

  /** Total number of outliers */
  totalOutliers: number;

  /** Scan duration in milliseconds */
  scanDuration?: number;
}

// ============================================================================
// Export Format Types
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'ai-context' | 'summary' | 'markdown';

/**
 * Options for exporting the manifest
 */
export interface ExportOptions {
  /** Output format */
  format: ExportFormat;

  /** Output file path (stdout if not specified) */
  output?: string;

  /** Categories to include (all if not specified) */
  categories?: PatternCategory[];

  /** Pattern statuses to include */
  statuses?: Array<'discovered' | 'approved' | 'ignored'>;

  /** Minimum confidence threshold */
  minConfidence?: number;

  /** Whether to include code snippets */
  includeSnippets?: boolean;

  /** Maximum tokens for AI context format */
  maxTokens?: number;

  /** Whether to use compact output */
  compact?: boolean;
}

/**
 * Token estimation result
 */
export interface TokenEstimate {
  /** Estimated token count */
  tokens: number;

  /** Size category */
  category: 'small' | 'medium' | 'large' | 'xlarge';

  /** Warning message if too large */
  warning?: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Query options for finding patterns
 */
export interface PatternQuery {
  /** Pattern ID or name (supports partial matching) */
  pattern?: string;

  /** Category filter */
  category?: PatternCategory;

  /** Status filter */
  status?: 'discovered' | 'approved' | 'ignored';

  /** Minimum confidence */
  minConfidence?: number;

  /** File path filter (glob pattern) */
  filePath?: string;

  /** Limit number of results */
  limit?: number;
}

/**
 * Query result for pattern locations
 */
export interface PatternQueryResult {
  /** Pattern ID */
  patternId: string;

  /** Pattern name */
  patternName: string;

  /** Pattern category */
  category: PatternCategory;

  /** Matching locations */
  locations: SemanticLocation[];

  /** Total location count (may be more than returned if limited) */
  totalCount: number;
}

/**
 * Query options for finding patterns in files
 */
export interface FileQuery {
  /** File path (supports glob patterns) */
  path: string;

  /** Whether to include nested patterns */
  includeNested?: boolean;

  /** Category filter */
  category?: PatternCategory;
}

/**
 * Query result for file patterns
 */
export interface FileQueryResult {
  /** File path */
  file: string;

  /** Patterns found in the file */
  patterns: Array<{
    id: string;
    name: string;
    category: PatternCategory;
    locations: SemanticLocation[];
  }>;

  /** File metadata */
  metadata: ManifestFile;
}
