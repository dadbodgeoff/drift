// node --test npm/set-version.test.mjs
//
// Pins npm/set-version.mjs, on a copy of this checkout's version files:
// - --check passes on the checkout as committed (the places agree today);
// - setting a version changes exactly the version lines (5 in Cargo.toml, 5 in
//   Cargo.lock, 1 in plugin.json), --check then passes for it, and setting the old
//   version back gives byte-identical files;
// - --check fails, naming the file, when any one place disagrees: the plugin, a
//   Cargo.lock member, a workspace dependency, a member crate with its own version,
//   or a version written into the marketplace;
// - --check <version> fails when the files agree on another version (a tag that
//   does not match), and a leading `v` or a non-semver version is refused.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repo, "npm/set-version.mjs");
const current = execFileSync("node", [script, "--print"], { encoding: "utf8" }).trim();

function copy() {
  const root = mkdtempSync(join(tmpdir(), "drift-set-version-"));
  const files = ["Cargo.toml", "Cargo.lock", "integrations/claude-code/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json"];
  const members = /^members = \[([^\]]*)\]/m.exec(readFileSync(join(repo, "Cargo.toml"), "utf8"))[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  for (const m of members) files.push(`${m}/Cargo.toml`);
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(repo, f), join(root, f));
  }
  return { root, files, done: () => rmSync(root, { recursive: true, force: true }) };
}
const run = (root, ...args) => spawnSync("node", [script, "--root", root, ...args], { encoding: "utf8" });
const edit = (root, rel, f) => writeFileSync(join(root, rel), f(readFileSync(join(root, rel), "utf8")));
const changedLines = (a, b) => a.split("\n").filter((l, i) => l !== b.split("\n")[i]).length;

test("the committed checkout agrees", () => {
  const r = spawnSync("node", [script, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("set changes only the version lines, and round-trips", () => {
  const c = copy();
  try {
    const before = Object.fromEntries(c.files.map((f) => [f, readFileSync(join(c.root, f), "utf8")]));
    const s = run(c.root, "7.8.9-beta.1");
    assert.equal(s.status, 0, s.stderr);
    assert.equal(run(c.root, "--check", "7.8.9-beta.1").status, 0);
    assert.equal(run(c.root, "--check", current).status, 1);
    const after = (f) => readFileSync(join(c.root, f), "utf8");
    assert.equal(changedLines(before["Cargo.toml"], after("Cargo.toml")), 5);
    assert.equal(changedLines(before["Cargo.lock"], after("Cargo.lock")), 5);
    assert.equal(changedLines(before["integrations/claude-code/.claude-plugin/plugin.json"], after("integrations/claude-code/.claude-plugin/plugin.json")), 1);
    assert.equal(JSON.parse(after("integrations/claude-code/.claude-plugin/plugin.json")).version, "7.8.9-beta.1");
    assert.equal(run(c.root, current).status, 0);
    for (const f of c.files) assert.equal(after(f), before[f], `${f} after the round trip`);
  } finally {
    c.done();
  }
});

for (const [name, rel, f, says] of [
  ["the plugin", "integrations/claude-code/.claude-plugin/plugin.json", (t) => t.replace(/("version":\s*")[^"]*/, "$19.9.9"), "plugin.json: version is 9.9.9"],
  ["a Cargo.lock member", "Cargo.lock", (t) => t.replace(/(name = "drift-ts"\nversion = ")[^"]*/, "$19.9.9"), "Cargo.lock: drift-ts is 9.9.9"],
  ["a workspace dependency", "Cargo.toml", (t) => t.replace(/(\ndrift-py = \{[^}\n]*version = ")[^"]*/, "$19.9.9"), "workspace dependency drift-py is 9.9.9"],
  ["a member crate with its own version", "crates/drift-core/Cargo.toml", (t) => t.replace("version.workspace = true", 'version = "9.9.9"'), "crates/drift-core/Cargo.toml: does not say version.workspace = true"],
  ["a version in the marketplace", ".claude-plugin/marketplace.json", (t) => t.replace('"source"', '"version": "9.9.9", "source"'), "marketplace.json: plugin drift is 9.9.9"],
]) {
  test(`--check fails when ${name} disagrees`, () => {
    const c = copy();
    try {
      edit(c.root, rel, f);
      const r = run(c.root, "--check");
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(says.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      c.done();
    }
  });
}

test("a leading v or a non-semver version is refused", () => {
  assert.equal(spawnSync("node", [script, "--check", `v${current}`]).status, 2);
  assert.equal(spawnSync("node", [script, "--check", "1.2"]).status, 2);
  const c = copy();
  try {
    assert.equal(run(c.root, "v1.2.3").status, 2);
    assert.equal(run(c.root, "--check").status, 0, "a refused version wrote nothing");
  } finally {
    c.done();
  }
});
