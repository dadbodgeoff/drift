#!/usr/bin/env node
// Default-tier admission analysis on dev labels (eval/study/TIER-ADMISSION.md). Reads existing queues and
// final labels only; it labels nothing and refuses a held-out run.
//
//   node eval/study/tier-admission.mjs [--ts QUEUE:LABELS] [--py QUEUE:LABELS]
//
// QUEUE is a run's (or view's) queue.json, LABELS its final.jsonl (later lines win; unlabelled = WRONG).
// The run.json next to QUEUE gives the repo list. Defaults: the TS round-2 and Python round-2 dev runs.
// Prints, per language: precision by rule kind (all shown) and by proposal feature (rule-5 default tier);
// the fixed candidate rules; threshold rules with leave-one-repo-out cross-validation; and the
// data-driven selection procedures, cross-validated the same way.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { clusterBootstrap, clusterT, die, namesPackage, parseArgs, readJson, readJsonl, ruleKind, tierOf, wilson } from "./lib.mjs";

const RUNS = "eval/study/runs";
const args = parseArgs(process.argv.slice(2), {
  defaults: {
    ts: `${RUNS}/dev-ts-r2-2026-11-05/views/rule5/queue.json:${RUNS}/dev-ts-r2-2026-11-05/final.jsonl`,
    py: `${RUNS}/dev-py-r2-2026-11-05/views/rule5-py/queue.json:${RUNS}/dev-py-r2-2026-11-05/final.jsonl`,
  },
});
const RULE5 = readJson(`${RUNS}/dev-py-r2-2026-11-05/views/rule5/run.json`).params.tier;
const D5 = readJson(join(dirname(new URL(import.meta.url).pathname), "tier-d5.json")).tier;

function load(spec) {
  const [queue, labels] = spec.split(":");
  if (!existsSync(queue) || !existsSync(labels)) die(`missing ${queue} or ${labels}`);
  const run = readJson(join(dirname(queue), "run.json"));
  if (run.manifest?.holdout || (run.manifest?.holdout_because ?? []).length) die(`${queue}: a held-out run; this analysis is for dev runs only`);
  const L = new Map(readJsonl(labels).map((r) => [r.uid, r.label]));
  const items = readJson(queue).items.map((p) => {
    const ev = p.evidence;
    return {
      ...p,
      label: L.get(p.uid) ?? "WRONG",
      kind: ruleKind(p.rule),
      members: p.members ?? ev.total,
      support: ev.holders / ev.total,
      lb: ev.lower_bound,
      lift: ev.lift,
      nout: ev.total - ev.holders,
      ofrac: (ev.total - ev.holders) / ev.total,
      local: !namesPackage(p.rule),
      entry: p.role.entry !== "-",
      r5: tierOf(p, RULE5) === "default",
    };
  });
  const roleKey = (p) => JSON.stringify([p.repo, p.role]);
  const sib = new Map();
  for (const p of items) sib.set(roleKey(p), (sib.get(roleKey(p)) ?? 0) + 1);
  for (const p of items) p.sib = sib.get(roleKey(p));
  const repos = (run.params?.repos ?? []).map((r) => r.split("@")[0]);
  return { items, repos: repos.length ? repos : [...new Set(items.map((p) => p.repo))] };
}
const DATA = { ts: load(args.ts), py: load(args.py) };
const ALL = [...DATA.ts.items, ...DATA.py.items];

