import { describe, expect, it } from "vitest";
import { buildFrameworkEntrypointReadModel } from "../src/index.js";

describe("framework entrypoint read model", () => {
  it("groups normalized entrypoints by framework with parser gap and capability summaries", () => {
    const model = buildFrameworkEntrypointReadModel({
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      entrypoints: [{
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint_express_users_get",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
        adapter_id: "framework_adapter_express_v1",
        framework: "express",
        kind: "api_route",
        file_path: "apps/api/src/routes/users.ts",
        route_pattern: "/users",
        method: "GET",
        middleware_refs: ["fact_require_user"],
        request_source_refs: [],
        response_sink_refs: ["fact_response_json"],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["evidence_framework_route"],
        parser_gap_ids: []
      }, {
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint_custom_router",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
        adapter_id: "framework_adapter_custom_v1",
        framework: "custom",
        kind: "api_route",
        file_path: "apps/api/src/custom-router.ts",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "heuristic",
        evidence_refs: ["evidence_custom_router"],
        parser_gap_ids: ["framework_gap_custom_router"]
      }],
      parser_gaps: [{
        schema_version: "drift.framework.parser_gap.v1",
        parser_gap_id: "framework_gap_custom_router",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
        adapter_id: "framework_adapter_custom_v1",
        framework: "custom",
        file_path: "apps/api/src/custom-router.ts",
        code: "unsupported_framework_pattern",
        reason: "Custom router factory is not supported.",
        affected_entrypoint_ids: ["entrypoint_custom_router"],
        affected_contract_kinds: ["api_route_requires_auth_helper"],
        blocks_enforcement: true,
        suggested_next_step: "Keep this framework advisory or add a deterministic adapter."
      }],
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
      }, {
        schema_version: "drift.framework.capability.v1",
        adapter_id: "framework_adapter_custom_v1",
        framework: "custom",
        capability: "entrypoint_discovery",
        status: "unsupported",
        can_block: false,
        block_requires_accepted_convention: true,
        parser_gap_ids: ["framework_gap_custom_router"],
        missing_proof_ids: []
      }],
      proof_status_by_entrypoint_id: new Map([
        ["entrypoint_express_users_get", "proven"],
        ["entrypoint_custom_router", "parser_gap"]
      ])
    });

    expect(model.summary).toEqual({
      entrypoint_count: 2,
      supported_count: 1,
      parser_gap_count: 1,
      unsupported_count: 1,
      blocking_gap_count: 1
    });
    expect(model.by_framework).toEqual([{
      framework: "custom",
      adapter_id: "framework_adapter_custom_v1",
      entrypoint_count: 1,
      capability_status: "unsupported",
      can_block: false
    }, {
      framework: "express",
      adapter_id: "framework_adapter_express_v1",
      entrypoint_count: 1,
      capability_status: "complete",
      can_block: true
    }]);
    expect(model.entrypoints[0]).toMatchObject({
      entrypoint_id: "entrypoint_custom_router",
      parser_gap_codes: ["unsupported_framework_pattern"],
      proof_status: "parser_gap"
    });
    expect(JSON.stringify(model)).not.toContain("app.get");
  });
});
