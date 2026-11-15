// The dev4 report (WS-E, eval/study/PREREG-F11-dev4-check.md): the pre-registered measures from both dev4 runs'
// metrics.json, final labels and A/B label records, and the dev4-check verdict per condition (PLAN-R11 section 4.2).
// Adapted from runs/dev3-ts-2026-11-08/dev3-check.mjs. Names repos by key only.
//
//   node eval/study/runs/dev4-ts-2026-11-09/dev4-check.mjs [--json OUT] > dev4-check.md
//
// Differences from dev3-check: the TS final labels are final-all.jsonl (adjudicate.mjs --merge's final.jsonl plus the
// blind-C repo's rows, lead's cap rule, run README); condition (b) needs >= 10 shown Python cards (opt-in view); the
// in-sample figures are the build set at F11 (PREREG section 1); yield counts a failed repo as zero (PREREG measure 5);
// the default-tier flag precision row (measure 8), the Python default view (measure 9) and agent exposure (measure 10)
// are added.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { proposalLanguageGroup, readJsonl, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUNS = { ts: here, py: join(here, "..", "dev4-py-2026-11-09") };
const FINAL = { ts: "final-all.jsonl", py: "final.jsonl" };
const json = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "n/a");
const rate = (w) => (w && w.n ? `${pct(w.p)} (${w.k}/${w.n}); Wilson [${pct(w.lo)}, ${pct(w.hi)}]${w.boot ? `; cluster boot [${pct(w.boot.lo)}, ${pct(w.boot.hi)}], t [${pct(w.t?.lo)}, ${pct(w.t?.hi)}] over ${w.boot.clusters} repos` : ""}` : "n = 0");
// PREREG-F11 section 1: the build set at F11 (folds 1-4 and dev3), per-card accept over all shown.
const IN_SAMPLE = { "typescript/javascript": { p: 50 / 58, text: "86.2% (50/58)" }, python: { p: 13 / 14, text: "92.9% (13/14)" } };
const MIN_PY = 10; // PLAN-R11 section 4.2 (b): >= 10 shown Python cards

const out = { languages: {}, conditions: {}, flag_precision: {}, wrong_causes: {}, unlabelled: 0 };
const lines = ["# dev4 report: the pre-registered measures and the dev4-check", "", "Rates are over all shown cards, unlabelled counted as WRONG (eval/study/PREREG-F11-dev4-check.md). Python: the opt-in view. Repos by key only.", ""];

