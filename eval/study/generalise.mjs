#!/usr/bin/env node
// Generalisation readings for a change (eval/study/PLAN-R10.md §3.2-§3.3, PLAN-R11.md §5): the tested form of
// research/2026-11-08/r10-history.mjs and r11-default.mjs. Build-set data only; every figure is in-sample unless marked.
//
//   node eval/study/generalise.mjs --before <dir> --after <dir> [--design-folds 1,3|none] [--policy NAME] [--json out.json]
//   node eval/study/generalise.mjs --diff <census-diff.json> [--design-folds ...]      (before: the relabel5 and dev3 cards)
//   node eval/study/generalise.mjs --policy NAME [--design-folds ...]                  (a shown-set policy on the labels)
//   node eval/study/generalise.mjs --default-tier [--json out.json]                   (the default-tier readings alone)
//   node eval/study/generalise.mjs --list-policies
//
// The build set is five folds (eval/study/folds-r11.json): folds 1-4 of round 10 (the 34 dev repos, relabel5 labels)
// and fold 5 = dev3 (12 TS/JS and 8 Python repos by key, T01.. and P01..), which joined the build set after its report
// (#132): its cards are the F10 census (eval/study/runs/dev3-{ts,py}-2026-11-08/queue.json), labelled by its final.jsonl.
//
// --before/--after are directories of `drift census --json --max 15` output, one `<repo>.json` per build repo (the
// file name is the repo; a dev3 repo by its key). --write-diff <file> writes their census diff in the form --diff
// reads. --after-labels <final.jsonl,...> labels after-state cards (a relabel of the changed cards); without it a card
// keeps its relabel5 (or dev3) label by uid, and a card never labelled is UNLABELLED, counted as not accepted [STRICT].
//
// What it prints, per language (TS/JS, Python; a repo's language is its fold file language, as r10-history's part):
//   0. fold 5 (dev3): accept, not-wrong, default tier, before -> after, on the dev3 labels; a census before/after
//      that does not cover every dev3 repo of the language has no fold-5 reading, and so no admission [STRICT];
//   1. in-sample: accept, not-wrong, default tier, WRONG and yield, before -> after, on the relabel5 labels (folds 1-4);
//   2. the undo-named reading (§3.3): the before state with every change since dev-v3 that a round 4-9 PR names by
//      id undone (r10-history §2), then the change applied to it. A census change cannot say what it does to a
//      card the undo restores (one the product no longer shows), so such cards stay as they are; a policy is
//      applied to them;
//   3. the dev-v3 reading, where a policy applies (--policy): the policy on the dev-v3 labels;
//   4. per fold (all five), with --design-folds: the design folds against the other folds;
//   5. the default tier per fold, before -> after: ACCEPT / shown, and flag precision ((mistake + look) / the A and B
//      per-outlier verdicts, followed through carried rows). A card's verdicts count only while its outlier count is
//      the labelled one; any other default card is reported as untraced;
//   6. the admission verdict (PLAN-R11 §5), per language the change touches.
//
// Card effects (in-sample). A card is HELPED when a labelled non-ACCEPT card (WRONG or TRIVIAL) is no longer shown,
// or a card becomes ACCEPT (a new id labelled ACCEPT, or a relabel to ACCEPT). An ACCEPT is LOST when an ACCEPT
// card is no longer shown, is relabelled non-ACCEPT, or moves from the default tier to the suggestion tier
// [STRICT: a demotion costs the ACCEPT for D1]. Removing an unlabelled card is neither. A card moved behind a
// flag is still shown (§4 [STRICT]).
//
// Admission (PLAN-R11 §5, five folds), per language the change touches; admitted only when every touched language is:
//   a. it helps cards in >= 3 repos across >= 2 folds;
//   b. it loses no ACCEPT outside its design folds, fold 5 included;
//   c. its other-fold effect is positive: accept over the other folds' cards rises (an empty side is not a rise);
//   d. its fold-5 effect, reported separately (design fold or not), is not negative: no fold-5 ACCEPT lost, and the
//      fold-5 accept rate does not fall (with nothing shown before, every card shown after must be ACCEPT) [STRICT].
// [STRICT] Fold 5 is a design fold of every change that touches a default-tier card (PLAN-R11 §5: this plan read every
// dev3 default card): when the named design folds leave it out, it is added, and the output says so.
// Refuses held-out paths, a blind pool before its report and a pool operator's scratch, any path of a reported pool
// (dev3, dev4) but its committed runs, and any repo
// outside the build set (folds-r11.json).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { FOLD5, FOLDS_FILE_R11, loadFolds } from "./folds.mjs";
import { blindPoolProblem, blindPoolsNamed, die, familyOf, parseArgs, proposalLanguage, repoRootDir } from "./lib.mjs";
import { loro, showTable as showTableOfRun } from "./show-policy.mjs";

export const RUNS = "eval/study/runs";
// The labelled dev snapshots (r10-history.mjs SNAP): product commit and the round whose end it marks.
export const SNAPSHOTS = [
  { key: "v3", run: "dev-v3-2026-11-06", commit: "debc33a", after: "round 3", parts: ["ts", "py", "py2"] },
  { key: "r2", run: "dev-v3-relabel2-2026-11-07", commit: "feefad6", after: "round 4", parts: ["ts"] },
  { key: "r3", run: "dev-v3-relabel3-2026-11-07", commit: "e9c6058", after: "round 5", parts: ["ts", "py", "py2"] },
  { key: "r4", run: "dev-v3-relabel4-2026-11-07", commit: "2c81ba4", after: "round 6", parts: ["ts", "py", "py2"] },
  { key: "r5", run: "dev-v3-relabel5-2026-11-07", commit: "de57356", after: "round 9", parts: ["ts", "py", "py2"] },
];
export const IN_SAMPLE = "r5";
// Fold 5: the dev3 runs at F10 (blind, then joined the build set after #132), one per language, repos by key.
export const DEV3 = { key: "dev3", runs: { ts: "dev3-ts-2026-11-08", py: "dev3-py-2026-11-08" }, commit: "5151e5c", after: "round 10 (F10, blind)" };
export const SHOW_TABLE = "crates/drift-mine/data/show-policy.json";
// The run the committed show table was generated from in rounds 10 and 11 (#129): the table PLAN-R11 and the readings
// it cites were made with. Round 12 regenerated the committed table from relabel 6; a record that cites the earlier
// figures reads this run's table, computed from the run record (show-policy.mjs showTable), not the committed one.
export const SHOW_TABLE_R5_RUN = "eval/study/runs/dev-v3-relabel5-2026-11-07";
export const PART_LANG = { ts: "ts", py: "py", py2: "py" };
export const LANG_NAME = { ts: "TS", py: "Python" };
export const MENTIONS = "eval/study/research/2026-11-08/pr-mentions.json";
export const UNDO = { base: "v3", rounds: [4, 5, 6, 8, 9] };
export const ADMISSION = { min_repos: 3, min_folds: 2 };

