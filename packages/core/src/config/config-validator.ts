/**
 * Config Validator - Configuration validation against JSON schema
 *
 * Provides comprehensive validation for DriftConfig objects with
 * helpful, actionable error messages for invalid configurations.
 *
 * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 */

import type {
  DriftConfig,
} from './types.js';
import type { Severity } from '../store/types.js';

// ============================================================================
// Constants
// ============================================================================

/** Valid AI provider values */
const VALID_AI_PROVIDERS = ['openai', 'anthropic', 'ollama'] as const;

/** Valid CI fail-on values */
const VALID_CI_FAIL_ON = ['error', 'warning', 'none'] as const;

/** Valid report format values */
const VALID_REPORT_FORMATS = ['json', 'text', 'github', 'gitlab'] as const;

/** Valid severity values */
const VALID_SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Represents a single configuration validation error
 */
export interface ConfigValidationError {
  /** Path to the invalid field (e.g., 'ai.provider', 'learning.autoApproveThreshold') */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Expected value or type */
  expected?: string;
  /** Actual value received */
  actual?: unknown;
  /** Suggestion for how to fix the error */
  suggestion?: string;
}

/**
 * Result of a configuration validation operation
 */
export interface ConfigValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validated and typed data (only present if valid) */
  data?: DriftConfig;
  /** List of validation errors (only present if invalid) */
  errors?: ConfigValidationError[];
}

/**
 * Custom error class for configuration validation failures
 *
 * @requirements 36.6 - Provide helpful error messages
 */
export class ConfigValidationException extends Error {
  constructor(
    message: string,
    public readonly errors: ConfigValidationError[]
  ) {
    super(message);
    this.name = 'ConfigValidationException';
  }

  /**
   * Format errors as a human-readable string with suggestions
   */
  formatErrors(): string {
    if (this.errors.length === 0) {return 'No errors';}

    return this.errors
      .map((e) => {
        let msg = `  - ${e.path}: ${e.message}`;
        if (e.expected) {msg += `\n    Expected: ${e.expected}`;}
        if (e.actual !== undefined) {msg += `\n    Got: ${JSON.stringify(e.actual)}`;}
        if (e.suggestion) {msg += `\n    Suggestion: ${e.suggestion}`;}
        return msg;
      })
      .join('\n\n');
  }

  /**
   * Get a summary of all errors
   */
  getSummary(): string {
    const errorCount = this.errors.length;
    const paths = this.errors.map((e) => e.path).join(', ');
    return `${errorCount} validation error(s) in: ${paths}`;
  }
}

// ============================================================================
// Helper Validation Functions
// ============================================================================

/**
 * Check if a value is a non-null object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Get a property from an object safely
 */
function get(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

/**
 * Check if a value is a number within a range
 */
function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= min && value <= max;
}

/**
 * Check if a value is in a valid set
 */
function isOneOf<T>(value: unknown, validValues: readonly T[]): value is T {
  return validValues.includes(value as T);
}

// ============================================================================
// Component Validators
// ============================================================================