// 1. Rates per language, from each run's metrics.json (each language must come from one run only).
for (const [part, dir] of Object.entries(RUNS)) {
  const m = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8"));
  for (const l of m.by_language) {
    if (!l.overall.shown && part !== { "typescript/javascript": "ts", python: "py" }[l.language]) continue; // a language this run's repos show no card in
    if (out.languages[l.language]) throw new Error(`${l.language} has cards in both runs: pool them by hand`);
    out.languages[l.language] = { run: part, repos: l.repos?.length ?? l.repos, overall: l.overall, default_tier: l.default_tier, suggestion_tier: l.suggestion_tier };
  }
}
// 2. Flag precision: (mistake + look) / all per-outlier verdicts of the A and B records, per language and tier.
const REAL = new Set(["mistake", "look"]);
for (const [part, dir] of Object.entries(RUNS)) {
  const q = JSON.parse(readFileSync(join(dir, "queue.json"), "utf8")).items;
  const byUid = new Map(q.map((p) => [p.uid, p]));
  for (const L of ["A", "B"]) {
    const d = join(dir, "labels", L);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")))
      for (const r of readJsonl(join(d, f))) {
        const p = byUid.get(r.uid);
        if (!p) continue;
        for (const k of [`${proposalLanguageGroup(p)} ${p.tier}`, `${proposalLanguageGroup(p)} all`]) {
          const a = (out.flag_precision[k] ??= { real: 0, n: 0, repos: {} });
          for (const o of r.outliers ?? []) {
            a.n++;
            if (REAL.has(o.verdict)) a.real++;
            a.repos[p.repo] ??= [0, 0];
            a.repos[p.repo][1]++;
            if (REAL.has(o.verdict)) a.repos[p.repo][0]++;
          }
        }
      }
  }
  // 3. WRONG causes and unlabelled, from final.jsonl.
  const fin = new Map(readJsonl(join(dir, FINAL[part])).map((r) => [r.uid, r]));
  for (const p of q) {
    const r = fin.get(p.uid);
    const lang = proposalLanguageGroup(p);
    out.wrong_causes[lang] ??= {};
    if (!r?.label) {
      out.unlabelled++;
      out.wrong_causes[lang].unlabelled = (out.wrong_causes[lang].unlabelled ?? 0) + 1;
    } else if (r.label === "WRONG") out.wrong_causes[lang][r.wrong_because ?? "(none given)"] = (out.wrong_causes[lang][r.wrong_because ?? "(none given)"] ?? 0) + 1;
  }
}
// 4. The conditions (point estimates, strict).
const ts = out.languages["typescript/javascript"];
const py = out.languages.python;
const d1 = ts?.default_tier?.accept_shown;
out.conditions.a = { rule: "TS default-tier accept >= 90% with >= 8 default-tier cards", n: d1?.n ?? 0, p: d1?.p ?? null, met: Boolean(d1 && d1.n >= 8 && d1.p >= 0.9) };
out.conditions.b = {
  rule: "not-wrong >= 70% per language (TS over all shown; Python over the opt-in view, with >= 10 shown Python cards)",
  by_language: Object.fromEntries(["typescript/javascript", "python"].map((l) => { const w = out.languages[l]?.overall?.not_wrong_shown; const minN = l === "python" ? MIN_PY : 1; return [l, { n: w?.n ?? 0, p: w?.p ?? null, min_n: minN, evaluable: (w?.n ?? 0) >= minN, met: Boolean(w?.n && w.n >= minN && w.p >= 0.7) }]; })),
};
out.conditions.b.met = Object.values(out.conditions.b.by_language).every((x) => x.met);
out.conditions.c = {
  rule: "|dev4 per-card accept (all shown) - build-set in-sample at F11| <= 10 points, per language",
  by_language: Object.fromEntries(["typescript/javascript", "python"].map((l) => { const w = out.languages[l]?.overall?.accept_shown; const diff = w?.n ? 100 * (w.p - IN_SAMPLE[l].p) : null; return [l, { n: w?.n ?? 0, p: w?.p ?? null, in_sample: IN_SAMPLE[l].text, diff_points: diff, met: diff !== null && Math.abs(diff) <= 10 + 1e-9 }]; })),
};
out.conditions.c.met = Object.values(out.conditions.c.by_language).every((x) => x.met);
out.passes = out.conditions.a.met && out.conditions.b.met && out.conditions.c.met;

