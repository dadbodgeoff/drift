import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T28. A contract field the schema accepts but nothing enforces is an overclaim: an operator can
 * write it, Drift stores it, and it changes nothing - silently, and without complaint, which is
 * what makes it hard to notice.
 *
 * Seven such fields exist today (see docs/architecture/contract-field-enforcement-map.md). They
 * are recorded here rather than rejected, because each needs a decision the schema cannot make:
 * implement, remove, or mark experimental. This test's job is to stop the list growing.
 */

const KNOWN_UNENFORCED = [
  "enforcement_policy",
  "beta_claim_profile",
  "active_semantic_capability_ids",
  "active_convention_rule_ids",
  "architecture_contract_id",
  "architecture_contract_fingerprint",
  "semantic_capability_contract_version"
] as const;

describe("contract fields are enforced somewhere", () => {
  it("documents every known-unenforced field", () => {
    const map = readFileSync(
      join(import.meta.dirname, "../../../docs/architecture/contract-field-enforcement-map.md"),
      "utf8"
    );
    for (const field of KNOWN_UNENFORCED) {
      expect(map, `${field} must be listed in the enforcement map`).toContain(field);
    }
  });

  it("keeps the unenforced list from growing unnoticed", () => {
    // Deliberately a tripwire rather than a discovery mechanism: a new field added to
    // RepoContract without an enforcement site should force a conscious choice, not slip in.
    const domain = readFileSync(join(import.meta.dirname, "../src/domain.ts"), "utf8");
    const block = domain.match(/export interface RepoContract \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const fields = [...block.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((match) => match[1]!);
    expect(fields.length).toBeGreaterThan(10);

    // Structural/bookkeeping fields are not enforcement surfaces.
    const structural = new Set([
      "id",
      "repo_id",
      "contract_schema_version",
      "repo_fingerprint",
      "created_at",
      "updated_at",
      "layer_architecture"
    ]);
    const accountedFor = new Set<string>([...structural, ...KNOWN_UNENFORCED]);

    const enforced = [
      "conventions",
      "rejected_inferences",
      "waivers",
      "risky_areas",
      "agent_contracts",
      "safe_commands",
      "required_checks",
      "context_egress",
      "agent_permissions"
    ];
    for (const field of enforced) accountedFor.add(field);

    const unaccounted = fields.filter((field) => !accountedFor.has(field));
    expect(
      unaccounted,
      `New RepoContract field(s) with no recorded enforcement site: ${unaccounted.join(", ")}. ` +
        `Add them to the enforcement map with a verdict, or wire them up.`
    ).toEqual([]);
  });
});
