#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const srcRoot = join(repoRoot, "packages/cli/src");
const packageSrcRoots = {
  cli: srcRoot,
  adapters: join(repoRoot, "packages/adapters/src"),
  core: join(repoRoot, "packages/core/src"),
  query: join(repoRoot, "packages/query/src"),
  factgraph: join(repoRoot, "packages/factgraph/src"),
  storage: join(repoRoot, "packages/storage/src"),
  mcp: join(repoRoot, "packages/mcp/src"),
  engineContract: join(repoRoot, "packages/engine-contract/src"),
  vocabulary: join(repoRoot, "packages/vocabulary/src")
};

/**
 * Does this file IMPORT one of the named Drift packages?
 *
 * Deliberately not `source.includes("@drift/x")`. The same shortcut on `better-sqlite3` had this
 * gate red from commit 201f462 onward because a package NAME appeared in a detection list, and the
 * comment below records that lesson - it just was not applied to these rules, which still matched
 * any mention. W5 tripped all three of them from prose: a comment in core/src/security.ts naming
 * `@drift/engine-contract` was read as core importing it. A boundary check that fires on prose is
 * one people learn to argue with.
 */
function importsDriftPackage(source, packages) {
  return new RegExp(`(?:from|require\\(|import\\()\\s*["'\`]@drift/(?:${packages})(?:["'\`/])`).test(source);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }
    return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

function moduleForImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = normalize(resolve(dirname(fromFile), specifier.replace(/\.js$/, ".ts")));
  return existsSync(resolved) ? resolved : null;
}

