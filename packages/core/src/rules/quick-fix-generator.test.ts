/**
 * Quick Fix Generator Tests
 *
 * Tests for the QuickFixGenerator class and fix strategies.
 *
 * @requirements 25.1 - THE Quick_Fix_System SHALL generate code transformations for fixable violations
 * @requirements 25.2 - THE Quick_Fix SHALL include a preview of the change before applying
 * @requirements 25.3 - THE Quick_Fix SHALL support fix types: replace, wrap, extract, import, rename, move, delete
 * @requirements 25.4 - WHEN multiple fixes are available, THE Quick_Fix_System SHALL rank by confidence
 * @requirements 25.5 - THE Quick_Fix_System SHALL mark the preferred fix for one-click application
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  QuickFixGenerator,
  createQuickFixGenerator,
  createQuickFixGeneratorWithConfig,
  createHighConfidenceQuickFixGenerator,
  createFullQuickFixGenerator,
  ReplaceFixStrategy,
  WrapFixStrategy,
  ExtractFixStrategy,
  ImportFixStrategy,
  RenameFixStrategy,
  MoveFixStrategy,
  DeleteFixStrategy,
  type FixContext,
} from './quick-fix-generator.js';
import type { Violation, Range } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestViolation(overrides: Partial<Violation> = {}): Violation {
  const defaultRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  };

  return {
    id: 'test-violation-1',
    patternId: 'test-pattern-1',
    severity: 'warning',
    file: 'test.ts',
    range: defaultRange,
    message: 'Test violation message',
    expected: 'expectedCode',
    actual: 'actualCode',
    aiExplainAvailable: false,
    aiFixAvailable: false,
    firstSeen: new Date(),
    occurrences: 1,
    ...overrides,
  };
}

function createTestContext(violation: Violation, content: string): FixContext {
  return {
    violation,
    content,
    expected: violation.expected,
    actual: violation.actual,
  };
}

// ============================================================================
// QuickFixGenerator Tests
// ============================================================================

describe('QuickFixGenerator', () => {
  let generator: QuickFixGenerator;

  beforeEach(() => {
    generator = createQuickFixGenerator();
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const gen = new QuickFixGenerator();
      expect(gen).toBeDefined();
      expect(gen.getStrategies()).toHaveLength(7);
    });

    it('should create with custom configuration', () => {
      const gen = new QuickFixGenerator({
        minConfidence: 0.8,
        maxFixesPerViolation: 3,
      });
      expect(gen).toBeDefined();
    });
  });

  describe('generateFixes', () => {
    it('should generate fixes for a violation with expected value', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = generator.generateFixes(violation, content);

      expect(result.violationId).toBe(violation.id);
      expect(result.hasFixs).toBe(true);
      expect(result.fixes.length).toBeGreaterThan(0);
    });

    it('should rank fixes by confidence (highest first)', () => {
      const violation = createTestViolation({
        message: 'Rename to follow camelCase convention',
        expected: 'myVariable',
        actual: 'my_variable',
      });
      const content = 'const my_variable = 1;';

      const result = generator.generateFixes(violation, content);

      if (result.fixes.length > 1) {
        for (let i = 1; i < result.fixes.length; i++) {
          const prevFix = result.fixes[i - 1];
          const currFix = result.fixes[i];
          if (prevFix && currFix) {
            expect(prevFix.confidence).toBeGreaterThanOrEqual(currFix.confidence);
          }
        }
      }
    });

    it('should mark the first fix as preferred', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = generator.generateFixes(violation, content);

      if (result.fixes.length > 0) {
        expect(result.fixes[0]?.isPreferred).toBe(true);
        for (let i = 1; i < result.fixes.length; i++) {
          expect(result.fixes[i]?.isPreferred).toBe(false);
        }
      }
    });

    it('should set preferredFix to the first fix', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = generator.generateFixes(violation, content);

      if (result.hasFixs) {
        expect(result.preferredFix).toBeDefined();
        expect(result.preferredFix).toBe(result.fixes[0]);
      }
    });

    it('should limit fixes to maxFixesPerViolation', () => {
      const gen = new QuickFixGenerator({ maxFixesPerViolation: 2 });
      const violation = createTestViolation({
        message: 'Multiple fix types applicable: rename, replace, extract',
        expected: 'newName',
        actual: 'oldName',
      });
      const content = 'const oldName = 1;';

      const result = gen.generateFixes(violation, content);

      expect(result.fixes.length).toBeLessThanOrEqual(2);
    });

    it('should filter fixes below minConfidence', () => {
      const gen = new QuickFixGenerator({ minConfidence: 0.95 });
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = gen.generateFixes(violation, content);

      for (const fix of result.fixes) {
        expect(fix.confidence).toBeGreaterThanOrEqual(0.95);
      }
    });
  });

  describe('generateFixesForAll', () => {
    it('should generate fixes for multiple violations', () => {
      const violations = [
        createTestViolation({ id: 'v1', expected: 'const a = 1;', actual: 'var a = 1;' }),
        createTestViolation({ id: 'v2', expected: 'const b = 2;', actual: 'var b = 2;' }),
      ];
      const content = 'var a = 1;\nvar b = 2;';

      const results = generator.generateFixesForAll(violations, content);

      expect(results).toHaveLength(2);
      expect(results[0]?.violationId).toBe('v1');
      expect(results[1]?.violationId).toBe('v2');
    });
  });

  describe('generateFixOfType', () => {
    it('should generate a specific type of fix', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('quickfix');
    });

    it('should return null for unsupported fix type', () => {
      const violation = createTestViolation({
        message: 'Some violation',
        expected: 'expected',
        actual: 'actual',
      });
      const content = 'some code';

      // Try to generate a fix type that doesn't match the violation
      const fix = generator.generateFixOfType(violation, content, 'delete');

      // Delete strategy won't handle this violation (no delete keywords)
      expect(fix).toBeNull();
    });
  });

  describe('generatePreview', () => {
    it('should generate a preview for a fix', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = generator.generateFixes(violation, content);
      if (result.preferredFix) {
        const preview = generator.generatePreview(result.preferredFix, content);
        expect(preview).toBeDefined();
        expect(typeof preview).toBe('string');
      }
    });

    it('should use existing preview if available', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const result = generator.generateFixes(violation, content);
      if (result.preferredFix && result.preferredFix.preview) {
        const preview = generator.generatePreview(result.preferredFix, content);
        expect(preview).toBe(result.preferredFix.preview);
      }
    });
  });

  describe('applyFix', () => {
    it('should apply a replace fix to content', () => {
      const violation = createTestViolation({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        expected: 'const',
        actual: 'var',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const result = generator.applyFix(fix, content);
        expect(result).toBe('const x = 1;');
      }
    });

    it('should apply a delete fix to content', () => {
      const violation = createTestViolation({
        message: 'Delete unused code',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        expected: '',
        actual: 'var x = 1;',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'delete');
      if (fix) {
        const result = generator.applyFix(fix, content);
        expect(result).toBe('');
      }
    });
  });

  describe('isIdempotent', () => {
    it('should return true when fix replaces text with same text', () => {
      // A fix that replaces "const" with "const" is idempotent
      const violation = createTestViolation({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        expected: 'const',
        actual: 'const',
      });
      const content = 'const x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const isIdempotent = generator.isIdempotent(fix, content);
        expect(isIdempotent).toBe(true);
      }
    });

    it('should return true when fix is now idempotent', () => {
      // A fix that replaces "var" with "const" is now idempotent
      // because the second application checks if the text already matches
      const violation = createTestViolation({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        expected: 'const',
        actual: 'var',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const isIdempotent = generator.isIdempotent(fix, content);
        // This IS now idempotent because applyFix checks if text already matches
        expect(isIdempotent).toBe(true);
      }
    });
  });

  describe('validateFix', () => {
    it('should validate a valid fix', () => {
      const violation = createTestViolation({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        expected: 'const',
        actual: 'var',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const validation = generator.validateFix(fix, content);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }
    });

    it('should detect invalid range', () => {
      const violation = createTestViolation({
        range: { start: { line: 100, character: 0 }, end: { line: 100, character: 10 } },
        expected: 'const',
        actual: 'var',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const validation = generator.validateFix(fix, content);
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getAvailableFixTypes', () => {
    it('should return available fix types for a violation', () => {
      const violation = createTestViolation({
        message: 'Rename to follow naming convention',
        expected: 'myVariable',
        actual: 'my_variable',
      });

      const types = generator.getAvailableFixTypes(violation);

      expect(types).toContain('replace');
      expect(types).toContain('rename');
    });

    it('should return delete for violations about unused code', () => {
      const violation = createTestViolation({
        message: 'Delete unused variable',
        expected: '',
        actual: 'const unused = 1;',
      });

      const types = generator.getAvailableFixTypes(violation);

      expect(types).toContain('delete');
    });
  });

  describe('registerStrategy', () => {
    it('should register a custom strategy', () => {
      const customStrategy: ReplaceFixStrategy = new ReplaceFixStrategy();
      generator.registerStrategy(customStrategy);

      const strategies = generator.getStrategies();
      expect(strategies.some(s => s.type === 'replace')).toBe(true);
    });

    it('should replace existing strategy of same type', () => {
      const initialCount = generator.getStrategies().length;
      const customStrategy = new ReplaceFixStrategy();
      generator.registerStrategy(customStrategy);

      expect(generator.getStrategies().length).toBe(initialCount);
    });
  });

  describe('calculateImpact', () => {
    it('should calculate impact for a fix', () => {
      const violation = createTestViolation({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        expected: 'const',
        actual: 'var',
      });
      const content = 'var x = 1;';

      const fix = generator.generateFixOfType(violation, content, 'replace');
      if (fix) {
        const impact = generator.calculateImpact(fix, content);

        expect(impact.filesAffected).toBe(1);
        expect(impact.linesChanged).toBeGreaterThanOrEqual(1);
        expect(['low', 'medium', 'high']).toContain(impact.riskLevel);
        expect(typeof impact.breakingChange).toBe('boolean');
      }
    });
  });
});

// ============================================================================
// Fix Strategy Tests
// ============================================================================

describe('ReplaceFixStrategy', () => {
  const strategy = new ReplaceFixStrategy();

  describe('canHandle', () => {
    it('should handle violations with expected value', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should not handle violations without expected value', () => {
      const violation = createTestViolation({
        expected: '',
        actual: 'var x = 1;',
      });

      expect(strategy.canHandle(violation)).toBe(false);
    });
  });

  describe('generate', () => {
    it('should generate a replace fix', () => {
      const violation = createTestViolation({
        expected: 'const x = 1;',
        actual: 'var x = 1;',
      });
      const context = createTestContext(violation, 'var x = 1;');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('quickfix');
      expect(fix?.isPreferred).toBe(true);
    });
  });
});

describe('WrapFixStrategy', () => {
  const strategy = new WrapFixStrategy();

  describe('canHandle', () => {
    it('should handle violations with wrap keywords', () => {
      const violation = createTestViolation({
        message: 'Wrap code with try-catch block',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations with error handling keywords', () => {
      const violation = createTestViolation({
        message: 'Add error handling with catch block',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should not handle unrelated violations', () => {
      const violation = createTestViolation({
        message: 'Rename variable to follow convention',
      });

      expect(strategy.canHandle(violation)).toBe(false);
    });
  });

  describe('generate', () => {
    it('should generate a wrap fix for try-catch', () => {
      const violation = createTestViolation({
        message: 'Wrap with try-catch for error handling',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      });
      const context = createTestContext(violation, 'await fetchData();');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('refactor');
      expect(fix?.title).toContain('Wrap with');
    });
  });
});

describe('ExtractFixStrategy', () => {
  const strategy = new ExtractFixStrategy();

  describe('canHandle', () => {
    it('should handle violations with extract keywords', () => {
      const violation = createTestViolation({
        message: 'Extract duplicate code into a function',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about refactoring', () => {
      const violation = createTestViolation({
        message: 'Refactor repeated logic',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate an extract fix', () => {
      const violation = createTestViolation({
        message: 'Extract duplicate code',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      });
      const context = createTestContext(violation, 'const result = a + b;');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('refactor');
      expect(fix?.title).toContain('Extract to');
    });
  });
});

describe('ImportFixStrategy', () => {
  const strategy = new ImportFixStrategy();

  describe('canHandle', () => {
    it('should handle violations about missing imports', () => {
      const violation = createTestViolation({
        message: 'Missing import for module',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about undefined references', () => {
      const violation = createTestViolation({
        message: 'Undefined reference to external module',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate an import fix with import statement', () => {
      const violation = createTestViolation({
        message: 'Missing import',
        expected: "import { foo } from 'bar';",
      });
      const context = createTestContext(violation, 'foo();');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('quickfix');
      expect(fix?.title).toContain('Add import');
    });

    it('should generate import from module path', () => {
      const violation = createTestViolation({
        message: "Missing import from '@/utils'",
        expected: '@/utils',
      });
      const context = createTestContext(violation, 'utils.foo();');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
    });
  });
});

describe('RenameFixStrategy', () => {
  const strategy = new RenameFixStrategy();

  describe('canHandle', () => {
    it('should handle violations about naming conventions', () => {
      const violation = createTestViolation({
        message: 'Rename to follow camelCase convention',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about case conventions', () => {
      const violation = createTestViolation({
        message: 'Variable should use snake_case',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate a rename fix', () => {
      const violation = createTestViolation({
        message: 'Rename to follow naming convention',
        expected: 'myVariable',
        actual: 'my_variable',
      });
      const context = createTestContext(violation, 'const my_variable = 1;');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('quickfix');
      expect(fix?.title).toContain('Rename to');
    });

    it('should convert to camelCase', () => {
      const violation = createTestViolation({
        message: 'Use camelCase naming',
        expected: 'camelCase',
        actual: 'snake_case_name',
      });
      const context = createTestContext(violation, 'const snake_case_name = 1;');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.title).toContain('camelCase');
    });
  });
});

describe('MoveFixStrategy', () => {
  const strategy = new MoveFixStrategy();

  describe('canHandle', () => {
    it('should handle violations about code location', () => {
      const violation = createTestViolation({
        message: 'Move this code to the correct location',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about organization', () => {
      const violation = createTestViolation({
        message: 'Organize imports at the top',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate a move fix', () => {
      const violation = createTestViolation({
        message: 'Move to line 1',
        expected: 'line 1',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
      });
      const content = 'line 0\nline 1\nline 2\nline 3\nline 4\nconst x = 1;';
      const context = createTestContext(violation, content);

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('refactor');
      expect(fix?.title).toContain('Move code');
    });
  });
});

describe('DeleteFixStrategy', () => {
  const strategy = new DeleteFixStrategy();

  describe('canHandle', () => {
    it('should handle violations about unused code', () => {
      const violation = createTestViolation({
        message: 'Delete unused variable',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about redundant code', () => {
      const violation = createTestViolation({
        message: 'Remove redundant statement',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });

    it('should handle violations about dead code', () => {
      const violation = createTestViolation({
        message: 'Dead code detected',
      });

      expect(strategy.canHandle(violation)).toBe(true);
    });
  });

  describe('generate', () => {
    it('should generate a delete fix', () => {
      const violation = createTestViolation({
        message: 'Delete unused code',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      });
      const context = createTestContext(violation, 'const unused = 1;');

      const fix = strategy.generate(context);

      expect(fix).toBeDefined();
      expect(fix?.kind).toBe('quickfix');
      expect(fix?.title).toBe('Delete code');
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createQuickFixGenerator', () => {
    it('should create a generator with default config', () => {
      const gen = createQuickFixGenerator();
      expect(gen).toBeInstanceOf(QuickFixGenerator);
      expect(gen.getStrategies()).toHaveLength(7);
    });
  });

  describe('createQuickFixGeneratorWithConfig', () => {
    it('should create a generator with custom config', () => {
      const gen = createQuickFixGeneratorWithConfig({
        minConfidence: 0.9,
        maxFixesPerViolation: 2,
      });
      expect(gen).toBeInstanceOf(QuickFixGenerator);
    });
  });

  describe('createHighConfidenceQuickFixGenerator', () => {
    it('should create a generator with high confidence threshold', () => {
      const gen = createHighConfidenceQuickFixGenerator();
      expect(gen).toBeInstanceOf(QuickFixGenerator);

      // Test that low confidence fixes are filtered
      const violation = createTestViolation({
        message: 'Move code to different location',
        expected: 'line 1',
      });
      const result = gen.generateFixes(violation, 'const x = 1;');

      // Move fixes have 0.6 confidence, should be filtered with 0.8 threshold
      const moveFixes = result.fixes.filter(f => f.fixType === 'move');
      expect(moveFixes).toHaveLength(0);
    });
  });

  describe('createFullQuickFixGenerator', () => {
    it('should create a generator with all fixes enabled', () => {
      const gen = createFullQuickFixGenerator();
      expect(gen).toBeInstanceOf(QuickFixGenerator);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('QuickFixGenerator Integration', () => {
  let generator: QuickFixGenerator;

  beforeEach(() => {
    generator = createQuickFixGenerator();
  });

  it('should handle a complete fix workflow', () => {
    // 1. Create a violation
    const violation = createTestViolation({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      expected: 'const',
      actual: 'var',
      message: 'Use const instead of var',
    });
    const content = 'var x = 1;';

    // 2. Generate fixes
    const result = generator.generateFixes(violation, content);
    expect(result.hasFixs).toBe(true);

    // 3. Get preferred fix
    const preferredFix = result.preferredFix;
    expect(preferredFix).toBeDefined();

    if (preferredFix) {
      // 4. Generate preview
      const preview = generator.generatePreview(preferredFix, content);
      expect(preview).toBeDefined();

      // 5. Validate fix
      const validation = generator.validateFix(preferredFix, content);
      expect(validation.valid).toBe(true);

      // 6. Apply fix
      const fixedContent = generator.applyFix(preferredFix, content);
      expect(fixedContent).toBe('const x = 1;');

      // 7. Calculate impact
      const impact = generator.calculateImpact(preferredFix, content);
      expect(impact.filesAffected).toBe(1);
      expect(impact.linesChanged).toBeGreaterThanOrEqual(1);
    }
  });

  it('should handle multi-line content', () => {
    const violation = createTestViolation({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      expected: 'const',
      actual: 'var',
    });
    const content = 'const a = 1;\nvar b = 2;\nconst c = 3;';

    const fix = generator.generateFixOfType(violation, content, 'replace');
    if (fix) {
      const result = generator.applyFix(fix, content);
      expect(result).toBe('const a = 1;\nconst b = 2;\nconst c = 3;');
    }
  });

  it('should handle violations without applicable fixes', () => {
    const violation = createTestViolation({
      message: 'Some obscure violation with no keywords',
      expected: '',
      actual: 'code',
    });
    const content = 'code';

    const result = generator.generateFixes(violation, content);

    // May or may not have fixes depending on strategy matching
    expect(result.violationId).toBe(violation.id);
    expect(Array.isArray(result.fixes)).toBe(true);
  });
});
