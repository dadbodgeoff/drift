// Coverage of the apps11 pool (eval/study/PREREG-apps-coverage.md): what Drift shows on beta-user-shaped app repos.
//
//   run    --manifest eval/apps11-build.json --drift BIN --clones DIR --out RUNDIR [--only a,b] [--keep-clones]
//          per repo, one at a time: a depth-1 checkout at the pin, then `census --json --max 15` at the root (defaults),
//          at the root with --python-proposals, and per discovered package (--root <package>, defaults; Python packages
//          also with --python-proposals). Writes RUNDIR/repos/<name>.json (shown cards only: id, tier, language, rule
//          kind, package) and deletes the checkout unless --keep-clones.
//   report RUNDIR   the coverage measures from those files: RUNDIR/metrics.json and RUNDIR/coverage.md.
//          With --labels FILE.jsonl (final labels, rubric v3: {repo, id, label}), the label measures too.
//   Map coverage (drift-map.mjs; PREREG-apps-coverage.md section 4b): per repo also `scan --json` and `census --json --max
//   1000 --all` (every mined proposal; default and --python-proposals), joined per tracked source file (select-apps.mjs
//   locCounted: the C4 line-count set) to: parsed, package, structural role, internal imports, under a mined / shown
//   convention; and the unmapped files by class with Drift's reason. Written to RUNDIR/repos/<name>.map.json.
//
// Packages: the directories of the product manifests at the pin (select-apps.mjs structureOf: package.json and Python
// manifests, not under docs/examples/tests/hidden/node_modules), the repo root left out unless it is the only one. A root
// census card belongs to the deepest package directory that contains its example file (none: the root).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, readJson, readJsonl, sha256File } from "./lib.mjs";
import { mapCoverage } from "./drift-map.mjs";
import { JS_MANIFEST_RE, PY_MANIFEST_RE, WORKSPACE_FILE_RE, locCounted, nonBlank, structureOf } from "./select-apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------------------
// Pure parts (exported for the tests)
// ---------------------------------------------------------------------------------------------------------
export function packagesOf(files) {
  const st = structureOf(files.filter((p) => JS_MANIFEST_RE.test(p) || PY_MANIFEST_RE.test(p) || WORKSPACE_FILE_RE.test(p)));
  const kinds = new Map();
  for (const d of st.js) kinds.set(d, "ts");
  for (const d of st.py) kinds.set(d, kinds.has(d) ? "ts+py" : "py");
  const dirs = [...kinds.keys()].filter((d) => d !== "");
  const list = dirs.length ? dirs : [...kinds.keys()];
  return list.sort().map((dir) => ({ dir, kind: kinds.get(dir) }));
}
export const packageOfPath = (path, pkgs) => pkgs.map((p) => p.dir).filter((d) => d === "" || path === d || path.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
// The shown cards of one census JSON.
export function shownCards(census, pkgs = [], prefix = "") {
  const cards = (census.proposals ?? []).filter((p) => p.shown_by_default !== false);
  return cards.map((p) => {
    const path = `${prefix}${p.example?.path ?? ""}`;
    return { id: p.id, tier: p.tier, language: p.language, rule_kind: p.rule_kind, role_package: p.role?.package ?? null, package: packageOfPath(path, pkgs) };
  });
}
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const dist = (xs) => ({ n: xs.length, mean: mean(xs), median: median(xs), zero: xs.filter((x) => x === 0).length, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null });
// The coverage measures from the per-repo summaries (and final labels, when given: Map uid -> label).
export function coverage(repos, labels = null) {
  const ok = repos.filter((r) => !r.failed);
  const n = repos.length;
  const shownRoot = (r, v) => (r.failed ? 0 : r.root[v].cards.length);
  const pkgsWith = (r, v) => new Set(r.failed ? [] : r.root[v].cards.map((c) => c.package).filter((p) => p !== null));
  const perPackageAlone = (r) => (r.failed ? [] : r.packages.map((p) => Math.max(p.default?.cards.length ?? 0, p.python_opt_in?.cards.length ?? 0)));
  const out = {
    repos: n,
    failed: repos.filter((r) => r.failed).map((r) => ({ name: r.name, why: r.failed })),
    packages: { total: ok.reduce((a, r) => a + r.packages.length, 0), per_repo: dist(ok.map((r) => r.packages.length)), by_kind: ok.flatMap((r) => r.packages).reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {}) },
  };
  for (const v of ["default", "python_opt_in"]) {
    const silent = repos.filter((r) => shownRoot(r, v) === 0).length;
    const pk = ok.flatMap((r) => r.packages.map((p) => r.root[v].cards.filter((c) => c.package === p.dir).length));
    out[`root_${v}`] = {
      silent_root: { repos: silent, of: n, rate: n ? silent / n : null },
      shown_per_repo: dist(repos.map((r) => shownRoot(r, v))),
      shown_per_package: dist(pk),
      packages_with_shown: { packages: ok.reduce((a, r) => a + r.packages.filter((p) => pkgsWith(r, v).has(p.dir)).length, 0), of: out.packages.total },
      by_tier: ok.flatMap((r) => r.root[v].cards).reduce((a, c) => ((a[c.tier] = (a[c.tier] ?? 0) + 1), a), {}),
      by_language: ok.flatMap((r) => r.root[v].cards).reduce((a, c) => ((a[c.language] = (a[c.language] ?? 0) + 1), a), {}),
    };
  }
  const alone = ok.flatMap(perPackageAlone);
  out.per_package_census = {
    "//": "each package censused alone (--root <package>); Python packages: the larger of the default and opt-in views",
    shown_per_package: dist(alone),
    packages_with_shown: { packages: alone.filter((x) => x > 0).length, of: alone.length },
    shown_per_repo: dist(repos.map((r) => perPackageAlone(r).reduce((a, b) => a + b, 0))),
    failed_packages: ok.reduce((a, r) => a + r.packages.filter((p) => p.failed).length, 0),
  };
  if (labels) {
    // Label measures (rubric v3 finals; ACCEPT only counts). Shown = the root default census plus, for Python, the
    // opt-in view: as dev4's "shown".
    const shown = (r) => (r.failed ? [] : [...new Map([...r.root.default.cards, ...r.root.python_opt_in.cards.filter((c) => c.language === "py")].map((c) => [c.id, c])).values()]);
    const lab = (r, c) => labels.get(`${r.name}/${c.id}`) ?? null;
    const acc = repos.map((r) => shown(r).filter((c) => lab(r, c) === "ACCEPT").length);
    const all = repos.flatMap((r) => shown(r).map((c) => lab(r, c)));
    const pkAcc = ok.flatMap((r) => r.packages.map((p) => shown(r).some((c) => c.package === p.dir && lab(r, c) === "ACCEPT")));
    out.labels = {
      accepted_per_repo: dist(acc),
      package_coverage: { packages: pkAcc.filter(Boolean).length, of: pkAcc.length, rate: pkAcc.length ? pkAcc.filter(Boolean).length / pkAcc.length : null },
      precision: { accept: all.filter((l) => l === "ACCEPT").length, not_wrong: all.filter((l) => l === "ACCEPT" || l === "TRIVIAL").length, shown: all.length, unlabelled: all.filter((l) => l === null).length },
    };
  }
  return out;
}

