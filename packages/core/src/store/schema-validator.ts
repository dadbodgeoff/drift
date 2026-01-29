/**
 * Schema Validator - JSON schema validation for patterns and config
 *
 * Provides comprehensive JSON schema validation for all store data structures
 * including patterns, pattern files, history files, lock files, and variants.
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */

import type {
  Pattern,
  PatternFile,
  HistoryFile,
  LockFile,
  VariantsFile,
  StoredPattern,
  PatternCategory,
  PatternStatus,
  Severity,
  ConfidenceLevel,
  DetectorType,
  VariantScope,
  HistoryEventType,
  ConfidenceInfo,
  PatternLocation,
  OutlierLocation,
  DetectorConfig,
  PatternMetadata,
  PatternVariant,
  LockedPattern,
  PatternHistory,
  PatternHistoryEvent,
} from './types.js';
import type { DriftConfig } from '../config/types.js';

// ============================================================================
// Schema Version Constants
// ============================================================================

/**
 * Current schema versions for validation
 */
export const SCHEMA_VERSIONS = {
  pattern: '1.0.0',
  patternFile: '1.0.0',
  historyFile: '1.0.0',
  lockFile: '1.0.0',
  variantsFile: '1.0.0',
  config: '1.0.0',
} as const;

/**
 * Supported schema versions for backward compatibility
 */
export const SUPPORTED_VERSIONS = {
  pattern: ['1.0.0'],
  patternFile: ['1.0.0'],
  historyFile: ['1.0.0'],
  lockFile: ['1.0.0'],
  variantsFile: ['1.0.0'],
  config: ['1.0.0'],
} as const;


// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Represents a single validation error
 */
export interface ValidationError {
  /** Path to the invalid field (e.g., 'patterns[0].confidence.score') */
  path: string;
  /** Error message describing the validation failure */
  message: string;
  /** Expected value or type */
  expected?: string;
  /** Actual value received */
  actual?: unknown;
}

/**
 * Result of a validation operation
 */
export interface ValidationResult<T = unknown> {
  /** Whether validation passed */
  valid: boolean;
  /** Validated and typed data (only present if valid) */
  data?: T;
  /** List of validation errors (only present if invalid) */
  errors?: ValidationError[];
}

/**
 * Custom error class for schema validation failures
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
    public readonly schemaType: string
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }

  /**
   * Format errors as a human-readable string
   */
  formatErrors(): string {
    return this.errors
      .map((e) => `  - ${e.path}: ${e.message}`)
      .join('\n');
  }
}


// ============================================================================
// Valid Value Sets
// ============================================================================

const VALID_PATTERN_CATEGORIES: PatternCategory[] = [
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

const VALID_PATTERN_STATUSES: PatternStatus[] = ['discovered', 'approved', 'ignored'];

const VALID_SEVERITIES: Severity[] = ['error', 'warning', 'info', 'hint'];

const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low', 'uncertain'];

const VALID_DETECTOR_TYPES: DetectorType[] = ['ast', 'regex', 'semantic', 'structural', 'custom'];

const VALID_VARIANT_SCOPES: VariantScope[] = ['global', 'directory', 'file'];

const VALID_HISTORY_EVENT_TYPES: HistoryEventType[] = [
  'created',
  'approved',
  'ignored',
  'updated',
  'deleted',
  'confidence_changed',
  'locations_changed',
  'severity_changed',
];

const VALID_AI_PROVIDERS = ['openai', 'anthropic', 'ollama'] as const;

const VALID_CI_FAIL_ON = ['error', 'warning', 'none'] as const;

const VALID_REPORT_FORMATS = ['json', 'text', 'github', 'gitlab'] as const;


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
 * Get a property from an object safely (for use with index signatures)
 */
function get(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

/**
 * Check if a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Check if a value is a valid ISO date string
 */
function isISODateString(value: unknown): value is string {
  if (typeof value !== 'string') {return false;}
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.includes('T');
}

/**
 * Check if a value is a number within a range
 */
function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= min && value <= max;
}

/**
 * Check if a value is a positive integer
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Check if a value is in a valid set
 */
function isOneOf<T>(value: unknown, validValues: readonly T[]): value is T {
  return validValues.includes(value as T);
}

/**
 * Check if a value is a valid semver version string
 */
function isSemverVersion(value: unknown): value is string {
  if (typeof value !== 'string') {return false;}
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(value);
}


// ============================================================================
// Component Validators
// ============================================================================

/**
 * Validate a PatternLocation object
 */
function validatePatternLocation(
  location: unknown,
  path: string,
  errors: ValidationError[]
): location is PatternLocation {
  if (!isObject(location)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof location });
    return false;
  }

  let valid = true;
  const file = get(location, 'file');
  const line = get(location, 'line');
  const column = get(location, 'column');
  const endLine = get(location, 'endLine');
  const endColumn = get(location, 'endColumn');

  if (!isNonEmptyString(file)) {
    errors.push({ path: `${path}.file`, message: 'Must be a non-empty string', expected: 'string', actual: file });
    valid = false;
  }

  if (!isPositiveInteger(line) || (line) < 1) {
    errors.push({ path: `${path}.line`, message: 'Must be a positive integer >= 1', expected: 'number >= 1', actual: line });
    valid = false;
  }

  if (!isPositiveInteger(column) || (column) < 1) {
    errors.push({ path: `${path}.column`, message: 'Must be a positive integer >= 1', expected: 'number >= 1', actual: column });
    valid = false;
  }

  // Optional fields
  if (endLine !== undefined && (!isPositiveInteger(endLine) || (endLine) < 1)) {
    errors.push({ path: `${path}.endLine`, message: 'Must be a positive integer >= 1', expected: 'number >= 1', actual: endLine });
    valid = false;
  }

  if (endColumn !== undefined && (!isPositiveInteger(endColumn) || (endColumn) < 1)) {
    errors.push({ path: `${path}.endColumn`, message: 'Must be a positive integer >= 1', expected: 'number >= 1', actual: endColumn });
    valid = false;
  }

  return valid;
}