/**
 * Validate severity overrides
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validateSeverityOverrides(
  severity: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (severity === undefined) {return true;}

  if (!isObject(severity)) {
    errors.push({
      path: 'severity',
      message: 'Severity overrides must be an object mapping pattern IDs to severity levels',
      expected: 'Record<string, "error" | "warning" | "info" | "hint">',
      actual: typeof severity,
      suggestion: 'Use an object like: { "pattern-id": "warning" }',
    });
    return false;
  }

  let valid = true;
  for (const [patternId, severityValue] of Object.entries(severity)) {
    if (!isOneOf(severityValue, VALID_SEVERITIES)) {
      errors.push({
        path: `severity.${patternId}`,
        message: `Invalid severity level for pattern "${patternId}"`,
        expected: VALID_SEVERITIES.join(' | '),
        actual: severityValue,
        suggestion: `Use one of: ${VALID_SEVERITIES.join(', ')}`,
      });
      valid = false;
    }
  }

  return valid;
}

/**
 * Validate ignore patterns
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validateIgnorePatterns(
  ignore: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (ignore === undefined) {return true;}

  if (!Array.isArray(ignore)) {
    errors.push({
      path: 'ignore',
      message: 'Ignore patterns must be an array of strings',
      expected: 'string[]',
      actual: typeof ignore,
      suggestion: 'Use an array like: ["node_modules", "dist", "*.test.ts"]',
    });
    return false;
  }

  let valid = true;
  for (let i = 0; i < ignore.length; i++) {
    const pattern = ignore[i];
    if (typeof pattern !== 'string') {
      errors.push({
        path: `ignore[${i}]`,
        message: 'Each ignore pattern must be a string',
        expected: 'string',
        actual: typeof pattern,
        suggestion: 'Ensure all patterns are strings (glob patterns or directory names)',
      });
      valid = false;
    } else if (pattern.length === 0) {
      errors.push({
        path: `ignore[${i}]`,
        message: 'Ignore pattern cannot be empty',
        expected: 'non-empty string',
        actual: '""',
        suggestion: 'Remove empty patterns or provide a valid glob pattern',
      });
      valid = false;
    }
  }

  return valid;
}

/**
 * Validate AI configuration
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validateAIConfig(
  ai: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (ai === undefined) {return true;}

  if (!isObject(ai)) {
    errors.push({
      path: 'ai',
      message: 'AI configuration must be an object',
      expected: '{ provider: "openai" | "anthropic" | "ollama", model?: string }',
      actual: typeof ai,
      suggestion: 'Configure AI like: { "provider": "openai", "model": "gpt-4" }',
    });
    return false;
  }

  let valid = true;
  const provider = get(ai, 'provider');
  const model = get(ai, 'model');

  // Provider is required when ai config is present
  if (provider === undefined) {
    errors.push({
      path: 'ai.provider',
      message: 'AI provider is required when AI configuration is specified',
      expected: VALID_AI_PROVIDERS.join(' | '),
      actual: undefined,
      suggestion: `Add a provider: ${VALID_AI_PROVIDERS.join(', ')}`,
    });
    valid = false;
  } else if (!isOneOf(provider, VALID_AI_PROVIDERS)) {
    errors.push({
      path: 'ai.provider',
      message: `Invalid AI provider "${provider}"`,
      expected: VALID_AI_PROVIDERS.join(' | '),
      actual: provider,
      suggestion: `Use one of the supported providers: ${VALID_AI_PROVIDERS.join(', ')}`,
    });
    valid = false;
  }

  // Model is optional but must be a string if provided
  if (model !== undefined && typeof model !== 'string') {
    errors.push({
      path: 'ai.model',
      message: 'AI model must be a string',
      expected: 'string',
      actual: typeof model,
      suggestion: 'Specify a model name like "gpt-4", "claude-3-opus", or "llama2"',
    });
    valid = false;
  }

  return valid;
}

/**
 * Validate CI configuration
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validateCIConfig(
  ci: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (ci === undefined) {return true;}

  if (!isObject(ci)) {
    errors.push({
      path: 'ci',
      message: 'CI configuration must be an object',
      expected: '{ failOn: "error" | "warning" | "none", reportFormat: "json" | "text" | "github" | "gitlab" }',
      actual: typeof ci,
      suggestion: 'Configure CI like: { "failOn": "error", "reportFormat": "github" }',
    });
    return false;
  }

  let valid = true;
  const failOn = get(ci, 'failOn');
  const reportFormat = get(ci, 'reportFormat');

  // failOn validation
  if (failOn !== undefined && !isOneOf(failOn, VALID_CI_FAIL_ON)) {
    errors.push({
      path: 'ci.failOn',
      message: `Invalid failOn value "${failOn}"`,
      expected: VALID_CI_FAIL_ON.join(' | '),
      actual: failOn,
      suggestion: `Use one of: ${VALID_CI_FAIL_ON.join(', ')}. "error" fails on errors only, "warning" fails on warnings and errors, "none" never fails.`,
    });
    valid = false;
  }

  // reportFormat validation
  if (reportFormat !== undefined && !isOneOf(reportFormat, VALID_REPORT_FORMATS)) {
    errors.push({
      path: 'ci.reportFormat',
      message: `Invalid report format "${reportFormat}"`,
      expected: VALID_REPORT_FORMATS.join(' | '),
      actual: reportFormat,
      suggestion: `Use one of: ${VALID_REPORT_FORMATS.join(', ')}. Use "github" for GitHub Actions annotations, "gitlab" for GitLab Code Quality.`,
    });
    valid = false;
  }

  return valid;
}

/**
 * Validate learning configuration
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validateLearningConfig(
  learning: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (learning === undefined) {return true;}

  if (!isObject(learning)) {
    errors.push({
      path: 'learning',
      message: 'Learning configuration must be an object',
      expected: '{ autoApproveThreshold: number (0-1), minOccurrences: number (>= 1) }',
      actual: typeof learning,
      suggestion: 'Configure learning like: { "autoApproveThreshold": 0.95, "minOccurrences": 3 }',
    });
    return false;
  }

  let valid = true;
  const autoApproveThreshold = get(learning, 'autoApproveThreshold');
  const minOccurrences = get(learning, 'minOccurrences');

  // autoApproveThreshold validation
  if (autoApproveThreshold !== undefined) {
    if (typeof autoApproveThreshold !== 'number') {
      errors.push({
        path: 'learning.autoApproveThreshold',
        message: 'Auto-approve threshold must be a number',
        expected: 'number between 0 and 1',
        actual: typeof autoApproveThreshold,
        suggestion: 'Use a decimal value like 0.95 (95% confidence)',
      });
      valid = false;
    } else if (!isNumberInRange(autoApproveThreshold, 0, 1)) {
      errors.push({
        path: 'learning.autoApproveThreshold',
        message: 'Auto-approve threshold must be between 0 and 1',
        expected: '0 <= value <= 1',
        actual: autoApproveThreshold,
        suggestion: `Value ${autoApproveThreshold} is out of range. Use a value like 0.85 (85%) or 0.95 (95%).`,
      });
      valid = false;
    }
  }

  // minOccurrences validation
  if (minOccurrences !== undefined) {
    if (typeof minOccurrences !== 'number') {
      errors.push({
        path: 'learning.minOccurrences',
        message: 'Minimum occurrences must be a number',
        expected: 'positive integer >= 1',
        actual: typeof minOccurrences,
        suggestion: 'Use an integer like 3 or 5',
      });
      valid = false;
    } else if (!Number.isInteger(minOccurrences) || minOccurrences < 1) {
      errors.push({
        path: 'learning.minOccurrences',
        message: 'Minimum occurrences must be a positive integer (>= 1)',
        expected: 'integer >= 1',
        actual: minOccurrences,
        suggestion: `Value ${minOccurrences} is invalid. Use a positive integer like 3 (detect patterns with at least 3 occurrences).`,
      });
      valid = false;
    }
  }

  return valid;
}

/**
 * Validate performance configuration
 *
 * @requirements 36.6 - Provide helpful error messages
 */
