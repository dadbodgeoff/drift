// Step-0 kill test (round 13): control-arm conformance on new-unit tasks. No Drift in the
// session. Reuses the v2 harness's sandbox (sandbox.mjs), checkouts and transcript parsing
// (lib.mjs) and its security scorer (score.mjs securityCheck).
//
//   node eval/agent-ab/r13-step0/run.mjs --drift <bin> --clones <dev-clones dir> --work <dir> \
//        --models <strong-id>,<cheap-id> --labels strong,cheap --repeats 3 --jobs 3 --budget-usd 25 \
//        [--only id,id] [--max-turns 40] [--timeout-min 15] [--prepare-only]
//
// 1. prepare: per task, a shared bare clone of the dev clone with one commit on top that deletes
//    the unit (tasks.json `remove`/`cut`); the dev clone is never written.
// 2. run: per task x model x repeat, a sandboxed `claude -p` (control arm, v2 sandbox flags) on
//    a fresh checkout of that commit. Every call goes to <work>/ledger.jsonl; scheduling stops
//    when ledger + in-flight estimates would pass --budget-usd.
// 3. score (score.mjs here): `drift security --json` and `--diff-base HEAD` on the final tree,
//    the patch, and tokens / turns / tool calls before the first edit from the stream.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { args, changedPaths, patchOf, readJson, readJsonl, run, rng, sh, shuffle, writeJson } from "../v2/lib.mjs";
import { bareFrom, withCheckout } from "./wt.mjs";
import { checkInit, childEnv, claudeArgs, initSummary } from "../v2/sandbox.mjs";
import { securityCheck } from "../v2/score.mjs";
import { scoreRun } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const a = args();
const drift = resolve(a.drift);
const clones = resolve(a.clones);
const work = resolve(a.work);
const models = String(a.models).split(",");
const labels = String(a.labels ?? a.models).split(",");
const repeats = Number(a.repeats ?? 3);
const jobs = Math.min(Number(a.jobs ?? 2), 2); // at most 2 checkouts on disk (shared disk)
const budget = Number(a["budget-usd"] ?? 25);
const maxTurns = Number(a["max-turns"] ?? 40);
const timeoutMs = Number(a["timeout-min"] ?? 15) * 60_000;
const suite = readJson(join(here, "tasks.json"));
const only = a.only ? String(a.only).split(",") : null;
const tasks = suite.tasks.filter((t) => !only || only.includes(t.id));
const BANNED = /convention|\bauth|drift|pattern|guard|permission|decorat|wrapper|middleware|lint|best practice|consistent/i; // verify-tasks.mjs
for (const t of tasks) {
  const m = (t.prompt + suite.suffix).match(BANNED);
  if (m) throw new Error(`${t.id}: prompt mentions "${m[0]}"`);
}

