import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CONVENTION_KINDS, FILE_ROLES } from "@drift/core";
import { buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { MIGRATIONS, openDriftStorage } from "@drift/storage";
import { runCli } from "../../cli/src/index.js";
import {
  DRIFT_READ_ONLY_MCP_TOOLS,
  createReadOnlyMcpHandlers,
  handleMcpJsonRpcRequest,
  resolveMcpDatabasePath,
  runMcpCli,
  runReadOnlyMcpStdioServer
} from "../src/index.js";

const tempDirs: string[] = [];

function factQuality(scanId = "scan_abc") {
  return {
    source_span: { start_line: 1, start_column: 1, end_line: 1, end_column: 1 },
    ast_node_kind: null,
    extraction_method: "test_fixture",
    extractor_version: "0.1.0",
    parser_version: "0.1.0",
    confidence: 1,
    confidence_label: "certain" as const,
    evidence_level: "text" as const,
    resolution_status: "resolved" as const,
    staleness_status: "fresh" as const,
    last_seen_scan_id: scanId
  };
}

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
      end_line: 1,
      ...factQuality()
    },
    {
      id: "fact_role_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "file_role_detected",
      file_path: "apps/web/app/api/users/route.ts",
      name: "api_route",
      start_line: 1,
      end_line: 1,
      ...factQuality()
    },
    {
      id: "fact_export_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "exported_symbol",
      file_path: "apps/web/app/api/users/route.ts",
      name: "GET",
      start_line: 1,
      end_line: 1,
      ...factQuality()
    },
    {
      id: "fact_call_abc",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "symbol_called",
      file_path: "apps/web/app/api/users/route.ts",
      name: "Response.json",
      start_line: 1,
      end_line: 1,
      ...factQuality()
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

const crossSurfaceExpectedRouteContracts = [
  {
    route_id: "route:apps/web/app/(admin)/api/projects/route.ts:GET",
    normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/(admin)/api/projects/route.ts:GET",
    path: "/api/projects",
    method: "GET"
  },
  {
    route_id: "route:apps/web/src/app/api/users/[id]/route.ts:GET",
    normalized_entrypoint_id: "entrypoint:next_app:apps/web/src/app/api/users/[id]/route.ts:GET",
    path: "/api/users/:id",
    method: "GET"
  },
  {
    route_id: "route:src/pages/api/projects/[projectId].ts:default",
    normalized_entrypoint_id: "entrypoint:next_pages:src/pages/api/projects/[projectId].ts:default",
    path: "/api/projects/:projectId",
    method: "default"
  }
];

function routeContractProjection(routes: Array<{
  route_id: string;
  normalized_entrypoint_id?: string;
  path: string | null;
  method: string | null;
}>): Array<{
  route_id: string;
  normalized_entrypoint_id: string | undefined;
  path: string | null;
  method: string | null;
}> {
  return routes
    .map((route) => ({
      route_id: route.route_id,
      normalized_entrypoint_id: route.normalized_entrypoint_id,
      path: route.path,
      method: route.method
    }))
    .sort((left, right) => left.route_id.localeCompare(right.route_id));
}

function readinessCapabilitySummary(payload: {
  readiness?: unknown;
  capability_report?: {
    certified_capabilities?: unknown;
    required_capabilities?: unknown;
    missing_capabilities?: unknown;
    completeness?: unknown;
    parser_gap_count?: unknown;
    parser_gap_kinds?: unknown;
    fallback_used?: unknown;
    enforcement_degraded?: unknown;
    engine_resolution?: unknown;
    engine_build_profile?: unknown;
  };
  security_capabilities?: unknown;
}): {
  readiness?: unknown;
  capability_report: unknown;
  security_capabilities?: unknown;
} {
  return {
    readiness: payload.readiness,
    capability_report: payload.capability_report
      ? {
          certified_capabilities: payload.capability_report.certified_capabilities,
          required_capabilities: payload.capability_report.required_capabilities,
          missing_capabilities: payload.capability_report.missing_capabilities,
          completeness: payload.capability_report.completeness,
          parser_gap_count: payload.capability_report.parser_gap_count,
          parser_gap_kinds: payload.capability_report.parser_gap_kinds,
          fallback_used: payload.capability_report.fallback_used,
          enforcement_degraded: payload.capability_report.enforcement_degraded,
          // BB-2: engine provenance is part of the parity surface. Left out, MCP could report a
          // scan taken through a debug engine as indistinguishable from a release one - which is
          // exactly the confusion the field exists to end, and exactly the gap the EW-6
          // stored_fact_count parity failure taught us to close in the same commit.
          engine_resolution: payload.capability_report.engine_resolution,
          engine_build_profile: payload.capability_report.engine_build_profile
        }
      : null,
    security_capabilities: payload.security_capabilities
  };
}

async function seedCrossSurfaceCanonicalRouteState(prefix = "drift-mcp-cross-surface-routes-"): Promise<{
  databasePath: string;
  repoId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await mkdir(join(repoRoot, "apps/web/app/(admin)/api/projects"), { recursive: true });
  await mkdir(join(repoRoot, "apps/web/src/app/api/users/[id]"), { recursive: true });
  await mkdir(join(repoRoot, "src/pages/api/projects"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/web/app/(admin)/api/projects/route.ts"),
    "export async function GET() { return Response.json({ projects: [] }); }\n"
  );
  await writeFile(
    join(repoRoot, "apps/web/src/app/api/users/[id]/route.ts"),
    "export async function GET() { return Response.json({ user: null }); }\n"
  );
  await writeFile(
    join(repoRoot, "src/pages/api/projects/[projectId].ts"),
    [
      "export default function handler(_req, res) {",
      "  res.status(200).json({ project: null });",
      "}",
      ""
    ].join("\n")
  );
  await writeFile(
    join(repoRoot, "middleware.ts"),
    [
      "import { NextResponse } from \"next/server\";",
      "export function middleware() {",
      "  return NextResponse.next();",
      "}",
      ""
    ].join("\n")
  );

  const scanned = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-05-31T00:00:00.000Z",
    "--json"
  ]);
  expect(scanned.stderr).toBe("");
  expect(scanned.exitCode).toBe(0);
  const payload = JSON.parse(scanned.stdout);
  return {
    databasePath: payload.state.database_path,
    repoId: payload.repo.id
  };
}

function deleteAppliedMigration(databasePath: string, migrationId: string): void {
  const storage = openDriftStorage({ databasePath });
  const raw = storage as unknown as {
    db: {
      prepare: (sql: string) => { run: (...args: unknown[]) => void };
    };
  };
  raw.db
    .prepare("DELETE FROM schema_migrations WHERE id = ?")
    .run(migrationId);
  storage.close();
}

