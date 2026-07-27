import { describe, expect, it } from "vitest";
import { DriftError, isDriftError } from "../src/app/drift-error.js";

/**
 * T23. The CLI's top-level handler classified failures by matching message text
 * (`message.startsWith("Scan is stale")` and seven more). That was fragile before and became
 * load-bearing once A5 made exit codes a contract: the stale-scan branch maps to exit 3, a
 * fail-closed refusal, so rewording an error string silently changed exit-code behaviour.
 */
describe("DriftError", () => {
  it("carries its own classification rather than relying on message text", () => {
    const error = new DriftError("Scan is stale for repo_abc.", {
      code: "stale_scan",
      userAction: "Refresh the scan.",
      recoveryCommands: ["drift scan status --json"]
    });
    expect(isDriftError(error)).toBe(true);
    expect(error.code).toBe("stale_scan");
    expect(error.recoveryCommands).toEqual(["drift scan status --json"]);
    // Rewording the message must not change how it is classified.
    const reworded = new DriftError("The stored scan is out of date.", {
      code: "stale_scan",
      userAction: "Refresh the scan."
    });
    expect(reworded.code).toBe(error.code);
  });

  it("defaults to retryable, and names an action", () => {
    const error = new DriftError("boom", { code: "cli_error", userAction: "Try again." });
    expect(error.safeToRetry).toBe(true);
    expect(error.userAction).not.toBe("");
    expect(error.recoveryCommands).toEqual([]);
  });

  it("can declare a failure that retrying will not fix", () => {
    const error = new DriftError("Unsupported local state schema.", {
      code: "unsupported_database",
      userAction: "Upgrade Drift.",
      safeToRetry: false
    });
    expect(error.safeToRetry).toBe(false);
  });

  it("is still an Error, so existing handlers keep working", () => {
    const error = new DriftError("x", { code: "cli_error", userAction: "y" });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("x");
    expect(isDriftError(new Error("plain"))).toBe(false);
  });
});
