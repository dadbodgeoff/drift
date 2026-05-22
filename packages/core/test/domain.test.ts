import { describe, expect, it } from "vitest";
import {
  AcceptedConventionSchema,
  DRIFT_CONTRACT_SCHEMA_VERSION,
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION,
  FindingSchema,
  RepoContractSchema,
  authorizeContextExport,
  canonicalRepoContractJson,
  canonicalScanStateJson,
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
    expect(DRIFT_CONTRACT_SCHEMA_VERSION).toBe(1);
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
});
