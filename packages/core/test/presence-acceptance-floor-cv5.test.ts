import { describe, expect, it } from "vitest";
import {
  PRESENCE_AUTO_ACCEPT_MIN_COVERAGE,
  PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES,
  presenceAutoAcceptDecision
} from "../src/capabilities.js";

/**
 * CV-5: the auto-acceptance floor for presence families.
 *
 * Pre-registered in docs/internal/beta-run/CV-5-ACCEPTANCE-FLOOR.md and committed at 34a82807 - before the
 * implementation and before the measurement. These tests pin the constants themselves, so moving
 * either one is a visible decision rather than a quiet retune.
 *
 * The negative controls come first, and they are the reason there are two floors instead of one: each
 * floor alone admits a mistake the other catches.
 */

const candidate = (input: {
  coverage: number;
  files: number;
  kind?: string;
  presence?: boolean;
}) => ({
  kind: input.kind ?? "api_route_requires_auth_helper",
  matcher: input.presence === false ? {} : { enforcement_semantics: "presence" },
  scoring: { coverage_ratio: input.coverage },
  evidence_refs: Array.from({ length: input.files }, (_, index) => ({
    file_path: `app/api/r${index}/route.ts`
  }))
});

describe("CV-5 presence auto-acceptance floor", () => {
  it("pins the pre-registered constants", () => {
    // If either of these changes, the diff has to say why. "So the family we wanted gets accepted" is
    // not a why - that is the whole point of pre-registering them.
    expect(PRESENCE_AUTO_ACCEPT_MIN_COVERAGE).toBe(0.6);
    expect(PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES).toBe(20);
  });

  describe("negative controls", () => {
    it("refuses a high-coverage family with too little evidence", () => {
      // Why the evidence floor exists. Three of four routes is 0.75 coverage from three examples - a
      // coincidence with a good score, not a convention. The coverage floor alone would admit it.
      const decision = presenceAutoAcceptDecision(candidate({ coverage: 0.75, files: 3 }));
      expect(decision.eligible).toBe(false);
      expect(decision.below_floor_reason).toBe("evidence_files");
    });

    it("refuses a well-evidenced family with too little coverage", () => {
      // Why the coverage floor exists, and this is dub's rate-limit family: 26 evidence files clears
      // the evidence floor outright, and 7.3% coverage is a migration nobody agreed to. The evidence
      // floor alone would admit it.
      const decision = presenceAutoAcceptDecision(candidate({ coverage: 0.0728, files: 26 }));
      expect(decision.eligible).toBe(false);
      expect(decision.below_floor_reason).toBe("coverage");
    });

    it("refuses a family failing both, and says so", () => {
      const decision = presenceAutoAcceptDecision(candidate({ coverage: 0.1, files: 4 }));
      expect(decision.eligible).toBe(false);
      expect(decision.below_floor_reason).toBe("both");
    });

    it("never auto-accepts a quarantined proof candidate at any coverage", () => {
      // A guard-dominance candidate is not a floor question. It is excluded because it reasons about
      // control flow, and reporting "coverage too low" about it would misdescribe why it was skipped.
      const decision = presenceAutoAcceptDecision(
        candidate({ coverage: 0.99, files: 500, presence: false })
      );
      expect(decision.eligible).toBe(false);
      expect(decision.below_floor_reason).toBeNull();
    });

    it("never auto-accepts a presence-marked candidate of a non-promotable kind", () => {
      const decision = presenceAutoAcceptDecision(
        candidate({ coverage: 0.99, files: 500, kind: "api_route_cors_must_match_policy" })
      );
      expect(decision.eligible).toBe(false);
      expect(decision.below_floor_reason).toBeNull();
    });

    it("counts distinct files, not evidence refs", () => {
      // Twenty refs pointing at one file is one file's worth of evidence. Counting refs would let a
      // single heavily-referenced route clear an absolute floor meant to require breadth.
      const duplicated = {
        kind: "api_route_requires_auth_helper",
        matcher: { enforcement_semantics: "presence" },
        scoring: { coverage_ratio: 0.9 },
        evidence_refs: Array.from({ length: 40 }, () => ({ file_path: "app/api/one/route.ts" }))
      };
      const decision = presenceAutoAcceptDecision(duplicated);
      expect(decision.evidence_file_count).toBe(1);
      expect(decision.eligible).toBe(false);
    });
  });

  describe("acceptance", () => {
    it("accepts a family clearing both floors", () => {
      // dub's auth family: 0.7731 conditioned coverage over 276 files.
      const decision = presenceAutoAcceptDecision(candidate({ coverage: 0.7731, files: 276 }));
      expect(decision.eligible).toBe(true);
      expect(decision.below_floor_reason).toBeNull();
    });

    it("accepts exactly at both floors, not just above them", () => {
      // The boundary is inclusive. Pinned so a later refactor cannot quietly turn >= into >.
      const decision = presenceAutoAcceptDecision(
        candidate({ coverage: PRESENCE_AUTO_ACCEPT_MIN_COVERAGE, files: PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES })
      );
      expect(decision.eligible).toBe(true);
    });

    it("refuses one step below either floor", () => {
      expect(
        presenceAutoAcceptDecision(candidate({ coverage: 0.5999, files: 100 })).eligible
      ).toBe(false);
      expect(
        presenceAutoAcceptDecision(candidate({ coverage: 0.9, files: 19 })).eligible
      ).toBe(false);
    });

    it("reports the numbers that decided it, so the disclosure can print them", () => {
      const decision = presenceAutoAcceptDecision(candidate({ coverage: 0.0728, files: 26 }));
      expect(decision.coverage_ratio).toBe(0.0728);
      expect(decision.evidence_file_count).toBe(26);
    });
  });
});
