// The dev3 report (WS-F, eval/study/PREREG-F10-dev3-check.md): the pre-registered measures from both dev3 runs'
// metrics.json, final.jsonl and A/B label records, and the D12 dev3-check verdict per condition. Names repos by key only.
//
//   node eval/study/runs/dev3-ts-2026-11-08/dev3-check.mjs [--json OUT] > dev3-check.md
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { proposalLanguageGroup, readJsonl, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUNS = { ts: here, py: join(here, "..", "dev3-py-2026-11-08") };
const json = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "n/a");
const rate = (w) => (w && w.n ? `${pct(w.p)} (${w.k}/${w.n}); Wilson [${pct(w.lo)}, ${pct(w.hi)}]${w.boot ? `; cluster boot [${pct(w.boot.lo)}, ${pct(w.boot.hi)}], t [${pct(w.t?.lo)}, ${pct(w.t?.hi)}] over ${w.boot.clusters} repos` : ""}` : "n = 0");
const IN_SAMPLE = { "typescript/javascript": { p: 43 / 46, text: "93.5% (43/46)" }, python: { p: 12 / 12, text: "100% (12/12)" } };

const out = { languages: {}, conditions: {}, flag_precision: {}, wrong_causes: {}, unlabelled: 0 };
const lines = ["# dev3 report: the pre-registered measures and the D12 dev3-check", "", "Rates are over all shown cards, unlabelled counted as WRONG (eval/study/PREREG-F10-dev3-check.md). Repos by key only.", ""];

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
  const fin = new Map(readJsonl(join(dir, "final.jsonl")).map((r) => [r.uid, r]));
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
  rule: "not-wrong >= 70% per language",
  by_language: Object.fromEntries(["typescript/javascript", "python"].map((l) => { const w = out.languages[l]?.overall?.not_wrong_shown; return [l, { n: w?.n ?? 0, p: w?.p ?? null, met: Boolean(w?.n && w.p >= 0.7) }]; })),
};
out.conditions.b.met = Object.values(out.conditions.b.by_language).every((x) => x.met);
out.conditions.c = {
  rule: "|dev3 per-card accept (all shown) - build-set in-sample| <= 10 points, per language",
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
  lines.push(`- Yield: ${y.total} accepted over ${y.repos} repos, mean ${y.mean.toFixed(2)}, median ${y.median}, ${y.zero} repos with none; shown ${L.overall.shown} (${(L.overall.shown / y.repos).toFixed(2)} per repo)`);
  lines.push(`- WRONG causes: ${JSON.stringify(out.wrong_causes[lang] ?? {})}`, "");
}
lines.push("## Flag precision ((mistake + look) / all per-outlier verdicts, A and B)", "");
for (const [k, a] of Object.entries(out.flag_precision).sort()) {
  const rr = Object.values(a.repos).map(([r, n]) => r / n);
  a.wilson = wilson(a.real, a.n);
  lines.push(`- ${k}: ${a.n ? `${pct(a.real / a.n)} (${a.real}/${a.n}); Wilson [${pct(a.wilson.lo)}, ${pct(a.wilson.hi)}]; ${rr.length} repos, range ${pct(Math.min(...rr))}–${pct(Math.max(...rr))}` : "no verdicts"}`);
}
lines.push("", "## The D12 dev3-check (PLAN-R10 section 3.4, condition 2)", "");
const v = (b) => (b ? "MET" : "NOT MET");
lines.push(`- (a) ${out.conditions.a.rule}: ${pct(out.conditions.a.p)} with ${out.conditions.a.n} cards: **${v(out.conditions.a.met)}**`);
for (const [l, x] of Object.entries(out.conditions.b.by_language)) lines.push(`- (b) not-wrong, ${l}: ${x.n ? pct(x.p) : "no shown card"} (n = ${x.n}): **${v(x.met)}**`);
for (const [l, x] of Object.entries(out.conditions.c.by_language)) lines.push(`- (c) ${l}: dev3 ${x.n ? pct(x.p) : "no shown card"} (n = ${x.n}) vs in-sample ${x.in_sample}: ${x.diff_points === null ? "no estimate" : `${x.diff_points >= 0 ? "+" : ""}${x.diff_points.toFixed(1)} points`}: **${v(x.met)}**`);
lines.push(`- Beside them, no verdict: undo-named TS 63.6%, Python 88.9%; dev-v3 TS 69.2%, Python 85.7% (#129).`);
lines.push("", `**dev3-check: ${out.passes ? "PASSES" : "FAILS"}** (all three conditions must hold).`, "", `Unlabelled cards: ${out.unlabelled}.`);
console.log(lines.join("\n"));
if (json) writeFileSync(json, JSON.stringify(out, null, 2) + "\n");