export const isA = (c) => c?.label === "ACCEPT";
const isLabelledNonA = (c) => c && (c.label === "WRONG" || c.label === "TRIVIAL");
export const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : "n/a");
const pts = (d) => (Number.isFinite(d) ? `${d >= 0 ? "+" : ""}${(100 * d).toFixed(1)} pts` : "n/a");

// Inputs that must never be read (brief): held-out manifests, runs and scratch, always; a blind dev pool until its
// report is in the tree (lib.mjs BLIND_POOLS: PLAN-R10 section 3.4, PLAN-R11 sections 0 and 4.2), and a pool the
// registry does not know; a pool operator's scratch (its private key map), always. A pool that has reported (dev3
// since #132, dev4 since its dev4-check) is build-set data, but only through its committed run records
// (eval/study/runs/<pool>-*): any other path that names it is refused, so name a census directory without one
// [STRICT]. Each check is one line (generalise.test.mjs mutates each).
const poolRuns = (pool) => new RegExp(`^eval/study/runs/${pool}-[\\w.-]+(/|$)`);
export function checkPath(p) {
  const s = String(p).replace(/\\/g, "/");
  const abs = resolve(s).replace(/\\/g, "/");
  const rel = relative(repoRootDir, abs).replace(/\\/g, "/");
  const inRepo = rel && !rel.startsWith("../") && !isAbsolute(rel);
  for (const x of [s, abs]) {
    if (/heldout|holdout/i.test(x)) throw new Error(`${p}: a held-out path; generalise.mjs reads build-set data only`); // mutation:path-heldout
    if (/(^|\/)scratchpad\/dev\d/i.test(x)) throw new Error(`${p}: a blind pool operator's scratch; generalise.mjs never reads it`); // mutation:path-poolscratch
    for (const pool of blindPoolsNamed(x)) if (blindPoolProblem(pool)) throw new Error(`${p}: ${blindPoolProblem(pool)}; generalise.mjs reads build-set data only`); // mutation:path-blind
  }
  const tail = inRepo ? rel : abs; // inside this checkout, only the part below its root is judged
  for (const pool of blindPoolsNamed(tail)) if (!(inRepo && poolRuns(pool).test(rel))) throw new Error(`${p}: a ${pool} path outside the committed ${pool} runs (eval/study/runs/${pool}-*); name a census directory without ${pool} in it`); // mutation:path-pool
  return p;
}
const readJsonl = (f) => readFileSync(checkPath(f), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// ---------- cards ----------

// One card: { uid, repo, id, lang, tier, family, outliers, rank, roleFile, roleEntry, roleKind, label, why }.
// `plang` is the convention's own language (lib.mjs proposalLanguage), which the show table is keyed by.
export function cardFromQueue(it, lang) {
  return {
    uid: it.uid, repo: it.repo, id: it.id, lang, tier: it.tier, family: it.family, outliers: it.outliers, rank: it.rank,
    roleFile: it.role?.file ?? "*", roleEntry: it.role?.entry, roleKind: it.role?.kind, rolePackage: it.role?.package ?? "", roleDir: it.role?.dir ?? "", outlierFiles: it.outlier_files ?? null, plang: proposalLanguage(it),
  };
}
export function cardFromCensus(p, repo, lang) {
  const outliers = Number.isInteger(p.outliers_total) ? p.outliers_total : (p.outliers ?? []).length;
  const ex = p.example && typeof p.example === "object" ? `${p.example.path}#${p.example.symbol}` : p.example;
  return {
    uid: `${repo}/${p.id}`, repo, id: p.id, lang, tier: p.tier, family: familyOf({ rule: p.rule, summary: p.summary }), outliers, rank: p.rank,
    roleFile: p.role?.file ?? "*", roleEntry: p.role?.entry, roleKind: p.role?.kind, rolePackage: p.role?.package ?? "", roleDir: p.role?.dir ?? "", outlierFiles: Array.isArray(p.outliers) ? [...new Set(p.outliers.map((o) => o.path))] : null, plang: proposalLanguage({ python_members: p.evidence?.python_members, example: ex }),
  };
}
export const withLabel = (c, labels) => {
  const l = labels.get(c.uid);
  return { ...c, label: l ? l.label : "UNLABELLED", why: l?.wrong_because ?? l?.why ?? null };
};

// A labelled snapshot (r10-history loadSnap): uid -> card, from views/d7/queue.json and final.jsonl.
export function loadSnapshot(s, folds, root = repoRootDir) {
  const cards = new Map();
  const labels = new Map();
  for (const p of s.parts) {
    const dir = join(root, RUNS, s.run, p);
    const q = JSON.parse(readFileSync(checkPath(join(dir, "views/d7/queue.json")), "utf8")).items;
    const L = new Map(readJsonl(join(dir, "final.jsonl")).map((r) => [r.uid, r]));
    for (const [k, v] of L) labels.set(k, v);
    for (const it of q) {
      const f = folds.repos.get(it.repo);
      if (!f) continue; // polar, CTFd: outside the build set
      if (f.lang !== PART_LANG[p]) throw new Error(`${s.run}/${p}: ${it.repo} is ${f.lang} in the folds file`);
      cards.set(it.uid, { ...withLabel(cardFromQueue(it, PART_LANG[p]), L), part: p });
    }
  }
  return { ...s, root, cards, labels };
}

// Fold 5: the dev3 runs as a labelled snapshot (queue.json is the F10 census as shown; final.jsonl its labels; the A and
// B records under labels/ its per-outlier verdicts). Every card's repo must be a fold-5 repo of the run's language.
export function loadDev3(folds, root = repoRootDir) {
  const cards = new Map();
  const labels = new Map();
  const recs = new Map();
  for (const [lang, run] of Object.entries(DEV3.runs)) {
    const dir = join(root, RUNS, run);
    const q = JSON.parse(readFileSync(checkPath(join(dir, "queue.json")), "utf8")).items;
    const L = new Map(readJsonl(join(dir, "final.jsonl")).map((r) => [r.uid, r]));
    for (const [k, v] of L) labels.set(k, v);
    for (const ab of ["A", "B"]) {
      const d = join(dir, "labels", ab);
      if (!existsSync(checkPath(d))) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")).sort()) for (const r of readJsonl(join(d, f))) (recs.get(r.uid) ?? recs.set(r.uid, {}).get(r.uid))[ab] = r;
    }
    for (const it of q) {
      const f = folds.repos.get(it.repo);
      if (!f || f.fold !== FOLD5) throw new Error(`${run}: ${it.repo} is not a fold-${FOLD5} repo of ${FOLDS_FILE_R11}`);
      if (f.lang !== lang) throw new Error(`${run}: ${it.repo} is ${f.lang} in the folds file`);
      cards.set(it.uid, { ...withLabel(cardFromQueue(it, lang), L), part: lang });
    }
  }
  return { key: DEV3.key, run: null, commit: DEV3.commit, after: DEV3.after, root, cards, labels, recs };
}

// ---------- per-outlier verdicts (flag precision) ----------

// A and B v3 records of a label run directory (labels/ and relabel/labels/), by uid.
const recCache = new Map();
function recordsOf(dir) {
  if (recCache.has(dir)) return recCache.get(dir);
  const m = new Map();
  for (const b of [join(dir, "labels"), join(dir, "relabel", "labels")]) for (const L of ["A", "B"]) {
    const d = join(b, L);
    if (!existsSync(checkPath(d))) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".jsonl")).sort()) for (const r of readJsonl(join(d, f))) {
      if (r.rubric !== "v3") continue;
      (m.get(r.uid) ?? m.set(r.uid, {}).get(r.uid))[L] = r;
    }
  }
  recCache.set(dir, m);
  return m;
}
const finalCache = new Map();
const finalRows = (f) => finalCache.get(f) ?? finalCache.set(f, existsSync(checkPath(f)) ? new Map(readJsonl(f).map((r) => [r.uid, r])) : new Map()).get(f);
// The A and B records a final row rests on, followed through carried rows (r10-history.mjs §12); null when not both.
function traceRecords(uid, finalFile, root, depth = 0) {
  if (depth > 8) return null;
  const row = finalRows(finalFile).get(uid);
  if (!row) return null;
  if (row.source === "carried" && row.carried_from) return traceRecords(uid, resolve(root, row.carried_from), root, depth + 1);
  const r = recordsOf(dirname(finalFile)).get(uid);
  return r?.A && r?.B ? r : null;
}
export const REAL_VERDICTS = new Set(["mistake", "look"]);
// A card's per-outlier verdicts (A's then B's) in a labelled snapshot, or null when they cannot be traced.
export function verdictsOf(snap, card) {
  const recs = snap.recs ? snap.recs.get(card.uid) ?? null : card.part ? traceRecords(card.uid, join(snap.root, RUNS, snap.run, card.part, "final.jsonl"), snap.root) : null;
  return recs ? ["A", "B"].flatMap((L) => (recs[L]?.outliers ?? []).map((o) => o.verdict)) : null;
}

