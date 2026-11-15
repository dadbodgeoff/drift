#!/usr/bin/env node
// Map coverage of a pool of repositories (map11, round 11).
//
//   node eval/study/coverage/map-coverage.mjs run --bin DRIFT --clones DIR --out RUN [--repos a,b] [--variant NAME] [-- extra census flags]
//   node eval/study/coverage/map-coverage.mjs report RUN [--base RUN0] [--folds eval/study/folds-r11.json] [--json OUT]
//   node eval/study/coverage/map-coverage.mjs cards RUN_BEFORE RUN_AFTER [--rows OUT --keys OUT]
//
// `run` runs, for each repository, one at a time and with a private DRIFT_CACHE_DIR:
//   - `drift census --json --max 15` with DRIFT_FUNNEL set (the census for the
//     non-regression check and the yield funnel, eval/study/coverage/funnel.mjs);
//   - `drift census --coverage --json` (Drift's own coverage measures, the one definition:
//     crates/drift-mine/src/map.rs `coverage`, aligned with the pilot's probe);
//   - `drift map --files` (every file with its package, layer, role ids and, when in no
//     role, Drift's reason), for the classes of unmapped files below.
// Each output is gzipped into RUN/<variant>/<repo>.{census,funnel,coverage,map}.json.gz.
// Clones are read only: nothing is written into them.
//
// `report` prints, per repository and per fold, the coverage measures (production in a
// role narrower than its package and files under a shown convention are the headlines),
// the median and the share of repositories at or above 90%, and the unmapped files by
// class (CLASSES, a documented path-and-facts heuristic) with Drift's reason.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------------------
// Classes of files, by what they are. The heuristic reads only the path and the map row
// (language, test flag, entry points); it never reads a file. First match wins.
// ---------------------------------------------------------------------------------------

const seg = (p) => p.toLowerCase().split("/");
const fileOf = (p) => seg(p).at(-1);
const dirsOf = (p) => seg(p).slice(0, -1);
const stemOf = (p) => fileOf(p).split(".")[0];

