import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRIFT_RESOLVER_VERSION,
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION
} from "../src/versions.js";

/**
 * T63. These are separate constants that currently all read the same string, which makes them
 * look interchangeable. They are not, and T15 depended on that: incremental reuse needs the
 * *engine* version, and no TypeScript constant tracks it, so `DRIFT_SCANNER_VERSION` could not
 * stand in. The version had to be threaded from the engine's own `scan_started` event instead.
 *
 * Until they are genuinely single-sourced, these tests pin the coupling that already exists so
 * a bump cannot silently desynchronise them from the workspace version or from Cargo.
 */

const REPO_ROOT = join(import.meta.dirname, "../../..");

function workspaceVersion(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return manifest.version ?? "";
}

function cargoWorkspaceVersion(): string {
  const cargo = readFileSync(join(REPO_ROOT, "Cargo.toml"), "utf8");
  return cargo.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
}

function engineVersion(): string {
  const lib = readFileSync(join(REPO_ROOT, "crates/drift-engine/src/lib.rs"), "utf8");
  return lib.match(/DRIFT_ENGINE_VERSION:\s*&str\s*=\s*"([^"]+)"/)?.[1] ?? "";
}

describe("version constants stay in step", () => {
  it("reports a workspace version", () => {
    expect(workspaceVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("keeps the TypeScript constants aligned with the workspace version", () => {
    const version = workspaceVersion();
    for (const [name, value] of [
      ["DRIFT_SCANNER_VERSION", DRIFT_SCANNER_VERSION],
      ["DRIFT_TYPESCRIPT_ADAPTER_VERSION", DRIFT_TYPESCRIPT_ADAPTER_VERSION],
      ["DRIFT_RULE_ENGINE_VERSION", DRIFT_RULE_ENGINE_VERSION],
      ["DRIFT_RESOLVER_VERSION", DRIFT_RESOLVER_VERSION]
    ] as const) {
      expect(value, `${name} drifted from package.json version ${version}`).toBe(version);
    }
  });

  it("keeps the Rust engine version aligned with the Cargo workspace version", () => {
    const cargo = cargoWorkspaceVersion();
    if (!cargo) {
      // Workspace inherits; nothing to compare against.
      return;
    }
    expect(engineVersion()).toBe(cargo);
  });

  it("keeps the engine version aligned with the npm workspace version", () => {
    // The reuse gate in T15 compares a stored engine version against the running engine, so a
    // divergence here would make reuse silently refuse forever, or worse, silently accept.
    expect(engineVersion()).toBe(workspaceVersion());
  });
});
