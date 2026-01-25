/**
 * Constraint Protocol Types
 *
 * Defines all types for the architectural constraint system.
 * Constraints are learned invariants that MUST be satisfied,
 * derived from patterns, call graphs, boundaries, and test topology.
 */

import type { PatternCategory } from '../store/types.js';

// =============================================================================
// Core Constraint Types
// =============================================================================

/**
 * A constraint represents an architectural invariant learned from the codebase.
 * Unlike patterns (which describe what IS), constraints enforce what MUST BE.
 */
export interface Constraint {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Detailed description */
  description: string;

  /** Constraint category */
  category: ConstraintCategory;

  /** What this constraint was derived from */
  derivedFrom: ConstraintSource;

  /** The invariant being enforced */
  invariant: ConstraintInvariant;

  /** Where this constraint applies */
  scope: ConstraintScope;

  /** Confidence metrics */
  confidence: ConstraintConfidence;

  /** Enforcement configuration */
  enforcement: ConstraintEnforcement;

  /** Lifecycle status */
  status: ConstraintStatus;

  /** Language this constraint applies to (or 'all') */
  language: ConstraintLanguage;

  /** Metadata */
  metadata: ConstraintMetadata;
}

/**
 * Constraint categories aligned with Drift's analysis capabilities
 */
export type ConstraintCategory =
  | 'api'           // API endpoint constraints
  | 'auth'          // Authentication/authorization
  | 'data'          // Data access patterns
  | 'error'         // Error handling
  | 'test'          // Test coverage
  | 'security'      // Security patterns
  | 'structural'    // Module/file structure
  | 'performance'   // Performance patterns
  | 'logging'       // Logging requirements
  | 'validation';   // Input validation

/**
 * Supported languages for constraints
 */
export type ConstraintLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'rust'
  | 'cpp'
  | 'all';

/**
 * Constraint lifecycle status
 */
export type ConstraintStatus =
  | 'discovered'    // Auto-discovered, pending review
  | 'approved'      // User-approved, actively enforced
  | 'ignored'       // User-ignored, not enforced
  | 'custom';       // User-defined constraint

// =============================================================================
// Constraint Source
// =============================================================================

/**
 * Tracks what Drift analysis data this constraint was derived from
 */
export interface ConstraintSource {
  /** Pattern IDs this was derived from */
  patterns: string[];

  /** Call graph paths analyzed */
  callGraphPaths: string[];

  /** Boundary rules involved */
  boundaries: string[];

  /** Test topology data */
  testTopology?: string[];

  /** Error handling analysis */
  errorHandling?: string[];

  /** Module coupling data */
  moduleCoupling?: string[];

  /** Wrapper detection data */
  wrappers?: string[];
}

// =============================================================================
// Constraint Invariant
// =============================================================================

/**
 * The invariant being enforced by this constraint
 */
export interface ConstraintInvariant {
  /** Type of invariant */
  type: ConstraintType;

  /** Human-readable condition */
  condition: string;

  /** Machine-checkable predicate */
  predicate: ConstraintPredicate;
}

/**
 * Types of invariants that can be enforced
 */
export type ConstraintType =
  | 'must_have'        // X must exist when Y exists
  | 'must_not_have'    // X must not exist when Y exists
  | 'must_precede'     // X must happen before Y
  | 'must_follow'      // X must happen after Y
  | 'must_colocate'    // X and Y must be in same scope
  | 'must_separate'    // X and Y must be in different scopes
  | 'must_wrap'        // X must be wrapped by Y
  | 'must_propagate'   // X must propagate through call chain
  | 'cardinality'      // Exactly N of X per Y
  | 'data_flow'        // Data must flow through X before Y
  | 'naming'           // Must follow naming convention
  | 'structure';       // Must follow structural pattern

// =============================================================================
// Constraint Predicate
// =============================================================================

/**
 * Language-agnostic predicate that can be evaluated against code.
 * Each field represents a different type of check.
 */
