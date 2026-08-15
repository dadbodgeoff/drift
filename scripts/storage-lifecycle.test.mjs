import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(repoRoot, "scripts/storage-lifecycle-baseline.json");
const original = readFileSync(BASELINE, "utf8");

function runGate() {
  try {
    const stdout = execFileSync("node", ["scripts/storage-lifecycle.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`
    };
  }
}

/**
 * A ratchet is only worth having if it fails. These exercise both directions, because a gate that
 * can only ever pass is indistinguishable from no gate - and the class it guards has already been
 * missed by two separate architecture audits.
 */
describe("storage lifecycle gate", () => {
  afterEach(() => {
    writeFileSync(BASELINE, original);
  });

  it("passes against the committed baseline", () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("storage lifecycle:");
  });

  it("fails when a storage method loses its production caller", () => {
    // Simulated by removing a known orphan from the baseline: identical to a newly-introduced one
    // from the gate's point of view, and it needs no source edit.
    const baseline = JSON.parse(original);
    baseline.known_orphans = baseline.known_orphans.filter(
      (entry) => entry.method !== "upsertSymbolIdentities"
    );
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2));

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("NEW writer_orphan: upsertSymbolIdentities");
    // A writer orphan must say why it is the more severe kind.
    expect(result.output).toContain("never be populated");
  });

  it("fails when the baseline still claims a gap that has been fixed", () => {
    // Keeps the record honest in the other direction: fixing a gap forces removing its entry,
    // so the file cannot decay into a list of things that used to be true.
    const baseline = JSON.parse(original);
    baseline.known_orphans.push({
      method: "listFacts",
      table: "facts",
      kind: "reader_orphan",
      reason: "synthetic - listFacts has many production callers"
    });
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2));

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("STALE baseline entry: listFacts");
  });

  it("separates writer orphans from reader orphans", () => {
    // The distinction is the point: a missing writer means every read is empty, a missing reader
    // means data is stored and unused. Conflating them would bury the severe case.
    const result = runGate();
    expect(result.output).toMatch(/\d+ writer, \d+ reader/);
    const baseline = JSON.parse(original);
    const writers = baseline.known_orphans.filter((entry) => entry.kind === "writer_orphan");
    expect(writers.map((entry) => entry.method).sort()).toEqual([
      "upsertParserGapV2",
      "upsertSecurityBoundaryProofs",
      "upsertSymbolIdentities"
    ]);
  });
});
