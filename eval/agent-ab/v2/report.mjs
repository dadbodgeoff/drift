// Report an A/B v2 run.
//
//   node eval/agent-ab/v2/report.mjs --work <dir> [--out report.md]
//
// Primary analysis: the paired comparison per task (control rate minus drift rate over the
// repeats), with a bootstrap over tasks, overall and per category. Per-arm and per-category
// rates are pooled over runs, but their intervals come from a cluster bootstrap over tasks
// (repeats of one task are not independent). Percentile bootstrap intervals undercover with few
// tasks (about 82% at n = 5 for a nominal 95%), so intervals over fewer than MIN_TASKS tasks, or
// where every task ties, are printed as "n too small".
//
// Runs that are invalid (sandbox breach, unexpected tool set, tampering) or whose replay does not
// match the final tree are left out of the rates and listed per arm and model, with errors
// (no score) and timeouts. A timeout is an outcome of the run: timed-out runs stay in the rates.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, bootstrap, mean, readJson, rng } from "./lib.mjs";

const MIN_TASKS = 5;
const a = args();
const work = resolve(a.work);
const dirs = readdirSync(join(work, "runs"));
const all = dirs.map((d) => readJson(join(work, "runs", d, "score.json"))).filter(Boolean);
const errored = dirs
  .filter((d) => !existsSync(join(work, "runs", d, "score.json")))
  .map((d) => ({ id: d, meta: readJson(join(work, "runs", d, "meta.json")) ?? Object.fromEntries(["task", "arm", "model"].map((k, i) => [k, d.split("__")[i]])) }));
const excluded = (r) => (r.invalid?.length ?? 0) > 0 || r.replay_consistent === false;
const rows = all.filter((r) => !excluded(r));

const lines = [];
const p = (s = "") => lines.push(s);
const pct = (x) => (Number.isNaN(x) ? "–" : `${Math.round(100 * x)}%`);
const by = (xs, k) => xs.reduce((m, x) => ((m[k(x)] ??= []).push(x), m), {});
const finalAny = (r) => r.final_violations > 0;
const introAny = (r) => r.introduced > 0;
const regAny = (r) => r.regressions > 0;
const ciFail = (r) => r.ci_exit !== 0;
/** Security facts the change introduced (null when the drift build did not score them). */
const secScored = (r) => r.sec_gaps !== null && r.sec_gaps !== undefined;
const secAny = (r) => (r.sec_gaps ?? 0) + (r.sec_unguarded_reaching ?? 0) > 0;
const secTotal = (r) => (r.sec_gaps ?? 0) + (r.sec_unguarded_reaching ?? 0) + (r.sec_sinks ?? 0) + (r.sec_leaks ?? 0);
const short = (m) => String(m).replace(/^claude-/, "").replace(/-5-5$/, "");

/** Pooled rate over runs, with a cluster bootstrap over tasks. */
function clusterRate(rs, f) {
  const k = rs.filter(f).length;
  const tasks = Object.values(by(rs, (r) => r.task));
  const head = `${k}/${rs.length} ${pct(k / rs.length)}`;
  if (tasks.length < MIN_TASKS) return `${head} [n too small: ${tasks.length} tasks]`;
  const rand = rng(11);
  const vals = [];
  for (let b = 0; b < 4000; b++) {
    let s = 0, n = 0;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[Math.floor(rand() * tasks.length)];
      s += t.filter(f).length;
      n += t.length;
    }
    vals.push(s / n);
  }
  vals.sort((x, y) => x - y);
  return `${head} [${pct(vals[100])}–${pct(vals[3899])}]`;
}

/** Mean of a per-run number with a cluster bootstrap over tasks. */
function clusterMean(rs, f, d = 2) {
  const tasks = Object.values(by(rs, (r) => r.task));
  const m = mean(rs.map(f));
  if (tasks.length < MIN_TASKS) return `${m.toFixed(d)} [n too small]`;
  const [lo, hi] = bootstrap(tasks, (ts) => mean(ts.flat().map(f)));
  return `${m.toFixed(d)} [${lo.toFixed(d)}–${hi.toFixed(d)}]`;
}

