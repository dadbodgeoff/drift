// Rule 1's technical check of a held-out set, before any census: does each repo clone at its pinned sha,
// does `drift scan` run, and does it have at least 200 parseable files?
//
//   node eval/study/techcheck.mjs --manifest eval/holdout-primary.json --drift BIN [--cache DIR] [--reserves N] [--json OUT]
//                                 [--prune] [--min-free-gb G]
//
// BIN is the frozen binary (prepare.mjs --only none builds it; run.json drift.build.binary). Checkouts go to
// the shared clone location <cache>/repos/<name>, which prepare.mjs copies a held-out commit from (no second
// download). Only `drift scan`'s summary is read: file and parse-error counts, never conventions, proposals
// or code, so a failing repo can be replaced (rule 1) before anyone has looked at its proposals.
//
// Checked: each slot's current occupant (the primaries, after the manifest's `replaced`), plus the next N
// unused reserves in order (default: as many as there are failures, so a failing reserve is caught too).
// For each failure it prints the `replaced` entry rule 1 asks for (the i-th swap uses the i-th reserve).
// Appending it is a manifest change: commit it, then prepare a NEW run directory (rule 2: one commit per run).
//
// Only rule 1's three reasons (and decision D3) produce a swap: the clone fails, `drift scan` errors, or fewer
// than 200 parseable files. A problem of this machine or of the harness (a checkout at the sha that is not
// clean, a scan that wrote into the checkout, git init or the checkout of a fetched sha failing) is not a
// failure of the repo: techcheck stops with exit 3, names the problem and its fix, and prints no swap.
//
// --prune deletes each checkout as soon as it has been checked (one repo on disk at a time; a census later fetches
// again at the pinned sha). It deletes only <cache>/repos/<name> for a plain name (letters, digits, '.', '_', '-'; not
// '.' or '..'); any other name is an environment error before anything is fetched. --min-free-gb G stops with an
// environment error before a fetch when the cache's filesystem has less than G GB free: a full disk would otherwise
// look like a clone failure of the repo, and rule 1 would swap it.
//
// Exit: 0 all pass; 1 rule-1 failures (swap entries printed); 2 usage; 3 environment error (no swap entries).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { die, effectiveRepos, parseArgs, readJson, sha256File } from "./lib.mjs";

const MIN_PARSEABLE = 200; // rule 1: "fewer than 200 parseable files" fails the technical check
const args = parseArgs(process.argv.slice(2), { flags: ["prune"], defaults: { cache: join(homedir(), ".cache", "drift-eval") } });
if (!args.manifest || !args.drift) die("usage: techcheck.mjs --manifest FILE --drift BIN [--cache DIR] [--reserves N] [--json OUT] [--prune] [--min-free-gb G]");
const prune = args.prune === true;
const minFreeGb = args.minFreeGb !== undefined ? Number(args.minFreeGb) : null;
if (minFreeGb !== null && !(minFreeGb >= 0)) die("--min-free-gb must be a number >= 0");
const manifest = readJson(resolve(args.manifest));
const drift = resolve(args.drift);
const cache = resolve(args.cache);
const date = new Date().toISOString().slice(0, 10);

