#!/usr/bin/env node
/**
 * O-3: the evasion matrix as a pinned suite - 13 import shapes x the 7 eval repos.
 *
 * Prior art: the 2026-07-27 bench evasion matrix (12 shapes, ad hoc, results eyeballed).
 * This port makes it first-class: hermetic per repo, the hardened predicate semantics of
 * external-eval (exit code, enforcement-vs-mode, attribution - shapeVerdict in
 * scripts/external-eval-predicate.mjs), and a committed baseline of expected outcomes per
 * shape x repo (scripts/evasion-baseline.json) that records HONEST current truth:
 * shapes that block, shapes that legitimately refuse (fail-closed), and shapes that
 * still evade - `known_evasion: true`, never hidden - so progress and regression are
 * pinned in both directions.
 *
 * Shape classes:
 *   catch    the violation reaches the route at runtime; must be caught, attributed to
 *            the route itself (EVERY finding, pin a), and enforced at the contract's
 *            mode (block-mode repos exit 2, warn-mode exit 0). A fail-closed refusal
 *            (exit 3) is a legitimate landing pinned per cell by the baseline.
 *   silent   negative controls (type-only, sibling lookalike): a finding is a FAIL.
 *   observe  recorded, baseline-pinned, no class-level expectation (side-effect import).
 *   refuse   the refusal scenario (pin b): a non-existent decoy subpath alone must exit
 *            3 with blocked_reasons naming the decoy route. S01 is the blocking
 *            scenario: the real violation alone must exit 2 on block-mode repos.
 *
 *   node scripts/evasion-matrix.mjs                  # verify against baseline
 *   node scripts/evasion-matrix.mjs --update         # rewrite the baseline
 *   node scripts/evasion-matrix.mjs --only dub,taxonomy
 *
 * `--only X --update` merges the re-measured repos into the existing baseline; it never
 * truncates other repos' rows (the external-eval `--only --update` data-loss bug, O-4).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EVAL_REPOS } from "./eval-repos.mjs";
import { shapeVerdict, unsafeShapeMoves, updateGate } from "./external-eval-predicate.mjs";
import { importOf } from "./data-layer-import.mjs";
import { contaminationAllowed, contaminationRefusal } from "./worktree-contamination.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const BASELINE = join(HERE, "evasion-baseline.json");
const REPOS_DIR = process.env.DRIFT_EVAL_REPOS || join(homedir(), "drift-falsification/repos");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
// O-4: each explicitly accepted unsafe move, as "<repo>:<shapeId>.<field>". Repeatable.
const ACCEPTED_REGRESSIONS = new Set(
  args.flatMap((arg, index) => (arg === "--accept-regression" && args[index + 1] ? [args[index + 1]] : []))
);
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex >= 0 && args[onlyIndex + 1]
    ? args[onlyIndex + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;

const env = { ...process.env, DRIFT_ENGINE_BIN: ENGINE };
delete env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function drift(cwd, extraEnv, ...a) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...a], {
      cwd,
      encoding: "utf8",
      env: { ...env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024
    });
    return { ok: true, stdout, code: 0 };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.toString() ?? "", code: error.status ?? 1 };
  }
}

/** Identical to external-eval's resetTree: clean alone leaves staged files behind. */
function resetTree(root) {
  try {
    git(root, "reset", "-q", "--hard", "HEAD");
    git(root, "clean", "-qfd");
  } catch {
    /* best effort */
  }
}

/**
 * Resolve a specifier to a repo-relative file (for the relative-path shape), consulting
 * tsconfig path aliases (root and common app roots) and workspace package names. Ported
 * from the bench matrix. Returns null when unresolvable - the shape records UNTESTABLE
 * rather than guessing.
 */
