// Drift's version is written down in several files. This sets it in all of them
// at once, or checks that they agree:
//
//   node npm/set-version.mjs <version>             set it everywhere
//   node npm/set-version.mjs --check [<version>]   every place agrees (and equals <version>, if given)
//   node npm/set-version.mjs --print               print the workspace version
//
// The places (one list, used by both modes, so a place cannot be set and not
// checked): the [workspace.package] version and every path dependency's version in
// Cargo.toml; `version.workspace = true` in each member crate; each workspace
// member's entry in Cargo.lock; the Claude Code plugin's plugin.json; and the
// marketplace entry, if it states a version. The npm packages carry no version in
// the repository: npm/build.mjs stamps the release tag's version into them.
//
// Cargo.lock is edited as text (only the members' `version =` lines), so this needs
// no cargo and gives the same file `cargo update --workspace` would.
// release.yml's verify job, npm/dry-run.sh and npm/ci-check.mjs call --check.
// `--root <dir>` works on another checkout (the tests use a copy).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let root = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = args.indexOf("--root");
if (r !== -1) {
  root = args[r + 1];
  args.splice(r, 2);
}
// Semver 2.0 (npm and Cargo both require it), optional prerelease and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const USAGE = "usage: node npm/set-version.mjs <version> | --check [<version>] | --print   (semver, without a leading v)";

const read = (rel) => readFileSync(join(root, rel), "utf8");
const errors = [];

// The `version` key of the [workspace.package] table (no other table header between).
const WORKSPACE_VERSION = /(^\[workspace\.package\][ \t]*\r?\n(?:(?!\[)[^\n]*\n)*?version[ \t]*=[ \t]*")([^"]*)(")/m;

/** Every place the version is written, each with its current value and a setter. */
function places() {
  const out = [];
  const cargo = read("Cargo.toml");
  const ws = WORKSPACE_VERSION.exec(cargo);
  if (!ws) errors.push("Cargo.toml: no [workspace.package] version");
  out.push({ file: "Cargo.toml", what: "[workspace.package] version", value: ws?.[2], set: (t, v) => t.replace(WORKSPACE_VERSION, `$1${v}$3`) });
  // Path dependencies in [workspace.dependencies]: the internal crates.
  for (const m of cargo.matchAll(/^([\w-]+) = \{[^}\n]*path = "[^"]*"[^}\n]*\}/gm)) {
    const name = m[1];
    const re = new RegExp(`(^${name} = \\{[^}\\n]*path = "[^"]*"[^}\\n]*version = ")([^"]*)(")`, "m");
    const v = re.exec(cargo)?.[2];
    if (v === undefined) errors.push(`Cargo.toml: workspace dependency ${name} has a path and no version`);
    out.push({ file: "Cargo.toml", what: `workspace dependency ${name}`, value: v, set: (t, nv) => t.replace(re, `$1${nv}$3`) });
  }
  // Members: each takes the workspace version, and each is in Cargo.lock.
  const members = /^members = \[([^\]]*)\]/m.exec(cargo)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  if (!members.length) errors.push("Cargo.toml: no workspace members");
  const lock = read("Cargo.lock");
  for (const dir of members) {
    const manifest = read(join(dir, "Cargo.toml"));
    const name = /^name = "([^"]+)"/m.exec(manifest)?.[1];
    if (!/^version\.workspace = true$/m.test(manifest)) {
      errors.push(`${dir}/Cargo.toml: does not say version.workspace = true (its version must be the workspace's)`);
    }
    const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")([^"]*)(")`);
    const v = re.exec(lock)?.[2];
    if (v === undefined) errors.push(`Cargo.lock: no entry for workspace member ${name}`);
    out.push({ file: "Cargo.lock", what: name, value: v, set: (t, nv) => t.replace(re, `$1${nv}$3`) });
  }
  const pluginRel = "integrations/claude-code/.claude-plugin/plugin.json";
  const VERSION_KEY = /("version":\s*")([^"]*)(")/;
  out.push({ file: pluginRel, what: "version", value: JSON.parse(read(pluginRel)).version, set: (t, v) => t.replace(VERSION_KEY, `$1${v}$3`) });
  // The marketplace states no version today; if it ever does, it must agree.
  const marketRel = ".claude-plugin/marketplace.json";
  const market = JSON.parse(read(marketRel));
  for (const p of market.plugins ?? []) {
    if (p.version !== undefined) out.push({ file: marketRel, what: `plugin ${p.name}`, value: p.version, set: null });
  }
  if (market.metadata?.version !== undefined) out.push({ file: marketRel, what: "metadata.version", value: market.metadata.version, set: null });
  return out;
}

function report() {
  for (const e of errors) console.error(`set-version: ${e}`);
  process.exit(1);
}

const mode = args[0];
if (mode === "--print" || mode === "--check") {
  const want = mode === "--check" ? args[1] : undefined;
  if (want !== undefined && !SEMVER.test(want)) {
    console.error(`set-version: ${JSON.stringify(want)} is not a version (semver, without a leading v)`);
    process.exit(2);
  }
  const all = places();
  if (errors.length) report();
  const base = all[0].value;
  if (mode === "--print") {
    console.log(base);
    process.exit(0);
  }
  const expected = want ?? base;
  for (const p of all) {
    if (p.value !== expected) {
      errors.push(`${p.file}: ${p.what} is ${p.value}, want ${expected} (node npm/set-version.mjs ${expected})`);
    }
  }
  if (errors.length) report();
  console.log(`version ${expected}: ${all.length} places agree (${[...new Set(all.map((p) => p.file))].join(", ")})`);
  process.exit(0);
}

const version = mode;
if (!version || args.length !== 1 || !SEMVER.test(version)) {
  console.error(USAGE);
  process.exit(2);
}
const all = places();
if (errors.length) report();
const fixed = all.filter((p) => !p.set);
if (fixed.length) {
  console.error(`set-version: ${fixed.map((p) => `${p.file} ${p.what}`).join(", ")}: change by hand, or remove the version there`);
  process.exit(1);
}
const texts = new Map();
for (const p of all) {
  const text = texts.get(p.file) ?? read(p.file);
  texts.set(p.file, p.set(text, version));
}
for (const [file, text] of texts) writeFileSync(join(root, file), text);
// Read back: every place now says the new version.
const wrong = places().filter((p) => p.value !== version);
if (errors.length || wrong.length) {
  for (const p of wrong) errors.push(`${p.file}: ${p.what} is still ${p.value}`);
  report();
}
console.log(`version ${version}: ${all.length} places in ${[...texts.keys()].join(", ")}`);