const git = (dir, ...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const dirty = (dir) => git(dir, "status", "--porcelain", "--ignored", "--untracked-files=all").stdout.trim();
// Local paths never go into a reason (reasons are committed in `replaced`); details are for the console only.
const local = (text) => String(text ?? "").split(cache).join("<cache>").split(drift).join("<drift>").trim().split("\n").pop()?.slice(0, 200) ?? "";

const PLAIN_NAME = /^[A-Za-z0-9_.-]+$/;
const reposDir = join(cache, "repos");
// The checkout --prune may delete: <cache>/repos/<name> for a plain name only, never anything above or beside it.
const prunable = (name) => PLAIN_NAME.test(String(name ?? "")) && name !== "." && name !== ".." && join(reposDir, name).startsWith(reposDir + sep);
const freeGb = () => {
  mkdirSync(cache, { recursive: true });
  const st = statfsSync(cache);
  return (Number(st.bavail) * Number(st.bsize)) / 1e9;
};

// -> { dir } | { dir, failure } (rule 1: the clone failed) | { dir, env } (this machine or the harness)
function checkout(repo) {
  const dir = join(cache, "repos", repo.name);
  const where = `<cache>/repos/${repo.name}`;
  if (prune && !prunable(repo.name)) return { dir, env: `--prune deletes <cache>/repos/<name> for a plain name only, and ${JSON.stringify(repo.name)} is not one. Fix: run without --prune, or correct the manifest's name` };
  if (minFreeGb !== null) {
    const free = freeGb();
    if (free < minFreeGb) return { dir, env: `${free.toFixed(1)} GB free on the cache's filesystem, under --min-free-gb ${minFreeGb}. Fix: free disk space (delete checked checkouts under <cache>/repos), then rerun` };
  }
  if (existsSync(join(dir, ".git")) && git(dir, "rev-parse", "HEAD").stdout.trim() === repo.sha) {
    const st = dirty(dir);
    if (st)
      return { dir, env: `${where} is at the pinned sha but has modified, untracked or ignored files (${st.split("\n").slice(0, 3).join("; ")}). Fix: delete it (rm -rf ${dir}) and rerun techcheck` };
    return { dir };
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { dir, env: `cannot create ${where} (${e.code}). Fix: check the cache directory's permissions and free disk space, then rerun` };
  }
  if (!existsSync(join(dir, ".git")) && git(dir, "init", "-q").status !== 0)
    return { dir, env: `git init failed in ${where}. Fix: check permissions and free disk space, delete it, then rerun` };
  const f = git(dir, "fetch", "-q", "--depth", "1", repo.url, repo.sha);
  if (f.status !== 0) return { dir, failure: "clone failed (git fetch of the pinned sha)", detail: local(f.stderr) };
  const c = git(dir, "checkout", "-q", "--force", repo.sha);
  if (c.status !== 0 || git(dir, "rev-parse", "HEAD").stdout.trim() !== repo.sha)
    return { dir, env: `the pinned sha was fetched into ${where} but could not be checked out (${local(c.stderr)}). Fix: free disk space, use a case-sensitive filesystem, delete ${where}, then rerun` };
  return { dir };
}

// Abort on an environment error: a rule-1 verdict on this repo would be about the machine, not the repo.
function envError(repo, msg) {
  console.error(`ENVIRONMENT ERROR, not a rule-1 failure: ${repo.name}: ${msg}`);
  console.error("No swap entry is printed for it. Fix the environment and rerun techcheck.");
  if (args.json) writeFileSync(args.json, JSON.stringify({ manifest: args.manifest, set_id: manifest.set_id ?? null, env_error: { repo: repo.name, message: msg.split(cache).join("<cache>") }, replaced: [] }, null, 2) + "\n");
  process.exit(3);
}

function check(repo) {
  const out = { name: repo.name, sha: repo.sha, clone: false, scan: false, files: null, parse_errors: null, parseable: null, pass: false, reason: null };
  const co = checkout(repo);
  if (co.env) envError(repo, co.env);
  if (co.failure) return { ...out, reason: co.failure, detail: co.detail };
  out.clone = true;
  const r = spawnSync(drift, ["--root", co.dir, "--no-cache", "scan"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const text = `${r.stdout}\n${r.stderr}`;
  const files = text.match(/drift scan: (\d+) files/);
  const errs = text.match(/parse errors:\s+(\d+)/);
  if (r.status !== 0 || !files) return { ...out, reason: `drift scan errored (exit ${r.status})`, detail: local(text) };
  const st = dirty(co.dir);
  if (st) envError(repo, `drift scan changed the checkout <cache>/repos/${repo.name} (${st.split("\n").slice(0, 3).join("; ")}): a harness problem (a scan never writes with --no-cache). Fix: find out why, delete the checkout, then rerun`);
  out.scan = true;
  out.files = +files[1];
  out.parse_errors = errs ? +errs[1] : 0;
  out.parseable = out.files - out.parse_errors;
  if (out.parseable < MIN_PARSEABLE) return { ...out, reason: `fewer than ${MIN_PARSEABLE} parseable files (${out.parseable})` };
  return { ...out, pass: true };
}
// The check, then (--prune) the checkout deleted, pass or fail: only the summary counts are kept.
function checkAndPrune(repo) {
  const x = check(repo);
  if (prune) rmSync(join(reposDir, repo.name), { recursive: true, force: true });
  return x;
}

const occupants = effectiveRepos(manifest);
const used = (manifest.replaced ?? []).length;
const reserves = (manifest.reserves?.repos ?? []).slice(used);
console.error(`drift ${drift} (sha256 ${sha256File(drift).slice(0, 12)}); ${occupants.length} slot occupants, ${reserves.length} unused reserves`);
const results = occupants.map((r) => {
  const x = checkAndPrune(r);
  console.error(`${x.name}: ${x.pass ? "PASS" : `FAIL (${x.reason})`}${x.scan ? ` ${x.files} files, ${x.parse_errors} parse errors` : ""}${x.detail ? `\n    ${x.detail}` : ""}`);
  return x;
});
const failing = results.filter((r) => !r.pass).length;
const nReserves = Math.min(reserves.length, args.reserves !== undefined ? Number(args.reserves) : failing);
const reserveResults = reserves.slice(0, nReserves).map((r) => {
  const x = checkAndPrune(r);
  console.error(`reserve ${x.name}: ${x.pass ? "PASS" : `FAIL (${x.reason})`}${x.scan ? ` ${x.files} files, ${x.parse_errors} parse errors` : ""}${x.detail ? `\n    ${x.detail}` : ""}`);
  return x;
});

// Rule 1: the i-th swap uses the i-th reserve, for the slot's current occupant; a reserve that fails is itself
// replaced by the next one (swaps chain).
const replaced = [];
let next = 0;
for (const r of results.filter((x) => !x.pass)) {
  let occupant = r;
  while (true) {
    const res = reserves[next];
    if (!res) {
      replaced.push({ error: `no reserve left for ${occupant.name}` });
      break;
    }
    replaced.push({ date, repo: occupant.name, reserve: res.name, reason: `technical check: ${occupant.reason}` });
    next++;
    const rr = reserveResults.find((x) => x.name === res.name);
    if (!rr) {
      replaced.push({ error: `reserve ${res.name} not checked yet: rerun with --reserves ${next}` });
      break;
    }
    if (rr.pass) break;
    occupant = rr;
  }
}
console.log(`${results.length - failing}/${results.length} pass the technical check (rule 1: clone, drift scan, >= ${MIN_PARSEABLE} parseable files)`);
if (replaced.length) {
  console.log(`Append to ${args.manifest} "replaced", in this order, then commit and prepare a NEW run directory (a clone failure must reproduce on a rerun first: a network outage looks the same):`);
  for (const e of replaced) console.log(`  ${JSON.stringify(e)}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify({ manifest: args.manifest, set_id: manifest.set_id ?? null, drift_sha256: sha256File(drift), min_parseable: MIN_PARSEABLE, pruned: prune, results, reserves: reserveResults, replaced }, null, 2) + "\n");
process.exit(failing ? 1 : 0);