function resolveSpec(repoDir, spec) {
  const candidates = [];
  for (const tsDir of [".", "apps/web", "apps/dashboard", "apps/server"]) {
    const tsPath = join(repoDir, tsDir, "tsconfig.json");
    if (!existsSync(tsPath)) continue;
    let ts;
    try {
      ts = JSON.parse(readFileSync(tsPath, "utf8").replace(/^\s*\/\/.*$/gm, ""));
    } catch {
      continue;
    }
    const paths = ts?.compilerOptions?.paths ?? {};
    for (const [alias, targets] of Object.entries(paths)) {
      const prefix = alias.replace(/\*$/, "");
      if (!spec.startsWith(prefix)) continue;
      for (const target of targets) {
        candidates.push(join(tsDir, target.replace(/\*$/, ""), spec.slice(prefix.length)));
      }
    }
  }
  if (spec.startsWith("@") && spec.includes("/")) {
    const pkgName = spec.split("/").slice(0, 2).join("/");
    const sub = spec.split("/").slice(2).join("/");
    let hits = "";
    try {
      hits = execFileSync(
        "sh",
        ["-c", `grep -rl '"name": *"${pkgName}"' --include=package.json packages apps 2>/dev/null | grep -v node_modules | head -3`],
        { cwd: repoDir, encoding: "utf8" }
      );
    } catch {
      hits = "";
    }
    for (const pkgJson of hits.trim().split("\n").filter(Boolean)) {
      const dir = dirname(pkgJson);
      candidates.push(sub ? join(dir, sub) : dir);
      candidates.push(sub ? join(dir, "src", sub) : join(dir, "src"));
      try {
        const main = JSON.parse(readFileSync(join(repoDir, pkgJson), "utf8")).main;
        if (main && !sub) candidates.push(join(dir, main.replace(/\.[jt]s$/, "")));
      } catch {
        /* ignore */
      }
    }
  }
  for (const candidate of candidates) {
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const path = candidate + ext;
      if (existsSync(join(repoDir, path))) return path;
    }
  }
  return null;
}

function routeBody(importLines, useLines) {
  return `${importLines}\nexport async function GET() {\n${useLines}\n  return new Response("ok");\n}\n`;
}

/**
 * The shape catalogue. `files(dir)` maps repo-relative paths to contents; `route` is the
 * file the findings must attribute to. spec/sym are the repo's real data layer from the
 * shared eval-repos table (the same ground truth external-eval injects).
 */
