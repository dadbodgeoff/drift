#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_TARGETS = [
  {
    target: "aarch64-apple-darwin",
    packageDir: "engine-darwin-arm64",
    packageName: "@drift/engine-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    bin: "./bin/drift-engine",
    archiveExt: "tar.gz"
  },
  {
    target: "x86_64-apple-darwin",
    packageDir: "engine-darwin-x64",
    packageName: "@drift/engine-darwin-x64",
    os: "darwin",
    cpu: "x64",
    bin: "./bin/drift-engine",
    archiveExt: "tar.gz"
  },
  {
    target: "x86_64-unknown-linux-gnu",
    packageDir: "engine-linux-x64-gnu",
    packageName: "@drift/engine-linux-x64-gnu",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
    bin: "./bin/drift-engine",
    archiveExt: "tar.gz"
  },
  {
    target: "aarch64-unknown-linux-gnu",
    packageDir: "engine-linux-arm64-gnu",
    packageName: "@drift/engine-linux-arm64-gnu",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
    bin: "./bin/drift-engine",
    archiveExt: "tar.gz"
  },
  {
    target: "x86_64-pc-windows-msvc",
    packageDir: "engine-win32-x64",
    packageName: "@drift/engine-win32-x64",
    os: "win32",
    cpu: "x64",
    bin: "./bin/drift-engine.exe",
    archiveExt: "zip"
  }
];

/**
 * Validate the engine release matrix: package declarations, workflow coverage, and - the part
 * that was broken - artifact reality.
 *
 * F-5 (D-2): the previous version exited 0 printing "Validated 5 engine release targets" with
 * zero artifacts present, with every artifact unverified, and even with --require-artifacts when
 * artifacts were merely unverified - a B-4-class check that reports success without checking the
 * thing it names, in the release tooling itself. It also never compared the manifest's `target`
 * against the declared matrix (the win32 package carries an honest x86_64-pc-windows-gnu manifest
 * while the matrix declares msvc), and replaced each manifest's own verification_note with a
 * hardcoded "cross-compiled; never executed".
 *
 * Defaults now fail closed: anything short of a verified artifact on every target is fatal.
 * Escape hatches are explicit and named in the output:
 *   --allow-unverified                       dev machines: missing/unverified tolerated (reported);
 *                                            checksum mismatches and unrecorded binaries stay fatal
 *   --require-artifacts                      with --allow-unverified: missing still fatal
 *   --accept-target-mismatch <dir>:<target>  acknowledge a deliberate target substitution (D-5
 *                                            authorizes shipping the windows-gnu build); repeatable
 */
