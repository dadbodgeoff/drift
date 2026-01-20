/**
 * Property Test for CLI Exit Code Consistency
 *
 * **Property 10: CLI Exit Code Consistency**
 * Violations >= threshold → exit 1
 *
 * **Validates: Requirements 29.9, 30.4**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Violation, Severity } from 'driftdetect-core';

/**
 * Severity order for comparison
 */
const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

/**
 * Determine exit code based on violations and threshold
 * This is the function under test - extracted from check.ts
 */
function getExitCode(
  violations: Violation[],
  failOn: 'error' | 'warning' | 'none'
): number {
  if (failOn === 'none') {
    return 0;
  }

  const threshold = SEVERITY_ORDER[failOn];
  const hasViolationsAboveThreshold = violations.some(
    (v) => SEVERITY_ORDER[v.severity] >= threshold
  );

  return hasViolationsAboveThreshold ? 1 : 0;
}

/**
 * Generate a mock violation with a given severity
 */
function createMockViolation(severity: Severity): Violation {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    patternId: 'test-pattern',
    severity,
    file: 'test.ts',
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 10 },
    },
    message: 'Test violation',
    expected: 'expected',
    actual: 'actual',
    aiExplainAvailable: false,
    aiFixAvailable: false,
    firstSeen: new Date(),
    occurrences: 1,
  };
}

/**
 * Arbitrary for generating severity levels
 */
const severityArb = fc.constantFrom<Severity>('error', 'warning', 'info', 'hint');

/**
 * Arbitrary for generating fail-on thresholds
 */
const failOnArb = fc.constantFrom<'error' | 'warning' | 'none'>('error', 'warning', 'none');

/**
 * Arbitrary for generating arrays of violations
 */
const violationsArb = fc.array(
  severityArb.map((severity) => createMockViolation(severity)),
  { minLength: 0, maxLength: 20 }
);

describe('CLI Exit Code Consistency (Property 10)', () => {
  /**
   * Property: When failOn is 'none', exit code is always 0
   */
  it('should always return exit code 0 when failOn is "none"', () => {
    fc.assert(
      fc.property(violationsArb, (violations) => {
        const exitCode = getExitCode(violations, 'none');
        expect(exitCode).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When there are no violations, exit code is always 0
   */
  it('should always return exit code 0 when there are no violations', () => {
    fc.assert(
      fc.property(failOnArb, (failOn) => {
        const exitCode = getExitCode([], failOn);
        expect(exitCode).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When failOn is 'error' and there's at least one error, exit code is 1
   */
  it('should return exit code 1 when failOn is "error" and there are errors', () => {
    fc.assert(
      fc.property(
        fc.array(severityArb.map((s) => createMockViolation(s)), { minLength: 0, maxLength: 10 }),
        (otherViolations) => {
          // Add at least one error
          const violations = [...otherViolations, createMockViolation('error')];
          const exitCode = getExitCode(violations, 'error');
          expect(exitCode).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When failOn is 'warning' and there's at least one warning or error, exit code is 1
   */
  it('should return exit code 1 when failOn is "warning" and there are warnings or errors', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Severity>('error', 'warning'),
        fc.array(severityArb.map((s) => createMockViolation(s)), { minLength: 0, maxLength: 10 }),
        (highSeverity, otherViolations) => {
          // Add at least one warning or error
          const violations = [...otherViolations, createMockViolation(highSeverity)];
          const exitCode = getExitCode(violations, 'warning');
          expect(exitCode).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When failOn is 'error' and there are only warnings/info/hints, exit code is 0
   */
  it('should return exit code 0 when failOn is "error" and there are only lower severity violations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Severity>('warning', 'info', 'hint').map((s) => createMockViolation(s)),
          { minLength: 1, maxLength: 10 }
        ),
        (violations) => {
          const exitCode = getExitCode(violations, 'error');
          expect(exitCode).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When failOn is 'warning' and there are only info/hints, exit code is 0
   */
  it('should return exit code 0 when failOn is "warning" and there are only info/hint violations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<Severity>('info', 'hint').map((s) => createMockViolation(s)),
          { minLength: 1, maxLength: 10 }
        ),
        (violations) => {
          const exitCode = getExitCode(violations, 'warning');
          expect(exitCode).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Exit code is deterministic - same input always produces same output
   */
  it('should be deterministic - same violations and threshold produce same exit code', () => {
    fc.assert(
      fc.property(violationsArb, failOnArb, (violations, failOn) => {
        const exitCode1 = getExitCode(violations, failOn);
        const exitCode2 = getExitCode(violations, failOn);
        expect(exitCode1).toBe(exitCode2);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Exit code is binary - always 0 or 1
   */
  it('should always return 0 or 1', () => {
    fc.assert(
      fc.property(violationsArb, failOnArb, (violations, failOn) => {
        const exitCode = getExitCode(violations, failOn);
        expect([0, 1]).toContain(exitCode);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Severity ordering is respected
   * If a violation at severity S causes exit 1, then any violation at severity >= S also causes exit 1
   */
  it('should respect severity ordering - higher severity always triggers if lower does', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'error' | 'warning'>('error', 'warning'),
        (failOn) => {
          // Test that error always triggers when warning triggers
          const warningViolation = [createMockViolation('warning')];
          const errorViolation = [createMockViolation('error')];

          const warningExitCode = getExitCode(warningViolation, failOn);
          const errorExitCode = getExitCode(errorViolation, failOn);

          // If warning triggers exit 1, error must also trigger exit 1
          if (warningExitCode === 1) {
            expect(errorExitCode).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Adding more violations never decreases exit code
   * (monotonicity - more violations can only make things worse or stay the same)
   */
  it('should be monotonic - adding violations never decreases exit code', () => {
    fc.assert(
      fc.property(
        violationsArb,
        severityArb.map((s) => createMockViolation(s)),
        failOnArb,
        (violations, newViolation, failOn) => {
          const exitCodeBefore = getExitCode(violations, failOn);
          const exitCodeAfter = getExitCode([...violations, newViolation], failOn);

          // Exit code should never decrease when adding violations
          expect(exitCodeAfter).toBeGreaterThanOrEqual(exitCodeBefore);
        }
      ),
      { numRuns: 100 }
    );
  });
});
