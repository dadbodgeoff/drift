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

/**
 * A minimal security boundary proof naming one accepted convention as a matched contract.
 *
 * `contract_id` is the field that matters: the engine stamps it from `convention.id`
 * (check_command.rs), so it is what makes "this convention was evaluated" an exact statement
 * rather than "something of this kind was".
 */
function proofFor(conventionId: string) {
  return {
    proof_id: `proof_${conventionId}`,
    proof_version: "security-boundary-proof/v1",
    route: {
      route_id: "route_apps_get",
      file_path: "app/api/apps/route.ts",
      file_role: "api_route"
    },
    contracts: [{
      contract_id: conventionId,
      kind: "api_route_requires_auth_helper",
      enforcement_mode: "warn",
      capability: "deterministic_check",
      matched: true
    }],
    capability_status: [],
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
    }
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
      report_surface: "priority",
      // This case runs with `proofs: []` and always has. It used to report `accepted_proof`, which
      // was the fail-open: `proofBacked: true` was a literal on the seed, so acceptance WAS proof
      // and `input.proofs` decided nothing. Pinned here because the surrounding assertions were
      // all true before and after the fix - `accepted`, `priority` and `report_surface` are
      // unchanged - so nothing in this test would have noticed.
      proof_backed: false,
      proof_truth: "accepted_unproven"
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
  it("does not call an accepted convention proof-backed without a proof, and does with one", () => {
    // ITEM 3's claim, made as a matched pair so it can fail in both directions. A fix that reported
    // `accepted_unproven` for everything would satisfy the first half and be exactly as useless as
    // the fail-open it replaced.
    const conventionId = "convention_auth_workspace";
    const authFacts = [
      fact({ kind: "file_role_detected", file_path: "app/api/apps/route.ts", name: "api_route", start_line: 1 }),
      fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "withWorkspace", start_line: 5 })
    ];
    const authConvention = accepted({
      id: conventionId,
      kind: "api_route_requires_auth_helper",
      statement: "Use withWorkspace.",
      matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withWorkspace"] },
      requires: { auth_helpers: [{ symbol: "withWorkspace" }] }
    });
    const build = (proofs: unknown[]) => buildSecurityArchitectureAudit({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      facts: authFacts,
      candidates: [],
      accepted_conventions: [authConvention],
      parser_gaps: [],
      proofs: proofs as never
    });

    const unproven = build([]).areas.auth_boundary.patterns.find(
      (pattern) => pattern.pattern === "withWorkspace"
    );
    expect(unproven).toMatchObject({
      accepted: true,
      accepted_convention_ids: [conventionId],
      proof_backed: false,
      proof_truth: "accepted_unproven"
    });
    // Still `high` priority, and that is not an oversight: an accepted rule with nothing behind it
    // is the MORE urgent of the two states, because someone is relying on it. Demoting it would
    // move it off the priority surface, which is the last thing this fix should do.
    expect(unproven?.priority).toBe("high");

    const proven = build([proofFor(conventionId)]).areas.auth_boundary.patterns.find(
      (pattern) => pattern.pattern === "withWorkspace"
    );
    expect(proven).toMatchObject({
      accepted: true,
      proof_backed: true,
      proof_truth: "accepted_proof"
    });
  });

  it("attributes proofs by convention id, not by kind", () => {
    // Two accepted conventions of the SAME kind, one proved. Attribution by kind would mark both
    // proof-backed off one proof, which is the fail-open in a narrower disguise - and the disguise
    // a "just check the proofs list" fix falls into, because every proof carries a `kind` and only
    // some readers notice it also carries the `contract_id` the engine stamped from `convention.id`.
    const model = buildSecurityArchitectureAudit({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      facts: [
        fact({ kind: "file_role_detected", file_path: "app/api/apps/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "withWorkspace", start_line: 5 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "withSession", start_line: 6 })
      ],
      candidates: [],
      accepted_conventions: [
        accepted({
          id: "convention_proved",
          kind: "api_route_requires_auth_helper",
          statement: "Use withWorkspace.",
          matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withWorkspace"] },
          requires: { auth_helpers: [{ symbol: "withWorkspace" }] }
        }),
        accepted({
          id: "convention_unproved",
          kind: "api_route_requires_auth_helper",
          statement: "Use withSession.",
          matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withSession"] },
          requires: { auth_helpers: [{ symbol: "withSession" }] }
        })
      ],
      parser_gaps: [],
      proofs: [proofFor("convention_proved")] as never
    });

    const byPattern = new Map(
      model.areas.auth_boundary.patterns.map((pattern) => [pattern.pattern, pattern])
    );
    expect(byPattern.get("withWorkspace")?.proof_truth).toBe("accepted_proof");
    expect(byPattern.get("withSession")?.proof_truth).toBe("accepted_unproven");
  });

  it("counts a FAILED proof as proof-backing, because a violation is a measurement", () => {
    // The opposite over-correction, and it is easy to write by accident: requiring
    // `proof_status === "proven"` would report every convention that actually CAUGHT something as
    // unproven, which is the fail-open inverted. `matched` is the right predicate - it says this
    // convention was evaluated against this route - and the verdict belongs to the finding.
    const model = buildSecurityArchitectureAudit({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      facts: [
        fact({ kind: "file_role_detected", file_path: "app/api/apps/route.ts", name: "api_route", start_line: 1 }),
        fact({ kind: "symbol_called", file_path: "app/api/apps/route.ts", name: "withWorkspace", start_line: 5 })
      ],
      candidates: [],
      accepted_conventions: [
        accepted({
          id: "convention_caught_one",
          kind: "api_route_requires_auth_helper",
          statement: "Use withWorkspace.",
          matcher: { kind: "api_route_requires_auth_helper", required_calls: ["withWorkspace"] },
          requires: { auth_helpers: [{ symbol: "withWorkspace" }] }
        })
      ],
      parser_gaps: [],
      proofs: [
        {
          ...proofFor("convention_caught_one"),
          result: {
            proof_status: "unproven",
            enforcement_result: "block",
            can_block: true,
            finding_ids: ["finding_abc"]
          }
        }
      ] as never
    });

    expect(
      model.areas.auth_boundary.patterns.find((pattern) => pattern.pattern === "withWorkspace")
    ).toMatchObject({ proof_backed: true, proof_truth: "accepted_proof" });
  });
});
