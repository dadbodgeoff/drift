import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyConstant,
  isTrustDiscriminator,
  leafFields,
  pointerFields,
  populatedArrayPaths,
  pointerIsRoutable,
  routedCommandPrefixes
} from "./payload-invariants.mjs";

/**
 * Tests for the trust-calibration gate.
 *
 * Its own failure modes are the ones every gate in this repo has had: evaluating nothing and
 * reporting success, ratcheting in one direction only, and holding a baseline that has stopped
 * describing the payloads. The end-to-end run is expensive (it scans eight fixtures), so the
 * expensive path is exercised once and the logic is tested directly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "payload-invariants.mjs");
const BASELINE = join(HERE, "payload-invariants-baseline.json");
const original = readFileSync(BASELINE, "utf8");

afterEach(() => writeFileSync(BASELINE, original));

function runGate() {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [GATE], { encoding: "utf8" }), stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? ""
    };
  }
}

describe("payload invariants gate", () => {
  it("passes against the committed baseline", () => {
    const result = runGate();
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trust discriminator(s) evaluated");
  }, 300_000);

  it("fails on a NEW constant trust field", () => {
    // The forward ratchet: a field that stops varying must be declared, not absorbed. Dropping an
    // entry stands in for a field that has newly frozen.
    const baseline = JSON.parse(original);
    const dropped = baseline.constants[0];
    writeFileSync(BASELINE, `${JSON.stringify({ constants: baseline.constants.slice(1) }, null, 2)}\n`);
    const result = runGate();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("NEW constant trust field");
    expect(result.stderr).toContain(dropped.path);
  }, 300_000);

  it("fails on a STALE baseline entry", () => {
    // The other direction. A field recorded as frozen that now varies is a false record, and
    // without this half, making a field vary is a silent no-op and the baseline drifts out of
    // contact with the payloads it describes.
    const baseline = JSON.parse(original);
    writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          constants: [
            ...baseline.constants,
            {
              path: "prepare.this_field_was_never_here",
              value: false,
              kind: "product_invariant",
              reason: "recorded, but this field does not exist"
            }
          ]
        },
        null,
        2
      )}\n`
    );
    const result = runGate();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("STALE baseline entry");
    expect(result.stderr).toContain("this_field_was_never_here");
  }, 300_000);
});

describe("baseline honesty", () => {
  it("gives every constant a kind and a reason", () => {
    for (const entry of JSON.parse(original).constants) {
      expect(entry.kind, `${entry.path} has no kind`).toBeTruthy();
      expect(entry.reason, `${entry.path} has no reason`).toBeTruthy();
    }
  });

  it("keeps matrix gaps distinguishable from guarantees", () => {
    // The distinction this baseline exists to preserve. `product_invariant` says "this cannot
    // vary"; `matrix_gap` says "we did not make it vary". Collapsing them would let an untested
    // corner read as a promise, which is the failure this whole gate is about one level up.
    const constants = JSON.parse(original).constants;
    const kinds = new Set(constants.map((entry) => entry.kind));
    expect(kinds.has("matrix_gap")).toBe(true);
    expect(kinds.has("product_invariant")).toBe(true);
    // The truncation fields are the gate's own headline example and must stay recorded as a hole,
    // never as a property: D-M5 found `truncated.conventions` hardcoded false, and a baseline
    // calling that an invariant would re-freeze it with a certificate.
    for (const entry of constants.filter((row) => row.path.includes("truncated"))) {
      expect(entry.kind, `${entry.path} must stay a matrix_gap`).toBe("matrix_gap");
    }
  });

  it("records the unimplemented placeholders as placeholders", () => {
    // `snapshot_usage` and `stale_test_candidate` are hardcoded false in test-intelligence.ts and
    // nothing computes them. Recording them as invariants would say "checked, and no" about a
    // field that never looked.
    const placeholders = JSON.parse(original).constants.filter(
      (entry) => entry.kind === "unimplemented_placeholder"
    );
    expect(placeholders.length).toBeGreaterThan(0);
    for (const entry of placeholders) {
      expect(entry.reason).toMatch(/never computed|placeholder/i);
    }
  });
});

describe("discriminator selection", () => {
  it("treats every boolean as a discriminator", () => {
    expect(isTrustDiscriminator("anything.at.all", true)).toBe(true);
    expect(isTrustDiscriminator("guidance.truncated.conventions", false)).toBe(true);
  });

  it("treats a reason, status or decision string as a discriminator", () => {
    expect(isTrustDiscriminator("prepare.test_intelligence_reason", "no_test_files_in_repo")).toBe(true);
    expect(isTrustDiscriminator("refusal.error.type", "refusal")).toBe(true);
    expect(isTrustDiscriminator("readiness.decision", "proceed")).toBe(true);
  });

  it("does not treat identity strings as discriminators", () => {
    // Scope, and the reason the baseline is readable: ids, paths and hashes are constant or
    // varying for reasons that have nothing to do with calibration.
    expect(isTrustDiscriminator("prepare.repo_id", "repo_abc")).toBe(false);
    expect(isTrustDiscriminator("prepare.relevant_files[].path", "app/api/route.ts")).toBe(false);
  });

  it("does not treat a count under readiness as a discriminator", () => {
    // Numbers beneath a discriminator parent are the data the calibration fields summarise. Left
    // in, they filled the baseline with counts that are constant because the fixture is fixed.
    expect(isTrustDiscriminator("readiness.parser_gaps_by_kind.parser_error", 1)).toBe(false);
    expect(isTrustDiscriminator("readiness.graph_available", true)).toBe(true);
  });
});

describe("leaf flattening", () => {
  it("collapses array indices so a field is compared with itself", () => {
    const leaves = leafFields({ conventions: [{ mode: "warn" }, { mode: "block" }] });
    expect([...leaves.keys()]).toEqual(["conventions[].mode"]);
    expect(leaves.get("conventions[].mode")).toEqual(["warn", "block"]);
  });

  it("keeps nulls, which are answers", () => {
    expect(leafFields({ reason: null }).get("reason")).toEqual([null]);
  });

  it("emits a leaf for an EMPTY array, which is the always-[] blind spot", () => {
    // The hole this gate shipped with. `covered_symbols: []` produced no path at all, so a field
    // that is an empty list in every cell - declared shape with nothing computing it - was
    // invisible, while the `snapshot_usage: false` sitting beside it in the same object was
    // caught. An always-empty list is the same defect wearing a different type.
    const leaves = leafFields({ covered_symbols: [], snapshot_usage: false });
    expect([...leaves.keys()]).toEqual(["covered_symbols", "snapshot_usage"]);
    expect(leaves.get("covered_symbols")).toEqual([[]]);
    expect(isTrustDiscriminator("test_intelligence[].covered_symbols", [])).toBe(true);
  });

  it("does not call a list frozen when another cell filled it", () => {
    // The correctness half of emitting `[]`. `conventions` is empty in the no-ts fixture and
    // populated everywhere else; the two states land under different keys, so counting only the
    // empty ones would report a working field as a hardcoded literal.
    //
    // Prefix-wise, and this is the part an exact-match test gets wrong: an array of OBJECTS never
    // produces the bare key `conventions[]`, only `conventions[].mode`. Matching on the exact key
    // missed every populated object-array and reported 208 constants instead of 12.
    const populated = populatedArrayPaths([
      "prepare.conventions",
      "prepare.conventions[].mode",
      "prepare.safe_commands",
      "prepare.safe_commands[]",
      "prepare.test_intelligence[].covered_symbols",
      "prepare.graph_context.route_flows[].diagnostics[].code"
    ]);
    expect(populated.has("prepare.conventions")).toBe(true);
    expect(populated.has("prepare.safe_commands")).toBe(true);
    // Nested: both the outer array and the inner one were filled.
    expect(populated.has("prepare.graph_context.route_flows")).toBe(true);
    expect(populated.has("prepare.graph_context.route_flows[].diagnostics")).toBe(true);
    // The always-empty field itself is NOT populated - it is the one that must survive to the
    // baseline, and a guard that swallowed it would restore the blind spot with extra steps.
    expect(populated.has("prepare.test_intelligence[].covered_symbols")).toBe(false);
  });

  it("still recurses into a NON-empty array rather than emitting a leaf for it", () => {
    // The collapse semantics above must survive: a populated array contributes its elements and
    // no leaf of its own, so `conventions[].mode` keeps gathering values across elements.
    const leaves = leafFields({ conventions: [{ mode: "warn" }, { mode: "block" }] });
    expect([...leaves.keys()]).toEqual(["conventions[].mode"]);
    expect(leaves.has("conventions")).toBe(false);
  });
});

describe("pointer checking", () => {
  const prefixes = routedCommandPrefixes(
    readFileSync(join(HERE, "../packages/cli/src/app/router.ts"), "utf8"),
    readFileSync(join(HERE, "../packages/cli/src/app/run-cli.ts"), "utf8")
  );

  it("reads the routed command surface rather than restating it", () => {
    // Liveness: if the router stops matching, every pointer passes vacuously.
    expect(prefixes.size).toBeGreaterThan(8);
    expect(prefixes.has("scan status")).toBe(true);
    expect(prefixes.has("doctor")).toBe(true);
  });

  it("accepts a routed command and rejects an invented one", () => {
    expect(pointerIsRoutable("drift scan status --repo x --json", prefixes)).toBe(true);
    expect(pointerIsRoutable("drift frobnicate --repo x --json", prefixes)).toBe(false);
  });

  it("separates a data pointer from a remediation pointer", () => {
    // Conflating them is a false positive: `next_command` says what to run next and owes nobody a
    // key named after its parent. Only a *_list_command / *_records_command promises data.
    const found = pointerFields({
      guidance: { parser_gaps: { full_list_command: "drift scan status --repo x --json" } },
      scan_status: { next_command: "drift scan --repo-root . --json" }
    });
    const byPath = Object.fromEntries(found.map((entry) => [entry.path, entry]));
    expect(byPath["guidance.parser_gaps.full_list_command"]).toMatchObject({
      kind: "data",
      promises: "parser_gaps"
    });
    expect(byPath["scan_status.next_command"]).toMatchObject({ kind: "remediation", promises: null });
  });
});

describe("constant classification", () => {
  it("calls a read-only guarantee a product invariant", () => {
    expect(classifyConstant("prepare.agent_envelope.read_only", true).kind).toBe("product_invariant");
  });

  it("calls a truncation field a matrix gap, never an invariant", () => {
    expect(classifyConstant("prepare.guidance.truncated.conventions", false).kind).toBe("matrix_gap");
  });

  it("says plainly when it cannot explain a constant", () => {
    const classified = classifyConstant("prepare.something.unexpected_flag", false);
    expect(classified.kind).toBe("matrix_gap");
    expect(classified.reason).toContain("not yet explained");
  });
});
