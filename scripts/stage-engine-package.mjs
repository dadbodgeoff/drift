#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const packageDir = required(args, "package-dir");
const binary = required(args, "binary");
const target = required(args, "target");
const platform = required(args, "platform");
const arch = required(args, "arch");
const binaryName = args["binary-name"] ?? (platform === "win32" ? "drift-engine.exe" : "drift-engine");

const packageRoot = resolve(packageDir);
const packageManifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const binaryTarget = resolve(packageRoot, "bin", binaryName);
mkdirSync(resolve(packageRoot, "bin"), { recursive: true });
copyFileSync(resolve(binary), binaryTarget);
if (platform !== "win32") {
  chmodSync(binaryTarget, 0o755);
}

// BB-2: refuse to stage an engine that reports itself as a debug build.
//
// This is the last gate before a binary becomes an npm package, and until this sprint the publish
// path (`prepare-engine-package.mjs`) staged `target/debug` - so every install would have received an
// engine ~2.7x slower than the one every measurement in this repo was taken against. Fixing the caller
// was necessary; asserting here is what stops the next caller from reintroducing it. Only asserted for
// a binary that can run on this host, since a cross-compiled artifact cannot be executed to be asked.
if (platform === process.platform && arch === process.arch) {
  const probe = spawnSync(binaryTarget, ["version"], { encoding: "utf8" });
  const reported = probe.status === 0 && probe.stdout
    ? (JSON.parse(probe.stdout).build_profile ?? null)
    : null;
  if (reported === "debug") {
    console.error(
      `Refusing to stage ${binaryTarget}: it reports build_profile "debug". Users would install an ` +
      "engine whose timings do not describe the product. Build with " +
      `\`cargo build --release -p drift-engine --target ${target}\` and stage from target/${target}/release.`
    );
    process.exit(1);
  }
  if (reported === null) {
    console.error(
      `Refusing to stage ${binaryTarget}: it did not report a build profile, so it cannot be verified ` +
      "as a release build. An unverified engine is not a release engine."
    );
    process.exit(1);
  }
}

const bytes = readFileSync(binaryTarget);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema_version: "drift.engine.package.v1",
  package_name: packageManifest.name,
  package_version: packageManifest.version,
  target_triple: target,
  platform,
  arch,
  binary_path: `bin/${basename(binaryTarget)}`,
  engine_version: packageManifest.version,
  sha256
};

writeFileSync(resolve(packageRoot, "engine-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}
