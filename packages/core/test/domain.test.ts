import { describe, expect, it } from "vitest";
import {
  AcceptedConventionSchema,
  FindingSchema,
  RepoContractSchema,
  authorizeContextExport,
  makeDriftId
} from "../src/index.js";

describe("core domain", () => {
  it("creates stable prefixed ids", () => {
    expect(makeDriftId("convention", "abc123")).toBe("convention_abc123");
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
    expect(authorizeContextExport(contract, "cli-preflight", { path: "src/app/api/users/route.ts" })).toMatchObject({
      allowed: true,
      mode: "local_only",
      surface: "cli-preflight",
      max_snippet_chars: 1200
    });
  });
});
