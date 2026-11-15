#!/usr/bin/env node
// The show policy (eval/study/PLAN-R10.md §4, WS-B): which suggestion-tier cards Drift shows at all. Writes the table
// the product reads (crates/drift-mine/data/show-policy.json, `drift_mine::show`). A suggestion is shown only when
//   - it has at most `max_outliers` outliers (1), and
//   - its rule family is admitted for its language by the leave-one-repo-out (LORO) family table: with any one dev
//     repo's cards left out, the family's suggestion-tier accept on the other dev repos is >= bar.min_accept with
//     >= bar.min_cards labelled cards (60% of 5), and
//   - its family is not hidden outright for its language (`hidden`: call order in both languages, PLAN-R10 I1; TS
//     rendered components and calls, Python package and repo facts, I2).
// The default tier is not affected. A hidden card is gone from every surface (census, init, check, hooks, MCP, PR
// mode, SARIF, the AGENTS.md export, the Studio), not moved behind a flag (PLAN-R10 §6).
//
//   node eval/study/show-policy.mjs --run eval/study/runs/<run> [--out crates/drift-mine/data/show-policy.json]
//   node eval/study/show-policy.mjs --run eval/study/runs/<run> --check   (exit 1 when the committed table differs)
//
// [STRICT] LORO admission is the minimum over left-out repos: a family is admitted only when it meets the bar
// whichever single dev repo is left out (so with at least 2 repos), never because of one repo's labels. Counts are
// per repo, per language of the proposal (lib.mjs proposalLanguage: a TS card in a Python repo counts as TS), over
// suggestion-tier cards of the run's D7 view (`<part>/views/d7/queue.json`) with their final labels
// (`<part>/final.jsonl`); a card without a label counts as not accepted. polar and CTFd are left out (never scanned).
// Dev build-set data only. Refuses a held-out run always, and a run that names a blind dev pool (in its path, or as
// the pool of a repo, `dev3:P04`) until that pool's report is in the tree (lib.mjs BLIND_POOLS): a pool joins the build
// set after its report (PLAN-R10 section 3.4, PLAN-R11 sections 0 and 4.2), not before, and not by how a run is named.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { kindFamilies } from "./family-admission.mjs";
import { blindPoolProblem, blindPoolsNamed, die, familyOf, parseArgs, proposalLanguage, readJson, readJsonl, repoRootDir, sha256File } from "./lib.mjs";

export const DEFAULT_OUT = "crates/drift-mine/data/show-policy.json";
export const BAR = { min_accept: 0.6, min_cards: 5 };
export const MAX_OUTLIERS = 1;
// PLAN-R10 §2.3 (I1, I2): decisions of the plan, not derived from labels; kept even when a later run would admit them.
export const HIDDEN = { ts: ["calls", "ordering", "renders"], py: ["ordering", "repo"] };
export const EXCLUDED_REPOS = ["CTFd", "polar"];

// k of n meets the bar, in integers as drift_mine::show does: n >= min_cards and k * 100 >= round(min_accept * 100) * n.
export const meets = (k, n, bar = BAR) => k <= n && n >= bar.min_cards && k * 100 >= Math.round(bar.min_accept * 100) * n;

// The family's counts with each repo left out, and whether every one meets the bar (at least 2 repos).
export function loro(repos, bar = BAR) {
  const names = Object.keys(repos).sort();
  const A = names.reduce((s, r) => s + repos[r].accepted, 0);
  const N = names.reduce((s, r) => s + repos[r].n, 0);
  const out = Object.fromEntries(names.map((r) => [r, { accepted: A - repos[r].accepted, n: N - repos[r].n }]));
  const admitted = names.length >= 2 && names.every((r) => meets(out[r].accepted, out[r].n, bar));
  return { without: out, admitted };
}

// Why the run at `rel`, whose queues name these repos, cannot be a source of the table; null when it can. A held-out
// run never can. A blind dev pool the path or a repo names must have its report in the tree (`exists`: for tests).
export function runProblem(rel, repos = [], exists = existsSync) {
  if (!/^eval\/study\/runs\/dev-[\w.-]+$/.test(rel) || /heldout|holdout/i.test(rel)) return "expected a dev build-set run under eval/study/runs";
  for (const pool of blindPoolsNamed([rel, ...repos].join("\n"))) {
    const why = blindPoolProblem(pool, exists);
    if (why) return why;
  }
  return null;
}

