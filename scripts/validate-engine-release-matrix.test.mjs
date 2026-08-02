import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_TARGETS, validateEngineReleaseMatrix } from "./validate-engine-release-matrix.mjs";

/**
 * F-5 (D-2). Three verified defects in the release-matrix validator, reproduced live against the
 * working tree before this fix (exit 0, "Validated 5 engine release targets" printed with two
 * unverified artifacts, both with and without --require-artifacts):
 *
 *   (a) unbuilt/unverified targets were never fatal by default - a release job got green with
 *       zero executed binaries;
 *   (b) the manifest's `target` field was never cross-checked against the declared matrix - the
 *       win32 package carries an honest x86_64-pc-windows-gnu manifest while the matrix declares
 *       msvc, and nothing surfaced it;
 *   (c) it printed its own hardcoded "cross-compiled; never executed" instead of the manifest's
 *       verification_note, erasing records like "no Windows host available".
 *
 * Binaries/manifests under packages/engine-*\/ are gitignored local artifacts, so every case here
 * synthesizes its own fixture tree.
 */

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Build a synthetic repo tree whose declarations all pass; artifacts controlled per test. */
function fixtureTree({ artifacts = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "drift-release-matrix-"));
  tempDirs.push(root);

  writeJson(root, "package.json", { name: "drift", version: "0.1.0" });
  const optionalDependencies = {};
  for (const target of EXPECTED_TARGETS) {
    optionalDependencies[target.packageName] = "workspace:*";
  }
  writeJson(root, "packages/cli/package.json", { name: "@drift/cli", version: "0.1.0", optionalDependencies });

  // The real workflow satisfies every token assertion; reuse it instead of restating the list.
  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/engine-binary-release.yml"),
    "utf8"
  );
  writeFile(root, ".github/workflows/engine-binary-release.yml", workflow);

  for (const target of EXPECTED_TARGETS) {
    writeJson(root, `packages/${target.packageDir}/package.json`, {
      name: target.packageName,
      version: "0.1.0",
      os: [target.os],
      cpu: [target.cpu],
      ...(target.libc ? { libc: [target.libc] } : {}),
      bin: { "drift-engine": target.bin },
      files: ["bin", "engine-manifest.json"]
    });

    const spec = artifacts[target.packageDir];
    if (!spec) {
      continue;
    }
    const binary = Buffer.from(`fake-engine-${target.packageDir}`);
    writeFile(root, join("packages", target.packageDir, target.bin.replace(/^\.\//, "")), binary);
    if (spec.manifest === false) {
      continue;
    }
    writeJson(root, `packages/${target.packageDir}/engine-manifest.json`, {
      schema_version: "drift.engine_artifact.v1",
      engine_version: "0.1.0",
      target: spec.manifestTarget ?? target.target,
      os: target.os,
      cpu: target.cpu,
      bin: target.bin,
      sha256: spec.corruptChecksum
        ? "0".repeat(64)
        : createHash("sha256").update(binary).digest("hex"),
      verified: spec.verified ?? false,
      ...(spec.note !== undefined ? { verification_note: spec.note } : {})
    });
  }
  return root;
}

function writeJson(root, path, value) {
  writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function allVerified() {
  const artifacts = {};
  for (const target of EXPECTED_TARGETS) {
    artifacts[target.packageDir] = { verified: true, note: `executed on ${target.target}` };
  }
  return artifacts;
}

describe("release-matrix validator fails closed by default (F-5a)", () => {
  it("passes and claims verification only when every target is verified", () => {
    const root = fixtureTree({ artifacts: allVerified() });
    const result = validateEngineReleaseMatrix({ root });
    expect(result.failures).toEqual([]);
    expect(result.fatal).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("All 5 engine release targets verified for Drift 0.1.0.");
  });

  it("is fatal with zero artifacts present and never prints the Validated claim", () => {
    const root = fixtureTree();
    const result = validateEngineReleaseMatrix({ root });
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBe(5);
    expect(result.summary).toContain("0 of 5 engine release targets verified");
    expect(result.summary).not.toContain("Validated 5");
  });

  it("is fatal when a built target was never executed, naming the escape hatch", () => {
    const artifacts = allVerified();
    artifacts["engine-win32-x64"] = { verified: false, note: "cross-compiled; no Windows host" };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root });
    expect(result.ok).toBe(false);
    expect(result.fatal.some((line) => line.includes("never verified by execution"))).toBe(true);
    expect(result.fatal.some((line) => line.includes("--allow-unverified"))).toBe(true);
  });

  it("tolerates missing/unverified only under --allow-unverified, still reporting them", () => {
    const artifacts = allVerified();
    delete artifacts["engine-linux-arm64-gnu"];
    artifacts["engine-win32-x64"] = { verified: false, note: "cross-compiled; no Windows host" };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain("3 of 5 engine release targets verified");
  });

  it("keeps missing artifacts fatal under --allow-unverified when --require-artifacts is set", () => {
    const artifacts = allVerified();
    delete artifacts["engine-linux-arm64-gnu"];
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true, requireArtifacts: true });
    expect(result.ok).toBe(false);
    expect(result.fatal.some((line) => line.includes("artifact missing"))).toBe(true);
  });

  it("never tolerates a checksum mismatch, even under --allow-unverified", () => {
    const artifacts = allVerified();
    artifacts["engine-darwin-x64"] = { verified: true, note: "executed", corruptChecksum: true };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true });
    expect(result.ok).toBe(false);
    expect(result.fatal.some((line) => line.includes("checksum mismatch"))).toBe(true);
  });
});