// A directory of census --json files -> cards (unlabelled). Refuses a repo outside the build set.
export function loadCensusDir(dir, folds) {
  checkPath(resolve(dir));
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const repo = basename(f, ".json");
    const fl = folds.repos.get(repo);
    if (!fl) throw new Error(`${join(dir, f)}: ${repo} is not a build-set repo (folds-r11.json)`);
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(j.proposals)) throw new Error(`${join(dir, f)}: no proposals (expected census --json output)`);
    for (const p of j.proposals) out.push({ ...cardFromCensus(p, repo, fl.lang), _census: p });
  }
  return out;
}

// The census diff of two card lists, in the form --diff reads: per repo, removed ids, added and changed proposals.
export function censusDiff(before, after) {
  const b = new Map(before.map((c) => [c.uid, c]));
  const a = new Map(after.map((c) => [c.uid, c]));
  const repos = {};
  const at = (r) => (repos[r] ??= { removed: [], added: [], changed: [] });
  for (const c of before) if (!a.has(c.uid)) at(c.repo).removed.push(c.id);
  for (const c of after) {
    const o = b.get(c.uid);
    if (!o) at(c.repo).added.push(c._census ?? c);
    else if (o.tier !== c.tier || o.outliers !== c.outliers || o.family !== c.family) at(c.repo).changed.push(c._census ?? c);
  }
  return { kind: "drift-census-diff", repos };
}
// Apply a census diff to labelled cards (the diff's repos must be build repos; removed and changed ids must exist).
export function applyDiff(cards, diff, folds) {
  if (diff?.kind !== "drift-census-diff") throw new Error("not a census diff (kind drift-census-diff)");
  const out = new Map(cards.map((c) => [c.uid, c]));
  for (const [repo, d] of Object.entries(diff.repos)) {
    const fl = folds.repos.get(repo);
    if (!fl) throw new Error(`census diff: ${repo} is not a build-set repo`);
    const conv = (p) => (p.uid ? p : cardFromCensus(p, repo, fl.lang));
    for (const id of d.removed ?? []) if (!out.delete(`${repo}/${id}`)) throw new Error(`census diff: ${repo}/${id} removed but not in the before state`);
    for (const p of d.changed ?? []) {
      const c = conv(p);
      if (!out.has(c.uid)) throw new Error(`census diff: ${c.uid} changed but not in the before state`);
      out.set(c.uid, { ...out.get(c.uid), tier: c.tier, outliers: c.outliers, family: c.family, rank: c.rank });
    }
    for (const p of d.added ?? []) {
      const c = conv(p);
      if (out.has(c.uid)) throw new Error(`census diff: ${c.uid} added but already in the before state`);
      out.set(c.uid, { ...c, label: "UNLABELLED", why: null });
    }
  }
  return [...out.values()];
}

// ---------- the undo-named reading (r10-history §2) ----------

// PR mentions -> uids (ids are content hashes: an id seen in two repos is dropped, as r10-history does).
export function mentionedUids(prs, snapshots) {
  const idRepo = new Map();
  const collide = new Set();
  for (const s of snapshots) for (const c of s.cards.values()) {
    if (idRepo.has(c.id) && idRepo.get(c.id) !== c.repo) collide.add(c.id);
    idRepo.set(c.id, c.repo);
  }
  return prs.map((p) => ({ ...p, uids: p.ids.filter((i) => idRepo.has(i) && !collide.has(i)).map((i) => `${idRepo.get(i)}/${i}`) }));
}
export function namedSet(prs, rounds) {
  const s = new Set();
  for (const p of prs) if (rounds.includes(p.round)) for (const u of p.uids) s.add(u);
  return s;
}

// The state `now` with every change since `base` that a PR names undone: a named card present in both returns to
// its base state (label, tier); a named card new since base is dropped; a named base card no longer shown returns.
export function undoNamed(now, base, named) {
  const out = [];
  const nowIds = new Set(now.map((c) => c.uid));
  for (const c of now) {
    if (!named.has(c.uid)) out.push(c);
    else if (base.has(c.uid)) out.push({ ...base.get(c.uid), undone: true });
  }
  for (const b of base.values()) if (!nowIds.has(b.uid) && named.has(b.uid)) out.push({ ...b, restored: true });
  return out;
}

// ---------- statistics, effects, admission ----------

export function stats(cards, repos = new Set(cards.map((c) => c.repo)).size) {
  const n = (f) => cards.filter(f).length;
  const accept = n(isA), trivial = n((c) => c.label === "TRIVIAL"), wrong = n((c) => c.label === "WRONG");
  const d = cards.filter((c) => c.tier === "default");
  return {
    accept, shown: cards.length, trivial, wrong, unlabelled: n((c) => c.label === "UNLABELLED"), not_wrong: accept + trivial,
    default: { accept: d.filter(isA).length, shown: d.length }, repos,
    cards_per_repo: repos ? cards.length / repos : 0, accepts_per_repo: repos ? accept / repos : 0, wrong_per_repo: repos ? wrong / repos : 0,
  };
}
const reposOf = (...lists) => new Set(lists.flat().map((c) => c.repo));
// after rate > before rate, compared in integers; an empty side is not a rise [STRICT].
export const rises = (b, a) => b.shown > 0 && a.shown > 0 && a.accept * b.shown > b.accept * a.shown;
const rateDelta = (b, a) => (b.shown && a.shown ? a.accept / a.shown - b.accept / b.shown : NaN);

