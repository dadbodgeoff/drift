// The D10.2 metrics of relabel5, exactly as pre-registered in this run's README ("Pre-registration"), from the final
// labels of every shown card. Run from the checkout root, after `stage.mjs final` for every part and decide.sh:
//
//   node eval/study/runs/dev-v3-relabel5-2026-11-07/d10.mjs [--no-verifier]
//
// Writes d10-metrics.json and d10-metrics.md in the run directory. Reads, per part: views/d7/queue.json (the shown
// cards and their D7 tier), final.jsonl (labels), census-json/<repo>.json (`agents.shown_to_agents`: what the family
// table admits), the A and B label records behind each final label (followed through carried rows to the run that
// labelled the card, for the outlier verdicts), and verifier/outcomes.jsonl (the product's verifier decision).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clusterBootstrap, wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const noVerifier = process.argv.includes("--no-verifier");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const PARTS = ["ts", "py", "py2"];
const LANG = { ts: "TypeScript/JavaScript", py: "Python", py2: "Python" };
const REAL = new Set(["mistake", "look"]);

// The A and B records behind a final row, followed through carried rows. Returns {A, B, from} or null.
const recCache = new Map();
function recordsOf(dir) {
  if (recCache.has(dir)) return recCache.get(dir);
  const m = new Map();
  for (const base of [join(dir, "labels"), join(dir, "relabel", "labels")])
    for (const L of ["A", "B"]) {
      const d = join(base, L);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")))
        for (const r of readJsonl(join(d, f))) {
          if (r.rubric !== "v3") continue;
          const e = m.get(r.uid) ?? {};
          e[L] = r; // the last record for a uid wins (a record redone after the validator's message)
          m.set(r.uid, e);
        }
    }
  recCache.set(dir, m);
  return m;
}
function trace(uid, finalFile, depth = 0) {
  if (depth > 8 || !existsSync(finalFile)) return null;
  const dir = dirname(finalFile);
  const row = readJsonl(finalFile).find((r) => r.uid === uid);
  if (!row) return null;
  if (row.source === "carried" && row.carried_from) return trace(uid, resolve(root, row.carried_from), depth + 1);
  const recs = recordsOf(dir).get(uid);
  if (!recs?.A || !recs?.B) return null;
  return { A: recs.A, B: recs.B, from: dir.replace(root + "/", "") };
}

const cards = [];
const verifier = new Map(noVerifier ? [] : readJsonl(join(here, "verifier", "outcomes.jsonl")).map((o) => [o.uid, o]));
for (const part of PARTS) {
  const items = readJson(join(here, part, "views", "d7", "queue.json")).items;
  const finalFile = join(here, part, "final.jsonl");
  const final = new Map(readJsonl(finalFile).map((f) => [f.uid, f]));
  const census = new Map();
  for (const p of items) {
    if (!census.has(p.repo)) census.set(p.repo, new Map(readJson(join(here, "census-json", `${p.repo}.json`)).proposals.map((x) => [x.id, x])));
    const c = census.get(p.repo).get(p.id);
    if (!c) throw new Error(`${p.uid}: not in census-json`);
    if (c.tier !== p.tier) throw new Error(`${p.uid}: census tier ${c.tier}, D7 ${p.tier}`);
    const f = final.get(p.uid);
    const v = verifier.get(p.uid);
    cards.push({
      uid: p.uid, part, repo: p.repo, lang: LANG[part], plang: c.language, tier: p.tier, label: f?.label ?? null,
      fresh: f ? f.source !== "carried" : null,
      family_shown: c.agents?.shown_to_agents === true,
      verifier_pass: p.tier === "suggestion" && v?.pass === true,
      outliers_listed: c.outliers_total,
      recs: f ? (f.source === "carried" ? trace(p.uid, finalFile) : trace(p.uid, finalFile)) : null,
    });
  }
}

const acc = (s) => s.filter((c) => c.label === "ACCEPT").length;
const rate = (s, k = acc(s)) => {
  const w = wilson(k, s.length);
  const byRepo = new Map();
  for (const c of s) byRepo.set(c.repo, (byRepo.get(c.repo) ?? 0) + 1);
  return { k, n: s.length, rate: s.length ? k / s.length : null, wilson95: s.length ? [w.lo, w.hi] : null, repos: byRepo.size };
};
const clustered = (s, kOf) => {
  const g = new Map();
  for (const c of s) {
    const e = g.get(c.repo) ?? { k: 0, n: 0 };
    const [k, n] = kOf(c);
    e.k += k;
    e.n += n;
    g.set(c.repo, e);
  }
  const b = clusterBootstrap([...g.values()]);
  return [b.lo, b.hi, b.clusters];
};
const groups = { "TypeScript/JavaScript": (c) => c.lang === "TypeScript/JavaScript", Python: (c) => c.lang === "Python", "py (repos-py)": (c) => c.part === "py", "py2 (repos-py-2)": (c) => c.part === "py2", All: () => true,
  // secondary (not pre-registered): by the proposal's own language, as relabel4 reported Python ("Python proposals only")
  "Python proposals only (by proposal language)": (c) => c.plang === "py", "TS/JS proposals, all parts (by proposal language)": (c) => c.plang === "ts" };