function shapesFor(cfg, relSpec) {
  const spec = cfg.dataModule;
  const sym = cfg.dataSymbol;
  const use = (binding) => `  const __h = ${binding}; void __h;`;
  // The repo's real import kind for its data layer. papermark default-exports and every one of its
  // 204 routes imports it that way; injecting the named form there names a symbol the module does not
  // have. See data-layer-import.mjs. Shapes that import a LOCAL module the matrix writes itself
  // (S03-S05's barrels, S06's namespace) stay named, because those modules are written with named
  // exports by this file.
  const dataImport = (module) => importOf(cfg, module, sym);

  // A barrel that re-exports the data layer under a chosen name.
  //
  // `export { prisma } from "@/lib/prisma"` is wrong for the same reason the named import was: on a
  // module that only default-exports there is no `prisma` to re-export. The right form is
  // `export { default as prisma } from "@/lib/prisma"` - still a re-export statement, which is what
  // S03-S05 exist to test.
  //
  // The first attempt here used `import __data from "..."; export const prisma = __data;`. That
  // compiles, but it is not a re-export, so the chain detection could not follow it and three catch
  // cells silently became evasions - but it is a different shape from the one these cells pin, and
  // quietly substituting it changed what they measure. That shape is D-2/E04, and R8 closed it; it
  // now has cells of its own (S14-S18) rather than borrowing these.
  const reexportFromDataLayer = (exportedAs) =>
    cfg.dataImportKind === "default"
      ? `export { default as ${exportedAs} } from "${spec}";\n`
      : `export { ${sym}${exportedAs === sym ? "" : ` as ${exportedAs}`} } from "${spec}";\n`;

  // ------------------------------------------------------------------------------------
  // R8 / D-2: laundering through a LOCAL BINDING rather than a re-export statement.
  //
  // S03-S05 launder through `export { x } from "<data layer>"` - a statement that carries a
  // `source` field on its AST node, which is the entire reason Drift caught them. Drop the
  // `from` clause and the same republication became invisible: `export const client = db`,
  // `export { db }`, `export function get() { return db }` all reached the route at runtime and
  // all reported a clean pass. S14-S18 pin those now that R8 closed them; S19-S21 pin the
  // negative controls that a loose fix would break; S22-S28 pin what is still open.
  //
  // The laundering module always imports the data layer in the repo's OWN form (papermark
  // default-exports), so `sym` is the local binding name in every one of these.
  const launderPrelude = `${dataImport(spec)}\n`;
  // The namespace member S23 reads. On a default-exporting data layer there is no named member
  // to reach for, and `__ns.default` is the honest equivalent.
  const nsMember = cfg.dataImportKind === "default" ? "default" : sym;
  return [
    {
      id: "S01-control-canonical",
      class: "catch",
      isBlockingScenario: true,
      files: (d) => ({ [`${d}/route.ts`]: routeBody(dataImport(spec), use(sym)) })
    },
    relSpec
      ? {
          id: "S02-relative-path",
          class: "catch",
          files: (d) => ({ [`${d}/route.ts`]: routeBody(dataImport(relSpec(d)), use(sym)) })
        }
      : { id: "S02-relative-path", class: "catch", untestable: "specifier not resolvable to a file" },
    {
      id: "S03-barrel-1hop",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: reexportFromDataLayer(sym),
        [`${d}/route.ts`]: routeBody(`import { ${sym} } from "./data";`, use(sym))
      })
    },
    {
      id: "S04-barrel-2hop",
      class: "catch",
      files: (d) => ({
        [`${d}/inner.ts`]: reexportFromDataLayer(sym),
        [`${d}/outer.ts`]: `export { ${sym} } from "./inner";\n`,
        [`${d}/route.ts`]: routeBody(`import { ${sym} } from "./outer";`, use(sym))
      })
    },
    {
      id: "S05-renamed-reexport",
      class: "catch",
      files: (d) => ({
        [`${d}/util.ts`]: reexportFromDataLayer("helper"),
        [`${d}/route.ts`]: routeBody(`import { helper } from "./util";`, use("helper"))
      })
    },
    {
      id: "S06-namespace-import",
      class: "catch",
      files: (d) => ({ [`${d}/route.ts`]: routeBody(`import * as __ns from "${spec}";`, use("__ns")) })
    },
    {
      id: "S07-dynamic-import",
      class: "catch",
      files: (d) => ({
        [`${d}/route.ts`]: routeBody("", `  const __m = await import("${spec}"); void __m;`)
      })
    },
    {
      id: "S08-require-call",
      class: "catch",
      files: (d) => ({
        [`${d}/route.ts`]: routeBody(
          `declare const require: (id: string) => unknown;`,
          `  const __m = require("${spec}"); void __m;`
        )
      })
    },
    {
      id: "S09-type-only-decoy",
      class: "silent",
      files: (d) => ({
        [`${d}/route.ts`]: routeBody(
          `import type * as __T from "${spec}";`,
          `  const __k: keyof typeof __T | null = null; void __k;`
        )
      })
    },
    {
      // The bench matrix classed this "observe"; that hid the honest answer. A bare
      // `import "<data module>"` executes the module - it IS a runtime dependency on the
      // data layer - and it is currently a silent miss on every repo. Classing it catch
      // records that as known_evasion: true rather than filing it where no one looks.
      id: "S10-side-effect-import",
      class: "catch",
      files: (d) => ({ [`${d}/route.ts`]: routeBody(`import "${spec}";`, "  // side-effect only") })
    },
    {
      id: "S11-lookalike-negative",
      class: "silent",
      files: (d) => ({
        [`${d}/route.ts`]: routeBody(dataImport(`${spec}-legacy`), use(sym))
      })
    },
    cfg.genuineSubpath
      ? {
          id: "S12-genuine-subpath",
          class: "catch",
          files: (d) => ({
            [`${d}/route.ts`]: routeBody(
              `import { ${cfg.genuineSubpathSymbol} } from "${cfg.genuineSubpath}";`,
              use(cfg.genuineSubpathSymbol)
            )
          })
        }
      : {
          id: "S12-genuine-subpath",
          class: "catch",
          untestable: "data module has no real subpath module to import"
        },
    {
      // Pin (b), refusal half. The decoy is deliberately non-existent; the check must
      // refuse (exit 3) naming this route, never block it and never pass.
      id: "S13-refusal-decoy",
      class: "refuse",
      files: (d) => ({
        [`${d}/route.ts`]: routeBody(dataImport(`${spec}/internal`), use(sym))
      })
    },

    // === R8 / D-2, closed: the three shapes plus the two variants that exercise separate code ===

    {
      // E04. The shape the S03 comment above described as "a real evasion shape Drift does not
      // currently catch". It is one token from S03 - the `from` clause - and that token decided
      // whether the product blocked or reported a clean pass.
      id: "S14-alias-const-binding",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export const helper = ${sym};\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    },
    {
      // E04b, the detached clause. `export { db };` with no `from` is handled by a different
      // extractor branch than `export { db } from "./db"` - it was named in no prior audit and is
      // one keystroke from S03 for anyone writing the evasion deliberately.
      id: "S15-alias-detached-clause",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export { ${sym} };\n`,
        [`${d}/route.ts`]: routeBody(`import { ${sym} } from "./data";`, use(sym))
      })
    },
    {
      // E04b, renamed. Its own cell for the same reason S05 is separate from S03: the rename is
      // where the exported name and the source symbol diverge, so it is the only cell that can
      // catch a fact recording one of the two and losing the other - which would make the export
      // unresolvable in its target and the chain unwalkable, while S15 stayed green.
      id: "S16-alias-renamed-clause",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export { ${sym} as helper };\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    },
    {
      // E05. An exported function whose every return is the imported binding. Weaker evidence
      // than an alias - it is a claim about returns, not an identity - and it is the shape whose
      // conservatism boundary S25/S26 pin the far side of.
      id: "S17-wrap-function-return",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export function getHelper() {\n  return ${sym};\n}\n`,
        [`${d}/route.ts`]: routeBody(`import { getHelper } from "./data";`, use("getHelper()"))
      })
    },
    {
      // E05, concise arrow body. Its own cell because there is no `return` token to collect: the
      // body IS the single return, which is a separate path through the wrap rule. A regression
      // that only collected `return_statement` nodes would leave S17 green and this one silent.
      id: "S18-wrap-arrow-return",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export const getHelper = () => ${sym};\n`,
        [`${d}/route.ts`]: routeBody(`import { getHelper } from "./data";`, use("getHelper()"))
      })
    },

    // === R8 / D-2, negative controls: these are NOT laundering and a finding is a FAIL ===
    //
    // The classification rule, applied to every deliberate miss below and in S22-S28: a shape
    // that IS laundering and is not caught is a `known_evasion` (recall gap, recorded, still a
    // catch cell); a shape where the route provably does NOT receive the data layer is `silent`
    // (precision control, a finding is a false positive). The three here are the ones a fix
    // loose enough to close S22-S28 would break first, which is exactly why they are pinned
    // alongside rather than after.

    {
      // The binding is reassigned AWAY from the import before the module finishes evaluating, so
      // the importer receives the replacement, not the data layer. Note the direction: `export
      // let helper = <data layer>` that is NEVER reassigned IS caught (measured), and the
      // reassignment TOWARD the import is S28. Only this direction is a false-positive risk.
      id: "S19-alias-reassigned-away",
      class: "silent",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export let helper = ${sym};\nhelper = null as never;\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    },
    {
      // The returned identifier is a local declaration that shadows the import. Same spelling,
      // different binding; the caller gets the local. A wrap rule that matched on name alone
      // rather than resolving the scope chain would flag this, and it would be wrong.
      id: "S20-wrap-shadowed-local",
      class: "silent",
      files: (d) => ({
        [`${d}/data.ts`]:
          `${launderPrelude}export function getHelper() {\n  const ${sym} = { shadowed: true };\n  return ${sym};\n}\n`,
        [`${d}/route.ts`]: routeBody(`import { getHelper } from "./data";`, use("getHelper()"))
      })
    },
    {
      // The only `return <binding>` in the file belongs to an inner callback. The exported
      // function returns undefined, so the route receives undefined. A naive subtree walk over
      // return statements attributes the inner return to the outer function and flags this.
      id: "S21-wrap-nested-callback",
      class: "silent",
      files: (d) => ({
        [`${d}/data.ts`]:
          `${launderPrelude}export function getHelper() {\n  [1].forEach(() => {\n    return ${sym};\n  });\n}\n`,
        [`${d}/route.ts`]: routeBody(`import { getHelper } from "./data";`, use("getHelper()"))
      })
    },

    // === R8-13, still open: real laundering, deliberately not caught, recorded not hidden ===
    //
    // Each of these reaches the data layer at the route at runtime. They are catch cells and the
    // baseline pins them `known_evasion: true`, which is the matrix's way of saying "this is a
    // miss we can name" rather than filing it where no one looks.

    {
      // Member expression. The fact model has no member path, so a claim about WHICH member was
      // republished would be invented. `.constructor` rather than a repo-specific property: it
      // typechecks on every value in every repo, and the shape under test is the member
      // expression, not which member.
      id: "S22-alias-member-expression",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export const helper = ${sym}.constructor;\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    },
    {
      // Namespace member. Same gap as S22 with a namespace import in front of it; listed
      // separately because the binding table entry is a whole module rather than one symbol, so
      // it is the shape most likely to fall into the alias rule by accident.
      id: "S23-alias-namespace-member",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `import * as __ns from "${spec}";\nexport const helper = __ns.${nsMember};\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    },
    {
      // Property laundering. Closing it needs an object-shape relation - which property of which
      // literal holds which binding - and that is a different fact model, not a looser rule.
      id: "S24-alias-object-literal",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export const api = { ${sym} };\n`,
        [`${d}/route.ts`]: routeBody(`import { api } from "./data";`, use(`api.${nsMember}`))
      })
    },
    {
      // `async` returns a Promise of the binding, not the binding. The route awaits it and does
      // receive the data layer, so this is a miss and not a control - but claiming the awaited
      // value IS the import is a claim about types, and this engine has no type environment.
      id: "S25-wrap-async-function",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export async function getHelper() {\n  return ${sym};\n}\n`,
        [`${d}/route.ts`]: routeBody(
          `import { getHelper } from "./data";`,
          `  const __h = await getHelper(); void __h;`
        )
      })
    },
    {
      // One branch returns the binding and one returns something else. The wrap rule requires
      // EVERY return to be the same binding, because "sometimes the data layer" cannot be
      // decided without the control-flow tier.
      id: "S26-wrap-conditional-return",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]:
          `${launderPrelude}export function getHelper(flag: boolean) {\n  if (flag) {\n    return ${sym};\n  }\n  return null as never;\n}\n`,
        [`${d}/route.ts`]: routeBody(`import { getHelper } from "./data";`, use("getHelper(true)"))
      })
    },
    {
      // Multi-declarator export. The alias rule takes a statement with exactly ONE declarator so
      // that a partially-matching statement cannot emit a half-true fact; two declarators of the
      // same binding is real laundering and is missed. Found in review, not in the plan's table.
      id: "S27-alias-multi-declarator",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export const first = ${sym}, second = ${sym};\n`,
        [`${d}/route.ts`]: routeBody(`import { first } from "./data";`, use("first"))
      })
    },
    {
      // Reassignment TOWARD the import - the honest half of the `let` row. The rule disqualifies
      // any reassigned binding, which is right for S19 and gives this one away for free. Closing
      // it needs flow-sensitive binding state, not a wider rule.
      id: "S28-alias-let-reassigned-to-import",
      class: "catch",
      files: (d) => ({
        [`${d}/data.ts`]: `${launderPrelude}export let helper = null as never;\nhelper = ${sym};\n`,
        [`${d}/route.ts`]: routeBody(`import { helper } from "./data";`, use("helper"))
      })
    }
  ];
}