export interface ConstraintPredicate {
  /** Entry point constraints (API endpoints, controllers, etc.) */
  entryPointMustHave?: EntryPointPredicate;

  /** Function-level constraints */
  functionMustHave?: FunctionPredicate;

  /** Class-level constraints */
  classMustHave?: ClassPredicate;

  /** Data access constraints */
  dataAccess?: DataAccessPredicate;

  /** Call chain constraints */
  callChain?: CallChainPredicate;

  /** Test coverage constraints */
  testCoverage?: TestCoveragePredicate;

  /** Naming convention constraints */
  naming?: NamingPredicate;

  /** File structure constraints */
  fileStructure?: FileStructurePredicate;
}


/**
 * Predicate for entry point constraints (API endpoints, controllers)
 */
export interface EntryPointPredicate {
  /** Must have these in the call chain before the handler */
  inCallChain?: string[];

  /** Position requirement */
  position?: 'before_handler' | 'after_handler' | 'anywhere';

  /** Must have these decorators (TypeScript/Python) */
  decorator?: string[];

  /** Must have these annotations (Java) */
  annotation?: string[];

  /** Must have these attributes (C#) */
  attribute?: string[];

  /** Must have these middleware (Express/Laravel/etc.) */
  middleware?: string[];

  /** Must have specific HTTP methods */
  httpMethods?: string[];

  /** Must have specific response types */
  responseType?: string[];
}

/**
 * Predicate for function-level constraints
 */
export interface FunctionPredicate {
  /** Must have these decorators */
  decorator?: string[];

  /** Must have these annotations */
  annotation?: string[];

  /** Must have these attributes */
  attribute?: string[];

  /** Must have parameter matching criteria */
  parameter?: {
    type: string;
    contains?: string[];
    name?: string;
  };

  /** Must have specific return type */
  returnType?: string;

  /** Must have error handling */
  errorHandling?: boolean;

  /** Must be within N call levels of entry point */
  withinDepthOf?: {
    entryPoint?: number;
    dataAccess?: number;
  };

  /** Function body must contain */
  bodyContains?: string[];

  /** Function body must not contain */
  bodyMustNotContain?: string[];

  /** Must be async */
  isAsync?: boolean;
}

/**
 * Predicate for class-level constraints
 */
export interface ClassPredicate {
  /** Must have these decorators */
  decorator?: string[];

  /** Must have these annotations */
  annotation?: string[];

  /** Must have these attributes */
  attribute?: string[];

  /** Must implement these interfaces */
  implements?: string[];

  /** Must extend these classes */
  extends?: string[];

  /** Methods must have these annotations */
  methodAnnotation?: string[];

  /** Class or methods must have these attributes */
  classOrMethodAttribute?: string[];

  /** Must have specific constructor parameters */
  constructorParams?: string[];

  /** Must have specific fields/properties */
  fields?: string[];
}

/**
 * Predicate for data access constraints
 */
export interface DataAccessPredicate {
  /** Table/collection being accessed */
  table: string;

  /** Must go through these classes/functions */
  mustGoThrough?: string[];

  /** Must not access directly */
  mustNotAccess?: string[];

  /** Requires authentication before access */
  requiresAuth?: boolean;

  /** Specific operations (read/write/delete) */
  operations?: ('read' | 'write' | 'delete')[];

  /** Sensitive fields that need extra protection */
  sensitiveFields?: string[];
}

/**
 * Predicate for call chain constraints
 */
export interface CallChainPredicate {
  /** Starting point (function, class, or 'entryPoint') */
  from: string;

  /** Ending point (function, class, or 'dataAccess') */
  to: string;

  /** Must include these in the chain */
  mustInclude?: string[];

  /** Must not include these in the chain */
  mustNotInclude?: string[];

  /** Maximum call depth */
  maxDepth?: number;

  /** Minimum call depth */
  minDepth?: number;
}

