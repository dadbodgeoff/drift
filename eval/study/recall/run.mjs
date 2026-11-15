#!/usr/bin/env node
// Run walk.mjs over the build set of eval/study/folds-r11.json, one repo at a time (never two drift processes at
// once), skipping repos whose record exists, stopping when the disk has under 3 GB free, and deleting each repo's
// history and cache as soon as its record is written.
//
//   node eval/study/recall/run.mjs --work DIR --records DIR --f11 BIN --study BIN [--only a,b] [--budget 600] [--max-cp 300]
//   node eval/study/recall/run.mjs --mode branches --branches DIR --work DIR --records DIR --f11 BIN --study BIN
//
// Inputs are the build-set manifests only: eval/repos.json, eval/repos-py.json, eval/repos-py-2.json and the dev3
// census manifests named by folds-r11.json (fold 5, by key). No other manifest is opened.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { die, parseArgs } from "../lib.mjs";

const a = parseArgs(process.argv.slice(2), { defaults: { budget: "600", maxCp: "300", minFreeGb: "3" } });
for (const k of ["work", "records", "f11", "study"]) if (!a[k]) die(`missing --${k}`);
const folds = JSON.parse(readFileSync("eval/study/folds-r11.json", "utf8"));
const pins = new Map();
const add = (lang, file) => {
  for (const r of JSON.parse(readFileSync(file, "utf8")).repos) pins.set(`${lang}:${r.name}`, { url: r.url, sha: r.sha });
};
for (const f of folds.manifests.ts) add("ts", f);
for (const f of folds.manifests.py) add("py", f);
add("ts", folds.fold5.ts.census_manifest);
add("py", folds.fold5.py.census_manifest);

export function buildSet() {
  const out = [];
  for (const f of folds.folds)
    for (const lang of ["ts", "py"])
      for (const name of f[lang]) {
        if (folds.excluded.includes(name)) continue;
        const p = pins.get(`${lang}:${name}`);
        if (!p) die(`${name}: no pin in the build-set manifests`);
        out.push({ name, lang, fold: f.fold, ...p });
      }
  return out;
}

// --mode branches: branches.mjs (the review-time arm) over every repo whose walk record has cards, into --branches DIR.
const mode = a.mode || "walk";
const freeGb = () => Number(execFileSync("df", ["-BM", "--output=avail", "/"], { encoding: "utf8" }).split("\n")[1].replace("M", "")) / 1024;
const only = a.only ? new Set(a.only.split(",")) : null;
for (const r of buildSet()) {
  if (only && !only.has(r.name)) continue;
  const rec = join(a.records, `${r.name}.json`);
  const out = mode === "branches" ? join(a.branches, `${r.name}.branches.json`) : rec;
  if (existsSync(out)) continue;
  if (mode === "branches") {
    if (!existsSync(rec)) continue;
    const m = JSON.parse(readFileSync(rec, "utf8"));
    if (!m.accepted) continue;
  }
  // Wait while under 4 GB of memory is available (other agents' builds).
  while (Number(execFileSync("free", ["-g"], { encoding: "utf8" }).split("\n")[1].trim().split(/\s+/)[6]) < 4)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  const free = freeGb();
  if (free < Number(a.minFreeGb)) die(`stopping before ${r.name}: ${free} GB free`);
  process.stderr.write(`== ${r.name} (${r.lang}, fold ${r.fold}), ${free} GB free\n`);
  const args =
    mode === "branches"
      ? ["eval/study/recall/branches.mjs", "--record", rec, "--url", r.url, "--work", a.work, "--out", out, "--f11", a.f11, "--study", a.study, "--budget", a.branchBudget || "300"]
      : null;
  const res = spawnSync(
    "node",
    args || [
      "eval/study/recall/walk.mjs",
      ...["--name", r.name, "--url", r.url, "--sha", r.sha, "--lang", r.lang, "--fold", String(r.fold)],
      ...["--work", a.work, "--out", out, "--f11", a.f11, "--study", a.study, "--budget", a.budget, "--max-cp", a.maxCp],
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (res.status !== 0) process.stderr.write(`!! ${r.name}: exit ${res.status}\n`);
  rmSync(join(a.work, "repos", r.name), { recursive: true, force: true });
  rmSync(join(a.work, "cache", r.name), { recursive: true, force: true });
}
process.stderr.write("all done\n");
