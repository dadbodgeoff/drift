import { describe, expect, it } from "vitest";
import { runCli } from "../src/app/run-cli.js";

/**
 * T24. A local-first tool's error messages are its support channel - there is no server-side log
 * to consult. Every failure must carry a code, a cause, and a next action.
 *
 * The codes added here are the ones that reached users as raw SQLite or filesystem strings.
 * "database or disk is full" surfaced verbatim mid-scan during development, with no indication
 * of what to do about it.
 */

async function failureFor(args: string[]): Promise<{ code: string; user_action: string; recovery_commands: string[] }> {
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
