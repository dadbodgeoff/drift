import { describe, expect, it } from "vitest";
import { GUIDANCE_BYTE_BUDGET, buildGuidanceView } from "@drift/core";

/**
 * BB-6. Measured composition of the 901,730-byte dub packet (compact JSON, 2026-08-03):
 * `parser_gaps` 358,538 B in 639 full records, `selected_conventions` 187,369 B of which 186,252 was
 * the same 397 findings the envelope already carries, `graph_context` 167,801 B, `findings` 94,486 B.
 * The agent-usage trial used 2 of 9 sections and dismissed `semantic_coverage`, `parser_gaps`,
 * `route_flows` and `risky_areas` as noise - the consumer they exist for.
 *
 * So this is a filtering job, not a compression job, and the budget is asserted in bytes because the
 * EW-8 lesson is that only byte assertions force real fixes.
 */

const convention = (overrides: Record<string, unknown> = {}) => ({
  id: "convention_abc",
  kind: "api_route_no_direct_data_access",
  statement: "API routes must not import the data layer directly.",
  scope: { path_globs: ["app/api/**"], exclude_path_globs: [], file_roles: ["api_route"] },
  matcher: { kind: "forbidden_imports", forbidden_imports: ["@/lib/prisma"] },
  enforcement_mode: "warn" as const,
  migration_sentence: "397 existing violations are baselined and do not block; new code is held to this rule.",
  conforming_examples: [{ file_path: "app/api/health/route.ts", role: "api_route" }],
  conforming_examples_reason: null,
  rationale: { derivation: "18 of 20 routes delegate.", reason: "Route modules are transport." },
  ...overrides
});

describe("BB-6 guidance view", () => {
  it("answers will-this-block as a boolean rather than leaving it to be inferred", () => {
    // The trials showed agents inferring it wrongly from the mode word: warn mode read as "not a real
    // rule", which is right about blocking and wrong about the rule.
    const warn = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [convention()],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: []
    });
    expect(warn.conventions[0].will_this_block).toBe(false);
    expect(warn.conventions[0].mode).toBe("warn");

    const block = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [convention({ enforcement_mode: "block" })],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: []
    });
    expect(block.conventions[0].will_this_block).toBe(true);
  });

  it("carries the exemplars and the migration sentence, and no evidence dump", () => {
    const view = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [convention()],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: []
    });
    expect(view.conventions[0].conforming_examples).toHaveLength(1);
    expect(view.conventions[0].migration_sentence).toContain("new code is held to this rule");
    // No evidence_refs: they are 186 KB of the same findings the envelope already carries.
    expect(JSON.stringify(view)).not.toContain("evidence_refs");
  });

  it("says what Drift has no opinion about", () => {
    const view = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [convention()],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: []
    });
    // An agent handed a list of rules infers the list is exhaustive and then reads silence as
    // approval. This is the line that says silence is silence.
    expect(view.not_covered).toContain("api_route_no_direct_data_access");
    expect(view.not_covered).toContain("silence, not approval");
  });

  it("says so when there is no convention at all, rather than emitting an empty view", () => {
    const view = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: []
    });
    expect(view.not_covered).toContain("no accepted convention");
    expect(view.conventions).toEqual([]);
  });

  it("summarizes parser gaps to at most three codes and no per-gap records", () => {
    const gaps = [
      ...Array.from({ length: 500 }, () => ({ code: "unresolved_import" })),
      ...Array.from({ length: 120 }, () => ({ code: "dynamic_route_segment" })),
      ...Array.from({ length: 12 }, () => ({ code: "namespace_import" })),
      ...Array.from({ length: 7 }, () => ({ code: "barrel_reexport" }))
    ];
    const view = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [],
      relevantFiles: [],
      requiredChecks: [],
      parserGaps: gaps
    });

    expect(view.parser_gaps.count).toBe(639);
    expect(view.parser_gaps.by_code).toHaveLength(3);
    // Count descending, then code ascending - a total order, because eval:determinism byte-compares.
    expect(view.parser_gaps.by_code).toEqual([
      { code: "unresolved_import", count: 500 },
      { code: "dynamic_route_segment", count: 120 },
      { code: "namespace_import", count: 12 }
    ]);
    expect(view.parser_gaps.full_list_command).toContain("drift doctor");
    // The count is kept honest even though the tail is dropped: 639 total, 3 kinds shown.
    expect(view.parser_gaps.count).toBeGreaterThan(
      view.parser_gaps.by_code.reduce((sum, entry) => sum + entry.count, 0)
    );
  });

  it("stays inside the 32 KB budget against a cal.com-scale worst case", () => {
    // cal.com's shape: ~2,500 parser gaps, many relevant files, many required checks. The budget must
    // hold without the caller having to know it exists.
    const view = buildGuidanceView({
      repoId: "repo_calcom",
      conventions: [convention(), convention({ id: "convention_def", kind: "api_route_requires_service_delegation" })],
      relevantFiles: Array.from({ length: 400 }, (_, index) => ({
        path: `apps/web/app/api/some/deeply/nested/route-${index}/route.ts`,
        reasons: ["matches task tokens", "same directory as target"]
      })),
      requiredChecks: Array.from({ length: 60 }, (_, index) => ({
        command: `pnpm test --filter package-${index}`,
        reason: "required_for_changed_files"
      })),
      parserGaps: Array.from({ length: 2_500 }, (_, index) => ({ code: `code_${index % 40}` }))
    });

    const bytes = Buffer.byteLength(JSON.stringify(view), "utf8");
    expect(bytes).toBeLessThanOrEqual(GUIDANCE_BYTE_BUDGET);
    // And the truncation is declared, not silent - a capped list that says nothing reads as complete.
    expect(view.truncated.relevant_files).toBe(true);
    expect(view.truncated.required_checks).toBe(true);
  });

  it("declares no truncation when nothing was dropped", () => {
    const view = buildGuidanceView({
      repoId: "repo_abc",
      conventions: [convention()],
      relevantFiles: [{ path: "app/api/a/route.ts", reasons: ["matches task"] }],
      requiredChecks: [{ command: "pnpm test", reason: "always" }],
      parserGaps: []
    });
    expect(view.truncated).toEqual({ conventions: false, relevant_files: false, required_checks: false });
  });
});
