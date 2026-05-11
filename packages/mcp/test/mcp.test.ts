import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import {
  DRIFT_READ_ONLY_MCP_TOOLS,
  createReadOnlyMcpHandlers,
  handleMcpJsonRpcRequest
} from "../src/index.js";

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
    adapter_versions: { typescript: "0.0.1" },
    rule_engine_version: "0.0.1",
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
    safe_commands: [{
      command: "pnpm test",
      reason: "Run project tests after changing API routes.",
      requires_explicit_run: true
    }],
    required_checks: [{
      command: "drift check --diff main...HEAD",
      applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      reason: "Validate accepted API route conventions."
    }],
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
  storage.upsertFinding({
    id: "finding_suppressed",
    repo_id: "repo_abc",
    convention_id: "convention_no_direct_db",
    fingerprint: "finding-suppressed-fp",
    title: "Suppressed legacy violation",
    message: "Legacy route imports prisma directly.",
    severity: "warning",
    enforcement_result: "warn",
    status: "suppressed",
    diff_status: "outside_diff",
    evidence_refs: [],
    created_at: "2026-05-10T00:00:05.500Z"
  });
  storage.upsertBaselineViolation({
    id: "baseline_abc",
    repo_id: "repo_abc",
    convention_id: "convention_no_direct_db",
    finding_fingerprint: "finding-fp",
    file_path: "apps/web/app/api/users/route.ts",
    first_seen_scan_id: "scan_abc",
    first_seen_commit: "abc123",
    status: "active",
    created_at: "2026-05-10T00:00:06.000Z"
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
      latest_scan: { id: "scan_abc" },
      stale: true,
      invalidation_reasons: [
        "adapter_version_changed:typescript",
        "rule_engine_version_changed"
      ]
    });
    expect(handlers.get_repo_contract({ repo_id: "repo_abc" })).toMatchObject({
      contract: { id: "contract_abc" }
    });
    expect(handlers.get_task_preflight({ repo_id: "repo_abc", task: "add users route" })).toMatchObject({
      contract: {
        id: "contract_abc",
        schema_version: 1
      },
      policy: { allowed: true, surface: "mcp" },
      conventions: [{ id: "convention_no_direct_db" }],
      baseline: { active_count: 1 },
      findings: [{ id: "finding_abc" }],
      required_checks: [{ command: "drift check --diff main...HEAD" }],
      safe_commands: [{ command: "pnpm test" }],
      redactions: {
        denied_globs: [".env*", "**/*.pem"],
        snippets_included: false
      },
      next_commands: [
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json",
        "drift findings list --repo repo_abc --json"
      ]
    });
    expect(handlers.get_conventions({ repo_id: "repo_abc" })).toMatchObject({
      conventions: [{ id: "convention_no_direct_db" }]
    });
    expect(handlers.get_findings({ repo_id: "repo_abc" })).toMatchObject({
      summary: {
        total_count: 2,
        filtered_count: 2,
        by_status: {
          new: 1,
          suppressed: 1
        },
        by_severity: {
          error: 1,
          warning: 1
        }
      },
      findings: [{ id: "finding_abc" }, { id: "finding_suppressed" }]
    });
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      status: "new",
      severity: "error"
    })).toMatchObject({
      summary: {
        total_count: 2,
        filtered_count: 1
      },
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

  it("exposes a read-only JSON-RPC tools/list and tools/call surface", async () => {
    const databasePath = await seedMcpDatabase();

    const initialized = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    });
    const listed = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    const called = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_task_preflight",
        arguments: {
          repo_id: "repo_abc",
          task: "add users route"
        }
      }
    });
    const rejected = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "accept_convention",
        arguments: {
          repo_id: "repo_abc"
        }
      }
    });

    expect(initialized?.result).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: "drift-local" }
    });
    expect(listed?.result).toMatchObject({
      tools: DRIFT_READ_ONLY_MCP_TOOLS
    });
    expect(DRIFT_READ_ONLY_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "get_scan_status",
      "get_repo_contract",
      "get_task_preflight",
      "get_conventions",
      "get_findings",
      "get_allowed_context"
    ]);
    expect(called?.result).toMatchObject({
      content: [{ type: "text" }],
      isError: false
    });
    const text = (called?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(text)).toMatchObject({
      repo_id: "repo_abc",
      policy: { allowed: true },
      contract: { id: "contract_abc" },
      baseline: { active_count: 1 },
      conventions: [{ id: "convention_no_direct_db" }]
    });
    expect(rejected?.error?.message).toContain("Unknown read-only Drift MCP tool");
  });
});