export function showTable(runDir) {
  const rel = relative(repoRootDir, join(repoRootDir, runDir)).split("\\").join("/");
  const refused = runProblem(rel);
  if (refused) die(`${runDir}: ${refused}`);
  const abs = join(repoRootDir, rel);
  const parts = readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(abs, d.name, "views/d7/queue.json")) && existsSync(join(abs, d.name, "final.jsonl")))
    .map((d) => d.name)
    .sort();
  if (!parts.length) die(`${rel}: no <part>/views/d7/queue.json with <part>/final.jsonl`);
  const counts = { ts: {}, py: {} };
  const sources = [];
  const named = new Set();
  for (const part of parts) {
    const qPath = `${rel}/${part}/views/d7/queue.json`;
    const lPath = `${rel}/${part}/final.jsonl`;
    const labels = new Map(readJsonl(join(repoRootDir, lPath)).map((r) => [r.uid, r.label]));
    let cards = 0;
    for (const it of readJson(join(repoRootDir, qPath)).items) {
      named.add(String(it.repo));
      if (EXCLUDED_REPOS.includes(it.repo) || it.tier !== "suggestion") continue;
      const lang = proposalLanguage(it);
      const fam = familyOf(it);
      const r = ((counts[lang][fam] ??= {})[it.repo] ??= { accepted: 0, n: 0 });
      r.n += 1;
      if (labels.get(it.uid) === "ACCEPT") r.accepted += 1;
      cards += 1;
    }
    sources.push({ queue: qPath, queue_sha256: sha256File(join(repoRootDir, qPath)), labels: lPath, labels_sha256: sha256File(join(repoRootDir, lPath)), suggestion_cards: cards });
  }
  // The pools its cards come from, by repo name: each must have reported.
  const blind = runProblem(rel, [...named]);
  if (blind) die(`${runDir}: ${blind}`);
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
  return {
    "//": "Generated by eval/study/show-policy.mjs; do not edit by hand. What Drift shows at all (eval/study/PLAN-R10.md §4): a suggestion-tier card is shown only with at most max_outliers outliers and a rule family admitted for its language: not hidden, and with any one dev repo left out, the family's suggestion-tier accept on the other repos meets bar (leave-one-repo-out, minimum over repos). The product recomputes that from `repos`, so an edited `admitted` cannot admit a family. Default-tier cards are not affected. A rule kind mapped to null, a family with no entry for the language, or a missing table shows no suggestion. Dev, in-sample counts.",
    schema: 1,
    regenerate: `node eval/study/show-policy.mjs --run ${rel}`,
    source: { run: rel, date: rel.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, view: "d7", excluded_repos: EXCLUDED_REPOS, parts: sources },
    bar: { ...BAR, over: "suggestion_tier", rate: "ACCEPT / labelled", admission: "leave_one_repo_out_min" },
    max_outliers: MAX_OUTLIERS,
    hidden: HIDDEN,
    hidden_because: "eval/study/PLAN-R10.md §2.3: I1 (call order, both languages), I2 (TS rendered components and calls, Python package and repo facts)",
    rule_kinds: kindFamilies(),
    languages,
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2), { flags: ["check"], defaults: { out: DEFAULT_OUT } });
  if (!args.run) die("missing --run eval/study/runs/<run>");
  const out = join(repoRootDir, args.out);
  const text = JSON.stringify(showTable(args.run), null, 1) + "\n";
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
    for (const [lang, fams] of Object.entries(t.languages))
      console.log(`${lang}: admitted ${Object.entries(fams).filter(([, v]) => v.admitted).map(([f, v]) => `${f} (${v.accepted}/${v.n}, LORO min ${(100 * v.loro_min_rate).toFixed(1)}%)`).join(", ") || "none"}`);
    console.log(`wrote ${args.out}`);
  }
}
