import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "../src/index.js";

const tempDirs: string[] = [];

async function tempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-storage-"));
  tempDirs.push(dir);
  return join(dir, "drift.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SQLite Drift storage", () => {
  it("applies schema migrations into SQLite", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });

    storage.migrate();

    expect(storage.getAppliedMigrations()).toEqual([
      "001_initial_local_state",
      "002_scan_facts",
      "003_repo_contracts_and_conventions"
    ]);
    storage.close();
  });

  it("persists repo, scan, findings, and baselines as queryable database rows", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 10,
      fact_count: 20,
      finding_count: 1,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    storage.upsertFinding({
      id: "finding_abc",
      repo_id: "repo_abc",
      convention_id: "convention_abc",
      fingerprint: "finding-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertBaselineViolation({
      id: "baseline_abc",
      repo_id: "repo_abc",
      convention_id: "convention_abc",
      finding_fingerprint: "finding-fp",
      file_path: "apps/web/app/api/users/route.ts",
      first_seen_scan_id: "scan_abc",
      first_seen_commit: "abc123",
      status: "active",
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.upsertFacts([
      {
        id: "fact_import_prisma",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "import_used",
        file_path: "apps/web/app/api/users/route.ts",
        name: "prisma",
        value: "@/lib/prisma",
        start_line: 1,
        end_line: 1
      },
      {
        id: "fact_api_role",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "apps/web/app/api/users/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1
      }
    ]);

    expect(storage.getRepo("repo_abc")?.fingerprint).toBe("repo-fp");
    expect(storage.getScanManifest("scan_abc")?.adapter_versions).toEqual({ typescript: "0.1.0" });
    expect(storage.listFacts("scan_abc", { kind: "import_used" })).toEqual([
      {
        id: "fact_import_prisma",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "import_used",
        file_path: "apps/web/app/api/users/route.ts",
        name: "prisma",
        value: "@/lib/prisma",
        start_line: 1,
        end_line: 1
      }
    ]);
    expect(storage.listFindings("repo_abc")).toHaveLength(1);
    expect(storage.listBaselineViolations("repo_abc")).toHaveLength(1);
    storage.close();
  });

  it("keeps audit events append-only", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.appendAuditEvent({
      id: "audit_event_abc",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "repo_added",
      target_type: "repo",
      target_id: "repo_abc",
      metadata: { root_path: "/repo" },
      created_at: "2026-05-10T00:00:00.000Z"
    });

    expect(() => storage.appendAuditEvent({
      id: "audit_event_abc",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "policy_changed",
      target_type: "policy",
      target_id: "policy_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:01.000Z"
    })).toThrow(/append-only/i);
    expect(storage.listAuditEvents("repo_abc")).toHaveLength(1);
    storage.close();
  });

  it("persists convention candidates, accepted conventions, and repo contracts in SQLite", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });

    storage.upsertConventionCandidate({
      id: "candidate_no_direct_db",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route_no_direct_data_access",
      statement: "API routes should not import data-access clients directly.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_no_direct_data_access",
        forbidden_imports: ["@/lib/prisma"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "error",
      suggested_enforcement_mode: "block",
      enforcement_capability: "deterministic_check",
      confidence_label: "high",
      scoring: {
        supporting_examples_count: 12,
        counterexamples_count: 0,
        scope_files_count: 12,
        coverage_ratio: 1,
        heuristic_id: "direct-data-access-import-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "candidate",
      created_at: "2026-05-10T00:00:01.000Z"
    });

    const acceptedConvention = {
      id: "convention_no_direct_db",
      contract_id: "contract_abc",
      kind: "api_route_no_direct_data_access" as const,
      statement: "API routes must not import data-access clients directly.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route" as const] },
      matcher: {
        kind: "api_route_no_direct_data_access" as const,
        forbidden_imports: ["@/lib/prisma"],
        applies_to_file_roles: ["api_route" as const]
      },
      severity: "error" as const,
      enforcement_mode: "block" as const,
      enforcement_capability: "deterministic_check" as const,
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-10T00:00:02.000Z",
      updated_at: "2026-05-10T00:00:02.000Z"
    };
    storage.upsertAcceptedConvention("repo_abc", acceptedConvention);

    storage.upsertRepoContract({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:03.000Z",
      updated_at: "2026-05-10T00:00:03.000Z",
      conventions: [acceptedConvention],
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

    expect(storage.listConventionCandidates("repo_abc", { status: "candidate" })).toHaveLength(1);
    expect(storage.listAcceptedConventions("repo_abc")[0]?.id).toBe("convention_no_direct_db");
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.id).toBe("convention_no_direct_db");
    storage.close();
  });
});
