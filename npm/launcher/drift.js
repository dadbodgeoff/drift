#!/usr/bin/env node
// Launcher for the native `drift` binary. The binary ships in a per-platform
// package installed through optionalDependencies, so installing Drift never
// runs a script. This file only finds that binary and runs it.
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const pkg = require("../package.json");
const suffix = `${process.platform}-${process.arch}`;
const platformPkg = `${pkg.name}-${suffix}`;
const exe = process.platform === "win32" ? "drift.exe" : "drift";

let bin;
try {
  bin = path.join(path.dirname(require.resolve(`${platformPkg}/package.json`)), "bin", exe);
} catch {
  console.error(
    `drift: no prebuilt binary for ${suffix} (expected the optional package ${platformPkg}).\n` +
      "Reinstall without --no-optional / --omit=optional, or build from source: " +
      "cargo install --locked --git https://github.com/dadbodgeoff/drift drift-cli"
  );
  process.exit(2);
}

const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (r.error) {
  console.error(`drift: failed to run ${bin}: ${r.error.message}`);
  process.exit(2);
}
process.exit(r.status === null ? 1 : r.status);