/** Paired difference control - drift per task (rates over repeats); bootstrap over tasks. */
export function paired(rs, f) {
  const diffs = [];
  let better = 0, tie = 0, worse = 0;
  for (const tr of Object.values(by(rs, (r) => r.task))) {
    const c = tr.filter((r) => r.arm === "control");
    const d = tr.filter((r) => r.arm === "drift");
    if (!c.length || !d.length) continue;
    const x = c.filter(f).length / c.length - d.filter(f).length / d.length;
    diffs.push(x);
    if (x > 0) better++;
    else if (x < 0) worse++;
    else tie++;
  }
  const head = `${diffs.length ? pct(mean(diffs)) : "–"} over ${diffs.length} tasks (Drift better ${better}, tie ${tie}, worse ${worse})`;
  if (diffs.length < MIN_TASKS || diffs.every((x) => x === diffs[0])) return { text: `${head} [n too small]`, diffs };
  const [lo, hi] = bootstrap(diffs, mean);
  return { text: `${head} [${pct(lo)}–${pct(hi)}]`, diffs };
}

p(`# Agent A/B v2 report`);
p();
p(`${all.length} scored runs in ${work}; ${all.length - rows.length} excluded (invalid or replay-inconsistent); ${errored.length} units without a score.`);
p(`Only conventions labelled ACCEPT by the independent reviewers are enforced and counted.`);
p();
p(`- **final**: run left at least one new violation in the files it changed (final-state score, as v1; legacy code that only moved is not counted).`);
p(`- **introduced**: at least one violation existed after some edit during the session (trajectory replay; a renamed violation counts once).`);
p(`- **regression**: an existing symbol that satisfied a rule stopped satisfying it at some point (e.g. a route inserted between a decorator and its handler).`);
p(`- **CI fails**: \`drift check\` on the final tree exits non-zero, as the GitHub action would.`);
p(`- Intervals: cluster bootstrap over tasks. The paired per-task difference (control minus drift; positive means Drift helped) is the primary result.`);

