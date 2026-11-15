// Large fixtures for performance work, generated at test time and never
// committed (fixtures/local/ is git-ignored): third-party code stays out of
// the repository. Skipped for any repo that is not present.
//
//   node scripts/make-local-fixtures.mjs --drift <drift> --repos <dir with checkouts> --work <scratch> [--policy] [--sources <dir>] [names...]
//
// Default names: twenty (≈36k files) and dub. Each gets slim facts, census and
// security; no policy (the repos are read-only, so `drift init` never runs).
//
// --policy: the repos are scratch copies made for this run (never a checkout you
// keep: Drift writes .drift/ into them). Each also gets a policy and a check, as a
// team would have them: `drift init`, every proposal accepted, those in the default
// tier blocked (`drift review --block` refuses the rest without --force), then
// `.drift/conventions.yaml`, `drift.lock` and `drift check --format json`. With
// them every view reads real output: Conventions, Check and Attention included.
//
// Sources are never copied. `local/index.json` records each repo's checkout (`sourceRoot`), and the
// fixture servers (tests/e2e/serve.mjs, the fixture dev server) read a file from it when the code drawer
// asks, under the desktop app's rules (scripts/local-sources.mjs): only files the facts list, inside the
// checkout. --sources <dir> names the checkouts to read (default: --repos); with --policy, pass the
// originals, since the scratch copies are deleted after the run. A checkout that is gone reads
// "Source not available", as before.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { slimFacts } from "../src/shared/contract/slim.ts";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const flags = new Set(["--drift", "--repos", "--work", "--sources"]);
const switches = new Set(["--policy"]);
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const drift = arg("--drift");
const reposDir = arg("--repos");
const sourcesDir = arg("--sources") ?? reposDir;
const work = resolve(arg("--work") ?? join(app, ".local-work"));
const policy = process.argv.includes("--policy");
const names = process.argv.slice(2).filter((a, i, all) => !flags.has(a) && !switches.has(a) && !flags.has(all[i - 1]));
const want = names.length ? names : ["twenty", "dub"];
const out = join(app, "fixtures/local");
if (!drift || !reposDir || !existsSync(drift)) {
  console.log("make-local-fixtures: --drift and --repos are required; skipping");
  process.exit(0);
}
mkdirSync(out, { recursive: true });
const repos = [];
for (const name of want) {
  const root = join(reposDir, name);
  if (!existsSync(root)) {
    console.log(`skip ${name}: not present`);
    continue;
  }
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${name}`) };
  const run = (args, allow = []) => {
    const r = spawnSync(drift, ["--root", root, ...args], { env, encoding: "utf8", maxBuffer: 2 ** 31 });
    if (r.status !== 0 && !allow.includes(r.status)) throw new Error(`${name}: drift ${args[0]} exited ${r.status}: ${r.stderr}`);
    return r.stdout;
  };
  const t0 = Date.now();
  mkdirSync(work, { recursive: true });
  const factsPath = join(work, `${name}-facts.json`);
  run(["scan", "--out", factsPath]);
  const facts = slimFacts(JSON.parse(readFileSync(factsPath, "utf8")));
  writeFileSync(join(dir, "facts.json.gz"), gzipSync(JSON.stringify(facts)));
  if (policy) {
    run(["init"]);
    const proposed = JSON.parse(run(["census", "--json"])).proposals;
    const block = proposed.filter((p) => p.tier === "default").map((p) => p.id);
    const accept = proposed.filter((p) => p.tier !== "default").map((p) => p.id);
    if (block.length || accept.length) run(["review", ...(accept.length ? ["--accept", accept.join(",")] : []), ...(block.length ? ["--block", block.join(",")] : [])]);
    copyFileSync(join(root, ".drift/conventions.yaml"), join(dir, "conventions.yaml"));
    copyFileSync(join(root, "drift.lock"), join(dir, "drift.lock"));
    const check = JSON.parse(run(["check", "--format", "json"], [1]));
    writeFileSync(join(dir, "check.json"), JSON.stringify(check));
  }
  const census = JSON.parse(run(["census", "--json"]));
  census.root = `/local/${name}`;
  writeFileSync(join(dir, "census.json"), JSON.stringify(census));
  writeFileSync(join(dir, "security.json"), run(["security", "--json"]));
  // No earlier scan to compare with (the fixture adapter reads history.json for "since the last scan").
  writeFileSync(join(dir, "history.json"), JSON.stringify({ snapshots: [], audit: [] }));
  const sourceRoot = sourcesDir ? resolve(sourcesDir, name) : null;
  repos.push({ id: name, path: `/local/${name}`, name: `${name} (local)`, ...(policy ? { policy: true } : {}), ...(sourceRoot && existsSync(sourceRoot) ? { sourceRoot } : {}) });
  console.log(`${name}: ${facts.files.length} files in ${Date.now() - t0} ms`);
}
writeFileSync(join(out, "index.json"), JSON.stringify({ repos }, null, 1) + "\n");