/**
 * Predicate for test coverage constraints
 */
export interface TestCoveragePredicate {
  /** Minimum number of tests */
  minCoverage?: number;

  /** Types of tests required */
  types?: ('unit' | 'integration' | 'e2e')[];

  /** Must test these scenarios */
  mustTest?: ('happy_path' | 'error_cases' | 'edge_cases' | 'security')[];

  /** Maximum mock ratio (mocks / real calls) */
  maxMockRatio?: number;

  /** Minimum assertion count */
  minAssertions?: number;
}

/**
 * Predicate for naming convention constraints
 */
export interface NamingPredicate {
  /** Regex pattern to match */
  pattern: string;

  /** What the pattern applies to */
  scope: 'file' | 'function' | 'class' | 'variable' | 'parameter';

  /** Case style */
  caseStyle?: 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE' | 'kebab-case';

  /** Required prefix */
  prefix?: string;

  /** Required suffix */
  suffix?: string;
}

/**
 * Predicate for file structure constraints
 */
export interface FileStructurePredicate {
  /** File must be in these directories */
  directories?: string[];

  /** File must match these glob patterns */
  filePatterns?: string[];

  /** Must have these imports */
  mustImport?: string[];

  /** Must not have these imports */
  mustNotImport?: string[];

  /** Must export these symbols */
  mustExport?: string[];

  /** Maximum file length (lines) */
  maxLines?: number;

  /** Maximum function count per file */
  maxFunctions?: number;
}

// =============================================================================
// Constraint Scope
// =============================================================================

/**
 * Defines where a constraint applies
 */
export interface ConstraintScope {
  /** File glob patterns */
  files?: string[];

  /** Function name patterns (regex) */
  functions?: string[];

  /** Class name patterns (regex) */
  classes?: string[];

  /** Pattern categories this applies to */
  categories?: PatternCategory[];

  /** Apply to all entry points */
  entryPoints?: boolean;

  /** Apply to all data accessors */
  dataAccessors?: boolean;

  /** Apply to specific modules */
  modules?: string[];

  /** Framework-specific scope */
  frameworks?: string[];

  /** Exclusion patterns */
  exclude?: {
    files?: string[];
    functions?: string[];
    classes?: string[];
    directories?: string[];
  };
}

// =============================================================================
// Constraint Confidence
// =============================================================================

/**
 * Confidence metrics for a constraint
 */
export interface ConstraintConfidence {
  /** Overall confidence score (0-1) */
  score: number;

  /** Number of conforming instances */
  evidence: number;

  /** Number of violations found */
  violations: number;

  /** Violation details for review */
  violationDetails?: ConstraintViolationDetail[];

  /** When confidence was last calculated */
  lastVerified: string;

  /** Confidence trend */
  trend?: 'improving' | 'stable' | 'declining';
}

/**
 * Detail about a specific violation during extraction
 */
export interface ConstraintViolationDetail {
  file: string;
  line: number;
  reason: string;
  functionName?: string;
  className?: string;
}

// =============================================================================
// Constraint Enforcement
// =============================================================================

/**
 * How a constraint is enforced
 */
export interface ConstraintEnforcement {
  /** Severity level */
  level: 'error' | 'warning' | 'info';

  /** Can this be auto-fixed? */
  autoFix?: ConstraintFix;

  /** Human guidance for fixing */
  guidance: string;

  /** Related documentation URL */
  docs?: string;

  /** Example of correct implementation */
  example?: ConstraintExample;
}

/**
 * Auto-fix configuration
 */
export interface ConstraintFix {
  /** Type of fix */
  type: ConstraintFixType;

  /** Fix template (language-specific) */
  template: string;

  /** Templates per language */
  templates?: Partial<Record<ConstraintLanguage, string>>;

  /** Confidence that fix is correct */
  confidence: number;

  /** Additional context for the fix */
  context?: string;
}

/**
 * Types of auto-fixes available
 */
