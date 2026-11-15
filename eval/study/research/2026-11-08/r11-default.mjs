#!/usr/bin/env node
// Round-11 planning analysis (eval/study/PLAN-R11.md): why the TS default tier is 30/30 in sample and about half out
// of sample, what each product option does, and how large dev4 must be.
//
//   node eval/study/research/2026-11-08/r11-default.mjs [--json out.json]
//
// Reads only build-set data: the dev label snapshots (dev-v3 .. relabel5), the round 4-9 PR mentions, the committed
// show table, and the dev3 run (eval/study/runs/dev3-*), which joined the build set after its report (#132). It never
// opens a held-out manifest, run or scratch. The out-of-sample default-tier counts of the two held-out runs are the
// lead's aggregates (HELDOUT_AGG below), typed in; nothing else about those runs is used.
//
// Since round 11 (WS-A) the readings it rests on are generalise.mjs's, tested there (generalise.test.mjs): the dev3
// cards and verdicts (loadDev3, fold 5 of folds-r11.json), the per-outlier verdicts followed through carried rows
// (verdictsOf), the default tier per fold (defaultTier) and the committed show table (the show-table policy). Its
// output is unchanged (r11-default.out.txt).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { POLICIES, defaultTier, loadAll, namedSet, isA, pct, verdictsOf, UNDO } from "../../generalise.mjs";
import { wilson } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const RUNS = join(root, "eval/study/runs");
const out = {};
const lines = [];
const log = (s = "") => lines.push(s);
const readJsonl = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const wil = (k, n) => { const w = wilson(k, n); return n ? `${pct(k, n)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]` : "n = 0"; };

// The lead's held-out aggregates (TS default tier, ACCEPT / shown). Counts only.
const HELDOUT_AGG = [
  { run: "heldout1 (#111)", accept: 5, shown: 7 },
  { run: "heldout2 (#123)", accept: 1, shown: 3 },
];

// ---------- inputs ----------
const { folds, snaps, dev3: dev3snap, prs } = loadAll(root);
const named = namedSet(prs, UNDO.rounds);
// Raw queue items per snapshot (for summaries and rule kinds), keyed by uid.
const rawItems = (run, parts) => {
  const m = new Map();
  for (const p of parts) for (const it of JSON.parse(readFileSync(join(RUNS, run, p, "views/d7/queue.json"), "utf8")).items) m.set(it.uid, it);
  return m;
};
const raw = Object.fromEntries(Object.entries(snaps).map(([k, s]) => [k, rawItems(s.run, s.parts)]));

// dev3 (build set since #132, fold 5): shown cards = the F10 census (the show policy already applied).
const DEV3 = { ts: "dev3-ts-2026-11-08", py: "dev3-py-2026-11-08" };
const dev3 = { ts: [], py: [] };
for (const [lang, run] of Object.entries(DEV3)) {
  const dir = join(RUNS, run);
  const q = new Map(JSON.parse(readFileSync(join(dir, "queue.json"), "utf8")).items.map((it) => [it.uid, it]));
  for (const c of dev3snap.cards.values()) if (c.lang === lang) dev3[lang].push({ ...c, summary: q.get(c.uid).summary, fold: 5 });
  out[`dev3_${lang}_repos`] = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).repos.length;
}

const REAL = new Set(["mistake", "look"]);
const cardVerdicts = (s, c) => verdictsOf(s ?? dev3snap, c);

// The wrapper a call-wrapper card names, classed by name (a heuristic, printed per card so it can be audited):
// "security" when a wrapper's name says authentication, session, permission or tenant scope.
const SECURITY_NAME = /auth|session|workspace|protected|permission|admin|partnerprofile|verify|guard|tenant/i;
const wrapperClass = (c, summary) => {
  if (c.family === "layering") return "layering";
  if (c.family !== "wrapper") return c.family;
  const names = [...String(summary).matchAll(/([A-Za-z_$][\w$.]*)\(\)/g)].map((m) => m[1]);
  return names.some((n) => SECURITY_NAME.test(n)) ? "security_wrapper" : "other_wrapper";
};
const summaryOf = (key, c) => (key === "dev3" ? c.summary : raw[key].get(c.uid)?.summary ?? "");

