/**
 * Policy Loader Tests
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyLoader } from '../policy/policy-loader.js';
import { PolicyEvaluator } from '../policy/policy-evaluator.js';
import { DEFAULT_POLICIES } from '../policy/default-policies.js';
import type { QualityPolicy, GateResult, GateId } from '../types.js';

describe('PolicyLoader', () => {
  let loader: PolicyLoader;
  const projectRoot = '/test/project';

  beforeEach(() => {
    loader = new PolicyLoader(projectRoot);
  });

  describe('load', () => {
    it('should load default policy when no policy specified', async () => {
      const policy = await loader.load();
      
      expect(policy).toBeDefined();
      expect(policy.id).toBe('default');
    });

    it('should load strict policy', async () => {
      const policy = await loader.load('strict');
      
      expect(policy).toBeDefined();
      expect(policy.id).toBe('strict');
    });

    it('should load relaxed policy', async () => {
      const policy = await loader.load('relaxed');
      
      expect(policy).toBeDefined();
      expect(policy.id).toBe('relaxed');
    });

    it('should load ci-fast policy', async () => {
      const policy = await loader.load('ci-fast');
      
      expect(policy).toBeDefined();
      expect(policy.id).toBe('ci-fast');
    });

    it('should throw for unknown policy', async () => {
      await expect(loader.load('unknown-policy')).rejects.toThrow();
    });

    it('should accept inline policy object', async () => {
      const inlinePolicy: QualityPolicy = {
        id: 'custom',
        name: 'Custom Policy',
        description: 'A custom policy',
        version: '1.0.0',
        scope: {},
        gates: {
          'pattern-compliance': {
            enabled: true,
            blocking: true,
            minComplianceRate: 90,
            maxNewOutliers: 0,
            categories: [],
            minPatternConfidence: 0.8,
            approvedOnly: true,
          },
          'constraint-verification': 'skip',
          'regression-detection': 'skip',
          'impact-simulation': 'skip',
          'security-boundary': 'skip',
          'custom-rules': 'skip',
        },
        aggregation: {
          mode: 'all',
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
      };

      const policy = await loader.load(inlinePolicy);
      
      expect(policy).toBe(inlinePolicy);
    });
  });

  describe('getGateConfig', () => {
    it('should return gate config from policy', async () => {
      const policy = await loader.load('default');
      const config = loader.getGateConfig(policy, 'pattern-compliance');
      
      expect(config).toBeDefined();
      expect(config).not.toBe('skip');
    });

    it('should return skip for disabled gates', async () => {
      const policy = await loader.load('ci-fast');
      const config = loader.getGateConfig(policy, 'impact-simulation');
      
      expect(config).toBe('skip');
    });
  });

  describe('isGateEnabled', () => {
    it('should return true for enabled gates', async () => {
      const policy = await loader.load('default');
      const enabled = loader.isGateEnabled(policy, 'pattern-compliance');
      
      expect(enabled).toBe(true);
    });

    it('should return false for skipped gates', async () => {
      const policy = await loader.load('ci-fast');
      const enabled = loader.isGateEnabled(policy, 'impact-simulation');
      
      expect(enabled).toBe(false);
    });
  });
});

describe('PolicyEvaluator', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    evaluator = new PolicyEvaluator();
  });

  describe('evaluate', () => {
    const createGateResult = (
      gateId: GateId,
      passed: boolean,
      score: number
    ): GateResult => ({
      gateId,
      gateName: gateId,
      status: passed ? 'passed' : 'failed',
      passed,
      score,
      summary: 'Test result',
      violations: [],
      warnings: [],
      executionTimeMs: 100,
      details: {},
    });

    it('should pass when all gates pass with "any" mode (default)', () => {
      const policy = DEFAULT_POLICIES.default!;
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 100),
        'constraint-verification': createGateResult('constraint-verification', true, 100),
        'regression-detection': createGateResult('regression-detection', true, 100),
        'impact-simulation': createGateResult('impact-simulation', true, 100),
        'security-boundary': createGateResult('security-boundary', true, 100),
        'custom-rules': createGateResult('custom-rules', true, 100),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      expect(evaluation.passed).toBe(true);
      expect(evaluation.score).toBe(100);
    });

    it('should fail when any gate fails with "any" mode (default)', () => {
      const policy = DEFAULT_POLICIES.default!;
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 100),
        'constraint-verification': createGateResult('constraint-verification', false, 50),
        'regression-detection': createGateResult('regression-detection', true, 100),
        'impact-simulation': createGateResult('impact-simulation', true, 100),
        'security-boundary': createGateResult('security-boundary', true, 100),
        'custom-rules': createGateResult('custom-rules', true, 100),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      expect(evaluation.passed).toBe(false);
    });

    it('should pass when any gate passes with "all" mode', () => {
      const policy: QualityPolicy = {
        ...DEFAULT_POLICIES.default!,
        aggregation: { mode: 'all' },
      };
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 100),
        'constraint-verification': createGateResult('constraint-verification', false, 50),
        'regression-detection': createGateResult('regression-detection', false, 50),
        'impact-simulation': createGateResult('impact-simulation', false, 50),
        'security-boundary': createGateResult('security-boundary', false, 50),
        'custom-rules': createGateResult('custom-rules', false, 50),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      // "all" mode means all gates must fail for overall failure
      // Since pattern-compliance passed, overall passes
      expect(evaluation.passed).toBe(true);
    });

    it('should calculate weighted score with "weighted" mode', () => {
      const policy: QualityPolicy = {
        ...DEFAULT_POLICIES.default!,
        aggregation: {
          mode: 'weighted',
          weights: {
            'pattern-compliance': 2,
            'constraint-verification': 1,
            'regression-detection': 1,
            'impact-simulation': 1,
            'security-boundary': 1,
            'custom-rules': 1,
          },
        },
      };
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 100),
        'constraint-verification': createGateResult('constraint-verification', true, 50),
        'regression-detection': createGateResult('regression-detection', true, 50),
        'impact-simulation': createGateResult('impact-simulation', true, 50),
        'security-boundary': createGateResult('security-boundary', true, 50),
        'custom-rules': createGateResult('custom-rules', true, 50),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      // Weighted average: (100*2 + 50*1 + 50*1 + 50*1 + 50*1 + 50*1) / (2+1+1+1+1+1) = 450/7 ≈ 64
      expect(evaluation.score).toBeGreaterThan(60);
      expect(evaluation.score).toBeLessThan(70);
    });

    it('should pass when score meets threshold with "threshold" mode', () => {
      const policy: QualityPolicy = {
        ...DEFAULT_POLICIES.default!,
        aggregation: {
          mode: 'threshold',
          minScore: 70,
        },
      };
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 80),
        'constraint-verification': createGateResult('constraint-verification', true, 80),
        'regression-detection': createGateResult('regression-detection', true, 80),
        'impact-simulation': createGateResult('impact-simulation', true, 80),
        'security-boundary': createGateResult('security-boundary', true, 80),
        'custom-rules': createGateResult('custom-rules', true, 80),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      expect(evaluation.passed).toBe(true);
      expect(evaluation.score).toBe(80);
    });

    it('should fail when score is below threshold with "threshold" mode', () => {
      const policy: QualityPolicy = {
        ...DEFAULT_POLICIES.default!,
        aggregation: {
          mode: 'threshold',
          minScore: 80,
        },
      };
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 70),
        'constraint-verification': createGateResult('constraint-verification', true, 70),
        'regression-detection': createGateResult('regression-detection', true, 70),
        'impact-simulation': createGateResult('impact-simulation', true, 70),
        'security-boundary': createGateResult('security-boundary', true, 70),
        'custom-rules': createGateResult('custom-rules', true, 70),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      expect(evaluation.passed).toBe(false);
    });

    it('should fail if required gate fails regardless of mode', () => {
      const policy: QualityPolicy = {
        ...DEFAULT_POLICIES.default!,
        aggregation: {
          mode: 'all',
          requiredGates: ['security-boundary'],
        },
      };
      const results: Record<GateId, GateResult> = {
        'pattern-compliance': createGateResult('pattern-compliance', true, 100),
        'constraint-verification': createGateResult('constraint-verification', true, 100),
        'regression-detection': createGateResult('regression-detection', true, 100),
        'impact-simulation': createGateResult('impact-simulation', true, 100),
        'security-boundary': createGateResult('security-boundary', false, 50),
        'custom-rules': createGateResult('custom-rules', true, 100),
      };

      const evaluation = evaluator.evaluate(results, policy);
      
      expect(evaluation.passed).toBe(false);
    });
  });
});