/**
 * Validate an OutlierLocation object
 */
function validateOutlierLocation(
  location: unknown,
  path: string,
  errors: ValidationError[]
): location is OutlierLocation {
  if (!validatePatternLocation(location, path, errors)) {
    return false;
  }

  const loc = location as unknown as Record<string, unknown>;
  let valid = true;
  const reason = get(loc, 'reason');
  const deviationScore = get(loc, 'deviationScore');

  if (!isNonEmptyString(reason)) {
    errors.push({ path: `${path}.reason`, message: 'Must be a non-empty string', expected: 'string', actual: reason });
    valid = false;
  }

  if (deviationScore !== undefined && !isNumberInRange(deviationScore, 0, 1)) {
    errors.push({ path: `${path}.deviationScore`, message: 'Must be a number between 0 and 1', expected: '0-1', actual: deviationScore });
    valid = false;
  }

  return valid;
}


/**
 * Validate a ConfidenceInfo object
 */
function validateConfidenceInfo(
  confidence: unknown,
  path: string,
  errors: ValidationError[]
): confidence is ConfidenceInfo {
  if (!isObject(confidence)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof confidence });
    return false;
  }

  let valid = true;
  const frequency = get(confidence, 'frequency');
  const consistency = get(confidence, 'consistency');
  const age = get(confidence, 'age');
  const spread = get(confidence, 'spread');
  const score = get(confidence, 'score');
  const level = get(confidence, 'level');

  if (!isNumberInRange(frequency, 0, 1)) {
    errors.push({ path: `${path}.frequency`, message: 'Must be a number between 0 and 1', expected: '0-1', actual: frequency });
    valid = false;
  }

  if (!isNumberInRange(consistency, 0, 1)) {
    errors.push({ path: `${path}.consistency`, message: 'Must be a number between 0 and 1', expected: '0-1', actual: consistency });
    valid = false;
  }

  if (!isPositiveInteger(age) && age !== 0) {
    errors.push({ path: `${path}.age`, message: 'Must be a non-negative number', expected: 'number >= 0', actual: age });
    valid = false;
  }

  if (!isPositiveInteger(spread)) {
    errors.push({ path: `${path}.spread`, message: 'Must be a non-negative integer', expected: 'integer >= 0', actual: spread });
    valid = false;
  }

  if (!isNumberInRange(score, 0, 1)) {
    errors.push({ path: `${path}.score`, message: 'Must be a number between 0 and 1', expected: '0-1', actual: score });
    valid = false;
  }

  if (!isOneOf(level, VALID_CONFIDENCE_LEVELS)) {
    errors.push({ path: `${path}.level`, message: `Must be one of: ${VALID_CONFIDENCE_LEVELS.join(', ')}`, expected: VALID_CONFIDENCE_LEVELS.join('|'), actual: level });
    valid = false;
  }

  return valid;
}

/**
 * Validate a DetectorConfig object
 */
function validateDetectorConfig(
  detector: unknown,
  path: string,
  errors: ValidationError[]
): detector is DetectorConfig {
  if (!isObject(detector)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof detector });
    return false;
  }

  let valid = true;
  const type = get(detector, 'type');
  const config = get(detector, 'config');
  const ast = get(detector, 'ast');
  const regex = get(detector, 'regex');
  const structural = get(detector, 'structural');
  const custom = get(detector, 'custom');

  if (!isOneOf(type, VALID_DETECTOR_TYPES)) {
    errors.push({ path: `${path}.type`, message: `Must be one of: ${VALID_DETECTOR_TYPES.join(', ')}`, expected: VALID_DETECTOR_TYPES.join('|'), actual: type });
    valid = false;
  }

  if (!isObject(config)) {
    errors.push({ path: `${path}.config`, message: 'Must be an object', expected: 'object', actual: typeof config });
    valid = false;
  }

  // Type-specific validation is optional - just ensure the objects exist if provided
  if (ast !== undefined && !isObject(ast)) {
    errors.push({ path: `${path}.ast`, message: 'Must be an object if provided', expected: 'object', actual: typeof ast });
    valid = false;
  }

  if (regex !== undefined && !isObject(regex)) {
    errors.push({ path: `${path}.regex`, message: 'Must be an object if provided', expected: 'object', actual: typeof regex });
    valid = false;
  }

  if (structural !== undefined && !isObject(structural)) {
    errors.push({ path: `${path}.structural`, message: 'Must be an object if provided', expected: 'object', actual: typeof structural });
    valid = false;
  }

  if (custom !== undefined && !isObject(custom)) {
    errors.push({ path: `${path}.custom`, message: 'Must be an object if provided', expected: 'object', actual: typeof custom });
    valid = false;
  }

  return valid;
}