const tsDefault = (key) => (key === "dev3" ? dev3.ts : [...snaps[key].cards.values()].filter((c) => c.lang === "ts")).filter((c) => c.tier === "default");
const KEYS = ["v3", "r2", "r3", "r4", "r5", "dev3"];
const NAME = { v3: "dev-v3 (round 3)", r2: "relabel2 (round 4)", r3: "relabel3 (round 5)", r4: "relabel4 (round 6)", r5: "relabel5 (round 9)", dev3: "dev3 at F10 (blind)" };
const count = (cs, f) => cs.filter(f).length;
const causes = (cs) => {
  const o = {};
  for (const c of cs) if (c.label !== "ACCEPT") { const k = c.label === "WRONG" ? `WRONG/${c.why}` : c.label; o[k] = (o[k] ?? 0) + 1; }
  return o;
};

// ---------- §1 the default tier at every snapshot ----------
log("# r11-default: the TS default tier in sample and out of sample (build-set data; held-out = lead's aggregates)");
log("\n## 1. TS default tier, ACCEPT / shown, by snapshot (Wilson 95%)");
out.s1 = {};
for (const k of KEYS) {
  const d = tsDefault(k);
  const repos = new Set(d.map((c) => c.repo));
  const fam = (f) => d.filter((c) => c.family === f);
  out.s1[k] = { shown: d.length, accept: count(d, isA), repos: repos.size, causes: causes(d), wrapper: [count(fam("wrapper"), isA), fam("wrapper").length], layering: [count(fam("layering"), isA), fam("layering").length] };
  log(`${NAME[k]}: ${wil(count(d, isA), d.length)} over ${repos.size} repos; wrappers ${pct(...out.s1[k].wrapper)}, layering ${pct(...out.s1[k].layering)}; not accepted: ${JSON.stringify(causes(d))}`);
}
{
  const ho = HELDOUT_AGG.reduce((s, h) => ({ a: s.a + h.accept, n: s.n + h.shown }), { a: 0, n: 0 });
  const d3 = out.s1.dev3;
  for (const h of HELDOUT_AGG) log(`${h.run} (lead's aggregate): ${wil(h.accept, h.shown)}`);
  log(`pooled out of sample (heldout1 + heldout2 + dev3): ${wil(ho.a + d3.accept, ho.n + d3.shown)}`);
  out.s1.pooled_oos = { accept: ho.a + d3.accept, shown: ho.n + d3.shown };
  const v3 = out.s1.v3, r5 = out.s1.r5;
  log(`gaps: in-sample relabel5 ${pct(r5.accept, r5.shown)} -> undo-named/dev-v3 ${pct(v3.accept, v3.shown)} -> pooled out of sample ${pct(ho.a + d3.accept, ho.n + d3.shown)}`);
}

// ---------- §2 flag precision of the default tier ----------
log("\n## 2. TS default tier: flag precision ((mistake + look) / A and B per-outlier verdicts) and the cards whose flags are mostly not real");
out.s2 = {};
for (const k of KEYS) {
  const s = k === "dev3" ? null : snaps[k];
  let real = 0, n = 0, traced = 0;
  const bands = { none_real: [0, 0], under_half: [0, 0], half_plus: [0, 0], no_outliers: [0, 0] };
  for (const c of tsDefault(k)) {
    const v = cardVerdicts(s, c);
    if (c.outliers === 0) { bands.no_outliers[1]++; if (isA(c)) bands.no_outliers[0]++; }
    if (!v) continue;
    traced++;
    const r = v.filter((x) => REAL.has(x)).length;
    real += r; n += v.length;
    if (!v.length) continue;
    const b = r === 0 ? "none_real" : r / v.length < 0.5 ? "under_half" : "half_plus";
    bands[b][1]++; if (isA(c)) bands[b][0]++;
  }
  out.s2[k] = { real, n, traced, cards: tsDefault(k).length, bands };
  log(`${NAME[k]}: flag precision ${wil(real, n)} (verdicts traced for ${traced} of ${tsDefault(k).length} cards); card accept by real share: 0 real ${pct(...bands.none_real)}, <50% ${pct(...bands.under_half)}, >=50% ${pct(...bands.half_plus)}; cards with 0 outliers ${pct(...bands.no_outliers)}`);
}