/** [class, test(row) -> bool], in precedence order. */
export const CLASSES = [
  ["python test", (r) => r.test && r.lang === "py" && !/conftest\.py$|\/fixtures\//.test(r.path)],
  ["python test fixture", (r) => r.test && r.lang === "py"],
  ["TS story", (r) => r.test && /\.stories\.|\/__stories__\//.test(r.path)],
  ["TS end-to-end test", (r) => r.test && (/\.e2e\./.test(r.path) || dirsOf(r.path).some((d) => ["e2e", "cypress", "playwright"].includes(d)))],
  ["TS test fixture or mock", (r) => r.test && dirsOf(r.path).some((d) => ["fixtures", "__fixtures__", "__mocks__"].includes(d))],
  ["TS component test", (r) => r.test && /\.(tsx|jsx)$/.test(r.path)],
  ["TS unit test", (r) => r.test],
  ["demo or example code", (r) => r.nonprod],
  ["migration", (r) => dirsOf(r.path).some((d) => d === "migrations" || d === "alembic")],
  ["config", (r) => /\.config\./.test(fileOf(r.path)) || ["config", "settings", "conf", "configuration"].includes(stemOf(r.path)) || dirsOf(r.path).some((d) => ["config", "configs", "settings"].includes(d))],
  ["type declarations", (r) => /\.d\.(ts|mts|cts)$/.test(r.path) || stemOf(r.path) === "types" || /\.types?\./.test(fileOf(r.path))],
  ["python package __init__", (r) => fileOf(r.path) === "__init__.py"],
  ["CLI or script", (r) => dirsOf(r.path).some((d) => ["scripts", "script", "bin", "cli", "commands"].includes(d)) || ["cli", "__main__", "manage"].includes(stemOf(r.path))],
  ["Next route/page/layout", (r) => r.lang === "ts" && dirsOf(r.path).includes("app") && ["page", "layout", "route", "loading", "error", "not-found", "template", "default"].includes(stemOf(r.path))],
  ["entry-point module (router, handler, job)", (r) => (r.entry_points ?? 0) > 0],
  ["ORM or schema models", (r) => (r.lang === "py" && (fileOf(r.path) === "models.py" || dirsOf(r.path).at(-1) === "models")) || ["schema", "schemas"].includes(dirsOf(r.path).at(-1) ?? "")],
  ["service or repository", (r) => /(^|[_.-])(service|services|repository|repositories|repo)$/.test(stemOf(r.path)) || dirsOf(r.path).some((d) => ["services", "service", "repositories"].includes(d))],
  ["React hook", (r) => r.lang === "ts" && (/^use[A-Z0-9]/.test(r.path.split("/").at(-1)) || dirsOf(r.path).includes("hooks"))],
  ["React component", (r) => /\.(tsx|jsx)$/.test(r.path)],
  ["lib or util", (r) => dirsOf(r.path).some((d) => ["lib", "libs", "utils", "util", "helpers", "helper", "shared", "common"].includes(d)) || ["utils", "util", "helpers", "helper"].includes(stemOf(r.path))],
  ["barrel index", (r) => stemOf(r.path) === "index"],
  ["python module", (r) => r.lang === "py"],
  ["TS module", () => true],
];

/** The class of a map row ([`CLASSES`]). */
export function classify(row) {
  for (const [name, test] of CLASSES) if (test(row)) return name;
  return "TS module";
}

// ---------------------------------------------------------------------------------------
// Numbers.
// ---------------------------------------------------------------------------------------

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);

/** The headline readings of one repository's `census --coverage --json`. */
export function headlines(cov) {
  return {
    files: cov.files,
    production: cov.production.files,
    tests: cov.test.files,
    parsed: cov.measures["1_parsed"].pct,
    package: cov.measures["2_package"].pct,
    role: cov.measures["3_role"].pct,
    imports: cov.measures["4_internal_imports_resolved"].pct,
    mined: cov.measures["6_mined"].pct,
    shown: cov.measures["7_shown"].pct,
    prod_role: cov.production.role.pct,
    prod_narrow: cov.production.narrower_than_package.pct,
    prod_kind: cov.production.kind_keyed.pct,
    prod_mined: cov.production.mined.pct,
    prod_shown: cov.production.shown.pct,
    test_role: cov.test.test_role.pct,
    test_mined: cov.test.mined.pct,
    by_keying: cov.conventions?.by_keying ?? {},
  };
}

/**
 * Shares of a `map --files` output's files in a place role (the roles mining forms at
 * F11: no `shape`), in a test role, and in a kind role (selector version 4).
 */
export function roleShares(map) {
  const byId = Object.fromEntries((map.roles ?? []).map((r) => [r.id, r.selector?.shape ?? null]));
  const test = (s) => s && /:(test|fixture|e2e|story)$/.test(s);
  let place = 0, tests = 0, kinds = 0;
  for (const f of map.files) {
    const shapes = f.roles.map((id) => byId[id] ?? null);
    if (shapes.some((s) => s === null)) place++;
    if (shapes.some((s) => test(s))) tests++;
    if (shapes.some((s) => s && !test(s))) kinds++;
  }
  const n = map.files.length;
  return { role_places: pct(place, n), role_test: pct(tests, n), role_kind: pct(kinds, n) };
}

/** Unmapped rows of a `map --files` output, by class and reason: {class: {reason: n}}. */
export function unmappedClasses(map) {
  const out = {};
  for (const r of map.files) {
    if (r.roles.length) continue;
    const c = classify(r);
    const why = r.unmapped ?? "in no role";
    out[c] ??= {};
    out[c][why] = (out[c][why] ?? 0) + 1;
  }
  return out;
}

/** Median, mean and share of repositories at or above `bar` of `key` over `rows`. */
export function pool(rows, key, bar = 90) {
  const xs = rows.map((r) => r[key]).filter((x) => typeof x === "number");
  return {
    median: xs.length ? Math.round(10 * median(xs)) / 10 : null,
    mean: xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null,
    at_or_above: xs.filter((x) => x >= bar).length,
    of: xs.length,
  };
}

/** Fold of each repository name ([`folds-r11.json`]). */
export function foldsOf(folds) {
  const out = {};
  for (const f of folds.folds) for (const r of [...f.ts, ...f.py]) out[r] = f.fold;
  return out;
}

// ---------------------------------------------------------------------------------------
// run / report
// ---------------------------------------------------------------------------------------

const gz = (p, v) => writeFileSync(p, gzipSync(typeof v === "string" ? v : JSON.stringify(v)));
export const ungz = (p) => JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));

function clonesOf(dir) {
  const out = {};
  for (const set of readdirSync(dir)) {
    const d = join(dir, set);
    for (const r of readdirSync(d)) out[r] = join(d, r);
  }
  return out;
}

