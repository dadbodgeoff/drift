#!/usr/bin/env node
/**
 * Every migration-backed table must be written and read by production code.
 *
 * The failure this exists to stop is not hypothetical and not rare. A table gets a migration, a
 * storage method, a schema and a test - and no production caller. Nothing fails: the table simply
 * stays empty forever while readers merge an always-empty array into their output. `ParserGapV2` is
 * the worked example: `upsertParserGapV2` has only test callers, and four agent surfaces
 * (`prepare`, `repo map`, and two MCP tools) do `[...parserGaps, ...parserGapV2]` against nothing.
 *
 * Two independent audits of this repo each found a DIFFERENT subset of this class, which is the
 * argument for a rule rather than a third audit. This check found a third instance neither had
 * (`upsertSymbolIdentities`), and confirmed the shape against the database: both tables whose
 * writers have no production caller measure 0 rows on a real dub scan.
 *
 * SEVERITY. A missing writer and a missing reader are not the same defect:
 *   - `writer_orphan`  the table is never populated. Every read is empty, and any surface that
 *                      reports on it is reporting on nothing. This is the ParserGapV2 disease.
 *   - `reader_orphan`  the table IS populated and nothing in production reads it. Cheaper - dead
 *                      read API rather than a false signal - but it is still storage cost with no
 *                      consumer: `symbol_occurrences` and `module_dependents` alone are ~57,000
 *                      rows per dub scan that nothing queries.
 *
 * RATCHET, both directions - the shape `scripts/evasion-baseline.json` uses. The baseline records
 * honest current truth, never hides a known gap, and fails on:
 *   - a NEW orphan, so the class cannot grow silently;
 *   - a baselined orphan that now HAS a production caller, so fixing one forces removing its entry
 *     rather than leaving a stale claim behind.
 *
 * Deliberately static. Running the product and counting rows would be a stronger signal but a much
 * slower and flakier gate; "no production caller" is decidable from the source and was cross-checked
 * against real row counts when the baseline was written.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = join(repoRoot, "scripts/storage-lifecycle-baseline.json");
const STORAGE_PATH = join(repoRoot, "packages/storage/src/sqlite-storage.ts");
const MIGRATIONS_PATH = join(repoRoot, "packages/storage/src/migrations.ts");

/** Tables the migrations create. The universe this check is about. */
function migrationTables() {
  const source = readFileSync(MIGRATIONS_PATH, "utf8");
  return [...source.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)]
    .map((match) => match[1])
    .filter((table) => table !== "schema_migrations")
    .sort()
    .filter((table, index, all) => all.indexOf(table) === index);
}

/**
 * Attribute each SQL statement to the storage method containing it.
 *
 * Method-level rather than statement-level because the question is "can production reach this
 * table", and a caller reaches a method, not a statement.
 */
function tableMethods(tables) {
  const source = readFileSync(STORAGE_PATH, "utf8");
  const starts = [...source.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)]
    .map((match) => ({ index: match.index, name: match[1] }));
  const methodAt = (position) => {
    let name;
    for (const entry of starts) {
      if (entry.index <= position) {
        name = entry.name;
      } else {
        break;
      }
    }
    return name;
  };

  const result = {};
  for (const table of tables) {
    const writers = new Set();
    const readers = new Set();
    const write = new RegExp(`INSERT (?:OR REPLACE )?INTO ${table}\\b|UPDATE ${table}\\b|DELETE FROM ${table}\\b`, "g");
    const read = new RegExp(`FROM ${table}\\b`, "g");
    for (const match of source.matchAll(write)) {
      const name = methodAt(match.index);
      if (name) writers.add(name);
    }
    for (const match of source.matchAll(read)) {
      const name = methodAt(match.index);
      if (name) readers.add(name);
    }
    result[table] = { writers: [...writers].sort(), readers: [...readers].sort() };
  }
  return result;
}

/**
 * Every line of production source, read once.
 *
 * Built as a single corpus rather than grepping per method: there are ~64 storage methods reachable
 * from a table, and a repo-wide grep each took this gate to ~105 seconds - slow enough that it
 * would be the longest step in `verify:ci` and get skipped locally. One filesystem walk makes it
 * sub-second.
 *
 * "Production" excludes tests, build output and dependencies. A test calling a method is exactly
 * the situation this gate exists to catch, so tests cannot count as callers.
 */
function productionSource() {
  const SKIP = new Set(["node_modules", "dist", "target", ".git", "coverage", ".next", "test", "tests"]);
  const chunks = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) visit(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|rs)$/.test(entry.name)) continue;
      if (/\.test\.|\.spec\./.test(entry.name)) continue;
      // A method cannot be its own caller.
      if (full.endsWith("packages/storage/src/sqlite-storage.ts")) continue;
      chunks.push(readFileSync(full, "utf8"));
    }
  };
  for (const top of ["packages", "crates", "scripts"]) {
    const path = join(repoRoot, top);
    try {
      if (statSync(path).isDirectory()) visit(path);
    } catch {
      // A missing top-level directory is not this gate's concern.
    }
  }
  return chunks.join("\n");
}

const PRODUCTION_SOURCE = productionSource();

/** Does anything outside tests and build output call this storage method? */
function hasProductionCaller(method) {
  return PRODUCTION_SOURCE.includes(`.${method}(`);
}

function main() {
  const tables = migrationTables();
  const methods = tableMethods(tables);
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const known = new Map(baseline.known_orphans.map((entry) => [entry.method, entry]));

  const orphans = [];
  for (const table of tables) {
    for (const [role, list] of [["writer", methods[table].writers], ["reader", methods[table].readers]]) {
      for (const method of list) {
        if (!hasProductionCaller(method)) {
          orphans.push({ method, table, kind: `${role}_orphan` });
        }
      }
    }
  }
  // A method can serve several tables; report it once, by its most severe role.
  const byMethod = new Map();
  for (const orphan of orphans) {
    const existing = byMethod.get(orphan.method);
    if (!existing || (existing.kind === "reader_orphan" && orphan.kind === "writer_orphan")) {
      byMethod.set(orphan.method, orphan);
    }
  }

  const found = [...byMethod.values()].sort((left, right) => left.method.localeCompare(right.method));
  const failures = [];

  for (const orphan of found) {
    if (!known.has(orphan.method)) {
      failures.push(
        `NEW ${orphan.kind}: ${orphan.method} (${orphan.table}) has no production caller. ` +
          (orphan.kind === "writer_orphan"
            ? "The table will never be populated, so every reader of it returns empty."
            : "The table is populated and nothing in production reads it.") +
          " Wire it up, or add it to scripts/storage-lifecycle-baseline.json with a reason."
      );
    }
  }
  for (const [method, entry] of known) {
    if (!byMethod.has(method)) {
      failures.push(
        `STALE baseline entry: ${method} now HAS a production caller. Remove it from ` +
          "scripts/storage-lifecycle-baseline.json - a baseline that still claims a fixed gap is a false record."
      );
    }
  }

  const writerOrphans = found.filter((orphan) => orphan.kind === "writer_orphan");
  console.log(
    `storage lifecycle: ${tables.length} tables, ${found.length} orphaned method(s) ` +
      `(${writerOrphans.length} writer, ${found.length - writerOrphans.length} reader), ` +
      `${known.size} baselined.`
  );
  for (const orphan of found) {
    const entry = known.get(orphan.method);
    console.log(`  ${orphan.kind === "writer_orphan" ? "W" : "r"} ${orphan.method} (${orphan.table})${entry ? "" : "  <-- NEW"}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

main();
