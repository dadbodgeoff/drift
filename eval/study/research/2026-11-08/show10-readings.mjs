#!/usr/bin/env node
// WS-B (PLAN-R10 §4): the show policy's census diff on the dev clones and its readings. Dev data only.
//
//   node eval/study/research/2026-11-08/show10-readings.mjs <census-before> <census-after> [--json out.json]
//
// <census-*> hold `<part>/<repo>.json` from `drift census --json --all --all-outliers --max 15` (release builds of
// main and of the branch) on the 34 dev clones. Prints every removed id with its tier, family and v3 label (the
// newest labels, relabel5, for the card id), the default-tier changes (must be none), and three readings of the policy
// (PLAN-R10 §3.3), each by dev set as §4 reports them (TS/JS: `ts`; Python: `py` + `py2`):
//   - in-sample: accept over all shown on the census after, with relabel5's labels (a card without one counts as
//     not accepted);
//   - undo-named: relabel5's cards with every change a round 4-9 PR names by id undone against dev-v3
//     (r10-history.mjs §2), then the policy applied;
//   - dev-v3: the policy (the committed table, frozen) applied to the dev-v3 cards and labels;
// and the leave-one-repo-out reading: each repo's cards judged by a table built without that repo's labels.
// The fold readings are generalise.mjs's (show10-generalise.out.txt: `generalise.mjs --before --after --design-folds none`
// on the same census, one <repo>.json per repo). Outputs at the branch: show10-readings.out.txt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { familyOf, proposalLanguage } from "../../lib.mjs";
import { loro } from "../../show-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const runs = path.join(root, "eval/study/runs");
const table = JSON.parse(fs.readFileSync(path.join(root, "crates/drift-mine/data/show-policy.json"), "utf8"));
const EXCLUDED = new Set(table.source.excluded_repos);
const PARTS = ["ts", "py", "py2"];
const SET = { ts: "TS", py: "Py", py2: "Py" };
const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) throw new Error("usage: show10-readings.mjs <census-before> <census-after> [--json out]");

const readJsonl = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pct = (a, n) => (n ? `${((100 * a) / n).toFixed(1)}% (${a}/${n})` : "n/a");
const outliersOf = (c) => Math.max(0, (c.evidence?.total ?? 0) - (c.evidence?.holders ?? 0));

// The product's rule (drift_mine::show) on a card: default tier, or <= max_outliers and an admitted family.
const admits = (t, lang, fam) => {
  const r = t.languages[lang]?.[fam];
  return !!r && !t.hidden[lang].includes(fam) && r.admitted && loro(r.repos).admitted;
};
const shown = (t, c) => c.tier === "default" || (outliersOf(c) <= t.max_outliers && admits(t, proposalLanguage(c), familyOf(c)));

function census(dir) {
  const m = new Map();
  for (const part of PARTS) {
    const d = path.join(dir, part);
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
      const repo = f.replace(/\.json$/, "");
      if (EXCLUDED.has(repo)) continue;
      const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
      for (const p of j.proposals) m.set(`${repo}/${p.id}`, { ...p, uid: `${repo}/${p.id}`, repo, part, python_members: p.evidence?.python_members, example: `${p.example.path}#${p.example.symbol}` });
    }
  }
  return m;
}

// Labels and cards of a label run (its D7 view).
function snap(run, parts = PARTS) {
  const cards = new Map();
  for (const part of parts) {
    const dir = path.join(runs, run, part);
    if (!fs.existsSync(dir)) continue;
    const labels = new Map(readJsonl(path.join(dir, "final.jsonl")).map((r) => [r.uid, r.label]));
    for (const it of JSON.parse(fs.readFileSync(path.join(dir, "views/d7/queue.json"), "utf8")).items) {
      if (EXCLUDED.has(it.repo)) continue;
      cards.set(it.uid, { ...it, part, label: labels.get(it.uid) ?? "UNLABELLED" });
    }
  }
  return cards;
}

const before = census(beforeDir);
const after = census(afterDir);
const r5 = snap("dev-v3-relabel5-2026-11-07");
const v3 = snap("dev-v3-2026-11-06");
const isA = (c) => c?.label === "ACCEPT";
const label = (uid) => r5.get(uid)?.label ?? "UNLABELLED";
const out = {};
const log = (...a) => console.log(...a);

