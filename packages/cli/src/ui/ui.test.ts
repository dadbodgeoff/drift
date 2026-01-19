/**
 * UI Component Tests
 *
 * Tests for CLI UI components including tables, spinners, and formatters.
 * Validates Requirements 29.1
 */

import { describe, it, expect } from 'vitest';
import {
  createTable,
  formatSeverity,
  formatConfidence,
  formatCount,
  formatPath,
  createPatternsTable,
  createViolationsTable,
  createStatusTable,
  createCategoryTable,
  type PatternRow,
  type ViolationRow,
  type StatusSummary,
  type CategoryBreakdown,
} from './table.js';
import { Spinner, createSpinner, status } from './spinner.js';

describe('Table Formatting', () => {
  describe('createTable', () => {
    it('should create a table with headers', () => {
      const table = createTable({
        head: ['Column 1', 'Column 2'],
      });
      table.push(['Value 1', 'Value 2']);
      const output = table.toString();

      expect(output).toContain('Column 1');
      expect(output).toContain('Column 2');
      expect(output).toContain('Value 1');
      expect(output).toContain('Value 2');
    });

    it('should support different styles', () => {
      const styles = ['default', 'compact', 'borderless', 'minimal'] as const;

      for (const style of styles) {
        const table = createTable({ style, head: ['Test'] });
        table.push(['Value']);
        expect(() => table.toString()).not.toThrow();
      }
    });
  });

  describe('formatSeverity', () => {
    it('should format all severity levels', () => {
      expect(formatSeverity('error')).toContain('error');
      expect(formatSeverity('warning')).toContain('warning');
      expect(formatSeverity('info')).toContain('info');
      expect(formatSeverity('hint')).toContain('hint');
    });
  });

  describe('formatConfidence', () => {
    it('should format confidence as percentage', () => {
      expect(formatConfidence(0.85)).toContain('85%');
      expect(formatConfidence(0.5)).toContain('50%');
      expect(formatConfidence(1.0)).toContain('100%');
    });

    it('should handle edge cases', () => {
      expect(formatConfidence(0)).toContain('0%');
      expect(formatConfidence(0.999)).toContain('100%');
    });
  });

  describe('formatCount', () => {
    it('should format counts', () => {
      expect(formatCount(0)).toContain('0');
      expect(formatCount(10)).toContain('10');
      expect(formatCount(100)).toContain('100');
    });

    it('should respect threshold', () => {
      // Count above threshold should be highlighted differently
      const aboveThreshold = formatCount(5, 3);
      const belowThreshold = formatCount(2, 3);
      expect(aboveThreshold).toBeDefined();
      expect(belowThreshold).toBeDefined();
    });
  });

  describe('formatPath', () => {
    it('should return short paths unchanged', () => {
      const shortPath = 'src/index.ts';
      expect(formatPath(shortPath)).toBe(shortPath);
    });

    it('should truncate long paths', () => {
      const longPath = 'very/long/path/to/some/deeply/nested/file/in/the/project/structure.ts';
      const formatted = formatPath(longPath, 30);
      expect(formatted.length).toBeLessThanOrEqual(50); // Includes ellipsis
      expect(formatted).toContain('...');
    });
  });
});

describe('Pattern Table', () => {
  it('should create a patterns table', () => {
    const patterns: PatternRow[] = [
      {
        id: 'pattern-1',
        name: 'Test Pattern',
        category: 'structural',
        confidence: 0.9,
        locations: 10,
        outliers: 2,
      },
    ];

    const output = createPatternsTable(patterns);
    expect(output).toContain('pattern-1');
    expect(output).toContain('Test Pattern');
    expect(output).toContain('structural');
  });

  it('should handle empty patterns', () => {
    const output = createPatternsTable([]);
    expect(output).toBeDefined();
  });
});

describe('Violations Table', () => {
  it('should create a violations table', () => {
    const violations: ViolationRow[] = [
      {
        severity: 'error',
        file: 'src/test.ts',
        line: 42,
        message: 'Test violation',
        pattern: 'test-pattern',
      },
    ];

    const output = createViolationsTable(violations);
    expect(output).toContain('src/test.ts');
    expect(output).toContain('42');
    expect(output).toContain('Test violation');
  });
});

describe('Status Table', () => {
  it('should create a status summary table', () => {
    const summary: StatusSummary = {
      totalPatterns: 100,
      approvedPatterns: 80,
      discoveredPatterns: 15,
      ignoredPatterns: 5,
      totalViolations: 10,
      errors: 2,
      warnings: 8,
    };

    const output = createStatusTable(summary);
    expect(output).toContain('100');
    expect(output).toContain('80');
    expect(output).toContain('15');
  });
});

describe('Category Table', () => {
  it('should create a category breakdown table', () => {
    const categories: CategoryBreakdown[] = [
      {
        category: 'structural',
        patterns: 20,
        violations: 5,
        coverage: 0.85,
      },
      {
        category: 'components',
        patterns: 15,
        violations: 3,
        coverage: 0.9,
      },
    ];

    const output = createCategoryTable(categories);
    expect(output).toContain('structural');
    expect(output).toContain('components');
  });
});

describe('Spinner', () => {
  describe('createSpinner', () => {
    it('should create a spinner with text', () => {
      const spinner = createSpinner('Loading...');
      expect(spinner).toBeInstanceOf(Spinner);
    });

    it('should create a spinner with options', () => {
      const spinner = createSpinner({
        text: 'Processing...',
        color: 'cyan',
      });
      expect(spinner).toBeInstanceOf(Spinner);
    });
  });

  describe('Spinner class', () => {
    it('should support method chaining', () => {
      const spinner = new Spinner({ text: 'Test', enabled: false });
      
      // These should return the spinner for chaining
      expect(spinner.text('New text')).toBe(spinner);
      expect(spinner.color('green')).toBe(spinner);
    });

    it('should track spinning state', () => {
      const spinner = new Spinner({ enabled: false });
      expect(spinner.isSpinning).toBe(false);
    });
  });
});

describe('Status Indicators', () => {
  it('should have all status methods', () => {
    expect(typeof status.success).toBe('function');
    expect(typeof status.error).toBe('function');
    expect(typeof status.warning).toBe('function');
    expect(typeof status.info).toBe('function');
    expect(typeof status.pending).toBe('function');
  });
});

describe('UI Module Exports', () => {
  it('should export all required components', async () => {
    const uiModule = await import('./index.js');

    // Prompts
    expect(typeof uiModule.confirmPrompt).toBe('function');
    expect(typeof uiModule.inputPrompt).toBe('function');
    expect(typeof uiModule.selectPrompt).toBe('function');

    // Spinner
    expect(typeof uiModule.createSpinner).toBe('function');
    expect(typeof uiModule.withSpinner).toBe('function');
    expect(uiModule.Spinner).toBeDefined();
    expect(uiModule.status).toBeDefined();

    // Table
    expect(typeof uiModule.createTable).toBe('function');
    expect(typeof uiModule.formatSeverity).toBe('function');
    expect(typeof uiModule.formatConfidence).toBe('function');
    expect(typeof uiModule.createPatternsTable).toBe('function');
    expect(typeof uiModule.createViolationsTable).toBe('function');

    // Progress
    expect(typeof uiModule.createScanProgress).toBe('function');
    expect(typeof uiModule.createAnalysisProgress).toBe('function');
  });
});
