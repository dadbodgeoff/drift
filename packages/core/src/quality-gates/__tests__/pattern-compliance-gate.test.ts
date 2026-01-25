/**
 * Pattern Compliance Gate Tests
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternComplianceGate } from '../gates/pattern-compliance/pattern-compliance-gate.js';
import type {
  GateInput,
  PatternComplianceConfig,
  PatternComplianceDetails,
  Pattern,
} from '../types.js';

describe('PatternComplianceGate', () => {
  let gate: PatternComplianceGate;

  beforeEach(() => {
    gate = new PatternComplianceGate();
  });

  describe('metadata', () => {
    it('should have correct id', () => {
      expect(gate.id).toBe('pattern-compliance');
    });

    it('should have correct name', () => {
      expect(gate.name).toBe('Pattern Compliance');
    });

    it('should have a description', () => {
      expect(gate.description).toBeTruthy();
    });
  });

  describe('getDefaultConfig', () => {
    it('should return valid default config', () => {
      const config = gate.getDefaultConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.blocking).toBe(true);
      expect(config.minComplianceRate).toBe(80);
      expect(config.maxNewOutliers).toBe(0);
      expect(config.categories).toEqual([]);
      expect(config.minPatternConfidence).toBe(0.7);
      expect(config.approvedOnly).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should accept valid config', () => {
      const config: PatternComplianceConfig = {
        enabled: true,
        blocking: true,
        minComplianceRate: 80,
        maxNewOutliers: 0,
        categories: [],
        minPatternConfidence: 0.7,
        approvedOnly: true,
      };

      const result = gate.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid minComplianceRate', () => {
      const config: PatternComplianceConfig = {
        enabled: true,
        blocking: true,
        minComplianceRate: 150, // Invalid
        maxNewOutliers: 0,
        categories: [],
        minPatternConfidence: 0.7,
        approvedOnly: true,
      };

      const result = gate.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('minComplianceRate must be between 0 and 100');
    });

    it('should reject negative maxNewOutliers', () => {
      const config: PatternComplianceConfig = {
        enabled: true,
        blocking: true,
        minComplianceRate: 80,
        maxNewOutliers: -1, // Invalid
        categories: [],
        minPatternConfidence: 0.7,
        approvedOnly: true,
      };

      const result = gate.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('maxNewOutliers must be non-negative');
    });

    it('should reject invalid minPatternConfidence', () => {
      const config: PatternComplianceConfig = {
        enabled: true,
        blocking: true,
        minComplianceRate: 80,
        maxNewOutliers: 0,
        categories: [],
        minPatternConfidence: 1.5, // Invalid
        approvedOnly: true,
      };

      const result = gate.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('minPatternConfidence must be between 0 and 1');
    });
  });

  describe('execute', () => {
    const createInput = (
      files: string[],
      patterns: Pattern[],
      config?: Partial<PatternComplianceConfig>
    ): GateInput => ({
      files,
      projectRoot: '/test/project',
      branch: 'main',
      isCI: false,
      config: {
        ...gate.getDefaultConfig(),
        ...config,
      },
      context: {
        patterns,
      },
    });

    it('should pass when no patterns exist', async () => {
      const input = createInput(['src/test.ts'], []);
      const result = await gate.execute(input);

      expect(result.passed).toBe(true);
      expect(result.status).toBe('passed');
      expect(result.score).toBe(100);
      expect(result.warnings).toContain('No approved patterns found. Run `drift scan` and `drift approve` first.');
    });

    it('should pass when all files comply with patterns', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'API Handler Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [
            { file: 'src/test.ts', line: 10 },
            { file: 'src/test.ts', line: 20 },
          ],
          outliers: [],
        },
      ];

      const input = createInput(['src/test.ts'], patterns);
      const result = await gate.execute(input);

      expect(result.passed).toBe(true);
      expect(result.status).toBe('passed');
      const details = result.details as unknown as PatternComplianceDetails;
      expect(details.complianceRate).toBe(100);
      expect(details.newOutliers).toHaveLength(0);
    });

    it('should fail when compliance rate is below threshold', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'API Handler Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [
            { file: 'src/test.ts', line: 10 },
          ],
          outliers: [
            { file: 'src/test.ts', line: 20, reason: 'Missing error handling' },
            { file: 'src/test.ts', line: 30, reason: 'Missing error handling' },
            { file: 'src/test.ts', line: 40, reason: 'Missing error handling' },
            { file: 'src/test.ts', line: 50, reason: 'Missing error handling' },
          ],
        },
      ];

      const input = createInput(['src/test.ts'], patterns, { minComplianceRate: 80 });
      const result = await gate.execute(input);

      expect(result.passed).toBe(false);
      expect(result.status).toBe('failed');
      const details = result.details as unknown as PatternComplianceDetails;
      expect(details.complianceRate).toBeLessThan(80);
    });

    it('should filter patterns by category', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'API Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [{ file: 'src/test.ts', line: 10 }],
          outliers: [],
        },
        {
          id: 'pattern-2',
          name: 'Auth Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'auth',
          locations: [],
          outliers: [{ file: 'src/test.ts', line: 20, reason: 'Missing auth' }],
        },
      ];

      // Only check API patterns
      const input = createInput(['src/test.ts'], patterns, { categories: ['api'] });
      const result = await gate.execute(input);

      expect(result.passed).toBe(true);
      const details = result.details as unknown as PatternComplianceDetails;
      expect(details.patternsChecked).toBe(1);
    });

    it('should filter patterns by confidence', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'High Confidence Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [{ file: 'src/test.ts', line: 10 }],
          outliers: [],
        },
        {
          id: 'pattern-2',
          name: 'Low Confidence Pattern',
          status: 'approved',
          confidence: 0.5, // Below threshold
          category: 'api',
          locations: [],
          outliers: [{ file: 'src/test.ts', line: 20, reason: 'Violation' }],
        },
      ];

      const input = createInput(['src/test.ts'], patterns, { minPatternConfidence: 0.7 });
      const result = await gate.execute(input);

      expect(result.passed).toBe(true);
      const details = result.details as unknown as PatternComplianceDetails;
      expect(details.patternsChecked).toBe(1);
    });

    it('should only check approved patterns when approvedOnly is true', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'Approved Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [{ file: 'src/test.ts', line: 10 }],
          outliers: [],
        },
        {
          id: 'pattern-2',
          name: 'Discovered Pattern',
          status: 'discovered',
          confidence: 0.9,
          category: 'api',
          locations: [],
          outliers: [{ file: 'src/test.ts', line: 20, reason: 'Violation' }],
        },
      ];

      const input = createInput(['src/test.ts'], patterns, { approvedOnly: true });
      const result = await gate.execute(input);

      expect(result.passed).toBe(true);
      const details = result.details as unknown as PatternComplianceDetails;
      expect(details.patternsChecked).toBe(1);
    });

    it('should create violations for new outliers', async () => {
      const patterns: Pattern[] = [
        {
          id: 'pattern-1',
          name: 'API Handler Pattern',
          status: 'approved',
          confidence: 0.9,
          category: 'api',
          locations: [{ file: 'src/test.ts', line: 10 }],
          outliers: [
            { file: 'src/test.ts', line: 20, reason: 'Missing error handling' },
          ],
        },
      ];

      const input = createInput(['src/test.ts'], patterns, { maxNewOutliers: 0 });
      const result = await gate.execute(input);

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].gateId).toBe('pattern-compliance');
      expect(result.violations[0].ruleId).toBe('pattern-1');
    });
  });
});