// ---------- §3 selection: where the in-sample 30/30 came from ----------
log("\n## 3. Lineage of the default tier, dev-v3 -> relabel5 (ids a round 4-9 PR names are 'named')");
{
  const v3 = new Map(tsDefault("v3").map((c) => [c.uid, c]));
  const r5 = new Map(tsDefault("r5").map((c) => [c.uid, c]));
  const r5all = snaps.r5.cards;
  const fate = {};
  log("dev-v3 default cards that were not ACCEPT, and what happened to them:");
  for (const c of v3.values()) {
    const now = r5all.get(c.uid);
    const f = now ? (now.tier === "default" ? `default ${now.label}` : `suggestion ${now.label}`) : "no longer shown";
    const k = `${isA(c) ? "ACCEPT" : "non-ACCEPT"} -> ${now ? (now.tier === "default" ? "default" : "suggestion") : "gone"}${named.has(c.uid) ? " (named)" : ""}`;
    fate[k] = (fate[k] ?? 0) + 1;
    if (!isA(c)) log(`   ${c.uid} ${c.family} ${c.label}/${c.why} -> ${f}${named.has(c.uid) ? "; named by a round 4-9 PR" : "; not named"}`);
  }
  log(`dev-v3 default fates: ${JSON.stringify(fate)}`);
  const orig = {};
  for (const c of r5.values()) {
    const was = v3.get(c.uid);
    const k = was ? `same id, dev-v3 default ${was.label}` : snaps.v3.cards.has(c.uid) ? "same id, dev-v3 suggestion" : "new id since dev-v3";
    const kk = `${k}${named.has(c.uid) ? " (named)" : ""}`;
    orig[kk] = (orig[kk] ?? 0) + 1;
  }
  log(`relabel5 default cards by origin: ${JSON.stringify(orig)}`);
  out.s3 = { v3_fates: fate, r5_origins: orig };
}

// ---------- §4 composition: what kind of default card ----------
log("\n## 4. Composition: security-named call wrappers, other call wrappers, layering (ACCEPT / shown)");
out.s4 = {};
for (const k of KEYS) {
  const by = {};
  for (const c of tsDefault(k)) { const w = wrapperClass(c, summaryOf(k, c)); (by[w] ??= [0, 0])[1]++; if (isA(c)) by[w][0]++; }
  out.s4[k] = by;
  log(`${NAME[k]}: ${["security_wrapper", "other_wrapper", "layering"].map((w) => `${w} ${by[w] ? pct(...by[w]) : "n = 0"}`).join("; ")}`);
}
log("classification per card (relabel5 and dev3), for audit:");
for (const k of ["v3", "r5", "dev3"]) for (const c of tsDefault(k)) log(`   ${k} ${c.uid} ${wrapperClass(c, summaryOf(k, c))} ${c.label} | ${summaryOf(k, c).slice(0, 100)}`);

// ---------- §5 folds, with dev3 as fold 5 ----------
log("\n## 5. TS default tier per fold (folds-r10.json; dev3 = fold 5)");
out.s5 = {};
const BUILD_FOLDS = folds.folds.filter((f) => f !== 5);
for (const k of ["v3", "r5"]) {
  const per = defaultTier(tsDefault(k), folds);
  out.s5[k] = Object.fromEntries(BUILD_FOLDS.filter((f) => per[f].shown).map((f) => [f, { accept: per[f].accept, shown: per[f].shown, repos: per[f].repos }]));
  log(`${NAME[k]}: ${BUILD_FOLDS.map((f) => `fold ${f} ${per[f].shown ? `${pct(per[f].accept, per[f].shown)} (${per[f].repos} repos)` : "n = 0"}`).join("; ")}`);
}
{
  const d = tsDefault("dev3");
  out.s5.dev3 = { 5: { accept: count(d, isA), shown: d.length, repos: new Set(d.map((c) => c.repo)).size } };
  log(`dev3 = fold 5: ${pct(count(d, isA), d.length)} (${new Set(d.map((c) => c.repo)).size} repos with a default card, of ${out.dev3_ts_repos})`);
  // Leave-one-fold-out at dev-v3: the default tier of the 3 other folds as the prediction for the left-out fold.
  const v3 = tsDefault("v3");
  log("dev-v3, leave one fold out (prediction from the other three folds -> the fold itself):");
  for (const f of BUILD_FOLDS) {
    const o = v3.filter((c) => folds.repos.get(c.repo).fold !== f), s = v3.filter((c) => folds.repos.get(c.repo).fold === f);
    log(`   fold ${f}: others ${pct(count(o, isA), o.length)} -> fold ${pct(count(s, isA), s.length)}`);
  }
}