function run(args) {
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bin = resolve(get("--bin"));
  const clones = clonesOf(resolve(get("--clones")));
  const out = join(resolve(get("--out")), get("--variant") ?? "default");
  const extra = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
  const only = get("--repos")?.split(",");
  mkdirSync(out, { recursive: true });
  for (const [name, dir] of Object.entries(clones).sort()) {
    if (only && !only.includes(name)) continue;
    if (existsSync(join(out, `${name}.map.json.gz`))) continue;
    const cache = mkdtempSync(join(out, ".cache-"));
    const funnel = join(cache, "funnel.json");
    const env = { ...process.env, DRIFT_CACHE_DIR: cache };
    const drift = (argv, extraEnv = {}) =>
      execFileSync(bin, ["--root", dir, ...argv], { env: { ...env, ...extraEnv }, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    try {
      gz(join(out, `${name}.census.json.gz`), drift(["census", "--json", "--max", "15", ...extra], { DRIFT_FUNNEL: funnel }));
      if (existsSync(funnel)) gz(join(out, `${name}.funnel.json.gz`), readFileSync(funnel, "utf8"));
      gz(join(out, `${name}.coverage.json.gz`), drift(["census", "--coverage", "--json", ...extra]));
      gz(join(out, `${name}.map.json.gz`), drift(["map", "--files"]));
      process.stderr.write(`${name} ok\n`);
    } catch (e) {
      process.stderr.write(`${name} FAILED: ${String(e.message).split("\n")[0]}\n`);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }
}

export function summarise(dir, folds) {
  const repos = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".coverage.json.gz")).sort()) {
    const name = f.replace(/\.coverage\.json\.gz$/, "");
    const cov = ungz(join(dir, f));
    const mapPath = join(dir, `${name}.map.json.gz`);
    const map = existsSync(mapPath) ? ungz(mapPath) : { files: [] };
    repos[name] = { fold: folds[name] ?? null, ...headlines(cov), ...roleShares(map), unmapped: unmappedClasses(map), packages: cov.packages };
  }
  return repos;
}

const KEYS = ["parsed", "package", "role", "role_places", "role_test", "role_kind", "imports", "prod_role", "prod_narrow", "prod_kind", "prod_mined", "prod_shown", "test_role", "test_mined", "mined", "shown"];

export function poolTable(repos) {
  const rows = Object.values(repos);
  const out = {};
  for (const k of KEYS) out[k] = pool(rows, k);
  const byFold = {};
  for (const r of rows) (byFold[r.fold ?? "-"] ??= []).push(r);
  out.folds = Object.fromEntries(Object.entries(byFold).map(([f, rs]) => [f, Object.fromEntries(KEYS.map((k) => [k, pool(rs, k)]))]));
  // Unmapped classes over the pool: mean share of each repository's files.
  const classes = {};
  for (const r of rows) {
    for (const [c, why] of Object.entries(r.unmapped)) {
      const n = Object.values(why).reduce((a, b) => a + b, 0);
      classes[c] ??= { files: 0, share: 0, reasons: {} };
      classes[c].files += n;
      classes[c].share += r.files ? n / r.files / rows.length : 0;
      for (const [w, k] of Object.entries(why)) classes[c].reasons[w] = (classes[c].reasons[w] ?? 0) + k;
    }
  }
  out.unmapped = Object.fromEntries(Object.entries(classes).sort((a, b) => b[1].files - a[1].files).map(([c, v]) => [c, { ...v, share: Math.round(v.share * 1000) / 10 }]));
  // Cards and covered files by role keying, summed over the pool.
  const keying = {};
  for (const r of rows)
    for (const [k, v] of Object.entries(r.by_keying))
      for (const [m, n] of Object.entries(v)) keying[k] = { ...keying[k], [m]: (keying[k]?.[m] ?? 0) + n };
  out.by_keying = keying;
  return out;
}

/** How a proposal's role is keyed for the card diff: a test role, a kind role or a place role. */
export function roleType(p) {
  const shape = p.role?.shape;
  if (!shape) return "place";
  return /:(test|fixture|e2e|story)$/.test(shape) ? "test" : "kind";
}

/**
 * The card diff of two census runs (`before`, `after`: {repo: census JSON}): per repo,
 * proposals added and removed (by id) and shown ones added and removed, by role type.
 * Aggregates only.
 */
export function cardDiff(before, after) {
  const out = { repos: {}, total: {} };
  const bump = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
  for (const repo of Object.keys(after).sort()) {
    const a = new Map((before[repo]?.proposals ?? []).map((p) => [p.id, p]));
    const b = new Map((after[repo]?.proposals ?? []).map((p) => [p.id, p]));
    const r = {};
    for (const [id, p] of b) {
      if (!a.has(id)) bump(r, `added_${roleType(p)}`);
      if (p.shown_by_default && !a.get(id)?.shown_by_default) bump(r, `shown_added_${roleType(p)}`);
    }
    for (const [id, p] of a) {
      if (!b.has(id)) bump(r, `removed_${roleType(p)}`);
      if (p.shown_by_default && !b.get(id)?.shown_by_default) bump(r, `shown_removed_${roleType(p)}`);
    }
    out.repos[repo] = r;
    for (const [k, n] of Object.entries(r)) bump(out.total, k, n);
  }
  return out;
}

