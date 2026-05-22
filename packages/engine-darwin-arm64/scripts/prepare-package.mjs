#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("@drift/engine-darwin-arm64 can only be packed on darwin/arm64.");
}

execFileSync("cargo", ["build", "-p", "drift-engine"], {
  cwd: repoRoot,
  stdio: "inherit"
});

execFileSync(process.execPath, [
  resolve(repoRoot, "scripts/stage-engine-package.mjs"),
  "--package-dir", packageRoot,
  "--binary", resolve(repoRoot, "target/debug/drift-engine"),
  "--target", "aarch64-apple-darwin",
  "--platform", "darwin",
  "--arch", "arm64",
  "--binary-name", "drift-engine"
], {
  cwd: repoRoot,
  stdio: "inherit"
});