for (const [lang, L] of Object.entries(out.languages)) {
  lines.push(`## ${lang} (${L.repos} repos)`, "");
  lines.push(`- D1 / default-tier accept: ${rate(L.default_tier.accept_shown)}`);
  lines.push(`- Suggestion-tier accept: ${rate(L.suggestion_tier.accept_shown)}`);
  lines.push(`- Per-card accept, all shown: ${rate(L.overall.accept_shown)}`);
  lines.push(`- D4 / not-wrong, all shown: ${rate(L.overall.not_wrong_shown)}`);
  lines.push(`- Default-tier not-wrong: ${rate(L.default_tier.not_wrong_shown)}; suggestion-tier not-wrong: ${rate(L.suggestion_tier.not_wrong_shown)}`);
  const y = L.overall.yield;
  // PREREG measure 5: a failed repo counts as zero (metrics.mjs counts only the repos censused ok).
  const run = JSON.parse(readFileSync(join(RUNS[L.run], "run.json"), "utf8"));
  const all = run.repos.length, failed = run.repos.filter((r) => r.status !== "ok").length;
  L.yield_all = { repos: all, failed, accepted: y.total, mean: y.total / all, zero: y.zero + failed, shown_per_repo: L.overall.shown / all };
  lines.push(`- Yield: ${y.total} accepted over ${all} repos (${failed} failed census, counted as zero), mean ${(y.total / all).toFixed(2)}, median ${y.median}, ${y.zero + failed} repos with none; shown ${L.overall.shown} (${(L.overall.shown / all).toFixed(2)} per repo)`);
  lines.push(`- WRONG causes: ${JSON.stringify(out.wrong_causes[lang] ?? {})}`, "");
}
lines.push("## Flag precision ((mistake + look) / all per-outlier verdicts, A and B)", "");
for (const [k, a] of Object.entries(out.flag_precision).sort()) {
  const rr = Object.values(a.repos).map(([r, n]) => r / n);
  a.wilson = wilson(a.real, a.n);
  lines.push(`- ${k}: ${a.n ? `${pct(a.real / a.n)} (${a.real}/${a.n}); Wilson [${pct(a.wilson.lo)}, ${pct(a.wilson.hi)}]; ${rr.length} repos, range ${pct(Math.min(...rr))}–${pct(Math.max(...rr))}` : "no verdicts"}`);
}
// Measure 9: the Python default view (proposals off). Measure 10: agent exposure, from each repo's census JSON at F11.
const dv = JSON.parse(readFileSync(join(RUNS.py, "default-view.json"), "utf8"));
out.python_default_view = { repos: dv.repos.length, shown: dv.total };
out.agent_exposure = {};
for (const [part, dir] of Object.entries(RUNS)) {
  const d = join(dir, "census-json");
  let n = 0, unvetted = 0;
  for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) for (const p of JSON.parse(readFileSync(join(d, f), "utf8")).proposals) { n++; if (p.agents?.shown_to_agents === true) unvetted++; }
  out.agent_exposure[part] = { shown: n, shown_to_agents_unvetted: unvetted };
}
lines.push("", `## Python default view and agent exposure`, "");
lines.push(`- Python default census (proposals off): ${dv.total} shown cards over ${dv.repos.length} repos.`);
for (const [p, x] of Object.entries(out.agent_exposure)) lines.push(`- Agent exposure, ${p}: ${x.shown_to_agents_unvetted} of ${x.shown} shown cards reach agents without a person's accept.`);
lines.push(`- Default-tier flag precision beside it (no verdict): dev3 at F10 31.3% (5/16).`);
lines.push("", "## The dev4-check (PLAN-R11 section 4.2 (2))", "");
const v = (b) => (b ? "MET" : "NOT MET");
lines.push(`- (a) ${out.conditions.a.rule}: ${pct(out.conditions.a.p)} with ${out.conditions.a.n} cards: **${v(out.conditions.a.met)}**`);
for (const [l, x] of Object.entries(out.conditions.b.by_language)) lines.push(`- (b) not-wrong, ${l}: ${x.n ? pct(x.p) : "no shown card"} (n = ${x.n}${x.min_n > 1 ? `, needs >= ${x.min_n}` : ""})${x.evaluable ? "" : ": not evaluable (n below the minimum)"}: **${v(x.met)}**`);
for (const [l, x] of Object.entries(out.conditions.c.by_language)) lines.push(`- (c) ${l}: dev4 ${x.n ? pct(x.p) : "no shown card"} (n = ${x.n}) vs in-sample ${x.in_sample}: ${x.diff_points === null ? "no estimate" : `${x.diff_points >= 0 ? "+" : ""}${x.diff_points.toFixed(1)} points`}: **${v(x.met)}**`);
lines.push(`- Beside them, no verdict: the undo-named and dev-v3 readings were not recomputed at F11 for this report.`);
lines.push("", `**dev4-check: ${out.passes ? "PASSES" : "FAILS"}** (all three conditions must hold, for both languages).`, "", `Unlabelled cards: ${out.unlabelled}.`);
console.log(lines.join("\n"));
if (json) writeFileSync(json, JSON.stringify(out, null, 2) + "\n");
