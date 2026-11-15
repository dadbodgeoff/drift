#!/usr/bin/env node
// The neighbour gate (round 11, WS-J), measured at warning level on the build set's labelled outliers.
//
//   node eval/study/neighbour.mjs --study <dir> [--design-folds 5] [--json out.json]
//
// <dir> holds one `<repo>.json` per build repo (a dev3 repo by its key): what `drift census --json` writes to the file
// DRIFT_STUDY_NEIGHBOUR names (crates/drift-mine/src/neighbour.rs `study`): per proposal, per outlier, whether the gate
// may hold it back at all, its nearest holder and nearest Drift-exempt member with their distances, and its distance to
// every other outlier of the card.
//
// Labels. The labelled cards are the in-sample snapshot (relabel5, folds 1-4) and dev3 (fold 5), as generalise.mjs
// loads them; an outlier's verdicts are labeller A's and B's per-outlier verdicts on the v3 records the card's final
// label rests on (followed through carried rows). Each verdict names a symbol; it is placed on a member (`path#symbol`)
// through the card's block in the queue the labellers read (the outlier lines, in order), or, failing that, a symbol
// unique among the card's outliers now. A verdict that cannot be placed, or a member that is no longer an outlier of
// the card now, is left out and counted (`unplaced`) [STRICT].
//
// Ground truth per outlier [STRICT]: KEEP when either labeller says mistake or look (MISTAKE when either says mistake);
// LEGIT when both say legit or not_violation (one verdict alone counts when only one labeller gave one); anything else
// (one_off, a split with one_off) is OTHER, left out of precision and recall and counted.
//
// Leave-one-out. Each labelled outlier is taken in turn as a hypothetical new member. Set apart: the card's Drift
// exemptions, and every OTHER LEGIT outlier of the card as a reviewer's exception (what a reviewer who agreed with the
// labellers would have marked fine). The gate holds the warning back when it may (crates/drift-mine/src/neighbour.rs
// `may_hold_back`: never on an entry point, under a guard rule or under an input validation rule) and the nearest
// set-apart member is strictly nearer than the nearest holder; otherwise it warns (as `holds_back`). The
// `exemptions-only` reading drops the reviewer's exceptions: Drift's own exemptions alone.
//
// Member-level precision = LEGIT held back / all held back (LEGIT + KEEP); recall = LEGIT held back / all LEGIT.
// Fold rule at member level (PLAN-R10 §3.2, PLAN-R11 §5), admitted only when:
//   a. it helps >= 3 repos across >= 2 folds: a repo is helped when it holds back at least one LEGIT outlier and no
//      KEEP outlier [STRICT];
//   b. it holds back no MISTAKE outlier outside its design folds (fold 5 always a design fold, PLAN-R11 §5).
// Refuses held-out, dev4 and dev3-operator paths (generalise.mjs checkPath).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FOLD5, loadFolds } from "./folds.mjs";
import { DEV3, IN_SAMPLE, RUNS, SNAPSHOTS, checkPath, loadDev3, loadSnapshot } from "./generalise.mjs";
import { die, parseArgs, repoRootDir } from "./lib.mjs";

