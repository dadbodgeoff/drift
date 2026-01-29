/**
 * Language Intelligence Layer - Core Types
 *
 * Unified semantic model for cross-language code analysis.
 * This layer sits ON TOP of existing extractors, adding semantic
 * normalization without modifying any existing code.
 */

import type { DataAccessPoint } from '../boundaries/types.js';
import type { CallGraphLanguage, FunctionExtraction, FileExtractionResult } from '../call-graph/types.js';

// ============================================================================
// Semantic Categories
// ============================================================================

/**
 * High-level semantic categories for decorators/annotations
 */
export type SemanticCategory =
  | 'routing'      // HTTP endpoints, API routes
  | 'di'           // Dependency injection
  | 'orm'          // Database/ORM related
  | 'auth'         // Authentication/authorization
  | 'validation'   // Input validation
  | 'test'         // Test annotations
  | 'logging'      // Logging/tracing
  | 'caching'      // Cache control
  | 'scheduling'   // Scheduled tasks, cron
  | 'messaging'    // Message queues, events
  | 'middleware'   // Request/response middleware
  | 'unknown';     // Unrecognized decorator

/**
 * HTTP methods for routing decorators
 * Note: Aligned with contracts.ts HttpMethod for compatibility
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Data access mode
 */
export type DataAccessMode = 'read' | 'write' | 'both';

// ============================================================================
// Normalized Decorator
// ============================================================================

/**
 * Semantic meaning extracted from a decorator/annotation
 */
export interface DecoratorSemantics {
  /** High-level category */
  category: SemanticCategory;

  /** Human-readable description of what this decorator does */
  intent: string;

  /** Whether this marks a function as an entry point (API endpoint, event handler, etc.) */
  isEntryPoint: boolean;

  /** Whether this marks a class/function as injectable (DI service) */
  isInjectable: boolean;

  /** Whether this marks a function as requiring authentication */
  requiresAuth: boolean;

  /** Data access mode if this is an ORM decorator */
  dataAccess?: DataAccessMode;

  /** Confidence score (0-1) for this semantic interpretation */
  confidence: number;
}

/**
 * Normalized decorator that works across all languages
 *
 * Takes raw decorator strings like "@Controller", "[ApiController]", "@app.route"
 * and normalizes them to a common semantic model.
 */
export interface NormalizedDecorator {
  /** Original raw decorator string as extracted by tree-sitter */
  raw: string;

  /** Normalized name (without @ or [] or language-specific syntax) */
  name: string;

  /** Source language */
  language: CallGraphLanguage;

  /** Framework that defines this decorator (if known) */
  framework?: string;

  /** Semantic meaning */
  semantic: DecoratorSemantics;

  /** Extracted arguments from the decorator */
  arguments: DecoratorArguments;
}

/**
 * Common decorator arguments extracted across languages
 */
export interface DecoratorArguments {
  /** Route path for routing decorators: "/api/users" */
  path?: string;

  /** HTTP methods: ["GET", "POST"] */
  methods?: HttpMethod[];

  /** Named route/endpoint */
  name?: string;

  /** Middleware/guards to apply */
  middleware?: string[];

  /** Roles/permissions required */
  roles?: string[];

  /** Scope for DI (singleton, transient, scoped) */
  scope?: 'singleton' | 'transient' | 'scoped';

  /** Generic key-value arguments */
  [key: string]: unknown;
}

// ============================================================================
// Normalized Function
// ============================================================================

/**
 * Semantic information derived from a function and its decorators
 */
export interface FunctionSemantics {
  /** Is this an entry point (API endpoint, event handler, CLI command, etc.) */
  isEntryPoint: boolean;

  /** Is this a data accessor (reads/writes to database) */
  isDataAccessor: boolean;

  /** Is this an auth handler (login, logout, token validation) */
  isAuthHandler: boolean;

  /** Is this a test case */
  isTestCase: boolean;

  /** Is this an injectable service */
  isInjectable: boolean;

  /** Entry point details (if isEntryPoint) */
  entryPoint?: {
    type: 'http' | 'graphql' | 'grpc' | 'websocket' | 'event' | 'scheduled' | 'cli';
    path?: string | undefined;
    methods?: HttpMethod[] | undefined;
  } | undefined;

  /** Injected dependencies (service names) */
  dependencies: string[];

  /** Data access points within this function */
  dataAccess: DataAccessPoint[];

  /** Required authentication/authorization */
  auth?: {
    required: boolean;
    roles?: string[] | undefined;
    permissions?: string[] | undefined;
  } | undefined;
}

/**
 * Normalized function with semantic enrichment
 *
 * Extends the raw FunctionExtraction with semantic information
 * derived from decorators and framework knowledge.
 */
export interface NormalizedFunction extends FunctionExtraction {
  /** Normalized decorators with semantic meaning */
  normalizedDecorators: NormalizedDecorator[];

