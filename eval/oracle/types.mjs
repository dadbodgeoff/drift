// Differential test of Drift's parameter-type facts against the TypeScript compiler.
//
//   drift --root REPO --no-cache scan --out facts.json
//   node eval/oracle/types.mjs REPO facts.json [--json out.json] [--files N] [--strict] [--verbose]
//
// Drift records, for each object key a call passes, whether the callee's declared
// parameter type requires it (`Symbol.arg_types`: `callee@i:key=required|optional|unknown`).
// Here every call in the files that have such facts is resolved again with the
// type checker: the resolved signature's declaration gives the callee
// (`file#name` or `file#Class.method`), its parameter `i` gives the declared type,
// and each key is looked up on it.
//
// The compiler's answer uses Drift's definition (crates/drift-ts/src/typeres.rs):
// optional when the property is declared optional, its declared type has an
// `undefined` or `void` member, or the callee's destructuring pattern gives the
// key a default; required otherwise; unknown when the type has no such property
// (index signatures, unions without it) or the call does not resolve. A nested
// key `a.b` is required when every segment is.
//
// Callees declared in `node_modules` are named `pkg:<package>#name`, and Drift's
// `pkg:<package>/<subpath>#name` callees are compared by package.
//
// Categories: `agree`, `DISAGREE` (both known, different: always a bug),
// `drift_only` (Drift known, the compiler not), `tsc_only` (a coverage gap).
// With `--strict` (for fixtures that type-check cleanly) `drift_only` counts as a
// disagreement too: there the compiler answers every key it can, so a key Drift
// answers and the compiler does not (an index signature's key) is a Drift error.
// Needs the `typescript` package (set TS_PATH to its directory if not installed here).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH ?? "typescript");

const [root, factsPath, ...rest] = process.argv.slice(2);
if (!root || !factsPath) {
  console.error("usage: node types.mjs REPO facts.json [--json out.json] [--files N]");
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : dflt;
};
const MAX_FILES = Number(opt("--files", "100000"));
const MAX_KEY_DEPTH = 3;
const absRoot = resolve(root);
const rel = (p) => relative(absRoot, p).split(sep).join("/");