/**
 * Validate a PatternMetadata object
 */
function validatePatternMetadata(
  metadata: unknown,
  path: string,
  errors: ValidationError[]
): metadata is PatternMetadata {
  if (!isObject(metadata)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof metadata });
    return false;
  }

  let valid = true;
  const firstSeen = get(metadata, 'firstSeen');
  const lastSeen = get(metadata, 'lastSeen');
  const approvedAt = get(metadata, 'approvedAt');
  const approvedBy = get(metadata, 'approvedBy');
  const version = get(metadata, 'version');
  const tags = get(metadata, 'tags');
  const relatedPatterns = get(metadata, 'relatedPatterns');
  const source = get(metadata, 'source');
  const custom = get(metadata, 'custom');

  if (!isISODateString(firstSeen)) {
    errors.push({ path: `${path}.firstSeen`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: firstSeen });
    valid = false;
  }

  if (!isISODateString(lastSeen)) {
    errors.push({ path: `${path}.lastSeen`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lastSeen });
    valid = false;
  }

  // Optional fields
  if (approvedAt !== undefined && !isISODateString(approvedAt)) {
    errors.push({ path: `${path}.approvedAt`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: approvedAt });
    valid = false;
  }

  if (approvedBy !== undefined && typeof approvedBy !== 'string') {
    errors.push({ path: `${path}.approvedBy`, message: 'Must be a string', expected: 'string', actual: typeof approvedBy });
    valid = false;
  }

  if (version !== undefined && typeof version !== 'string') {
    errors.push({ path: `${path}.version`, message: 'Must be a string', expected: 'string', actual: typeof version });
    valid = false;
  }

  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      errors.push({ path: `${path}.tags`, message: 'Must be an array', expected: 'array', actual: typeof tags });
      valid = false;
    } else if (!tags.every((t: unknown) => typeof t === 'string')) {
      errors.push({ path: `${path}.tags`, message: 'All tags must be strings', expected: 'string[]', actual: tags });
      valid = false;
    }
  }

  if (relatedPatterns !== undefined) {
    if (!Array.isArray(relatedPatterns)) {
      errors.push({ path: `${path}.relatedPatterns`, message: 'Must be an array', expected: 'array', actual: typeof relatedPatterns });
      valid = false;
    } else if (!relatedPatterns.every((p: unknown) => typeof p === 'string')) {
      errors.push({ path: `${path}.relatedPatterns`, message: 'All related patterns must be strings', expected: 'string[]', actual: relatedPatterns });
      valid = false;
    }
  }

  if (source !== undefined && typeof source !== 'string') {
    errors.push({ path: `${path}.source`, message: 'Must be a string', expected: 'string', actual: typeof source });
    valid = false;
  }

  if (custom !== undefined && !isObject(custom)) {
    errors.push({ path: `${path}.custom`, message: 'Must be an object', expected: 'object', actual: typeof custom });
    valid = false;
  }

  return valid;
}


// ============================================================================
// Pattern Validators
// ============================================================================

/**
 * Validate a StoredPattern object
 */
function validateStoredPattern(
  pattern: unknown,
  path: string,
  errors: ValidationError[]
): pattern is StoredPattern {
  if (!isObject(pattern)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof pattern });
    return false;
  }

  let valid = true;
  const id = get(pattern, 'id');
  const subcategory = get(pattern, 'subcategory');
  const name = get(pattern, 'name');
  const description = get(pattern, 'description');
  const severity = get(pattern, 'severity');
  const autoFixable = get(pattern, 'autoFixable');
  const detector = get(pattern, 'detector');
  const confidence = get(pattern, 'confidence');
  const metadata = get(pattern, 'metadata');
  const locations = get(pattern, 'locations');
  const outliers = get(pattern, 'outliers');

  // Required string fields
  if (!isNonEmptyString(id)) {
    errors.push({ path: `${path}.id`, message: 'Must be a non-empty string', expected: 'string', actual: id });
    valid = false;
  }

  if (!isNonEmptyString(subcategory)) {
    errors.push({ path: `${path}.subcategory`, message: 'Must be a non-empty string', expected: 'string', actual: subcategory });
    valid = false;
  }

  if (!isNonEmptyString(name)) {
    errors.push({ path: `${path}.name`, message: 'Must be a non-empty string', expected: 'string', actual: name });
    valid = false;
  }

  if (!isNonEmptyString(description)) {
    errors.push({ path: `${path}.description`, message: 'Must be a non-empty string', expected: 'string', actual: description });
    valid = false;
  }

  // Enum fields
  if (!isOneOf(severity, VALID_SEVERITIES)) {
    errors.push({ path: `${path}.severity`, message: `Must be one of: ${VALID_SEVERITIES.join(', ')}`, expected: VALID_SEVERITIES.join('|'), actual: severity });
    valid = false;
  }

  // Boolean field
  if (typeof autoFixable !== 'boolean') {
    errors.push({ path: `${path}.autoFixable`, message: 'Must be a boolean', expected: 'boolean', actual: typeof autoFixable });
    valid = false;
  }

  // Complex fields
  if (!validateDetectorConfig(detector, `${path}.detector`, errors)) {
    valid = false;
  }

  if (!validateConfidenceInfo(confidence, `${path}.confidence`, errors)) {
    valid = false;
  }

  if (!validatePatternMetadata(metadata, `${path}.metadata`, errors)) {
    valid = false;
  }

  // Array fields
  if (!Array.isArray(locations)) {
    errors.push({ path: `${path}.locations`, message: 'Must be an array', expected: 'array', actual: typeof locations });
    valid = false;
  } else {
    (locations as unknown[]).forEach((loc: unknown, i: number) => {
      if (!validatePatternLocation(loc, `${path}.locations[${i}]`, errors)) {
        valid = false;
      }
    });
  }

  if (!Array.isArray(outliers)) {
    errors.push({ path: `${path}.outliers`, message: 'Must be an array', expected: 'array', actual: typeof outliers });
    valid = false;
  } else {
    (outliers as unknown[]).forEach((loc: unknown, i: number) => {
      if (!validateOutlierLocation(loc, `${path}.outliers[${i}]`, errors)) {
        valid = false;
      }
    });
  }

  return valid;
}


