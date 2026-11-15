// Measure proposal precision on the labelled dev repos.
//
//   node eval/study/measure.mjs --drift target/release/drift --cache DIR [--out DIR] [--json FILE]
//                               [--baseline DIR]
//
// Runs `drift census --all-outliers` (default top 15) on every repo in
// eval/repos.json (checked out under DIR/repos/<name>, read-only: `--no-cache`
// keeps Drift from writing a fact cache into the clone), and scores the
// proposal ids against eval/study/labels.jsonl. A proposal id is a hash of
// (role, rule), so an unchanged proposal keeps its label; ids with no label are
// listed as new, to be labelled blind.
//
// Reported per repo and in total:
//   - proposals shown, and ACCEPT / TRIVIAL / WRONG among labelled ones;
//   - not-wrong rate = (ACCEPT + TRIVIAL) / labelled;
//   - accept rate = ACCEPT / labelled;
//   - new (unlabelled) ids.
// With --baseline (an earlier --out directory), it also lists labelled ids whose
// wording or members changed since then: same (role, rule), so the same id, but
// the old label may no longer apply and the proposal should be relabelled.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { censusListAll, parseJson, readJson } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const drift = resolve(arg("--drift", join(here, "..", "..", "target", "release", "drift")));
// Every proposal, not only the suggestions a person is shown first (lib.mjs censusListAll).
const listAll = existsSync(drift) ? censusListAll(drift) : [];
const cache = resolve(arg("--cache", "."));
const outDir = arg("--out", null);
const jsonOut = arg("--json", null);
const baselineDir = arg("--baseline", null);

// id -> what a reviewer saw of each proposal in a census output: its wording,
// holders/total and outliers (lift and bounds move with the rest of the repo).
function blocks(text) {
  const out = new Map();
  let id = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\d+\. \[(D-[0-9a-f]{6})\] (.*)$/);
    const e = line.match(/^\s+evidence:\s+(\d+\/\d+)/);
    if (m) {
      id = m[1];
      out.set(id, [m[2]]);
    } else if (id && e) {
      out.get(id).push(e[1]);
    } else if (id && /^\s+outlier:/.test(line)) {
      out.get(id).push(line.trim());
    }
  }
  return out;
}
const manifest = readJson(join(here, "..", "repos.json"));

const labels = new Map();
for (const [n, line] of readFileSync(join(here, "labels.jsonl"), "utf8").split("\n").entries()) {
  if (!line.trim()) continue;
  const l = parseJson(line, `eval/study/labels.jsonl:${n + 1}`);
  // An unknown label (a typo, a new value) would silently drop out of both the
  // labelled and the new counts.
  if (!["ACCEPT", "TRIVIAL", "WRONG"].includes(l.label)) {
    throw new Error(`labels.jsonl: unknown label ${JSON.stringify(l.label)} for ${l.repo} ${l.id}`);
  }
  labels.set(`${l.repo} ${l.id}`, l.label); // later lines win
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const rows = [];
const total = { n: 0, ACCEPT: 0, TRIVIAL: 0, WRONG: 0, new: 0 };
for (const repo of manifest.repos) {
  const dir = join(cache, "repos", repo.name);
  const r = spawnSync(drift, ["--root", dir, "--no-cache", "census", "--all-outliers", ...listAll], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(`census failed on ${repo.name}: ${r.stderr.slice(0, 500)}`);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${repo.name}.txt`), r.stdout);
  }
  const proposals = [...r.stdout.matchAll(/^\s*\d+\. \[(D-[0-9a-f]{6})\] (.*)$/gm)].map((m) => ({
    id: m[1],
    text: m[2],
  }));
  const row = { repo: repo.name, n: proposals.length, ACCEPT: 0, TRIVIAL: 0, WRONG: 0, new: [] };
  for (const p of proposals) {
    const label = labels.get(`${repo.name} ${p.id}`);
    if (label) row[label] += 1;
    else row.new.push(p);
  }
  if (baselineDir && existsSync(join(baselineDir, `${repo.name}.txt`))) {
    const before = blocks(readFileSync(join(baselineDir, `${repo.name}.txt`), "utf8"));
    const now = blocks(r.stdout);
    row.changed = proposals
      .filter((p) => labels.has(`${repo.name} ${p.id}`) && before.has(p.id))
      .filter((p) => before.get(p.id).join("\n") !== now.get(p.id).join("\n"))
      .map((p) => ({ ...p, label: labels.get(`${repo.name} ${p.id}`) }));
  }
  rows.push(row);
  total.n += row.n;
  for (const k of ["ACCEPT", "TRIVIAL", "WRONG"]) total[k] += row[k];
  total.new += row.new.length;
}

const line = (name, r, nnew) => {
  const lab = r.ACCEPT + r.TRIVIAL + r.WRONG;
  return [
    name.padEnd(26),
    String(r.n).padStart(4),
    String(r.ACCEPT).padStart(4),
    String(r.TRIVIAL).padStart(4),
    String(r.WRONG).padStart(4),
    pct(r.ACCEPT + r.TRIVIAL, lab).padStart(8),
    pct(r.ACCEPT, lab).padStart(8),
    String(nnew).padStart(4),
  ].join(" ");
};
console.log(["repo".padEnd(26), "   n", " ACC", " TRI", " WRO", "not-wrong", " accept", " new"].join(" "));
for (const r of rows) console.log(line(r.repo, r, r.new.length));
console.log(line("TOTAL", total, total.new));
const newIds = rows.flatMap((r) => r.new.map((p) => `${r.repo} ${p.id} ${p.text}`));
if (newIds.length) {
  console.log("\nNew (unlabelled) proposals:");
  for (const s of newIds) console.log(`  ${s}`);
}
const changed = rows.flatMap((r) => (r.changed ?? []).map((p) => `${r.repo} ${p.id} [${p.label}] ${p.text}`));
if (changed.length) {
  console.log("\nLabelled proposals whose wording or members changed since the baseline (relabel):");
  for (const s of changed) console.log(`  ${s}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ rows, total }, null, 2));
