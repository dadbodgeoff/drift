// Agent A/B harness v2: the same Claude Code task with and without Drift, repeated, scored on
// the whole trajectory. See README.md in this folder.
//
//   node eval/agent-ab/v2/run.mjs --drift <bin> --repos <dev repos dir> --work <dir> \
//        [--models haiku,sonnet,opus] [--repeats 5] [--arms control,drift] [--jobs 4] \
//        [--only id,id] [--categories a,b] [--seed 1] [--budget-usd 50] [--dry-run] \
//        [--calibrate <work dir of an earlier run>] [--max-turns 80] [--timeout-min 30] \
//        [--max-attempts 2] [--pass-env VAR,VAR]
//
// Prints a cost estimate first; --dry-run stops there. Every `claude` call is written to
// <work>/ledger.jsonl as soon as it returns (cost from its result, or from the transcript's
// usage when it was killed); --budget-usd stops scheduling once the ledger plus in-flight
// estimates would pass it. A unit without score.json is retried up to --max-attempts times;
// the previous attempt is moved to runs/<id>/attempt-<n>/ first. Sessions run sandboxed, see
// sandbox.mjs.

import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MAX_WORKTREES, args, buildPolicy, costFromTranscript, fileHash, findTranscript, here, hideHarnessFiles, installPolicy, loadLabels,
  policyHash, readJson, readJsonl, rng, root, run, shuffle, tamperHashes, withWorktree, writeJson,
} from "./lib.mjs";
import { scoreInPlace } from "./score.mjs";
import { estimate, printEstimate } from "./estimate.mjs";
import { buildPlugin, checkInit, childEnv, claudeArgs, initSummary, snapshotOutside, writeDriftWrapper, writesOutside } from "./sandbox.mjs";

export const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

const a = args();
const drift = resolve(a.drift ?? join(root, "target/release/drift"));
const repos = resolve(a.repos ?? "");
const work = resolve(a.work ?? "");
const models = String(a.models ?? "haiku").split(",").map((m) => MODELS[m] ?? m);
const repeats = Number(a.repeats ?? 5);
const arms = String(a.arms ?? "control,drift").split(",");
const jobs = Math.min(Number(a.jobs ?? 4), MAX_WORKTREES);
const seed = Number(a.seed ?? 1);
const budget = a["budget-usd"] ? Number(a["budget-usd"]) : Infinity;
const maxTurns = Number(a["max-turns"] ?? 80);
const timeoutMs = Number(a["timeout-min"] ?? 30) * 60_000;
const maxAttempts = Number(a["max-attempts"] ?? 2);
const passEnv = a["pass-env"] ? String(a["pass-env"]).split(",") : [];
const only = a.only ? String(a.only).split(",") : null;
const cats = a.categories ? String(a.categories).split(",") : null;

const allTasks = readJson(a.tasks ? resolve(a.tasks) : join(here, "tasks.json")).tasks;
const tasks = allTasks.filter((t) => (!only || only.includes(t.id)) && (!cats || cats.includes(t.category)));
if (!tasks.length) throw new Error("no tasks selected");

const short = (m) => Object.entries(MODELS).find(([, v]) => v === m)?.[0] ?? m.replace(/^claude-/, "");
const units = [];
for (const t of tasks) for (const arm of arms) for (const m of models) for (let r = 1; r <= repeats; r++) units.push({ task: t, arm, model: m, rep: r, id: `${t.id}__${arm}__${short(m)}__r${r}` });
const done = (u) => existsSync(join(work, "runs", u.id, "score.json"));
/** Attempts already made: moved ones (attempt-<n>/) plus a dead one still at the top level. */
const attemptsOf = (u) => {
  const d = join(work, "runs", u.id);
  if (!existsSync(d)) return 0;
  const entries = readdirSync(d);
  return entries.filter((e) => /^attempt-\d+$/.test(e)).length + (entries.some((e) => e === "meta.json" || e === "error.txt") ? 1 : 0);
};
const todo = units.filter((u) => !done(u));

const est = estimate({ tasks, arms, models, repeats, calibrate: a.calibrate ? resolve(a.calibrate) : null });
const ledgerPath = join(work, "ledger.jsonl");
const ledgerSpent = () => readJsonl(ledgerPath).reduce((n, l) => n + (l.cost_usd ?? 0), 0);
printEstimate(est, { todo: todo.length, total: units.length, budget, spent: existsSync(ledgerPath) ? ledgerSpent() : 0 });
if (a["dry-run"]) process.exit(0);
if (!a.repos || !a.work) throw new Error("--repos and --work are required");

mkdirSync(join(work, "runs"), { recursive: true });
// One drift binary per work dir: policies, scores and resumed runs all refer to it.
const driftHash = fileHash(drift);
const prevConfig = readJson(join(work, "config.json"));
if (prevConfig?.drift_sha256 && prevConfig.drift_sha256 !== driftHash) throw new Error(`${work} was run with another drift binary (${prevConfig.drift_sha256.slice(0, 12)}); use a new --work`);
const binDir = writeDriftWrapper(work, drift);
const pluginDir = buildPlugin(work);

