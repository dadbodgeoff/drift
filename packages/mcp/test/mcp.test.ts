import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { createReadOnlyMcpHandlers } from "../src/index.js";

const tempDirs: string[] = [];

async function seedMcpDatabase(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-mcp-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "drift.sqlite");
  const storage = openDriftStorage({ databasePath });
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
    file_count: 1,
    fact_count: 2,
    finding_count: 1,
    started_at: "2026-05-10T00:00:01.000Z",
    completed_at: "2026-05-10T00:00:02.000Z"
  });
  const convention = {
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
    accepted_at: "2026-05-10T00:00:03.000Z",
    updated_at: "2026-05-10T00:00:03.000Z"
  };
  storage.upsertAcceptedConvention("repo_abc", convention);
  storage.upsertRepoContract({
    id: "contract_abc",
    repo_id: "repo_abc",
    contract_schema_version: 1,
    repo_fingerprint: "repo-fp",
    created_at: "2026-05-10T00:00:04.000Z",
    updated_at: "2026-05-10T00:00:04.000Z",
    conventions: [convention],
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
  storage.upsertFinding({
    id: "finding_abc",
    repo_id: "repo_abc",
    convention_id: "convention_no_direct_db",
    fingerprint: "finding-fp",
    title: "API route imports data access directly",
    message: "Route imports prisma directly.",
    severity: "error",
    enforcement_result: "block",
    status: "new",
    diff_status: "new_in_diff",
    evidence_refs: [],
    created_at: "2026-05-10T00:00:05.000Z"
  });
  storage.close();
  return databasePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("read-only MCP handlers", () => {
  it("returns scan, contract, preflight, findings, and policy context without mutating state", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(handlers.get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      scan_count: 1,
      latest_scan: { id: "scan_abc" }
    });
    expect(handlers.get_repo_contract({ repo_id: "repo_abc" })).toMatchObject({
      contract: { id: "contract_abc" }
    });
    expect(handlers.get_task_preflight({ repo_id: "repo_abc", task: "add users route" })).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
      conventions: [{ id: "convention_no_direct_db" }],
      findings: [{ id: "finding_abc" }]
    });
    expect(handlers.get_conventions({ repo_id: "repo_abc" })).toMatchObject({
      conventions: [{ id: "convention_no_direct_db" }]
    });
    expect(handlers.get_findings({ repo_id: "repo_abc" })).toMatchObject({
      findings: [{ id: "finding_abc" }]
    });
    expect(handlers.get_allowed_context({ repo_id: "repo_abc", path: ".env.local" })).toMatchObject({
      decision: { allowed: false, mode: "denied" }
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listAuditEvents("repo_abc")).toHaveLength(0);
    storage.close();
  });
});
