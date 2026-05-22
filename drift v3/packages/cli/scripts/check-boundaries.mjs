#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const srcRoot = join(repoRoot, "packages/cli/src");
const packageSrcRoots = {
  cli: srcRoot,
  core: join(repoRoot, "packages/core/src"),
  storage: join(repoRoot, "packages/storage/src"),
  mcp: join(repoRoot, "packages/mcp/src"),
  engineContract: join(repoRoot, "packages/engine-contract/src")
};

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

for (const { pkg, root, file } of packageFiles) {
  const fileRel = relative(root, file).replaceAll("\\", "/");
  const repoRel = relative(repoRoot, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");

  if (pkg !== "storage" && (source.includes("better-sqlite3") || source.includes("new Database("))) {
    failures.push(`${repoRel} uses raw SQLite; database access belongs in packages/storage`);
  }

  if (pkg === "core" && /@drift\/(cli|storage|mcp|engine-contract)/.test(source)) {
    failures.push(`${repoRel} imports another Drift package; core must stay dependency-light`);
  }

  if (pkg === "engineContract" && /@drift\/(cli|storage|mcp|core)/.test(source)) {
    failures.push(`${repoRel} imports another Drift package; engine-contract must stay standalone`);
  }

  if (pkg === "storage" && /@drift\/(cli|mcp)/.test(source)) {
    failures.push(`${repoRel} imports product surfaces; storage must stay below CLI/MCP`);
  }

  if (pkg === "mcp" && /@drift\/cli/.test(source)) {
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