/**
 * Validate a full Pattern object (includes status and category)
 */
function validatePattern(
  pattern: unknown,
  path: string,
  errors: ValidationError[]
): pattern is Pattern {
  if (!isObject(pattern)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof pattern });
    return false;
  }

  let valid = true;
  const category = get(pattern, 'category');
  const status = get(pattern, 'status');

  // Validate category (not in StoredPattern)
  if (!isOneOf(category, VALID_PATTERN_CATEGORIES)) {
    errors.push({ path: `${path}.category`, message: `Must be one of: ${VALID_PATTERN_CATEGORIES.join(', ')}`, expected: VALID_PATTERN_CATEGORIES.join('|'), actual: category });
    valid = false;
  }

  // Validate status (not in StoredPattern)
  if (!isOneOf(status, VALID_PATTERN_STATUSES)) {
    errors.push({ path: `${path}.status`, message: `Must be one of: ${VALID_PATTERN_STATUSES.join(', ')}`, expected: VALID_PATTERN_STATUSES.join('|'), actual: status });
    valid = false;
  }

  // Validate the rest using StoredPattern validator
  // Create a copy without category and status for StoredPattern validation
  const storedPatternFields = { ...pattern };
  delete (storedPatternFields as Record<string, unknown>)['category'];
  delete (storedPatternFields as Record<string, unknown>)['status'];

  if (!validateStoredPattern(storedPatternFields, path, errors)) {
    valid = false;
  }

  return valid;
}


// ============================================================================
// File Validators
// ============================================================================

/**
 * Validate a PatternFile object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validatePatternFile(data: unknown): ValidationResult<PatternFile> {
  const errors: ValidationError[] = [];

  if (!isObject(data)) {
    errors.push({ path: '', message: 'Pattern file must be an object', expected: 'object', actual: typeof data });
    return { valid: false, errors };
  }

  const version = get(data, 'version');
  const category = get(data, 'category');
  const patterns = get(data, 'patterns');
  const lastUpdated = get(data, 'lastUpdated');
  const checksum = get(data, 'checksum');

  // Version validation
  if (!isSemverVersion(version)) {
    errors.push({ path: 'version', message: 'Must be a valid semver version string', expected: 'semver', actual: version });
  } else if (!SUPPORTED_VERSIONS.patternFile.includes(version as '1.0.0')) {
    errors.push({ path: 'version', message: `Unsupported version. Supported: ${SUPPORTED_VERSIONS.patternFile.join(', ')}`, expected: SUPPORTED_VERSIONS.patternFile.join('|'), actual: version });
  }

  // Category validation
  if (!isOneOf(category, VALID_PATTERN_CATEGORIES)) {
    errors.push({ path: 'category', message: `Must be one of: ${VALID_PATTERN_CATEGORIES.join(', ')}`, expected: VALID_PATTERN_CATEGORIES.join('|'), actual: category });
  }

  // Patterns array validation
  if (!Array.isArray(patterns)) {
    errors.push({ path: 'patterns', message: 'Must be an array', expected: 'array', actual: typeof patterns });
  } else {
    (patterns as unknown[]).forEach((pattern: unknown, i: number) => {
      validateStoredPattern(pattern, `patterns[${i}]`, errors);
    });
  }

  // Last updated validation
  if (!isISODateString(lastUpdated)) {
    errors.push({ path: 'lastUpdated', message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lastUpdated });
  }

  // Optional checksum
  if (checksum !== undefined && typeof checksum !== 'string') {
    errors.push({ path: 'checksum', message: 'Must be a string if provided', expected: 'string', actual: typeof checksum });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as unknown as PatternFile };
}


/**
 * Validate a PatternHistoryEvent object
 */
