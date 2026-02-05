/**
 * Migration Scorer Tests
 */

import { describe, it, expect } from 'vitest';
import { MigrationScorer, createMigrationScorer } from '../analyzers/migration-scorer.js';
import type { STPOU, SafetyAnalysisResult } from '../types.js';
import type { DocstringExtractionResult, StateMachineExtractionResult } from '../extractors/index.js';

describe('MigrationScorer', () => {
  const createMockPOU = (overrides: Partial<STPOU> = {}): STPOU => ({
    id: 'test-pou-1',
    type: 'FUNCTION_BLOCK',
    name: 'FB_Test',
    qualifiedName: 'FB_Test',
    location: { file: 'test.st', line: 1, column: 1 },
    documentation: null,
    variables: [],
    extends: null,
    implements: [],
    methods: [],
    bodyStartLine: 10,
    bodyEndLine: 50,
    vendorAttributes: {},
    ...overrides,
  });

  const createMockDocstrings = (): DocstringExtractionResult => ({
    docstrings: [],
    summary: {
      total: 0,
      byBlock: {},
      withParams: 0,
      withHistory: 0,
      withWarnings: 0,
      averageQuality: 0,
    },
  });

  const createMockStateMachines = (): StateMachineExtractionResult => ({
    stateMachines: [],
    summary: {
      total: 0,
      totalStates: 0,
      byVariable: {},
      withDeadlocks: 0,
      withGaps: 0,
    },
  });

  const createMockSafety = (): SafetyAnalysisResult => ({
    interlocks: [],
    bypasses: [],
    criticalWarnings: [],
    summary: {
      totalInterlocks: 0,
      byType: {
        'interlock': 0,
        'permissive': 0,
        'estop': 0,
        'safety-relay': 0,
        'safety-device': 0,
        'bypass': 0,
      },
      bypassCount: 0,
      criticalWarningCount: 0,
    },
  });

  describe('factory function', () => {
    it('should create scorer with default weights', () => {
      const scorer = createMigrationScorer();
      expect(scorer).toBeInstanceOf(MigrationScorer);
    });

    it('should create scorer with custom weights', () => {
      const scorer = createMigrationScorer({
        weights: { documentation: 0.5 },
      });
      expect(scorer).toBeInstanceOf(MigrationScorer);
    });
  });

  describe('calculateReadiness', () => {
    it('should return empty report for no POUs', () => {
      const scorer = new MigrationScorer();
      const result = scorer.calculateReadiness(
        [],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety()
      );

      expect(result.overallScore).toBe(0);
      expect(result.pouScores).toHaveLength(0);
      expect(result.migrationOrder).toHaveLength(0);
    });

    it('should score a simple POU', () => {
      const scorer = new MigrationScorer();
      const pou = createMockPOU();

      const result = scorer.calculateReadiness(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety()
      );

      expect(result.pouScores).toHaveLength(1);
      expect(result.pouScores[0]!.pouName).toBe('FB_Test');
      expect(result.pouScores[0]!.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.pouScores[0]!.overallScore).toBeLessThanOrEqual(100);
    });

    it('should penalize POUs with safety bypasses', () => {
      const scorer = new MigrationScorer();
      const pou = createMockPOU();

      const safetyWithBypass: SafetyAnalysisResult = {
        ...createMockSafety(),
        bypasses: [{
          id: 'bypass-1',
          name: 'bDbg_SkipIL',
          location: { file: 'test.st', line: 20, column: 1 },
          pouId: null,
          affectedInterlocks: [],
          condition: null,
          severity: 'critical',
        }],
      };

      const result = scorer.calculateReadiness(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        safetyWithBypass
      );

      expect(result.pouScores[0]!.dimensionScores.safety).toBeLessThan(100);
      expect(result.risks.some(r => r.category === 'safety')).toBe(true);
    });

    it('should generate migration order', () => {
      const scorer = new MigrationScorer();
      const pou1 = createMockPOU({ id: 'pou-1', name: 'FB_First' });
      const pou2 = createMockPOU({ id: 'pou-2', name: 'FB_Second' });

      const result = scorer.calculateReadiness(
        [pou1, pou2],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety()
      );

      expect(result.migrationOrder).toHaveLength(2);
      expect(result.migrationOrder[0]!.order).toBe(1);
      expect(result.migrationOrder[1]!.order).toBe(2);
    });

    it('should estimate effort', () => {
      const scorer = new MigrationScorer();
      const pou = createMockPOU();

      const result = scorer.calculateReadiness(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety()
      );

      expect(result.estimatedEffort.totalHours).toBeGreaterThan(0);
      expect(result.estimatedEffort.confidence).toBeGreaterThan(0);
      expect(result.estimatedEffort.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('grading', () => {
    it('should assign correct grades', () => {
      const scorer = new MigrationScorer();
      
      // Create POUs with different documentation levels
      const wellDocumented = createMockPOU({
        id: 'pou-good',
        name: 'FB_Good',
        documentation: {
          id: 'doc-1',
          summary: 'Well documented function block',
          description: 'Full description',
          params: [],
          returns: null,
          author: 'Test',
          date: '2024-01-01',
          history: [{ date: '2024-01-01', author: 'Test', description: 'Created' }],
          warnings: [],
          notes: [],
          raw: '',
          location: { file: 'test.st', line: 1, column: 1 },
          associatedBlock: 'FB_Good',
          associatedBlockType: 'FUNCTION_BLOCK',
        },
        variables: [
          {
            id: 'var-1',
            name: 'bInput',
            dataType: 'BOOL',
            section: 'VAR_INPUT',
            initialValue: null,
            comment: 'Input signal',
            isArray: false,
            arrayBounds: null,
            isSafetyCritical: false,
            ioAddress: null,
            location: { file: 'test.st', line: 5, column: 1 },
            pouId: 'pou-good',
          },
        ],
      });

      const result = scorer.calculateReadiness(
        [wellDocumented],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety()
      );

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.overallGrade);
    });
  });
});