function validatePerformanceConfig(
  performance: unknown,
  errors: ConfigValidationError[]
): boolean {
  if (performance === undefined) {return true;}

  if (!isObject(performance)) {
    errors.push({
      path: 'performance',
      message: 'Performance configuration must be an object',
      expected: '{ maxWorkers: number, cacheEnabled: boolean, incrementalAnalysis: boolean }',
      actual: typeof performance,
      suggestion: 'Configure performance like: { "maxWorkers": 4, "cacheEnabled": true, "incrementalAnalysis": true }',
    });
    return false;
  }

  let valid = true;
  const maxWorkers = get(performance, 'maxWorkers');
  const cacheEnabled = get(performance, 'cacheEnabled');
  const incrementalAnalysis = get(performance, 'incrementalAnalysis');

  // maxWorkers validation
  if (maxWorkers !== undefined) {
    if (typeof maxWorkers !== 'number') {
      errors.push({
        path: 'performance.maxWorkers',
        message: 'Max workers must be a number',
        expected: 'positive integer >= 1',
        actual: typeof maxWorkers,
        suggestion: 'Use an integer like 4 or 8 (number of parallel worker threads)',
      });
      valid = false;
    } else if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
      errors.push({
        path: 'performance.maxWorkers',
        message: 'Max workers must be a positive integer (>= 1)',
        expected: 'integer >= 1',
        actual: maxWorkers,
        suggestion: `Value ${maxWorkers} is invalid. Use a positive integer like 4 (typically matches CPU cores).`,
      });
      valid = false;
    }
  }

  // cacheEnabled validation
  if (cacheEnabled !== undefined && typeof cacheEnabled !== 'boolean') {
    errors.push({
      path: 'performance.cacheEnabled',
      message: 'Cache enabled must be a boolean',
      expected: 'true | false',
      actual: typeof cacheEnabled,
      suggestion: 'Use true to enable caching (recommended) or false to disable',
    });
    valid = false;
  }

  // incrementalAnalysis validation
  if (incrementalAnalysis !== undefined && typeof incrementalAnalysis !== 'boolean') {
    errors.push({
      path: 'performance.incrementalAnalysis',
      message: 'Incremental analysis must be a boolean',
      expected: 'true | false',
      actual: typeof incrementalAnalysis,
      suggestion: 'Use true to enable incremental analysis (recommended) or false for full analysis on each change',
    });
    valid = false;
  }

  return valid;
}