// The map-coverage aggregate over repos (drift-map.mjs mapCoverage outputs): pooled shares, per-repo medians,
// per-package shares and silent packages, the unmapped breakdown, and the validation against the product.
export function mapSummary(maps) {
  const ok = maps.filter((m) => !m.failed);
  const keys = ["files_parsed", "files_in_package", "files_in_nonroot_drift_package", "files_in_role", "files_in_any_role", "files_under_mined", "files_under_shown", "files_under_mined_py", "files_under_shown_py"];
  const pooled = {};
  const perRepo = {};
  for (const k of keys) {
    const s = ok.reduce((a, m) => ({ files: a.files + m.repo[k].files, of_files: a.of_files + m.repo[k].of_files, loc: a.loc + m.repo[k].loc, of_loc: a.of_loc + m.repo[k].of_loc }), { files: 0, of_files: 0, loc: 0, of_loc: 0 });
    pooled[k] = { ...s, files_rate: s.of_files ? s.files / s.of_files : null, loc_rate: s.of_loc ? s.loc / s.of_loc : null };
    perRepo[k] = { files_rate: dist(ok.map((m) => (m.repo[k].of_files ? m.repo[k].files / m.repo[k].of_files : 0))), loc_rate: dist(ok.map((m) => (m.repo[k].of_loc ? m.repo[k].loc / m.repo[k].of_loc : 0))) };
  }
  const imp = ok.reduce((a, m) => ({ resolved: a.resolved + m.repo.imports.internal_resolved, unresolved: a.unresolved + m.repo.imports.internal_unresolved }), { resolved: 0, unresolved: 0 });
  const pkgs = ok.flatMap((m) => m.per_package);
  const pkgRate = (k, unit) => dist(pkgs.filter((p) => p[k][`of_${unit}`]).map((p) => p[k][unit] / p[k][`of_${unit}`]));
  const unmapped = {};
  for (const m of ok)
    for (const u of m.unmapped) {
      const e = (unmapped[`${u.class}\t${u.why}`] ??= { class: u.class, why: u.why, files: 0, loc: 0, repos: 0 });
      e.files += u.files;
      e.loc += u.loc;
      e.repos++;
    }
  const byClass = {};
  for (const u of Object.values(unmapped)) {
    const e = (byClass[u.class] ??= { files: 0, loc: 0, reasons: {} });
    e.files += u.files;
    e.loc += u.loc;
    e.reasons[u.why] = (e.reasons[u.why] ?? 0) + u.files;
  }
  return {
    repos: maps.length,
    failed: maps.filter((m) => m.failed).map((m) => m.name),
    validation: ok.map((m) => ({ name: m.name, ...Object.fromEntries(Object.entries(m.check).map(([v, c]) => [v, `${c.roles}/${c.census_roles} roles, ${c.units}/${c.census_units} units, ${c.member_counts_match}/${c.proposals} member counts`])) })),
    pooled,
    per_repo: perRepo,
    imports: { ...imp, rate: imp.resolved + imp.unresolved ? imp.resolved / (imp.resolved + imp.unresolved) : null },
    per_package: { packages: pkgs.length, in_role_files: pkgRate("files_in_role", "files"), in_role_loc: pkgRate("files_in_role", "loc"), under_shown_files: pkgRate("files_under_shown", "files"), silent: { default: pkgs.filter((p) => p.silent.default).length, python_opt_in: pkgs.filter((p) => p.silent.python_opt_in).length } },
    unmapped_by_class: Object.fromEntries(Object.entries(byClass).sort(([, a], [, b]) => b.files - a.files)),
    unmapped: Object.values(unmapped).sort((a, b) => b.files - a.files),
  };
}

