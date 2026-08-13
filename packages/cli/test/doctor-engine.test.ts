import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * `doctor` must not report an engine it cannot run.
 *
 * It is the command `docs/quickstart.md` tells users to run first AND the command the
 * `missing_engine` failure names as its recovery, so a false all-clear here is the one place a
 * wrong answer is guaranteed to be believed.
 *
 * Measured on main, with `cargo` absent from PATH: `doctor` printed 12 checks, **none of them
 * about the engine**, exited 0, reported `"engine": {"status": "available", "error": null}`, and
 * then recommended `drift start` — a command that dies immediately with `spawn cargo ENOENT`.
 * Status came from resolution *succeeding*; for a source checkout nothing was executed or stat'd.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-doctor-engine-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  await mkdtemp(join(tmpdir(), "unused-"));
  execFileSync("mkdir", ["-p", join(repoRoot, "app/api/x")]);
  await writeFile(join(repoRoot, "package.json"), '{"name":"dx","version":"1.0.0"}\n');
  await writeFile(
    join(repoRoot, "app/api/x/route.ts"),
    "export async function GET(){return Response.json({})}\n"
  );
  return { repoRoot, stateRoot: join(dir, "state") };
}

const doctor = async (repoRoot: string, stateRoot: string) =>
  runCli(["doctor", "--repo-root", repoRoot, "--state-root", stateRoot, "--json"]);

describe("doctor reports whether the engine can actually run", () => {
  it("always carries an engine check, so the human output cannot omit it", async () => {
    const { repoRoot, stateRoot } = await fixture();

    const payload = JSON.parse((await doctor(repoRoot, stateRoot)).stdout);

    // On main this array had no engine entry at all: provenance went into the JSON payload only.
    expect(payload.checks.some((check: { id: string }) => check.id === "engine")).toBe(true);
  });

  it("fails, and exits non-zero, when the toolchain it would use is not installed", async () => {
    const { repoRoot, stateRoot } = await fixture();
    const originalPath = process.env.PATH;
    const originalOverride = process.env.DRIFT_ENGINE_BIN;
    try {
      // Keep node reachable so the CLI itself still runs; remove everything else, so `cargo` —
      // which a source checkout would build with — is genuinely absent.
      delete process.env.DRIFT_ENGINE_BIN;
      process.env.PATH = dirname(process.execPath);

      const result = await doctor(repoRoot, stateRoot);
      const payload = JSON.parse(result.stdout);
      const engine = payload.checks.find((check: { id: string }) => check.id === "engine");

      expect(engine.status).toBe("fail");
      expect(payload.engine.status).not.toBe("available");
      // The remediation has to name the thing that is missing. On main the message never said
      // "Rust" at all.
      expect(engine.detail).toMatch(/rustup|Rust toolchain/i);
      // quickstart says "fix anything it marks fail first" — unactionable while this was 0.
      expect(result.exitCode).toBe(1);
    } finally {
      process.env.PATH = originalPath;
      if (originalOverride === undefined) {
        delete process.env.DRIFT_ENGINE_BIN;
      } else {
        process.env.DRIFT_ENGINE_BIN = originalOverride;
      }
    }
  });
});
