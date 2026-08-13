import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { collectScanData } from "../src/engine/collect-scan-data.js";
import {
  engineHandshake,
  engineNotMeasurableWarning,
  engineResolutionStatus,
  resetEngineProvenanceCachesForTest
} from "../src/engine/rust-engine.js";

/**
 * BB-2. `resolveRustEngineCommand` has always had a three-way `source` discriminant and propagated
 * it nowhere, so a `cargo run --quiet` debug engine - measured at 22.9s against the release engine's
 * 7.88s on the same check - reported itself as `engine_source: "rust", fallback_used: false`. True,
 * and materially misleading: it cost a careful evaluator half a session on 2026-08-03 and produced
 * latency numbers that had to be retracted.
 *
 * These tests pin the two halves of the fix: provenance is reported, and an engine you should not
 * measure through says so on stderr.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RELEASE_ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const DEBUG_ENGINE = join(REPO_ROOT, "target/debug/drift-engine");

const withEnv = async <T>(overrides: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> => {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

async function fixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb2-"));
  await mkdir(join(dir, "app/api/users"), { recursive: true });
  await writeFile(
    join(dir, "app/api/users/route.ts"),
    "export async function GET() { return Response.json({ ok: true }); }\n"
  );
  return dir;
}

/**
 * Capture what the CLI writes to stderr while `run` executes. `process.stderr.write` rather than a
 * spawned process, because the assertion is about the library seam every command shares.
 */
