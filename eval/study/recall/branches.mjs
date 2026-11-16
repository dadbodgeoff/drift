#!/usr/bin/env node
// The review-time arm of recall11: deviations a pull request introduced in one of its commits and no longer had when
// it was merged, i.e. fixed in review. The first-parent walk (walk.mjs) cannot see them.
//
//   node eval/study/recall/branches.mjs --record FILE --url URL --work DIR --out FILE --f11 BIN --study BIN
//        [--depth 300] [--pr-depth 30] [--max-branch 30] [--budget 300]
//
// Per repo (its walk record gives the head, S and the cards):
// - one bounded fetch: the pinned head (--depth) and, in the same command, `refs/pull/<N>/head` (--pr-depth) of every
//   squash-merged pull request after S (a first-parent commit with one parent whose subject ends in "(#N)");
// - the same mining at S (the study binary, every card accepted); the card ids must equal the walk record's, else the
//   repo is refused [STRICT];
// - for each first-parent commit C after S that merged a branch (a merge commit: its second parent; a squash: the pull
//   request's head), with P = C's first parent: the branch commits are those of the head not reachable from P (the
//   newest --max-branch, oldest first), and B is the parent of the oldest of them when it is in the history;
// - `check --format json` (gate on, members listed) at P, at B, at each branch commit and at C, PRs taken in an even
//   stride over the window until --budget seconds of checks are spent;
// - a branch deviation is a key that violates at some branch commit, is not baselined, and violates at neither P nor
//   B; at C it is fixed (C holds the member), exempted, removed, merged (still violating at C: the first-parent walk
//   counts it), or unknown (its file is unchecked at C). Its flags are those at the first branch commit showing it.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { flagsOf, keyOf, prNumber, splitKey } from "./lib.mjs";
import { die, parseArgs } from "../lib.mjs";

const a = parseArgs(process.argv.slice(2), { defaults: { depth: "300", prDepth: "30", maxBranch: "30", budget: "300" } });
for (const k of ["record", "url", "work", "out", "f11", "study"]) if (!a[k]) die(`missing --${k}`);
const rec = JSON.parse(readFileSync(a.record, "utf8"));
const repo = join(a.work, "repos", rec.name);
const cache = join(a.work, "cache", rec.name);
mkdirSync(cache, { recursive: true });
const t0 = Date.now();
const log = (m) => process.stderr.write(`[${rec.name} branches ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}\n`);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 }).trim();
function drift(bin, args, extra = {}) {
  const r = spawnSync(bin, ["--root", repo, ...args], {
    env: { ...process.env, DRIFT_CACHE_DIR: cache, ...extra },
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0 && r.status !== 1) throw new Error(`${args.join(" ")}: exit ${r.status}: ${r.stderr.slice(0, 500)}`);
  return r.stdout;
}
// Two fetch commands in one bounded step: the pinned head, then the pull refs of the squash merges its first-parent
// history after S names ("(#N)" subjects), listed on the remote first so that only existing refs are asked for.
if (!existsSync(join(repo, ".git"))) {
  execFileSync("git", ["init", "-q", repo]);
  git("config", "gc.auto", "0");
  git("fetch", "-q", "--no-tags", `--depth=${a.depth}`, a.url, rec.head);
  const fp0 = git("rev-list", "--first-parent", rec.head).split("\n").slice(0, rec.s_index);
  const wanted = new Set(fp0.map((c) => prNumber(git("log", "-1", "--format=%s", c))).filter(Boolean));
  const remote = wanted.size
    ? execFileSync("git", ["ls-remote", a.url, "refs/pull/*/head"], { encoding: "utf8", maxBuffer: 1 << 30 })
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("\t")[1])
    : [];
  const refs = remote.filter((r) => wanted.has(Number(r.split("/")[2]))).map((r) => `+${r}:refs/pr/${r.split("/")[2]}`);
  log(`fetch: head --depth ${a.depth}; ${refs.length} of ${wanted.size} pull refs --depth ${a.prDepth}`);
  for (let i = 0; i < refs.length; i += 200) git("fetch", "-q", "--no-tags", `--depth=${a.prDepth}`, a.url, ...refs.slice(i, i + 200));
}
const checkout = (sha) => git("-c", "advice.detachedHead=false", "checkout", "-q", "-f", sha);
checkout(rec.S);
rmSync(join(repo, ".drift"), { recursive: true, force: true });
rmSync(join(repo, "drift.lock"), { force: true });
// DRIFT_NO_FROM_MAP: mined proposals only, as the walk recorded (an older binary ignores it).
drift(a.study, ["init", "--max", "1000", "--all"], { DRIFT_STUDY_UNSHOWN: "1", DRIFT_NO_FROM_MAP: "1" });
const yaml = readFileSync(join(repo, ".drift", "conventions.yaml"), "utf8");
const ids = [...new Set([...yaml.matchAll(/^\s*-?\s*id:\s*([A-Z]-[0-9a-f]+)\s*$/gm)].map((m) => m[1]))];
const want = rec.census.study.cards.map((c) => c.id).sort();
if (JSON.stringify([...ids].sort()) !== JSON.stringify(want)) die(`${rec.name}: mining at S differs from the walk record`);
if (ids.length) drift(a.study, ["review", "--accept", ids.join(",")], { DRIFT_STUDY_UNSHOWN: "1" });