const pct = (x) => (100 * x).toFixed(0);
function rate(k, n) {
  if (!n) return "–";
  const w = wilson(k, n);
  return `${k}/${n} ${(100 * w.p).toFixed(1)}% [${pct(w.lo)}–${pct(w.hi)}]`;
}
const stats = (sel, pop) => {
  const xs = pop.filter(sel);
  return { n: xs.length, a: xs.filter((p) => p.label === "ACCEPT").length, nw: xs.filter((p) => p.label !== "WRONG").length };
};
const bucket = (v, edges, labels) => labels[edges.findIndex((e) => v < e)] ?? labels.at(-1);
const FEATURES = {
  "role size (members)": [(p) => bucket(p.members, [30, 60, 120, 300, Infinity], ["15-29", "30-59", "60-119", "120-299", "300+"]), ["15-29", "30-59", "60-119", "120-299", "300+"]],
  "support (holders/total)": [(p) => bucket(p.support, [0.85, 0.9, 0.95, 0.98, 2], ["<0.85", "0.85-0.90", "0.90-0.95", "0.95-0.98", ">=0.98"]), ["<0.85", "0.85-0.90", "0.90-0.95", "0.95-0.98", ">=0.98"]],
  "outlier count": [(p) => bucket(p.nout, [2, 4, 10, Infinity], ["1", "2-3", "4-9", "10+"]), ["1", "2-3", "4-9", "10+"]],
  "outlier fraction": [(p) => bucket(p.ofrac, [0.02, 0.05, 0.1, 0.15, 2], ["<2%", "2-5%", "5-10%", "10-15%", ">=15%"]), ["<2%", "2-5%", "5-10%", "10-15%", ">=15%"]],
  lift: [(p) => bucket(p.lift, [3, 5, 10, 20, 50, Infinity], ["<3", "3-5", "5-10", "10-20", "20-50", "50+"]), ["<3", "3-5", "5-10", "10-20", "20-50", "50+"]],
  "Wilson lower bound": [(p) => bucket(p.lb, [0.8, 0.85, 0.9, 0.95, 2], ["<0.80", "0.80-0.85", "0.85-0.90", "0.90-0.95", ">=0.95"]), ["<0.80", "0.80-0.85", "0.85-0.90", "0.90-0.95", ">=0.95"]],
  "role symbol kind": [(p) => p.role.kind + (p.role.variety ? `/${p.role.variety}` : ""), null],
  "role scope": [(p) => (p.role.file === "*" ? "dir-wide (file *)" : "file kind"), ["file kind", "dir-wide (file *)"]],
  "role is an entry point": [(p) => (p.entry ? "entry point" : "no"), ["entry point", "no"]],
  "wrapper alternatives": [(p) => ((p.rule.any_of ?? []).length > 1 ? "2+" : "1"), ["1", "2+"]],
  "shown proposals in the role": [(p) => (p.sib >= 3 ? "3+" : String(p.sib)), ["1", "2", "3+"]],
  "rule target": [(p) => (p.local ? "in repo" : "outside the repo (package, built-in, unresolved)"), ["in repo", "outside the repo (package, built-in, unresolved)"]],
};
function table(pop, f, order, name) {
  const g = new Map();
  for (const p of pop) g.set(f(p), [...(g.get(f(p)) ?? []), p]);
  const keys = order ? order.filter((k) => g.has(k)) : [...g.keys()].sort((a, b) => g.get(b).length - g.get(a).length || a.localeCompare(b));
  const out = [`| ${name} | n | A/T/W | accept | not-wrong |`, "| --- | --- | --- | --- | --- |"];
  for (const k of keys) {
    const xs = g.get(k), s = stats(() => true, xs), t = xs.filter((p) => p.label === "TRIVIAL").length;
    out.push(`| ${k} | ${s.n} | ${s.a}/${t}/${s.n - s.nw} | ${rate(s.a, s.n)} | ${rate(s.nw, s.n)} |`);
  }
  return out.join("\n");
}

