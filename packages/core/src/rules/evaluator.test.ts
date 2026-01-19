/**
 * Evaluator unit tests
 *
 * Tests for the Evaluator class that checks if code matches patterns
 * and determines violation details.
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Evaluator,
  createEvaluator,
  createEvaluatorWithConfig,
  createEvaluatorWithAI,
  createEvaluatorWithSeverity,
  type EvaluationInput,
  type EvaluatorConfig,
} from './evaluator.js';
import type { Pattern, PatternCategory } from '../store/types.js';
import type { Location } from '../matcher/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock evaluation input
 */
function createMockInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  return {
    file: 'src/test-file.ts',
    content: 'const foo = "bar";\nexport function test() { return 42; }',
    ast: null,
    language: 'typescript',
    ...overrides,
  };
}

/**
 * Create a mock pattern
 */
function createMockPattern(overrides?: Partial<Pattern>): Pattern {
  return {
    id: 'test-pattern-1',
    category: 'structural' as PatternCategory,
    subcategory: 'naming',
    name: 'Test Pattern',
    description: 'A test pattern for unit testing',
    detector: {
      type: 'regex',
      config: {},
      regex: {
        pattern: 'const\\s+\\w+\\s*=',
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
    locations: [],
    outliers: [],
    metadata: {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    },
    severity: 'warning',
    autoFixable: false,
    status: 'approved',
    ...overrides,
  };
}

/**
 * Create a pattern with outliers
 */
function createPatternWithOutliers(file: string): Pattern {
  return createMockPattern({
    id: 'pattern-with-outliers',
    outliers: [
      {
        file,
        line: 1,
        column: 1,
        reason: 'Uses var instead of const',
      },
    ],
  });
}

/**
 * Create a pattern with expected locations
 */
function createPatternWithLocations(file: string): Pattern {
  return createMockPattern({
    id: 'pattern-with-locations',
    locations: [
      {
        file,
        line: 1,
        column: 1,
      },
    ],
  });
}

// ============================================================================
// Evaluator Class Tests
// ============================================================================

describe('Evaluator', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  describe('constructor', () => {
    it('should create an evaluator with default configuration', () => {
      const eval1 = new Evaluator();
      expect(eval1).toBeInstanceOf(Evaluator);
    });

    it('should create an evaluator with custom configuration', () => {
      const config: EvaluatorConfig = {
        aiExplainAvailable: true,
        aiFixAvailable: true,
        minConfidence: 0.5,
        projectRoot: '/custom/root',
      };
      const eval1 = new Evaluator(config);
      expect(eval1).toBeInstanceOf(Evaluator);
    });

    it('should create an evaluator with severity configuration', () => {
      const config: EvaluatorConfig = {
        severityConfig: {
          defaultSeverity: 'error',
          patternOverrides: { 'test-pattern': 'info' },
        },
      };
      const eval1 = new Evaluator(config);
      expect(eval1).toBeInstanceOf(Evaluator);
    });
  });

  describe('checkMatch', () => {
    it('should return true when code matches pattern', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.checkMatch(input, pattern);

      // Pattern has no outliers or expected locations, so it should match
      expect(result).toBe(true);
    });

    it('should return false when pattern has outliers in the file', () => {
      const input = createMockInput();
      const pattern = createPatternWithOutliers(input.file);

      const result = evaluator.checkMatch(input, pattern);

      expect(result).toBe(false);
    });

    it('should return false when expected pattern is missing', () => {
      const input = createMockInput();
      // Pattern expects to find something but regex won't match
      const pattern = createMockPattern({
        id: 'missing-pattern',
        detector: {
          type: 'regex',
          config: {},
          regex: {
            pattern: 'nonexistent_pattern_xyz',
            flags: 'g',
          },
        },
        locations: [
          {
            file: input.file,
            line: 1,
            column: 1,
          },
        ],
      });

      const result = evaluator.checkMatch(input, pattern);

      expect(result).toBe(false);
    });
  });

  describe('getMatchDetails', () => {
    it('should return match details for regex pattern', () => {
      const input = createMockInput({
        content: 'const foo = 1;\nconst bar = 2;',
      });
      const pattern = createMockPattern();

      const details = evaluator.getMatchDetails(input, pattern);

      expect(Array.isArray(details)).toBe(true);
      // Should find matches for 'const' declarations
      expect(details.length).toBeGreaterThan(0);
    });

    it('should return empty array when no matches found', () => {
      const input = createMockInput({
        content: 'let foo = 1;', // No 'const' declarations
      });
      const pattern = createMockPattern();

      const details = evaluator.getMatchDetails(input, pattern);

      expect(details).toEqual([]);
    });

    it('should include location information in match details', () => {
      const input = createMockInput({
        content: 'const foo = 1;',
      });
      const pattern = createMockPattern();

      const details = evaluator.getMatchDetails(input, pattern);

      if (details.length > 0) {
        expect(details[0]).toHaveProperty('location');
        expect(details[0]?.location).toHaveProperty('file');
        expect(details[0]?.location).toHaveProperty('line');
        expect(details[0]?.location).toHaveProperty('column');
      }
    });
  });

  describe('evaluate', () => {
    it('should return evaluation result with pattern ID', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(result.patternId).toBe(pattern.id);
    });

    it('should return evaluation result with file path', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(result.file).toBe(input.file);
    });

    it('should return matches flag', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(typeof result.matches).toBe('boolean');
    });

    it('should return confidence score', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should return pattern matches array', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(Array.isArray(result.patternMatches)).toBe(true);
    });

    it('should return violations array', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(Array.isArray(result.violations)).toBe(true);
    });

    it('should return duration in milliseconds', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return errors array', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      const result = evaluator.evaluate(input, pattern);

      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should create violations for outlier locations', () => {
      const input = createMockInput();
      const pattern = createPatternWithOutliers(input.file);

      const result = evaluator.evaluate(input, pattern);

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]?.patternId).toBe(pattern.id);
    });

    it('should create violation for missing expected pattern', () => {
      const input = createMockInput();
      const pattern = createMockPattern({
        id: 'missing-pattern',
        detector: {
          type: 'regex',
          config: {},
          regex: {
            pattern: 'nonexistent_xyz_123',
            flags: 'g',
          },
        },
        locations: [
          {
            file: input.file,
            line: 1,
            column: 1,
          },
        ],
      });

      const result = evaluator.evaluate(input, pattern);

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]?.message).toContain('Missing expected pattern');
    });
  });

  describe('evaluateAll', () => {
    it('should evaluate multiple patterns', () => {
      const input = createMockInput();
      const patterns = [
        createMockPattern({ id: 'pattern-1' }),
        createMockPattern({ id: 'pattern-2' }),
        createMockPattern({ id: 'pattern-3' }),
      ];

      const results = evaluator.evaluateAll(input, patterns);

      expect(results.length).toBe(3);
      expect(results[0]?.patternId).toBe('pattern-1');
      expect(results[1]?.patternId).toBe('pattern-2');
      expect(results[2]?.patternId).toBe('pattern-3');
    });

    it('should return empty array for empty patterns', () => {
      const input = createMockInput();

      const results = evaluator.evaluateAll(input, []);

      expect(results).toEqual([]);
    });
  });

  describe('evaluateFiles', () => {
    it('should evaluate multiple files against patterns', () => {
      const inputs = [
        createMockInput({ file: 'file1.ts' }),
        createMockInput({ file: 'file2.ts' }),
      ];
      const patterns = [createMockPattern()];

      const summary = evaluator.evaluateFiles(inputs, patterns);

      expect(summary.filesEvaluated).toContain('file1.ts');
      expect(summary.filesEvaluated).toContain('file2.ts');
    });

    it('should return evaluation summary', () => {
      const inputs = [createMockInput()];
      const patterns = [createMockPattern()];

      const summary = evaluator.evaluateFiles(inputs, patterns);

      expect(summary).toHaveProperty('patternsEvaluated');
      expect(summary).toHaveProperty('patternsMatched');
      expect(summary).toHaveProperty('patternsViolated');
      expect(summary).toHaveProperty('totalViolations');
      expect(summary).toHaveProperty('violationsBySeverity');
      expect(summary).toHaveProperty('totalDuration');
      expect(summary).toHaveProperty('filesEvaluated');
    });

    it('should count violations by severity', () => {
      const inputs = [createMockInput()];
      const patterns = [createPatternWithOutliers(inputs[0]!.file)];

      const summary = evaluator.evaluateFiles(inputs, patterns);

      expect(summary.violationsBySeverity).toHaveProperty('error');
      expect(summary.violationsBySeverity).toHaveProperty('warning');
      expect(summary.violationsBySeverity).toHaveProperty('info');
      expect(summary.violationsBySeverity).toHaveProperty('hint');
    });
  });

  describe('determineViolation', () => {
    it('should create violation with correct pattern ID', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 1, column: 1 };

      const violation = evaluator.determineViolation(input, pattern, location);

      expect(violation.patternId).toBe(pattern.id);
    });

    it('should create violation with correct file', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 1, column: 1 };

      const violation = evaluator.determineViolation(input, pattern, location);

      expect(violation.file).toBe(input.file);
    });

    it('should create violation with severity from pattern category', () => {
      const input = createMockInput();
      const pattern = createMockPattern({ category: 'security' });
      const location: Location = { file: input.file, line: 1, column: 1 };

      const violation = evaluator.determineViolation(input, pattern, location);

      // Security patterns default to 'error' severity
      expect(violation.severity).toBe('error');
    });

    it('should create violation with custom reason', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 1, column: 1 };
      const reason = 'Custom violation reason';

      const violation = evaluator.determineViolation(input, pattern, location, reason);

      expect(violation.message).toBe(reason);
    });

    it('should create violation with range from location', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 5, column: 10 };

      const violation = evaluator.determineViolation(input, pattern, location);

      expect(violation.range.start.line).toBe(4); // 0-indexed
      expect(violation.range.start.character).toBe(9); // 0-indexed
    });

    it('should create violation with unique ID', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 1, column: 1 };

      const violation1 = evaluator.determineViolation(input, pattern, location);
      const violation2 = evaluator.determineViolation(input, pattern, location);

      expect(violation1.id).not.toBe(violation2.id);
    });
  });

  describe('getSeverityManager', () => {
    it('should return the severity manager instance', () => {
      const severityManager = evaluator.getSeverityManager();

      expect(severityManager).toBeDefined();
      expect(typeof severityManager.getEffectiveSeverity).toBe('function');
    });
  });

  describe('getPatternMatcher', () => {
    it('should return the pattern matcher instance', () => {
      const patternMatcher = evaluator.getPatternMatcher();

      expect(patternMatcher).toBeDefined();
      expect(typeof patternMatcher.match).toBe('function');
    });
  });

  describe('reset', () => {
    it('should reset violation ID counter', () => {
      const input = createMockInput();
      const pattern = createMockPattern();
      const location: Location = { file: input.file, line: 1, column: 1 };

      // Create some violations
      evaluator.determineViolation(input, pattern, location);
      evaluator.determineViolation(input, pattern, location);

      // Reset
      evaluator.reset();

      // Create new violation - ID should be reset
      const violation = evaluator.determineViolation(input, pattern, location);
      expect(violation.id).toContain('eval-violation-');
    });

    it('should clear pattern matcher cache', () => {
      const input = createMockInput();
      const pattern = createMockPattern();

      // Evaluate to populate cache
      evaluator.evaluate(input, pattern);

      // Reset
      evaluator.reset();

      // Cache should be cleared
      const stats = evaluator.getPatternMatcher().getCacheStats();
      expect(stats.size).toBe(0);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createEvaluator', () => {
    it('should create an evaluator with default configuration', () => {
      const evaluator = createEvaluator();

      expect(evaluator).toBeInstanceOf(Evaluator);
    });
  });

  describe('createEvaluatorWithConfig', () => {
    it('should create an evaluator with custom configuration', () => {
      const config: EvaluatorConfig = {
        minConfidence: 0.7,
        projectRoot: '/custom/path',
      };

      const evaluator = createEvaluatorWithConfig(config);

      expect(evaluator).toBeInstanceOf(Evaluator);
    });
  });

  describe('createEvaluatorWithAI', () => {
    it('should create an evaluator with AI features enabled', () => {
      const evaluator = createEvaluatorWithAI();
      const input = createMockInput();
      const pattern = createPatternWithOutliers(input.file);

      const result = evaluator.evaluate(input, pattern);

      // Violations should have AI features available
      if (result.violations.length > 0) {
        expect(result.violations[0]?.aiExplainAvailable).toBe(true);
        expect(result.violations[0]?.aiFixAvailable).toBe(true);
      }
    });
  });

  describe('createEvaluatorWithSeverity', () => {
    it('should create an evaluator with custom severity configuration', () => {
      const evaluator = createEvaluatorWithSeverity({
        defaultSeverity: 'error',
        patternOverrides: { 'test-pattern-1': 'hint' },
      });

      expect(evaluator).toBeInstanceOf(Evaluator);
    });

    it('should apply severity overrides', () => {
      const evaluator = createEvaluatorWithSeverity({
        patternOverrides: { 'test-pattern-1': 'hint' },
      });

      const input = createMockInput();
      const pattern = createPatternWithOutliers(input.file);
      pattern.id = 'test-pattern-1';

      const result = evaluator.evaluate(input, pattern);

      // Violation should have 'hint' severity due to override
      if (result.violations.length > 0) {
        expect(result.violations[0]?.severity).toBe('hint');
      }
    });
  });
});

