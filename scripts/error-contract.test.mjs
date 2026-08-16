import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ERROR_SOURCE = join(repoRoot, "packages/cli/src/app/drift-error.ts");
const DOC = join(repoRoot, "docs/reference/errors.md");
const originalSource = readFileSync(ERROR_SOURCE, "utf8");
const originalDoc = readFileSync(DOC, "utf8");

function runGate() {
  try {
    return {
      exitCode: 0,
      output: execFileSync("node", ["scripts/error-contract.mjs"], { cwd: repoRoot, encoding: "utf8" })
    };
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * Each case below is a defect that actually shipped, replayed. A gate for a class that has already
 * escaped once should be able to demonstrate it catches that exact escape.
 */
describe("error contract gate", () => {
  afterEach(() => {
    writeFileSync(ERROR_SOURCE, originalSource);
    writeFileSync(DOC, originalDoc);
  });

  it("passes against the committed contract", () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("error contract:");
  });

  it("fails when a refusal is given an error's exit code (D-E1)", () => {
    writeFileSync(
      ERROR_SOURCE,
      originalSource.replace(
        'missing_contract: { exitCode: 3, type: "refusal" }',
        'missing_contract: { exitCode: 1, type: "refusal" }'
      )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("missing_contract");
    expect(result.output).toContain("exits 1");
  });

  it("fails when a code is undocumented (D-E6)", () => {
    writeFileSync(
      DOC,
      originalDoc.replace(/^\| `shallow_clone` \|.*$/m, "")
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("shallow_clone is not documented");
  });

  it("fails when the docs and the table disagree about what is a refusal", () => {
    writeFileSync(
      ERROR_SOURCE,
      originalSource.replace(
        'empty_contract: { exitCode: 3, type: "refusal" }',
        'empty_contract: { exitCode: 1, type: "error" }'
      )
    );

    const result = runGate();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("empty_contract");
    expect(result.output).toContain("docs list it among the refusals");
  });
});
