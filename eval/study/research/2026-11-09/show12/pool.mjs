#!/usr/bin/env node
// Round 12, show12: the show policy's declared rule (eval/study/show-policy.mjs, PLAN-R10 §4, #129) re-applied to the
// larger labelled build set. The rule is imported, not copied: `loro` and `BAR`, `HIDDEN`, `MAX_OUTLIERS`,
// `EXCLUDED_REPOS` from show-policy.mjs, `familyOf` and `proposalLanguage` from lib.mjs. Nothing here changes a bar,
// a family or a cap.
//
//   node eval/study/research/2026-11-09/show12/pool.mjs [--sensitivity all-snapshots] [--table out.json] [--json out.json]
//
// Population (as show-policy.mjs: suggestion-tier cards of a labelled census, tier and family as the census gave
// them, a card without a final label counts as not accepted), pooled over these merged records:
//   dev      relabel5 (ts, py, py2 D7 views; the run the current table was built from), then the newer clean
//            relabels of dev-clone cards: show-before-cap run 2 (labels-final.jsonl, its census-diff.json rows) and
//            map11's clean relabel (labels-relabel.jsonl);
//   dev3     dev3-ts and dev3-py at F10 (queue.json + final.jsonl), then map11's clean relabel of fold-5 cards;
//   dev4     dev4-ts (queue.json + final-all.jsonl: adjudicated plus the A + blind-C repo) and dev4-py at F11;
//   apps     apps-build: no labelled record exists (apps11-build-baseline is unlabelled), so it adds nothing.
// Left out [STRICT]: deviation runs (show-before-cap run 1, map11's first run), layer11's labels (hand-rendered
// prompts: the raw census block and the rubric with its study-only notes, against the labelling-prompt rule),
// rubric-v2 runs, held-out and blind runs. A repo is identified per pool (dev3 and dev4 keys collide: `dev3:T02`,
// `dev4:T02`). A card is identified by pool, repo and id (lib.mjs uidOf); a later record supersedes an earlier one.
// --sensitivity all-snapshots also pools the earlier v3 dev snapshots (dev-v3, relabel, relabel2, relabel3,
// relabel4 D7 views) under relabel5, so cards the product no longer mines count too.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { kindFamilies } from "../../../family-admission.mjs";
import { LABELS, familyOf, parseArgs, proposalLanguage, readJson, readJsonl, repoRootDir, wilson } from "../../../lib.mjs";
import { BAR, EXCLUDED_REPOS, HIDDEN, MAX_OUTLIERS, loro } from "../../../show-policy.mjs";

const R = (p) => join(repoRootDir, p);
const RUNS = "eval/study/runs";
const RES = "eval/study/research/2026-11-09";
const EARLIER = [
  ["dev-v3-2026-11-06", ["ts", "py", "py2"]],
  ["dev-v3-relabel-2026-11-06", ["ts"]],
  ["dev-v3-relabel2-2026-11-07", ["ts"]],
  ["dev-v3-relabel3-2026-11-07", ["ts", "py", "py2"]],
  ["dev-v3-relabel4-2026-11-07", ["ts", "py", "py2"]],
];

// One labelled card: pool, repo, id, language, family, tier, label (null: none), source.
function fromQueue(pool, queuePath, labelPath, source) {
  const labels = new Map(readJsonl(R(labelPath)).map((r) => [r.uid ?? `${r.repo}/${r.id}`, r]));
  return readJson(R(queuePath)).items
    .filter((it) => !EXCLUDED_REPOS.includes(it.repo))
    .map((it) => {
      const l = labels.get(it.uid);
      return { pool, repo: it.repo, id: it.id, lang: proposalLanguage(it), family: familyOf(it), tier: it.tier, label: valid(l) ? l.label : null, source };
    });
}
const valid = (l) => !!l && LABELS.includes(l.label) && (l.rubric ?? "v3") === "v3";

