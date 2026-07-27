import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectScanData,
  scanDataFromEngineScanResult,
  scanDataFromEngineStreamOutput
} from "../src/engine/collect-scan-data.js";
import { engineCheckRequest } from "../src/engine/engine-check.js";
import { buildFactGraphArtifact } from "../src/engine/fact-graph.js";
import { resolveRustEngineCommand, runRustEngineWithInput } from "../src/engine/rust-engine.js";

const input = {
  repoId: "repo_abc",
  scanId: "scan_abc",
  repoRoot: "/repo"
};

describe("engine scan data bridge", () => {
  it("marks explicit TypeScript fallback as degraded and diagnostic-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-engine-fallback-"));
    const previousBin = process.env.DRIFT_ENGINE_BIN;
    const previousFallback = process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
    try {
      await mkdir(join(dir, "app/api/users"), { recursive: true });
      await writeFile(join(dir, "app/api/users/route.ts"), "export async function GET() { return Response.json({ ok: true }); }\n");
      process.env.DRIFT_ENGINE_BIN = join(dir, "missing-engine");
      process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = "1";

      const scanData = await collectScanData({
        repoId: "repo_abc",
        scanId: "scan_fallback",
        repoRoot: dir
      });

      expect(scanData.engineSource).toBe("typescript");
      expect(scanData.fallbackStatus).toMatchObject({
        fallback_used: true,
        fallback_reason: "rust_engine_failed",
        enforcement_degraded: true,
        degraded_capabilities: ["graph", "graph_evidence", "deterministic_enforcement"]
      });
      expect(scanData.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "typescript_fallback_used"
      }));
      expect(scanData.graph_nodes).toEqual([]);
      expect(scanData.graph_edges).toEqual([]);
      expect(scanData.graph_evidence).toEqual([]);
    } finally {
      if (previousBin === undefined) {
        delete process.env.DRIFT_ENGINE_BIN;
      } else {
        process.env.DRIFT_ENGINE_BIN = previousBin;
      }
      if (previousFallback === undefined) {
        delete process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
      } else {
        process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = previousFallback;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not silently resolve a TypeScript scanner fallback when the Rust engine is unavailable", () => {
    expect(resolveRustEngineCommand({
      startDir: "/tmp/drift-no-cargo-workspace",
      env: {},
      allowPackaged: false
    })).toBeUndefined();
  });

  it("fails closed when the configured Rust engine cannot execute", async () => {
    await expect(runRustEngineWithInput(["scan-repo", "--repo-root", "/repo"], undefined, {
      startDir: "/tmp/drift-no-cargo-workspace",
      env: { DRIFT_ENGINE_BIN: "/tmp/drift-missing-engine-bin" },
      allowPackaged: false
    })).rejects.toThrow(/DRIFT_ENGINE_BIN is invalid/);
  });

  it("maps a contract-valid engine scan result into Drift scan data", () => {
    const scanData = scanDataFromEngineScanResult({
      schema_version: "engine.scan.result.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      file_snapshots: [{
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [{
        kind: "import_used",
        file_path: "app/api/users/route.ts",
        name: "prisma",
        value: "@/lib/prisma",
        start_line: 1,
        end_line: 1
      }],
      framework_adapters: [{
        schema_version: "engine.framework.adapter.v1",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        adapter_version: "0.1.0",
        package_names: ["next"],
        entrypoint_kinds: ["api_route"],
        supported_patterns: ["app/api/**/route.{ts,tsx,js,jsx}"],
        unsupported_patterns: []
      }],
      normalized_entrypoints: [{
        schema_version: "engine.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        kind: "api_route",
        file_path: "app/api/users/route.ts",
        route_pattern: "/api/users",
        method: "GET",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact:app/api/users/route.ts:route_declared:GET:1-1"],
        parser_gap_ids: []
      }],
      framework_parser_gaps: [],
      framework_capabilities: [{
        schema_version: "engine.framework.capability.v1",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        capability: "entrypoint_discovery",
        status: "complete",
        can_block: true,
        block_requires_accepted_convention: true,
        parser_gap_ids: [],
        missing_proof_ids: []
      }],
      diagnostics: [],
      stats: {
        files_seen: 1,
        files_skipped: 0,
        files_parsed: 1,
        facts_emitted: 1,
        graph_nodes: 0,
        graph_edges: 0,
        diagnostics_emitted: 0,
        duration_ms: 5,
        truncated: false
      },
      completeness: [{
        scope: "repo",
        complete: true,
        required_capabilities: ["syntax_facts"],
        missing_capabilities: [],
        truncated: false,
        can_block: true,
        reasons: []
      }]
    }, input);

    expect(scanData.engineSource).toBe("rust");
    expect(scanData.files).toEqual(["app/api/users/route.ts"]);
    expect(scanData.snapshots).toMatchObject([{
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/users/route.ts",
      indexed: true
    }]);
    expect(scanData.facts).toMatchObject([{
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "import_used",
      file_path: "app/api/users/route.ts",
      name: "prisma",
      extraction_method: "rust_typescript_parser",
      evidence_level: "ast",
      resolution_status: "resolved",
      confidence_label: "certain"
    }]);
    expect(scanData.framework_adapters).toHaveLength(1);
    expect(scanData.normalized_entrypoints).toMatchObject([{
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
      framework: "next_app",
      route_pattern: "/api/users"
    }]);
    expect(scanData.framework_capabilities).toMatchObject([{
      framework: "next_app",
      capability: "entrypoint_discovery",
      can_block: true
    }]);
  });

  it("rejects malformed engine scan results before mapping", () => {
    expect(() => scanDataFromEngineScanResult({
      schema_version: "engine.scan.result.v1",
      repo_id: "repo_abc"
    }, input)).toThrow(/Invalid Drift engine scan result/);
  });

  it("maps newline-delimited stream events into Drift scan data", () => {
    const stream = [
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_started",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        engine_version: "0.1.0"
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "file_snapshot_batch",
        file_snapshots: [{
          file_path: "app/api/users/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 100,
          indexed: true
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "fact_batch",
        facts: [{
          kind: "file_detected",
          file_path: "app/api/users/route.ts",
          name: "app/api/users/route.ts",
          start_line: 1,
          end_line: 1
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "framework_adapter_batch",
        framework_adapters: [{
          schema_version: "engine.framework.adapter.v1",
          adapter_id: "framework_adapter_next_v1",
          framework: "next_app",
          adapter_version: "0.1.0",
          package_names: ["next"],
          entrypoint_kinds: ["api_route"],
          supported_patterns: ["app/api/**/route.{ts,tsx,js,jsx}"],
          unsupported_patterns: []
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "normalized_entrypoint_batch",
        normalized_entrypoints: [{
          schema_version: "engine.normalized_entrypoint.v1",
          entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          adapter_id: "framework_adapter_next_v1",
          framework: "next_app",
          kind: "api_route",
          file_path: "app/api/users/route.ts",
          route_pattern: "/api/users",
          method: "GET",
          middleware_refs: [],
          request_source_refs: [],
          response_sink_refs: [],
          data_operation_refs: [],
          confidence_label: "high",
          evidence_refs: ["fact:app/api/users/route.ts:route_declared:GET:1-1"],
          parser_gap_ids: []
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "framework_capability_batch",
        framework_capabilities: [{
          schema_version: "engine.framework.capability.v1",
          adapter_id: "framework_adapter_next_v1",
          framework: "next_app",
          capability: "entrypoint_discovery",
          status: "complete",
          can_block: true,
          block_requires_accepted_convention: true,
          parser_gap_ids: [],
          missing_proof_ids: []
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_completed",
        stats: {
          files_seen: 1,
          files_skipped: 0,
          files_parsed: 1,
          facts_emitted: 1,
          graph_nodes: 0,
          graph_edges: 0,
          diagnostics_emitted: 0,
          duration_ms: 5,
          truncated: false
        },
        completeness: [{
          scope: "repo",
          complete: true,
          required_capabilities: ["syntax_facts"],
          missing_capabilities: [],
          truncated: false,
          can_block: true,
          reasons: []
        }]
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const scanData = scanDataFromEngineStreamOutput(stream, input);

    expect(scanData.engineSource).toBe("rust");
    expect(scanData.files).toEqual(["app/api/users/route.ts"]);
    expect(scanData.facts).toHaveLength(1);
    expect(scanData.framework_adapters).toHaveLength(1);
    expect(scanData.normalized_entrypoints).toMatchObject([{
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET"
    }]);
    expect(scanData.framework_capabilities).toMatchObject([{
      framework: "next_app",
      capability: "entrypoint_discovery"
    }]);
  });

  it("preserves engine graph stream batches for durable graph persistence", () => {
    const stream = [
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_started",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        engine_version: "0.1.0"
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "graph_node_batch",
        graph_nodes: [{
          id: "file:app/api/users/route.ts",
          kind: "file",
          label: "app/api/users/route.ts",
          stable: true,
          evidence_ids: [],
          metadata: {}
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "graph_edge_batch",
        graph_edges: [{
          id: "edge:file:app/api/users/route.ts:FILE_DEFINES_MODULE:module:app/api/users/route.ts",
          kind: "FILE_DEFINES_MODULE",
          from: "file:app/api/users/route.ts",
          to: "module:app/api/users/route.ts",
          evidence_ids: [],
          metadata: {}
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "graph_evidence_batch",
        graph_evidence: [{
          id: "evidence:typescript:app/api/users/route.ts:aaaaaaaaaaaa:1-1",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          artifact_id: "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
          file_path: "app/api/users/route.ts",
          file_hash: "a".repeat(64),
          start_line: 1,
          end_line: 1,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_abc"],
          redaction_state: "none"
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_completed",
        stats: {
          files_seen: 1,
          files_skipped: 0,
          files_parsed: 1,
          facts_emitted: 0,
          graph_nodes: 1,
          graph_edges: 1,
          diagnostics_emitted: 0,
          duration_ms: 5,
          truncated: false
        },
        completeness: [{
          scope: "repo",
          complete: true,
          required_capabilities: ["syntax_facts"],
          missing_capabilities: [],
          truncated: false,
          can_block: true,
          reasons: []
        }]
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const scanData = scanDataFromEngineStreamOutput(stream, input);

    expect(scanData.graph_nodes).toHaveLength(1);
    expect(scanData.graph_edges).toHaveLength(1);
    expect(scanData.graph_evidence).toHaveLength(1);
  });

  it("preserves engine stream stats and diagnostics for skipped files", () => {
    const stream = [
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_started",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        engine_version: "0.1.0"
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "diagnostic_batch",
        diagnostics: [{
          severity: "warning",
          code: "file_too_large",
          message: "Skipped large file.",
          file_path: "app/api/large/route.ts"
        }]
      },
      {
        schema_version: "engine.stream.event.v1",
        event: "scan_completed",
        stats: {
          files_seen: 1,
          files_skipped: 1,
          files_parsed: 0,
          facts_emitted: 0,
          graph_nodes: 0,
          graph_edges: 0,
          diagnostics_emitted: 1,
          duration_ms: 5,
          truncated: false
        },
        completeness: [{
          scope: "repo",
          complete: true,
          required_capabilities: ["syntax_facts"],
          missing_capabilities: [],
          truncated: false,
          can_block: true,
          reasons: []
        }]
      }
    ].map((event) => JSON.stringify(event)).join("\n");

    const scanData = scanDataFromEngineStreamOutput(stream, input);

    expect(scanData.stats?.files_skipped).toBe(1);
    expect(scanData.diagnostics).toContainEqual(expect.objectContaining({
      code: "file_too_large",
      file_path: "app/api/large/route.ts"
    }));
  });

  it("requires a completed stream before accepting engine scan data", () => {
    const stream = JSON.stringify({
      schema_version: "engine.stream.event.v1",
      event: "scan_started",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_version: "0.1.0"
    });

    expect(() => scanDataFromEngineStreamOutput(stream, input)).toThrow(/did not complete/);
  });

  it("builds a contract-valid engine check request from scan facts", () => {
    const request = engineCheckRequest({
      repoId: "repo_abc",
      repoRoot: "/repo",
      scanId: "scan_check_abc",
      snapshots: [{
        repo_id: "repo_abc",
        scan_id: "scan_check_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [{
        id: "fact_import",
        repo_id: "repo_abc",
        scan_id: "scan_check_abc",
        kind: "import_used",
        file_path: "app/api/users/route.ts",
        name: "prisma",
        value: "@/lib/prisma",
        start_line: 1,
        end_line: 1
      }],
      graphNodes: [{
        id: "module:src/lib/prisma.ts",
        kind: "module",
        label: "src/lib/prisma.ts",
        stable: true,
        evidence_ids: ["evidence_import"],
        metadata: { path: "src/lib/prisma.ts" }
      }],
      graphEdges: [{
        id: "edge_import_resolves",
        kind: "IMPORT_RESOLVES_TO_MODULE",
        from: "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/prisma:prisma:1-1",
        to: "module:src/lib/prisma.ts",
        evidence_ids: ["evidence_import"],
        metadata: { resolution_status: "resolved" }
      }],
      graphEvidence: [{
        id: "evidence_import",
        repo_id: "repo_abc",
        scan_id: "scan_check_abc",
        artifact_id: "artifact:app/api/users/route.ts",
        file_path: "app/api/users/route.ts",
        file_hash: "a".repeat(64),
        start_line: 1,
        end_line: 1,
        start_column: 1,
        end_column: 30,
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        fact_ids: ["fact_import"],
        redaction_state: "none"
      }],
      conventions: [{
        id: "convention_no_direct_db",
        repo_id: "repo_abc",
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        statement: "API routes should not import data-access clients directly.",
        scope: { path_globs: ["app/api/**/route.ts"] },
        matcher: {
          kind: "api_route_no_direct_data_access",
          forbidden_imports: ["@/lib/prisma"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "human",
        accepted_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z"
      }],
      baseline: [],
      diff: {
        files: [{ path: "app/api/users/route.ts", changedLines: new Set([1]) }],
        deletedFiles: []
      },
      scope: "changed-hunks"
    });

    expect(request.schema_version).toBe("engine.check.request.v1");
    expect(request.scan.facts).toHaveLength(1);
    expect(request.graph.graph_nodes).toHaveLength(1);
    expect(request.graph.graph_edges).toHaveLength(1);
    expect(request.graph.graph_evidence).toHaveLength(1);
    expect(request.diff.files?.[0]).toEqual({
      path: "app/api/users/route.ts",
      changed_lines: [1]
    });
  });

  it("builds a stable fact graph artifact from snapshots and facts", () => {
    const artifact = buildFactGraphArtifact({
      repoId: "repo_abc",
      scanId: "scan_abc",
      createdAt: "2026-05-10T00:00:00.000Z",
      snapshots: [{
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [{
        id: "fact_role",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "app/api/users/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1
      }]
    });

    expect(artifact.schema_version).toBe("factgraph.v2");
    expect(artifact.graph_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.node_count).toBeGreaterThan(0);
    expect(artifact.graph.nodes).toContainEqual(expect.objectContaining({
      id: "file:app/api/users/route.ts",
      kind: "file",
      label: "app/api/users/route.ts"
    }));
  });

  it("adds graph edges for resolved relative imports", () => {
    const artifact = buildFactGraphArtifact({
      repoId: "repo_abc",
      scanId: "scan_abc",
      createdAt: "2026-05-10T00:00:00.000Z",
      snapshots: [
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "app/api/users/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 100,
          indexed: true
        },
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "app/lib/db.ts",
          content_hash: "b".repeat(64),
          byte_size: 100,
          indexed: true
        }
      ],
      facts: [{
        id: "fact_import",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "import_used",
        file_path: "app/api/users/route.ts",
        name: "db",
        value: "../../lib/db",
        start_line: 1,
        end_line: 1
      }]
    });

    expect(artifact.graph.edges).toContainEqual(expect.objectContaining({
      id: "edge:import_decl:app/api/users/route.ts:aaaaaaaaaaaa:../../lib/db:db:1-1:IMPORT_RESOLVES_TO_MODULE:module:app/lib/db.ts",
      kind: "IMPORT_RESOLVES_TO_MODULE",
      from: "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:../../lib/db:db:1-1",
      to: "module:app/lib/db.ts"
    }));
  });

  it("adds graph edges for tsconfig path alias imports", () => {
    const artifact = buildFactGraphArtifact({
      repoId: "repo_abc",
      scanId: "scan_abc",
      createdAt: "2026-05-10T00:00:00.000Z",
      pathAliases: { "@/*": ["src/*"] },
      snapshots: [
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "app/api/users/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 100,
          indexed: true
        },
        {
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          file_path: "src/lib/db.ts",
          content_hash: "b".repeat(64),
          byte_size: 100,
          indexed: true
        }
      ],
      facts: [{
        id: "fact_import",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "import_used",
        file_path: "app/api/users/route.ts",
        name: "db",
        value: "@/lib/db",
        start_line: 1,
        end_line: 1
      }]
    });

    expect(artifact.graph.edges).toContainEqual(expect.objectContaining({
      id: "edge:import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1:IMPORT_RESOLVES_TO_MODULE:module:src/lib/db.ts",
      kind: "IMPORT_RESOLVES_TO_MODULE",
      from: "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1",
      to: "module:src/lib/db.ts"
    }));
  });
});
