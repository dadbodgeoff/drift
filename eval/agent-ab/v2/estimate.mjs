// Cost estimate for an A/B run, printed before anything is scheduled.
//
// Base cost per run and model: the mean of the v1 A/B (eval/agent-ab/results-*.json, nine
// single-file tasks). Sonnet was not run in v1: its base is Opus's times 0.60, which is what the
// v1 Opus token mix (input, output, 1h cache writes, cache reads) costs at Sonnet 5.5 prices
// ($2/$10/$4/$0.20 per MTok vs Opus 5.5's $4/$20/$8/$0.20).
// Harder tasks cost more: a per-category multiplier (CATEGORY_WEIGHT, or a task's own `weight`),
// and the drift arm costs more than control (ARM_WEIGHT; 1.8x overall in the Haiku pilot).
// Both are replaced by observed multipliers per (category, arm) when --calibrate points at an
// earlier work dir (its ledger, so killed and failed runs count too).
//
//   node eval/agent-ab/v2/estimate.mjs [--models haiku,sonnet,opus] [--repeats 5] [--calibrate <work>]

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { args, here, mean, readJson, readJsonl, resultCosts, root } from "./lib.mjs";

const SONNET_FROM_OPUS = 0.6;
// Cost of a run relative to a v1 run, by category. a, d, e, f observed in the Haiku pilot
// (2026-11-05: a 0.9, d 0.5, e 2.0, f 13 with resumed calls' cumulative cost counted once);
// b and c estimated (c is about one f prompt).
export const CATEGORY_WEIGHT = { a: 1, b: 1.5, c: 4, d: 0.6, e: 2, f: 13 };
// Pilot: drift/control cost ratio 1.8 ($0.33 vs $0.18); these keep the category weights' mean.
export const ARM_WEIGHT = { control: 0.7, drift: 1.3 };

export function baseCosts() {
  const base = {};
  for (const [m, f] of [["claude-haiku-5-5", "results-haiku.json"], ["claude-opus-5-5", "results-opus.json"]]) {
    const rows = readJson(join(root, "eval/agent-ab", f), []);
    base[m] = mean(rows.map((r) => r.cost_usd).filter((x) => x != null));
  }
  base["claude-sonnet-5-5"] = base["claude-opus-5-5"] * SONNET_FROM_OPUS;
  return base;
}

/** Observed cost multiplier per (category, arm): mean cost per unit (all attempts) / v1 base for its model. */
export function calibration(work, base) {
  const perRun = {};
  for (const l of readJsonl(join(work, "ledger.jsonl"))) {
    perRun[l.run] ??= { category: l.category, arm: l.arm, model: l.model, usd: 0 };
    perRun[l.run].usd += l.cost_usd ?? 0;
  }
  // Work dirs from before the ledger: score.json.
  if (!Object.keys(perRun).length && existsSync(join(work, "runs")))
    for (const d of readdirSync(join(work, "runs"))) {
      const r = readJson(join(work, "runs", d, "score.json"));
      const meta = readJson(join(work, "runs", d, "meta.json"));
      const results = (meta?.results ?? []).map((f) => readJson(join(work, "runs", d, f), {}));
      if (r) perRun[d] = { category: r.category, arm: r.arm, model: r.model, usd: meta?.cost_usd ?? resultCosts(results).reduce((n, c) => n + (c ?? 0), 0) };
    }
  const by = {};
  for (const r of Object.values(perRun)) if (base[r.model] && r.usd) (by[`${r.category}/${r.arm}`] ??= []).push(r.usd / base[r.model]);
  return Object.fromEntries(Object.entries(by).map(([c, xs]) => [c, { weight: mean(xs), n: xs.length }]));
}

export function estimate({ tasks, arms, models, repeats, calibrate }) {
  const base = baseCosts();
  const cal = calibrate ? calibration(calibrate, base) : {};
  const weight = (t, arm) => cal[`${t.category}/${arm}`]?.weight ?? (t.weight ?? CATEGORY_WEIGHT[t.category] ?? 1) * (ARM_WEIGHT[arm] ?? 1);
  const perUnit = (t, m, arm) => (base[m] ?? base["claude-opus-5-5"]) * weight(t, arm);
  const byModel = {};
  for (const m of models) byModel[m] = tasks.reduce((n, t) => n + arms.reduce((k, arm) => k + perUnit(t, m, arm), 0), 0) * repeats;
  const runs = tasks.length * arms.length * models.length * repeats;
  return { base, cal, byModel, total: Object.values(byModel).reduce((x, y) => x + y, 0), runs, perUnit, tasks: tasks.length, arms: arms.length, repeats };
}

export function printEstimate(e, { todo, total, budget, spent } = {}) {
  console.log(`Estimate: ${e.tasks} tasks x ${e.arms} arms x ${e.repeats} repeats x ${Object.keys(e.byModel).length} models = ${e.runs} runs${todo != null && todo !== total ? ` (${todo} not yet done)` : ""}`);
  for (const [m, c] of Object.entries(e.byModel)) console.log(`  ${m}: base $${e.base[m]?.toFixed(4)}/run (v1) -> ~$${c.toFixed(2)}`);
  if (Object.keys(e.cal).length) console.log(`  calibrated multipliers (category/arm): ${Object.entries(e.cal).map(([c, v]) => `${c} x${v.weight.toFixed(2)} (n=${v.n})`).join(", ")}`);
  console.log(`  total ~$${e.total.toFixed(2)}${budget != null && budget !== Infinity ? `, budget $${budget}` : ""}${spent ? `, $${spent.toFixed(2)} already in the ledger` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
  const tasks = readJson(a.tasks ?? join(here, "tasks.json")).tasks;
  const models = String(a.models ?? "haiku,sonnet,opus").split(",").map((m) => MODELS[m] ?? m);
  printEstimate(estimate({ tasks, arms: String(a.arms ?? "control,drift").split(","), models, repeats: Number(a.repeats ?? 5), calibrate: a.calibrate }));
}