// Card-level events between two labelled states (one language), with their effect.
export function cardEvents(before, after) {
  const b = new Map(before.map((c) => [c.uid, c]));
  const a = new Map(after.map((c) => [c.uid, c]));
  const ev = [];
  for (const c of before) {
    if (a.has(c.uid)) continue;
    ev.push({ uid: c.uid, repo: c.repo, kind: "removed", before: c, effect: isA(c) ? "accept_lost" : isLabelledNonA(c) ? "helped" : null });
  }
  for (const c of after) {
    const o = b.get(c.uid);
    if (!o) {
      ev.push({ uid: c.uid, repo: c.repo, kind: "added", after: c, effect: isA(c) ? "helped" : null });
      continue;
    }
    if (isA(o) && !isA(c)) ev.push({ uid: c.uid, repo: c.repo, kind: "relabelled", before: o, after: c, effect: "accept_lost" });
    else if (!isA(o) && isA(c)) ev.push({ uid: c.uid, repo: c.repo, kind: "relabelled", before: o, after: c, effect: "helped" });
    else if (o.tier === "default" && c.tier !== "default") ev.push({ uid: c.uid, repo: c.repo, kind: "demoted", before: o, after: c, effect: isA(c) ? "accept_lost" : null });
    else if (o.tier !== c.tier) ev.push({ uid: c.uid, repo: c.repo, kind: "promoted", before: o, after: c, effect: null });
    else if (o.outliers !== c.outliers || o.label !== c.label) ev.push({ uid: c.uid, repo: c.repo, kind: "changed", before: o, after: c, effect: null });
  }
  return ev.sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
}

// Per-fold effects for one language: each fold, then the design folds and the other folds pooled.
export function foldEffects(before, after, folds, designFolds = null) {
  const foldOf = (r) => folds.repos.get(r)?.fold;
  const ev = cardEvents(before, after).map((e) => ({ ...e, fold: foldOf(e.repo) }));
  const side = (keep) => {
    const b = before.filter((c) => keep(foldOf(c.repo))), a = after.filter((c) => keep(foldOf(c.repo)));
    const nRepos = reposOf(b, a).size;
    const e = ev.filter((x) => keep(x.fold));
    const sb = stats(b, nRepos), sa = stats(a, nRepos);
    return {
      before: sb, after: sa, delta: rateDelta(sb, sa), rises: rises(sb, sa),
      delta_per_repo: { accepts: sa.accepts_per_repo - sb.accepts_per_repo, wrong: sa.wrong_per_repo - sb.wrong_per_repo, shown: sa.cards_per_repo - sb.cards_per_repo },
      helped: e.filter((x) => x.effect === "helped").map((x) => x.uid), accept_lost: e.filter((x) => x.effect === "accept_lost").map((x) => x.uid),
      repos_helped: [...new Set(e.filter((x) => x.effect === "helped").map((x) => x.repo))].sort(),
    };
  };
  const perFold = folds.folds.map((f) => ({ fold: f, design: designFolds ? designFolds.has(f) : null, ...side((x) => x === f) }));
  const res = { events: ev, folds: perFold, all: side(() => true), fold5: side((x) => x === FOLD5) };
  if (designFolds) {
    res.design = side((x) => designFolds.has(x));
    res.other = side((x) => !designFolds.has(x));
  }
  return res;
}

// Condition d: the fold-5 effect is not negative [STRICT]: no fold-5 ACCEPT lost; with nothing shown in fold 5 before,
// every card shown after is ACCEPT; else the accept rate does not fall (integers). Removing only non-ACCEPTs passes.
export function fold5NotNegative(f5) {
  if (f5.accept_lost.length) return false; // mutation:d-lost
  if (!f5.before.shown) return f5.after.accept === f5.after.shown; // mutation:d-empty
  return f5.after.accept * f5.before.shown >= f5.before.accept * f5.after.shown; // mutation:d-rate
}

// [STRICT] Fold 5 joins the design folds when any change event touches a default-tier card (before or after), in any
// language: PLAN-R11 §5 makes fold 5 a design fold of every default-tier or candidate-tier mechanism.
export function effectiveDesignFolds(designFolds, events) {
  if (!designFolds || designFolds.has(FOLD5)) return { design: designFolds, forced: false };
  const touchesDefault = events.some((e) => e.before?.tier === "default" || e.after?.tier === "default"); // mutation:e
  return touchesDefault ? { design: new Set([...designFolds, FOLD5]), forced: true } : { design: designFolds, forced: false };
}

// The verdict for one language from its fold effects (needs design folds; `fold5Covered`: the change was read on every
// fold-5 repo of the language). Each condition is one line, so a mutation of it is a one-line edit
// (generalise.test.mjs mutates each and expects a test to fail).
export function admission(eff, rule = ADMISSION, fold5Covered = true) {
  if (!eff.other) return { verdict: "no verdict: name the design folds (--design-folds)", admitted: null };
  const helpedRepos = new Set(eff.events.filter((e) => e.effect === "helped").map((e) => e.repo));
  const helpedFolds = new Set(eff.events.filter((e) => e.effect === "helped").map((e) => e.fold));
  const lostOutside = eff.other.accept_lost;
  const a = helpedRepos.size >= rule.min_repos && helpedFolds.size >= rule.min_folds; // mutation:a
  const b = lostOutside.length === 0; // mutation:b
  const c = eff.other.rises; // mutation:c
  const d = fold5Covered && fold5NotNegative(eff.fold5); // mutation:d
  return {
    conditions: {
      helps: { repos: [...helpedRepos].sort(), folds: [...helpedFolds].sort(), pass: a },
      no_accept_lost_outside_design: { lost: lostOutside, pass: b },
      other_fold_effect_positive: { delta: eff.other.delta, pass: c },
      fold5_not_negative: { covered: fold5Covered, delta: eff.fold5.delta, lost: eff.fold5.accept_lost, before: [eff.fold5.before.accept, eff.fold5.before.shown], after: [eff.fold5.after.accept, eff.fold5.after.shown], pass: d },
    },
    admitted: a && b && c && d,
  };
}

// ---------- the default tier per fold: ACCEPT / shown and flag precision ----------

