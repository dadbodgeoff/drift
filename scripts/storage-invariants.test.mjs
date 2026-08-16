import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(repoRoot, "scripts/storage-invariants-baseline.json");
const STORAGE = join(repoRoot, "packages/storage/src/sqlite-storage.ts");
const originalBaseline = readFileSync(BASELINE, "utf8");
const originalStorage = readFileSync(STORAGE, "utf8");

function runGate() {
  try {
    return {
      exitCode: 0,
      output: execFileSync("node", ["scripts/storage-invariants.mjs"], {
        cwd: repoRoot,
        encoding: "utf8"
      })
    };
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * A ratchet is only worth having if it fails. Both directions are exercised here because the defect
 * this guards - one column missing from one SET list - passed every test in the repo, shipped, and
 * was found by neither of two architecture audits until someone ran `drift start` three times in a
 * row against the same state root.
 */
describe("storage invariants gate", () => {
  afterEach(() => {
    writeFileSync(BASELINE, originalBaseline);
    writeFileSync(STORAGE, originalStorage);
  });

  it("passes against the committed baseline", () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("storage invariants:");
  });

  it("fails when an upsert stops refreshing scan_id", () => {
    // Exactly the D-ST2 edit, re-applied: drop the one line from convention_candidates.
    writeFileSync(
      STORAGE,
      originalStorage.replace(
        "        ON CONFLICT(id) DO UPDATE SET\n          scan_id = excluded.scan_id,\n",
        "        ON CONFLICT(id) DO UPDATE SET\n"
      )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("NEW stale scan_id upsert: convention_candidates");
  });

  it("fails on a baseline entry whose gap has been fixed", () => {
    writeFileSync(
      BASELINE,
      JSON.stringify({
        stale_scan_id_upserts: [
          { table: "repos", conflict_target: "id", reason: "not actually an offender" }
        ]
      })
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("STALE baseline entry: repos");
  });
});
