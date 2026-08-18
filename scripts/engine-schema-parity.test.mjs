import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
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
 * A stand-in engine: the real binary, with `mutate` applied to its parsed output on the way back.
 *
 * The alternative was to corrupt crates/drift-engine/src/security_proof.rs and let the gate
 * recompile it. That is a truer reproduction and it is what verified this gate by hand. It is not
 * used here for two reasons: it costs a release rebuild per case, and it mutates shared source
 * that other harness tests compile against. (`test:harness` now runs with --no-file-parallelism,
 * so the race that originally ruled it out no longer applies -- but a test that edits tracked
 * source still leaves the tree dirty if it dies partway, and the proxy has neither problem.)
 *
 * What the proxy preserves is what matters: the real engine, the real request, the real schemas.
 * Only the bytes between them are touched.
 */
function proxyEngine(realEngine, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "drift-schema-parity-proxy-"));
  const script = join(dir, "proxy.mjs");
  writeFileSync(
    script,
    [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync } from "node:fs";',
      `const out = execFileSync(${JSON.stringify(realEngine)}, ["check-repo"], {`,
      '  input: readFileSync(0, "utf8"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024',
      "});",
      "const payload = JSON.parse(out);",
      mutate,
      "process.stdout.write(JSON.stringify(payload));"
    ].join("\n")
  );
  const shim = join(dir, "engine.sh");
  writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(script)}\n`);
  chmodSync(shim, 0o755);
  return shim;
}

/** Reproduces F1: a finding-level word written into the proof-level reason field. */
const EMIT_ILLEGAL_REASON = `
for (const pr of payload.security_boundary_proofs ?? []) {
  for (const m of pr.session_trust?.missing_trust ?? []) {
    if (m.reason === "unknown_helper") m.reason = "session_not_trusted";
  }
}`;

/** Empties every vocabulary-constrained list. The document stays schema-valid. */
const EMPTY_EVERY_SURFACE = `
for (const pr of payload.security_boundary_proofs ?? []) {
  if (pr.session_trust) pr.session_trust.missing_trust = [];
  if (pr.authorization) pr.authorization.missing = [];
  if (pr.tenant) pr.tenant.missing = [];
  pr.missing_proof = [];
}`;

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
    // The count of surfaces actually read, so a shrinking check is visible in the pass line.
    expect(result.output).toMatch(/\d+ populated surfaces/);
  }, 300_000);

  it("fails, and names the field, when the engine emits a word the schema rejects (F1)", () => {
    expect(runGate().exitCode).toBe(0);
    const realEngine = join(repoRoot, "target/release/drift-engine");
    const result = runGate(["--engine", proxyEngine(realEngine, EMIT_ILLEGAL_REASON)]);

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

  /**
   * The liveness contract, driven rather than grepped.
   *
   * This test used to read the gate's own source and assert two English sentences appeared in it.
   * That is not a test of behaviour: it would have passed just as happily with the check deleted
   * and the message left behind, and it did in fact pass while the check was one level too
   * shallow -- requiring only that SOME proof came back, never that the constrained field the
   * scenario exists to reach was populated. An engine can answer with a well-formed document in
   * which every constrained list is empty, and the gate called that success while reading
   * nothing, which is the same "green suite that looked at nothing" it was written to end.
   *
   * The payload here stays schema-valid on purpose: the gate must refuse it for being vacuous,
   * not for being malformed.
   */
  it("refuses a well-formed payload whose constrained surfaces are all empty", () => {
    expect(runGate().exitCode).toBe(0);
    const realEngine = join(repoRoot, "target/release/drift-engine");
    const result = runGate(["--engine", proxyEngine(realEngine, EMPTY_EVERY_SURFACE)]);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("no longer reaches the field it exists to check");
    // Names the surface, per scenario, so the message points at what stopped being reached.
    expect(result.output).toContain("session_trust.missing_trust is empty");
    expect(result.output).toContain("tenant.missing is empty");
    expect(result.output).toContain("authorization.missing is empty");
  }, 300_000);

  it("refuses an --engine path that does not exist", () => {
    const result = runGate(["--engine", join(repoRoot, "target/release/no-such-engine")]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("does not exist");
  }, 60_000);
});