export type ConstraintFixType =
  | 'add_decorator'
  | 'add_middleware'
  | 'wrap_try_catch'
  | 'add_annotation'
  | 'add_attribute'
  | 'add_import'
  | 'add_parameter'
  | 'add_validation'
  | 'add_logging'
  | 'refactor'
  | 'rename'
  | 'move_file';

/**
 * Example of correct implementation
 */
export interface ConstraintExample {
  file: string;
  line: number;
  endLine?: number;
  code: string;
  description?: string;
}

// =============================================================================
// Constraint Metadata
// =============================================================================

/**
 * Metadata about a constraint
 */
export interface ConstraintMetadata {
  /** When first discovered */
  createdAt: string;

  /** When last updated */
  updatedAt: string;

  /** Who approved (if approved) */
  approvedBy?: string;

  /** When approved */
  approvedAt?: string;

  /** Tags for filtering */
  tags?: string[];

  /** Related constraints */
  relatedConstraints?: string[];

  /** Notes */
  notes?: string;

  /** Version of the constraint schema */
  schemaVersion: string;
}


// =============================================================================
// Verification Types
// =============================================================================

/**
 * Result of verifying code against constraints
 */
export interface VerificationResult {
  /** Overall pass/fail */
  passed: boolean;

  /** Summary message */
  summary: string;

  /** Constraints that were satisfied */
  satisfied: SatisfiedConstraint[];

  /** Constraints that were violated */
  violations: ConstraintViolation[];

  /** Constraints that couldn't be checked */
  skipped: SkippedConstraint[];

  /** Execution metadata */
  metadata: VerificationMetadata;
}

/**
 * A constraint that was satisfied
 */
export interface SatisfiedConstraint {
  constraintId: string;
  constraintName: string;
  category: ConstraintCategory;
}

/**
 * A constraint violation
 */
export interface ConstraintViolation {
  /** Constraint that was violated */
  constraintId: string;
  constraintName: string;
  category: ConstraintCategory;
  severity: 'error' | 'warning' | 'info';

  /** What was violated */
  message: string;

  /** Where in the code */
  location: ViolationLocation;

  /** Fix suggestion */
  fix?: ViolationFix;

  /** Example of correct implementation */
  example?: ConstraintExample;

  /** Human guidance */
  guidance: string;
}

/**
 * Location of a violation in code
 */
export interface ViolationLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;
}

/**
 * Fix suggestion for a violation
 */
export interface ViolationFix {
  type: ConstraintFixType;
  suggestion: string;
  confidence: number;
  /** Diff-style replacement */
  replacement?: {
    startLine: number;
    endLine: number;
    newContent: string;
  };
}

/**
 * A constraint that was skipped
 */
export interface SkippedConstraint {
  constraintId: string;
  constraintName: string;
  reason: string;
}

/**
 * Metadata about the verification
 */
export interface VerificationMetadata {
  file: string;
  language: ConstraintLanguage;
  constraintsChecked: number;
  executionTimeMs: number;
  timestamp: string;
}

// =============================================================================
// Index Types
// =============================================================================

/**
 * Index for fast constraint lookups
 */
export interface ConstraintIndex {
  version: string;
  generatedAt: string;

  /** Total counts */
  counts: ConstraintCounts;

  /** Quick lookup maps */
  byFile: Record<string, string[]>;      // file glob → constraint IDs
  byCategory: Record<string, string[]>;  // category → constraint IDs
  byLanguage: Record<string, string[]>;  // language → constraint IDs
  byStatus: Record<string, string[]>;    // status → constraint IDs

  /** Constraint summaries for fast listing */
  summaries: ConstraintSummary[];
}

/**
 * Constraint counts by various dimensions
 */
export interface ConstraintCounts {
  total: number;
  byStatus: Record<ConstraintStatus, number>;
  byCategory: Record<ConstraintCategory, number>;
  byLanguage: Record<ConstraintLanguage, number>;
  byEnforcement: Record<'error' | 'warning' | 'info', number>;
}

