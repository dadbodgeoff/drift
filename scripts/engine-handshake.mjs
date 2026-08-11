/**
 * BB-2: the handshake a measuring harness must clear before it is allowed to record a number.
 *
 * On 2026-08-03 a benchmarking session recorded latencies through an engine resolved by
 * `cargo run --quiet` — a debug build, ~2.7x slower (7.88s measured against 22.9s) — and the
 * numbers were published, believed, and then retracted. Nothing in the harness could have caught
 * it: `fallback_status` said `engine_source: "rust", fallback_used: false`, which was true.
 *
 * The fix is structural rather than procedural. A harness that records results asks the engine what
 * it is, and refuses to record anything through a build whose timings do not describe the product.
 * "Refuses" means a non-zero exit with the cause named, not a warning — a warning is exactly what
 * the previous session would have ignored.
 *
 * An engine that cannot answer is also a refusal: `build_profile: null` means unverified, and
 * unverified is not release.
 */

import { spawnSync } from "node:child_process";

/**
 * Ask an engine binary what it is. Never throws; an engine that cannot answer yields
 * `{ build_profile: null }`.
 */
export function engineHandshake(enginePath) {
  const result = spawnSync(enginePath, ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 || !result.stdout) {
    return { build_profile: null, engine_version: null, error: (result.stderr ?? "").trim() || `exit ${result.status}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const profile = parsed.build_profile === "release" || parsed.build_profile === "debug" ? parsed.build_profile : null;
    return {
      build_profile: profile,
      engine_version: typeof parsed.engine_version === "string" ? parsed.engine_version : null,
      error: profile ? null : "handshake did not report a build_profile"
    };
  } catch (error) {
    return { build_profile: null, engine_version: null, error: error.message };
  }
}

/**
 * The refusal itself, separated from the exit so it can be unit-tested without a process.
 *
 * Returns `null` when the engine is fit to measure through, or a message naming the cause.
 */
export function releaseEngineRefusal(handshake, enginePath) {
  if (handshake.build_profile === "release") {
    return null;
  }
  if (handshake.build_profile === "debug") {
    return (
      `refusing to record measurements: ${enginePath} is a debug build (timings run ~2.7x slow and do ` +
      `not describe the shipped product). Run \`cargo build --release -p drift-engine\` and point ` +
      `DRIFT_ENGINE_BIN at target/release/drift-engine.`
    );
  }
  return (
    `refusing to record measurements: ${enginePath} did not report a build profile ` +
    `(${handshake.error ?? "no reason given"}). An unverified engine is not a release engine — ` +
    `rebuild with \`cargo build --release -p drift-engine\`.`
  );
}

/** Clear the handshake or exit 1 with the cause named. Call before the first measured run. */
export function requireReleaseEngine(enginePath) {
  const handshake = engineHandshake(enginePath);
  const refusal = releaseEngineRefusal(handshake, enginePath);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  return handshake;
}
