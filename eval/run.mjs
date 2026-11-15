// Run the pinned evaluation: clone each repo at its commit, scan, compare with
// the TypeScript compiler, mine conventions, and check thresholds.
//
//   node eval/run.mjs --drift target/release/drift [--cache DIR] [--only a,b] [--out results.json]
//
// Exit code 1 when any repo breaks a threshold in eval/repos.json.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const drift = resolve(arg("--drift", join(here, "..", "target", "release", "drift")));
const cache = resolve(arg("--cache", join(homedir(), ".cache", "drift-eval")));
const only = arg("--only", "") ? new Set(arg("--only", "").split(",")) : null;
const outPath = arg("--out", null);
const manifest = JSON.parse(readFileSync(join(here, "repos.json"), "utf8"));

function checkout(repo) {
  const dir = join(cache, "repos", repo.name);
  if (existsSync(join(dir, ".git"))) {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
    if (head === repo.sha) return dir;
  }
  mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "inherit"] });
  if (!existsSync(join(dir, ".git"))) git("init", "-q");
  git("fetch", "-q", "--depth", "1", repo.url, repo.sha);
  git("checkout", "-q", "--force", "FETCH_HEAD");
  return dir;
}

function run(cmd, a, opts = {}) {
  const started = process.hrtime.bigint();
  const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 30, ...opts });
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed (${r.status}): ${r.stderr?.slice(0, 500)}`);
  return { ...r, ms };
}

const results = [];
let failed = false;
for (const repo of manifest.repos) {
  if (only && !only.has(repo.name)) continue;
  const limits = { ...manifest.defaults, ...repo };
  const work = join(cache, "out", repo.name);
  mkdirSync(work, { recursive: true });
  let row = { name: repo.name, shape: repo.shape };
  try {
    const dir = checkout(repo);
    const scan = run(drift, ["--root", dir, "--no-cache", "scan", "--out", join(work, "facts.json")]);
    const num = (label) => Number(scan.stderr.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? NaN);
    row = {
      ...row,
      files: Number(scan.stderr.match(/scan: (\d+) files/)?.[1] ?? NaN),
      scan_ms: scan.ms,
      parse_errors: num("parse errors"),
      skipped: num("skipped"),
      entry_points: num("entry points"),
    };
    writeFileSync(join(work, "imports.jsonl"), run(drift, ["--root", dir, "debug", "imports"]).stdout);
    run(process.execPath, [
      "--max-old-space-size=6000",
      join(here, "oracle", "oracle.mjs"),
      dir,
      join(work, "imports.jsonl"),
      join(work, "facts.json"),
      "--samples",
      "400",
      "--json",
      join(work, "oracle.json"),
    ]);
    const o = JSON.parse(readFileSync(join(work, "oracle.json"), "utf8"));
    const c = o.imports.categories;
    const gaps = Object.entries(c).filter(([k]) => k.startsWith("GAP_")).reduce((n, [, v]) => n + v, 0);
    row = {
      ...row,
      imports: o.imports.total,
      agree: (c.agree ?? 0) + (c.agree_source_vs_dts ?? 0) + (c.agree_package_with_repo_types ?? 0),
      disagree: c.DISAGREE ?? 0,
      gaps,
      drift_only: c.drift_only_resolves ?? 0,
      export_recall: o.exports.ts_names ? o.exports.matched / o.exports.ts_names : 1,
      exports_missing: o.exports.missing,
    };
    const census = run(drift, ["--root", dir, "--no-cache", "census"]);
    row.conventions = Number(census.stdout.match(/^(\d+) conventions/m)?.[1] ?? NaN);
    const problems = [];
    if (row.parse_errors > (limits.max_parse_errors ?? 0)) problems.push(`parse errors ${row.parse_errors}`);
    if (row.disagree > limits.max_disagreements) problems.push(`disagreements ${row.disagree}`);
    if (row.gaps > limits.max_gaps) problems.push(`gaps ${row.gaps}`);
    if (row.export_recall < limits.min_export_recall) problems.push(`export recall ${row.export_recall.toFixed(3)}`);
    row.status = problems.length ? `FAIL: ${problems.join(", ")}` : "ok";
    if (problems.length) failed = true;
  } catch (e) {
    row.status = `ERROR: ${e.message.split("\n")[0]}`;
    failed = true;
  }
  results.push(row);
  console.error(`${row.name}: ${row.status}`);
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "–");
console.log("| Repo | Files | Scan | Imports agreeing | Disagree | Gaps | Export recall | Entry points | Conventions | Status |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  console.log(
    `| ${r.name} | ${fmt(r.files)} | ${r.scan_ms ? (r.scan_ms / 1000).toFixed(2) + " s" : "–"} | ${fmt(r.agree)} | ${fmt(r.disagree)} | ${fmt(r.gaps)} | ${Number.isFinite(r.export_recall) ? (r.export_recall * 100).toFixed(1) + "%" : "–"} | ${fmt(r.entry_points)} | ${fmt(r.conventions)} | ${r.status} |`,
  );
}
if (outPath) writeFileSync(outPath, JSON.stringify({ drift, results }, null, 2));
process.exit(failed ? 1 : 0);