const K5 = new Set(RULE5.default.rule_kinds.filter((k) => k !== "passes_key" && k !== "renders"));
const FIXED = {
  "R0 rule 5": (p) => p.r5,
  "C1 rule 5 - {passes_key, renders}": (p) => p.r5 && K5.has(p.kind),
  "C2 rule 5 + target in repo": (p) => p.r5 && p.local,
  "C3 C1 + target in repo (D5)": (p) => p.r5 && K5.has(p.kind) && p.local,
  "C4 rule 5 + entry-point role": (p) => p.r5 && p.entry,
  "C5 rule 5 + (target in repo or entry point)": (p) => p.r5 && (p.local || p.entry),
  "C6 C1 + (target in repo or entry point)": (p) => p.r5 && K5.has(p.kind) && (p.local || p.entry),
  "C9 C3 - wrapped_by:extends": (p) => p.r5 && K5.has(p.kind) && p.local && p.kind !== "wrapped_by:extends",
};
const GRIDS = {
  support: ["support", [0, 0.85, 0.9, 0.925, 0.95, 0.97, 0.98, 0.99, 1], "ge"],
  "lower bound": ["lb", [0, 0.75, 0.8, 0.85, 0.9, 0.95], "ge"],
  members: ["members", [15, 20, 30, 50, 75, 100, 150, 200, 300], "ge"],
  lift: ["lift", [0, 2, 3, 5, 8, 10, 15, 20, 30, 50], "ge"],
  outliers: ["nout", [Infinity, 20, 10, 5, 3, 2, 1], "le"],
  "outlier fraction": ["ofrac", [1, 0.15, 0.1, 0.05, 0.02], "le"],
};
// The least strict candidate whose training accept rate is >= 95%; else the most precise (ties: least strict).
function choose(cands, train) {
  let best = null;
  for (const [name, sel] of cands) {
    const s = stats(sel, train), acc = s.n ? s.a / s.n : 0;
    if (s.n && acc >= 0.95) return [name, sel];
    if (!best || acc > best[0] + 1e-12) best = [acc, name, sel];
  }
  return [best[1], best[2]];
}
// Leave one repo out: fit on the other repos (same language, or pooled over both), score the held-out repo.
function cv(fit, lang, pooled) {
  const pop = DATA[lang].items, tot = { n: 0, a: 0, nw: 0 }, picks = new Map();
  for (const r of [...new Set(pop.map((p) => p.repo))].sort()) {
    const [name, sel] = fit((pooled ? ALL : pop).filter((p) => p.repo !== r));
    picks.set(name, (picks.get(name) ?? 0) + 1);
    const s = stats(sel, pop.filter((p) => p.repo === r));
    tot.n += s.n; tot.a += s.a; tot.nw += s.nw;
  }
  return { ...tot, picks: [...picks].map(([k, v]) => `${k} ×${v}`).join(", ") };
}
// Drop a rule-5 kind whose training Wilson upper bound is below 95%; optionally keep only in-repo targets
// when that raises the training accept rate.
function kindProc(withTarget) {
  return (train) => {
    const keep = RULE5.default.rule_kinds.filter((k) => {
      const s = stats((p) => p.r5 && p.kind === k, train);
      return !s.n || wilson(s.a, s.n).hi >= 0.95;
    });
    const base = (p) => p.r5 && keep.includes(p.kind);
    const dropped = RULE5.default.rule_kinds.filter((k) => !keep.includes(k)).join(",") || "none";
    if (withTarget) {
      const loc = (p) => base(p) && p.local, s0 = stats(base, train), s1 = stats(loc, train);
      if (s1.n && s1.a / s1.n > s0.a / s0.n) return [`drop ${dropped} + in repo`, loc];
    }
    return [`drop ${dropped}`, base];
  };
}
const perRepo = (sel, lang) => {
  const c = DATA[lang].repos.map((r) => DATA[lang].items.filter((p) => p.repo === r && sel(p)).length);
  const sorted = [...c].sort((a, b) => a - b), m = sorted.length;
  const median = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
  return `${(c.reduce((a, b) => a + b, 0) / m).toFixed(1)} / ${median} / ${c.filter((x) => !x).length} of ${m}`;
};

