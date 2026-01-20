/**
 * CLI Command Tests
 *
 * Tests for all CLI commands and CI mode output.
 * Validates Requirements 29.1-29.9, 30.1-30.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Violation, Pattern, Severity } from 'driftdetect-core';
import {
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  type ReportData,
} from '../reporters/index.js';
import { getExitCode } from './check.js';

/**
 * Create mock violation for testing
 */
function createMockViolation(
  severity: Severity,
  file = 'test.ts',
  line = 1
): Violation {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    patternId: 'test-pattern',
    severity,
    file,
    range: {
      start: { line, character: 0 },
      end: { line, character: 10 },
    },
    message: `Test ${severity} violation`,
    explanation: `This is a ${severity} level violation`,
    expected: 'expected pattern',
    actual: 'actual code',
    aiExplainAvailable: false,
    aiFixAvailable: false,
    firstSeen: new Date(),
    occurrences: 1,
  };
}

/**
 * Create mock pattern for testing
 */
function createMockPattern(id: string, name: string): Pattern {
  return {
    id,
    category: 'structural',
    subcategory: 'test',
    name,
    description: `Test pattern: ${name}`,
    detector: { type: 'custom', config: {} },
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
  };
}

/**
 * Create mock report data for testing
 */
function createMockReportData(violations: Violation[]): ReportData {
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;
  const infoCount = violations.filter((v) => v.severity === 'info').length;
  const hintCount = violations.filter((v) => v.severity === 'hint').length;

  return {
    violations,
    summary: {
      total: violations.length,
      errors: errorCount,
      warnings: warningCount,
      infos: infoCount,
      hints: hintCount,
    },
    patterns: [createMockPattern('test-pattern', 'Test Pattern')],
    timestamp: new Date().toISOString(),
    rootDir: '/test/project',
  };
}

describe('CLI Exit Code Logic', () => {
  describe('getExitCode', () => {
    it('should return 0 when failOn is "none" regardless of violations', () => {
      const violations = [
        createMockViolation('error'),
        createMockViolation('warning'),
      ];
      expect(getExitCode(violations, 'none')).toBe(0);
    });

    it('should return 0 when there are no violations', () => {
      expect(getExitCode([], 'error')).toBe(0);
      expect(getExitCode([], 'warning')).toBe(0);
    });

    it('should return 1 when failOn is "error" and there are errors', () => {
      const violations = [createMockViolation('error')];
      expect(getExitCode(violations, 'error')).toBe(1);
    });

    it('should return 0 when failOn is "error" and there are only warnings', () => {
      const violations = [createMockViolation('warning')];
      expect(getExitCode(violations, 'error')).toBe(0);
    });

    it('should return 1 when failOn is "warning" and there are warnings', () => {
      const violations = [createMockViolation('warning')];
      expect(getExitCode(violations, 'warning')).toBe(1);
    });

    it('should return 1 when failOn is "warning" and there are errors', () => {
      const violations = [createMockViolation('error')];
      expect(getExitCode(violations, 'warning')).toBe(1);
    });

    it('should return 0 when failOn is "warning" and there are only info/hints', () => {
      const violations = [
        createMockViolation('info'),
        createMockViolation('hint'),
      ];
      expect(getExitCode(violations, 'warning')).toBe(0);
    });
  });
});

describe('Text Reporter', () => {
  const reporter = new TextReporter();

  it('should report no violations message when empty', () => {
    const data = createMockReportData([]);
    const output = reporter.generate(data);
    expect(output).toContain('No violations found');
  });

  it('should group violations by file', () => {
    const violations = [
      createMockViolation('error', 'file1.ts', 10),
      createMockViolation('warning', 'file1.ts', 20),
      createMockViolation('error', 'file2.ts', 5),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('file1.ts');
    expect(output).toContain('file2.ts');
  });

  it('should include violation details', () => {
    const violations = [createMockViolation('error', 'test.ts', 42)];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('42:0');
    expect(output).toContain('error');
    expect(output).toContain('test-pattern');
  });

  it('should include summary counts', () => {
    const violations = [
      createMockViolation('error'),
      createMockViolation('error'),
      createMockViolation('warning'),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('2 errors');
    expect(output).toContain('1 warning');
    expect(output).toContain('3 total');
  });
});

describe('JSON Reporter (CI Mode)', () => {
  const reporter = new JsonReporter();

  it('should produce valid JSON output', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('should include all violation fields', () => {
    const violations = [createMockViolation('error', 'test.ts', 10)];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0]).toMatchObject({
      patternId: 'test-pattern',
      severity: 'error',
      file: 'test.ts',
      line: 10,
    });
  });

  it('should include summary statistics', () => {
    const violations = [
      createMockViolation('error'),
      createMockViolation('warning'),
      createMockViolation('info'),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed.summary).toMatchObject({
      total: 3,
      errors: 1,
      warnings: 1,
      infos: 1,
      hints: 0,
    });
  });

  it('should include pattern information', () => {
    const data = createMockReportData([]);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0]).toMatchObject({
      id: 'test-pattern',
      name: 'Test Pattern',
    });
  });

  it('should include timestamp', () => {
    const data = createMockReportData([]);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed.timestamp).toBeDefined();
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });
});

