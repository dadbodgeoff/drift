import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactGraphArtifact } from "@drift/factgraph";
import { openDriftStorage } from "@drift/storage";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphQueryService } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GraphQueryService", () => {
  it("maps repo files from persisted FactGraph projections without reading raw facts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 4,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/lib/db.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifact({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      facts: [
        {
          id: "fact_role",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "file_role_detected",
          file_path: "app/api/users/route.ts",
          name: "api_route",
          start_line: 1,
          end_line: 4
        },
        {
          id: "fact_import",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "app/api/users/route.ts",
          name: "db",
          value: "../../lib/db",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_export",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "exported_symbol",
          file_path: "app/api/users/route.ts",
          name: "GET",
          start_line: 3,
          end_line: 3
        },
        {
          id: "fact_call",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "symbol_called",
          file_path: "app/api/users/route.ts",
          name: "findMany",
          start_line: 4,
          end_line: 4
        }
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const map = createGraphQueryService(storage).repoMap({ repoId: "repo_abc", scanId: "scan_abc" });
    storage.close();

    expect(map.graph_summary).toMatchObject({
      graph_backed: true,
      evidence_count: 4
    });
    expect(map.files[0]).toMatchObject({
      path: "app/api/users/route.ts",
      roles: ["api_route"],
      imports: ["../../lib/db"],
      exported_symbols: ["GET"],
      calls: ["findMany"],
      fact_count: 4
    });
    expect(map.files[0]?.graph_node_ids).toContain("file:app/api/users/route.ts");
    expect(map.files[0]?.evidence_ids).toContain("evidence:typescript:app/api/users/route.ts:aaaaaaaaaaaa:1-1");
  });
});
