// Run a drift binary's `practices --json` over a manifest, one repo at a time, and write the M-cov tables
// (PLAN-R13 §5, PREREG-R13-practices.md). Measures only: nothing is labelled here (practices.mjs sample / score).
//
//   node eval/study/practices-run.mjs --manifest eval/repos.json --drift BIN --out RUNDIR --clones DIR [--fetch] [--keep-clones] [--only a,b]
//
// --manifest  a manifest with repos [{ name, url, sha }] (eval/repos*.json, eval/dev3*/dev4* manifests, eval/apps11-build.json).
//             A held-out or blind manifest (holdout*, apps-blind*, apps11-blind*, apps13-blind*) is refused unless
//             --blind-operator is given: only that set's operator runs it, from the private key map.
// --clones    where the checkouts are: DIR/<name> at the pin. An existing checkout is used read-only and never deleted; one
//             at another commit is a failed repo, never moved. With --fetch, a missing one is fetched at the pin (depth 1)
//             and deleted after its run unless --keep-clones.
// --drift     the binary; it must have the `practices` subcommand. Its sha256 and every repo's `commit` are recorded.
//
// Per repo: `drift practices --json` (plus `--all-variants`, and `--units` for the full member lists the M-acc sample
// frame needs, when the binary has them; PREREG-R13-practices.md P3) in the checkout, with a private
// DRIFT_CACHE_DIR deleted afterwards. Writes RUNDIR/repos/<name>.json ({ name, url, sha, secs, practices } or
// { name, sha, failed }), RUNDIR/run.json, and the M-cov tables RUNDIR/mcov.json and RUNDIR/mcov.md (practices.mjs mcov
// recomputes them from the per-repo files). Polar and CTFd are never run. Before each repo it waits while less than
// 4 GB of memory is available (the brief).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { die, parseArgs, readJson, sha256File } from "./lib.mjs";
import { repoCov, writeMcov } from "./practices.mjs";

export const BLIND_MANIFEST = /(^|\/)[^/]*(holdout|apps-blind|apps11-blind|apps13-blind)[^/]*$/i;
export const NEVER = ["polar", "ctfd"];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
function availableGb() {
  try {
    const m = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
    return m ? Number(m[1]) / 1048576 : Infinity;
  } catch {
    return Infinity;
  }
}
const repoSlugOf = (r) => String(r.repo ?? r.url ?? "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").toLowerCase();
export const neverRun = (r) => NEVER.includes(String(r.name ?? "").toLowerCase()) || NEVER.includes(repoSlugOf(r).split("/")[1] ?? "");

