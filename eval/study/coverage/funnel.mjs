#!/usr/bin/env node
// The yield funnel of a pool (map11, round 11): where the coverage of conventions dies.
//
//   node eval/study/coverage/funnel.mjs RUN/<variant> [--folds eval/study/folds-r11.json] [--json OUT]
//
// Reads the `<repo>.funnel.json.gz` files `map-coverage.mjs run` writes (the counts
// `census --json` writes to DRIFT_FUNNEL, crates/drift-mine/src/funnel.rs) and prints,
// summed over the pool and per fold:
//   - roles by keying (kind / path / package) and how many reach the miner's size bars;
//   - for each rule family (and keying), what reaches each stage and what each gate drops,
//     from the candidate rules a role's members have down to the shown cards;
//   - cards per mined role and per keying.
// Aggregates only: no card, role or file name is printed.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

/** The stages, in mining order (crates/drift-mine/src/funnel.rs `STAGES`). */
export const REACH = ["roles", "role_mined", "observed", "drafted", "mined", "proposed", "shown"];

/** Rows `{family, keying, lang, stage, n}` of many repositories, summed by `key(row)`. */
export function sum(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key(r);
    out[k] ??= {};
    out[k][r.stage] = (out[k][r.stage] ?? 0) + r.n;
  }
  return out;
}

/** The base family of a funnel family (`test:calls` -> `calls`), and whether it is a test role's. */
export const splitFamily = (f) => (f.startsWith("test:") ? [f.slice(5), true] : [f, false]);

/** Per family (and keying): reached counts and drops, with the first gate that drops most. */
export function families(rows) {
  const by = sum(rows.filter((r) => r.family !== "-"), (r) => `${r.family}\t${r.keying}\t${r.lang}`);
  const out = [];
  for (const [k, stages] of Object.entries(by)) {
    const [family, keying, lang] = k.split("\t");
    const drops = Object.entries(stages).filter(([s]) => !REACH.includes(s) && s !== "not_listed");
    drops.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push({
      family,
      keying,
      lang,
      observed: stages.observed ?? 0,
      drafted: stages.drafted ?? 0,
      mined: stages.mined ?? 0,
      proposed: stages.proposed ?? 0,
      shown: stages.shown ?? 0,
      not_listed: stages.not_listed ?? 0,
      top_gate: drops[0]?.[0] ?? null,
      drops: Object.fromEntries(drops),
    });
  }
  out.sort((a, b) => b.drafted - a.drafted || b.observed - a.observed || a.family.localeCompare(b.family) || a.keying.localeCompare(b.keying) || a.lang.localeCompare(b.lang));
  return out;
}

/** Roles by keying and language: groups, mined-size roles, cards mined and shown on them. */
export function keyings(rows) {
  const roles = sum(rows.filter((r) => r.family === "-"), (r) => `${r.keying}\t${r.lang}`);
  const cards = sum(rows.filter((r) => r.family !== "-"), (r) => `${r.keying}\t${r.lang}`);
  const keys = [...new Set([...Object.keys(roles), ...Object.keys(cards)])].sort();
  return keys.map((k) => {
    const [keying, lang] = k.split("\t");
    const r = roles[k] ?? {};
    const c = cards[k] ?? {};
    const mined = c.mined ?? 0;
    return {
      keying,
      lang,
      groups: r.roles ?? 0,
      too_small: r.role_small ?? 0,
      one_file: r.role_one_file ?? 0,
      roles: r.role_mined ?? 0,
      drafted: c.drafted ?? 0,
      mined,
      shown: c.shown ?? 0,
      mined_per_100_roles: r.role_mined ? Math.round((10000 * mined) / r.role_mined) / 100 : 0,
    };
  });
}

function load(dir) {
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".funnel.json.gz")).sort())
    out[f.replace(/\.funnel\.json\.gz$/, "")] = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")).rows;
  return out;
}

function main(args) {
  const dir = resolve(args[0]);
  const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const folds = JSON.parse(readFileSync(get("--folds") ?? "eval/study/folds-r11.json", "utf8"));
  const foldOf = {};
  for (const f of folds.folds) for (const r of [...f.ts, ...f.py]) foldOf[r] = f.fold;
  const byRepo = load(dir);
  const all = Object.values(byRepo).flat();
  const perFold = {};
  for (const [repo, rows] of Object.entries(byRepo)) (perFold[foldOf[repo] ?? "-"] ??= []).push(...rows);
  const fam = families(all);
  const keys = keyings(all);
  console.log(`Repositories: ${Object.keys(byRepo).length}\n\nRoles and cards by keying:`);
  console.log("  keying   lang  groups  too_small  one_file  roles  drafted  mined  shown  mined/100 roles");
  for (const k of keys) console.log(`  ${k.keying.padEnd(8)} ${k.lang.padEnd(4)} ${String(k.groups).padStart(7)} ${String(k.too_small).padStart(10)} ${String(k.one_file).padStart(9)} ${String(k.roles).padStart(6)} ${String(k.drafted).padStart(8)} ${String(k.mined).padStart(6)} ${String(k.shown).padStart(6)} ${String(k.mined_per_100_roles).padStart(8)}`);
  console.log("\nFamilies (observed -> drafted -> mined -> proposed -> shown; the gates that drop most):");
  for (const f of fam.filter((f) => f.observed + f.drafted > 0).slice(0, Number(get("--top") ?? 40))) {
    const gates = Object.entries(f.drops).slice(0, 4).map(([g, n]) => `${g} ${n}`).join(", ");
    console.log(`  ${f.family.padEnd(26)} ${f.keying.padEnd(7)} ${f.lang}  ${f.observed} -> ${f.drafted} -> ${f.mined} -> ${f.proposed} -> ${f.shown}   [${gates}]`);
  }
  console.log("\nPer fold: roles, drafted, mined, proposed, shown");
  for (const [fold, rows] of Object.entries(perFold).sort()) {
    const t = sum(rows, () => "all").all ?? {};
    console.log(`  fold ${fold}: ${t.role_mined ?? 0} roles, ${t.drafted ?? 0} drafted, ${t.mined ?? 0} mined, ${t.proposed ?? 0} proposed, ${t.shown ?? 0} shown`);
  }
  if (get("--json")) writeFileSync(get("--json"), JSON.stringify({ keyings: keys, families: fam, folds: Object.fromEntries(Object.entries(perFold).map(([f, rows]) => [f, { keyings: keyings(rows), families: families(rows) }])) }, null, 1) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
