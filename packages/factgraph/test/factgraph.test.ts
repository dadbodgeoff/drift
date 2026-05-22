import { describe, expect, it } from "vitest";
import {
  FACTGRAPH_SCHEMA_VERSION,
  buildFactGraphArtifact,
  buildFactGraphArtifactFromParts,
  fileId,
  fileVersionId,
  graphEvidenceId,
  importDeclarationId,
  moduleId,
  symbolId
} from "../src/index.js";

describe("FactGraph V1", () => {
  it("creates stable entity, version, occurrence, and evidence IDs", () => {
    expect(fileId("apps/web/app/api/users/route.ts")).toBe("file:apps/web/app/api/users/route.ts");
    expect(fileVersionId("apps/web/app/api/users/route.ts", "abcdef1234567890")).toBe(
      "file_version:apps/web/app/api/users/route.ts:abcdef123456"
    );
    expect(moduleId("apps/web/app/api/users/route.ts")).toBe("module:apps/web/app/api/users/route.ts");
    expect(symbolId("apps/web/app/api/users/route.ts", "function", "GET")).toBe(
      "symbol:apps/web/app/api/users/route.ts:function:GET"
    );
    expect(importDeclarationId({
      filePath: "apps/web/app/api/users/route.ts",
      fileHash: "abcdef1234567890",
      source: "@/lib/prisma",
      localName: "prisma",
      startLine: 1,
      endLine: 1
    })).toBe("import_decl:apps/web/app/api/users/route.ts:abcdef123456:@/lib/prisma:prisma:1-1");
    expect(graphEvidenceId({
      filePath: "apps/web/app/api/users/route.ts",
      fileHash: "abcdef1234567890",
      startLine: 1,
      endLine: 1,
      adapterId: "typescript"
    })).toBe("evidence:typescript:apps/web/app/api/users/route.ts:abcdef123456:1-1");
  });

  it("builds deterministic evidence-backed graph artifacts from scan facts", () => {
    const artifact = buildFactGraphArtifact({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "apps/web/app/api/users/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 120,
          indexed: true
        },
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "apps/web/lib/prisma.ts",
          content_hash: "b".repeat(64),
          byte_size: 80,
          indexed: true
        }
      ],
      facts: [
        {
          id: "fact_role",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "file_role_detected",
          file_path: "apps/web/app/api/users/route.ts",
          name: "api_route",
          start_line: 1,
          end_line: 4
        },
        {
          id: "fact_import",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "apps/web/app/api/users/route.ts",
          name: "prisma",
          value: "@/lib/prisma",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_export",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "exported_symbol",
          file_path: "apps/web/app/api/users/route.ts",
          name: "GET",
          start_line: 3,
          end_line: 3
        },
        {
          id: "fact_route",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "route_declared",
          file_path: "apps/web/app/api/users/route.ts",
          name: "GET",
          start_line: 3,
          end_line: 3
        },
        {
          id: "fact_call",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "symbol_called",
          file_path: "apps/web/app/api/users/route.ts",
          name: "findMany",
          start_line: 4,
          end_line: 4
        }
      ],
      adapters: [{
        id: "typescript",
        version: "0.1.0",
        deterministic: true,
        capabilities: ["file_discovery", "syntax_facts", "route_detection"]
      }],
      pathAliases: {
        "@/*": ["apps/web/*"]
      },
      createdAt: "2026-05-22T00:00:00.000Z"
    });

    expect(artifact.schema_version).toBe(FACTGRAPH_SCHEMA_VERSION);
    expect(artifact.graph_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.node_count).toBeGreaterThan(0);
    expect(artifact.edge_count).toBeGreaterThan(0);
    expect(artifact.graph.nodes).toContainEqual(expect.objectContaining({
      id: "file:apps/web/app/api/users/route.ts",
      kind: "file"
    }));
    expect(artifact.graph.nodes).toContainEqual(expect.objectContaining({
      id: "symbol:apps/web/app/api/users/route.ts:function:GET",
      kind: "symbol"
    }));
    expect(artifact.graph.edges).toContainEqual(expect.objectContaining({
      kind: "IMPORT_RESOLVES_TO_MODULE",
      from: "import_decl:apps/web/app/api/users/route.ts:aaaaaaaaaaaa:@/lib/prisma:prisma:1-1",
      to: "module:apps/web/lib/prisma.ts"
    }));
    expect(artifact.graph.evidence).toContainEqual(expect.objectContaining({
      id: "evidence:typescript:apps/web/app/api/users/route.ts:aaaaaaaaaaaa:1-1",
      fact_ids: ["fact_import"],
      redaction_state: "none"
    }));

    const rebuilt = buildFactGraphArtifact({
      ...artifact.graph,
      snapshots: [
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "apps/web/app/api/users/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 120,
          indexed: true
        },
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "apps/web/lib/prisma.ts",
          content_hash: "b".repeat(64),
          byte_size: 80,
          indexed: true
        }
      ],
      facts: [
        {
          id: "fact_import",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "apps/web/app/api/users/route.ts",
          name: "prisma",
          value: "@/lib/prisma",
          start_line: 1,
          end_line: 1
        }
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    });
    expect(rebuilt.graph_hash).not.toBe(artifact.graph_hash);
  });

  it("materializes streamed graph parts into the same artifact contract", () => {
    const artifact = buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_stream",
        scan_id: "scan_stream",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{
        repo_id: "repo_stream",
        scan_id: "scan_stream",
        file_path: "app/api/users/route.ts",
        content_hash: "c".repeat(64),
        byte_size: 64,
        indexed: true
      }],
      nodes: [{
        id: "file:app/api/users/route.ts",
        kind: "file",
        label: "app/api/users/route.ts",
        stable: true,
        evidence_ids: [],
        metadata: { path: "app/api/users/route.ts" }
      }, {
        id: "data_store:db:user",
        kind: "data_store",
        label: "user",
        stable: true,
        evidence_ids: ["evidence:typescript:app/api/users/route.ts:cccccccccccc:1-1"],
        metadata: { receiver_root: "db", store_name: "user" }
      }, {
        id: "data_operation:app/api/users/route.ts:cccccccccccc:db.user:findMany:1-1",
        kind: "data_operation",
        label: "findMany",
        stable: false,
        evidence_ids: ["evidence:typescript:app/api/users/route.ts:cccccccccccc:1-1"],
        metadata: { receiver_name: "db.user", store_name: "user", operation_kind: "read" }
      }],
      edges: [{
        id: "edge:data_operation:app/api/users/route.ts:cccccccccccc:db.user:findMany:1-1:DATA_OPERATION_READS_DATA_STORE:data_store:db:user",
        kind: "DATA_OPERATION_READS_DATA_STORE",
        from: "data_operation:app/api/users/route.ts:cccccccccccc:db.user:findMany:1-1",
        to: "data_store:db:user",
        evidence_ids: ["evidence:typescript:app/api/users/route.ts:cccccccccccc:1-1"],
        metadata: { operation_kind: "read" }
      }],
      evidence: [{
        id: "evidence:typescript:app/api/users/route.ts:cccccccccccc:1-1",
        repo_id: "repo_stream",
        scan_id: "scan_stream",
        artifact_id: "file_version:app/api/users/route.ts:cccccccccccc",
        file_path: "app/api/users/route.ts",
        file_hash: "c".repeat(64),
        start_line: 1,
        end_line: 1,
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        fact_ids: ["fact_1"],
        redaction_state: "none"
      }],
      createdAt: "2026-05-22T00:00:00.000Z"
    });

    expect(artifact.schema_version).toBe(FACTGRAPH_SCHEMA_VERSION);
    expect(artifact.node_count).toBe(3);
    expect(artifact.edge_count).toBe(1);
    expect(artifact.evidence_count).toBe(1);
    expect(artifact.graph.completeness).toContainEqual(expect.objectContaining({
      scope: "repo",
      can_block: true
    }));
  });
});
