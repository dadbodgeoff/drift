import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactGraphArtifact, buildFactGraphArtifactFromParts } from "@drift/factgraph";
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

  it("returns route-to-service-to-data-access flow from graph projections", async () => {
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
      id: "scan_flow",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 3,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 100,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "src/lib/db.ts",
        content_hash: "c".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("file:app/api/users/route.ts", "file", "app/api/users/route.ts", { path: "app/api/users/route.ts" }),
        graphNode("file:src/services/users.ts", "file", "src/services/users.ts", { path: "src/services/users.ts" }),
        graphNode("file:src/lib/db.ts", "file", "src/lib/db.ts", { path: "src/lib/db.ts" }),
        graphNode("module:app/api/users/route.ts", "module", "app/api/users/route.ts", { file_path: "app/api/users/route.ts" }),
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("file_role:api_route", "file_role", "api_route", { role: "api_route" }),
        graphNode("file_role:service_module", "file_role", "service_module", { role: "service_module" }),
        graphNode("file_role:data_access_module", "file_role", "data_access_module", { role: "data_access_module" }),
        graphNode("route:POST:app/api/users/route.ts", "route", "POST", {
          file_path: "app/api/users/route.ts",
          method: "POST",
          route_pattern: "/api/users",
          framework_role: "next_app_route",
          dynamic_params: []
        }),
        graphNode("symbol:app/api/users/route.ts:function:POST", "symbol", "POST", {
          file_path: "app/api/users/route.ts",
          symbol_kind: "function",
          exported: true
        }),
        graphNode("data_store:db:user", "data_store", "user", {
          receiver_root: "db",
          store_name: "user",
          file_path: "src/services/users.ts"
        }),
        {
          ...graphNode("data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3", "data_operation", "create", {
            file_path: "src/services/users.ts",
            receiver_name: "db.user",
            receiver_root: "db",
            store_name: "user",
            operation_name: "create",
            operation_kind: "write"
          }),
          evidence_ids: ["evidence_data_operation"]
        }
      ],
      edges: [
        graphEdge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
        graphEdge("FILE_HAS_ROLE", "file:src/services/users.ts", "file_role:service_module"),
        graphEdge("FILE_HAS_ROLE", "file:src/lib/db.ts", "file_role:data_access_module"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/services/users.ts"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:src/services/users.ts", "module:src/lib/db.ts"),
        graphEdge("ROUTE_HANDLED_BY_SYMBOL", "route:POST:app/api/users/route.ts", "symbol:app/api/users/route.ts:function:POST"),
        graphEdge("DATA_OPERATION_WRITES_DATA_STORE", "data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3", "data_store:db:user")
      ],
      evidence: [
        graphEvidence("evidence_data_operation", "fact_data_operation", "scan_flow", "src/services/users.ts", 3)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const flow = createGraphQueryService(storage).getRouteFlow({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "app/api/users/route.ts",
      method: "POST",
      policy_surface: "mcp"
    });
    const reachable = createGraphQueryService(storage).getReachableDataAccess({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "app/api/users/route.ts",
      method: "POST",
      policy_surface: "mcp"
    });
    const endpointFlow = createGraphQueryService(storage).getRouteFlow({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "/api/users",
      method: "POST",
      policy_surface: "mcp"
    });
    storage.close();

    expect(flow.complete).toBe(true);
    expect(flow.policy).toMatchObject({ surface: "mcp", local_only: true });
    expect(flow).toMatchObject({
      route_pattern: "/api/users",
      framework_role: "next_app_route",
      dynamic_params: []
    });
    expect(endpointFlow.route_module_id).toBe("module:app/api/users/route.ts");
    expect(flow.route_module_id).toBe("module:app/api/users/route.ts");
    expect(flow.route_handler_symbol_ids).toEqual(["symbol:app/api/users/route.ts:function:POST"]);
    expect(flow.service_module_ids).toEqual(["module:src/services/users.ts"]);
    expect(flow.data_access_module_ids).toEqual(["module:src/lib/db.ts"]);
    expect(flow.risk_reasons).toEqual([{
      risk_kind: "data_write",
      operation_kind: "write",
      operation_name: "create",
      store_name: "user",
      file_path: "src/services/users.ts",
      start_line: 3
    }]);
    expect(flow.module_path).toEqual([
      "module:app/api/users/route.ts",
      "module:src/services/users.ts",
      "module:src/lib/db.ts"
    ]);
    expect(reachable.data_operations).toEqual([{
      operation_node_id: "data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3",
      data_store_node_id: "data_store:db:user",
      file_path: "src/services/users.ts",
      start_line: 3,
      operation_kind: "write",
      operation_name: "create",
      store_name: "user",
      receiver_name: "db.user"
    }]);
    expect(reachable.risk_reasons).toEqual(flow.risk_reasons);
  });

  it("resolves finding evidence through graph links and explicit fact selectors", async () => {
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
      id: "scan_evidence",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 0,
      finding_count: 1,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [{
      repo_id: "repo_abc",
      scan_id: "scan_evidence",
      file_path: "app/api/users/route.ts",
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    }];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_evidence",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("finding:finding_abc", "finding", "API route imports data access directly", {}),
        {
          ...graphNode("import_decl:app/api/users/route.ts:db", "import_decl", "db", {
            file_path: "app/api/users/route.ts",
            source: "@/lib/db"
          }),
          evidence_ids: ["evidence_route"]
        },
        {
          ...graphNode("callsite:app/api/users/route.ts:findMany", "callsite", "findMany", {
            file_path: "app/api/users/route.ts"
          }),
          evidence_ids: ["evidence_fact"]
        }
      ],
      edges: [
        graphEdge("FINDING_HAS_EVIDENCE", "finding:finding_abc", "evidence_route")
      ],
      evidence: [
        graphEvidence("evidence_route", "fact_import", "scan_evidence", "app/api/users/route.ts", 1),
        graphEvidence("evidence_fact", "fact_call", "scan_evidence", "app/api/users/route.ts", 3)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const result = createGraphQueryService(storage).getFindingEvidence({
      repo_id: "repo_abc",
      scan_id: "scan_evidence",
      finding_id: "finding_abc",
      fact_ids: ["fact_call"],
      policy_surface: "mcp"
    });
    storage.close();

    expect(result.diagnostics).toEqual([]);
    expect(result.policy).toMatchObject({ surface: "mcp", local_only: true });
    expect(result.evidence.map((evidence) => evidence.id).sort()).toEqual(["evidence_fact", "evidence_route"]);
    expect(result.related_nodes.map((node) => node.id).sort()).toEqual([
      "callsite:app/api/users/route.ts:findMany",
      "import_decl:app/api/users/route.ts:db"
    ]);
  });

  it("returns affected files from module dependents and resolver dependencies", async () => {
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
      id: "scan_affected",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 3,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 100,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "src/lib/db.ts",
        content_hash: "c".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("file:app/api/users/route.ts", "file", "app/api/users/route.ts", { path: "app/api/users/route.ts" }),
        graphNode("file:src/services/users.ts", "file", "src/services/users.ts", { path: "src/services/users.ts" }),
        graphNode("file:src/lib/db.ts", "file", "src/lib/db.ts", { path: "src/lib/db.ts" }),
        graphNode("module:app/api/users/route.ts", "module", "app/api/users/route.ts", { file_path: "app/api/users/route.ts" }),
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("import_decl:src/services/users.ts:db", "import_decl", "db from ../lib/db", {
          file_path: "src/services/users.ts",
          source: "../lib/db",
          resolved_file_path: "src/lib/db.ts"
        })
      ],
      edges: [
        graphEdge("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/services/users.ts"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:src/services/users.ts", "module:src/lib/db.ts"),
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const affected = createGraphQueryService(storage).getAffectedFiles({
      repo_id: "repo_abc",
      scan_id: "scan_affected",
      path: "src/lib/db.ts",
      policy_surface: "cli-preflight"
    });
    const routeAffected = createGraphQueryService(storage).getAffectedFiles({
      repo_id: "repo_abc",
      scan_id: "scan_affected",
      path: "app/api/users/route.ts",
      policy_surface: "cli-preflight"
    });
    storage.close();

    expect(affected.policy).toMatchObject({ surface: "cli-preflight", local_only: true });
    expect(affected.files).toEqual([
      "app/api/users/route.ts",
      "src/lib/db.ts",
      "src/services/users.ts"
    ]);
    expect(routeAffected.files).toEqual(["app/api/users/route.ts"]);
  });

  it("reports graph completeness from resolver dependency projections", async () => {
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
    for (const scanId of ["scan_missing", "scan_complete", "scan_incomplete", "scan_diagnostic"]) {
      storage.upsertScanManifest({
        id: scanId,
        repo_id: "repo_abc",
        branch: "main",
        commit: "abc123",
        dirty: false,
        scanner_version: "0.1.0",
        adapter_versions: { typescript: "0.1.0" },
        rule_engine_version: "0.1.0",
        status: "completed",
        file_count: 1,
        fact_count: 0,
        finding_count: 0,
        started_at: "2026-05-22T00:00:00.000Z",
        completed_at: "2026-05-22T00:00:01.000Z"
      });
    }
    const snapshots = [{
      repo_id: "repo_abc",
      scan_id: "scan_complete",
      file_path: "src/services/users.ts",
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    }];
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_complete",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("import_decl:src/services/users.ts:db", "import_decl", "db from ../lib/db", {
          file_path: "src/services/users.ts",
          resolved_file_path: "src/lib/db.ts"
        })
      ],
      edges: [
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_incomplete",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{ ...snapshots[0], scan_id: "scan_incomplete" }],
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" })
      ],
      edges: [
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_diagnostic",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{ ...snapshots[0], scan_id: "scan_diagnostic" }],
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" })
      ],
      edges: [],
      evidence: [],
      diagnostics: [{
        id: "diag_unresolved_import",
        severity: "warning",
        code: "unresolved_import",
        message: "Could not resolve import ../lib/db from src/services/users.ts.",
        file_path: "src/services/users.ts",
        evidence_ids: []
      }],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const service = createGraphQueryService(storage);
    const missing = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_missing" });
    const complete = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_complete" });
    const incomplete = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_incomplete" });
    const diagnostic = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_diagnostic" });
    storage.close();

    expect(missing.complete).toBe(false);
    expect(missing.reasons).toContain("graph_empty");
    expect(complete.complete).toBe(true);
    expect(complete.reasons).toEqual([]);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.reasons).toContain("resolver_dependencies_missing");
    expect(diagnostic.complete).toBe(false);
    expect(diagnostic.reasons).toContain("import_resolution_incomplete");
  });

  it("returns semantic symbol neighborhoods from import and callsite graph links", async () => {
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
      id: "scan_symbols",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        {
          ...graphNode("symbol:src/services/users.ts:function:getUsers", "symbol", "getUsers", {
            file_path: "src/services/users.ts",
            symbol_kind: "function",
            exported: true
          }),
          evidence_ids: ["evidence_decl"]
        },
        {
          ...graphNode("import_decl:app/api/users/route.ts:loadUsers", "import_decl", "loadUsers from @/services/users", {
            file_path: "app/api/users/route.ts",
            source: "@/services/users",
            imported_name: "getUsers",
            local_name: "loadUsers"
          }),
          evidence_ids: ["evidence_ref"]
        },
        graphNode("callsite:app/api/users/route.ts:loadUsers", "callsite", "loadUsers", {
          file_path: "app/api/users/route.ts",
          callee_name: "loadUsers"
        })
      ],
      edges: [
        {
          ...graphEdge("IMPORT_RESOLVES_TO_SYMBOL", "import_decl:app/api/users/route.ts:loadUsers", "symbol:src/services/users.ts:function:getUsers"),
          evidence_ids: ["evidence_ref"]
        },
        graphEdge("CALLSITE_REFERENCES_SYMBOL", "callsite:app/api/users/route.ts:loadUsers", "import_decl:app/api/users/route.ts:loadUsers")
      ],
      evidence: [
        graphEvidence("evidence_decl", "fact_decl", "scan_symbols", "src/services/users.ts", 2),
        graphEvidence("evidence_ref", "fact_import", "scan_symbols", "app/api/users/route.ts", 1)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const neighborhood = createGraphQueryService(storage).getSymbolNeighborhood({
      repo_id: "repo_abc",
      scan_id: "scan_symbols",
      symbol_id: "symbol:src/services/users.ts:function:getUsers",
      depth: 2,
      policy_surface: "cli-preflight"
    });
    const missing = createGraphQueryService(storage).getSymbolNeighborhood({
      repo_id: "repo_abc",
      scan_id: "scan_symbols",
      symbol_id: "symbol:missing",
      policy_surface: "cli-preflight"
    });
    storage.close();

    expect(neighborhood.diagnostics).toEqual([]);
    expect(neighborhood.policy).toMatchObject({ surface: "cli-preflight", local_only: true });
    expect(neighborhood.nodes.map((node) => node.id)).toEqual([
      "callsite:app/api/users/route.ts:loadUsers",
      "import_decl:app/api/users/route.ts:loadUsers",
      "symbol:src/services/users.ts:function:getUsers"
    ]);
    expect(neighborhood.edges.map((edge) => edge.kind)).toEqual([
      "CALLSITE_REFERENCES_SYMBOL",
      "IMPORT_RESOLVES_TO_SYMBOL"
    ]);
    expect(neighborhood.occurrence_count).toBe(2);
    expect(neighborhood.occurrence_files).toEqual([
      "app/api/users/route.ts",
      "src/services/users.ts"
    ]);
    expect(missing.diagnostics).toContain("symbol_not_found");
    expect(missing.nodes).toEqual([]);
    expect(missing.edges).toEqual([]);
    expect(missing.occurrence_count).toBe(0);
  });
});

function graphNode(
  id: string,
  kind: string,
  label: string,
  metadata: Record<string, unknown>
) {
  return {
    id,
    kind,
    label,
    stable: true,
    evidence_ids: [],
    metadata
  };
}

function graphEdge(kind: string, from: string, to: string) {
  return {
    id: `edge:${from}:${kind}:${to}`,
    kind,
    from,
    to,
    evidence_ids: [],
    metadata: {}
  };
}

function graphEvidence(
  id: string,
  factId: string,
  scanId: string,
  filePath: string,
  line: number
) {
  return {
    id,
    repo_id: "repo_abc",
    scan_id: scanId,
    artifact_id: `file_version:${filePath}:aaaaaaaaaaaa`,
    file_path: filePath,
    file_hash: "a".repeat(64),
    start_line: line,
    end_line: line,
    adapter_id: "typescript",
    adapter_version: "0.1.0",
    fact_ids: [factId],
    redaction_state: "none"
  };
}
