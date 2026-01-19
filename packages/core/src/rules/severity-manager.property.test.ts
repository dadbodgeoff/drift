/**
 * Property-Based Tests for SeverityManager
 *
 * Property 6: Violation Severity Ordering
 * For any two violations where one has severity "error" and another has severity "warning",
 * the error SHALL be reported before the warning in sorted output.
 * **Validates: Requirements 24.1, 24.2, 24.3**
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 * @requirements 24.2 - WHEN severity is error, THE Violation SHALL block commits and merges
 * @requirements 24.3 - WHEN severity is warning, THE Violation SHALL be displayed but not block
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  SeverityManager,
  sortViolationsBySeverity,
  compareSeverity,
} from './severity-manager.js';
import type { Violation } from './types.js';
import { SEVERITY_ORDER, SEVERITY_LEVELS } from './types.js';
import type { Severity } from '../store/types.js';

// ============================================================================
// Arbitraries for generating test data
// ============================================================================

/**
 * Arbitrary for generating valid severity levels
 */
const severityArb: fc.Arbitrary<Severity> = fc.constantFrom(
  'error',
  'warning',
  'info',
  'hint'
);

/**
 * Arbitrary for generating a valid Position
 */
const positionArb = fc.record({
  line: fc.integer({ min: 0, max: 10000 }),
  character: fc.integer({ min: 0, max: 1000 }),
});

/**
 * Arbitrary for generating a valid Range
 */
const rangeArb = fc.record({
  start: positionArb,
  end: positionArb,
});

/**
 * Arbitrary for generating a valid Violation
 */
const violationArb: fc.Arbitrary<Violation> = fc.record({
  id: fc.uuid(),
  patternId: fc.string({ minLength: 1, maxLength: 50 }),
  severity: severityArb,
  file: fc.string({ minLength: 1, maxLength: 100 }),
  range: rangeArb,
  message: fc.string({ minLength: 1, maxLength: 200 }),
  explanation: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
  expected: fc.string({ minLength: 1, maxLength: 100 }),
  actual: fc.string({ minLength: 1, maxLength: 100 }),
  quickFix: fc.constant(undefined),
  aiExplainAvailable: fc.boolean(),
  aiFixAvailable: fc.boolean(),
  firstSeen: fc.date(),
  occurrences: fc.integer({ min: 1, max: 1000 }),
});

/**
 * Arbitrary for generating an array of violations with mixed severities
 */
const violationArrayArb = fc.array(violationArb, { minLength: 0, maxLength: 100 });

/**
 * Arbitrary for generating an array of violations that includes at least one error and one warning
 */
