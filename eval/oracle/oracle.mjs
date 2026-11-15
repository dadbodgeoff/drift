// Differential test of Drift's TypeScript parser against the TypeScript compiler.
//
//   drift --root REPO debug imports > imports.jsonl
//   drift --root REPO scan --no-cache --out facts.json
//   node eval/oracle/oracle.mjs REPO imports.jsonl facts.json [--samples 400] [--json out.json]
//
// Imports: every specifier Drift saw is resolved again with ts.resolveModuleName,
// using the file's own tsconfig. Exports: a sample of files is type-checked
// (noResolve) and the module's value exports are compared with Drift's.
// Needs the `typescript` package (set TS_PATH to its directory if not installed here).
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH ?? "typescript");

const [root, importsPath, factsPath, ...rest] = process.argv.slice(2);
if (!root || !importsPath || !factsPath) {
  console.error("usage: node oracle.mjs REPO imports.jsonl facts.json [--samples N] [--json out.json]");
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : dflt;
};
const SAMPLES = Number(opt("--samples", "400"));
const absRoot = resolve(root);
const rel = (p) => relative(absRoot, p).split(sep).join("/");
const inRepo = (p) => p && !rel(p).startsWith("..") && !p.includes(`${sep}node_modules${sep}`);

// ---------------------------------------------------------------- tsconfig per directory
const configCache = new Map();
function optionsFor(file) {
  const cfgPath = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  if (configCache.has(cfgPath)) return configCache.get(cfgPath);
  let options = {};
  if (cfgPath) {
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (read.config) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(cfgPath), undefined, cfgPath);
      options = parsed.options;
    }
  }
  options = {
    ...options,
    allowJs: true,
    resolveJsonModule: true,
    moduleResolution: options.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    module: options.module ?? ts.ModuleKind.ESNext,
  };
  configCache.set(cfgPath, options);
  return options;
}