const out = ["# Default-tier admission analysis (dev labels)", ""];
for (const lang of ["ts", "py"]) {
  const { items } = DATA[lang], r5 = items.filter((p) => p.r5), base = stats((p) => p.r5, items).a;
  out.push(`## ${lang === "ts" ? "TypeScript/JavaScript" : "Python"}: ${items.length} shown, ${r5.length} in the rule-5 default tier`, "");
  out.push("### Rule kind (all shown)", "", table(items, (p) => p.kind ?? "(none)", null, "rule kind"), "");
  out.push("### Features (rule-5 default tier)", "");
  for (const [name, [f, order]] of Object.entries(FEATURES)) out.push(table(r5, f, order, name), "");
  out.push("### Fixed candidate rules (no fitted parameter: in-sample = cross-validated)", "");
  out.push("| rule | default n | accept | repo-cluster bootstrap / cluster-t | not-wrong | accepts moved to suggestion | per repo: mean / median / empty |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, sel] of Object.entries(FIXED)) {
    const s = stats(sel, items);
    const cl = DATA[lang].repos.map((r) => { const c = stats((p) => p.repo === r && sel(p), items); return { k: c.a, n: c.n }; });
    const iv = (x) => (Number.isNaN(x.lo) ? "–" : `${pct(x.lo)}–${pct(x.hi)}`);
    out.push(`| ${name} | ${s.n} | ${rate(s.a, s.n)} | ${iv(clusterBootstrap(cl))} / ${iv(clusterT(cl))} (${cl.filter((c) => c.n).length} repos) | ${rate(s.nw, s.n)} | ${base - s.a} | ${perRepo(sel, lang)} |`);
  }
  out.push("", "### Threshold rules: in-sample by threshold, and leave-one-repo-out cross-validated", "");
  out.push("| base + feature | in-sample (threshold: accept/n) | CV, same-language training | CV, pooled training |", "| --- | --- | --- | --- |");
  for (const b of ["R0 rule 5", "C2 rule 5 + target in repo", "C3 C1 + target in repo (D5)"])
    for (const [g, [feat, grid, op]] of Object.entries(GRIDS)) {
      const cands = grid.map((t) => [`${op === "ge" ? "≥" : "≤"}${t}`, (p) => FIXED[b](p) && (op === "ge" ? p[feat] >= t : p[feat] <= t)]);
      const ins = cands.map(([nm, sel]) => { const s = stats(sel, items); return `${nm}: ${s.a}/${s.n}`; }).join("; ");
      const cell = (pooled) => { const c = cv((tr) => choose(cands, tr), lang, pooled); return `${rate(c.a, c.n)}, moved ${base - c.a} (${c.picks})`; };
      out.push(`| ${b} + ${g} | ${ins} | ${cell(false)} | ${cell(true)} |`);
    }
  out.push("", "### Selection procedures, leave-one-repo-out cross-validated", "");
  out.push("| procedure | CV, same-language training | CV, pooled training |", "| --- | --- | --- |");
  const sel = Object.entries(FIXED).filter(([k]) => !k.startsWith("C9"));
  const procs = {
    "drop rule-5 kinds whose Wilson upper bound < 95%": kindProc(false),
    "the same, then keep in-repo targets if that helps": kindProc(true),
    "pick the least strict fixed candidate R0–C6 with training accept ≥ 95%": (tr) => choose(sel.sort(([, a], [, b]) => stats(b, tr).n - stats(a, tr).n), tr),
  };
  for (const [name, fit] of Object.entries(procs)) {
    const cell = (pooled) => { const c = cv(fit, lang, pooled); return `${rate(c.a, c.n)}, moved ${base - c.a} (${c.picks})`; };
    out.push(`| ${name} | ${cell(false)} | ${cell(true)} |`);
  }
  out.push("");
}
const d5 = (lang) => stats((p) => tierOf(p, D5) === "default", DATA[lang].items);
out.push(`Check: tierOf under tier-d5.json gives TS ${rate(d5("ts").a, d5("ts").n)}, Python ${rate(d5("py").a, d5("py").n)} (= C3).`);
console.log(out.join("\n"));
