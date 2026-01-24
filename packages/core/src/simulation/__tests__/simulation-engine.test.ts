/**
 * Simulation Engine Tests
 *
 * Tests for the Speculative Execution Engine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SimulationEngine,
  createSimulationEngine,
  ApproachGenerator,
  createApproachGenerator,
  FrictionScorer,
  ImpactScorer,
  PatternAlignmentScorer,
  SecurityScorer,
  detectTaskCategory,
  getStrategyProvider,
  type SimulationTask,
  type SimulationEngineConfig,
} from '../index.js';

describe('SimulationEngine', () => {
  let engine: SimulationEngine;
  const projectRoot = '/tmp/test-project';

  beforeEach(() => {
    engine = createSimulationEngine({ projectRoot });
  });

  describe('simulate', () => {
    it('should simulate approaches for a rate limiting task', async () => {
      const task: SimulationTask = {
        description: 'Add rate limiting to the API endpoints',
      };

      const result = await engine.simulate(task);

      expect(result).toBeDefined();
      expect(result.task).toEqual(task);
      expect(result.approaches.length).toBeGreaterThan(0);
      expect(result.recommended).toBeDefined();
      expect(result.summary).toBeTruthy();
      expect(result.confidence).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should detect task category automatically', async () => {
      const task: SimulationTask = {
        description: 'Implement user authentication with JWT tokens',
      };

      const result = await engine.simulate(task);

      // Should detect as authentication
      expect(result.approaches.length).toBeGreaterThan(0);
      expect(result.recommended.approach.name).toBeTruthy();
    });

    it('should respect maxApproaches option', async () => {
      const engineWithLimit = createSimulationEngine({
        projectRoot,
        options: { maxApproaches: 2 },
      });

      const task: SimulationTask = {
        description: 'Add caching layer',
      };

      const result = await engineWithLimit.simulate(task);

      expect(result.approaches.length).toBeLessThanOrEqual(2);
    });

    it('should rank approaches by score', async () => {
      const task: SimulationTask = {
        description: 'Add error handling middleware',
      };

      const result = await engine.simulate(task);

      // Verify ranking
      for (let i = 0; i < result.approaches.length - 1; i++) {
        expect(result.approaches[i]!.score).toBeGreaterThanOrEqual(
          result.approaches[i + 1]!.score
        );
        expect(result.approaches[i]!.rank).toBe(i + 1);
      }
    });

    it('should generate tradeoffs between approaches', async () => {
      const task: SimulationTask = {
        description: 'Add logging to all API endpoints',
      };

      const result = await engine.simulate(task);

      if (result.approaches.length > 1) {
        expect(result.tradeoffs.length).toBeGreaterThan(0);
        expect(result.tradeoffs[0]!.approach1).toBeTruthy();
        expect(result.tradeoffs[0]!.approach2).toBeTruthy();
        expect(result.tradeoffs[0]!.dimensions.length).toBe(4);
      }
    });

    it('should include pros and cons for each approach', async () => {
      const task: SimulationTask = {
        description: 'Add input validation',
      };

      const result = await engine.simulate(task);

      for (const approach of result.approaches) {
        expect(approach.pros).toBeDefined();
        expect(approach.cons).toBeDefined();
        expect(approach.reasoning).toBeTruthy();
      }
    });

    it('should calculate confidence score', async () => {
      const task: SimulationTask = {
        description: 'Add authorization checks',
      };

      const result = await engine.simulate(task);

      expect(result.confidence.score).toBeGreaterThanOrEqual(0);
      expect(result.confidence.score).toBeLessThanOrEqual(100);
      expect(result.confidence.dataSources).toBeDefined();
    });
  });
});

describe('ApproachGenerator', () => {
  let generator: ApproachGenerator;
  const projectRoot = '/tmp/test-project';

  beforeEach(() => {
    generator = createApproachGenerator({ projectRoot });
  });

  describe('generate', () => {
    it('should generate approaches for TypeScript projects', async () => {
      const task: SimulationTask = {
        description: 'Add rate limiting middleware',
      };

      const result = await generator.generate(task);

      expect(result.approaches.length).toBeGreaterThan(0);
      expect(result.detectedCategory).toBe('rate-limiting');
    });

    it('should detect task categories correctly', async () => {
      const testCases = [
        { desc: 'Add rate limiting', expected: 'rate-limiting' },
        { desc: 'Implement user login', expected: 'authentication' },
        { desc: 'Add role-based access control', expected: 'authorization' },
        { desc: 'Create new API endpoint', expected: 'api-endpoint' },
        { desc: 'Add database query', expected: 'data-access' },
        { desc: 'Handle errors gracefully', expected: 'error-handling' },
        { desc: 'Add Redis caching', expected: 'caching' },
        { desc: 'Add logging middleware', expected: 'logging' },
        { desc: 'Write unit tests', expected: 'testing' },
        { desc: 'Add input validation', expected: 'validation' },
      ];

      for (const { desc, expected } of testCases) {
        const result = await generator.generate({ description: desc });
        expect(result.detectedCategory).toBe(expected);
      }
    });

    it('should include approach metadata', async () => {
      const task: SimulationTask = {
        description: 'Add authentication',
      };

      const result = await generator.generate(task);

      for (const approach of result.approaches) {
        expect(approach.id).toBeTruthy();
        expect(approach.name).toBeTruthy();
        expect(approach.description).toBeTruthy();
        expect(approach.strategy).toBeTruthy();
        expect(approach.language).toBeTruthy();
      }
    });
  });
});

describe('detectTaskCategory', () => {
  it('should detect rate limiting', () => {
    expect(detectTaskCategory('add rate limiting')).toBe('rate-limiting');
    expect(detectTaskCategory('implement throttling')).toBe('rate-limiting');
    expect(detectTaskCategory('add API quota')).toBe('rate-limiting');
  });

  it('should detect authentication', () => {
    expect(detectTaskCategory('add user login')).toBe('authentication');
    expect(detectTaskCategory('implement JWT auth')).toBe('authentication');
    expect(detectTaskCategory('add OAuth support')).toBe('authentication');
  });

  it('should detect authorization', () => {
    expect(detectTaskCategory('add permission checks')).toBe('authorization');
    expect(detectTaskCategory('implement RBAC')).toBe('authorization');
    expect(detectTaskCategory('add access control')).toBe('authorization');
  });

  it('should detect error handling', () => {
    expect(detectTaskCategory('add error handling')).toBe('error-handling');
    expect(detectTaskCategory('catch exceptions')).toBe('error-handling');
    expect(detectTaskCategory('add fallback logic')).toBe('error-handling');
  });

  it('should return generic for unclear tasks', () => {
    expect(detectTaskCategory('do something')).toBe('generic');
    expect(detectTaskCategory('fix the thing')).toBe('generic');
  });
});

describe('getStrategyProvider', () => {
  it('should return provider for TypeScript', () => {
    const provider = getStrategyProvider('typescript');
    expect(provider).toBeDefined();
    expect(provider!.language).toBe('typescript');
  });

  it('should return provider for Python', () => {
    const provider = getStrategyProvider('python');
    expect(provider).toBeDefined();
    expect(provider!.language).toBe('python');
  });

  it('should return provider for Java', () => {
    const provider = getStrategyProvider('java');
    expect(provider).toBeDefined();
    expect(provider!.language).toBe('java');
  });

  it('should return provider for C#', () => {
    const provider = getStrategyProvider('csharp');
    expect(provider).toBeDefined();
    expect(provider!.language).toBe('csharp');
  });

  it('should return provider for PHP', () => {
    const provider = getStrategyProvider('php');
    expect(provider).toBeDefined();
    expect(provider!.language).toBe('php');
  });

  it('should return strategies for rate limiting', () => {
    const provider = getStrategyProvider('typescript')!;
    const strategies = provider.getStrategies('rate-limiting');
    expect(strategies.length).toBeGreaterThan(0);
  });
});

describe('FrictionScorer', () => {
  let scorer: FrictionScorer;

  beforeEach(() => {
    scorer = new FrictionScorer({ projectRoot: '/tmp/test' });
  });

  it('should score friction metrics', async () => {
    const approach = {
      id: 'test-1',
      name: 'Test Approach',
      description: 'A test approach',
      strategy: 'middleware' as const,
      language: 'typescript' as const,
      targetFiles: ['src/middleware.ts'],
      estimatedLinesAdded: 50,
      estimatedLinesModified: 10,
    };

    const result = await scorer.score(approach);

    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.codeChurn).toBeDefined();
    expect(result.patternDeviation).toBeDefined();
    expect(result.testingEffort).toBeDefined();
    expect(result.refactoringRequired).toBeDefined();
    expect(result.learningCurve).toBeDefined();
    expect(result.breakdown.length).toBe(5);
  });

  it('should give lower friction to simpler approaches', async () => {
    const simpleApproach = {
      id: 'simple',
      name: 'Simple',
      description: 'Simple approach',
      strategy: 'middleware' as const,
      language: 'typescript' as const,
      targetFiles: ['src/a.ts'],
      estimatedLinesAdded: 20,
      estimatedLinesModified: 5,
    };

    const complexApproach = {
      id: 'complex',
      name: 'Complex',
      description: 'Complex approach',
      strategy: 'per-function' as const,
      language: 'typescript' as const,
      targetFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
      estimatedLinesAdded: 200,
      estimatedLinesModified: 100,
    };

    const simpleResult = await scorer.score(simpleApproach);
    const complexResult = await scorer.score(complexApproach);

    expect(simpleResult.overall).toBeLessThan(complexResult.overall);
  });
});

describe('ImpactScorer', () => {
  let scorer: ImpactScorer;

  beforeEach(() => {
    scorer = new ImpactScorer({ projectRoot: '/tmp/test' });
  });

  it('should score impact metrics', async () => {
    const approach = {
      id: 'test-1',
      name: 'Test Approach',
      description: 'A test approach',
      strategy: 'middleware' as const,
      language: 'typescript' as const,
      targetFiles: ['src/middleware.ts'],
    };

    const result = await scorer.score(approach);

    expect(result.filesAffected).toBeGreaterThanOrEqual(0);
    expect(result.functionsAffected).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.riskLevel).toMatch(/^(critical|high|medium|low)$/);
  });
});

describe('PatternAlignmentScorer', () => {
  let scorer: PatternAlignmentScorer;

  beforeEach(() => {
    scorer = new PatternAlignmentScorer({ projectRoot: '/tmp/test' });
  });

  it('should score pattern alignment', async () => {
    const approach = {
      id: 'test-1',
      name: 'Test Approach',
      description: 'A test approach',
      strategy: 'middleware' as const,
      language: 'typescript' as const,
      targetFiles: ['src/middleware.ts'],
    };

    const result = await scorer.score(approach, 'rate-limiting');

    expect(result.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(result.alignmentScore).toBeLessThanOrEqual(100);
    expect(result.alignedPatterns).toBeDefined();
    expect(result.conflictingPatterns).toBeDefined();
    expect(typeof result.createsNewPattern).toBe('boolean');
    expect(typeof result.wouldBeOutlier).toBe('boolean');
  });
});

describe('SecurityScorer', () => {
  let scorer: SecurityScorer;

  beforeEach(() => {
    scorer = new SecurityScorer({ projectRoot: '/tmp/test' });
  });

  it('should score security metrics', async () => {
    const approach = {
      id: 'test-1',
      name: 'Test Approach',
      description: 'A test approach',
      strategy: 'guard' as const,
      language: 'typescript' as const,
      targetFiles: ['src/auth/guard.ts'],
    };

    const result = await scorer.score(approach);

    expect(result.securityRisk).toBeGreaterThanOrEqual(0);
    expect(result.securityRisk).toBeLessThanOrEqual(100);
    expect(result.dataAccessImplications).toBeDefined();
    expect(result.authImplications).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it('should flag auth-related files', async () => {
    const approach = {
      id: 'test-1',
      name: 'Auth Approach',
      description: 'Modifies auth',
      strategy: 'guard' as const,
      language: 'typescript' as const,
      targetFiles: ['src/auth/login.ts', 'src/auth/session.ts'],
    };

    const result = await scorer.score(approach);

    expect(result.authImplications.length).toBeGreaterThan(0);
  });
});

describe('Integration', () => {
  it('should work end-to-end with all components', async () => {
    const engine = createSimulationEngine({
      projectRoot: '/tmp/test-project',
      options: {
        maxApproaches: 3,
        includeSecurityAnalysis: true,
      },
    });

    const task: SimulationTask = {
      description: 'Add rate limiting to protect API from abuse',
      constraints: [
        { type: 'custom', value: 'must work with existing auth', description: 'Auth compatibility' },
      ],
    };

    const result = await engine.simulate(task);

    // Verify complete result structure
    expect(result.task).toEqual(task);
    expect(result.approaches.length).toBeGreaterThan(0);
    expect(result.approaches.length).toBeLessThanOrEqual(3);
    expect(result.recommended).toBeDefined();
    expect(result.recommended.rank).toBe(1);
    expect(result.summary).toBeTruthy();
    expect(result.confidence.score).toBeGreaterThan(0);
    expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);

    // Verify each approach has all required fields
    for (const approach of result.approaches) {
      expect(approach.approach).toBeDefined();
      expect(approach.friction).toBeDefined();
      expect(approach.impact).toBeDefined();
      expect(approach.patternAlignment).toBeDefined();
      expect(approach.security).toBeDefined();
      expect(approach.score).toBeGreaterThanOrEqual(0);
      expect(approach.score).toBeLessThanOrEqual(100);
      expect(approach.rank).toBeGreaterThan(0);
      expect(approach.reasoning).toBeTruthy();
      expect(approach.pros).toBeDefined();
      expect(approach.cons).toBeDefined();
      expect(approach.nextSteps).toBeDefined();
    }
  });

  it('should handle generic tasks gracefully', async () => {
    const engine = createSimulationEngine({
      projectRoot: '/tmp/test-project',
    });

    const task: SimulationTask = {
      description: 'do something with the code',
    };

    const result = await engine.simulate(task);

    // Should still produce a result even for vague tasks
    expect(result.approaches.length).toBeGreaterThan(0);
    expect(result.recommended).toBeDefined();
    expect(result.summary).toBeTruthy();
  });

  it('should handle tasks with explicit category', async () => {
    const engine = createSimulationEngine({
      projectRoot: '/tmp/test-project',
    });

    const task: SimulationTask = {
      description: 'implement the feature',
      category: 'authentication',
    };

    const result = await engine.simulate(task);

    // Should use the explicit category
    expect(result.approaches.length).toBeGreaterThan(0);
    expect(result.recommended).toBeDefined();
  });

  it('should handle tasks with target file', async () => {
    const engine = createSimulationEngine({
      projectRoot: '/tmp/test-project',
    });

    const task: SimulationTask = {
      description: 'add validation',
      target: 'src/api/users.ts',
    };

    const result = await engine.simulate(task);

    expect(result.approaches.length).toBeGreaterThan(0);
    expect(result.recommended).toBeDefined();
  });

  it('should work with custom scoring weights', async () => {
    const engine = createSimulationEngine({
      projectRoot: '/tmp/test-project',
      weights: {
        friction: 0.5,
        impact: 0.2,
        patternAlignment: 0.2,
        security: 0.1,
      },
    });

    const task: SimulationTask = {
      description: 'add caching',
    };

    const result = await engine.simulate(task);

    expect(result.approaches.length).toBeGreaterThan(0);
    expect(result.recommended).toBeDefined();
    // Scores should still be valid
    for (const approach of result.approaches) {
      expect(approach.score).toBeGreaterThanOrEqual(0);
      expect(approach.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('Language Strategy Coverage', () => {
  const categories = [
    'rate-limiting',
    'authentication',
    'authorization',
    'api-endpoint',
    'data-access',
    'error-handling',
    'caching',
    'logging',
    'validation',
    'middleware',
  ] as const;

  const languages = ['typescript', 'python', 'java', 'csharp', 'php'] as const;

  for (const language of languages) {
    describe(language, () => {
      it('should have a strategy provider', () => {
        const provider = getStrategyProvider(language);
        expect(provider).toBeDefined();
        expect(provider!.language).toBe(language);
      });

      it('should return strategies for common categories', () => {
        const provider = getStrategyProvider(language)!;
        
        // At least some categories should have strategies
        let hasStrategies = false;
        for (const category of categories) {
          const strategies = provider.getStrategies(category);
          if (strategies.length > 0) {
            hasStrategies = true;
            // Verify strategy structure
            for (const strategy of strategies) {
              expect(strategy.name).toBeTruthy();
              expect(strategy.description).toBeTruthy();
              expect(strategy.strategy).toBeTruthy();
            }
          }
        }
        expect(hasStrategies).toBe(true);
      });
    });
  }
});
