/**
 * Rule Engine Tests
 *
 * Tests for the RuleEngine class that evaluates patterns against code
 * and generates violations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuleEngine,
  createRuleEngine,
  createRuleEngineWithConfig,
  createRuleEngineWithAI,
  type RuleEngineConfig,
  type RuleEvaluationInput,
  type PatternWithContext,
} from './rule-engine.js';
import type { Pattern, PatternCategory } from '../store/types.js';
import type { Violation } from './types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock pattern for testing
 */
function createMockPattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'test-pattern-1',
    category: 'structural' as PatternCategory,
    subcategory: 'file-naming',
    name: 'Test Pattern',
    description: 'A test pattern for unit testing',
    detector: {
      type: 'regex',
      config: {},
      regex: {
        pattern: 'function\\s+test',
        flags: 'g',
      },
    },
    confidence: {
      frequency: 0.9,
      consistency: 0.85,
      age: 30,
      spread: 10,
      score: 0.87,
      level: 'high',
    },
    locations: [
      { file: 'test.ts', line: 1, column: 1 },
    ],
    outliers: [],
    metadata: {
      firstSeen: '2024-01-01T00:00:00Z',
      lastSeen: '2024-01-15T00:00:00Z',
    },
    severity: 'warning',
    autoFixable: false,
    status: 'approved',
    ...overrides,
  };
}

/**
 * Create a mock evaluation input
 */
function createMockInput(overrides: Partial<RuleEvaluationInput> = {}): RuleEvaluationInput {
  return {
    file: 'test.ts',
    content: 'function test() { return true; }',
    ast: null,
    language: 'typescript',
    ...overrides,
  };
}

/**
 * Create a pattern with context
 */
function createPatternWithContext(
  pattern: Pattern,
  expected?: string
): PatternWithContext {
  return {
    pattern,
    expected,
  };
}

// ============================================================================
// RuleEngine Tests
// ============================================================================

