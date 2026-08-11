import { describe, expect, it } from "vitest";
import {
  CHECK_EXIT_BLOCKED,
  CHECK_EXIT_PASS,
  CHECK_EXIT_REFUSED,
  checkExitCodeFor,
  checkStatusFor,
  enforcementDegradedByCompleteness
} from "../src/check/run-check.js";

/**
 * S1-01. A finding demoted for incomplete coverage must never produce exit 0.
 *
 * The engine zeroes every finding's enforcement_result when any API-route file in the checked scope
 * carries an unresolved-import diagnostic (check_command.rs:276, gated on the single boolean at :37).
 * The CLI then exits `blockingCount > 0 ? 2 : 0`, and blockingCount is zero because everything was
 * demoted — so uncertainty is reported as success.
 *
 * The engine's demotion is contract-mandated: engine-contract fires only when some finding is
 * "block", so an all-"none" payload is legal at any completeness. Reporting *pass* is not mandated,
 * and that is what this changes. Exit 3 already means "no enforcement claim was made"
 * (run-check.ts:203 does exactly this for the TypeScript fallback); this is the same situation.
 */

const blockConvention = { enforcement_mode: "block" as const };

describe("enforcementDegradedByCompleteness", () => {
  it("is true when coverage is incomplete and a block-mode finding was zeroed", () => {
    expect(
      enforcementDegradedByCompleteness({
        findings: [{ enforcement_result: "none", convention: blockConvention }]
      })
    ).toBe(true);
  });

  it("is false when a block-mode finding actually carries block", () => {
    // The normal case, and the guard against over-refusal. `enforcement_result_for` maps block to
    // "block" and warn to "warn" unconditionally, so this is what complete coverage looks like.
    expect(
      enforcementDegradedByCompleteness({
        findings: [{ enforcement_result: "block", convention: blockConvention }]
      })
    ).toBe(false);
  });

  it("is false when a warn-mode finding actually carries warn", () => {
    expect(
      enforcementDegradedByCompleteness({
        findings: [{ enforcement_result: "warn", convention: { enforcement_mode: "warn" } }]
      })
    ).toBe(false);
  });

  it("is false when incomplete coverage zeroed nothing that would have enforced", () => {
    // A convention that is off anyway loses nothing to incompleteness, so refusing would be noise.
    expect(
      enforcementDegradedByCompleteness({
        findings: [{ enforcement_result: "none", convention: { enforcement_mode: "off" } }]
      })
    ).toBe(false);
  });

  it("is false when there are no findings at all", () => {
    expect(
      enforcementDegradedByCompleteness({
        findings: []
      })
    ).toBe(false);
  });
});

describe("checkExitCodeFor", () => {
  it("refuses rather than passing when enforcement was degraded", () => {
    expect(checkExitCodeFor({ blockingCount: 0, enforcementDegraded: true })).toBe(
      CHECK_EXIT_REFUSED
    );
  });

  it("still blocks when something actually blocks", () => {
    // Degradation must not mask a real violation into a refusal.
    expect(checkExitCodeFor({ blockingCount: 1, enforcementDegraded: true })).toBe(
      CHECK_EXIT_BLOCKED
    );
  });

  it("passes only when coverage was adequate and nothing blocked", () => {
    expect(checkExitCodeFor({ blockingCount: 0, enforcementDegraded: false })).toBe(CHECK_EXIT_PASS);
  });
});

/**
 * E-1 (S1-02 / B-3). The status must be the exit code's truth in the payload: exit 3 with
 * `check.status: "pass"` was the measured shape on cal.com at e0dc052 and is recorded on
 * every baseline row today. One decision, same inputs as the exit code, so the two can
 * never diverge.
 */
describe("checkStatusFor", () => {
  it("records refused when enforcement was degraded and nothing blocked", () => {
    expect(checkStatusFor({ blockingCount: 0, enforcementDegraded: true })).toBe("refused");
  });

  it("records fail when something actually blocks, even degraded", () => {
    expect(checkStatusFor({ blockingCount: 1, enforcementDegraded: true })).toBe("fail");
  });

  it("records pass only for a clean, fully-enforced check", () => {
    expect(checkStatusFor({ blockingCount: 0, enforcementDegraded: false })).toBe("pass");
  });

  it("agrees with the exit code on every input", () => {
    for (const blockingCount of [0, 1, 5]) {
      for (const enforcementDegraded of [false, true]) {
        const status = checkStatusFor({ blockingCount, enforcementDegraded });
        const exit = checkExitCodeFor({ blockingCount, enforcementDegraded });
        const expected = { [CHECK_EXIT_PASS]: "pass", [CHECK_EXIT_BLOCKED]: "fail", [CHECK_EXIT_REFUSED]: "refused" }[exit];
        expect(status).toBe(expected);
      }
    }
  });
});
