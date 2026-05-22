import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-fixture-matrix-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

beforeEach(() => {
  originalEngineBin = process.env.DRIFT_ENGINE_BIN;
  process.env.DRIFT_ENGINE_BIN = resolve("target/debug/drift-engine");
});

afterEach(async () => {
  if (originalEngineBin === undefined) {
    delete process.env.DRIFT_ENGINE_BIN;
  } else {
    process.env.DRIFT_ENGINE_BIN = originalEngineBin;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("fixture matrix", () => {
  it("keeps a service-delegated API route as a graph-resolved route-to-service flow", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-service-delegated");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);
    const storage = openDriftStorage({ databasePath: payload.database_path });

    try {
      const edges = storage.listGraphEdges(payload.repo.id, payload.scan.id);
      const diagnostics = storage.listGraphDiagnostics(payload.repo.id, payload.scan.id);

      expect(payload.summary.files_indexed).toBe(3);
      expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: "unresolved_import" }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/services/users.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/lib/prisma.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("resolves monorepo workspace package imports into graph module edges", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("monorepo-alias-db");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);
    const storage = openDriftStorage({ databasePath: payload.database_path });

    try {
      const edges = storage.listGraphEdges(payload.repo.id, payload.scan.id);

      expect(payload.summary.files_indexed).toBe(2);
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:packages/db/src/index.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("handles repos with no TypeScript or JavaScript without inventing conventions", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("no-ts-repo");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);

    expect(payload.summary.files_indexed).toBe(0);
    expect(payload.summary.candidates_count).toBe(0);
    expect(payload.candidates).toEqual([]);
  });
});
