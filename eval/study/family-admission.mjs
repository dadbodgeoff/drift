#!/usr/bin/env node
// Family admission for suggestions (eval/study/PLAN-ROUND8.md, W0): which suggestion-tier rule families Drift
// shows to agents. A family is admitted, per language, when its suggestion-tier accept rate on the latest
// labelled dev run is >= 85% with >= 10 labelled cards. Writes the table the product reads
// (crates/drift-mine/data/family-admission.json, `drift_mine::admission`). Regenerate after every relabel:
//
//   node eval/study/family-admission.mjs --run eval/study/runs/<run> [--out crates/drift-mine/data/family-admission.json]
//   node eval/study/family-admission.mjs --run eval/study/runs/<run> --check   (exit 1 when the committed table differs)
//   node eval/study/family-admission.mjs --run eval/study/runs/<run> --min-accept 0.75 --min-cards 10   (change the bar)
//
// The bar is data: it is kept in the table (`bar`), which the product reads; regenerating keeps the committed
// table's bar unless --min-accept / --min-cards change it (DEFAULT_BAR only when there is no table yet).
//
// Reads every `<run>/<part>/metrics.json` (a part per dev set: ts, py, py2), scored with final labels. The
// counts are the parts' `by_language[].families[].suggestion_tier` (the language's own proposals, D7 tier),
// summed per language and family. Families are the study's (lib.mjs `familyOf`), keyed as the Studio's track
// record keys them (`studioFamilies()`, derived from the Studio's rule-kind-family.json, the one family mapping). Each rule
// kind the product emits (lib.mjs `RULE_KINDS`) is mapped to its family with `familyOf`, so the product never
// keeps a mapping of its own; a kind whose family is `other` maps to null (never admitted). Refuses a held-out
// run: dev data only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { FAMILIES, LANGUAGE_ROWS, RULE_KINDS, die, familyOf, parseArgs, readJson, repoRootDir, ruleOfKind, sha256File, studioFamilies } from "./lib.mjs";

export { ruleOfKind };

// The bar a first table gets (PLAN-ROUND8.md W0); after that the committed table's own `bar` is kept.
export const DEFAULT_BAR = { min_accept: 0.85, min_cards: 10 };
export const DEFAULT_OUT = "crates/drift-mine/data/family-admission.json";

export function kindFamilies() {
  const out = {};
  for (const k of RULE_KINDS) {
    const f = familyOf({ rule: ruleOfKind(k), summary: "" });
    out[k] = f === "other" || !studioFamilies()[f] ? null : f;
  }
  return out;
}

// Whether k of n meets the bar, in integers (no rounding at the edge), as drift_mine::admission::Bar::met does:
// n >= min_cards and k * 100 >= round(min_accept * 100) * n.
export const admitted = (k, n, bar = DEFAULT_BAR) => k <= n && n >= bar.min_cards && k * 100 >= Math.round(bar.min_accept * 100) * n;

export function checkBar(bar) {
  if (!bar || !Number.isFinite(bar.min_accept) || bar.min_accept <= 0 || bar.min_accept > 1 || !Number.isInteger(bar.min_cards) || bar.min_cards < 1) die(`invalid bar ${JSON.stringify(bar)}: min_accept in (0, 1], min_cards a positive integer`);
  return { min_accept: bar.min_accept, min_cards: bar.min_cards };
}

