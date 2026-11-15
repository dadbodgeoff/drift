#!/usr/bin/env node
// Round 12, show12: D4 on the build set at the F12 candidate, per arm (current table, regenerated table).
//
//   node eval/study/research/2026-11-09/show12/d4.mjs --census <dir> --text <dir> [--rows <a.jsonl:keymap.json,...>]
//        [--extra <labels.jsonl,...>] [--json out.json] [--cards out.jsonl]
//
// <dir>/{default,optin}/<pool>__<repo>.json is `drift census --json --max 15` (optin: --python-proposals);
// --text the same layout of `census --all --all-outliers --max 15` text (.txt), for the card each label was given on.
// D4 (PREREG-F11-dev4-check §2, PLAN-R11 §2 [STRICT]): not-wrong = (ACCEPT + TRIVIAL) over every card the census
// lists (`census --all`), both tiers. TS/JS reads the default view, Python the opt-in view. "Listed by default" is the
// subset with shown_by_default (the census without --all).
//
// A shown card has a final clean label when a merged clean record labelled its uid (pool:repo/id) on a byte-identical
// card: stage.mjs rule 4, the labeller's card (lib.mjs labellerCard, without the `tier:` line) equal, repo at the
// same pin. A uid labelled only on another card text is `changed` and counts as unlabelled [STRICT]. Records, oldest
// first (a later identical one wins): calib-v3, dev-v3, relabel, relabel2, relabel3, relabel4, relabel5 (D7 views),
// dev3, dev4, then --rows (opaque-key rows of a clean research relabel: proposal text + keymap) and --extra labels.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LABELS, labellerCard, parseArgs, parseCensus, readJson, readJsonl, repoRootDir, wilson } from "../../../lib.mjs";

const R = (p) => join(repoRootDir, p);
const RUNS = "eval/study/runs";
const SNAP = [
  ["calib-v3-2026-11-06", ["ts", "py"], "queue.json"],
  ["dev-v3-2026-11-06", ["ts", "py", "py2"], "views/d7/queue.json"],
  ["dev-v3-relabel-2026-11-06", ["ts"], "views/d7/queue.json"],
  ["dev-v3-relabel2-2026-11-07", ["ts"], "views/d7/queue.json"],
  ["dev-v3-relabel3-2026-11-07", ["ts", "py", "py2"], "views/d7/queue.json"],
  ["dev-v3-relabel4-2026-11-07", ["ts", "py", "py2"], "views/d7/queue.json"],
  ["dev-v3-relabel5-2026-11-07", ["ts", "py", "py2"], "views/d7/queue.json"],
];
const KEYED = [
  ["dev3", "dev3-ts-2026-11-08", "final.jsonl"],
  ["dev3", "dev3-py-2026-11-08", "final.jsonl"],
  ["dev4", "dev4-ts-2026-11-09", "final-all.jsonl"],
  ["dev4", "dev4-py-2026-11-09", "final.jsonl"],
];
export const cardText = (block) => labellerCard(block).split("\n").filter((l) => !/^\s+tier:\s/.test(l)).join("\n").replace(/^\[(D-[0-9a-f]+|K-[0-9a-f]+)\] /, "").trimEnd();
const ok = (l) => l && LABELS.includes(l.label) && (l.rubric ?? "v3") === "v3";

function index(rowsArgs, extra) {
  const idx = new Map(); // uid -> [{label, text, pin, source, wrong_because}]
  const add = (uid, e) => (idx.get(uid) ?? idx.set(uid, []).get(uid)).push(e);
  const runPins = (dir) => new Map((readJson(R(`${dir}/run.json`)).repos ?? []).map((r) => [r.name, r.sha]));
  for (const [run, parts, q] of SNAP)
    for (const p of parts) {
      const dir = `${RUNS}/${run}/${p}`;
      const pins = runPins(dir);
      const lab = new Map(readJsonl(R(`${dir}/final.jsonl`)).map((r) => [r.uid, r]));
      for (const it of readJson(R(`${dir}/${q}`)).items) {
        const l = lab.get(it.uid);
        if (ok(l)) add(`dev:${it.uid}`, { label: l.label, text: cardText(it.block), pin: pins.get(it.repo), source: run });
      }
    }
  for (const [pool, run, fin] of KEYED) {
    const dir = `${RUNS}/${run}`;
    const pins = runPins(dir);
    const lab = new Map(readJsonl(R(`${dir}/${fin}`)).map((r) => [r.uid, r]));
    for (const it of readJson(R(`${dir}/queue.json`)).items) {
      const l = lab.get(it.uid);
      if (ok(l)) add(`${pool}:${it.uid}`, { label: l.label, text: cardText(it.block), pin: pins.get(it.repo), source: run });
    }
  }
  for (const spec of rowsArgs) {
    const [rowsPath, keymapPath, labelsPath, source] = spec.split(":");
    const km = readJson(keymapPath);
    const labels = new Map(readJsonl(labelsPath).map((r) => [r.key, r.label ?? r.final]));
    for (const row of readJsonl(rowsPath)) {
      const k = km[row.key];
      const label = labels.get(row.key);
      if (!k || !LABELS.includes(label)) continue;
      const pool = /\/dev-clones\/dev3\//.test(row.repo_dir) ? "dev3" : "dev";
      add(`${pool}:${k.repo}/${k.id}`, { label, text: cardText(row.proposal), pin: null, source, repo_dir: row.repo_dir });
    }
  }
  for (const p of extra) for (const l of readJsonl(p)) if (ok(l) && l.text) add(l.uid, { label: l.label, text: cardText(l.text), pin: l.pin ?? null, source: p });
  return idx;
}

