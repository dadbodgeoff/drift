/**
 * Quality Gates Integration Tests
 * 
 * @license Apache-2.0
 * 
 * Tests the quality gates system with real pattern/constraint data
 * from the demo projects.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { GateOrchestrator } from '../orchestrator/gate-orchestrator.js';
import { PolicyLoader } from '../policy/policy-loader.js';
import { PatternComplianceGate } from '../gates/pattern-compliance/pattern-compliance-gate.js';
import { ConstraintVerificationGate } from '../gates/constraint-verification/constraint-verification-gate.js';
import { RegressionDetectionGate } from '../gates/regression-detection/regression-detection-gate.js';
import { ImpactSimulationGate } from '../gates/impact-simulation/impact-simulation-gate.js';
import { SecurityBoundaryGate } from '../gates/security-boundary/security-boundary-gate.js';
import { CustomRulesGate } from '../gates/custom-rules/custom-rules-gate.js';
import { TextReporter } from '../reporters/text-reporter.js';
import { JsonReporter } from '../reporters/json-reporter.js';
import { GitHubReporter } from '../reporters/github-reporter.js';
import { SarifReporter } from '../reporters/sarif-reporter.js';
import type { 
  QualityGateOptions, 
  GateInput, 
  Pattern, 
  Constraint,
  PatternComplianceConfig,
  ConstraintVerificationConfig,
} from '../types.js';

// Demo project paths (relative to workspace root)
const DEMO_BACKEND_PATH = path.resolve(__dirname, '../../../../demo/backend');
const DEMO_FRONTEND_PATH = path.resolve(__dirname, '../../../../demo/frontend');

describe('Quality Gates Integration', () => {
  describe('GateOrchestrator with real project', () => {
    let orchestrator: GateOrchestrator;

    beforeAll(() => {
      // Use the demo backend as the test project
      orchestrator = new GateOrchestrator(DEMO_BACKEND_PATH);
    });

    it('should run with default policy on demo project', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'default', // Explicitly specify default policy
        files: ['src/routes/users.ts', 'src/services/user-service.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result).toBeDefined();
      expect(result.passed).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.policy.id).toBe('default');
      expect(result.metadata.filesChecked).toBe(2);
    });

    it('should run with strict policy', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'strict',
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('strict');
    });

    it('should run with relaxed policy', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        policy: 'relaxed',
        files: ['src/routes/users.ts'],
        branch: 'feature/test',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('relaxed');
    });

    it('should run specific gates only', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        gates: ['pattern-compliance'],
        files: ['src/routes/users.ts'],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.gatesRun).toContain('pattern-compliance');
      expect(result.metadata.gatesRun).toHaveLength(1);
    });

    it('should handle empty file list gracefully', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: [],
        branch: 'main',
      };

      const result = await orchestrator.run(options);

      expect(result.passed).toBe(true);
      expect(result.warnings).toContain('No files to check');
    });

    it('should include CI metadata when ci flag is set', async () => {
      const options: QualityGateOptions = {
        projectRoot: DEMO_BACKEND_PATH,
        files: ['src/routes/users.ts'],
        branch: 'main',
        ci: true,
        commitSha: 'abc123def456',
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.ci).toBe(true);
      expect(result.metadata.commitSha).toBe('abc123def456');
    });
  });

  describe('Individual Gates', () => {
    describe('PatternComplianceGate', () => {
      it('should execute with mock patterns', async () => {
        const gate = new PatternComplianceGate(DEMO_BACKEND_PATH);
        
        const mockPatterns: Pattern[] = [
          {
            id: 'error-handling-try-catch',
            name: 'Try-Catch Error Handling',
            status: 'approved',
            confidence: 0.85,
            category: 'errors',
            locations: [
              { file: 'src/services/user-service.ts', line: 10 },
              { file: 'src/services/auth-service.ts', line: 25 },
            ],
            outliers: [],
          },
          {
            id: 'api-response-format',
            name: 'API Response Format',
            status: 'approved',
            confidence: 0.92,
            category: 'api',
            locations: [
              { file: 'src/routes/users.ts', line: 15 },
            ],
            outliers: [
              { file: 'src/routes/legacy.ts', line: 5, reason: 'Uses old response format' },
            ],
          },
        ];

        const config: PatternComplianceConfig = {
          enabled: true,
          blocking: true,
          minComplianceRate: 70,
          maxNewOutliers: 5,
          categories: [],
          minPatternConfidence: 0.7,
          approvedOnly: true,
        };

        const input: GateInput = {
          files: ['src/routes/users.ts', 'src/services/user-service.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config,
          context: {
            patterns: mockPatterns,
          },
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('pattern-compliance');
        expect(result.passed).toBeDefined();
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      });

      it('should validate config correctly', () => {
        const gate = new PatternComplianceGate(DEMO_BACKEND_PATH);
        
        const validConfig: PatternComplianceConfig = {
          enabled: true,
          blocking: true,
          minComplianceRate: 80,
          maxNewOutliers: 0,
          categories: [],
          minPatternConfidence: 0.7,
          approvedOnly: true,
        };

        const validation = gate.validateConfig(validConfig);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });
    });

    describe('ConstraintVerificationGate', () => {
      it('should execute with mock constraints', async () => {
        const gate = new ConstraintVerificationGate(DEMO_BACKEND_PATH);
        
        const mockConstraints: Constraint[] = [
          {
            id: 'auth-before-db',
            description: 'Authentication must occur before database access',
            status: 'approved',
            confidence: 0.95,
            category: 'security',
          },
          {
            id: 'validate-input',
            description: 'Input validation required for all API endpoints',
            status: 'discovered',
            confidence: 0.78,
            category: 'validation',
          },
        ];

        const config: ConstraintVerificationConfig = {
          enabled: true,
          blocking: true,
          enforceApproved: true,
          enforceDiscovered: false,
          minConfidence: 0.8,
          categories: [],
        };

        const input: GateInput = {
          files: ['src/routes/users.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config,
          context: {
            constraints: mockConstraints,
          },
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('constraint-verification');
        expect(result.passed).toBeDefined();
      });
    });

    describe('RegressionDetectionGate', () => {
      it('should execute with mock snapshot', async () => {
        const gate = new RegressionDetectionGate(DEMO_BACKEND_PATH);
        
        const input: GateInput = {
          files: ['src/routes/users.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config: gate.getDefaultConfig(),
          context: {
            patterns: [],
            previousSnapshot: {
              id: 'snapshot-1',
              branch: 'main',
              commitSha: 'abc123',
              timestamp: new Date().toISOString(),
              healthScore: 85,
              patterns: [],
              constraints: [],
              security: {
                authCoverage: 90,
                sensitiveAccessPoints: 5,
                protectedTables: 3,
                unprotectedTables: 1,
              },
              metadata: {
                filesAnalyzed: 10,
                patternsAnalyzed: 5,
                constraintsAnalyzed: 3,
              },
            },
          },
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('regression-detection');
        expect(result.passed).toBeDefined();
      });
    });

    describe('ImpactSimulationGate', () => {
      it('should execute with mock call graph', async () => {
        const gate = new ImpactSimulationGate(DEMO_BACKEND_PATH);
        
        const input: GateInput = {
          files: ['src/routes/users.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config: gate.getDefaultConfig(),
          context: {
            callGraph: {
              nodes: new Map([
                ['src/routes/users.ts:getUsers', {
                  id: 'src/routes/users.ts:getUsers',
                  file: 'src/routes/users.ts',
                  name: 'getUsers',
                  type: 'function',
                }],
                ['src/services/user-service.ts:findAll', {
                  id: 'src/services/user-service.ts:findAll',
                  file: 'src/services/user-service.ts',
                  name: 'findAll',
                  type: 'method',
                }],
              ]),
              edges: [
                { from: 'src/routes/users.ts:getUsers', to: 'src/services/user-service.ts:findAll' },
              ],
            },
          },
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('impact-simulation');
        expect(result.passed).toBeDefined();
      });
    });

    describe('SecurityBoundaryGate', () => {
      it('should execute with mock data', async () => {
        const gate = new SecurityBoundaryGate(DEMO_BACKEND_PATH);
        
        const input: GateInput = {
          files: ['src/routes/users.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config: gate.getDefaultConfig(),
          context: {},
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('security-boundary');
        expect(result.passed).toBeDefined();
      });
    });

    describe('CustomRulesGate', () => {
      it('should execute with inline rules', async () => {
        const gate = new CustomRulesGate(DEMO_BACKEND_PATH);
        
        const input: GateInput = {
          files: ['src/routes/users.ts'],
          projectRoot: DEMO_BACKEND_PATH,
          branch: 'main',
          isCI: false,
          config: {
            enabled: true,
            blocking: true,
            ruleFiles: [],
            inlineRules: [
              {
                id: 'no-console-log',
                name: 'No Console Log',
                description: 'Disallow console.log in production code',
                severity: 'warning',
                condition: {
                  type: 'content-pattern',
                  files: '**/*.ts',
                  mustNotContain: 'console.log',
                },
                message: 'Remove console.log statements',
                enabled: true,
                tags: ['logging'],
              },
            ],
            useBuiltInRules: false,
          },
          context: {
            customRules: [],
          },
        };

        const result = await gate.execute(input);

        expect(result.gateId).toBe('custom-rules');
        expect(result.passed).toBeDefined();
      });
    });
  });

  describe('Reporters', () => {
    const mockResult = {
      passed: true,
      status: 'passed' as const,
      score: 85,
      summary: 'All gates passed',
      gates: {},
      violations: [
        {
          id: 'v1',
          gateId: 'pattern-compliance' as const,
          severity: 'warning' as const,
          file: 'src/test.ts',
          line: 10,
          column: 5,
          message: 'Test violation',
          explanation: 'This is a test',
          ruleId: 'test-rule',
        },
      ],
      warnings: ['Test warning'],
      policy: { id: 'default', name: 'Default Policy' },
      metadata: {
        executionTimeMs: 150,
        filesChecked: 5,
        gatesRun: ['pattern-compliance' as const],
        gatesSkipped: [],
        timestamp: new Date().toISOString(),
        branch: 'main',
        ci: false,
      },
      exitCode: 0,
    };

    describe('TextReporter', () => {
      it('should generate readable text output', () => {
        const reporter = new TextReporter();
        const output = reporter.generate(mockResult);

        expect(output).toContain('DRIFT QUALITY GATE RESULTS');
        expect(output).toContain('PASSED');
        expect(output).toContain('85/100');
      });

      it('should include violations in verbose mode', () => {
        const reporter = new TextReporter();
        const output = reporter.generate(mockResult, { verbose: true });

        expect(output).toContain('VIOLATIONS');
        expect(output).toContain('src/test.ts:10');
      });
    });

    describe('JsonReporter', () => {
      it('should generate valid JSON', () => {
        const reporter = new JsonReporter();
        const output = reporter.generate(mockResult);

        const parsed = JSON.parse(output);
        expect(parsed.passed).toBe(true);
        expect(parsed.score).toBe(85);
      });
    });

    describe('GitHubReporter', () => {
      it('should generate GitHub Actions format', () => {
        const reporter = new GitHubReporter();
        const output = reporter.generate(mockResult);

        expect(output).toContain('::warning');
        expect(output).toContain('src/test.ts');
      });
    });

    describe('SarifReporter', () => {
      it('should generate valid SARIF', () => {
        const reporter = new SarifReporter();
        const output = reporter.generate(mockResult);

        const parsed = JSON.parse(output);
        expect(parsed.$schema).toContain('sarif');
        expect(parsed.version).toBe('2.1.0');
        expect(parsed.runs).toHaveLength(1);
      });
    });
  });

  describe('PolicyLoader', () => {
    let loader: PolicyLoader;

    beforeAll(() => {
      loader = new PolicyLoader(DEMO_BACKEND_PATH);
    });

    it('should load all built-in policies', async () => {
      const policies = await loader.listAll();
      
      expect(policies.length).toBeGreaterThanOrEqual(4);
      
      const policyIds = policies.map(p => p.id);
      expect(policyIds).toContain('default');
      expect(policyIds).toContain('strict');
      expect(policyIds).toContain('relaxed');
      expect(policyIds).toContain('ci-fast');
    });

    it('should match policy to branch context', async () => {
      // Strict policy should match main branch
      const strictPolicy = await loader.loadForContext({
        branch: 'main',
        paths: ['src/routes/users.ts'],
      });
      
      // Default or strict should be returned for main
      expect(['default', 'strict']).toContain(strictPolicy.id);
    });

    it('should match relaxed policy to feature branch', async () => {
      const relaxedPolicy = await loader.loadForContext({
        branch: 'feature/new-feature',
        paths: ['src/routes/users.ts'],
      });
      
      // Relaxed policy matches feature/* branches
      expect(['default', 'relaxed']).toContain(relaxedPolicy.id);
    });
  });
});