export const KEEP_VERDICTS = new Set(["mistake", "look"]);
export const LEGIT_VERDICTS = new Set(["legit", "not_violation"]);
const readJsonl = (f) => readFileSync(checkPath(f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// ---------- ground truth ----------

// One outlier's verdicts (A's and B's, either may be missing) -> { truth: KEEP|LEGIT|OTHER, mistake }.
export function groundTruth(verdicts) {
  const vs = verdicts.filter(Boolean);
  if (!vs.length) return { truth: "OTHER", mistake: false };
  const mistake = vs.includes("mistake"); // mutation:truth-mistake
  if (vs.some((v) => KEEP_VERDICTS.has(v))) return { truth: "KEEP", mistake }; // mutation:truth-keep
  if (vs.every((v) => LEGIT_VERDICTS.has(v))) return { truth: "LEGIT", mistake };
  return { truth: "OTHER", mistake };
}

// ---------- the decision (crates/drift-mine/src/neighbour.rs holds_back, may_hold_back) ----------

// Outlier `k` of a study card, with `apart` the indexes of the outliers set apart as reviewer's exceptions.
// -> { hold, why }. `exemptions` false leaves the card's Drift exemptions out (not a reading the product has).
export function decide(card, k, apart, { exemptions = true } = {}) {
  const o = card.outliers[k];
  if (!o?.found) return { hold: false, why: "not_found" };
  if (!o.may_hold_back) return { hold: false, why: "guarded" }; // mutation:decide-guard
  const ds = [];
  if (exemptions && o.exempt) ds.push(o.exempt.distance);
  for (const j of apart) if (j !== k && o.pair[j] != null) ds.push(o.pair[j]); // mutation:decide-leave-one-out
  if (!ds.length) return { hold: false, why: "nobody_apart" };
  if (!o.holder) return { hold: false, why: "no_holder" };
  const a = Math.min(...ds);
  return a < o.holder.distance ? { hold: true, why: "nearer_apart" } : { hold: false, why: "nearer_holders" }; // mutation:decide-nearer
}

// ---------- labelled outliers ----------

const blockCache = new Map();
// uid -> [{ kind: outlier|exempt, path, symbol }] from a queue's blocks.
function blocksOf(queueFile) {
  if (blockCache.has(queueFile)) return blockCache.get(queueFile);
  const m = new Map();
  if (existsSync(checkPath(queueFile))) {
    for (const it of JSON.parse(readFileSync(queueFile, "utf8")).items ?? []) {
      const rows = [];
      for (const line of String(it.block ?? "").split("\n")) {
        // `outlier:  path:line [KIND ]symbol[ (why)]` (KIND: QUERY, FIELD, ... on some cards)
        const x = /^\s*(outlier|exempt):\s+(\S+?):(\d+) (.+?)(?: \([^()]*\))?$/.exec(line);
        if (!x) continue;
        const rest = x[4].trim();
        rows.push({ kind: x[1], path: x[2], symbol: rest.startsWith("(file)") ? "(file)" : rest.split(/\s+/).pop() });
      }
      m.set(it.uid, rows);
    }
  }
  blockCache.set(queueFile, m);
  return m;
}

// The A and B records a final row rests on, with the queue their block is in; null when not both (generalise.mjs's
// traceRecords, keeping where each record was read).
function traceWithQueue(uid, finalFile, depth = 0) {
  if (depth > 8 || !existsSync(checkPath(finalFile))) return null;
  const row = readJsonl(finalFile).find((r) => r.uid === uid);
  if (!row) return null;
  if (row.source === "carried" && row.carried_from) return traceWithQueue(uid, resolve(repoRootDir, row.carried_from), depth + 1);
  const dir = dirname(finalFile);
  const out = {};
  for (const [sub, queue] of [["labels", join(dir, "queue.json")], [join("relabel", "labels"), join(dir, "relabel", "queue.json")]]) {
    for (const L of ["A", "B"]) {
      const d = join(dir, sub, L);
      if (!existsSync(checkPath(d))) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")).sort()) for (const r of readJsonl(join(d, f))) {
        if (r.uid === uid && r.rubric === "v3") out[L] = { rec: r, queue };
      }
    }
  }
  return out.A && out.B ? out : null;
}

// Read a labeller's symbol: { symbol, hint } where hint is a path fragment, or a full key. Labellers write the
// symbol as listed (`GET`), with a hint (`POST (ai/sync-embeddings)`, `(file) electron-builder.config.cjs`,
// `x.js (file)`), as `path#symbol` or as `path:line symbol`.
export function readSymbol(s) {
  s = String(s).trim();
  let m;
  if ((m = /^(\S+)#(\S+)$/.exec(s))) return { symbol: m[2], hint: m[1] };
  if ((m = /^(\S*[/.]\S*?)(?::\d+)? (\S+)$/.exec(s)) && !m[2].startsWith("(")) return { symbol: m[2], hint: m[1] };
  if ((m = /^\(file\) (.+)$/.exec(s))) return { symbol: "(file)", hint: m[1] };
  if ((m = /^(.+?) \(file\)$/.exec(s))) return { symbol: "(file)", hint: m[1] };
  if ((m = /^(\S+) \((.+)\)$/.exec(s))) return { symbol: m[1], hint: m[2] };
  if (/^\S+\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(s)) return { symbol: "(file)", hint: s };
  return { symbol: s, hint: null };
}

// Place a record's verdicts on members: [{ key, verdict }] and the count of verdicts not placed. A verdict is placed
// by position when the record lists the block's outliers in order; otherwise on the one member (of the block's
// outliers and the card's outliers now) with its symbol whose path contains its hint. Anything else is not placed.
export function placeVerdicts(rec, block, current) {
  const syms = (rec.outliers ?? []).map((o) => String(o.symbol));
  const outRows = (block ?? []).filter((r) => r.kind === "outlier");
  const aligned = syms.length > 0 && syms.length <= outRows.length && syms.every((s, i) => s === outRows[i].symbol);
  const keys = [...new Set([...current, ...outRows.map((r) => `${r.path}#${r.symbol}`)])];
  const split = (k) => [k.slice(0, k.lastIndexOf("#")), k.slice(k.lastIndexOf("#") + 1)];
  const placed = [];
  let unplaced = 0;
  (rec.outliers ?? []).forEach((o, i) => {
    let key = null;
    if (aligned) key = `${outRows[i].path}#${outRows[i].symbol}`;
    else {
      const { symbol, hint } = readSymbol(o.symbol);
      const hits = keys.filter((k) => {
        const [path, sym] = split(k);
        return sym === symbol && (!hint || path.includes(hint.replace(/^\.\//, "")));
      });
      if (hits.length === 1) key = hits[0];
    }
    if (key) placed.push({ key, verdict: o.verdict });
    else unplaced++;
  });
  return { placed, unplaced };
}

// The labelled outliers of one card against its study card now: [{ k, key, truth, mistake }], with counts left out.
export function labelledOutliers(traced, study) {
  const current = study.outliers.map((o) => o.member);
  const index = new Map(current.map((m, k) => [m, k]));
  const by = new Map();
  let unplaced = 0;
  for (const L of ["A", "B"]) {
    const t = traced[L];
    const { placed, unplaced: u } = placeVerdicts(t.rec, blocksOf(t.queue).get(t.rec.uid), current);
    unplaced += u;
    for (const p of placed) (by.get(p.key) ?? by.set(p.key, {}).get(p.key))[L] = p.verdict;
  }
  const out = [];
  let gone = 0;
  for (const [key, v] of by) {
    const k = index.get(key);
    if (k === undefined) {
      gone++;
      continue;
    }
    out.push({ k, key, ...groundTruth([v.A, v.B]) });
  }
  return { outliers: out, unplaced, gone };
}

// ---------- the evaluation ----------

// Every labelled card with a study card now: [{ uid, repo, fold, lang, label, tier, study, outliers, unplaced, gone }].
export function loadCards(studyDir, folds) {
  checkPath(resolve(studyDir));
  const study = new Map();
  for (const f of readdirSync(studyDir).filter((x) => x.endsWith(".json")).sort()) {
    const repo = basename(f, ".json");
    if (!folds.repos.has(repo)) throw new Error(`${join(studyDir, f)}: ${repo} is not a build-set repo (folds-r11.json)`);
    const j = JSON.parse(readFileSync(join(studyDir, f), "utf8"));
    if (j.kind !== "drift-neighbour-study") throw new Error(`${join(studyDir, f)}: not a neighbour study file`);
    for (const c of j.cards) study.set(`${repo}/${c.id}`, c);
  }
  const snap = loadSnapshot(SNAPSHOTS.find((s) => s.key === IN_SAMPLE), folds);
  const dev3 = loadDev3(folds);
  const out = [];
  const missing = { card: 0, records: 0 };
  const add = (card, traced) => {
    const s = study.get(card.uid);
    if (!s) return missing.card++;
    if (!traced) return missing.records++;
    const f = folds.repos.get(card.repo);
    out.push({ uid: card.uid, repo: card.repo, fold: f.fold, lang: f.lang, label: card.label, tier: s.tier, rule_kind: s.rule_kind, study: s, ...labelledOutliers(traced, s) });
  };
  for (const c of snap.cards.values()) {
    if (folds.repos.get(c.repo)?.fold === FOLD5) continue;
    add(c, traceWithQueue(c.uid, join(repoRootDir, RUNS, snap.run, c.part, "final.jsonl")));
  }
  for (const c of dev3.cards.values()) {
    const r = dev3.recs.get(c.uid);
    const queue = join(repoRootDir, RUNS, DEV3.runs[c.lang], "queue.json");
    add(c, r?.A && r?.B ? { A: { rec: r.A, queue }, B: { rec: r.B, queue } } : null);
  }
  return { cards: out, missing };
}

const zero = () => ({ legit: 0, keep: 0, mistake: 0, other: 0, legitHeld: 0, keepHeld: 0, mistakeHeld: 0, lookHeld: 0, otherHeld: 0, guarded: 0 });
// Leave-one-out over every labelled outlier of every card. -> { rows, byRepo, byFold }.
export function evaluate(cards, opts = {}) {
  const rows = [];
  for (const c of cards) {
    const legitIdx = c.outliers.filter((o) => o.truth === "LEGIT").map((o) => o.k);
    for (const o of c.outliers) {
      const apart = opts.reviewer === false ? [] : legitIdx.filter((k) => k !== o.k);
      const d = decide(c.study, o.k, apart, opts);
      rows.push({ uid: c.uid, repo: c.repo, fold: c.fold, lang: c.lang, tier: c.tier, card_label: c.label, key: o.key, truth: o.truth, mistake: o.mistake, ...d });
    }
  }
  const tally = (m, key, r) => {
    const t = (m[key] ??= zero());
    if (r.why === "guarded") t.guarded++;
    if (r.truth === "LEGIT") { t.legit++; if (r.hold) t.legitHeld++; }
    else if (r.truth === "KEEP") { t.keep++; if (r.hold) t.keepHeld++; if (r.mistake) { t.mistake++; if (r.hold) t.mistakeHeld++; } else if (r.hold) t.lookHeld++; }
    else { t.other++; if (r.hold) t.otherHeld++; }
  };
  const byRepo = {};
  const byFold = {};
  const all = {};
  for (const r of rows) {
    tally(byRepo, r.repo, r);
    tally(byFold, `${r.lang}:${r.fold}`, r);
    tally(byFold, `all:${r.fold}`, r);
    tally(all, "all", r);
  }
  return { rows, byRepo, byFold, all: all.all ?? zero() };
}

export const precision = (t) => (t.legitHeld + t.keepHeld ? t.legitHeld / (t.legitHeld + t.keepHeld) : null);
export const recall = (t) => (t.legit ? t.legitHeld / t.legit : null);

// The fold rule at member level. `repoFold` maps repo -> fold.
export function admission(byRepo, repoFold, designFolds, { minRepos = 3, minFolds = 2 } = {}) {
  const design = new Set([...designFolds, FOLD5]); // [STRICT] fold 5 is always a design fold
  const helped = Object.entries(byRepo).filter(([, t]) => t.legitHeld > 0 && t.keepHeld === 0).map(([r]) => r); // mutation:admission-helped
  const helpedFolds = new Set(helped.map((r) => repoFold.get(r)));
  const a = helped.length >= minRepos && helpedFolds.size >= minFolds; // mutation:admission-a
  const mistakesOutside = Object.entries(byRepo).filter(([r, t]) => !design.has(repoFold.get(r)) && t.mistakeHeld > 0).map(([r, t]) => [r, t.mistakeHeld]);
  const b = mistakesOutside.length === 0; // mutation:admission-b
  return { design: [...design].sort(), helped, helpedFolds: [...helpedFolds].sort(), a, b, mistakesOutside, admitted: a && b };
}

const pc = (x) => (x == null ? "n/a" : `${(100 * x).toFixed(1)}%`);
export function render(res, adm, label) {
  const L = [`## ${label}`, "", "| Fold | Lang | LEGIT held / LEGIT (recall) | KEEP held / KEEP (mistake, look) | precision | OTHER held / OTHER | guarded |", "|---|---|---|---|---|---|---|"];
  for (const k of Object.keys(res.byFold).sort()) {
    const [lang, fold] = k.split(":");
    const t = res.byFold[k];
    L.push(`| ${fold} | ${lang} | ${t.legitHeld}/${t.legit} (${pc(recall(t))}) | ${t.keepHeld}/${t.keep} (${t.mistakeHeld}, ${t.lookHeld}) | ${pc(precision(t))} | ${t.otherHeld}/${t.other} | ${t.guarded} |`);
  }
  const t = res.all;
  L.push(`| all | all | ${t.legitHeld}/${t.legit} (${pc(recall(t))}) | ${t.keepHeld}/${t.keep} (${t.mistakeHeld}, ${t.lookHeld}) | ${pc(precision(t))} | ${t.otherHeld}/${t.other} | ${t.guarded} |`);
  L.push("", `Fold rule (design folds ${adm.design.join(", ")}): (a) helped repos ${adm.helped.length} [${adm.helped.join(", ")}] across folds [${adm.helpedFolds.join(", ")}]: ${adm.a ? "MET" : "NOT MET"}; (b) MISTAKE outliers held back outside the design folds: ${adm.mistakesOutside.length ? adm.mistakesOutside.map(([r, n]) => `${r} ${n}`).join(", ") : "none"}: ${adm.b ? "MET" : "NOT MET"}. **${adm.admitted ? "ADMITTED" : "NOT ADMITTED"}**`, "");
  return L.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2), { defaults: { "design-folds": "5" } });
  if (!args.study) die("usage: neighbour.mjs --study <dir> [--design-folds 5] [--json out.json]");
  const folds = loadFolds();
  const design = String(args["design-folds"]).split(",").filter(Boolean).map(Number);
  const { cards, missing } = loadCards(args.study, folds);
  const repoFold = new Map([...folds.repos].map(([r, f]) => [r, f.fold]));
  const n = cards.reduce((a, c) => ({ out: a.out + c.outliers.length, unplaced: a.unplaced + c.unplaced, gone: a.gone + c.gone }), { out: 0, unplaced: 0, gone: 0 });
  const out = [`# neighbour gate, member level, leave-one-out (build-set data; in-sample on folds 1-4, fold 5 = dev3)`, "", `Labelled cards with a study card now: ${cards.length} (no study card: ${missing.card}; no A and B records: ${missing.records}). Labelled outliers placed: ${n.out}; verdicts not placed: ${n.unplaced}; placed members no longer outliers: ${n.gone}.`, ""];
  const readings = {};
  const shown = cards.filter((c) => c.study.shown);
  for (const [name, cs, opts] of [
    ["all labelled cards: Drift exemptions + other LEGIT outliers as reviewer's exceptions", cards, {}],
    [`cards the product shows now (${shown.length}): Drift exemptions + other LEGIT outliers as reviewer's exceptions`, shown, {}],
    ["all labelled cards: exemptions only (no reviewer's exceptions)", cards, { reviewer: false }],
  ]) {
    const res = evaluate(cs, opts);
    const adm = admission(res.byRepo, repoFold, design);
    readings[name] = { byFold: res.byFold, all: res.all, byRepo: res.byRepo, admission: adm, held: res.rows.filter((r) => r.hold) };
    out.push(render(res, adm, name));
  }
  // [STRICT] Admitted only when both reviewer readings (every labelled card, and the cards shown now) are.
  const keys = Object.keys(readings);
  const verdict = readings[keys[0]].admission.admitted && readings[keys[1]].admission.admitted;
  out.push(`**Verdict [STRICT: both reviewer readings must pass]: ${verdict ? "ADMITTED" : "NOT ADMITTED"}.**`);
  console.log(out.join("\n"));
  if (args.json) writeFileSync(args.json, JSON.stringify({ cards: cards.length, missing, placed: n, design, verdict, readings }, null, 2) + "\n");
}