const report = { models: {} };
const models = [...new Set([...all.map((r) => r.model), ...errored.map((e) => e.meta?.model).filter(Boolean)])];
for (const model of models) {
  const mr = rows.filter((r) => r.model === model);
  const mall = all.filter((r) => r.model === model);
  const merr = errored.filter((e) => [model, short(model)].includes(e.meta?.model));
  p();
  p(`## ${model}`);
  p();
  p(`### Paired by task (primary)`);
  p();
  const pf = paired(mr, finalAny), pi = paired(mr, introAny), pg = paired(mr, regAny);
  p(`- **final**: ${pf.text}`);
  p(`- **introduced**: ${pi.text}`);
  p(`- **regression**: ${pg.text}`);
  const secRows = mr.filter(secScored);
  if (secRows.length) {
    const psg = paired(secRows, secAny);
    p(`- **security**: ${psg.text} (an entry point the run added lacks a guard most of its siblings have, or has no wrapper and reaches a risky operation; \`drift security --diff-base\`, facts that fail nothing)`);
  }
  // Sensitivity: a run that tampered with Drift's policy or the agent configuration counts as a
  // failure (a violation left) instead of being excluded.
  const tampered = (r) => (r.tampered_final?.length ?? 0) > 0 || r.invalid?.some((x) => /^tampered/.test(x));
  const sens = mall.filter((r) => !excluded(r) || (tampered(r) && r.replay_consistent !== false && r.invalid.every((x) => /^tampered/.test(x))));
  const ps = paired(sens, (r) => tampered(r) || finalAny(r));
  p(`- **sensitivity, final with tampered runs counted as failures** (${sens.filter(tampered).length} tampered runs): ${ps.text}`);
  p();
  p(`| Category | final | introduced | regression |`);
  p(`| --- | --- | --- | --- |`);
  for (const [cat, cr] of Object.entries(by(mr, (r) => r.category)).sort()) p(`| ${cat} | ${paired(cr, finalAny).text} | ${paired(cr, introAny).text} | ${paired(cr, regAny).text} |`);

  p();
  const secRowsAll = mr.filter(secScored);
  if (secRowsAll.length) {
    p();
    p(`### Security facts introduced, per arm`);
    p();
    p(`| Arm | Runs scored | runs with a gap or unguarded reach | mean gaps | mean unguarded reaching | mean risky ops added | mean client leaks added | gaps an accepted convention also reports |`);
    p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
    const sa = by(secRowsAll, (r) => r.arm);
    for (const arm of ["control", "drift"]) {
      const rs = sa[arm] ?? [];
      if (!rs.length) continue;
      const accepted = rs.reduce((n, r) => n + (r.sec_gap_details ?? []).filter((g) => g.convention === "accepted").length, 0);
      const gaps = rs.reduce((n, r) => n + (r.sec_gaps ?? 0), 0);
      p(`| ${arm} | ${rs.length} | ${clusterRate(rs, secAny)} | ${clusterMean(rs, (r) => r.sec_gaps ?? 0)} | ${clusterMean(rs, (r) => r.sec_unguarded_reaching ?? 0)} | ${clusterMean(rs, (r) => r.sec_sinks ?? 0)} | ${clusterMean(rs, (r) => r.sec_leaks ?? 0)} | ${accepted}/${gaps} |`);
    }
    void secTotal;
  }
  p();
  p(`### Rates per arm`);
  p();
  p(`| Arm | Runs | Tasks | final | introduced | regression | fixed / introduced | mean final | mean introduced | CI fails | moved legacy | suppressions | timed out | $ | turns | s |`);
  p(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  const armRows = by(mr, (r) => r.arm);
  for (const arm of ["control", "drift"]) {
    const rs = armRows[arm] ?? [];
    if (!rs.length) continue;
    const intro = rs.reduce((n, r) => n + r.introduced, 0);
    const fixed = rs.reduce((n, r) => n + r.fixed_later, 0);
    p(
      `| ${arm} | ${rs.length} | ${new Set(rs.map((r) => r.task)).size} | ${clusterRate(rs, finalAny)} | ${clusterRate(rs, introAny)} | ${clusterRate(rs, regAny)} | ${fixed}/${intro} | ${clusterMean(rs, (r) => r.final_violations)} | ${clusterMean(rs, (r) => r.introduced)} | ${clusterRate(rs, ciFail)} | ${rs.reduce((n, r) => n + (r.final_moved_legacy ?? 0), 0)} | ${rs.reduce((n, r) => n + r.suppressions_added, 0)} | ${rs.filter((r) => r.timed_out).length} | ${rs.reduce((n, r) => n + (r.cost_usd ?? 0), 0).toFixed(2)} | ${mean(rs.map((r) => r.turns)).toFixed(1)} | ${mean(rs.map((r) => r.seconds)).toFixed(0)} |`,
    );
  }
  p();
  p(`| Category | Arm | Runs | Tasks | final | introduced | regression |`);
  p(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const [cat, cr] of Object.entries(by(mr, (r) => r.category)).sort())
    for (const arm of ["control", "drift"]) {
      const rs = cr.filter((r) => r.arm === arm);
      if (rs.length) p(`| ${cat} | ${arm} | ${rs.length} | ${new Set(rs.map((r) => r.task)).size} | ${clusterRate(rs, finalAny)} | ${clusterRate(rs, introAny)} | ${clusterRate(rs, regAny)} |`);
    }

  p();
  p(`### Per task`);
  p();
  p(`| Task | Cat | n c/d | final c | final d | introduced c | introduced d | regression c | regression d |`);
  p(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const [task, tr] of Object.entries(by(mr, (r) => r.task)).sort()) {
    const c = tr.filter((r) => r.arm === "control");
    const d = tr.filter((r) => r.arm === "drift");
    const rc = (f, xs) => (xs.length ? pct(xs.filter(f).length / xs.length) : "–");
    p(`| ${task} | ${tr[0].category} | ${c.length}/${d.length} | ${rc(finalAny, c)} | ${rc(finalAny, d)} | ${rc(introAny, c)} | ${rc(introAny, d)} | ${rc(regAny, c)} | ${rc(regAny, d)} |`);
  }

  p();
  p(`### Failures and exclusions per arm`);
  p();
  p(`| Arm | scored | invalid | replay inconsistent | timed out | errors (no score) | scored on a retry |`);
  p(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const arm of ["control", "drift"]) {
    const rs = mall.filter((r) => r.arm === arm);
    p(`| ${arm} | ${rs.length} | ${rs.filter((r) => r.invalid?.length).length} | ${rs.filter((r) => r.replay_consistent === false).length} | ${rs.filter((r) => r.timed_out).length} | ${merr.filter((e) => e.meta?.arm === arm).length} | ${rs.filter((r) => (r.attempt ?? 1) > 1).length} |`);
  }
  for (const r of mall.filter((r) => r.invalid?.length)) p(`- invalid ${r.run}: ${r.invalid.join("; ")}`);

  const ctrl = armRows.control ?? [];
  const left = ctrl.filter(finalAny);
  p();
  p(`### CI view (control arm)`);
  p();
  p(`- Runs that left violations: ${left.length}/${ctrl.length}; CI would fail on ${left.filter(ciFail).length} of them (strict mode: ${left.filter((r) => r.ci_exit_strict !== 0).length}).`);
  p(`- CI failures with nothing left in changed files (moved legacy code, untouched files): ${ctrl.filter((r) => ciFail(r) && !finalAny(r)).length}.`);

  const dr = (armRows.drift ?? []).filter((r) => r.hooks);
  if (dr.length) {
    const lat = {};
    for (const r of dr) for (const [ev, v] of Object.entries(r.hooks.latency_ms ?? {})) (lat[ev] ??= []).push(v);
    const intro = dr.reduce((n, r) => n + r.introduced, 0);
    p();
    p(`### What the hooks did (drift arm)`);
    p();
    p(`- Advice shown: ${dr.reduce((n, r) => n + r.hooks.context_shown.post, 0)} PostToolUse, ${dr.reduce((n, r) => n + r.hooks.context_shown.pre, 0)} PreToolUse primes, ${dr.reduce((n, r) => n + r.hooks.context_shown.start, 0)} SessionStart.`);
    p(`- Stop blocks: ${dr.reduce((n, r) => n + r.hooks.blocks, 0)} (in ${dr.filter((r) => r.hooks.blocks > 0).length} runs); Stop feedback seen in transcript: ${dr.reduce((n, r) => n + r.hooks.stop_feedback, 0)}.`);
    p(`- Introduced violations the hooks reported to the agent: ${dr.reduce((n, r) => n + r.hooks.introduced_advised, 0)}/${intro}.`);
    p(`- Hook errors: ${dr.reduce((n, r) => n + r.hooks.hook_errors, 0)}; agent ran drift CLI: ${dr.reduce((n, r) => n + r.hooks.agent_drift_cli.length, 0)} times.`);
    for (const [ev, vs] of Object.entries(lat).sort()) p(`- Latency ${ev}: ${vs.reduce((n, v) => n + v.n, 0)} calls, median of run medians ${vs.map((v) => v.p50).sort((x, y) => x - y)[Math.floor(vs.length / 2)]} ms, max ${Math.max(...vs.map((v) => v.max))} ms.`);
  }
  p();
  p(`Tampering attempts (Edit/Write/Bash on .drift/, drift.lock, .claude/): ${["control", "drift"].map((arm) => `${arm} ${mall.filter((r) => r.arm === arm && (r.tamper_calls || r.tamper_recorded || r.tampered_final?.length)).length} runs`).join(", ")}.`);
  const issues = {};
  for (const r of mall) for (const [k, v] of Object.entries(r.replay_issues ?? {})) issues[k] = (issues[k] ?? 0) + v;
  p(`Replay issues: ${JSON.stringify(issues)}.`);
  report.models[model] = { runs: mr.length, excluded: mall.length - mr.length, paired: { final: pf.diffs, introduced: pi.diffs, regression: pg.diffs } };
}

const md = lines.join("\n") + "\n";
console.log(md);
if (a.out) writeFileSync(resolve(a.out), md);
writeFileSync(join(work, "report.json"), JSON.stringify({ ...report, rows: all, errored: errored.map((e) => e.id) }, null, 2));