// 1. Census diff.
const removed = [...before.values()].filter((c) => !after.has(c.uid));
const added = [...after.values()].filter((c) => !before.has(c.uid));
const changedTier = [...after.values()].filter((c) => before.has(c.uid) && before.get(c.uid).tier !== c.tier);
const defaultChanges = [...removed, ...added, ...changedTier].filter((c) => c.tier === "default" || before.get(c.uid)?.tier === "default");
log(`## 1. Census diff: before ${before.size} cards, after ${after.size}; removed ${removed.length}, added ${added.length}, tier changed ${changedTier.length}; default-tier changes ${defaultChanges.length}`);
const why = (c) => {
  const lang = proposalLanguage(c), fam = familyOf(c);
  if (table.hidden[lang].includes(fam)) return "hidden family";
  if (!admits(table, lang, fam)) return "family not admitted";
  if (outliersOf(c) > table.max_outliers) return "outliers > 1";
  return "?";
};
out.removed = removed.map((c) => ({ uid: c.uid, set: SET[c.part], lang: proposalLanguage(c), tier: c.tier, family: familyOf(c), outliers: outliersOf(c), label: label(c.uid), why: why(c) }));
for (const r of out.removed) log(`  ${r.uid} ${r.set}/${r.lang} ${r.tier} ${r.family} outliers=${r.outliers} ${r.label} (${r.why})`);
out.added = added.map((c) => c.uid);
out.default_changes = defaultChanges.map((c) => c.uid);
const byFam = {};
for (const r of out.removed) {
  const k = `${r.lang} ${r.tier} ${r.family}`;
  byFam[k] ??= { n: 0, ACCEPT: 0, TRIVIAL: 0, WRONG: 0, UNLABELLED: 0 };
  byFam[k].n += 1;
  byFam[k][r.label] += 1;
}
out.removed_by_family = byFam;
log("  removed by language, tier and family (v3 labels):");
for (const [k, v] of Object.entries(byFam).sort()) log(`    ${k}: ${v.n} (ACCEPT ${v.ACCEPT}, TRIVIAL ${v.TRIVIAL}, WRONG ${v.WRONG}, unlabelled ${v.UNLABELLED})`);
const unlabelledAfter = [...after.values()].filter((c) => !r5.has(c.uid)).map((c) => c.uid);
log(`  census-before cards without a relabel5 label: ${[...before.values()].filter((c) => !r5.has(c.uid)).length}; after: ${unlabelledAfter.length}`);

// 2. In-sample, by dev set, before and after.
const rate = (cs) => [cs.filter((c) => label(c.uid) === "ACCEPT").length, cs.length];
const notWrong = (cs) => [cs.filter((c) => ["ACCEPT", "TRIVIAL"].includes(label(c.uid))).length, cs.length];
const repos = (set) => [...new Set([...before.values()].filter((c) => SET[c.part] === set).map((c) => c.repo))];
const allRepos = (set) => {
  const s = new Set();
  for (const part of PARTS.filter((p) => SET[p] === set)) for (const f of fs.readdirSync(path.join(beforeDir, part))) if (f.endsWith(".json") && !EXCLUDED.has(f.slice(0, -5))) s.add(f.slice(0, -5));
  return [...s].sort();
};
out.in_sample = {};
log("\n## 2. In-sample (relabel5 labels on the census), by dev set");
for (const set of ["TS", "Py"]) {
  const b = [...before.values()].filter((c) => SET[c.part] === set);
  const a = [...after.values()].filter((c) => SET[c.part] === set);
  const rs = allRepos(set);
  const per = rs.map((r) => {
    const sa = a.filter((c) => c.repo === r && c.tier === "suggestion");
    const sb = b.filter((c) => c.repo === r && c.tier === "suggestion");
    const da = a.filter((c) => c.repo === r && c.tier === "default");
    return { repo: r, suggestions_before: sb.length, suggestions_after: sa.length, accepted_suggestions_after: rate(sa)[0], default: da.length, accepts_after: rate(a.filter((c) => c.repo === r))[0], accepts_before: rate(b.filter((c) => c.repo === r))[0] };
  });
  const row = {
    repos: rs.length, repos_with_cards_before: repos(set).length,
    before: rate(b), after: rate(a), not_wrong_before: notWrong(b), not_wrong_after: notWrong(a),
    default_after: rate(a.filter((c) => c.tier === "default")), suggestion_after: rate(a.filter((c) => c.tier === "suggestion")),
    wrong_after: a.filter((c) => label(c.uid) === "WRONG").length, wrong_before: b.filter((c) => label(c.uid) === "WRONG").length,
    per_repo: per, zero_suggestions: per.filter((x) => !x.suggestions_after).map((x) => x.repo),
  };
  out.in_sample[set] = row;
  const n = rs.length, wc = repos(set).length;
  log(`${set} (${n} repos, ${wc} with cards): before ${pct(...row.before)}, not-wrong ${pct(...row.not_wrong_before)}, WRONG ${row.wrong_before}; after ${pct(...row.after)}, not-wrong ${pct(...row.not_wrong_after)}, WRONG ${row.wrong_after}`);
  log(`   after: default ${pct(...row.default_after)}; suggestions ${pct(...row.suggestion_after)}; accepts/repo (repos with cards before) ${(row.before[0] / wc).toFixed(2)} -> ${(row.after[0] / wc).toFixed(2)}; cards/repo ${(row.before[1] / wc).toFixed(1)} -> ${(row.after[1] / wc).toFixed(1)}`);
  log(`   per repo (accepts before -> after; suggestions shown before -> after, accepted after): ${per.map((x) => `${x.repo} ${x.accepts_before}->${x.accepts_after} [${x.suggestions_before}->${x.suggestions_after}, ${x.accepted_suggestions_after}A]`).join("; ")}`);
  log(`   repos left with 0 suggestions (${row.zero_suggestions.length} of ${n}): ${row.zero_suggestions.join(", ")}`);
}