  /** Derived semantic information */
  semantics: FunctionSemantics;
}

// ============================================================================
// Normalized Extraction Result
// ============================================================================

/**
 * Result of normalizing a file extraction
 */
export interface NormalizedExtractionResult extends Omit<FileExtractionResult, 'functions'> {
  /** Normalized functions with semantic enrichment */
  functions: NormalizedFunction[];

  /** Detected frameworks in this file */
  detectedFrameworks: string[];

  /** Overall file semantics */
  fileSemantics: {
    /** Is this a controller/router file */
    isController: boolean;
    /** Is this a service/provider file */
    isService: boolean;
    /** Is this a model/entity file */
    isModel: boolean;
    /** Is this a test file */
    isTestFile: boolean;
    /** Primary framework detected */
    primaryFramework?: string | undefined;
  };
}

// ============================================================================
// Framework Pattern Types
// ============================================================================

/**
 * A single decorator pattern mapping
 */
export interface DecoratorMapping {
  /** Pattern to match decorator strings (applied to already-extracted decorator) */
  pattern: RegExp;

  /** Semantic meaning when matched */
  semantic: Omit<DecoratorSemantics, 'confidence'>;

  /** Function to extract arguments from the raw decorator string */
  extractArgs: (raw: string) => DecoratorArguments;

  /** Confidence score for this mapping (default: 1.0) */
  confidence?: number;
}

/**
 * Framework pattern definition
 *
 * Declarative definition of how a framework uses decorators/annotations.
 * This is the "knowledge base" that powers semantic normalization.
 */
export interface FrameworkPattern {
  /** Framework identifier: "spring", "laravel", "fastapi", "nestjs", "aspnet" */
  framework: string;

  /** Display name: "Spring Boot", "Laravel", "FastAPI" */
  displayName: string;

  /** Languages this framework applies to */
  languages: CallGraphLanguage[];

  /** Version constraints (optional) */
  version?: string;

  /** Decorator/annotation mappings */
  decoratorMappings: DecoratorMapping[];

  /** Patterns that indicate this framework is in use (for detection) */
  detectionPatterns: {
    /** Import patterns that indicate framework usage */
    imports?: RegExp[];
    /** Decorator patterns that indicate framework usage */
    decorators?: RegExp[];
    /** File patterns (e.g., "*.controller.ts" for NestJS) */
    filePatterns?: RegExp[];
  };

  /** Patterns that mark entry points */
  entryPointPatterns: RegExp[];

  /** Patterns that mark injectable services */
  diPatterns: RegExp[];

  /** Patterns that indicate ORM/data access */
  ormPatterns: RegExp[];

  /** Patterns that indicate auth requirements */
  authPatterns: RegExp[];
}

// ============================================================================
// Language Normalizer Interface
// ============================================================================

/**
 * Interface for language-specific normalizers
 *
 * Each normalizer wraps an existing extractor and adds semantic normalization.
 */
export interface LanguageNormalizer {
  /** Language this normalizer handles */
  readonly language: CallGraphLanguage;

  /** File extensions this normalizer handles */
  readonly extensions: string[];

  /**
   * Normalize an extraction result
   *
   * Takes raw extraction from existing extractor and adds semantic information.
   */
  normalize(source: string, filePath: string): NormalizedExtractionResult;

  /**
   * Normalize a single decorator string
   */
  normalizeDecorator(raw: string, frameworks: FrameworkPattern[]): NormalizedDecorator;

  /**
   * Detect which frameworks are in use in the source
   */
  detectFrameworks(source: string): FrameworkPattern[];

  /**
   * Check if this normalizer can handle a file
   */
  canHandle(filePath: string): boolean;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying normalized functions
 */
export interface QueryOptions {
  /** Filter by semantic category */
  category?: SemanticCategory;

  /** Filter by framework */
  framework?: string;

  /** Filter by language */
  language?: CallGraphLanguage;

  /** Only entry points */
  entryPointsOnly?: boolean;

  /** Only data accessors */
  dataAccessorsOnly?: boolean;

  /** Only functions requiring auth */
  authRequiredOnly?: boolean;

  /** Filter by table name (for data accessors) */
  table?: string;
}

/**
 * Result of a cross-language query
 */
export interface QueryResult {
  /** Matching functions */
  functions: NormalizedFunction[];

  /** Files containing matches */
  files: string[];

  /** Frameworks involved */
  frameworks: string[];

  /** Languages involved */
  languages: CallGraphLanguage[];

  /** Total count */
  count: number;
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Configuration for the Language Intelligence system
 */
export interface LanguageIntelligenceConfig {
  /** Root directory of the project */
  rootDir: string;

  /** Additional framework patterns to register */
  customFrameworks?: FrameworkPattern[];

  /** Whether to auto-detect frameworks */
  autoDetect?: boolean;

  /** Verbose logging */
  verbose?: boolean;
}
