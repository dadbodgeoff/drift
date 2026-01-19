/**
 * Config Validator Tests
 *
 * Tests for configuration validation against JSON schema
 * with helpful error messages.
 *
 * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
 * @requirements 36.7 - Configuration SHALL support JSON schema validation
 */

import { describe, it, expect } from 'vitest';

import {
  validateConfig,
  assertValidConfig,
  validatePartialConfig,
  formatConfigErrors,
  getErrorSummary,
  ConfigValidationException,
  DRIFT_CONFIG_SCHEMA,
  type ConfigValidationError,
  type ConfigValidationResult,
} from './config-validator.js';
import type { DriftConfig } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a valid base config for testing
 */
function createValidConfig(): DriftConfig {
  return {
    severity: {
      'pattern-1': 'error',
      'pattern-2': 'warning',
    },
    ignore: ['node_modules', 'dist', '*.test.ts'],
    ai: {
      provider: 'openai',
      model: 'gpt-4',
    },
    ci: {
      failOn: 'error',
      reportFormat: 'github',
    },
    learning: {
      autoApproveThreshold: 0.95,
      minOccurrences: 3,
    },
    performance: {
      maxWorkers: 4,
      cacheEnabled: true,
      incrementalAnalysis: true,
    },
  };
}

// ============================================================================
// validateConfig Tests
// ============================================================================