export function validateEngineReleaseMatrix(options = {}) {
  const root = options.root ?? ".";
  const requireArtifacts = options.requireArtifacts ?? false;
  const allowUnverified = options.allowUnverified ?? false;
  const acceptedTargetMismatches = new Set(options.acceptedTargetMismatches ?? []);

  const failures = [];
  const warnings = [];
  const fatal = [];

  const workflow = readText(root, ".github/workflows/engine-binary-release.yml");
  const rootManifest = readJson(root, "package.json");
  const cliManifest = readJson(root, "packages/cli/package.json");

  for (const target of EXPECTED_TARGETS) {
    const manifest = readJson(root, `packages/${target.packageDir}/package.json`);
    expectEqual(failures, manifest.name, target.packageName, `${target.packageDir} package name`);
    expectEqual(failures, manifest.version, rootManifest.version, `${target.packageDir} version`);
    expectEqual(failures, manifest.os?.[0], target.os, `${target.packageDir} os`);
    expectEqual(failures, manifest.cpu?.[0], target.cpu, `${target.packageDir} cpu`);
    if (target.libc) {
      expectEqual(failures, manifest.libc?.[0], target.libc, `${target.packageDir} libc`);
    }
    expectEqual(failures, manifest.bin?.["drift-engine"], target.bin, `${target.packageDir} bin`);
    expectIncludes(failures, manifest.files ?? [], "bin", `${target.packageDir} package files`);
    expectIncludes(failures, manifest.files ?? [], "engine-manifest.json", `${target.packageDir} package files`);
    expectEqual(
      failures,
      cliManifest.optionalDependencies?.[target.packageName],
      "workspace:*",
      `cli optional dependency ${target.packageName}`
    );

    for (const token of [
      target.target,
      target.packageName,
      `package_dir: ${target.packageDir}`,
      `platform: ${target.os}`,
      `arch: ${target.cpu}`,
      `archive_ext: ${target.archiveExt}`
    ]) {
      expectText(failures, workflow, token, "engine release workflow");
    }
  }

  for (const token of [
    "workflow_dispatch:",
    "dry_run:",
    "pnpm verify:ci",
    "node scripts/validate-engine-release-matrix.mjs",
    "cargo build --locked --release -p drift-engine",
    "Native engine smoke",
    "SHA256SUMS",
    "test \"$(grep -c '^' SHA256SUMS)\" -eq 5",
    "unset DRIFT_ENGINE_BIN",
    "npm_config_provenance=true npm publish",
    "if: ${{ inputs.dry_run == false || startsWith(github.ref, 'refs/tags/v') }}"
  ]) {
    expectText(failures, workflow, token, "engine release workflow");
  }

  for (const dependency of Object.keys(cliManifest.optionalDependencies ?? {})) {
    if (!EXPECTED_TARGETS.some((target) => target.packageName === dependency)) {
      failures.push(`Unexpected CLI optional engine dependency: ${dependency}`);
    }
  }

  // Artifact reality check. Everything above validates *declarations*; this validates the
  // binaries themselves: presence, checksum against the recorded manifest, whether the build
  // was ever executed, and whether the manifest's target matches the one the matrix declares.
  const artifactRows = [];
  for (const target of EXPECTED_TARGETS) {
    const packageRoot = resolve(root, "packages", target.packageDir);
    // The binary named by the matrix (win32 is drift-engine.exe - the old hardcoded
    // "bin/drift-engine" silently checked the wrong filename on that target).
    const binaryPath = resolve(packageRoot, target.bin);
    const manifestPath = resolve(packageRoot, "engine-manifest.json");

    if (!existsSync(binaryPath)) {
      artifactRows.push({ target, state: "missing", detail: `no binary at ${target.bin} — build on its platform` });
      continue;
    }
    if (!existsSync(manifestPath)) {
      artifactRows.push({ target, state: "unrecorded", detail: "binary present but no engine-manifest.json" });
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
    if (actual !== manifest.sha256) {
      artifactRows.push({
        target,
        state: "CHECKSUM MISMATCH",
        detail: `manifest ${String(manifest.sha256).slice(0, 12)} vs actual ${actual.slice(0, 12)}`
      });
      continue;
    }
    // Cross-check the manifest's own target against the matrix declaration. The manifest is the
    // honest record of what was built; the matrix is what the release claims to ship.
    const manifestTarget = manifest.target ?? manifest.target_triple ?? null;
    const targetMismatch = manifestTarget && manifestTarget !== target.target ? manifestTarget : null;
    artifactRows.push({
      target,
      state: manifest.verified ? "verified" : "unverified",
      // The manifest's verification_note is the record of what was (or was not) done; the old
      // hardcoded string here erased notes like "no Windows host available".
      detail: String(
        manifest.verification_note ??
          (manifest.verified ? "executed" : "no verification recorded in manifest")
      ),
      targetMismatch
    });
  }

  for (const row of artifactRows) {
    if (row.state === "CHECKSUM MISMATCH" || row.state === "unrecorded") {
      fatal.push(
        `${row.target.packageDir}: ${row.state === "unrecorded" ? "binary present but unrecorded" : "checksum mismatch"} - ` +
          `the artifact is not the one that was recorded (${row.detail}). Never tolerated.`
      );
      continue;
    }
    if (row.targetMismatch) {
      const ackKey = `${row.target.packageDir}:${row.targetMismatch}`;
      const message =
        `${row.target.packageDir}: matrix declares ${row.target.target} but the artifact manifest ` +
        `records ${row.targetMismatch}`;
      if (acceptedTargetMismatches.has(ackKey)) {
        warnings.push(`${message} - explicitly acknowledged via --accept-target-mismatch ${ackKey}`);
      } else if (allowUnverified) {
        warnings.push(`${message} - shipping this requires --accept-target-mismatch ${ackKey} in the release job`);
      } else {
        fatal.push(`${message}. If shipping this substitute is deliberate, pass --accept-target-mismatch ${ackKey}.`);
      }
    }
    if (row.state === "missing") {
      if (allowUnverified && !requireArtifacts) {
        warnings.push(`${row.target.packageDir}: ${row.detail}`);
      } else {
        fatal.push(`${row.target.packageDir}: artifact missing (${row.detail}).`);
      }
      continue;
    }
    if (row.state === "unverified") {
      if (allowUnverified) {
        warnings.push(`${row.target.packageDir}: built but not verified by execution - ${row.detail}`);
      } else {
        fatal.push(
          `${row.target.packageDir}: built but never verified by execution (${row.detail}). ` +
            `A release must not ship an unexecuted binary; verify it on its platform, or pass ` +
            `--allow-unverified on a dev machine.`
        );
      }
    }
  }

  const verifiedCount = artifactRows.filter((row) => row.state === "verified").length;
  const summary =
    failures.length === 0 && fatal.length === 0 && verifiedCount === EXPECTED_TARGETS.length
      ? `All ${EXPECTED_TARGETS.length} engine release targets verified for Drift ${rootManifest.version}.`
      : `${verifiedCount} of ${EXPECTED_TARGETS.length} engine release targets verified for Drift ${rootManifest.version} ` +
        `(${artifactRows.filter((row) => row.state === "unverified").length} unverified, ` +
        `${artifactRows.filter((row) => row.state === "missing").length} missing, ` +
        `${artifactRows.filter((row) => row.state === "CHECKSUM MISMATCH" || row.state === "unrecorded").length} untrustworthy).`;

  return {
    failures,
    warnings,
    fatal,
    artifactRows,
    summary,
    version: rootManifest.version,
    ok: failures.length === 0 && fatal.length === 0
  };
}

function main() {
  const argv = process.argv.slice(2);
  const acceptedTargetMismatches = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--accept-target-mismatch" && argv[index + 1]) {
      acceptedTargetMismatches.push(argv[index + 1]);
      index++;
    }
  }
  const result = validateEngineReleaseMatrix({
    requireArtifacts: argv.includes("--require-artifacts"),
    allowUnverified: argv.includes("--allow-unverified"),
    acceptedTargetMismatches
  });

  if (result.failures.length > 0) {
    console.error(result.failures.join("\n"));
    process.exit(1);
  }

  console.log(`\nEngine artifacts for Drift ${result.version}:`);
  for (const row of result.artifactRows) {
    console.log(`  ${row.state.padEnd(18)} ${row.target.packageDir.padEnd(24)} ${row.detail}`);
  }
  for (const warning of result.warnings) {
    console.log(`\nwarning: ${warning}`);
  }
  if (result.fatal.length > 0) {
    console.error(`\n${result.fatal.map((line) => `fatal: ${line}`).join("\n")}`);
    console.error(`\n${result.summary}`);
    process.exit(1);
  }
  console.log(`\n${result.summary}`);
}

function readText(root, path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function expectEqual(failures, actual, expected, label) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function expectIncludes(failures, values, expected, label) {
  if (!values.includes(expected)) {
    failures.push(`${label}: missing ${expected}`);
  }
}

function expectText(failures, text, expected, label) {
  if (!text.includes(expected)) {
    failures.push(`${label}: missing ${expected}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