const readText = (p) => (existsSync(p) ? parseCensus(readFileSync(p, "utf8")).proposals : []);

export function measure({ census, text, rows = [], extra = [] }) {
  const idx = index(rows, extra);
  const cards = [];
  for (const view of ["default", "optin"]) {
    const dir = join(census, view);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const [pool, repo] = f.replace(/\.json$/, "").split("__");
      let j;
      try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { cards.push({ view, pool, repo, failed: true }); continue; }
      const blocks = new Map(readText(join(text, view, f.replace(/\.json$/, ".txt"))).map((p) => [p.id, p.block]));
      for (const p of j.proposals ?? []) {
        const uid = `${pool}:${repo}/${p.id}`;
        const t = blocks.has(p.id) ? cardText(blocks.get(p.id)) : null;
        const hits = idx.get(uid) ?? [];
        const same = t == null ? [] : hits.filter((h) => h.text === t);
        const use = same.at(-1) ?? null;
        cards.push({
          view, pool, repo, id: p.id, uid, language: p.language, tier: p.tier, rule_kind: p.rule_kind, shown_by_default: !!p.shown_by_default,
          outliers: (p.evidence?.total ?? 0) - (p.evidence?.holders ?? 0),
          label: use?.label ?? null, label_source: use?.source ?? null,
          status: use ? "labelled" : hits.length ? (t == null ? "no_text" : "changed") : "none",
          uid_labels: hits.map((h) => `${h.source}:${h.label}`),
          summary: p.summary,
        });
      }
    }
  }
  return cards;
}

export function d4(cards) {
  const out = {};
  for (const [lang, view] of [["ts", "default"], ["py", "optin"]]) {
    const shown = cards.filter((c) => !c.failed && c.view === view && c.language === lang);
    for (const [scope, set] of [["all_listed", shown], ["listed_by_default", shown.filter((c) => c.shown_by_default)]]) {
      const lab = set.filter((c) => c.status === "labelled");
      const nw = lab.filter((c) => c.label !== "WRONG").length;
      const w = wilson(nw, lab.length);
      const byPool = {};
      for (const c of set) {
        const b = (byPool[c.pool] ??= { shown: 0, labelled: 0, not_wrong: 0, default_tier: 0 });
        b.shown += 1;
        if (c.tier === "default") b.default_tier += 1;
        if (c.status === "labelled") { b.labelled += 1; if (c.label !== "WRONG") b.not_wrong += 1; }
      }
      (out[lang] ??= {})[scope] = {
        view, shown: set.length, default_tier: set.filter((c) => c.tier === "default").length, labelled: lab.length,
        accept: lab.filter((c) => c.label === "ACCEPT").length, trivial: lab.filter((c) => c.label === "TRIVIAL").length, wrong: lab.length - nw,
        not_wrong: nw, d4: lab.length ? +(nw / lab.length).toFixed(4) : null, wilson95: lab.length ? [+w.lo.toFixed(4), +w.hi.toFixed(4)] : null,
        unlabelled: set.length - lab.length, unlabelled_changed: set.filter((c) => c.status === "changed").length,
        repos_with_cards: new Set(set.map((c) => `${c.pool}:${c.repo}`)).size, by_pool: byPool,
      };
    }
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2), { defaults: {} });
  const list = (s) => (s ? String(s).split(",").filter(Boolean) : []);
  const cards = measure({ census: a.census, text: a.text, rows: list(a.rows), extra: list(a.extra) });
  const res = { census: a.census, failed: cards.filter((c) => c.failed).map((c) => `${c.view}:${c.pool}:${c.repo}`), d4: d4(cards) };
  console.log(JSON.stringify(res, null, 1));
  if (a.json) writeFileSync(a.json, JSON.stringify(res, null, 1) + "\n");
  if (a.cards) writeFileSync(a.cards, cards.map((c) => JSON.stringify(c)).join("\n") + "\n");
}
