/**
 * Enterprise Error Handler
 * 
 * Provides structured error responses with:
 * - Consistent error codes
 * - Recovery suggestions for AI
 * - Request tracking
 */

export enum DriftErrorCode {
  // Client errors (4xx equivalent)
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  PATTERN_NOT_FOUND = 'PATTERN_NOT_FOUND',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  INVALID_CURSOR = 'INVALID_CURSOR',
  INVALID_CATEGORY = 'INVALID_CATEGORY',
  MISSING_REQUIRED_PARAM = 'MISSING_REQUIRED_PARAM',
  
  // Server errors (5xx equivalent)
  SCAN_REQUIRED = 'SCAN_REQUIRED',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  
  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Resource errors
  CALLGRAPH_NOT_BUILT = 'CALLGRAPH_NOT_BUILT',
  DNA_NOT_ANALYZED = 'DNA_NOT_ANALYZED',
}

export interface RecoveryHint {
  suggestion: string;
  alternativeTools?: string[];
  retryAfterMs?: number;
  command?: string;
}

export interface DriftErrorDetails {
  code: DriftErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
  recovery?: RecoveryHint | undefined;
}

export class DriftError extends Error {
  public readonly code: DriftErrorCode;
  public readonly details?: Record<string, unknown> | undefined;
  public readonly recovery?: RecoveryHint | undefined;
  
  constructor(errorDetails: DriftErrorDetails) {
    super(errorDetails.message);
    this.name = 'DriftError';
    this.code = errorDetails.code;
    this.details = errorDetails.details;
    this.recovery = errorDetails.recovery;
  }
  
  /**
   * Convert to MCP error response format
   */
  toMCPResponse(requestId?: string): {
    content: Array<{ type: string; text: string }>;
    isError: true;
  } {
    const errorResponse = {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        recovery: this.recovery,
      },
      meta: {
        requestId: requestId || `err_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
      },
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(errorResponse, null, 2),
      }],
      isError: true,
    };
  }
}

/**
 * Error factory functions for common errors
 */
export const Errors = {
  invalidArgument(param: string, reason: string, suggestion?: string): DriftError {
    return new DriftError({
      code: DriftErrorCode.INVALID_ARGUMENT,
      message: `Invalid argument '${param}': ${reason}`,
      details: { param, reason },
      recovery: suggestion ? { suggestion } : undefined,
    });
  },
  
  missingRequired(param: string): DriftError {
    return new DriftError({
      code: DriftErrorCode.MISSING_REQUIRED_PARAM,
      message: `Missing required parameter: ${param}`,
      details: { param },
      recovery: {
        suggestion: `Provide the '${param}' parameter`,
      },
    });
  },
  
  missingParameter(param: string): DriftError {
    return this.missingRequired(param);
  },
  
  notFound(type: string, id: string): DriftError {
    if (type === 'pattern') {
      return this.patternNotFound(id);
    }
    if (type === 'file') {
      return this.fileNotFound(id);
    }
    return new DriftError({
      code: DriftErrorCode.FILE_NOT_FOUND,
      message: `${type} not found: ${id}`,
      details: { type, id },
      recovery: {
        suggestion: `Check that the ${type} exists`,
      },
    });
  },
  
  invalidParameter(param: string, reason: string): DriftError {
    return this.invalidArgument(param, reason);
  },
  
  patternNotFound(patternId: string): DriftError {
    return new DriftError({
      code: DriftErrorCode.PATTERN_NOT_FOUND,
      message: `Pattern not found: ${patternId}`,
      details: { patternId },
      recovery: {
        suggestion: 'Use drift_patterns_list to find valid pattern IDs',
        alternativeTools: ['drift_patterns_list', 'drift_status'],
      },
    });
  },
  
  fileNotFound(path: string): DriftError {
    return new DriftError({
      code: DriftErrorCode.FILE_NOT_FOUND,
      message: `File not found: ${path}`,
      details: { path },
      recovery: {
        suggestion: 'Check the file path is relative to project root',
        alternativeTools: ['drift_files_list'],
      },
    });
  },
  
  invalidCursor(): DriftError {
    return new DriftError({
      code: DriftErrorCode.INVALID_CURSOR,
      message: 'Invalid or expired pagination cursor',
      recovery: {
        suggestion: 'Start pagination from the beginning without a cursor',
      },
    });
  },
  
  invalidCategory(category: string, validCategories: string[]): DriftError {
    return new DriftError({
      code: DriftErrorCode.INVALID_CATEGORY,
      message: `Invalid category: ${category}`,
      details: { 
        provided: category, 
        valid: validCategories,
      },
      recovery: {
        suggestion: `Use one of: ${validCategories.join(', ')}`,
      },
    });
  },
  
  scanRequired(): DriftError {
    return new DriftError({
      code: DriftErrorCode.SCAN_REQUIRED,
      message: 'No pattern data found. The codebase needs to be scanned first.',
      recovery: {
        suggestion: "Run 'drift scan' in the project root to analyze patterns",
        command: 'drift scan',
        alternativeTools: ['drift_status'],
      },
    });
  },
  
  callgraphNotBuilt(): DriftError {
    return new DriftError({
      code: DriftErrorCode.CALLGRAPH_NOT_BUILT,
      message: 'Call graph has not been built yet.',
      recovery: {
        suggestion: "Use drift_callgraph with action='build' first",
        alternativeTools: ['drift_callgraph'],
      },
    });
  },
  
  dnaNotAnalyzed(): DriftError {
    return new DriftError({
      code: DriftErrorCode.DNA_NOT_ANALYZED,
      message: 'Styling DNA has not been analyzed yet.',
      recovery: {
        suggestion: "Run 'drift dna scan' to analyze styling patterns",
        command: 'drift dna scan',
      },
    });
  },
  
  rateLimited(retryAfterMs: number): DriftError {
    return new DriftError({
      code: DriftErrorCode.RATE_LIMITED,
      message: 'Rate limit exceeded. Please wait before making more requests.',
      recovery: {
        suggestion: 'Wait before retrying',
        retryAfterMs,
      },
    });
  },
  
  internal(message: string, details?: Record<string, unknown>): DriftError {
    return new DriftError({
      code: DriftErrorCode.INTERNAL_ERROR,
      message: `Internal error: ${message}`,
      details,
      recovery: {
        suggestion: 'This is an unexpected error. Please report it if it persists.',
      },
    });
  },
  
  custom(code: string, message: string, alternativeTools?: string[]): DriftError {
    return new DriftError({
      code: code as DriftErrorCode,
      message,
      recovery: alternativeTools ? {
        suggestion: message,
        alternativeTools,
      } : undefined,
    });
  },
};

/**
 * Error handler middleware
 */
export function handleError(error: unknown, requestId?: string): {
  content: Array<{ type: string; text: string }>;
  isError: true;
} {
  if (error instanceof DriftError) {
    return error.toMCPResponse(requestId);
  }
  
  // Convert unknown errors to DriftError
  const message = error instanceof Error ? error.message : String(error);
  return Errors.internal(message).toMCPResponse(requestId);
}