// Default-tier cards per fold, the build folds (1-4) pooled, and all five: { accept, shown, repos, flags: { real, n,
// traced, untraced } }. `verdictsOf(card)` gives a card's per-outlier verdicts, or null when they cannot be traced.
export function defaultTier(cards, folds, verdictsOfCard = () => null) {
  const keys = [...folds.folds.map(String), "build", "all"];
  const acc = Object.fromEntries(keys.map((k) => [k, { accept: 0, shown: 0, repos: new Set(), flags: { real: 0, n: 0, traced: 0, untraced: 0 } }]));
  for (const c of cards) {
    if (c.tier !== "default") continue;
    const f = folds.repos.get(c.repo)?.fold;
    const v = verdictsOfCard(c);
    for (const k of [String(f), f === FOLD5 ? null : "build", "all"]) {
      if (!k || !acc[k]) continue;
      const x = acc[k];
      x.shown++;
      if (isA(c)) x.accept++;
      x.repos.add(c.repo);
      if (!v) x.flags.untraced++;
      else {
        x.flags.traced++;
        x.flags.n += v.length;
        x.flags.real += v.filter((y) => REAL_VERDICTS.has(y)).length;
      }
    }
  }
  return Object.fromEntries(keys.map((k) => [k, { ...acc[k], repos: acc[k].repos.size }]));
}
export const touched = (eff) => eff.events.length > 0;

// ---------- policies (shown-set filters on one language's labelled cards) ----------

const sugg = (c) => c.tier === "suggestion";
const plainFnNaming = (c) => c.family === "naming" && sugg(c) && c.roleFile === "*" && c.roleEntry === "-" && c.roleKind === "function";
const HIDE_I = { ts: ["ordering", "renders", "calls"], py: ["ordering", "repo"] };
// For each repo, keep the suggestion families whose suggestion-tier accept on the OTHER repos is >= t (n >= 5).
const loroFamilies = (cs, t, extra = () => true) => {
  const out = [];
  for (const r of new Set(cs.map((c) => c.repo))) {
    const others = cs.filter((c) => c.repo !== r && sugg(c));
    const keep = (c) => {
      if (c.tier === "default") return true;
      if (!extra(c)) return false;
      const x = others.filter((o) => o.family === c.family);
      return x.length >= 5 && x.filter(isA).length * 100 >= t * x.length;
    };
    out.push(...cs.filter((c) => c.repo === r && keep(c)));
  }
  return out;
};
const filt = (f) => (cs, lang) => cs.filter((c) => f(c, lang));
// The committed show table (#129, drift_mine::show): a suggestion is shown with <= max_outliers outliers when its
// family is admitted for the convention's language (plang) and not hidden; the default tier is not affected.
let tableCache = null;
export const showTable = () => (tableCache ??= JSON.parse(readFileSync(join(repoRootDir, SHOW_TABLE), "utf8")));
let tableR5Cache = null;
export const showTableR5 = () => (tableR5Cache ??= showTableOfRun(SHOW_TABLE_R5_RUN));
const tableAdmits = (t, lang, fam) => { const r = t.languages?.[lang]?.[fam]; return !!r && r.admitted && !r.hidden && !(t.hidden?.[lang] ?? []).includes(fam); };
const tableShows = (t, c) => c.tier === "default" || (c.outliers <= t.max_outliers && tableAdmits(t, c.plang, c.family));
// The table with one repo's counts taken out and its families re-admitted by LORO (show10-readings §4).
export function tableWithout(t, repo, loro) {
  const u = structuredClone(t);
  for (const fams of Object.values(u.languages)) for (const rec of Object.values(fams)) if (rec.repos?.[repo]) {
    rec.accepted -= rec.repos[repo].accepted;
    rec.n -= rec.repos[repo].n;
    delete rec.repos[repo];
    rec.admitted = loro(rec.repos).admitted && !rec.hidden;
  }
  return u;
}

// PLAN-R11 §1.4 / WS-C candidate scope (crates/drift-mine/src/scope.rs), as label policies for the dev-v3 reading. A
// default-tier card the mechanism moves to the suggestion tier is hidden there (the committed show table admits neither
// TS wrappers nor TS layering), so the policy drops it. K1: a call-wrapper default card on a role with no entry kind
// ("-", or a wiring role's "*"). K2: a layering default card whose role is all config or tooling files (a "scripts"
// directory segment in its package or dir, or a ".config" file kind), or whose every outlier file is one (scope.rs
// is_tooling_path): set apart, it leaves no outlier, and a rule with none is not proposed. K2 can also shrink a role
// under 15 counted members; that needs the member list, so only a census shows it (policy_matches_census).
export const isToolingPath = (p) => {
  const segs = String(p).split("#")[0].split("/");
  const name = segs.pop() ?? "";
  return name.includes(".config.") || segs.includes("scripts");
};
export const k1Fails = (c) => c.tier === "default" && c.family === "wrapper" && (c.roleEntry === "-" || c.roleEntry === "*" || !c.roleEntry);
const toolingRole = (c) => [...String(c.rolePackage ?? "").split("/"), ...String(c.roleDir ?? "").split("/")].includes("scripts") || /(^|\*)\.config$/.test(String(c.roleFile ?? ""));
const toolingOutliers = (c) => Array.isArray(c.outlierFiles) && c.outlierFiles.length > 0 && c.outlierFiles.every(isToolingPath);
export const k2Fails = (c) => c.tier === "default" && c.family === "layering" && (toolingRole(c) || toolingOutliers(c));

