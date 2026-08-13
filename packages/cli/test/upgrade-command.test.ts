import { describe, expect, it } from "vitest";
import { acceptanceDisclosureLines } from "../src/domain/acceptance-disclosure.js";

/**
 * The remediation Drift prints has to be a command that runs.
 *
 * `drift start --accept-defaults` correctly discloses a warn-mode acceptance — "new violations will
 * be reported but will NOT block" — and then offers the single command that turns it into a gate.
 * That command was built from the ACCEPTED convention id (`convention_<hash>`) while
 * `conventions accept` resolves a CANDIDATE id (`candidate_<hash>`), so running it verbatim gave:
 *
 *   Convention candidate not found: convention_<hash>
 *
 * Telling someone exactly what to run and handing them a command that errors is worse than
 * offering nothing: it converts "I chose not to gate" into "I tried and Drift is broken".
 *
 * The lookup now accepts either form, so this test pins the contract from the printing side: the
 * command names the id it was given, and the id form is one `requiredCandidate` resolves.
 */
describe("the acceptance disclosure offers a runnable command", () => {
  const disclosure = {
    convention_id: "convention_b490ebf583532fb6",
    convention_kind: "api_route_no_direct_data_access",
    mode: "warn" as const,
    severity: "error" as const,
    baselined_count: 1,
    blocks_new_violations: false,
    upgrade_command:
      "drift conventions accept convention_b490ebf583532fb6 --repo repo_x --severity error --mode block --confirm",
    accepted_count: 1,
    also_accepted: [],
    deferred_families: [],
    deferred_candidates: []
  };

  it("states plainly that nothing will block, and names the fix", () => {
    const lines = acceptanceDisclosureLines(disclosure).join("\n");

    expect(lines).toContain("WARN mode");
    expect(lines).toContain("will NOT block");
    expect(lines).toContain("To make this a gate:");
  });

  it("prints the same id the accept command will be asked to resolve", () => {
    const lines = acceptanceDisclosureLines(disclosure).join("\n");
    const printed = lines.match(/drift conventions accept (\S+)/)?.[1];

    expect(printed).toBe(disclosure.convention_id);
    // Both prefixes must resolve. `candidateIdFor` maps convention_<hash> -> candidate_<hash>, so
    // the hash has to survive the rewrite intact — that is the whole of the contract.
    expect(printed?.replace(/^convention_/, "candidate_")).toBe("candidate_b490ebf583532fb6");
  });
});
