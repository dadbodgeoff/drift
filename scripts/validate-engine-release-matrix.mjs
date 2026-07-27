#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const expectedTargets = [
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

const failures = [];
const workflow = readText(".github/workflows/engine-binary-release.yml");
const rootManifest = readJson("package.json");
const cliManifest = readJson("packages/cli/package.json");

for (const target of expectedTargets) {
  const manifest = readJson(`packages/${target.packageDir}/package.json`);
  expectEqual(manifest.name, target.packageName, `${target.packageDir} package name`);
  expectEqual(manifest.version, rootManifest.version, `${target.packageDir} version`);
  expectEqual(manifest.os?.[0], target.os, `${target.packageDir} os`);
  expectEqual(manifest.cpu?.[0], target.cpu, `${target.packageDir} cpu`);
  if (target.libc) {
    expectEqual(manifest.libc?.[0], target.libc, `${target.packageDir} libc`);
  }
  expectEqual(manifest.bin?.["drift-engine"], target.bin, `${target.packageDir} bin`);
  expectIncludes(manifest.files ?? [], "bin", `${target.packageDir} package files`);
  expectIncludes(manifest.files ?? [], "engine-manifest.json", `${target.packageDir} package files`);
  expectEqual(cliManifest.optionalDependencies?.[target.packageName], "workspace:*", `cli optional dependency ${target.packageName}`);

  for (const token of [
    target.target,
    target.packageName,
    `package_dir: ${target.packageDir}`,
    `platform: ${target.os}`,
    `arch: ${target.cpu}`,
    `archive_ext: ${target.archiveExt}`
  ]) {
    expectText(workflow, token, "engine release workflow");
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
  expectText(workflow, token, "engine release workflow");
}

for (const dependency of Object.keys(cliManifest.optionalDependencies ?? {})) {
  if (!expectedTargets.some((target) => target.packageName === dependency)) {
    failures.push(`Unexpected CLI optional engine dependency: ${dependency}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

/**
 * Artifact reality check.
 *
 * Everything above validates package.json *declarations* - bin path, files list. That passed with
 * four of the five platform packages containing no binary at all, which is the same shape of
 * problem this product exists to catch: a check that reports success without checking the thing
 * it names.
 *
 * So also report, per target, whether a binary exists, whether its SHA-256 matches the recorded
 * manifest, and whether it was ever *executed* rather than merely linked. Cross-compiled binaries
 * are reported UNVERIFIED, because that is what they are.
 *
 * Missing artifacts are reported, not fatal: only the host platform can build most of these, so a
 * developer machine legitimately has gaps. `--require-artifacts` makes them fatal, which is what
 * a release job should pass.
 */
const requireArtifacts = process.argv.includes("--require-artifacts");
const artifactRows = [];
for (const target of expectedTargets) {
  const packageRoot = resolve("packages", target.packageDir);
  const binaryPath = resolve(packageRoot, "bin/drift-engine");
  const manifestPath = resolve(packageRoot, "engine-manifest.json");

  if (!existsSync(binaryPath)) {
    artifactRows.push({ target, state: "missing", detail: "no binary — build on its platform" });
    continue;
  }
  if (!existsSync(manifestPath)) {
    artifactRows.push({ target, state: "unrecorded", detail: "binary present but no engine-manifest.json" });
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  if (actual !== manifest.sha256) {
    artifactRows.push({ target, state: "CHECKSUM MISMATCH", detail: `manifest ${String(manifest.sha256).slice(0, 12)} vs actual ${actual.slice(0, 12)}` });
    continue;
  }
  artifactRows.push({
    target,
    state: manifest.verified ? "verified" : "unverified",
    detail: manifest.verified ? String(manifest.verification_note ?? "executed") : "cross-compiled; never executed"
  });
}

console.log(`\nEngine artifacts for Drift ${rootManifest.version}:`);
for (const row of artifactRows) {
  console.log(`  ${row.state.padEnd(18)} ${row.target.packageDir.padEnd(24)} ${row.detail}`);
}

const mismatched = artifactRows.filter((row) => row.state === "CHECKSUM MISMATCH" || row.state === "unrecorded");
const absent = artifactRows.filter((row) => row.state === "missing");
if (mismatched.length > 0) {
  console.error(`\n${mismatched.length} artifact(s) present but untrustworthy. A checksum mismatch means the binary is not the one that was recorded.`);
  process.exit(1);
}
if (requireArtifacts && absent.length > 0) {
  console.error(`\n${absent.length} artifact(s) missing and --require-artifacts was set.`);
  process.exit(1);
}
if (absent.length > 0) {
  console.log(`\n${absent.length} target(s) not built here. Pass --require-artifacts in the release job to make that fatal.`);
}

console.log(`\nValidated ${expectedTargets.length} engine release targets for Drift ${rootManifest.version}.`);

function readText(path) {
  return readFileSync(resolve(path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function expectIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    failures.push(`${label}: missing ${expected}`);
  }
}

function expectText(text, expected, label) {
  if (!text.includes(expected)) {
    failures.push(`${label}: missing ${expected}`);
  }
}
