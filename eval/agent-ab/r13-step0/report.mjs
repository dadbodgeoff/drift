// Step-0 report: rescore every run from its saved artifacts (score.mjs), then control
// conformance per model with a Wilson interval, and tokens, turns and exploration per task.
//
//   node eval/agent-ab/r13-step0/report.mjs --work <dir> --out <dir for results.json and report.md>
//
// A concern with no added entry point in Drift's inventory ("none") counts as not conformant
// [strict]; the count of such pairs is printed apart. Model ids never appear in the output: runs
// are labelled by tier ("strong", "cheap").

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { args, readJson, readJsonl, wilson } from "../v2/lib.mjs";
import { scoreRun } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const a = args();
const work = resolve(a.work);
const out = resolve(a.out ?? work);
const suite = readJson(join(here, "tasks.json"));
const byId = new Map(suite.tasks.map((t) => [t.id, t]));
const rows = [];
for (const id of readdirSync(join(work, "runs")).sort()) {
  const dir = join(work, "runs", id);
  const old = readJson(join(dir, "score.json"));
  if (!old) continue;
  const meta = readJson(join(dir, "meta.json"));
  const result = readJsonl(join(dir, "stream.jsonl")).find((l) => l.type === "result") ?? null;
  const row = scoreRun({ task: byId.get(old.task), runDir: dir, changed: old.changed, result });
  // Invalid: the init check failed, the session timed out, or it ended without a result
  // message. Excluded from rates and listed apart.
  const why = [...(meta.init_problems ?? []), ...(meta.timed_out ? ["timed out"] : []), ...(result ? [] : ["no result message"])];
  rows.push({ ...row, label: meta.label, rep: meta.rep, invalid: why.length ? why : null, timed_out: meta.timed_out });
}
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const fmtW = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} ${n ? pct(k / n) : "–"} [${pct(lo)}–${pct(hi)}]`;
};
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => {
  const s = xs.filter((x) => x != null);
  return s.length ? s.reduce((p, q) => p + q, 0) / s.length : null;
};
const f0 = (x) => (x == null ? "–" : Math.round(x).toLocaleString("en-US"));
const f1 = (x) => (x == null ? "–" : x.toFixed(1));
const labels = [...new Set(rows.map((r) => r.label))].sort().reverse();
const lines = ["# Step 0: control-arm conformance on new-unit tasks", ""];
const summary = {};
lines.push("| Model tier | Runs | Invalid | Task-concern pairs conformant | of which no entry point found | Runs with every concern conformant | Mean cost | Total cost |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const lab of labels) {
  const rs = rows.filter((r) => r.label === lab);
  const valid = rs.filter((r) => !r.invalid);
  const pairs = valid.flatMap((r) => r.concerns);
  const k = pairs.filter((c) => c.auto === "pass").length;
  const none = pairs.filter((c) => c.auto === "none").length;
  const allOk = valid.filter((r) => r.concerns.every((c) => c.auto === "pass")).length;
  const cost = rs.reduce((n, r) => n + (r.cost_usd ?? 0), 0);
  summary[lab] = { runs: rs.length, invalid: rs.length - valid.length, pairs: pairs.length, conformant: k, wilson: wilson(k, pairs.length), none, runs_all_conformant: allOk, cost_usd: cost };
  lines.push(`| ${lab} | ${rs.length} | ${rs.length - valid.length} | ${fmtW(k, pairs.length)} | ${none} | ${fmtW(allOk, valid.length)} | $${(cost / rs.length).toFixed(3)} | $${cost.toFixed(2)} |`);
}
lines.push("", "## By concern", "", "| Model tier | Concern | Conformant |", "| --- | --- | --- |");
for (const lab of labels)
  for (const con of [...new Set(rows.flatMap((r) => r.concerns.map((c) => c.concern)))].sort()) {
    const ps = rows.filter((r) => r.label === lab && !r.invalid).flatMap((r) => r.concerns.filter((c) => c.concern === con));
    if (ps.length) lines.push(`| ${lab} | ${con} | ${fmtW(ps.filter((c) => c.auto === "pass").length, ps.length)} |`);
  }
lines.push("", "## Per task (means over repeats)", "", "| Task | Tier | n | Conformant pairs | Turns | Input | Output | Cache read | Cache write | Read/Grep/Glob before first edit | Exploration calls (E1) | Seconds | Cost |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const t of suite.tasks)
  for (const lab of labels) {
    const rs = rows.filter((r) => r.task === t.id && r.label === lab && !r.invalid);
    if (!rs.length) continue;
    const ps = rs.flatMap((r) => r.concerns);
    lines.push(`| ${t.id} | ${lab} | ${rs.length} | ${ps.filter((c) => c.auto === "pass").length}/${ps.length} | ${f1(mean(rs.map((r) => r.turns)))} | ${f0(mean(rs.map((r) => r.input_tokens)))} | ${f0(mean(rs.map((r) => r.output_tokens)))} | ${f0(mean(rs.map((r) => r.cache_read_tokens)))} | ${f0(mean(rs.map((r) => r.cache_creation_tokens)))} | ${f1(mean(rs.map((r) => r.reads_before_edit)))} | ${f1(mean(rs.map((r) => r.exploration_calls)))} | ${f0(mean(rs.map((r) => r.seconds)))} | $${(mean(rs.map((r) => r.cost_usd)) ?? 0).toFixed(3)} |`);
  }
lines.push("", "## Per tier, per run (medians)", "", "| Tier | Turns | Input | Output | Cache read | Cache write | Read/Grep/Glob before first edit | Exploration calls | Seconds |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const lab of labels) {
  const rs = rows.filter((r) => r.label === lab && !r.invalid);
  const m = (k) => median(rs.map((r) => r[k]));
  summary[lab].medians = Object.fromEntries(["turns", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "reads_before_edit", "exploration_calls", "seconds"].map((k) => [k, m(k)]));
  lines.push(`| ${lab} | ${f1(m("turns"))} | ${f0(m("input_tokens"))} | ${f0(m("output_tokens"))} | ${f0(m("cache_read_tokens"))} | ${f0(m("cache_creation_tokens"))} | ${f1(m("reads_before_edit"))} | ${f1(m("exploration_calls"))} | ${f0(m("seconds"))} |`);
}
lines.push("", "## Non-conformant pairs (valid runs)", "");
for (const r of rows.filter((x) => !x.invalid)) for (const c of r.concerns) if (c.auto !== "pass") lines.push(`- ${r.run} ${c.concern}: ${c.auto}${c.why ? ` (${c.why})` : ""}`);
lines.push("", "## Invalid runs", "");
for (const r of rows.filter((x) => x.invalid)) lines.push(`- ${r.run}: ${r.invalid.join("; ")}`);
const ledger = readJsonl(join(work, "ledger.jsonl"));
lines.push("", `Ledger: ${ledger.length} calls, $${ledger.reduce((n, l) => n + (l.cost_usd ?? 0), 0).toFixed(2)}.`);
mkdirSync(out, { recursive: true });
const strip = (r) => ({ ...r, run: r.run.replace(/__control__/, "__") });
writeFileSync(join(out, "results.json"), JSON.stringify({ summary, rows: rows.map(strip) }, null, 2) + "\n");
writeFileSync(join(out, "report.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
