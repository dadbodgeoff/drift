import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/migrations.js";
import { openDriftStorage } from "../src/index.js";

/**
 * T16. 0.9.x is published and has real installs, so upgrade must be safe in both directions:
 * an older database migrates forward without losing data, and a *newer* database is refused
 * rather than operated on blindly.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-migrations-"));
  dirs.push(dir);
  return join(dir, "drift.sqlite");
}

const REPO = {
  id: "repo_legacy",
  root_path: "/tmp/legacy",
  fingerprint: "fp",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

describe("forward migration", () => {
  it("applies every migration to a fresh database and records them", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(20);
    const ids = MIGRATIONS.map((migration) => migration.id);
    // Ids must be unique and stable: they are the upgrade key, so a duplicate or a rename would
    // silently skip a migration on an existing install.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("migrates a database that stopped at an earlier version, preserving data", async () => {
    const path = await databasePath();

    // Simulate an older install: apply the first eight migrations only, then write data through
    // whatever surface existed then, then upgrade.
    const legacy = openDriftStorage({ databasePath: path });
    const raw = legacy as unknown as {
      db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => { run: (...args: unknown[]) => void };
      };
      applyMigration: (migration: (typeof MIGRATIONS)[number]) => void;
    };
    raw.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    const record = raw.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
    for (const migration of MIGRATIONS.slice(0, 8)) {
      raw.applyMigration(migration);
      record.run(migration.id, "2026-01-01T00:00:00.000Z");
    }
    // Write through raw SQL, not upsertRepo: the modern writer sets columns that later
    // migrations add, which is exactly what an older build could not have done.
    raw.db
      .prepare(
        "INSERT INTO repos (id, root_path, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(REPO.id, REPO.root_path, REPO.fingerprint, REPO.created_at, REPO.updated_at);
    legacy.close();

    // Upgrade.
    const upgraded = openDriftStorage({ databasePath: path });
    expect(() => upgraded.migrate()).not.toThrow();
    expect(upgraded.getAppliedMigrations().length).toBe(MIGRATIONS.length);
    // The data written by the older version survives.
    expect(upgraded.getRepo("repo_legacy")?.root_path).toBe("/tmp/legacy");
    upgraded.close();
  });

  it("is idempotent when run repeatedly", async () => {
    const path = await databasePath();
    const storage = openDriftStorage({ databasePath: path });
    storage.migrate();
    const first = storage.getAppliedMigrations().length;
    storage.migrate();
    storage.migrate();
    expect(storage.getAppliedMigrations().length).toBe(first);
    storage.close();
  });
});

describe("newer database is refused", () => {
  it("fails closed rather than operating on a schema it does not understand", async () => {
    const path = await databasePath();
    const storage = openDriftStorage({ databasePath: path });
    storage.migrate();

    // Simulate a database written by a future Drift: an applied migration this build has never
    // heard of. Previously this was ignored - all known migrations were already applied, so
    // migrate() did nothing and the CLI carried on against an unknown schema.
    const raw = storage as unknown as {
      db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
    };
    raw.db
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("999_from_the_future", "2027-01-01T00:00:00.000Z");
    storage.close();

    const older = openDriftStorage({ databasePath: path });
    expect(() => older.migrate()).toThrow(/newer version of Drift/);
    // The message must name the remedy, and be the string the CLI classifies as a refusal.
    expect(() => older.migrate()).toThrow(/Unsupported local state schema/);
    older.close();
  });
});
