#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const packagePaths = [
  "packages/core/package.json",
  "packages/engine-contract/package.json",
  "packages/storage/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "packages/engine-darwin-arm64/package.json",
  "packages/engine-darwin-x64/package.json",
  "packages/engine-linux-x64-gnu/package.json",
  "packages/engine-linux-arm64-gnu/package.json",
  "packages/engine-win32-x64/package.json"
];

for (const packagePath of packagePaths) {
  const absolutePath = resolve(packagePath);
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  rewriteDependencyBlock(manifest.dependencies);
  rewriteDependencyBlock(manifest.optionalDependencies);
  rewriteDependencyBlock(manifest.peerDependencies);
  writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function rewriteDependencyBlock(dependencies) {
  if (!dependencies) {
    return;
  }
  for (const [name, dependencyVersion] of Object.entries(dependencies)) {
    if (name.startsWith("@drift/") && dependencyVersion.startsWith("workspace:")) {
      dependencies[name] = version;
    }
  }
}
