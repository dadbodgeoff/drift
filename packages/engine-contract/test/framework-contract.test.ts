import { describe, expect, it } from "vitest";
import {
  EngineFrameworkAdapterSchema,
  EngineFrameworkCapabilitySchema,
  EngineFrameworkParserGapSchema,
  EngineNormalizedEntrypointSchema,
  parseEngineScanResult,
  parseEngineSecurityProofEvent,
  parseEngineStreamEvent
} from "../src/index.js";

describe("engine framework contract schemas", () => {
  it("validates scan results that carry framework adapter output", () => {
    const result = parseEngineScanResult({
      schema_version: "engine.scan.result.v1",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", framework_express: "0.1.0" },
      file_snapshots: [],
      facts: [],
      framework_adapters: [{
        schema_version: "engine.framework.adapter.v1",
        adapter_id: "framework_adapter_express_v1",
        framework: "express",
        adapter_version: "0.1.0",
        package_names: ["express"],
        entrypoint_kinds: ["api_route"],
        supported_patterns: ["app.get(path, ...middleware, handler)"],
        unsupported_patterns: ["dynamic route registration loops"]
      }],
      normalized_entrypoints: [{
        schema_version: "engine.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint_express_users_get",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
        adapter_id: "framework_adapter_express_v1",
        framework: "express",
        kind: "api_route",
        file_path: "apps/api/src/routes/users.ts",
        handler_symbol: "listUsers",
        route_pattern: "/users",
        method: "GET",
        middleware_refs: ["fact_require_user"],
        request_source_refs: ["fact_request_query"],
        response_sink_refs: ["fact_response_json"],
        data_operation_refs: ["fact_user_find_many"],
        confidence_label: "high",
        evidence_refs: ["evidence_framework_route"],
        parser_gap_ids: []
      }],
      framework_parser_gaps: [],
      framework_capabilities: [{
        schema_version: "engine.framework.capability.v1",
        adapter_id: "framework_adapter_express_v1",
        framework: "express",
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
        facts_emitted: 0,
        graph_nodes: 0,
        graph_edges: 0,
        diagnostics_emitted: 0,
        duration_ms: 10,
        truncated: false
      },
      completeness: []
    });

    expect(result.normalized_entrypoints).toHaveLength(1);
    expect(result.framework_capabilities[0]?.can_block).toBe(true);
  });

  it("rejects unknown framework schema versions at the engine boundary", () => {
    expect(() => EngineNormalizedEntrypointSchema.parse({
      schema_version: "engine.normalized_entrypoint.v2",
      entrypoint_id: "entrypoint_express_users_get",
      adapter_id: "framework_adapter_express_v1",
      framework: "express",
      kind: "api_route",
      file_path: "apps/api/src/routes/users.ts",
      middleware_refs: [],
      request_source_refs: [],
      response_sink_refs: [],
      data_operation_refs: [],
      confidence_label: "high",
      evidence_refs: [],
      parser_gap_ids: []
    })).toThrow();
  });

  it("rejects blocking framework capabilities unless complete", () => {
    expect(() => EngineFrameworkCapabilitySchema.parse({
      schema_version: "engine.framework.capability.v1",
      adapter_id: "framework_adapter_express_v1",
      framework: "express",
      capability: "middleware_chain_resolution",
      status: "partial",
      can_block: true,
      block_requires_accepted_convention: true,
      parser_gap_ids: ["gap_dynamic_middleware"],
      missing_proof_ids: []
    })).toThrow(/can_block requires complete framework capability/);
  });

  it("validates parser gaps and adapters as standalone engine records", () => {
    expect(EngineFrameworkAdapterSchema.parse({
      schema_version: "engine.framework.adapter.v1",
      adapter_id: "framework_adapter_custom_v1",
      framework: "custom",
      adapter_version: "0.1.0",
      package_names: [],
      entrypoint_kinds: ["api_route"],
      supported_patterns: [],
      unsupported_patterns: ["custom router factory"]
    }).framework).toBe("custom");

    expect(EngineFrameworkParserGapSchema.parse({
      schema_version: "engine.framework.parser_gap.v1",
      parser_gap_id: "gap_custom_router",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      adapter_id: "framework_adapter_custom_v1",
      framework: "custom",
      file_path: "apps/api/src/router.ts",
      code: "unsupported_framework_pattern",
      reason: "Custom router factory is not supported.",
      affected_entrypoint_ids: [],
      affected_contract_kinds: ["api_route_requires_auth_helper"],
      blocks_enforcement: true,
      suggested_next_step: "Add a deterministic custom router adapter."
    }).blocks_enforcement).toBe(true);
  });

  it("validates framework stream batch events", () => {
    const adapterEvent = parseEngineStreamEvent({
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
    });
    const entrypointEvent = parseEngineStreamEvent({
      schema_version: "engine.stream.event.v1",
      event: "normalized_entrypoint_batch",
      normalized_entrypoints: [{
        schema_version: "engine.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
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
        evidence_refs: ["fact:app/api/users/route.ts:route_declared:GET:1-3"],
        parser_gap_ids: []
      }]
    });
    const capabilityEvent = parseEngineStreamEvent({
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
    });

    expect(adapterEvent.event).toBe("framework_adapter_batch");
    expect(entrypointEvent.event).toBe("normalized_entrypoint_batch");
    expect(capabilityEvent.event).toBe("framework_capability_batch");
  });

  it("allows security proofs to reference normalized entrypoint ids", () => {
    const event = parseEngineSecurityProofEvent({
      event: "SecurityProof",
      schema_version: "engine.security.proof/v1",
      proofs: [{
        proof_id: "proof_express_users_get",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route_express_users_get",
          normalized_entrypoint_id: "entrypoint_express_users_get",
          file_path: "apps/api/src/routes/users.ts",
          file_role: "api_route",
          endpoint: {
            path: "/users",
            method: "GET",
            framework: "express"
          }
        },
        evidence_refs: [{
          evidence_id: "evidence_framework_route",
          fact_id: "fact_route_users_get",
          capability: "entrypoint_discovery",
          kind: "normalized_entrypoint",
          file_path: "apps/api/src/routes/users.ts",
          start_line: 1,
          end_line: 4,
          role: "policy"
        }],
        contracts: [],
        capability_status: [],
        auth: {
          required: false,
          proven: false,
          proof_kind: "none",
          trusted_guard_calls: [],
          dominated_sinks: [],
          undominated_sinks: []
        },
        missing_proof: [],
        parser_gaps: [],
        result: {
          proof_status: "advisory_only",
          enforcement_result: "brief",
          can_block: false,
          finding_ids: []
        }
      }]
    });

    expect(event.proofs[0]?.route.normalized_entrypoint_id).toBe("entrypoint_express_users_get");
  });
});
