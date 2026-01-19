/**
 * Schema Validator Tests
 *
 * Comprehensive tests for JSON schema validation of patterns and config.
 *
 * @requirements 4.5 - Pattern schema SHALL be validated on load/save
 */

import { describe, it, expect } from 'vitest';
import {
  validatePatternFile,
  validateHistoryFile,
  validateLockFile,
  validateVariantsFile,
  validateConfig,
  validateSinglePattern,
  validateSingleStoredPattern,
  assertValidPatternFile,
  assertValidConfig,
  SchemaValidationError,
  SCHEMA_VERSIONS,
  isVersionSupported,
  getCurrentVersion,
  formatValidationErrors,
  type ValidationError,
} from './schema-validator.js';
import type {
  PatternFile,
  HistoryFile,
  LockFile,
  VariantsFile,
  Pattern,
  StoredPattern,
} from './types.js';
import type { DriftConfig } from '../config/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const validPatternLocation = {
  file: 'src/components/Button.tsx',
  line: 10,
  column: 5,
};

const validOutlierLocation = {
  ...validPatternLocation,
  reason: 'Uses non-standard prop naming',
  deviationScore: 0.75,
};

const validConfidenceInfo = {
  frequency: 0.85,
  consistency: 0.92,
  age: 30,
  spread: 15,
  score: 0.88,
  level: 'high' as const,
};


const validDetectorConfig = {
  type: 'ast' as const,
  config: { nodeType: 'function_declaration' },
};

const validPatternMetadata = {
  firstSeen: '2024-01-15T10:30:00.000Z',
  lastSeen: '2024-03-20T14:45:00.000Z',
  approvedAt: '2024-02-01T09:00:00.000Z',
  approvedBy: 'developer@example.com',
  version: '1.0.0',
  tags: ['react', 'components'],
  source: 'auto-detected',
};

const validStoredPattern: StoredPattern = {
  id: 'component-props-destructuring',
  subcategory: 'props-patterns',
  name: 'Props Destructuring',
  description: 'Components should destructure props in function signature',
  detector: validDetectorConfig,
  confidence: validConfidenceInfo,
  locations: [validPatternLocation],
  outliers: [validOutlierLocation],
  metadata: validPatternMetadata,
  severity: 'warning',
  autoFixable: true,
};

const validPattern: Pattern = {
  ...validStoredPattern,
  category: 'components',
  status: 'approved',
};

const validPatternFile: PatternFile = {
  version: '1.0.0',
  category: 'components',
  patterns: [validStoredPattern],
  lastUpdated: '2024-03-20T14:45:00.000Z',
};

const validHistoryFile: HistoryFile = {
  version: '1.0.0',
  patterns: [
    {
      patternId: 'component-props-destructuring',
      category: 'components',
      events: [
        {
          timestamp: '2024-01-15T10:30:00.000Z',
          type: 'created',
          patternId: 'component-props-destructuring',
        },
        {
          timestamp: '2024-02-01T09:00:00.000Z',
          type: 'approved',
          patternId: 'component-props-destructuring',
          user: 'developer@example.com',
        },
      ],
      createdAt: '2024-01-15T10:30:00.000Z',
      lastModified: '2024-02-01T09:00:00.000Z',
    },
  ],
  lastUpdated: '2024-03-20T14:45:00.000Z',
};


const validLockFile: LockFile = {
  version: '1.0.0',
  patterns: [
    {
      id: 'component-props-destructuring',
      category: 'components',
      name: 'Props Destructuring',
      confidenceScore: 0.88,
      severity: 'warning',
      definitionHash: 'abc123def456',
      lockedAt: '2024-03-20T14:45:00.000Z',
    },
  ],
  generatedAt: '2024-03-20T14:45:00.000Z',
  checksum: 'sha256:abcdef123456',
};

const validVariantsFile: VariantsFile = {
  version: '1.0.0',
  variants: [
    {
      id: 'variant-legacy-button',
      patternId: 'component-props-destructuring',
      name: 'Legacy Button Exception',
      reason: 'Legacy component cannot be refactored without breaking changes',
      scope: 'file',
      scopeValue: 'src/legacy/Button.tsx',
      locations: [validPatternLocation],
      createdAt: '2024-02-15T11:00:00.000Z',
      createdBy: 'developer@example.com',
      active: true,
    },
  ],
  lastUpdated: '2024-03-20T14:45:00.000Z',
};

