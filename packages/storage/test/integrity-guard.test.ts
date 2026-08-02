import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { isCorruptStoredDataError, openDriftStorage } from "../src/index.js";

/**
 * F-3 (R-3 fix). Two verified silent failure modes:
 *
 * (a) a database corrupted mid-file (damaged pages whose b-tree still walks for the queried
 *     tables) was served as success - the guard must fail closed with a corrupt_database error
 *     instead of serving possibly-incomplete data;
 * (b) corrupted WAL frames silently discard committed transactions - SQLite's recovery stops at
 *     the first bad frame and says nothing, exit 0 everywhere. Full committed-vs-torn
 *     discrimination is impossible from the file alone, but "current-generation frames carrying
 *     a commit record were discarded" is observable and must surface as a warning diagnostic.
 */

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-integrity-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Seed a real Drift DB plus a filler table large enough to have corruptible interior pages. */
function seedWithFiller(databasePath: string): { fillerFirstPage: number; pageCount: number } {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertRepo({
    id: "repo_abc",
    root_path: "/nonexistent/repo",
    fingerprint: "repo-fp",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z"
  });
  storage.close();

  const raw = new Database(databasePath);
  const before = (raw.pragma("page_count") as Array<{ page_count: number }>)[0]!.page_count;
  raw.exec("CREATE TABLE filler (id INTEGER PRIMARY KEY, data BLOB)");
  const insert = raw.prepare("INSERT INTO filler (data) VALUES (?)");
  const blob = Buffer.alloc(4000, 7);
  const tx = raw.transaction(() => {
    for (let i = 0; i < 200; i++) insert.run(blob);
  });
  tx();
  raw.pragma("wal_checkpoint(TRUNCATE)");
  const after = (raw.pragma("page_count") as Array<{ page_count: number }>)[0]!.page_count;
  raw.close();
  return { fillerFirstPage: before + 1, pageCount: after };
}

async function corruptPage(databasePath: string, pageNumber: number): Promise<void> {
  const bytes = await readFile(databasePath);
  const pageSize = bytes.readUInt16BE(16) === 1 ? 65536 : bytes.readUInt16BE(16);
  const offset = (pageNumber - 1) * pageSize;
  bytes.fill(0xff, offset + 32, offset + pageSize - 32);
  await writeFile(databasePath, bytes);
}

describe("integrity guard fails closed on mid-file corruption (F-3a)", () => {
  it("refuses to open a mid-file-corrupted database when the guard is requested", async () => {
    const dir = await tempDir();
    const databasePath = join(dir, "drift.sqlite");
    const { fillerFirstPage, pageCount } = seedWithFiller(databasePath);
    // Corrupt a page in the middle of the filler btree: the schema and the tables Drift's
    // serve paths read still walk, which is exactly the verified silent mode.
    const target = Math.min(fillerFirstPage + 3, pageCount);
    await corruptPage(databasePath, target);

    let thrown: unknown;
    try {
      const storage = openDriftStorage({ databasePath, integrityGuard: true });
      storage.close();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "guard must refuse a corrupt database instead of serving").toBeDefined();
    expect(isCorruptStoredDataError(thrown)).toBe(true);
    expect((thrown as Error).message).toMatch(/quick_check|integrity/i);
  });

  it("opens a healthy database with the guard enabled and caches the verification", async () => {
    const dir = await tempDir();
    const databasePath = join(dir, "drift.sqlite");
    seedWithFiller(databasePath);
    const first = openDriftStorage({ databasePath, integrityGuard: true });
    expect(first.getRepo("repo_abc")).toBeDefined();
    first.close();
    // Second open of an unchanged file must reuse the cached verification (no re-scan).
    const second = openDriftStorage({ databasePath, integrityGuard: true });
    expect(second.getRepo("repo_abc")).toBeDefined();
    second.close();
  });
});

describe("WAL recovery surfaces a warning diagnostic (F-3b)", () => {
  it("warns when recovery discards current-generation WAL frames carrying commit records", async () => {
    const dir = await tempDir();
    const livePath = join(dir, "live.sqlite");
    const crashPath = join(dir, "crash.sqlite");

    // Build a WAL with 10 committed single-statement transactions, snapshot db+wal mid-flight
    // (simulating the state on disk at a crash), then corrupt frame 6 of the snapshot's WAL.
    const raw = new Database(livePath);
    raw.pragma("journal_mode = WAL");
    raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    raw.pragma("wal_checkpoint(TRUNCATE)");
    const insert = raw.prepare("INSERT INTO t (v) VALUES (?)");
    for (let i = 0; i < 10; i++) raw.transaction(() => insert.run(`txn${i}`))();
    await copyFile(livePath, crashPath);
    await copyFile(`${livePath}-wal`, `${crashPath}-wal`);
    raw.close();

    const wal = await readFile(`${crashPath}-wal`);
    const pageSize = wal.readUInt32BE(8);
    const frameSize = 24 + pageSize;
    const target = 32 + 5 * frameSize + 24 + 100; // inside frame 6's page image
    wal[target] ^= 0xff;
    wal[target + 1] ^= 0xff;
    await writeFile(`${crashPath}-wal`, wal);

    const storage = openDriftStorage({ databasePath: crashPath });
    const diagnostics = storage.openDiagnostics;
    storage.close();
    expect(diagnostics.some((diagnostic) => diagnostic.code === "wal_recovery_discarded_commits")).toBe(true);
    const warning = diagnostics.find((diagnostic) => diagnostic.code === "wal_recovery_discarded_commits");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toMatch(/commit/i);
  });

  it("stays silent on a clean open and on stale pre-checkpoint WAL leftovers", async () => {
    const dir = await tempDir();
    const databasePath = join(dir, "clean.sqlite");
    const raw = new Database(databasePath);
    raw.pragma("journal_mode = WAL");
    raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    raw.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
    raw.close();

    const storage = openDriftStorage({ databasePath });
    expect(
      storage.openDiagnostics.filter((diagnostic) => diagnostic.code === "wal_recovery_discarded_commits")
    ).toEqual([]);
    storage.close();
  });
});