// ---------------------------------------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------------------------------------
const die = (m) => {
  console.error(`error: ${m}`);
  process.exit(2);
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
const availGb = () => Number(/MemAvailable:\s+(\d+)/.exec(spawnSync("cat", ["/proc/meminfo"], { encoding: "utf8" }).stdout)?.[1] ?? 0) / 1048576;
function census(drift, dir, extra, cache) {
  while (availGb() < 4) sleep(30000); // the brief: never start a drift process with under 4 GB available
  const t0 = Date.now();
  const r = spawnSync(drift, ["census", "--json", "--max", "15", "--root", dir, ...extra], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 1800000, env: { ...process.env, DRIFT_CACHE_DIR: cache } });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.status !== 0) return { failed: `exit ${r.status}${r.signal ? ` ${r.signal}` : ""}: ${(r.stderr ?? "").split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? ""}`, secs };
  try {
    return { json: JSON.parse(r.stdout), secs };
  } catch {
    return { failed: "census output is not JSON", secs };
  }
}
function rawCensus(drift, dir, extra, cache, out) {
  while (availGb() < 4) sleep(30000);
  const r = spawnSync("sh", ["-c", `"$0" "$@" > "${out}"`, drift, ...extra, "--root", dir], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 3600000, env: { ...process.env, DRIFT_CACHE_DIR: cache } });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(readFileSync(out, "utf8"));
  } catch {
    return null;
  } finally {
    rmSync(out, { force: true });
  }
}
// Map coverage of a checkout (drift-map.mjs), with the root census results already run.
function mapRepo(drift, dest, files, pkgs, cache, rootD, rootP) {
  const tmp = join(dirname(dest), `.map-${Date.now()}.json`);
  const scan = rawCensus(drift, dest, ["scan", "--json"], cache, tmp);
  const minedD = rawCensus(drift, dest, ["census", "--json", "--max", "1000", "--all"], cache, tmp);
  const minedP = rawCensus(drift, dest, ["census", "--json", "--max", "1000", "--all", "--python-proposals"], cache, tmp);
  if (!scan || !minedD || !minedP || rootD.failed || rootP.failed) return { failed: "scan or census failed" };
  const sources = files
    .filter((p) => {
      try {
        const st = statSync(join(dest, p));
        return st.isFile() && locCounted(p, st.size);
      } catch {
        return false;
      }
    })
    .map((p) => ({ path: p, loc: nonBlank(readFileSync(join(dest, p), "utf8")) }));
  const shownOf = (c) => (c.proposals ?? []).filter((p) => p.shown_by_default !== false);
  return mapCoverage({
    sources,
    scan,
    pkgs,
    mined: { default: minedD.proposals ?? [], python_opt_in: minedP.proposals ?? [] },
    shown: { default: shownOf(rootD.json), python_opt_in: shownOf(rootP.json) },
    census: { default: minedD, python_opt_in: minedP },
  });
}
const summary = (c, pkgs, prefix) =>
  c.failed ? { failed: c.failed, secs: c.secs, cards: [] } : { shown: c.json.shown, conventions: c.json.conventions, units: c.json.units, roles: c.json.roles, tiers: c.json.tiers, python_withheld: c.json.python_proposals?.withheld ?? null, secs: c.secs, cards: shownCards(c.json, pkgs, prefix) };

