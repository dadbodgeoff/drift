import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function runGate(args = []) {
  try {
    return {
      exitCode: 0,
      output: execFileSync("node", ["scripts/engine-schema-parity.mjs", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * A proxy that is the real engine with one word changed.
 *
 * It forwards the request to the real binary and rewrites `unknown_helper` to
 * `session_not_trusted` in the session-trust proof on the way back -- which is exactly the
 * defect that shipped: a finding-level word written into a proof-level field.
 *
 * The alternative was to corrupt crates/drift-engine/src/security_proof.rs and let the gate
 * recompile it. That is a truer reproduction and it is what was used to verify this gate by
 * hand, but it cannot live in the harness: vitest runs test files in parallel, and
 * engine-handshake.test.mjs builds and executes the same target/release/drift-engine. A test
 * that corrupts shared source mid-run can hand a different test a corrupted engine. Proxying
 * keeps the real engine, the real request, and the real schemas, and mutates only the bytes in
 * flight.
 */
function badEngineProxy(realEngine) {
  const dir = mkdtempSync(join(tmpdir(), "drift-schema-parity-proxy-"));
  const script = join(dir, "proxy.mjs");
  writeFileSync(
    script,
    [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync } from "node:fs";',
      'const request = readFileSync(0, "utf8");',
      `const out = execFileSync(${JSON.stringify(realEngine)}, ["check-repo"], {`,
      '  input: request, encoding: "utf8", maxBuffer: 64 * 1024 * 1024',
      "});",
      "process.stdout.write(out.replaceAll('\"unknown_helper\"', '\"session_not_trusted\"'));"
    ].join("\n")
  );
  const shim = join(dir, "engine.sh");
  writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(script)}\n`);
  chmodSync(shim, 0o755);
  return shim;
}

/**
 * This gate exists because a contract with a producer test and a consumer test and nothing
 * across the seam is two opinions, not a contract. Asserting only that it passes today would
 * repeat that mistake one level up -- a green gate proves nothing until it has been watched
 * to fail.
 */
describe("engine schema parity gate", () => {
  it("passes against the committed engine", () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("engine schema parity:");
    expect(result.output).toContain("parsed by 2 consumers");
  }, 300_000);

  it("fails, and names the field, when the engine emits a word the schema rejects (F1)", () => {
    // Build once through the gate's own path, then proxy that binary.
    expect(runGate().exitCode).toBe(0);
    const realEngine = join(repoRoot, "target/release/drift-engine");
    const result = runGate(["--engine", badEngineProxy(realEngine)]);

    expect(result.exitCode).toBe(1);
    // The field, so the message points at the defect rather than at the gate.
    expect(result.output).toContain("session_trust.missing_trust.0.reason");
    // The value emitted, and the set it had to be in.
    expect(result.output).toContain("session_not_trusted");
    expect(result.output).toContain("unknown_helper");
    // Both consumers see it -- neither schema is silently absent from the check.
    expect(result.output).toContain("SecurityBoundaryProofSchema");
    expect(result.output).toContain("parseEngineCheckResult");
  }, 300_000);

  it("refuses an --engine path that does not exist", () => {
    const result = runGate(["--engine", join(repoRoot, "target/release/no-such-engine")]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("does not exist");
  }, 60_000);

  /**
   * A scenario that stops producing proofs would parse clean and check nothing, which is how a
   * gate rots into decoration. The gate treats an empty scenario as a failure; this pins that
   * the check is still there to be relied on.
   */
  it("treats a scenario that produces no proofs as a failure", () => {
    const gateSource = readFileSync(join(repoRoot, "scripts/engine-schema-parity.mjs"), "utf8");
    expect(gateSource).toContain("a scenario produced no security_boundary_proofs");
    expect(gateSource).toContain("parses clean and checks nothing");
  });
});