// ---------------------------------------------------------------- Drift's facts
/** `pkg:@a/b/sub#x@0:k` -> `pkg:@a/b#x@0:k`: packages are compared by name. */
const normCallee = (k) => k.replace(/^pkg:((?:@[^/#]+\/)?[^/#]+)[^#]*#/, "pkg:$1#");
const STRICT = rest.includes("--strict");
const facts = JSON.parse(readFileSync(factsPath, "utf8"));
/** file -> Map("callee@i:key" -> required|optional|unknown) */
const drift = new Map();
for (const f of facts.files) {
  for (const s of f.symbols) {
    for (const a of s.arg_types ?? []) {
      const eq = a.lastIndexOf("=");
      const k = normCallee(a.slice(0, eq));
      const v = a.slice(eq + 1);
      if (!drift.has(f.path)) drift.set(f.path, new Map());
      const m = drift.get(f.path);
      if (m.has(k) && m.get(k) !== v) {
        console.error(`${f.path}: ${k} is ${m.get(k)} in one symbol and ${v} in another`);
        process.exitCode = 1;
      }
      m.set(k, v);
    }
  }
}
const files = [...drift.keys()]
  .filter((p) => [...drift.get(p).values()].some((v) => v !== "unknown"))
  .filter((p) => /\.[cm]?tsx?$/.test(p))
  .sort()
  .slice(0, MAX_FILES);

// ---------------------------------------------------------------- the compiler
const configCache = new Map();
/** The tsconfig governing `file`: compiler options, and its files that can change
 * other files' types (declaration files and module augmentations), which the
 * program must include although nothing imports them. */
function configFor(file) {
  const cfgPath = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  if (configCache.has(cfgPath)) return configCache.get(cfgPath);
  let options = {};
  let ambient = [];
  if (cfgPath) {
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (read.config) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(cfgPath), undefined, cfgPath);
      options = parsed.options;
      ambient = parsed.fileNames.filter((f) => {
        if (/\.d\.[cm]?ts$/.test(f)) return true;
        try {
          const text = readFileSync(f, "utf8");
          return text.includes("declare module") || text.includes("declare global");
        } catch {
          return false;
        }
      });
    }
  }
  // Drift's definition is the strict one: `?` adds `undefined`, nothing else does.
  options = { ...options, strict: true, strictNullChecks: true, noEmit: true, allowJs: true, skipLibCheck: true };
  const cfg = { options, ambient };
  configCache.set(cfgPath, cfg);
  return cfg;
}

const byConfig = new Map();
for (const f of files) {
  const abs = join(absRoot, f);
  const cfg = configFor(abs);
  if (!byConfig.has(cfg)) byConfig.set(cfg, []);
  byConfig.get(cfg).push(abs);
}

const includesUndefined = (t) =>
  (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0 ||
  (t.isUnion() && t.types.some((x) => (x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0));

/** The callee id Drift would give the declaration of a resolved signature. */
function calleeId(decl, call) {
  if (!decl) return null;
  const file = decl.getSourceFile().fileName;
  const r = rel(file);
  const posix = file.split(sep).join("/");
  const pkgs = [...posix.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)];
  const pkg = pkgs.length ? `pkg:${pkgs[pkgs.length - 1][1]}` : null;
  if (!pkg && r.startsWith("..")) return null;
  let name = null;
  if (ts.isFunctionDeclaration(decl) && decl.name) name = decl.name.text;
  else if ((ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)) && ts.isVariableDeclaration(decl.parent) && ts.isIdentifier(decl.parent.name))
    name = decl.parent.name.text;
  else if (ts.isMethodDeclaration(decl) && ts.isClassDeclaration(decl.parent) && decl.parent.name && ts.isIdentifier(decl.name))
    name = `${decl.parent.name.text}.${decl.name.text}`;
  else if ((ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)) && ts.isPropertyDeclaration(decl.parent) && ts.isClassDeclaration(decl.parent.parent) && decl.parent.parent.name && ts.isIdentifier(decl.parent.name))
    name = `${decl.parent.parent.name.text}.${decl.parent.name.text}`;
  // Drift names a package function imported by default `pkg:<package>#default`.
  if (name && pkg && ts.isIdentifier(call.expression)) {
    const sym = checker.getSymbolAtLocation(call.expression);
    if (sym && sym.flags & ts.SymbolFlags.Alias && sym.declarations?.some((d) => ts.isImportClause(d))) name = "default";
  }
  return name ? `${pkg ?? r}#${name}` : null;
}

function literalKeys(obj, prefix, depth, out) {
  for (const p of obj.properties) {
    // Method shorthand and accessors are keys too (Drift records them).
    const keyed =
      ts.isPropertyAssignment(p) ||
      ts.isShorthandPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p);
    if (!keyed) continue;
    if (p.name && ts.isComputedPropertyName(p.name)) continue;
    const k = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) ? p.name.text : null;
    if (k === null) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    out.push(key);
    let v = ts.isPropertyAssignment(p) ? p.initializer : null;
    while (v && (ts.isParenthesizedExpression(v) || ts.isAsExpression(v) || ts.isSatisfiesExpression(v) || ts.isNonNullExpression(v))) v = v.expression;
    if (v && ts.isObjectLiteralExpression(v) && depth + 1 < MAX_KEY_DEPTH) literalKeys(v, key, depth + 1, out);
  }
}