function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ["keepClones", "noMap"] });
  const mode = args._[0];
  if (mode === "run") {
    for (const k of ["manifest", "drift", "clones", "out"]) if (!args[k]) die(`--${k} is required`);
    if (/apps-blind|apps11-blind/.test(String(args.manifest))) die("the blind half waits for the workspace-support branch (PREREG-apps-coverage.md, order)");
    const m = readJson(resolve(args.manifest));
    const drift = resolve(args.drift);
    const out = resolve(args.out);
    const clones = resolve(args.clones);
    const only = args.only ? new Set(String(args.only).split(",")) : null;
    const commit = JSON.parse(spawnSync(drift, ["census", "--json", "--max", "1", "--root", here], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout || "{}").commit ?? null;
    writeJson(join(out, "run.json"), { manifest: args.manifest, manifest_set_id: m.set_id, drift: { path: drift, sha256: sha256File(drift), commit }, params: { max: 15, views: ["root default", "root --python-proposals", "per package --root (defaults; Python packages also --python-proposals)"] }, started_at: new Date().toISOString() });
    for (const r of m.repos) {
      if (only && !only.has(r.name)) continue;
      const dest = join(clones, r.name);
      const cache = join(clones, `.cache-${r.name}`);
      const g = (...a) => spawnSync("git", ["-C", dest, ...a], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 1800000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      if (!existsSync(join(dest, ".git"))) {
        mkdirSync(dest, { recursive: true });
        if (g("init", "-q").status !== 0 || g("fetch", "-q", "--depth", "1", r.url, r.sha).status !== 0 || g("checkout", "-q", "FETCH_HEAD").status !== 0) {
          writeJson(join(out, "repos", `${r.name}.json`), { name: r.name, sha: r.sha, failed: "checkout at the pin failed" });
          continue;
        }
      }
      if (g("rev-parse", "HEAD").stdout.trim() !== r.sha) die(`${r.name}: the checkout is not at its pin`);
      const files = g("ls-files").stdout.split("\n").filter(Boolean);
      const pkgs = packagesOf(files);
      console.error(`${r.name}: ${pkgs.length} packages`);
      const rootD = census(drift, dest, [], cache);
      const rootP = census(drift, dest, ["--python-proposals"], cache);
      const rec = { name: r.name, repo: r.repo, sha: r.sha, loc: r.loc, shape: r.shape, packages: [], root: { default: summary(rootD, pkgs, ""), python_opt_in: summary(rootP, pkgs, "") } };
      if (!args.noMap) writeJson(join(out, "repos", `${r.name}.map.json`), { name: r.name, sha: r.sha, ...mapRepo(drift, dest, files, pkgs, cache, rootD, rootP) });
      if (rootD.failed) rec.failed = `root census: ${rootD.failed}`;
      for (const p of pkgs) {
        if (p.dir === "") {
          rec.packages.push({ ...p, default: rec.root.default, python_opt_in: rec.root.python_opt_in });
          continue;
        }
        const pr = { ...p, default: summary(census(drift, join(dest, p.dir), [], cache), pkgs, `${p.dir}/`) };
        if (p.kind !== "ts") pr.python_opt_in = summary(census(drift, join(dest, p.dir), ["--python-proposals"], cache), pkgs, `${p.dir}/`);
        if (pr.default.failed) pr.failed = pr.default.failed;
        rec.packages.push(pr);
      }
      if (g("status", "--porcelain", "--ignored").stdout.trim()) rec.dirty_after = true; // census writes nothing; record it if not
      writeJson(join(out, "repos", `${r.name}.json`), rec);
      rmSync(cache, { recursive: true, force: true });
      if (!args.keepClones) rmSync(dest, { recursive: true, force: true });
      console.error(`  root ${rec.root.default.cards.length} shown (opt-in ${rec.root.python_opt_in.cards.length}); packages alone ${rec.packages.reduce((a, p) => a + Math.max(p.default?.cards?.length ?? 0, p.python_opt_in?.cards?.length ?? 0), 0)}`);
    }
    return;
  }
  if (mode === "report") {
    const dir = resolve(args._[1] ?? die("usage: apps-coverage.mjs report RUNDIR"));
    const repos = readdirSync(join(dir, "repos")).filter((f) => f.endsWith(".json") && !f.endsWith(".map.json")).sort().map((f) => readJson(join(dir, "repos", f)));
    const labels = args.labels ? new Map(readJsonl(resolve(args.labels)).map((x) => [`${x.repo}/${x.id}`, x.label])) : null;
    const c = coverage(repos, labels);
    const maps = readdirSync(join(dir, "repos")).filter((f) => f.endsWith(".map.json")).sort().map((f) => readJson(join(dir, "repos", f)));
    if (maps.length) c.map = mapSummary(maps);
    writeJson(join(dir, "metrics.json"), c);
    console.log(JSON.stringify(c, null, 2));
    return;
  }
  die("usage: apps-coverage.mjs run ... | report RUNDIR [--labels FILE]");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