const validConfig: DriftConfig = {
  severity: {
    'component-props-destructuring': 'error',
  },
  ignore: ['node_modules/**', 'dist/**'],
  ai: {
    provider: 'anthropic',
    model: 'claude-3-sonnet',
  },
  ci: {
    failOn: 'error',
    reportFormat: 'github',
  },
  learning: {
    autoApproveThreshold: 0.9,
    minOccurrences: 5,
  },
  performance: {
    maxWorkers: 4,
    cacheEnabled: true,
    incrementalAnalysis: true,
  },
};


// ============================================================================
// PatternFile Validation Tests
// ============================================================================

describe('validatePatternFile', () => {
  it('should validate a valid pattern file', () => {
    const result = validatePatternFile(validPatternFile);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validPatternFile);
    expect(result.errors).toBeUndefined();
  });

  it('should reject non-object input', () => {
    const result = validatePatternFile('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].message).toContain('must be an object');
  });

  it('should reject invalid version', () => {
    const result = validatePatternFile({ ...validPatternFile, version: 'invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'version')).toBe(true);
  });

  it('should reject unsupported version', () => {
    const result = validatePatternFile({ ...validPatternFile, version: '99.0.0' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'version' && e.message.includes('Unsupported'))).toBe(true);
  });

  it('should reject invalid category', () => {
    const result = validatePatternFile({ ...validPatternFile, category: 'invalid-category' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'category')).toBe(true);
  });

  it('should reject non-array patterns', () => {
    const result = validatePatternFile({ ...validPatternFile, patterns: 'not an array' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'patterns')).toBe(true);
  });

  it('should reject invalid lastUpdated', () => {
    const result = validatePatternFile({ ...validPatternFile, lastUpdated: 'not a date' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'lastUpdated')).toBe(true);
  });

  it('should validate patterns within the file', () => {
    const invalidPattern = { ...validStoredPattern, id: '' };
    const result = validatePatternFile({ ...validPatternFile, patterns: [invalidPattern] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('patterns[0].id'))).toBe(true);
  });

  it('should accept optional checksum', () => {
    const withChecksum = { ...validPatternFile, checksum: 'sha256:abc123' };
    const result = validatePatternFile(withChecksum);
    expect(result.valid).toBe(true);
  });
});


// ============================================================================
// HistoryFile Validation Tests
// ============================================================================

describe('validateHistoryFile', () => {
  it('should validate a valid history file', () => {
    const result = validateHistoryFile(validHistoryFile);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validHistoryFile);
  });

  it('should reject non-object input', () => {
    const result = validateHistoryFile(null);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid version', () => {
    const result = validateHistoryFile({ ...validHistoryFile, version: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'version')).toBe(true);
  });

  it('should reject invalid event type', () => {
    const invalidHistory = {
      ...validHistoryFile,
      patterns: [{
        ...validHistoryFile.patterns[0],
        events: [{ ...validHistoryFile.patterns[0].events[0], type: 'invalid-type' }],
      }],
    };
    const result = validateHistoryFile(invalidHistory);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('type'))).toBe(true);
  });

  it('should validate all valid event types', () => {
    const eventTypes = ['created', 'approved', 'ignored', 'updated', 'deleted', 'confidence_changed', 'locations_changed', 'severity_changed'];
    for (const type of eventTypes) {
      const history = {
        ...validHistoryFile,
        patterns: [{
          ...validHistoryFile.patterns[0],
          events: [{ ...validHistoryFile.patterns[0].events[0], type }],
        }],
      };
      const result = validateHistoryFile(history);
      expect(result.valid).toBe(true);
    }
  });
});

// ============================================================================
// LockFile Validation Tests
// ============================================================================