export const POLICIES = {
  K1: { what: "WS-C K1: no call-wrapper default card on a non-entry role (PLAN-R11 §1.4)", select: filt((c) => !k1Fails(c)) },
  K2: { what: "WS-C K2: no layering default card on a config or tooling role, or whose outliers are all config or tooling files (PLAN-R11 §1.4)", select: filt((c) => !k2Fails(c)) },
  all: { what: "all shown (today)", select: filt(() => true) },
  M1: { what: "no TS naming on plain-function roles (§2.1)", select: filt((c, l) => !(l === "ts" && plainFnNaming(c))) },
  I1: { what: "no call order in the suggestion tier (§2.3)", select: filt((c) => !(sugg(c) && c.family === "ordering")) },
  "I1+I2": { what: "hide TS ordering, renders, calls; Python ordering, package facts (§2.3)", select: filt((c, l) => !(sugg(c) && HIDE_I[l].includes(c.family))) },
  "M1+I1+I2": { what: "M1, I1 and I2 (§4)", select: filt((c, l) => !(l === "ts" && plainFnNaming(c)) && !(sugg(c) && HIDE_I[l].includes(c.family))) },
  "rank<=5": { what: "W4 rank <= 5 (§4)", select: filt((c) => c.rank <= 5), v3: false },
  "rank<=3": { what: "W4 rank <= 3 (§4)", select: filt((c) => c.rank <= 3), v3: false },
  "outliers<=1": { what: "at most 1 outlier, any tier (§4)", select: filt((c) => c.outliers <= 1) },
  "default+sugg<=1": { what: "default tier + suggestions with <= 1 outlier (§4)", select: filt((c) => c.tier === "default" || c.outliers <= 1) },
  "default+sugg<=1,no-ordering": { what: "... and no ordering (§4)", select: filt((c) => c.tier === "default" || (c.outliers <= 1 && c.family !== "ordering")) },
  "loro60": { what: "default tier + suggestion families >= 60% under leave-one-repo-out, n >= 5 (§4)", select: (cs) => loroFamilies(cs, 60) },
  "loro60+<=1": { what: "default tier + suggestions with <= 1 outlier in families >= 60% under LORO, n >= 5 (§4, the bold policy)", select: (cs) => loroFamilies(cs, 60, (c) => c.outliers <= 1) },
  "default-only": { what: "default tier only (§4)", select: filt((c) => c.tier === "default") },
  "show-table": { what: "the committed show table (#129: crates/drift-mine/data/show-policy.json; default tier, and suggestions with <= 1 outlier in a family admitted for the card's language)", select: filt((c) => tableShows(showTable(), c)) },
  "show-table-loro": {
    what: "the committed show table, each repo judged by the table recounted without its own labels (#129 leave-one-repo-out)",
    select: (cs) => cs.filter((c) => tableShows(tableWithout(showTable(), c.repo, loro), c)),
    v3: false,
  },
  "show-table-r5": { what: "the show table as relabel 5 gives it (the committed table of rounds 10 and 11, #129; computed from eval/study/runs/dev-v3-relabel5-2026-11-07)", select: filt((c) => tableShows(showTableR5(), c)) },
  "show-table-r5-loro": {
    what: "relabel 5's show table, each repo judged by the table recounted without its own labels (#129 leave-one-repo-out)",
    select: (cs) => cs.filter((c) => tableShows(tableWithout(showTableR5(), c.repo, loro), c)),
    v3: false,
  },
};

// ---------- the readings ----------

// Everything the tool reports, as data. `change` is one of
//   { policy: name }                         a policy on the labelled cards (every reading); fold 5 is the dev3 cards,
//                                            the policy applied to them on their own (a LORO policy sees only them);
//   { before: cards, after: cards, repos? }  two census states (unlabelled cards; labels by uid); `repos` names the
//                                            repos the census covered on both sides (fold 5 is read only when it
//                                            holds every fold-5 repo of the language);
//   { diff }                                 a census diff applied to the relabel5 and dev3 cards.
export function generalise({ change, folds, snaps, dev3, prs, designFolds = null, afterLabels = new Map(), undo = UNDO, policy = null }) {
  const now = snaps[IN_SAMPLE];
  const named = namedSet(prs, undo.rounds);
  const base = snaps[undo.base].cards;
  const labelsNow = new Map([...now.labels, ...(dev3?.labels ?? new Map())]);
  const label = (c, extra) => withLabel(c, extra && extra.has(c.uid) ? extra : labelsNow);
  const pol = policy ?? change.policy;
  if (pol && !POLICIES[pol]) throw new Error(`unknown policy ${pol} (--list-policies)`);
  const isF5 = (c) => folds.repos.get(c.repo)?.fold === FOLD5;
  const f5Cards = dev3 ? [...dev3.cards.values()] : [];
  const f5Repos = (lang) => [...folds.repos].filter(([, v]) => v.fold === FOLD5 && v.lang === lang).map(([r]) => r);
  const out = { mode: change.policy ? `policy ${change.policy}` : change.diff ? "census diff on relabel5 and dev3" : "census before/after", undo, policy: pol ?? null, design_folds: null, fold5_design_forced: false, languages: {} };
  // The before and after states per language (all five folds).
  const states = {};
  for (const lang of ["ts", "py"]) {
    const ofLang = (cs) => cs.filter((c) => c.lang === lang);
    let before, after, covered;
    if (change.policy) {
      const b14 = ofLang([...now.cards.values()]), b5 = ofLang(f5Cards);
      before = [...b14, ...b5];
      after = [...POLICIES[change.policy].select(b14, lang), ...POLICIES[change.policy].select(b5, lang)];
      covered = !!dev3;
    } else if (change.diff) {
      const all = [...now.cards.values(), ...f5Cards];
      before = ofLang(all);
      after = ofLang(applyDiff(all, change.diff, folds).map((c) => label(c, afterLabels)));
      covered = !!dev3;
    } else {
      before = ofLang(change.before).map((c) => label(c));
      after = ofLang(change.after).map((c) => label(c, afterLabels));
      covered = !!change.repos && f5Repos(lang).every((r) => change.repos.has(r)); // [STRICT] no repos named: not covered
    }
    states[lang] = { before, after, covered };
  }
  const allEvents = Object.values(states).flatMap((x) => cardEvents(x.before, x.after));
  const { design, forced } = effectiveDesignFolds(designFolds, allEvents);
  out.design_folds = design ? [...design].sort() : null;
  out.fold5_design_forced = forced;
  for (const lang of ["ts", "py"]) {
    const { before, after, covered } = states[lang];
    const b14 = before.filter((c) => !isF5(c)), a14 = after.filter((c) => !isF5(c));
    const b5 = before.filter(isF5), a5 = after.filter(isF5);
    const R = {};
    const reading = (b, a) => {
      const n = reposOf(b, a).size;
      const sb = stats(b, n), sa = stats(a, n);
      return { before: sb, after: sa, delta: rateDelta(sb, sa), folds: foldEffects(b, a, folds, design) };
    };
    R.in_sample = reading(b14, a14);
    if (covered) {
      const n = f5Repos(lang).length;
      const sb = stats(b5, n), sa = stats(a5, n);
      R.fold5 = { covered: true, repos: n, before: sb, after: sa, delta: rateDelta(sb, sa) };
    } else R.fold5 = { covered: false };
    // Undo-named: the build-fold before state with named changes undone, then the change applied to it (no fold 5:
    // dev3 has no history before F10).
    const ub = undoNamed(b14, new Map([...base].filter(([, c]) => c.lang === lang)), named);
    let ua;
    if (change.policy) ua = POLICIES[change.policy].v3 === false ? null : POLICIES[change.policy].select(ub, lang);
    else {
      const aIds = new Map(a14.map((c) => [c.uid, c]));
      const bIds = new Set(b14.map((c) => c.uid));
      ua = [];
      for (const c of ub) {
        if (!bIds.has(c.uid)) ua.push(c); // restored by the undo: the census says nothing about it
        else if (aIds.has(c.uid)) ua.push(c.undone ? c : aIds.get(c.uid));
      }
      for (const c of a14) if (!bIds.has(c.uid) && !named.has(c.uid)) ua.push(c);
    }
    // A rank policy has no undo-named form: undone and restored cards carry dev-v3 ranks, which are not W4's.
    R.undo_named = ua ? { ...reading(ub, ua), restored: ub.filter((c) => c.restored).length } : null;
    if (pol && POLICIES[pol].v3 !== false) {
      const v = [...base.values()].filter((c) => c.lang === lang);
      R.dev_v3 = reading(v, POLICIES[pol].select(v, lang));
    } else R.dev_v3 = null;
    if (pol && !change.policy) {
      const want = new Set([...POLICIES[pol].select(b14, lang), ...POLICIES[pol].select(b5, lang)].map((c) => c.uid));
      const got = new Set(after.map((c) => c.uid));
      R.policy_matches_census = { differ: [...new Set([...want, ...got])].filter((u) => want.has(u) !== got.has(u)).sort() };
    }
    // The five-fold effects the admission rule reads, and the default tier per fold before and after.
    R.folds = foldEffects(before, after, folds, design);
    const labelled = (c) => (isF5(c) ? dev3?.cards.get(c.uid) : now.cards.get(c.uid));
    const vOf = (c) => {
      const l = labelled(c);
      if (!l || l.outliers !== c.outliers || afterLabels.has(c.uid)) return null; // stale or relabelled: untraced
      return verdictsOf(isF5(c) ? dev3 : now, l);
    };
    R.default_tier = { before: defaultTier(before, folds, vOf), after: defaultTier(after, folds, vOf) };
    R.touched = touched(R.folds);
    R.admission = R.touched ? admission(R.folds, ADMISSION, covered) : { verdict: "no change in this language", admitted: null };
    out.languages[lang] = R;
  }
  const verdicts = Object.values(out.languages).filter((r) => r.touched).map((r) => r.admission.admitted);
  out.admitted = !design || !verdicts.length ? null : verdicts.every((v) => v === true);
  return out;
}

