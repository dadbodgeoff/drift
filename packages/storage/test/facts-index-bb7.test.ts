import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";

/**
 * BB-7: **premise false, recorded rather than deleted.**
 *
 * The item asked for an index on `facts.file_path`, on the strength of "single-file fact query 448 ms
 * cold (full table scan), all-facts 55 ms — the index is missing". Verified against a real 106,626-row
 * dub database (2026-08-03):
 *
 * - `idx_facts_scan_file ON facts(scan_id, file_path)` has existed since migration `002`, and the
 *   planner uses it: a per-file lookup reports
 *   `SEARCH facts USING INDEX idx_facts_scan_file (scan_id=? AND file_path=?)` and returns in ~15 ms.
 * - The reported numbers are inverted, not just off: the per-file lookup is the *fast* query and the
 *   all-facts load is the slow one (~267 ms best of 3), so the measurement cannot have been of these
 *   two queries as the product issues them. The most likely explanation is the BB-2 debug-engine
 *   session that also produced the retracted latency numbers.
 * - No query in the product filters `facts` by `file_path` without `scan_id`. That shape does scan the
 *   table, and it measured 9.6 ms — the only shape a bare `file_path` index would help is one nobody
 *   issues.
 *
 * So the index was **not** added: a fourth index on the largest table costs write throughput on every
 * scan and disk in a database already flagged for GB-scale growth (B-11/P-4 scan GC), and the planner
 * never chose the redundant index while it briefly existed.
 *
 * This test is the guard, so the premise cannot quietly come back as a "missing index" again. The real
 * finding it leaves behind is logged separately: every caller loads *all* facts for a scan and filters
 * in memory, which is what the 267 ms actually buys, and which is a P-1-sprint change rather than an
 * index.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function openStorage() {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb7-index-"));
  tempDirs.push(dir);
  const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
  storage.migrate();
  return storage;
}

describe("BB-7 facts indexing (premise false)", () => {
  it("already indexes (scan_id, file_path) - the index BB-7 asked for is not missing", async () => {
    const storage = await openStorage();
    const db = (storage as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } }).db;
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'facts'")
      .all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toContain("idx_facts_scan_file");
    storage.close();
  });

  it("uses that index for a per-file fact lookup instead of scanning", async () => {
    const storage = await openStorage();
    const db = (storage as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } }).db;
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM facts WHERE scan_id = ? AND file_path = ?")
      .all("scan_abc", "app/api/users/route.ts") as Array<{ detail: string }>;

    const detail = plan.map((row) => row.detail).join("; ");
    expect(detail).toContain("USING INDEX");
    expect(detail).not.toContain("SCAN facts");
    storage.close();
  });

  it("keeps exactly the three fact indexes the schema declares - no redundant fourth", async () => {
    // A redundant index is not free on this table: it is written on every scan of every repo, and
    // measured DB size for dub is already 535 MB.
    const storage = await openStorage();
    const db = (storage as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } }).db;
    const named = (db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'facts' AND sql IS NOT NULL")
      .all() as Array<{ name: string }>)
      .map((row) => row.name)
      .sort();

    expect(named).toEqual(["idx_facts_scan_file", "idx_facts_scan_id", "idx_facts_scan_kind"]);
    storage.close();
  });
});