const isDts = (p) => /\.d\.[cm]?ts$/.test(p);
/** `knex` -> `.../@types/knex.d.ts` or `.../types/knex/index.d.ts`. */
const isAmbientTypesFor = (spec, p) => {
  if (!isDts(p) || spec.startsWith(".") || !/(^|\/)@?types\//.test(p)) return false;
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  const base = stripExt(p);
  return base.endsWith(`/${name}`) || base.endsWith(`/${name.replace("@", "").replace("/", "__")}`);
};
const stripExt = (p) => p.replace(/\.d\.[cm]?ts$/, "").replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");

// ---------------------------------------------------------------- imports
const rows = readFileSync(importsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cats = {};
const examples = {};
function bump(cat, row, ts) {
  cats[cat] = (cats[cat] ?? 0) + 1;
  (examples[cat] ??= []).length < 6 && examples[cat].push({ file: row.file, spec: row.spec, drift: row.module, ts });
}
for (const row of rows) {
  const file = join(absRoot, row.file);
  const r = ts.resolveModuleName(row.spec, file, optionsFor(file), ts.sys).resolvedModule;
  const tsPath = r && inRepo(r.resolvedFileName) ? rel(r.resolvedFileName) : null;
  const tsExternal = r && !tsPath;
  const d = row.module;
  const dKind = d.startsWith("pkg:") ? "pkg" : d.startsWith("unresolved:") ? "unresolved" : "repo";
  if (tsPath) {
    if (dKind === "repo" && d === tsPath) bump("agree", row, tsPath);
    else if (dKind === "repo" && isDts(tsPath) && stripExt(d) === stripExt(tsPath)) bump("agree_source_vs_dts", row, tsPath);
    else if (dKind === "repo") bump("DISAGREE", row, tsPath);
    // `typeRoots: ["./src/@types"]` lets TypeScript resolve a bare package name to an
    // in-repo augmentation (`src/@types/knex.d.ts`). The import is still the package.
    else if (dKind === "pkg" && isAmbientTypesFor(row.spec, tsPath)) bump("agree_package_with_repo_types", row, tsPath);
    else if (dKind === "pkg") bump("GAP_package_but_in_repo", row, tsPath);
    else bump("GAP_unresolved_but_ts_resolves", row, tsPath);
  } else if (tsExternal) {
    bump(dKind === "pkg" ? "agree_external" : `ts_external_drift_${dKind}`, row, r.resolvedFileName.slice(-80));
  } else {
    // TypeScript could not resolve (often: no node_modules in a fresh clone).
    if (dKind === "repo") bump("drift_only_resolves", row, null);
    else if (dKind === "pkg") bump("both_external_unresolved", row, null);
    else bump("both_unresolved", row, null);
  }
}

// ---------------------------------------------------------------- exports
const facts = JSON.parse(readFileSync(factsPath, "utf8"));
const byPath = new Map(facts.files.map((f) => [f.path, f]));
// Deterministic sample: every k-th file in path order.
const all = facts.files.map((f) => f.path).sort();
const step = Math.max(1, Math.floor(all.length / SAMPLES));
const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLES);
const program = ts.createProgram(
  sample.map((p) => join(absRoot, p)),
  { allowJs: true, checkJs: false, noResolve: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.Preserve, types: [] },
);
const checker = program.getTypeChecker();
const exp = { files: 0, ts_names: 0, matched: 0, missing: 0, extra: 0 };
const missingEx = [];
const extraEx = [];
const missingByKind = {};
for (const p of sample) {
  const sf = program.getSourceFile(join(absRoot, p));
  if (!sf) continue;
  exp.files++;
  // CommonJS files are not "external modules" to getSymbolAtLocation; their symbol lives on the file.
  const sym = checker.getSymbolAtLocation(sf) ?? sf.symbol;
  const tsNames = new Set();
  if (sym) {
    for (const s of checker.getExportsOfModule(sym)) {
      const typeOnly = s.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) && !(s.flags & ts.SymbolFlags.Value);
      const decl = s.declarations?.[0];
      const explicitType = decl && (decl.isTypeOnly || decl.parent?.isTypeOnly || decl.parent?.parent?.isTypeOnly);
      // `module.exports = x` is TypeScript's `export=`; Drift calls it `default`.
      const name = String(s.escapedName) === "export=" ? "default" : String(s.escapedName);
      if (!typeOnly && !explicitType && name !== "__esModule" && name !== "prototype") tsNames.add(name);
    }
  }
  const dNames = new Set((byPath.get(p)?.exports ?? []).map((e) => e.name).filter((n) => n !== "*"));
  // CommonJS `export =`/module.exports shows up as `export=` in TypeScript.
  for (const n of tsNames) {
    exp.ts_names++;
    if (dNames.has(n)) exp.matched++;
    else {
      exp.missing++;
      const s = checker.getExportsOfModule(sym).find((x) => String(x.escapedName) === n || (n === "default" && String(x.escapedName) === "export="));
      const kind = s?.declarations?.[0] ? ts.SyntaxKind[s.declarations[0].kind] : "unknown";
      missingByKind[kind] = (missingByKind[kind] ?? 0) + 1;
      missingEx.length < 12 && missingEx.push(`${p} :: ${n} (${kind})`);
    }
  }
  for (const n of dNames) {
    if (!tsNames.has(n)) {
      exp.extra++;
      extraEx.length < 8 && extraEx.push(`${p} :: ${n}`);
    }
  }
}

const out = { repo: root, imports: { total: rows.length, categories: cats, examples }, exports: { ...exp, missingByKind, missingEx, extraEx } };
const json = opt("--json", null);
if (json) writeFileSync(json, JSON.stringify(out, null, 2));
console.log(`== ${root}`);
console.log(`imports: ${rows.length}`);
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${v}`);
console.log(`exports (sample of ${exp.files} files): ${exp.matched}/${exp.ts_names} TypeScript value exports found, ${exp.missing} missing, ${exp.extra} extra`);
if (exp.missing) console.log(`  missing by declaration kind: ${JSON.stringify(missingByKind)}`);
