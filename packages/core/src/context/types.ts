/**
 * Package Context Types
 * 
 * @license Apache-2.0
 * 
 * Type definitions for package-scoped context generation.
 * Enables monorepo support with per-package AI context minimization.
 */

// =============================================================================
// Package Detection Types
// =============================================================================

/**
 * Package manager type
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go' | 'maven' | 'gradle' | 'composer' | 'nuget' | 'unknown';

/**
 * Detected package in a monorepo
 */
export interface DetectedPackage {
  /** Package name from manifest */
  name: string;
  /** Relative path from project root */
  path: string;
  /** Absolute path */
  absolutePath: string;
  /** Package manager type */
  packageManager: PackageManager;
  /** Primary language */
  language: string;
  /** Dependencies (internal packages) */
  internalDependencies: string[];
  /** External dependencies */
  externalDependencies: string[];
  /** Whether this is the root package */
  isRoot: boolean;
  /** Package version if available */
  version?: string;
  /** Package description if available */
  description?: string;
}

/**
 * Monorepo structure
 */
export interface MonorepoStructure {
  /** Root directory */
  rootDir: string;
  /** Whether this is a monorepo */
  isMonorepo: boolean;
  /** Detected packages */
  packages: DetectedPackage[];
  /** Package manager for the monorepo */
  packageManager: PackageManager;
  /** Workspace configuration source */
  workspaceConfig?: string;
}

// =============================================================================
// Context Generation Types
// =============================================================================

/**
 * Options for generating package context
 */
export interface PackageContextOptions {
  /** Package name or path to generate context for */
  package: string;
  /** Maximum tokens for the context (default: 8000) */
  maxTokens?: number;
  /** Include code snippets */
  includeSnippets?: boolean;
  /** Include dependency patterns */
  includeDependencies?: boolean;
  /** Categories to include (empty = all) */
  categories?: string[];
  /** Minimum pattern confidence */
  minConfidence?: number;
  /** Output format */
  format?: 'json' | 'markdown' | 'ai-context';
  /** Include internal dependency patterns */
  includeInternalDeps?: boolean;
}

/**
 * Pattern summary for context
 */
export interface ContextPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Category */
  category: string;
  /** Confidence score */
  confidence: number;
  /** Number of occurrences in this package */
  occurrences: number;
  /** Example snippet if available */
  example?: string;
  /** Files where this pattern appears */
  files: string[];
  /** Whether this pattern is from a dependency */
  fromDependency?: string;
}

/**
 * Constraint summary for context
 */
export interface ContextConstraint {
  /** Constraint ID */
  id: string;
  /** Constraint name */
  name: string;
  /** Category */
  category: string;
  /** Enforcement level */
  enforcement: 'error' | 'warning' | 'info';
  /** Human-readable condition */
  condition: string;
  /** Guidance for following this constraint */
  guidance: string;
}

/**
 * Entry point in the package
 */
export interface ContextEntryPoint {
  /** Entry point name */
  name: string;
  /** File path */
  file: string;
  /** Type (api, event, cli, etc.) */
  type: string;
  /** HTTP method if API */
  method?: string;
  /** Route path if API */
  path?: string;
}

/**
 * Data accessor in the package
 */
export interface ContextDataAccessor {
  /** Function/method name */
  name: string;
  /** File path */
  file: string;
  /** Tables accessed */
  tables: string[];
  /** Whether it accesses sensitive data */
  accessesSensitive: boolean;
}

/**
 * Generated package context
 */
export interface PackageContext {
  /** Package information */
  package: {
    name: string;
    path: string;
    language: string;
    description?: string;
  };
  /** Summary statistics */
  summary: {
    totalPatterns: number;
    totalConstraints: number;
    totalFiles: number;
    totalEntryPoints: number;
    totalDataAccessors: number;
    estimatedTokens: number;
  };
  /** Patterns in this package */
  patterns: ContextPattern[];
  /** Constraints that apply */
  constraints: ContextConstraint[];
  /** Entry points */
  entryPoints: ContextEntryPoint[];
  /** Data accessors */
  dataAccessors: ContextDataAccessor[];
  /** Key files to understand */
  keyFiles: Array<{
    file: string;
    reason: string;
    patterns: string[];
  }>;
  /** Guidance for working in this package */
  guidance: {
    keyInsights: string[];
    commonPatterns: string[];
    warnings: string[];
  };
  /** Internal dependencies with their patterns */
  dependencies?: Array<{
    name: string;
    patterns: ContextPattern[];
  }>;
  /** Generation metadata */
  metadata: {
    generatedAt: string;
    driftVersion: string;
    contextVersion: string;
  };
}

/**
 * Result of context generation
 */
export interface PackageContextResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated context */
  context?: PackageContext;
  /** Error message if failed */
  error?: string;
  /** Warnings during generation */
  warnings: string[];
  /** Token estimate */
  tokenEstimate: number;
}

// =============================================================================
// Context Export Types
// =============================================================================

/**
 * AI-optimized context format
 */
export interface AIContextFormat {
  /** System prompt section */
  systemPrompt: string;
  /** Package conventions section */
  conventions: string;
  /** Pattern examples section */
  examples: string;
  /** Constraints section */
  constraints: string;
  /** Full combined context */
  combined: string;
  /** Token counts */
  tokens: {
    systemPrompt: number;
    conventions: number;
    examples: number;
    constraints: number;
    total: number;
  };
}

/**
 * Context cache entry
 */
export interface ContextCacheEntry {
  /** Package name */
  packageName: string;
  /** Cache key (hash of inputs) */
  cacheKey: string;
  /** Generated context */
  context: PackageContext;
  /** When cached */
  cachedAt: string;
  /** TTL in milliseconds */
  ttlMs: number;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Context generation event types
 */
export type ContextEventType =
  | 'context:generating'
  | 'context:generated'
  | 'context:cached'
  | 'context:error'
  | 'package:detected'
  | 'monorepo:detected';

/**
 * Context generation event
 */
export interface ContextEvent {
  type: ContextEventType;
  timestamp: string;
  packageName?: string;
  details?: Record<string, unknown>;
}