async function capturedStderr(run: () => Promise<unknown>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return original(chunk as string, ...(rest as []));
  }) as typeof process.stderr.write;
  try {
    await run();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

describe("BB-2 engine provenance", () => {
  afterEach(() => {
    resetEngineProvenanceCachesForTest();
  });

  it("reports the engine's own build profile through the version handshake", () => {
    // The engine is the only honest source: a release binary can sit under target/debug, so no
    // inference from path names is acceptable.
    expect(existsSync(RELEASE_ENGINE)).toBe(true);
    expect(engineHandshake({ command: RELEASE_ENGINE, args: [], source: "env_override" }).build_profile).toBe(
      "release"
    );
  });

  it("treats an engine that cannot answer as unverified rather than release", () => {
    expect(
      engineHandshake({ command: join(tmpdir(), "drift-bb2-no-such-engine"), args: [], source: "env_override" })
        .build_profile
    ).toBeNull();
  });

  it("names env_override resolution when DRIFT_ENGINE_BIN points at the engine", async () => {
    await withEnv({ DRIFT_ENGINE_BIN: RELEASE_ENGINE }, () => {
      expect(engineResolutionStatus()).toEqual({ resolution: "env_override", build_profile: "release" });
    });
  });

  it("prefers the built release binary over cargo inside the cargo workspace", async () => {
    await withEnv({ DRIFT_ENGINE_BIN: undefined }, () => {
      // startDir inside this repo, which is the cargo workspace root - the fallback branch the
      // 2026-08-03 confound came from. This checkout has target/release/drift-engine built.
      //
      // Resolution used to go straight to `cargo run`, which builds and runs DEBUG, so
      // `pnpm build:engine` had no effect on the CLI at all. Measured on dub: 76s through
      // `cargo run` vs 26s on the release binary, on every command, silently.
      const status = engineResolutionStatus({ env: {}, startDir: join(REPO_ROOT, "packages/cli/src") });
      expect(status.resolution).toBe("workspace_release_binary");
    });
  });

  it("still falls back to cargo in a workspace that has not been built", async () => {
    // A synthetic workspace with no target/release, so this branch is exercised deterministically
    // rather than depending on whether the checkout happens to have run `pnpm build:engine`.
    const dir = await mkdtemp(join(tmpdir(), "drift-unbuilt-workspace-"));
    await mkdir(join(dir, "crates", "drift-engine"), { recursive: true });
    await writeFile(join(dir, "Cargo.toml"), "[workspace]\nmembers = [\"crates/drift-engine\"]\n");

    await withEnv({ DRIFT_ENGINE_BIN: undefined }, () => {
      const status = engineResolutionStatus({ env: {}, startDir: join(dir, "crates", "drift-engine") });
      expect(status.resolution).toBe("workspace_cargo");
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("carries engine_resolution and engine_build_profile on a real scan's fallback_status", async () => {
    const dir = await fixtureRepo();
    try {
      await withEnv({ DRIFT_ENGINE_BIN: RELEASE_ENGINE, DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK: undefined }, async () => {
        const scanData = await collectScanData({ repoId: "repo_bb2", scanId: "scan_bb2", repoRoot: dir });
        expect(scanData.fallbackStatus).toMatchObject({
          engine_source: "rust",
          fallback_used: false,
          engine_resolution: "env_override",
          engine_build_profile: "release"
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports neither field for the TypeScript scanner, which is not the Rust engine", async () => {
    const dir = await fixtureRepo();
    try {
      await withEnv(
        {
          DRIFT_ENGINE_BIN: join(dir, "missing-engine"),
          DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK: "1"
        },
        async () => {
          const scanData = await collectScanData({ repoId: "repo_bb2", scanId: "scan_bb2_ts", repoRoot: dir });
          expect(scanData.fallbackStatus).toMatchObject({
            engine_source: "typescript",
            engine_resolution: null,
            engine_build_profile: null
          });
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe("the loud part", () => {
    it("warns once on stderr when the engine that answered is a debug build", async () => {
      if (!existsSync(DEBUG_ENGINE)) {
        // `cargo build -p drift-engine` has not run in this checkout. Refuse to pass vacuously.
        execFileSync("cargo", ["build", "-p", "drift-engine"], { cwd: REPO_ROOT, stdio: "ignore" });
      }
      const dir = await fixtureRepo();
      try {
        const captured = await withEnv({ DRIFT_ENGINE_BIN: DEBUG_ENGINE }, () =>
          capturedStderr(() => collectScanData({ repoId: "repo_bb2", scanId: "scan_bb2_debug", repoRoot: dir }))
        );
        expect(captured).toContain("warning: drift-engine is a debug build");
        expect(captured).toContain("set DRIFT_ENGINE_BIN for measurements");
        // Once, not per spawn - warning fatigue is how the previous session learned to ignore it.
        expect(captured.match(/warning: drift-engine/g)).toHaveLength(1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("says nothing for a release engine resolved by env override", async () => {
      const dir = await fixtureRepo();
      try {
        const captured = await withEnv({ DRIFT_ENGINE_BIN: RELEASE_ENGINE }, () =>
          capturedStderr(() => collectScanData({ repoId: "repo_bb2", scanId: "scan_bb2_quiet", repoRoot: dir }))
        );
        expect(captured).not.toContain("warning: drift-engine");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("warns for a cargo-run resolution regardless of what profile it reports", () => {
      // The cargo fallback is a debug build by construction, but the warning must not depend on the
      // handshake succeeding - resolution alone is enough to know the timings are worthless.
      expect(engineNotMeasurableWarning("workspace_cargo", null)?.cause).toBe("workspace_cargo");
      expect(engineNotMeasurableWarning("workspace_cargo", "release")?.line).toContain("resolved via cargo run");
    });

    it("does not warn for a packaged release engine", () => {
      expect(engineNotMeasurableWarning("packaged_optional_dependency", "release")).toBeNull();
      expect(engineNotMeasurableWarning("env_override", "release")).toBeNull();
    });

    it("warns for a debug profile reached by any route, not only cargo", () => {
      expect(engineNotMeasurableWarning("env_override", "debug")?.cause).toBe("debug_profile");
      expect(engineNotMeasurableWarning("packaged_optional_dependency", "debug")?.cause).toBe("debug_profile");
    });

    it("does not warn when the profile is merely unverified", () => {
      // An unverified engine is a reason for a measuring harness to refuse (see
      // scripts/engine-handshake.mjs), but not a reason to print a warning on every user command:
      // a stub engine in someone's test suite is not a misconfiguration of theirs.
      expect(engineNotMeasurableWarning("env_override", null)).toBeNull();
    });
  });
});
