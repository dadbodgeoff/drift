/**
 * Quality Gates E2E Tests
 * 
 * @license Apache-2.0
 * 
 * End-to-end tests that simulate real CLI usage scenarios.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { GateOrchestrator } from '../orchestrator/gate-orchestrator.js';
import { TextReporter } from '../reporters/text-reporter.js';
import { JsonReporter } from '../reporters/json-reporter.js';
import { GitHubReporter } from '../reporters/github-reporter.js';
import { GitLabReporter } from '../reporters/gitlab-reporter.js';
import { SarifReporter } from '../reporters/sarif-reporter.js';
import type { QualityGateOptions, QualityGateResult, OutputFormat } from '../types.js';

// Demo project path
const DEMO_BACKEND_PATH = path.resolve(__dirname, '../../../../demo/backend');

describe('Quality Gates E2E', () => {
  describe('Full Pipeline Execution', () => {
    let orchestrator: GateOrchestrator;

    beforeAll(() => {
      orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
    });

    it('should complete full gate run with all gates', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts', 'src/services/user-service.ts'],
        branch: 'main',
        ci: false,
      };

      const result = await orchestrator.run(options);

      // Verify complete result structure
      expect(result).toMatchObject({
        passed: expect.any(Boolean),
        status: expect.stringMatching(/^(passed|failed|warned|skipped|errored)$/),
        score: expect.any(Number),
        summary: expect.any(String),
        gates: expect.any(Object),
        violations: expect.any(Array),
        warnings: expect.any(Array),
        policy: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
        }),
        metadata: expect.objectContaining({
          executionTimeMs: expect.any(Number),
          filesChecked: expect.any(Number),
          gatesRun: expect.any(Array),
          gatesSkipped: expect.any(Array),
          timestamp: expect.any(String),
          branch: 'main',
          ci: false,
        }),
        exitCode: expect.any(Number),
      });

      // Score should be valid
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);

      // Exit code should match pass/fail
      if (result.passed) {
        expect(result.exitCode).toBe(0);
      } else {
        expect(result.exitCode).toBe(1);
      }
    });

    it('should run in CI mode with JSON output', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
        ci: true,
        commitSha: 'e2e-test-commit',
        format: 'json',
      };

      const result = await orchestrator.run(options);
      const reporter = new JsonReporter();
      const output = reporter.generate(result);

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed.passed).toBe(result.passed);
      expect(parsed.score).toBe(result.score);
      expect(parsed.metadata.ci).toBe(true);
      expect(parsed.metadata.commitSha).toBe('e2e-test-commit');
    });

    it('should generate GitHub Actions annotations', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
        ci: true,
      };

      const result = await orchestrator.run(options);
      const reporter = new GitHubReporter();
      const output = reporter.generate(result);

      // GitHub format uses ::group:: and ::endgroup::
      expect(output).toContain('::group::');
      expect(output).toContain('::endgroup::');
    });

    it('should generate GitLab CI format', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
        ci: true,
      };

      const result = await orchestrator.run(options);
      const reporter = new GitLabReporter();
      const output = reporter.generate(result);

      // GitLab Code Quality format is an array of issues
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should generate SARIF for security tools', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);
      const reporter = new SarifReporter();
      const output = reporter.generate(result);

      const sarif = JSON.parse(output);
      expect(sarif.$schema).toContain('sarif');
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs).toBeInstanceOf(Array);
      expect(sarif.runs[0].tool.driver.name).toBe('Drift Quality Gates');
    });
  });

  describe('Policy Scenarios', () => {
    let orchestrator: GateOrchestrator;

    beforeAll(() => {
      orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
    });

    it('should apply strict policy for main branch', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'strict',
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('strict');
      // Strict policy has more gates enabled
      expect(result.metadata.gatesRun.length).toBeGreaterThan(0);
    });

    it('should apply relaxed policy for feature branches', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'relaxed',
        files: ['src/routes/users.ts'],
        branch: 'feature/new-feature',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('relaxed');
    });

    it('should apply ci-fast policy for quick checks', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'ci-fast',
        files: ['src/routes/users.ts'],
        branch: 'main',
        ci: true,
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('ci-fast');
      // CI-fast skips most gates
      expect(result.metadata.gatesRun).toContain('pattern-compliance');
    });

    it('should accept inline policy', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: {
          id: 'custom-inline',
          name: 'Custom Inline Policy',
          description: 'Test inline policy',
          version: '1.0.0',
          scope: {},
          gates: {
            'pattern-compliance': {
              enabled: true,
              blocking: true,
              minComplianceRate: 50,
              maxNewOutliers: 10,
              categories: [],
              minPatternConfidence: 0.5,
              approvedOnly: false,
            },
            'constraint-verification': 'skip',
            'regression-detection': 'skip',
            'impact-simulation': 'skip',
            'security-boundary': 'skip',
            'custom-rules': 'skip',
          },
          aggregation: {
            mode: 'any',
          },
          actions: {
            onPass: [],
            onFail: [],
            onWarn: [],
          },
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('custom-inline');
      expect(result.metadata.gatesRun).toContain('pattern-compliance');
      expect(result.metadata.gatesRun).not.toContain('constraint-verification');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent project gracefully', async () => {
      const orchestrator = new GateOrchestrator('/non/existent/path');
      
      const options: QualityGateOptions = {
        projectRoot: '/non/existent/path',
        files: ['test.ts'],
        branch: 'main',
      };

      // Should not throw, but return a result
      const result = await orchestrator.run(options);
      expect(result).toBeDefined();
    });

    it('should handle invalid policy ID', async () => {
      const orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
      
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'non-existent-policy',
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      // Should throw for invalid policy
      await expect(orchestrator.run(options)).rejects.toThrow('Policy not found');
    });
  });

  describe('Output Formats', () => {
    let result: QualityGateResult;

    beforeAll(async () => {
      const orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
      result = await orchestrator.run({
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
      });
    });

    it('should generate text format', () => {
      const reporter = new TextReporter();
      const output = reporter.generate(result);

      expect(output).toContain('DRIFT QUALITY GATE RESULTS');
      expect(output).toContain('Status:');
      expect(output).toContain('Score:');
    });

    it('should generate JSON format', () => {
      const reporter = new JsonReporter();
      const output = reporter.generate(result);

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('passed');
      expect(parsed).toHaveProperty('score');
      expect(parsed).toHaveProperty('gates');
    });

    it('should generate GitHub format', () => {
      const reporter = new GitHubReporter();
      const output = reporter.generate(result);

      expect(output).toContain('::group::');
    });

    it('should generate GitLab format', () => {
      const reporter = new GitLabReporter();
      const output = reporter.generate(result);

      // GitLab Code Quality format is an array of issues
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should generate SARIF format', () => {
      const reporter = new SarifReporter();
      const output = reporter.generate(result);

      const parsed = JSON.parse(output);
      expect(parsed.version).toBe('2.1.0');
    });
  });

  describe('Performance', () => {
    it('should complete within reasonable time', async () => {
      const orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
      
      const start = Date.now();
      const result = await orchestrator.run({
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
      });
      const elapsed = Date.now() - start;

      // Should complete within 5 seconds for a single file
      expect(elapsed).toBeLessThan(5000);
      expect(result.metadata.executionTimeMs).toBeLessThan(5000);
    });

    it('should handle multiple files efficiently', async () => {
      const orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
      
      const files = [
        'src/routes/users.ts',
        'src/routes/auth.ts',
        'src/services/user-service.ts',
        'src/services/auth-service.ts',
        'src/middleware/auth.ts',
      ];

      const start = Date.now();
      const result = await orchestrator.run({
        projectRoot: DEMO_BACKEND_PATH,
        files,
        branch: 'main',
      });
      const elapsed = Date.now() - start;

      // Should complete within 10 seconds for multiple files
      expect(elapsed).toBeLessThan(10000);
    });
  });
});