// ---------- §6 product options ----------
// Shown set: default cards per the option; suggestions as the committed show table shows them (<= 1 outlier, family
// admitted by the LORO table, not hidden). A default card the option demotes becomes a suggestion and meets the same
// table: TS layering has no suggestion-tier entry and TS wrappers are 0/1, so the committed table hides it [STRICT].
// generalise.mjs's show-table policy is that rule (the dev set by repo language, as show10-readings §2 groups it).
// PINNED (round 12): "the committed show table" of this analysis is relabel 5's, the table committed when PLAN-R11 was
// written. The committed table was regenerated from relabel 6 in round 12 (python12.md section 9.4); this script reads
// relabel 5's table from its run record (generalise.mjs show-table-r5), so its output stays what PLAN-R11 cites.
const shownSet = (key, lang) => (key === "dev3" ? dev3[lang] : POLICIES["show-table-r5"].select([...snaps[key].cards.values()].filter((c) => c.lang === lang), lang));
const OPTIONS = {
  a: { what: "keep the default tier as is (agents see it unvetted)", def: () => true, demoted: "hidden_by_table", agents: "default" },
  b: { what: "no default tier: demote to suggestion; the committed show table hides them", def: () => false, demoted: "hidden_by_table", agents: "none" },
  "b-humans": { what: "no default tier: demote to suggestion, still shown to people (not to agents)", def: () => false, demoted: "shown", agents: "none" },
  "c-0": { what: "default tier only with 0 outliers; the rest demoted and hidden by the table", def: (c) => c.outliers === 0, demoted: "hidden_by_table", agents: "default" },
  "c-<=1": { what: "default tier only with <= 1 outlier; the rest demoted and hidden by the table", def: (c) => c.outliers <= 1, demoted: "hidden_by_table", agents: "default" },
  "c-security": { what: "default tier only for security-named call wrappers (post hoc, §4); the rest demoted and hidden", def: (c, k) => wrapperClass(c, summaryOf(k, c)) === "security_wrapper", demoted: "hidden_by_table", agents: "default" },
  d: { what: "candidate tier: D7 cards shown to people as block candidates; agents and check see one only after a person accepts it", def: () => true, demoted: "shown", agents: "accepted_only" },
};
log("\n## 6. Options for the default tier: TS default tier, D4 (not-wrong over all shown) and yield");
log("Shown suggestions follow the committed show table; repos = all repos of the set (dev3 12 TS; build 16 TS).");
out.s6 = {};
const nRepos = { v3: 16, r5: 16, dev3: 12 };
for (const [o, opt] of Object.entries(OPTIONS)) {
  out.s6[o] = {};
  log(`\n(${o}) ${opt.what}`);
  for (const k of ["r5", "v3", "dev3"]) {
    const all = shownSet(k, "ts");
    const kept = all.filter((c) => c.tier !== "default" || opt.def(c, k) || opt.demoted === "shown");
    const def = all.filter((c) => c.tier === "default" && opt.def(c, k));
    const agentUnvetted = opt.agents === "default" ? def : [];
    const nw = count(kept, (c) => c.label === "ACCEPT" || c.label === "TRIVIAL");
    const r = { default: [count(def, isA), def.length], d4: [nw, kept.length], accepts_per_repo: count(kept, isA) / nRepos[k], agents_unvetted: [count(agentUnvetted, isA), agentUnvetted.length] };
    out.s6[o][k] = r;
    log(`   ${NAME[k]}: default ${r.default[1] ? pct(...r.default) : "n = 0"}; D4 ${pct(...r.d4)}; ${r.accepts_per_repo.toFixed(2)} accepts/repo; shown to agents with no person's decision: ${r.agents_unvetted[1]} cards (${r.agents_unvetted[1] ? pct(...r.agents_unvetted) : "-"}), ${(r.agents_unvetted[1] / nRepos[k]).toFixed(2)}/repo`);
  }
}
log("\nPooled out of sample under (a): every held-out and dev3 default card reaches agents: " + pct(out.s1.pooled_oos.accept, out.s1.pooled_oos.shown) + " right.");

