#!/usr/bin/env node
/**
 * A scan-scoped row must not keep a stale scan_id when a later scan rewrites it.
 *
 * D-ST2 is the worked example, and it is worth stating precisely because the shape is so easy to
 * reproduce. `upsertConventionCandidate` listed twenty columns in its `ON CONFLICT DO UPDATE SET`
 * and omitted exactly one: `scan_id`. Candidate ids are content-derived, so re-running inference
 * produces the same id and the row keeps the scan id of whichever scan inserted it first.
 * `pruneSupersededScans` then deletes by scan id and takes the row with it - while the contract
 * built on that candidate is still live.
 *
 * The user-visible result was that every third `drift start --accept-defaults` against the same
 * state root exited 1 with "Convention candidate not found". Periodic, not constant, so it read as
 * flakiness rather than a bug. Three sibling tables - `parser_gaps`, `check_runs`,
 * `security_boundary_proofs` - got this right, which is what makes it a rule worth enforcing rather
 * than a one-off: the codebase already agrees, and one statement disagreed silently.
 *
 * RATCHET, both directions, matching scripts/storage-lifecycle-baseline.json:
 *   - a NEW omission fails, so the class cannot grow;
 *   - a baselined omission that now sets scan_id fails too, so fixing one forces removing its entry
 *     rather than leaving a stale claim in the baseline.
 *
 * Deliberately static. The runtime half of this class - a retention rule naming a column that does
 * not exist - is enforced where it happens, in `pruneSupersededScans`, which now throws instead of
 * swallowing the error in a bare catch (D-ST1). That one cannot be decided from the source, because
 * the schema it must agree with is built by migrations at run time.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = join(repoRoot, "scripts/storage-invariants-baseline.json");
const STORAGE_PATH = join(repoRoot, "packages/storage/src/sqlite-storage.ts");
const MIGRATIONS_PATH = join(repoRoot, "packages/storage/src/migrations.ts");

/**
 * Tables that carry a scan_id, read from the migrations rather than hardcoded.
 *
 * Reads both `CREATE TABLE` bodies and later `ADD COLUMN scan_id`, so a table that gained the
 * column in a migration is covered the same as one born with it.
 */
function scanScopedTables(migrationSource) {
  const tables = new Set();

  for (const match of migrationSource.matchAll(
    /CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+) \(([\s\S]*?)\n\s*\);/g
  )) {
    if (/\bscan_id\b/.test(match[2])) {
      tables.add(match[1]);
    }
  }
  for (const match of migrationSource.matchAll(
    /ALTER TABLE ([a-z_]+) ADD COLUMN scan_id\b/g
  )) {
    tables.add(match[1]);
  }

  return tables;
}

/**
 * Every upsert in the storage layer, as { table, setsScanId, line }.
 *
 * Chunking on `INSERT INTO` keeps each statement's `DO UPDATE SET` attributed to its own table:
 * the SET body is bounded by the end of the surrounding template literal, which is the first
 * backtick after it.
 */
function upserts(storageSource) {
  const found = [];
  const chunks = storageSource.split("INSERT INTO ");

  let consumed = chunks[0].length;
  for (const chunk of chunks.slice(1)) {
    const offset = consumed + "INSERT INTO ".length;
    consumed = offset + chunk.length;

    const table = chunk.match(/^([a-z_]+)/)?.[1];
    const updateAt = chunk.indexOf("DO UPDATE SET");
    if (!table || updateAt === -1) {
      continue;
    }

    const end = chunk.indexOf("`", updateAt);
    const body = chunk.slice(updateAt, end === -1 ? undefined : end);

    // A conflict target that already contains scan_id cannot collide across scans - two scans
    // produce two rows, and there is nothing stale to refresh. Only an id that is stable across
    // scans (`ON CONFLICT(id)`) can carry an old scan_id into a new scan.
    const target = chunk.slice(0, updateAt).match(/ON CONFLICT\s*\(([^)]*)\)/)?.[1] ?? "";

    found.push({
      table,
      scanScopedConflictTarget: /\bscan_id\b/.test(target),
      setsScanId: /\bscan_id\s*=\s*excluded\.scan_id\b/.test(body),
      // `facts` carries scan_id (first seen) alongside last_seen_scan_id (most recent) on purpose.
      // Refreshing both would erase the distinction the pair exists to record.
      tracksLastSeen: /\blast_seen_scan_id\s*=\s*excluded\.last_seen_scan_id\b/.test(body),
      line: storageSource.slice(0, offset).split("\n").length
    });
  }

  return found;
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    return new Map((parsed.stale_scan_id_upserts ?? []).map((entry) => [entry.table, entry]));
  } catch {
    return new Map();
  }
}

function main() {
  const migrationSource = readFileSync(MIGRATIONS_PATH, "utf8");
  const storageSource = readFileSync(STORAGE_PATH, "utf8");

  const scanScoped = scanScopedTables(migrationSource);
  const baseline = readBaseline();
  const failures = [];

  const relevant = upserts(storageSource).filter(
    (upsert) =>
      scanScoped.has(upsert.table) &&
      // Cannot collide across scans, so there is no stale value to carry forward.
      !upsert.scanScopedConflictTarget &&
      // Deliberately keeps first-seen and last-seen apart; refreshing scan_id would collapse them.
      !upsert.tracksLastSeen
  );
  const offenders = relevant.filter((upsert) => !upsert.setsScanId);

  for (const offender of offenders) {
    if (!baseline.has(offender.table)) {
      failures.push(
        `NEW stale scan_id upsert: ${offender.table} (packages/storage/src/sqlite-storage.ts:${offender.line}) ` +
          "has a scan_id column and an ON CONFLICT DO UPDATE that does not refresh it. A re-proposed " +
          "row keeps the old scan id and pruning deletes it while it is still referenced. Add " +
          "`scan_id = excluded.scan_id` to the SET list."
      );
    }
  }

  const offending = new Set(offenders.map((offender) => offender.table));
  for (const table of baseline.keys()) {
    if (!offending.has(table)) {
      failures.push(
        `STALE baseline entry: ${table} now refreshes scan_id. Remove it from ` +
          "scripts/storage-invariants-baseline.json - a baseline that still claims a fixed gap is a false record."
      );
    }
  }

  console.log(
    `storage invariants: ${scanScoped.size} scan-scoped table(s), ${relevant.length} upsert(s) checked, ` +
      `${offenders.length} stale, ${baseline.size} baselined.`
  );
  for (const offender of offenders) {
    console.log(`  ! ${offender.table}:${offender.line}${baseline.has(offender.table) ? "" : "  <-- NEW"}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

main();