/** The new shown cards of `after` as labelling rows with opaque keys, and the key map. */
export function labelRows(before, after, prefix = "M11") {
  const rows = [];
  const keys = [];
  for (const repo of Object.keys(after).sort()) {
    const a = new Map((before[repo]?.proposals ?? []).map((p) => [p.id, p]));
    for (const p of after[repo].proposals ?? []) {
      if (!p.shown_by_default || a.get(p.id)?.shown_by_default) continue;
      const key = `${prefix}-${String(rows.length + 1).padStart(3, "0")}`;
      rows.push({ key, repo, id: p.id, tier: p.tier, language: p.language, rule_kind: p.rule_kind, summary: p.summary, role: p.role, rule: p.rule, evidence: p.evidence, example: p.example, outliers: p.outliers });
      keys.push({ key, repo, id: p.id, role_type: roleType(p) });
    }
  }
  return { rows, keys };
}

function cards(args) {
  const [beforeDir, afterDir] = args.map((a) => resolve(a));
  const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const load = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".census.json.gz")).map((f) => [f.replace(/\.census\.json\.gz$/, ""), ungz(join(dir, f))]));
  const before = load(beforeDir);
  const after = load(afterDir);
  const d = cardDiff(before, after);
  console.log("Card diff (proposals of census --json --max 15), totals:", JSON.stringify(d.total));
  for (const [repo, r] of Object.entries(d.repos)) if (Object.keys(r).length) console.log(`  ${repo.padEnd(30)} ${JSON.stringify(r)}`);
  if (get("--rows")) {
    const { rows, keys } = labelRows(before, after, get("--prefix") ?? "M11");
    writeFileSync(get("--rows"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    writeFileSync(get("--keys"), keys.map((r) => JSON.stringify(r)).join("\n") + (keys.length ? "\n" : ""));
    console.log(`${rows.length} new shown cards written as rows (keys apart)`);
  }
}

function report(args) {
  const dir = resolve(args[0]);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const folds = foldsOf(JSON.parse(readFileSync(get("--folds") ?? "eval/study/folds-r11.json", "utf8")));
  const repos = summarise(dir, folds);
  const base = get("--base") ? summarise(resolve(get("--base")), folds) : null;
  const table = poolTable(repos);
  const baseTable = base ? poolTable(base) : null;
  const line = (k) => {
    const p = table[k];
    const b = baseTable?.[k];
    return `${k.padEnd(12)} median ${String(p.median).padStart(5)}%  mean ${String(p.mean).padStart(5)}%  >=90%: ${p.at_or_above}/${p.of}` + (b ? `   (before: median ${b.median}%, >=90% ${b.at_or_above}/${b.of})` : "");
  };
  console.log(`Repositories: ${Object.keys(repos).length}`);
  for (const k of KEYS) console.log(line(k));
  console.log("\nPer repository: prod_narrow / role / test_role / shown");
  for (const [n, r] of Object.entries(repos)) console.log(`  ${n.padEnd(30)} fold ${r.fold ?? "-"}  ${r.prod_narrow}%  ${r.role}%  ${r.test_role}%  ${r.shown}%` + (base?.[n] ? `   (before ${base[n].prod_narrow}% ${base[n].role}% ${base[n].test_role}% ${base[n].shown}%)` : ""));
  console.log("\nUnmapped by class (files over the pool; mean share of a repo's files):");
  for (const [c, v] of Object.entries(table.unmapped)) console.log(`  ${c.padEnd(42)} ${String(v.files).padStart(7)}  ${String(v.share).padStart(5)}%  ${Object.entries(v.reasons).map(([w, k]) => `${w}: ${k}`).join("; ")}`);
  console.log("\nCards and covered files by role keying (summed):");
  for (const [k, v] of Object.entries(table.by_keying)) console.log(`  ${k.padEnd(8)} ${JSON.stringify(v)}`);
  if (get("--json")) writeFileSync(get("--json"), JSON.stringify({ repos, table, base: baseTable }, null, 1) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "run") run(rest);
  else if (cmd === "report") report(rest);
  else if (cmd === "cards") cards(rest);
  else {
    console.error("usage: map-coverage.mjs run --bin DRIFT --clones DIR --out RUN [--variant V] [--repos a,b] [-- census flags] | report RUN [--base RUN0] [--json OUT] | cards RUN_BEFORE RUN_AFTER [--rows OUT --keys OUT]");
    process.exit(2);
  }
}

