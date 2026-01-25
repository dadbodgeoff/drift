/**
 * Reporter Tests
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  SarifReporter,
} from '../reporters/index.js';
import type { QualityGateResult, GateId } from '../types.js';

describe('Reporters', () => {
  const createMockResult = (passed: boolean): QualityGateResult => ({
    passed,
    status: passed ? 'passed' : 'failed',
    score: passed ? 100 : 50,
    summary: 'Test summary',
    gates: {
      'pattern-compliance': {
        gateId: 'pattern-compliance',
        gateName: 'Pattern Compliance',
        status: passed ? 'passed' : 'failed',
        passed,
        score: passed ? 100 : 50,
        summary: 'Pattern compliance check',
        violations: passed ? [] : [
          {
            id: 'v1',
            gateId: 'pattern-compliance',
            severity: 'error',
            file: 'src/test.ts',
            line: 10,
            column: 1,
            message: 'Test violation',
            explanation: 'This is a test violation',
            ruleId: 'test-rule',
          },
        ],
        warnings: [],
        executionTimeMs: 100,
        details: {},
      },
      'constraint-verification': {
        gateId: 'constraint-verification',
        gateName: 'Constraint Verification',
        status: 'passed',
        passed: true,
        score: 100,
        summary: 'Constraint verification check',
        violations: [],
        warnings: [],
        executionTimeMs: 50,
        details: {},
      },
      'regression-detection': {
        gateId: 'regression-detection',
        gateName: 'Regression Detection',
        status: 'skipped',
        passed: true,
        score: 100,
        summary: 'Skipped',
        violations: [],
        warnings: [],
        executionTimeMs: 0,
        details: {},
      },
      'impact-simulation': {
        gateId: 'impact-simulation',
        gateName: 'Impact Simulation',
        status: 'skipped',
        passed: true,
        score: 100,
        summary: 'Skipped',
        violations: [],
        warnings: [],
        executionTimeMs: 0,
        details: {},
      },
      'security-boundary': {
        gateId: 'security-boundary',
        gateName: 'Security Boundary',
        status: 'skipped',
        passed: true,
        score: 100,
        summary: 'Skipped',
        violations: [],
        warnings: [],
        executionTimeMs: 0,
        details: {},
      },
      'custom-rules': {
        gateId: 'custom-rules',
        gateName: 'Custom Rules',
        status: 'skipped',
        passed: true,
        score: 100,
        summary: 'Skipped',
        violations: [],
        warnings: [],
        executionTimeMs: 0,
        details: {},
      },
    },
    violations: passed ? [] : [
      {
        id: 'v1',
        gateId: 'pattern-compliance',
        severity: 'error',
        file: 'src/test.ts',
        line: 10,
        column: 1,
        message: 'Test violation',
        explanation: 'This is a test violation',
        ruleId: 'test-rule',
      },
    ],
    warnings: ['Test warning'],
    policy: {
      id: 'default',
      name: 'Default Policy',
    },
    metadata: {
      executionTimeMs: 150,
      filesChecked: 10,
      gatesRun: ['pattern-compliance', 'constraint-verification'] as GateId[],
      gatesSkipped: ['regression-detection', 'impact-simulation', 'security-boundary', 'custom-rules'] as GateId[],
      timestamp: new Date().toISOString(),
      branch: 'main',
      ci: false,
    },
    exitCode: passed ? 0 : 1,
  });

  describe('TextReporter', () => {
    let reporter: TextReporter;

    beforeEach(() => {
      reporter = new TextReporter();
    });

    it('should generate text report for passing result', () => {
      const result = createMockResult(true);
      const report = reporter.generate(result);

      expect(report).toContain('PASSED');
      expect(report).toContain('100');
    });

    it('should generate text report for failing result', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);

      expect(report).toContain('FAILED');
      expect(report).toContain('violation');
    });

    it('should include verbose details when requested', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result, { verbose: true });

      expect(report).toContain('src/test.ts');
      expect(report).toContain('Test violation');
    });
  });

  describe('JsonReporter', () => {
    let reporter: JsonReporter;

    beforeEach(() => {
      reporter = new JsonReporter();
    });

    it('should generate valid JSON', () => {
      const result = createMockResult(true);
      const report = reporter.generate(result);

      expect(() => JSON.parse(report)).not.toThrow();
    });

    it('should include all result fields', () => {
      const result = createMockResult(true);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      expect(parsed.passed).toBe(true);
      expect(parsed.score).toBe(100);
      expect(parsed.gates).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });
  });

  describe('GitHubReporter', () => {
    let reporter: GitHubReporter;

    beforeEach(() => {
      reporter = new GitHubReporter();
    });

    it('should generate GitHub Actions format', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);

      // GitHub Actions uses ::error:: format
      expect(report).toContain('::error');
    });

    it('should include file and line in annotations', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);

      expect(report).toContain('file=src/test.ts');
      expect(report).toContain('line=10');
    });

    it('should generate summary for passing result', () => {
      const result = createMockResult(true);
      const report = reporter.generate(result);

      expect(report).toContain('✅');
    });
  });

  describe('GitLabReporter', () => {
    let reporter: GitLabReporter;

    beforeEach(() => {
      reporter = new GitLabReporter();
    });

    it('should generate GitLab Code Quality format', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should include fingerprint for each issue', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      if (parsed.length > 0) {
        expect(parsed[0].fingerprint).toBeDefined();
      }
    });

    it('should include location for each issue', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      if (parsed.length > 0) {
        expect(parsed[0].location).toBeDefined();
        expect(parsed[0].location.path).toBe('src/test.ts');
        expect(parsed[0].location.lines.begin).toBe(10);
      }
    });
  });

  describe('SarifReporter', () => {
    let reporter: SarifReporter;

    beforeEach(() => {
      reporter = new SarifReporter();
    });

    it('should generate valid SARIF format', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      expect(parsed.$schema).toContain('sarif');
      expect(parsed.version).toBe('2.1.0');
      expect(parsed.runs).toBeDefined();
      expect(Array.isArray(parsed.runs)).toBe(true);
    });

    it('should include tool information', () => {
      const result = createMockResult(true);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      expect(parsed.runs[0].tool.driver.name).toBe('Drift Quality Gates');
    });

    it('should include results for violations', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      expect(parsed.runs[0].results.length).toBeGreaterThan(0);
    });

    it('should include physical location for violations', () => {
      const result = createMockResult(false);
      const report = reporter.generate(result);
      const parsed = JSON.parse(report);

      const firstResult = parsed.runs[0].results[0];
      expect(firstResult.locations).toBeDefined();
      expect(firstResult.locations[0].physicalLocation.artifactLocation.uri).toBe('src/test.ts');
    });
  });
});
