#!/usr/bin/env node
// WS-G semantic check: offline scoring against the v3 labels, as pre-registered in sem11-prereg.md.
//
//   node eval/study/research/2026-11-08/sem11-score.mjs --run eval/study/runs/sem11-2026-11-08 [--json out.json] [--md out.md]
//
// Reads the run's cards.jsonl (each card's judged members, from the product's payload) and outcomes.jsonl (the
// product's decision, `drift_semantic_card` with the 3 replies: per member kind, flag, set_apart, and card_pass), the
// labels of folds 1-4 (relabel5) and fold 5 (dev3) with the A and B per-outlier verdicts behind them, the relabel5
// verifier outcomes, and folds-r11.json. Build-set data only; it refuses held-out, dev4 and dev3-operator paths.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FOLD5, loadFolds } from "../../folds.mjs";
import { checkPath } from "../../generalise.mjs";
import { parseArgs, repoRootDir } from "../../lib.mjs";

export const RELABEL5 = "eval/study/runs/dev-v3-relabel5-2026-11-07";
export const DEV3 = { ts: "eval/study/runs/dev3-ts-2026-11-08", py: "eval/study/runs/dev3-py-2026-11-08" };
export const DESIGN_FOLDS = new Set([4, FOLD5]); // [STRICT] sem11-prereg.md: fold 5 (PLAN-R11) and fold 4 (a payload printed)
// Ids of folds 1-3 that PLAN-R11 or R6 name in prose (their cards were not opened): the sensitivity reading leaves them out.
export const NAMED_IDS = new Set(["ai/D-fc5ef7", "supabase/D-c2e88c", "supabase/D-e93eb6", "formbricks/D-3bb3c1", "twenty/D-2df337"]);
export const REAL = new Set(["mistake", "look"]);
export const VERDICTS = ["mistake", "look", "legit", "not_violation", "one_off"];
const NAMED_REPOS_PREFIX = (uid) => NAMED_IDS.has(uid);

const readJsonl = (f) => readFileSync(checkPath(f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : "n/a");

// ---------- labels and per-outlier verdicts ----------

function recordsIn(dir) {
  const m = new Map();
  for (const b of [join(dir, "labels"), join(dir, "relabel", "labels")]) for (const L of ["A", "B"]) {
    const d = join(b, L);
    if (!existsSync(checkPath(d))) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")).sort()) for (const r of readJsonl(join(d, f))) {
      if (r.rubric !== "v3") continue;
      (m.get(r.uid) ?? m.set(r.uid, {}).get(r.uid))[L] = r;
    }
  }
  return m;
}
const recCache = new Map();
const recs = (dir) => recCache.get(dir) ?? recCache.set(dir, recordsIn(dir)).get(dir);
const finCache = new Map();
const finals = (f) => finCache.get(f) ?? finCache.set(f, existsSync(checkPath(f)) ? new Map(readJsonl(f).map((r) => [r.uid, r])) : new Map()).get(f);
// The A and B records behind a final row, followed through carried rows (generalise.mjs traceRecords).
export function trace(uid, finalFile, root = repoRootDir, depth = 0) {
  if (depth > 8) return null;
  const row = finals(finalFile).get(uid);
  if (!row) return null;
  if (row.source === "carried" && row.carried_from) return trace(uid, resolve(root, row.carried_from), root, depth + 1);
  const r = recs(dirname(finalFile)).get(uid);
  return r?.A && r?.B ? r : null;
}

