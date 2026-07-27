import { describe, expect, it } from "vitest";
import {
  EngineCheckRequestSchema,
  EngineCandidatesResultSchema,
  EngineScanResultSchema,
  EngineStreamEventSchema,
  parseEngineCandidatesResult,
  parseEngineCheckResult,
  parseEngineScanResult,
  parseEngineStreamEvent
} from "../src/index.js";

describe("engine contract schemas", () => {
  it("validates a versioned scan result with diagnostics, stats, and completeness", () => {
    const result = parseEngineScanResult({
      schema_version: "engine.scan.result.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      file_snapshots: [{
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 123,
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
      diagnostics: [],
      stats: {
        files_seen: 1,
        files_skipped: 0,
        files_parsed: 1,
        facts_emitted: 1,
        graph_nodes: 0,
        graph_edges: 0,
        diagnostics_emitted: 0,
        duration_ms: 10,
        truncated: false,
        capabilities: {
          certified: ["file_discovery", "syntax_facts"],
          required: ["syntax_facts"],
          missing: []
        }
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
    });

    expect(result.schema_version).toBe("engine.scan.result.v1");
    expect(result.stats.capabilities).toEqual({
      certified: ["file_discovery", "syntax_facts"],
      required: ["syntax_facts"],
      missing: []
    });
    expect(EngineScanResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects malformed scan results at the boundary", () => {
    expect(() => parseEngineScanResult({
      schema_version: "engine.scan.result.v1",
      repo_id: "repo_abc"
    })).toThrow(/Invalid Drift engine scan result/);
  });

  it("validates streaming scan batch events", () => {
    const event = parseEngineStreamEvent({
      schema_version: "engine.stream.event.v1",
      event: "fact_batch",
      facts: [{
        kind: "file_detected",
        file_path: "app/api/users/route.ts",
        name: "app/api/users/route.ts",
        start_line: 1,
        end_line: 1
      }]
    });

    expect(event.event).toBe("fact_batch");
    expect(EngineStreamEventSchema.safeParse(event).success).toBe(true);
  });

  it("validates graph streaming batch events", () => {
    const nodeEvent = parseEngineStreamEvent({
      schema_version: "engine.stream.event.v1",
      event: "graph_node_batch",
      graph_nodes: [{
        id: "file:app/api/users/route.ts",
        kind: "file",
        label: "app/api/users/route.ts",
        stable: true,
        evidence_ids: [],
        metadata: { path: "app/api/users/route.ts" }
      }]
    });
    const edgeEvent = parseEngineStreamEvent({
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
    });
    const evidenceEvent = parseEngineStreamEvent({
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
    });

    expect(nodeEvent.event).toBe("graph_node_batch");
    expect(edgeEvent.event).toBe("graph_edge_batch");
    expect(evidenceEvent.event).toBe("graph_evidence_batch");
  });

  it("validates check requests that carry scan facts to the engine", () => {
    const parsed = EngineCheckRequestSchema.parse({
      schema_version: "engine.check.request.v1",
      repo: {
        repo_id: "repo_abc",
        repo_root: "/repo",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      graph: {
        require_fresh: false,
        graph_nodes: [{
          id: "module:src/lib/prisma.ts",
          kind: "module",
          label: "src/lib/prisma.ts",
          stable: true,
          evidence_ids: ["evidence_import"],
          metadata: { path: "src/lib/prisma.ts" }
        }],
        graph_edges: [{
          id: "edge_import_resolves",
          kind: "IMPORT_RESOLVES_TO_MODULE",
          from: "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/prisma:prisma:1-1",
          to: "module:src/lib/prisma.ts",
          evidence_ids: ["evidence_import"],
          metadata: { resolution_status: "resolved" }
        }],
        graph_evidence: [{
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
        }]
      },
      scan: {
        scan_id: "scan_check_abc",
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
        }]
      },
      contract: {
        contract_id: "contract_abc",
        contract_schema_version: 1,
        conventions: [{
          id: "convention_no_direct_db",
          rule_id: "api_route_no_direct_data_access",
          kind: "api_route_no_direct_data_access",
          matcher: {
            forbidden_imports: ["@/lib/prisma"]
          },
          severity: "error",
          enforcement_mode: "block",
          enforcement_capability: "deterministic_check"
        }],
        waivers: [],
        exceptions: []
      },
      baseline: [],
      diff: {
        mode: "changed-hunks",
        files: [{
          path: "app/api/users/route.ts",
          changed_lines: [1]
        }]
      },
      limits: {
        max_files_seen: 100,
        max_files_parsed: 100,
        max_file_bytes: 1000000,
        max_facts: 1000,
        max_graph_nodes: 0,
        max_graph_edges: 0,
        max_diagnostics: 100,
        follow_symlinks: false
      }
    });

    expect(parsed.scan.facts).toHaveLength(1);
    expect(parsed.graph.graph_nodes).toHaveLength(1);
    expect(parsed.graph.graph_edges).toHaveLength(1);
    expect(parsed.graph.graph_evidence).toHaveLength(1);
  });

  it("validates request validation method and requires scope in check requests", () => {
    const parsed = EngineCheckRequestSchema.parse({
      schema_version: "engine.check.request.v1",
      repo: {
        repo_id: "repo_abc",
        repo_root: "/repo",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      graph: {
        require_fresh: false,
        graph_nodes: [],
        graph_edges: [],
        graph_evidence: [],
        graph_diagnostics: []
      },
      scan: {
        scan_id: "scan_check_abc",
        file_snapshots: [{
          file_path: "app/api/projects/route.ts",
          content_hash: "a".repeat(64),
          byte_size: 100,
          indexed: true
        }],
        facts: []
      },
      contract: {
        contract_id: "contract_abc",
        contract_schema_version: 1,
        conventions: [{
          id: "security_api_request_validation",
          rule_id: "api_route_requires_request_validation",
          kind: "api_route_requires_request_validation",
          matcher: {
            methods: ["POST"],
            applies_to_file_roles: ["api_route"]
          },
          requires: {
            input_sources: ["body"],
            sinks: ["data_operation"],
            schemas: ["ProjectInputSchema"]
          },
          severity: "error",
          enforcement_mode: "block",
          enforcement_capability: "deterministic_check"
        }],
        waivers: [],
        exceptions: []
      },
      baseline: [],
      diff: {
        mode: "changed-hunks",
        files: [{
          path: "app/api/projects/route.ts",
          changed_lines: [1]
        }]
      },
      limits: {
        max_files_seen: 100,
        max_files_parsed: 100,
        max_file_bytes: 1000000,
        max_facts: 1000,
        max_graph_nodes: 0,
        max_graph_edges: 0,
        max_diagnostics: 100,
        follow_symlinks: false
      }
    });

    expect(parsed.contract.conventions[0]?.requires).toMatchObject({
      input_sources: ["body"],
      sinks: ["data_operation"],
      schemas: ["ProjectInputSchema"]
    });
  });

  it("validates engine-owned check results", () => {
    const result = parseEngineCheckResult({
      schema_version: "engine.check.result.v1",
      repo_id: "repo_abc",
      scan_id: "scan_check_abc",
      engine_version: "0.1.0",
      rule_engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      diff_mode: "changed-hunks",
      findings: [{
        id: "finding_abc",
        fingerprint: "fingerprint_abc",
        convention_id: "convention_no_direct_db",
        rule_id: "api_route_no_direct_data_access",
        title: "API route imports data access directly",
        message: "app/api/users/route.ts imports prisma from @/lib/prisma directly.",
        severity: "error",
        enforcement_result: "block",
        status_hint: "new",
        diff_status: "new_in_diff",
        evidence: [{
          file_path: "app/api/users/route.ts",
          start_line: 1,
          end_line: 1,
          evidence_id: "evidence_abc"
        }],
        related_node_ids: []
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
        duration_ms: 2,
        truncated: false
      },
      completeness: [{
        scope: "repo",
        complete: true,
        required_capabilities: ["direct_data_access_check"],
        missing_capabilities: [],
        truncated: false,
        can_block: true,
        reasons: []
      }]
    });

    expect(result.findings[0].diff_status).toBe("new_in_diff");
  });

  it("rejects blocking check results when required capabilities are missing", () => {
    expect(() => parseEngineCheckResult({
      schema_version: "engine.check.result.v1",
      repo_id: "repo_abc",
      scan_id: "scan_check_abc",
      engine_version: "0.1.0",
      rule_engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      diff_mode: "changed-hunks",
      findings: [{
        id: "finding_abc",
        fingerprint: "fingerprint_abc",
        convention_id: "convention_no_direct_db",
        rule_id: "api_route_no_direct_data_access",
        title: "API route imports data access directly",
        message: "app/api/users/route.ts imports prisma from @/lib/prisma directly.",
        severity: "error",
        enforcement_result: "block",
        status_hint: "new",
        diff_status: "new_in_diff",
        evidence: [{ file_path: "app/api/users/route.ts" }],
        related_node_ids: []
      }],
      diagnostics: [],
      stats: {
        files_seen: 1,
        files_skipped: 0,
        files_parsed: 1,
        facts_emitted: 1,
        graph_nodes: 1,
        graph_edges: 1,
        diagnostics_emitted: 0,
        duration_ms: 2,
        truncated: false,
        capabilities: {
          certified: ["syntax_facts"],
          required: ["direct_data_access_check"],
          missing: ["direct_data_access_check"]
        }
      },
      completeness: [{
        scope: "repo",
        complete: false,
        required_capabilities: ["direct_data_access_check"],
        missing_capabilities: ["direct_data_access_check"],
        truncated: false,
        can_block: false,
        reasons: ["missing_capability:direct_data_access_check"]
      }]
    })).toThrow(/blocking findings require complete capability coverage/);
  });

  it("validates engine-owned candidate inference results without governance mutation state", () => {
    const result = parseEngineCandidatesResult({
      schema_version: "engine.candidates.result.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      graph_id: "graph_scan_abc",
      engine_version: "0.1.0",
      rule_engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      candidates: [{
        candidate_id: "candidate_abc",
        candidate_version: 1,
        kind: "api_route_no_direct_data_access",
        rule_id: "api_route_no_direct_data_access",
        rule_version: "0.1.0",
        matcher_schema_version: "convention.matcher.v1",
        matcher_fingerprint: "matcher_fp",
        scope_fingerprint: "scope_fp",
        graph_fingerprint: "graph_fp",
        statement: "API routes should not import data-access clients directly.",
        rationale: "Detected API route imports that resolve to data-access modules.",
        scope: {
          path_globs: ["**/app/api/**/route.ts"],
          file_roles: ["api_route"]
        },
        matcher: {
          kind: "api_route_no_direct_data_access",
          forbidden_imports: ["@/lib/db"],
          applies_to_file_roles: ["api_route"]
        },
        requires: {
          forbidden_imports: ["@/lib/db"]
        },
        suggested_severity: "error",
        suggested_enforcement_mode: "warn",
        enforcement_capability: "deterministic_check",
        confidence_label: "high",
        scoring: {
          supporting_examples_count: 2,
          counterexamples_count: 0,
          scope_files_count: 3,
          coverage_ratio: 0.67,
          heuristic_id: "engine-direct-data-access-v1"
        },
        required_capabilities: ["syntax_facts", "import_resolution", "route_detection"],
        evidence_refs: [{
          id: "evidence_ref_abc",
          kind: "supporting",
          file_path: "app/api/users/route.ts",
          start_line: 1,
          end_line: 1,
          import_source: "@/lib/db",
          fact_ids: ["fact_import"],
          scan_id: "scan_abc",
          file_hash: "a".repeat(64),
          redaction_state: "none"
        }],
        counterexample_refs: [],
        reason_not_blocking: "candidate_not_accepted",
        evidence_fingerprint: "evidence_fp"
      }],
      diagnostics: [],
      stats: {
        files_seen: 3,
        files_skipped: 0,
        files_parsed: 3,
        facts_emitted: 10,
        graph_nodes: 12,
        graph_edges: 14,
        diagnostics_emitted: 0,
        duration_ms: 2,
        truncated: false
      },
      completeness: [{
        scope: "repo",
        complete: true,
        required_capabilities: ["candidate_inference"],
        missing_capabilities: [],
        truncated: false,
        can_block: false,
        reasons: []
      }]
    });

    expect(result.candidates[0].kind).toBe("api_route_no_direct_data_access");
    expect(result.candidates[0]).not.toHaveProperty("status");
    expect(EngineCandidatesResultSchema.safeParse(result).success).toBe(true);
  });
});
