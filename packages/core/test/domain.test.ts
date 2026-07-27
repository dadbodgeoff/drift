import { describe, expect, it } from "vitest";
import * as coreExports from "../src/index.js";
import {
  AcceptedConventionSchema,
  AgentContractSchema,
  AgentContractSelectionSchema,
  AgentPreflightPacketV2Schema,
  AgentPreflightPacketSchema,
  AgentTaskSchema,
  AuditEventSchema,
  ContractFindingV2Schema,
  ContextPolicyMatrixSchema,
  DRIFT_CONTRACT_SCHEMA_VERSION,
  DRIFT_RESOLVER_VERSION,
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION,
  EntrypointFlowProofSchema,
  EntrypointFactSchema,
  FactRecordSchema,
  FileRoleSchema,
  FindingSchema,
  HelperSimilarityEvidenceSchema,
  LayerArchitectureContractSchema,
  ParserGapSchema,
  RepoContractSchema,
  RequiredCheckExecutionSchema,
  SymbolIdentitySchema,
  ChangeImpactSchema,
  TestIntelligenceSchema,
  authorizeContextExport,
  canonicalRepoContractJson,
  canonicalScanStateJson,
  createContextPolicyMatrix,
  createAgentPreflightPacket,
  createAgentEnvelopeV2,
  createContractParityLedger,
  createPolicyProof,
  makeDriftId
} from "../src/index.js";

