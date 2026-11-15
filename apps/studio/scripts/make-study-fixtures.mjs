// Study fixtures.
//
//   node scripts/make-study-fixtures.mjs [--drift <drift> --eval-repos <dir of the 16 study repos> --work <scratch>]
//
// Copies the study's own data (eval/study labels, eval/agent-ab results) into
// fixtures/studies/ and optionally re-runs `drift census --json` on the study
// repos (outliers trimmed to three). The confidence hints in
// src/entities/convention/family-precision.json are maintained by hand from the
// study's published table, with their provenance.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LANGUAGE_ROWS as STUDY_LANGUAGE_ROWS, studioFamilies } from "../../../eval/study/lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const driftRoot = resolve(app, "../..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = join(app, "fixtures/studies");
mkdirSync(out, { recursive: true });
copyFileSync(join(driftRoot, "eval/study/labels.jsonl"), join(out, "labels.jsonl"));
copyFileSync(join(driftRoot, "eval/study/second-opinion.jsonl"), join(out, "second-opinion.jsonl"));
for (const f of readdirSync(join(driftRoot, "eval/agent-ab")).filter((f) => /^results-.*\.json$|^tasks\.json$/.test(f)))
  copyFileSync(join(driftRoot, "eval/agent-ab", f), join(out, f));

