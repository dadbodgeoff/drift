import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("built drift-mcp binary", () => {
  it("prints help from the compiled package entrypoint", async () => {
    const result = await execFileAsync(process.execPath, [
      "packages/mcp/dist/bin.js",
      "--help"
    ]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: drift-mcp --db <path>");
    expect(result.stdout).toContain("DRIFT_DB");
  });
});
