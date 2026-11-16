#!/usr/bin/env node
// One repo of the recall11 walk (eval/study/research/2026-11-09/recall11.md): mine at a snapshot S, then run
// `drift check --format json` at every first-parent commit after S (or every stride-th, within a time budget) with
// every card mined at S accepted, and record what each run says about the tracked (card, member) pairs.
//
//   node eval/study/recall/walk.mjs --name REPO --url URL --sha HEAD --lang ts|py --fold N \
//        --work DIR --out FILE --f11 BIN --study BIN [--back 200] [--depth 300] [--max-cp 120] [--budget 900]
//
// - The history: one bounded fetch (`git fetch --depth`) of the pinned head into a private repo under --work; the
//   dev clones are never written.
// - S: the first-parent commit about --back total commits before the pinned head (lib.mjs pickSnapshot).
// - Cards at S, from the frozen F11 binary (--f11): `census --json` with the product defaults, with
//   `--python-proposals` (the opt-in view), and both again with no cap (`--all --max 1000`).
// - Mining at S for the check: the study binary (--study: F11 plus eval/study/recall/study.patch, which only (1) lets
//   DRIFT_STUDY_UNSHOWN=1 skip the show policy, so the cards it hides are mined too, and (2) with
//   DRIFT_STUDY_MEMBERS=1 lists the members each convention holds on, `study_holds`). `init --max 1000 --all`, then
//   every card is accepted (advise mode). drift.lock is the baseline at S.
// - At each checkpoint: `check --format json` with DRIFT_NEIGHBOUR_GATE=on (the gate's held-back warnings stay in
//   `violations`, flagged) and DRIFT_STUDY_MEMBERS=1; every 5th checkpoint and the last also gate off, to confirm
//   that the gate-off warnings are the gate-on violations (PREREG-F11 §7 "discrepancies").
// The record keeps, per checkpoint, every violation with its flags, and the holds, exemptions and unchecked files
// of the keys tracked so far (lock entries and every violation seen). score.mjs replays it (lib.mjs track).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkpoints, flagsOf, keyOf, parseRenames, pickSnapshot, renameKey, splitKey } from "./lib.mjs";
import { die, parseArgs } from "../lib.mjs";

