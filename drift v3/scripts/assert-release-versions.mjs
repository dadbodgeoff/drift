#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expectedVersion = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const packagePaths = [
  "package.json",
  "packages/core/package.json",
  "packages/storage/package.json",
  "packages/engine-contract/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "packages/engine-darwin-arm64/package.json",
  "packages/engine-darwin-x64/package.json",
  "packages/engine-linux-x64-gnu/package.json",
  "packages/engine-linux-arm64-gnu/package.json",
  "packages/engine-win32-x64/package.json"
];

const failures = [];
for (const path of packagePaths) {
  const manifest = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (manifest.version !== expectedVersion) {
    failures.push(`${path} version ${manifest.version} does not match ${expectedVersion}`);
  }
}

const cargoMetadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
  encoding: "utf8"
}));
const enginePackage = cargoMetadata.packages.find((pkg) => pkg.name === "drift-engine");
if (!enginePackage) {
  failures.push("cargo metadata did not include drift-engine");
} else if (enginePackage.version !== expectedVersion) {
  failures.push(`drift-engine Cargo version ${enginePackage.version} does not match ${expectedVersion}`);
}

const cliManifest = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));
for (const [name, version] of Object.entries(cliManifest.optionalDependencies ?? {})) {
  if (!name.startsWith("@drift/engine-")) {
    continue;
  }
  if (version !== "workspace:*" && version !== expectedVersion) {
    failures.push(`packages/cli optional dependency ${name}@${version} is not exact ${expectedVersion}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