async function seedMcpNoContractDatabase(): Promise<{
  databasePath: string;
  repoId: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "drift-mcp-no-contract-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const routeSource = "export async function GET() { return Response.json({ ok: true }); }\n";
  await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
  await writeFile(join(repoRoot, "apps/web/app/api/users/route.ts"), routeSource);

  const databasePath = join(dir, "drift.sqlite");
  const repoId = "repo_no_contract";
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertRepo({
    id: repoId,
    root_path: repoRoot,
    fingerprint: "repo-no-contract-fp",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z"
  });
  storage.upsertScanManifest({
    id: "scan_no_contract",
    repo_id: repoId,
    branch: "unknown",
    commit: "abc123",
    dirty: false,
    scanner_version: "0.1.0",
    adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed",
    file_count: 1,
    fact_count: 2,
    finding_count: 0,
    started_at: "2026-05-10T00:00:01.000Z",
    completed_at: "2026-05-10T00:00:02.000Z"
  });
  storage.upsertFileSnapshot({
    repo_id: repoId,
    scan_id: "scan_no_contract",
    file_path: "apps/web/app/api/users/route.ts",
    content_hash: createHash("sha256").update(routeSource).digest("hex"),
    byte_size: Buffer.byteLength(routeSource),
    indexed: true
  });
  storage.upsertFacts([
    {
      id: "fact_no_contract_file",
      repo_id: repoId,
      scan_id: "scan_no_contract",
      kind: "file_detected",
      file_path: "apps/web/app/api/users/route.ts",
      name: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      ...factQuality("scan_no_contract")
    },
    {
      id: "fact_no_contract_role",
      repo_id: repoId,
      scan_id: "scan_no_contract",
      kind: "file_role_detected",
      file_path: "apps/web/app/api/users/route.ts",
      name: "api_route",
      start_line: 1,
      end_line: 1,
      ...factQuality("scan_no_contract")
    }
  ]);
  storage.upsertConventionCandidate({
    id: "candidate_no_contract_db",
    repo_id: repoId,
    scan_id: "scan_no_contract",
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
      supporting_examples_count: 4,
      counterexamples_count: 0,
      scope_files_count: 4,
      coverage_ratio: 1,
      heuristic_id: "direct-data-access-import-v1"
    },
    evidence_refs: [],
    counterexample_refs: [],
    status: "candidate",
    created_at: "2026-05-10T00:00:03.000Z"
  });
  storage.close();

  return { databasePath, repoId };
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

  it("does not run migrations from read-only MCP handlers", async () => {
    const databasePath = await seedMcpDatabase();
    const lastMigration = MIGRATIONS.at(-1)!.id;
    deleteAppliedMigration(databasePath, lastMigration);

    expect(() => createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" }))
      .toThrow(/read-only MCP database is not migrated/i);

    const storage = openDriftStorage({ databasePath });
    expect(storage.getAppliedMigrations()).not.toContain(lastMigration);
    storage.close();
  });

  it("matches CLI missing-scan status and readiness semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-mcp-no-scan-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });
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
    storage.close();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      stale: true,
      invalidation_reasons: ["scan_missing"],
      parser_gap_quality: {
        schema_version: "drift.parser_gap_quality.v1",
        total_count: 0,
        user_action: "No parser gap action required."
      },
      readiness: {
        missing_capabilities: ["fact_graph", "scan_manifest"],
        required_capabilities: ["fact_graph", "scan_manifest"]
      }
    });
  });

  it("matches CLI readiness for scan status, repo map, and preflight surfaces", async () => {
    const databasePath = await seedMcpDatabase();
    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const now = "2026-05-10T00:00:10.000Z";
    const task = "change users api route";

    const cliScanStatus = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", "repo_abc",
      "--json"
    ]);
    const cliRepoMap = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", "repo_abc",
      "--json"
    ]);
    const cliPreflight = await runCli([
      "--db", databasePath,
      "prepare", task,
      "--repo", "repo_abc",
      "--now", now,
      "--json"
    ]);

    expect(cliScanStatus.exitCode).toBe(0);
    expect(cliRepoMap.exitCode).toBe(0);
    expect(cliPreflight.exitCode).toBe(0);

    const mcpScanStatus = handlers.get_scan_status({ repo_id: "repo_abc" });
    const mcpRepoMap = handlers.get_repo_map({ repo_id: "repo_abc" });
    const mcpPreflight = handlers.get_task_preflight({
      repo_id: "repo_abc",
      task,
      now
    });

    expect(mcpScanStatus.readiness).toEqual(JSON.parse(cliScanStatus.stdout).readiness);
    expect(mcpRepoMap.readiness).toEqual(JSON.parse(cliRepoMap.stdout).readiness);
    expect(mcpPreflight.readiness).toEqual(JSON.parse(cliPreflight.stdout).readiness);
    expect(mcpScanStatus.parser_gap_quality).toEqual(JSON.parse(cliScanStatus.stdout).parser_gap_quality);
    expect(mcpRepoMap.parser_gap_quality).toEqual(JSON.parse(cliRepoMap.stdout).parser_gap_quality);
    expect(mcpPreflight.parser_gap_quality).toEqual(JSON.parse(cliPreflight.stdout).parser_gap_quality);

    // BB-6: the guidance view is the packet's headline surface, so it is part of the parity contract.
    // Both surfaces build it from the same core builder over the same stored state; if that ever stops
    // being true this is the assertion that says so, rather than an agent noticing that the CLI and
    // the MCP server recommend different files.
    const cliGuidance = JSON.parse(cliPreflight.stdout).guidance;
    expect(cliGuidance).toBeTruthy();
    expect(mcpPreflight.guidance).toEqual(cliGuidance);
    // And the conventions block, which carries the BB-5 exemplars the guidance view embeds.
    expect(mcpPreflight.conventions).toEqual(JSON.parse(cliPreflight.stdout).conventions);
  });

  it("reports parser gap summaries in scan status", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_unresolved_users",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "unresolved_import",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:00:08.000Z"
    }]);
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_source: "rust",
      engine_version: null,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "graph_stream"],
      required_capabilities: ["file_discovery", "graph_stream"],
      missing_capabilities: ["graph_stream"],
      completeness: [{
        scope: "repo",
        complete: false,
        can_block: false,
        reasons: ["graph_missing"]
      }],
      parser_gap_count: 1,
      parser_gap_kinds: { unresolved_import: 1 },
      fallback_used: false,
      enforcement_degraded: true,
      created_at: "2026-05-10T00:00:09.000Z"
    });
    storage.close();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      capability_report: {
        schema_version: "drift.scan_capability_report.v1",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        parser_gap_count: 1,
        parser_gap_kinds: { unresolved_import: 1 },
        enforcement_degraded: true
      },
      parser_gaps: {
        total_count: 1,
        by_kind: { unresolved_import: 1 },
        confidence_impact: { lowers_flow: 1 }
      },
      parser_gap_quality: {
        schema_version: "drift.parser_gap_quality.v1",
        total_count: 1,
        advisory_count: 1,
        top_actions: [{
          suggested_action: "Resolve the import or add resolver configuration, then rerun drift scan.",
          count: 1
        }]
      },
      readiness: {
        schema_version: "drift.readiness.v1",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        surface: "scan_status",
        parser_gap_count: 1,
        parser_gaps_by_kind: { unresolved_import: 1 },
        decision: "refuse",
        reasons: [
          "graph_incomplete",
          "graph_missing",
          "graph_unavailable",
          "missing_capability:fact_graph",
          "parser_gaps_present"
        ]
      }
    });
  });

  it("reports parser gap v2 summaries and readiness in scan status", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertParserGapV2([{
      schema_version: "drift.parser_gap.v2",
      parser_gap_id: "gap_dynamic_import_route_1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 4,
      end_line: 4,
      kind: "dynamic_import_unresolved",
      message: "Dynamic import target is not statically resolvable.",
      affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
      affected_contract_kinds: ["api_route_no_direct_data_access"],
      confidence_impact: "blocks_enforcement",
      suggested_action: "rewrite_static",
      evidence_refs: ["evidence_graph_1"]
    }]);
    storage.close();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      parser_gaps: {
        total_count: 1,
        by_kind: { dynamic_import_unresolved: 1 },
        confidence_impact: { blocks_enforcement: 1 },
        by_capability: {
          "ts.dynamic_imports.v1": 1,
          "ts.route_flow.v1": 1
        },
        by_contract_kind: {
          api_route_no_direct_data_access: 1
        }
      },
      parser_gap_quality: {
        schema_version: "drift.parser_gap_quality.v1",
        total_count: 1,
        blocking_count: 1,
        by_capability: {
          "ts.dynamic_imports.v1": 1,
          "ts.route_flow.v1": 1
        },
        by_contract_kind: {
          api_route_no_direct_data_access: 1
        },
        decision: "refuse",
        user_action: "Resolve blocking parser gaps before enabling blocking enforcement."
      },
      readiness: {
        parser_gap_count: 1,
        parser_gaps_by_kind: { dynamic_import_unresolved: 1 },
        confidence: 0,
        decision: "refuse",
        reasons: [
          "graph_incomplete",
          "graph_missing",
          "graph_unavailable",
          "missing_capability:fact_graph",
          "parser_gap_blocks_enforcement",
          "parser_gaps_present"
        ]
      }
    });
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

  it("matches CLI scan-status resolver input invalidation semantics", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const repo = storage.getRepo("repo_abc")!;
    const scan = storage.listScanManifests("repo_abc").find((entry) => entry.id === "scan_abc")!;
    const routeSource = "export async function GET() { return Response.json({ ok: true }); }\n";
    await writeFile(join(repo.root_path, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["apps/web/*"] }
      }
    }));
    storage.upsertScanManifest({
      ...scan,
      id: "scan_resolver_inputs",
      branch: "unknown",
      scanner_version: "0.1.0",
      adapter_versions: {
        typescript: "0.1.0",
        resolver: "0.1.0",
        resolver_inputs: "0".repeat(64)
      },
      rule_engine_version: "0.1.0",
      started_at: "2026-05-10T00:00:03.000Z",
      completed_at: "2026-05-10T00:00:04.000Z"
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_resolver_inputs",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: createHash("sha256").update(routeSource).digest("hex"),
      byte_size: Buffer.byteLength(routeSource),
      indexed: true
    });
    storage.close();

    expect(createReadOnlyMcpHandlers({ databasePath }).get_scan_status({ repo_id: "repo_abc" })).toMatchObject({
      stale: true,
      invalidation_reasons: ["resolver_inputs_changed"]
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
        },
        contract_parity: {
          summary: {
            missing_count: 0,
            partial_beta_required_count: 0,
            not_implemented_count: 0
          }
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
      policy: { allowed: true, surface: "contract-export" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      contract_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      contract: { id: "contract_abc" },
      summary: {
        convention_count: 1,
        agent_contract_count: 0,
        risky_area_count: 1,
        required_check_count: 1,
        safe_command_count: 1,
        waiver_count: 0,
        rejected_inference_count: 0
      }
    });
    expect(handlers.get_repo_map({ repo_id: "repo_abc" })).toMatchObject({
      repo_id: "repo_abc",
      policy: { allowed: true, surface: "cli-preflight" },
      readiness: {
        schema_version: "drift.readiness.v1",
        surface: "repo_map",
        repo_id: "repo_abc"
      },
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
      topology: {
        schema_version: "drift.repo_topology.v1",
        areas: expect.arrayContaining([
          expect.objectContaining({
            name: "Users Management",
            entrypoints: ["GET /api/users"]
          })
        ])
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
      agent_envelope: {
        policy_proof: {
          schema_version: "policy.proof.v1",
          surface: "cli-preflight",
          allowed: true,
          redaction_state: "metadata_only",
          snippets_included: false,
          source_content_included: false,
          context_truncated: false
        }
      },
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
      policy: { allowed: true, surface: "cli-preflight" },
      readiness: {
        schema_version: "drift.readiness.v1",
        surface: "prepare",
        repo_id: "repo_abc"
      },
      parser_gap_quality: {
        schema_version: "drift.parser_gap_quality.v1",
        surface: "prepare",
        repo_id: "repo_abc",
        total_count: 0,
        user_action: "No parser gap action required."
      },
      conventions: [{
        id: "convention_no_direct_db",
        severity: "error",
        agent_instruction: "When editing API route files, do not import data-access clients directly. Forbidden imports: @/lib/prisma. Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
      }],
      agent_contract_packet: {
        schema_version: "drift.agent.preflight.v3",
        repo_id: "repo_abc",
        stale: true,
        selected_contracts: [],
        selected_conventions: [{ id: "convention_no_direct_db" }],
        required_checks: []
      },
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
      change_impact: {
        schema_version: "drift.change_impact.v1",
        repo_id: "repo_abc"
      },
      task_model: {
        schema_version: "drift.agent_task.v1",
        task_intent: "feature",
        target_area: "user_management",
        likely_entrypoint_kinds: ["api_route"],
        human_approval_needed: false
      },
      task_preflight_packet: {
        schema_version: "drift.agent_preflight.v2",
        repo_id: "repo_abc",
        context_policy: {
          egress_level: "symbol_only",
          can_modify_contract: false
        }
      },
      test_intelligence: [],
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

    // T48: legacy_packet was byte-identical to the sibling top-level agent_contract_packet -
    // 3,012 bytes of pure duplication in a packet agents pay tokens to read. Asserted absent
    // rather than merely unasserted, so it cannot quietly come back.
    expect(preflight.task_preflight_packet).not.toHaveProperty("legacy_packet");
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
      policy: { allowed: true, surface: "cli-preflight" },
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
      review_items: Array<Record<string, unknown>>;
      findings: Array<Record<string, unknown>>;
    };
    expect(allFindings).toMatchObject({
      policy: { allowed: true, surface: "cli-check" },
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
      review_items: [{ id: "finding_abc" }, { id: "finding_suppressed" }],
      findings: [{ finding_id: "finding_abc" }, { finding_id: "finding_suppressed" }]
    });
    expect(allFindings.review_items[0]).toMatchObject({
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
        start_line: 1
      }
    });
    expect(allFindings.findings[0]).toMatchObject({
      finding_id: "finding_abc",
      title: "API route imports data access directly",
      lifecycle: "new",
      file_refs: [{
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        end_line: 1,
        redaction_state: "line_only"
      }]
    });
    expect(allFindings.findings[0]).not.toHaveProperty("message");
    expect(allFindings.findings[0]).not.toHaveProperty("evidence_refs");
    expect(JSON.stringify(allFindings)).not.toContain("@/lib/prisma");
    expect(JSON.stringify(allFindings)).not.toContain("prisma");
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
      findings: [{ finding_id: "finding_abc" }]
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
      findings: [{ finding_id: "finding_abc" }, { finding_id: "finding_suppressed" }]
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
      findings: [{ finding_id: "finding_suppressed" }]
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
      findings: [{ finding_id: "finding_abc" }]
    });
    expect(handlers.get_findings({
      repo_id: "repo_abc",
      diff_status: "outside_diff" as never
    })).toMatchObject({
      summary: {
        total_count: 2,
        filtered_count: 1
      },
      findings: [{ finding_id: "finding_suppressed" }]
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
      path: "apps/web/app/api/users/route.ts"
    })).toMatchObject({
      context_policy: {
        can_read_repo_map: true,
        can_read_source_snippets: false,
        can_read_contract: true,
        can_read_findings: true,
        can_execute_commands: false,
        can_modify_contract: false,
        can_create_waiver: false,
        can_request_human_approval: true,
        can_access_secret_like_files: false,
        can_emit_patch: false,
        egress_level: "symbol_only"
      }
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
    storage.upsertFrameworkScanData({
      repoId: "repo_abc",
      scanId: "scan_abc",
      adapters: [{
        schema_version: "drift.framework.adapter.v1",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        adapter_version: "0.1.0",
        package_names: ["next"],
        entrypoint_kinds: ["api_route"],
        supported_patterns: ["app/api/**/route.{ts,tsx,js,jsx}"],
        unsupported_patterns: [],
        capabilities: []
      }],
      entrypoints: [{
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: `entrypoint:next_app:${routePath}:GET`,
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        kind: "api_route",
        file_path: routePath,
        route_pattern: "/api/users",
        method: "GET",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact_route_users_get"],
        parser_gap_ids: []
      }],
      parserGaps: [],
      capabilities: [{
        schema_version: "drift.framework.capability.v1",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        capability: "entrypoint_discovery",
        status: "complete",
        can_block: true,
        block_requires_accepted_convention: true,
        parser_gap_ids: [],
        missing_proof_ids: []
      }]
    });
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
      framework_entrypoints: {
        summary: { entrypoint_count: number };
        entrypoints: Array<{ file_path: string; route_pattern?: string; method?: string }>;
      };
    };

    expect(mapped.summary.call_count).toBe(2);
    expect(mapped.files).toEqual([expect.objectContaining({
      path: routePath,
      roles: ["api_route"],
      exported_symbols: ["GET"],
      calls: expect.arrayContaining(["Response.json", "db.user.findMany"])
    })]);
    expect(mapped.framework_entrypoints.summary.entrypoint_count).toBe(1);
    expect(mapped.framework_entrypoints.entrypoints).toEqual([
      expect.objectContaining({
        file_path: routePath,
        route_pattern: "/api/users",
        method: "GET"
      })
    ]);
  });

  it("returns canonical route entrypoints in MCP repo map and security context", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFrameworkScanData({
      repoId: "repo_abc",
      scanId: "scan_abc",
      adapters: [{
        schema_version: "drift.framework.adapter.v1",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        adapter_version: "0.1.0",
        package_names: ["next"],
        entrypoint_kinds: ["api_route"],
        supported_patterns: ["app/api/**/route.{ts,tsx,js,jsx}", "pages/api/**/*.{ts,tsx,js,jsx}"],
        unsupported_patterns: [],
        capabilities: []
      }],
      entrypoints: [{
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint:next_app:apps/web/app/(admin)/api/projects/route.ts:GET",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        kind: "api_route",
        file_path: "apps/web/app/(admin)/api/projects/route.ts",
        handler_symbol: "GET",
        route_pattern: "/api/projects",
        method: "GET",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact:apps/web/app/(admin)/api/projects/route.ts:route_declared:GET:1-1"],
        parser_gap_ids: []
      }, {
        schema_version: "drift.normalized_entrypoint.v1",
        entrypoint_id: "entrypoint:next_pages:src/pages/api/projects/[projectId].ts:default",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_pages",
        kind: "api_route",
        file_path: "src/pages/api/projects/[projectId].ts",
        handler_symbol: "default",
        route_pattern: "/api/projects/:projectId",
        method: "default",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact:src/pages/api/projects/[projectId].ts:route_declared:default:1-1"],
        parser_gap_ids: []
      }],
      parserGaps: [],
      capabilities: []
    });
    storage.close();

    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const repoMap = handlers.get_repo_map({ repo_id: "repo_abc" } as never) as {
      routes: Array<{
        route_id: string;
        normalized_entrypoint_id?: string;
        path: string | null;
        method: string | null;
        source?: string;
        freshness?: string;
      }>;
      route_source_summary: {
        normalized_entrypoint: number;
        security_proof: number;
        legacy_fact_fallback: number;
      };
      canonical_route_fallback: { used: boolean; reason: string | null };
      proof_freshness: string;
      redactions: {
        snippets_included: boolean;
      };
    };
    const securityContext = handlers.get_security_context({ repo_id: "repo_abc" } as never) as {
      routes: Array<{
        route_id: string;
        normalized_entrypoint_id?: string;
        path: string | null;
        method: string | null;
        source?: string;
        freshness?: string;
      }>;
      route_source_summary: {
        normalized_entrypoint: number;
        security_proof: number;
        legacy_fact_fallback: number;
      };
      canonical_route_fallback: { used: boolean; reason: string | null };
      proof_freshness: string;
      redactions: {
        snippets_included: boolean;
        request_payloads_included: boolean;
        secret_values_included: boolean;
        actor_identity_included: boolean;
      };
    };

    const expectedRoutes = [
      expect.objectContaining({
        route_id: "route:apps/web/app/(admin)/api/projects/route.ts:GET",
        normalized_entrypoint_id: "entrypoint:next_app:apps/web/app/(admin)/api/projects/route.ts:GET",
        path: "/api/projects",
        method: "GET",
        source: "normalized_entrypoint",
        freshness: "fresh"
      }),
      expect.objectContaining({
        route_id: "route:src/pages/api/projects/[projectId].ts:default",
        normalized_entrypoint_id: "entrypoint:next_pages:src/pages/api/projects/[projectId].ts:default",
        path: "/api/projects/:projectId",
        method: "default",
        source: "normalized_entrypoint",
        freshness: "fresh"
      })
    ];
    expect(repoMap.routes).toEqual(expect.arrayContaining(expectedRoutes));
    expect(repoMap.route_source_summary).toEqual({
      normalized_entrypoint: 2,
      security_proof: 0,
      legacy_fact_fallback: 0
    });
    expect(repoMap.canonical_route_fallback).toEqual({ used: false, reason: null });
    expect(repoMap.proof_freshness).toBe("none");
    expect(repoMap.redactions.snippets_included).toBe(false);
    expect(securityContext.routes).toEqual(expect.arrayContaining(expectedRoutes));
    expect(securityContext.route_source_summary).toEqual({
      normalized_entrypoint: 2,
      security_proof: 0,
      legacy_fact_fallback: 0
    });
    expect(securityContext.canonical_route_fallback).toEqual({ used: false, reason: null });
    expect(securityContext.proof_freshness).toBe("none");
    expect(securityContext.redactions).toMatchObject({
      snippets_included: false,
      request_payloads_included: false,
      secret_values_included: false,
      actor_identity_included: false
    });
    expect(JSON.stringify(securityContext)).not.toContain("request.json()");
    expect(JSON.stringify(securityContext)).not.toContain("process.env");
    expect(JSON.stringify(securityContext)).not.toContain("local-user");
  });

  it("proves cross-surface canonical route parity for CLI and MCP route contracts", async () => {
    const { databasePath, repoId } = await seedCrossSurfaceCanonicalRouteState();
    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const cliRepoMap = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--json"
    ]);
    const cliScanStatus = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(cliRepoMap.stderr).toBe("");
    expect(cliRepoMap.exitCode).toBe(0);
    expect(cliScanStatus.stderr).toBe("");
    expect(cliScanStatus.exitCode).toBe(0);
    const cliRepoMapPayload = JSON.parse(cliRepoMap.stdout);
    const cliScanStatusPayload = JSON.parse(cliScanStatus.stdout);
    const mcpRepoMap = handlers.get_repo_map({ repo_id: repoId } as never) as {
      routes: Array<{
        route_id: string;
        normalized_entrypoint_id?: string;
        path: string | null;
        method: string | null;
        source?: string;
      }>;
      route_source_summary: {
        normalized_entrypoint: number;
        security_proof: number;
        legacy_fact_fallback: number;
      };
      canonical_route_fallback: { used: boolean; reason: string | null };
    };
    const securityContext = handlers.get_security_context({ repo_id: repoId } as never) as {
      routes: Array<{
        route_id: string;
        normalized_entrypoint_id?: string;
        path: string | null;
        method: string | null;
        source?: string;
      }>;
      route_source_summary: {
        normalized_entrypoint: number;
        security_proof: number;
        legacy_fact_fallback: number;
      };
      canonical_route_fallback: { used: boolean; reason: string | null };
      redactions: {
        snippets_included: boolean;
        source_content_included?: boolean;
        request_payloads_included: boolean;
        secret_values_included: boolean;
        actor_identity_included: boolean;
      };
    };
    const mcpScanStatus = handlers.get_scan_status({ repo_id: repoId });

    const cliRouteContracts = routeContractProjection(cliRepoMapPayload.routes);
    expect(cliRouteContracts).toEqual(crossSurfaceExpectedRouteContracts);
    expect(routeContractProjection(mcpRepoMap.routes)).toEqual(cliRouteContracts);
    expect(routeContractProjection(securityContext.routes)).toEqual(cliRouteContracts);
    expect(mcpRepoMap.route_source_summary).toEqual({
      normalized_entrypoint: 3,
      security_proof: 0,
      legacy_fact_fallback: 0
    });
    expect(securityContext.route_source_summary).toEqual(mcpRepoMap.route_source_summary);
    expect(mcpRepoMap.canonical_route_fallback).toEqual({ used: false, reason: null });
    expect(securityContext.canonical_route_fallback).toEqual({ used: false, reason: null });
    expect(mcpRepoMap.routes.every((route) => route.source === "normalized_entrypoint")).toBe(true);
    expect(securityContext.routes.every((route) => route.source === "normalized_entrypoint")).toBe(true);
    expect(readinessCapabilitySummary(mcpScanStatus)).toEqual(
      readinessCapabilitySummary(cliScanStatusPayload)
    );
    expect(securityContext.redactions).toMatchObject({
      snippets_included: false,
      request_payloads_included: false,
      secret_values_included: false,
      actor_identity_included: false
    });
  });

  it("exposes required-check execution proof through read-only MCP", async () => {
    const databasePath = await seedMcpDatabase();
    const command = "node -e \"process.stdout.write('ok')\"";
    const storage = openDriftStorage({ databasePath });
    storage.recordRequiredCheckExecution({
      schema_version: "drift.required_check_execution.v1",
      execution_id: "required_check_execution_abc",
      repo_id: "repo_abc",
      repo_root: "/tmp/repo",
      repo_commit: "abc123",
      git_branch: "main",
      git_commit_sha: "abc123",
      worktree_dirty: false,
      untracked_files_present: false,
      scan_id: "scan_abc",
      repo_contract_id: "contract_abc",
      agent_contract_id: "agent_contract_smoke_checks",
      contract_fingerprint: "contract-fp",
      repo_contract_version: 1,
      command,
      argv: ["node", "-e", "process.stdout.write('ok')"],
      command_hash: createHash("sha256").update(command).digest("hex"),
      diff_hash: "diff-fp",
      lockfile_hash: null,
      package_manager: null,
      cwd: "/tmp/repo",
      started_at: "2026-05-10T00:00:30.000Z",
      completed_at: "2026-05-10T00:00:31.000Z",
      timeout_ms: 30000,
      exit_code: 0,
      status: "passed",
      stdout_hash: createHash("sha256").update("ok").digest("hex"),
      stderr_hash: createHash("sha256").update("").digest("hex"),
      stdout_preview: "ok",
      stderr_preview: "",
      audit_event_id: "audit_event_required_check_abc"
    });
    storage.close();

    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const proof = handlers.get_required_check_executions({
      repo_id: "repo_abc",
      command
    }) as {
      summary: Record<string, unknown>;
      filters: Record<string, unknown>;
      latest_by_command: Array<Record<string, unknown>>;
      executions: Array<Record<string, unknown>>;
    };

    expect(proof).toMatchObject({
      response_schema: "drift.required_check_executions.v1",
      repo_id: "repo_abc",
      policy: { allowed: true, surface: "log" },
      filters: {
        command,
        scan_id: null,
        repo_contract_id: null
      },
      summary: {
        repo_contract_id: "contract_abc",
        total_count: 1,
        returned_count: 1,
        latest_passed_count: 1,
        latest_failed_count: 0
      },
      latest_by_command: [{
        execution_id: "required_check_execution_abc",
        command,
        status: "passed",
        stdout_hash: createHash("sha256").update("ok").digest("hex"),
        stderr_hash: createHash("sha256").update("").digest("hex")
      }],
      executions: [{
        execution_id: "required_check_execution_abc",
        command,
        status: "passed",
        argv: ["node", "-e", "process.stdout.write('ok')"]
      }]
    });
    expect(proof.latest_by_command[0]).not.toHaveProperty("stdout_preview");
    expect(proof.latest_by_command[0]).not.toHaveProperty("stderr_preview");
    expect(proof.executions[0]).not.toHaveProperty("stdout_preview");
    expect(proof.executions[0]).not.toHaveProperty("stderr_preview");
  });

  it("exposes middleware coverage proof summaries without snippets", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFacts([{
      id: "fact_middleware_protects_users",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "middleware_protects_route",
      file_path: "apps/web/app/api/users/route.ts",
      name: "middleware:middleware.ts",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        middleware_id: "middleware:middleware.ts",
        protection_kind: "auth"
      }),
      imported_name: "auth",
      start_line: 1,
      end_line: 1,
      ...factQuality("scan_abc")
    }]);
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_dynamic_middleware",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "partial_parse",
      file_path: "middleware.ts",
      start_line: 10,
      end_line: 10,
      confidence_impact: "blocks_enforcement",
      message: "unsupported_dynamic_middleware_matcher",
      evidence_refs: ["parser_gap_dynamic_middleware"],
      created_at: "2026-05-25T00:00:00.000Z"
    }]);
    storage.close();

    const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
      repo_id: "repo_abc"
    } as never) as Record<string, unknown>;

    expect(securityContext.response_schema).toBe("drift.security.context.v2");
    expect(securityContext.middleware_coverage).toBeUndefined();
    expect(securityContext.parser_gap_summaries).toEqual([]);
    expect(JSON.stringify(securityContext)).not.toContain("requireUser()");
  });

  it("v2 security context does not include legacy raw-fact sections", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFacts([{
      id: "fact_request_body_secret",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "request_input_read",
      file_path: "apps/web/app/api/users/route.ts",
      name: "body",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:POST",
        source: "request.json()",
        variable: "body",
        cookie: "session=secret"
      }),
      imported_name: undefined,
      start_line: 1,
      end_line: 1,
      ...factQuality("scan_abc")
    }, {
      id: "fact_tenant_secret",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "tenant_source",
      file_path: "apps/web/app/api/users/route.ts",
      name: "tenantId",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        variable: "session.user.tenantId",
        trusted: true
      }),
      imported_name: undefined,
      start_line: 2,
      end_line: 2,
      ...factQuality("scan_abc")
    }]);
    storage.close();

    const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
      repo_id: "repo_abc"
    } as never) as Record<string, unknown>;

    expect(securityContext.response_schema).toBe("drift.security.context.v2");
    expect(securityContext.middleware_coverage).toBeUndefined();
    expect(securityContext.request_validation).toBeUndefined();
    expect(securityContext.session_trust).toBeUndefined();
    expect(securityContext.authorization).toBeUndefined();
    expect(securityContext.tenant_scope).toBeUndefined();
    expect(securityContext.current_proof_status).toEqual([]);
    expect(securityContext.required_proofs).toEqual(expect.any(Array));
    expect(JSON.stringify(securityContext)).not.toContain("request.json()");
    expect(JSON.stringify(securityContext)).not.toContain("session.user.tenantId");
    expect(JSON.stringify(securityContext)).not.toContain("cookie");
  });

  it("exposes request validation proof summaries without snippets", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const validationConvention = {
      id: "security_api_request_validation",
      contract_id: "contract_abc",
      kind: "api_route_requires_request_validation" as const,
      statement: "API request input must be validated before protected sinks.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route" as const] },
      matcher: {
        kind: "api_route_requires_request_validation" as const,
        applies_to_file_roles: ["api_route" as const]
      },
      requires: {
        validators: ["validateProjectInput"],
        schemas: ["ProjectInputSchema"]
      },
      severity: "error" as const,
      enforcement_mode: "block" as const,
      enforcement_capability: "deterministic_check" as const,
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-25T00:00:00.000Z",
      updated_at: "2026-05-25T00:00:00.000Z"
    };
    storage.upsertAcceptedConvention("repo_abc", validationConvention);
    storage.upsertRepoContract({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fp",
      created_at: "2026-05-25T00:00:00.000Z",
      updated_at: "2026-05-25T00:00:00.000Z",
      conventions: [validationConvention],
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
    storage.upsertFacts([{
      id: "fact_request_body",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "request_input_read",
      file_path: "apps/web/app/api/projects/route.ts",
      name: "body",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/projects/route.ts:POST",
        source: "body",
        variable: "body"
      }),
      imported_name: undefined,
      start_line: 3,
      end_line: 3,
      ...factQuality("scan_abc")
    }, {
      id: "fact_validated_use",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "validated_input_used",
      file_path: "apps/web/app/api/projects/route.ts",
      name: "input",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/projects/route.ts:POST",
        source_input_var: "body",
        validated_var: "input",
        sink_fact_id: "fact_sink",
        sink_kind: "data_operation"
      }),
      imported_name: undefined,
      start_line: 5,
      end_line: 5,
      ...factQuality("scan_abc")
    }]);
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_request_spread",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "partial_parse",
      file_path: "apps/web/app/api/projects/route.ts",
      start_line: 8,
      end_line: 8,
      confidence_impact: "blocks_enforcement",
      message: "unsupported_request_input_spread",
      evidence_refs: ["parser_gap_request_spread"],
      created_at: "2026-05-25T00:00:00.000Z"
    }]);
    storage.close();

    const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
      repo_id: "repo_abc"
    } as never) as {
      repo_security_contracts: Array<{ kind: string }>;
      request_validation?: unknown;
      parser_gap_summaries: unknown[];
      do_not_include: string[];
    };

    expect(securityContext.repo_security_contracts).toContainEqual(expect.objectContaining({
      kind: "api_route_requires_request_validation"
    }));
    expect(securityContext.request_validation).toBeUndefined();
    expect(securityContext.parser_gap_summaries).toEqual([]);
    expect(securityContext.do_not_include).toContain("secret values");
    expect(JSON.stringify(securityContext)).not.toContain("request.json()");
    expect(JSON.stringify(securityContext)).not.toContain("session=secret");
  });

  it("marks grouped app api raw fact security context fallbacks explicitly", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFacts([{
      id: "fact_grouped_api_role",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "file_role_detected",
      file_path: "apps/web/app/(admin)/api/projects/route.ts",
      name: "api_route",
      value: undefined,
      imported_name: undefined,
      start_line: 1,
      end_line: 1,
      ...factQuality("scan_abc")
    }, {
      id: "fact_grouped_route_declared",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "route_declared",
      file_path: "apps/web/app/(admin)/api/projects/route.ts",
      name: "GET",
      value: "GET",
      imported_name: undefined,
      start_line: 3,
      end_line: 3,
      ...factQuality("scan_abc")
    }]);
    storage.close();

    const handlers = createReadOnlyMcpHandlers({ databasePath });
    const repoMap = handlers.get_repo_map({
      repo_id: "repo_abc"
    } as never) as {
      canonical_route_fallback: { used: boolean; reason: string | null };
      routes: Array<{ route_id: string; file_path: string; path: string | null; method: string; source?: string }>;
    };
    const securityContext = handlers.get_security_context({
      repo_id: "repo_abc"
    } as never) as {
      canonical_route_fallback: { used: boolean; reason: string | null };
      routes: Array<{ route_id: string; file_path: string; path: string | null; method: string; source?: string }>;
    };

    expect(repoMap.canonical_route_fallback).toEqual({
      used: true,
      reason: "normalized_entrypoints_missing"
    });
    expect(repoMap.routes).toContainEqual(expect.objectContaining({
      route_id: "route:apps/web/app/api/users/route.ts:GET",
      file_path: "apps/web/app/api/users/route.ts",
      path: null,
      method: "GET",
      source: "legacy_fact_fallback"
    }));
    expect(securityContext.canonical_route_fallback).toEqual({
      used: true,
      reason: "normalized_entrypoints_missing"
    });
    expect(securityContext.routes).toContainEqual(expect.objectContaining({
      route_id: "route:apps/web/app/(admin)/api/projects/route.ts:GET",
      file_path: "apps/web/app/(admin)/api/projects/route.ts",
      path: null,
      method: "GET",
      source: "legacy_fact_fallback"
    }));
  });

  it("exposes phase4 security proof summaries without snippets", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const phase4Conventions = [{
      id: "security_session_trust",
      contract_id: "contract_abc",
      kind: "session_object_must_come_from_trusted_helper" as const,
      statement: "Session objects must come from accepted auth helpers.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route" as const] },
      matcher: {
        kind: "session_object_must_come_from_trusted_helper" as const,
        applies_to_file_roles: ["api_route" as const]
      },
      requires: {
        auth_helpers: [{ guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }]
      },
      severity: "error" as const,
      enforcement_mode: "block" as const,
      enforcement_capability: "deterministic_check" as const,
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z"
    }, {
      id: "security_api_authorization",
      contract_id: "contract_abc",
      kind: "api_route_requires_authorization" as const,
      statement: "API routes require accepted authorization guard proof.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route" as const] },
      matcher: {
        kind: "api_route_requires_authorization" as const,
        applies_to_file_roles: ["api_route" as const]
      },
      requires: {
        auth_helpers: [{ guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }],
        authorization_helpers: ["requireRole"]
      },
      severity: "error" as const,
      enforcement_mode: "block" as const,
      enforcement_capability: "deterministic_check" as const,
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z"
    }, {
      id: "security_api_tenant_scope",
      contract_id: "contract_abc",
      kind: "api_route_requires_tenant_scope" as const,
      statement: "API routes require tenant scoped data access.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route" as const] },
      matcher: {
        kind: "api_route_requires_tenant_scope" as const,
        applies_to_file_roles: ["api_route" as const]
      },
      requires: {
        auth_helpers: [{ guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }],
        tenant_keys: ["tenantId"],
        tenant_sources: ["session"]
      },
      severity: "error" as const,
      enforcement_mode: "block" as const,
      enforcement_capability: "deterministic_check" as const,
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "local-user",
      accepted_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z"
    }];
    for (const convention of phase4Conventions) {
      storage.upsertAcceptedConvention("repo_abc", convention);
    }
    storage.upsertRepoContract({
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fp",
      created_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z",
      conventions: phase4Conventions,
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
    storage.upsertFacts([{
      id: "fact_session",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "session_read",
      file_path: "apps/web/app/api/projects/route.ts",
      name: "session",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/projects/route.ts:GET",
        variable: "session",
        source: "auth_result",
        trust: "trusted"
      }),
      imported_name: undefined,
      start_line: 3,
      end_line: 3,
      ...factQuality("scan_abc")
    }, {
      id: "fact_authz",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "authorization_guard_called",
      file_path: "apps/web/app/api/projects/route.ts",
      name: "requireRole",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/projects/route.ts:GET",
        policy_id: "authorization_require_role",
        roles: ["admin"],
        subject_var: "session.user"
      }),
      imported_name: undefined,
      start_line: 4,
      end_line: 4,
      ...factQuality("scan_abc")
    }, {
      id: "fact_tenant_source",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "tenant_source",
      file_path: "apps/web/app/api/projects/route.ts",
      name: "tenantId",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/projects/route.ts:GET",
        source: "session",
        key: "tenantId",
        variable: "session.user.tenantId",
        trusted: true
      }),
      imported_name: undefined,
      start_line: 5,
      end_line: 5,
      ...factQuality("scan_abc")
    }]);
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_tenant_dynamic",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "partial_parse",
      file_path: "apps/web/app/api/projects/route.ts",
      start_line: 8,
      end_line: 8,
      confidence_impact: "blocks_enforcement",
      message: "unsupported_tenant_dynamic_property",
      evidence_refs: ["parser_gap_tenant_dynamic"],
      created_at: "2026-05-26T00:00:00.000Z"
    }]);
    storage.close();

    const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
      repo_id: "repo_abc"
    } as never) as {
      repo_security_contracts: Array<{ kind: string }>;
      session_trust?: unknown;
      authorization?: unknown;
      tenant_scope?: unknown;
      parser_gap_summaries: unknown[];
      do_not_include: string[];
    };

    expect(securityContext.repo_security_contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "session_object_must_come_from_trusted_helper" }),
      expect.objectContaining({ kind: "api_route_requires_authorization" }),
      expect.objectContaining({ kind: "api_route_requires_tenant_scope" })
    ]));
    expect(securityContext.session_trust).toBeUndefined();
    expect(securityContext.authorization).toBeUndefined();
    expect(securityContext.tenant_scope).toBeUndefined();
    expect(securityContext.parser_gap_summaries).toEqual([]);
    expect(securityContext.do_not_include).toContain("secret values");
    expect(JSON.stringify(securityContext)).not.toContain("session.user.tenantId");
    expect(JSON.stringify(securityContext)).not.toContain("session=secret");
    expect(JSON.stringify(securityContext)).not.toContain("request.json()");
  });

  it("derives Phase 5 MCP context from trusted stored proof, not raw facts", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertSecurityBoundaryProofs({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      created_at: "2026-05-25T00:00:00.000Z",
      proofs: [{
        proof_id: "proof:route:apps/web/app/api/users/route.ts:GET:phase5",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route:apps/web/app/api/users/route.ts:GET",
          file_path: "apps/web/app/api/users/route.ts",
          file_role: "api_route",
          handler_symbol: "GET"
        },
        contracts: [{
          contract_id: "security_api_sensitive_response",
          kind: "api_route_forbids_sensitive_response_fields",
          enforcement_mode: "block",
          capability: "deterministic_check",
          matched: true
        }],
        capability_status: [{
          name: "response_shape_facts",
          status: "partial",
          can_block: true,
          parser_gap_ids: [],
          missing_proof_ids: ["missing_proof_sensitive"]
        }],
        auth: {
          required: false,
          proven: false,
          proof_kind: "none",
          trusted_guard_calls: [],
          dominated_sinks: [],
          undominated_sinks: []
        },
        response_shape: {
          required: true,
          proven: false,
          sensitive_leaks: [{
            field_fact_id: "fact:apps/web/app/api/users/route.ts:4",
            field_path: "user.email",
            reason: "sensitive_field_without_serializer"
          }]
        },
        sinks: { secrets: [] },
        missing_proof: [{
          id: "missing_proof_sensitive",
          capability: "response_shape_facts",
          code: "sensitive_response_field_unfiltered",
          blocks_enforcement: true,
          fact_ids: ["fact:apps/web/app/api/users/route.ts:4"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_sensitive"]
        }
      }]
    });
    storage.close();

    const securityContext = createReadOnlyMcpHandlers({ databasePath }).get_security_context({
      repo_id: "repo_abc"
    } as never) as {
      current_proof_status: Array<{
        route_id: string;
        file_path: string;
        path: string | null;
        method: string | null;
        proof_status: string;
        enforcement_result: string;
        source?: string;
        freshness?: string;
      }>;
      changed_route_security: Array<{
        route_id: string;
        file_path: string;
        current_proof_status: string;
        missing_proof: Array<{ code: string }>;
      }>;
    };

    expect(securityContext.current_proof_status).toEqual([expect.objectContaining({
      route_id: "route:apps/web/app/api/users/route.ts:GET",
      file_path: "apps/web/app/api/users/route.ts",
      path: null,
      method: "GET",
      proof_status: "missing_proof",
      enforcement_result: "block",
      source: "security_proof",
      freshness: "fresh"
    })]);
    expect(securityContext.changed_route_security).toEqual([expect.objectContaining({
      route_id: "route:apps/web/app/api/users/route.ts:GET",
      file_path: "apps/web/app/api/users/route.ts",
      current_proof_status: "missing_proof",
      missing_proof: [expect.objectContaining({ code: "sensitive_response_field_unfiltered" })]
    })]);
    expect(JSON.stringify(securityContext)).not.toContain("redacted@example.test");
    expect(JSON.stringify(securityContext)).not.toContain("process.env");
  });

  it("does not report an excluded file as in scope for a convention (BB-11)", async () => {
    // BB-11, behaviourally. The differential in scope-predicate-bb11.test.ts compares predicates;
    // this one goes through `get_task_preflight` -> `relevantFilesForTask` -> the scope decision at
    // packages/mcp/src/index.ts:2160, so it fails if that seam reverts to deciding scope itself.
    //
    // The defect: :2160 applied `path_globs` only and never consulted `exclude_path_globs`, so a file
    // an author had explicitly excluded was still labelled "in scope for <convention_id>" on this
    // agent-facing surface, and inherited that convention's roles.
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const [convention] = contract.conventions;
    storage.upsertAcceptedConvention("repo_abc", {
      ...convention,
      scope: { ...convention.scope, exclude_path_globs: ["**/api/users/**"] }
    });
    storage.upsertRepoContract({
      ...contract,
      conventions: [{
        ...convention,
        scope: { ...convention.scope, exclude_path_globs: ["**/api/users/**"] }
      }]
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath }).get_task_preflight({
      repo_id: "repo_abc",
      task: "change users api route",
      path: "apps/web/app/api/users/route.ts"
    }) as { relevant_files: Array<{ path: string; reasons: string[]; roles: string[] }> };

    const excluded = preflight.relevant_files.find(
      (file) => file.path === "apps/web/app/api/users/route.ts"
    );
    // It is still relevant - it is the requested path - but not because it is in this convention's
    // scope, and it must not inherit the convention's roles through a scope claim it does not satisfy.
    expect(excluded?.reasons ?? []).not.toContain(`in scope for ${convention.id}`);
  });

  it("includes scan symbol identities in MCP change impact", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertSymbolIdentities([{
      schema_version: "drift.symbol_identity.v1",
      symbol_id: "symbol_route_get",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      symbol_name: "GET",
      kind: "function",
      declared_in: "apps/web/app/api/users/route.ts",
      exported_from: ["apps/web/app/api/users/route.ts"],
      imported_as: [],
      re_export_chain: [],
      canonical_definition: "apps/web/app/api/users/route.ts#GET",
      call_sites: [],
      references: [],
      visibility: "exported"
    }]);
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath }).get_task_preflight({
      repo_id: "repo_abc",
      task: "change users api route",
      path: "apps/web/app/api/users/route.ts"
    }) as { change_impact: { changed_symbols: string[] } };

    expect(preflight.change_impact.changed_symbols).toEqual([
      "apps/web/app/api/users/route.ts#GET"
    ]);
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

  it("returns first-run MCP preflight before a contract exists without inventing conventions", async () => {
    const { databasePath, repoId } = await seedMcpNoContractDatabase();
    const preflight = createReadOnlyMcpHandlers({ databasePath }).get_task_preflight({
      repo_id: repoId,
      task: "add users api route",
      path: "apps/web/app/api/users/route.ts",
      now: "2026-05-10T00:01:00.000Z"
    }) as {
      contract: { ready: boolean; id: string | null; source: string };
      summary: {
        contract_ready: boolean;
        candidate_count: number;
        convention_count: number;
        relevant_file_count: number;
      };
      conventions: unknown[];
      relevant_files: Array<{ path: string; reasons: string[] }>;
      next_commands: string[];
    };

    expect(preflight.contract).toMatchObject({
      ready: false,
      id: null,
      source: "default_local_policy"
    });
    expect(preflight.summary).toMatchObject({
      contract_ready: false,
      candidate_count: 1,
      convention_count: 0,
      relevant_file_count: 1
    });
    expect(preflight.conventions).toEqual([]);
    expect(preflight.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);
    expect(preflight.next_commands).toEqual([
      `drift conventions list --repo ${repoId} --status candidate --json`,
      `drift repo map --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]);
  });

  it("MCP preflight derives semantic coverage from scan capability vocabulary", async () => {
    const { databasePath, repoId } = await seedMcpNoContractDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: repoId,
        scan_id: "scan_no_contract",
        root_hash: "repo-no-contract-fp",
        branch: "unknown",
        commit: "abc123",
        dirty: false
      },
      snapshots: storage.listFileSnapshots(repoId, "scan_no_contract"),
      nodes: [],
      edges: [],
      evidence: [],
      createdAt: "2026-05-10T00:00:08.000Z"
    }));
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: repoId,
      scan_id: "scan_no_contract",
      engine_source: "rust",
      engine_version: null,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      certified_capabilities: ["graph_stream", "syntax_facts", "file_discovery", "route_flow"],
      required_capabilities: ["graph_stream", "syntax_facts", "file_discovery", "unknown_capability"],
      missing_capabilities: [],
      completeness: [],
      parser_gap_count: 0,
      parser_gap_kinds: {},
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-05-10T00:00:45.000Z"
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath }).get_task_preflight({
      repo_id: repoId,
      task: "change users api route",
      path: "apps/web/app/api/users/route.ts",
      now: "2026-05-10T00:01:00.000Z"
    }) as {
      semantic_coverage: Record<string, unknown>;
    };

    // D-S1: the required list is now the engine's own vocabulary rather than four `ts.*.v1` ids
    // translated out of it, and `graph_stream` - which every scan requires - survives instead of
    // vanishing into an unknown capability. Only the genuinely unknown name fails the run closed.
    expect(preflight.semantic_coverage).toMatchObject({
      required_capabilities: [
        "file_discovery",
        "graph_stream",
        "route_flow",
        "syntax_facts",
        "unknown_capability"
      ],
      complete_capabilities: [
        "file_discovery",
        "graph_stream",
        "route_flow",
        "syntax_facts"
      ],
      missing_capabilities: ["unknown_capability"],
      unsupported_capabilities: ["unknown_capability"],
      decision: "refuse"
    });
  });

  it("returns MCP repo map before a contract exists using the default local policy", async () => {
    const { databasePath, repoId } = await seedMcpNoContractDatabase();
    const repoMap = createReadOnlyMcpHandlers({ databasePath }).get_repo_map({
      repo_id: repoId
    }) as {
      policy: { allowed: boolean; surface: string };
      summary: { indexed_file_count: number; listed_file_count: number };
      files: Array<{
        path: string;
        roles: string[];
        convention_ids: string[];
        risky_area_ids: string[];
        open_finding_ids: string[];
      }>;
      redactions: { source_content_included: boolean; snippets_included: boolean };
    };

    expect(repoMap.policy).toMatchObject({
      allowed: true,
      surface: "cli-preflight"
    });
    expect(repoMap.summary).toMatchObject({
      indexed_file_count: 1,
      listed_file_count: 1
    });
    expect(repoMap.files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        roles: ["api_route"],
        convention_ids: [],
        risky_area_ids: [],
        open_finding_ids: []
      })
    ]);
    expect(repoMap.redactions).toMatchObject({
      source_content_included: false,
      snippets_included: false
    });
  });

  it("returns allowed context before a contract exists using the default local policy", async () => {
    const { databasePath, repoId } = await seedMcpNoContractDatabase();
    const allowedContext = createReadOnlyMcpHandlers({ databasePath }).get_allowed_context({
      repo_id: repoId,
      path: "apps/web/app/api/users/route.ts"
    }) as {
      contract?: { ready: boolean; id: string | null; source: string };
      decision: { allowed: boolean; surface: string; mode: string };
      redactions: { allow_full_file_content: boolean; max_snippet_chars: number };
      file_context: { convention_ids: string[]; risky_area_ids: string[] };
      summary: { allowed: boolean };
    };

    expect(allowedContext.contract).toMatchObject({
      ready: false,
      id: null,
      source: "default_local_policy"
    });
    expect(allowedContext.decision).toMatchObject({
      allowed: true,
      surface: "mcp",
      mode: "local_only"
    });
    expect(allowedContext.file_context).toMatchObject({
      convention_ids: [],
      risky_area_ids: []
    });
    expect(allowedContext.redactions).toMatchObject({
      allow_full_file_content: false,
      max_snippet_chars: 1200
    });
    expect(allowedContext.summary.allowed).toBe(true);
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

  it("applies legacy MCP api-route scopes to grouped app routes", async () => {
    const databasePath = await seedMcpDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const repoRoot = storage.getRepo("repo_abc")!.root_path;
    const groupedRoute = "apps/web/app/(admin)/api/users/route.ts";
    await mkdir(join(repoRoot, "apps/web/app/(admin)/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, groupedRoute),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [{
        command: "drift check --diff main...HEAD",
        applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
        reason: "Validate accepted API route conventions."
      }],
      risky_areas: [{
        id: "risk_api_routes",
        path_globs: ["apps/web/app/api/**/route.ts"],
        risk_kind: "data_access",
        reason: "API route changes can bypass data-access layering."
      }]
    });
    storage.close();

    const preflight = createReadOnlyMcpHandlers({ databasePath })
      .get_task_preflight({ repo_id: "repo_abc", task: "change users api route", path: groupedRoute }) as {
        relevant_files: Array<{ path: string; roles: string[] }>;
        summary: { required_check_count: number; risky_area_count: number };
        required_checks: Array<{ command: string; matched_files: string[] }>;
        risky_areas: Array<{ id: string; matched_files: string[] }>;
      };

    expect(preflight.relevant_files).toContainEqual(expect.objectContaining({
      path: groupedRoute,
      roles: ["api_route"]
    }));
    expect(preflight.summary).toMatchObject({
      required_check_count: 1,
      risky_area_count: 1
    });
    expect(preflight.required_checks).toContainEqual(expect.objectContaining({
      matched_files: expect.arrayContaining([groupedRoute])
    }));
    expect(preflight.risky_areas).toContainEqual(expect.objectContaining({
      matched_files: expect.arrayContaining([groupedRoute])
    }));
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
        end_line: 1,
        ...factQuality()
      },
      {
        id: "fact_role_core_service",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "packages/core/src/service.ts",
        name: "service_module",
        start_line: 1,
        end_line: 1,
        ...factQuality()
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
      repo_id: "repo_abc"
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
      "get_security_context",
      "get_task_preflight",
      "get_conventions",
      "get_findings",
      "get_required_check_executions",
      "get_allowed_context"
    ]);
    // D-M4 / D-M4b: both filters are the vocabulary itself, so the assertion is that they ARE the
    // vocabulary rather than a second transcription of it. The old lists were 17 of 21 roles and 9
    // of 23 convention kinds - and both were frozen here in exactly that shape, which is why a hand
    // list is checked against the source and not against a copy of itself.
    const repoMapRoleSchema = DRIFT_READ_ONLY_MCP_TOOLS.find((tool) => tool.name === "get_repo_map")
      ?.inputSchema.properties.role as { enum?: string[] } | undefined;
    expect(repoMapRoleSchema?.enum).toEqual([...FILE_ROLES]);
    expect(repoMapRoleSchema?.enum).toContain("ui_component");

    const conventionKindSchema = DRIFT_READ_ONLY_MCP_TOOLS.find((tool) => tool.name === "get_conventions")
      ?.inputSchema.properties.kind as { enum?: string[] } | undefined;
    expect(conventionKindSchema?.enum).toEqual([...CONVENTION_KINDS]);
    expect(conventionKindSchema?.enum).toContain("api_route_forbids_untrusted_ssrf");
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
        // 33 since CV-1's migration 033_convention_candidate_superseded_by. This pin exists to make a
        // schema change deliberate, so it moves with one - and CV-1 landed without running this suite,
        // which is how it moved a commit later than the migration did.
        supported_sqlite_schema_version: MIGRATIONS.length,
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
