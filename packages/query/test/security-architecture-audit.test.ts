import { describe, expect, it } from "vitest";
import { buildSecurityArchitectureAudit } from "../src/index.js";
import type { AcceptedConvention, ConventionCandidate, FactRecord } from "@drift/core";

function fact(input: Partial<FactRecord> & Pick<FactRecord, "kind" | "file_path" | "name" | "start_line">): FactRecord {
  return {
    id: `fact_${input.kind}_${input.file_path}_${input.name}_${input.start_line}`.replace(/[^A-Za-z0-9_]/g, "_"),
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    end_line: input.start_line,
    source_span: { start_line: input.start_line, start_column: 1, end_line: input.start_line, end_column: 1 },
    ast_node_kind: null,
    extraction_method: "test",
    extractor_version: "0.1.0",
    parser_version: "0.1.0",
    confidence: 1,
    confidence_label: "certain",
    evidence_level: "text",
    resolution_status: "resolved",
    staleness_status: "fresh",
    last_seen_scan_id: "scan_abc",
    ...input
  };
}

function candidate(input: Pick<ConventionCandidate, "id" | "kind" | "status" | "statement" | "matcher" | "requires">): ConventionCandidate {
  return {
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    rationale: "test candidate",
    scope: { path_globs: ["**/app/api/**/route.ts"], file_roles: ["api_route"] },
    suggested_severity: "warning",
    suggested_enforcement_mode: "warn",
    enforcement_capability: "deterministic_check",
    confidence_label: "medium",
    scoring: {
      supporting_examples_count: 2,
      counterexamples_count: 0,
      scope_files_count: 4,
      coverage_ratio: 0.5,
      heuristic_id: "test"
    },
    evidence_refs: [],
    counterexample_refs: [],
    created_at: "2026-05-27T00:00:00.000Z",
    ...input
  };
}

function accepted(input: Pick<AcceptedConvention, "id" | "kind" | "statement" | "matcher" | "requires">): AcceptedConvention {
  return {
    contract_id: "contract_abc",
    rationale: "accepted",
    scope: { path_globs: ["**/app/api/**/route.ts"], file_roles: ["api_route"] },
    severity: "warning",
    enforcement_mode: "warn",
    enforcement_capability: "deterministic_check",
    exceptions: [],
    evidence_refs: [],
    counterexample_refs: [],
    accepted_by: "test",
    accepted_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z",
    ...input
  };
}

