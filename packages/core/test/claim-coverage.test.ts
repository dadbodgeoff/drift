import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProductionClaimsManifest } from "../src/capabilities.js";

/**
 * T31. Every allowed claim must be backed by a test that would fail if the claim stopped being
 * true. A claims file that is maintained by hand drifts from behaviour silently - which is the
 * failure mode this whole product exists to prevent, so it would be a poor thing to ship.
 *
 * Each entry names the test that proves it. Adding an allowed claim without evidence fails here.
 */

const REPO_ROOT = join(import.meta.dirname, "../../..");

/** claim -> file that proves it, and a token that must appear in that file. */
const CLAIM_EVIDENCE: Record<string, { file: string; token: string }> = {
  local_first_cli: {
    // The scan path must not depend on the MCP package or any non-workspace runtime dep.
    file: "packages/cli/package.json",
    token: "@drift/core"
  },
  typescript_api_route_layering: {
    file: "crates/drift-engine/tests/typescript_facts.rs",
    token: "grouped_next_api_route_gets_api_route_role"
  },
  sqlite_local_state: {
    file: "packages/storage/test/migrations.test.ts",
    token: "migrates a database that stopped at an earlier version"
  },
  human_confirmed_governance: {
    file: "packages/cli/test/contract-field-enforcement.test.ts",
    token: "waiver"
  },
  read_only_mcp: {
    file: "packages/core/src/capabilities.ts",
    token: "mcp_mutation_tools: []"
  },
  accepted_contract_blocks_direct_data_access: {
    // The seven-repo suite is the real proof: injection caught with correct evidence on every one.
    file: "scripts/external-eval-baseline.json",
    token: '"injection_caught": true'
  },
  incremental_reuse: {
    file: "crates/drift-engine/tests/scan_reuse.rs",
    token: "refuses_reuse_from_a_different_engine_version"
  },
  // CV-1. The claim is that per-symbol candidates aggregate into one family with union coverage. The
  // token is the control that would fail first if aggregation started over-reaching, which is the way
  // this claim actually breaks - measured on dub, module identity alone put three crypto utilities
  // into the auth family.
  convention_family_aggregation: {
    file: "crates/drift-engine/tests/convention_families_cv1.rs",
    token: "a_utility_from_the_familys_own_module_does_not_join"
  },
  // CV-3. The claim is presence-only enforcement, and the thing that would make it dishonest is a
  // finding that claims protection. That is what this token pins.
  presence_only_family_enforcement: {
    file: "crates/drift-engine/tests/presence_enforcement_cv3.rs",
    token: "the_finding_claims_presence_and_never_protection"
  }
};

describe("every allowed claim is backed by evidence", () => {
  const manifest = createProductionClaimsManifest();

  it("has an evidence entry for each allowed claim", () => {
    const missing = manifest.allowed_claims.filter((claim) => !CLAIM_EVIDENCE[claim]);
    expect(
      missing,
      `Allowed claim(s) with no recorded evidence: ${missing.join(", ")}. ` +
        `Add the test that proves it, or block the claim.`
    ).toEqual([]);
  });

  for (const [claim, evidence] of Object.entries(CLAIM_EVIDENCE)) {
    it(`${claim} is proven by ${evidence.file}`, () => {
      const contents = readFileSync(join(REPO_ROOT, evidence.file), "utf8");
      expect(contents, `${evidence.file} no longer contains ${evidence.token}`).toContain(
        evidence.token
      );
    });
  }

  it("does not claim anything it has demoted", () => {
    // These were demoted after the falsification test and the security audit. A regression that
    // re-allowed them would be an overclaim, not a feature.
    for (const blocked of [
      "convention_learning",
      "automatic_convention_inference_for_any_data_layer",
      "security_boundary_proofs",
      "auth_dominance_analysis"
    ]) {
      expect(manifest.blocked_claims).toContain(blocked);
      expect(manifest.allowed_claims).not.toContain(blocked);
    }
  });

  it("keeps the JSON manifest in step with the code manifest", () => {
    const onDisk = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs/internal/architecture/beta-claims.json"), "utf8")
    ) as { allowed_claims: string[]; blocked_claims: string[] };
    expect([...onDisk.allowed_claims].sort()).toEqual([...manifest.allowed_claims].sort());
    expect([...onDisk.blocked_claims].sort()).toEqual([...manifest.blocked_claims].sort());
  });
});
