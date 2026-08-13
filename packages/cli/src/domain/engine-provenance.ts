import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { resolveRustEngineCommand } from "../engine/rust-engine.js";

/**
 * Is this command actually runnable?
 *
 * A PATH lookup rather than spawning the command: probing must not be able to build anything.
 * `cargo run` on a cold target compiles ~200 crates with no output, so "check whether it works by
 * running it" would turn `drift doctor` into a multi-minute silent build.
 */
function commandExists(command: string | null): boolean {
  if (!command) {
    return false;
  }
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => extensions.some((ext) => existsSync(join(directory, `${command}${ext}`))));
}

export type EngineProvenanceSource =
  | "env_override"
  | "packaged_optional_dependency"
  | "workspace_release_binary"
  | "workspace_cargo"
  | "missing";

export interface EngineProvenance {
  status: "available" | "missing" | "invalid";
  source: EngineProvenanceSource;
  path: string | null;
  command: string | null;
  args: string[];
  cwd: string | null;
  package_name: string | null;
  package_version: string | null;
  target_triple: string | null;
  sha256: string | null;
  expected_sha256: string | null;
  checksum_matches: boolean | null;
  override_active: boolean;
  error: string | null;
}

export function engineProvenance(): EngineProvenance {
  try {
    const resolved = resolveRustEngineCommand();
    if (!resolved) {
      return {
        status: "missing",
        source: "missing",
        path: null,
        command: null,
        args: [],
        cwd: null,
        package_name: null,
        package_version: null,
        target_triple: null,
        sha256: null,
        expected_sha256: null,
        checksum_matches: null,
        override_active: Boolean(process.env.DRIFT_ENGINE_BIN),
        error: null
      };
    }

    const expectedSha256 = resolved.expectedSha256 ?? null;
    const actualSha256 = resolved.sha256 ?? null;
    // "available" has to mean the engine can actually run, not merely that we decided what to run.
    //
    // Resolution alone was the whole test, and for `workspace_cargo` nothing was ever executed or
    // stat'd — so on a clone without a Rust toolchain doctor reported
    // `{"status":"available","error":null}` while the very next command died with
    // `spawn cargo ENOENT`. doctor is what the quickstart tells users to run first AND what the
    // missing_engine failure names as its recovery command, so a false all-clear here is the one
    // place a wrong answer is guaranteed to be believed.
    //
    // The workspace path is the only one that needs a probe: env_override and packaged binaries
    // are resolved by stat'ing a file that must already exist.
    const cargoMissing = resolved.source === "workspace_cargo" && !commandExists(resolved.command);
    if (cargoMissing) {
      return {
        status: "missing",
        source: "workspace_cargo",
        path: null,
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd ?? null,
        package_name: null,
        package_version: null,
        target_triple: null,
        sha256: null,
        expected_sha256: null,
        checksum_matches: null,
        override_active: false,
        error: `This is a source checkout with no packaged engine binary, so Drift would build the engine with \`${resolved.command}\` — but \`${resolved.command}\` is not on PATH. Install a Rust toolchain (https://rustup.rs), or set DRIFT_ENGINE_BIN to a prebuilt drift-engine.`
      };
    }
    return {
      status: "available",
      source: resolved.source,
      path: resolved.source === "workspace_cargo" ? null : resolved.command,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd ?? null,
      package_name: resolved.packageName ?? null,
      package_version: resolved.packageVersion ?? null,
      target_triple: resolved.targetTriple ?? null,
      sha256: actualSha256,
      expected_sha256: expectedSha256,
      checksum_matches: actualSha256 && expectedSha256 ? actualSha256 === expectedSha256 : null,
      override_active: resolved.source === "env_override",
      error: null
    };
  } catch (error) {
    return {
      status: "invalid",
      source: process.env.DRIFT_ENGINE_BIN ? "env_override" : "missing",
      path: process.env.DRIFT_ENGINE_BIN ?? null,
      command: null,
      args: [],
      cwd: null,
      package_name: null,
      package_version: null,
      target_triple: null,
      sha256: null,
      expected_sha256: null,
      checksum_matches: false,
      override_active: Boolean(process.env.DRIFT_ENGINE_BIN),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
