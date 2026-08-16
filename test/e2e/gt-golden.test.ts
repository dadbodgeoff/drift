// Ground-truth audit golden suite (TDD §4.1, phase 0a).
//
// This file pins the harness itself and the audit's known-good control. Defect-specific
// assertions land with their tracks, in their own files, so the integration branch stays
// green while A/B/C/D run in parallel.
//
// Assertions here are explicit rather than snapshots on purpose: `expect(x).toHaveLength(4)`
// cannot be silently re-recorded en masse, and `vitest -u` re-records every snapshot in a run
// from a single flagless invocation.

import { afterEach, describe, expect, it } from "vitest";
import { cleanupGtTempDirs, flaggedPaths, readFindings, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const SENSITIVE_KIND = "api_route_forbids_sensitive_response_fields";
const DATA_ACCESS_KIND = "api_route_no_direct_data_access";

describe("gt harness", () => {
  it("obtains its convention from the proposer, never by injection", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-sensitive-fields",
      acceptKinds: [SENSITIVE_KIND]
    });

    // The candidate came out of `drift start`, and acceptance went through the real
    // `conventions accept` command. Both halves matter: the audit's P0 lived in the seam
    // between them, and a test that writes the convention into the state DB cannot see it.
    expect(run.acceptPayloads).toHaveLength(1);
    const accepted = run.acceptPayloads[0].accepted;
    expect(accepted.kind).toBe(SENSITIVE_KIND);
    expect(accepted.evidence_refs.length).toBeGreaterThan(0);

    // The accepted convention carries fields the proposer derived from the fixture, not a
    // `requires` block this test authored.
    expect(accepted.requires.sensitive_response_fields.length).toBeGreaterThan(0);
  });

  it("drives the debug engine and verifies its identity", async () => {
    // assertEngineIdentity runs inside every workflow; this pins the reported shape so a
    // change to the engine block cannot quietly turn the guard into a no-op.
    const run = await runGtWorkflow({ fixture: "gt-sensitive-fields" });
    expect(run.startPayload.engine.checksum_matches).toBe(true);
    expect(run.startPayload.engine.path).toMatch(/target\/debug\/drift-engine$/);
    expect(run.startPayload.engine.status).toBe("available");
  });
});

describe("gt-data-access control", () => {
  // The audit's true positives. D4 removes the `dbg`/`imdb` false positives; these four must
  // survive that change untouched, which is what makes them the control rather than the target.
  it("flags every genuine data-access route", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-data-access",
      acceptKinds: [DATA_ACCESS_KIND]
    });

    const findings = readFindings(run.databasePath, run.repoId);
    const flagged = flaggedPaths(findings, DATA_ACCESS_KIND);

    for (const route of [
      "pages/api/route-data-access.ts",
      "pages/api/route-database.ts",
      "pages/api/route-db.ts",
      "pages/api/route-prisma.ts"
    ]) {
      expect(flagged, `${route} is a genuine data-access route and must stay flagged`).toContain(route);
    }

    // Near-miss negatives that already behave: `prismatic` proves the token matcher is
    // boundary-aware, `utils` proves the name heuristic needs a signal at all.
    expect(flagged).not.toContain("pages/api/route-prismatic.ts");
    expect(flagged).not.toContain("pages/api/route-utils.ts");
  });
});
