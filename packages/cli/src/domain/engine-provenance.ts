import { resolveRustEngineCommand } from "../engine/rust-engine.js";

export type EngineProvenanceSource =
  | "env_override"
  | "packaged_optional_dependency"
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