// The default-tier readings on their own (r11-default §1, §2, §5): per labelled snapshot (dev-v3 .. relabel5 on folds
// 1-4) and dev3 (fold 5), per fold: TS default tier ACCEPT / shown and flag precision.
export function defaultTierReadings({ folds, snaps, dev3 }, lang = "ts") {
  const out = {};
  for (const s of [...SNAPSHOTS.map((x) => snaps[x.key]), dev3]) {
    if (!s) continue;
    const cards = [...s.cards.values()].filter((c) => c.lang === lang);
    out[s.key] = { commit: s.commit, after: s.after, ...defaultTier(cards, folds, (c) => verdictsOf(s, c)) };
  }
  return out;
}

// ---------- loading and printing ----------

export function loadAll(root = repoRootDir, mentions = [MENTIONS]) {
  const folds = loadFolds(join(root, FOLDS_FILE_R11), root);
  const snaps = Object.fromEntries(SNAPSHOTS.map((s) => [s.key, loadSnapshot(s, folds, root)]));
  const dev3 = loadDev3(folds, root);
  const raw = mentions.flatMap((m) => JSON.parse(readFileSync(checkPath(resolve(root, m)), "utf8")).prs);
  return { folds, snaps, dev3, prs: mentionedUids(raw, Object.values(snaps)) };
}

export function parseDesignFolds(s, folds) {
  if (s == null) return null;
  if (s === "none") return new Set();
  const v = String(s).split(",").map((x) => Number(x.trim()));
  for (const f of v) if (!folds.folds.includes(f)) throw new Error(`--design-folds: ${f} is not a fold (${folds.folds.join(", ")})`);
  return new Set(v);
}