describe('validateLockFile', () => {
  it('should validate a valid lock file', () => {
    const result = validateLockFile(validLockFile);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validLockFile);
  });

  it('should reject missing checksum', () => {
    const { checksum, ...withoutChecksum } = validLockFile;
    const result = validateLockFile(withoutChecksum);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'checksum')).toBe(true);
  });

  it('should reject invalid confidence score', () => {
    const invalidLock = {
      ...validLockFile,
      patterns: [{ ...validLockFile.patterns[0], confidenceScore: 1.5 }],
    };
    const result = validateLockFile(invalidLock);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('confidenceScore'))).toBe(true);
  });

  it('should reject invalid severity', () => {
    const invalidLock = {
      ...validLockFile,
      patterns: [{ ...validLockFile.patterns[0], severity: 'critical' }],
    };
    const result = validateLockFile(invalidLock);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('severity'))).toBe(true);
  });
});


// ============================================================================
// VariantsFile Validation Tests
// ============================================================================

describe('validateVariantsFile', () => {
  it('should validate a valid variants file', () => {
    const result = validateVariantsFile(validVariantsFile);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validVariantsFile);
  });

  it('should reject invalid scope', () => {
    const invalidVariants = {
      ...validVariantsFile,
      variants: [{ ...validVariantsFile.variants[0], scope: 'invalid-scope' }],
    };
    const result = validateVariantsFile(invalidVariants);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('scope'))).toBe(true);
  });

  it('should validate all valid scopes', () => {
    const scopes = ['global', 'directory', 'file'];
    for (const scope of scopes) {
      const variants = {
        ...validVariantsFile,
        variants: [{ ...validVariantsFile.variants[0], scope }],
      };
      const result = validateVariantsFile(variants);
      expect(result.valid).toBe(true);
    }
  });

  it('should reject non-boolean active field', () => {
    const invalidVariants = {
      ...validVariantsFile,
      variants: [{ ...validVariantsFile.variants[0], active: 'yes' }],
    };
    const result = validateVariantsFile(invalidVariants);
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('active'))).toBe(true);
  });

  it('should accept optional scopeValue', () => {
    const { scopeValue, ...variantWithoutScopeValue } = validVariantsFile.variants[0];
    const variants = {
      ...validVariantsFile,
      variants: [variantWithoutScopeValue],
    };
    const result = validateVariantsFile(variants);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Config Validation Tests
// ============================================================================

describe('validateConfig', () => {
  it('should validate a valid config', () => {
    const result = validateConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validConfig);
  });

  it('should accept empty config', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
  });

  it('should reject invalid severity override', () => {
    const result = validateConfig({ severity: { 'pattern-id': 'critical' } });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('severity'))).toBe(true);
  });

  it('should reject non-array ignore', () => {
    const result = validateConfig({ ignore: 'not-an-array' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'ignore')).toBe(true);
  });

  it('should reject invalid AI provider', () => {
    const result = validateConfig({ ai: { provider: 'invalid-provider' } });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'ai.provider')).toBe(true);
  });

  it('should validate all valid AI providers', () => {
    const providers = ['openai', 'anthropic', 'ollama'];
    for (const provider of providers) {
      const result = validateConfig({ ai: { provider } });
      expect(result.valid).toBe(true);
    }
  });

  it('should reject invalid CI failOn', () => {
    const result = validateConfig({ ci: { failOn: 'always', reportFormat: 'json' } });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'ci.failOn')).toBe(true);
  });

  it('should reject invalid learning threshold', () => {
    const result = validateConfig({ learning: { autoApproveThreshold: 1.5, minOccurrences: 5 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'learning.autoApproveThreshold')).toBe(true);
  });

  it('should reject invalid performance maxWorkers', () => {
    const result = validateConfig({ performance: { maxWorkers: 0, cacheEnabled: true, incrementalAnalysis: true } });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === 'performance.maxWorkers')).toBe(true);
  });
});


// ============================================================================
// Pattern Validation Tests
// ============================================================================

