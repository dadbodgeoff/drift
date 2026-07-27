import { describe, expect, it } from "vitest";
import {
  SecurityBoundaryProofSchema,
  SecurityConventionSchema,
  SecurityMissingProofCodeSchema,
  SecurityParserGapCodeSchema
} from "../src/index.js";

describe("security domain schemas", () => {
  it("validates api_route_requires_auth_helper contracts and missing proof codes", () => {
    expect(SecurityMissingProofCodeSchema.parse("missing_auth_guard")).toBe("missing_auth_guard");

    const contract = SecurityConventionSchema.parse({
      contract_id: "security_api_auth_require_user",
      kind: "api_route_requires_auth_helper",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        file_roles: ["api_route"],
        path_globs: ["**/app/api/**/route.ts"],
        methods: ["GET", "POST"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "route",
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        auth_helpers: ["requireUser"],
        dominates: ["data_operation", "response"]
      },
      exceptions: [],
      governance: {
        accepted_by: "test",
        accepted_at: "2026-05-25T00:00:00.000Z",
        rationale: "API routes require accepted auth helper dominance"
      }
    });

    expect(contract.kind).toBe("api_route_requires_auth_helper");
  });

  it("rejects blocking heuristic security contracts", () => {
    expect(() => SecurityConventionSchema.parse({
      contract_id: "security_api_auth_require_user",
      kind: "api_route_requires_auth_helper",
      capability: "heuristic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"] },
      scope: { check_scope: "changed-files", applies_to: "route" },
      requires: { auth_helpers: ["requireUser"] }
    })).toThrow(/blocking security contracts require deterministic capability/);
  });

  it("validates accepted Phase 5 sensitive response and secret exposure contracts", () => {
    const sensitiveResponseContract = SecurityConventionSchema.parse({
      contract_id: "security_api_sensitive_response",
      kind: "api_route_forbids_sensitive_response_fields",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        file_roles: ["api_route"],
        methods: ["GET"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "response",
        path_globs: ["app/api/users/**/route.ts"],
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        sensitive_response_fields: [{
          field_path: "user.email",
          classification: "pii",
          source: "contract"
        }],
        response_serializers: [{
          serializer_id: "serializePublicUser",
          import_source: "@/lib/serializers/user",
          imported_name: "serializePublicUser",
          local_name: "serializePublicUser",
          policy: "denylist",
          filtered_fields: ["user.email"]
        }]
      },
      exceptions: []
    });

    const secretExposureContract = SecurityConventionSchema.parse({
      contract_id: "security_api_secret_exposure",
      kind: "api_route_forbids_secret_exposure",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        file_roles: ["api_route"],
        methods: ["POST"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "response",
        path_globs: ["app/api/tokens/**/route.ts"],
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        secret_sources: ["env", "config", "secret_manager"],
        log_sinks: ["console.error", "logger.error"]
      },
      exceptions: []
    });

    expect(sensitiveResponseContract.requires?.response_serializers).toEqual([{
      serializer_id: "serializePublicUser",
      import_source: "@/lib/serializers/user",
      imported_name: "serializePublicUser",
      local_name: "serializePublicUser",
      policy: "denylist",
      filtered_fields: ["user.email"]
    }]);
    expect(secretExposureContract.scope.path_globs).toEqual(["app/api/tokens/**/route.ts"]);
    expect(secretExposureContract.matcher.methods).toEqual(["POST"]);
  });

  it("accepts candidate sensitive fields only for non-blocking advisory contracts", () => {
    const advisory = SecurityConventionSchema.parse({
      contract_id: "security_api_sensitive_candidate",
      kind: "api_route_forbids_sensitive_response_fields",
      capability: "heuristic_check",
      enforcement_mode: "warn",
      matcher: { file_roles: ["api_route"], methods: ["GET"] },
      scope: {
        check_scope: "changed-files",
        applies_to: "response",
        path_globs: ["app/api/users/**/route.ts"]
      },
      requires: {
        sensitive_response_fields: [{
          field_path: "password",
          classification: "credential",
          source: "candidate"
        }]
      }
    });

    expect(advisory.requires?.sensitive_response_fields).toEqual([{
      field_path: "password",
      classification: "credential",
      source: "candidate"
    }]);

    expect(() => SecurityConventionSchema.parse({
      ...advisory,
      capability: "deterministic_check",
      enforcement_mode: "block"
    })).toThrow(/candidate sensitive fields cannot back blocking enforcement/);
  });

  it("rejects unsafe Phase 5 contract payloads", () => {
    expect(() => SecurityConventionSchema.parse({
      contract_id: "security_api_unknown_serializer",
      kind: "api_route_forbids_sensitive_response_fields",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"], methods: ["GET"] },
      scope: {
        check_scope: "changed-files",
        applies_to: "response",
        path_globs: ["app/api/users/**/route.ts"]
      },
      requires: {
        sensitive_response_fields: [{ field_path: "user.email", classification: "pii", source: "contract" }],
        response_serializers: [{
          serializer_id: "serializePublicUser",
          import_source: "@/lib/serializers/user",
          policy: "unknown",
          filtered_fields: ["user.email"]
        }]
      }
    })).toThrow(/serializer policy/i);

    expect(() => SecurityConventionSchema.parse({
      contract_id: "security_api_secret_value",
      kind: "api_route_forbids_secret_exposure",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"], methods: ["POST"] },
      scope: {
        check_scope: "changed-files",
        applies_to: "response",
        path_globs: ["app/api/tokens/**/route.ts"]
      },
      requires: {
        secret_sources: ["env"],
        source_value: "SECRET_VALUE_SHOULD_NOT_LEAK"
      }
    })).toThrow(/source values are not allowed/i);
  });

  it("validates SecurityBoundaryProof.auth without snippets", () => {
    const proof = SecurityBoundaryProofSchema.parse({
      proof_id: "proof_route_projects_get",
      proof_version: "security-boundary-proof/v1",
      route: {
        route_id: "route_projects_get",
        file_path: "app/api/projects/route.ts",
        file_role: "api_route"
      },
      contracts: [{
        contract_id: "security_api_auth_require_user",
        kind: "api_route_requires_auth_helper",
        enforcement_mode: "block",
        capability: "deterministic_check",
        matched: true
      }],
      capability_status: [{
        name: "control_flow_guard_dominance",
        status: "complete",
        can_block: true,
        parser_gap_ids: [],
        missing_proof_ids: ["missing_proof_auth"]
      }],
      auth: {
        required: true,
        proven: false,
        proof_kind: "none",
        trusted_guard_calls: [],
        dominated_sinks: [],
        undominated_sinks: [{
          sink_id: "sink_projects_read",
          sink_kind: "data_operation",
          reason: "no_guard_call",
          fact_ids: ["fact_projects_read"]
        }]
      },
      missing_proof: [{
        id: "missing_proof_auth",
        capability: "control_flow_guard_dominance",
        code: "missing_auth_guard",
        blocks_enforcement: true,
        fact_ids: ["fact_projects_read"],
        graph_edge_ids: []
      }],
      parser_gaps: [],
      result: {
        proof_status: "missing_proof",
        enforcement_result: "block",
        can_block: true,
        finding_ids: ["finding_auth"]
      }
    });

    expect(JSON.stringify(proof)).not.toContain("const projects");
    expect(proof.auth.required).toBe(true);
  });

  it("preserves normalized entrypoint ids in Phase 8 proof route metadata", () => {
    const proof = validSecurityBoundaryProof({
      route: {
        route_id: "route_users_get",
        normalized_entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
        file_path: "app/api/users/route.ts",
        file_role: "api_route",
        endpoint: { path: "/api/users", method: "GET", framework: "next" },
        handler_symbol: "GET"
      },
      evidence_refs: [{
        evidence_id: "evidence_auth_guard",
        fact_id: "fact_auth_guard",
        capability: "control_flow_guard_dominance",
        kind: "auth_guard_called",
        file_path: "app/api/users/route.ts",
        start_line: 4,
        end_line: 4,
        role: "guard"
      }]
    });

    const parsed = SecurityBoundaryProofSchema.parse(proof);
    expect(parsed.route.normalized_entrypoint_id).toBe("entrypoint:next_app:app/api/users/route.ts:GET");
    expect(parsed.evidence_refs).toHaveLength(1);
  });

  it("rejects Phase 8 proof evidence refs that carry source or secret values", () => {
    const proof = validSecurityBoundaryProof({
      evidence_refs: [{
        evidence_id: "evidence_bad",
        capability: "raw_sql",
        kind: "raw_sql_called",
        file_path: "app/api/users/route.ts",
        role: "sink",
        source: "await db.query(\"select secret\")"
      }]
    });

    expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow();
  });

  it("validates middleware_must_cover_routes contracts and parser gaps", () => {
    expect(SecurityMissingProofCodeSchema.parse("middleware_not_covering_route")).toBe("middleware_not_covering_route");
    expect(SecurityMissingProofCodeSchema.parse("middleware_dynamic_matcher")).toBe("middleware_dynamic_matcher");
    expect(SecurityParserGapCodeSchema.parse("unsupported_dynamic_middleware_matcher")).toBe("unsupported_dynamic_middleware_matcher");

    const contract = SecurityConventionSchema.parse({
      contract_id: "security_middleware_api_coverage",
      kind: "middleware_must_cover_routes",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        route_paths: ["/api/projects"],
        methods: ["GET"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "route",
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        middleware_symbols: ["middleware"],
        protection_kinds: ["auth"]
      },
      exceptions: []
    });

    expect(contract.kind).toBe("middleware_must_cover_routes");
  });

  it("validates middleware SecurityBoundaryProof fields from engine output", () => {
    const proof = SecurityBoundaryProofSchema.parse({
      proof_id: "proof_route_projects_get_middleware",
      proof_version: "security-boundary-proof/v1",
      route: {
        route_id: "route_projects_get",
        file_path: "app/api/projects/route.ts",
        file_role: "api_route"
      },
      contracts: [{
        contract_id: "security_middleware_api_coverage",
        kind: "middleware_must_cover_routes",
        enforcement_mode: "block",
        capability: "deterministic_check",
        matched: true
      }],
      capability_status: [{
        name: "middleware_coverage",
        status: "complete",
        can_block: true,
        parser_gap_ids: [],
        missing_proof_ids: []
      }],
      auth: {
        required: true,
        proven: true,
        proof_kind: "middleware_guard",
        trusted_guard_calls: [],
        dominated_sinks: [],
        undominated_sinks: []
      },
      middleware: {
        required: true,
        proven: true,
        matched_middleware: [{
          middleware_id: "middleware:middleware.ts",
          matcher_fact_id: "fact_middleware_matcher",
          protects_route_edge_id: "edge_middleware_projects",
          protection_kind: "auth"
        }],
        mismatches: []
      },
      missing_proof: [],
      parser_gaps: [],
      result: {
        proof_status: "proven",
        enforcement_result: "pass",
        can_block: false,
        finding_ids: []
      }
    });

    expect(proof.middleware.proven).toBe(true);
    expect(JSON.stringify(proof)).not.toContain("requireUser()");
  });

  it("validates api_route_requires_request_validation contracts and proof fields", () => {
    expect(SecurityMissingProofCodeSchema.parse("request_input_not_validated")).toBe("request_input_not_validated");
    expect(SecurityMissingProofCodeSchema.parse("unknown_validator")).toBe("unknown_validator");
    expect(SecurityParserGapCodeSchema.parse("unsupported_request_input_spread")).toBe("unsupported_request_input_spread");

    const contract = SecurityConventionSchema.parse({
      contract_id: "security_api_request_validation",
      kind: "api_route_requires_request_validation",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        file_roles: ["api_route"],
        path_globs: ["**/app/api/**/route.ts"],
        methods: ["POST", "PUT", "PATCH", "DELETE"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "route",
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        input_sources: ["body", "query", "params"],
        sinks: ["data_operation"],
        validators: ["validateProjectInput"],
        schemas: ["ProjectInputSchema"]
      },
      exceptions: []
    });

    const proof = SecurityBoundaryProofSchema.parse({
      proof_id: "proof_route_projects_post_validation",
      proof_version: "security-boundary-proof/v1",
      route: {
        route_id: "route_projects_post",
        file_path: "app/api/projects/route.ts",
        file_role: "api_route"
      },
      contracts: [{
        contract_id: "security_api_request_validation",
        kind: "api_route_requires_request_validation",
        enforcement_mode: "block",
        capability: "deterministic_check",
        matched: true
      }],
      capability_status: [{
        name: "request_validation_facts",
        status: "complete",
        can_block: true,
        parser_gap_ids: [],
        missing_proof_ids: ["missing_validation"]
      }],
      auth: {
        required: false,
        proven: false,
        proof_kind: "none",
        trusted_guard_calls: [],
        dominated_sinks: [],
        undominated_sinks: []
      },
      request_validation: {
        required: true,
        proven: false,
        input_reads: [{
          fact_id: "fact_body",
          source: "body",
          variable: "body"
        }],
        validations: [],
        validated_uses: [],
        unvalidated_uses: [{
          input_fact_id: "fact_body",
          sink_fact_id: "sink_create",
          sink_kind: "data_operation",
          reason: "request_input_not_validated"
        }]
      },
      missing_proof: [{
        id: "missing_validation",
        capability: "request_validation_facts",
        code: "request_input_not_validated",
        blocks_enforcement: true,
        fact_ids: ["fact_body"],
        graph_edge_ids: []
      }],
      parser_gaps: [],
      result: {
        proof_status: "missing_proof",
        enforcement_result: "block",
        can_block: true,
        finding_ids: ["finding_validation"]
      }
    });

    expect(contract.kind).toBe("api_route_requires_request_validation");
    expect(proof.request_validation.required).toBe(true);
    expect(JSON.stringify(proof)).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
  });

  it("validates phase4 tenant authorization and session trust contracts", () => {
    expect(SecurityMissingProofCodeSchema.parse("session_not_trusted")).toBe("session_not_trusted");
    expect(SecurityMissingProofCodeSchema.parse("authorization_guard_missing")).toBe("authorization_guard_missing");
    expect(SecurityMissingProofCodeSchema.parse("tenant_predicate_missing")).toBe("tenant_predicate_missing");

    const authorization = SecurityConventionSchema.parse({
      contract_id: "security_api_authorization",
      kind: "api_route_requires_authorization",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"], methods: ["DELETE"] },
      scope: { check_scope: "changed-files", applies_to: "route" },
      requires: {
        auth_helpers: ["requireUser"],
        authorization_helpers: ["requireRole", "canAccessProject"],
        data_operations: ["delete"]
      }
    });
    const tenant = SecurityConventionSchema.parse({
      contract_id: "security_api_tenant_scope",
      kind: "api_route_requires_tenant_scope",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"] },
      scope: { check_scope: "changed-files", applies_to: "route" },
      requires: {
        auth_helpers: ["requireUser"],
        tenant_helpers: ["scopeProjectToTenant"],
        tenant_keys: ["tenantId"],
        tenant_sources: ["session"],
        data_operations: ["findMany", "delete"]
      }
    });
    const session = SecurityConventionSchema.parse({
      contract_id: "security_session_trust",
      kind: "session_object_must_come_from_trusted_helper",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: { file_roles: ["api_route"] },
      scope: { check_scope: "changed-files", applies_to: "route" },
      requires: { auth_helpers: ["requireUser"] }
    });

    expect(authorization.kind).toBe("api_route_requires_authorization");
    expect(tenant.kind).toBe("api_route_requires_tenant_scope");
    expect(session.kind).toBe("session_object_must_come_from_trusted_helper");
  });

  it("rejects impossible phase4 proof states", () => {
    const proof = {
      proof_id: "proof_phase4",
      proof_version: "security-boundary-proof/v1",
      route: {
        route_id: "route_projects_delete",
        file_path: "app/api/projects/route.ts",
        file_role: "api_route"
      },
      contracts: [],
      capability_status: [],
      auth: { required: false, proven: false, proof_kind: "none", trusted_guard_calls: [], dominated_sinks: [], undominated_sinks: [] },
      session_trust: {
        required: true,
        proven: true,
        trusted_sessions: [],
        missing_trust: [{ fact_id: "fact_session", variable: "session", reason: "derived_from_request" }]
      },
      authorization: {
        required: true,
        proven: true,
        role_or_policy_guards: [{ fact_id: "fact_role", policy_id: "authorization_require_role", roles: ["admin"], permissions: [], subject_var: "session.user" }],
        missing: [{ reason: "session_not_trusted", sink_fact_id: "sink_delete" }]
      },
      tenant: {
        required: true,
        proven: true,
        tenant_sources: [{ fact_id: "fact_tenant", source: "body", key: "tenantId", trusted: false }],
        predicates: [{ fact_id: "fact_predicate", data_operation_fact_id: "fact_delete", tenant_key: "tenantId", predicate_kind: "equality" }],
        missing: [{ data_operation_fact_id: "fact_delete", reason: "tenant_source_untrusted" }]
      },
      missing_proof: [],
      parser_gaps: [],
      result: { proof_status: "proven", enforcement_result: "pass", can_block: false, finding_ids: [] }
    };

    expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow(/phase4 proven proof cannot include missing/i);
  });

  it("validates phase4 parser gaps from engine output", () => {
    expect(SecurityParserGapCodeSchema.parse("unsupported_tenant_dynamic_property")).toBe("unsupported_tenant_dynamic_property");
    expect(SecurityParserGapCodeSchema.parse("unsupported_tenant_query_object_alias")).toBe("unsupported_tenant_query_object_alias");
    expect(SecurityParserGapCodeSchema.parse("unsupported_session_nested_destructure")).toBe("unsupported_session_nested_destructure");
  });

  it("validates Phase 6 contract kinds and proof codes", () => {
    expect(SecurityMissingProofCodeSchema.parse("request_controlled_url")).toBe("request_controlled_url");
    expect(SecurityMissingProofCodeSchema.parse("raw_sql_unparameterized")).toBe("raw_sql_unparameterized");
    expect(SecurityMissingProofCodeSchema.parse("unsupported_dynamic_cors_origin")).toBe("unsupported_dynamic_cors_origin");
    expect(SecurityParserGapCodeSchema.parse("unsupported_dynamic_outbound_url")).toBe("unsupported_dynamic_outbound_url");

    const contract = SecurityConventionSchema.parse({
      contract_id: "security_api_no_untrusted_ssrf",
      kind: "api_route_forbids_untrusted_ssrf",
      capability: "deterministic_check",
      enforcement_mode: "block",
      matcher: {
        file_roles: ["api_route"],
        path_globs: ["**/app/api/**/route.ts"],
        methods: ["POST"]
      },
      scope: {
        check_scope: "changed-files",
        applies_to: "route",
        diff_status: ["added", "modified", "renamed"]
      },
      requires: {
        outbound_url_allowlist_helpers: [{
          helper_id: "network:assertAllowedOutboundUrl",
          symbol: "assertAllowedOutboundUrl",
          import_source: "@/lib/security/network"
        }]
      },
      exceptions: []
    });

    expect(contract.kind).toBe("api_route_forbids_untrusted_ssrf");
  });

  it("rejects impossible proven Phase 6 SSRF proof states", () => {
    const proof = validSecurityBoundaryProof({
      contracts: [{
        contract_id: "security_api_no_untrusted_ssrf",
        kind: "api_route_forbids_untrusted_ssrf",
        enforcement_mode: "block",
        capability: "deterministic_check",
        matched: true
      }],
      ssrf: {
        required: true,
        proven: true,
        outbound_requests: [{
          fact_id: "fact_fetch",
          sink_id: "sink_fetch",
          api: "fetch",
          url_source: "request_input"
        }],
        allowlist_proofs: [],
        missing_proof: []
      }
    });

    expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow(/SSRF/i);
  });

  it("rejects impossible proven Phase 6 raw SQL proof states", () => {
    const proof = validSecurityBoundaryProof({
      contracts: [{
        contract_id: "security_api_no_raw_sql",
        kind: "api_route_forbids_raw_sql_without_params",
        enforcement_mode: "block",
        capability: "deterministic_check",
        matched: true
      }],
      raw_sql: {
        required: true,
        proven: true,
        raw_sql_calls: [{
          fact_id: "fact_query",
          sink_id: "sink_query",
          query_shape: "concat",
          uses_untrusted_input: true
        }],
        parameterized_sql: [],
        missing_proof: []
      }
    });

    expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow(/raw SQL/i);
  });

  it("rejects impossible request validation proof states", () => {
    const proof = validSecurityBoundaryProof({
      request_validation: {
        required: true,
        proven: true,
        input_reads: [{ fact_id: "fact_body", source: "body", variable: "body" }],
        validations: [],
        validated_uses: [],
        unvalidated_uses: [{
          input_fact_id: "fact_body",
          sink_fact_id: "fact_sink",
          sink_kind: "data_operation",
          reason: "request_input_not_validated"
        }]
      },
      result: {
        proof_status: "proven",
        enforcement_result: "pass",
        can_block: false,
        finding_ids: []
      }
    });

    expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow(/request validation/i);
  });
});