function requirement(checker, param, key) {
  let type = checker.getTypeAtLocation(param);
  const defaults = new Set();
  if (ts.isObjectBindingPattern(param.name)) {
    for (const el of param.name.elements) {
      const k = el.propertyName ?? el.name;
      if (el.initializer && ts.isIdentifier(k)) defaults.add(k.text);
    }
  }
  let result = "required";
  const segs = key.split(".");
  for (let i = 0; i < segs.length; i++) {
    if (type.isUnion()) type = checker.getNonNullableType(type);
    const prop = checker.getPropertyOfType(type, segs[i]);
    if (!prop) return "unknown";
    const pt = checker.getTypeOfSymbol(prop);
    const declaredOptional = (i === 0 && defaults.has(segs[i])) || (prop.flags & ts.SymbolFlags.Optional) !== 0;
    // A type the compiler could not resolve (an uninstalled package) is `any`, which
    // absorbs `undefined`: unless the key is optional anyway, the compiler cannot answer.
    if (!declaredOptional && (pt.flags & ts.TypeFlags.Any) !== 0 && pt.intrinsicName === "error") return "unknown";
    const optional = declaredOptional || includesUndefined(pt);
    if (optional) result = "optional";
    type = pt;
  }
  return result;
}

let checker;
const report = { files: files.length, checked: 0, agree: 0, DISAGREE: [], drift_only: [], tsc_only: [] };
for (const [{ options, ambient }, roots] of byConfig) {
  const program = ts.createProgram([...new Set([...roots, ...ambient])], options);
  checker = program.getTypeChecker();
  for (const abs of roots) {
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const r = rel(abs);
    const tsc = new Map();
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const sig = checker.getResolvedSignature(node);
        const decl = sig?.declaration;
        const id = calleeId(decl, node);
        if (id && decl.parameters) {
          // A `this` parameter is not an argument.
          const first = decl.parameters[0];
          const offset = first && ts.isIdentifier(first.name) && first.name.text === "this" ? 1 : 0;
          node.arguments.forEach((arg, i) => {
            let a = arg;
            while (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isSatisfiesExpression(a) || ts.isNonNullExpression(a)) a = a.expression;
            if (!ts.isObjectLiteralExpression(a)) return;
            const param = decl.parameters[i + offset];
            if (!param || param.dotDotDotToken) return;
            const keys = [];
            literalKeys(a, "", 0, keys);
            for (const k of keys) {
              const v = requirement(checker, param, k);
              const kk = `${id}@${i}:${k}`;
              // Several call sites must agree; otherwise the key is not decided by the declaration.
              tsc.set(kk, tsc.has(kk) && tsc.get(kk) !== v ? "unknown" : v);
            }
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const [k, d] of drift.get(r) ?? []) {
      const t = tsc.get(k) ?? "unknown";
      report.checked++;
      if (d === "unknown" && t === "unknown") continue;
      if (d === "unknown") report.tsc_only.push({ file: r, key: k, tsc: t });
      else if (t === "unknown") {
        report.drift_only.push({ file: r, key: k, drift: d });
        if (STRICT) report.DISAGREE.push({ file: r, key: k, drift: d, tsc: t });
      }
      else if (d === t) report.agree++;
      else report.DISAGREE.push({ file: r, key: k, drift: d, tsc: t });
    }
  }
}
console.log(
  `files ${report.files}, keys ${report.checked}: agree ${report.agree}, DISAGREE ${report.DISAGREE.length}, drift_only ${report.drift_only.length}, tsc_only ${report.tsc_only.length}`,
);
for (const d of report.DISAGREE.slice(0, 50)) console.log(`DISAGREE ${d.file} ${d.key}: drift ${d.drift}, tsc ${d.tsc}`);
if (rest.includes("--verbose")) {
  for (const d of report.drift_only) console.log(`drift_only ${d.file} ${d.key}: ${d.drift}`);
  for (const d of report.tsc_only) console.log(`tsc_only ${d.file} ${d.key}: ${d.tsc}`);
}
const jsonOut = opt("--json", null);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
if (report.DISAGREE.length) process.exitCode = 1;