describe('validateSinglePattern', () => {
  it('should validate a valid pattern', () => {
    const result = validateSinglePattern(validPattern);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validPattern);
  });

  it('should reject invalid category', () => {
    const result = validateSinglePattern({ ...validPattern, category: 'invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('category'))).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = validateSinglePattern({ ...validPattern, status: 'pending' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('status'))).toBe(true);
  });

  it('should validate all valid categories', () => {
    const categories = [
      'structural', 'components', 'styling', 'api', 'auth', 'errors',
      'data-access', 'testing', 'logging', 'security', 'config', 'types',
      'performance', 'accessibility', 'documentation',
    ];
    for (const category of categories) {
      const result = validateSinglePattern({ ...validPattern, category });
      expect(result.valid).toBe(true);
    }
  });

  it('should validate all valid statuses', () => {
    const statuses = ['discovered', 'approved', 'ignored'];
    for (const status of statuses) {
      const result = validateSinglePattern({ ...validPattern, status });
      expect(result.valid).toBe(true);
    }
  });
});

describe('validateSingleStoredPattern', () => {
  it('should validate a valid stored pattern', () => {
    const result = validateSingleStoredPattern(validStoredPattern);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(validStoredPattern);
  });

  it('should reject empty id', () => {
    const result = validateSingleStoredPattern({ ...validStoredPattern, id: '' });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path === '.id')).toBe(true);
  });

  it('should reject invalid confidence score', () => {
    const invalidConfidence = { ...validConfidenceInfo, score: 1.5 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('confidence.score'))).toBe(true);
  });

  it('should reject invalid detector type', () => {
    const invalidDetector = { ...validDetectorConfig, type: 'invalid' };
    const result = validateSingleStoredPattern({ ...validStoredPattern, detector: invalidDetector });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('detector.type'))).toBe(true);
  });

  it('should validate all valid detector types', () => {
    const types = ['ast', 'regex', 'semantic', 'structural', 'custom'];
    for (const type of types) {
      const detector = { ...validDetectorConfig, type };
      const result = validateSingleStoredPattern({ ...validStoredPattern, detector });
      expect(result.valid).toBe(true);
    }
  });

  it('should validate all valid severities', () => {
    const severities = ['error', 'warning', 'info', 'hint'];
    for (const severity of severities) {
      const result = validateSingleStoredPattern({ ...validStoredPattern, severity });
      expect(result.valid).toBe(true);
    }
  });
});


// ============================================================================
// Confidence Info Validation Tests
// ============================================================================

describe('Confidence Info Validation', () => {
  it('should reject frequency out of range', () => {
    const invalidConfidence = { ...validConfidenceInfo, frequency: -0.1 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('frequency'))).toBe(true);
  });

  it('should reject consistency out of range', () => {
    const invalidConfidence = { ...validConfidenceInfo, consistency: 1.1 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('consistency'))).toBe(true);
  });

  it('should reject negative age', () => {
    const invalidConfidence = { ...validConfidenceInfo, age: -5 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('age'))).toBe(true);
  });

  it('should reject negative spread', () => {
    const invalidConfidence = { ...validConfidenceInfo, spread: -1 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('spread'))).toBe(true);
  });

  it('should reject invalid confidence level', () => {
    const invalidConfidence = { ...validConfidenceInfo, level: 'very-high' };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: invalidConfidence });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('level'))).toBe(true);
  });

  it('should validate all valid confidence levels', () => {
    const levels = ['high', 'medium', 'low', 'uncertain'];
    for (const level of levels) {
      const confidence = { ...validConfidenceInfo, level };
      const result = validateSingleStoredPattern({ ...validStoredPattern, confidence });
      expect(result.valid).toBe(true);
    }
  });
});

// ============================================================================
// Location Validation Tests
// ============================================================================

