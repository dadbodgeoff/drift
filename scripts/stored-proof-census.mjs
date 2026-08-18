#!/usr/bin/env node
/**
 * What is actually stored in the security proof reason/code fields, across every database this
 * machine can reach.
 *
 * WHY THIS EXISTS, AND WHY IT RUNS BEFORE ANYTHING IS DELETED
 *
 * `packages/storage` parses `security_boundary_proofs.proof_json` and
 * `security_boundary_proof_runs.proof_json` with `SecurityBoundaryProofSchema` ON READ. Those
 * reason and code fields are closed `z.enum`s. Shrinking one of them does not fail at the next
 * write - it fails at the next READ of a row that was written before the shrink, and it fails as a
 * ZodError from `listSecurityBoundaryProofs`, which is to say the row becomes unreadable and the
 * repo's stored history becomes unloadable. There is no migration path back once the enum has
 * shipped narrower than the data.
 *
 * Several of these vocabularies were WIDENED at some point - `authorization.missing[].reason` and
 * `tenant.missing[].reason` each carry two spellings of the same three concepts, an older set and a
 * newer one. A producer audit run against today's engine will report the older spelling as dead,
 * because today's engine does not emit it. That audit is correct about the producer and wrong about
 * the consequence: rows written by the older engine are still on disk and are still parsed with
 * today's schema.
 *
 * So: a member this census finds in a stored row is RESERVED, never deleted, whatever the producer
 * audit says about it.
 *
 * WHAT IT DOES
 *
 * Walks every proof JSON blob and records the distinct string value at every path whose leaf key is
 * `reason` or `code`, keyed by the path with array indices collapsed to `[]`. The walk is structural
 * rather than a list of known field paths on purpose: the schema is what is under audit here, so
 * enumerating it from the schema would inherit whatever the schema already gets wrong, and a field
 * added later would silently escape the census.
 *
 * Free-text `reason` fields are in the output too - `parser_gaps[].reason` and the control-flow
 * reasons are prose, not vocabulary. They are reported rather than filtered because deciding which
 * paths are closed vocabularies is the judgement this census exists to inform, not a premise it
 * gets to assume. Paths with many distinct long values read as prose at a glance.
 *
 * NO DATABASES IS NOT NO DATA. If nothing is reachable, this exits 1 and says so. An empty report
 * that exits 0 would read as "nothing is stored, delete freely", which is the exact wrong answer
 * and the reason this script is separate from the gates.
 *
 *   node scripts/stored-proof-census.mjs                  every ~/.drift/repos/<id>/drift.sqlite
 *   node scripts/stored-proof-census.mjs --db PATH ...    those databases as well
 *   node scripts/stored-proof-census.mjs --json           machine-readable, for diffing over time
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * better-sqlite3 is a dependency of packages/storage, not of the repo root.
 *
 * Resolving it from there rather than adding a root dependency keeps the native module in exactly
 * one place. A second copy would be a second version, and a second version of a native sqlite
 * binding reading the same file is its own failure mode.
 */
function loadDatabase() {
  const require = createRequire(join(repoRoot, "packages/storage/package.json"));
  try {
    return require("better-sqlite3");
  } catch (error) {
    console.error(
      "stored-proof census: cannot load better-sqlite3 from packages/storage " +
        `(${error instanceof Error ? error.message : String(error)}).\n` +
        "Run `pnpm install` first. Without it this script cannot open a database, which is not the " +
        "same as finding no rows - see the header."
    );
    process.exit(1);
  }
}

/** The default state root the CLI uses when `--db` is not given: ~/.drift/repos/<id>/drift.sqlite. */
function defaultDatabases() {
  const root = join(homedir(), ".drift", "repos");
  if (!existsSync(root)) {
    return [];
  }
  const found = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry, "drift.sqlite");
    if (existsSync(path) && statSync(path).isFile()) {
      found.push(path);
    }
  }
  return found.sort();
}

function parseArgs(argv) {
  const extra = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") {
      json = true;
    } else if (argv[index] === "--db") {
      const path = argv[index + 1];
      if (!path) {
        console.error("stored-proof census: --db needs a path.");
        process.exit(1);
      }
      extra.push(path);
      index += 1;
    }
  }
  return { extra, json };
}