// uid -> { uid, repo, fold, lang, tier, family, label, outliers (labelled count), verdicts: [{L, symbol, verdict}] | null }
export function loadLabels(folds, root = repoRootDir) {
  const out = new Map();
  const add = (it, lang, finalFile, abRecs) => {
    const f = folds.repos.get(it.repo);
    if (!f) return;
    const row = finals(finalFile).get(it.uid);
    const ab = abRecs ? abRecs.get(it.uid) : trace(it.uid, finalFile, root);
    const verdicts = ab?.A && ab?.B ? ["A", "B"].flatMap((L) => (ab[L].outliers ?? []).map((o) => ({ L, symbol: o.symbol, verdict: o.verdict }))) : null;
    out.set(it.uid, { uid: it.uid, repo: it.repo, id: it.id, fold: f.fold, lang, tier: it.tier, family: it.family, label: row?.label ?? "UNLABELLED", outliers: it.outliers, verdicts });
  };
  for (const [p, lang] of [["ts", "ts"], ["py", "py"], ["py2", "py"]]) {
    const dir = join(root, RELABEL5, p);
    // The D7 view's queue (generalise.mjs loadSnapshot): its tier is D7's; the part's own queue.json predates D7.
    for (const it of JSON.parse(readFileSync(checkPath(join(dir, "views/d7/queue.json")), "utf8")).items) add(it, lang, join(dir, "final.jsonl"), null);
  }
  for (const [lang, run] of Object.entries(DEV3)) {
    const dir = join(root, run);
    const ab = recs(dir);
    for (const it of JSON.parse(readFileSync(checkPath(join(dir, "queue.json")), "utf8")).items) add(it, lang, join(dir, "final.jsonl"), ab);
  }
  return out;
}

// ---------- matching labeller verdicts to judged members ----------

// A labeller verdict names a symbol; it matches the card's judged flagged member with that symbol when the symbol is
// unique among the judged members and among the outliers the card lists, and the card's outlier count is the
// labelled one (sem11-prereg.md). Returns [{ member, L, verdict }].
export function matchVerdicts(card, lab) {
  if (!lab?.verdicts || card.outliers_total !== lab.outliers) return [];
  const flagged = card.members.filter((m) => m.flagged);
  const count = (xs, s) => xs.filter((x) => x === s).length;
  const judgedSyms = flagged.map((m) => m.symbol);
  const listed = card.listed_outlier_symbols ?? judgedSyms;
  const out = [];
  for (const v of lab.verdicts) {
    if (count(judgedSyms, v.symbol) !== 1 || count(listed, v.symbol) !== 1) continue;
    out.push({ member: flagged.find((m) => m.symbol === v.symbol).key, L: v.L, verdict: v.verdict });
  }
  return out;
}

// ---------- agreement ----------

export function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
const agree = (pairs) => ({ n: pairs.length, exact: pairs.length ? pairs.filter(([a, b]) => a === b).length / pairs.length : null, kappa: kappa(pairs) });

// ---------- decision (b): which flags are shown ----------

// Per matched member: real (every labeller verdict real), not_real (none real), split.
export function memberTruth(matched) {
  const by = new Map();
  for (const m of matched) (by.get(m.member) ?? by.set(m.member, []).get(m.member)).push(m.verdict);
  const t = new Map();
  for (const [k, vs] of by) t.set(k, vs.every((v) => REAL.has(v)) ? "real" : vs.every((v) => !REAL.has(v)) ? "not_real" : "split");
  return t;
}

// The effect of narrowing on one card: { helped, losses: [member], before: {real, n}, after: {real, n} } over matched verdicts.
export function cardFlagEffect(outcome, matched) {
  const apart = new Set(outcome.set_apart);
  const truth = memberTruth(matched);
  const losses = [...truth].filter(([k, t]) => t === "real" && apart.has(k)).map(([k]) => k);
  const notRealApart = [...truth].filter(([k, t]) => t === "not_real" && apart.has(k)).length;
  const before = { real: matched.filter((m) => REAL.has(m.verdict)).length, n: matched.length };
  const kept = matched.filter((m) => !apart.has(m.member));
  const after = { real: kept.filter((m) => REAL.has(m.verdict)).length, n: kept.length };
  return { helped: notRealApart > 0 && losses.length === 0, losses, before, after };
}

const precRises = (b, a) => a.n > 0 && a.real * b.n > b.real * a.n; // integers: a.real/a.n > b.real/b.n
const precNotLower = (b, a) => (a.n === 0 ? b.real === 0 : a.real * b.n >= b.real * a.n);

