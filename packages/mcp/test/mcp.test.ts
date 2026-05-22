import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { openDriftStorage } from "@drift/storage";
import {
  DRIFT_READ_ONLY_MCP_TOOLS,
  createReadOnlyMcpHandlers,
  handleMcpJsonRpcRequest,
  resolveMcpDatabasePath,
  runMcpCli,
  runReadOnlyMcpStdioServer
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
  storage.upsertFileSnapshot({
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    file_path: "apps/web/app/api/users/route.ts",
    content_hash: "b".repeat(64),
    byte_size: 66,
    indexed: true
  });
  storage.upsertFacts([
    {
      id: "fact_file_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "file_detected",
      file_path: "apps/web/app/api/users/route.ts",
      name: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1
    },
    {
      id: "fact_role_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "file_role_detected",
      file_path: "apps/web/app/api/users/route.ts",
      name: "api_route",
      start_line: 1,
      end_line: 1
    },
    {
      id: "fact_export_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "exported_symbol",
      file_path: "apps/web/app/api/users/route.ts",
      name: "GET",
      start_line: 1,
      end_line: 1
    },
    {
      id: "fact_call_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "symbol_called",
      file_path: "apps/web/app/api/users/route.ts",
      name: "Response.json",
      start_line: 1,
      end_line: 1
    }
  ]);
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
    evidence_refs: [{
      id: "evidence_finding_abc",
      kind: "violation",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      symbol: "prisma",
      import_source: "@/lib/prisma",
      fact_ids: ["fact_import_abc"],
      scan_id: "scan_abc",
      file_hash: "a".repeat(64),
      redaction_state: "none"
    }],
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
  storage.appendAuditEvent({
    id: "audit_event_seed_repo_abc",
    repo_id: "repo_abc",
    actor: "local-user",
    action: "repo_added",
    target_type: "repo",
    target_id: "repo_abc",
    metadata: { source: "mcp-fixture" },
    created_at: "2026-05-10T00:00:07.000Z"
  });
  storage.close();
  return databasePath;
}

async function runMcpStdio(databasePath: string, lines: string[]): Promise<{
  stdout: string[];
  stderr: string;
}> {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  output.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  error.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const running = runReadOnlyMcpStdioServer({
    databasePath
  }, {
    input,
    output,
    error
  });
  for (const line of lines) {
    input.write(`${line}\n`);
  }
  input.end();
  await running;

  return {
    stdout: Buffer.concat(stdoutChunks)
      .toString("utf8")
      .split("\n")
      .filter(Boolean),
    stderr: Buffer.concat(stderrChunks).toString("utf8")
  };
}

