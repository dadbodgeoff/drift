// Map coverage: how much of a repo Drift's facts and roles reach, per file, from `drift scan --json` and the census.
//
// The CLI prints no per-file role membership, so this file re-derives it from the fact index with the role rules of
// crates/drift-mine/src/roles.rs at F11 (units, selectors_for, FileKinds, NonProduction, class_variety, member_kind,
// reserved_export, FunctionAliases) and mine.rs (a role is a selector with >= MIN_ROLE_SIZE members whose Python
// members span >= ROLE_MIN_FILES files). It is STUDY code, not the product: every run checks it against the product's
// own numbers (census `roles` = roles_considered; each proposal's role member count), and reports the agreement.
//
// Exports pure functions only; eval/study/apps-coverage.mjs runs it.

const ROLE_DEPTHS = [1, 2, 3, 4, 5];
const LITERAL_STEM_MIN = 5;
const SUFFIX_MIN = 3;
export const MIN_ROLE_SIZE = 8;
const ROLE_MIN_FILES = 3;
const PACKAGE_WIDE = "**";
const DEMO_DIRS = ["example", "examples", "sample", "samples", "demo", "demos", "playground", "playgrounds"];
const INTEGRATION_DIR = "integration";
const LINEAGE = ["view", "serializer", "model", "form", "admin", "inline", "mixin", "exception"];
const SPECIAL_KINDS = ["enum", "namedtuple", "typeddict", "dataclass"];
const NEXT_RESERVED = ["generateMetadata", "generateStaticParams", "generateViewport", "generateImageMetadata", "generateSitemaps", "metadata", "viewport", "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration", "experimental_ppr", "config", "alt", "size", "contentType", "getServerSideProps", "getStaticProps", "getStaticPaths", "getInitialProps", "middleware", "proxy"];