function showBeforeCap() {
  const rows = readJson(R(`${RES}/show-before-cap/census-diff.json`));
  const card = new Map();
  for (const r of rows) for (const c of r.new) card.set(`${r.repo}/${c.id}`, { ...c, repo: r.repo });
  const fam = kindFamilies();
  return readJsonl(R(`${RES}/show-before-cap/labels-final.jsonl`)).map((l) => {
    const c = card.get(l.uid);
    if (!c) throw new Error(`show-before-cap: ${l.uid} not in census-diff.json`);
    return { pool: "dev", repo: l.repo, id: l.id, lang: c.language, family: fam[c.rule_kind], tier: c.tier, label: valid(l) ? l.label : null, source: "show-before-cap-run2" };
  });
}

// map11's clean relabel. Its fold-5 rows carry no id (aggregates-only rule for dev3); they are new cards (group
// new_kind), so each is its own card, identified by its relabel key.
function map11() {
  const fam = kindFamilies();
  return readJsonl(R(`${RES}/map11/labels-relabel.jsonl`)).map((l) => ({
    pool: l.fold === 5 ? "dev3" : "dev",
    repo: l.repo,
    id: l.id ?? l.key,
    lang: /python/.test(l.group) ? "py" : "ts",
    family: fam[l.rule_kind],
    tier: l.tier,
    label: LABELS.includes(l.final) ? l.final : null,
    source: "map11-clean-relabel",
  }));
}

export function assemble({ sensitivity = null } = {}) {
  const ordered = [];
  if (sensitivity === "all-snapshots")
    for (const [run, parts] of EARLIER) for (const p of parts) ordered.push(...fromQueue("dev", `${RUNS}/${run}/${p}/views/d7/queue.json`, `${RUNS}/${run}/${p}/final.jsonl`, run));
  for (const p of ["ts", "py", "py2"])
    ordered.push(...fromQueue("dev", `${RUNS}/dev-v3-relabel5-2026-11-07/${p}/views/d7/queue.json`, `${RUNS}/dev-v3-relabel5-2026-11-07/${p}/final.jsonl`, "relabel5"));
  ordered.push(...fromQueue("dev3", `${RUNS}/dev3-ts-2026-11-08/queue.json`, `${RUNS}/dev3-ts-2026-11-08/final.jsonl`, "dev3"));
  ordered.push(...fromQueue("dev3", `${RUNS}/dev3-py-2026-11-08/queue.json`, `${RUNS}/dev3-py-2026-11-08/final.jsonl`, "dev3"));
  ordered.push(...fromQueue("dev4", `${RUNS}/dev4-ts-2026-11-09/queue.json`, `${RUNS}/dev4-ts-2026-11-09/final-all.jsonl`, "dev4"));
  ordered.push(...fromQueue("dev4", `${RUNS}/dev4-py-2026-11-09/queue.json`, `${RUNS}/dev4-py-2026-11-09/final.jsonl`, "dev4"));
  ordered.push(...showBeforeCap());
  ordered.push(...map11());
  const byUid = new Map();
  let superseded = 0;
  for (const c of ordered) {
    const uid = `${c.pool}:${c.repo}/${c.id}`;
    if (byUid.has(uid)) superseded += 1;
    byUid.set(uid, { ...c, uid });
  }
  return { cards: [...byUid.values()], superseded };
}

