/**
 * Error Handling Coverage Types
 *
 * Types for analyzing error handling patterns, boundaries, and propagation.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Action taken when an error is caught
 */
export type CatchAction = 'log' | 'rethrow' | 'swallow' | 'transform' | 'recover';

/**
 * Severity of an unhandled error path
 */
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Quality level of error handling
 */
export type ErrorHandlingQuality = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * A catch clause in error handling
 */
export interface CatchClause {
  /** Error type being caught (or 'any' for bare catch) */
  errorType: string;
  /** What happens: log, rethrow, swallow, transform, recover */
  action: CatchAction;
  /** Line number */
  line: number;
  /** Does it preserve the original error? */
  preservesError: boolean;
}

/**
 * Async error handling analysis
 */
export interface AsyncErrorHandling {
  /** Has .catch() on promises */
  hasCatch: boolean;
  /** Uses try/catch with await */
  hasAsyncTryCatch: boolean;
  /** Has unhandled promise chains */
  hasUnhandledPromises: boolean;
  /** Specific unhandled locations */
  unhandledLocations: Array<{ line: number; expression: string }>;
}

/**
 * Error handling profile for a function
 */
export interface ErrorHandlingProfile {
  /** Function identifier */
  functionId: string;
  /** File path */
  file: string;
  /** Function name */
  name: string;
  /** Qualified name (class.method) */
  qualifiedName: string;
  /** Line number */
  line: number;
  
  /** Does this function have try/catch? */
  hasTryCatch: boolean;
  /** Does this function throw? */
  canThrow: boolean;
  /** Throw locations */
  throwLocations: number[];
  /** What types of errors does it catch? */
  catchClauses: CatchClause[];
  /** Does it re-throw after catching? */
  rethrows: boolean;
  /** For async functions: are promises handled? */
  asyncHandling: AsyncErrorHandling | null;
  /** Is this an async function? */
  isAsync: boolean;
  /** Error handling quality score (0-100) */
  qualityScore: number;
}

/**
 * An error boundary (where errors get caught)
 */
export interface ErrorBoundary {
  /** Function that catches errors */
  functionId: string;
  /** File path */
  file: string;
  /** Function name */
  name: string;
  /** What it catches from (function IDs) */
  catchesFrom: string[];
  /** Error types handled */
  handledTypes: string[];
  /** Is this a framework boundary (React ErrorBoundary, Express middleware)? */
  isFrameworkBoundary: boolean;
  /** Framework type if applicable */
  frameworkType?: 'react-error-boundary' | 'express-middleware' | 'nestjs-filter' | 'spring-handler' | 'laravel-handler';
  /** Coverage: what % of callers are protected */
  coverage: number;
  /** Line number of catch */
  line: number;
}

/**
 * An unhandled error path
 */
export interface UnhandledErrorPath {
  /** Entry point where error originates */
  entryPoint: string;
  /** Path to where error escapes (function IDs) */
  path: string[];
  /** What type of error */
  errorType: string;
  /** Severity based on entry point type */
  severity: ErrorSeverity;
  /** Suggested fix location */
  suggestedBoundary: string;
  /** Why this is a problem */
  reason: string;
}

/**
 * Error transformation in propagation chain
 */
export interface ErrorTransformation {
  /** Location (function ID) */
  location: string;
  /** Original error type */
  fromType: string;
  /** Transformed error type */
  toType: string;
  /** Does it preserve stack trace? */
  preservesStack: boolean;
  /** Line number */
  line: number;
}

/**
 * Error propagation chain
 */
export interface ErrorPropagationChain {
  /** Where error originates */
  source: { functionId: string; throwLine: number };
  /** Where it gets caught (or null if uncaught) */
  sink: { functionId: string; catchLine: number } | null;
  /** Functions in between */
  propagationPath: string[];
  /** Does error get transformed along the way? */
  transformations: ErrorTransformation[];
  /** Chain length */
  depth: number;
}

// ============================================================================
// Topology Types
// ============================================================================

/**
 * Complete error handling topology
 */