// ---------- 1. prepare ----------
function prepare(t) {
  const dir = join(work, "repos", t.id);
  if (existsSync(join(dir, "PREPARED"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  const src = join(clones, t.set, t.repo);
  bareFrom(src, dir);
  const base = sh("git", ["-C", src, "rev-parse", "HEAD"]).trim();
  const idx = join(work, "repos", `${t.id}.index`);
  const empty = join(work, "repos", `${t.id}.empty`); // update-index wants a work tree; it reads none
  mkdirSync(empty, { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: idx, GIT_WORK_TREE: empty };
  const g = (argv, input) => execGit(dir, argv, env, input);
  g(["read-tree", base]);
  for (const f of t.remove) g(["update-index", "--force-remove", "--", f]);
  const byFile = new Map();
  for (const c of t.cut) (byFile.get(c.file) ?? byFile.set(c.file, []).get(c.file)).push(c);
  for (const [file, cuts] of byFile) {
    let text = g(["show", `${base}:${file}`]);
    for (const c of cuts) {
      if (text.split(c.text).length !== 2) throw new Error(`${t.id}: cut text not found exactly once in ${file}`);
      text = text.replace(c.text, c.with ?? "");
    }
    const blob = g(["hash-object", "-w", "--stdin"], text).trim();
    g(["update-index", "--cacheinfo", `100644,${blob},${file}`]);
  }
  const tree = g(["write-tree"]).trim();
  const commit = execGit(dir, ["commit-tree", tree, "-p", base, "-m", `step0: remove unit for ${t.id}`], {
    ...process.env, GIT_AUTHOR_NAME: "step0", GIT_AUTHOR_EMAIL: "step0@example.invalid", GIT_COMMITTER_NAME: "step0",
    GIT_COMMITTER_EMAIL: "step0@example.invalid", GIT_AUTHOR_DATE: "2026-11-09T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-09T00:00:00Z",
  }).trim();
  execGit(dir, ["update-ref", "HEAD", commit]);
  rmSync(idx, { force: true });
  rmSync(empty, { recursive: true, force: true });
  writeFileSync(join(dir, "PREPARED"), JSON.stringify({ base, commit }) + "\n");
  return dir;
}
function execGit(dir, argv, env, input) {
  const r = run("git", ["-C", dir, ...argv], undefined, { env, input });
  if (r.code !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

mkdirSync(join(work, "runs"), { recursive: true });
const prepared = Object.fromEntries(tasks.map((t) => [t.id, prepare(t)]));
for (const t of tasks) console.log(`prepared ${t.id}: ${readFileSync(join(prepared[t.id], "PREPARED"), "utf8").trim()}`);
// Drift's inventory of the base commit (the unit removed): what the run adds is the difference.
mkdirSync(join(work, "base-inv"), { recursive: true });
for (const t of tasks) {
  const out = join(work, "base-inv", `${t.id}.json`);
  if (existsSync(out)) continue;
  await withCheckout(prepared[t.id], join(work, "wt", `base-${t.id}`), async (wt) => {
    const r = run(drift, ["security", "--json"], wt);
    if (r.code !== 0) throw new Error(`${t.id}: drift security on the base failed: ${r.stderr.slice(0, 300)}`);
    writeFileSync(out, r.stdout);
  });
  console.log(`base inventory ${t.id}: ${JSON.parse(readFileSync(out, "utf8")).entry_points.length} entry points`);
}
if (a["prepare-only"]) process.exit(0);

// ---------- 2. run ----------
const ledgerPath = join(work, "ledger.jsonl");
const spent = () => readJsonl(ledgerPath).reduce((n, l) => n + (l.cost_usd ?? 0), 0);
const prior = { strong: 0.6, cheap: 0.12 }; // per-run estimate before any run of that model has returned
const estimate = (label) => {
  const rows = readJsonl(ledgerPath).filter((l) => l.label === label);
  if (!rows.length) return prior[label] ?? 0.6;
  return Math.max(...rows.map((r) => r.cost_usd)); // the dearest run so far: the cap must hold
};
const units = [];
for (const t of tasks) for (let m = 0; m < models.length; m++) for (let r = 1; r <= repeats; r++)
  units.push({ task: t, model: models[m], label: labels[m], rep: r, id: `${t.id}__control__${labels[m]}__r${r}` });
const queue = shuffle(units.filter((u) => !existsSync(join(work, "runs", u.id, "score.json"))), rng(13));

function claude(argv, cwd, env, streamPath) {
  return new Promise((done) => {
    const p = spawn("claude", argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", err = "", result = null, init = null, initProblems = [], timedOut = false;
    const lines = [];
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        lines.push(line);
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.type === "system" && j.subtype === "init" && !init) {
          init = initSummary(j);
          initProblems = checkInit(init, "control", join(work, "init-expected.json"));
          if (initProblems.length) p.kill("SIGTERM");
        }
        if (j.type === "result") result = j;
      }
    });
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGTERM"); }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(streamPath, lines.join("\n") + "\n");
      done({ code, result, init, initProblems, timedOut, err });
    });
  });
}

async function runUnit(u) {
  const runDir = join(work, "runs", u.id);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  const wt = join(work, "wt", u.id);
  const home = join(work, "homes", u.id);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, "tmp"), { recursive: true });
  return withCheckout(prepared[u.task.id], wt, async () => {
    writeJson(join(runDir, "settings.json"), {});
    const env = childEnv({ home });
    const t0 = Date.now();
    const argv = claudeArgs({ prompt: u.task.prompt + suite.suffix, arm: "control", model: u.model, maxTurns, settings: join(runDir, "settings.json") });
    const r = await claude(argv, wt, env, join(runDir, "stream.jsonl"));
    const cost = r.result?.total_cost_usd ?? 0;
    appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), run: u.id, label: u.label, cost_usd: cost, exit: r.code, timed_out: r.timedOut, has_result: !!r.result }) + "\n");
    writeJson(join(runDir, "meta.json"), { run: u.id, task: u.task.id, repo: u.task.repo, label: u.label, rep: u.rep, exit: r.code, timed_out: r.timedOut, init_problems: r.initProblems, ms: Date.now() - t0, stderr: r.err.slice(0, 2000) });
    rmSync(home, { recursive: true, force: true });
    const changed = changedPaths(wt);
    writeFileSync(join(runDir, "changes.patch"), patchOf(wt, changed));
    // Drift facts on the final tree: the security inventory (guards, validates) and the change's gaps.
    const sec = run(drift, ["security", "--json"], wt);
    writeFileSync(join(runDir, "security-full.json"), sec.stdout);
    securityCheck(drift, wt, join(runDir, "ci"));
    const row = scoreRun({ task: u.task, runDir, changed, result: r.result });
    writeJson(join(runDir, "score.json"), row);
    console.log(`${u.id}: $${cost.toFixed(3)} ${row.turns} turns, reads-before-edit ${row.reads_before_edit}, ${row.concerns.map((c) => `${c.concern}=${c.auto}`).join(" ")}`);
    return row;
  });
}

const inflight = new Map();
let stopped = false;
async function worker() {
  while (queue.length && !stopped) {
    const u = queue[0];
    const committed = spent() + [...inflight.values()].reduce((x, y) => x + y, 0);
    if (committed + estimate(u.label) > budget) {
      stopped = true;
      console.log(`budget: $${committed.toFixed(2)} spent or in flight; next ${u.label} run ~$${estimate(u.label).toFixed(2)} would pass $${budget}; stopping with ${queue.length} left`);
      break;
    }
    queue.shift();
    inflight.set(u.id, estimate(u.label));
    try {
      await runUnit(u);
    } catch (e) {
      console.log(`${u.id}: failed: ${e.stack ?? e}`);
      writeFileSync(join(work, "runs", u.id, "error.txt"), String(e.stack ?? e));
    } finally {
      inflight.delete(u.id);
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`done: $${spent().toFixed(2)} in the ledger`);