/**
 * Every string at a path whose leaf key is `reason` or `code`, with array indices collapsed.
 *
 * `session_trust.missing_trust[3].reason` and `session_trust.missing_trust[7].reason` are the same
 * field with two rows in it; keeping the index would produce one census entry per array element and
 * bury the answer.
 */
function collectFields(value, path, into) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFields(entry, `${path}[]`, into);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if ((key === "reason" || key === "code") && typeof child === "string") {
      const bucket = into.get(childPath) ?? new Map();
      bucket.set(child, (bucket.get(child) ?? 0) + 1);
      into.set(childPath, bucket);
      continue;
    }
    collectFields(child, childPath, into);
  }
}

const PROOF_TABLES = ["security_boundary_proofs", "security_boundary_proof_runs"];

function tableExists(db, table) {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

function censusOfDatabase(Database, path) {
  const result = { path, rows: 0, tables: [], unreadable: [], fields: new Map() };
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
  try {
    for (const table of PROOF_TABLES) {
      if (!tableExists(db, table)) {
        continue;
      }
      result.tables.push(table);
      for (const row of db.prepare(`SELECT proof_json FROM ${table}`).all()) {
        result.rows += 1;
        let parsed;
        try {
          parsed = JSON.parse(row.proof_json);
        } catch {
          // A blob that is not JSON is a corruption finding, not a census finding, but it must not
          // be silently skipped: a row that cannot be read is a row whose members are unknown.
          result.unreadable.push(table);
          continue;
        }
        collectFields(parsed, "", result.fields);
      }
    }
  } finally {
    db.close();
  }
  return result;
}

function merge(into, from) {
  for (const [path, values] of from) {
    const bucket = into.get(path) ?? new Map();
    for (const [value, count] of values) {
      bucket.set(value, (bucket.get(value) ?? 0) + count);
    }
    into.set(path, bucket);
  }
}

function main() {
  const { extra, json } = parseArgs(process.argv.slice(2));
  const databases = [...new Set([...defaultDatabases(), ...extra])];

  if (databases.length === 0) {
    console.error(
      "stored-proof census: NO DATABASES REACHABLE.\n" +
        "\n" +
        "  Looked under ~/.drift/repos/<repo_id>/drift.sqlite and found none, and no --db was given.\n" +
        "\n" +
        "  This is NOT the same result as 'no proof rows store these members'. It is the absence of\n" +
        "  evidence, and it must not be read as evidence of absence: a vocabulary member shrunk out\n" +
        "  of the schema on the strength of an empty census bricks the read path for every row that\n" +
        "  still holds it, on a machine this census never saw.\n" +
        "\n" +
        "  Run `drift scan` against any repo first, or pass --db PATH."
    );
    process.exit(1);
  }

  const Database = loadDatabase();
  const perDatabase = databases.map((path) => censusOfDatabase(Database, path));
  const combined = new Map();
  let rows = 0;
  let opened = 0;
  const failures = [];
  for (const entry of perDatabase) {
    if (entry.error) {
      failures.push(entry);
      continue;
    }
    opened += 1;
    rows += entry.rows;
    merge(combined, entry.fields);
  }

  const paths = [...combined.keys()].sort();

  if (json) {
    console.log(
      JSON.stringify(
        {
          databases_found: databases.length,
          databases_opened: opened,
          proof_rows: rows,
          unopenable: failures.map((entry) => ({ path: entry.path, error: entry.error })),
          fields: Object.fromEntries(
            paths.map((path) => [
              path,
              Object.fromEntries([...combined.get(path)].sort(([left], [right]) => left.localeCompare(right)))
            ])
          )
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    `stored-proof census: ${opened} of ${databases.length} database(s) opened, ${rows} proof row(s), ` +
      `${paths.length} reason/code field path(s).`
  );
  for (const entry of failures) {
    console.log(`  ! could not open ${entry.path}: ${entry.error}`);
  }
  if (rows === 0) {
    console.log(
      "\n  Databases opened, but they hold NO proof rows. Nothing here licenses shrinking an enum:\n" +
        "  this machine has simply never run a security check that produced a proof."
    );
    return;
  }
  console.log("");
  for (const path of paths) {
    const values = [...combined.get(path)].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    console.log(`  ${path}  (${values.length} distinct)`);
    for (const [value, count] of values) {
      const shown = value.length > 100 ? `${value.slice(0, 97)}...` : value;
      console.log(`      ${String(count).padStart(6)}  ${JSON.stringify(shown)}`);
    }
  }
}

main();