describe("security architecture audit", () => {
  it("summarizes repo security patterns without treating body parsers as validation proof", () => {
    const model = buildSecurityArchitectureAudit({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      facts: [
        fact({ kind: "file_role_detected", file_path: "app/api/apps/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "file_role_detected", file_path: "app/api/tokens/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "file_role_detected", file_path: "app/api/public/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "withWorkspace", start_line: 5 }),
        fact({ kind: "symbol_called", file_path: "app/api/tokens/route.ts", name: "withSession", start_line: 5 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "parseRequestBody", start_line: 8 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "parseAsync", value: "createOAuthAppSchema", start_line: 8 }),
        fact({ kind: "symbol_called", file_path: "app/api/public/route.ts", name: "ratelimitOrThrow", start_line: 3 }),
        fact({ kind: "symbol_called", file_path: "app/api/public/route.ts", name: "exceededLimitError", start_line: 8 }),
        fact({ kind: "symbol_called", file_path: "app/api/public/route.ts", name: "accountApplicationDeauthorized", start_line: 9 }),
        fact({ kind: "data_operation_detected", file_path: "app/api/public/route.ts", name: "then", start_line: 10 }),
        fact({ kind: "sensitive_field_declared", file_path: "app/api/apps/route.ts", name: "success", start_line: 11 }),
        fact({ kind: "sensitive_field_declared", file_path: "app/api/apps/route.ts", name: "accessToken", start_line: 12 }),
        fact({ kind: "request_input_read", file_path: "app/api/apps/route.ts", name: "name", value: "{\"source\":\"body\",\"variable\":\"name\",\"source_value\":\"secret\"}", start_line: 8 }),
        fact({ kind: "outbound_request_called", file_path: "app/api/import/route.ts", name: "fetch", value: "{\"url_source\":\"request_input\",\"url_var\":\"url\",\"raw_url\":\"https://token@example.com\"}", start_line: 12 })
      ],
      candidates: [
        candidate({
          id: "candidate_auth_workspace",
          kind: "api_route_requires_auth_helper",
          status: "accepted",
          statement: "Use withWorkspace.",
          matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withWorkspace"] },
          requires: { auth_helpers: [{ symbol: "withWorkspace" }] }
        }),
        candidate({
          id: "candidate_body_parser",
          kind: "api_route_requires_request_validation",
          status: "candidate",
          statement: "Uses parseRequestBody.",
          matcher: { kind: "api_route_requires_request_validation", required_calls: ["parseRequestBody"] },
          requires: { validators: [{ symbol: "parseRequestBody" }] }
        }),
        candidate({
          id: "candidate_rate_error",
          kind: "api_route_requires_rate_limit",
          status: "candidate",
          statement: "Uses exceededLimitError.",
          matcher: { kind: "api_route_requires_rate_limit", required_calls: ["exceededLimitError"] },
          requires: { rate_limit_helpers: [{ symbol: "exceededLimitError" }] }
        }),
        candidate({
          id: "candidate_response_sanitizer",
          kind: "api_route_forbids_sensitive_response_fields",
          status: "candidate",
          statement: "Uses sanitizer helper.",
          matcher: { kind: "api_route_forbids_sensitive_response_fields", required_calls: ["sanitizeFullTextSearch"] },
          requires: { response_serializers: [{ symbol: "sanitizeFullTextSearch" }] }
        })
      ],
      accepted_conventions: [
        accepted({
          id: "convention_auth_workspace",
          kind: "api_route_requires_auth_helper",
          statement: "Use withWorkspace.",
          matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withWorkspace"] },
          requires: { auth_helpers: [{ symbol: "withWorkspace" }] }
        })
      ],
      parser_gaps: [],
      proofs: []
    });

    expect(model.summary.area_count).toBeGreaterThan(10);
    expect(model.summary.priority_pattern_count).toBeGreaterThan(0);
    expect(model.summary.inventory_pattern_count).toBeGreaterThan(0);
    expect(model.summary.signal_to_noise_ratio).toBeGreaterThan(0);
    expect(model.areas.auth_boundary.patterns[0]).toMatchObject({
      pattern: "withWorkspace",
      fact_count: 1,
      file_count: 1,
      accepted: true,
      candidate_only: false,
      priority: "high",
      report_surface: "priority"
    });
    expect(model.areas.request_validation.patterns.find((pattern) => pattern.pattern === "parseRequestBody")).toMatchObject({
      semantic_role: "body_parser",
      proof_truth: "candidate_only",
      priority: "low",
      report_surface: "inventory"
    });
    expect(model.areas.request_validation.patterns.find((pattern) => pattern.pattern === "createOAuthAppSchema.parseAsync")).toMatchObject({
      semantic_role: "validator",
      report_surface: "inventory"
    });
    expect(model.areas.rate_limit.patterns.find((pattern) => pattern.pattern === "exceededLimitError")).toMatchObject({
      semantic_role: "error_helper",
      proof_truth: "candidate_only",
      report_surface: "inventory"
    });
    expect(model.areas.sensitive_response.patterns.find((pattern) => pattern.pattern === "accessToken")).toMatchObject({
      semantic_role: "sensitive_field",
      priority: "medium",
      report_surface: "priority"
    });
    expect(model.areas.sensitive_response.patterns.find((pattern) => pattern.pattern === "success")).toMatchObject({
      semantic_role: "sensitive_field",
      priority: "low",
      report_surface: "inventory"
    });
    expect(model.areas.sensitive_response.patterns.find((pattern) => pattern.pattern === "sanitizeFullTextSearch")).toMatchObject({
      semantic_role: "response_field",
      proof_truth: "candidate_only",
      report_surface: "inventory"
    });
    expect(model.areas.ssrf.patterns[0]).toMatchObject({
      pattern: "request_input",
      fact_count: 1,
      priority: "high",
      report_surface: "priority"
    });
    expect(model.areas.authorization.patterns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: "accountApplicationDeauthorized" })
    ]));
    expect(model.areas.data_access.patterns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ pattern: "then" })
    ]));
    expect(model.areas.request_validation.priority_patterns.map((pattern) => pattern.pattern)).not.toContain("parseRequestBody");
    expect(model.areas.sensitive_response.priority_patterns.map((pattern) => pattern.pattern)).not.toContain("success");
    expect(model.areas.sensitive_response.priority_patterns.map((pattern) => pattern.pattern)).not.toContain("sanitizeFullTextSearch");
    expect(JSON.stringify(model)).not.toContain("source_value");
    expect(JSON.stringify(model)).not.toContain("https://token@example.com");
    expect(model.next_steps).toContain("Review candidate-only security patterns before accepting enforcement.");
  });

  it("does not label raw security facts as accepted proof without Rust proofs", () => {
    const model = buildSecurityArchitectureAudit({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      facts: [
        fact({ kind: "file_role_detected", file_path: "app/api/apps/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "request_validation_called", file_path: "app/api/apps/route.ts", name: "validateBody", start_line: 5 }),
        fact({ kind: "authorization_guard_called", file_path: "app/api/apps/route.ts", name: "requireAdmin", start_line: 6 }),
        fact({ kind: "tenant_guard_called", file_path: "app/api/apps/route.ts", name: "scopeWorkspace", start_line: 7 }),
        fact({ kind: "parameterized_sql_used", file_path: "app/api/apps/route.ts", name: "sql", start_line: 8 })
      ],
      candidates: [],
      accepted_conventions: [],
      parser_gaps: [],
      proofs: []
    });

    expect(model.areas.request_validation.patterns.find((pattern) => pattern.pattern === "validateBody")).toMatchObject({
      proof_truth: "fact_inventory",
      accepted: false
    });
    expect(model.areas.authorization.patterns.find((pattern) => pattern.pattern === "requireAdmin")).toMatchObject({
      proof_truth: "fact_inventory",
      accepted: false
    });
    expect(model.areas.tenant_scope.patterns.find((pattern) => pattern.pattern === "scopeWorkspace")).toMatchObject({
      proof_truth: "fact_inventory",
      accepted: false
    });
    expect(model.areas.raw_sql.patterns.find((pattern) => pattern.pattern === "sql")).toMatchObject({
      proof_truth: "fact_inventory",
      accepted: false
    });
  });
});
