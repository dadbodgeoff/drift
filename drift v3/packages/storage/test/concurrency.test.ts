import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "../src/index.js";

/**
 * T17. Three processes can hold the same database at once in normal use: an edit-time hook
 * running `drift check`, a developer running the CLI, and an agent holding the MCP server open.
 * WAL stops readers blocking the writer, but concurrent writers still collide, and without a
 * busy timeout SQLite returns SQLITE_BUSY immediately - which reaches the user as a crash
 * rather than a brief wait. This must hold before the hooks pack ships.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-concurrency-"));
  dirs.push(dir);
  return join(dir, "drift.sqlite");
}

describe("concurrent connections", () => {
  it("enables WAL and a busy timeout", async () => {
    const storage = openDriftStorage({ databasePath: await databasePath() });
    storage.migrate();
    const raw = storage as unknown as {
      db: { pragma: (q: string, options?: { simple?: boolean }) => unknown };
    };
    expect(String(raw.db.pragma("journal_mode", { simple: true })).toLowerCase()).toBe("wal");
    // Without this, a second writer fails instantly instead of waiting.
    expect(Number(raw.db.pragma("busy_timeout", { simple: true }))).toBeGreaterThan(0);
    storage.close();
  });

  it("allows a second connection to read while the first holds the database", async () => {
    const path = await databasePath();
    const writer = openDriftStorage({ databasePath: path });
    writer.migrate();
    writer.upsertRepo({
      id: "repo_abc",
      root_path: "/tmp/repo",
      fingerprint: "fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });

    // A reader opening the same file must see committed data, not fail to acquire it.
    const reader = openDriftStorage({ databasePath: path });
    expect(reader.getRepo("repo_abc")?.id).toBe("repo_abc");
    reader.close();
    writer.close();
  });

  it("survives interleaved writes from two connections", async () => {
    const path = await databasePath();
    const first = openDriftStorage({ databasePath: path });
    first.migrate();
    const second = openDriftStorage({ databasePath: path });

    // Alternate writers, as a hook and the CLI would while a developer edits files.
    for (let index = 0; index < 20; index += 1) {
      const storage = index % 2 === 0 ? first : second;
      storage.upsertRepo({
        id: `repo_${index}`,
        root_path: `/tmp/repo_${index}`,
        fingerprint: `fp_${index}`,
        created_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z"
      });
    }

    for (let index = 0; index < 20; index += 1) {
      expect(first.getRepo(`repo_${index}`), `repo_${index} missing`).toBeDefined();
    }
    second.close();
    first.close();
  });
});
