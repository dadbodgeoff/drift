/**
 * Property-Based Tests for ConfigValidator - Configuration Validation
 *
 * Property 15: Configuration Validation
 * For any invalid configuration file, the Config_System SHALL reject it
 * with a descriptive error message rather than using partial/corrupted config.
 * **Validates: Requirements 36.6, 36.7**
 *
 * @requirements 36.6 - THE Config_System SHALL validate config against JSON schema
 * @requirements 36.7 - WHEN config is invalid, THE Config_System SHALL provide helpful error messages
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateConfig,
  assertValidConfig,
  ConfigValidationException,
} from './config-validator.js';
import type { DriftConfig, AIConfig, CIConfig, LearningConfig, PerformanceConfig } from './types.js';
import type { Severity } from '../store/types.js';

// Valid config arbitraries
const validAIProviderArb: fc.Arbitrary<'openai' | 'anthropic' | 'ollama'> = fc.constantFrom(
  'openai' as const,
  'anthropic' as const,
  'ollama' as const
);

const validCIFailOnArb: fc.Arbitrary<'error' | 'warning' | 'none'> = fc.constantFrom(
  'error' as const,
  'warning' as const,
  'none' as const
);

const validReportFormatArb: fc.Arbitrary<'json' | 'text' | 'github' | 'gitlab'> = fc.constantFrom(
  'json' as const,
  'text' as const,
  'github' as const,
  'gitlab' as const
);

const validSeverityArb: fc.Arbitrary<Severity> = fc.constantFrom(
  'error' as const,
  'warning' as const,
  'info' as const,
  'hint' as const
);

const validPatternIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
const validIgnorePatternArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const validThresholdArb = fc.double({ min: 0, max: 1, noNaN: true });
const validPositiveIntArb = fc.integer({ min: 1, max: 1000 });

const validSeverityOverridesArb: fc.Arbitrary<Record<string, Severity>> = fc.dictionary(
  validPatternIdArb,
  validSeverityArb
);

const validIgnoreArb = fc.array(validIgnorePatternArb, { minLength: 0, maxLength: 10 });

const validAIConfigArb: fc.Arbitrary<AIConfig> = fc.record({
  provider: validAIProviderArb,
  model: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const validCIConfigArb: fc.Arbitrary<CIConfig> = fc.record({
  failOn: validCIFailOnArb,
  reportFormat: validReportFormatArb,
});

const validLearningConfigArb: fc.Arbitrary<LearningConfig> = fc.record({
  autoApproveThreshold: validThresholdArb,
  minOccurrences: validPositiveIntArb,
});

const validPerformanceConfigArb: fc.Arbitrary<PerformanceConfig> = fc.record({
  maxWorkers: validPositiveIntArb,
  cacheEnabled: fc.boolean(),
  incrementalAnalysis: fc.boolean(),
});

const validDriftConfigArb: fc.Arbitrary<DriftConfig> = fc
  .record({
    severity: fc.option(validSeverityOverridesArb, { nil: undefined }),
    ignore: fc.option(validIgnoreArb, { nil: undefined }),
    ai: fc.option(validAIConfigArb, { nil: undefined }),
    ci: fc.option(validCIConfigArb, { nil: undefined }),
    learning: fc.option(validLearningConfigArb, { nil: undefined }),
    performance: fc.option(validPerformanceConfigArb, { nil: undefined }),
  })
  .map((config) => {
    const result: DriftConfig = {};
    if (config.severity !== undefined) result.severity = config.severity;
    if (config.ignore !== undefined) result.ignore = config.ignore;
    if (config.ai !== undefined) result.ai = config.ai;
    if (config.ci !== undefined) result.ci = config.ci;
    if (config.learning !== undefined) result.learning = config.learning;
    if (config.performance !== undefined) result.performance = config.performance;
    return result;
  });

// Invalid config arbitraries
const invalidAIProviderArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !['openai', 'anthropic', 'ollama'].includes(s));

const invalidCIFailOnArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !['error', 'warning', 'none'].includes(s));

const invalidReportFormatArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !['json', 'text', 'github', 'gitlab'].includes(s));

const invalidSeverityArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !['error', 'warning', 'info', 'hint'].includes(s));

const invalidThresholdArb = fc.oneof(
  fc.double({ min: -100, max: -0.001, noNaN: true }),
  fc.double({ min: 1.001, max: 100, noNaN: true })
);

const nonObjectArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.anything())
);

const nonStringArb = fc.oneof(fc.integer(), fc.boolean(), fc.object(), fc.array(fc.anything()));
const nonBooleanArb = fc.oneof(fc.string(), fc.integer(), fc.object());

describe('ConfigValidator Property Tests', () => {
  describe('Property 15: Configuration Validation', () => {
    it('should accept any valid DriftConfig', async () => {
      await fc.assert(
        fc.asyncProperty(validDriftConfigArb, async (config) => {
          const result = validateConfig(config);
          expect(result.valid).toBe(true);
          expect(result.errors).toBeUndefined();
          expect(result.data).toBeDefined();
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject non-object root values with descriptive error', async () => {
      await fc.assert(
        fc.asyncProperty(nonObjectArb, async (invalidRoot) => {
          const result = validateConfig(invalidRoot);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          expect(result.errors!.length).toBeGreaterThan(0);
          const error = result.errors![0];
          expect(error.message).toBeDefined();
          expect(error.message.length).toBeGreaterThan(0);
          expect(error.suggestion).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject invalid AI provider with helpful error message', async () => {
      await fc.assert(
        fc.asyncProperty(invalidAIProviderArb, async (invalidProvider) => {
          const config = { ai: { provider: invalidProvider } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'ai.provider');
          expect(error).toBeDefined();
          expect(error!.expected).toBeDefined();
          expect(error!.expected).toContain('openai');
          expect(error!.actual).toBe(invalidProvider);
          expect(error!.suggestion).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject invalid CI failOn with helpful error message', async () => {
      await fc.assert(
        fc.asyncProperty(invalidCIFailOnArb, async (invalidFailOn) => {
          const config = { ci: { failOn: invalidFailOn, reportFormat: 'text' } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'ci.failOn');
          expect(error).toBeDefined();
          expect(error!.expected).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject invalid report format with helpful error message', async () => {
      await fc.assert(
        fc.asyncProperty(invalidReportFormatArb, async (invalidFormat) => {
          const config = { ci: { failOn: 'error', reportFormat: invalidFormat } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'ci.reportFormat');
          expect(error).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject invalid severity level with helpful error message', async () => {
      await fc.assert(
        fc.asyncProperty(validPatternIdArb, invalidSeverityArb, async (patternId, invalidSeverity) => {
          const config = { severity: { [patternId]: invalidSeverity } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === `severity.${patternId}`);
          expect(error).toBeDefined();
          expect(error!.expected).toBeDefined();
          expect(error!.expected).toContain('error');
          expect(error!.expected).toContain('warning');
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject autoApproveThreshold outside [0,1] range', async () => {
      await fc.assert(
        fc.asyncProperty(invalidThresholdArb, async (invalidThreshold) => {
          const config = { learning: { autoApproveThreshold: invalidThreshold, minOccurrences: 3 } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'learning.autoApproveThreshold');
          expect(error).toBeDefined();
          expect(error!.message).toContain('between 0 and 1');
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject minOccurrences less than 1', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: -100, max: 0 }), async (invalidMinOccurrences) => {
          const config = { learning: { autoApproveThreshold: 0.9, minOccurrences: invalidMinOccurrences } };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'learning.minOccurrences');
          expect(error).toBeDefined();
          expect(error!.message).toContain('>= 1');
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject maxWorkers less than 1', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: -100, max: 0 }), async (invalidMaxWorkers) => {
          const config = {
            performance: { maxWorkers: invalidMaxWorkers, cacheEnabled: true, incrementalAnalysis: true },
          };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'performance.maxWorkers');
          expect(error).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject non-string items in ignore array', async () => {
      await fc.assert(
        fc.asyncProperty(nonStringArb, async (nonStringItem) => {
          const config = { ignore: ['valid-pattern', nonStringItem, 'another-valid'] };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'ignore[1]');
          expect(error).toBeDefined();
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject empty strings in ignore array', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validIgnorePatternArb, { minLength: 0, maxLength: 3 }),
          fc.integer({ min: 0, max: 3 }),
          async (validPatterns, insertIndex) => {
            const patterns = [...validPatterns];
            const actualIndex = Math.min(insertIndex, patterns.length);
            patterns.splice(actualIndex, 0, '');
            const config = { ignore: patterns };
            const result = validateConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            const error = result.errors!.find((e) => e.path === `ignore[${actualIndex}]`);
            expect(error).toBeDefined();
            expect(error!.message).toContain('cannot be empty');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject non-boolean cacheEnabled', async () => {
      await fc.assert(
        fc.asyncProperty(nonBooleanArb, async (nonBoolean) => {
          const config = {
            performance: { maxWorkers: 4, cacheEnabled: nonBoolean, incrementalAnalysis: true },
          };
          const result = validateConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors).toBeDefined();
          const error = result.errors!.find((e) => e.path === 'performance.cacheEnabled');
          expect(error).toBeDefined();
          expect(error!.message).toContain('must be a boolean');
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject unknown top-level configuration keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => !['severity', 'ignore', 'ai', 'ci', 'learning', 'performance'].includes(s)),
          fc.anything(),
          async (unknownKey, value) => {
            const config = { [unknownKey]: value };
            const result = validateConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            const error = result.errors!.find((e) => e.path === unknownKey);
            expect(error).toBeDefined();
            expect(error!.message).toContain('Unknown configuration option');
            expect(error!.suggestion).toBeDefined();
            expect(error!.suggestion).toContain('Remove');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should throw ConfigValidationException for any invalid config', async () => {
      await fc.assert(
        fc.asyncProperty(invalidAIProviderArb, async (invalidProvider) => {
          const config = { ai: { provider: invalidProvider } };
          expect(() => assertValidConfig(config)).toThrow(ConfigValidationException);
          try {
            assertValidConfig(config);
          } catch (error) {
            expect(error).toBeInstanceOf(ConfigValidationException);
            const exception = error as ConfigValidationException;
            expect(exception.errors.length).toBeGreaterThan(0);
            const formatted = exception.formatErrors();
            expect(formatted.length).toBeGreaterThan(0);
            const summary = exception.getSummary();
            expect(summary).toContain('error');
          }
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should collect and report all validation errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          invalidAIProviderArb,
          invalidCIFailOnArb,
          invalidThresholdArb,
          async (invalidProvider, invalidFailOn, invalidThreshold) => {
            const config = {
              ai: { provider: invalidProvider },
              ci: { failOn: invalidFailOn, reportFormat: 'text' },
              learning: { autoApproveThreshold: invalidThreshold, minOccurrences: 3 },
            };
            const result = validateConfig(config);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors!.length).toBeGreaterThanOrEqual(3);
            const paths = result.errors!.map((e) => e.path);
            expect(paths).toContain('ai.provider');
            expect(paths).toContain('ci.failOn');
            expect(paths).toContain('learning.autoApproveThreshold');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should provide helpful and actionable error messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant({ ai: { provider: 'invalid' } }),
            fc.constant({ ci: { failOn: 'invalid', reportFormat: 'text' } }),
            fc.constant({ learning: { autoApproveThreshold: 2, minOccurrences: 3 } }),
            fc.constant({ performance: { maxWorkers: 0, cacheEnabled: true, incrementalAnalysis: true } }),
            fc.constant({ ignore: ['valid', 123] }),
            fc.constant({ severity: { pattern: 'invalid' } })
          ),
          async (invalidConfig) => {
            const result = validateConfig(invalidConfig);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            for (const error of result.errors!) {
              expect(error.path).toBeDefined();
              expect(error.message).toBeDefined();
              expect(error.message.length).toBeGreaterThan(0);
              expect(error.message.length).toBeGreaterThan(5);
            }
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should preserve valid config data through validation', async () => {
      await fc.assert(
        fc.asyncProperty(validDriftConfigArb, async (config) => {
          const result = validateConfig(config);
          expect(result.valid).toBe(true);
          if (result.data) {
            if (config.severity !== undefined) {
              expect(result.data.severity).toEqual(config.severity);
            }
            if (config.ignore !== undefined) {
              expect(result.data.ignore).toEqual(config.ignore);
            }
            if (config.ai !== undefined) {
              expect(result.data.ai).toEqual(config.ai);
            }
            if (config.ci !== undefined) {
              expect(result.data.ci).toEqual(config.ci);
            }
            if (config.learning !== undefined) {
              expect(result.data.learning).toEqual(config.learning);
            }
            if (config.performance !== undefined) {
              expect(result.data.performance).toEqual(config.performance);
            }
          }
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