// The binary's practices flags: refuses a binary without the subcommand.
export function practicesFlags(drift) {
  const h = spawnSync(drift, ["practices", "--help"], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (h.status !== 0 || !/--json/.test(h.stdout ?? "")) return null;
  return ["--json", ...["--all-variants", "--units"].filter((f) => new RegExp(`${f}\\b`).test(h.stdout))];
}

function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ["fetch", "keepClones", "blindOperator"] });
  for (const k of ["manifest", "drift", "out", "clones"]) if (!args[k]) die(`--${k} is required`);
  if (BLIND_MANIFEST.test(String(args.manifest)) && !args.blindOperator) die("a held-out or blind manifest: only its operator runs it (--blind-operator)");
  const m = readJson(resolve(args.manifest));
  const drift = resolve(args.drift);
  const out = resolve(args.out);
  const clones = resolve(args.clones);
  const only = args.only ? new Set(String(args.only).split(",")) : null;
  const flags = practicesFlags(drift);
  if (!flags) die(`${drift} has no \`practices --json\` subcommand (PLAN-R13 §4): use a binary with the practices engine`);
  const runMeta = { manifest: args.manifest, manifest_set_id: m.set_id ?? basename(args.manifest, ".json"), drift: { path: drift, sha256: sha256File(drift), flags }, started_at: new Date().toISOString(), repos: [] };
  // A run directory holds one binary's results: a second call (--only, to redo some repos) must use the same binary.
  const prev = existsSync(join(out, "run.json")) ? readJson(join(out, "run.json")) : null;
  if (prev && prev.drift?.sha256 !== runMeta.drift.sha256) die(`${out} holds the results of another binary (sha256 ${String(prev.drift?.sha256).slice(0, 12)}): use a fresh RUNDIR`);
  if (prev && !only) die(`${out} already holds a run: use a fresh RUNDIR, or --only to redo some repos`);
  for (const r of m.repos ?? []) {
    if (only && !only.has(r.name)) continue;
    if (neverRun(r)) {
      console.error(`${r.name}: never run (the brief)`);
      continue;
    }
    while (availableGb() < 4) {
      console.error("waiting: under 4 GB of memory available");
      sleep(30000);
    }
    const dest = join(clones, r.name);
    const cache = join(out, "cache", r.name);
    const g = (...a) => spawnSync("git", ["-C", dest, ...a], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 1800000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let fetched = false;
    const fail = (why) => {
      writeJson(join(out, "repos", `${r.name}.json`), { name: r.name, url: r.url ?? null, sha: r.sha, failed: why });
      runMeta.repos.push({ name: r.name, url: r.url ?? null, sha: r.sha, checkout: fetched && !args.keepClones ? null : dest, status: "failed" });
      console.error(`${r.name}: FAILED (${why})`);
      if (fetched && !args.keepClones) rmSync(dest, { recursive: true, force: true });
    };
    if (!existsSync(join(dest, ".git"))) {
      if (!args.fetch) {
        fail("no checkout (pass --fetch to fetch it at the pin)");
        continue;
      }
      if (existsSync(dest)) {
        fail(`${dest} exists and is not a git checkout`);
        continue;
      }
      mkdirSync(dest, { recursive: true });
      fetched = true;
      if (g("init", "-q").status !== 0 || g("fetch", "-q", "--depth", "1", r.url, r.sha).status !== 0 || g("checkout", "-q", "FETCH_HEAD").status !== 0) {
        fail("checkout at the pin failed");
        continue;
      }
    }
    const head = g("rev-parse", "HEAD").stdout.trim();
    if (head !== r.sha) {
      fail(`the checkout is at ${head.slice(0, 12) || "?"}, not at its pin`);
      continue;
    }
    const t0 = Date.now();
    const p = spawnSync(drift, ["practices", ...flags], { cwd: dest, encoding: "utf8", maxBuffer: 1 << 30, timeout: 3600000, env: { ...process.env, DRIFT_CACHE_DIR: cache } });
    const secs = Math.round((Date.now() - t0) / 100) / 10;
    rmSync(cache, { recursive: true, force: true });
    if (p.status !== 0) {
      fail(`practices exited ${p.status ?? p.signal}: ${(p.stderr ?? "").trim().split("\n").pop()?.slice(0, 200) ?? ""}`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(p.stdout);
    } catch {
      fail("practices printed no JSON");
      continue;
    }
    const cov = repoCov(json);
    writeJson(join(out, "repos", `${r.name}.json`), { name: r.name, url: r.url ?? null, sha: r.sha, secs, commit: json.commit ?? null, problems: cov.problems, practices: json });
    runMeta.repos.push({ name: r.name, url: r.url ?? null, sha: r.sha, checkout: fetched && !args.keepClones ? null : dest, status: "ok", commit: json.commit ?? null });
    if (fetched && !args.keepClones) rmSync(dest, { recursive: true, force: true });
    const at = cov.concerns.filter((c) => c.total > 0);
    console.error(`${r.name}: ${secs}s; ${at.length} concerns with units, coverage ${cov.summary.coverage === null ? "–" : `${(cov.summary.coverage * 100).toFixed(1)}%`}${cov.problems.length ? `; ${cov.problems.length} JSON problems` : ""}`);
  }
  rmSync(join(out, "cache"), { recursive: true, force: true });
  if (prev) runMeta.repos = [...(prev.repos ?? []).filter((x) => !runMeta.repos.some((y) => y.name === x.name)), ...runMeta.repos].sort((a, b) => a.name.localeCompare(b.name));
  runMeta.finished_at = new Date().toISOString();
  runMeta.commits = [...new Set(runMeta.repos.map((r) => r.commit).filter(Boolean))];
  writeJson(join(out, "run.json"), runMeta);
  const pool = writeMcov(out);
  console.log(`M-cov: ${pool.concerns_at_target} of ${pool.concerns_with_units} concerns at target; ${pool.failed.length} failed repos; tables in ${join(out, "mcov.md")}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
