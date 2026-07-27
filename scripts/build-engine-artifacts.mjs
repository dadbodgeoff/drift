#!/usr/bin/env node
/**
 * Build `drift-engine` into the platform packages, with checksums.
 *
 * Each target lands in `packages/engine-<platform>/bin/drift-engine` alongside an
 * `engine-manifest.json` recording the target triple, SHA-256, byte size, and - the field that
 * matters - whether the binary was actually *executed* on this machine.
 *
 * That distinction is the point. A cross-compiled binary that links is not a binary known to
 * work: it has never run. Recording "built" and "verified" as the same thing is how a release
 * ships an artifact nobody has executed, so they are separate fields and only the host platform
 * can set `verified`.
 *
 *   node scripts/build-engine-artifacts.mjs            # every target that can build here
 *   node scripts/build-engine-artifacts.mjs --list     # what is buildable, without building
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const TARGETS = [
  { triple: "aarch64-apple-darwin", pkg: "engine-darwin-arm64", os: "darwin", cpu: "arm64" },
  { triple: "x86_64-apple-darwin", pkg: "engine-darwin-x64", os: "darwin", cpu: "x64" },
  { triple: "x86_64-unknown-linux-gnu", pkg: "engine-linux-x64-gnu", os: "linux", cpu: "x64" },
  { triple: "aarch64-unknown-linux-gnu", pkg: "engine-linux-arm64-gnu", os: "linux", cpu: "arm64" },
  { triple: "x86_64-pc-windows-msvc", pkg: "engine-win32-x64", os: "win32", cpu: "x64" }
];

/** The triple this machine runs natively, and therefore the only one it can verify. */
function hostTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  return "unknown";
}

const HOST = hostTriple();
const version = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;

function build(target) {
  try {
    execFileSync("rustup", ["target", "add", target.triple], { stdio: "ignore" });
  } catch {
    /* already installed, or rustup unavailable */
  }
  try {
    execFileSync(
      "cargo",
      ["build", "--release", "-p", "drift-engine", "--target", target.triple],
      { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "pipe"] }
    );
    return { ok: true };
  } catch (error) {
    const stderr = error.stderr?.toString() ?? "";
    // tree-sitter ships C build scripts, so a cross build needs a C toolchain for the target.
    const reason = stderr.includes("custom build command")
      ? "needs a cross C toolchain for tree-sitter (build in CI on the target platform)"
      : (stderr.split("\n").find((line) => line.startsWith("error")) ?? "build failed");
    return { ok: false, reason };
  }
}

/**
 * Run the binary against a real fixture. Only meaningful for the host triple.
 *
 * Deliberately a scan rather than a `--version` probe: the engine has no version flag, and more
 * importantly a binary that prints its version has proven only that it starts. Scanning a fixture
 * and parsing the result proves it parses, extracts facts, and emits valid output - which is what
 * "this artifact works" has to mean.
 */
function verify(binaryPath) {
  const fixture = join(REPO_ROOT, "test/fixtures/next-api-direct-db");
  try {
    const out = execFileSync(binaryPath, ["scan-repo", fixture, "--format", "json", "--repo-id", "verify"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024
    });
    const parsed = JSON.parse(out);
    const facts = parsed.facts?.length ?? 0;
    if (facts === 0) {
      return { verified: false, output: "scanned the fixture but produced no facts" };
    }
    return { verified: true, output: `scanned fixture: ${facts} facts, ${parsed.file_snapshots?.length ?? 0} files` };
  } catch (error) {
    return { verified: false, output: (error.stderr?.toString() ?? error.message).slice(0, 120) };
  }
}

const listOnly = process.argv.includes("--list");
const results = [];

for (const target of TARGETS) {
  const isHost = target.triple === HOST;
  if (listOnly) {
    results.push({ ...target, host: isHost, status: "not attempted" });
    continue;
  }

  const outcome = build(target);
  if (!outcome.ok) {
    results.push({ ...target, host: isHost, status: "unbuildable", reason: outcome.reason });
    continue;
  }

  const built = join(REPO_ROOT, "target", target.triple, "release", "drift-engine");
  if (!existsSync(built)) {
    results.push({ ...target, host: isHost, status: "missing after build" });
    continue;
  }

  const binDir = join(REPO_ROOT, "packages", target.pkg, "bin");
  mkdirSync(binDir, { recursive: true });
  const dest = join(binDir, "drift-engine");
  copyFileSync(built, dest);

  const bytes = readFileSync(dest);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Only the host can honestly claim this ran.
  const runtime = isHost ? verify(dest) : { verified: false, output: "cross-compiled; not executed on this machine" };

  writeFileSync(
    join(REPO_ROOT, "packages", target.pkg, "engine-manifest.json"),
    `${JSON.stringify(
      {
        schema_version: "drift.engine_artifact.v1",
        engine_version: version,
        target: target.triple,
        os: target.os,
        cpu: target.cpu,
        bin: "./bin/drift-engine",
        sha256,
        byte_size: bytes.length,
        built_on: HOST,
        // built !== verified. A cross-compiled binary has never run.
        verified: runtime.verified,
        verification_note: runtime.output
      },
      null,
      2
    )}\n`
  );

  results.push({ ...target, host: isHost, status: "built", sha256: sha256.slice(0, 12), verified: runtime.verified });
}

for (const r of results) {
  const mark = r.status !== "built" ? "  --" : r.verified ? "  ok" : " ~~~";
  console.log(
    `${mark} ${r.pkg.padEnd(24)} ${r.status.padEnd(16)}` +
      (r.sha256 ? ` sha=${r.sha256} ${r.verified ? "verified (executed here)" : "UNVERIFIED (cross-compiled)"}` : "") +
      (r.reason ? ` — ${r.reason}` : "")
  );
}

const built = results.filter((r) => r.status === "built");
const verified = built.filter((r) => r.verified);
console.log(
  `\n${built.length}/${TARGETS.length} targets built, ${verified.length} verified by execution on ${HOST}.`
);
if (built.length < TARGETS.length) {
  console.log("Remaining targets must be built in CI on their own platform - see docs/architecture/engine-release.md.");
}
