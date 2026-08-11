import { describe, expect, it } from "vitest";
import { buildReadiness } from "../src/readiness.js";
import { buildParserGapQuality } from "../src/parser-gap-quality.js";

describe("parser gap quality", () => {
  it("summarizes blocking parser gaps with user action and samples", () => {
    const gap = {
      schema_version: "drift.parser_gap.v2" as const,
      parser_gap_id: "gap_dynamic_route",
      repo_id: "repo_1",
      scan_id: "scan_1",
      kind: "dynamic_import_unresolved" as const,
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 4,
      end_line: 8,
      confidence_impact: "blocks_enforcement" as const,
      message: "Dynamic route import is unsupported.",
      evidence_refs: ["evidence_1"],
      affected_capabilities: ["route_flow"],
      affected_contract_kinds: ["api_route_no_direct_data_access" as const],
      suggested_action: "rewrite_static" as const
    };
    const readiness = buildReadiness({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [gap]
    });

    expect(buildParserGapQuality({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      parser_gaps: [gap],
      readiness
    })).toMatchObject({
      schema_version: "drift.parser_gap_quality.v1",
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      total_count: 1,
      blocking_count: 1,
      advisory_count: 0,
      by_kind: { dynamic_import_unresolved: 1 },
      by_capability: { route_flow: 1 },
      by_contract_kind: { api_route_no_direct_data_access: 1 },
      top_actions: [{ suggested_action: "rewrite_static", count: 1 }],
      sample_gaps: [{
        parser_gap_id: "gap_dynamic_route",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 4,
        end_line: 8,
        kind: "dynamic_import_unresolved",
        confidence_impact: "blocks_enforcement",
        suggested_action: "rewrite_static",
        affected_capabilities: ["route_flow"],
        affected_contract_kinds: ["api_route_no_direct_data_access"],
        message: "Dynamic route import is unsupported."
      }],
      decision: "refuse",
      user_action: "Resolve blocking parser gaps before enabling blocking enforcement."
    });
  });

  it("maps v1 parser gaps to deterministic suggested actions", () => {
    const gap = {
      schema_version: "drift.parser_gap.v1" as const,
      gap_id: "parser_gap_unresolved_users",
      repo_id: "repo_1",
      scan_id: "scan_1",
      kind: "unresolved_import" as const,
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      confidence_impact: "lowers_flow" as const,
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-31T00:00:00.000Z"
    };
    const readiness = buildReadiness({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [gap]
    });
    const quality = buildParserGapQuality({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      parser_gaps: [gap],
      readiness
    });

    expect(quality).toMatchObject({
      total_count: 1,
      blocking_count: 0,
      advisory_count: 1,
      by_capability: {},
      by_contract_kind: {},
      decision: "advisory_only",
      user_action: "Review advisory parser gaps; blocking enforcement remains limited to complete evidence."
    });
    expect(quality.sample_gaps[0]).toMatchObject({
      parser_gap_id: "parser_gap_unresolved_users",
      suggested_action: "Resolve the import or add resolver configuration, then rerun drift scan."
    });
  });

  it("returns empty quality for clean scans", () => {
    const readiness = buildReadiness({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      graph_available: true,
      graph_complete: true,
      parser_gaps: []
    });

    expect(buildParserGapQuality({
      repo_id: "repo_1",
      scan_id: "scan_1",
      surface: "scan_status",
      parser_gaps: [],
      readiness
    })).toMatchObject({
      schema_version: "drift.parser_gap_quality.v1",
      total_count: 0,
      blocking_count: 0,
      advisory_count: 0,
      by_kind: {},
      by_capability: {},
      by_contract_kind: {},
      top_actions: [],
      sample_gaps: [],
      decision: "blocking_allowed",
      user_action: "No parser gap action required."
    });
  });
});