/**
 * Summary of a constraint for listing
 */
export interface ConstraintSummary {
  id: string;
  name: string;
  description: string;
  category: ConstraintCategory;
  language: ConstraintLanguage;
  status: ConstraintStatus;
  confidence: number;
  enforcement: 'error' | 'warning' | 'info';
  evidence: number;
  violations: number;
  type: ConstraintType;
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Options for querying constraints
 */
export interface ConstraintQueryOptions {
  /** Filter by category */
  category?: ConstraintCategory;

  /** Filter by categories */
  categories?: ConstraintCategory[];

  /** Filter by status */
  status?: ConstraintStatus;

  /** Filter by statuses */
  statuses?: ConstraintStatus[];

  /** Filter by language */
  language?: ConstraintLanguage;

  /** Filter by minimum confidence */
  minConfidence?: number;

  /** Filter by enforcement level */
  enforcement?: 'error' | 'warning' | 'info';

  /** Filter by file (returns constraints applicable to file) */
  file?: string;

  /** Search in name/description */
  search?: string;

  /** Filter by tags */
  tags?: string[];

  /** Pagination limit */
  limit?: number;

  /** Pagination offset */
  offset?: number;
}

/**
 * Result of a constraint query
 */
export interface ConstraintQueryResult {
  constraints: Constraint[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

// =============================================================================
// Extraction Types
// =============================================================================

/**
 * Options for constraint extraction
 */
export interface ExtractionOptions {
  /** Minimum confidence threshold for discovered constraints */
  minConfidence?: number;

  /** Categories to extract */
  categories?: ConstraintCategory[];

  /** Languages to analyze */
  languages?: ConstraintLanguage[];

  /** Force re-extraction even if recent */
  force?: boolean;

  /** Include detailed violation info */
  includeViolationDetails?: boolean;
}

/**
 * Result of constraint extraction
 */
export interface ExtractionResult {
  /** Newly discovered constraints */
  discovered: Constraint[];

  /** Updated existing constraints */
  updated: Constraint[];

  /** Constraints that are no longer valid */
  invalidated: string[];

  /** Extraction statistics */
  stats: ExtractionStats;
}

/**
 * Statistics from extraction
 */
export interface ExtractionStats {
  patternsAnalyzed: number;
  candidatesFound: number;
  constraintsCreated: number;
  constraintsUpdated: number;
  constraintsInvalidated: number;
  executionTimeMs: number;
  byCategory: Record<ConstraintCategory, number>;
  byLanguage: Record<ConstraintLanguage, number>;
}

// =============================================================================
// Constants
// =============================================================================

export const CONSTRAINT_SCHEMA_VERSION = '1.0.0';

export const CONSTRAINT_CATEGORIES: ConstraintCategory[] = [
  'api',
  'auth',
  'data',
  'error',
  'test',
  'security',
  'structural',
  'performance',
  'logging',
  'validation',
];

export const CONSTRAINT_LANGUAGES: ConstraintLanguage[] = [
  'typescript',
  'javascript',
  'python',
  'java',
  'csharp',
  'php',
  'rust',
  'cpp',
  'all',
];

export const CONSTRAINT_STATUSES: ConstraintStatus[] = [
  'discovered',
  'approved',
  'ignored',
  'custom',
];

export const CONSTRAINT_TYPES: ConstraintType[] = [
  'must_have',
  'must_not_have',
  'must_precede',
  'must_follow',
  'must_colocate',
  'must_separate',
  'must_wrap',
  'must_propagate',
  'cardinality',
  'data_flow',
  'naming',
  'structure',
];

/** Default confidence threshold for constraint discovery */
export const DEFAULT_MIN_CONFIDENCE = 0.90;

/** Default enforcement level for discovered constraints */
export const DEFAULT_ENFORCEMENT_LEVEL: 'error' | 'warning' | 'info' = 'warning';
