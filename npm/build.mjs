// Build npm packages from release binaries.
//
//   node npm/build.mjs <version> <artifacts-dir> <out-dir>
//
// <artifacts-dir>/<rust-target>/<exe> must hold each built binary.
// Produces one package per platform plus the main package, which depends on
// them through optionalDependencies. No package has install scripts.
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [version, artifacts, out] = process.argv.slice(2);
if (!version || !artifacts || !out) {
  console.error("usage: node npm/build.mjs <version> <artifacts-dir> <out-dir>");
  process.exit(2);
}
const config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
const common = {
  version,
  license: "Apache-2.0",
  repository: { type: "git", url: `git+${config.repository}.git` },
  homepage: config.repository,
};

const optional = {};
for (const [target, t] of Object.entries(config.targets)) {
  const src = join(artifacts, target, t.exe);
  if (!existsSync(src)) {
    console.error(`missing binary for ${target}: ${src}`);
    process.exit(1);
  }
  const name = `${config.name}-${t.suffix}`;
  const dir = join(out, t.suffix);
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(src, join(dir, "bin", t.exe));
  chmodSync(join(dir, "bin", t.exe), 0o755);
  copyFileSync(join(here, "..", "LICENSE"), join(dir, "LICENSE"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name, ...common, description: `Drift binary for ${t.suffix}`, os: [t.os], cpu: [t.cpu], files: ["bin/"], preferUnplugged: true },
      null,
      2,
    ) + "\n",
  );
  optional[name] = version;
}

const main = join(out, "main");
mkdirSync(join(main, "bin"), { recursive: true });
copyFileSync(join(here, "launcher", "drift.js"), join(main, "bin", "drift.js"));
copyFileSync(join(here, "..", "README.md"), join(main, "README.md"));
copyFileSync(join(here, "..", "LICENSE"), join(main, "LICENSE"));
writeFileSync(
  join(main, "package.json"),
  JSON.stringify(
    {
      name: config.name,
      ...common,
      description: "The convention lockfile for AI agents: mined from your code, approved by you, checked in your agents and CI.",
      bin: { drift: "bin/drift.js" },
      files: ["bin/", "README.md"],
      optionalDependencies: optional,
      engines: { node: ">=18" },
      keywords: ["conventions", "lint", "ai-agents", "claude-code", "mcp", "typescript"],
    },
    null,
    2,
  ) + "\n",
);
console.log(`built ${Object.keys(optional).length + 1} packages in ${out}`);