const fileName = (p) => p.slice(p.lastIndexOf("/") + 1);
const dirName = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export function isTestPath(path) {
  const lower = path.toLowerCase();
  const file = fileName(lower);
  if (file.includes(".test.") || file.includes(".spec.")) return true;
  if ((file.startsWith("test_") && file.endsWith(".py")) || file.endsWith("_test.py") || file === "conftest.py" || file === "tests.py") return true;
  if (file.endsWith(".py") && lower.includes("/") && dirName(lower).split("/").includes("testing")) return true;
  if (file.includes(".stories.") || file.includes(".e2e.")) return true;
  return lower.split("/").some((d) => ["__tests__", "__stories__", "__mocks__", "tests", "test", "e2e", "fixtures", "__fixtures__", "cypress", "playwright"].includes(d));
}
const stem = (path) => {
  const f = fileName(path);
  const i = f.indexOf(".");
  return i >= 0 ? f.slice(0, i) : f;
};
const testedStem = (path) => {
  const s = stem(path);
  if (!path.endsWith(".py")) return s;
  const t = s.startsWith("test_") ? s.slice(5) : s.endsWith("_test") ? s.slice(0, -5) : null;
  return t || s;
};
const segmentsBelow = (path, pkg) => {
  const rel = pkg ? (path.startsWith(pkg) ? path.slice(pkg.length).replace(/^\/+/, "") : path) : path;
  const segs = rel.split("/");
  segs.pop();
  return segs;
};
const abstractSegment = (seg) => (seg.startsWith("[") && seg.endsWith("]") ? "[*]" : seg);
export const dirsBelowPackage = (path, pkg) => segmentsBelow(path, pkg).map(abstractSegment);
const isDemo = (d) => DEMO_DIRS.includes(d.toLowerCase());
export const isDemoPath = (path, pkg) => pkg.split("/").filter(Boolean).some(isDemo) || (segmentsBelow(path, pkg)[0] !== undefined && isDemo(segmentsBelow(path, pkg)[0]));
export function learnNonProduction(files) {
  const sources = new Set(files.filter((f) => !isTestPath(f.path)).map((f) => `${dirName(f.path)}\t${stem(f.path)}`));
  const colocated = (path) => {
    const dir = dirName(path);
    const parent = dir.endsWith("/__tests__") ? dir.slice(0, -"/__tests__".length) : dir;
    const st = testedStem(path);
    return sources.has(`${dir}\t${st}`) || sources.has(`${parent}\t${st}`);
  };
  const tests = new Map();
  for (const f of files) {
    if (!isTestPath(f.path)) continue;
    if (segmentsBelow(f.path, f.package)[0] === INTEGRATION_DIR) {
      const prefix = f.package ? `${f.package}/${INTEGRATION_DIR}/` : `${INTEGRATION_DIR}/`;
      const e = tests.get(prefix) ?? [0, 0];
      if (colocated(f.path)) e[1]++;
      else e[0]++;
      tests.set(prefix, e);
    }
  }
  const suites = [...tests].filter(([, [s, c]]) => s > c).map(([p]) => p);
  return (path, pkg) => isDemoPath(path, pkg) || suites.some((p) => path.startsWith(p));
}
const dottedSuffix = (path) => {
  const parts = fileName(path).split(".");
  return parts.length >= 3 ? parts[parts.length - 2] : null;
};
const kindStem = (path) => {
  const f = fileName(path);
  if (f.startsWith("[") && f.includes("]")) return "[*]";
  return abstractSegment(stem(path));
};
const numberedPythonStem = (path) => path.endsWith(".py") && stem(path).split(/[^0-9]/).some((run) => run.length >= 2 && run.startsWith("0"));
const pythonLayeredKind = (path) => {
  if (!path.endsWith(".py")) return null;
  const segs = path.split("/");
  if (segs.length < 2) return null;
  const parent = segs[segs.length - 2];
  const st = stem(path);
  return st !== "__init__" ? `${parent}/${st}` : null;
};
export function learnKinds(files) {
  const stems = new Map();
  const dirSizes = new Map();
  const suffixes = new Map();
  for (const f of files) {
    const dir = dirName(f.path);
    dirSizes.set(dir, (dirSizes.get(dir) ?? 0) + 1);
    if (!numberedPythonStem(f.path)) {
      const k = kindStem(f.path);
      const e = stems.get(k) ?? { n: 0, dirs: new Set() };
      e.n++;
      e.dirs.add(dir);
      stems.set(k, e);
    }
    const s = dottedSuffix(f.path);
    if (s !== null) suffixes.set(s, (suffixes.get(s) ?? 0) + 1);
  }
  const recursAsKind = (dirs) => {
    const sizes = [...dirs].map((d) => dirSizes.get(d)).sort((a, b) => a - b);
    if (dirs.size >= sizes[Math.floor((sizes.length - 1) / 2)]) return true;
    const parents = new Map();
    for (const d of [...dirs].filter((d) => d !== "")) parents.set(dirName(d), (parents.get(dirName(d)) ?? 0) + 1);
    return Math.max(0, ...parents.values()) * 2 > dirs.size;
  };
  const pairs = new Map();
  const pstems = new Map();
  for (const f of files) {
    if (numberedPythonStem(f.path)) continue;
    const k = pythonLayeredKind(f.path);
    if (k) {
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
      pstems.set(stem(f.path), (pstems.get(stem(f.path)) ?? 0) + 1);
    }
  }
  const layers = new Set([...pairs].filter(([k, n]) => n >= LITERAL_STEM_MIN && (pstems.get(k.split("/").pop()) ?? 0) > n).map(([k]) => k));
  return {
    literal: new Set([...stems].filter(([s, e]) => e.n >= LITERAL_STEM_MIN && s !== "index" && recursAsKind(e.dirs)).map(([s]) => s)),
    suffixes: new Set([...suffixes].filter(([, n]) => n >= SUFFIX_MIN).map(([s]) => s)),
    layers,
  };
}
export function kindOf(kinds, path) {
  const layered = pythonLayeredKind(path);
  if (layered && kinds.layers.has(layered)) return layered;
  const s = dottedSuffix(path);
  if (s !== null && kinds.suffixes.has(s)) return `*.${s}`;
  if (kinds.literal.has(stem(path))) return stem(path);
  const k = kindStem(path);
  return kinds.literal.has(k) ? k : "*";
}
const sel = (o) => ({ package: o.package, dir: o.dir, file: o.file, entry: o.entry, kind: o.kind, variety: o.variety ?? null, export_name: o.export_name ?? null, member_kind: o.member_kind ?? null });
export const keyOf = (s) => [s.package, s.dir, s.file, s.entry, s.kind, s.variety ?? "", s.export_name ?? "", s.member_kind ?? ""].join("\u0001");
function selectorsFor(file, entry, kind, kinds) {
  const dirs = dirsBelowPackage(file.path, file.package);
  const fk = kindOf(kinds, file.path);
  const out = [];
  for (const depth of ROLE_DEPTHS) {
    if (depth > dirs.length && depth > 1) break;
    const dir = dirs.slice(0, Math.min(depth, dirs.length)).join("/");
    out.push(sel({ package: file.package, dir: dir || ".", file: fk, entry, kind }));
  }
  if (kind === "module") out.push(sel({ package: file.package, dir: PACKAGE_WIDE, file: "*", entry: "-", kind }));
  return out;
}
function classVariety(s) {
  const t = s.traits ?? [];
  if (t.includes("type_var")) return { excluded: true };
  if (s.kind !== "class" || !t.length) return { primary: true };
  if (t.includes("view")) return { excluded: true };
  if (t.includes("protocol")) return { special: "protocol" };
  if (t.includes("base") || t.includes("abstract")) return { excluded: true };
  const k = SPECIAL_KINDS.find((x) => t.includes(x));
  return k ? { special: k } : { primary: true };
}
const memberKind = (s, entry) => (s.kind === "class" && entry === "-" ? (s.traits ?? []).map((t) => (t.startsWith("lineage_") ? t.slice(8) : null)).find((k) => k && LINEAGE.includes(k)) ?? null : null);
const reservedExport = (file, s) => {
  if (!(file.entry_points ?? []).some((e) => e.adapter === "nextjs")) return null;
  return (s.exported_as ?? []).find((n) => NEXT_RESERVED.includes(n)) ?? (NEXT_RESERVED.includes(s.name) ? s.name : null);
};
function placeSelectors(file, s, entry, kind, kinds) {
  const reserved = entry === "-" ? reservedExport(file, s) : null;
  const out = selectorsFor(file, entry, kind, kinds);
  if (reserved) for (const r of out) r.export_name = reserved;
  return out;
}
function symbolSelectors(file, s, entry, kinds) {
  const v = classVariety(s);
  if (v.excluded) return [];
  const out = placeSelectors(file, s, entry, s.kind, kinds);
  if (v.special) for (const r of out) r.variety = v.special;
  else {
    const mk = memberKind(s, entry);
    if (mk) for (const r of out) r.member_kind = mk;
  }
  return out;
}
const plainAliasOf = (s) => {
  if (!["const", "variable"].includes(s.kind)) return null;
  const d = s.derives_from ?? "";
  const i = d.indexOf("#");
  if (i < 0) return null;
  const name = d.slice(i + 1);
  return name && !/[.(]/.test(name) ? d : null;
};
function learnAliases(files) {
  const defs = new Map();
  if (!files.some((f) => (f.symbols ?? []).some((s) => plainAliasOf(s)))) return () => null;
  for (const f of files)
    for (const s of f.symbols ?? []) {
      if (!["function", "component"].includes(s.kind) && !plainAliasOf(s)) continue;
      for (const n of [s.name, ...(s.exported_as ?? [])]) if (!defs.has(`${f.path}#${n}`)) defs.set(`${f.path}#${n}`, s);
    }
  return (s) => {
    let r = plainAliasOf(s);
    for (let i = 0; r && i < 8; i++) {
      const t = defs.get(r);
      if (!t) return null;
      if (["function", "component"].includes(t.kind)) return t;
      r = plainAliasOf(t);
    }
    return null;
  };
}
const entryOf = (file, s) => (file.entry_points ?? []).find((e) => (s.exported_as ?? []).includes(e.symbol))?.kind ?? "-";
// Units, as roles.rs `units` makes them: { path, name, kind, file (true for the file unit), lang, roles: [selector] }.
export function unitsOf(scan) {
  const files = scan.files ?? [];
  const kinds = learnKinds(files);
  const nonProd = learnNonProduction(files);
  const alias = learnAliases(files);
  const out = [];
  for (const f of files) {
    if (isTestPath(f.path) || nonProd(f.path, f.package)) continue;
    for (const s of f.symbols ?? []) {
      if (!(s.exported_as ?? []).length || s.kind === "module") continue;
      const entry = entryOf(f, s);
      const t = entry === "-" ? alias(s) : null;
      const roles = t ? placeSelectors(f, s, entry, t.kind, kinds) : symbolSelectors(f, s, entry, kinds);
      out.push({ path: f.path, name: s.name, kind: t ? t.kind : s.kind, lang: f.lang, roles });
    }
    out.push({ path: f.path, name: "(file)", kind: "module", file: true, lang: f.lang, roles: selectorsFor(f, "-", "module", kinds) });
  }
  for (const m of scan.models ?? []) out.push({ path: m.path, name: m.name, kind: "model", model: true, roles: [sel({ package: "", dir: m.source, file: "(model)", entry: "-", kind: "model" })] });
  const manifestOf = (p) => p.manifest || (p.path ? `${p.path}/package.json` : "package.json");
  const python = (p) => Boolean(p.manifest);
  const prod = (p) => !isTestPath(manifestOf(p)) && !nonProd(manifestOf(p), p.path);
  const nested = [false, true].map((py) => (scan.packages ?? []).filter((p) => python(p) === py && p.path && prod(p)).length);
  for (const p of scan.packages ?? []) {
    if (nested[Number(python(p))] >= 2 && !p.path) continue;
    if (!prod(p)) continue;
    out.push({ path: manifestOf(p), name: p.name, kind: "package", package_unit: true, roles: [sel({ package: "", dir: ".", file: python(p) ? "pyproject.toml" : "package.json", entry: "-", kind: "package" })] });
  }
  return { units: out, kinds, nonProd };
}
// Roles: selector key -> unit indices, kept when they span files (mine.rs spans_files), then those of >= MIN_ROLE_SIZE.
export function rolesOf(units) {
  const roles = new Map();
  units.forEach((u, i) => {
    for (const r of u.roles) {
      const k = keyOf(r);
      (roles.get(k) ?? roles.set(k, { sel: r, members: [] }).get(k)).members.push(i);
    }
  });
  for (const [k, r] of roles) {
    const allPy = r.members.every((m) => units[m].lang === "py");
    if (allPy && new Set(r.members.map((m) => units[m].path)).size < ROLE_MIN_FILES) roles.delete(k);
  }
  return roles;
}
const keyCache = new WeakMap();
// roles.rs RoleSelector::includes, for a convention's role (with `also` parts and a role narrowed below depth 5).
export function includes(role, unitRoles, path) {
  if ((role.also ?? []).length) return [{ ...role, also: [] }, ...role.also].some((p) => includes(p, unitRoles, path));
  let keys = keyCache.get(unitRoles);
  if (!keys) keyCache.set(unitRoles, (keys = new Set(unitRoles.map(keyOf))));
  const r = sel(role);
  if (keys.has(keyOf(r))) return true;
  const segs = r.dir.split("/");
  if (segs.length <= 5 || r.dir === PACKAGE_WIDE) return false;
  const top = { ...r, dir: segs.slice(0, 5).join("/") };
  const below = dirsBelowPackage(path, r.package);
  return keys.has(keyOf(top)) && segs.every((s, i) => below[i] === s);
}

// The class of a source file, for the unmapped breakdown: by path and its facts only (descriptive, not Drift's).
export function fileClass(path, facts) {
  const p = path.toLowerCase();
  const f = fileName(p);
  const segs = p.split("/");
  const has = (...names) => segs.slice(0, -1).some((s) => names.includes(s));
  const traits = (facts?.symbols ?? []).flatMap((s) => s.traits ?? []);
  if (isTestPath(path) || /(^|\/)(test|tests|spec|__tests__)(\/|$)|^test|_test\.|\.test\.|\.spec\./.test(p)) return "test";
  if (has("migrations", "versions") && (p.endsWith(".py") || has("migrations"))) return "migration";
  if (/\.(config|conf)\.[cm]?[jt]s$|(^|\/)(settings|config|conf|constants?)\.py$|(^|\/)(vite|next|tailwind|postcss|eslint|jest|vitest|webpack|babel|playwright|drizzle|prettier)\.config\./.test(p) || has("config", "configs", "settings")) return "config";
  if (has("scripts", "script", "bin", "tools", "cli") || f === "manage.py" || f === "setup.py") return "script";
  if ((/^use[A-Z0-9]/.test(fileName(path)) && /\.[cm]?[jt]sx?$/.test(f)) || has("hooks")) return "hook";
  if ((facts?.entry_points ?? []).length || /^(page|layout|route|loader|action|\+page|\+layout|\+server)\./.test(f) || has("pages", "routes", "app") && /\.(tsx|jsx)$/.test(f)) return "route/page";
  if (has("models") && p.endsWith(".py") || f === "models.py" || /\.entity\.|\.model\./.test(f) || traits.some((t) => t === "lineage_model")) return "ORM model";
  if (has("schemas", "schema", "dto", "dtos") || traits.includes("dataclass") || traits.includes("typeddict") || /\.dto\.|schemas?\.py$/.test(f)) return "pydantic/dataclass model";
  if (has("routers", "router", "endpoints", "api", "views") || /^(urls|views|deps|dependencies|router|routes|api)\.py$/.test(f) || /\.(controller|router|resolver)\./.test(f)) return "router/dep";
  if (has("services", "service") || /\.service\.|services?\.py$/.test(f)) return "service";
  if (/\.(tsx|jsx|vue|svelte)$/.test(f) || has("components", "component", "ui")) return "component";
  if (has("types", "typings", "interfaces") || /\.types?\.[cm]?ts$|^types?\.py$/.test(f)) return "types";
  if (has("utils", "util", "lib", "libs", "helpers", "helper", "common", "shared") || /^(utils?|helpers?)\./.test(f)) return "util";
  if (f === "__init__.py" || /^index\.[cm]?[jt]sx?$/.test(f)) return "index/__init__";
  return "other";
}

// Map coverage of one repo. sources: [{ path, loc }] (tracked source files); scan: `drift scan --json`; pkgs: [{ dir }]
// (apps-coverage packagesOf); mined / shown: { default: [proposal], python_opt_in: [proposal] } from `census --json`.
export function mapCoverage({ sources, scan, pkgs, mined, shown, census }) {
  const byPath = new Map((scan.files ?? []).map((f) => [f.path, f]));
  const skipped = new Map((scan.skipped ?? []).map((s) => [s.path, s.reason]));
  const { units, nonProd } = unitsOf(scan);
  const raw = new Map();
  units.forEach((u, i) => {
    for (const r of u.roles) (raw.get(keyOf(r)) ?? raw.set(keyOf(r), []).get(keyOf(r))).push(i);
  });
  const roles = rolesOf(units);
  const big = new Set([...roles].filter(([, r]) => r.members.length >= MIN_ROLE_SIZE).map(([k]) => k));
  const unitsByPath = new Map();
  units.forEach((u) => (unitsByPath.get(u.path) ?? unitsByPath.set(u.path, []).get(u.path)).push(u));
  const covered = (props) => {
    const s = new Set();
    for (const p of props) for (const u of units) if (!s.has(u.path) && includes(p.role, u.roles, u.path)) s.add(u.path);
    return s;
  };
  const cov = {};
  for (const v of ["default", "python_opt_in"]) cov[v] = { mined: covered(mined[v] ?? []), shown: covered(shown[v] ?? []) };
  // Validation against the product: roles_considered and each mined proposal's member count.
  const check = {};
  for (const v of ["default", "python_opt_in"]) {
    const props = mined[v] ?? [];
    check[v] = { roles: big.size, census_roles: census?.[v]?.roles ?? null, units: units.length, census_units: census?.[v]?.units ?? null, proposals: props.length, member_counts_match: props.filter((p) => units.filter((u) => includes(p.role, u.roles, u.path)).length === p.role.members).length };
  }
  const wsNames = new Set((scan.packages ?? []).map((p) => p.name).filter(Boolean));
  const pkgOf = (path) => pkgs.map((p) => p.dir).filter((d) => d === "" || path.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
  const rows = sources.map(({ path, loc }) => {
    const f = byPath.get(path);
    const us = unitsByPath.get(path) ?? [];
    const sym = us.filter((u) => !u.file && !u.model && !u.package_unit);
    const inSymRole = sym.some((u) => u.roles.some((r) => big.has(keyOf(r))));
    const inAnyRole = us.some((u) => u.roles.some((r) => big.has(keyOf(r))));
    let internal = 0;
    let unresolved = 0;
    for (const i of f?.imports ?? []) {
      const m = i.module ?? "";
      if (m.startsWith("unresolved:")) unresolved++;
      else if (m.startsWith("pkg:")) {
        const name = m.slice(4).split("#")[0];
        if ([...wsNames].some((n) => name === n || name.startsWith(`${n}/`))) unresolved++; // a workspace package not resolved to its files
      } else if (!m.startsWith("global#")) internal++;
    }
    let why = null;
    if (!inSymRole) {
      if (!f) why = skipped.has(path) ? `not parsed: ${skipped.get(path)}` : "not in the fact index (not scanned)";
      else if (f.parse_ok === false) why = "parse failed";
      else if (isTestPath(path)) why = "test path (forms no role)";
      else if (nonProd(path, f.package)) why = "demo or integration-suite code";
      else if (!sym.length) why = (f.symbols ?? []).some((s) => (s.exported_as ?? []).length) ? "exports only module-level code" : "no exported symbol";
      else if (sym.every((u) => !u.roles.length)) why = "only base, abstract, view or type-variable classes";
      else {
        const sizes = sym.flatMap((u) => u.roles.map((r) => (raw.get(keyOf(r)) ?? []).length));
        const max = Math.max(...sizes);
        why = max >= MIN_ROLE_SIZE ? "Python role within fewer than 3 files" : `largest role ${max < 4 ? "1-3" : "4-7"} members (< ${MIN_ROLE_SIZE})`;
      }
    }
    return {
      path,
      loc,
      parsed: Boolean(f && f.parse_ok !== false),
      drift_package: f ? f.package : null,
      package: pkgOf(path),
      in_role: inSymRole,
      in_any_role: inAnyRole,
      imports_internal: internal,
      imports_unresolved: unresolved,
      mined: cov.default.mined.has(path),
      shown: cov.default.shown.has(path),
      mined_py: cov.python_opt_in.mined.has(path),
      shown_py: cov.python_opt_in.shown.has(path),
      why,
      class: inSymRole ? null : fileClass(path, f),
    };
  });
  const share = (xs, pred) => ({ files: xs.filter(pred).length, of_files: xs.length, loc: xs.filter(pred).reduce((a, r) => a + r.loc, 0), of_loc: xs.reduce((a, r) => a + r.loc, 0) });
  const measures = (xs) => ({
    files_parsed: share(xs, (r) => r.parsed),
    files_in_package: share(xs, (r) => r.parsed && r.drift_package !== null && r.package !== null && r.drift_package === r.package),
    files_in_nonroot_drift_package: share(xs, (r) => r.parsed && Boolean(r.drift_package)),
    files_in_role: share(xs, (r) => r.in_role),
    files_in_any_role: share(xs, (r) => r.in_any_role),
    imports: { internal_resolved: xs.reduce((a, r) => a + r.imports_internal, 0), internal_unresolved: xs.reduce((a, r) => a + r.imports_unresolved, 0) },
    files_under_mined: share(xs, (r) => r.mined),
    files_under_shown: share(xs, (r) => r.shown),
    files_under_mined_py: share(xs, (r) => r.mined_py),
    files_under_shown_py: share(xs, (r) => r.shown_py),
  });
  const unmapped = {};
  for (const r of rows.filter((r) => !r.in_role)) {
    const k = `${r.class}\t${r.why}`;
    const e = (unmapped[k] ??= { class: r.class, why: r.why, files: 0, loc: 0 });
    e.files++;
    e.loc += r.loc;
  }
  const perPackage = pkgs.map((p) => {
    const xs = rows.filter((r) => r.package === p.dir);
    const m = measures(xs);
    return { dir: p.dir, kind: p.kind, ...m, silent: { default: m.files_under_shown.files === 0, python_opt_in: m.files_under_shown_py.files === 0 } };
  });
  return { check, repo: measures(rows), per_package: perPackage, unmapped: Object.values(unmapped).sort((a, b) => b.loc - a.loc) };
}