function validatePatternHistoryEvent(
  event: unknown,
  path: string,
  errors: ValidationError[]
): event is PatternHistoryEvent {
  if (!isObject(event)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof event });
    return false;
  }

  let valid = true;
  const timestamp = get(event, 'timestamp');
  const type = get(event, 'type');
  const patternId = get(event, 'patternId');
  const user = get(event, 'user');
  const details = get(event, 'details');

  if (!isISODateString(timestamp)) {
    errors.push({ path: `${path}.timestamp`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: timestamp });
    valid = false;
  }

  if (!isOneOf(type, VALID_HISTORY_EVENT_TYPES)) {
    errors.push({ path: `${path}.type`, message: `Must be one of: ${VALID_HISTORY_EVENT_TYPES.join(', ')}`, expected: VALID_HISTORY_EVENT_TYPES.join('|'), actual: type });
    valid = false;
  }

  if (!isNonEmptyString(patternId)) {
    errors.push({ path: `${path}.patternId`, message: 'Must be a non-empty string', expected: 'string', actual: patternId });
    valid = false;
  }

  // Optional fields
  if (user !== undefined && typeof user !== 'string') {
    errors.push({ path: `${path}.user`, message: 'Must be a string if provided', expected: 'string', actual: typeof user });
    valid = false;
  }

  if (details !== undefined && !isObject(details)) {
    errors.push({ path: `${path}.details`, message: 'Must be an object if provided', expected: 'object', actual: typeof details });
    valid = false;
  }

  return valid;
}

/**
 * Validate a PatternHistory object
 */
function validatePatternHistory(
  history: unknown,
  path: string,
  errors: ValidationError[]
): history is PatternHistory {
  if (!isObject(history)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof history });
    return false;
  }

  let valid = true;
  const patternId = get(history, 'patternId');
  const category = get(history, 'category');
  const events = get(history, 'events');
  const createdAt = get(history, 'createdAt');
  const lastModified = get(history, 'lastModified');

  if (!isNonEmptyString(patternId)) {
    errors.push({ path: `${path}.patternId`, message: 'Must be a non-empty string', expected: 'string', actual: patternId });
    valid = false;
  }

  if (!isOneOf(category, VALID_PATTERN_CATEGORIES)) {
    errors.push({ path: `${path}.category`, message: `Must be one of: ${VALID_PATTERN_CATEGORIES.join(', ')}`, expected: VALID_PATTERN_CATEGORIES.join('|'), actual: category });
    valid = false;
  }

  if (!Array.isArray(events)) {
    errors.push({ path: `${path}.events`, message: 'Must be an array', expected: 'array', actual: typeof events });
    valid = false;
  } else {
    (events as unknown[]).forEach((event: unknown, i: number) => {
      if (!validatePatternHistoryEvent(event, `${path}.events[${i}]`, errors)) {
        valid = false;
      }
    });
  }

  if (!isISODateString(createdAt)) {
    errors.push({ path: `${path}.createdAt`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: createdAt });
    valid = false;
  }

  if (!isISODateString(lastModified)) {
    errors.push({ path: `${path}.lastModified`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lastModified });
    valid = false;
  }

  return valid;
}


/**
 * Validate a HistoryFile object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateHistoryFile(data: unknown): ValidationResult<HistoryFile> {
  const errors: ValidationError[] = [];

  if (!isObject(data)) {
    errors.push({ path: '', message: 'History file must be an object', expected: 'object', actual: typeof data });
    return { valid: false, errors };
  }

  const version = get(data, 'version');
  const patterns = get(data, 'patterns');
  const lastUpdated = get(data, 'lastUpdated');

  // Version validation
  if (!isSemverVersion(version)) {
    errors.push({ path: 'version', message: 'Must be a valid semver version string', expected: 'semver', actual: version });
  } else if (!SUPPORTED_VERSIONS.historyFile.includes(version as '1.0.0')) {
    errors.push({ path: 'version', message: `Unsupported version. Supported: ${SUPPORTED_VERSIONS.historyFile.join(', ')}`, expected: SUPPORTED_VERSIONS.historyFile.join('|'), actual: version });
  }

  // Patterns array validation
  if (!Array.isArray(patterns)) {
    errors.push({ path: 'patterns', message: 'Must be an array', expected: 'array', actual: typeof patterns });
  } else {
    (patterns as unknown[]).forEach((history: unknown, i: number) => {
      validatePatternHistory(history, `patterns[${i}]`, errors);
    });
  }

  // Last updated validation
  if (!isISODateString(lastUpdated)) {
    errors.push({ path: 'lastUpdated', message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lastUpdated });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as unknown as HistoryFile };
}


/**
 * Validate a LockedPattern object
 */