const labels = loadLabels();
const policies = {};
for (const repo of [...new Set(tasks.map((t) => t.repo))]) {
  policies[repo] = await buildPolicy({ work, repos, repo, drift, labels });
  const ids = new Set(policies[repo].meta.accepted.map((c) => c.id));
  for (const t of tasks.filter((t) => t.repo === repo)) {
    const missing = t.exercises.filter((id) => !ids.has(id));
    if (missing.length) throw new Error(`${t.id} exercises ${missing.join(", ")}, which the ${repo} policy does not accept`);
  }
  console.log(`policy ${repo}: ${policies[repo].meta.accepted.length} accepted (${policies[repo].meta.accepted.filter((c) => c.mode === "block").length} block), ${policies[repo].meta.rejected.length} rejected, hash ${policies[repo].meta.policy_hash}`);
}
writeJson(join(work, "config.json"), { drift, drift_sha256: driftHash, repos, models, repeats, arms, jobs, seed, budget, maxTurns, maxAttempts, tasks: tasks.map((t) => t.id), started: prevConfig?.started ?? new Date().toISOString(), resumed: prevConfig ? new Date().toISOString() : undefined });

/** One `claude -p` call. Validates the init message as soon as it arrives and kills the session on a mismatch. */
function claude(argv, cwd, env, arm, streamPath) {
  return new Promise((resolveCall) => {
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
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.type === "system" && j.subtype === "init" && !init) {
          init = initSummary(j);
          initProblems = checkInit(init, arm, join(work, "init-expected.json"));
          if (initProblems.length) p.kill("SIGTERM");
        }
        if (j.type === "result") result = j;
      }
    });
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGTERM");
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(streamPath, lines.join("\n") + "\n");
      resolveCall({ code, result, init, initProblems, timedOut, err });
    });
  });
}

/** Move a dead attempt's files out of the way, so nothing of it leaks into the new one. */
function freshRunDir(runDir) {
  if (!existsSync(runDir)) return 1;
  const n = readdirSync(runDir).filter((d) => /^attempt-\d+$/.test(d)).length + 1;
  const dest = join(runDir, `attempt-${n}`);
  mkdirSync(dest);
  for (const e of readdirSync(runDir)) if (!/^attempt-\d+$/.test(e)) renameSync(join(runDir, e), join(dest, e));
  return n + 1;
}

