import { describe, expect, it } from "vitest";
import { buildSecurityBoundaryProofReadModel, buildSecurityPhase8ReadModel, fallbackFactRepoMapFiles } from "../src/index.js";

describe("security boundary proof read model", () => {
  it("renders proof, findings, and parser gaps without snippets", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
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
          parser_gap_ids: ["parser_gap_dynamic"],
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
        parser_gaps: [{
          parser_gap_id: "parser_gap_dynamic",
          capability: "control_flow_guard_dominance",
          code: "unsupported_dynamic_control_flow",
          file_path: "app/api/projects/route.ts",
          reason: "Unsupported dynamic control flow",
          affected_contract_kinds: ["api_route_requires_auth_helper"],
          affected_route_ids: ["route_projects_get"],
          missing_proof_ids: ["missing_proof_auth"],
          blocks_enforcement: true
        }],
        result: {
          proof_status: "parser_gap",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_auth"]
        }
      }],
      findings: [{
        finding_id: "finding_auth",
        title: "API route missing required auth proof",
        lifecycle: "new"
      }]
    });

    expect(model.routes).toEqual([{
      route_id: "route_projects_get",
      file_path: "app/api/projects/route.ts",
      auth_required: true,
      auth_proven: false,
      middleware_required: false,
      middleware_proven: false,
      middleware_protection_kinds: [],
      middleware_mismatch_reasons: [],
      request_validation_required: false,
      request_validation_proven: false,
      request_validation_unvalidated_reasons: [],
      phase6: {
        ssrf: {
          required: false,
          proven: false,
          outbound_request_count: 0,
          allowlist_proof_count: 0
        },
        raw_sql: {
          required: false,
          proven: false,
          raw_sql_call_count: 0,
          parameterized_sql_count: 0
        },
        cors: {
          required: false,
          proven: false,
          policy_count: 0
        },
        csrf: {
          required: false,
          proven: false,
          guard_call_count: 0
        },
        rate_limit: {
          required: false,
          proven: false,
          guard_call_count: 0
        }
      },
      response_shape_required: false,
      response_shape_proven: false,
      sensitive_response_leak_reasons: [],
      secret_exposure_count: 0,
      secret_exposure_sink_kinds: [],
      session_trust_required: false,
      session_trust_proven: false,
      session_missing_trust_reasons: [],
      authorization_required: false,
      authorization_proven: false,
      authorization_missing_reasons: [],
      tenant_required: false,
      tenant_proven: false,
      tenant_missing_reasons: [],
      proof_status: "parser_gap",
      enforcement_result: "block",
      missing_proof_codes: ["missing_auth_guard"],
      parser_gap_codes: ["unsupported_dynamic_control_flow"],
      finding_ids: ["finding_auth"],
      lifecycle: ["new"]
    }]);
    expect(JSON.stringify(model)).not.toContain("const projects");
    expect(JSON.stringify(model)).not.toContain("requireUser()");
  });

  it("summarizes request validation proof without snippets", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
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
          input_reads: [{ fact_id: "fact_body", source: "body", variable: "body" }],
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
      }],
      findings: []
    });

    expect(model.routes[0]).toMatchObject({
      route_id: "route_projects_post",
      request_validation_required: true,
      request_validation_proven: false,
      request_validation_unvalidated_reasons: ["request_input_not_validated"]
    });
    expect(JSON.stringify(model)).not.toContain("request.json()");
  });

  it("summarizes phase4 proof without synthesizing trust from raw facts", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
        proof_id: "proof_phase4",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route_projects_delete",
          file_path: "app/api/projects/route.ts",
          file_role: "api_route"
        },
        contracts: [{
          contract_id: "security_api_authorization",
          kind: "api_route_requires_authorization",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }],
        capability_status: [{
          name: "authorization",
          status: "partial",
          can_block: true,
          parser_gap_ids: [],
          missing_proof_ids: ["missing_authz"]
        }],
        auth: {
          required: false,
          proven: false,
          proof_kind: "none",
          trusted_guard_calls: [],
          dominated_sinks: [],
          undominated_sinks: []
        },
        session_trust: {
          required: true,
          proven: false,
          trusted_sessions: [],
          missing_trust: [{ fact_id: "fact_session", variable: "session", reason: "derived_from_request" }]
        },
        authorization: {
          required: true,
          proven: false,
          role_or_policy_guards: [],
          missing: [{ reason: "session_not_trusted", sink_fact_id: "sink_delete" }]
        },
        tenant: {
          required: true,
          proven: false,
          tenant_sources: [{ fact_id: "fact_tenant", source: "body", key: "tenantId", trusted: false }],
          predicates: [],
          missing: [{ data_operation_fact_id: "fact_delete", reason: "tenant_source_untrusted" }]
        },
        missing_proof: [{
          id: "missing_authz",
          capability: "authorization",
          code: "session_not_trusted",
          blocks_enforcement: true,
          fact_ids: ["fact_session"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_authz"]
        }
      }],
      findings: [{ finding_id: "finding_authz", title: "missing", lifecycle: "new" }]
    });

    expect(model.routes[0]).toMatchObject({
      session_trust_required: true,
      session_trust_proven: false,
      authorization_required: true,
      authorization_proven: false,
      authorization_missing_reasons: ["session_not_trusted"],
      tenant_required: true,
      tenant_proven: false,
      tenant_missing_reasons: ["tenant_source_untrusted"]
    });
    expect(JSON.stringify(model)).not.toContain("tenant-");
    expect(JSON.stringify(model)).not.toContain("session=");
  });

  it("does not report request validation proven from raw scan facts", () => {
    const files = fallbackFactRepoMapFiles([{
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/projects/route.ts",
      content_hash: "hash_projects_route",
      byte_size: 120,
      indexed: true
    }], [{
      id: "fact_request_body",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "request_input_read",
      file_path: "app/api/projects/route.ts",
      name: "body",
      value: JSON.stringify({
        route_id: "route:app/api/projects/route.ts:POST",
        source: "body",
        variable: "body"
      }),
      start_line: 3,
      end_line: 3
    }, {
      id: "fact_validated_use",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "validated_input_used",
      file_path: "app/api/projects/route.ts",
      name: "input",
      value: JSON.stringify({
        route_id: "route:app/api/projects/route.ts:POST",
        sink_kind: "data_operation"
      }),
      start_line: 5,
      end_line: 5
    }] as never);

    expect(files[0]?.route_security?.request_validation).toMatchObject({
      status: "not_evaluated",
      input_sources: ["body"]
    });
  });

  it("summarizes middleware coverage proof without snippets", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
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
      }],
      findings: []
    });

    expect(model.routes).toEqual([expect.objectContaining({
      route_id: "route_projects_get",
      middleware_required: true,
      middleware_proven: true,
      middleware_protection_kinds: ["auth"],
      middleware_mismatch_reasons: [],
      request_validation_required: false,
      request_validation_proven: false,
      request_validation_unvalidated_reasons: []
    })]);
    expect(JSON.stringify(model)).not.toContain("requireUser()");
  });

  it("summarizes Phase 5 proof sections without using raw facts as proof", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
        proof_id: "proof_phase5",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route:app/api/users/route.ts:GET",
          file_path: "app/api/users/route.ts",
          file_role: "api_route"
        },
        contracts: [{
          contract_id: "security_api_sensitive_response",
          kind: "api_route_forbids_sensitive_response_fields",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }],
        capability_status: [{
          name: "response_shape_facts",
          status: "partial",
          can_block: true,
          parser_gap_ids: [],
          missing_proof_ids: ["missing_sensitive"]
        }],
        auth: {
          required: false,
          proven: false,
          proof_kind: "none",
          trusted_guard_calls: [],
          dominated_sinks: [],
          undominated_sinks: []
        },
        response_shape: {
          required: true,
          proven: false,
          sensitive_leaks: [{
            field_fact_id: "fact:app/api/users/route.ts:4",
            field_path: "user.email",
            reason: "sensitive_field_without_serializer"
          }]
        },
        sinks: {
          secrets: [{
            secret_fact_id: "fact:app/api/users/route.ts:3",
            secret_class: "api_key",
            sink_kind: "response",
            sink_line: 4,
            reason: "secret_reaches_sink"
          }]
        },
        missing_proof: [{
          id: "missing_sensitive",
          capability: "response_shape_facts",
          code: "sensitive_response_field_unfiltered",
          blocks_enforcement: true,
          fact_ids: ["fact:app/api/users/route.ts:4"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_phase5"]
        }
      }],
      findings: []
    });

    expect(model.routes[0]).toMatchObject({
      response_shape_required: true,
      response_shape_proven: false,
      sensitive_response_leak_reasons: ["sensitive_field_without_serializer"],
      secret_exposure_count: 1,
      secret_exposure_sink_kinds: ["response"],
      missing_proof_codes: ["sensitive_response_field_unfiltered"]
    });
    expect(JSON.stringify(model)).not.toContain("process.env.API_KEY");
    expect(JSON.stringify(model)).not.toContain("redacted@example.test");
  });

  it("summarizes Phase 6 proof sections from trusted proof output", () => {
    const model = buildSecurityBoundaryProofReadModel({
      proofs: [{
        proof_id: "proof_route_proxy_post",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route_proxy_post",
          file_path: "app/api/proxy/route.ts",
          file_role: "api_route"
        },
        contracts: [{
          contract_id: "security_api_no_untrusted_ssrf",
          kind: "api_route_forbids_untrusted_ssrf",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }],
        capability_status: [],
        auth: {
          required: false,
          proven: false,
          proof_kind: "none",
          trusted_guard_calls: [],
          dominated_sinks: [],
          undominated_sinks: []
        },
        ssrf: {
          required: true,
          proven: false,
          outbound_requests: [{
            fact_id: "fact_fetch",
            sink_id: "sink_fetch",
            api: "fetch",
            url_source: "request_input"
          }],
          allowlist_proofs: [],
          missing_proof: [{
            code: "request_controlled_url",
            fact_ids: ["fact_fetch"]
          }]
        },
        missing_proof: [{
          id: "missing_ssrf",
          capability: "outbound_request_facts",
          code: "request_controlled_url",
          blocks_enforcement: true,
          fact_ids: ["fact_fetch"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_ssrf"]
        }
      }],
      findings: []
    });

    expect(model.routes[0]?.phase6.ssrf).toEqual({
      required: true,
      proven: false,
      outbound_request_count: 1,
      allowlist_proof_count: 0
    });
    expect(JSON.stringify(model)).not.toContain("https://token");
  });

  it("builds Phase 8 route security from proofs only", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: "check_security",
      proofs: [securityBoundaryProofFixture({
        route: {
          route_id: "route_users_get",
          file_path: "app/api/users/route.ts",
          file_role: "api_route",
          endpoint: { path: "/api/users", method: "GET", framework: "next" }
        },
        auth: { required: true, proven: true, proof_kind: "handler_guard", trusted_guard_calls: [], dominated_sinks: [], undominated_sinks: [] },
        tenant: {
          required: true,
          proven: false,
          tenant_sources: [],
          predicates: [],
          missing: [{ data_operation_fact_id: "fact_find_many", reason: "tenant_predicate_not_bound_to_query" }]
        },
        missing_proof: [{
          id: "missing_tenant",
          capability: "tenant_scope",
          code: "tenant_predicate_missing",
          blocks_enforcement: true,
          fact_ids: ["fact_tenant"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_tenant"]
        }
      })],
      findings: [{ finding_id: "finding_tenant", title: "Tenant missing", lifecycle: "new" }],
      accepted_conventions: []
    });

    expect(model.routes[0]).toMatchObject({
      route_id: "route_users_get",
      path: "/api/users",
      method: "GET",
      security: {
        auth_proven: true,
        tenant_scope: "missing_proof",
        proof_status: "missing_proof",
        enforcement_result: "block"
      }
    });
    expect(model.security_capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "tenant_scope",
        missing_proof_count: 1,
        affected_files: ["app/api/users/route.ts"]
      })
    ]));
  });

  it("filters Phase 8 route security to changed files", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: "check_security",
      proofs: [
        securityBoundaryProofFixture({
          route: { route_id: "route_users", file_path: "app/api/users/route.ts", file_role: "api_route" }
        }),
        securityBoundaryProofFixture({
          route: { route_id: "route_admin", file_path: "app/api/admin/route.ts", file_role: "api_route" }
        })
      ],
      findings: [],
      accepted_conventions: [],
      changed_files: ["app/api/users/route.ts"]
    });

    expect(model.changed_route_security.map((route) => route.file_path)).toEqual(["app/api/users/route.ts"]);
  });

  it("redacts accepted_by from security read model", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: "check_security",
      proofs: [],
      findings: [],
      accepted_conventions: [acceptedConventionFixture({
        accepted_by: "geoffrey@example.com",
        accepted_at: "2026-05-27T00:00:00.000Z"
      })]
    });

    expect(JSON.stringify(model)).not.toContain("geoffrey@example.com");
    expect(model.repo_security_contracts[0]).not.toHaveProperty("accepted_by");
    expect(model.repo_security_contracts[0]?.accepted_at).toBe("2026-05-27T00:00:00.000Z");
  });

  it("known routes without proof are emitted as unknown", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: null,
      proofs: [],
      findings: [],
      accepted_conventions: [],
      known_routes: [{
        route_id: "route:GET:apps/web/app/api/users/route.ts",
        file_path: "apps/web/app/api/users/route.ts",
        method: "GET",
        path: "/api/users",
        file_role: "api_route"
      }]
    });

    expect(model.routes).toEqual([expect.objectContaining({
      route_id: "route:GET:apps/web/app/api/users/route.ts",
      path: "/api/users",
      method: "GET",
      security: expect.objectContaining({
        proof_status: "unknown",
        missing_proof_codes: ["no_security_proof"]
      })
    })]);
  });

  it("merges canonical route metadata into proof-backed and unknown Phase 8 routes", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_new",
      check_id: "check_security",
      proof_scan_id: "scan_old",
      proofs: [securityBoundaryProofFixture({
        route: {
          route_id: "route:apps/web/app/api/users/route.ts:GET",
          file_path: "apps/web/app/api/users/route.ts",
          file_role: "api_route",
          endpoint: { path: "/api/wrong", method: "POST", framework: "next" }
        }
      })],
      findings: [],
      accepted_conventions: [],
      changed_files: ["apps/web/app/api/users/route.ts", "apps/web/app/api/admin/route.ts"],
      canonical_route_fallback: { used: false, reason: null },
      route_source_summary: {
        normalized_entrypoint: 2,
        security_proof: 0,
        legacy_fact_fallback: 0
      },
      known_routes: [{
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/users/route.ts:GET",
        file_path: "apps/web/app/api/users/route.ts",
        path: "/api/users",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale"
      }, {
        route_id: "route:apps/web/app/api/admin/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/admin/route.ts:GET",
        file_path: "apps/web/app/api/admin/route.ts",
        path: "/api/admin",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale"
      }]
    });

    expect(model.proof_freshness).toBe("stale");
    expect(model.canonical_route_fallback).toEqual({ used: false, reason: null });
    expect(model.route_source_summary).toMatchObject({ normalized_entrypoint: 2 });
    expect(model.routes).toEqual([
      expect.objectContaining({
        route_id: "route:apps/web/app/api/admin/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/admin/route.ts:GET",
        path: "/api/admin",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale",
        security: expect.objectContaining({ proof_status: "unknown" })
      }),
      expect.objectContaining({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/users/route.ts:GET",
        path: "/api/users",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale",
        security: expect.objectContaining({ proof_status: "proven" })
      })
    ]);
    expect(model.changed_route_security).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/users/route.ts:GET",
        path: "/api/users",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale",
        current_proof_status: "proven",
        current_proof_status_detail: expect.objectContaining({
          proof_status: "proven",
          source: "normalized_entrypoint",
          freshness: "stale"
        })
      })
    ]));
    expect(model.changed_route_security).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route_id: "route:apps/web/app/api/admin/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/admin/route.ts:GET",
        path: "/api/admin",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "stale",
        current_proof_status: "unknown"
      })
    ]));
    expect(model.required_proofs[0]).toMatchObject({
      route_id: "route:apps/web/app/api/users/route.ts:GET",
      normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/users/route.ts:GET",
      path: "/api/users",
      method: "GET",
      source: "normalized_entrypoint",
      freshness: "stale"
    });
    expect(model.current_proof_status).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/users/route.ts:GET",
        proof_status: "proven",
        source: "normalized_entrypoint",
        freshness: "stale"
      }),
      expect.objectContaining({
        route_id: "route:apps/web/app/api/admin/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/api/admin/route.ts:GET",
        proof_status: "unknown",
        source: "normalized_entrypoint",
        freshness: "stale"
      })
    ]));
  });

  it("derives mixed capability route status by capability", () => {
    const model = buildSecurityPhase8ReadModel({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: "check_security",
      proofs: [securityBoundaryProofFixture({
        contracts: [{
          contract_id: "security_api_auth",
          kind: "api_route_requires_auth_helper",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }, {
          contract_id: "security_api_request_validation",
          kind: "api_route_requires_request_validation",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }, {
          contract_id: "security_custom",
          kind: "custom_briefing",
          enforcement_mode: "warn",
          capability: "heuristic_check",
          matched: true
        }],
        capability_status: [{
          name: "control_flow_guard_dominance",
          status: "complete",
          can_block: true,
          parser_gap_ids: [],
          missing_proof_ids: []
        }, {
          name: "request_validation_facts",
          status: "partial",
          can_block: true,
          parser_gap_ids: [],
          missing_proof_ids: ["missing_validation"]
        }],
        request_validation: {
          required: true,
          proven: false,
          input_reads: [],
          validations: [],
          validated_uses: [],
          unvalidated_uses: []
        },
        missing_proof: [{
          id: "missing_validation",
          capability: "request_validation_facts",
          code: "request_input_not_validated",
          blocks_enforcement: true,
          fact_ids: ["fact_body"],
          graph_edge_ids: []
        }],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: []
        }
      })],
      findings: [],
      accepted_conventions: [
        acceptedConventionFixture(),
        acceptedConventionFixture({
          id: "security_api_request_validation",
          kind: "api_route_requires_request_validation",
          enforcement_capability: "deterministic_check",
          enforcement_mode: "block"
        }),
        acceptedConventionFixture({
          id: "candidate_only_signal",
          kind: "api_route_forbids_secret_exposure",
          enforcement_capability: "heuristic_check",
          enforcement_mode: "warn"
        })
      ]
    });

    expect(model.security_capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "control_flow_guard_dominance",
        status: "complete",
        capability: "deterministic_check",
        can_block: true
      }),
      expect.objectContaining({
        name: "request_validation_facts",
        status: "partial",
        capability: "deterministic_check",
        can_block: true
      }),
      expect.objectContaining({
        name: "secret_exposure",
        capability: "heuristic_check",
        can_block: false
      })
    ]));
  });
});