// Admission for (b) (sem11-prereg.md). Each condition is one line (sem11-score.test.mjs mutates each).
export function admitFlags(effects, design = DESIGN_FOLDS, rule = { min_repos: 3, min_folds: 2 }) {
  const helped = effects.filter((e) => e.helped);
  const sum = (xs, k) => xs.reduce((s, e) => ({ real: s.real + e[k].real, n: s.n + e[k].n }), { real: 0, n: 0 });
  const other = effects.filter((e) => !design.has(e.fold));
  const f5 = effects.filter((e) => e.fold === FOLD5);
  const a = new Set(helped.map((e) => e.repo)).size >= rule.min_repos && new Set(helped.map((e) => e.fold)).size >= rule.min_folds; // mutation:b-a
  const b = other.every((e) => e.losses.length === 0); // mutation:b-b
  const c = precRises(sum(other, "before"), sum(other, "after")); // mutation:b-c
  const d = f5.every((e) => e.losses.length === 0) && precNotLower(sum(f5, "before"), sum(f5, "after")); // mutation:b-d
  return {
    conditions: {
      helps: { repos: [...new Set(helped.map((e) => e.repo))].sort(), folds: [...new Set(helped.map((e) => e.fold))].sort(), pass: a },
      no_real_flag_set_apart_outside_design: { losses: other.flatMap((e) => e.losses.map((m) => `${e.uid} ${m}`)), pass: b },
      other_fold_flag_precision_rises: { before: sum(other, "before"), after: sum(other, "after"), pass: c },
      fold5_not_negative: { losses: f5.flatMap((e) => e.losses), before: sum(f5, "before"), after: sum(f5, "after"), pass: d },
    },
    admitted: a && b && c && d,
  };
}

// ---------- shown-set readings, (a) and (c): the generalise.mjs fold rule on a before/after shown set ----------

// cards: [{ uid, repo, fold, label, before: bool, after: bool }]. helped: a non-ACCEPT shown before and not after;
// lost: an ACCEPT shown before and not after. Each condition one line.
export function admitShown(cards, design = DESIGN_FOLDS, rule = { min_repos: 3, min_folds: 2 }, fold5Covered = true) {
  const isA = (c) => c.label === "ACCEPT";
  const helped = cards.filter((c) => c.before && !c.after && !isA(c));
  const lost = cards.filter((c) => c.before && !c.after && isA(c));
  const rate = (xs, k) => ({ accept: xs.filter((c) => c[k] && isA(c)).length, shown: xs.filter((c) => c[k]).length });
  const other = cards.filter((c) => !design.has(c.fold));
  const f5 = cards.filter((c) => c.fold === FOLD5);
  const ob = rate(other, "before"), oa = rate(other, "after"), fb = rate(f5, "before"), fa = rate(f5, "after");
  const a = new Set(helped.map((c) => c.repo)).size >= rule.min_repos && new Set(helped.map((c) => c.fold)).size >= rule.min_folds; // mutation:s-a
  const b = !lost.some((c) => !design.has(c.fold)); // mutation:s-b
  const c = oa.shown > 0 && oa.accept * ob.shown > ob.accept * oa.shown; // mutation:s-c
  const d = fold5Covered && !lost.some((x) => x.fold === FOLD5) && (fb.shown ? fa.accept * fb.shown >= fb.accept * fa.shown : fa.accept === fa.shown); // mutation:s-d
  return {
    conditions: {
      helps: { repos: [...new Set(helped.map((x) => x.repo))].sort(), folds: [...new Set(helped.map((x) => x.fold))].sort(), pass: a },
      no_accept_lost_outside_design: { lost: lost.filter((x) => !design.has(x.fold)).map((x) => x.uid), pass: b },
      other_fold_effect_positive: { before: ob, after: oa, pass: c },
      fold5_not_negative: { covered: fold5Covered, before: fb, after: fa, pass: d },
    },
    admitted: a && b && c && d,
  };
}

// ---------- the run ----------