describe('Location Validation', () => {
  it('should reject location with empty file', () => {
    const invalidLocation = { ...validPatternLocation, file: '' };
    const result = validateSingleStoredPattern({ ...validStoredPattern, locations: [invalidLocation] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('file'))).toBe(true);
  });

  it('should reject location with zero line', () => {
    const invalidLocation = { ...validPatternLocation, line: 0 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, locations: [invalidLocation] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('line'))).toBe(true);
  });

  it('should reject location with zero column', () => {
    const invalidLocation = { ...validPatternLocation, column: 0 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, locations: [invalidLocation] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('column'))).toBe(true);
  });

  it('should accept location with optional endLine and endColumn', () => {
    const locationWithEnd = { ...validPatternLocation, endLine: 15, endColumn: 20 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, locations: [locationWithEnd] });
    expect(result.valid).toBe(true);
  });

  it('should reject outlier without reason', () => {
    const { reason, ...outlierWithoutReason } = validOutlierLocation;
    const result = validateSingleStoredPattern({ ...validStoredPattern, outliers: [outlierWithoutReason] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('reason'))).toBe(true);
  });

  it('should reject outlier with invalid deviationScore', () => {
    const invalidOutlier = { ...validOutlierLocation, deviationScore: 1.5 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, outliers: [invalidOutlier] });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('deviationScore'))).toBe(true);
  });
});


// ============================================================================
// Metadata Validation Tests
// ============================================================================

describe('Metadata Validation', () => {
  it('should reject invalid firstSeen date', () => {
    const invalidMetadata = { ...validPatternMetadata, firstSeen: 'not-a-date' };
    const result = validateSingleStoredPattern({ ...validStoredPattern, metadata: invalidMetadata });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('firstSeen'))).toBe(true);
  });

  it('should reject invalid lastSeen date', () => {
    const invalidMetadata = { ...validPatternMetadata, lastSeen: '2024-01-15' }; // Missing time component
    const result = validateSingleStoredPattern({ ...validStoredPattern, metadata: invalidMetadata });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('lastSeen'))).toBe(true);
  });

  it('should accept metadata without optional fields', () => {
    const minimalMetadata = {
      firstSeen: '2024-01-15T10:30:00.000Z',
      lastSeen: '2024-03-20T14:45:00.000Z',
    };
    const result = validateSingleStoredPattern({ ...validStoredPattern, metadata: minimalMetadata });
    expect(result.valid).toBe(true);
  });

  it('should reject non-string tags', () => {
    const invalidMetadata = { ...validPatternMetadata, tags: [1, 2, 3] };
    const result = validateSingleStoredPattern({ ...validStoredPattern, metadata: invalidMetadata });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('tags'))).toBe(true);
  });

  it('should reject non-array tags', () => {
    const invalidMetadata = { ...validPatternMetadata, tags: 'not-an-array' };
    const result = validateSingleStoredPattern({ ...validStoredPattern, metadata: invalidMetadata });
    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.path.includes('tags'))).toBe(true);
  });
});

// ============================================================================
// Assert Functions Tests
// ============================================================================

describe('assertValidPatternFile', () => {
  it('should return data for valid input', () => {
    const result = assertValidPatternFile(validPatternFile);
    expect(result).toEqual(validPatternFile);
  });

  it('should throw SchemaValidationError for invalid input', () => {
    expect(() => assertValidPatternFile({ invalid: true })).toThrow(SchemaValidationError);
  });

  it('should include error details in thrown error', () => {
    try {
      assertValidPatternFile({ invalid: true });
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      const schemaError = error as SchemaValidationError;
      expect(schemaError.errors.length).toBeGreaterThan(0);
      expect(schemaError.schemaType).toBe('PatternFile');
      expect(schemaError.formatErrors()).toContain('-');
    }
  });
});

describe('assertValidConfig', () => {
  it('should return data for valid input', () => {
    const result = assertValidConfig(validConfig);
    expect(result).toEqual(validConfig);
  });

  it('should throw SchemaValidationError for invalid input', () => {
    expect(() => assertValidConfig({ ai: { provider: 'invalid' } })).toThrow(SchemaValidationError);
  });
});


// ============================================================================
// Version Checking Tests
// ============================================================================

