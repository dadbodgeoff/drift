import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "../src/index.js";

/**
 * EW-8. Pruning must return disk to the user.
 *
 * `pruneSupersededScans` works: growth is bounded, and dub plateaus at 1,560 MB instead of climbing
 * without limit. The comment beside it said "deliberately no VACUUM", reasoning that freed pages are
 * reused by later scans. Both statements are true, and they answer different questions. Pages *are*
 * reused, so growth is bounded - the stated goal is met. The file still never shrinks, so the user
 * sees a 1.5 GB directory after Drift has finished with the data. R-1 measured 59% of free pages
 * never going back to the OS.
 *
 * The assertion below is on **on-disk file size**, deliberately. That is the whole reason this was
 * never caught: the old comment is correct under any page-count-based test, because the pages really
 * are free and really are reused. Only the bytes a file listing reports can tell the difference
 * between "reusable" and "returned".
 *
 * And the constraint is real, so the fix respects it: a full VACUUM needs roughly twice the
 * database's size in temp space, which on a 1.5 GB database sitting near the 5 GB halt floor is
 * itself the hazard. Hence `incremental_vacuum` for new databases, and an explicit, space-checked
 * one-time reclaim for existing ones.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-reclaim-"));
  dirs.push(dir);
  return join(dir, "drift.sqlite");
}

/** Bytes a file listing would report: the database plus its sidecars. */
async function onDiskBytes(path: string): Promise<number> {
  let total = 0;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      total += (await stat(candidate)).size;
    } catch {
      /* absent */
    }
  }
  return total;
}

function factQuality(scanId: string) {
  return {
    source_span: { start_line: 1, start_column: 1, end_line: 1, end_column: 1 },
    ast_node_kind: null,
    extraction_method: "test_fixture",
    extractor_version: "0.1.0",
    parser_version: "0.1.0",
    confidence: 1,
    confidence_label: "certain" as const,
    evidence_level: "text" as const,
    resolution_status: "resolved" as const,
    staleness_status: "fresh" as const,
    last_seen_scan_id: scanId
  };
}

const REPO_ID = "repo_reclaim";

/**
 * One scan's worth of state, sized so the difference between "reused" and "returned" is larger
 * than SQLite's page granularity. Each scan writes the same content under a new scan id, which is
 * the real shape being measured: N scans of an *unchanged* repo.
 */
function writeScan(storage: ReturnType<typeof openDriftStorage>, index: number): void {
  const scanId = `scan_${String(index).padStart(4, "0")}`;
  storage.upsertScanManifest({
    id: scanId,
    repo_id: REPO_ID,
    branch: "main",
    commit: `commit${index}`,
    dirty: false,
    status: "completed",
    scanner_version: "0.1.0",
    adapter_versions: { typescript: "0.1.0" },
    rule_engine_version: "0.1.0",
    file_count: 400,
    fact_count: 400,
    finding_count: 0,
    started_at: `2026-08-0${(index % 9) + 1}T00:00:00.000Z`,
    completed_at: `2026-08-0${(index % 9) + 1}T00:00:01.000Z`
  });
  const facts = [];
  const snapshots = [];
  for (let file = 0; file < 400; file += 1) {
    const filePath = `apps/web/app/api/route-${file}/route.ts`;
    snapshots.push({
      repo_id: REPO_ID,
      scan_id: scanId,
      file_path: filePath,
      content_hash: `${file}`.padStart(64, "0"),
      byte_size: 2048,
      indexed: true
    });
    for (let n = 0; n < 6; n += 1) {
      facts.push({
        id: `fact_${scanId}_${file}_${n}`,
        repo_id: REPO_ID,
        scan_id: scanId,
        kind: "import_used" as const,
        file_path: filePath,
        name: `binding${n}`,
        value: `@acme/package-with-a-reasonably-long-specifier/subpath/${n}`,
        start_line: n + 1,
        end_line: n + 1,
        ...factQuality(scanId)
      });
    }
  }
  storage.transaction(() => {
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFacts(facts);
  });
}