async function runMcpCliWithLines(
  argv: string[],
  env: { DRIFT_DB?: string | undefined },
  lines: string[]
): Promise<{
  exitCode: number;
  stdout: string[];
  stderr: string;
}> {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  output.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  error.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const running = runMcpCli(argv, env, { input, output, error });
  for (const line of lines) {
    input.write(`${line}\n`);
  }
  input.end();
  const result = await running;

  return {
    exitCode: result.exitCode,
    stdout: Buffer.concat(stdoutChunks)
      .toString("utf8")
      .split("\n")
      .filter(Boolean),
    stderr: Buffer.concat(stderrChunks).toString("utf8")
  };
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
      scan_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      audit_integrity: {
        valid: true,
        event_count: 0,
        head_event_hash: null
      },
      indexed_file_count: 1,
      source_change_count: 1,
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

  it("matches CLI scan-status branch invalidation semantics", async () => {
    const databasePath = await seedMcpDatabase();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      current_branch: "unknown",
      stale: true,
      invalidation_reasons: expect.arrayContaining([
        "branch_changed",
        "adapter_version_changed:typescript",
        "rule_engine_version_changed"
      ])
    });
  });

  it("returns scan, contract, preflight, findings, and policy context without mutating state", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(handlers.get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      scan_count: 1,
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        latest_scan_id: "scan_abc",
        scan_count: 1,
        indexed_file_count: 1,
        source_change_count: 1,
        stale: true,
        invalidation_count: 3,
        audit_valid: true
      },
      current_branch: "unknown",
      latest_scan: { id: "scan_abc" },
      scan_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      indexed_file_count: 1,
      source_change_count: 1,
      stale: true,
      invalidation_reasons: [
        "branch_changed",
        "adapter_version_changed:typescript",
        "rule_engine_version_changed"
      ],
      next_command: expect.stringContaining("drift scan --repo-root"),
      next_commands: [
        expect.stringContaining("drift scan --repo-root"),
        expect.stringContaining("drift doctor --repo-root")
      ]
    });
    expect(handlers.get_capabilities({})).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      capabilities: {
        read_only_cli: expect.arrayContaining(["prepare", "check"]),
        human_confirmed_cli: expect.arrayContaining([
          "conventions reject --confirm",
          "conventions edit --confirm",
          "findings mark-fixed --confirm",
          "findings mark-needs-review --confirm",
          "policy set-egress --confirm",
          "policy agent grant --confirm",
          "policy agent revoke --confirm",
          "restore --confirm"
        ]),
        mcp_read_only_tools: expect.arrayContaining(["get_runtime_info", "get_capabilities", "get_audit_status"]),
        mcp_mutation_tools: [],
        supported_wedge: {
          storage: "sqlite"
        }
      }
    });
    expect(handlers.get_audit_status({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      policy: { allowed: true, surface: "log" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      audit_integrity: {
        valid: true,
        event_count: 1,
        head_event_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        broken_at_event_id: null,
        reasons: []
      },
      summary: {
        valid: true,
        event_count: 1,
        verified_count: 1,
        broken_at_event_id: null,
        reason_count: 0
      },
      next_commands: [
        "drift audit list --repo repo_abc --json",
        "drift backup create --repo repo_abc --confirm --json"
      ]
    });
    expect(handlers.get_repo_contract({ repo_id: "repo_abc" })).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      contract_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      contract: { id: "contract_abc" },
      summary: {
        convention_count: 1,
        risky_area_count: 1,
        required_check_count: 1,
        safe_command_count: 1,
        waiver_count: 0,
        rejected_inference_count: 0
      }
    });
    expect(handlers.get_repo_map({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      policy: { allowed: true, surface: "mcp" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      scan_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      filters: {
        role: null,
        path: null
      },
      summary: {
        indexed_file_count: 1,
        listed_file_count: 1,
        role_counts: {
          api_route: 1
        },
        import_count: 0,
        export_count: 1,
        call_count: 1
      },
      files: [{
        path: "apps/web/app/api/users/route.ts",
        roles: ["api_route"],
        exported_symbols: ["GET"],
        calls: ["Response.json"],
        convention_ids: ["convention_no_direct_db"],
        risky_area_ids: ["risk_user_api"],
        open_finding_ids: ["finding_abc"]
      }],
      impact_summary: {
        convention_coverage_count: 1,
        risky_file_count: 1,
        open_finding_count: 1
      },
      freshness_requirement: {
        required: false,
        satisfied: false
      },
      redactions: {
        snippets_included: false
      }
    });
    expect(handlers.get_repo_map({
      repo_id: "repo_abc",
      role: "api_route",
      path: "apps/web/app/api/users/route.ts"
    })).toMatchObject({
      filters: {
        role: "api_route",
        path: "apps/web/app/api/users/route.ts"
      },
      summary: {
        listed_file_count: 1
      }
    });
    const preflight = handlers.get_task_preflight({
      repo_id: "repo_abc",
      task: "add users route",
      path: "apps/web/app/api/users/route.ts",
      now: "2026-05-10T00:01:00.000Z"
    } as never) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(preflight).toMatchObject({
      target_path: "apps/web/app/api/users/route.ts",
      generated_at: "2026-05-10T00:01:00.000Z",
      freshness_requirement: {
        required: false,
        satisfied: false
      },
      summary: {
        convention_count: 1,
        relevant_file_count: 1,
        risky_area_count: 1,
        finding_count: 1,
        blocking_finding_count: 1,
        required_check_count: 1,
        safe_command_count: 1,
        baseline_active_count: 1,
        scan_stale: true
      },
      relevant_files: [{
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      }],
      governance: {
        read_only: true,
        agent_can_mutate: false,
        allowed_agent_actions: ["read_context", "request_preflight", "propose_resolution"],
        human_approval_required_for: [
          "accept_convention",
          "reject_convention",
          "edit_convention",
          "add_exception",
          "add_contract_waiver",
          "mark_needs_review",
          "suppress_finding",
          "accept_drift",
          "mark_false_positive",
          "change_policy",
          "grant_agent_permission",
          "export_contract",
          "import_contract",
          "create_backup",
          "restore_backup"
        ]
      },
      contract: {
        id: "contract_abc",
        schema_version: 1
      },
      policy: { allowed: true, surface: "mcp" },
      conventions: [{
        id: "convention_no_direct_db",
        severity: "error",
        agent_instruction: "When editing API route files, do not import data-access clients directly. Forbidden imports: @/lib/prisma. Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
      }],
      scan_status: {
        current_branch: "unknown",
        scan_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        indexed_file_count: 1,
        source_change_count: 1,
        stale: true,
        invalidation_reasons: [
          "branch_changed",
          "adapter_version_changed:typescript",
          "rule_engine_version_changed"
        ],
        next_command: expect.stringContaining("drift scan --repo-root")
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
    expect(() => handlers.get_task_preflight({
      repo_id: "repo_abc",
      task: "add users route",
      require_fresh: true
    } as never)).toThrow("Scan is stale for repo_abc.");
    expect(() => handlers.get_repo_map({
      repo_id: "repo_abc",
      require_fresh: true
    } as never)).toThrow("Scan is stale for repo_abc.");
    expect(handlers.get_conventions({ repo_id: "repo_abc" })).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
      summary: {
        total_count: 1,
        deterministic_count: 1,
        heuristic_count: 0,
        briefing_only_count: 0,
        blocking_count: 1
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      conventions: [{ id: "convention_no_direct_db" }]
    });
    const allFindings = handlers.get_findings({ repo_id: "repo_abc" }) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(allFindings).toMatchObject({
      policy: { allowed: true, surface: "mcp" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
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
        },
        by_diff_status: {
          new_in_diff: 1,
          outside_diff: 1
        }
      },
      findings: [{ id: "finding_abc" }, { id: "finding_suppressed" }]
    });
    expect(allFindings.findings[0]).toMatchObject({
      id: "finding_abc",
      convention_id: "convention_no_direct_db",
      title: "API route imports data access directly",
      severity: "error",
      status: "new",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      evidence_ref_count: 1,
      first_evidence: {
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        import_source: "@/lib/prisma",
        symbol: "prisma"
      }
    });
    expect(allFindings.findings[0]).not.toHaveProperty("message");
    expect(allFindings.findings[0]).not.toHaveProperty("evidence_refs");
    const pathFindings = handlers.get_findings({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts"
    } as never) as {
      summary: Record<string, unknown>;
      filters: Record<string, unknown>;
      findings: Array<Record<string, unknown>>;
      scan_status: { stale: boolean };
      freshness_requirement: { required: boolean; satisfied: boolean };
    };
    expect(pathFindings).toMatchObject({
      filters: {
        path: "apps/web/app/api/users/route.ts"
      },
      scan_status: {
        stale: true
      },
      freshness_requirement: {
        required: false,
        satisfied: false
      },
      summary: {
        total_count: 2,
        filtered_count: 1
      },
      findings: [{ id: "finding_abc" }]
    });
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db"
    } as never)).toMatchObject({
      filters: {
        convention_id: "convention_no_direct_db"
      },
      summary: {
        total_count: 2,
        filtered_count: 2
      },
      findings: [{ id: "finding_abc" }, { id: "finding_suppressed" }]
    });
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      convention_id: "convention_missing"
    } as never)).toMatchObject({
      filters: {
        convention_id: "convention_missing"
      },
      summary: {
        total_count: 2,
        filtered_count: 0
      },
      findings: []
    });
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      limit: 1,
      offset: 1
    } as never)).toMatchObject({
      pagination: {
        limit: 1,
        offset: 1,
        returned_count: 1,
        has_more: false,
        next_offset: null
      },
      summary: {
        total_count: 2,
        filtered_count: 2
      },
      findings: [{ id: "finding_suppressed" }]
    });
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      limit: 0
    } as never)).toThrow("limit must be a positive integer.");
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      offset: -1
    } as never)).toThrow("offset must be a non-negative integer.");
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      require_fresh: true
    } as never)).toThrow("Scan is stale for repo_abc.");
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
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      diff_status: "outside_diff" as never
    })).toMatchObject({
      summary: {
        total_count: 2,
        filtered_count: 1
      },
      findings: [{ id: "finding_suppressed" }]
    });
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      status: "open" as never
    })).toThrow("status must be");
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      severity: "critical" as never
    })).toThrow("severity must be");
    expect(() => handlers.get_findings({
      repo_id: "repo_abc",
      diff_status: "unknown" as never
    })).toThrow("diff_status must be");
    expect(handlers.get_allowed_context({ repo_id: "repo_abc", path: ".env.local" })).toMatchObject({
      decision: { allowed: false, mode: "denied" }
    });
    expect(handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      requested_snippet_chars: 5000
    } as never)).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      scan_status: {
        stale: true
      },
      freshness_requirement: {
        required: false,
        satisfied: false
      },
      file_context: {
        path: "apps/web/app/api/users/route.ts",
        indexed: true,
        roles: ["api_route"],
        convention_ids: ["convention_no_direct_db"],
        risky_area_ids: ["risk_user_api"],
        open_finding_ids: ["finding_abc"]
      },
      request: {
        path: "apps/web/app/api/users/route.ts",
        surface: "mcp",
        requested_snippet_chars: 5000,
        request_full_file_content: false
      },
      summary: {
        allowed: true,
        mode: "redacted",
        surface: "mcp",
        indexed: true,
        matched_convention_count: 1,
        risky_area_count: 1,
        open_finding_count: 1,
        freshness_required: false,
        freshness_satisfied: false,
        denied_glob_count: 2,
        approved_snippet_chars: 1200
      },
      decision: {
        allowed: true,
        mode: "redacted",
        max_snippet_chars: 1200,
        approved_snippet_chars: 1200
      },
      redactions: {
        denied_globs: [".env*", "**/*.pem"],
        allow_full_file_content: false,
        max_snippet_chars: 1200
      },
      next_commands: [
        "drift prepare \"task\" --repo repo_abc --path apps/web/app/api/users/route.ts --json",
        "drift repo map --repo repo_abc --path apps/web/app/api/users/route.ts --json",
        "drift policy show --repo repo_abc --json"
      ]
    });
    expect(handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      requested_snippet_chars: -1
    } as never)).toMatchObject({
      decision: {
        allowed: false,
        mode: "denied",
        reason: "requested snippet length must be a positive integer",
        approved_snippet_chars: 0
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
      require_fresh: true
    } as never)).toThrow("Scan is stale for repo_abc.");
    expect(() => handlers.get_allowed_context({
      repo_id: "repo_abc",
      path: "apps/web/app/api/users/route.ts",
      surface: "email" as never
    })).toThrow("surface must be");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listAuditEvents("repo_abc").map((event) => event.id)).toEqual(["audit_event_seed_repo_abc"]);
    storage.close();
  });

  it("serves graph-backed repo map details through MCP with fact fallback", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    const routePath = "apps/web/app/api/users/route.ts";
    const routeHash = "b".repeat(64);
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        root_hash: "repo-fp",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: storage.listFileSnapshots("repo_abc", "scan_abc"),
      nodes: [{
        id: `callsite:${routePath}:db.user.findMany:1`,
        kind: "callsite",
        label: "db.user.findMany",
        stable: false,
        evidence_ids: ["evidence_graph_call"],
        metadata: {
          file_path: routePath,
          callee_name: "db.user.findMany"
        }
      }],
      edges: [],
      evidence: [{
        id: "evidence_graph_call",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        artifact_id: `file_version:${routePath}:${routeHash.slice(0, 12)}`,
        file_path: routePath,
        file_hash: routeHash,
        start_line: 1,
        end_line: 1,
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        fact_ids: [],
        redaction_state: "none"
      }],
      createdAt: "2026-05-10T00:00:08.000Z"
    }));
    storage.close();

    const mapped = createReadOnlyMcpHandlers({ databasePath }).get_repo_map({
      repo_id: "repo_abc"
    } as never) as {
      summary: {
        call_count: number;
      };
      files: Array<{
        path: string;
        roles: string[];
        exported_symbols: string[];
        calls: string[];
      }>;
    };

    expect(mapped.summary.call_count).toBe(2);
    expect(mapped.files).toEqual([expect.objectContaining({
      path: routePath,
      roles: ["api_route"],
      exported_symbols: ["GET"],
      calls: ["Response.json", "db.user.findMany"]
    })]);
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
          "branch_changed",
          "adapter_version_changed:typescript",
          "rule_engine_version_changed"
        ],
        changes: {
          added: [],
          modified: [],
          deleted: ["apps/web/app/api/users/route.ts"]
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

  it("scopes MCP preflight required checks and risky areas to task-relevant files", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [
        {
          command: "drift check --diff main...HEAD",
          applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
          reason: "Validate accepted API route conventions."
        },
        {
          command: "pnpm lint docs",
          applies_to: { path_globs: ["docs/**"] },
          reason: "Validate docs formatting."
        }
      ],
      risky_areas: [
        {
          id: "risk_user_api",
          path_globs: ["apps/web/app/api/users/**"],
          risk_kind: "data_access",
          reason: "User API routes touch persisted user data."
        },
        {
          id: "risk_docs",
          path_globs: ["docs/**"],
          risk_kind: "generated_code",
          reason: "Docs risk should not apply to API route work."
        }
      ]
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({ repo_id: "repo_abc", task: "change users api route" }) as {
        summary: { required_check_count: number; risky_area_count: number };
        required_checks: Array<{ command: string; matched_files: string[] }>;
        risky_areas: Array<{ id: string; matched_files: string[] }>;
      };

    expect(preflight.summary).toMatchObject({
      required_check_count: 1,
      risky_area_count: 1
    });
    expect(preflight.required_checks).toEqual([
      expect.objectContaining({
        command: "drift check --diff main...HEAD",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
    expect(preflight.required_checks.map((check) => check.command)).not.toContain("pnpm lint docs");
    expect(preflight.risky_areas).toEqual([
      expect.objectContaining({
        id: "risk_user_api",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
  });

  it("scopes MCP preflight contract waivers to task-relevant files", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [
        {
          id: "waiver_user_api",
          reason: "Legacy user API route is allowed for now.",
          path_globs: ["apps/web/app/api/users/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        },
        {
          id: "waiver_expired",
          reason: "Expired waiver should not be briefed.",
          path_globs: ["apps/web/app/api/users/**"],
          expires_at: "2026-05-10T00:00:20.000Z",
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        }
      ]
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({
        repo_id: "repo_abc",
        task: "change users api route",
        now: "2026-05-10T00:00:30.000Z"
      }) as {
        summary: { waiver_count: number };
        waivers: Array<{ id: string; status: string; matched_files: string[] }>;
      };

    expect(preflight.summary.waiver_count).toBe(1);
    expect(preflight.waivers).toEqual([
      expect.objectContaining({
        id: "waiver_user_api",
        status: "active",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
  });

  it("paginates MCP repo map output in deterministic path order", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "apps/web/app/api/admin/route.ts",
      content_hash: "c".repeat(64),
      byte_size: 42,
      indexed: true
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "packages/core/src/service.ts",
      content_hash: "d".repeat(64),
      byte_size: 40,
      indexed: true
    });
    storage.upsertFacts([
      {
        id: "fact_role_admin_route",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "apps/web/app/api/admin/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1
      },
      {
        id: "fact_role_core_service",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "packages/core/src/service.ts",
        name: "service_module",
        start_line: 1,
        end_line: 1
      }
    ]);
    storage.close();

    const mapped = createReadOnlyMcpHandlers({ databasePath })
      .get_repo_map({
        repo_id: "repo_abc",
        limit: 2,
        offset: 1
      } as never) as {
        summary: {
          indexed_file_count: number;
          filtered_file_count: number;
          listed_file_count: number;
        };
        pagination: {
          limit: number;
          offset: number;
          returned_count: number;
          has_more: boolean;
          next_offset: number | null;
        };
        files: Array<{ path: string }>;
      };

    expect(mapped).toMatchObject({
      summary: {
        indexed_file_count: 3,
        filtered_file_count: 3,
        listed_file_count: 2
      },
      pagination: {
        limit: 2,
        offset: 1,
        returned_count: 2,
        has_more: false,
        next_offset: null
      }
    });
    expect(mapped.files.map((file) => file.path)).toEqual([
      "apps/web/app/api/users/route.ts",
      "packages/core/src/service.ts"
    ]);
  });

  it("filters and paginates MCP conventions in deterministic accepted order", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const baseConvention = storage.listAcceptedConventions("repo_abc")[0]!;
    storage.upsertAcceptedConvention("repo_abc", {
      ...baseConvention,
      id: "convention_auth_helper",
      kind: "api_route_requires_auth_helper",
      statement: "Workspace routes should call the auth helper.",
      matcher: {
        kind: "api_route_requires_auth_helper",
        required_calls: ["requireWorkspaceAccess"],
        applies_to_file_roles: ["api_route"]
      },
      enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      accepted_at: "2026-05-10T00:00:04.500Z",
      updated_at: "2026-05-10T00:00:04.500Z"
    });
    storage.upsertAcceptedConvention("repo_abc", {
      ...baseConvention,
      id: "convention_service_delegation",
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate through service modules.",
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: ["@/services/users"],
        applies_to_file_roles: ["api_route"]
      },
      enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      accepted_at: "2026-05-10T00:00:05.000Z",
      updated_at: "2026-05-10T00:00:05.000Z"
    });
    storage.close();

    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const paged = handlers.get_conventions({
      repo_id: "repo_abc",
      limit: 2,
      offset: 1
    } as never) as {
      summary: { total_count: number; filtered_count: number; listed_count: number };
      pagination: {
        limit: number;
        offset: number;
        returned_count: number;
        has_more: boolean;
        next_offset: number | null;
      };
      conventions: Array<{ id: string }>;
    };
    const filtered = handlers.get_conventions({
      repo_id: "repo_abc",
      kind: "api_route_requires_service_delegation",
      capability: "heuristic_check"
    } as never) as {
      filters: { kind: string; capability: string };
      summary: { total_count: number; filtered_count: number; listed_count: number };
      conventions: Array<{ id: string }>;
    };

    expect(paged).toMatchObject({
      summary: {
        total_count: 3,
        filtered_count: 3,
        listed_count: 2
      },
      pagination: {
        limit: 2,
        offset: 1,
        returned_count: 2,
        has_more: false,
        next_offset: null
      }
    });
    expect(paged.conventions.map((convention) => convention.id)).toEqual([
      "convention_auth_helper",
      "convention_service_delegation"
    ]);
    expect(filtered).toMatchObject({
      filters: {
        kind: "api_route_requires_service_delegation",
        capability: "heuristic_check"
      },
      summary: {
        total_count: 3,
        filtered_count: 1,
        listed_count: 1
      },
      conventions: [{ id: "convention_service_delegation" }]
    });
    expect(() => handlers.get_conventions({
      repo_id: "repo_abc",
      capability: "fuzzy"
    } as never)).toThrow("capability must be briefing_only, heuristic_check, or deterministic_check.");
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

  it("rejects blank repo ids before querying MCP storage", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(() => handlers.get_scan_status({ repo_id: "   " }))
      .toThrow("repo_id must not be empty");
    expect(() => handlers.get_repo_contract({ repo_id: "   " }))
      .toThrow("repo_id must not be empty");
    expect(() => handlers.get_conventions({ repo_id: "   " }))
      .toThrow("repo_id must not be empty");
    expect(() => handlers.get_findings({ repo_id: "   " }))
      .toThrow("repo_id must not be empty");
  });

  it("rejects blank MCP preflight tasks", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(() => handlers.get_task_preflight({ repo_id: "repo_abc", task: "   " }))
      .toThrow("task must not be empty");
  });

  it("rejects unsafe MCP allowed-context paths", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });

    expect(() => handlers.get_allowed_context({ repo_id: "repo_abc", path: "" }))
      .toThrow("path must not be empty");
    expect(() => handlers.get_allowed_context({ repo_id: "repo_abc", path: "../secrets.env" }))
      .toThrow("path must be repo-relative");
    expect(() => handlers.get_allowed_context({ repo_id: "repo_abc", path: "/tmp/secrets.env" }))
      .toThrow("path must be repo-relative");
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
    const runtimeInfo = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "get_runtime_info",
        arguments: {}
      }
    });
    const capabilitiesInfo = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "get_capabilities",
        arguments: {}
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
    const blankRepoId = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "get_scan_status",
        arguments: {
          repo_id: "   "
        }
      }
    });
    const unsafeContextPath = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "../secrets.env"
        }
      }
    });
    const invalidNow = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "get_task_preflight",
        arguments: {
          repo_id: "repo_abc",
          task: "add users route",
          now: "soon"
        }
      }
    });
    const invalidRequireFresh = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "get_task_preflight",
        arguments: {
          repo_id: "repo_abc",
          task: "add users route",
          require_fresh: "yes"
        }
      }
    });
    const invalidAllowedContextRequireFresh = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: "repo_abc",
          path: "apps/web/app/api/users/route.ts",
          require_fresh: "yes"
        }
      }
    });
    const invalidFindingsPath = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: "repo_abc",
          path: "../secret.ts"
        }
      }
    });
    const invalidFindingsRequireFresh = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: "repo_abc",
          require_fresh: "yes"
        }
      }
    });
    const invalidFindingsConventionId = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: "repo_abc",
          convention_id: 123
        }
      }
    });
    const invalidFindingsLimit = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: "repo_abc",
          limit: "two"
        }
      }
    });
    const invalidFindingsOffset = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: "repo_abc",
          offset: -1
        }
      }
    });
    const invalidRepoMapLimit = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "get_repo_map",
        arguments: {
          repo_id: "repo_abc",
          limit: 0
        }
      }
    });
    const invalidRepoMapOffset = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "get_repo_map",
        arguments: {
          repo_id: "repo_abc",
          offset: -1
        }
      }
    });
    const invalidConventionsLimit = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "get_conventions",
        arguments: {
          repo_id: "repo_abc",
          limit: 0
        }
      }
    });
    const invalidConventionsCapability = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "get_conventions",
        arguments: {
          repo_id: "repo_abc",
          capability: "fuzzy"
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
      "get_runtime_info",
      "get_capabilities",
      "get_audit_status",
      "get_scan_status",
      "get_repo_contract",
      "get_repo_map",
      "get_task_preflight",
      "get_conventions",
      "get_findings",
      "get_allowed_context"
    ]);
    expect(called?.result).toMatchObject({
      content: [{ type: "text" }],
      isError: false
    });
    const runtimeText = (runtimeInfo?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(runtimeText)).toMatchObject({
      runtime: {
        mcp_version: "0.1.0",
        core_version: "0.1.0",
        scanner_version: "0.1.0",
        supported_sqlite_schema_version: 9,
        storage_driver: "sqlite"
      },
      v1_scope: {
        product_mode: "local_first_cli",
        primary_wedge: "typescript_api_route_layering",
        source_mutation: false
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      }
    });
    const capabilitiesText = (capabilitiesInfo?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(JSON.parse(capabilitiesText)).toMatchObject({
      capabilities: {
        read_only_cli: expect.arrayContaining(["scan", "prepare", "check"]),
        human_confirmed_cli: expect.arrayContaining([
          "conventions accept --confirm",
          "conventions reject --confirm",
          "conventions edit --confirm",
          "findings mark-fixed --confirm",
          "findings mark-needs-review --confirm",
          "policy set-egress --confirm",
          "policy agent grant --confirm",
          "policy agent revoke --confirm",
          "restore --confirm"
        ]),
        mcp_read_only_tools: expect.arrayContaining(["get_runtime_info", "get_capabilities"]),
        mcp_mutation_tools: []
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      }
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
    expect(blankRepoId?.error?.message).toContain("Invalid arguments for get_scan_status: field repo_id must not be empty.");
    expect(unsafeContextPath?.error?.message).toContain("Invalid arguments for get_allowed_context: field path must be repo-relative.");
    expect(invalidNow?.error?.message).toContain("now must be an ISO timestamp.");
    expect(invalidRequireFresh?.error?.message).toContain("Invalid arguments for get_task_preflight: field require_fresh must be a boolean.");
    expect(invalidAllowedContextRequireFresh?.error?.message).toContain("Invalid arguments for get_allowed_context: field require_fresh must be a boolean.");
    expect(invalidFindingsPath?.error?.message).toContain("Invalid arguments for get_findings: field path must be repo-relative.");
    expect(invalidFindingsRequireFresh?.error?.message).toContain("Invalid arguments for get_findings: field require_fresh must be a boolean.");
    expect(invalidFindingsConventionId?.error?.message).toContain("Invalid arguments for get_findings: field convention_id must be a string.");
    expect(invalidFindingsLimit?.error?.message).toContain("Invalid arguments for get_findings: field limit must be a number.");
    expect(invalidFindingsOffset?.error?.message).toContain("Invalid arguments for get_findings: field offset must be a non-negative integer.");
    expect(invalidRepoMapLimit?.error?.message).toContain("Invalid arguments for get_repo_map: field limit must be a positive integer.");
    expect(invalidRepoMapOffset?.error?.message).toContain("Invalid arguments for get_repo_map: field offset must be a non-negative integer.");
    expect(invalidConventionsLimit?.error?.message).toContain("Invalid arguments for get_conventions: field limit must be a positive integer.");
    expect(invalidConventionsCapability?.error?.message).toContain("Invalid arguments for get_conventions: field capability must be one of briefing_only, heuristic_check, deterministic_check.");
  });

  it("rejects blank JSON-RPC tool names before tool lookup", async () => {
    const databasePath = await seedMcpDatabase();

    const response = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "   ",
        arguments: {
          repo_id: "repo_abc"
        }
      }
    });

    expect(response?.error?.message).toContain("Expected non-empty string param: name");
  });

  it("does not swallow JSON-RPC notification-like requests when an id is present", async () => {
    const databasePath = await seedMcpDatabase();

    const response = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      id: 0,
      method: "notifications/cancelled",
      params: {}
    });
    const notification = handleMcpJsonRpcRequest({ databasePath }, {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: {}
    });

    expect(response).toMatchObject({
      id: 0,
      error: {
        message: "Unsupported MCP method: notifications/cancelled"
      }
    });
    expect(notification).toBeUndefined();
  });

  it("keeps the MCP stdio server running after an invalid JSON line", async () => {
    const databasePath = await seedMcpDatabase();
    const result = await runMcpStdio(databasePath, [
      "{not json",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    ]);

    expect(result.stdout).toHaveLength(2);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      id: null,
      error: {
        code: -32700
      }
    });
    expect(JSON.parse(result.stdout[1]!)).toMatchObject({
      id: 1,
      result: {
        tools: DRIFT_READ_ONLY_MCP_TOOLS
      }
    });
    expect(result.stderr).toContain("Drift MCP rejected an invalid JSON-RPC line.");
  });

  it("resolves the MCP database path from argv before the environment", () => {
    expect(resolveMcpDatabasePath(["--db", "/tmp/drift.sqlite"], {
      DRIFT_DB: "/tmp/env.sqlite"
    })).toBe("/tmp/drift.sqlite");
    expect(resolveMcpDatabasePath([], {
      DRIFT_DB: "/tmp/env.sqlite"
    })).toBe("/tmp/env.sqlite");
  });

  it("rejects blank or missing MCP database path inputs", () => {
    expect(resolveMcpDatabasePath(["--db", "   "], {
      DRIFT_DB: "/tmp/env.sqlite"
    })).toBeUndefined();
    expect(resolveMcpDatabasePath(["--db", "--other"], {
      DRIFT_DB: "/tmp/env.sqlite"
    })).toBeUndefined();
    expect(resolveMcpDatabasePath([], {
      DRIFT_DB: "   "
    })).toBeUndefined();
  });

  it("returns a clean MCP CLI error when no database path is configured", async () => {
    const result = await runMcpCliWithLines([], {}, []);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toContain("Missing --db <path> or DRIFT_DB for drift-mcp.");
  });

  it("runs the MCP CLI from DRIFT_DB when no explicit database path is provided", async () => {
    const databasePath = await seedMcpDatabase();
    const result = await runMcpCliWithLines([], { DRIFT_DB: databasePath }, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout[0]!)).toMatchObject({
      id: 1,
      result: {
        tools: DRIFT_READ_ONLY_MCP_TOOLS
      }
    });
  });

  it("prefers explicit MCP CLI --db over DRIFT_DB", async () => {
    const databasePath = await seedMcpDatabase();
    const missingEnvDatabasePath = join(tmpdir(), "drift-mcp-missing-env.sqlite");
    const result = await runMcpCliWithLines(["--db", databasePath], {
      DRIFT_DB: missingEnvDatabasePath
    }, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_scan_status",
          arguments: {
            repo_id: "repo_abc"
          }
        }
      })
    ]);

    expect(result.exitCode).toBe(0);
    const response = JSON.parse(result.stdout[0]!);
    const payload = JSON.parse(response.result.content[0].text);
    expect(payload.repo_id).toBe("repo_abc");
  });

  it("does not start the MCP CLI when explicit --db is malformed", async () => {
    const databasePath = await seedMcpDatabase();
    const result = await runMcpCliWithLines(["--db", "--other"], {
      DRIFT_DB: databasePath
    }, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toContain("Missing --db <path> or DRIFT_DB for drift-mcp.");
  });

  it("does not start the MCP CLI when explicit --db is blank", async () => {
    const databasePath = await seedMcpDatabase();
    const result = await runMcpCliWithLines(["--db", "   "], {
      DRIFT_DB: databasePath
    }, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toContain("Missing --db <path> or DRIFT_DB for drift-mcp.");
  });

  it("prints MCP CLI help without requiring a database path", async () => {
    const result = await runMcpCliWithLines(["--help"], {}, []);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.join("\n")).toContain("Usage: drift-mcp --db <path>");
    expect(result.stdout.join("\n")).toContain("Environment:");
    expect(result.stdout.join("\n")).toContain("DRIFT_DB");
  });

  it("prints MCP CLI version without requiring a database path", async () => {
    const result = await runMcpCliWithLines(["--version"], {}, []);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toEqual(["0.1.0"]);
  });

  it("rejects unknown MCP CLI options before starting stdio", async () => {
    const databasePath = await seedMcpDatabase();
    const result = await runMcpCliWithLines(["--db", databasePath, "--mutate"], {}, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toContain("Unknown drift-mcp option: --mutate");
  });
});