export interface ErrorHandlingTopology {
  /** Functions with their error handling status */
  functions: Map<string, ErrorHandlingProfile>;
  /** Error boundaries (where errors get caught) */
  boundaries: ErrorBoundary[];
  /** Unhandled error paths */
  unhandledPaths: UnhandledErrorPath[];
  /** Error propagation chains */
  propagationChains: ErrorPropagationChain[];
  /** Generation timestamp */
  generatedAt: string;
  /** Project root */
  projectRoot: string;
}

/**
 * Aggregate metrics for error handling
 */
export interface ErrorHandlingMetrics {
  /** Total functions analyzed */
  totalFunctions: number;
  /** Functions with try/catch */
  functionsWithTryCatch: number;
  /** Functions that can throw */
  functionsThatThrow: number;
  /** Error boundaries count */
  boundaryCount: number;
  /** Unhandled paths count */
  unhandledCount: number;
  /** By severity */
  unhandledBySeverity: Record<ErrorSeverity, number>;
  /** Average quality score */
  avgQualityScore: number;
  /** Functions with swallowed errors */
  swallowedErrorCount: number;
  /** Async functions with unhandled promises */
  unhandledAsyncCount: number;
  /** Framework boundaries detected */
  frameworkBoundaries: number;
}

/**
 * Summary for display
 */
export interface ErrorHandlingSummary {
  /** Total functions */
  totalFunctions: number;
  /** Coverage percentage (functions with handling / total) */
  coveragePercent: number;
  /** Unhandled paths */
  unhandledPaths: number;
  /** Critical unhandled */
  criticalUnhandled: number;
  /** Average quality */
  avgQuality: number;
  /** Quality distribution */
  qualityDistribution: Record<ErrorHandlingQuality, number>;
  /** Top issues */
  topIssues: Array<{
    type: 'swallowed' | 'unhandled-async' | 'no-boundary' | 'bare-catch';
    count: number;
    severity: ErrorSeverity;
  }>;
}

// ============================================================================
// Analysis Types
// ============================================================================

/**
 * Analysis result for a specific function
 */
export interface FunctionErrorAnalysis {
  /** The function profile */
  profile: ErrorHandlingProfile;
  /** Errors this function can receive from callees */
  incomingErrors: Array<{ from: string; errorType: string }>;
  /** Where errors from this function propagate to */
  outgoingErrors: Array<{ to: string; caught: boolean }>;
  /** Is this function protected by a boundary? */
  isProtected: boolean;
  /** Protecting boundary if any */
  protectingBoundary?: ErrorBoundary;
  /** Issues found */
  issues: Array<{
    type: string;
    message: string;
    severity: ErrorSeverity;
    line?: number;
  }>;
  /** Suggestions for improvement */
  suggestions: string[];
}

/**
 * Gap analysis result
 */
export interface ErrorHandlingGap {
  /** Function with the gap */
  functionId: string;
  /** File path */
  file: string;
  /** Function name */
  name: string;
  /** Line number */
  line: number;
  /** Type of gap */
  gapType: 'no-try-catch' | 'swallowed-error' | 'unhandled-async' | 'bare-catch' | 'missing-boundary';
  /** Severity */
  severity: ErrorSeverity;
  /** Description */
  description: string;
  /** Suggested fix */
  suggestion: string;
  /** Risk score (0-100) */
  riskScore: number;
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for error handling analysis
 */
export interface ErrorHandlingOptions {
  /** Root directory */
  rootDir: string;
  /** Include async analysis */
  includeAsync?: boolean;
  /** Detect framework boundaries */
  detectFrameworkBoundaries?: boolean;
  /** Maximum propagation depth */
  maxPropagationDepth?: number;
}

/**
 * Options for gap detection
 */
export interface GapDetectionOptions {
  /** Minimum severity to report */
  minSeverity?: ErrorSeverity;
  /** Maximum gaps to return */
  limit?: number;
  /** Include suggestions */
  includeSuggestions?: boolean;
  /** Focus on specific files */
  files?: string[];
}

/**
 * Options for boundary analysis
 */
export interface BoundaryAnalysisOptions {
  /** Include framework boundaries */
  includeFramework?: boolean;
  /** Minimum coverage to report */
  minCoverage?: number;
}
