import { describe, expect, it } from "vitest";
import {
  BUILTIN_SEMANTIC_CAPABILITIES,
  ArchitectureContractV1Schema,
  AgentPreflightSemanticEnvelopeSchema,
  CallResolutionRecordSchema,
  ConventionElectionContractV2Schema,
  ConventionRuleContractSchema,
  DataOperationRecordV2Schema,
  FrameworkAdapterContractV2Schema,
  ModuleResolutionRecordSchema,
  ParserGapV2Schema,
  RepoContractSchema,
  SemanticBetaProofSchema,
  SemanticCheckProofSchema,
  SemanticCoverageContractSchema,
  SemanticCapabilityContractSchema,
  SymbolIdentityV2Schema,
  validateConventionRuleCapabilities
} from "../src/index.js";

describe("semantic capabilities", () => {
  it("rejects blocking semantic capabilities without deterministic certification", () => {
    expect(() => SemanticCapabilityContractSchema.parse({
      schema_version: "drift.semantic_capability.v1",
      capability_id: "ts.computed_calls.v1",
      display_name: "Computed call resolution",
      language: "typescript",
      support: "partial",
      certification: "experimental",
      can_block: true,
      evidence_classes: ["heuristic"],
      emitted_fact_kinds: [],
      emitted_node_kinds: [],
      emitted_edge_kinds: [],
      parser_gap_kinds: ["computed_call_unresolved"],
      fixture_suites: ["ts-computed-calls"],
      required_for_beta_claims: [],
      owner: "rust_engine"
    })).toThrow("blocking semantic capabilities require certified deterministic evidence");
  });

  it("requires active convention rules to reference known semantic capabilities", () => {
    const result = validateConventionRuleCapabilities({
      rule: {
        rule_id: "api_route_no_direct_data_access",
        requires_capabilities: ["ts.static_imports.v1", "ts.missing.v1"]
      },
      capabilities: BUILTIN_SEMANTIC_CAPABILITIES
    });

    expect(result).toEqual({
      valid: false,
      missing_capabilities: ["ts.missing.v1"]
    });
  });

  it("marks the V1 route-layering capability set as blocking-safe", () => {
    const result = validateConventionRuleCapabilities({
      rule: {
        rule_id: "api_route_no_direct_data_access",
        requires_capabilities: [
          "ts.file_discovery.v1",
          "ts.syntax_facts.v1",
          "ts.static_imports.v1",
          "ts.import_resolution.v1",
          "ts.data_operations.v1",
          "ts.route_flow.v1"
        ]
      },
      capabilities: BUILTIN_SEMANTIC_CAPABILITIES
    });

    expect(result).toEqual({
      valid: true,
      missing_capabilities: []
    });
  });

  it("validates parser gap v2 semantic capability impact", () => {
    expect(ParserGapV2Schema.parse({
      schema_version: "drift.parser_gap.v2",
      parser_gap_id: "gap_dynamic_import_route_1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/users/route.ts",
      start_line: 4,
      end_line: 4,
      kind: "dynamic_import_unresolved",
      message: "Dynamic import target is not statically resolvable.",
      affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
      affected_contract_kinds: ["api_route_no_direct_data_access"],
      confidence_impact: "blocks_enforcement",
      suggested_action: "rewrite_static",
      evidence_refs: ["evidence_graph_1"]
    })).toMatchObject({
      kind: "dynamic_import_unresolved",
      affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
      confidence_impact: "blocks_enforcement"
    });
  });

  it("validates semantic coverage decisions for blocking-safe checks", () => {
    expect(SemanticCoverageContractSchema.parse({
      schema_version: "drift.semantic_coverage.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "check",
      scope_id: "check_route_no_db",
      required_capabilities: ["ts.static_imports.v1", "ts.import_resolution.v1"],
      complete_capabilities: ["ts.static_imports.v1", "ts.import_resolution.v1"],
      partial_capabilities: [],
      missing_capabilities: [],
      unsupported_capabilities: [],
      parser_gap_ids: [],
      unsupported_pattern_ids: [],
      confidence: 1,
      decision: "blocking_allowed",
      reasons: [],
      generated_at: "2026-05-28T00:00:00.000Z"
    })).toMatchObject({
      decision: "blocking_allowed",
      confidence: 1
    });
  });

  it("validates architecture role edge policies", () => {
    expect(ArchitectureContractV1Schema.parse({
      schema_version: "drift.architecture.v1",
      architecture_id: "default_ts_architecture_v1",
      repo_id: "repo_abc",
      version: "1",
      source: "default",
      roles: [{
        role: "route",
        description: "HTTP route entrypoint",
        detection: "path",
        confidence_required_for_blocking: "high"
      }],
      edge_policies: [{
        from_role: "route",
        to_role: "data_access",
        edge_kind: "imports",
        policy: "forbidden",
        required_capabilities: ["ts.import_resolution.v1"]
      }]
    })).toMatchObject({
      architecture_id: "default_ts_architecture_v1",
      edge_policies: [expect.objectContaining({ policy: "forbidden" })]
    });
  });

  it("validates convention rules bound to semantic capabilities and architecture", () => {
    expect(ConventionRuleContractSchema.parse({
      schema_version: "drift.convention_rule.v2",
      rule_id: "api_route_no_direct_data_access",
      rule_version: "1",
      convention_kind: "api_route_no_direct_data_access",
      statement: "API routes must not directly access data stores.",
      applies_to: {
        path_globs: ["app/api/**/route.ts"],
        file_roles: ["route"],
        entrypoint_kinds: ["api_route"],
        methods: ["GET"]
      },
      requires_capabilities: ["ts.static_imports.v1", "ts.import_resolution.v1", "ts.route_flow.v1"],
      architecture_contract_id: "default_ts_architecture_v1",
      matcher: { forbidden_target_roles: ["data_access"] },
      can_block_when: {
        convention_status: "active",
        coverage_decision: "blocking_allowed",
        capability_certification: "certified_deterministic"
      },
      advisory_when: ["parser_gap_lowers_flow"],
      refuse_when: ["required_capability_missing"]
    })).toMatchObject({
      schema_version: "drift.convention_rule.v2",
      can_block_when: { coverage_decision: "blocking_allowed" }
    });
  });

  it("validates audited active convention elections", () => {
    expect(ConventionElectionContractV2Schema.parse({
      schema_version: "drift.convention_election.v2",
      election_id: "election_abc",
      repo_id: "repo_abc",
      candidate_id: "candidate_abc",
      convention_id: "convention_abc",
      previous_state: "candidate",
      next_state: "active",
      decision: "activate",
      human_actor: "local-user",
      reason: "Accepted deterministic route-layering convention.",
      evidence_refs: ["evidence_1"],
      counterexample_refs: [],
      required_capabilities: ["ts.route_flow.v1"],
      semantic_coverage_id: "coverage_abc",
      architecture_contract_id: "default_ts_architecture_v1",
      convention_rule_id: "api_route_no_direct_data_access",
      contract_fingerprint_before: "0".repeat(64),
      contract_fingerprint_after: "1".repeat(64),
      audit_event_id: "audit_abc",
      can_block: true,
      created_at: "2026-05-28T00:00:00.000Z"
    })).toMatchObject({
      next_state: "active",
      can_block: true
    });
  });

  it("allows repo contracts to bind semantic and architecture contract versions", () => {
    expect(RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-28T00:00:00.000Z",
      updated_at: "2026-05-28T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: [],
      semantic_capability_contract_version: "drift.semantic_capability.v1",
      architecture_contract_id: "default_ts_architecture_v1",
      architecture_contract_fingerprint: "a".repeat(64),
      active_convention_rule_ids: ["api_route_no_direct_data_access"],
      active_semantic_capability_ids: ["ts.route_flow.v1"],
      beta_claim_profile: "narrow_route_layering",
      enforcement_policy: {
        block_on_parser_gaps: false,
        refuse_on_required_capability_missing: true,
        advisory_on_heuristic_capability: true
      }
    })).toMatchObject({
      semantic_capability_contract_version: "drift.semantic_capability.v1",
      beta_claim_profile: "narrow_route_layering"
    });
  });

  it("validates module, symbol, call, and data operation semantic records", () => {
    expect(ModuleResolutionRecordSchema.parse({
      schema_version: "drift.module_resolution.v1",
      resolution_id: "resolution_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      importer_file: "app/api/users/route.ts",
      source: "@/lib/db",
      specifier_kind: "absolute_alias",
      import_kind: "static_import",
      resolved_file_path: "src/lib/db.ts",
      status: "resolved",
      resolver_strategy: "tsconfig_paths",
      evidence_ref: "evidence_1"
    })).toMatchObject({ status: "resolved" });

    expect(SymbolIdentityV2Schema.parse({
      schema_version: "drift.symbol_identity.v2",
      symbol_id: "symbol_listUsers",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      canonical_name: "listUsers",
      declaration_file: "src/services/users.ts",
      declaration_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 },
      symbol_kind: "function",
      export_kind: "named",
      aliases: [],
      re_export_chain: [],
      reference_count: 2,
      confidence: "high",
      resolution_status: "resolved",
      parser_gap_ids: []
    })).toMatchObject({ canonical_name: "listUsers" });

    expect(CallResolutionRecordSchema.parse({
      schema_version: "drift.call_resolution.v1",
      call_id: "call_findMany",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/users/route.ts",
      span: { start_line: 4, start_column: 9, end_line: 4, end_column: 27 },
      callee_text: "db.user.findMany",
      receiver_text: "db.user",
      root_identifier: "db",
      shape: "member",
      resolved_import_id: "resolution_db",
      resolution_status: "resolved",
      confidence: "high"
    })).toMatchObject({ shape: "member" });

    expect(DataOperationRecordV2Schema.parse({
      schema_version: "drift.data_operation.v2",
      operation_id: "data_op_findMany",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/users/route.ts",
      call_id: "call_findMany",
      operation_family: "database",
      operation_kind: "read",
      receiver_root: "db",
      receiver_path: ["user"],
      store_name: "user",
      tenant_sensitive: true,
      mutation: false,
      confidence: "high",
      evidence_ref: "evidence_1",
      parser_gap_ids: []
    })).toMatchObject({ operation_kind: "read" });
  });

  it("validates framework adapter, preflight, check proof, and beta proof contracts", () => {
    expect(FrameworkAdapterContractV2Schema.parse({
      schema_version: "drift.framework_adapter.v2",
      adapter_id: "next_app_router",
      framework: "next",
      certification: "certified_deterministic",
      route_patterns_supported: ["app/api/**/route.ts"],
      unsupported_patterns: ["decorator routing"],
      emitted_entrypoint_kinds: ["api_route"],
      emitted_capabilities: ["ts.entrypoints.next.v1"],
      parser_gap_kinds: ["unsupported_framework_pattern"],
      fixture_suites: ["next-app-routes"],
      can_block: true
    })).toMatchObject({ adapter_id: "next_app_router" });

    const coverage = SemanticCoverageContractSchema.parse({
      schema_version: "drift.semantic_coverage.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "preflight",
      scope_id: "task_abc",
      required_capabilities: ["ts.route_flow.v1"],
      complete_capabilities: ["ts.route_flow.v1"],
      partial_capabilities: [],
      missing_capabilities: [],
      unsupported_capabilities: [],
      parser_gap_ids: [],
      unsupported_pattern_ids: [],
      confidence: 0.98,
      decision: "blocking_allowed",
      reasons: [],
      generated_at: "2026-05-28T00:00:00.000Z"
    });

    expect(AgentPreflightSemanticEnvelopeSchema.parse({
      schema_version: "drift.agent_preflight_semantic.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      task: "Update users route",
      decision: "safe_to_edit",
      semantic_coverage: coverage,
      parser_gaps: [],
      affected_files: ["app/api/users/route.ts"],
      affected_symbols: ["listUsers"],
      affected_routes: ["/api/users"],
      affected_data_operations: ["db.user.findMany"],
      required_checks: ["pnpm test"],
      safe_commands: ["pnpm test"],
      source_content_included: false,
      graph_context_included: true
    })).toMatchObject({ decision: "safe_to_edit" });

    expect(SemanticCheckProofSchema.parse({
      schema_version: "drift.semantic_check_proof.v1",
      check_id: "check_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      repo_contract_id: "contract_abc",
      convention_id: "convention_abc",
      convention_rule_id: "api_route_no_direct_data_access",
      semantic_coverage_id: "coverage_abc",
      architecture_contract_id: "default_ts_architecture_v1",
      required_capabilities: ["ts.route_flow.v1"],
      coverage_decision: "blocking_allowed",
      parser_gap_ids: [],
      graph_edge_ids: ["edge_1"],
      graph_node_ids: ["node_1"],
      evidence_refs: ["evidence_1"],
      result: "block"
    })).toMatchObject({ result: "block" });

    expect(SemanticBetaProofSchema.parse({
      schema_version: "drift.semantic_beta_proof.v1",
      commit_sha: "abc123",
      semantic_capability_contracts_verified: true,
      architecture_contract_verified: true,
      convention_election_contract_verified: true,
      repo_contract_materialization_verified: true,
      cli_mcp_semantic_parity_verified: true,
      unsupported_pattern_visibility_verified: true,
      blocking_safety_verified: true,
      claim_gate_verified: true,
      partial_beta_required_count: 0,
      unsupported_beta_required_count: 0,
      evidence: {}
    })).toMatchObject({ claim_gate_verified: true });
  });
});