// ============================================================================
// Main Validation Functions
// ============================================================================

/**
 * Validate a DriftConfig object against the JSON schema
 *
 * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 *
 * @param data - The data to validate
 * @returns Validation result with typed data or errors
 */
export function validateConfig(data: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  // Root must be an object
  if (!isObject(data)) {
    errors.push({
      path: '',
      message: 'Configuration must be a JSON object',
      expected: 'object',
      actual: typeof data,
      suggestion: 'Ensure your config.json contains a valid JSON object like: { "ignore": ["node_modules"] }',
    });
    return { valid: false, errors };
  }

  // Validate each section
  validateSeverityOverrides(get(data, 'severity'), errors);
  validateIgnorePatterns(get(data, 'ignore'), errors);
  validateAIConfig(get(data, 'ai'), errors);
  validateCIConfig(get(data, 'ci'), errors);
  validateLearningConfig(get(data, 'learning'), errors);
  validatePerformanceConfig(get(data, 'performance'), errors);

  // Check for unknown top-level keys
  const knownKeys = ['severity', 'ignore', 'ai', 'ci', 'learning', 'performance'];
  for (const key of Object.keys(data)) {
    if (!knownKeys.includes(key)) {
      errors.push({
        path: key,
        message: `Unknown configuration option "${key}"`,
        expected: knownKeys.join(' | '),
        actual: key,
        suggestion: `Remove "${key}" or check for typos. Valid options are: ${knownKeys.join(', ')}`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as DriftConfig };
}

/**
 * Validate a DriftConfig and throw if invalid
 *
 * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 *
 * @param data - The data to validate
 * @returns The validated DriftConfig
 * @throws ConfigValidationException if validation fails
 */
export function assertValidConfig(data: unknown): DriftConfig {
  const result = validateConfig(data);

  if (!result.valid) {
    throw new ConfigValidationException(
      `Invalid configuration: ${result.errors!.length} validation error(s)`,
      result.errors!
    );
  }

  return result.data!;
}

/**
 * Validate a partial DriftConfig (for merging with defaults)
 *
 * This is more lenient than full validation - it allows missing required fields
 * since they will be filled in from defaults.
 *
 * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 *
 * @param data - The partial data to validate
 * @returns Validation result with typed data or errors
 */
export function validatePartialConfig(data: unknown): ConfigValidationResult {
  // For partial config, we use the same validation logic
  // since all fields are already optional in DriftConfig
  return validateConfig(data);
}

/**
 * Format validation errors as a human-readable string
 *
 * @requirements 36.6 - Provide helpful error messages
 *
 * @param errors - Array of validation errors
 * @returns Formatted error string
 */
export function formatConfigErrors(errors: ConfigValidationError[]): string {
  if (errors.length === 0) {return 'No errors';}

  const header = `Configuration validation failed with ${errors.length} error(s):\n`;
  const body = errors
    .map((e, i) => {
      let msg = `\n${i + 1}. ${e.path || 'root'}: ${e.message}`;
      if (e.expected) {msg += `\n   Expected: ${e.expected}`;}
      if (e.actual !== undefined) {msg += `\n   Got: ${JSON.stringify(e.actual)}`;}
      if (e.suggestion) {msg += `\n   💡 ${e.suggestion}`;}
      return msg;
    })
    .join('\n');

  return header + body;
}

/**
 * Get a quick summary of validation errors
 *
 * @param errors - Array of validation errors
 * @returns Short summary string
 */
export function getErrorSummary(errors: ConfigValidationError[]): string {
  if (errors.length === 0) {return 'Configuration is valid';}

  const paths = errors.map((e) => e.path || 'root');
  const uniquePaths = [...new Set(paths)];

  return `${errors.length} error(s) in: ${uniquePaths.join(', ')}`;
}

// ============================================================================
// JSON Schema Definition (for documentation and external tools)
// ============================================================================

/**
 * JSON Schema definition for DriftConfig
 *
 * This can be used by external tools for validation or IDE support.
 *
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 */
export const DRIFT_CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'DriftConfig',
  description: 'Configuration schema for Drift architectural drift detection',
  type: 'object',
  properties: {
    severity: {
      type: 'object',
      description: 'Severity overrides per pattern ID',
      additionalProperties: {
        type: 'string',
        enum: ['error', 'warning', 'info', 'hint'],
      },
    },
    ignore: {
      type: 'array',
      description: 'File/folder patterns to ignore',
      items: {
        type: 'string',
        minLength: 1,
      },
    },
    ai: {
      type: 'object',
      description: 'AI provider configuration (BYOK)',
      properties: {
        provider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'ollama'],
          description: 'AI provider to use',
        },
        model: {
          type: 'string',
          description: 'Model name to use',
        },
      },
      required: ['provider'],
    },
    ci: {
      type: 'object',
      description: 'CI/CD mode settings',
      properties: {
        failOn: {
          type: 'string',
          enum: ['error', 'warning', 'none'],
          description: 'Severity level that causes CI failure',
        },
        reportFormat: {
          type: 'string',
          enum: ['json', 'text', 'github', 'gitlab'],
          description: 'Output format for CI reports',
        },
      },
    },
    learning: {
      type: 'object',
      description: 'Pattern learning settings',
      properties: {
        autoApproveThreshold: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence threshold for auto-approving patterns',
        },
        minOccurrences: {
          type: 'integer',
          minimum: 1,
          description: 'Minimum occurrences to detect a pattern',
        },
      },
    },
    performance: {
      type: 'object',
      description: 'Performance tuning settings',
      properties: {
        maxWorkers: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum worker threads for parallel processing',
        },
        cacheEnabled: {
          type: 'boolean',
          description: 'Enable analysis caching',
        },
        incrementalAnalysis: {
          type: 'boolean',
          description: 'Enable incremental analysis for changed files',
        },
      },
    },
  },
  additionalProperties: false,
} as const;
