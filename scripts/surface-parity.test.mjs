import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { duplicatePairs, functionsIn, mutationSites, similarity } from "./surface-parity.mjs";

/**
 * W6: tests for the duplicate-derivation gate.
 *
 * The gate exists because `beta:proof` compares OUTPUT and therefore cannot see a derivation
 * implemented twice until some input tells the two copies apart. Its own failure modes are the
 * same ones every gate in this repo has had: reading nothing and reporting success, ratcheting in
 * only one direction, and holding a baseline that has stopped describing the codebase.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "surface-parity.mjs");
const BASELINE = join(HERE, "surface-parity-baseline.json");

function runGate() {
  try {
    const stdout = execFileSync(process.execPath, [GATE], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? ""
    };
  }
}

const original = readFileSync(BASELINE, "utf8");
afterEach(() => writeFileSync(BASELINE, original));

describe("surface parity gate", () => {
  it("passes against the committed baseline", () => {
    const result = runGate();
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("recorded duplicate(s)");
  });

  it("fails on a NEW duplicated derivation", () => {
    // The ratchet's forward direction: duplication may not grow. Dropping one entry stands in for
    // a newly copied function - the gate sees a pair it has no record of either way.
    const baseline = JSON.parse(original);
    const dropped = baseline.duplicates[0];
    writeFileSync(
      BASELINE,
      `${JSON.stringify({ duplicates: baseline.duplicates.slice(1) }, null, 2)}\n`
    );
    const result = runGate();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("NEW duplicated derivation");
    expect(result.stderr).toContain(dropped.key.split("<->")[0]);
  });

  it("fails on a STALE baseline entry", () => {
    // The other direction, and the one gates usually lack. A recorded duplicate that no longer
    // exists is a false claim about the codebase; left alone, the baseline stops describing
    // anything and unifying a pair becomes a silent no-op.
    const baseline = JSON.parse(original);
    writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          duplicates: [
            ...baseline.duplicates,
            {
              key: "unifiedLongAgo<->unifiedLongAgo",
              mcp: "packages/mcp/src/index.ts:unifiedLongAgo",
              cli: "packages/cli/src/domain/gone.ts:unifiedLongAgo",
              similarity: 1,
              both_private: false,
              reason: "recorded, but these were unified"
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
    expect(result.stderr).toContain("unifiedLongAgo");
  });

  it("records the pairs the export-only census could not see", () => {
    // The blind spot this replaces: the architecture census indexed only symbols carrying a
    // top-level `export`, and all three parser-gap divergences in this remediation were
    // module-private. A baseline with no private pairs in it would mean the parser regressed to
    // the census's view.
    const baseline = JSON.parse(original);
    expect(baseline.duplicates.filter((entry) => entry.both_private).length).toBeGreaterThan(0);
  });

  it("gives every recorded duplicate a reason", () => {
    const baseline = JSON.parse(original);
    for (const entry of baseline.duplicates) {
      expect(entry.reason, `${entry.key} has no reason`).toBeTruthy();
      expect(entry.reason, `${entry.key} still carries the placeholder reason`).not.toContain("TODO");
    }
  });
});

describe("surface parity mechanics", () => {
  it("scores a copy with a reworded comment as identical", () => {
    // The observed shape, not a hypothetical: MCP's preflightConvention carried a comment saying
    // it matched the CLI's preparedConvention while its body had already diverged.
    const withOneComment = functionsIn("a.ts", "function f() {\n  // does a thing\n  return compute(input) + 1;\n}");
    const withAnother = functionsIn("b.ts", "function f() {\n  /* entirely different words */\n  return compute(input) + 1;\n}");
    expect(similarity(withOneComment[0].normalized, withAnother[0].normalized)).toBe(1);
  });

  it("indexes module-private functions, not only exported ones", () => {
    const found = functionsIn("a.ts", "function privateOne() { return 1; }\nexport function publicOne() { return 2; }");
    expect(found.map((entry) => entry.name)).toEqual(["privateOne", "publicOne"]);
    expect(found[0].exported).toBe(false);
    expect(found[1].exported).toBe(true);
  });

  it("ignores bodies too short to be evidence of a shared derivation", () => {
    // Below the floor the matches are things like `return storage.getRepo(id) ?? null;` - alike
    // because there is one way to write them, not because anything was copied.
    const cli = functionsIn("cli.ts", "function short() { return a ? b : c; }");
    const mcp = functionsIn("mcp.ts", "function short() { return a ? b : c; }");
    expect(duplicatePairs(cli, mcp)).toEqual([]);
  });

  it("sees a copy whose locals were renamed", () => {
    // An exact-copy check is defeated by one rename, and every divergence in this remediation
    // began as an exact copy that someone then edited on one side.
    const body = (name) =>
      `function build(${name}) {\n` +
      `  const rows = ${name}.listFindings(repoId).filter(isOpen);\n` +
      `  const counts = rows.map((row) => row.severity);\n` +
      `  return { rows, counts, total: rows.length, repo: repoId, kind: "summary" };\n}`;
    const cli = functionsIn("cli.ts", body("storage"));
    const mcp = functionsIn("mcp.ts", body("handle"));
    const pairs = duplicatePairs(cli, mcp);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThan(0.85);
    expect(pairs[0].similarity).toBeLessThan(1);
  });

  it("names a storage write in MCP", () => {
    // The read-only property, checked structurally rather than trusted. MCP's payloads assert
    // `read_only: true`; nothing compared that claim to the source.
    const writes = mutationSites([
      { file: join(HERE, "../packages/mcp/src/index.ts"), source: "storage.upsertFinding({ id });" }
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("packages/mcp/src/index.ts:1");
  });

  it("does not mistake a read for a write", () => {
    const reads = mutationSites([
      { file: join(HERE, "../packages/mcp/src/index.ts"), source: "storage.listFindings(repoId);\nstorage.getRepo(repoId);" }
    ]);
    expect(reads).toEqual([]);
  });
});
