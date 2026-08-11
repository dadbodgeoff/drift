import { describe, expect, it } from "vitest";

import { startCountsFrom } from "./external-eval-start.mjs";

/**
 * BB-8. The `baselined` cell was read by regexing `start`'s human output:
 * `/Baselined (\d+) existing violation/`. BB-3 reworded that sentence to "397 existing violations
 * baselined - ...", the regex stopped matching, `?? 0` supplied a plausible zero, and the baseline was
 * updated 397->0 on all seven repos under a "new fields" rationale. The product was baselining
 * correctly throughout; only the measurement was dead, and with it this suite's ability to see a
 * baselining regression.
 *
 * Nothing failed because nothing tested that the reader still read anything. That is what these tests
 * are for.
 */

// A real `start --accept-defaults --json` payload from dub, trimmed to the fields this reader uses.
const DUB_PAYLOAD = {
  response_schema: "drift.start.result.v1",
  repo: { id: "repo_9a75a9b284d85c79" },
  scan: { id: "scan_ca126dfb95eebb2f" },
  summary: {
    files_indexed: 1487,
    facts_count: 106626,
    diagnostics_count: 639,
    candidates_count: 20,
    engine_source: "rust"
  },
  accepted: { id: "convention_c8a97e3d4e5490d8", enforcement_mode: "warn" },
  acceptance: {
    convention_id: "convention_c8a97e3d4e5490d8",
    convention_kind: "api_route_no_direct_data_access",
    mode: "warn",
    severity: "error",
    baselined_count: 397,
    blocks_new_violations: false,
    upgrade_command: "drift conventions accept convention_c8a97e3d4e5490d8 --repo repo_9a75a9b284d85c79 --severity error --mode block --confirm"
  },
  baselined_count: 397
};

describe("BB-8 start counts", () => {
  it("reads the real per-repo counts off the schema-locked payload", () => {
    expect(startCountsFrom(DUB_PAYLOAD)).toEqual({
      repo_id: "repo_9a75a9b284d85c79",
      files: 1487,
      facts: 106626,
      candidates: 20,
      // The number the dead regex reported as 0 for a whole sprint.
      baselined: 397
    });
  });

  it("reports null, not 0, when acceptance did not happen", () => {
    // A repo onboarded without --accept-defaults baselines nothing. That is a legitimate state and a
    // different fact from "baselined none of the violations it found"; collapsing them into 0 is what
    // let the dead cell pass for a measurement.
    const { acceptance, ...withoutAcceptance } = DUB_PAYLOAD;
    expect(startCountsFrom(withoutAcceptance).baselined).toBeNull();
    expect(acceptance).toBeTruthy();
  });

  it("keeps a genuine zero when acceptance reports one", () => {
    // A clean repo really can baseline zero. The distinction from the case above is the whole point.
    const payload = { ...DUB_PAYLOAD, acceptance: { ...DUB_PAYLOAD.acceptance, baselined_count: 0 } };
    expect(startCountsFrom(payload).baselined).toBe(0);
  });

  it("reports null rather than 0 for a malformed or missing summary", () => {
    // The failure mode being killed: a reader that cannot find its number must say so, not invent one.
    expect(startCountsFrom({ repo: { id: "repo_abc" } })).toEqual({
      repo_id: "repo_abc",
      files: null,
      facts: null,
      candidates: null,
      baselined: null
    });
    expect(startCountsFrom(null).baselined).toBeNull();
    expect(startCountsFrom({ summary: { files_indexed: "1487" } }).files).toBeNull();
  });

  it("does not depend on any human sentence", () => {
    // The regression guard proper: the reader must be indifferent to prose. If someone reintroduces a
    // text dependency, this payload - which carries no human output at all - stops satisfying it.
    const counts = startCountsFrom(DUB_PAYLOAD);
    expect(counts.baselined).toBe(397);
    expect(JSON.stringify(DUB_PAYLOAD)).not.toContain("Baselined");
  });
});
