#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const target = required(args, "target");
const platform = required(args, "platform");
const arch = required(args, "arch");
const binaryName = args["binary-name"] ?? (platform === "win32" ? "drift-engine.exe" : "drift-engine");

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, "../..");

if (process.platform !== platform || process.arch !== arch) {
  throw new Error(`${process.env.npm_package_name ?? "Engine package"} can only be packed on ${platform}/${arch}.`);
}

execFileSync("cargo", ["build", "-p", "drift-engine"], {
  cwd: repoRoot,
  stdio: "inherit"
});

execFileSync(process.execPath, [
  resolve(repoRoot, "scripts/stage-engine-package.mjs"),
  "--package-dir", packageRoot,
  "--binary", resolve(repoRoot, "target/debug", binaryName),
  "--target", target,
  "--platform", platform,
  "--arch", arch,
  "--binary-name", binaryName
], {
  cwd: repoRoot,
  stdio: "inherit"
});

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