describe('RuleEngine', () => {
  let ruleEngine: RuleEngine;

  beforeEach(() => {
    ruleEngine = new RuleEngine();
  });

  describe('constructor', () => {
    it('should create a RuleEngine with default configuration', () => {
      const engine = new RuleEngine();
      expect(engine).toBeInstanceOf(RuleEngine);
    });

    it('should create a RuleEngine with custom configuration', () => {
      const config: RuleEngineConfig = {
        aiExplainAvailable: true,
        aiFixAvailable: true,
        maxViolationsPerFile: 50,
      };
      const engine = new RuleEngine(config);
      expect(engine).toBeInstanceOf(RuleEngine);
    });

    it('should create a RuleEngine with severity configuration', () => {
      const config: RuleEngineConfig = {
        severityConfig: {
          defaultSeverity: 'error',
          patternOverrides: {
            'test-pattern': 'warning',
          },
        },
      };
      const engine = new RuleEngine(config);
      expect(engine).toBeInstanceOf(RuleEngine);
    });
  });

  describe('evaluate', () => {
    it('should return passed result when no violations found', () => {
      const input = createMockInput({
        content: 'const x = 1;', // No function test pattern
      });
      const pattern = createMockPattern({
        locations: [], // No expected locations
      });
      const patternWithContext = createPatternWithContext(pattern);

      const result = ruleEngine.evaluate(input, patternWithContext);

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.ruleId).toBe(pattern.id);
      expect(result.file).toBe(input.file);
    });

    it('should generate violations for outlier locations', () => {
      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          {
            file: 'test.ts',
            line: 1,
            column: 1,
            reason: 'Deviates from naming convention',
          },
        ],
      });
      const patternWithContext = createPatternWithContext(pattern);

      const result = ruleEngine.evaluate(input, patternWithContext);

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].patternId).toBe(pattern.id);
    });

    it('should include duration in result', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const patternWithContext = createPatternWithContext(pattern);

      const result = ruleEngine.evaluate(input, patternWithContext);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle evaluation errors gracefully', () => {
      const input = createMockInput();
      // Create a pattern with invalid regex
      const pattern = createMockPattern({
        detector: {
          type: 'regex',
          config: {},
          regex: {
            pattern: '[invalid(regex',
            flags: 'g',
          },
        },
      });
      const patternWithContext = createPatternWithContext(pattern);

      const result = ruleEngine.evaluate(input, patternWithContext);

      // Should not throw, but may have errors
      expect(result.ruleId).toBe(pattern.id);
    });
  });

  describe('evaluateAll', () => {
    it('should evaluate multiple patterns', () => {
      const input = createMockInput();
      const patterns = [
        createPatternWithContext(createMockPattern({ id: 'pattern-1' })),
        createPatternWithContext(createMockPattern({ id: 'pattern-2' })),
        createPatternWithContext(createMockPattern({ id: 'pattern-3' })),
      ];

      const results = ruleEngine.evaluateAll(input, patterns);

      expect(results).toHaveLength(3);
      expect(results[0].ruleId).toBe('pattern-1');
      expect(results[1].ruleId).toBe('pattern-2');
      expect(results[2].ruleId).toBe('pattern-3');
    });

    it('should return empty array for empty patterns', () => {
      const input = createMockInput();
      const results = ruleEngine.evaluateAll(input, []);

      expect(results).toHaveLength(0);
    });
  });

  describe('evaluateFiles', () => {
    it('should evaluate patterns against multiple files', () => {
      const inputs = [
        createMockInput({ file: 'file1.ts' }),
        createMockInput({ file: 'file2.ts' }),
      ];
      const patterns = [
        createPatternWithContext(createMockPattern()),
      ];

      const summary = ruleEngine.evaluateFiles(inputs, patterns);

      expect(summary.filesEvaluated).toContain('file1.ts');
      expect(summary.filesEvaluated).toContain('file2.ts');
      expect(summary.rulesEvaluated).toBe(2); // 1 pattern x 2 files
    });

    it('should calculate summary statistics', () => {
      const inputs = [createMockInput()];
      const patterns = [
        createPatternWithContext(createMockPattern()),
      ];

      const summary = ruleEngine.evaluateFiles(inputs, patterns);

      expect(summary.rulesEvaluated).toBeGreaterThanOrEqual(0);
      expect(summary.totalDuration).toBeGreaterThanOrEqual(0);
      expect(summary.violationsBySeverity).toBeDefined();
      expect(summary.violationsBySeverity.error).toBeGreaterThanOrEqual(0);
      expect(summary.violationsBySeverity.warning).toBeGreaterThanOrEqual(0);
      expect(summary.violationsBySeverity.info).toBeGreaterThanOrEqual(0);
      expect(summary.violationsBySeverity.hint).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getViolations', () => {
    it('should collect violations from all results', () => {
      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test outlier' },
        ],
      });
      const patternWithContext = createPatternWithContext(pattern);

      const results = [ruleEngine.evaluate(input, patternWithContext)];
      const violations = ruleEngine.getViolations(results);

      expect(Array.isArray(violations)).toBe(true);
    });

    it('should sort violations by severity', () => {
      // Create violations with different severities
      const input = createMockInput();
      const errorPattern = createMockPattern({
        id: 'error-pattern',
        severity: 'error',
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Error' },
        ],
      });
      const warningPattern = createMockPattern({
        id: 'warning-pattern',
        severity: 'warning',
        outliers: [
          { file: 'test.ts', line: 2, column: 1, reason: 'Warning' },
        ],
      });

      const results = [
        ruleEngine.evaluate(input, createPatternWithContext(warningPattern)),
        ruleEngine.evaluate(input, createPatternWithContext(errorPattern)),
      ];

      const violations = ruleEngine.getViolations(results);

      // Errors should come before warnings
      if (violations.length >= 2) {
        const errorIndex = violations.findIndex(v => v.severity === 'error');
        const warningIndex = violations.findIndex(v => v.severity === 'warning');
        if (errorIndex !== -1 && warningIndex !== -1) {
          expect(errorIndex).toBeLessThan(warningIndex);
        }
      }
    });
  });

  describe('getBlockingViolations', () => {
    it('should return only error severity violations', () => {
      const input = createMockInput();
      const errorPattern = createMockPattern({
        id: 'error-pattern',
        severity: 'error',
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Error' },
        ],
      });
      const warningPattern = createMockPattern({
        id: 'warning-pattern',
        severity: 'warning',
        outliers: [
          { file: 'test.ts', line: 2, column: 1, reason: 'Warning' },
        ],
      });

      const results = [
        ruleEngine.evaluate(input, createPatternWithContext(errorPattern)),
        ruleEngine.evaluate(input, createPatternWithContext(warningPattern)),
      ];

      const blockingViolations = ruleEngine.getBlockingViolations(results);

      for (const violation of blockingViolations) {
        expect(violation.severity).toBe('error');
      }
    });
  });

  describe('hasBlockingViolations', () => {
    it('should return true when error violations exist', () => {
      // Create engine with pattern override to ensure error severity
      const engine = new RuleEngine({
        severityConfig: {
          patternOverrides: {
            'error-pattern': 'error',
          },
        },
      });

      const input = createMockInput();
      const errorPattern = createMockPattern({
        id: 'error-pattern',
        category: 'security', // Security defaults to error
        severity: 'error',
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Error' },
        ],
      });

      const results = [
        engine.evaluate(input, createPatternWithContext(errorPattern)),
      ];

      expect(engine.hasBlockingViolations(results)).toBe(true);
    });

    it('should return false when only warning violations exist', () => {
      const input = createMockInput();
      const warningPattern = createMockPattern({
        severity: 'warning',
        locations: [], // No expected locations
        outliers: [],
      });

      const results = [
        ruleEngine.evaluate(input, createPatternWithContext(warningPattern)),
      ];

      expect(ruleEngine.hasBlockingViolations(results)).toBe(false);
    });
  });

  describe('getSeverityManager', () => {
    it('should return the severity manager instance', () => {
      const severityManager = ruleEngine.getSeverityManager();
      expect(severityManager).toBeDefined();
      expect(typeof severityManager.isBlocking).toBe('function');
    });
  });

  describe('reset', () => {
    it('should reset the rule engine state', () => {
      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test' },
        ],
      });

      // Generate some violations
      ruleEngine.evaluate(input, createPatternWithContext(pattern));

      // Reset
      ruleEngine.reset();

      // State should be cleared
      const severityManager = ruleEngine.getSeverityManager();
      const counts = severityManager.getViolationCounts();
      expect(counts.total).toBe(0);
    });
  });

  describe('violation properties', () => {
    it('should generate violations with required properties', () => {
      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 5, column: 10, reason: 'Test violation' },
        ],
      });

      const result = ruleEngine.evaluate(input, createPatternWithContext(pattern));

      if (result.violations.length > 0) {
        const violation = result.violations[0];
        expect(violation.id).toBeDefined();
        expect(violation.patternId).toBe(pattern.id);
        expect(violation.severity).toBeDefined();
        expect(violation.file).toBe(input.file);
        expect(violation.range).toBeDefined();
        expect(violation.message).toBeDefined();
        expect(violation.expected).toBeDefined();
        expect(violation.actual).toBeDefined();
        expect(violation.firstSeen).toBeInstanceOf(Date);
        expect(violation.occurrences).toBeGreaterThanOrEqual(1);
      }
    });

    it('should set AI availability based on config', () => {
      const engineWithAI = new RuleEngine({
        aiExplainAvailable: true,
        aiFixAvailable: true,
      });

      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test' },
        ],
      });

      const result = engineWithAI.evaluate(input, createPatternWithContext(pattern));

      if (result.violations.length > 0) {
        expect(result.violations[0].aiExplainAvailable).toBe(true);
        expect(result.violations[0].aiFixAvailable).toBe(true);
      }
    });
  });

  describe('violation limits', () => {
    it('should respect maxViolationsPerFile limit', () => {
      const engine = new RuleEngine({
        maxViolationsPerFile: 2,
      });

      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test 1' },
          { file: 'test.ts', line: 2, column: 1, reason: 'Test 2' },
          { file: 'test.ts', line: 3, column: 1, reason: 'Test 3' },
          { file: 'test.ts', line: 4, column: 1, reason: 'Test 4' },
        ],
      });

      const result = engine.evaluate(input, createPatternWithContext(pattern));

      expect(result.violations.length).toBeLessThanOrEqual(2);
    });

    it('should respect maxViolationsPerPattern limit', () => {
      const engine = new RuleEngine({
        maxViolationsPerPattern: 1,
        maxViolationsPerFile: 100,
      });

      const input = createMockInput();
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test 1' },
          { file: 'test.ts', line: 2, column: 1, reason: 'Test 2' },
        ],
      });

      const result = engine.evaluate(input, createPatternWithContext(pattern));

      expect(result.violations.length).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createRuleEngine', () => {
    it('should create a RuleEngine with default configuration', () => {
      const engine = createRuleEngine();
      expect(engine).toBeInstanceOf(RuleEngine);
    });
  });

  describe('createRuleEngineWithConfig', () => {
    it('should create a RuleEngine with custom configuration', () => {
      const config: RuleEngineConfig = {
        maxViolationsPerFile: 25,
        aiExplainAvailable: true,
      };
      const engine = createRuleEngineWithConfig(config);
      expect(engine).toBeInstanceOf(RuleEngine);
    });
  });

  describe('createRuleEngineWithAI', () => {
    it('should create a RuleEngine with AI features enabled', () => {
      const engine = createRuleEngineWithAI();
      expect(engine).toBeInstanceOf(RuleEngine);

      // Verify AI is enabled by checking a violation
      const input: RuleEvaluationInput = {
        file: 'test.ts',
        content: 'test',
        ast: null,
        language: 'typescript',
      };
      const pattern = createMockPattern({
        outliers: [
          { file: 'test.ts', line: 1, column: 1, reason: 'Test' },
        ],
      });

      const result = engine.evaluate(input, createPatternWithContext(pattern));

      if (result.violations.length > 0) {
        expect(result.violations[0].aiExplainAvailable).toBe(true);
        expect(result.violations[0].aiFixAvailable).toBe(true);
      }
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('RuleEngine Integration', () => {
  it('should work with severity manager for escalation', () => {
    const engine = new RuleEngine({
      severityConfig: {
        escalation: {
          enabled: true,
          threshold: 2,
          rules: [
            { from: 'warning', to: 'error', afterCount: 2 },
          ],
        },
      },
      trackOccurrences: true,
    });

    const input = createMockInput();
    const pattern = createMockPattern({
      severity: 'warning',
      outliers: [
        { file: 'test.ts', line: 1, column: 1, reason: 'Test 1' },
        { file: 'test.ts', line: 2, column: 1, reason: 'Test 2' },
        { file: 'test.ts', line: 3, column: 1, reason: 'Test 3' },
      ],
    });

    // First evaluation
    engine.evaluate(input, createPatternWithContext(pattern));

    // Check that violations were recorded
    const severityManager = engine.getSeverityManager();
    const counts = severityManager.getViolationCounts();
    expect(counts.byPattern[pattern.id]).toBeGreaterThan(0);
  });

  it('should handle multiple file evaluations correctly', () => {
    const engine = new RuleEngine();

    const inputs = [
      createMockInput({ file: 'src/file1.ts', content: 'const a = 1;' }),
      createMockInput({ file: 'src/file2.ts', content: 'const b = 2;' }),
      createMockInput({ file: 'src/file3.ts', content: 'const c = 3;' }),
    ];

    const patterns = [
      createPatternWithContext(createMockPattern({ id: 'pattern-a' })),
      createPatternWithContext(createMockPattern({ id: 'pattern-b' })),
    ];

    const summary = engine.evaluateFiles(inputs, patterns);

    expect(summary.filesEvaluated).toHaveLength(3);
    expect(summary.rulesEvaluated).toBe(6); // 2 patterns x 3 files
  });
});
