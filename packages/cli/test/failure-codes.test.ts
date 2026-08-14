import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/app/run-cli.js";
import { ENGINE_PAYLOAD_MAX_BYTES } from "../src/engine/engine-payload-limits.js";

/**
 * T24. A local-first tool's error messages are its support channel - there is no server-side log
 * to consult. Every failure must carry a code, a cause, and a next action.
 *
 * The codes added here are the ones that reached users as raw SQLite or filesystem strings.
 * "database or disk is full" surfaced verbatim mid-scan during development, with no indication
 * of what to do about it.
 */

async function failureFor(args: string[]): Promise<{
  code: string;
  user_action: string;
  recovery_commands: string[];
  safe_to_retry: boolean;
}> {
  const result = await runCli([...args, "--json"]);
  const payload = JSON.parse(result.stdout);
  return payload.failure;
}

describe("every reported failure names a code and a next action", () => {
  it("classifies a missing database", async () => {
    const failure = await failureFor(["contract", "show", "--repo", "repo_abc"]);
    expect(failure.code).toBe("missing_database");
    expect(failure.user_action).not.toBe("");
    expect(failure.recovery_commands.length).toBeGreaterThan(0);
  });

  it("classifies an unusable database path", async () => {
    const failure = await failureFor(["contract", "show", "--repo", "repo_abc", "--db", "/"]);
    // Whatever the platform reports, it must arrive classified with an action rather than as a
    // bare filesystem string.
    expect(failure.code).not.toBe("");
    expect(failure.user_action).not.toBe("");
    expect(failure.recovery_commands.length).toBeGreaterThan(0);
  });

  it("classifies a repo whose engine payload exceeds the ingest ceiling", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-failure-codes-payload-"));
    const previousBin = process.env.DRIFT_ENGINE_BIN;
    const previousPayload = process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES;
    try {
      await mkdir(join(dir, "repo"), { recursive: true });
      await writeFile(join(dir, "repo", "package.json"), '{"name":"fc","version":"1.0.0"}\n');
      process.env.DRIFT_ENGINE_BIN = join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "stub-payload-engine.mjs"
      );
      process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES = String(ENGINE_PAYLOAD_MAX_BYTES + 1024 * 1024);

      const failure = await failureFor([
        "start",
        "--repo-root",
        join(dir, "repo"),
        "--db",
        join(dir, "drift.db"),
        "--accept-defaults"
      ]);

      expect(failure.code).toBe("engine_payload_too_large");
      expect(failure.user_action).not.toBe("");
      expect(failure.recovery_commands.length).toBeGreaterThan(0);
      // Nothing about this changes between runs, so inviting a retry would waste the operator's
      // time on a failure that is deterministic in the repo's size.
      expect(failure.safe_to_retry).toBe(false);
    } finally {
      if (previousBin === undefined) {
        delete process.env.DRIFT_ENGINE_BIN;
      } else {
        process.env.DRIFT_ENGINE_BIN = previousBin;
      }
      if (previousPayload === undefined) {
        delete process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES;
      } else {
        process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES = previousPayload;
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("never returns a failure without an action or a recovery path", async () => {
    // A catch-all is acceptable; a catch-all that says nothing useful is not.
    for (const args of [
      ["conventions", "list", "--repo", "repo_missing"],
      ["findings", "list"],
      ["check", "--repo", "repo_abc"]
    ]) {
      const failure = await failureFor(args);
      expect(failure.code, `${args.join(" ")} produced an empty code`).toBeTruthy();
      expect(failure.user_action, `${args.join(" ")} produced no action`).toBeTruthy();
      expect(
        failure.recovery_commands.length,
        `${args.join(" ")} produced no recovery command`
      ).toBeGreaterThan(0);
    }
  });
});