async function runUnit(u) {
  const runDir = join(work, "runs", u.id);
  const attempt = freshRunDir(runDir);
  mkdirSync(runDir, { recursive: true });
  const wt = join(work, "wt", u.id);
  const home = join(work, "homes", u.id);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, "tmp"), { recursive: true });
  const policyDir = policies[u.task.repo].dir;
  return withWorktree(join(repos, u.task.repo), wt, async () => {
    hideHarnessFiles(wt, join(runDir, "exclude"));
    // Both arms: the silent recorder (successful and failed tool calls), passed with --settings.
    const recorder = { type: "command", command: `node ${join(here, "recorder.mjs")}`, timeout: 30 };
    const matcher = "Write|Edit|MultiEdit|NotebookEdit|Bash";
    writeJson(join(runDir, "settings.json"), { hooks: { PostToolUse: [{ matcher, hooks: [recorder] }], PostToolUseFailure: [{ matcher, hooks: [recorder] }] } });
    let path = process.env.PATH;
    if (u.arm === "drift") {
      // As a team would have it: reviewed policy committed, the Drift plugin (hooks and skill) installed.
      installPolicy(policyDir, wt);
      run(drift, ["scan"], wt); // warm fact cache, as after `drift init`
      path = `${binDir}:${path}`;
    }
    const env = { ...childEnv({ home, path, passEnv }), AB_REC_DIR: join(runDir, "rec"), AB_WT: wt, ...(u.arm === "drift" ? { AB_HOOK_LOG: join(runDir, "hooklog.jsonl") } : {}) };
    const installed = tamperHashes(wt);
    // Seed the recorder with what was installed, so the first change to the policy is seen.
    mkdirSync(join(runDir, "rec"), { recursive: true });
    writeFileSync(join(runDir, "rec", "state.json"), JSON.stringify({ "\0tamper": installed }));
    const prompts = u.task.prompts ?? [u.task.prompt];
    const meta = {
      run: u.id, task: u.task.id, repo: u.task.repo, category: u.task.category, exercises: u.task.exercises, arm: u.arm, model: u.model, rep: u.rep, attempt,
      wt, home, policy_hash: policies[u.task.repo].meta.policy_hash, drift_sha256: driftHash, installed,
      env_keys: Object.keys(env).sort(), sessions: [], results: [], streams: [], exit_codes: [], timed_out: [], init: [], invalid: [], cost_usd: 0, started: new Date().toISOString(),
    };
    writeJson(join(runDir, "meta.json"), meta);
    const outsideBefore = snapshotOutside({ work, repos, repoDir: join(repos, u.task.repo) });
    const t0 = Date.now();
    let session = null;
    let sessionTotal = 0;
    for (let i = 0; i < prompts.length; i++) {
      const argv = claudeArgs({ prompt: prompts[i], arm: u.arm, model: u.model, maxTurns, settings: join(runDir, "settings.json"), pluginDir, resume: session });
      const r = await claude(argv, wt, env, u.arm, join(runDir, `claude-${i}.jsonl`));
      writeFileSync(join(runDir, `claude-${i}.json`), r.result ? JSON.stringify(r.result) : "");
      writeFileSync(join(runDir, `claude-${i}.stderr`), r.err);
      meta.results.push(`claude-${i}.json`);
      meta.streams.push(`claude-${i}.jsonl`);
      meta.exit_codes.push(r.code);
      meta.timed_out.push(r.timedOut);
      meta.init.push(r.init);
      if (r.initProblems.length) meta.invalid.push(...r.initProblems.map((p) => `init: ${p}`));
      const sid = r.result?.session_id ?? readJsonl(join(runDir, `claude-${i}.jsonl`)).find((l) => l.session_id)?.session_id;
      if (sid) {
        session = sid;
        if (!meta.sessions.includes(sid)) meta.sessions.push(sid);
      }
      // Ledger first: the money is spent whatever happens next. A resumed call reports the
      // session's cumulative cost, so the call's own cost is the increase.
      let cost = r.result?.total_cost_usd;
      let source = "result";
      if (cost != null) {
        cost = cost >= sessionTotal ? cost - sessionTotal : cost;
        sessionTotal = r.result.total_cost_usd;
      } else {
        // Killed (timeout, init check) or crashed: no result. Price the transcript's usage.
        const t = session && findTranscript(session, home);
        const total = t ? costFromTranscript(readJsonl(t), u.model) : 0;
        cost = Math.max(0, total - sessionTotal);
        sessionTotal = Math.max(sessionTotal, total);
        source = t ? "transcript" : "none";
      }
      meta.cost_usd += cost;
      appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), run: u.id, attempt, call: i, arm: u.arm, model: u.model, category: u.task.category, cost_usd: cost, source, exit: r.code, timed_out: r.timedOut }) + "\n");
      writeJson(join(runDir, "meta.json"), meta);
      if (r.initProblems.length || (r.code !== 0 && !session)) break;
    }
    meta.ms = Date.now() - t0;
    // Containment: tool calls that tried to leave the checkout, and files changed outside it.
    const outside = writesOutside({ work, repos, repoDir: join(repos, u.task.repo) }, outsideBefore);
    if (outside.length) meta.invalid.push(`files modified outside the checkout: ${outside.slice(0, 10).join(", ")}`);
    mkdirSync(join(runDir, "transcripts"), { recursive: true });
    for (const s of meta.sessions) {
      const t = findTranscript(s, home);
      if (t) cpSync(t, join(runDir, "transcripts", `${s}.jsonl`));
    }
    const sess = join(wt, ".drift/cache/sessions");
    if (existsSync(sess)) cpSync(sess, join(runDir, "drift-sessions"), { recursive: true });
    writeJson(join(runDir, "meta.json"), meta);
    rmSync(home, { recursive: true, force: true });
    const row = scoreInPlace({ drift, wt, runDir, policyDir });
    console.log(
      `${u.id}: $${row.cost_usd.toFixed(3)} ${row.turns} turns ${row.seconds}s | final ${row.final_violations}, introduced ${row.introduced}, fixed ${row.fixed_later}, regressions ${row.regressions}, ci exit ${row.ci_exit}${row.replay_consistent ? "" : " (replay inconsistent)"}${row.invalid.length ? ` INVALID: ${row.invalid.join("; ")}` : ""}`,
    );
    return row;
  });
}

// Randomised order (seeded), parallel workers, budget guard on the ledger, retry cap.
const queue = shuffle(todo, rng(seed)).filter((u) => {
  if (attemptsOf(u) >= maxAttempts) {
    console.log(`${u.id}: ${attemptsOf(u)} failed attempts, not retried (--max-attempts ${maxAttempts})`);
    return false;
  }
  return true;
});
const inflight = new Map();
let stopped = false;
const unitEst = (u) => est.perUnit(u.task, u.model, u.arm);
async function worker() {
  while (queue.length && !stopped) {
    const u = queue[0];
    const committed = ledgerSpent() + [...inflight.values()].reduce((x, y) => x + y, 0);
    if (committed + unitEst(u) > budget) {
      stopped = true;
      console.log(`budget: $${committed.toFixed(2)} spent (ledger) or in flight, next run ~$${unitEst(u).toFixed(2)} would pass $${budget}; stopping (${queue.length} left)`);
      break;
    }
    queue.shift();
    inflight.set(u.id, unitEst(u));
    try {
      await runUnit(u);
    } catch (e) {
      console.log(`${u.id}: failed: ${e.stack ?? e}`);
      mkdirSync(join(work, "runs", u.id), { recursive: true });
      writeFileSync(join(work, "runs", u.id, "error.txt"), String(e.stack ?? e));
    } finally {
      inflight.delete(u.id);
    }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`done: $${ledgerSpent().toFixed(2)} in the ledger. Report: node ${join(here, "report.mjs")} --work ${work}`);
