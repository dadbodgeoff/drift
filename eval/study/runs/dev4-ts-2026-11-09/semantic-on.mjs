// The semantic-on arm (PREREG-F11 section 6): the dev4 cards and final labels, filtered through harness v1's outcomes
// (semantic-on/<key>/outcomes.jsonl, frozen prompt sem-v1 and model, 3 samples, run on the payloads harness v1 built at
// F11). Gates nothing. Names repos by key only.
//
//   node eval/study/runs/dev4-ts-2026-11-09/semantic-on.mjs [--json OUT] > semantic-on.md
//
// - A card the check does not admit (card_pass false) is dropped from the arm; a flag it sets apart is dropped from the
//   arm's flag verdicts.
// - Flags join the A and B per-outlier verdicts by unit: a symbol-unit flag (path#symbol) matches a verdict naming that
//   symbol when it is unique among the card's flagged members, or naming path#symbol; a file-unit flag (path#(file))
//   matches a verdict naming the same repo-relative path (./ and a trailing / removed, case kept).
// - A kept flag that matches no verdict counts as not correct [STRICT], once per labeller record of the card.
// - EXPLORATORY, not pre-registered (no verdict): labellers often name a file-unit outlier by a path relative to its
//   package or by a shorter tail of it. The suffix reading also matches a file-unit flag to a verdict whose path is a
//   '/'-aligned tail of the flag's path, when that tail is unique among the card's flagged paths.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { proposalLanguageGroup, readJsonl, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUNS = { ts: { dir: here, final: "final-all.jsonl" }, py: { dir: join(here, "..", "dev4-py-2026-11-09"), final: "final.jsonl" } };
const REAL = new Set(["mistake", "look"]);
const json = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1)}% (${k}/${n})` : "n = 0");
const wil = (k, n) => (n ? (({ lo, hi }) => ` Wilson [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]`)(wilson(k, n)) : "");
const norm = (p) => String(p ?? "").replace(/^\.\//, "").replace(/\/+$/, "");

const outcomes = new Map();
for (const k of readdirSync(join(here, "semantic-on")).filter((x) => existsSync(join(here, "semantic-on", x, "outcomes.jsonl"))))
  for (const o of readJsonl(join(here, "semantic-on", k, "outcomes.jsonl"))) outcomes.set(o.uid, o);

const out = { languages: {}, errors: 0 };
for (const reading of ["prereg", "suffix"]) {
for (const [part, { dir, final }] of Object.entries(RUNS)) {
  const q = JSON.parse(readFileSync(join(dir, "queue.json"), "utf8")).items;
  const runRepos = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).repos.length;
  const fin = new Map(readJsonl(join(dir, final)).map((r) => [r.uid, r]));
  const recs = [];
  for (const L of ["A", "B"]) {
    const d = join(dir, "labels", L);
    if (existsSync(d)) for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl"))) for (const r of readJsonl(join(d, f))) recs.push({ L, ...r });
  }
  for (const p of q) {
    const lang = proposalLanguageGroup(p);
    const S = ((out.languages[reading] ??= {})[lang] ??= { repos: runRepos, cards: 0, passed: 0, dropped: [], cand: { shipped: [0, 0], arm: [0, 0] }, notwrong: { shipped: [0, 0], arm: [0, 0] }, accepted: { shipped: 0, arm: 0 }, flags: {}, unmatched: { file: 0, symbol: 0 } });
    const o = outcomes.get(p.uid);
    const label = fin.get(p.uid)?.label ?? "UNLABELLED";
    const acc = label === "ACCEPT", nw = acc || label === "TRIVIAL";
    S.cards++;
    if (!o || o.error) { out.errors++; continue; }
    const pass = o.card_pass === true;
    if (p.tier === "default") { S.cand.shipped[1]++; if (acc) S.cand.shipped[0]++; if (pass) { S.cand.arm[1]++; if (acc) S.cand.arm[0]++; } }
    S.notwrong.shipped[1]++; if (nw) S.notwrong.shipped[0]++;
    if (acc) S.accepted.shipped++;
    if (pass) { S.passed++; S.notwrong.arm[1]++; if (nw) S.notwrong.arm[0]++; if (acc) S.accepted.arm++; } else S.dropped.push({ tier: p.tier, label });
    // flags: per labeller record of this card
    const apart = new Set(o.set_apart);
    const flagged = o.members.filter((m) => m.flagged);
    const syms = flagged.map((m) => m.member.split("#").pop());
    for (const r of recs.filter((x) => x.uid === p.uid)) {
      for (const m of flagged) {
        const [path, sym] = [m.member.slice(0, m.member.lastIndexOf("#")), m.member.split("#").pop()];
        const fileUnit = sym === "(file)";
        const tail = (x, full) => { const t = norm(x); return t && (full === t || full.endsWith("/" + t)); };
        const paths = flagged.map((y) => y.member.slice(0, y.member.lastIndexOf("#")));
        const fileMatch = (x) => norm(x.symbol) === norm(path) || norm(x.path) === norm(path) || (reading === "suffix" && [x.symbol, x.path].some((t) => tail(t, path) && paths.filter((q) => tail(t, q)).length === 1));
        const v = (r.outliers ?? []).find((x) => (fileUnit ? fileMatch(x) : x.symbol === m.member || (x.symbol === sym && syms.filter((s) => s === sym).length === 1)));
        if (!v) S.unmatched[fileUnit ? "file" : "symbol"]++;
        const real = Boolean(v && REAL.has(v.verdict));
        for (const key of [`${p.tier}`, "all"]) {
          const F = (S.flags[key] ??= { shipped: [0, 0], kept: [0, 0], dropped: [0, 0] });
          F.shipped[1]++; if (real) F.shipped[0]++;
          const side = apart.has(m.member) ? F.dropped : F.kept;
          side[1]++; if (real) side[0]++;
        }
      }
    }
  }
}
}
const lines = ["# dev4 semantic-on arm (PREREG-F11 section 6; gates nothing)", "", "Harness v1, prompt sem-v1 (sha256 `95ec1162366a…`), the frozen model, 3 samples per card. Rates over the arm's cards, unlabelled counted as WRONG; each beside the shipped default on the same cards. Repos by key only.", ""];
for (const [lang, S] of Object.entries(out.languages.prereg)) {
  const X = out.languages.suffix[lang];
  lines.push(`## ${lang}`, "", `- Cards: ${S.cards}; admitted by the check: ${S.passed}; dropped: ${S.dropped.length} (${JSON.stringify(S.dropped.reduce((a, d) => ((a[`${d.tier}:${d.label}`] = (a[`${d.tier}:${d.label}`] ?? 0) + 1), a), {}))}).`);
  lines.push(`- Candidate (default-tier) accept among the cards that pass: ${pct(...S.cand.arm)}${wil(...S.cand.arm)}; shipped default ${pct(...S.cand.shipped)}.`);
  for (const [k, F] of Object.entries(S.flags).sort()) lines.push(`- Flag precision, ${k} tier${k === "all" ? "s" : ""}: kept flags ${pct(...F.kept)}${wil(...F.kept)}; dropped flags ${pct(...F.dropped)}; shipped (all flags) ${pct(...F.shipped)}.`);
  lines.push(`- Unmatched flag verdicts (counted as not correct): file-unit ${S.unmatched.file}, symbol-unit ${S.unmatched.symbol}.`);
  lines.push(`- Exploratory, no verdict (suffix reading for file-unit names): kept flags ${pct(...X.flags.all.kept)}, default tier kept ${pct(...(X.flags.default?.kept ?? [0, 0]))}; dropped ${pct(...X.flags.all.dropped)}; shipped ${pct(...X.flags.all.shipped)}; still unmatched: file-unit ${X.unmatched.file}.`);
  lines.push(`- D4 / not-wrong over the arm's cards: ${pct(...S.notwrong.arm)}${wil(...S.notwrong.arm)}; shipped ${pct(...S.notwrong.shipped)}.`);
  lines.push(`- Yield: ${S.accepted.arm} accepted over ${S.repos} repos (${(S.accepted.arm / S.repos).toFixed(2)} per repo), ${S.passed} shown (${(S.passed / S.repos).toFixed(2)} per repo); shipped ${S.accepted.shipped} accepted (${(S.accepted.shipped / S.repos).toFixed(2)}), ${S.cards} shown.`, "");
}
lines.push(`Cards without an outcome: ${out.errors}.`);
console.log(lines.join("\n"));
if (json) writeFileSync(json, JSON.stringify(out, null, 2) + "\n");