const out = { run: here.replace(root + "/", ""), unlabelled: cards.filter((c) => !c.label).map((c) => c.uid), groups: {} };

for (const [g, gf] of Object.entries(groups)) {
  const s = cards.filter(gf);
  const tiers = { default: s.filter((c) => c.tier === "default"), suggestion: s.filter((c) => c.tier === "suggestion"), all: s };
  const r = { primary_accept: {}, flag_precision: {}, agent_shown: {} };
  for (const [t, ts] of Object.entries(tiers)) r.primary_accept[t] = { ...rate(ts), cluster95: clustered(ts, (c) => [c.label === "ACCEPT" ? 1 : 0, 1]) };
  // Flag precision: every A and B verdict on the outliers of shown cards.
  for (const [t, ts] of Object.entries(tiers)) {
    const withOut = ts.filter((c) => c.outliers_listed > 0);
    const traced = withOut.filter((c) => c.recs);
    const verdicts = (c, Ls = ["A", "B"]) => Ls.flatMap((L) => (c.recs?.[L]?.outliers ?? []).map((o) => o.verdict));
    const count = (cs, Ls, excludeOneOff = false) => {
      const vs = cs.flatMap((c) => verdicts(c, Ls)).filter((v) => !excludeOneOff || v !== "one_off");
      const k = vs.filter((v) => REAL.has(v)).length;
      const w = wilson(k, vs.length);
      return { k, n: vs.length, rate: vs.length ? k / vs.length : null, wilson95: vs.length ? [w.lo, w.hi] : null };
    };
    r.flag_precision[t] = {
      cards_with_outliers: withOut.length,
      cards_traced: traced.length,
      untraced: withOut.filter((c) => !c.recs).map((c) => c.uid),
      pooled_AB: { ...count(traced, ["A", "B"]), cluster95: clustered(traced, (c) => { const v = verdicts(c); return [v.filter((x) => REAL.has(x)).length, v.length]; }) },
      A: count(traced, ["A"]),
      B: count(traced, ["B"]),
      pooled_AB_without_one_off: count(traced, ["A", "B"], true),
      verdicts: Object.fromEntries(["mistake", "look", "legit", "not_violation", "one_off"].map((v) => [v, traced.flatMap((c) => verdicts(c)).filter((x) => x === v).length])),
    };
  }
  // Agent-shown precision: the default tier, plus suggestions the family table admits, plus (with the verifier on)
  // suggestions whose verifier verdict passes.
  const shipped = s.filter((c) => c.tier === "default" || c.family_shown);
  const withVer = s.filter((c) => c.tier === "default" || c.family_shown || c.verifier_pass);
  r.agent_shown = {
    with_verifier: { ...rate(withVer), default: withVer.filter((c) => c.tier === "default").length, family_admitted: withVer.filter((c) => c.tier === "suggestion" && c.family_shown).length, verifier_passed: withVer.filter((c) => c.tier === "suggestion" && !c.family_shown && c.verifier_pass).length, cluster95: clustered(withVer, (c) => [c.label === "ACCEPT" ? 1 : 0, 1]) },
    as_shipped_verify_off: { ...rate(shipped), family_admitted: shipped.filter((c) => c.tier === "suggestion").length },
  };
  out.groups[g] = r;
}
out.cards = cards.map(({ recs, ...c }) => ({ ...c, verdicts_from: recs?.from ?? null }));
writeFileSync(join(here, "d10-metrics.json"), JSON.stringify(out, null, 2) + "\n");

const pc = (x) => (x?.rate == null ? "n/a" : `${(100 * x.rate).toFixed(1)}% (${x.k}/${x.n}; Wilson ${(100 * x.wilson95[0]).toFixed(1)}-${(100 * x.wilson95[1]).toFixed(1)})`);
const L = [];
L.push("| Group | Default-tier accept | Suggestion accept | All-shown accept (primary) | Agent-shown precision (verifier on) | Agent-shown, as shipped (verify off) | Flag precision, all shown (A+B verdicts) |", "|---|---|---|---|---|---|---|");
for (const [g, r] of Object.entries(out.groups)) L.push(`| ${g} | ${pc(r.primary_accept.default)} | ${pc(r.primary_accept.suggestion)} | ${pc(r.primary_accept.all)} | ${pc(r.agent_shown.with_verifier)} | ${pc(r.agent_shown.as_shipped_verify_off)} | ${pc(r.flag_precision.all.pooled_AB)} |`);
writeFileSync(join(here, "d10-metrics.md"), L.join("\n") + "\n");
console.log(L.join("\n"));
if (out.unlabelled.length) console.log(`UNLABELLED (counted WRONG): ${out.unlabelled.length}`);