describe("core domain", () => {
  it("creates stable prefixed ids", () => {
    expect(makeDriftId("convention", "abc123")).toBe("convention_abc123");
  });

  it("exports shared scanner and rule versions for all local surfaces", () => {
    expect(DRIFT_SCANNER_VERSION).toBe("0.1.0");
    expect(DRIFT_TYPESCRIPT_ADAPTER_VERSION).toBe("0.1.0");
    expect(DRIFT_RULE_ENGINE_VERSION).toBe("0.1.0");
    expect(DRIFT_RESOLVER_VERSION).toBe("0.1.0");
    expect(DRIFT_CONTRACT_SCHEMA_VERSION).toBe(1);
  });

  it("validates fact quality provenance on parsed facts", () => {
    expect(FactRecordSchema.parse({
      id: "fact_route_users_get",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "route_declared",
      file_path: "app/api/users/route.ts",
      name: "GET /api/users",
      value: "/api/users",
      start_line: 1,
      end_line: 3,
      source_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 },
      ast_node_kind: "ExportedFunction",
      extraction_method: "next_app_router_parser",
      extractor_version: "0.1.0",
      parser_version: "0.1.0",
      confidence: 0.98,
      confidence_label: "high",
      evidence_level: "ast",
      resolution_status: "resolved",
      staleness_status: "fresh",
      last_seen_scan_id: "scan_abc"
    })).toMatchObject({
      confidence_label: "high",
      resolution_status: "resolved",
      evidence_level: "ast"
    });
  });

  it("rejects parsed facts without extraction provenance", () => {
    expect(() => FactRecordSchema.parse({
      id: "fact_missing_provenance",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "route_declared",
      file_path: "app/api/users/route.ts",
      name: "GET",
      start_line: 1,
      end_line: 1
    })).toThrow();
  });

  it("validates parser gaps with confidence impact", () => {
    expect(ParserGapSchema.parse({
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_unresolved_users",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "unresolved_import",
      file_path: "app/api/users/route.ts",
      start_line: 2,
      end_line: 2,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:00:00.000Z"
    })).toMatchObject({
      kind: "unresolved_import",
      confidence_impact: "lowers_flow"
    });
  });

  it("validates scan capability reports as first-class scan proof", () => {
    const schema = (coreExports as {
      ScanCapabilityReportSchema?: { parse(input: unknown): unknown };
    }).ScanCapabilityReportSchema;

    expect(schema).toBeDefined();
    expect(schema!.parse({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_source: "rust",
      engine_version: "0.1.0",
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "fact_graph"],
      required_capabilities: ["file_discovery", "fact_graph"],
      missing_capabilities: [],
      completeness: [{
        scope: "repo",
        complete: true,
        can_block: true,
        reasons: []
      }],
      parser_gap_count: 1,
      parser_gap_kinds: { unresolved_import: 1 },
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-05-25T00:00:00.000Z"
    })).toMatchObject({
      schema_version: "drift.scan_capability_report.v1",
      scan_id: "scan_abc",
      certified_capabilities: ["file_discovery", "syntax_facts", "fact_graph"],
      parser_gap_kinds: { unresolved_import: 1 }
    });
  });

  it("validates machine contract version bindings", () => {
    const schema = (coreExports as {
      MachineContractVersionsSchema?: { parse(input: unknown): unknown };
    }).MachineContractVersionsSchema;

    expect(schema).toBeDefined();
    expect(schema!.parse({
      schema_version: "drift.machine_contract_versions.v1",
      cli_version: "0.1.0",
      core_version: "0.1.0",
      storage_schema_version: 23,
      contract_schema_version: 1,
      engine_contract_versions: {
        scan_request: "engine.scan.request.v1",
        scan_result: "engine.scan.result.v1",
        check_request: "engine.check.request.v1",
        check_result: "engine.check.result.v1",
        candidates_result: "engine.candidates.result.v1",
        stream_event: "engine.stream.event.v1"
      },
      factgraph_schema_version: "factgraph.v2",
      scanner_version: "0.1.0",
      rule_engine_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" }
    })).toMatchObject({
      schema_version: "drift.machine_contract_versions.v1",
      engine_contract_versions: {
        check_result: "engine.check.result.v1"
      },
      factgraph_schema_version: "factgraph.v2"
    });
  });

  it("validates layer architecture contracts", () => {
    expect(LayerArchitectureContractSchema.parse({
      schema_version: "drift.layer_architecture.v1",
      architecture_id: "architecture_api_layering",
      repo_id: "repo_abc",
      version: 1,
      layers: [
        { id: "route", role: "route", position: "entrypoint" },
        { id: "service", role: "service", position: "middle" },
        { id: "data_access", role: "data_access", position: "terminal" }
      ],
      allowed_edges: [
        { from_layer: "route", to_layer: "service" },
        { from_layer: "service", to_layer: "data_access" }
      ],
      forbidden_edges: [{ from_layer: "route", to_layer: "data_access" }],
      soft_edges: [{ from_layer: "route", to_layer: "auth", reason: "auth-sensitive routes should authenticate first" }]
    })).toMatchObject({
      schema_version: "drift.layer_architecture.v1",
      layers: expect.arrayContaining([expect.objectContaining({ role: "route" })])
    });
  });

  it("validates typed entrypoint facts", () => {
    expect(EntrypointFactSchema.parse({
      schema_version: "drift.entrypoint_fact.v1",
      entrypoint_id: "entrypoint_api_users_get",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route",
      file_path: "app/api/users/route.ts",
      symbol: "GET",
      route_pattern: "/api/users",
      method: "GET",
      adapter_id: "next_app_router",
      confidence_label: "certain",
      evidence_refs: ["fact_route_users_get"]
    })).toMatchObject({ kind: "api_route" });
  });

  it("validates symbol identity, change impact, and test intelligence contracts", () => {
    expect(SymbolIdentitySchema.parse({
      schema_version: "drift.symbol_identity.v1",
      symbol_id: "symbol_users_get",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      symbol_name: "getUserById",
      kind: "function",
      declared_in: "server/services/users.ts",
      exported_from: ["server/services/users.ts", "server/services/index.ts"],
      imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }],
      re_export_chain: ["server/services/index.ts"],
      canonical_definition: "server/services/users.ts#getUserById",
      call_sites: [{ file_path: "app/api/users/route.ts", start_line: 4, end_line: 4 }],
      references: [{ file_path: "app/api/users/route.ts", start_line: 1, end_line: 1 }],
      visibility: "exported"
    })).toMatchObject({ canonical_definition: "server/services/users.ts#getUserById" });

    expect(ChangeImpactSchema.parse({
      schema_version: "drift.change_impact.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      changed_files: ["server/repositories/users.ts"],
      changed_symbols: ["findMany"],
      changed_routes: [],
      changed_tests: [],
      changed_contract_surfaces: ["data_access"],
      affected_routes: ["GET /api/users"],
      affected_services: ["server/services/users.ts"],
      affected_data_ops: ["prisma.user.findMany"],
      affected_tests: ["server/services/users.test.ts"],
      affected_callers: ["server/services/users.ts"],
      affected_importers: ["server/services/users.ts"],
      missing_test_candidates: []
    })).toMatchObject({ affected_routes: ["GET /api/users"] });

    expect(TestIntelligenceSchema.parse({
      schema_version: "drift.test_intelligence.v1",
      test_subject: "server/services/users.ts",
      test_type: "unit",
      test_framework: "vitest",
      test_file_for: ["server/services/users.ts"],
      covered_symbols: ["listUsers"],
      covered_routes: ["GET /api/users"],
      mocked_dependencies: ["server/repositories/users.ts"],
      fixture_usage: [],
      snapshot_usage: false,
      missing_test_candidate: false,
      stale_test_candidate: false
    })).toMatchObject({ test_framework: "vitest" });
  });

  it("creates deterministic agent envelope actions", () => {
    expect(createAgentEnvelopeV2({
      surface: "cli-preflight",
      policy: { allowed: true, surface: "cli-preflight" },
      scan: { required_fresh: false, stale: false, latest_scan_id: "scan_abc" }
    }).action).toBe("safe_to_edit");
    expect(createAgentEnvelopeV2({
      surface: "cli-preflight",
      policy: { allowed: true, surface: "cli-preflight" },
      scan: { required_fresh: false, stale: true, latest_scan_id: null }
    }).action).toBe("run_scan_first");
    expect(createAgentEnvelopeV2({
      surface: "cli-preflight",
      policy: { allowed: true, surface: "cli-preflight" },
      scan: { required_fresh: true, stale: true, latest_scan_id: "scan_abc" }
    }).action).toBe("blocked_by_stale_graph");
    expect(createAgentEnvelopeV2({
      surface: "cli-preflight",
      policy: { allowed: false, surface: "cli-preflight", reason: "denied" }
    }).action).toBe("blocked_by_policy");
    expect(createAgentEnvelopeV2({
      surface: "cli-preflight",
      policy: { allowed: true, surface: "cli-preflight" },
      scan: { required_fresh: false, stale: false, latest_scan_id: "scan_abc" },
      redactions: { snippets_included: false, context_truncated: true }
    }).action).toBe("context_truncated");
  });

  it("creates policy proof metadata for agent-facing egress", () => {
    const proof = createPolicyProof({
      allowed: true,
      surface: "cli-preflight",
      mode: "redacted",
      reason: "requested snippet length exceeds repo policy and was capped",
      max_snippet_chars: 1200,
      approved_snippet_chars: 1200
    }, {
      snippetsIncluded: true,
      sourceContentIncluded: false,
      contextTruncated: true
    });

    expect(proof).toEqual({
      schema_version: "policy.proof.v1",
      surface: "cli-preflight",
      allowed: true,
      mode: "redacted",
      reason: "requested snippet length exceeds repo policy and was capped",
      max_snippet_chars: 1200,
      approved_snippet_chars: 1200,
      snippets_included: true,
      source_content_included: false,
      context_truncated: true,
      redaction_state: "snippet_limited"
    });
  });

  it("accepts deterministic package and module role names", () => {
    expect(FileRoleSchema.parse("cli_command_module")).toBe("cli_command_module");
    expect(FileRoleSchema.parse("core_module")).toBe("core_module");
    expect(FileRoleSchema.parse("query_module")).toBe("query_module");
    expect(FileRoleSchema.parse("factgraph_module")).toBe("factgraph_module");
    expect(FileRoleSchema.parse("adapter_module")).toBe("adapter_module");
    expect(FileRoleSchema.parse("storage_module")).toBe("storage_module");
    expect(FileRoleSchema.parse("engine_bridge_module")).toBe("engine_bridge_module");
    expect(FileRoleSchema.parse("mcp_module")).toBe("mcp_module");
    expect(FileRoleSchema.parse("package_manifest")).toBe("package_manifest");
  });

  it("validates accepted deterministic conventions", () => {
    const convention = AcceptedConventionSchema.parse({
      id: "convention_abc",
      contract_id: "contract_abc",
      kind: "api_route_no_direct_data_access",
      statement: "API routes must not import direct data-access clients.",
      scope: { path_globs: ["app/api/**/*.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: ["@/db", "@/prisma", "prisma"],
        applies_to_file_roles: ["api_route"]
      },
      severity: "error",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });

    expect(convention.kind).toBe("api_route_no_direct_data_access");
  });

  it("validates agent contract intelligence definitions", () => {
    const placement = AgentContractSchema.parse({
      kind: "module_placement",
      id: "agent_contract_placement_api_routes",
      version: 1,
      statement: "API route files are entrypoints and must not contain data access modules.",
      target_role: "api_route",
      allowed_paths: ["app/api/**/route.ts", "pages/api/**/*.ts"],
      forbidden_contained_roles: ["data_access_module"],
      enforcement: "blocking"
    });
    expect(placement.kind).toBe("module_placement");

    const helperReuse = AgentContractSchema.parse({
      kind: "canonical_helper_reuse",
      id: "agent_contract_auth_helper",
      version: 1,
      canonical_helpers: [{
        helper_id: "helper_require_user",
        symbol: "requireUser",
        module: "@/server/auth/require-user",
        applies_to_roles: ["api_route"],
        purpose_tags: ["auth", "current-user"],
        avoid_new_symbols_matching: ["getCurrentUser", "authUser"],
        suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
      }],
      enforcement: "advisory"
    });
    expect(helperReuse.kind).toBe("canonical_helper_reuse");

    const flow = AgentContractSchema.parse({
      kind: "entrypoint_flow",
      id: "agent_contract_route_flow",
      version: 1,
      entry_roles: ["api_route"],
      required_steps: [
        { kind: "auth_helper", calls: ["requireUser"] },
        { kind: "service_delegation", target_roles: ["service_module"] }
      ],
      forbidden_steps: [{ kind: "direct_data_access" }],
      enforcement: "blocking"
    });
    expect(flow.required_steps).toHaveLength(2);

    const checks = AgentContractSchema.parse({
      kind: "required_change_checks",
      id: "agent_contract_route_checks",
      version: 1,
      rules: [{
        applies_to: { file_roles: ["api_route"], path_globs: ["app/api/**/route.ts"] },
        required_checks: [{
          command: "drift check --scope changed-files --json",
          reason: "API route changes must be checked against accepted route contracts.",
          required_for_release: true
        }]
      }]
    });
    expect(checks.kind).toBe("required_change_checks");
  });

  it("rejects unsafe agent contract selectors", () => {
    expect(() => AgentContractSchema.parse({
      kind: "module_placement",
      id: "agent_contract_bad",
      version: 1,
      statement: "bad",
      target_role: "service_module",
      allowed_paths: ["../outside"],
      enforcement: "blocking"
    })).toThrow();

    expect(() => AgentContractSchema.parse({
      kind: "canonical_helper_reuse",
      id: "agent_contract_bad_helper",
      version: 1,
      canonical_helpers: [{
        helper_id: "helper_bad",
        symbol: "requireUser",
        module: "@/server/auth/require-user",
        purpose_tags: [],
        suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
      }],
      enforcement: "advisory"
    })).toThrow();
  });

  it("validates agent contract selection and preflight packet contracts", () => {
    const selection = AgentContractSelectionSchema.parse({
      schema_version: "drift.agent.contract_selection.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      selected_contract_ids: ["agent_contract_auth_helper"],
      selected_convention_ids: ["convention_direct_db"],
      selected_helper_ids: ["helper_require_user"],
      selected_required_checks: ["drift check --scope changed-files --json"],
      selection_inputs: {
        task_text: "add auth to the users route",
        explicit_paths: ["app/api/users/route.ts"],
        changed_paths: [],
        file_roles: ["api_route"],
        graph_node_ids: ["file:app/api/users/route.ts"]
      },
      reasons: [{
        target_id: "agent_contract_auth_helper",
        reason: "task_text_match",
        evidence_refs: ["evidence_task_auth"]
      }]
    });
    expect(selection.reasons[0]?.reason).toBe("task_text_match");

    const packet = AgentPreflightPacketSchema.parse({
      schema_version: "drift.agent.preflight.v3",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      stale: false,
      task: "add auth to the users route",
      selected_contracts: [],
      selected_conventions: [],
      selected_helpers: [{
        symbol: "requireUser",
        module: "@/server/auth/require-user",
        suggested_import: "import { requireUser } from \"@/server/auth/require-user\";",
        purpose_tags: ["auth"]
      }],
      placement_guidance: [{
        role: "api_route",
        allowed_paths: ["app/api/**/route.ts"],
        forbidden_paths: ["app/api/**/helpers.ts"]
      }],
      import_boundaries: [],
      required_flows: [],
      required_checks: [{
        command: "drift check --scope changed-files --json",
        reason: "API route changes must be checked."
      }],
      active_exceptions: [],
      active_waivers: [],
      agent_instructions: ["Use requireUser from @/server/auth/require-user."],
      diagnostics: []
    });
    expect(packet.selected_helpers[0]?.symbol).toBe("requireUser");
  });

  it("validates task-aware preflight packets", () => {
    const taskModel = AgentTaskSchema.parse({
      schema_version: "drift.agent_task.v1",
      task_id: "agent_task_users_filter",
      task_text: "add filtering to users endpoint",
      task_intent: "feature",
      target_area: "user_management",
      likely_files: ["**/app/api/**/route.ts"],
      likely_entrypoint_kinds: ["api_route"],
      required_context: ["accepted_conventions", "change_impact", "repo_map"],
      risky_contracts: ["api_route_no_direct_data_access"],
      required_checks: ["drift check --scope changed-hunks"],
      forbidden_actions: ["create_waiver", "modify_repo_contract"],
      human_approval_needed: false
    });
    const contextPolicy = ContextPolicyMatrixSchema.parse({
      schema_version: "drift.context_policy.v1",
      can_read_repo_map: true,
      can_read_source_snippets: false,
      can_read_contract: true,
      can_read_findings: true,
      can_execute_commands: false,
      can_modify_contract: false,
      can_create_waiver: false,
      can_request_human_approval: true,
      can_access_secret_like_files: false,
      can_emit_patch: false,
      egress_level: "symbol_only"
    });
    const changeImpact = ChangeImpactSchema.parse({
      schema_version: "drift.change_impact.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      changed_files: ["app/api/users/route.ts"],
      changed_symbols: [],
      changed_routes: ["app/api/users/route.ts"],
      changed_tests: [],
      changed_contract_surfaces: ["entrypoint"],
      affected_routes: ["GET /api/users"],
      affected_services: [],
      affected_data_ops: [],
      affected_tests: [],
      affected_callers: [],
      affected_importers: [],
      missing_test_candidates: ["GET /api/users"]
    });
    const legacyPacket = AgentPreflightPacketSchema.parse({
      schema_version: "drift.agent.preflight.v3",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      stale: false,
      task: "add filtering to users endpoint",
      selected_contracts: [],
      selected_conventions: [],
      selected_helpers: [],
      placement_guidance: [],
      import_boundaries: [],
      required_flows: [],
      required_checks: [],
      active_exceptions: [],
      active_waivers: [],
      agent_instructions: [],
      diagnostics: []
    });

    expect(AgentPreflightPacketV2Schema.parse({
      schema_version: "drift.agent_preflight.v2",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      task_model: taskModel,
      repo_map_summary: {
        relevant_file_count: 1,
        route_flow_count: 1,
        parser_gap_count: 0
      },
      accepted_conventions: [],
      relevant_files: [],
      role_layer_proof: [],
      change_impact: changeImpact,
      test_intelligence: [],
      parser_gaps: [],
      required_checks: [],
      forbidden_actions: ["create_waiver", "modify_repo_contract"],
      context_policy: contextPolicy,
      confidence: {
        graph_confidence: 0.92,
        reasons: []
      },
      legacy_packet: legacyPacket
    })).toMatchObject({ schema_version: "drift.agent_preflight.v2" });
  });

  it("derives an agent-safe context policy matrix", () => {
    const contract = RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*", "**/*.pem"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    });
    const decision = authorizeContextExport(contract, "cli-preflight", {
      path: "apps/web/app/api/users/route.ts"
    });

    expect(createContextPolicyMatrix(contract, decision)).toMatchObject({
      can_read_repo_map: true,
      can_read_source_snippets: false,
      can_read_contract: true,
      can_read_findings: true,
      can_execute_commands: false,
      can_modify_contract: false,
      can_create_waiver: false,
      can_request_human_approval: true,
      can_access_secret_like_files: false,
      can_emit_patch: false,
      egress_level: "symbol_only"
    });
  });

  it("validates evidence-complete contract findings", () => {
    const finding = ContractFindingV2Schema.parse({
      schema_version: "drift.finding.v2",
      finding_id: "finding_duplicate_helper",
      contract_id: "agent_contract_auth_helper",
      kind: "canonical_helper_reuse",
      severity: "warning",
      status: "advisory",
      file_path: "app/api/users/auth.ts",
      range: { start_line: 1, end_line: 12 },
      expected: "Use requireUser from @/server/auth/require-user.",
      actual: "New helper getCurrentUser was introduced inside the API route tree.",
      evidence_refs: ["evidence_export_getCurrentUser", "evidence_helper_requireUser"],
      graph_path: ["file:app/api/users/auth.ts", "symbol:getCurrentUser"],
      suggested_fix: "Import requireUser instead of creating getCurrentUser.",
      diagnostics: []
    });
    expect(finding.status).toBe("advisory");
  });

  it("validates finding confidence and drift category", () => {
    expect(FindingSchema.parse({
      id: "finding_release_blocking",
      repo_id: "repo_abc",
      convention_id: "agent_contract_api_flow",
      fingerprint: "finding-fp",
      title: "API flow regressed",
      message: "Route bypasses the accepted service layer.",
      severity: "release_blocking",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      confidence_label: "certain",
      drift_category: "new_violation",
      introduced_by_diff: true,
      affected_contract: "agent_contract_api_flow",
      created_at: "2026-05-24T00:00:00.000Z"
    })).toMatchObject({
      severity: "release_blocking",
      drift_category: "new_violation"
    });
  });

  it("validates audit events with before and after object hashes", () => {
    expect(AuditEventSchema.parse({
      id: "audit_1",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "repo_contract",
      target_id: "contract_abc",
      metadata: {},
      before_hash: "0".repeat(64),
      after_hash: "1".repeat(64),
      object_schema_version: "drift.repo_contract.v1",
      created_at: "2026-05-24T00:00:00.000Z"
    })).toMatchObject({
      before_hash: "0".repeat(64),
      after_hash: "1".repeat(64)
    });
  });

  it("reports contract parity for all canonical contracts", () => {
    const ledger = createContractParityLedger();

    expect(ledger.contracts.map((contract) => contract.name)).toEqual([
      "ParsedFactContract",
      "FactQualityContract",
      "GraphContract",
      "ScanStatusContract",
      "SemanticCapabilityContract",
      "RoleOntologyContract",
      "LayerArchitectureContract",
      "AdapterContract",
      "DataOperationContract",
      "EntrypointContract",
      "SymbolIdentityContract",
      "ChangeImpactContract",
      "TestIntelligenceContract",
      "ConventionElectionContract",
      "RepoContract",
      "RuleContract",
      "FindingContract",
      "WaiverContract",
      "BaselineContract",
      "CheckProofContract",
      "AgentTaskContract",
      "AgentPreflightContract",
      "ContextPolicyContract",
      "AuditContract",
      "ReleaseProofContract"
    ]);
    expect(ledger.summary.not_implemented_count).toBe(0);
    expect(ledger.summary.missing_count).toBe(0);
    expect(ledger.summary.partial_beta_required_count).toBe(0);
  });

  it("builds deterministic agent preflight packets from repo contracts", () => {
    const contract = RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [{
        id: "convention_no_direct_db",
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        statement: "API routes must not import direct data-access clients.",
        scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route"] },
        matcher: {
          kind: "api_route_no_direct_data_access",
          forbidden_target_roles: ["data_access_module"],
          allowed_delegate_imports: ["@/server/services"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "local-user",
        accepted_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z"
      }],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      agent_contracts: [
        {
          kind: "canonical_helper_reuse",
          id: "agent_contract_auth_helper",
          version: 1,
          canonical_helpers: [{
            helper_id: "helper_require_user",
            symbol: "requireUser",
            module: "@/server/auth/require-user",
            applies_to_roles: ["api_route"],
            purpose_tags: ["auth", "current-user"],
            suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
          }],
          enforcement: "advisory"
        },
        {
          kind: "entrypoint_flow",
          id: "agent_contract_route_flow",
          version: 1,
          entry_roles: ["api_route"],
          required_steps: [
            { kind: "auth_helper", calls: ["requireUser"] },
            { kind: "service_delegation", target_roles: ["service_module"] }
          ],
          forbidden_steps: [{ kind: "direct_data_access" }],
          enforcement: "blocking"
        },
        {
          kind: "required_change_checks",
          id: "agent_contract_route_checks",
          version: 1,
          rules: [{
            applies_to: { file_roles: ["api_route"], path_globs: ["app/api/**/route.ts"] },
            required_checks: [{
              command: "drift check --scope changed-files --json",
              reason: "API route changes must be checked against accepted route contracts.",
              required_for_release: true
            }]
          }]
        }
      ],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*", "**/*.pem"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    });

    const packet = createAgentPreflightPacket({
      repoContract: contract,
      task: "add auth to the users route",
      scan_id: "scan_abc",
      stale: false,
      explicit_paths: ["app/api/users/route.ts"],
      changed_paths: [],
      file_roles: ["api_route"],
      graph_node_ids: ["file:app/api/users/route.ts"]
    });

    expect(packet.selected_contracts.map((entry) => entry.id)).toEqual([
      "agent_contract_auth_helper",
      "agent_contract_route_checks",
      "agent_contract_route_flow"
    ]);
    expect(packet.selected_conventions.map((entry) => entry.id)).toEqual(["convention_no_direct_db"]);
    expect(packet.selected_helpers).toEqual([{
      symbol: "requireUser",
      module: "@/server/auth/require-user",
      suggested_import: "import { requireUser } from \"@/server/auth/require-user\";",
      purpose_tags: ["auth", "current-user"]
    }]);
    expect(packet.required_checks).toEqual([{
      command: "drift check --scope changed-files --json",
      reason: "API route changes must be checked against accepted route contracts."
    }]);
    expect(packet.agent_instructions).toContain("Use requireUser from @/server/auth/require-user.");
  });

  it("validates repo contracts and findings", () => {
    expect(() => RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*", "**/*.pem"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    })).not.toThrow();

    expect(FindingSchema.parse({
      id: "finding_abc",
      repo_id: "repo_abc",
      convention_id: "convention_abc",
      fingerprint: "fp",
      title: "API route imports database client directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:00.000Z"
    }).diff_status).toBe("new_in_diff");
  });

  it("canonicalizes repo contracts independent of unordered list order", () => {
    const baseContract = RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [
        { candidate_id: "candidate_b", reason: "b", rejected_by: "local-user", rejected_at: "2026-05-10T00:00:00.000Z" },
        { candidate_id: "candidate_a", reason: "a", rejected_by: "local-user", rejected_at: "2026-05-10T00:00:00.000Z" }
      ],
      waivers: [
        { id: "waiver_b", reason: "b", path_globs: ["b/**"], created_by: "local-user", created_at: "2026-05-10T00:00:00.000Z" },
        { id: "waiver_a", reason: "a", path_globs: ["a/**"], created_by: "local-user", created_at: "2026-05-10T00:00:00.000Z" }
      ],
      risky_areas: [
        { id: "risk_b", path_globs: ["b/**"], risk_kind: "billing", reason: "b" },
        { id: "risk_a", path_globs: ["a/**"], risk_kind: "auth", reason: "a" }
      ],
      agent_contracts: [
        {
          kind: "module_placement",
          id: "agent_contract_b",
          version: 1,
          statement: "Service modules live under server services.",
          target_role: "service_module",
          allowed_paths: ["server/services/**"],
          enforcement: "blocking"
        },
        {
          kind: "canonical_helper_reuse",
          id: "agent_contract_a",
          version: 1,
          canonical_helpers: [{
            helper_id: "helper_require_user",
            symbol: "requireUser",
            module: "@/server/auth/require-user",
            applies_to_roles: ["api_route"],
            purpose_tags: ["auth"],
            suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
          }],
          enforcement: "advisory"
        }
      ],
      safe_commands: [
        { command: "pnpm test:b", reason: "b", requires_explicit_run: true },
        { command: "pnpm test:a", reason: "a", requires_explicit_run: true }
      ],
      required_checks: [
        { command: "drift check b", applies_to: { path_globs: ["b/**"] }, reason: "b" },
        { command: "drift check a", applies_to: { path_globs: ["a/**"] }, reason: "a" }
      ],
      context_egress: {
        default_mode: "local_only",
        denied_globs: ["**/*.pem", ".env*"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: [
        { agent: "agent_b", permissions: ["request_preflight"] },
        { agent: "agent_a", permissions: ["read_context"] }
      ]
    });
    const reorderedContract = RepoContractSchema.parse({
      ...baseContract,
      rejected_inferences: [...baseContract.rejected_inferences].reverse(),
      waivers: [...baseContract.waivers].reverse(),
      risky_areas: [...baseContract.risky_areas].reverse(),
      agent_contracts: [...(baseContract.agent_contracts ?? [])].reverse(),
      safe_commands: [...baseContract.safe_commands].reverse(),
      required_checks: [...baseContract.required_checks].reverse(),
      context_egress: {
        ...baseContract.context_egress,
        denied_globs: [...baseContract.context_egress.denied_globs].reverse()
      },
      agent_permissions: [...baseContract.agent_permissions].reverse()
    });

    expect(canonicalRepoContractJson(baseContract)).toBe(canonicalRepoContractJson(reorderedContract));
  });

  it("canonicalizes scan state independent of file snapshot order", () => {
    const manifest = {
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed" as const,
      file_count: 2,
      fact_count: 4,
      finding_count: 1,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    };
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "b.ts",
        content_hash: "hash-b",
        byte_size: 2,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "a.ts",
        content_hash: "hash-a",
        byte_size: 1,
        indexed: true
      }
    ];

    expect(canonicalScanStateJson({ manifest, snapshots })).toBe(
      canonicalScanStateJson({ manifest, snapshots: [...snapshots].reverse() })
    );
  });

  it("rejects unsafe context denied globs in repo contracts", () => {
    const contract = {
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: ["../secrets/**", "/tmp/secrets/**"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    };

    expect(() => RepoContractSchema.parse(contract)).toThrow();
  });

  it("rejects unsafe convention scope path globs", () => {
    expect(() => AcceptedConventionSchema.parse({
      id: "convention_abc",
      contract_id: "contract_abc",
      kind: "api_route_no_direct_data_access",
      statement: "API routes must not import direct data-access clients.",
      scope: {
        path_globs: ["../app/api/**/*.ts"],
        exclude_path_globs: ["/tmp/generated/**"],
        file_roles: ["api_route"]
      },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: ["@/db"],
        applies_to_file_roles: ["api_route"]
      },
      severity: "error",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    })).toThrow();
  });

  it("rejects unsafe convention exception path globs", () => {
    expect(() => AcceptedConventionSchema.parse({
      id: "convention_abc",
      contract_id: "contract_abc",
      kind: "api_route_no_direct_data_access",
      statement: "API routes must not import direct data-access clients.",
      scope: { path_globs: ["app/api/**/*.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: ["@/db"],
        applies_to_file_roles: ["api_route"]
      },
      severity: "error",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      exceptions: [{
        id: "exception_escape",
        reason: "bad exception",
        path_globs: ["../legacy/**"],
        created_by: "local-user",
        created_at: "2026-05-10T00:00:00.000Z"
      }],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    })).toThrow();
  });

  it("rejects unsafe risky area path globs in repo contracts", () => {
    expect(() => RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [{
        id: "risk_escape",
        path_globs: ["../billing/**"],
        risk_kind: "billing",
        reason: "Bad risky area."
      }],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    })).toThrow();
  });

  it("authorizes context export from repo policy in one shared place", () => {
    const contract = RepoContractSchema.parse({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fingerprint",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z",
      conventions: [],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [".env*", "**/*.pem"],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    });

    expect(authorizeContextExport(contract, "mcp", { path: ".env.local" })).toMatchObject({
      allowed: false,
      mode: "denied",
      surface: "mcp",
      max_snippet_chars: 0
    });
    expect(authorizeContextExport(contract, "mcp", { path: "../secrets.env" })).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "context path must be repo-relative"
    });
    expect(authorizeContextExport(contract, "mcp", { path: "/tmp/secrets.env" })).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "context path must be repo-relative"
    });
    expect(authorizeContextExport(contract, "cli-preflight", { path: "src/app/api/users/route.ts" })).toMatchObject({
      allowed: true,
      mode: "local_only",
      surface: "cli-preflight",
      max_snippet_chars: 1200
    });
    expect(authorizeContextExport(contract, "mcp", {
      path: "src/app/api/users/route.ts",
      requested_snippet_chars: 2400
    })).toMatchObject({
      allowed: true,
      mode: "redacted",
      max_snippet_chars: 1200,
      approved_snippet_chars: 1200
    });
    expect(authorizeContextExport(contract, "mcp", {
      path: "src/app/api/users/route.ts",
      requested_snippet_chars: -1
    })).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "requested snippet length must be a positive integer",
      approved_snippet_chars: 0
    });
    expect(authorizeContextExport(contract, "mcp", {
      path: "src/app/api/users/route.ts",
      requested_snippet_chars: 12.5
    })).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "requested snippet length must be a positive integer",
      approved_snippet_chars: 0
    });
    expect(authorizeContextExport(contract, "mcp", {
      path: "src/app/api/users/route.ts",
      request_full_file_content: true
    })).toMatchObject({
      allowed: false,
      mode: "denied",
      max_snippet_chars: 0,
      approved_snippet_chars: 0
    });
  });

  it("validates helper similarity evidence without source snippets", () => {
    const parsed = HelperSimilarityEvidenceSchema.parse({
      schema_version: "drift.helper_similarity.v1",
      candidate_symbol: "getCurrentUser",
      candidate_file_path: "apps/web/lib/get-current-user.ts",
      canonical_symbol: "requireUser",
      canonical_module: "@/lib/auth/require-user",
      score: 0.91,
      score_band: "high",
      matched_features: ["purpose_tags", "parameter_shape", "call_dependencies"],
      missing_features: ["return_shape"],
      evidence_refs: ["fact_candidate_export", "fact_canonical_export"],
      blocking_allowed: false
    });

    expect(parsed.blocking_allowed).toBe(false);
    expect(parsed.matched_features).toContain("call_dependencies");
  });

  it("validates entrypoint flow proof with graph paths and missing evidence", () => {
    const parsed = EntrypointFlowProofSchema.parse({
      schema_version: "drift.entrypoint_flow_proof.v1",
      entry_file_path: "apps/web/app/api/accounts/route.ts",
      contract_id: "agent_contract_api_flow",
      required_steps: [{
        step_kind: "service_delegation",
        satisfied: true,
        evidence_refs: ["edge_route_to_service"],
        graph_path: ["apps/web/app/api/accounts/route.ts", "@/server/services/accounts"]
      }],
      forbidden_steps: [{
        step_kind: "direct_data_access",
        present: false,
        evidence_refs: [],
        graph_path: []
      }],
      missing_evidence: []
    });

    expect(parsed.required_steps[0]?.satisfied).toBe(true);
  });

  it("rejects required check execution without argv proof", () => {
    expect(() => RequiredCheckExecutionSchema.parse({
      schema_version: "drift.required_check_execution.v1",
      execution_id: "exec_1",
      repo_id: "repo_1",
      repo_root: "/repo",
      repo_commit: "abc",
      git_branch: "main",
      git_commit_sha: "abc",
      worktree_dirty: false,
      untracked_files_present: false,
      scan_id: "scan_1",
      repo_contract_id: "contract_1",
      agent_contract_id: "agent_contract_checks",
      contract_fingerprint: "contract-fp",
      repo_contract_version: 1,
      command: "pnpm test",
      command_hash: "hash",
      diff_hash: "diff-fp",
      lockfile_hash: null,
      package_manager: null,
      cwd: "/repo",
      started_at: "2026-05-24T00:00:00.000Z",
      completed_at: "2026-05-24T00:00:01.000Z",
      timeout_ms: 30000,
      exit_code: 0,
      status: "passed",
      stdout_hash: "stdout",
      stderr_hash: "stderr",
      stdout_preview: "",
      stderr_preview: "",
      audit_event_id: "audit_1"
    })).toThrow();
  });

  it("validates passed required check execution proof", () => {
    const parsed = RequiredCheckExecutionSchema.parse({
      schema_version: "drift.required_check_execution.v1",
      execution_id: "exec_1",
      repo_id: "repo_1",
      repo_root: "/repo",
      repo_commit: "abc",
      git_branch: "main",
      git_commit_sha: "abc",
      worktree_dirty: false,
      untracked_files_present: false,
      scan_id: "scan_1",
      repo_contract_id: "contract_1",
      agent_contract_id: "agent_contract_checks",
      contract_fingerprint: "contract-fp",
      repo_contract_version: 1,
      command: "pnpm test",
      argv: ["pnpm", "test"],
      command_hash: "hash",
      diff_hash: "diff-fp",
      lockfile_hash: null,
      package_manager: null,
      cwd: "/repo",
      started_at: "2026-05-24T00:00:00.000Z",
      completed_at: "2026-05-24T00:00:01.000Z",
      timeout_ms: 30000,
      exit_code: 0,
      status: "passed",
      stdout_hash: "stdout",
      stderr_hash: "stderr",
      stdout_preview: "",
      stderr_preview: "",
      audit_event_id: "audit_1"
    });

    expect(parsed.argv).toEqual(["pnpm", "test"]);
  });
});
