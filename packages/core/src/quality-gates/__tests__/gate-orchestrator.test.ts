/**
 * Gate Orchestrator Tests
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GateOrchestrator } from '../orchestrator/gate-orchestrator.js';
import { GateRegistry } from '../orchestrator/gate-registry.js';
import type { QualityGateOptions, GateId } from '../types.js';

describe('GateOrchestrator', () => {
  let orchestrator: GateOrchestrator;
  const projectRoot = '/test/project';

  beforeEach(() => {
    orchestrator = new GateOrchestrator(projectRoot);
  });

  describe('constructor', () => {
    it('should create orchestrator with project root', () => {
      expect(orchestrator).toBeDefined();
    });
  });

  describe('run', () => {
    it('should run with default options', async () => {
      const options: QualityGateOptions = {
        projectRoot,
      };

      const result = await orchestrator.run(options);

      expect(result).toBeDefined();
      expect(result.passed).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.timestamp).toBeDefined();
    });

    it('should run specific gates when specified', async () => {
      const options: QualityGateOptions = {
        projectRoot,
        gates: ['pattern-compliance'] as GateId[],
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.gatesRun).toContain('pattern-compliance');
    });

    it('should use specified policy', async () => {
      const options: QualityGateOptions = {
        projectRoot,
        policy: 'strict',
      };

      const result = await orchestrator.run(options);

      expect(result.policy.id).toBe('strict');
    });

    it('should include branch in metadata', async () => {
      const options: QualityGateOptions = {
        projectRoot,
        branch: 'feature/test',
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.branch).toBe('feature/test');
    });

    it('should include commit SHA in metadata when provided', async () => {
      const options: QualityGateOptions = {
        projectRoot,
        commitSha: 'abc123',
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.commitSha).toBe('abc123');
    });

    it('should set CI flag in metadata', async () => {
      const options: QualityGateOptions = {
        projectRoot,
        ci: true,
      };

      const result = await orchestrator.run(options);

      expect(result.metadata.ci).toBe(true);
    });

    it('should aggregate violations from all gates', async () => {
      const options: QualityGateOptions = {
        projectRoot,
      };

      const result = await orchestrator.run(options);

      expect(Array.isArray(result.violations)).toBe(true);
    });

    it('should aggregate warnings from all gates', async () => {
      const options: QualityGateOptions = {
        projectRoot,
      };

      const result = await orchestrator.run(options);

      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should calculate overall score', async () => {
      const options: QualityGateOptions = {
        projectRoot,
      };

      const result = await orchestrator.run(options);

      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should set exit code based on result', async () => {
      const options: QualityGateOptions = {
        projectRoot,
      };

      const result = await orchestrator.run(options);

      expect(typeof result.exitCode).toBe('number');
      if (result.passed) {
        expect(result.exitCode).toBe(0);
      } else {
        expect(result.exitCode).toBe(1);
      }
    });
  });
});

describe('GateRegistry', () => {
  let registry: GateRegistry;

  beforeEach(() => {
    registry = new GateRegistry();
    registry.reset(); // Clear any cached state
  });

  describe('list', () => {
    it('should list registered gates', async () => {
      const gates = await registry.list();
      
      expect(Array.isArray(gates)).toBe(true);
    });
  });

  describe('has', () => {
    it('should return true for registered gates', async () => {
      const hasPatternCompliance = await registry.has('pattern-compliance');
      
      expect(hasPatternCompliance).toBe(true);
    });

    it('should return false for unknown gates', async () => {
      const hasUnknown = await registry.has('unknown-gate' as GateId);
      
      expect(hasUnknown).toBe(false);
    });
  });

  describe('get', () => {
    it('should return gate instance', async () => {
      const gate = await registry.get('pattern-compliance');
      
      expect(gate).toBeDefined();
      expect(gate.id).toBe('pattern-compliance');
    });

    it('should throw for unknown gates', async () => {
      await expect(registry.get('unknown-gate' as GateId)).rejects.toThrow('Unknown gate');
    });

    it('should cache gate instances', async () => {
      const gate1 = await registry.get('pattern-compliance');
      const gate2 = await registry.get('pattern-compliance');
      
      expect(gate1).toBe(gate2);
    });
  });

  describe('register', () => {
    it('should allow registering custom gates', async () => {
      const mockGate = {
        id: 'custom-gate' as GateId,
        name: 'Custom Gate',
        description: 'A custom gate',
        execute: vi.fn(),
        validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
        getDefaultConfig: vi.fn().mockReturnValue({ enabled: true, blocking: true }),
      };

      registry.register('custom-gate' as GateId, () => mockGate);
      
      const gate = await registry.get('custom-gate' as GateId);
      expect(gate).toBe(mockGate);
    });
  });

  describe('clear', () => {
    it('should clear cached instances', async () => {
      // Get a gate to cache it
      await registry.get('pattern-compliance');
      
      // Clear cache
      registry.clear();
      
      // Getting again should create new instance
      const gate = await registry.get('pattern-compliance');
      expect(gate).toBeDefined();
    });
  });
});
