import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { engineHandshake, releaseEngineRefusal } from "./engine-handshake.mjs";

/**
 * BB-2. A measuring harness must not be able to record a number through a debug engine. On
 * 2026-08-03 one did: latencies were recorded through `cargo run --quiet` (debug, ~2.7x slow),
 * published, believed, and retracted. The refusal below is what makes that structurally
 * unrepeatable.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const DEBUG_ENGINE = join(REPO_ROOT, "target/debug/drift-engine");

describe("BB-2 release-engine handshake", () => {
  it("clears a release engine", () => {
    expect(existsSync(RELEASE_ENGINE)).toBe(true);
    const handshake = engineHandshake(RELEASE_ENGINE);
    expect(handshake.build_profile).toBe("release");
    expect(releaseEngineRefusal(handshake, RELEASE_ENGINE)).toBeNull();
  });

  it("refuses a debug engine and names the fix", () => {
    if (!existsSync(DEBUG_ENGINE)) {
      // Build it rather than skip: a skipped test here would mean the debug refusal is unproven,
      // which is the exact hole this item closes. `reclaim-disk.sh` deletes debug artifacts by
      // design, so absence is normal rather than a misconfiguration.
      execFileSync("cargo", ["build", "-p", "drift-engine"], { cwd: REPO_ROOT, stdio: "ignore" });
    }
    const handshake = engineHandshake(DEBUG_ENGINE);
    expect(handshake.build_profile).toBe("debug");
    const refusal = releaseEngineRefusal(handshake, DEBUG_ENGINE);
    expect(refusal).toContain("refusing to record measurements");
    expect(refusal).toContain("cargo build --release -p drift-engine");
  });

  it("refuses an engine that cannot report a profile - unverified is not release", () => {
    const handshake = engineHandshake(join(REPO_ROOT, "target/release/no-such-engine"));
    expect(handshake.build_profile).toBeNull();
    expect(releaseEngineRefusal(handshake, "no-such-engine")).toContain("did not report a build profile");
  });
});