function importsFor(file) {
  const source = readFileSync(file, "utf8");
  const imports = [];
  const importPattern = /import\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["'];/g;
  for (const match of source.matchAll(importPattern)) {
    const imported = moduleForImport(file, match[1]);
    if (imported) {
      imports.push(imported);
    }
  }
  const exportPattern = /export\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["'];/g;
  for (const match of source.matchAll(exportPattern)) {
    const imported = moduleForImport(file, match[1]);
    if (imported) {
      imports.push(imported);
    }
  }
  return imports;
}

function rel(file) {
  return relative(srcRoot, file).replaceAll("\\", "/");
}

const files = listFiles(srcRoot);
const packageFiles = Object.entries(packageSrcRoots).flatMap(([pkg, root]) =>
  existsSync(root) ? listFiles(root).map((file) => ({ pkg, root, file })) : []
);
const failures = [];

for (const file of files) {
  const fileRel = rel(file);
  const imported = importsFor(file).map(rel);
  if (fileRel.startsWith("commands/")) {
    for (const target of imported.filter((item) => item.startsWith("commands/"))) {
      failures.push(`${fileRel} imports command module ${target}`);
    }
  }
  if (fileRel.startsWith("formatters/")) {
    const source = readFileSync(file, "utf8");
    if (
      source.includes("@drift/storage") ||
      source.includes("node:fs") ||
      source.includes("node:child_process") ||
      source.includes("node:os") ||
      source.includes("../io/")
    ) {
      failures.push(`${fileRel} imports storage, filesystem, process, or io helpers`);
    }
  }
  if (fileRel.startsWith("domain/")) {
    for (const target of imported.filter((item) => item.startsWith("args/"))) {
      failures.push(`${fileRel} imports CLI args module ${target}`);
    }
  }
  if (fileRel.startsWith("engine/") || fileRel.startsWith("check/")) {
    for (const target of imported.filter((item) => item.startsWith("commands/"))) {
      failures.push(`${fileRel} imports command module ${target}`);
    }
  }
  if (fileRel.startsWith("engine/")) {
    const source = readFileSync(file, "utf8");
    if (source.includes("execFileSync")) {
      failures.push(`${fileRel} uses execFileSync; engine bridge must stream child-process output`);
    }
  }
}

/**
 * The MCP server must not depend on the CLI.
 *
 * They are separate surfaces over the same data, and the CLI owns argument parsing, process exit
 * codes and terminal formatting - none of which mean anything to an agent over stdio. Shared
 * logic belongs in @drift/query, which is where T51 moved preflight ranking after the two copies
 * silently diverged.
 *
 * Asserted rather than assumed: the boundary holds today, and this keeps a convenient import from
 * quietly establishing the dependency.
 */
for (const { pkg, root, file } of packageFiles) {
  if (pkg !== "mcp") {
    continue;
  }
  const fileRel = relative(root, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  if (/(?:from|require\()\s*["'`](?:@drift\/cli|(?:\.\.\/)+cli\/)/.test(source)) {
    failures.push(
      `packages/mcp/${fileRel} imports from the CLI; shared logic belongs in @drift/query`
    );
  }
}

for (const { pkg, root, file } of packageFiles) {
  const fileRel = relative(root, file).replaceAll("\\", "/");
  const repoRel = relative(repoRoot, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");

  // Match an actual import of the driver, not any mention of its name.
  //
  // This previously tested `source.includes("better-sqlite3")`, which fired on
  // data-layer-discovery.ts - where "better-sqlite3" is one entry in a list of known data-layer
  // package names used for *detection*, not a database call. The gate had therefore been red
  // since commit 201f462, well before this run, and a boundary check that has been failing that
  // long is one nobody reads. Same shape as the problem this product exists to catch: a rule
  // declared, checked, and ignored.
  const importsSqliteDriver =
    /(?:from|require\()\s*["'`]better-sqlite3["'`]/.test(source) || source.includes("new Database(");
  if (pkg !== "storage" && importsSqliteDriver) {
    failures.push(`${repoRel} uses raw SQLite; database access belongs in packages/storage`);
  }

  /**
   * @drift/vocabulary is the one package every other package may import.
   *
   * It is the generated cross-boundary vocabulary and nothing else - zod and no Drift dependency -
   * so it sits below core, factgraph, engine-contract and adapters rather than beside them. The
   * whole point of W5 is that these packages share one list; forcing each to keep its own copy to
   * satisfy a layering rule is how they came to have six.
   */
  if (pkg === "vocabulary" && /(?:from|require\(|import\()\s*["'`]@drift\//.test(source)) {
    failures.push(`${repoRel} imports another Drift package; vocabulary must depend on nothing`);
  }

  if (source.includes("packages/adapters/src") || /@drift\/adapters\//.test(source)) {
    failures.push(`${repoRel} imports adapter internals directly; use the @drift/adapters public registry`);
  }

  if (pkg === "adapters" && importsDriftPackage(source, "cli|storage|mcp|core|engine-contract")) {
    failures.push(`${repoRel} imports another Drift package; adapters must stay manifest-only`);
  }

  if (pkg === "core" && importsDriftPackage(source, "cli|storage|mcp|query|factgraph|engine-contract")) {
    failures.push(`${repoRel} imports another Drift package; core must stay dependency-light`);
  }

  if (pkg === "engineContract" && importsDriftPackage(source, "cli|storage|mcp|core")) {
    failures.push(`${repoRel} imports another Drift package; engine-contract must stay standalone`);
  }

  if (pkg === "factgraph" && importsDriftPackage(source, "cli|storage|mcp|query|engine-contract")) {
    failures.push(`${repoRel} imports a product package; factgraph must stay schema-only`);
  }

  if (pkg === "storage" && importsDriftPackage(source, "cli|mcp|query")) {
    failures.push(`${repoRel} imports product surfaces; storage must stay below CLI/MCP`);
  }

  if (
    pkg === "query" &&
    (
      importsDriftPackage(source, "cli|mcp|engine-contract") ||
      source.includes("better-sqlite3") ||
      source.includes("new Database(") ||
      source.includes("node:child_process") ||
      source.includes("../engine/") ||
      source.includes("writeFile") ||
      source.includes("mkdir(") ||
      source.includes("rm(")
    )
  ) {
    failures.push(`${repoRel} imports mutation or execution behavior; query must stay read-model only`);
  }

  if (pkg === "mcp" && importsDriftPackage(source, "cli")) {
    failures.push(`${repoRel} imports CLI; MCP must use shared core/storage services only`);
  }

  if (pkg === "mcp" && fileRel === "tools.ts") {
    const forbiddenMutationNames = [
      "accept",
      "reject",
      "edit",
      "suppress",
      "mark_fixed",
      "mark_false_positive",
      "grant",
      "revoke",
      "restore",
      "backup_create",
      "import"
    ];
    for (const name of forbiddenMutationNames) {
      if (source.includes(`name: "${name}`)) {
        failures.push(`${repoRel} exposes mutation-like MCP tool ${name}`);
      }
    }
  }
}

const graph = new Map(files.map((file) => [file, importsFor(file).filter((target) => files.includes(target))]));
const visiting = new Set();
const visited = new Set();
const stack = [];

function visit(file) {
  if (visiting.has(file)) {
    const cycle = stack.slice(stack.indexOf(file)).concat(file).map(rel).join(" -> ");
    failures.push(`import cycle: ${cycle}`);
    return;
  }
  if (visited.has(file)) {
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const target of graph.get(file) ?? []) {
    visit(target);
  }
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) {
  visit(file);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Architecture boundaries OK");