describe('Version Checking', () => {
  describe('isVersionSupported', () => {
    it('should return true for supported versions', () => {
      expect(isVersionSupported('patternFile', '1.0.0')).toBe(true);
      expect(isVersionSupported('historyFile', '1.0.0')).toBe(true);
      expect(isVersionSupported('lockFile', '1.0.0')).toBe(true);
      expect(isVersionSupported('variantsFile', '1.0.0')).toBe(true);
      expect(isVersionSupported('config', '1.0.0')).toBe(true);
    });

    it('should return false for unsupported versions', () => {
      expect(isVersionSupported('patternFile', '2.0.0')).toBe(false);
      expect(isVersionSupported('historyFile', '0.9.0')).toBe(false);
    });
  });

  describe('getCurrentVersion', () => {
    it('should return current schema versions', () => {
      expect(getCurrentVersion('pattern')).toBe('1.0.0');
      expect(getCurrentVersion('patternFile')).toBe('1.0.0');
      expect(getCurrentVersion('historyFile')).toBe('1.0.0');
      expect(getCurrentVersion('lockFile')).toBe('1.0.0');
      expect(getCurrentVersion('variantsFile')).toBe('1.0.0');
      expect(getCurrentVersion('config')).toBe('1.0.0');
    });
  });

  describe('SCHEMA_VERSIONS', () => {
    it('should have all expected schema types', () => {
      expect(SCHEMA_VERSIONS).toHaveProperty('pattern');
      expect(SCHEMA_VERSIONS).toHaveProperty('patternFile');
      expect(SCHEMA_VERSIONS).toHaveProperty('historyFile');
      expect(SCHEMA_VERSIONS).toHaveProperty('lockFile');
      expect(SCHEMA_VERSIONS).toHaveProperty('variantsFile');
      expect(SCHEMA_VERSIONS).toHaveProperty('config');
    });
  });
});

// ============================================================================
// Error Formatting Tests
// ============================================================================

describe('formatValidationErrors', () => {
  it('should return "No errors" for empty array', () => {
    expect(formatValidationErrors([])).toBe('No errors');
  });

  it('should format single error', () => {
    const errors: ValidationError[] = [
      { path: 'field', message: 'is required' },
    ];
    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('field');
    expect(formatted).toContain('is required');
  });

  it('should format multiple errors', () => {
    const errors: ValidationError[] = [
      { path: 'field1', message: 'is required' },
      { path: 'field2', message: 'must be a number', expected: 'number', actual: 'string' },
    ];
    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('field1');
    expect(formatted).toContain('field2');
    expect(formatted).toContain('expected: number');
    expect(formatted).toContain('"string"');
  });

  it('should handle errors without path', () => {
    const errors: ValidationError[] = [
      { path: '', message: 'Root must be an object' },
    ];
    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('Root must be an object');
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle null input', () => {
    expect(validatePatternFile(null).valid).toBe(false);
    expect(validateHistoryFile(null).valid).toBe(false);
    expect(validateLockFile(null).valid).toBe(false);
    expect(validateVariantsFile(null).valid).toBe(false);
    expect(validateConfig(null).valid).toBe(false);
  });

  it('should handle undefined input', () => {
    expect(validatePatternFile(undefined).valid).toBe(false);
    expect(validateHistoryFile(undefined).valid).toBe(false);
    expect(validateLockFile(undefined).valid).toBe(false);
    expect(validateVariantsFile(undefined).valid).toBe(false);
    expect(validateConfig(undefined).valid).toBe(false);
  });

  it('should handle array input', () => {
    expect(validatePatternFile([]).valid).toBe(false);
    expect(validateConfig([]).valid).toBe(false);
  });

  it('should handle empty patterns array', () => {
    const emptyPatterns = { ...validPatternFile, patterns: [] };
    const result = validatePatternFile(emptyPatterns);
    expect(result.valid).toBe(true);
  });

  it('should handle empty variants array', () => {
    const emptyVariants = { ...validVariantsFile, variants: [] };
    const result = validateVariantsFile(emptyVariants);
    expect(result.valid).toBe(true);
  });

  it('should handle empty history patterns array', () => {
    const emptyHistory = { ...validHistoryFile, patterns: [] };
    const result = validateHistoryFile(emptyHistory);
    expect(result.valid).toBe(true);
  });

  it('should handle boundary confidence values', () => {
    // Test exact boundary values
    const boundaryConfidence = { ...validConfidenceInfo, frequency: 0, consistency: 1, score: 0 };
    const result = validateSingleStoredPattern({ ...validStoredPattern, confidence: boundaryConfidence });
    expect(result.valid).toBe(true);
  });
});