const mixedSeverityViolationsArb = fc
  .tuple(
    fc.array(violationArb.map((v) => ({ ...v, severity: 'error' as Severity })), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.array(violationArb.map((v) => ({ ...v, severity: 'warning' as Severity })), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.array(violationArb.map((v) => ({ ...v, severity: 'info' as Severity })), {
      minLength: 0,
      maxLength: 10,
    }),
    fc.array(violationArb.map((v) => ({ ...v, severity: 'hint' as Severity })), {
      minLength: 0,
      maxLength: 10,
    })
  )
  .map(([errors, warnings, infos, hints]) => {
    // Shuffle all violations together
    const all = [...errors, ...warnings, ...infos, ...hints];
    // Fisher-Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  });

/**
 * Arbitrary for generating pairs of different severity levels
 */
const severityPairArb = fc
  .tuple(severityArb, severityArb)
  .filter(([a, b]) => a !== b);

// ============================================================================
// Property Tests
// ============================================================================

describe('SeverityManager Property Tests', () => {
  /**
   * Property 6: Violation Severity Ordering
   * For any two violations where one has severity "error" and another has severity "warning",
   * the error SHALL be reported before the warning in sorted output.
   * **Validates: Requirements 24.1, 24.2, 24.3**
   */
  describe('Property 6: Violation Severity Ordering', () => {
    const manager = new SeverityManager();

    it('should always place errors before warnings in sorted output', async () => {
      await fc.assert(
        fc.asyncProperty(mixedSeverityViolationsArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);

          // Find indices of all errors and warnings
          const errorIndices: number[] = [];
          const warningIndices: number[] = [];

          sorted.forEach((v, index) => {
            if (v.severity === 'error') errorIndices.push(index);
            if (v.severity === 'warning') warningIndices.push(index);
          });

          // PROPERTY: All error indices SHALL be less than all warning indices
          // (errors come before warnings)
          for (const errorIdx of errorIndices) {
            for (const warningIdx of warningIndices) {
              expect(errorIdx).toBeLessThan(warningIdx);
            }
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always place warnings before info in sorted output', async () => {
      await fc.assert(
        fc.asyncProperty(mixedSeverityViolationsArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);

          // Find indices of all warnings and info
          const warningIndices: number[] = [];
          const infoIndices: number[] = [];

          sorted.forEach((v, index) => {
            if (v.severity === 'warning') warningIndices.push(index);
            if (v.severity === 'info') infoIndices.push(index);
          });

          // PROPERTY: All warning indices SHALL be less than all info indices
          for (const warningIdx of warningIndices) {
            for (const infoIdx of infoIndices) {
              expect(warningIdx).toBeLessThan(infoIdx);
            }
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should always place info before hints in sorted output', async () => {
      await fc.assert(
        fc.asyncProperty(mixedSeverityViolationsArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);

          // Find indices of all info and hints
          const infoIndices: number[] = [];
          const hintIndices: number[] = [];

          sorted.forEach((v, index) => {
            if (v.severity === 'info') infoIndices.push(index);
            if (v.severity === 'hint') hintIndices.push(index);
          });

          // PROPERTY: All info indices SHALL be less than all hint indices
          for (const infoIdx of infoIndices) {
            for (const hintIdx of hintIndices) {
              expect(infoIdx).toBeLessThan(hintIdx);
            }
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should maintain complete severity ordering: error > warning > info > hint', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);

          // PROPERTY: For any adjacent pair in sorted output,
          // the first SHALL have severity >= the second
          for (let i = 0; i < sorted.length - 1; i++) {
            const currentOrder = SEVERITY_ORDER[sorted[i].severity];
            const nextOrder = SEVERITY_ORDER[sorted[i + 1].severity];
            expect(currentOrder).toBeGreaterThanOrEqual(nextOrder);
          }

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should produce same ordering using sortViolationsBySeverity utility function', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          const sortedByManager = manager.sortBySeverity(violations);
          const sortedByUtility = sortViolationsBySeverity(violations);

          // PROPERTY: Both sorting methods SHALL produce the same severity ordering
          expect(sortedByManager.length).toBe(sortedByUtility.length);

          for (let i = 0; i < sortedByManager.length; i++) {
            expect(sortedByManager[i].severity).toBe(sortedByUtility[i].severity);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should not modify the original array when sorting', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          // Create a copy of original severities
          const originalSeverities = violations.map((v) => v.severity);

          // Sort
          manager.sortBySeverity(violations);

          // PROPERTY: Original array SHALL remain unchanged
          const afterSeverities = violations.map((v) => v.severity);
          expect(afterSeverities).toEqual(originalSeverities);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all violations when sorting (no loss of data)', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);

          // PROPERTY: Sorted array SHALL have same length as original
          expect(sorted.length).toBe(violations.length);

          // PROPERTY: All original violation IDs SHALL be present in sorted array
          const originalIds = new Set(violations.map((v) => v.id));
          const sortedIds = new Set(sorted.map((v) => v.id));
          expect(sortedIds).toEqual(originalIds);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty arrays correctly', async () => {
      const sorted = manager.sortBySeverity([]);
      expect(sorted).toEqual([]);
    });

    it('should handle single-element arrays correctly', async () => {
      await fc.assert(
        fc.asyncProperty(violationArb, async (violation) => {
          const sorted = manager.sortBySeverity([violation]);

          // PROPERTY: Single element array SHALL remain unchanged
          expect(sorted.length).toBe(1);
          expect(sorted[0].id).toBe(violation.id);
          expect(sorted[0].severity).toBe(violation.severity);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should produce stable sort for violations with same severity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            violationArb.map((v) => ({ ...v, severity: 'warning' as Severity })),
            { minLength: 2, maxLength: 50 }
          ),
          async (violations) => {
            const sorted = manager.sortBySeverity(violations);

            // PROPERTY: All violations SHALL have the same severity
            for (const v of sorted) {
              expect(v.severity).toBe('warning');
            }

            // PROPERTY: Length SHALL be preserved
            expect(sorted.length).toBe(violations.length);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should correctly compare any two severity levels', async () => {
      await fc.assert(
        fc.asyncProperty(severityPairArb, async ([severityA, severityB]) => {
          const comparison = compareSeverity(severityA, severityB);
          const orderA = SEVERITY_ORDER[severityA];
          const orderB = SEVERITY_ORDER[severityB];

          // PROPERTY: compareSeverity SHALL return positive when A is more severe
          if (orderA > orderB) {
            expect(comparison).toBeGreaterThan(0);
          }

          // PROPERTY: compareSeverity SHALL return negative when A is less severe
          if (orderA < orderB) {
            expect(comparison).toBeLessThan(0);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should return 0 when comparing same severity levels', async () => {
      await fc.assert(
        fc.asyncProperty(severityArb, async (severity) => {
          const comparison = compareSeverity(severity, severity);

          // PROPERTY: Comparing same severity SHALL return 0
          expect(comparison).toBe(0);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should maintain transitivity in severity ordering', async () => {
      // error > warning > info > hint
      // If A > B and B > C, then A > C
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(severityArb, severityArb, severityArb),
          async ([a, b, c]) => {
            const orderA = SEVERITY_ORDER[a];
            const orderB = SEVERITY_ORDER[b];
            const orderC = SEVERITY_ORDER[c];

            // PROPERTY: Transitivity SHALL hold
            if (orderA > orderB && orderB > orderC) {
              expect(orderA).toBeGreaterThan(orderC);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify blocking violations (errors only)', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);
          const hasBlocking = manager.hasBlockingViolations(sorted);
          const hasErrors = sorted.some((v) => v.severity === 'error');

          // PROPERTY: hasBlockingViolations SHALL return true iff there are errors
          expect(hasBlocking).toBe(hasErrors);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should place all blocking violations at the beginning of sorted output', async () => {
      await fc.assert(
        fc.asyncProperty(mixedSeverityViolationsArb, async (violations) => {
          const sorted = manager.sortBySeverity(violations);
          const blockingCount = manager.getBlockingViolationCount(sorted);

          // PROPERTY: First N violations SHALL all be blocking (errors)
          // where N is the blocking violation count
          for (let i = 0; i < blockingCount; i++) {
            expect(manager.isBlocking(sorted[i].severity)).toBe(true);
          }

          // PROPERTY: Remaining violations SHALL NOT be blocking
          for (let i = blockingCount; i < sorted.length; i++) {
            expect(manager.isBlocking(sorted[i].severity)).toBe(false);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly group violations by severity', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, async (violations) => {
          const groups = manager.groupBySeverity(violations);

          // PROPERTY: Total count across groups SHALL equal original count
          const totalGrouped =
            groups.error.length +
            groups.warning.length +
            groups.info.length +
            groups.hint.length;
          expect(totalGrouped).toBe(violations.length);

          // PROPERTY: Each violation SHALL be in the correct group
          for (const v of groups.error) {
            expect(v.severity).toBe('error');
          }
          for (const v of groups.warning) {
            expect(v.severity).toBe('warning');
          }
          for (const v of groups.info) {
            expect(v.severity).toBe('info');
          }
          for (const v of groups.hint) {
            expect(v.severity).toBe('hint');
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly filter by minimum severity', async () => {
      await fc.assert(
        fc.asyncProperty(violationArrayArb, severityArb, async (violations, minSeverity) => {
          const filtered = manager.filterByMinSeverity(violations, minSeverity);
          const minOrder = SEVERITY_ORDER[minSeverity];

          // PROPERTY: All filtered violations SHALL have severity >= minSeverity
          for (const v of filtered) {
            expect(SEVERITY_ORDER[v.severity]).toBeGreaterThanOrEqual(minOrder);
          }

          // PROPERTY: No violations with severity < minSeverity SHALL be included
          const excludedCount = violations.filter(
            (v) => SEVERITY_ORDER[v.severity] < minOrder
          ).length;
          expect(filtered.length).toBe(violations.length - excludedCount);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly identify most and least severe from a list', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(severityArb, { minLength: 1, maxLength: 50 }),
          async (severities) => {
            const mostSevere = manager.getMostSevere(severities);
            const leastSevere = manager.getLeastSevere(severities);

            const maxOrder = Math.max(...severities.map((s) => SEVERITY_ORDER[s]));
            const minOrder = Math.min(...severities.map((s) => SEVERITY_ORDER[s]));

            // PROPERTY: getMostSevere SHALL return severity with highest order
            expect(SEVERITY_ORDER[mostSevere]).toBe(maxOrder);

            // PROPERTY: getLeastSevere SHALL return severity with lowest order
            expect(SEVERITY_ORDER[leastSevere]).toBe(minOrder);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