function classifyOutcome(record, shapeClass) {
  if (shapeClass === "silent") return record.caught ? "false_positive" : "silent";
  if (record.exit === 3) return "refused";
  if (record.caught && record.exit === 2) return "blocked";
  if (record.caught && record.exit === 0) return "warned";
  if (!record.caught && record.exit === 0) return shapeClass === "catch" ? "evaded" : "silent";
  return "unclassified";
}

function evaluateRepo(cfg, baselineRow) {
  const root = join(REPOS_DIR, cfg.name);
  const result = { repo: cfg.name };
  if (!existsSync(root)) return { ...result, onboarded: false, error: "MISSING_REPO", shapes: [] };

  // EW-7 (DET-2): refuse a contaminated worktree rather than measuring it. Before the reset,
  // because the reset is what destroyed the evidence.
  const contamination = contaminationRefusal(root, cfg.name);
  if (contamination.refused && !contaminationAllowed(process.argv)) {
    console.error(`  REFUSED ${cfg.name}: ${contamination.reason}`);
    return {
      ...result,
      onboarded: false,
      error: "CONTAMINATED_WORKTREE",
      contaminated_files: contamination.entries.map((entry) => entry.path),
      shapes: []
    };
  }

  resetTree(root);
  const home = mkdtempSync(join(tmpdir(), "drift-evasion-home-"));
  const repoEnv = { HOME: home, DRIFT_HOME: home };
  try {
    const startArgs = ["start", "--repo-root", ".", "--accept-defaults"];
    if (cfg.declaredDataModules) startArgs.push("--data-modules", cfg.declaredDataModules);
    const start = drift(root, repoEnv, ...startArgs);
    result.onboarded = start.ok;
    if (!start.ok) {
      result.error = "ONBOARD_FAILED";
      result.shapes = [];
      return result;
    }
    const repoId = start.stdout.match(/repos\/(repo_[a-f0-9]+)\//)?.[1] ?? null;
    const dbEnv = { ...repoEnv, DRIFT_DB: join(home, ".drift/repos", repoId ?? "", "drift.sqlite") };

    const contractRun = drift(root, dbEnv, "contract", "show", "--repo", repoId, "--json");
    // CV-5: every shape in this matrix is a statement about the DATA-ACCESS convention - the forbidden
    // import reaches the route at runtime, or it does not. Once a repo can accept more than one
    // convention, "a finding on the injected route" stops meaning "this shape was caught": the silent
    // cells (S09 type-only decoy, S11 lookalike negative) inject routes that call no auth wrapper, so an
    // accepted auth family reports them correctly and the cell would read `false_positive` for the
    // product being right. Attribution, not location.
    let dataConventionId = null;
    try {
      const conventions = JSON.parse(contractRun.stdout).contract.conventions;
      const dataConvention = conventions.find((c) => c.kind === "api_route_no_direct_data_access");
      dataConventionId = dataConvention?.id ?? null;
      result.enforcement_mode = dataConvention?.enforcement_mode ?? null;
    } catch {
      result.enforcement_mode = null;
    }

    // Relative-path ground truth: resolve the data module to a real file once; the shape
    // computes the ./ path from its own injection directory.
    const resolvedTarget = resolveSpec(root, cfg.dataModule);
    result.resolved_target = resolvedTarget;
    const relSpec = resolvedTarget
      ? (injDir) => {
          let rel = relative(injDir, resolvedTarget).replace(/\\/g, "/").replace(/\.tsx?$/, "");
          if (!rel.startsWith(".")) rel = `./${rel}`;
          return rel.replace(/\/index$/, "");
        }
      : null;

    const baselineShapes = new Map((baselineRow?.shapes ?? []).map((shape) => [shape.id, shape]));
    result.shapes = [];
    for (const shape of shapesFor(cfg, relSpec)) {
      if (shape.untestable) {
        result.shapes.push({
          id: shape.id,
          class: shape.class,
          verdict: "UNTESTABLE",
          note: shape.untestable
        });
        continue;
      }
      const injDir = `${cfg.routeDir}/drift-evasion-${shape.id.slice(0, 3).toLowerCase()}`;
      const routePath = `${injDir}/route.ts`;
      const files = shape.files(injDir);
      const injectedPaths = Object.keys(files);
      let record;
      try {
        for (const [path, content] of Object.entries(files)) {
          mkdirSync(join(root, dirname(path)), { recursive: true });
          writeFileSync(join(root, path), content);
        }
        git(root, "add", "-A");
        const check = drift(
          root,
          dbEnv,
          "check",
          "--diff",
          "HEAD",
          "--scope",
          "changed-files",
          "--repo",
          repoId,
          "--json"
        );
        resetTree(root);
        let payload = null;
        try {
          payload = JSON.parse(check.stdout);
        } catch {
          payload = null;
        }
        const findings = (payload?.findings ?? [])
          // Null id keeps the old behaviour for an unreadable contract rather than silently passing.
          .filter((finding) => dataConventionId === null || finding.convention_id === dataConventionId)
          .filter((finding) =>
            (finding.evidence_refs ?? []).some((ref) => injectedPaths.includes(ref.file_path))
          );
        const blockedReasons = payload?.summary?.blocked_reasons ?? [];
        record = {
          id: shape.id,
          class: shape.class,
          route: routePath,
          caught: findings.length > 0,
          findings_count: findings.length,
          exit: check.code,
          check_status: payload?.check?.status ?? null,
          enforcement: findings[0]?.enforcement_result ?? null,
          // Pin (a): the leading evidence file of EVERY finding on the injected paths,
          // deduplicated and sorted. shapeVerdict requires each to be the route itself.
          attributed_files: [
            ...new Set(findings.map((finding) => finding.evidence_refs?.[0]?.file_path ?? null))
          ].sort(),
          ...(shape.class === "refuse"
            ? {
                refusal_names_decoy: blockedReasons.some(
                  (reason) => typeof reason === "string" && reason.includes(routePath)
                ),
                blocked_reasons: blockedReasons
              }
            : {})
        };
      } catch (error) {
        resetTree(root);
        record = {
          id: shape.id,
          class: shape.class,
          route: routePath,
          caught: false,
          findings_count: 0,
          exit: -1,
          check_status: null,
          enforcement: null,
          attributed_files: [],
          error: String(error).slice(0, 200)
        };
      }
      const knownEvasion = baselineShapes.get(shape.id)?.known_evasion === true;
      const verdict = shapeVerdict(record, {
        shapeClass: shape.class,
        enforcementMode: result.enforcement_mode,
        isBlockingScenario: shape.isBlockingScenario === true,
        knownEvasion: UPDATE ? true : knownEvasion
      });
      record.outcome = classifyOutcome(record, shape.class);
      record.verdict = verdict.status;
      if (verdict.failures.length) record.failed_assertions = verdict.failures;
      if (record.verdict === "KNOWN_EVASION" || (UPDATE && record.outcome === "evaded")) {
        // Honest truth, pinned: an evasion that still exists is recorded, never hidden.
        record.known_evasion = true;
        record.verdict = "KNOWN_EVASION";
      }
      result.shapes.push(record);
    }
    return result;
  } finally {
    resetTree(root);
    rmSync(home, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------

function freeSpaceGb() {
  try {
    const out = execFileSync("df", ["-k", REPOS_DIR], { encoding: "utf8" }).trim().split("\n").pop();
    const available = Number(out.split(/\s+/)[3]);
    return Number.isFinite(available) ? available / 1024 / 1024 : Infinity;
  } catch {
    return Infinity;
  }
}

if (freeSpaceGb() < 5) {
  console.error(`Refusing to run: ${freeSpaceGb().toFixed(1)} GB free, need 5 GB.`);
  process.exit(3);
}
if (!existsSync(CLI)) {
  console.error(`Missing CLI build at ${CLI}. Run: pnpm build`);
  process.exit(1);
}
if (!existsSync(ENGINE)) {
  console.error(`Missing engine at ${ENGINE}. Run: cargo build --release -p drift-engine`);
  process.exit(1);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const baselineByRepo = new Map(baseline.map((row) => [row.repo, row]));

const results = [];
for (const cfg of EVAL_REPOS.filter((entry) => !only || only.includes(entry.name))) {
  const row = evaluateRepo(cfg, baselineByRepo.get(cfg.name));
  results.push(row);
  console.log(`\n=== ${row.repo} (mode=${row.enforcement_mode ?? "?"}) ===`);
  for (const shape of row.shapes ?? []) {
    console.log(
      `  ${shape.id.padEnd(24)} ${String(shape.outcome ?? shape.note ?? "").padEnd(16)}` +
        ` exit=${shape.exit ?? "-"} ${shape.verdict}` +
        (shape.failed_assertions ? `  failed: ${shape.failed_assertions.join(", ")}` : "")
    );
  }
  if (row.error) console.log(`  ERROR: ${row.error}`);
}

const failing = results.flatMap((row) =>
  (row.shapes ?? [])
    .filter((shape) => shape.verdict === "FAIL")
    .map((shape) => `${row.repo}/${shape.id}`)
    .concat(row.onboarded === false ? [`${row.repo}/onboard`] : [])
);

if (UPDATE) {
  // O-4, same gating as external-eval: a FAILING verdict or an unaccepted unsafe move
  // (a shape whose catch regressed to an evasion, a block that became a pass, a new
  // known_evasion) refuses with no write unless each move is named via
  // --accept-regression <repo>:<shapeId>.<field>.
  const gate = updateGate({
    results: results.map((row) => ({
      ...row,
      status:
        row.onboarded === false || (row.shapes ?? []).some((shape) => shape.verdict === "FAIL")
          ? "FAIL"
          : "PASS",
      failed_assertions: (row.shapes ?? [])
        .filter((shape) => shape.verdict === "FAIL")
        .map((shape) => shape.id)
    })),
    baselineByRepo,
    acceptedRegressions: ACCEPTED_REGRESSIONS,
    unsafeMovesFor: (before, after) => {
      const beforeShapes = new Map((before?.shapes ?? []).map((shape) => [shape.id, shape]));
      return (after.shapes ?? []).flatMap((shape) =>
        unsafeShapeMoves(beforeShapes.get(shape.id), shape)
      );
    }
  });
  if (!gate.ok) {
    console.error("\nrefusing to update evasion baseline:");
    for (const refusal of gate.refusals) console.error(`  ${refusal}`);
    process.exit(1);
  }
  // Merge, never truncate: --only re-measures a subset without destroying other rows.
  const merged = EVAL_REPOS.map(
    (cfg) => results.find((row) => row.repo === cfg.name) ?? baselineByRepo.get(cfg.name)
  ).filter(Boolean);
  writeFileSync(BASELINE, `${JSON.stringify(merged, null, 2)}\n`);
  const evasions = results.flatMap((row) =>
    (row.shapes ?? []).filter((shape) => shape.known_evasion).map((s) => `${row.repo}/${s.id}`)
  );
  console.log(
    `\nbaseline updated - ${results.length} repo(s) written` +
      (evasions.length ? `; known evasions recorded: ${evasions.join(", ")}` : "; no known evasions")
  );
  process.exit(0);
}

const changed = [];
for (const row of results) {
  const before = baselineByRepo.get(row.repo);
  if (!before) {
    changed.push(`  ${row.repo}: (no baseline row)`);
    continue;
  }
  const beforeShapes = new Map((before.shapes ?? []).map((shape) => [shape.id, shape]));
  for (const shape of row.shapes ?? []) {
    const beforeShape = beforeShapes.get(shape.id);
    const a = JSON.stringify(beforeShape);
    const b = JSON.stringify(shape);
    if (a !== b) {
      changed.push(`  ${row.repo}/${shape.id}:`);
      const keys = new Set([...Object.keys(beforeShape ?? {}), ...Object.keys(shape)]);
      for (const key of keys) {
        const beforeValue = JSON.stringify(beforeShape?.[key]);
        const afterValue = JSON.stringify(shape[key]);
        if (beforeValue !== afterValue) {
          changed.push(`    ${key}: ${beforeValue ?? "(absent)"} -> ${afterValue}`);
        }
      }
    }
  }
  if (before.enforcement_mode !== row.enforcement_mode) {
    changed.push(
      `  ${row.repo}: enforcement_mode ${JSON.stringify(before.enforcement_mode)} -> ${JSON.stringify(row.enforcement_mode)}`
    );
  }
}

if (!changed.length && !failing.length) {
  const cells = results.reduce((n, row) => n + (row.shapes?.length ?? 0), 0);
  const known = results.reduce(
    (n, row) => n + (row.shapes ?? []).filter((shape) => shape.verdict === "KNOWN_EVASION").length,
    0
  );
  console.log(
    `\nno change vs baseline - ${cells} shape cells across ${results.length} repos` +
      (known ? ` (${known} known evasions still open)` : "")
  );
  process.exit(0);
}
if (changed.length) {
  console.log("\nchanged vs baseline:");
  console.log(changed.join("\n"));
}
if (failing.length) {
  console.log(`\nFAILING shapes: ${failing.join(", ")}`);
}
process.exit(1);