export function admissionTable(runDir, bar = DEFAULT_BAR) {
  bar = checkBar(bar);
  const rel = relative(repoRootDir, join(repoRootDir, runDir)).split("\\").join("/");
  if (!/^eval\/study\/runs\/[\w.-]+$/.test(rel) || /heldout/i.test(rel)) die(`${runDir}: expected a dev run under eval/study/runs`);
  const abs = join(repoRootDir, rel);
  const parts = readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(abs, d.name, "metrics.json")))
    .map((d) => d.name)
    .sort();
  if (!parts.length) die(`${rel}: no <part>/metrics.json`);
  const sums = { ts: {}, py: {} };
  const sources = [];
  for (const part of parts) {
    const path = `${rel}/${part}/metrics.json`;
    const m = readJson(join(repoRootDir, path));
    if (m.manifest?.holdout || (m.manifest?.holdout_because ?? []).length) die(`${path}: a held-out run; the admission table is for dev runs only`);
    if (m.kind !== "precision") die(`${path}: kind ${m.kind}, expected precision`);
    if (!Array.isArray(m.by_language)) die(`${path}: no by_language (re-score it with the current metrics.mjs)`);
    for (const [lang, row] of Object.entries(LANGUAGE_ROWS)) {
      const g = m.by_language.find((x) => x.language === row);
      for (const f of g?.families ?? []) {
        const s = f.suggestion_tier;
        if (!s || !Number.isInteger(s.labelled) || !Number.isInteger(s.ACCEPT)) die(`${path}: ${row} ${f.family} has no suggestion_tier counts`);
        if (!s.labelled) continue;
        const t = (sums[lang][f.family] ??= { accepted: 0, n: 0 });
        t.accepted += s.ACCEPT;
        t.n += s.labelled;
      }
    }
    sources.push({ path, sha256: sha256File(join(repoRootDir, path)), scored: m.run, manifest: m.manifest?.path ?? null, labels: m.labels ?? null, rubric: m.rubric ?? null, tier: m.tier?.definition?.decision ?? null });
  }
  const languages = {};
  for (const [lang, fams] of Object.entries(sums)) {
    languages[lang] = {};
    for (const f of Object.keys(fams).sort()) {
      const { accepted, n } = fams[f];
      languages[lang][f] = { accepted, n, rate: Math.round((accepted / n) * 1000) / 1000, admitted: admitted(accepted, n, bar) };
    }
  }
  const families = {};
  for (const [f, studio] of Object.entries(studioFamilies())) families[f] = { name: FAMILIES[f], studio };
  return {
    "//": "Generated by eval/study/family-admission.mjs; do not edit by hand (change the bar with --min-accept / --min-cards). Which suggestion-tier rule families Drift shows to agents (hooks, MCP, `drift check` text, AGENTS.md export): a family is admitted, per language, when its suggestion-tier accept rate on the latest labelled dev run is >= bar.min_accept with >= bar.min_cards labelled cards; the product reads the bar from here. Default-tier conventions are always shown. A rule kind mapped to null, a family with no entry for the language, or a missing table is not admitted. Dev, in-sample figures.",
    schema: 1,
    regenerate: `node eval/study/family-admission.mjs --run ${rel}`,
    source: { run: rel, date: rel.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, parts: sources },
    bar: { ...bar, over: "suggestion_tier", rate: "ACCEPT / labelled" },
    rule_kinds: kindFamilies(),
    families,
    languages,
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { flags: ["check"], defaults: { out: DEFAULT_OUT } });
  if (!args.run) die("missing --run eval/study/runs/<run>");
  const out = join(repoRootDir, args.out);
  const kept = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")).bar : null;
  const bar = { ...(kept ? { min_accept: kept.min_accept, min_cards: kept.min_cards } : DEFAULT_BAR) };
  if (args.minAccept !== undefined) bar.min_accept = Number(args.minAccept);
  if (args.minCards !== undefined) bar.min_cards = Number(args.minCards);
  const text = JSON.stringify(admissionTable(args.run, bar), null, 1) + "\n";
  if (args.check) {
    const now = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (now !== text) {
      console.error(`${args.out} is not what ${args.run} gives: run without --check to regenerate it`);
      process.exit(1);
    }
    console.log(`${args.out} is current`);
  } else {
    writeFileSync(out, text);
    const t = JSON.parse(text);
    for (const [lang, fams] of Object.entries(t.languages)) {
      const ok = Object.entries(fams).filter(([, v]) => v.admitted).map(([f]) => f);
      console.log(`${lang}: ${ok.length ? ok.join(", ") : "no family"} admitted`);
    }
    console.log(`wrote ${args.out}`);
  }
}