describe('GitHub Reporter (CI Mode)', () => {
  const reporter = new GitHubReporter();

  it('should produce GitHub Actions annotation format', () => {
    const violations = [createMockViolation('error', 'src/test.ts', 42)];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('::error');
    expect(output).toContain('file=src/test.ts');
    expect(output).toContain('line=42');
  });

  it('should map severity to GitHub annotation levels', () => {
    const violations = [
      createMockViolation('error'),
      createMockViolation('warning'),
      createMockViolation('info'),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('::error');
    expect(output).toContain('::warning');
    expect(output).toContain('::notice');
  });

  it('should include summary notice', () => {
    const violations = [
      createMockViolation('error'),
      createMockViolation('warning'),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('::notice::Drift found 2 violation(s)');
  });

  it('should set output variables', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    expect(output).toContain('::set-output name=violations::1');
    expect(output).toContain('::set-output name=errors::1');
  });

  it('should report no violations when empty', () => {
    const data = createMockReportData([]);
    const output = reporter.generate(data);

    expect(output).toContain('::notice::Drift: No violations found');
  });
});

describe('GitLab Reporter (CI Mode)', () => {
  const reporter = new GitLabReporter();

  it('should produce valid JSON array', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);

    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should follow GitLab Code Quality format', () => {
    const violations = [createMockViolation('error', 'src/test.ts', 42)];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed[0]).toMatchObject({
      type: 'issue',
      check_name: 'drift/test-pattern',
      location: {
        path: 'src/test.ts',
        lines: {
          begin: 42,
          end: 42,
        },
      },
    });
  });

  it('should map severity to GitLab severity levels', () => {
    const violations = [
      createMockViolation('error'),
      createMockViolation('warning'),
      createMockViolation('info'),
      createMockViolation('hint'),
    ];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    const severities = parsed.map((issue: { severity: string }) => issue.severity);
    expect(severities).toContain('critical');
    expect(severities).toContain('major');
    expect(severities).toContain('minor');
    expect(severities).toContain('info');
  });

  it('should include fingerprint for deduplication', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed[0].fingerprint).toBeDefined();
    expect(typeof parsed[0].fingerprint).toBe('string');
    expect(parsed[0].fingerprint.length).toBe(32); // MD5 hash length
  });

  it('should include content body when explanation exists', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed[0].content).toBeDefined();
    expect(parsed[0].content.body).toContain('error level violation');
  });

  it('should produce empty array when no violations', () => {
    const data = createMockReportData([]);
    const output = reporter.generate(data);
    const parsed = JSON.parse(output);

    expect(parsed).toEqual([]);
  });
});

describe('Reporter Consistency', () => {
  const reporters = {
    text: new TextReporter(),
    json: new JsonReporter(),
    github: new GitHubReporter(),
    gitlab: new GitLabReporter(),
  };

  it('all reporters should handle empty violations', () => {
    const data = createMockReportData([]);

    for (const [name, reporter] of Object.entries(reporters)) {
      expect(() => reporter.generate(data)).not.toThrow();
    }
  });

  it('all reporters should handle multiple violations', () => {
    const violations = [
      createMockViolation('error', 'file1.ts', 10),
      createMockViolation('warning', 'file2.ts', 20),
      createMockViolation('info', 'file3.ts', 30),
      createMockViolation('hint', 'file4.ts', 40),
    ];
    const data = createMockReportData(violations);

    for (const [name, reporter] of Object.entries(reporters)) {
      expect(() => reporter.generate(data)).not.toThrow();
    }
  });

  it('all reporters should produce non-empty output for violations', () => {
    const violations = [createMockViolation('error')];
    const data = createMockReportData(violations);

    for (const [name, reporter] of Object.entries(reporters)) {
      const output = reporter.generate(data);
      expect(output.length).toBeGreaterThan(0);
    }
  });
});
