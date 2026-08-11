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

// BB-2 (found while closing the sprint): this hook runs on `pnpm pack` and `npm publish`, so what it
// stages is what every user installs. It built and staged a **debug** engine - no `--release` - which
// would have shipped an engine ~2.7x slower than the one every measurement in this repo was taken
// against. The bench-side confound BB-2 exists to prevent, in the shipped product.
//
// `scripts/build-engine-artifacts.mjs` already built these correctly; the publish path used this
// script instead, and the two disagreed silently. Kept in step with it deliberately: same
// `--release --target <triple>` invocation, same output directory.
execFileSync("cargo", ["build", "--release", "-p", "drift-engine", "--target", target], {
  cwd: repoRoot,
  stdio: "inherit"
});

execFileSync(process.execPath, [
  resolve(repoRoot, "scripts/stage-engine-package.mjs"),
  "--package-dir", packageRoot,
  "--binary", resolve(repoRoot, "target", target, "release", binaryName),
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