function validateLockedPattern(
  pattern: unknown,
  path: string,
  errors: ValidationError[]
): pattern is LockedPattern {
  if (!isObject(pattern)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof pattern });
    return false;
  }

  let valid = true;
  const id = get(pattern, 'id');
  const category = get(pattern, 'category');
  const name = get(pattern, 'name');
  const confidenceScore = get(pattern, 'confidenceScore');
  const severity = get(pattern, 'severity');
  const definitionHash = get(pattern, 'definitionHash');
  const lockedAt = get(pattern, 'lockedAt');

  if (!isNonEmptyString(id)) {
    errors.push({ path: `${path}.id`, message: 'Must be a non-empty string', expected: 'string', actual: id });
    valid = false;
  }

  if (!isOneOf(category, VALID_PATTERN_CATEGORIES)) {
    errors.push({ path: `${path}.category`, message: `Must be one of: ${VALID_PATTERN_CATEGORIES.join(', ')}`, expected: VALID_PATTERN_CATEGORIES.join('|'), actual: category });
    valid = false;
  }

  if (!isNonEmptyString(name)) {
    errors.push({ path: `${path}.name`, message: 'Must be a non-empty string', expected: 'string', actual: name });
    valid = false;
  }

  if (!isNumberInRange(confidenceScore, 0, 1)) {
    errors.push({ path: `${path}.confidenceScore`, message: 'Must be a number between 0 and 1', expected: '0-1', actual: confidenceScore });
    valid = false;
  }

  if (!isOneOf(severity, VALID_SEVERITIES)) {
    errors.push({ path: `${path}.severity`, message: `Must be one of: ${VALID_SEVERITIES.join(', ')}`, expected: VALID_SEVERITIES.join('|'), actual: severity });
    valid = false;
  }

  if (!isNonEmptyString(definitionHash)) {
    errors.push({ path: `${path}.definitionHash`, message: 'Must be a non-empty string', expected: 'string', actual: definitionHash });
    valid = false;
  }

  if (!isISODateString(lockedAt)) {
    errors.push({ path: `${path}.lockedAt`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lockedAt });
    valid = false;
  }

  return valid;
}


/**
 * Validate a LockFile object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateLockFile(data: unknown): ValidationResult<LockFile> {
  const errors: ValidationError[] = [];

  if (!isObject(data)) {
    errors.push({ path: '', message: 'Lock file must be an object', expected: 'object', actual: typeof data });
    return { valid: false, errors };
  }

  const version = get(data, 'version');
  const patterns = get(data, 'patterns');
  const generatedAt = get(data, 'generatedAt');
  const checksum = get(data, 'checksum');

  // Version validation
  if (!isSemverVersion(version)) {
    errors.push({ path: 'version', message: 'Must be a valid semver version string', expected: 'semver', actual: version });
  } else if (!SUPPORTED_VERSIONS.lockFile.includes(version as '1.0.0')) {
    errors.push({ path: 'version', message: `Unsupported version. Supported: ${SUPPORTED_VERSIONS.lockFile.join(', ')}`, expected: SUPPORTED_VERSIONS.lockFile.join('|'), actual: version });
  }

  // Patterns array validation
  if (!Array.isArray(patterns)) {
    errors.push({ path: 'patterns', message: 'Must be an array', expected: 'array', actual: typeof patterns });
  } else {
    (patterns as unknown[]).forEach((pattern: unknown, i: number) => {
      validateLockedPattern(pattern, `patterns[${i}]`, errors);
    });
  }

  // Generated at validation
  if (!isISODateString(generatedAt)) {
    errors.push({ path: 'generatedAt', message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: generatedAt });
  }

  // Checksum validation
  if (!isNonEmptyString(checksum)) {
    errors.push({ path: 'checksum', message: 'Must be a non-empty string', expected: 'string', actual: checksum });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as unknown as LockFile };
}

/**
 * Validate a PatternVariant object
 */
function validatePatternVariant(
  variant: unknown,
  path: string,
  errors: ValidationError[]
): variant is PatternVariant {
  if (!isObject(variant)) {
    errors.push({ path, message: 'Must be an object', expected: 'object', actual: typeof variant });
    return false;
  }

  let valid = true;
  const id = get(variant, 'id');
  const patternId = get(variant, 'patternId');
  const name = get(variant, 'name');
  const reason = get(variant, 'reason');
  const scope = get(variant, 'scope');
  const scopeValue = get(variant, 'scopeValue');
  const locations = get(variant, 'locations');
  const createdAt = get(variant, 'createdAt');
  const createdBy = get(variant, 'createdBy');
  const active = get(variant, 'active');

  if (!isNonEmptyString(id)) {
    errors.push({ path: `${path}.id`, message: 'Must be a non-empty string', expected: 'string', actual: id });
    valid = false;
  }

  if (!isNonEmptyString(patternId)) {
    errors.push({ path: `${path}.patternId`, message: 'Must be a non-empty string', expected: 'string', actual: patternId });
    valid = false;
  }

  if (!isNonEmptyString(name)) {
    errors.push({ path: `${path}.name`, message: 'Must be a non-empty string', expected: 'string', actual: name });
    valid = false;
  }

  if (!isNonEmptyString(reason)) {
    errors.push({ path: `${path}.reason`, message: 'Must be a non-empty string', expected: 'string', actual: reason });
    valid = false;
  }

  if (!isOneOf(scope, VALID_VARIANT_SCOPES)) {
    errors.push({ path: `${path}.scope`, message: `Must be one of: ${VALID_VARIANT_SCOPES.join(', ')}`, expected: VALID_VARIANT_SCOPES.join('|'), actual: scope });
    valid = false;
  }

  // scopeValue is optional but must be string if provided
  if (scopeValue !== undefined && typeof scopeValue !== 'string') {
    errors.push({ path: `${path}.scopeValue`, message: 'Must be a string if provided', expected: 'string', actual: typeof scopeValue });
    valid = false;
  }

  if (!Array.isArray(locations)) {
    errors.push({ path: `${path}.locations`, message: 'Must be an array', expected: 'array', actual: typeof locations });
    valid = false;
  } else {
    (locations as unknown[]).forEach((loc: unknown, i: number) => {
      if (!validatePatternLocation(loc, `${path}.locations[${i}]`, errors)) {
        valid = false;
      }
    });
  }

  if (!isISODateString(createdAt)) {
    errors.push({ path: `${path}.createdAt`, message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: createdAt });
    valid = false;
  }

  if (createdBy !== undefined && typeof createdBy !== 'string') {
    errors.push({ path: `${path}.createdBy`, message: 'Must be a string if provided', expected: 'string', actual: typeof createdBy });
    valid = false;
  }

  if (typeof active !== 'boolean') {
    errors.push({ path: `${path}.active`, message: 'Must be a boolean', expected: 'boolean', actual: typeof active });
    valid = false;
  }

  return valid;
}


