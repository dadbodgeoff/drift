import type { AcceptedConvention } from "@drift/core";
import { BetaStartResponseSchema } from "@drift/core";
import { describe, expect, it } from "vitest";

import { acceptanceDisclosure, acceptanceDisclosureLines } from "../src/domain/acceptance-disclosure.js";

/**
 * BB-3. `--accept-defaults` printed `"Accepted default convention."` whether it had installed a gate
 * or a suggestion box. Verified at b5c3c230: dub's acceptance lands warn mode (397 pre-existing
 * violations drive `baseline_coverage_direction` that way), cal.com's lands block — same sentence,
 * opposite products.
 *
 * These tests pin the sentence. They deliberately do not touch candidate scoring: if a change to
 * this item moves which mode a candidate earns, that is the T100 regression shape (an output change
 * and a threshold change arriving in one reviewable diff) and the DoD says the item was implemented
 * at the wrong seam.
 */

const convention = (overrides: Partial<AcceptedConvention> = {}): AcceptedConvention => ({
  id: "api_route_no_direct_data_access",
  contract_id: "contract_repo_abc",
  kind: "api_route_no_direct_data_access",
  statement: "API routes must not import the data layer directly.",
  scope: { include: ["app/api/**"], exclude: [] } as AcceptedConvention["scope"],
  matcher: { kind: "forbidden_imports", forbidden_imports: ["@/lib/prisma"] } as AcceptedConvention["matcher"],
  severity: "error",
  enforcement_mode: "warn",
  enforcement_capability: "deterministic_check",
  exceptions: [],
  evidence_refs: [],
  counterexample_refs: [],
  accepted_by: "cli",
  accepted_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
  ...overrides
});

describe("BB-3 acceptance disclosure", () => {
  it("names the mode, the baselined count, and the upgrade command in warn mode", () => {
    const disclosure = acceptanceDisclosure({
      // A real accepted id is a content hash; the sentence must name the kind instead, and the id
      // must still be the argument in the upgrade command.
      accepted: convention({ id: "convention_c8a97e3d4e5490d8", enforcement_mode: "warn" }),
      repoId: "repo_dub",
      baselinedCount: 397
    });
    const lines = acceptanceDisclosureLines(disclosure).join("\n");

    // The mode word: the fact agents read as "is this a real rule" (Q9/Q19, 2026-08-03).
    expect(lines).toContain('Accepted "api_route_no_direct_data_access" in WARN mode');
    expect(lines).not.toContain('Accepted "convention_c8a97e3d4e5490d8"');
    // The count: what makes "will NOT block" mean "already-existing debt", not "broken".
    expect(lines).toContain("397 existing violations baselined");
    expect(lines).toContain("new violations will be reported but will NOT block");
    // The exact upgrade command, runnable as printed.
    expect(lines).toContain(
      "drift conventions accept convention_c8a97e3d4e5490d8 --repo repo_dub --severity error --mode block --confirm"
    );
    expect(disclosure.blocks_new_violations).toBe(false);
  });

  it("states the blocking consequence and offers no upgrade in block mode", () => {
    const disclosure = acceptanceDisclosure({
      accepted: convention({ enforcement_mode: "block" }),
      repoId: "repo_calcom",
      baselinedCount: 12
    });
    const lines = acceptanceDisclosureLines(disclosure);

    expect(lines.join("\n")).toContain("BLOCK mode");
    expect(lines.join("\n")).toContain("new violations exit 2");
    expect(lines.join("\n")).toContain("12 existing violations baselined");
    expect(disclosure.upgrade_command).toBeNull();
    // No upgrade line at all - a gate does not need upgrading, and offering it would teach users
    // the sentence is boilerplate.
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("To make this a gate");
  });

  it("omits the baseline clause rather than saying zero", () => {
    const lines = acceptanceDisclosureLines(
      acceptanceDisclosure({ accepted: convention({ enforcement_mode: "block" }), repoId: "repo_clean", baselinedCount: 0 })
    ).join("\n");
    expect(lines).toBe('Accepted "api_route_no_direct_data_access" in BLOCK mode (new violations exit 2).');
  });

  it("says one violation, singular", () => {
    const lines = acceptanceDisclosureLines(
      acceptanceDisclosure({ accepted: convention(), repoId: "repo_one", baselinedCount: 1 })
    ).join("\n");
    expect(lines).toContain("1 existing violation baselined");
    expect(lines).not.toContain("1 existing violations");
  });

  it("names a non-blocking mode by its own name instead of collapsing it to WARN", () => {
    const disclosure = acceptanceDisclosure({
      accepted: convention({ enforcement_mode: "brief" }),
      repoId: "repo_brief",
      baselinedCount: 3
    });
    expect(acceptanceDisclosureLines(disclosure)[0]).toContain("BRIEF mode");
    expect(disclosure.blocks_new_violations).toBe(false);
    expect(disclosure.upgrade_command).not.toBeNull();
  });

  it("locks the JSON shape on the beta start surface", () => {
    // A passthrough field can vanish without any schema complaining, which is how the original bug
    // survived: nothing asserted the output said what it decided.
    const payload = {
      response_schema: "drift.start.result.v1" as const,
      repo: { id: "repo_abc" },
      scan: { id: "scan_abc" },
      candidates: [],
      summary: {
        files_indexed: 1,
        facts_count: 1,
        diagnostics_count: 0,
        candidates_count: 1,
        engine_source: "rust" as const
      },
      onboarding: {
        status: "ready" as const,
        accepted_default: true,
        contract_ready: true,
        baselined_count: 397,
        candidate_count: 1
      },
      state: { repo_id: "repo_abc", repo_root: "/repo", database_path: "/db.sqlite" },
      accepted: convention(),
      acceptance: acceptanceDisclosure({ accepted: convention(), repoId: "repo_abc", baselinedCount: 397 }),
      baselined_count: 397,
      machine_contract_versions: { schema_version: "drift.machine_contract_versions.v1" as const },
      engine: {},
      v1_scope: {},
      next_commands: ["drift scan status --repo repo_abc"]
    };

    const parsed = BetaStartResponseSchema.parse(payload);
    expect(parsed.acceptance).toMatchObject({
      mode: "warn",
      severity: "error",
      baselined_count: 397,
      blocks_new_violations: false
    });
    expect(parsed.acceptance?.upgrade_command).toContain("--mode block --confirm");

    // A malformed acceptance block must fail the schema rather than pass through.
    expect(() =>
      BetaStartResponseSchema.parse({
        ...payload,
        acceptance: { ...payload.acceptance, mode: "advisory" }
      })
    ).toThrow();
  });
});