// The table, in show-policy.mjs's shape, from pooled cards (repo keys `pool:repo` outside the dev pool).
export function table(cards) {
  const counts = { ts: {}, py: {} };
  for (const c of cards) {
    if (c.tier !== "suggestion") continue;
    const repo = c.pool === "dev" ? c.repo : `${c.pool}:${c.repo}`;
    const r = ((counts[c.lang][c.family] ??= {})[repo] ??= { accepted: 0, n: 0 });
    r.n += 1;
    if (c.label === "ACCEPT") r.accepted += 1;
  }
  const languages = {};
  for (const [lang, fams] of Object.entries(counts)) {
    languages[lang] = {};
    for (const f of Object.keys(fams).sort()) {
      const repos = Object.fromEntries(Object.keys(fams[f]).sort().map((r) => [r, fams[f][r]]));
      const accepted = Object.values(repos).reduce((s, x) => s + x.accepted, 0);
      const n = Object.values(repos).reduce((s, x) => s + x.n, 0);
      const l = loro(repos);
      const minRate = Math.min(...Object.values(l.without).map((x) => (x.n ? x.accepted / x.n : 0)));
      languages[lang][f] = {
        accepted, n, rate: Math.round((accepted / n) * 1000) / 1000,
        loro_min_rate: Math.round(minRate * 1000) / 1000,
        hidden: HIDDEN[lang].includes(f),
        admitted: l.admitted && !HIDDEN[lang].includes(f),
        repos,
      };
    }
  }
  return languages;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { defaults: {} });
  const { cards, superseded } = assemble({ sensitivity: args.sensitivity ?? null });
  const cur = readJson(R("crates/drift-mine/data/show-policy.json"));
  const langs = table(cards);
  const summary = { by_source: {}, by_language: {}, by_pool: {}, suggestion_by_language_family: {}, superseded };
  for (const c of cards) {
    const k = (o, key) => (o[key] ??= { cards: 0, suggestion: 0, labelled: 0, ACCEPT: 0, TRIVIAL: 0, WRONG: 0 });
    for (const o of [k(summary.by_source, c.source), k(summary.by_language, c.lang), k(summary.by_pool, c.pool)]) {
      o.cards += 1;
      if (c.tier === "suggestion") o.suggestion += 1;
      if (c.label) { o.labelled += 1; o[c.label] += 1; }
    }
  }
  const diff = [];
  for (const lang of ["ts", "py"])
    for (const f of [...new Set([...Object.keys(cur.languages[lang]), ...Object.keys(langs[lang])])].sort()) {
      const a = cur.languages[lang][f], b = langs[lang][f];
      const was = !!a?.admitted, now = !!b?.admitted;
      summary.suggestion_by_language_family[`${lang}/${f}`] = b ? `${b.accepted}/${b.n} (LORO min ${(100 * b.loro_min_rate).toFixed(1)}%, ${Object.keys(b.repos).length} repos)` : "–";
      if (was !== now) diff.push({ lang, family: f, from: was ? "shown" : "hidden", to: now ? "shown" : "hidden", before: a && `${a.accepted}/${a.n} LORO min ${a.loro_min_rate}`, after: b && `${b.accepted}/${b.n} LORO min ${b.loro_min_rate}`, hidden_by_plan: !!b?.hidden });
    }
  const admitted = Object.fromEntries(Object.entries(langs).map(([l, fs]) => [l, Object.entries(fs).filter(([, v]) => v.admitted).map(([f, v]) => `${f} ${v.accepted}/${v.n} LORO min ${(100 * v.loro_min_rate).toFixed(1)}% (${Object.keys(v.repos).length} repos), pooled Wilson ${(100 * wilson(v.accepted, v.n).lo).toFixed(1)}-${(100 * wilson(v.accepted, v.n).hi).toFixed(1)}`)]));
  const out = { sensitivity: args.sensitivity ?? null, bar: BAR, max_outliers: MAX_OUTLIERS, hidden: HIDDEN, admitted_now: admitted, changes: diff, summary, languages: langs };
  console.log(JSON.stringify({ admitted_now: admitted, changes: diff, summary }, null, 1));
  if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1) + "\n");
  if (args.table) {
    const t = { ...cur, languages: langs };
    t.regenerate = "node eval/study/research/2026-11-09/show12/pool.mjs --table <out> (round 12 pooled build set)";
    t.source = { ...cur.source, run: "eval/study/research/2026-11-09/show12 (pooled: relabel5, dev3, dev4, show-before-cap run 2, map11 clean relabel)", date: "2026-11-09" };
    writeFileSync(args.table, JSON.stringify(t, null, 1) + "\n");
  }
}