function validSecurityBoundaryProof(overrides: Record<string, unknown> = {}) {
  return {
    proof_id: "proof_route_projects_post_validation",
    proof_version: "security-boundary-proof/v1",
    route: {
      route_id: "route_projects_post",
      file_path: "app/api/projects/route.ts",
      file_role: "api_route"
    },
    contracts: [{
      contract_id: "security_api_request_validation",
      kind: "api_route_requires_request_validation",
      enforcement_mode: "block",
      capability: "deterministic_check",
      matched: true
    }],
    capability_status: [{
      name: "request_validation_facts",
      status: "complete",
      can_block: true,
      parser_gap_ids: [],
      missing_proof_ids: []
    }],
    auth: {
      required: false,
      proven: false,
      proof_kind: "none",
      trusted_guard_calls: [],
      dominated_sinks: [],
      undominated_sinks: []
    },
    request_validation: {
      required: true,
      proven: true,
      input_reads: [{ fact_id: "fact_body", source: "body", variable: "body" }],
      validations: [{
        fact_id: "fact_validation",
        validator_symbol: "ProjectInputSchema",
        schema_symbol: "ProjectInputSchema",
        input_var: "body",
        result_var: "input"
      }],
      validated_uses: [{
        fact_id: "fact_validated_use",
        source_input_var: "body",
        validated_var: "input",
        sink_fact_id: "sink_create",
        sink_kind: "data_operation"
      }],
      unvalidated_uses: []
    },
    missing_proof: [],
    parser_gaps: [],
    result: {
      proof_status: "proven",
      enforcement_result: "pass",
      can_block: false,
      finding_ids: []
    },
    ...overrides
  };
}
