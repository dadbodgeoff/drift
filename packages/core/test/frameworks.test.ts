import { describe, expect, it } from "vitest";
import {
  FrameworkAdapterSchema,
  FrameworkCapabilitySchema,
  FrameworkConventionCandidateSchema,
  FrameworkElectionSchema,
  FrameworkEntrypointReadModelSchema,
  FrameworkParserGapSchema,
  NormalizedEntrypointFactSchema,
  SubdirectoryConventionSchema
} from "../src/index.js";

const evidenceRef = {
  id: "evidence_framework_route",
  kind: "supporting",
  file_path: "apps/api/src/routes/users.ts",
  start_line: 4,
  end_line: 8,
  fact_ids: ["fact_route_users_get"],
  scan_id: "scan_framework",
  file_hash: "hash_users_route",
  redaction_state: "none"
} as const;

describe("framework product schemas", () => {
  it("validates framework adapter records with explicit capabilities", () => {
    const adapter = FrameworkAdapterSchema.parse({
      schema_version: "drift.framework.adapter.v1",
      adapter_id: "framework_adapter_express_v1",
      framework: "express",
      adapter_version: "0.1.0",
      package_names: ["express"],
      entrypoint_kinds: ["api_route", "webhook_handler"],
      supported_patterns: ["app.get(path, ...middleware, handler)"],
      unsupported_patterns: ["dynamic route registration loops"],
      capabilities: [{
        schema_version: "drift.framework.capability.v1",
        adapter_id: "framework_adapter_express_v1",
        framework: "express",
        capability: "entrypoint_discovery",
        status: "complete",
        can_block: true,
        block_requires_accepted_convention: true,
        parser_gap_ids: [],
        missing_proof_ids: []
      }]
    });

    expect(adapter.framework).toBe("express");
    expect(adapter.capabilities[0]?.can_block).toBe(true);
  });

  it("rejects blocking framework capabilities unless the capability is complete", () => {
    expect(() => FrameworkCapabilitySchema.parse({
      schema_version: "drift.framework.capability.v1",
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

  it("validates normalized entrypoint facts without source snippets", () => {
    const entrypoint = NormalizedEntrypointFactSchema.parse({
      schema_version: "drift.normalized_entrypoint.v1",
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
      package_name: "@acme/api",
      subdirectory_role: "api",
      middleware_refs: ["fact_require_user"],
      request_source_refs: ["fact_request_query"],
      response_sink_refs: ["fact_response_json"],
      data_operation_refs: ["fact_user_find_many"],
      confidence_label: "high",
      evidence_refs: ["evidence_framework_route"],
      parser_gap_ids: []
    });

    expect(entrypoint).toMatchObject({
      framework: "express",
      route_pattern: "/users",
      method: "GET"
    });
    expect(JSON.stringify(entrypoint)).not.toContain("const users");
  });

  it("rejects unsafe subdirectory convention path globs", () => {
    expect(() => SubdirectoryConventionSchema.parse({
      kind: "subdirectory_convention",
      id: "subdir_api",
      version: 1,
      path_globs: ["/absolute/path"],
      roles: [{
        role: "api_route",
        path_globs: ["apps/api/src/routes/**"],
        framework_tags: ["express"],
        entrypoint_kinds: ["api_route"]
      }],
      enforcement: "advisory"
    })).toThrow(/pattern must be repo-relative/);
  });

  it("validates framework parser gaps as first-class product output", () => {
    const gap = FrameworkParserGapSchema.parse({
      schema_version: "drift.framework.parser_gap.v1",
      parser_gap_id: "framework_gap_dynamic_router",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      adapter_id: "framework_adapter_express_v1",
      framework: "express",
      file_path: "apps/api/src/routes/index.ts",
      start_line: 12,
      end_line: 14,
      code: "dynamic_router_registration",
      reason: "Route path is computed inside a loop.",
      affected_entrypoint_ids: [],
      affected_contract_kinds: ["api_route_requires_auth_helper"],
      blocks_enforcement: true,
      suggested_next_step: "Add an explicit route contract or keep this convention advisory."
    });

    expect(gap.blocks_enforcement).toBe(true);
  });

  it("rejects blocking framework candidates that are not deterministic", () => {
    expect(() => FrameworkConventionCandidateSchema.parse({
      schema_version: "drift.framework.convention_candidate.v1",
      id: "candidate_framework_custom",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      kind: "framework_adapter_enabled",
      framework: "custom",
      adapter_id: "framework_adapter_custom_v1",
      scope: {
        path_globs: ["apps/api/src/**"],
        entrypoint_kinds: ["api_route"]
      },
      suggested_enforcement_mode: "block",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      evidence_refs: [evidenceRef],
      counterexample_refs: [],
      cannot_block_reason: "Custom router support is heuristic."
    })).toThrow(/blocking framework candidates require deterministic capability/);
  });

  it("validates framework elections and read models for CLI/MCP reuse", () => {
    const election = FrameworkElectionSchema.parse({
      schema_version: "drift.framework.election.v1",
      election_id: "election_framework_express",
      repo_id: "repo_framework",
      candidate_id: "candidate_framework_express",
      decision: "accepted",
      actor: "test",
      decided_at: "2026-05-27T00:00:00.000Z",
      accepted_contract_ids: ["contract_framework_express_auth"],
      evidence_refs: ["evidence_framework_route"]
    });

    const readModel = FrameworkEntrypointReadModelSchema.parse({
      schema_version: "drift.framework_entrypoints.read_model.v1",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      summary: {
        entrypoint_count: 1,
        supported_count: 1,
        parser_gap_count: 0,
        unsupported_count: 0,
        blocking_gap_count: 0
      },
      by_framework: [{
        framework: "express",
        adapter_id: "framework_adapter_express_v1",
        entrypoint_count: 1,
        capability_status: "complete",
        can_block: true
      }],
      entrypoints: [{
        entrypoint_id: "entrypoint_express_users_get",
        framework: "express",
        kind: "api_route",
        file_path: "apps/api/src/routes/users.ts",
        route_pattern: "/users",
        method: "GET",
        proof_status: "proven",
        parser_gap_codes: []
      }]
    });

    expect(election.decision).toBe("accepted");
    expect(readModel.by_framework[0]?.framework).toBe("express");
  });
});
