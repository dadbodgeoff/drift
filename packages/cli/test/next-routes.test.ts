import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { API_ROUTE_SCOPE_GLOBS, type AcceptedConvention, type FactRecord, type RepoContract } from "@drift/core";
import { describe, expect, it } from "vitest";
import { filesForConvention } from "../src/check/diff.js";
import { inferConventionCandidates } from "../src/domain/convention-candidates.js";
import { relevantFilesForTask, requiredChecksForFiles, riskyAreasForFiles } from "../src/domain/preflight.js";
import { isApiRoutePath } from "../src/domain/repo-paths.js";

const apiRouteConvention: AcceptedConvention = {
  id: "conv_api_route_no_direct_data_access",
  contract_id: "contract_abc",
  kind: "api_route_no_direct_data_access",
  statement: "API routes should not import data access directly.",
  scope: {
    path_globs: ["**/app/api/**/route.ts"],
    file_roles: ["api_route"]
  },
  matcher: {
    kind: "api_route_no_direct_data_access",
    forbidden_imports: ["@/lib/prisma"],
    applies_to_file_roles: ["api_route"]
  },
  severity: "error",
  enforcement_mode: "block",
  enforcement_capability: "deterministic_check",
  exceptions: [],
  evidence_refs: [],
  counterexample_refs: [],
  accepted_by: "tester",
  accepted_at: "2026-05-28T00:00:00.000Z",
  updated_at: "2026-05-28T00:00:00.000Z"
};

describe("Next.js route group handling", () => {
  it("classifies grouped app api routes without classifying non-api app routes", () => {
    expect(isApiRoutePath("apps/web/app/(admin)/api/projects/route.ts")).toBe(true);
    expect(isApiRoutePath("apps/web/app/(marketing)/about/route.ts")).toBe(false);
  });

  it("applies legacy accepted api route scopes to grouped app api routes", () => {
    const files = filesForConvention(
      {
        files: [
          {
            path: "apps/web/app/(admin)/api/projects/route.ts",
            changedLines: new Set<number>()
          }
        ],
        deletedFiles: []
      },
      apiRouteConvention,
      "changed-files"
    );

    expect(files).toEqual(["apps/web/app/(admin)/api/projects/route.ts"]);
  });

  it("infers convention candidates with route-group-aware api route scope globs", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "drift-next-routes-"));
    const routePath = "apps/web/app/(admin)/api/projects/route.ts";
    await mkdir(join(repoRoot, "apps/web/app/(admin)/api/projects"), { recursive: true });
    await writeFile(join(repoRoot, routePath), "import { prisma } from '@/lib/prisma';\n");

    const candidates = inferConventionCandidates({
      repoId: "repo_abc",
      scanId: "scan_abc",
      repoRoot,
      now: "2026-05-28T00:00:00.000Z",
      facts: [
        fact("file_role_detected", routePath, "api_route"),
        fact("import_used", routePath, "prisma", "@/lib/prisma")
      ]
    });
    const directDataAccess = candidates.find((candidate) => candidate.kind === "api_route_no_direct_data_access");

    expect(directDataAccess?.scope).toEqual({
      path_globs: API_ROUTE_SCOPE_GLOBS,
      file_roles: ["api_route"]
    });
  });

  it("applies legacy preflight api-route scopes to grouped app api routes", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "drift-next-routes-"));
    const routePath = "apps/web/app/(admin)/api/projects/route.ts";
    await mkdir(join(repoRoot, "apps/web/app/(admin)/api/projects"), { recursive: true });
    await writeFile(join(repoRoot, routePath), "export async function GET() { return Response.json({ ok: true }); }\n");
    const contract = repoContractWithLegacyApiScope();
    const relevantFiles = relevantFilesForTask({
      repoRoot,
      task: "change projects api route",
      contract,
      targetPath: routePath
    });

    expect(relevantFiles).toContainEqual(expect.objectContaining({
      path: routePath,
      roles: ["api_route"]
    }));
    expect(requiredChecksForFiles(contract, relevantFiles)).toContainEqual(expect.objectContaining({
      matched_files: [routePath]
    }));
    expect(riskyAreasForFiles(contract, relevantFiles)).toContainEqual(expect.objectContaining({
      matched_files: [routePath]
    }));
  });
});

function fact(kind: FactRecord["kind"], filePath: string, name: string, value?: string): FactRecord {
  return {
    id: `fact_${kind}_${name}`,
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    kind,
    file_path: filePath,
    name,
    value,
    start_line: 1,
    end_line: 1,
    source_span: {
      start_line: 1,
      start_column: 1,
      end_line: 1,
      end_column: 1
    },
    ast_node_kind: null,
    extraction_method: "test",
    extractor_version: "test",
    parser_version: "test",
    confidence: 1,
    confidence_label: "certain",
    evidence_level: "ast",
    resolution_status: "resolved",
    staleness_status: "fresh",
    last_seen_scan_id: "scan_abc"
  };
}

function repoContractWithLegacyApiScope(): RepoContract {
  return {
    id: "contract_abc",
    repo_id: "repo_abc",
    contract_schema_version: 1,
    repo_fingerprint: "repo-fp",
    created_at: "2026-05-28T00:00:00.000Z",
    updated_at: "2026-05-28T00:00:00.000Z",
    conventions: [apiRouteConvention],
    rejected_inferences: [],
    waivers: [],
    risky_areas: [{
      id: "risk_api_routes",
      path_globs: ["apps/web/app/api/**/route.ts"],
      risk_kind: "data_access",
      reason: "API route changes can bypass data-access layering."
    }],
    safe_commands: [],
    required_checks: [{
      command: "drift check --diff main...HEAD",
      applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      reason: "Validate accepted API route conventions."
    }],
    context_egress: {
      default_mode: "local_only",
      denied_globs: [],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: []
  };
}