const a = parseArgs(process.argv.slice(2), {
  defaults: { back: "200", depth: "300", maxCp: "120", budget: "900", offEvery: "5" },
});
for (const k of ["name", "url", "sha", "lang", "work", "out", "f11", "study"]) if (!a[k]) die(`missing --${k}`);
const back = Number(a.back);
const depth = Number(a.depth);
const repo = join(a.work, "repos", a.name);
const cache = join(a.work, "cache", a.name);
mkdirSync(dirname(repo), { recursive: true });
mkdirSync(cache, { recursive: true });
const t0 = Date.now();
const log = (m) => process.stderr.write(`[${a.name} ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}\n`);

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 }).trim();
const env = (extra = {}) => ({ ...process.env, DRIFT_CACHE_DIR: cache, ...extra });
function drift(bin, args, extra = {}) {
  const r = spawnSync(bin, ["--root", repo, ...args], { env: env(extra), encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`${bin} ${args.join(" ")}: exit ${r.status}: ${r.stderr.slice(0, 500)}`);
  return r.stdout;
}
const json = (bin, args, extra) => JSON.parse(drift(bin, args, extra));

// ---------- history ----------
if (!existsSync(join(repo, ".git"))) {
  execFileSync("git", ["init", "-q", repo]);
  git("config", "gc.auto", "0");
  log(`fetch --depth ${depth}`);
  git("fetch", "-q", "--no-tags", `--depth=${depth}`, a.url, a.sha);
}
if (git("rev-parse", "FETCH_HEAD") !== a.sha) die(`${a.name}: FETCH_HEAD is not ${a.sha}`);
const fp = git("rev-list", "--first-parent", a.sha).split("\n");
const countBack = (i) => Number(git("rev-list", "--count", `${fp[i]}..${a.sha}`));
const s = pickSnapshot(fp, countBack, back);
const S = fp[s];
const after = fp.slice(0, s).reverse(); // oldest first, ends at the head
const totalBack = countBack(s);
log(`S = ${S.slice(0, 10)}: ${s} first-parent commits, ${totalBack} commits back`);

function checkout(sha) {
  git("-c", "advice.detachedHead=false", "checkout", "-q", "-f", sha);
}
checkout(S);
const trackedDrift = git("ls-files", ".drift", "drift.lock");
if (trackedDrift) die(`${a.name}: the repo tracks ${trackedDrift.split("\n")[0]}; not walked [STRICT]`);
rmSync(join(repo, ".drift"), { recursive: true, force: true });
rmSync(join(repo, "drift.lock"), { force: true });

// ---------- cards at S ----------
function compactCards(c) {
  return c.proposals.map((p) => ({
    id: p.id,
    rank: p.rank,
    shown_by_default: p.shown_by_default,
    tier: p.tier,
    rule_kind: p.rule_kind,
    language: p.language,
    agents: !!p.agents?.shown_to_agents,
    agents_reason: p.agents?.reason ?? null,
    members: p.role?.members ?? null,
    holders: p.evidence?.holders ?? null,
    total: p.evidence?.total ?? null,
    summary: p.summary,
  }));
}
const census = {};
for (const [k, args, extra] of [
  ["shown", ["census", "--json"], {}],
  ["shown_py", ["census", "--json", "--python-proposals"], {}],
  ["pool", ["census", "--json", "--all", "--max", "1000"], {}],
  ["pool_py", ["census", "--json", "--all", "--max", "1000", "--python-proposals"], {}],
]) {
  log(`census ${k}`);
  const c = json(a.f11, args, extra);
  census[k] = { commit: c.commit, cards: compactCards(c) };
}
log("census study (unshown)");
const studyCensus = json(a.study, ["census", "--json", "--all", "--max", "1000"], { DRIFT_STUDY_UNSHOWN: "1" });
census.study = { commit: studyCensus.commit, cards: compactCards(studyCensus) };

log("init (study, unshown, --max 1000 --all)");
// DRIFT_NO_FROM_MAP: the walk records mined proposals only; a binary that writes
// "from the map" ones honours it, an older one ignores it.
drift(a.study, ["init", "--max", "1000", "--all"], { DRIFT_STUDY_UNSHOWN: "1", DRIFT_NO_FROM_MAP: "1" });
const yaml = readFileSync(join(repo, ".drift", "conventions.yaml"), "utf8");
const ids = [...new Set([...yaml.matchAll(/^\s*-?\s*id:\s*([A-Z]-[0-9a-f]+)\s*$/gm)].map((m) => m[1]))];
if (ids.length) drift(a.study, ["review", "--accept", ids.join(",")], { DRIFT_STUDY_UNSHOWN: "1" });
const lock = readFileSync(join(repo, "drift.lock"), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const sp = l.indexOf(" ");
    return keyOf(l.slice(0, sp), ...l.slice(sp + 1).split(/#(.*)/s).slice(0, 2));
  });
log(`${ids.length} cards accepted, ${lock.length} lock entries`);

// ---------- the walk ----------
let tracked = new Set(lock);
function runCheck(gate, members) {
  const extra = { DRIFT_NEIGHBOUR_GATE: gate ? "on" : "off" };
  if (members) extra.DRIFT_STUDY_MEMBERS = "1";
  return json(a.study, ["check", "--format", "json"], extra);
}
function compactViolations(r) {
  return r.violations.map((v) => [v.id, v.path, v.symbol, flagsOf(v)]);
}

const tc = Date.now();
const atS = ids.length ? runCheck(true, true) : { violations: [], exempt: [], study_holds: [] };
const checkSecs = (Date.now() - tc) / 1000;
const newAtS = atS.violations.filter((v) => !v.baselined).length;
const maxCp = Math.max(20, Math.min(Number(a.maxCp), Math.floor(Number(a.budget) / (checkSecs * 1.25 + 1))));
const { stride, picked } = checkpoints(after, maxCp);
log(`check at S ${checkSecs.toFixed(1)}s (${newAtS} not baselined); ${after.length} commits, ${picked.length} checkpoints, stride ${stride}`);

const cps = [];
let prev = S;
const offEvery = Number(a.offEvery);
if (ids.length)
  picked.forEach((idx, n) => {
    const sha = after[idx];
    checkout(sha);
    const renames = parseRenames(
      execFileSync("git", ["-C", repo, "diff", "-M", "--name-status", "-z", "--diff-filter=R", prev, sha], {
        encoding: "utf8",
        maxBuffer: 1 << 30,
      }),
    );
    tracked = new Set([...tracked].map((k) => renameKey(k, renames)));
    const r = runCheck(true, true);
    const v = compactViolations(r);
    for (const [id, path, symbol, flags] of v) if (!flags.includes("b")) tracked.add(keyOf(id, path, symbol));
    const trackedPaths = new Set([...tracked].map((k) => splitKey(k).path));
    const cp = {
      i: idx,
      sha,
      date: git("log", "-1", "--format=%cI", sha),
      renames,
      v,
      holds: (r.study_holds || []).filter((k) => tracked.has(k)),
      exempt: (r.exempt || []).map((e) => keyOf(e.id, e.path, e.symbol)).filter((k) => tracked.has(k)),
      unchecked: (r.unchecked || []).filter((p) => trackedPaths.has(p)),
    };
    if ((n + 1) % offEvery === 0 || n === picked.length - 1) cp.v_off = compactViolations(runCheck(false, false));
    cps.push(cp);
    prev = sha;
    if ((n + 1) % 10 === 0) log(`checkpoint ${n + 1}/${picked.length}`);
  });

const record = {
  name: a.name,
  lang: a.lang,
  fold: Number(a.fold),
  head: a.sha,
  S,
  s_index: s,
  commits_back: totalBack,
  first_parent_after: after.length,
  stride,
  checkpoints: picked.length,
  check_secs_at_S: checkSecs,
  new_at_S: newAtS,
  binaries: { f11: census.shown.commit, study: census.study.commit },
  accepted: ids.length,
  census,
  lock,
  cps,
  secs: (Date.now() - t0) / 1000,
};
mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(a.out, JSON.stringify(record));
log(`done in ${record.secs.toFixed(0)}s`);
