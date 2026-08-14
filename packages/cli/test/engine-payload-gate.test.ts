import { constants as bufferConstants } from "node:buffer";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import {
  ENGINE_PAYLOAD_MAX_BYTES,
  ENGINE_PAYLOAD_STRINGIFY_RATIO_BOUND,
  MEASURED_CORPUS_ENGINE_PAYLOAD_BYTES
} from "../src/engine/engine-payload-limits.js";

/**
 * T-01: onboarding must refuse a repo whose engine payload it cannot serialize, and say so.
 *
 * `infer-candidates` re-serializes the ENTIRE graph and fact set into one JSON string and sends it
 * back to the engine (engine-candidates.ts:21), against a MAX_STRING_LENGTH of 536,870,888. Above
 * that the onboarding dies with `Invalid string length` - exit 1, a 495,616-byte partial database
 * left on disk, and every later command exiting 1 against it.
 *
 * The gate reads the engine's JSONL stream size, which is ~1x the string that gets built from it
 * (measured 0.973x on papermark). cal.com, the largest corpus repo, streams 395.5 MiB and so lands
 * around 75% of the ceiling - the working headroom is thin, and the ceiling and its derivation
 * both belong under test. See engine-payload-limits.ts for the full measurement record.
 *
 * This gate does not make large repos work; T-02 does that by removing the re-serialization. It
 * makes the failure honest: a refusal that names the measurement, before anything is written.
 */

const ENGINE_STUB = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "stub-payload-engine.mjs"
);

const tempDirs: string[] = [];
// afterAll, not afterEach: the refusal's state directory is asserted on by more than one test.
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<{ repoRoot: string; statePath: string; stateDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-payload-gate-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  await mkdir(join(repoRoot, "app/api/x"), { recursive: true });
  await writeFile(join(repoRoot, "package.json"), '{"name":"pg","version":"1.0.0"}\n');
  await writeFile(
    join(repoRoot, "app/api/x/route.ts"),
    "export async function GET(){return Response.json({})}\n"
  );
  const stateDir = join(dir, "state");
  await mkdir(stateDir, { recursive: true });
  return { repoRoot, statePath: join(stateDir, "drift.db"), stateDir };
}

async function startWithEnginePayload(
  payloadBytes: number,
  fixtureDirs: { repoRoot: string; statePath: string }
) {
  const previousBin = process.env.DRIFT_ENGINE_BIN;
  const previousPayload = process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES;
  try {
    process.env.DRIFT_ENGINE_BIN = ENGINE_STUB;
    process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES = String(payloadBytes);
    return await runCli([
      "start",
      "--repo-root",
      fixtureDirs.repoRoot,
      "--db",
      fixtureDirs.statePath,
      "--accept-defaults",
      "--json"
    ]);
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
  }
}

const MEBIBYTE = 1024 * 1024;

describe("engine payload ingest gate", () => {
  // One onboarding, examined four ways. Crossing the ceiling means streaming most of a gigabyte
  // through the stub, so the run is shared rather than repeated per assertion.
  const OVER_CEILING = ENGINE_PAYLOAD_MAX_BYTES + 3 * MEBIBYTE;
  let refusal: { exitCode: number; stdout: string };
  let refusedDirs: { repoRoot: string; statePath: string; stateDir: string };

  beforeAll(async () => {
    refusedDirs = await fixture();
    refusal = await startWithEnginePayload(OVER_CEILING, refusedDirs);
  }, 300_000);

  it("refuses, as a refusal rather than an error", () => {
    // Today: exit 0. Nothing measures the payload at all, at any size - the only thing that ever
    // stops an oversized repo is `JSON.stringify` throwing, which arrives as exit 1 with no code
    // and no action.
    expect(refusal.exitCode).toBe(3);
    expect(JSON.parse(refusal.stdout).error.code).toBe("engine_payload_too_large");
  });

  it("names the measurement and the ceiling, so the number is checkable from the message", () => {
    const message = JSON.parse(refusal.stdout).error.message as string;

    // Both numbers, in one shape: what was measured and what is supported. Asserted by pattern
    // rather than by literal, because the stub can only overshoot its target to a whole event -
    // and the message must report what the engine actually sent, not what was asked for.
    const numbers = message.match(/is (\d+) MB, above the (\d+) MB/);
    expect(numbers, `message did not state a measurement and a ceiling: ${message}`).not.toBeNull();
    const [, measured, ceiling] = numbers as RegExpMatchArray;
    expect(Number(ceiling)).toBe(Math.round(ENGINE_PAYLOAD_MAX_BYTES / MEBIBYTE));
    expect(Number(measured)).toBeGreaterThan(Number(ceiling));
    // That the repo is outside the supported envelope, not that Drift is broken.
    expect(message.toLowerCase()).toContain("supported");
  });

  it("leaves no database behind, having onboarded nothing", () => {
    // Today: a 495,616-byte partial database survives, and every later command exits 1 on it.
    expect(existsSync(refusedDirs.statePath)).toBe(false);
    expect(readdirSync(refusedDirs.stateDir)).toEqual([]);
  });

  it("does not refuse a payload under the ceiling", async () => {
    const dirs = await fixture();

    const result = await startWithEnginePayload(4096, dirs);

    expect(result.exitCode).toBe(0);
    expect(existsSync(dirs.statePath)).toBe(true);
  }, 120_000);
});

describe("the ceiling's derivation", () => {
  /**
   * The threshold is not a taste call, so these assert the two measurements it sits between
   * rather than the number itself. If either fails, the constant is wrong - not the test.
   */

  it("sits above every corpus repo that onboards today", () => {
    for (const [repo, bytes] of Object.entries(MEASURED_CORPUS_ENGINE_PAYLOAD_BYTES)) {
      expect(
        ENGINE_PAYLOAD_MAX_BYTES,
        `${repo} onboards today at ${Math.round(bytes / MEBIBYTE)} MB and must keep onboarding`
      ).toBeGreaterThan(bytes);
    }
  });

  it("sits below the payload whose re-serialization would exceed MAX_STRING_LENGTH", () => {
    // The gate's whole guarantee: anything it lets through can still be serialized.
    expect(ENGINE_PAYLOAD_MAX_BYTES * ENGINE_PAYLOAD_STRINGIFY_RATIO_BOUND).toBeLessThan(
      bufferConstants.MAX_STRING_LENGTH
    );
  });

  it("bounds the stringify ratio at or above every ratio measured", () => {
    // papermark at d2517b9: 107,938,762 stream bytes -> 105,027,953 stringify chars.
    expect(ENGINE_PAYLOAD_STRINGIFY_RATIO_BOUND).toBeGreaterThanOrEqual(105_027_953 / 107_938_762);
  });
});