export function score(runDir, root = repoRootDir, { exclude = () => false } = {}) {
  const folds = loadFolds(undefined, root);
  const labels = loadLabels(folds, root);
  const cards = readJsonl(join(runDir, "cards.jsonl")).filter((c) => !exclude(c.uid));
  const outcomes = new Map(readJsonl(join(runDir, "outcomes.jsonl")).map((o) => [o.uid, o]));
  const verifier = new Map(readJsonl(join(root, RELABEL5, "verifier", "outcomes.jsonl")).map((o) => [o.uid, o]));
  const R = { cards: cards.length, decided: 0, undecided: [], members: {}, flags: {}, a: {}, c: {}, yield: {}, flips: {} };
  const s2 = [], s2bin = [], apartBin = [], s1 = [], ab = [], effects = [], aCards = [], cCards = [];
  let flipK = 0, flipN = 0, flipF = 0, flipFN = 0, noMajority = 0, judgedN = 0;
  const perRepo = new Map();
  for (const card of cards) {
    const lab = labels.get(card.uid);
    const o = outcomes.get(card.uid);
    if (!lab) continue;
    if (!o?.members) { R.undecided.push(card.uid); continue; }
    R.decided++;
    const pr = perRepo.get(card.repo) ?? perRepo.set(card.repo, { repo: card.repo, fold: lab.fold, cards: 0, judged: 0, set_apart: 0, calls: 0, candidates: 0, candidates_pass: 0, candidates_pass_accept: 0 }).get(card.repo);
    pr.cards++; pr.calls += card.calls ?? 3; pr.judged += o.judged; pr.set_apart += o.set_apart.length;
    for (const m of o.members) {
      flipN++; if (!m.unanimous) flipK++;
      if (m.flagged) { flipFN++; if (!m.unanimous) flipF++; judgedN++; if (m.flag == null) noMajority++; }
    }
    const matched = matchVerdicts(card, lab);
    const byMember = new Map(o.members.map((m) => [m.member, m]));
    for (const x of matched) {
      const m = byMember.get(x.member);
      if (m.flag != null) { s2.push([m.flag, x.verdict]); s2bin.push([REAL.has(m.flag), REAL.has(x.verdict)]); }
      apartBin.push([m.set_apart, !REAL.has(x.verdict)]);
      s1.push([m.kind, x.verdict]);
    }
    const byL = new Map();
    for (const x of matched) (byL.get(x.member) ?? byL.set(x.member, {}).get(x.member))[x.L] = x.verdict;
    for (const v of byL.values()) if (v.A && v.B) ab.push([v.A, v.B]);
    if (matched.length) effects.push({ uid: card.uid, repo: card.repo, fold: lab.fold, tier: lab.tier, lang: lab.lang, ...cardFlagEffect(o, matched) });
    if (lab.tier === "default") {
      aCards.push({ uid: card.uid, repo: card.repo, fold: lab.fold, label: lab.label, before: true, after: o.card_pass });
      pr.candidates++; if (o.card_pass) { pr.candidates_pass++; if (lab.label === "ACCEPT") pr.candidates_pass_accept++; }
    } else if (verifier.has(card.uid) && !verifier.get(card.uid).tool_error) {
      const vp = verifier.get(card.uid).pass === true;
      cCards.push({ uid: card.uid, repo: card.repo, fold: lab.fold, label: lab.label, before: vp, after: vp && o.card_pass });
    }
  }
  R.members = {
    matched_verdicts: apartBin.length,
    s2_five_way: agree(s2), s2_real_vs_not: agree(s2bin.map(([a, b]) => [String(a), String(b)])),
    set_apart_vs_not_real: agree(apartBin.map(([a, b]) => [String(a), String(b)])),
    s1_other_given_labeller: Object.fromEntries(VERDICTS.map((v) => [v, { other: s1.filter(([k, l]) => l === v && k === "other").length, n: s1.filter(([, l]) => l === v).length }])),
    a_vs_b_five_way: agree(ab), a_vs_b_real_vs_not: agree(ab.map(([a, b]) => [String(REAL.has(a)), String(REAL.has(b))])),
    confusion: Object.fromEntries(VERDICTS.map((m) => [m, Object.fromEntries(VERDICTS.map((l) => [l, s2.filter(([x, y]) => x === m && y === l).length]))])),
  };
  R.flips = { members: [flipK, flipN], flags: [flipF, flipFN], flags_without_majority: [noMajority, judgedN] };
  const sum = (xs, k) => xs.reduce((s, e) => ({ real: s.real + e[k].real, n: s.n + e[k].n }), { real: 0, n: 0 });
  R.flags = {
    per_fold: Object.fromEntries([1, 2, 3, 4, 5].map((f) => { const e = effects.filter((x) => x.fold === f); return [f, { cards: e.length, helped: e.filter((x) => x.helped).length, losses: e.reduce((s, x) => s + x.losses.length, 0), before: sum(e, "before"), after: sum(e, "after") }]; })),
    admission: admitFlags(effects),
    by_tier_lang: Object.fromEntries(["default/ts", "suggestion/ts", "suggestion/py"].map((k) => { const [t, l] = k.split("/"); const e = effects.filter((x) => x.tier === t && x.lang === l); return [k, { cards: e.length, losses: e.reduce((s, x) => s + x.losses.length, 0), before: sum(e, "before"), after: sum(e, "after") }]; })),
  };
  const aRate = (xs) => ({ pass: pct(xs.filter((c) => c.after && c.label === "ACCEPT").length, xs.filter((c) => c.after).length), fail: pct(xs.filter((c) => !c.after && c.label === "ACCEPT").length, xs.filter((c) => !c.after).length) });
  R.a = { per_fold: Object.fromEntries([1, 2, 3, 4, 5].map((f) => [f, aRate(aCards.filter((c) => c.fold === f))])), all: aRate(aCards), would_be_gate: admitShown(aCards), gate: "not a gate (lead constraint 2): not admitted by construction" };
  R.c = { cards: cCards.length, per_fold: Object.fromEntries([1, 2, 3, 4].map((f) => { const x = cCards.filter((c) => c.fold === f); return [f, { verifier: pct(x.filter((c) => c.before && c.label === "ACCEPT").length, x.filter((c) => c.before).length), both: pct(x.filter((c) => c.after && c.label === "ACCEPT").length, x.filter((c) => c.after).length) }]; })), reading: admitShown(cCards, DESIGN_FOLDS, undefined, false), wired: "not wired (lead constraint 2)" };
  R.yield = [...perRepo.values()].sort((a, b) => a.fold - b.fold || a.repo.localeCompare(b.repo));
  return R;
}