const check = () =>
  JSON.parse(drift(a.study, ["check", "--format", "json"], { DRIFT_NEIGHBOUR_GATE: "on", DRIFT_STUDY_MEMBERS: "1" }));
const viol = (r) => new Map(r.violations.map((v) => [keyOf(v.id, v.path, v.symbol), flagsOf(v)]));

const fp = git("rev-list", "--first-parent", rec.head).split("\n");
const after = fp.slice(0, rec.s_index).reverse();
const prRefs = new Set(git("for-each-ref", "--format=%(refname)", "refs/pr").split("\n").filter(Boolean));
const merges = [];
for (const c of after) {
  const parents = git("rev-list", "--parents", "-n", "1", c).split(" ").slice(1);
  if (parents.length === 2) merges.push({ c, p: parents[0], head: parents[1], kind: "merge" });
  else {
    const n = prNumber(git("log", "-1", "--format=%s", c));
    if (n && prRefs.has(`refs/pr/${n}`)) merges.push({ c, p: parents[0], head: `refs/pr/${n}`, kind: "squash", pr: n });
  }
}
log(`${merges.length} merged branches after S (${merges.filter((m) => m.kind === "squash").length} squash)`);
const out = [];
let branchCommits = 0;
let spent = 0;
let visited = 0;
const timed = () => {
  const t = Date.now();
  const r = check();
  spent += (Date.now() - t) / 1000;
  return r;
};
// An even stride over the window, then the PRs in between, until the budget is spent.
const order = [];
for (let step = 8; step >= 1; step = Math.floor(step / 2)) for (let i = 0; i < merges.length; i += step) if (!order.includes(i)) order.push(i);
for (const i of ids.length ? order : []) {
  if (spent > Number(a.budget)) break;
  const { c, p, head, kind } = merges[i];
  let list = git("rev-list", "--reverse", head, `^${p}`).split("\n").filter(Boolean);
  if (!list.length) continue;
  if (list.length > Number(a.maxBranch)) list = list.slice(-Number(a.maxBranch));
  visited++;
  const base = (() => {
    try {
      return git("rev-parse", "--verify", "-q", `${list[0]}^`);
    } catch {
      return null;
    }
  })();
  checkout(p);
  const before = viol(timed());
  if (base && base !== p) {
    checkout(base);
    for (const k of viol(timed()).keys()) before.set(k, "");
  }
  const seen = new Map(); // key -> { flags, at }
  for (const b of list) {
    checkout(b);
    branchCommits++;
    for (const [k, f] of viol(timed())) if (!f.includes("b") && !before.has(k) && !seen.has(k)) seen.set(k, { flags: f, at: b });
  }
  if (!seen.size) continue;
  checkout(c);
  const rm = timed();
  const atC = viol(rm);
  const holds = new Set(rm.study_holds || []);
  const exempt = new Set((rm.exempt || []).map((e) => keyOf(e.id, e.path, e.symbol)));
  const unchecked = new Set(rm.unchecked || []);
  for (const [k, s] of seen) {
    const status = atC.has(k)
      ? "merged"
      : unchecked.has(splitKey(k).path)
        ? "unknown"
        : holds.has(k)
          ? "fixed"
          : exempt.has(k)
            ? "exempted"
            : "removed";
    out.push({ key: k, id: splitKey(k).id, commit: c, kind, intro: s.at, flags: s.flags, status, branch_commits: list.length });
  }
}
mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(
  a.out,
  JSON.stringify({
    name: rec.name,
    lang: rec.lang,
    fold: rec.fold,
    merges: merges.length,
    squash: merges.filter((m) => m.kind === "squash").length,
    visited,
    branch_commits: branchCommits,
    check_secs: spent,
    devs: out,
    secs: (Date.now() - t0) / 1000,
  }),
);
log(`done: ${branchCommits} branch commits, ${out.length} branch deviations`);