const flagsTxt = (x) => `flag precision ${pct(x.flags.real, x.flags.n)}${x.flags.untraced ? ` (${x.flags.untraced} cards untraced)` : ""}`;
const dtTxt = (x) => `${pct(x.accept, x.shown)}, ${flagsTxt(x)}`;
export function renderDefaultTier(rd, folds) {
  const L = ["# generalise --default-tier: TS default tier per fold, ACCEPT / shown and flag precision ((mistake + look) / A and B per-outlier verdicts). Build-set data."];
  for (const [k, r] of Object.entries(rd)) {
    L.push(`${k} (${r.commit}, ${r.after}): all ${dtTxt(r.all)}; build folds ${dtTxt(r.build)}`);
    for (const f of folds.folds) if (r[f].shown) L.push(`   fold ${f}: ${dtTxt(r[f])} over ${r[f].repos} repos`);
  }
  return L.join("\n");
}
const line = (s) => `${pct(s.accept, s.shown)}; not-wrong ${pct(s.not_wrong, s.shown)}; default ${pct(s.default.accept, s.default.shown)}; WRONG ${s.wrong}; unlabelled ${s.unlabelled}; ${s.cards_per_repo.toFixed(1)} cards/repo, ${s.accepts_per_repo.toFixed(1)} accepts/repo over ${s.repos} repos`;
export function render(res) {
  const L = [];
  L.push(`# generalise: ${res.mode}${res.policy ? ` (${res.policy}: ${POLICIES[res.policy].what})` : ""}. Dev data; in-sample unless marked.`);
  for (const [lang, R] of Object.entries(res.languages)) {
    L.push(`\n## ${LANG_NAME[lang]}`);
    const show = (name, r) => {
      if (!r) return;
      L.push(`${name}:`);
      L.push(`   before ${line(r.before)}`);
      L.push(`   after  ${line(r.after)}`);
      L.push(`   effect ${pts(r.delta)} accept`);
    };
    if (R.fold5.covered) show(`fold ${FOLD5} (dev3 labels; ${R.fold5.repos} repos)`, R.fold5);
    else L.push(`fold ${FOLD5} (dev3): not read (the census does not cover every dev3 repo of this language): no admission [STRICT]`);
    show("in-sample (relabel5 labels, folds 1-4)", R.in_sample);
    if (R.undo_named) show(`undo-named reading (every change since ${SNAPSHOTS.find((x) => x.key === res.undo.base).run} a round ${res.undo.rounds.join(",")} PR names by id, undone; ${R.undo_named.restored} restored cards)`, R.undo_named);
    else L.push(`undo-named reading: n/a (${res.policy} ranks by W4, and undone cards carry dev-v3 ranks)`);
    if (R.dev_v3) show("dev-v3 reading (the policy on the dev-v3 labels)", R.dev_v3);
    else L.push(`dev-v3 reading: ${res.policy ? `n/a (${res.policy} has no dev-v3 form)` : "n/a (a census change is not a policy; pass --policy for it)"}`);
    if (R.policy_matches_census) L.push(`policy ${res.policy} on the before cards gives the after cards: ${R.policy_matches_census.differ.length ? `no, ${R.policy_matches_census.differ.length} differ (${R.policy_matches_census.differ.join(" ")})` : "yes"}`);
    const F = R.folds;
    L.push("folds (in-sample, five folds):");
    for (const f of F.folds) L.push(`   fold ${f.fold}${f.design ? " [design]" : ""}: ${pct(f.before.accept, f.before.shown)} -> ${pct(f.after.accept, f.after.shown)} (${pts(f.delta)}); helped ${f.helped.length} in ${f.repos_helped.length} repos; ACCEPT lost ${f.accept_lost.length}`);
    for (const [k, r] of [["five folds", { folds: R.folds }], ["in-sample", R.in_sample], ["undo-named", R.undo_named], ["dev-v3", R.dev_v3]]) {
      if (!r?.folds.other) continue;
      const d = r.folds.design, o = r.folds.other;
      L.push(`   ${k}: design folds ${pct(d.before.accept, d.before.shown)} -> ${pct(d.after.accept, d.after.shown)} (${pts(d.delta)}); other folds ${pct(o.before.accept, o.before.shown)} -> ${pct(o.after.accept, o.after.shown)} (${pts(o.delta)}; per repo: accepts ${o.delta_per_repo.accepts.toFixed(2)}, WRONG ${o.delta_per_repo.wrong.toFixed(2)}, shown ${o.delta_per_repo.shown.toFixed(2)}; ${o.before.repos} repos)`);
    }
    L.push("default tier per fold (ACCEPT / shown; flag precision), before -> after:");
    for (const k of [...F.folds.map((f) => String(f.fold)), "build", "all"]) {
      const b = R.default_tier.before[k], a = R.default_tier.after[k];
      if (b.shown || a.shown) L.push(`   ${/^\d+$/.test(k) ? `fold ${k}` : k === "build" ? "folds 1-4" : "all five"}: ${dtTxt(b)} -> ${dtTxt(a)}`);
    }
    const A = R.admission;
    if (A.conditions) {
      const c = A.conditions;
      const f5 = c.fold5_not_negative;
      L.push(`admission (PLAN-R11 §5): helps ${c.helps.repos.length} repos across ${c.helps.folds.length} folds (>= ${ADMISSION.min_repos} across >= ${ADMISSION.min_folds}: ${c.helps.pass ? "yes" : "NO"}); ACCEPT lost outside the design folds ${c.no_accept_lost_outside_design.lost.length} (${c.no_accept_lost_outside_design.pass ? "yes" : `NO: ${c.no_accept_lost_outside_design.lost.join(" ")}`}); other-fold effect ${pts(c.other_fold_effect_positive.delta)} (${c.other_fold_effect_positive.pass ? "positive" : "NOT positive"}); fold-5 effect ${f5.covered ? `${pct(...f5.before)} -> ${pct(...f5.after)}, ACCEPT lost ${f5.lost.length}` : "not read"} (${f5.pass ? "not negative" : "NEGATIVE or not read"}) -> ${A.admitted ? "ADMITTED" : "NOT ADMITTED"}`);
    } else L.push(`admission (PLAN-R11 §5): ${A.verdict}`);
    const ev = F.events;
    if (ev.length) {
      L.push(`changed cards (${ev.length}):`);
      for (const e of ev) {
        const c = e.after ?? e.before;
        L.push(`   ${e.uid} fold ${e.fold} ${e.kind}${e.before && e.after && e.before.tier !== e.after.tier ? ` ${e.before.tier}->${e.after.tier}` : ` ${c.tier}`} ${c.family} ${e.before && e.after && e.before.label !== e.after.label ? `${e.before.label}->${e.after.label}` : c.label}${c.why ? `/${c.why}` : ""}${e.effect ? ` [${e.effect}]` : ""}`);
      }
    }
  }
  if (res.fold5_design_forced) L.push(`\nfold ${FOLD5} added to the design folds: the change touches a default-tier card (PLAN-R11 §5) [STRICT]; design folds ${res.design_folds.join(",")}`);
  L.push(`\nadmitted: ${res.admitted == null ? "no verdict" : res.admitted ? "yes (every language it touches)" : "no"}`);
  return L.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { flags: ["listPolicies", "defaultTier"] });
  if (args.listPolicies) {
    for (const [k, p] of Object.entries(POLICIES)) console.log(`${k}: ${p.what}${p.v3 === false ? " (no dev-v3 reading)" : ""}`);
    process.exit(0);
  }
  try {
    const { folds, snaps, dev3, prs } = loadAll(repoRootDir, [MENTIONS, ...(args.mentions ? String(args.mentions).split(",") : [])]);
    if (args.defaultTier) {
      const rd = defaultTierReadings({ folds, snaps, dev3 });
      console.log(renderDefaultTier(rd, folds));
      if (args.json) writeFileSync(args.json, JSON.stringify(rd, null, 1) + "\n");
      process.exit(0);
    }
    const designFolds = parseDesignFolds(args.designFolds, folds);
    const afterLabels = new Map();
    for (const f of args.afterLabels ? String(args.afterLabels).split(",") : []) {
      checkPath(f);
      const files = statSync(f).isDirectory() ? readdirSync(f, { recursive: true }).filter((x) => basename(String(x)) === "final.jsonl").map((x) => join(f, String(x))) : [f];
      for (const x of files) for (const r of readJsonl(x)) afterLabels.set(r.uid, r);
    }
    const undo = { base: args.undoBase ?? UNDO.base, rounds: args.undoRounds ? String(args.undoRounds).split(",").map(Number) : UNDO.rounds };
    if (!snaps[undo.base]) throw new Error(`--undo-base ${undo.base}: not a snapshot (${SNAPSHOTS.map((s) => s.key).join(", ")})`);
    let change;
    if (args.before || args.after) {
      if (!args.before || !args.after) throw new Error("--before and --after go together");
      for (const d of [args.before, args.after]) if (!existsSync(checkPath(d))) throw new Error(`${d}: no such directory`);
      const before = loadCensusDir(args.before, folds), after = loadCensusDir(args.after, folds);
      const bf = new Set(readdirSync(args.before).filter((x) => x.endsWith(".json")).map((x) => basename(x, ".json")));
      const af = new Set(readdirSync(args.after).filter((x) => x.endsWith(".json")).map((x) => basename(x, ".json")));
      const one = [...bf].filter((r) => !af.has(r)).concat([...af].filter((r) => !bf.has(r)));
      if (one.length) throw new Error(`census on one side only: ${one.join(", ")} (a before/after census covers the same repos)`);
      const missing = [...folds.repos.keys()].filter((r) => !bf.has(r));
      if (missing.length) console.error(`warning: no census for ${missing.length} build repos: ${missing.join(", ")}`);
      if (args.writeDiff) writeFileSync(args.writeDiff, JSON.stringify(censusDiff(before, after), null, 1) + "\n");
      change = { before, after, repos: new Set([...bf].filter((r) => af.has(r))) };
    } else if (args.diff) change = { diff: JSON.parse(readFileSync(checkPath(args.diff), "utf8")) };
    else if (args.policy) change = { policy: args.policy };
    else die("usage: generalise.mjs --before <dir> --after <dir> | --diff <file> | --policy <name> | --default-tier [--design-folds 1,3,5|none] [--json out]");
    const res = generalise({ change, folds, snaps, dev3, prs, designFolds, afterLabels, undo, policy: change.policy ? null : args.policy });
    console.log(render(res));
    if (args.json) writeFileSync(args.json, JSON.stringify(res, (k, v) => (k === "_census" ? undefined : v instanceof Set ? [...v] : v), 1) + "\n");
  } catch (e) {
    die(e.message);
  }
}