/**
 * Validate a VariantsFile object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateVariantsFile(data: unknown): ValidationResult<VariantsFile> {
  const errors: ValidationError[] = [];

  if (!isObject(data)) {
    errors.push({ path: '', message: 'Variants file must be an object', expected: 'object', actual: typeof data });
    return { valid: false, errors };
  }

  const version = get(data, 'version');
  const variants = get(data, 'variants');
  const lastUpdated = get(data, 'lastUpdated');

  // Version validation
  if (!isSemverVersion(version)) {
    errors.push({ path: 'version', message: 'Must be a valid semver version string', expected: 'semver', actual: version });
  } else if (!SUPPORTED_VERSIONS.variantsFile.includes(version as '1.0.0')) {
    errors.push({ path: 'version', message: `Unsupported version. Supported: ${SUPPORTED_VERSIONS.variantsFile.join(', ')}`, expected: SUPPORTED_VERSIONS.variantsFile.join('|'), actual: version });
  }

  // Variants array validation
  if (!Array.isArray(variants)) {
    errors.push({ path: 'variants', message: 'Must be an array', expected: 'array', actual: typeof variants });
  } else {
    (variants as unknown[]).forEach((variant: unknown, i: number) => {
      validatePatternVariant(variant, `variants[${i}]`, errors);
    });
  }

  // Last updated validation
  if (!isISODateString(lastUpdated)) {
    errors.push({ path: 'lastUpdated', message: 'Must be a valid ISO date string', expected: 'ISO date string', actual: lastUpdated });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as unknown as VariantsFile };
}


// ============================================================================
// Config Validator
// ============================================================================

/**
 * Validate a DriftConfig object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateConfig(data: unknown): ValidationResult<DriftConfig> {
  const errors: ValidationError[] = [];

  if (!isObject(data)) {
    errors.push({ path: '', message: 'Config must be an object', expected: 'object', actual: typeof data });
    return { valid: false, errors };
  }

  const severity = get(data, 'severity');
  const ignore = get(data, 'ignore');
  const ai = get(data, 'ai');
  const ci = get(data, 'ci');
  const learning = get(data, 'learning');
  const performance = get(data, 'performance');

  // Severity overrides (optional)
  if (severity !== undefined) {
    if (!isObject(severity)) {
      errors.push({ path: 'severity', message: 'Must be an object', expected: 'object', actual: typeof severity });
    } else {
      Object.entries(severity).forEach(([key, value]) => {
        if (!isOneOf(value, VALID_SEVERITIES)) {
          errors.push({ path: `severity.${key}`, message: `Must be one of: ${VALID_SEVERITIES.join(', ')}`, expected: VALID_SEVERITIES.join('|'), actual: value });
        }
      });
    }
  }

  // Ignore patterns (optional)
  if (ignore !== undefined) {
    if (!Array.isArray(ignore)) {
      errors.push({ path: 'ignore', message: 'Must be an array', expected: 'array', actual: typeof ignore });
    } else if (!ignore.every((p: unknown) => typeof p === 'string')) {
      errors.push({ path: 'ignore', message: 'All ignore patterns must be strings', expected: 'string[]', actual: ignore });
    }
  }

  // AI config (optional)
  if (ai !== undefined) {
    if (!isObject(ai)) {
      errors.push({ path: 'ai', message: 'Must be an object', expected: 'object', actual: typeof ai });
    } else {
      const aiProvider = get(ai, 'provider');
      const aiModel = get(ai, 'model');
      if (!isOneOf(aiProvider, VALID_AI_PROVIDERS)) {
        errors.push({ path: 'ai.provider', message: `Must be one of: ${VALID_AI_PROVIDERS.join(', ')}`, expected: VALID_AI_PROVIDERS.join('|'), actual: aiProvider });
      }
      if (aiModel !== undefined && typeof aiModel !== 'string') {
        errors.push({ path: 'ai.model', message: 'Must be a string if provided', expected: 'string', actual: typeof aiModel });
      }
    }
  }

  // CI config (optional)
  if (ci !== undefined) {
    if (!isObject(ci)) {
      errors.push({ path: 'ci', message: 'Must be an object', expected: 'object', actual: typeof ci });
    } else {
      const ciFailOn = get(ci, 'failOn');
      const ciReportFormat = get(ci, 'reportFormat');
      if (!isOneOf(ciFailOn, VALID_CI_FAIL_ON)) {
        errors.push({ path: 'ci.failOn', message: `Must be one of: ${VALID_CI_FAIL_ON.join(', ')}`, expected: VALID_CI_FAIL_ON.join('|'), actual: ciFailOn });
      }
      if (!isOneOf(ciReportFormat, VALID_REPORT_FORMATS)) {
        errors.push({ path: 'ci.reportFormat', message: `Must be one of: ${VALID_REPORT_FORMATS.join(', ')}`, expected: VALID_REPORT_FORMATS.join('|'), actual: ciReportFormat });
      }
    }
  }

  // Learning config (optional)
  if (learning !== undefined) {
    if (!isObject(learning)) {
      errors.push({ path: 'learning', message: 'Must be an object', expected: 'object', actual: typeof learning });
    } else {
      const autoApproveThreshold = get(learning, 'autoApproveThreshold');
      const minOccurrences = get(learning, 'minOccurrences');
      if (!isNumberInRange(autoApproveThreshold, 0, 1)) {
        errors.push({ path: 'learning.autoApproveThreshold', message: 'Must be a number between 0 and 1', expected: '0-1', actual: autoApproveThreshold });
      }
      if (!isPositiveInteger(minOccurrences)) {
        errors.push({ path: 'learning.minOccurrences', message: 'Must be a non-negative integer', expected: 'integer >= 0', actual: minOccurrences });
      }
    }
  }

  // Performance config (optional)
  if (performance !== undefined) {
    if (!isObject(performance)) {
      errors.push({ path: 'performance', message: 'Must be an object', expected: 'object', actual: typeof performance });
    } else {
      const maxWorkers = get(performance, 'maxWorkers');
      const cacheEnabled = get(performance, 'cacheEnabled');
      const incrementalAnalysis = get(performance, 'incrementalAnalysis');
      if (!isPositiveInteger(maxWorkers) || (maxWorkers) < 1) {
        errors.push({ path: 'performance.maxWorkers', message: 'Must be a positive integer', expected: 'integer >= 1', actual: maxWorkers });
      }
      if (typeof cacheEnabled !== 'boolean') {
        errors.push({ path: 'performance.cacheEnabled', message: 'Must be a boolean', expected: 'boolean', actual: typeof cacheEnabled });
      }
      if (typeof incrementalAnalysis !== 'boolean') {
        errors.push({ path: 'performance.incrementalAnalysis', message: 'Must be a boolean', expected: 'boolean', actual: typeof incrementalAnalysis });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as DriftConfig };
}


// ============================================================================
// Single Pattern Validator (Public API)
// ============================================================================

/**
 * Validate a single Pattern object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateSinglePattern(data: unknown): ValidationResult<Pattern> {
  const errors: ValidationError[] = [];

  if (!validatePattern(data, '', errors)) {
    return { valid: false, errors };
  }

  return { valid: true, data: data };
}

/**
 * Validate a single StoredPattern object
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */
export function validateSingleStoredPattern(data: unknown): ValidationResult<StoredPattern> {
  const errors: ValidationError[] = [];

  if (!validateStoredPattern(data, '', errors)) {
    return { valid: false, errors };
  }

  return { valid: true, data: data };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidPatternFile(data: unknown): PatternFile {
  const result = validatePatternFile(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid pattern file: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'PatternFile'
    );
  }
  return result.data!;
}

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidHistoryFile(data: unknown): HistoryFile {
  const result = validateHistoryFile(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid history file: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'HistoryFile'
    );
  }
  return result.data!;
}

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidLockFile(data: unknown): LockFile {
  const result = validateLockFile(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid lock file: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'LockFile'
    );
  }
  return result.data!;
}

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidVariantsFile(data: unknown): VariantsFile {
  const result = validateVariantsFile(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid variants file: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'VariantsFile'
    );
  }
  return result.data!;
}

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidConfig(data: unknown): DriftConfig {
  const result = validateConfig(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid config: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'DriftConfig'
    );
  }
  return result.data!;
}