function securityBoundaryProofFixture(overrides: Record<string, unknown> = {}) {
  return {
    proof_id: "proof_route_users_get",
    proof_version: "security-boundary-proof/v1",
    route: {
      route_id: "route_users_get",
      file_path: "app/api/users/route.ts",
      file_role: "api_route"
    },
    contracts: [{
      contract_id: "security_api_auth",
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
      missing_proof_ids: []
    }],
    auth: {
      required: true,
      proven: true,
      proof_kind: "handler_guard",
      trusted_guard_calls: [],
      dominated_sinks: [],
      undominated_sinks: []
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

function acceptedConventionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "security_api_auth",
    contract_id: "contract_security",
    kind: "api_route_requires_auth_helper",
    statement: "API routes require accepted auth helper proof.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route"] },
    matcher: {
      kind: "api_route_requires_auth_helper",
      applies_to_file_roles: ["api_route"]
    },
    requires: {
      auth_helpers: ["requireUser"]
    },
    severity: "error",
    enforcement_mode: "block",
    enforcement_capability: "deterministic_check",
    exceptions: [],
    evidence_refs: [],
    counterexample_refs: [],
    accepted_by: "local-user",
    accepted_at: "2026-05-25T00:00:00.000Z",
    updated_at: "2026-05-25T00:00:00.000Z",
    ...overrides
  } as const;
}
