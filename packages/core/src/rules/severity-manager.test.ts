/**
 * Severity Manager Tests
 *
 * Tests for severity management including default severity per category,
 * config overrides, escalation logic, and violation sorting.
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 * @requirements 24.2 - WHEN severity is error, THE Violation SHALL block commits and merges
 * @requirements 24.3 - WHEN severity is warning, THE Violation SHALL be displayed but not block
 * @requirements 24.4 - THE Enforcement_System SHALL allow severity overrides per pattern in config
 * @requirements 24.5 - THE Enforcement_System SHALL support severity escalation after N violations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SeverityManager,
  DEFAULT_CATEGORY_SEVERITY,
  DEFAULT_ESCALATION_RULES,
  DEFAULT_SEVERITY_MANAGER_CONFIG,
  getDefaultCategorySeverity,
  isBlockingSeverity,
  compareSeverity,
  sortViolationsBySeverity,
  getSeveritySummary,
  createSeverityManager,
  createSeverityManagerFromConfig,
} from './severity-manager.js';
import type { Violation } from './types.js';
import type { PatternCategory, Severity } from '../store/types.js';

// Helper to create a mock violation
function createMockViolation(
  id: string,
  patternId: string,
  severity: Severity
): Violation {
  return {
    id,
    patternId,
    severity,
    file: 'test.ts',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
    message: `Test violation ${id}`,
    expected: 'expected',
    actual: 'actual',
    aiExplainAvailable: false,
    aiFixAvailable: false,
    firstSeen: new Date(),
    occurrences: 1,
  };
}

describe('SeverityManager', () => {
  let manager: SeverityManager;

  beforeEach(() => {
    manager = new SeverityManager();
  });

  describe('constructor', () => {
    it('should create a manager with default configuration', () => {
      const m = new SeverityManager();
      const config = m.getConfig();
      expect(config.defaultSeverity).toBe('warning');
      expect(config.patternOverrides).toEqual({});
      expect(config.categoryOverrides).toEqual({});
      expect(config.escalation.enabled).toBe(false);
    });

    it('should create a manager with custom configuration', () => {
      const m = new SeverityManager({
        defaultSeverity: 'error',
        patternOverrides: { 'pattern-1': 'info' },
        categoryOverrides: { security: 'warning' },
      });
      const config = m.getConfig();
      expect(config.defaultSeverity).toBe('error');
      expect(config.patternOverrides['pattern-1']).toBe('info');
      expect(config.categoryOverrides['security']).toBe('warning');
    });

    it('should merge partial configuration with defaults', () => {
      const m = new SeverityManager({
        defaultSeverity: 'info',
      });
      const config = m.getConfig();
      expect(config.defaultSeverity).toBe('info');
      expect(config.escalation.enabled).toBe(false);
    });

    it('should merge escalation configuration', () => {
      const m = new SeverityManager({
        escalation: {
          enabled: true,
          threshold: 5,
          rules: [{ from: 'warning', to: 'error', afterCount: 5 }],
        },
      });
      const config = m.getConfig();
      expect(config.escalation.enabled).toBe(true);
      expect(config.escalation.threshold).toBe(5);
      expect(config.escalation.rules).toHaveLength(1);
    });
  });

  describe('getEffectiveSeverity', () => {
    it('should return pattern-specific override when set', () => {
      manager.setPatternOverride('pattern-1', 'error');
      const severity = manager.getEffectiveSeverity('pattern-1', 'structural');
      expect(severity).toBe('error');
    });

    it('should return category override when no pattern override', () => {
      manager.setCategoryOverride('structural', 'info');
      const severity = manager.getEffectiveSeverity('pattern-1', 'structural');
      expect(severity).toBe('info');
    });

    it('should return default category severity when no overrides', () => {
      const severity = manager.getEffectiveSeverity('pattern-1', 'security');
      expect(severity).toBe(DEFAULT_CATEGORY_SEVERITY['security']);
      expect(severity).toBe('error');
    });

    it('should return default severity for unknown category', () => {
      // Cast to bypass type checking for test
      const severity = manager.getEffectiveSeverity(
        'pattern-1',
        'unknown' as PatternCategory
      );
      expect(severity).toBe('warning');
    });

    it('should prioritize pattern override over category override', () => {
      manager.setPatternOverride('pattern-1', 'hint');
      manager.setCategoryOverride('security', 'warning');
      const severity = manager.getEffectiveSeverity('pattern-1', 'security');
      expect(severity).toBe('hint');
    });

    it('should return correct default severity for each category', () => {
      expect(manager.getEffectiveSeverity('p', 'structural')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'components')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'styling')).toBe('info');
      expect(manager.getEffectiveSeverity('p', 'api')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'auth')).toBe('error');
      expect(manager.getEffectiveSeverity('p', 'errors')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'data-access')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'testing')).toBe('info');
      expect(manager.getEffectiveSeverity('p', 'logging')).toBe('info');
      expect(manager.getEffectiveSeverity('p', 'security')).toBe('error');
      expect(manager.getEffectiveSeverity('p', 'config')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'types')).toBe('info');
      expect(manager.getEffectiveSeverity('p', 'performance')).toBe('hint');
      expect(manager.getEffectiveSeverity('p', 'accessibility')).toBe('warning');
      expect(manager.getEffectiveSeverity('p', 'documentation')).toBe('hint');
    });
  });

  describe('isBlocking', () => {
    it('should return true for error severity', () => {
      expect(manager.isBlocking('error')).toBe(true);
    });

    it('should return false for warning severity', () => {
      expect(manager.isBlocking('warning')).toBe(false);
    });

    it('should return false for info severity', () => {
      expect(manager.isBlocking('info')).toBe(false);
    });

    it('should return false for hint severity', () => {
      expect(manager.isBlocking('hint')).toBe(false);
    });
  });

  describe('hasBlockingViolations', () => {
    it('should return true when there are error violations', () => {
      const violations = [
        createMockViolation('1', 'p1', 'warning'),
        createMockViolation('2', 'p2', 'error'),
        createMockViolation('3', 'p3', 'info'),
      ];
      expect(manager.hasBlockingViolations(violations)).toBe(true);
    });

    it('should return false when there are no error violations', () => {
      const violations = [
        createMockViolation('1', 'p1', 'warning'),
        createMockViolation('2', 'p2', 'info'),
        createMockViolation('3', 'p3', 'hint'),
      ];
      expect(manager.hasBlockingViolations(violations)).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(manager.hasBlockingViolations([])).toBe(false);
    });
  });

  describe('getBlockingViolationCount', () => {
    it('should count error violations', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'error'),
        createMockViolation('3', 'p3', 'warning'),
      ];
      expect(manager.getBlockingViolationCount(violations)).toBe(2);
    });

    it('should return 0 when no error violations', () => {
      const violations = [
        createMockViolation('1', 'p1', 'warning'),
        createMockViolation('2', 'p2', 'info'),
      ];
      expect(manager.getBlockingViolationCount(violations)).toBe(0);
    });
  });

  describe('sortBySeverity', () => {
    it('should sort violations by severity (most severe first)', () => {
      const violations = [
        createMockViolation('1', 'p1', 'hint'),
        createMockViolation('2', 'p2', 'error'),
        createMockViolation('3', 'p3', 'warning'),
        createMockViolation('4', 'p4', 'info'),
      ];

      const sorted = manager.sortBySeverity(violations);

      expect(sorted[0].severity).toBe('error');
      expect(sorted[1].severity).toBe('warning');
      expect(sorted[2].severity).toBe('info');
      expect(sorted[3].severity).toBe('hint');
    });

    it('should not modify original array', () => {
      const violations = [
        createMockViolation('1', 'p1', 'hint'),
        createMockViolation('2', 'p2', 'error'),
      ];

      manager.sortBySeverity(violations);

      expect(violations[0].severity).toBe('hint');
      expect(violations[1].severity).toBe('error');
    });

    it('should handle empty array', () => {
      const sorted = manager.sortBySeverity([]);
      expect(sorted).toEqual([]);
    });

    it('should handle single element', () => {
      const violations = [createMockViolation('1', 'p1', 'warning')];
      const sorted = manager.sortBySeverity(violations);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].severity).toBe('warning');
    });
  });

  describe('sortBySeverityAscending', () => {
    it('should sort violations by severity (least severe first)', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'hint'),
        createMockViolation('3', 'p3', 'warning'),
        createMockViolation('4', 'p4', 'info'),
      ];

      const sorted = manager.sortBySeverityAscending(violations);

      expect(sorted[0].severity).toBe('hint');
      expect(sorted[1].severity).toBe('info');
      expect(sorted[2].severity).toBe('warning');
      expect(sorted[3].severity).toBe('error');
    });
  });

  describe('groupBySeverity', () => {
    it('should group violations by severity', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'warning'),
        createMockViolation('3', 'p3', 'error'),
        createMockViolation('4', 'p4', 'info'),
      ];

      const groups = manager.groupBySeverity(violations);

      expect(groups.error).toHaveLength(2);
      expect(groups.warning).toHaveLength(1);
      expect(groups.info).toHaveLength(1);
      expect(groups.hint).toHaveLength(0);
    });

    it('should return empty arrays for missing severities', () => {
      const violations = [createMockViolation('1', 'p1', 'error')];

      const groups = manager.groupBySeverity(violations);

      expect(groups.error).toHaveLength(1);
      expect(groups.warning).toHaveLength(0);
      expect(groups.info).toHaveLength(0);
      expect(groups.hint).toHaveLength(0);
    });
  });

  describe('filterByMinSeverity', () => {
    it('should filter violations by minimum severity', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'warning'),
        createMockViolation('3', 'p3', 'info'),
        createMockViolation('4', 'p4', 'hint'),
      ];

      const filtered = manager.filterByMinSeverity(violations, 'warning');

      expect(filtered).toHaveLength(2);
      expect(filtered.map((v) => v.severity)).toContain('error');
      expect(filtered.map((v) => v.severity)).toContain('warning');
    });

    it('should include all violations when min is hint', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'hint'),
      ];

      const filtered = manager.filterByMinSeverity(violations, 'hint');

      expect(filtered).toHaveLength(2);
    });

    it('should only include errors when min is error', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'warning'),
      ];

      const filtered = manager.filterByMinSeverity(violations, 'error');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].severity).toBe('error');
    });
  });

  describe('filterByMaxSeverity', () => {
    it('should filter violations by maximum severity', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'warning'),
        createMockViolation('3', 'p3', 'info'),
        createMockViolation('4', 'p4', 'hint'),
      ];

      const filtered = manager.filterByMaxSeverity(violations, 'info');

      expect(filtered).toHaveLength(2);
      expect(filtered.map((v) => v.severity)).toContain('info');
      expect(filtered.map((v) => v.severity)).toContain('hint');
    });
  });

  describe('compareSeverity', () => {
    it('should return positive when a is more severe', () => {
      expect(manager.compareSeverity('error', 'warning')).toBeGreaterThan(0);
      expect(manager.compareSeverity('warning', 'info')).toBeGreaterThan(0);
      expect(manager.compareSeverity('info', 'hint')).toBeGreaterThan(0);
    });

    it('should return negative when a is less severe', () => {
      expect(manager.compareSeverity('warning', 'error')).toBeLessThan(0);
      expect(manager.compareSeverity('info', 'warning')).toBeLessThan(0);
      expect(manager.compareSeverity('hint', 'info')).toBeLessThan(0);
    });

    it('should return 0 when equal', () => {
      expect(manager.compareSeverity('error', 'error')).toBe(0);
      expect(manager.compareSeverity('warning', 'warning')).toBe(0);
      expect(manager.compareSeverity('info', 'info')).toBe(0);
      expect(manager.compareSeverity('hint', 'hint')).toBe(0);
    });
  });

  describe('isMoreSevere', () => {
    it('should return true when a is more severe than b', () => {
      expect(manager.isMoreSevere('error', 'warning')).toBe(true);
      expect(manager.isMoreSevere('error', 'hint')).toBe(true);
    });

    it('should return false when a is not more severe than b', () => {
      expect(manager.isMoreSevere('warning', 'error')).toBe(false);
      expect(manager.isMoreSevere('error', 'error')).toBe(false);
    });
  });

  describe('isLessSevere', () => {
    it('should return true when a is less severe than b', () => {
      expect(manager.isLessSevere('warning', 'error')).toBe(true);
      expect(manager.isLessSevere('hint', 'error')).toBe(true);
    });

    it('should return false when a is not less severe than b', () => {
      expect(manager.isLessSevere('error', 'warning')).toBe(false);
      expect(manager.isLessSevere('error', 'error')).toBe(false);
    });
  });

  describe('getMostSevere', () => {
    it('should return the most severe from a list', () => {
      expect(manager.getMostSevere(['warning', 'error', 'info'])).toBe('error');
      expect(manager.getMostSevere(['warning', 'info', 'hint'])).toBe('warning');
    });

    it('should return hint for empty array', () => {
      expect(manager.getMostSevere([])).toBe('hint');
    });

    it('should handle single element', () => {
      expect(manager.getMostSevere(['info'])).toBe('info');
    });
  });

  describe('getLeastSevere', () => {
    it('should return the least severe from a list', () => {
      expect(manager.getLeastSevere(['warning', 'error', 'info'])).toBe('info');
      expect(manager.getLeastSevere(['warning', 'info', 'hint'])).toBe('hint');
    });

    it('should return error for empty array', () => {
      expect(manager.getLeastSevere([])).toBe('error');
    });

    it('should handle single element', () => {
      expect(manager.getLeastSevere(['info'])).toBe('info');
    });
  });

  describe('escalation', () => {
    beforeEach(() => {
      manager = new SeverityManager({
        escalation: {
          enabled: true,
          threshold: 10,
          rules: [
            { from: 'hint', to: 'info', afterCount: 5 },
            { from: 'info', to: 'warning', afterCount: 5 },
            { from: 'warning', to: 'error', afterCount: 5 },
          ],
        },
      });
    });

    it('should not escalate when disabled', () => {
      manager.setEscalationEnabled(false);
      // Record many violations
      for (let i = 0; i < 10; i++) {
        manager.recordViolation('pattern-1', 'structural');
      }

      const severity = manager.getEffectiveSeverityWithEscalation(
        'pattern-1',
        'structural'
      );
      expect(severity).toBe('warning'); // Default for structural
    });

    it('should escalate after threshold is reached', () => {
      // Record violations to trigger escalation
      for (let i = 0; i < 5; i++) {
        manager.recordViolation('pattern-1', 'structural');
      }

      const severity = manager.getEffectiveSeverityWithEscalation(
        'pattern-1',
        'structural'
      );
      // structural defaults to warning, should escalate to error
      expect(severity).toBe('error');
    });

    it('should not escalate before threshold', () => {
      // Record fewer violations than threshold
      for (let i = 0; i < 4; i++) {
        manager.recordViolation('pattern-1', 'structural');
      }

      const severity = manager.getEffectiveSeverityWithEscalation(
        'pattern-1',
        'structural'
      );
      expect(severity).toBe('warning'); // No escalation
    });

    it('should escalate hint to info', () => {
      // Record violations for a hint-level pattern
      for (let i = 0; i < 5; i++) {
        manager.recordViolation('pattern-1', 'performance');
      }

      const severity = manager.getEffectiveSeverityWithEscalation(
        'pattern-1',
        'performance'
      );
      // performance defaults to hint, should escalate to info
      expect(severity).toBe('info');
    });

    it('should use category count for escalation', () => {
      // Record violations for different patterns in same category
      for (let i = 0; i < 3; i++) {
        manager.recordViolation('pattern-1', 'structural');
      }
      for (let i = 0; i < 3; i++) {
        manager.recordViolation('pattern-2', 'structural');
      }

      // Category count is 6, should trigger escalation
      const severity = manager.getEffectiveSeverityWithEscalation(
        'pattern-3',
        'structural'
      );
      expect(severity).toBe('error');
    });

    it('should reset violation counts', () => {
      for (let i = 0; i < 10; i++) {
        manager.recordViolation('pattern-1', 'structural');
      }

      manager.resetViolationCounts();
      const counts = manager.getViolationCounts();

      expect(counts.total).toBe(0);
      expect(counts.byPattern).toEqual({});
      expect(counts.byCategory).toEqual({});
    });

    it('should track violation counts correctly', () => {
      manager.recordViolation('pattern-1', 'structural');
      manager.recordViolation('pattern-1', 'structural');
      manager.recordViolation('pattern-2', 'security');

      const counts = manager.getViolationCounts();

      expect(counts.total).toBe(3);
      expect(counts.byPattern['pattern-1']).toBe(2);
      expect(counts.byPattern['pattern-2']).toBe(1);
      expect(counts.byCategory['structural']).toBe(2);
      expect(counts.byCategory['security']).toBe(1);
    });
  });

  describe('override management', () => {
    it('should set and remove pattern overrides', () => {
      manager.setPatternOverride('pattern-1', 'error');
      expect(manager.getEffectiveSeverity('pattern-1', 'structural')).toBe('error');

      manager.removePatternOverride('pattern-1');
      expect(manager.getEffectiveSeverity('pattern-1', 'structural')).toBe('warning');
    });

    it('should set and remove category overrides', () => {
      manager.setCategoryOverride('structural', 'hint');
      expect(manager.getEffectiveSeverity('pattern-1', 'structural')).toBe('hint');

      manager.removeCategoryOverride('structural');
      expect(manager.getEffectiveSeverity('pattern-1', 'structural')).toBe('warning');
    });
  });

  describe('escalation configuration', () => {
    it('should enable/disable escalation', () => {
      manager.setEscalationEnabled(true);
      expect(manager.getConfig().escalation.enabled).toBe(true);

      manager.setEscalationEnabled(false);
      expect(manager.getConfig().escalation.enabled).toBe(false);
    });

    it('should set escalation threshold', () => {
      manager.setEscalationThreshold(20);
      expect(manager.getConfig().escalation.threshold).toBe(20);
    });

    it('should set escalation rules', () => {
      const rules = [{ from: 'info' as Severity, to: 'error' as Severity, afterCount: 3 }];
      manager.setEscalationRules(rules);
      expect(manager.getConfig().escalation.rules).toEqual(rules);
    });

    it('should add escalation rule', () => {
      const initialRules = manager.getConfig().escalation.rules.length;
      manager.addEscalationRule({ from: 'hint', to: 'error', afterCount: 100 });
      expect(manager.getConfig().escalation.rules.length).toBe(initialRules + 1);
    });
  });

  describe('toSeverityConfig', () => {
    it('should create SeverityConfig from current state', () => {
      manager.setPatternOverride('pattern-1', 'error');
      manager.setCategoryOverride('structural', 'info');

      const config = manager.toSeverityConfig();

      expect(config.default).toBe('warning');
      expect(config.overrides['pattern-1']).toBe('error');
      expect(config.categoryOverrides['structural']).toBe('info');
    });
  });

  describe('fromSeverityConfig', () => {
    it('should create SeverityManager from SeverityConfig', () => {
      const config = {
        default: 'info' as Severity,
        overrides: { 'pattern-1': 'error' as Severity },
        categoryOverrides: { structural: 'hint' as Severity },
        escalation: {
          enabled: true,
          threshold: 5,
          rules: [{ from: 'warning' as Severity, to: 'error' as Severity, afterCount: 5 }],
        },
      };

      const m = SeverityManager.fromSeverityConfig(config);
      const resultConfig = m.getConfig();

      expect(resultConfig.defaultSeverity).toBe('info');
      expect(resultConfig.patternOverrides['pattern-1']).toBe('error');
      expect(resultConfig.categoryOverrides['structural']).toBe('hint');
      expect(resultConfig.escalation.enabled).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of configuration', () => {
      const config = manager.getConfig();
      config.defaultSeverity = 'error';
      config.patternOverrides['test'] = 'hint';

      // Original should not be modified
      expect(manager.getConfig().defaultSeverity).toBe('warning');
      expect(manager.getConfig().patternOverrides['test']).toBeUndefined();
    });
  });
});


describe('Utility Functions', () => {
  describe('getDefaultCategorySeverity', () => {
    it('should return correct default severity for each category', () => {
      expect(getDefaultCategorySeverity('security')).toBe('error');
      expect(getDefaultCategorySeverity('auth')).toBe('error');
      expect(getDefaultCategorySeverity('structural')).toBe('warning');
      expect(getDefaultCategorySeverity('styling')).toBe('info');
      expect(getDefaultCategorySeverity('performance')).toBe('hint');
    });

    it('should return warning for unknown category', () => {
      expect(getDefaultCategorySeverity('unknown' as PatternCategory)).toBe('warning');
    });
  });

  describe('isBlockingSeverity', () => {
    it('should return true only for error', () => {
      expect(isBlockingSeverity('error')).toBe(true);
      expect(isBlockingSeverity('warning')).toBe(false);
      expect(isBlockingSeverity('info')).toBe(false);
      expect(isBlockingSeverity('hint')).toBe(false);
    });
  });

  describe('compareSeverity', () => {
    it('should compare severity levels correctly', () => {
      expect(compareSeverity('error', 'warning')).toBeGreaterThan(0);
      expect(compareSeverity('warning', 'error')).toBeLessThan(0);
      expect(compareSeverity('error', 'error')).toBe(0);
    });
  });

  describe('sortViolationsBySeverity', () => {
    it('should sort violations by severity (most severe first)', () => {
      const violations = [
        createMockViolation('1', 'p1', 'info'),
        createMockViolation('2', 'p2', 'error'),
        createMockViolation('3', 'p3', 'hint'),
      ];

      const sorted = sortViolationsBySeverity(violations);

      expect(sorted[0].severity).toBe('error');
      expect(sorted[1].severity).toBe('info');
      expect(sorted[2].severity).toBe('hint');
    });

    it('should not modify original array', () => {
      const violations = [
        createMockViolation('1', 'p1', 'hint'),
        createMockViolation('2', 'p2', 'error'),
      ];

      sortViolationsBySeverity(violations);

      expect(violations[0].severity).toBe('hint');
    });
  });

  describe('getSeveritySummary', () => {
    it('should count violations by severity', () => {
      const violations = [
        createMockViolation('1', 'p1', 'error'),
        createMockViolation('2', 'p2', 'error'),
        createMockViolation('3', 'p3', 'warning'),
        createMockViolation('4', 'p4', 'info'),
      ];

      const summary = getSeveritySummary(violations);

      expect(summary.error).toBe(2);
      expect(summary.warning).toBe(1);
      expect(summary.info).toBe(1);
      expect(summary.hint).toBe(0);
    });

    it('should return zeros for empty array', () => {
      const summary = getSeveritySummary([]);

      expect(summary.error).toBe(0);
      expect(summary.warning).toBe(0);
      expect(summary.info).toBe(0);
      expect(summary.hint).toBe(0);
    });
  });

  describe('createSeverityManager', () => {
    it('should create a manager with default configuration', () => {
      const manager = createSeverityManager();
      expect(manager.getConfig().defaultSeverity).toBe('warning');
    });
  });

  describe('createSeverityManagerFromConfig', () => {
    it('should create a manager with severity overrides', () => {
      const manager = createSeverityManagerFromConfig({
        'pattern-1': 'error',
        'pattern-2': 'hint',
      });

      expect(manager.getEffectiveSeverity('pattern-1', 'structural')).toBe('error');
      expect(manager.getEffectiveSeverity('pattern-2', 'structural')).toBe('hint');
    });

    it('should handle undefined overrides', () => {
      const manager = createSeverityManagerFromConfig(undefined);
      expect(manager.getConfig().patternOverrides).toEqual({});
    });
  });
});

describe('DEFAULT_CATEGORY_SEVERITY', () => {
  it('should have severity for all pattern categories', () => {
    const categories: PatternCategory[] = [
      'structural',
      'components',
      'styling',
      'api',
      'auth',
      'errors',
      'data-access',
      'testing',
      'logging',
      'security',
      'config',
      'types',
      'performance',
      'accessibility',
      'documentation',
    ];

    for (const category of categories) {
      expect(DEFAULT_CATEGORY_SEVERITY[category]).toBeDefined();
    }
  });

  it('should have security-related categories as error', () => {
    expect(DEFAULT_CATEGORY_SEVERITY['security']).toBe('error');
    expect(DEFAULT_CATEGORY_SEVERITY['auth']).toBe('error');
  });
});

describe('DEFAULT_ESCALATION_RULES', () => {
  it('should have rules for escalating each non-error severity', () => {
    const fromSeverities = DEFAULT_ESCALATION_RULES.map((r) => r.from);
    expect(fromSeverities).toContain('hint');
    expect(fromSeverities).toContain('info');
    expect(fromSeverities).toContain('warning');
  });

  it('should not have rule from error (cannot escalate further)', () => {
    const fromSeverities = DEFAULT_ESCALATION_RULES.map((r) => r.from);
    expect(fromSeverities).not.toContain('error');
  });
});

describe('Integration tests', () => {
  it('should handle complex override scenarios', () => {
    const manager = new SeverityManager({
      defaultSeverity: 'info',
      patternOverrides: {
        'critical-pattern': 'error',
      },
      categoryOverrides: {
        security: 'warning', // Override default error
      },
    });

    // Pattern override takes precedence
    expect(manager.getEffectiveSeverity('critical-pattern', 'structural')).toBe('error');

    // Category override applies
    expect(manager.getEffectiveSeverity('some-pattern', 'security')).toBe('warning');

    // Default category severity applies
    expect(manager.getEffectiveSeverity('some-pattern', 'auth')).toBe('error');

    // Default severity applies for unknown
    expect(manager.getEffectiveSeverity('some-pattern', 'unknown' as PatternCategory)).toBe('info');
  });

  it('should correctly determine blocking status for mixed violations', () => {
    const manager = new SeverityManager();
    const violations = [
      createMockViolation('1', 'p1', 'warning'),
      createMockViolation('2', 'p2', 'info'),
      createMockViolation('3', 'p3', 'hint'),
    ];

    expect(manager.hasBlockingViolations(violations)).toBe(false);

    violations.push(createMockViolation('4', 'p4', 'error'));
    expect(manager.hasBlockingViolations(violations)).toBe(true);
  });
});