// 3. Undo-named reading (r10-history.mjs §2): relabel5's cards with every change a round 4-9 PR names undone against
//    dev-v3, then the policy. Ids are content hashes; a PR "names" a card when its body cites the id.
const prs = JSON.parse(fs.readFileSync(path.join(here, "pr-mentions.json"), "utf8")).prs;
const idRepo = new Map();
const collide = new Set();
for (const c of [...v3.values(), ...r5.values()]) {
  const id = c.uid.split("/")[1];
  if (idRepo.has(id) && idRepo.get(id) !== c.repo) collide.add(id);
  idRepo.set(id, c.repo);
}
// r10-history resolves ids over every snapshot; read the others too so the same ids resolve.
for (const run of ["dev-v3-relabel2-2026-11-07", "dev-v3-relabel3-2026-11-07", "dev-v3-relabel4-2026-11-07"])
  for (const c of snap(run).values()) {
    const id = c.uid.split("/")[1];
    if (idRepo.has(id) && idRepo.get(id) !== c.repo) collide.add(id);
    idRepo.set(id, c.repo);
  }
for (const pr of prs) pr.uids = pr.ids.filter((i) => idRepo.has(i) && !collide.has(i)).map((i) => `${idRepo.get(i)}/${i}`);
const ROUNDS = [4, 5, 6, 8, 9];
const named = (uid) => prs.some((p) => ROUNDS.includes(p.round) && p.uids.includes(uid));
function undoNamed(set) {
  const cards = [];
  for (const c of r5.values()) {
    if (SET[c.part] !== set) continue;
    const b = v3.get(c.uid);
    if (!named(c.uid)) cards.push(c);
    else if (b) cards.push({ ...c, label: b.label }); // flipped back to its dev-v3 label
    // a named new card is removed
  }
  for (const b of v3.values()) if (SET[b.part] === set && !r5.has(b.uid) && named(b.uid)) cards.push(b); // a named hidden card returns
  return cards;
}
out.undo_named = {};
out.dev_v3 = {};
out.loro = {};
const lr = (cs) => [cs.filter(isA).length, cs.length];
log("\n## 3. Undo-named and dev-v3 readings, by dev set (policy = the committed table, frozen)");
for (const set of ["TS", "Py"]) {
  const u = undoNamed(set);
  const us = u.filter((c) => shown(table, c));
  out.undo_named[set] = { all: lr(u), policy: lr(us), wrong_policy: us.filter((c) => c.label === "WRONG").length };
  const v = [...v3.values()].filter((c) => SET[c.part] === set);
  const vs = v.filter((c) => shown(table, c));
  const vrepos = new Set(v.map((c) => c.repo)).size;
  out.dev_v3[set] = { all: lr(v), policy: lr(vs), wrong_policy: vs.filter((c) => c.label === "WRONG").length, default: lr(vs.filter((c) => c.tier === "default")), suggestions: lr(vs.filter((c) => c.tier === "suggestion")), repos: vrepos };
  log(`${set} undo-named: all shown ${pct(...out.undo_named[set].all)} -> policy ${pct(...out.undo_named[set].policy)} (WRONG ${out.undo_named[set].wrong_policy})`);
  log(`${set} dev-v3: all shown ${pct(...out.dev_v3[set].all)} -> policy ${pct(...out.dev_v3[set].policy)} (WRONG ${out.dev_v3[set].wrong_policy}; default ${pct(...out.dev_v3[set].default)}, suggestions ${pct(...out.dev_v3[set].suggestions)}; ${(out.dev_v3[set].policy[0] / vrepos).toFixed(2)} accepts/repo over ${vrepos} repos)`);
}

// 4. Leave-one-repo-out reading on relabel5: each repo's cards judged by a table recounted without its labels.
log("\n## 4. Leave-one-repo-out reading (relabel5): each repo judged by the table without its own labels");
for (const set of ["TS", "Py"]) {
  const cs = [...r5.values()].filter((c) => SET[c.part] === set);
  let a = 0, n = 0, w = 0;
  for (const r of [...new Set(cs.map((c) => c.repo))]) {
    const t = structuredClone(table);
    for (const fams of Object.values(t.languages))
      for (const rec of Object.values(fams))
        if (rec.repos[r]) {
          rec.accepted -= rec.repos[r].accepted;
          rec.n -= rec.repos[r].n;
          delete rec.repos[r];
          rec.admitted = loro(rec.repos).admitted;
        }
    const s = cs.filter((c) => c.repo === r && shown(t, c));
    a += s.filter(isA).length; n += s.length; w += s.filter((c) => c.label === "WRONG").length;
  }
  out.loro[set] = { policy: [a, n], wrong: w };
  log(`${set}: ${pct(a, n)} (WRONG ${w})`);
}

const j = process.argv.indexOf("--json");
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1) + "\n");