/**
 * A database in the shape every pre-EW-8 install has: `auto_vacuum = NONE`, fixed there because the
 * journal mode was set before the pragma. Measured directly - WAL first leaves auto_vacuum at 0
 * with no error, which is why the ordering in the constructor is load-bearing.
 */
async function legacyDatabase(): Promise<string> {
  const path = await databasePath();
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("auto_vacuum = 2");
  db.exec("CREATE TABLE legacy_marker (a TEXT)");
  const mode = (db.pragma("auto_vacuum") as Array<{ auto_vacuum: number }>)[0]?.auto_vacuum;
  db.close();
  expect(mode, "the fixture must actually be in NONE mode, or it proves nothing").toBe(0);
  return path;
}

function seedRepo(storage: ReturnType<typeof openDriftStorage>): void {
  storage.migrate();
  storage.upsertRepo({
    id: REPO_ID,
    root_path: "/tmp/repo",
    fingerprint: "fingerprint",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z"
  });
}

describe("disk reclaim", () => {
  it("keeps five scans of an unchanged repo within 1.5x the size of one", async () => {
    const path = await databasePath();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);

      // `keep: 1` throughout, so "the size of one scan" is genuinely the steady state and the
      // 1.5x bound measures reclaim rather than retention policy. The default keeps two scans, and
      // two scans of identical content are ~2x one by content alone - a bound that ignored that
      // would be measuring the wrong thing and would fail even with a perfect vacuum.
      writeScan(storage, 1);
      storage.pruneSupersededScans(REPO_ID, { keep: 1 });
      const afterOne = await onDiskBytes(path);
      expect(afterOne, "the fixture must be big enough for the ratio to mean something")
        .toBeGreaterThan(256 * 1024);

      for (let index = 2; index <= 5; index += 1) {
        writeScan(storage, index);
        storage.pruneSupersededScans(REPO_ID, { keep: 1 });
      }
      const afterFive = await onDiskBytes(path);

      expect(
        afterFive,
        `five scans grew on-disk state from ${afterOne} to ${afterFive} bytes; freed pages are ` +
          "being kept for reuse rather than returned to the OS"
      ).toBeLessThan(afterOne * 1.5);
    } finally {
      storage.close();
    }
  });

  it("reports the bytes it handed back, so the reclaim is observable rather than assumed", async () => {
    const path = await databasePath();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      for (let index = 1; index <= 4; index += 1) {
        writeScan(storage, index);
      }
      const pruned = storage.pruneSupersededScans(REPO_ID, { keep: 1 });

      expect(pruned.deleted.length, "there must be something to prune").toBeGreaterThan(0);
      expect(
        pruned.reclaimed_bytes,
        "a reclaim nobody can measure is indistinguishable from the previous behaviour"
      ).toBeGreaterThan(0);
    } finally {
      storage.close();
    }
  });

  it("refuses the one-time full reclaim rather than filling the disk", async () => {
    // A genuine pre-EW-8 database, built the way the old code built one: journal mode first, which
    // writes the header and fixes auto_vacuum at NONE for the life of the file. Constructing it
    // rather than mocking the mode is the point - every database a beta user already has is this
    // shape, and the migration path has to be exercised against the real thing.
    const path = await legacyDatabase();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      writeScan(storage, 1);

      // The upgrade to INCREMENTAL is a full VACUUM - roughly twice the database's size in scratch
      // space. On a machine at the halt floor that is the hazard, not the fix, so it must decline
      // and say so.
      const result = storage.reclaimDiskSpace({
        availableBytes: 1024,
        minimumFreeBytes: 5 * 1024 ** 3
      });

      expect(result.performed).toBe("none");
      expect(result.reclaimed_bytes).toBe(0);
      expect(
        result.refused_reason,
        "the refusal must say how much space it would have needed"
      ).toMatch(/needs about/);
      expect(result.required_bytes).toBeGreaterThan(5 * 1024 ** 3);
    } finally {
      storage.close();
    }
  });

  it("reclaims incrementally on a database already in incremental mode, without a full rewrite", async () => {
    const path = await databasePath();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      for (let index = 1; index <= 3; index += 1) {
        writeScan(storage, index);
      }

      // New databases are created in INCREMENTAL mode, so no migration is needed and the
      // space check is irrelevant - the cheap path must be taken even with no free space claimed.
      const result = storage.reclaimDiskSpace({ availableBytes: 0, minimumFreeBytes: 0 });

      expect(
        result.performed,
        "a database that never needed the migration must not be made to pay for one"
      ).toBe("incremental");
      expect(result.refused_reason).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("performs the one-time full reclaim on a legacy database when there is room", async () => {
    const path = await legacyDatabase();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      for (let index = 1; index <= 3; index += 1) {
        writeScan(storage, index);
      }
      storage.pruneSupersededScans(REPO_ID, { keep: 1 });
      const before = await onDiskBytes(path);

      const result = storage.reclaimDiskSpace({
        availableBytes: 64 * 1024 ** 3,
        minimumFreeBytes: 0
      });

      expect(result.performed, "a legacy database needs the full VACUUM to change mode").toBe(
        "full_vacuum"
      );
      expect(result.refused_reason).toBeNull();
      expect(await onDiskBytes(path), "and the file must actually be smaller afterwards")
        .toBeLessThan(before);
    } finally {
      storage.close();
    }
  });

  it("keeps reclaiming after the one-time migration, without another full rewrite", async () => {
    const path = await legacyDatabase();
    let storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      writeScan(storage, 1);
      storage.reclaimDiskSpace({ availableBytes: 64 * 1024 ** 3, minimumFreeBytes: 0 });
    } finally {
      storage.close();
    }

    // Reopened: the mode set by the VACUUM must have persisted, or the migration bought nothing
    // and every future prune silently reclaims zero again.
    storage = openDriftStorage({ databasePath: path });
    try {
      const result = storage.reclaimDiskSpace({ availableBytes: 0, minimumFreeBytes: 0 });
      expect(result.performed).toBe("incremental");
      expect(result.refused_reason).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("upgrades a legacy database during a prune when there is provably room", async () => {
    const path = await legacyDatabase();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      for (let index = 1; index <= 3; index += 1) {
        writeScan(storage, index);
      }
      const before = await onDiskBytes(path);

      // `availableBytes` in hand and plenty of it: the upgrade is safe, so it happens here rather
      // than requiring the user to know a command exists.
      const pruned = storage.pruneSupersededScans(REPO_ID, {
        keep: 1,
        availableBytes: 64 * 1024 ** 3
      });

      expect(pruned.reclaim_performed).toBe("full_vacuum");
      expect(pruned.reclaim_declined_reason).toBeNull();
      expect(await onDiskBytes(path)).toBeLessThan(before);
    } finally {
      storage.close();
    }
  });

  it("declines the upgrade with a reason when there is not room, and keeps pruning", async () => {
    const path = await legacyDatabase();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      for (let index = 1; index <= 3; index += 1) {
        writeScan(storage, index);
      }

      const pruned = storage.pruneSupersededScans(REPO_ID, { keep: 1, availableBytes: 1024 });

      // Pruning is the part that bounds growth, and it must still happen - the reclaim is the
      // part that returns disk, and only that is declined.
      expect(pruned.deleted.length, "housekeeping must not be abandoned").toBeGreaterThan(0);
      expect(pruned.reclaim_performed).toBe("none");
      expect(
        pruned.reclaim_declined_reason,
        "a state directory that will not shrink needs to say why"
      ).toMatch(/needs about/);
    } finally {
      storage.close();
    }
  });

  it("declines rather than guessing when free space could not be measured", async () => {
    const path = await legacyDatabase();
    const storage = openDriftStorage({ databasePath: path });
    try {
      seedRepo(storage);
      writeScan(storage, 1);
      writeScan(storage, 2);

      // No `availableBytes`: an unmeasurable disk is not an empty one, and attempting a full VACUUM
      // on a guess is how housekeeping becomes the disk-exhaustion failure it exists to prevent.
      const pruned = storage.pruneSupersededScans(REPO_ID, { keep: 1 });

      expect(pruned.reclaim_performed).toBe("none");
      expect(pruned.reclaim_declined_reason).toMatch(/free space was not measured/);
    } finally {
      storage.close();
    }
  });
});