describe("manifest target is cross-checked against the declared matrix (F-5b)", () => {
  it("is fatal on an unacknowledged target substitution, naming the ack flag", () => {
    const artifacts = allVerified();
    artifacts["engine-win32-x64"] = {
      verified: true,
      note: "executed under wine",
      manifestTarget: "x86_64-pc-windows-gnu"
    };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root });
    expect(result.ok).toBe(false);
    expect(
      result.fatal.some((line) =>
        line.includes("matrix declares x86_64-pc-windows-msvc") &&
        line.includes("records x86_64-pc-windows-gnu") &&
        line.includes("--accept-target-mismatch engine-win32-x64:x86_64-pc-windows-gnu")
      )
    ).toBe(true);
  });

  it("downgrades an explicitly acknowledged substitution to a warning (D-5 authorizes the gnu build)", () => {
    const artifacts = allVerified();
    artifacts["engine-win32-x64"] = {
      verified: true,
      note: "executed under wine",
      manifestTarget: "x86_64-pc-windows-gnu"
    };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({
      root,
      acceptedTargetMismatches: ["engine-win32-x64:x86_64-pc-windows-gnu"]
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((line) => line.includes("explicitly acknowledged"))).toBe(true);
  });

  it("surfaces the mismatch as a warning in dev mode instead of staying silent", () => {
    const artifacts = allVerified();
    artifacts["engine-win32-x64"] = {
      verified: false,
      note: "cross-compiled",
      manifestTarget: "x86_64-pc-windows-gnu"
    };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((line) => line.includes("records x86_64-pc-windows-gnu"))).toBe(true);
  });
});

describe("the manifest's own verification_note is reported (F-5c)", () => {
  it("shows the manifest's note for unverified artifacts instead of a hardcoded string", () => {
    const artifacts = allVerified();
    artifacts["engine-win32-x64"] = {
      verified: false,
      note: "cross-compiled; built but never executed — no Windows host available on this machine"
    };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true });
    const row = result.artifactRows.find((entry) => entry.target.packageDir === "engine-win32-x64");
    expect(row?.state).toBe("unverified");
    expect(row?.detail).toContain("no Windows host available");
  });

  it("falls back honestly when a manifest predates verification recording", () => {
    const artifacts = allVerified();
    artifacts["engine-darwin-arm64"] = { verified: false };
    const root = fixtureTree({ artifacts });
    const result = validateEngineReleaseMatrix({ root, allowUnverified: true });
    const row = result.artifactRows.find((entry) => entry.target.packageDir === "engine-darwin-arm64");
    expect(row?.detail).toBe("no verification recorded in manifest");
  });
});

describe("the artifact check looks at the binary the matrix names (win32 .exe)", () => {
  it("does not report the win32 target missing when only drift-engine.exe exists", () => {
    const root = fixtureTree({ artifacts: allVerified() });
    const result = validateEngineReleaseMatrix({ root });
    const row = result.artifactRows.find((entry) => entry.target.packageDir === "engine-win32-x64");
    // fixtureTree writes the binary at target.bin (bin/drift-engine.exe) only; the old
    // hardcoded bin/drift-engine lookup reported this as missing.
    expect(row?.state).toBe("verified");
  });
});