/**
 * Validate and throw if invalid
 *
 * @throws SchemaValidationError if validation fails
 */
export function assertValidPattern(data: unknown): Pattern {
  const result = validateSinglePattern(data);
  if (!result.valid) {
    throw new SchemaValidationError(
      `Invalid pattern: ${result.errors!.length} validation error(s)`,
      result.errors!,
      'Pattern'
    );
  }
  return result.data!;
}

// ============================================================================
// Version Checking
// ============================================================================

/**
 * Check if a schema version is supported
 */
export function isVersionSupported(
  schemaType: keyof typeof SUPPORTED_VERSIONS,
  version: string
): boolean {
  return SUPPORTED_VERSIONS[schemaType].includes(version as never);
}

/**
 * Get the current schema version for a type
 */
export function getCurrentVersion(schemaType: keyof typeof SCHEMA_VERSIONS): string {
  return SCHEMA_VERSIONS[schemaType];
}

/**
 * Format validation errors as a human-readable string
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {return 'No errors';}
  
  return errors
    .map((e) => {
      let msg = e.path ? `${e.path}: ${e.message}` : e.message;
      if (e.expected) {msg += ` (expected: ${e.expected})`;}
      if (e.actual !== undefined) {msg += ` (got: ${JSON.stringify(e.actual)})`;}
      return `  - ${msg}`;
    })
    .join('\n');
}