export function markdown(R, title = "sem11 offline scoring") {
  const k = (x) => (x?.kappa == null ? "n/a" : x.kappa.toFixed(2));
  const e = (x) => (x?.exact == null ? "n/a" : `${(100 * x.exact).toFixed(1)}%`);
  const L = [`# ${title}`, "", `Cards: ${R.cards} (decided ${R.decided}; undecided ${R.undecided.length})`, ""];
  const M = R.members;
  L.push("| Member-level agreement | n | exact | κ |", "|---|---|---|---|");
  L.push(`| S2 majority vs labeller, 5 classes | ${M.s2_five_way.n} | ${e(M.s2_five_way)} | ${k(M.s2_five_way)} |`);
  L.push(`| S2 majority vs labeller, real vs not | ${M.s2_real_vs_not.n} | ${e(M.s2_real_vs_not)} | ${k(M.s2_real_vs_not)} |`);
  L.push(`| set apart vs labeller not real | ${M.set_apart_vs_not_real.n} | ${e(M.set_apart_vs_not_real)} | ${k(M.set_apart_vs_not_real)} |`);
  L.push(`| A vs B (ceiling), 5 classes | ${M.a_vs_b_five_way.n} | ${e(M.a_vs_b_five_way)} | ${k(M.a_vs_b_five_way)} |`);
  L.push(`| A vs B (ceiling), real vs not | ${M.a_vs_b_real_vs_not.n} | ${e(M.a_vs_b_real_vs_not)} | ${k(M.a_vs_b_real_vs_not)} |`, "");
  L.push("S1 `other` by labeller verdict: " + VERDICTS.map((v) => `${v} ${pct(M.s1_other_given_labeller[v].other, M.s1_other_given_labeller[v].n)}`).join("; "), "");
  L.push("Confusion (rows: S2 majority; columns: labeller): " + VERDICTS.map((m) => `${m}: ${VERDICTS.map((l) => M.confusion[m][l]).join("/")}`).join("; "), "");
  L.push(`Flip rate (3 samples not unanimous): members ${pct(...R.flips.members)}, flags ${pct(...R.flips.flags)}; flags with no 2-of-3 majority ${pct(...R.flips.flags_without_majority)}`, "");
  L.push("| (b) flags, per fold | cards | helped | real set apart | flag precision before | after |", "|---|---|---|---|---|---|");
  for (const [f, x] of Object.entries(R.flags.per_fold)) L.push(`| ${f}${DESIGN_FOLDS.has(Number(f)) ? " (design)" : ""} | ${x.cards} | ${x.helped} | ${x.losses} | ${pct(x.before.real, x.before.n)} | ${pct(x.after.real, x.after.n)} |`);
  L.push("", "| (b) by tier and language | cards | real set apart | flag precision before | after |", "|---|---|---|---|---|");
  for (const [g, x] of Object.entries(R.flags.by_tier_lang)) L.push(`| ${g} | ${x.cards} | ${x.losses} | ${pct(x.before.real, x.before.n)} | ${pct(x.after.real, x.after.n)} |`);
  const A = R.flags.admission;
  L.push("", `(b) admission: **${A.admitted ? "ADMITTED" : "NOT ADMITTED"}**: ` + Object.entries(A.conditions).map(([n, c]) => `${n} ${c.pass ? "pass" : "FAIL"}`).join("; "), "");
  L.push(`Real flags set apart outside the design folds: ${A.conditions.no_real_flag_set_apart_outside_design.losses.join(", ") || "none"}`, "");
  L.push("| (a) candidate tier, card reading | accept where it passes | accept where it fails |", "|---|---|---|");
  for (const [f, x] of Object.entries(R.a.per_fold)) L.push(`| fold ${f} | ${x.pass} | ${x.fail} |`);
  L.push(`| all | ${R.a.all.pass} | ${R.a.all.fail} |`, "", `(a) would-be gate: ${R.a.would_be_gate.admitted ? "would pass" : "would fail"} the fold rule (${Object.entries(R.a.would_be_gate.conditions).map(([n, c]) => `${n} ${c.pass ? "pass" : "FAIL"}`).join("; ")}); ${R.a.gate}`, "");
  L.push("| (c) suggestions with a verifier outcome | verifier pass: accept | verifier and semantic: accept |", "|---|---|---|");
  for (const [f, x] of Object.entries(R.c.per_fold)) L.push(`| fold ${f} | ${x.verifier} | ${x.both} |`);
  L.push("", `(c) reading: ${R.c.reading.admitted ? "would pass" : "would fail"} (${Object.entries(R.c.reading.conditions).map(([n, c]) => `${n} ${c.pass ? "pass" : "FAIL"}`).join("; ")}); ${R.c.wired}`, "");
  return L.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = parseArgs(process.argv.slice(2));
  const run = resolve(a.run);
  const R = score(run);
  const S = score(run, repoRootDir, { exclude: NAMED_REPOS_PREFIX });
  const md = markdown(R) + "\n\n## Sensitivity: the ids PLAN-R11 and R6 name left out\n\n" + markdown(S, "without named ids").split("\n").slice(2).join("\n");
  if (a.json) writeFileSync(a.json, JSON.stringify({ all: R, without_named_ids: S }, null, 1) + "\n");
  if (a.md) writeFileSync(a.md, md + "\n");
  console.log(md);
}