describe('validateConfig', () => {
  describe('valid configurations', () => {
    /**
     * @requirements 36.7 - Configuration SHALL support JSON schema validation
     */
    it('should accept a complete valid configuration', () => {
      const config = createValidConfig();
      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(config);
      expect(result.errors).toBeUndefined();
    });

    it('should accept an empty configuration object', () => {
      const result = validateConfig({});

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should accept configuration with only severity overrides', () => {
      const config = {
        severity: {
          'my-pattern': 'warning',
        },
      };
      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(config);
    });

    it('should accept configuration with only ignore patterns', () => {
      const config = {
        ignore: ['node_modules', '**/*.test.ts'],
      };
      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should accept all valid AI providers', () => {
      const providers = ['openai', 'anthropic', 'ollama'] as const;

      for (const provider of providers) {
        const config = { ai: { provider } };
        const result = validateConfig(config);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept all valid CI failOn values', () => {
      const failOnValues = ['error', 'warning', 'none'] as const;

      for (const failOn of failOnValues) {
        const config = { ci: { failOn, reportFormat: 'text' as const } };
        const result = validateConfig(config);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept all valid report formats', () => {
      const formats = ['json', 'text', 'github', 'gitlab'] as const;

      for (const reportFormat of formats) {
        const config = { ci: { failOn: 'error' as const, reportFormat } };
        const result = validateConfig(config);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept all valid severity levels', () => {
      const severities = ['error', 'warning', 'info', 'hint'] as const;

      for (const severity of severities) {
        const config = { severity: { 'test-pattern': severity } };
        const result = validateConfig(config);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept boundary values for autoApproveThreshold', () => {
      // Test 0
      let result = validateConfig({ learning: { autoApproveThreshold: 0, minOccurrences: 1 } });
      expect(result.valid).toBe(true);

      // Test 1
      result = validateConfig({ learning: { autoApproveThreshold: 1, minOccurrences: 1 } });
      expect(result.valid).toBe(true);

      // Test middle value
      result = validateConfig({ learning: { autoApproveThreshold: 0.5, minOccurrences: 1 } });
      expect(result.valid).toBe(true);
    });

    it('should accept minOccurrences of 1', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 0.9, minOccurrences: 1 } });
      expect(result.valid).toBe(true);
    });

    it('should accept maxWorkers of 1', () => {
      const result = validateConfig({
        performance: { maxWorkers: 1, cacheEnabled: true, incrementalAnalysis: true },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid root type', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject null', () => {
      const result = validateConfig(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].path).toBe('');
      expect(result.errors![0].message).toContain('must be a JSON object');
      expect(result.errors![0].suggestion).toBeDefined();
    });

    it('should reject arrays', () => {
      const result = validateConfig([]);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('must be a JSON object');
    });

    it('should reject strings', () => {
      const result = validateConfig('invalid');

      expect(result.valid).toBe(false);
      expect(result.errors![0].actual).toBe('string');
    });

    it('should reject numbers', () => {
      const result = validateConfig(42);

      expect(result.valid).toBe(false);
      expect(result.errors![0].actual).toBe('number');
    });
  });

  describe('severity validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-object severity', () => {
      const result = validateConfig({ severity: 'invalid' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('severity');
      expect(result.errors![0].message).toContain('must be an object');
      expect(result.errors![0].suggestion).toContain('pattern-id');
    });

    it('should reject invalid severity values', () => {
      const result = validateConfig({
        severity: {
          'pattern-1': 'invalid-severity',
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('severity.pattern-1');
      expect(result.errors![0].message).toContain('Invalid severity level');
      expect(result.errors![0].expected).toContain('error');
      expect(result.errors![0].expected).toContain('warning');
    });

    it('should reject multiple invalid severity values', () => {
      const result = validateConfig({
        severity: {
          'pattern-1': 'bad1',
          'pattern-2': 'bad2',
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBe(2);
    });
  });

  describe('ignore validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-array ignore', () => {
      const result = validateConfig({ ignore: 'not-an-array' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ignore');
      expect(result.errors![0].message).toContain('must be an array');
    });

    it('should reject non-string items in ignore array', () => {
      const result = validateConfig({ ignore: ['valid', 123, 'also-valid'] });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ignore[1]');
      expect(result.errors![0].message).toContain('must be a string');
    });

    it('should reject empty strings in ignore array', () => {
      const result = validateConfig({ ignore: ['valid', '', 'also-valid'] });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ignore[1]');
      expect(result.errors![0].message).toContain('cannot be empty');
    });
  });

  describe('AI config validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-object ai config', () => {
      const result = validateConfig({ ai: 'invalid' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ai');
      expect(result.errors![0].message).toContain('must be an object');
    });

    it('should reject missing provider when ai is specified', () => {
      const result = validateConfig({ ai: { model: 'gpt-4' } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ai.provider');
      expect(result.errors![0].message).toContain('required');
    });

    it('should reject invalid provider', () => {
      const result = validateConfig({ ai: { provider: 'invalid-provider' } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ai.provider');
      expect(result.errors![0].message).toContain('Invalid AI provider');
      expect(result.errors![0].suggestion).toContain('openai');
    });

    it('should reject non-string model', () => {
      const result = validateConfig({ ai: { provider: 'openai', model: 123 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ai.model');
      expect(result.errors![0].message).toContain('must be a string');
    });
  });

  describe('CI config validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-object ci config', () => {
      const result = validateConfig({ ci: 'invalid' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ci');
    });

    it('should reject invalid failOn value', () => {
      const result = validateConfig({ ci: { failOn: 'invalid', reportFormat: 'text' } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ci.failOn');
      expect(result.errors![0].suggestion).toContain('error');
    });

    it('should reject invalid reportFormat value', () => {
      const result = validateConfig({ ci: { failOn: 'error', reportFormat: 'invalid' } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('ci.reportFormat');
      expect(result.errors![0].suggestion).toContain('github');
    });
  });

  describe('learning config validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-object learning config', () => {
      const result = validateConfig({ learning: 'invalid' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning');
    });

    it('should reject non-number autoApproveThreshold', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 'high', minOccurrences: 3 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.autoApproveThreshold');
      expect(result.errors![0].message).toContain('must be a number');
    });

    it('should reject autoApproveThreshold below 0', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: -0.1, minOccurrences: 3 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.autoApproveThreshold');
      expect(result.errors![0].message).toContain('between 0 and 1');
    });

    it('should reject autoApproveThreshold above 1', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 1.5, minOccurrences: 3 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.autoApproveThreshold');
      expect(result.errors![0].actual).toBe(1.5);
    });

    it('should reject non-number minOccurrences', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 0.9, minOccurrences: 'three' } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.minOccurrences');
    });

    it('should reject minOccurrences below 1', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 0.9, minOccurrences: 0 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.minOccurrences');
      expect(result.errors![0].message).toContain('>= 1');
    });

    it('should reject non-integer minOccurrences', () => {
      const result = validateConfig({ learning: { autoApproveThreshold: 0.9, minOccurrences: 2.5 } });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('learning.minOccurrences');
    });
  });

  describe('performance config validation', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should reject non-object performance config', () => {
      const result = validateConfig({ performance: 'fast' });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('performance');
    });

    it('should reject non-number maxWorkers', () => {
      const result = validateConfig({
        performance: { maxWorkers: 'four', cacheEnabled: true, incrementalAnalysis: true },
      });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('performance.maxWorkers');
    });

    it('should reject maxWorkers below 1', () => {
      const result = validateConfig({
        performance: { maxWorkers: 0, cacheEnabled: true, incrementalAnalysis: true },
      });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('performance.maxWorkers');
      expect(result.errors![0].message).toContain('>= 1');
    });

    it('should reject negative maxWorkers', () => {
      const result = validateConfig({
        performance: { maxWorkers: -1, cacheEnabled: true, incrementalAnalysis: true },
      });

      expect(result.valid).toBe(false);
    });

    it('should reject non-integer maxWorkers', () => {
      const result = validateConfig({
        performance: { maxWorkers: 4.5, cacheEnabled: true, incrementalAnalysis: true },
      });

      expect(result.valid).toBe(false);
    });

    it('should reject non-boolean cacheEnabled', () => {
      const result = validateConfig({
        performance: { maxWorkers: 4, cacheEnabled: 'yes', incrementalAnalysis: true },
      });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('performance.cacheEnabled');
      expect(result.errors![0].message).toContain('must be a boolean');
    });

    it('should reject non-boolean incrementalAnalysis', () => {
      const result = validateConfig({
        performance: { maxWorkers: 4, cacheEnabled: true, incrementalAnalysis: 1 },
      });

      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('performance.incrementalAnalysis');
    });
  });

  describe('unknown keys', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should report unknown top-level keys', () => {
      const result = validateConfig({
        unknownKey: 'value',
        anotherUnknown: 123,
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBe(2);
      expect(result.errors![0].message).toContain('Unknown configuration option');
      expect(result.errors![0].suggestion).toContain('Remove');
    });

    it('should report unknown keys alongside other errors', () => {
      const result = validateConfig({
        unknownKey: 'value',
        severity: 'invalid',
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBe(2);
    });
  });

  describe('multiple errors', () => {
    /**
     * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
     */
    it('should collect all errors from multiple sections', () => {
      const result = validateConfig({
        severity: { 'p1': 'invalid' },
        ignore: [123],
        ai: { provider: 'bad' },
        ci: { failOn: 'bad', reportFormat: 'bad' },
        learning: { autoApproveThreshold: 2, minOccurrences: 0 },
        performance: { maxWorkers: 0, cacheEnabled: 'yes', incrementalAnalysis: 'no' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(5);
    });
  });
});

// ============================================================================
// assertValidConfig Tests
// ============================================================================

describe('assertValidConfig', () => {
  /**
   * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
   */
  it('should return valid config without throwing', () => {
    const config = createValidConfig();
    const result = assertValidConfig(config);

    expect(result).toEqual(config);
  });

  it('should throw ConfigValidationException for invalid config', () => {
    expect(() => assertValidConfig({ severity: 'invalid' })).toThrow(ConfigValidationException);
  });

  it('should include errors in thrown exception', () => {
    try {
      assertValidConfig({ severity: 'invalid' });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationException);
      const exception = error as ConfigValidationException;
      expect(exception.errors.length).toBeGreaterThan(0);
      expect(exception.errors[0].path).toBe('severity');
    }
  });

  it('should provide formatted errors in exception', () => {
    try {
      assertValidConfig({ ai: { provider: 'invalid' } });
      expect.fail('Should have thrown');
    } catch (error) {
      const exception = error as ConfigValidationException;
      const formatted = exception.formatErrors();
      expect(formatted).toContain('ai.provider');
      expect(formatted).toContain('Expected');
    }
  });

  it('should provide error summary in exception', () => {
    try {
      assertValidConfig({
        severity: 'bad',
        ignore: 123,
      });
      expect.fail('Should have thrown');
    } catch (error) {
      const exception = error as ConfigValidationException;
      const summary = exception.getSummary();
      expect(summary).toContain('error');
      expect(summary).toContain('severity');
    }
  });
});

// ============================================================================
// validatePartialConfig Tests
// ============================================================================

describe('validatePartialConfig', () => {
  /**
   * @requirements 36.7 - Configuration SHALL support JSON schema validation
   */
  it('should accept partial config with only some fields', () => {
    const result = validatePartialConfig({
      ignore: ['node_modules'],
    });

    expect(result.valid).toBe(true);
  });

  it('should still validate provided fields', () => {
    const result = validatePartialConfig({
      ignore: [123], // Invalid
    });

    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// formatConfigErrors Tests
// ============================================================================

describe('formatConfigErrors', () => {
  /**
   * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
   */
  it('should return "No errors" for empty array', () => {
    const result = formatConfigErrors([]);
    expect(result).toBe('No errors');
  });

  it('should format single error with all fields', () => {
    const errors: ConfigValidationError[] = [
      {
        path: 'ai.provider',
        message: 'Invalid provider',
        expected: 'openai | anthropic | ollama',
        actual: 'invalid',
        suggestion: 'Use openai',
      },
    ];

    const result = formatConfigErrors(errors);

    expect(result).toContain('ai.provider');
    expect(result).toContain('Invalid provider');
    expect(result).toContain('Expected');
    expect(result).toContain('Got');
    expect(result).toContain('💡');
  });

  it('should format multiple errors with numbering', () => {
    const errors: ConfigValidationError[] = [
      { path: 'error1', message: 'First error' },
      { path: 'error2', message: 'Second error' },
    ];

    const result = formatConfigErrors(errors);

    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('2 error(s)');
  });

  it('should handle errors without optional fields', () => {
    const errors: ConfigValidationError[] = [
      { path: 'test', message: 'Simple error' },
    ];

    const result = formatConfigErrors(errors);

    expect(result).toContain('test');
    expect(result).toContain('Simple error');
    expect(result).not.toContain('Expected');
    expect(result).not.toContain('Got');
  });
});

// ============================================================================
// getErrorSummary Tests
// ============================================================================

describe('getErrorSummary', () => {
  it('should return valid message for empty errors', () => {
    const result = getErrorSummary([]);
    expect(result).toBe('Configuration is valid');
  });

  it('should summarize single error', () => {
    const errors: ConfigValidationError[] = [
      { path: 'ai.provider', message: 'Invalid' },
    ];

    const result = getErrorSummary(errors);

    expect(result).toContain('1 error');
    expect(result).toContain('ai.provider');
  });

  it('should summarize multiple errors with unique paths', () => {
    const errors: ConfigValidationError[] = [
      { path: 'ai.provider', message: 'Error 1' },
      { path: 'ci.failOn', message: 'Error 2' },
      { path: 'ai.provider', message: 'Error 3' }, // Duplicate path
    ];

    const result = getErrorSummary(errors);

    expect(result).toContain('3 error');
    expect(result).toContain('ai.provider');
    expect(result).toContain('ci.failOn');
  });
});

// ============================================================================
// DRIFT_CONFIG_SCHEMA Tests
// ============================================================================

describe('DRIFT_CONFIG_SCHEMA', () => {
  /**
   * @requirements 36.7 - Configuration SHALL support JSON schema validation
   */
  it('should have valid JSON schema structure', () => {
    expect(DRIFT_CONFIG_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(DRIFT_CONFIG_SCHEMA.type).toBe('object');
    expect(DRIFT_CONFIG_SCHEMA.title).toBe('DriftConfig');
  });

  it('should define all config properties', () => {
    const properties = Object.keys(DRIFT_CONFIG_SCHEMA.properties);

    expect(properties).toContain('severity');
    expect(properties).toContain('ignore');
    expect(properties).toContain('ai');
    expect(properties).toContain('ci');
    expect(properties).toContain('learning');
    expect(properties).toContain('performance');
  });

  it('should not allow additional properties', () => {
    expect(DRIFT_CONFIG_SCHEMA.additionalProperties).toBe(false);
  });

  it('should define AI provider enum', () => {
    const aiSchema = DRIFT_CONFIG_SCHEMA.properties.ai;
    expect(aiSchema.properties.provider.enum).toEqual(['openai', 'anthropic', 'ollama']);
  });

  it('should define CI failOn enum', () => {
    const ciSchema = DRIFT_CONFIG_SCHEMA.properties.ci;
    expect(ciSchema.properties.failOn.enum).toEqual(['error', 'warning', 'none']);
  });

  it('should define learning threshold constraints', () => {
    const learningSchema = DRIFT_CONFIG_SCHEMA.properties.learning;
    expect(learningSchema.properties.autoApproveThreshold.minimum).toBe(0);
    expect(learningSchema.properties.autoApproveThreshold.maximum).toBe(1);
    expect(learningSchema.properties.minOccurrences.minimum).toBe(1);
  });

  it('should define performance maxWorkers constraint', () => {
    const perfSchema = DRIFT_CONFIG_SCHEMA.properties.performance;
    expect(perfSchema.properties.maxWorkers.minimum).toBe(1);
  });
});

// ============================================================================
// ConfigValidationException Tests
// ============================================================================

describe('ConfigValidationException', () => {
  it('should have correct name', () => {
    const exception = new ConfigValidationException('Test', []);
    expect(exception.name).toBe('ConfigValidationException');
  });

  it('should store errors', () => {
    const errors: ConfigValidationError[] = [
      { path: 'test', message: 'Error' },
    ];
    const exception = new ConfigValidationException('Test', errors);

    expect(exception.errors).toEqual(errors);
  });

  it('should format errors correctly', () => {
    const errors: ConfigValidationError[] = [
      {
        path: 'ai.provider',
        message: 'Invalid',
        expected: 'openai',
        actual: 'bad',
        suggestion: 'Use openai',
      },
    ];
    const exception = new ConfigValidationException('Test', errors);
    const formatted = exception.formatErrors();

    expect(formatted).toContain('ai.provider');
    expect(formatted).toContain('Invalid');
    expect(formatted).toContain('Expected');
    expect(formatted).toContain('Suggestion');
  });

  it('should provide summary', () => {
    const errors: ConfigValidationError[] = [
      { path: 'a', message: 'Error 1' },
      { path: 'b', message: 'Error 2' },
    ];
    const exception = new ConfigValidationException('Test', errors);
    const summary = exception.getSummary();

    expect(summary).toContain('2');
    expect(summary).toContain('a');
    expect(summary).toContain('b');
  });
});

// ============================================================================
// Edge Cases and Error Message Quality Tests
// ============================================================================

describe('error message quality', () => {
  /**
   * @requirements 36.6 - Configuration validation SHALL reject invalid values with helpful error messages
   */
  it('should provide actionable suggestions for common mistakes', () => {
    // Typo in provider name
    const result = validateConfig({ ai: { provider: 'opanai' } });

    expect(result.valid).toBe(false);
    expect(result.errors![0].suggestion).toContain('openai');
  });

  it('should explain threshold range clearly', () => {
    const result = validateConfig({ learning: { autoApproveThreshold: 95, minOccurrences: 3 } });

    expect(result.valid).toBe(false);
    expect(result.errors![0].message).toContain('between 0 and 1');
    expect(result.errors![0].suggestion).toContain('0.95');
  });

  it('should explain boolean expectations clearly', () => {
    const result = validateConfig({
      performance: { maxWorkers: 4, cacheEnabled: 'true', incrementalAnalysis: true },
    });

    expect(result.valid).toBe(false);
    expect(result.errors![0].expected).toContain('true | false');
    expect(result.errors![0].suggestion).toContain('true');
  });

  it('should explain array expectations clearly', () => {
    const result = validateConfig({ ignore: 'node_modules' });

    expect(result.valid).toBe(false);
    expect(result.errors![0].suggestion).toContain('["node_modules"');
  });
});
