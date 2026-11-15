// Set the release version everywhere it is written down, in one step:
//
//   node npm/set-version.mjs <version>
//
// Updates the workspace version and the internal crates' versions in Cargo.toml,
// the Claude Code plugin version, and Cargo.lock (`cargo update --workspace
// --offline`). release.yml's verify job and npm/ci-check.mjs fail when these
// disagree; the npm packages take their version from the tag.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
// Semver 2.0 (npm and Cargo both require it), optional prerelease and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
if (!version || !SEMVER.test(version)) {
  console.error("usage: node npm/set-version.mjs <version>   (semver, without a leading v)");
  process.exit(2);
}

const INTERNAL = ["drift-core", "drift-ts", "drift-py", "drift-mine"];
const cargoPath = join(repo, "Cargo.toml");
let cargo = readFileSync(cargoPath, "utf8");
const WORKSPACE = /(\[workspace\.package\][^[]*?\nversion = ")[^"]*(")/;
if (!WORKSPACE.test(cargo)) {
  console.error("Cargo.toml: no [workspace.package] version found");
  process.exit(1);
}
cargo = cargo.replace(WORKSPACE, `$1${version}$2`);
for (const c of INTERNAL) {
  const re = new RegExp(`(\\n${c} = \\{[^}\\n]*version = ")[^"]*(")`);
  if (!re.test(cargo)) {
    console.error(`Cargo.toml: no workspace dependency line for ${c}`);
    process.exit(1);
  }
  cargo = cargo.replace(re, `$1${version}$2`);
}
writeFileSync(cargoPath, cargo);

const pluginPath = join(repo, "integrations/claude-code/.claude-plugin/plugin.json");
const plugin = readFileSync(pluginPath, "utf8");
const next = plugin.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
if (JSON.parse(next).version !== version) {
  console.error("plugin.json: version not updated");
  process.exit(1);
}
writeFileSync(pluginPath, next);

execFileSync("cargo", ["update", "--workspace", "--offline", "--manifest-path", cargoPath], { stdio: "inherit" });
console.log(`version ${version}: Cargo.toml, Cargo.lock, plugin.json`);
