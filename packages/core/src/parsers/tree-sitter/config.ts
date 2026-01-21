/**
 * Tree-sitter Python Parser Configuration
 *
 * Configuration types and defaults for the tree-sitter Python parser.
 * Provides validation and merging utilities.
 *
 * @requirements 3.5 - Unified AST query interface
 */

// ============================================
// Configuration Interface
// ============================================

/**
 * Configuration options for the Python parser.
 */
export interface PythonParserConfig {
  /** Use tree-sitter parser if available (default: true) */
  useTreeSitter: boolean;

  /** Extract Pydantic model information (default: true) */
  extractPydanticModels: boolean;

  /** Maximum depth for type resolution to prevent infinite loops (default: 10) */
  maxTypeDepth: number;

  /** Include position information in extracted data (default: true) */
  includePositions: boolean;

  /** Timeout for parsing in milliseconds, 0 = no timeout (default: 5000) */
  parseTimeout: number;

  /** Use incremental parsing when possible (default: true) */
  useIncremental: boolean;

  /** Include comments in the AST (default: true) */
  includeComments: boolean;

  /** Include anonymous nodes in the AST (default: false) */
  includeAnonymous: boolean;
}

// ============================================
// Default Configuration
// ============================================

/**
 * Default configuration for the Python parser.
 */
export const DEFAULT_PYTHON_PARSER_CONFIG: Readonly<PythonParserConfig> = {
  useTreeSitter: true,
  extractPydanticModels: true,
  maxTypeDepth: 10,
  includePositions: true,
  parseTimeout: 5000,
  useIncremental: true,
  includeComments: true,
  includeAnonymous: false,
};

// ============================================
// Configuration Validation
// ============================================

/**
 * Validation error for configuration.
 */
export interface ConfigValidationError {
  /** Field that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** The invalid value */
  value: unknown;
}

/**
 * Result of configuration validation.
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;
  /** Validation errors if any */
  errors: ConfigValidationError[];
  /** Validated and normalized configuration */
  config: PythonParserConfig;
}

/**
 * Validate a Python parser configuration.
 *
 * @param config - Partial configuration to validate
 * @returns Validation result with normalized config
 */
export function validateConfig(
  config: Partial<PythonParserConfig>
): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const normalized = { ...DEFAULT_PYTHON_PARSER_CONFIG };

  // Validate useTreeSitter
  if (config.useTreeSitter !== undefined) {
    if (typeof config.useTreeSitter !== 'boolean') {
      errors.push({
        field: 'useTreeSitter',
        message: 'must be a boolean',
        value: config.useTreeSitter,
      });
    } else {
      normalized.useTreeSitter = config.useTreeSitter;
    }
  }

  // Validate extractPydanticModels
  if (config.extractPydanticModels !== undefined) {
    if (typeof config.extractPydanticModels !== 'boolean') {
      errors.push({
        field: 'extractPydanticModels',
        message: 'must be a boolean',
        value: config.extractPydanticModels,
      });
    } else {
      normalized.extractPydanticModels = config.extractPydanticModels;
    }
  }

  // Validate maxTypeDepth
  if (config.maxTypeDepth !== undefined) {
    if (typeof config.maxTypeDepth !== 'number' || config.maxTypeDepth < 1) {
      errors.push({
        field: 'maxTypeDepth',
        message: 'must be a positive number',
        value: config.maxTypeDepth,
      });
    } else if (config.maxTypeDepth > 100) {
      errors.push({
        field: 'maxTypeDepth',
        message: 'must be at most 100',
        value: config.maxTypeDepth,
      });
    } else {
      normalized.maxTypeDepth = config.maxTypeDepth;
    }
  }

  // Validate includePositions
  if (config.includePositions !== undefined) {
    if (typeof config.includePositions !== 'boolean') {
      errors.push({
        field: 'includePositions',
        message: 'must be a boolean',
        value: config.includePositions,
      });
    } else {
      normalized.includePositions = config.includePositions;
    }
  }

  // Validate parseTimeout
  if (config.parseTimeout !== undefined) {
    if (typeof config.parseTimeout !== 'number' || config.parseTimeout < 0) {
      errors.push({
        field: 'parseTimeout',
        message: 'must be a non-negative number',
        value: config.parseTimeout,
      });
    } else {
      normalized.parseTimeout = config.parseTimeout;
    }
  }

  // Validate useIncremental
  if (config.useIncremental !== undefined) {
    if (typeof config.useIncremental !== 'boolean') {
      errors.push({
        field: 'useIncremental',
        message: 'must be a boolean',
        value: config.useIncremental,
      });
    } else {
      normalized.useIncremental = config.useIncremental;
    }
  }

  // Validate includeComments
  if (config.includeComments !== undefined) {
    if (typeof config.includeComments !== 'boolean') {
      errors.push({
        field: 'includeComments',
        message: 'must be a boolean',
        value: config.includeComments,
      });
    } else {
      normalized.includeComments = config.includeComments;
    }
  }

  // Validate includeAnonymous
  if (config.includeAnonymous !== undefined) {
    if (typeof config.includeAnonymous !== 'boolean') {
      errors.push({
        field: 'includeAnonymous',
        message: 'must be a boolean',
        value: config.includeAnonymous,
      });
    } else {
      normalized.includeAnonymous = config.includeAnonymous;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    config: normalized,
  };
}

/**
 * Merge partial configuration with defaults.
 *
 * @param config - Partial configuration
 * @returns Complete configuration with defaults applied
 */
export function mergeConfig(
  config: Partial<PythonParserConfig>
): PythonParserConfig {
  return {
    ...DEFAULT_PYTHON_PARSER_CONFIG,
    ...config,
  };
}

/**
 * Create configuration from environment variables.
 *
 * Environment variables:
 * - DRIFT_PYTHON_USE_TREE_SITTER: 'true' or 'false'
 * - DRIFT_PYTHON_EXTRACT_PYDANTIC: 'true' or 'false'
 * - DRIFT_PYTHON_MAX_TYPE_DEPTH: number
 * - DRIFT_PYTHON_PARSE_TIMEOUT: number (milliseconds)
 *
 * @returns Configuration from environment
 */
export function configFromEnv(): Partial<PythonParserConfig> {
  const config: Partial<PythonParserConfig> = {};

  const useTreeSitter = process.env['DRIFT_PYTHON_USE_TREE_SITTER'];
  if (useTreeSitter !== undefined) {
    config.useTreeSitter = useTreeSitter.toLowerCase() === 'true';
  }

  const extractPydantic = process.env['DRIFT_PYTHON_EXTRACT_PYDANTIC'];
  if (extractPydantic !== undefined) {
    config.extractPydanticModels = extractPydantic.toLowerCase() === 'true';
  }

  const maxTypeDepth = process.env['DRIFT_PYTHON_MAX_TYPE_DEPTH'];
  if (maxTypeDepth !== undefined) {
    const parsed = parseInt(maxTypeDepth, 10);
    if (!isNaN(parsed)) {
      config.maxTypeDepth = parsed;
    }
  }

  const parseTimeout = process.env['DRIFT_PYTHON_PARSE_TIMEOUT'];
  if (parseTimeout !== undefined) {
    const parsed = parseInt(parseTimeout, 10);
    if (!isNaN(parsed)) {
      config.parseTimeout = parsed;
    }
  }

  return config;
}