// Scored runs (dev sets only: eval/study/runs holds no held-out data until the primary run).
// Every metrics.json under a run, found by the same bounded walk as the main process (the run, its
// views, a part such as `calib-…/ts` or `dev-v3-…/py`, a part's views), plus `metrics-<variant>.json`
// beside one. Each is re-scored with the current eval/study/metrics.mjs from the run's own committed
// queue and the labels its metrics.json names (so older runs gain the per-language tables of #24); a
// variant with an exposure check is re-scored with the same `--exclude-repos`. The committed file is
// copied when re-scoring fails. Agreement files and adjudication exclusions are collected on the way.
const runsOut = join(out, "runs");
rmSync(runsOut, { recursive: true, force: true });
const runPaths = [];
const variantPaths = [];
const agreements = [];
const exclusions = [];
const runsDir = join(driftRoot, "eval/study/runs");
const subdirs = (d) => readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.isSymbolicLink()).map((x) => x.name).sort();
const scored = (dir) => existsSync(join(dir, "metrics.json"));
const runDirs = []; // [rel, dir, variant | null]
for (const r of subdirs(runsDir)) {
  let seen = 0;
  const walk = (d, rel, depth) => {
    if (++seen > 400) return;
    if (scored(d)) runDirs.push([rel, d, null]);
    for (const f of readdirSync(d).filter((x) => /^metrics-[\w.-]+\.json$/.test(x)).sort()) runDirs.push([rel, d, f.slice("metrics-".length, -".json".length)]);
    if (existsSync(join(d, "agreement.json"))) agreements.push({ path: rel, agreement: JSON.parse(readFileSync(join(d, "agreement.json"), "utf8")) });
    if (d.endsWith("/adjudication") && existsSync(join(d, "queue.json"))) {
      const ex = JSON.parse(readFileSync(join(d, "queue.json"), "utf8")).excluded;
      if (ex) exclusions.push({ path: rel, excluded: ex });
    }
    if (depth < 4) for (const v of subdirs(d)) walk(join(d, v), `${rel}/${v}`, depth + 1);
  };
  walk(join(runsDir, r), `eval/study/runs/${r}`, 0);
}
for (const [rel, dir, variant] of runDirs) {
  const file = variant ? `metrics-${variant}.json` : "metrics.json";
  const dest = join(runsOut, rel.slice("eval/study/runs/".length));
  mkdirSync(dest, { recursive: true });
  const committed = JSON.parse(readFileSync(join(dir, file), "utf8"));
  // Scored as the run its metrics.json names: a part's own metrics.json can hold the scoring of one of
  // its views (relabel3's `ts/metrics.json` is `metrics.mjs` on `ts/views/d7`), so re-scoring it as the
  // directory it sits in would apply that directory's run.json (another tier) instead.
  const scoredAs = typeof committed.run === "string" && /^eval\/study\/runs\/[\w./-]+$/.test(committed.run) && !committed.run.includes("..") && existsSync(join(driftRoot, committed.run, "run.json")) ? committed.run : rel;
  const args = ["eval/study/metrics.mjs", "--run", scoredAs, "--json", join(dest, file)];
  // The labels the run was scored with (repo-relative, so no local path is recorded); a view of a run
  // written before metrics.json named its labels uses its parent run's.
  const vi = rel.split("/").lastIndexOf("views");
  const labels = typeof committed.labels === "string" && !committed.labels.startsWith("/") && existsSync(join(driftRoot, committed.labels)) ? committed.labels : vi > 0 ? `${rel.split("/").slice(0, vi).join("/")}/final.jsonl` : null;
  if (labels && labels !== `${scoredAs}/final.jsonl`) args.push("--labels", labels); // the default stays implicit, as metrics.mjs reads it
  if (Array.isArray(committed.exposure?.exposed) && !committed.manifest?.holdout) args.push("--exclude-repos", committed.exposure.exposed.join(","));
  const r = spawnSync(process.execPath, args, { cwd: driftRoot, encoding: "utf8" });
  if (r.status !== 0) {
    // Not silent: the fixture is then the committed scoring (as the desktop app reads it), without what
    // the current metrics.mjs adds (calib-v3/py since 0285264: its A/B sets are incomplete, CTFd unlabelled).
    console.warn(`${rel}/${file}: re-scoring failed, the committed file is copied: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
    copyFileSync(join(dir, file), join(dest, file));
  }
  // No absolute local paths in committed fixtures: the binary a run measured keeps its name (its
  // sha256 identifies it); any other absolute path is cut to what follows the checkout.
  const m = JSON.parse(readFileSync(join(dest, file), "utf8"));
  if (typeof m.drift?.binary === "string") m.drift.binary = m.drift.binary.split("/").pop();
  if (typeof m.labels === "string" && m.labels.startsWith("/")) m.labels = m.labels.slice(m.labels.indexOf("eval/study/"));
  const text = JSON.stringify(m, null, 2) + "\n";
  if (/"\/(?:tmp|home|Users|root)\//.test(text)) throw new Error(`${rel}/${file}: an absolute local path is left in the fixture`);
  writeFileSync(join(dest, file), text);
  if (variant) variantPaths.push({ path: rel, variant });
  else runPaths.push(rel);
}
// Calibrations (a run with shift.json: the label shift, and each part's labeller agreement) and the
// dev manifests (eval/repos*.json only; held-out manifests are never read), as the main process loads them.
const calibrations = [];
for (const r of readdirSync(runsDir).sort()) {
  const d = join(runsDir, r);
  if (!existsSync(join(d, "shift.json"))) continue;
  const agreements = readdirSync(d)
    .filter((v) => existsSync(join(d, v, "agreement.json")))
    .sort()
    .map((v) => ({ path: `eval/study/runs/${r}/${v}`, agreement: JSON.parse(readFileSync(join(d, v, "agreement.json"), "utf8")) }));
  calibrations.push({ path: `eval/study/runs/${r}`, shift: JSON.parse(readFileSync(join(d, "shift.json"), "utf8")), agreements });
}
const manifests = readdirSync(join(driftRoot, "eval"))
  .filter((f) => /^repos[\w-]*\.json$/.test(f))
  .sort()
  .map((f) => {
    const m = JSON.parse(readFileSync(join(driftRoot, "eval", f), "utf8"));
    const lang = (m.repos ?? []).find((x) => typeof x.language === "string")?.language;
    return { path: `eval/${f}`, note: typeof m["//"] === "string" ? m["//"].slice(0, 400) : "", repos: (m.repos ?? []).length, language: typeof lang === "string" ? lang : null };
  });
const extra = JSON.stringify({ calibrations, agreements, exclusions, manifests }, null, 1) + "\n";
if (/"\/(?:tmp|home|Users|root)\//.test(extra)) throw new Error("an absolute local path is left in studies/extra.json");
writeFileSync(join(out, "extra.json"), extra);

const ixPath = join(app, "fixtures/index.json");
if (existsSync(ixPath)) {
  const ix = JSON.parse(readFileSync(ixPath, "utf8"));
  ix.studies = { ...(ix.studies ?? {}), runs: runPaths, variants: variantPaths };
  writeFileSync(ixPath, JSON.stringify(ix, null, 1) + "\n");
}

const evalRepos = arg("--eval-repos");
if (evalRepos) {
  const drift = resolve(arg("--drift"));
  const work = resolve(arg("--work"));
  const repos = JSON.parse(readFileSync(join(driftRoot, "eval/repos.json"), "utf8")).repos.map((r) => r.name);
  for (const name of repos) {
    const dir = join(evalRepos, name);
    if (!existsSync(dir)) continue;
    const r = spawnSync(drift, ["--root", dir, "census", "--json"], {
      env: { ...process.env, DRIFT_CACHE_DIR: join(work, `cache-${name}`) },
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (r.status !== 0) {
      console.warn(`census ${name} failed: ${r.stderr}`);
      continue;
    }
    const c = JSON.parse(r.stdout);
    writeFileSync(join(out, `census-${name}.json`), JSON.stringify({ ...c, root: `/study/${name}`, proposals: c.proposals.map((p) => ({ ...p, outliers: p.outliers.slice(0, 3) })) }) + "\n");
  }
}

// The per-family confidence hints (src/entities/convention/family-precision.json):
// the top level keeps the first round's published rates (PR #4), which the Studies
// view compares with its baseline; `latest` holds, per language, the newest run's
// family table from its committed metrics.json (adjudicated final labels), which the
// Conventions view shows as each rule family's track record.
// The study family -> Studio family names (eval/study/lib.mjs, derived from rule-kind-family.json: one mapping).
const STUDY_TO_STUDIO = studioFamilies();
const precisionPath = join(app, "src/entities/convention/family-precision.json");
const precision = JSON.parse(readFileSync(precisionPath, "utf8"));
const latest = {};
// Per language, the newest precision run on the language's first dev set (eval/repos.json, eval/repos-py.json),
// wherever in the run it is scored: the run itself (r2) or a part's view (dev-v3's `ts/views/d5`). A run's own
// metrics.json comes before its views; calibrations and variants are not track records.
const dated = (rel) => rel.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
const precisionRuns = runDirs
  .filter(([, , variant]) => !variant)
  .map(([rel, dir]) => [rel, JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8"))])
  .filter(([, m]) => m.kind !== "calibration" && Array.isArray(m.families))
  .sort(([a], [b]) => dated(b).localeCompare(dated(a)) || b.split("/")[3].localeCompare(a.split("/")[3]) || a.split("/").length - b.split("/").length || a.localeCompare(b));
// The figures are the language's own proposals (metrics.json `by_language`, as the run's README reports
// "Python proposals only"): a Python dev repo can hold TypeScript cards (relabel4/py: one `repo` card from
// full-stack-fastapi-template's frontend), which are no track record for a Python convention. A run
// scored before `by_language` existed keeps its whole table.
const LANGUAGE_ROWS = { typescript: STUDY_LANGUAGE_ROWS.ts, python: STUDY_LANGUAGE_ROWS.py };
const round3 = (p) => Math.round(p * 1000) / 1000;
for (const [lang, manifest] of [["typescript", "eval/repos.json"], ["python", "eval/repos-py.json"]]) {
  const hit = precisionRuns.find(([, m]) => m.manifest?.path === manifest);
  if (!hit) continue;
  const [rel, m] = hit;
  const name = rel.slice("eval/study/runs/".length);
  const groups = Array.isArray(m.by_language) ? m.by_language : [];
  const own = groups.find((g) => g.language === LANGUAGE_ROWS[lang]);
  const mixed = own && groups.some((g) => g !== own && g.overall?.shown > 0);
  const rows = own ? own.families.map((f) => ({ family: f.family, ...f.overall })) : (m.families ?? []);
  const overall = own ? own.overall : m.overall;
  const families = {};
  for (const f of rows)
    for (const studio of STUDY_TO_STUDIO[f.family] ?? [])
      if (f.labelled && Number.isFinite(f.accept?.p)) families[studio] = { n: f.labelled, rate: round3(f.accept.p), notWrong: round3(f.not_wrong.p) };
  latest[lang] = {
    study: `dev set, ${name}${mixed ? `, ${lang === "python" ? "Python" : "TypeScript/JavaScript"} proposals only` : ""}${m.rubric ? `, rubric ${m.rubric}` : ""}, not held-out`,
    run: rel,
    overall: { n: overall.labelled, rate: round3(overall.accept.p), notWrong: round3(overall.not_wrong.p) },
    families,
  };
}
writeFileSync(precisionPath, JSON.stringify({ ...precision, latest }, null, 1) + "\n");
