#!/usr/bin/env node
import { createHash } from "node:crypto";
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