// ---------- §7 Python ----------
log("\n## 7. Python: shown cards and accepts per repo (show policy applied)");
{
  const r5 = shownSet("r5", "py"), v3 = shownSet("v3", "py"), d3 = dev3.py;
  out.s7 = {
    r5: { accept: count(r5, isA), shown: r5.length, repos: 18 },
    v3: { accept: count(v3, isA), shown: v3.length, repos: 18 },
    dev3: { accept: count(d3, isA), shown: d3.length, repos: out.dev3_py_repos, causes: causes(d3) },
  };
  for (const [k, x] of Object.entries(out.s7)) log(`${NAME[k]}: ${pct(x.accept, x.shown)} accepted; ${(x.shown / x.repos).toFixed(2)} shown/repo, ${(x.accept / x.repos).toFixed(2)} accepts/repo over ${x.repos} repos${x.causes ? `; not accepted ${JSON.stringify(x.causes)}` : ""}`);
  log(`dev3 Python cards: ${d3.map((c) => `${c.uid} ${c.family} ${c.outliers} outl ${c.label}${c.why ? "/" + c.why : ""}`).join("; ")}`);
}

// ---------- §8 dev4 size ----------
// P(at least m cards) for a pool of n repos, (i) resampling dev3's per-repo counts (the one blind per-repo
// distribution), (ii) Poisson at the pooled out-of-sample rate given (cards per repo).
log("\n## 8. dev4 size: chance of at least 8 TS default cards and of at least 10 Python shown cards");
{
  let seed = 20261108;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const perRepo = (cards, nr) => { const m = new Map(); for (const c of cards) m.set(c.repo, (m.get(c.repo) ?? 0) + 1); const v = [...m.values()]; while (v.length < nr) v.push(0); return v; };
  const boot = (v, n, m, B = 20000) => { let hit = 0; for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += v[Math.floor(rnd() * v.length)]; if (s >= m) hit++; } return hit / B; };
  const pois = (lam, m) => { let p = Math.exp(-lam), c = p; for (let k = 1; k < m; k++) { p *= lam / k; c += p; } return 1 - c; };
  const tsv = perRepo(tsDefault("dev3"), out.dev3_ts_repos);
  const pyv = perRepo(dev3.py, out.dev3_py_repos);
  const h1rate = 7 / 18; // heldout1: 7 default cards; the held-out TS quota is 18 repos (select-holdout.mjs TS_BUCKETS)
  out.s8 = { ts: {}, py: {} };
  log(`TS default cards per repo: dev3 ${(tsv.reduce((a, b) => a + b, 0) / tsv.length).toFixed(2)} (counts ${JSON.stringify(tsv)}); heldout1 ${h1rate.toFixed(2)} (7 over the 18-repo quota)`);
  for (const n of [12, 18, 24, 30, 36, 42]) {
    const r = { boot_dev3: boot(tsv, n, 8), poisson_dev3: pois(n * 5 / 12, 8), poisson_heldout1: pois(n * h1rate, 8) };
    out.s8.ts[n] = r;
    log(`   TS n = ${n}: P(>= 8) resampling dev3 ${(100 * r.boot_dev3).toFixed(0)}%, Poisson at dev3's rate ${(100 * r.poisson_dev3).toFixed(0)}%, at heldout1's ${(100 * r.poisson_heldout1).toFixed(0)}%`);
  }
  const pyBuild = 12 / 18;
  log(`Python shown cards per repo: dev3 ${(pyv.reduce((a, b) => a + b, 0) / pyv.length).toFixed(2)}; build set (relabel5, show policy) ${pyBuild.toFixed(2)}`);
  for (const n of [8, 12, 16, 20, 24, 30, 40]) {
    const r = { boot_dev3: boot(pyv, n, 10), poisson_build: pois(n * pyBuild, 10) };
    out.s8.py[n] = r;
    log(`   Python n = ${n}: P(>= 10 shown) resampling dev3 ${(100 * r.boot_dev3).toFixed(0)}%, Poisson at the build-set rate ${(100 * r.poisson_build).toFixed(0)}%`);
  }
}

const text = lines.join("\n") + "\n";
process.stdout.write(text);
const ji = process.argv.indexOf("--json");
if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(out, null, 2) + "\n");