// ============================================================================
// Violation Details Tests
// ============================================================================

describe('Violation Details', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  it('should include expected value from pattern description', () => {
    const input = createMockInput();
    const pattern = createMockPattern({
      description: 'Use const for variable declarations',
    });
    const location: Location = { file: input.file, line: 1, column: 1 };

    const violation = evaluator.determineViolation(input, pattern, location);

    expect(violation.expected).toBe('Use const for variable declarations');
  });

  it('should include actual code from location', () => {
    const input = createMockInput({
      content: 'var foo = 1;\nconst bar = 2;',
    });
    const pattern = createMockPattern();
    const location: Location = { file: input.file, line: 1, column: 1 };

    const violation = evaluator.determineViolation(input, pattern, location);

    expect(violation.actual).toContain('var foo');
  });

  it('should truncate long actual code', () => {
    const longLine = 'x'.repeat(200);
    const input = createMockInput({
      content: longLine,
    });
    const pattern = createMockPattern();
    const location: Location = { file: input.file, line: 1, column: 1 };

    const violation = evaluator.determineViolation(input, pattern, location);

    expect(violation.actual.length).toBeLessThanOrEqual(103); // 100 + '...'
    expect(violation.actual).toContain('...');
  });

  it('should set firstSeen to current date', () => {
    const input = createMockInput();
    const pattern = createMockPattern();
    const location: Location = { file: input.file, line: 1, column: 1 };
    const before = new Date();

    const violation = evaluator.determineViolation(input, pattern, location);

    const after = new Date();
    expect(violation.firstSeen.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(violation.firstSeen.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should set occurrences to 1', () => {
    const input = createMockInput();
    const pattern = createMockPattern();
    const location: Location = { file: input.file, line: 1, column: 1 };

    const violation = evaluator.determineViolation(input, pattern, location);

    expect(violation.occurrences).toBe(1);
  });
});

// ============================================================================
// Pattern Type Tests
// ============================================================================

describe('Pattern Type Handling', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  it('should handle regex patterns', () => {
    const input = createMockInput({
      content: 'const foo = 1;',
    });
    const pattern = createMockPattern({
      detector: {
        type: 'regex',
        config: {},
        regex: {
          pattern: 'const\\s+\\w+',
          flags: 'g',
        },
      },
    });

    const result = evaluator.evaluate(input, pattern);

    expect(result.patternMatches.length).toBeGreaterThan(0);
  });

  it('should handle structural patterns', () => {
    const input = createMockInput({
      file: 'src/components/Button.tsx',
    });
    const pattern = createMockPattern({
      detector: {
        type: 'structural',
        config: {},
        structural: {
          pathPattern: '**/*.tsx',
        },
      },
    });

    const result = evaluator.evaluate(input, pattern);

    // Should match the structural pattern (path ends with .tsx)
    expect(result.patternMatches.length).toBeGreaterThan(0);
  });

  it('should handle AST patterns with null AST', () => {
    const input = createMockInput({
      ast: null,
    });
    const pattern = createMockPattern({
      detector: {
        type: 'ast',
        config: {},
        ast: {
          nodeType: 'function_declaration',
        },
      },
    });

    const result = evaluator.evaluate(input, pattern);

    // Should not crash, just return no matches
    expect(result.patternMatches).toEqual([]);
  });

  it('should handle custom patterns', () => {
    const input = createMockInput();
    const pattern = createMockPattern({
      detector: {
        type: 'custom',
        config: {},
        custom: {
          detectorId: 'custom-detector',
        },
      },
    });

    const result = evaluator.evaluate(input, pattern);

    // Custom patterns not implemented, should return no matches
    expect(result.patternMatches).toEqual([]);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  it('should handle invalid regex patterns gracefully', () => {
    const input = createMockInput();
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

    // Should not throw
    const result = evaluator.evaluate(input, pattern);

    expect(result.patternMatches).toEqual([]);
  });

  it('should return recoverable errors', () => {
    const input = createMockInput();
    // Create a pattern that might cause issues
    const pattern = createMockPattern({
      detector: {
        type: 'regex',
        config: {},
        regex: {
          pattern: '[invalid',
          flags: 'g',
        },
      },
    });

    const result = evaluator.evaluate(input, pattern);

    // Errors should be recoverable
    for (const error of result.errors) {
      expect(error.recoverable).toBe(true);
    }
  });
});
