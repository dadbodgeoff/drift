import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  const repoRoot = join(dir, "repo");
  await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/web/app/api/users/route.ts"),
    "export async function GET() { return Response.json({ ok: true }); }\n"
  );
  const databasePath = join(dir, "drift.sqlite");
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertRepo({
    id: "repo_abc",
    root_path: repoRoot,
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
    risky_areas: [{
      id: "risk_user_api",
      path_globs: ["apps/web/app/api/users/**"],
      risk_kind: "data_access",
      reason: "User API routes touch persisted user data."
    }],
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
  it("reports source-file staleness in scan status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-mcp-status-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    const initialSource = "export async function GET() { return Response.json({ ok: true }); }\n";
    await writeFile(routePath, initialSource);

    const databasePath = join(dir, "drift.sqlite");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: repoRoot,
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "unknown",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: createHash("sha256").update(initialSource).digest("hex"),
      byte_size: Buffer.byteLength(initialSource),
      indexed: true
    });
    storage.close();

    await writeFile(routePath, "export async function GET() { return Response.json({ changed: true }); }\n");

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      stale: true,
      invalidation_reasons: [],
      changes: {
        added: [],
        modified: ["apps/web/app/api/users/route.ts"],
        deleted: []
      }
    });
  });

  it("refuses scan status for an unknown repo id", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(() => handlers.get_scan_status({ repo_id: "repo_missing" }))
      .toThrow("Unknown repo repo_missing");
  });

  it("reports missing repo roots as stale in scan status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-mcp-missing-root-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "drift.sqlite");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: join(dir, "missing-repo"),
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "unknown",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "not-used-by-test",
      byte_size: 64,
      indexed: true
    });
    storage.close();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      stale: true,
      invalidation_reasons: ["repo_root_missing"],
      changes: {
        added: [],
        modified: [],
        deleted: ["apps/web/app/api/users/route.ts"]
      }
    });
  });

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
      policy: { allowed: true, surface: "mcp" },
      contract: { id: "contract_abc" }
    });
    const preflight = handlers.get_task_preflight({ repo_id: "repo_abc", task: "add users route" }) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(preflight).toMatchObject({
      contract: {
        id: "contract_abc",
        schema_version: 1
      },
      policy: { allowed: true, surface: "mcp" },
      conventions: [{ id: "convention_no_direct_db" }],
      scan_status: {
        stale: true,
        invalidation_reasons: [
          "adapter_version_changed:typescript",
          "rule_engine_version_changed"
        ]
      },
      baseline: { active_count: 1 },
      findings: [{ id: "finding_abc" }],
      risky_areas: [{
        id: "risk_user_api",
        risk_kind: "data_access",
        reason: "User API routes touch persisted user data."
      }],
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
    expect(preflight.findings[0]).toMatchObject({
      id: "finding_abc",
      convention_id: "convention_no_direct_db",
      severity: "error",
      status: "new",
      diff_status: "new_in_diff",
      enforcement_result: "block"
    });
    expect(preflight.findings[0]).not.toHaveProperty("message");
    expect(preflight.findings[0]).not.toHaveProperty("evidence_refs");
    expect(handlers.get_conventions({ repo_id: "repo_abc" })).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
      conventions: [{ id: "convention_no_direct_db" }]
    });
    expect(handlers.get_findings({ repo_id: "repo_abc" })).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
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
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      status: "open" as never
    })).toThrow("status must be");
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      severity: "critical" as never
    })).toThrow("severity must be");
    expect(handlers.get_allowed_context({ repo_id: "repo_abc", path: ".env.local" })).toMatchObject({
      decision: { allowed: false, mode: "denied" }
    });
    expect(handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      requested_snippet_chars: 5000
    } as never)).toMatchObject({
      decision: {
        allowed: true,
        mode: "redacted",
        max_snippet_chars: 1200,
        approved_snippet_chars: 1200
      }
    });
    expect(handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      request_full_file_content: true
    } as never)).toMatchObject({
      decision: {
        allowed: false,
        mode: "denied",
        reason: "full file content is denied by repo policy"
      }
    });
    expect(() => handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      surface: "email" as never
    })).toThrow("surface must be");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listAuditEvents("repo_abc")).toHaveLength(0);
    storage.close();
  });

  it("returns a stale MCP preflight when the repo root is missing", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const repoRoot = storage.getRepo("repo_abc")!.root_path;
    storage.close();
    await rm(repoRoot, { recursive: true, force: true });

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({ repo_id: "repo_abc", task: "add users route" });

    expect(preflight).toMatchObject({
      repo_id: "repo_abc",
      scan_status: {
        stale: true,
        invalidation_reasons: [
          "repo_root_missing",
          "adapter_version_changed:typescript",
          "rule_engine_version_changed"
        ],
        changes: {
          added: [],
          modified: [],
          deleted: []
        }
      },
      relevant_files: [],
      risky_areas: [],
      redactions: {
        excluded_file_count: 0,
        snippets_included: false
      }
    });
  });

  it("omits expired conventions from MCP preflight", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const convention = storage.listAcceptedConventions("repo_abc")[0]!;
    const expiredConvention = {
      ...convention,
      expires_at: "2026-05-10T00:00:20.000Z"
    };
    storage.upsertAcceptedConvention("repo_abc", expiredConvention);
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [expiredConvention]
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({ repo_id: "repo_abc", task: "add users route" }) as {
        conventions: unknown[];
      };

    expect(preflight.conventions).toEqual([]);
  });

  it("omits accepted drift findings from MCP preflight", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_accepted_drift",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-accepted-drift-fp",
      title: "Accepted legacy route",
      message: "Accepted direct data-access import.",
      severity: "error",
      enforcement_result: "block",
      status: "accepted_drift",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:05.750Z"
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({ repo_id: "repo_abc", task: "add users route" }) as {
        findings: Array<{ id: string }>;
      };

    expect(preflight.findings.map((finding) => finding.id)).toEqual(["finding_abc"]);
  });

  it("denies MCP repo context when policy requires approval", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc");
    storage.upsertRepoContract({
      ...contract!,
      context_egress: {
        ...contract!.context_egress,
        default_mode: "approval_required"
      }
    });
    storage.close();

    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(handlers.get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      policy: {
        allowed: false,
        surface: "mcp",
        mode: "approval_required"
      }
    });
    expect(() => handlers.get_task_preflight({
      repo_id: "repo_abc",
      task: "add users route"
    })).toThrow("Policy denied MCP output");
    expect(() => handlers.get_repo_contract({ repo_id: "repo_abc" }))
      .toThrow("Policy denied MCP output");
    expect(() => handlers.get_findings({ repo_id: "repo_abc" }))
      .toThrow("Policy denied MCP output");
    expect(handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts"
    })).toMatchObject({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      decision: {
        allowed: false,
        surface: "mcp",
        mode: "approval_required"
      }
    });
  });

  it("refuses contract-backed MCP tools for an unknown repo id", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(() => handlers.get_repo_contract({ repo_id: "repo_missing" }))
      .toThrow("Unknown repo repo_missing");
    expect(() => handlers.get_task_preflight({ repo_id: "repo_missing", task: "add route" }))
      .toThrow("Unknown repo repo_missing");
    expect(() => handlers.get_conventions({ repo_id: "repo_missing" }))
      .toThrow("Unknown repo repo_missing");
    expect(() => handlers.get_findings({ repo_id: "repo_missing" }))
      .toThrow("Unknown repo repo_missing");
    expect(() => handlers.get_allowed_context({ repo_id: "repo_missing", path: "apps/web/app/api/users/route.ts" }))
      .toThrow("Unknown repo repo_missing");
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
    const missingRequired = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_task_preflight",
        arguments: {
          repo_id: "repo_abc"
        }
      }
    });
    const extraArgument = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_scan_status",
        arguments: {
          repo_id: "repo_abc",
          mutate: true
        }
      }
    });
    const invalidNumber = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "apps/web/app/api/users/route.ts",
          requested_snippet_chars: "5000"
        }
      }
    });
    const invalidNegativeNumber = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "apps/web/app/api/users/route.ts",
          requested_snippet_chars: -1
        }
      }
    });
    const invalidFractionalNumber = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "apps/web/app/api/users/route.ts",
          requested_snippet_chars: 12.5
        }
      }
    });
    const invalidBoolean = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "apps/web/app/api/users/route.ts",
          request_full_file_content: "true"
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
    expect(missingRequired?.error?.message).toContain("Invalid arguments for get_task_preflight: missing required field task.");
    expect(extraArgument?.error?.message).toContain("Invalid arguments for get_scan_status: unexpected field mutate.");
    expect(invalidNumber?.error?.message).toContain("Invalid arguments for get_allowed_context: field requested_snippet_chars must be a number.");
    expect(invalidNegativeNumber?.error?.message).toContain("Invalid arguments for get_allowed_context: field requested_snippet_chars must be a positive integer.");
    expect(invalidFractionalNumber?.error?.message).toContain("Invalid arguments for get_allowed_context: field requested_snippet_chars must be a positive integer.");
    expect(invalidBoolean?.error?.message).toContain("Invalid arguments for get_allowed_context: field request_full_file_content must be a boolean.");
  });
});
