import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { MIGRATIONS, openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";

const tempDirs: string[] = [];

function factQuality(scanId: string) {
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

function phase8SecurityProof(overrides: Record<string, unknown> = {}) {
  return {
    proof_id: "proof_route_users_get_auth",
    proof_version: "security-boundary-proof/v1",
    route: {
      route_id: "route_users_get",
      file_path: "apps/web/app/api/users/route.ts",
      file_role: "api_route",
      endpoint: { path: "/api/users", method: "GET", framework: "next" }
    },
    contracts: [{
      contract_id: "security_auth",
      kind: "api_route_requires_auth_helper",
      enforcement_mode: "block",
      capability: "deterministic_check",
      matched: true
    }],
    capability_status: [{
      name: "control_flow_guard_dominance",
      status: "complete",
      can_block: true,
      parser_gap_ids: [],
      missing_proof_ids: []
    }],
    auth: {
      required: true,
      proven: true,
      proof_kind: "handler_guard",
      trusted_guard_calls: [{
        fact_id: "fact_auth_guard",
        guard_id: "guard_require_user",
        symbol: "requireUser",
        start_line: 2,
        end_line: 2
      }],
      dominated_sinks: [{
        sink_id: "sink_response",
        sink_kind: "response",
        edge_id: "edge_guard_response"
      }],
      undominated_sinks: []
    },
    missing_proof: [],
    parser_gaps: [],
    result: {
      proof_status: "proven",
      enforcement_result: "pass",
      can_block: true,
      finding_ids: []
    },
    ...overrides
  };
}

async function seedDatabase(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-cli-"));
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
    requires: { forbidden_imports: ["@/lib/prisma"] },
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
    matcher_fingerprint: "matcher_fp",
    scope_fingerprint: "scope_fp",
    graph_fingerprint: "graph_fp",
    evidence_fingerprint: "evidence_fp",
    required_capabilities: ["syntax_facts", "import_resolution"],
    reason_not_blocking: "candidate_not_accepted",
    status: "candidate",
    created_at: "2026-05-10T00:00:01.000Z"
  });
  storage.close();
  return databasePath;
}

function upsertReviewFinding(storage: ReturnType<typeof openDriftStorage>): void {
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
      scan_id: "scan_baseline",
      file_hash: "a".repeat(64),
      redaction_state: "none"
    }],
    created_at: "2026-05-10T00:00:02.000Z"
  });
}

function upsertReviewFindingGraphEvidence(storage: ReturnType<typeof openDriftStorage>): void {
  storage.upsertScanManifest({
    id: "scan_baseline",
    repo_id: "repo_abc",
    branch: "main",
    commit: "abc123",
    dirty: false,
    scanner_version: "0.1.0",
    adapter_versions: { typescript: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed",
    file_count: 1,
    fact_count: 1,
    finding_count: 1,
    started_at: "2026-05-10T00:00:00.000Z",
    completed_at: "2026-05-10T00:00:01.000Z"
  });
  storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
    repo: {
      repo_id: "repo_abc",
      scan_id: "scan_baseline",
      root_hash: "root_hash",
      branch: "main",
      commit: "abc123",
      dirty: false
    },
    snapshots: [{
      repo_id: "repo_abc",
      scan_id: "scan_baseline",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    }],
    nodes: [{
      id: "import_decl:apps/web/app/api/users/route.ts:prisma",
      kind: "import_decl",
      label: "prisma from @/lib/prisma",
      stable: true,
      evidence_ids: ["graph_evidence_import"],
      metadata: {
        file_path: "apps/web/app/api/users/route.ts",
        source: "@/lib/prisma",
        local_name: "prisma"
      }
    }],
    edges: [{
      id: "edge:finding:finding_abc:FINDING_HAS_EVIDENCE:graph_evidence_import",
      kind: "FINDING_HAS_EVIDENCE",
      from: "finding:finding_abc",
      to: "graph_evidence_import",
      evidence_ids: ["graph_evidence_import"],
      metadata: {}
    }],
    evidence: [{
      id: "graph_evidence_import",
      repo_id: "repo_abc",
      scan_id: "scan_baseline",
      artifact_id: "file_version:apps/web/app/api/users/route.ts:aaaaaaaaaaaa",
      file_path: "apps/web/app/api/users/route.ts",
      file_hash: "a".repeat(64),
      start_line: 1,
      end_line: 1,
      adapter_id: "typescript",
      adapter_version: "0.1.0",
      fact_ids: ["fact_import_abc"],
      redaction_state: "none"
    }],
    createdAt: "2026-05-10T00:00:00.000Z"
  }));
}

function markBackupWithFutureSchema(databasePath: string): void {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  const raw = storage as unknown as {
    db: {
      prepare: (sql: string) => { run: (...args: unknown[]) => void };
    };
  };
  raw.db
    .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
    .run("999_future_schema", "2026-05-10T00:00:05.000Z");
  storage.close();
}

function replaceBackupMigrationWithUnknown(databasePath: string): void {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  const raw = storage as unknown as {
    db: {
      prepare: (sql: string) => { run: (...args: unknown[]) => void };
    };
  };
  raw.db
    .prepare("DELETE FROM schema_migrations WHERE id = ?")
    .run("004_backup_manifests");
  raw.db
    .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
    .run("004_unknown_future_schema", "2026-05-10T00:00:05.000Z");
  storage.close();
}

function deleteBackupMigration(databasePath: string, migrationId: string): void {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
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

function removeResolverInputsFromScan(databasePath: string, scanId: string): void {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  const raw = storage as unknown as {
    db: {
      prepare: (sql: string) => { run: (...args: unknown[]) => void };
    };
  };
  raw.db
    .prepare("UPDATE scan_manifests SET adapter_versions_json = ? WHERE id = ?")
    .run(JSON.stringify({ typescript: "0.1.0", resolver: "0.1.0" }), scanId);
  storage.close();
}

function tamperFirstAuditEvent(databasePath: string): void {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  const raw = storage as unknown as {
    db: {
      prepare: (sql: string) => { run: (...args: unknown[]) => void };
    };
  };
  raw.db
    .prepare("UPDATE audit_events SET metadata_json = ? WHERE id = (SELECT id FROM audit_events ORDER BY rowid LIMIT 1)")
    .run(JSON.stringify({ tampered: true }));
  storage.close();
}

function appliedMigrationIds(databasePath: string): string[] {
  const storage = openDriftStorage({ databasePath });
  const migrations = storage.getAppliedMigrations();
  storage.close();
  return migrations;
}

async function seedAcceptedDatabase(): Promise<{ databasePath: string; repoRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-check-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/web/app/api/users/route.ts"),
    [
      "import { prisma } from \"@/lib/prisma\";",
      "",
      "export async function POST() {",
      "  return Response.json(await prisma.user.findMany());",
      "}",
      ""
    ].join("\n")
  );
  const diffPath = join(dir, "diff.patch");
  await writeFile(diffPath, [
    "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
    "--- a/apps/web/app/api/users/route.ts",
    "+++ b/apps/web/app/api/users/route.ts",
    "@@ -0,0 +1,5 @@",
    "+import { prisma } from \"@/lib/prisma\";",
    "+",
    "+export async function POST() {",
    "+  return Response.json(await prisma.user.findMany());",
    "+}",
    ""
  ].join("\n"));

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
  storage.upsertAcceptedConvention("repo_abc", {
    id: "convention_no_direct_db",
    contract_id: "contract_abc",
    kind: "api_route_no_direct_data_access",
    statement: "API routes must not import data-access clients directly.",
    scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
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
    accepted_by: "local-user",
    accepted_at: "2026-05-10T00:00:02.000Z",
    updated_at: "2026-05-10T00:00:02.000Z"
  });
  storage.upsertRepoContract({
    id: "contract_abc",
    repo_id: "repo_abc",
    contract_schema_version: 1,
    repo_fingerprint: "repo-fp",
    created_at: "2026-05-10T00:00:03.000Z",
    updated_at: "2026-05-10T00:00:03.000Z",
    conventions: storage.listAcceptedConventions("repo_abc"),
    rejected_inferences: [],
    waivers: [],
    risky_areas: [],
    layer_architecture: {
      schema_version: "drift.layer_architecture.v1",
      architecture_id: "architecture_typescript_api_route_layering",
      repo_id: "repo_abc",
      version: 1,
      layers: [
        { id: "route", role: "route", position: "entrypoint" },
        { id: "service", role: "service", position: "middle" },
        { id: "data_access", role: "data_access", position: "terminal" }
      ],
      allowed_edges: [
        { from_layer: "route", to_layer: "service", edge_kind: "imports" },
        { from_layer: "service", to_layer: "data_access", edge_kind: "imports" }
      ],
      forbidden_edges: [{ from_layer: "route", to_layer: "data_access", edge_kind: "imports" }],
      soft_edges: []
    },
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
  storage.close();
  return { databasePath, repoRoot };
}

async function seedStartedDoctorState(prefix = "drift-doctor-started-"): Promise<{
  databasePath: string;
  repoId: string;
  repoRoot: string;
  stateRoot: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/web/app/api/users/route.ts"),
    [
      "import { prisma } from \"@/lib/prisma\";",
      "export async function GET() {",
      "  return Response.json(await prisma.user.findMany());",
      "}",
      ""
    ].join("\n")
  );
  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-05-10T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  return {
    databasePath: payload.state.database_path,
    repoId: payload.repo.id,
    repoRoot,
    stateRoot
  };
}

async function seedScannedNoContractState(prefix = "drift-no-contract-"): Promise<{
  databasePath: string;
  repoId: string;
  repoRoot: string;
  stateRoot: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
  await writeFile(
    join(repoRoot, "apps/web/app/api/users/route.ts"),
    [
      "import { prisma } from \"@/lib/prisma\";",
      "export async function GET() {",
      "  return Response.json(await prisma.user.findMany());",
      "}",
      ""
    ].join("\n")
  );

  const scanned = await runCli([
    "scan",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--now", "2026-05-10T00:00:30.000Z",
    "--json"
  ]);
  expect(scanned.exitCode).toBe(0);
  const payload = JSON.parse(scanned.stdout);
  expect(payload.accepted).toBeUndefined();
  return {
    databasePath: payload.database_path,
    repoId: payload.repo.id,
    repoRoot,
    stateRoot
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("drift CLI convention review", () => {
  it("reports unknown commands before requiring a database", async () => {
    const result = await runCli(["chek", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: chek. Run drift --help.");
    expect(result.stderr).not.toContain("Missing --db");
  });

  it("prints machine-readable capability metadata without requiring a database", async () => {
    const result = await runCli(["capabilities", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
      supported_sqlite_schema_version: 25,
      storage_driver: "sqlite"
    });
    expect(payload.v1_scope).toMatchObject({
      product_mode: "local_first_cli",
      primary_wedge: "typescript_api_route_layering",
      source_mutation: false
    });
    expect(payload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(payload.capabilities.read_only_cli).toContain("prepare");
    expect(payload.capabilities.read_only_cli).toContain("conventions accepted");
    expect(payload.capabilities.human_confirmed_cli).toEqual(expect.arrayContaining([
      "conventions accept --confirm",
      "conventions reject --confirm",
      "conventions edit --confirm",
      "conventions exception add --confirm",
      "findings mark-fixed --confirm",
      "findings mark-needs-review --confirm",
      "findings suppress --confirm",
      "findings accept-drift --confirm",
      "findings mark-false-positive --confirm",
      "baseline create --confirm",
      "baseline clear --confirm",
      "policy set-egress --confirm",
      "policy agent grant --confirm",
      "policy agent revoke --confirm",
      "contract export --confirm",
      "contract import --confirm",
      "contract waiver add --confirm",
      "contract waiver remove --confirm",
      "backup create --confirm",
      "restore --confirm"
    ]));
    expect(payload.capabilities.mcp_read_only_tools).toContain("get_runtime_info");
    expect(payload.capabilities.mcp_read_only_tools).toContain("get_capabilities");
    expect(payload.capabilities.mcp_mutation_tools).toEqual([]);
    expect(payload.capabilities.supported_wedge).toMatchObject({
      languages: ["typescript", "javascript"],
      storage: "sqlite"
    });
    expect(payload.capabilities.contract_parity.summary).toMatchObject({
      missing_count: 0,
      partial_beta_required_count: 0,
      not_implemented_count: 0
    });
    expect(payload.claims_manifest).toMatchObject({
      schema_version: "drift.production.claims.v1",
      allowed_claims: expect.arrayContaining(["local_first_cli", "typescript_api_route_layering", "incremental_reuse"]),
      blocked_claims: expect.arrayContaining(["cloud_sync", "mutation_capable_mcp"])
    });
    expect(payload.claims_manifest.blocked_claims).not.toContain("incremental_reuse");
  });

  it("persists repo identity fields used by beta and production release gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-identity-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "identity-fixture" }));
    await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(repoRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
    await writeFile(join(repoRoot, "apps/web/app/api/users/route.ts"), "export async function GET() { return Response.json([]); }\n");

    const result = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.repo).toMatchObject({
      vcs_provider: "none",
      remote_url_hash: null,
      package_manager: "pnpm"
    });
    expect(payload.repo.lockfile_hashes).toHaveProperty("pnpm-lock.yaml");
    expect(payload.repo.resolver_input_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("initializes a repo with a default local database path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.repo.id).toMatch(/^repo_/);
    expect(payload.database_path).toContain("drift.sqlite");
    await expect(stat(payload.database_path)).resolves.toBeTruthy();
  });

  it("does not duplicate repo-added audit events on repeated init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-idempotent-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(repoRoot, { recursive: true });

    const first = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const second = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:01.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const payload = JSON.parse(first.stdout);
    const storage = openDriftStorage({ databasePath: payload.database_path });
    storage.migrate();
    expect(storage.listAuditEvents(payload.repo.id).filter((event) => event.action === "repo_added")).toHaveLength(1);
    storage.close();
  });

  it("accepts equals-style flags for first-run setup commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-equals-flags-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      `--repo-root=${repoRoot}`,
      `--state-root=${stateRoot}`,
      "--now=2026-05-10T00:00:00.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.repo.root_path).toBe(repoRoot);
    expect(payload.database_path).toContain(stateRoot);
  });

  it("rejects duplicate flags instead of silently taking the last value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-duplicate-flags-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--repo-root", repoRoot,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Duplicate flag: --repo-root");
  });

  it("rejects empty flag names with a clean parser error", async () => {
    const result = await runCli(["init", "--"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Empty flag name");
  });

  it("rejects unknown flags instead of silently ignoring typos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-unknown-flag-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--unknwon",
      "value",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --unknwon");
  });

  it("rejects missing values for value flags", async () => {
    const result = await runCli([
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--snippet-chars",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--snippet-chars requires a value.");
  });

  it("rejects explicit values for boolean flags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-boolean-value-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--json=false"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--json does not accept a value.");
  });

  it("rejects empty equals-style values for value flags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-empty-equals-"));
    tempDirs.push(dir);

    const result = await runCli([
      "init",
      "--repo-root=",
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--repo-root requires a non-empty value.");
  });

  it("rejects invalid now timestamps before writing local state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-invalid-now-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--state-root", join(dir, "state"),
      "--now", "soon",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--now must be an ISO timestamp.");
  });

  it("rejects unexpected init positional arguments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-extra-arg-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "extra",
      "--repo-root", repoRoot,
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for init: extra");
  });

  it("rejects unexpected scan status positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status", "extra",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for scan status: extra");
  });

  it("rejects unexpected convention show positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "show", "candidate_no_direct_db", "extra",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for conventions show: extra");
  });

  it("rejects unexpected contract import positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "import", "/tmp/contract.json", "extra",
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for contract import: extra");
  });

  it("rejects unexpected finding resolution positional arguments", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed", "finding_abc", "extra",
      "--repo", "repo_abc",
      "--evidence", "apps/web/app/api/users/route.ts:12",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument for findings mark-fixed: extra");
  });

  it("rejects blank init actors before registering the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-blank-actor-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "init",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--actor", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--actor must not be empty");
    await expect(stat(stateRoot)).rejects.toThrow();
  });

  it("creates explicit database parent directories and rejects database directories cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-explicit-db-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const databasePath = join(dir, "state", "nested", "drift.sqlite");
    await mkdir(repoRoot, { recursive: true });

    const created = await runCli([
      "--db", databasePath,
      "init",
      "--repo-root", repoRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const directoryDb = await runCli([
      "--db", join(dir, "state"),
      "init",
      "--repo-root", repoRoot,
      "--json"
    ]);

    expect(created.exitCode).toBe(0);
    await expect(stat(databasePath)).resolves.toBeTruthy();
    expect(directoryDb.exitCode).toBe(1);
    expect(directoryDb.stderr).toContain("--db must be a file path, not a directory");
  });

  it("rejects init repo roots that are files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-init-file-root-"));
    tempDirs.push(dir);
    const fileRoot = join(dir, "not-a-repo.ts");
    await writeFile(fileRoot, "export const x = 1;\n");

    const result = await runCli([
      "init",
      "--repo-root", fileRoot,
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--repo-root must be a directory");
  });

  it("scans a repo, stores snapshots and facts, and infers the first convention candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "import { createUser } from \"@/services/users\";",
        "",
        "export async function POST() {",
        "  return Response.json(await createUser(prisma));",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.files_indexed).toBe(1);
    expect(payload.summary.engine_source).toBe("rust");
    expect(payload.summary.facts_count).toBeGreaterThan(0);
    expect(payload.candidates[0].kind).toBe("api_route_no_direct_data_access");
    expect(payload.candidates[0].scoring.heuristic_id).toBe("engine-direct-data-access-v1");
    expect(payload.candidates[0].evidence_refs).toEqual([
      expect.objectContaining({
        kind: "supporting",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        end_line: 1,
        symbol: "prisma",
        import_source: "@/lib/prisma",
        fact_ids: [expect.stringMatching(/^fact[:_]/)],
        scan_id: payload.scan.id,
        file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        redaction_state: "none"
      })
    ]);
    const delegationCandidate = payload.candidates.find(
      (candidate: { kind: string }) => candidate.kind === "api_route_requires_service_delegation"
    );
    expect(delegationCandidate.evidence_refs).toEqual([
      expect.objectContaining({
        kind: "supporting",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 2,
        symbol: "createUser",
        import_source: "@/services/users"
      })
    ]);
    expect(delegationCandidate.counterexample_refs).toEqual([
      expect.objectContaining({
        kind: "counterexample",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        symbol: "prisma",
        import_source: "@/lib/prisma"
      })
    ]);

    const storage = openDriftStorage({ databasePath: payload.database_path });
    storage.migrate();
    expect(storage.getRepo(payload.repo.id)?.root_path).toBe(repoRoot);
    expect(storage.getScanManifest(payload.scan.id)?.status).toBe("completed");
    expect(storage.listFacts(payload.scan.id, { kind: "import_used" })).toHaveLength(2);
    expect(storage.listConventionCandidates(payload.repo.id, { status: "candidate" })).toHaveLength(2);
    expect(storage.listAuditEvents(payload.repo.id).map((event) => event.action)).toEqual([
      "scan_started",
      "scan_completed"
    ]);
    storage.close();
  });

  it("does not re-propose a rejected candidate without new evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-rejected-candidate-rescan-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const firstPayload = JSON.parse(first.stdout);
    const directCandidate = firstPayload.candidates.find(
      (candidate: { kind: string }) => candidate.kind === "api_route_no_direct_data_access"
    );
    if (!directCandidate) {
      throw new Error("expected direct data access candidate");
    }

    const rejected = await runCli([
      "--db", firstPayload.database_path,
      "conventions", "reject",
      directCandidate.id,
      "--repo", firstPayload.repo.id,
      "--reason", "false inference",
      "--confirm",
      "--json"
    ]);
    expect(rejected.exitCode).toBe(0);

    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);
    const secondPayload = JSON.parse(second.stdout);

    expect(second.exitCode).toBe(0);
    expect(secondPayload.candidates.some(
      (candidate: { id: string }) => candidate.id === directCandidate.id
    )).toBe(false);
  });

  it("rejects scan repo roots that are files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-file-root-"));
    tempDirs.push(dir);
    const fileRoot = join(dir, "not-a-dir.ts");
    await writeFile(fileRoot, "export const x = 1;\n");

    const result = await runCli([
      "scan",
      "--repo-root", fileRoot,
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--repo-root must be a directory");
  });

  it("rejects blank scan actors before registering the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-blank-actor-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "import { prisma } from \"@/lib/prisma\";\n"
    );

    const result = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--actor", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--actor must not be empty");
    await expect(stat(stateRoot)).rejects.toThrow();
  });

  it("persists failed scan manifests and audit events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-failed-"));
    tempDirs.push(dir);
    const missingRepoRoot = join(dir, "missing-repo");
    const stateRoot = join(dir, "state");

    const result = await runCli([
      "scan",
      "--repo-root", missingRepoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const [repoId] = await readdir(stateRoot);
    const storage = openDriftStorage({ databasePath: join(stateRoot, repoId, "drift.sqlite") });
    storage.migrate();
    const scan = storage.listScanManifests(repoId)[0];
    expect(scan).toMatchObject({
      repo_id: repoId,
      status: "failed",
      file_count: 0,
      fact_count: 0,
      finding_count: 0
    });
    expect(scan?.error_message).toBeTruthy();
    expect(storage.listAuditEvents(repoId).map((event) => event.action)).toEqual([
      "scan_started",
      "scan_failed"
    ]);
    storage.close();
  });

  it("infers service delegation as a heuristic warning convention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-service-candidate-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { listUsers } from \"@/services/users\";",
        "",
        "export async function GET() {",
        "  return Response.json(await listUsers());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:11.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.candidates).toHaveLength(1);
    expect(payload.candidates[0]).toMatchObject({
      kind: "api_route_requires_service_delegation",
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      matcher: {
        allowed_delegate_imports: ["@/services/users"]
      }
    });
    expect(payload.candidates[0].evidence_refs).toEqual([
      expect.objectContaining({
        kind: "supporting",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        symbol: "listUsers",
        import_source: "@/services/users",
        fact_ids: [expect.stringMatching(/^fact[:_]/)]
      })
    ]);
    expect(payload.candidates[0].counterexample_refs).toEqual([]);
  });

  it("resolves path aliases when inferring direct data-access imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-alias-candidate-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "src/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/lib"), { recursive: true });
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"]
          }
        }
      })
    );
    await writeFile(
      join(repoRoot, "src/lib/client.ts"),
      [
        "import { PrismaClient } from \"@prisma/client\";",
        "export const client = new PrismaClient();",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "src/app/api/users/route.ts"),
      [
        "import { client } from \"@/lib/client\";",
        "",
        "export async function GET() {",
        "  return Response.json(await client.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:12.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const directDataAccess = payload.candidates.find(
      (candidate: { kind: string }) => candidate.kind === "api_route_no_direct_data_access"
    );
    expect(directDataAccess).toMatchObject({
      matcher: {
        forbidden_imports: ["@/lib/client"]
      },
      enforcement_capability: "deterministic_check"
    });
  });

  it("does not accept default onboarding conventions from repo fixture routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-fixture-routes-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "test/fixtures/next-api-direct-db/apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "test/fixtures/next-api-direct-db/apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:13.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.candidates).toEqual([]);
    expect(payload.accepted).toBeUndefined();
    expect(payload.onboarding).toMatchObject({
      status: "needs_more_signal",
      accepted_default: false,
      candidate_count: 0
    });

    const mapped = await runCli([
      "--db", payload.database_path,
      "repo", "map",
      "--repo", payload.repo.id,
      "--json"
    ]);
    const audit = await runCli([
      "--db", payload.database_path,
      "audit", "verify",
      "--repo", payload.repo.id,
      "--json"
    ]);
    const backup = await runCli([
      "--db", payload.database_path,
      "backup", "create",
      "--repo", payload.repo.id,
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:14.000Z",
      "--confirm",
      "--json"
    ]);

    expect(mapped.exitCode).toBe(0);
    expect(JSON.parse(mapped.stdout)).toMatchObject({
      policy: { allowed: true, surface: "cli-preflight" },
      summary: { indexed_file_count: 1 },
      files: [{ convention_ids: [], risky_area_ids: [] }]
    });
    expect(audit.exitCode).toBe(0);
    expect(JSON.parse(audit.stdout)).toMatchObject({
      policy: { allowed: true, surface: "log" },
      verification: { valid: true, event_count: 2 }
    });
    expect(backup.exitCode).toBe(0);
    expect(JSON.parse(backup.stdout)).toMatchObject({
      policy: { allowed: true, surface: "artifact" },
      manifest: { repo_id: payload.repo.id }
    });
  });

  it("reports scan status and marks the graph stale after file changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-status-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      routePath,
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const scanned = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const scanPayload = JSON.parse(scanned.stdout);

    const fresh = await runCli([
      "--db", scanPayload.database_path,
      "scan", "status",
      "--repo", scanPayload.repo.id,
      "--json"
    ]);
    expect(fresh.exitCode).toBe(0);
    const freshPayload = JSON.parse(fresh.stdout);
    expect(freshPayload.stale).toBe(false);
    expect(freshPayload.scan_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(freshPayload.indexed_file_count).toBe(1);
    expect(freshPayload.source_change_count).toBe(0);
    expect(freshPayload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(freshPayload.summary).toMatchObject({
      latest_scan_id: scanPayload.scan.id,
      scan_count: 1,
      indexed_file_count: 1,
      source_change_count: 0,
      stale: false,
      invalidation_count: 0,
      audit_valid: true
    });
    expect(freshPayload.audit_integrity).toMatchObject({
      valid: true,
      event_count: 2,
      broken_at_event_id: null,
      reasons: []
    });
    expect(freshPayload.audit_integrity.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(freshPayload.readiness).toMatchObject({
      schema_version: "drift.readiness.v1",
      repo_id: scanPayload.repo.id,
      scan_id: scanPayload.scan.id,
      surface: "scan_status",
      parser_gap_count: 0
    });
    expect(freshPayload.capability_report).toMatchObject({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: scanPayload.repo.id,
      scan_id: scanPayload.scan.id,
      engine_source: expect.stringMatching(/^(rust|typescript)$/),
      scanner_version: "0.1.0",
      certified_capabilities: expect.arrayContaining(["file_discovery", "syntax_facts"]),
      required_capabilities: expect.arrayContaining(["file_discovery", "syntax_facts"]),
      missing_capabilities: [],
      parser_gap_count: 0,
      parser_gap_kinds: {},
      fallback_used: false,
      enforcement_degraded: false
    });
    expect(freshPayload.next_command).toBe(`drift prepare "task" --repo ${scanPayload.repo.id} --json`);
    expect(freshPayload.next_commands).toEqual([
      `drift prepare "task" --repo ${scanPayload.repo.id} --json`,
      `drift repo map --repo ${scanPayload.repo.id} --json`,
      `drift audit verify --repo ${scanPayload.repo.id} --json`
    ]);

    await writeFile(
      routePath,
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json({ changed: await prisma.user.count() });",
        "}",
        ""
      ].join("\n")
    );

    const stale = await runCli([
      "--db", scanPayload.database_path,
      "scan", "status",
      "--repo", scanPayload.repo.id,
      "--json"
    ]);
    const payload = JSON.parse(stale.stdout);
    expect(stale.exitCode).toBe(0);
    expect(payload.latest_scan.id).toBe(scanPayload.scan.id);
    expect(payload.scan_fingerprint).toBe(freshPayload.scan_fingerprint);
    expect(payload.indexed_file_count).toBe(1);
    expect(payload.source_change_count).toBe(1);
    expect(payload.stale).toBe(true);
    expect(payload.changes.modified).toEqual(["apps/web/app/api/users/route.ts"]);
    expect(payload.next_command).toBe(`drift scan --repo-root ${repoRoot} --json`);
    expect(payload.summary).toMatchObject({
      latest_scan_id: scanPayload.scan.id,
      scan_count: 1,
      indexed_file_count: 1,
      source_change_count: 1,
      stale: true,
      invalidation_count: 0,
      audit_valid: true
    });
    expect(payload.next_commands).toEqual([
      `drift scan --repo-root ${repoRoot} --json`,
      `drift doctor --repo-root ${repoRoot} --json`
    ]);

    const staleText = await runCli([
      "--db", scanPayload.database_path,
      "scan", "status",
      "--repo", scanPayload.repo.id
    ]);
    expect(staleText.exitCode).toBe(0);
    expect(staleText.stdout).toContain("Audit: valid");
    expect(staleText.stdout).toContain("Next commands:");
    expect(staleText.stdout).toContain(`drift doctor --repo-root ${repoRoot} --json`);

    const repeated = await runCli([
      "--db", scanPayload.database_path,
      "scan", "status",
      "--repo", scanPayload.repo.id,
      "--json"
    ]);
    expect(repeated.exitCode).toBe(0);

    const storage = openDriftStorage({ databasePath: scanPayload.database_path });
    storage.migrate();
    const invalidations = storage.listAuditEvents(scanPayload.repo.id)
      .filter((event) => event.action === "scan_invalidated");
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]?.metadata).toMatchObject({
      latest_scan_id: scanPayload.scan.id,
      modified: ["apps/web/app/api/users/route.ts"]
    });
    storage.close();
  });

  it("reports parser gap summaries in scan status", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-parser-gap-status-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_") && !scan.id.startsWith("scan_check_"))!.id;
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_unresolved_users",
      repo_id: repoId,
      scan_id: scanId,
      kind: "unresolved_import",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:00:02.000Z"
    }]);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.parser_gaps).toMatchObject({
      total_count: 1,
      by_kind: { unresolved_import: 1 },
      confidence_impact: { lowers_flow: 1 }
    });
    expect(payload.readiness).toMatchObject({
      schema_version: "drift.readiness.v1",
      repo_id: repoId,
      scan_id: scanId,
      surface: "scan_status",
      parser_gap_count: 1,
      parser_gaps_by_kind: { unresolved_import: 1 },
      decision: "advisory_only",
      reasons: ["parser_gaps_present"]
    });
  });

  it("links repeated scans to the previous completed scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-lineage-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const firstPayload = JSON.parse(first.stdout);
    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.scan.previous_scan_id).toBe(firstPayload.scan.id);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "incremental_reuse",
      reuse_applied: true,
      reusable_file_count: 1,
      changed_file_count: 0,
      blocked_reasons: []
    });
  });

  it("reuses unchanged files while reparsing modified files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-incremental-partial-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/services"), { recursive: true });
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    const servicePath = join(repoRoot, "src/services/users.ts");
    await writeFile(routePath, "export async function GET() { return Response.json({ ok: true }); }\n");
    await writeFile(servicePath, "export function listUsers() { return []; }\n");

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(first.exitCode).toBe(0);
    const firstPayload = JSON.parse(first.stdout);

    await writeFile(routePath, "export async function GET() { return Response.json({ changed: true }); }\n");
    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "incremental_reuse",
      reuse_applied: true,
      reusable_file_count: 1,
      changed_file_count: 1,
      blocked_reasons: []
    });
  });

  it("blocks reuse when resolver input files change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-incremental-resolver-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } }
    }));
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(first.exitCode).toBe(0);
    const firstPayload = JSON.parse(first.stdout);

    await writeFile(join(repoRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["app/*"] } }
    }));
    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "full_scan",
      reuse_applied: false,
      reusable_file_count: 1,
      changed_file_count: 0,
      blocked_reasons: ["resolver_inputs_changed"]
    });
  });

  it("blocks reuse when the previous scan lacks resolver input fingerprint evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-incremental-resolver-missing-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } }
    }));
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(first.exitCode).toBe(0);
    const firstPayload = JSON.parse(first.stdout);
    removeResolverInputsFromScan(firstPayload.database_path, firstPayload.scan.id);

    await writeFile(join(repoRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["app/*"] } }
    }));
    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "full_scan",
      reuse_applied: false,
      reusable_file_count: 1,
      changed_file_count: 0,
      blocked_reasons: ["resolver_inputs_missing"]
    });
  });

  it("blocks reuse after a degraded TypeScript fallback scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-incremental-fallback-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const previousBin = process.env.DRIFT_ENGINE_BIN;
    const previousFallback = process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
    let firstPayload: any;
    try {
      process.env.DRIFT_ENGINE_BIN = join(repoRoot, "..", "missing-engine");
      process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = "1";
      const first = await runCli([
        "scan",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--now", "2026-05-10T00:00:10.000Z",
        "--json"
      ]);
      expect(first.exitCode).toBe(0);
      firstPayload = JSON.parse(first.stdout);
      expect(firstPayload.summary.engine_source).toBe("typescript");
    } finally {
      if (previousBin === undefined) {
        delete process.env.DRIFT_ENGINE_BIN;
      } else {
        process.env.DRIFT_ENGINE_BIN = previousBin;
      }
      if (previousFallback === undefined) {
        delete process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
      } else {
        process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = previousFallback;
      }
    }

    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "full_scan",
      reuse_applied: false,
      reusable_file_count: 1,
      changed_file_count: 0,
      blocked_reasons: ["previous_scan_degraded"]
    });
  });

  it("reuses surviving files and excludes deleted files from the new scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-incremental-delete-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/services"), { recursive: true });
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    const servicePath = join(repoRoot, "src/services/users.ts");
    await writeFile(routePath, "export async function GET() { return Response.json({ ok: true }); }\n");
    await writeFile(servicePath, "export function listUsers() { return []; }\n");

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(first.exitCode).toBe(0);
    const firstPayload = JSON.parse(first.stdout);

    await rm(servicePath);
    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_plan).toMatchObject({
      previous_scan_id: firstPayload.scan.id,
      execution_mode: "incremental_reuse",
      reuse_applied: true,
      reusable_file_count: 1,
      changed_file_count: 1,
      blocked_reasons: []
    });
    const storage = openDriftStorage({ databasePath: secondPayload.database_path });
    storage.migrate();
    expect(storage.listFileSnapshots(secondPayload.repo.id, secondPayload.scan.id).map((snapshot) => snapshot.file_path))
      .toEqual(["apps/web/app/api/users/route.ts"]);
    storage.close();
  });

  it("persists scan file changes across repeated scans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-file-changes-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/services"), { recursive: true });
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    const servicePath = join(repoRoot, "src/services/users.ts");
    await writeFile(routePath, "export async function GET() { return Response.json({ ok: true }); }\n");
    await writeFile(servicePath, "export function listUsers() { return []; }\n");

    const first = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(first.exitCode).toBe(0);
    const firstPayload = JSON.parse(first.stdout);
    expect(firstPayload.summary.incremental_changes).toMatchObject({
      added: 2,
      modified: 0,
      deleted: 0,
      unchanged: 0,
      total: 2
    });

    await writeFile(routePath, "export async function GET() { return Response.json({ changed: true }); }\n");
    await rm(servicePath);
    await writeFile(join(repoRoot, "src/services/admin.ts"), "export function listAdmins() { return []; }\n");

    const second = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const secondPayload = JSON.parse(second.stdout);
    expect(secondPayload.summary.incremental_changes).toMatchObject({
      added: 1,
      modified: 1,
      deleted: 1,
      unchanged: 0,
      total: 3
    });

    const status = await runCli([
      "--db", secondPayload.database_path,
      "scan", "status",
      "--repo", secondPayload.repo.id,
      "--json"
    ]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).latest_scan_change_summary).toMatchObject({
      added: 1,
      modified: 1,
      deleted: 1,
      unchanged: 0,
      total: 3
    });

    const storage = openDriftStorage({ databasePath: secondPayload.database_path });
    storage.migrate();
    expect(storage.listScanFileChanges(secondPayload.repo.id, secondPayload.scan.id)
      .map((change) => [change.file_path, change.change_kind])).toEqual([
      ["apps/web/app/api/users/route.ts", "modified"],
      ["src/services/admin.ts", "added"],
      ["src/services/users.ts", "deleted"]
    ]);
    storage.close();
  });

  it("reports scan invalidation when scanner, adapter, or rule versions change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-scan-invalid-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    const databasePath = join(dir, "drift.sqlite");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      routePath,
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );
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
      id: "scan_old",
      repo_id: "repo_abc",
      branch: "unknown",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.0.1",
      adapter_versions: { typescript: "0.0.1", resolver: "0.0.1" },
      rule_engine_version: "0.0.1",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_old",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "not-used-by-test",
      byte_size: 58,
      indexed: true
    });
    storage.close();

    const status = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout);
    expect(payload.stale).toBe(true);
    expect(payload.invalidation_reasons).toEqual([
      "scanner_version_changed",
      "adapter_version_changed:typescript",
      "resolver_version_changed",
      "rule_engine_version_changed"
    ]);
  });

  it("marks scan status stale when resolver input files change without source changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-resolver-inputs-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
    );
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);

    expect(scan.exitCode).toBe(0);
    const scanPayload = JSON.parse(scan.stdout);
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["app/*"] } } })
    );

    const status = await runCli([
      "--db", scanPayload.database_path,
      "scan", "status",
      "--repo", scanPayload.repo.id,
      "--json"
    ]);

    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout);
    expect(payload.source_change_count).toBe(0);
    expect(payload.stale).toBe(true);
    expect(payload.invalidation_reasons).toContain("resolver_inputs_changed");
  });

  it("marks scan status stale when the current branch differs from the scanned branch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-branch-stale-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const databasePath = join(dir, "drift.sqlite");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );
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
      id: "scan_branch",
      repo_id: "repo_abc",
      branch: "main",
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
      scan_id: "scan_branch",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "not-used-by-test",
      byte_size: 64,
      indexed: true
    });
    storage.close();

    const status = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      stale: true,
      current_branch: "unknown",
      invalidation_reasons: ["branch_changed"]
    });
  });

  it("marks scan status stale when the repo root is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-missing-root-status-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "missing-repo");
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
      id: "scan_missing_root",
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
      scan_id: "scan_missing_root",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "not-used-by-test",
      byte_size: 64,
      indexed: true
    });
    storage.close();

    const status = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      stale: true,
      invalidation_reasons: ["repo_root_missing"],
      changes: {
        added: [],
        modified: [],
        deleted: ["apps/web/app/api/users/route.ts"]
      }
    });
  });

  it("starts onboarding in one command with a clear next-step summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:20.000Z"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift is ready for this repo.");
    expect(result.stdout).toContain("drift conventions list");
    expect(result.stdout).toContain("drift check --diff main...HEAD");
  });

  it.skipIf(process.platform === "win32")("starts when an upstream repo contains a broken symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-broken-symlink-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "export async function GET() {",
        "  return Response.json({ ok: true });",
        "}",
        ""
      ].join("\n")
    );
    const eeDir = join(repoRoot, "apps/web/app/app.dub.co/(dashboard)/[slug]/(ee)");
    await mkdir(eeDir, { recursive: true });
    await symlink("../../../../(ee)/LICENSE.md", join(eeDir, "LICENSE.md"));

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:25.000Z",
      "--json"
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary).toMatchObject({
      files_indexed: 1,
      files_skipped: 1,
      diagnostics_count: 1,
      engine_source: "rust"
    });
    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    expect(storage.listParserGaps(payload.repo.id, payload.scan.id)).toMatchObject([
      {
        kind: "partial_parse",
        file_path: "apps/web/app/app.dub.co/(dashboard)/[slug]/(ee)/LICENSE.md",
        confidence_impact: "blocks_enforcement"
      }
    ]);
    storage.close();
  });

  it("starts onboarding with accept-defaults, materializes contract, and baselines existing violations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-defaults-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Accepted default convention.");
    expect(result.stdout).toContain("Baselined 1 existing violation.");
    expect(result.stdout).toContain("Ready for AI-assisted work.");
    expect(result.stdout).toContain("drift scan status");
    expect(result.stdout).toContain("drift backup create");

    const dbLine = result.stdout.split("\n").find((line) => line.trim().startsWith("export DRIFT_DB="));
    const databasePath = dbLine?.split("=", 2)[1];
    const repoId = result.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
    expect(databasePath).toBeTruthy();
    expect(repoId).toBeTruthy();
    const storage = openDriftStorage({ databasePath: databasePath! });
    storage.migrate();
    expect(storage.getRepoContract(repoId!)?.conventions).toHaveLength(1);
    expect(storage.listBaselineViolations(repoId!)[0]?.status).toBe("active");
    expect(storage.listFindings(repoId!)[0]?.evidence_refs[0]).toMatchObject({
      kind: "violation",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      symbol: "prisma",
      import_source: "@/lib/prisma",
      redaction_state: "none"
    });
    expect(storage.listFindings(repoId!)[0]?.evidence_refs[0]?.scan_id).toMatch(/^scan_/);
    expect(storage.listFindings(repoId!)[0]?.evidence_refs[0]?.file_hash).toHaveLength(64);
    storage.close();
  });

  it("materializes a default required check when onboarding accepts a deterministic convention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-required-check-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    expect(storage.getRepoContract(payload.repo.id)?.required_checks).toMatchObject([
      {
        command: `drift check --diff main...HEAD --repo ${payload.repo.id} --scope changed-hunks --json`,
        applies_to: {
          path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
          file_roles: ["api_route"]
        },
        reason: "Block newly introduced deterministic convention violations before code is merged."
      }
    ]);
    storage.close();
  });

  it("includes default required checks in prepare after onboarding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-prepare-required-check-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const startedPayload = JSON.parse(started.stdout);
    const prepared = await runCli([
      "--db", startedPayload.state.database_path,
      "prepare", "change the users API route",
      "--repo", startedPayload.repo.id,
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout).required_checks).toMatchObject([
      {
        command: `drift check --diff main...HEAD --repo ${startedPayload.repo.id} --scope changed-hunks --json`
      }
    ]);
  });

  it("materializes a pnpm test safe command during onboarding when a test script exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-pnpm-safe-command-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }, null, 2));
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    expect(storage.getRepoContract(payload.repo.id)?.safe_commands).toEqual([
      {
        command: "pnpm test",
        reason: "Run the repo test script after AI-assisted changes.",
        requires_explicit_run: true
      }
    ]);
    storage.close();
  });

  it("materializes an npm test safe command during onboarding when npm is detected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-npm-safe-command-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" }
    }, null, 2));
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    expect(storage.getRepoContract(payload.repo.id)?.safe_commands[0]?.command).toBe("npm test");
    storage.close();
  });

  it("surfaces default data-access risk areas in prepare after onboarding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-risk-prepare-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const startedPayload = JSON.parse(started.stdout);
    const prepared = await runCli([
      "--db", startedPayload.state.database_path,
      "prepare", "change the users API route",
      "--repo", startedPayload.repo.id,
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout).risky_areas).toMatchObject([
      {
        id: "risk_data_access_api_routes",
        risk_kind: "data_access",
        path_globs: ["**/app/api/**/route.ts", "**/app/api/**/route.tsx", "**/pages/api/**/*.ts"],
        reason: "API route changes can bypass the accepted data-access layering convention."
      }
    ]);
  });

  it("baselines multiline import violations during onboarding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-multiline-defaults-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import {",
        "  prisma",
        "} from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.onboarding.baselined_count).toBe(1);

    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    expect(storage.listFindings(payload.repo.id)[0]?.evidence_refs[0]).toMatchObject({
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 3,
      symbol: "prisma",
      import_source: "@/lib/prisma"
    });
    storage.close();
  });

  it("emits machine-readable onboarding state and next commands for start --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-start-json-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.onboarding).toMatchObject({
      status: "ready",
      accepted_default: true,
      baselined_count: 1
    });
    expect(payload.state).toMatchObject({
      repo_root: repoRoot
    });
    expect(payload.state.database_path).toContain("drift.sqlite");
    expect(payload.next_commands).toEqual([
      `drift doctor --repo-root ${repoRoot} --state-root ${stateRoot} --json`,
      `drift scan status --repo ${payload.repo.id}`,
      `drift contract show --repo ${payload.repo.id}`,
      `drift baseline status --repo ${payload.repo.id}`,
      `drift prepare "task" --repo ${payload.repo.id} --json`,
      `drift check --diff main...HEAD --repo ${payload.repo.id} --scope changed-hunks`,
      `drift backup create --repo ${payload.repo.id} --confirm`
    ]);
  });

  it("prints baseline status in a readable summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-baseline-readable-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const payload = JSON.parse(started.stdout);

    const result = await runCli([
      "--db", payload.state.database_path,
      "baseline", "status",
      "--repo", payload.repo.id
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift baseline");
    expect(result.stdout).toContain("Active: 1");
    expect(result.stdout).toContain("Resolved: 0");
    expect(result.stdout).toContain("convention_");
  });

  it("runs doctor before local state exists and prints a clean next command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), "{\"name\":\"fixture\"}\n");
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift doctor");
    expect(result.stdout).toContain("Runtime: Drift CLI 0.1.0, SQLite schema 25");
    expect(result.stdout).toContain("V1 scope: local-first CLI, TypeScript API route layering");
    expect(result.stdout).toContain("TS/JS files: 1 indexable file");
    expect(result.stdout).toContain("API routes: 1 API route file");
    expect(result.stdout).toContain(`drift start --repo-root ${repoRoot} --state-root ${stateRoot} --accept-defaults`);
    await expect(stat(stateRoot)).rejects.toThrow();
  });

  it("preserves custom state roots in doctor next commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-state-root-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "custom-state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).next_command).toBe(
      `drift start --repo-root ${repoRoot} --state-root ${stateRoot} --accept-defaults`
    );
  });

  it("reports existing Drift state during doctor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-existing-state-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    expect(started.exitCode).toBe(0);

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift state: registered repo, 1 scan, contract ready");

    const json = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(json.stdout);
    expect(payload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
      scanner_version: "0.1.0",
      typescript_adapter_version: "0.1.0",
      rule_engine_version: "0.1.0",
      contract_schema_version: 1,
      supported_sqlite_schema_version: 25,
      storage_driver: "sqlite"
    });
    expect(payload.engine).toMatchObject({
      status: "available",
      source: "workspace_cargo",
      override_active: false,
      checksum_matches: null
    });
    expect(payload.v1_scope).toMatchObject({
      product_mode: "local_first_cli",
      primary_wedge: "typescript_api_route_layering",
      mutation_model: "human_confirmed_governance_only",
      source_mutation: false,
      language_adapters: ["typescript"],
      deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"]
    });
    expect(payload.state_summary).toMatchObject({
      supported_schema_version: 25
    });
    expect(payload.state_summary).toMatchObject({
      exists: true,
      repo_registered: true,
      scan_count: 1,
      contract_ready: true,
      audit_integrity: {
        valid: true,
        broken_at_event_id: null,
        reasons: []
      },
      backup_count: 0,
      backup_problem_count: 0
    });
    expect(payload.state_summary.audit_integrity.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.next_commands).toContain(`drift prepare "task" --repo ${payload.state_summary.repo_id} --json`);
    expect(payload.next_commands).toContain(`drift audit verify --repo ${payload.state_summary.repo_id} --json`);
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "audit_integrity",
      status: "ok"
    }));
  });

  it("warns during doctor when the stored scan is stale", async () => {
    const { repoRoot, stateRoot } = await seedStartedDoctorState("drift-doctor-stale-");
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json({ changed: true });",
        "}",
        ""
      ].join("\n")
    );

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe("warn");
    expect(payload.state_summary).toMatchObject({
      scan_stale: true,
      source_change_count: 1
    });
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "scan_freshness",
      status: "warn"
    }));
    expect(payload.next_command).toBe(`drift scan --repo-root ${repoRoot} --state-root ${stateRoot} --json`);
  });

  it("fails doctor when the stored contract schema is newer than the CLI supports", async () => {
    const { databasePath, repoId, repoRoot, stateRoot } = await seedStartedDoctorState("drift-doctor-contract-schema-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const existing = storage.getRepoContract(repoId)!;
    storage.upsertRepoContract({
      ...existing,
      contract_schema_version: 999,
      updated_at: "2026-05-10T00:10:00.000Z"
    });
    storage.close();

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe("fail");
    expect(payload.state_summary).toMatchObject({
      contract_ready: true,
      contract_compatible: false,
      contract_schema_version: 999,
      supported_contract_schema_version: 1
    });
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "contract",
      status: "fail"
    }));
    expect(payload.next_commands).toEqual([]);
  });

  it("reports backup artifact health during doctor", async () => {
    const { databasePath, repoId, repoRoot, stateRoot } = await seedStartedDoctorState("drift-doctor-backup-");
    const backupDir = join(repoRoot, "..", "backups");
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", repoId,
      "--output", backupDir,
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    const healthy = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot
    ]);

    expect(healthy.exitCode).toBe(0);
    expect(healthy.stdout).toContain("Backups: 1 tracked, 0 problems");

    await writeFile(backupPath, "not the original backup\n");
    const drifted = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(drifted.stdout);

    expect(drifted.exitCode).toBe(0);
    expect(payload.status).toBe("warn");
    expect(payload.state_summary).toMatchObject({
      backup_count: 1,
      backup_problem_count: 1
    });
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "backup_artifacts",
      status: "warn"
    }));
  });

  it("fails doctor when audit integrity is broken", async () => {
    const { databasePath, repoRoot, stateRoot } = await seedStartedDoctorState("drift-doctor-audit-");
    tamperFirstAuditEvent(databasePath);

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe("fail");
    expect(payload.state_summary.audit_integrity).toMatchObject({
      valid: false,
      broken_at_event_id: expect.stringMatching(/^audit_event_/),
      reasons: ["event_hash_mismatch"]
    });
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "audit_integrity",
      status: "fail"
    }));
    expect(payload.next_command).toBeNull();
  });

  it("fails doctor for non-prefix migration histories", async () => {
    const { databasePath, repoRoot, stateRoot } = await seedStartedDoctorState("drift-doctor-migrations-");
    replaceBackupMigrationWithUnknown(databasePath);

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.status).toBe("fail");
    expect(payload.state_summary).toMatchObject({
      compatible: false,
      unsupported_migrations: ["004_unknown_future_schema"]
    });
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "drift_state",
      status: "fail"
    }));
  });

  it("reports package manager and workspace signals during doctor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-package-manager-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), "{\"name\":\"fixture\"}\n");
    await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Package manager: pnpm");
    expect(result.stdout).toContain("Workspace: pnpm-workspace.yaml");

    const json = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(json.stdout);
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "package_manager",
      status: "ok",
      detail: "pnpm"
    }));
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "workspace",
      status: "ok",
      detail: "pnpm-workspace.yaml"
    }));
  });

  it("honors gitignore wildcard and output-directory patterns during doctor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-gitignore-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "output/dogfood"), { recursive: true });
    await writeFile(join(repoRoot, ".gitignore"), "main-*.js\noutput/\n");
    await writeFile(
      join(repoRoot, "app/api/users/route.ts"),
      "export async function GET() { return Response.json({ ok: true }); }\n"
    );
    await writeFile(join(repoRoot, "main-DlFGMsC6.js"), "export const bundled = true;\n");
    await writeFile(join(repoRoot, "output/dogfood/state.js"), "export const state = true;\n");

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "typescript_files",
      detail: "1 indexable file"
    }));
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "api_routes",
      detail: "1 API route file"
    }));
  });

  it("emits doctor results as JSON for setup automation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-json-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(repoRoot, { recursive: true });

    const result = await runCli([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.status).toBe("warn");
    expect(payload.database_path).toContain("drift.sqlite");
    expect(payload.checks.map((check: { id: string }) => check.id)).toContain("local_state");
    expect(payload.next_command).toBe(`drift start --repo-root ${repoRoot} --state-root ${stateRoot} --accept-defaults`);
  });

  it("reports file repo roots as doctor failures instead of crashing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-doctor-file-root-"));
    tempDirs.push(dir);
    const fileRoot = join(dir, "not-a-repo.ts");
    await writeFile(fileRoot, "export const x = 1;\n");

    const result = await runCli([
      "doctor",
      "--repo-root", fileRoot,
      "--state-root", join(dir, "state"),
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.status).toBe("fail");
    expect(payload.checks.find((check: { id: string }) => check.id === "repo_root")).toMatchObject({
      status: "fail",
      detail: `${fileRoot} is not a directory`
    });
    expect(payload.next_command).toBeNull();
  });

  it("prints clean help without requiring a database", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift doctor --repo-root .");
    expect(result.stdout).toContain("drift check --repo <repo_id>");
    expect(result.stdout).toContain("drift conventions list");
  });

  it("prints clean version without requiring a database", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("prints machine-readable version metadata without requiring a database", async () => {
    const result = await runCli(["version", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(payload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
      scanner_version: "0.1.0",
      typescript_adapter_version: "0.1.0",
      rule_engine_version: "0.1.0",
      contract_schema_version: 1,
      supported_sqlite_schema_version: 25,
      storage_driver: "sqlite"
    });
    expect(payload.engine).toMatchObject({
      status: "available",
      source: "workspace_cargo",
      override_active: false,
      checksum_matches: null
    });
    expect(payload.v1_scope).toMatchObject({
      product_mode: "local_first_cli",
      primary_wedge: "typescript_api_route_layering",
      source_mutation: false,
      deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"]
    });
  });

  it("prints focused command group help without requiring a database", async () => {
    const check = await runCli(["check", "--help"]);
    const conventions = await runCli(["conventions", "--help"]);
    const contract = await runCli(["contract", "--help"]);
    const policy = await runCli(["policy", "--help"]);
    const restore = await runCli(["restore", "--help"]);

    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain("Run deterministic checks");
    expect(check.stdout).toContain("--scope changed-hunks");
    expect(conventions.exitCode).toBe(0);
    expect(conventions.stdout).toContain("Review inferred conventions");
    expect(conventions.stdout).toContain("conventions exception add");
    expect(contract.exitCode).toBe(0);
    expect(contract.stdout).toContain("contract import <path> --confirm");
    expect(contract.stdout).not.toContain("dry-run only");
    expect(policy.exitCode).toBe(0);
    expect(policy.stdout).toContain("policy set-egress --repo <repo_id>");
    expect(policy.stdout).toContain("policy agent grant --repo <repo_id>");
    expect(policy.stdout).toContain("policy agent revoke --repo <repo_id>");
    expect(policy.stdout).toContain("--confirm --json");
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout).toContain("restore <backup.sqlite> --repo <repo_id> --confirm");
    expect(restore.stdout).toContain("restore <backup.sqlite> --repo <repo_id> --dry-run");
  });

  it("prints convention candidates in a readable review queue", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--status", "candidate"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift convention candidates");
    expect(result.stdout).toContain("candidate_no_direct_db");
    expect(result.stdout).toContain("api_route_no_direct_data_access");
    expect(result.stdout).toContain("deterministic_check");
    expect(result.stdout).toContain("drift conventions accept candidate_no_direct_db");
  });

  it("prints convention candidate details in a readable view", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "show",
      "candidate_no_direct_db"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift convention candidate");
    expect(result.stdout).toContain("candidate_no_direct_db");
    expect(result.stdout).toContain("api_route_no_direct_data_access");
    expect(result.stdout).toContain("Forbidden imports: @/lib/prisma");
    expect(result.stdout).toContain("Scope: apps/web/app/api/**/route.ts");
  });

  it("shows convention candidate evidence locations in JSON and text review output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-candidate-evidence-review-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:12.000Z",
      "--json"
    ]);
    const scanPayload = JSON.parse(scan.stdout);
    const candidate = scanPayload.candidates.find(
      (entry: { kind: string }) => entry.kind === "api_route_no_direct_data_access"
    );

    const json = await runCli([
      "--db", scanPayload.database_path,
      "conventions", "show",
      candidate.id,
      "--repo", scanPayload.repo.id,
      "--json"
    ]);
    const text = await runCli([
      "--db", scanPayload.database_path,
      "conventions", "show",
      candidate.id,
      "--repo", scanPayload.repo.id
    ]);

    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout).review_item).toMatchObject({
      evidence_ref_count: 1,
      counterexample_ref_count: 0,
      first_evidence: {
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        import_source: "@/lib/prisma"
      }
    });
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("apps/web/app/api/users/route.ts:1");
    expect(text.stdout).toContain("@/lib/prisma");
  });

  it("lists accepted conventions as the CLI equivalent of MCP get_conventions", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "accepted",
      "--repo", "repo_abc",
      "--kind", "api_route_no_direct_data_access",
      "--capability", "deterministic_check",
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo_id: "repo_abc",
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      filters: {
        kind: "api_route_no_direct_data_access",
        capability: "deterministic_check"
      },
      summary: {
        total_count: 1,
        filtered_count: 1,
        listed_count: 1,
        deterministic_count: 1,
        blocking_count: 1
      },
      pagination: {
        limit: 1,
        offset: 0,
        returned_count: 1,
        has_more: false,
        next_offset: null
      }
    });
    expect(payload.conventions).toEqual([
      expect.objectContaining({
        id: "convention_no_direct_db",
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check"
      })
    ]);
  });

  it("checks accepted deterministic conventions against changed hunks and stores findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.policy).toMatchObject({
      allowed: true,
      surface: "cli-check"
    });
    expect(payload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(payload.audit_integrity).toMatchObject({
      valid: true
    });
    expect(payload.check).toMatchObject({
      id: expect.stringMatching(/^check_/),
      repo_id: "repo_abc",
      repo_contract_id: "contract_abc",
      contract_fingerprint: expect.any(String),
      scope: "changed-hunks",
      status: "fail",
      scan_status: {
        mode: "check_time_collection",
        stored_scan_required: false,
        stale: false,
        scan_id: expect.stringMatching(/^scan_check_/)
      },
      fallback_status: {
        engine_source: "rust",
        fallback_used: false,
        enforcement_degraded: false
      },
      capability_completeness: {
        complete: true
      },
      machine_contract_versions: {
        schema_version: "drift.machine_contract_versions.v1",
        cli_version: "0.1.0",
        storage_schema_version: 25,
        factgraph_schema_version: "factgraph.v2"
      }
    });
    expect(payload.machine_contract_versions).toMatchObject({
      schema_version: "drift.machine_contract_versions.v1",
      engine_contract_versions: {
        check_result: "engine.check.result.v1"
      },
      scanner_version: "0.1.0",
      rule_engine_version: "0.1.0"
    });
    expect(payload.readiness).toMatchObject({
      schema_version: "drift.readiness.v1",
      repo_id: "repo_abc",
      scan_id: expect.stringMatching(/^scan_check_/),
      surface: "check",
      decision: "blocking_allowed"
    });
    expect(payload.summary.engine_source).toBe("rust");
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.summary.affected_scope).toMatchObject({
      mode: "changed-hunks",
      changed_file_count: 1,
      changed_line_count: 5,
      deleted_file_count: 0
    });
    expect(payload.summary.outcome).toMatchObject({
      status_counts: { new: 1 },
      diff_status_counts: { new_in_diff: 1 },
      enforcement_counts: { block: 1 },
      blocking_reasons: [
        {
          reason: "new_blocking_violation_in_changed_hunk",
          count: 1
        }
      ],
      non_blocking_reasons: []
    });
    expect(payload.review_items).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^finding_/),
        status: "new",
        enforcement_result: "block",
        evidence_ref_count: 1,
        first_evidence: {
          file_path: "apps/web/app/api/users/route.ts",
          start_line: 1,
          import_source: "@/lib/prisma",
          symbol: "prisma"
        }
      })
    ]);
    expect(payload.next_commands).toContain("drift findings list --repo repo_abc --status new --json");
    expect(payload.next_commands).toContain("drift baseline create --repo repo_abc --from main --confirm --json");
    expect(payload.findings[0].diff_status).toBe("new_in_diff");
    expect(payload.findings[0].status).toBe("new");
    expect(payload.findings[0]).toMatchObject({
      check_id: payload.check.id,
      repo_contract_id: "contract_abc",
      created_by_engine_version: "0.1.0",
      created_by_rule_engine_version: "0.1.0",
      contract_schema_version: 1,
      expected_layer: "service",
      actual_layer: "data_access",
      suggested_fix: "Move data access behind a service layer before returning from the route.",
      related_node_ids: expect.any(Array)
    });
    expect(payload.findings[0].graph_path.length).toBeGreaterThan(0);
    expect(payload.findings[0].evidence_refs[0]).toMatchObject({
      kind: "violation",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      symbol: "prisma",
      import_source: "@/lib/prisma",
      scan_id: expect.stringMatching(/^scan_check_/),
      redaction_state: "none"
    });
    expect(payload.findings[0].evidence_refs[0].file_hash).toHaveLength(64);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listCheckRuns("repo_abc")[0]).toMatchObject({
      id: payload.check.id,
      repo_contract_id: "contract_abc",
      status: "fail",
      blocking_count: 1,
      machine_contract_versions: expect.objectContaining({
        schema_version: "drift.machine_contract_versions.v1",
        storage_schema_version: 25
      })
    });
    expect(storage.listFindings("repo_abc")[0]?.title).toBe("API route imports data access directly");
    expect(storage.listFindings("repo_abc")[0]).toMatchObject({
      check_id: payload.check.id,
      repo_contract_id: "contract_abc",
      created_by_engine_version: "0.1.0",
      created_by_rule_engine_version: "0.1.0",
      contract_schema_version: 1,
      expected_layer: "service",
      actual_layer: "data_access"
    });
    expect(storage.listFindings("repo_abc")[0]?.evidence_refs[0]?.file_path).toBe(
      "apps/web/app/api/users/route.ts"
    );
    storage.close();
  });

  it("blocks new helper exports that duplicate an accepted canonical helper", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/server/auth"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/server/auth/current-user.ts"),
      [
        "export function getCurrentUser() {",
        "  return null;",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "helper.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/server/auth/current-user.ts b/apps/web/server/auth/current-user.ts",
      "--- /dev/null",
      "+++ b/apps/web/server/auth/current-user.ts",
      "@@ -0,0 +1,3 @@",
      "+export function getCurrentUser() {",
      "+  return null;",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      agent_contracts: [{
        kind: "canonical_helper_reuse",
        id: "agent_contract_auth_helper",
        version: 1,
        canonical_helpers: [{
          helper_id: "helper_require_user",
          symbol: "requireUser",
          module: "@/server/auth/require-user",
          applies_to_roles: ["api_route"],
          purpose_tags: ["auth"],
          avoid_new_symbols_matching: ["getCurrentUser"],
          suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
        }],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary).toMatchObject({
      findings_count: 1,
      blocking_count: 1,
      outcome: {
        diff_status_counts: { new_in_diff: 1 },
        enforcement_counts: { block: 1 }
      }
    });
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_auth_helper",
      repo_contract_id: "contract_abc",
      title: "Duplicate canonical helper introduced",
      status: "new",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "canonical_helper",
      actual_layer: "duplicate_helper",
      suggested_fix: "Import requireUser from @/server/auth/require-user instead of creating getCurrentUser."
    });
    expect(payload.findings[0].graph_path).toEqual([
      "apps/web/server/auth/current-user.ts",
      "@/server/auth/require-user"
    ]);
    expect(payload.findings[0].evidence_refs[0]).toMatchObject({
      kind: "violation",
      file_path: "apps/web/server/auth/current-user.ts",
      start_line: 1,
      end_line: 3,
      symbol: "getCurrentUser",
      fact_ids: [expect.stringMatching(/^fact_/)],
      scan_id: expect.stringMatching(/^scan_check_/),
      redaction_state: "none"
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]).toMatchObject({
      convention_id: "agent_contract_auth_helper",
      title: "Duplicate canonical helper introduced",
      expected_layer: "canonical_helper",
      actual_layer: "duplicate_helper"
    });
    checked.close();
  });

  it("warns when a renamed helper is highly similar to an accepted canonical helper", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/server/auth"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/server/auth/require-user.ts"),
      [
        "import { getSession } from \"@/server/auth/session\";",
        "export async function requireUser(request: Request) {",
        "  const session = await getSession(request);",
        "  return session.user;",
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "apps/web/server/auth/current-user.ts"),
      [
        "import { getSession } from \"@/server/auth/session\";",
        "export async function getCurrentUser(request: Request) {",
        "  const session = await getSession(request);",
        "  return session.user;",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "fuzzy-helper.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/server/auth/current-user.ts b/apps/web/server/auth/current-user.ts",
      "--- /dev/null",
      "+++ b/apps/web/server/auth/current-user.ts",
      "@@ -0,0 +1,5 @@",
      "+import { getSession } from \"@/server/auth/session\";",
      "+export async function getCurrentUser(request: Request) {",
      "+  const session = await getSession(request);",
      "+  return session.user;",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      agent_contracts: [{
        kind: "canonical_helper_reuse",
        id: "agent_contract_auth_helper",
        version: 1,
        canonical_helpers: [{
          helper_id: "helper_require_user",
          symbol: "requireUser",
          module: "@/server/auth/require-user",
          applies_to_roles: ["api_route"],
          purpose_tags: ["auth", "user"],
          suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
        }],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary).toMatchObject({
      findings_count: 1,
      blocking_count: 0
    });
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_auth_helper",
      title: "Possible duplicate canonical helper introduced",
      enforcement_result: "warn",
      expected_layer: "canonical_helper",
      actual_layer: "possible_duplicate_helper",
      suggested_fix: "Import requireUser from @/server/auth/require-user instead of creating getCurrentUser."
    });
  });

  it("blocks changed modules placed outside their accepted role paths", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/user.service.ts"),
      [
        "export function listUsers() {",
        "  return [];",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "module-placement.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/users/user.service.ts b/apps/web/app/api/users/user.service.ts",
      "--- /dev/null",
      "+++ b/apps/web/app/api/users/user.service.ts",
      "@@ -0,0 +1,3 @@",
      "+export function listUsers() {",
      "+  return [];",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [],
      agent_contracts: [{
        kind: "module_placement",
        id: "agent_contract_service_placement",
        version: 1,
        statement: "Service modules live outside API route folders.",
        target_role: "service_module",
        allowed_paths: ["apps/web/server/services/**"],
        forbidden_paths: ["apps/web/app/api/**"],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_service_placement",
      title: "Module placement contract violated",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "service_module",
      actual_layer: "misplaced_module",
      suggested_fix: "Move apps/web/app/api/users/user.service.ts under apps/web/server/services/**."
    });
    expect(payload.findings[0].evidence_refs[0]).toMatchObject({
      file_path: "apps/web/app/api/users/user.service.ts",
      start_line: 1,
      symbol: "service_module",
      fact_ids: [expect.stringMatching(/^fact_/)]
    });
  });

  it("blocks imports that violate an accepted agent import boundary", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/reports"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/reports/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "",
        "export async function GET() {",
        "  return Response.json(await prisma.report.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "import-boundary.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/reports/route.ts b/apps/web/app/api/reports/route.ts",
      "--- /dev/null",
      "+++ b/apps/web/app/api/reports/route.ts",
      "@@ -0,0 +1,5 @@",
      "+import { prisma } from \"@/lib/prisma\";",
      "+",
      "+export async function GET() {",
      "+  return Response.json(await prisma.report.findMany());",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [],
      agent_contracts: [{
        kind: "import_boundary",
        id: "agent_contract_api_import_boundary",
        version: 1,
        source_roles: ["api_route"],
        forbidden_imports: ["@/lib/prisma"],
        allowed_delegate_imports: ["@/server/services/**"],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_api_import_boundary",
      title: "Import boundary contract violated",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "allowed_import_boundary",
      actual_layer: "forbidden_import",
      suggested_fix: "Import through an accepted delegate instead of importing @/lib/prisma directly."
    });
    expect(payload.findings[0].evidence_refs[0]).toMatchObject({
      file_path: "apps/web/app/api/reports/route.ts",
      start_line: 1,
      symbol: "prisma",
      import_source: "@/lib/prisma",
      fact_ids: [expect.stringMatching(/^fact_/)]
    });
  });

  it("blocks file-role contracts when a changed file imports a forbidden dependency", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/files"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/files/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "",
        "export async function GET() {",
        "  return Response.json(await prisma.file.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "file-role.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/files/route.ts b/apps/web/app/api/files/route.ts",
      "--- /dev/null",
      "+++ b/apps/web/app/api/files/route.ts",
      "@@ -0,0 +1,5 @@",
      "+import { prisma } from \"@/lib/prisma\";",
      "+",
      "+export async function GET() {",
      "+  return Response.json(await prisma.file.findMany());",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [],
      agent_contracts: [{
        kind: "file_role",
        id: "agent_contract_api_route_role",
        version: 1,
        roles: [{
          role: "api_route",
          path_globs: ["apps/web/app/api/**/route.ts"],
          forbidden_imports: ["@/lib/prisma"],
          confidence: "deterministic"
        }]
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_api_route_role",
      title: "File role contract violated",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "api_route",
      actual_layer: "forbidden_import",
      suggested_fix: "Remove forbidden import @/lib/prisma from api_route files."
    });
  });

  it("blocks entrypoint flow contracts when a required auth helper call is missing", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/server/services"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/server/services/users.ts"),
      [
        "export async function listUsers() {",
        "  return [];",
        "}",
        ""
      ].join("\n")
    );
    await mkdir(join(repoRoot, "apps/web/app/api/session"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/session/route.ts"),
      [
        "import { listUsers } from \"@/server/services/users\";",
        "",
        "export async function GET() {",
        "  return Response.json(await listUsers());",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "entrypoint-flow.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/session/route.ts b/apps/web/app/api/session/route.ts",
      "--- /dev/null",
      "+++ b/apps/web/app/api/session/route.ts",
      "@@ -0,0 +1,5 @@",
      "+import { listUsers } from \"@/server/services/users\";",
      "+",
      "+export async function GET() {",
      "+  return Response.json(await listUsers());",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [],
      agent_contracts: [{
        kind: "entrypoint_flow",
        id: "agent_contract_api_auth_flow",
        version: 1,
        entry_roles: ["api_route"],
        required_steps: [{
          kind: "auth_helper",
          calls: ["requireUser"]
        }],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0]).toMatchObject({
      convention_id: "agent_contract_api_auth_flow",
      title: "Entrypoint flow contract violated",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "auth_helper",
      actual_layer: "missing_required_call",
      suggested_fix: "Call requireUser before completing this entrypoint."
    });
    expect(payload.findings[0].evidence_refs[0]).toMatchObject({
      file_path: "apps/web/app/api/session/route.ts",
      start_line: 1,
      symbol: "requireUser"
    });
  });

  it("blocks entrypoint flow contracts when a forbidden direct data access step is proven", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/audit"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/audit/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "",
        "export async function GET() {",
        "  return Response.json(await prisma.audit.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const diffFile = join(repoRoot, "..", "entrypoint-flow-direct-data.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/audit/route.ts b/apps/web/app/api/audit/route.ts",
      "--- /dev/null",
      "+++ b/apps/web/app/api/audit/route.ts",
      "@@ -0,0 +1,5 @@",
      "+import { prisma } from \"@/lib/prisma\";",
      "+",
      "+export async function GET() {",
      "+  return Response.json(await prisma.audit.findMany());",
      "+}",
      ""
    ].join("\n"));

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [],
      agent_contracts: [{
        kind: "entrypoint_flow",
        id: "agent_contract_api_flow",
        version: 1,
        entry_roles: ["api_route"],
        required_steps: [{ kind: "service_delegation", imports: ["@/server/services/audit"] }],
        forbidden_steps: [{ kind: "direct_data_access" }],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    const directDataFinding = payload.findings.find((finding: { actual_layer?: string }) =>
      finding.actual_layer === "direct_data_access"
    );
    expect(directDataFinding).toMatchObject({
      convention_id: "agent_contract_api_flow",
      title: "Entrypoint flow contract violated",
      expected_layer: "service_delegation",
      actual_layer: "direct_data_access",
      suggested_fix: "Delegate data access and business logic through an accepted service layer."
    });
    expect(directDataFinding.graph_path).toContain("@/lib/prisma");
  });

  it("blocks check enforcement when the explicit TypeScript fallback scanner is used", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const previousBin = process.env.DRIFT_ENGINE_BIN;
    const previousFallback = process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
    try {
      process.env.DRIFT_ENGINE_BIN = join(repoRoot, "..", "missing-engine");
      process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = "1";

      const result = await runCli([
        "--db", databasePath,
        "check",
        "--repo", "repo_abc",
        "--diff-file", diffFile,
        "--scope", "changed-hunks",
        "--now", "2026-05-10T00:00:30.000Z",
        "--json"
      ]);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.check).toMatchObject({
        status: "blocked",
        fallback_status: {
          fallback_used: true,
          fallback_reason: "rust_engine_failed",
          enforcement_degraded: true,
          degraded_capabilities: ["graph", "graph_evidence", "deterministic_enforcement"]
        },
        capability_completeness: {
          complete: false,
          can_block: false
        }
      });
      expect(payload.summary).toMatchObject({
        engine_source: "typescript",
        findings_count: 0,
        blocking_count: 0,
        blocked_reasons: ["typescript_fallback_used"]
      });
      expect(payload.diagnostics).toContainEqual(expect.objectContaining({
        code: "typescript_fallback_used",
        severity: "warning"
      }));
      expect(payload.findings).toEqual([]);

      const storage = openDriftStorage({ databasePath });
      storage.migrate();
      expect(storage.listCheckRuns("repo_abc")[0]).toMatchObject({
        status: "blocked",
        fallback_used: true,
        capability_complete: false
      });
      storage.close();
    } finally {
      if (previousBin === undefined) {
        delete process.env.DRIFT_ENGINE_BIN;
      } else {
        process.env.DRIFT_ENGINE_BIN = previousBin;
      }
      if (previousFallback === undefined) {
        delete process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK;
      } else {
        process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK = previousFallback;
      }
    }
  });

  it("expires existing findings when their accepted convention has expired", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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
    storage.upsertFinding({
      id: "finding_existing",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-existing-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:12.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 0,
      expired_findings_count: 1
    });

    const listed = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--status", "expired",
      "--json"
    ]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).findings).toEqual([
      expect.objectContaining({
        id: "finding_existing",
        status: "expired"
      })
    ]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]?.status).toBe("expired");
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "finding_resolved",
      target_id: "finding_existing",
      metadata: {
        status: "expired",
        reason: "convention_expired",
        convention_id: "convention_no_direct_db"
      }
    });
    checked.close();
  });

  it("prints contract show in a readable summary", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "show",
      "--repo", "repo_abc"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift contract");
    expect(result.stdout).toContain("Repo: repo_abc");
    expect(result.stdout).toContain("Conventions: 1");
    expect(result.stdout).toContain("api_route_no_direct_data_access");
    expect(result.stdout).toContain("Mode: local_only");
  });

  it("prints check findings in a readable review summary", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Drift check");
    expect(result.stdout).toContain("Scope: changed-hunks");
    expect(result.stdout).toContain("Findings: 1");
    expect(result.stdout).toContain("Blocking: 1");
    expect(result.stdout).toContain("API route imports data access directly");
    expect(result.stdout).toContain("apps/web/app/api/users/route.ts:1");
  });

  it("does not fail check for active baseline findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const first = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const finding = JSON.parse(first.stdout).findings[0];
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertScanManifest({
      id: "scan_baseline",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 1,
      started_at: "2026-05-10T00:00:30.000Z",
      completed_at: "2026-05-10T00:00:31.000Z"
    });
    storage.upsertBaselineViolation({
      id: "baseline_existing",
      repo_id: "repo_abc",
      convention_id: finding.convention_id,
      finding_fingerprint: finding.fingerprint,
      file_path: "apps/web/app/api/users/route.ts",
      first_seen_scan_id: "scan_baseline",
      first_seen_commit: "abc123",
      status: "active",
      created_at: "2026-05-10T00:00:31.000Z"
    });
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:40.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    const payload = JSON.parse(second.stdout);
    expect(payload.findings[0].status).toBe("pre_existing");
    expect(payload.summary.outcome).toMatchObject({
      status_counts: { pre_existing: 1 },
      non_blocking_reasons: [
        {
          reason: "pre_existing_baseline",
          count: 1
        }
      ]
    });
  });

  it("prints finding lists in a readable review queue", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift findings");
    expect(result.stdout).toContain("Total: 1");
    expect(result.stdout).toContain("new: 1");
    expect(result.stdout).toContain("API route imports data access directly");
    expect(result.stdout).toContain("apps/web/app/api/users/route.ts:1");
  });

  it("checks the full repo scope without requiring a git diff", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary).toMatchObject({
      scope: "full",
      findings_count: 1,
      blocking_count: 0,
      outcome: {
        diff_status_counts: {
          touched_existing: 1
        },
        non_blocking_reasons: expect.arrayContaining([
          {
            reason: "touched_existing_not_new_hunk",
            count: 1
          }
        ])
      }
    });
    expect(payload.findings[0]).toMatchObject({
      status: "new",
      diff_status: "touched_existing"
    });
  });

  it("honors import and symbol convention exceptions during checks", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/projects"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/projects/route.ts"),
      [
        "import { db } from \"@/lib/db\";",
        "export async function GET() {",
        "  return Response.json(await db.project.findMany());",
        "}",
        ""
      ].join("\n")
    );
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const convention = storage.listAcceptedConventions("repo_abc")[0]!;
    const updatedConvention = {
      ...convention,
      matcher: {
        ...convention.matcher,
        forbidden_imports: ["@/lib/prisma", "@/lib/db"]
      },
      exceptions: [
        {
          id: "exception_prisma_import",
          reason: "Legacy Prisma route is allowed temporarily.",
          imports: ["@/lib/prisma"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:20.000Z"
        },
        {
          id: "exception_db_symbol",
          reason: "Legacy db symbol is allowed temporarily.",
          symbols: ["db"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:20.000Z"
        }
      ]
    };
    storage.upsertAcceptedConvention("repo_abc", updatedConvention);
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [updatedConvention]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.findings_count).toBe(0);
  });

  it("honors endpoint and method convention exceptions without suppressing sibling routes", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/health"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/health/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const added = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--endpoint", "/api/health",
      "--method", "GET",
      "--reason", "Health endpoint is intentionally dependency-light.",
      "--confirm",
      "--json"
    ]);

    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).convention.exceptions).toEqual([
      expect.objectContaining({
        endpoint_paths: ["/api/health"],
        methods: ["GET"]
      })
    ]);

    const checked = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    expect(checked.exitCode).toBe(0);
    const payload = JSON.parse(checked.stdout);
    expect(payload.summary.findings_count, JSON.stringify(payload.findings, null, 2)).toBe(1);
    expect(payload.findings[0].evidence_refs[0].file_path).toBe("apps/web/app/api/users/route.ts");
  });

  it("honors read-only operation exceptions without suppressing write operations", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "apps/web/app/api/projects"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/projects/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function POST() {",
        "  return Response.json(await prisma.project.create({ data: {} }));",
        "}",
        ""
      ].join("\n")
    );

    const added = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--operation-kind", "read",
      "--reason", "Legacy read routes are allowed while the service layer is migrated.",
      "--confirm",
      "--json"
    ]);

    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).convention.exceptions).toEqual([
      expect.objectContaining({
        operation_kinds: ["read"]
      })
    ]);

    const checked = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    expect(checked.exitCode).toBe(0);
    const payload = JSON.parse(checked.stdout);
    expect(payload.summary.findings_count, JSON.stringify(payload.findings, null, 2)).toBe(1);
    expect(payload.findings[0].evidence_refs[0].file_path).toBe("apps/web/app/api/projects/route.ts");
  });

  it("does not honor expired convention exceptions during checks", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const convention = storage.listAcceptedConventions("repo_abc")[0]!;
    const updatedConvention = {
      ...convention,
      exceptions: [{
        id: "exception_expired_prisma_import",
        reason: "Expired temporary import exception.",
        imports: ["@/lib/prisma"],
        expires_at: "2026-05-10T00:00:20.000Z",
        created_by: "geoff",
        created_at: "2026-05-10T00:00:10.000Z"
      }]
    };
    storage.upsertAcceptedConvention("repo_abc", updatedConvention);
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [updatedConvention]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.findings_count).toBe(1);
  });

  it("adds contract waivers with explicit confirmation and audits the change", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/**",
      "--reason", "Legacy user API route is allowed until it is rewritten.",
      "--expires-at", "2026-06-10T00:00:00.000Z",
      "--actor", "geoff",
      "--confirm",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo_id: "repo_abc",
      changed: true,
      waiver: {
        reason: "Legacy user API route is allowed until it is rewritten.",
        path_globs: ["apps/web/app/api/users/**"],
        expires_at: "2026-06-10T00:00:00.000Z",
        created_by: "geoff",
        created_at: "2026-05-10T00:00:30.000Z"
      },
      contract_summary: {
        waiver_count: 1
      }
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getRepoContract("repo_abc")?.waivers).toEqual([payload.waiver]);
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "policy_changed",
      target_type: "contract_waiver",
      actor: "geoff",
      metadata: {
        path: "apps/web/app/api/users/**",
        reason: "Legacy user API route is allowed until it is rewritten."
      }
    });
    storage.close();
  });

  it("requires confirmation and a waiver selector before mutating contract waivers", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const missingConfirm = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/**",
      "--reason", "Legacy route.",
      "--json"
    ]);
    const missingSelector = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--reason", "Legacy route.",
      "--confirm",
      "--json"
    ]);
    const invalidExpiry = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/**",
      "--reason", "Legacy route.",
      "--expires-at", "tomorrow",
      "--confirm",
      "--json"
    ]);

    expect(missingConfirm.exitCode).toBe(1);
    expect(missingConfirm.stderr).toContain("Contract waiver changes require --confirm");
    expect(missingSelector.exitCode).toBe(1);
    expect(missingSelector.stderr).toContain("Contract waiver requires at least one of --path, --symbol, or --import");
    expect(invalidExpiry.exitCode).toBe(1);
    expect(invalidExpiry.stderr).toContain("--expires-at must be an ISO timestamp");
  });

  it("lists contract waivers by active and expired status", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [
        {
          id: "waiver_active_user_api",
          reason: "Legacy user API route is allowed for now.",
          path_globs: ["apps/web/app/api/users/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        },
        {
          id: "waiver_expired_docs",
          reason: "Expired docs waiver.",
          path_globs: ["docs/**"],
          expires_at: "2026-05-10T00:00:20.000Z",
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        }
      ]
    });
    storage.close();

    const active = await runCli([
      "--db", databasePath,
      "contract", "waivers", "list",
      "--repo", "repo_abc",
      "--status", "active",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const expired = await runCli([
      "--db", databasePath,
      "contract", "waivers", "list",
      "--repo", "repo_abc",
      "--status", "expired",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const invalid = await runCli([
      "--db", databasePath,
      "contract", "waivers", "list",
      "--repo", "repo_abc",
      "--status", "stale",
      "--json"
    ]);

    expect(active.exitCode).toBe(0);
    expect(JSON.parse(active.stdout)).toMatchObject({
      repo_id: "repo_abc",
      status: "active",
      summary: {
        total_count: 2,
        active_count: 1,
        expired_count: 1,
        listed_count: 1
      },
      review_items: [{
        id: "waiver_active_user_api",
        status: "active",
        path_globs: ["apps/web/app/api/users/**"]
      }]
    });
    expect(JSON.parse(expired.stdout).review_items).toEqual([
      expect.objectContaining({
        id: "waiver_expired_docs",
        status: "expired"
      })
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("--status must be active, expired, or all");
  });

  it("filters contract waivers by repo-relative path", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [
        {
          id: "waiver_active_user_api",
          reason: "Legacy user API route is allowed for now.",
          path_globs: ["apps/web/app/api/users/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        },
        {
          id: "waiver_docs",
          reason: "Docs waiver.",
          path_globs: ["docs/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:10.000Z"
        }
      ]
    });
    storage.close();

    const listed = await runCli([
      "--db", databasePath,
      "contract", "waivers", "list",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const unsafePath = await runCli([
      "--db", databasePath,
      "contract", "waivers", "list",
      "--repo", "repo_abc",
      "--path", "../secret.ts",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      summary: {
        listed_count: 1
      },
      review_items: [{
        id: "waiver_active_user_api",
        matched_files: ["apps/web/app/api/users/route.ts"]
      }]
    });
    expect(JSON.parse(listed.stdout).review_items.map((item: { id: string }) => item.id)).not.toContain("waiver_docs");
    expect(unsafePath.exitCode).toBe(1);
    expect(unsafePath.stderr).toContain("--path must be repo-relative");
  });

  it("shows contract waiver review details", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_active_user_api",
        reason: "Legacy user API route is allowed for now.",
        path_globs: ["apps/web/app/api/users/**"],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:10.000Z"
      }]
    });
    storage.close();

    const shown = await runCli([
      "--db", databasePath,
      "contract", "waiver", "show", "waiver_active_user_api",
      "--repo", "repo_abc",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const missing = await runCli([
      "--db", databasePath,
      "contract", "waiver", "show", "waiver_missing",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      repo_id: "repo_abc",
      waiver: {
        id: "waiver_active_user_api"
      },
      review_item: {
        id: "waiver_active_user_api",
        status: "active",
        path_globs: ["apps/web/app/api/users/**"]
      },
      next_commands: [
        "drift contract waivers list --repo repo_abc --status active --json",
        "drift contract waiver remove waiver_active_user_api --repo repo_abc --confirm --json"
      ]
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Contract waiver not found: waiver_missing");
  });

  it("removes contract waivers only with explicit confirmation and audits the change", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_active_user_api",
        reason: "Legacy user API route is allowed for now.",
        path_globs: ["apps/web/app/api/users/**"],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:10.000Z"
      }]
    });
    storage.close();

    const missingConfirm = await runCli([
      "--db", databasePath,
      "contract", "waiver", "remove", "waiver_active_user_api",
      "--repo", "repo_abc",
      "--json"
    ]);
    const removed = await runCli([
      "--db", databasePath,
      "contract", "waiver", "remove", "waiver_active_user_api",
      "--repo", "repo_abc",
      "--actor", "geoff",
      "--confirm",
      "--now", "2026-05-10T00:00:40.000Z",
      "--json"
    ]);

    expect(missingConfirm.exitCode).toBe(1);
    expect(missingConfirm.stderr).toContain("Contract waiver removal requires --confirm");
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout)).toMatchObject({
      repo_id: "repo_abc",
      changed: true,
      removed_waiver_id: "waiver_active_user_api",
      contract_summary: {
        waiver_count: 0
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.waivers).toEqual([]);
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "policy_changed",
      target_type: "contract_waiver",
      target_id: "waiver_active_user_api",
      actor: "geoff",
      metadata: {
        removed: true
      }
    });
    checked.close();
  });

  it("refuses to remove a missing contract waiver", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "waiver", "remove", "waiver_missing",
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Contract waiver not found: waiver_missing");
  });

  it("does not duplicate active contract waivers with the same selectors", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const first = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/**",
      "--reason", "Legacy route.",
      "--confirm",
      "--json"
    ]);
    const duplicate = await runCli([
      "--db", databasePath,
      "contract", "waiver", "add",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/**",
      "--reason", "Different words for same selector.",
      "--confirm",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(duplicate.exitCode).toBe(0);
    expect(JSON.parse(duplicate.stdout)).toMatchObject({
      changed: false,
      contract_summary: {
        waiver_count: 1
      }
    });
  });

  it("honors active contract waivers during checks and reports waived findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_user_api_legacy",
        reason: "Legacy user API route is accepted drift for now.",
        path_globs: ["apps/web/app/api/users/**"],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:20.000Z"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 0,
      blocking_count: 0,
      waived_findings_count: 1
    });
    expect(JSON.parse(result.stdout).waived_findings).toEqual([
      expect.objectContaining({
        waiver_id: "waiver_user_api_legacy",
        convention_id: "convention_no_direct_db",
        file_path: "apps/web/app/api/users/route.ts",
        symbol: "prisma",
        import_source: "@/lib/prisma",
        line: 1
      })
    ]);
  });

  it("does not honor a waiver when the waived file changed and reapproval is required", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_user_api_reapproval",
        reason: "Legacy user API route is accepted only for the approved file hash.",
        path_globs: ["apps/web/app/api/users/**"],
        requires_reapproval_on_change: true,
        approved_file_hashes: [{
          file_path: "apps/web/app/api/users/route.ts",
          content_hash: "0".repeat(64)
        }],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:20.000Z"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        convention_id: "convention_no_direct_db",
        title: "Waiver requires reapproval after file change",
        expected_layer: "approved_waiver_state",
        actual_layer: "waiver_stale_after_file_change",
        enforcement_result: "warn"
      }),
      expect.objectContaining({
        convention_id: "convention_no_direct_db",
        title: "API route imports data access directly",
        enforcement_result: "block"
      })
    ]));
    expect(payload.summary).toMatchObject({
      blocking_count: 1,
      waived_findings_count: 0
    });
  });

  it("does not honor expired contract waivers during checks", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_expired_user_api_legacy",
        reason: "Expired accepted drift.",
        path_globs: ["apps/web/app/api/users/**"],
        expires_at: "2026-05-10T00:00:20.000Z",
        created_by: "geoff",
        created_at: "2026-05-10T00:00:10.000Z"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 1,
      blocking_count: 1,
      waived_findings_count: 0
    });
  });

  it("honors symbol and import contract waivers during checks", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      waivers: [{
        id: "waiver_prisma_import",
        reason: "Temporarily allow this import while migrating legacy routes.",
        symbols: ["prisma"],
        imports: ["@/lib/prisma"],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:20.000Z"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 0,
      waived_findings_count: 1
    });
  });

  it("does not turn waived graph-resolved data access imports into findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
    );
    await mkdir(join(repoRoot, "src/lib"), { recursive: true });
    await writeFile(join(repoRoot, "src/lib/prisma.ts"), "export const prisma = {};\n");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      conventions: [{
        ...contract.conventions[0]!,
        matcher: {
          ...contract.conventions[0]!.matcher,
          forbidden_imports: ["src/lib/prisma.ts"]
        }
      }],
      waivers: [{
        id: "waiver_prisma_alias",
        reason: "Temporarily allow this aliased import while migrating legacy routes.",
        imports: ["@/lib/prisma"],
        created_by: "geoff",
        created_at: "2026-05-10T00:00:20.000Z"
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 0,
      blocking_count: 0
    });
  });

  it("does not check expired accepted conventions", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.findings_count).toBe(0);
  });

  it("does not check conventions with enforcement mode off", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const convention = storage.listAcceptedConventions("repo_abc")[0]!;
    const disabledConvention = {
      ...convention,
      enforcement_mode: "off" as const
    };
    storage.upsertAcceptedConvention("repo_abc", disabledConvention);
    storage.upsertRepoContract({
      ...storage.getRepoContract("repo_abc")!,
      conventions: [disabledConvention]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary.findings_count).toBe(0);
  });

  it("reports deleted diff files as skipped instead of active findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "deleted.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
      "deleted file mode 100644",
      "--- a/apps/web/app/api/users/route.ts",
      "+++ /dev/null",
      "@@ -1,5 +0,0 @@",
      "-import { prisma } from \"@/lib/prisma\";",
      "-",
      "-export async function POST() {",
      "-  return Response.json(await prisma.user.findMany());",
      "-}",
      ""
    ].join("\n"));

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      findings_count: 0,
      skipped_deleted_files: ["apps/web/app/api/users/route.ts"]
    });
  });

  it("preserves human-governed finding statuses during repeated checks", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    const first = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const finding = JSON.parse(first.stdout).findings[0];
    await runCli([
      "--db", databasePath,
      "findings", "suppress",
      finding.id,
      "--repo", "repo_abc",
      "--reason", "legacy fixture",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);

    const second = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:40.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).findings[0]).toMatchObject({
      id: finding.id,
      status: "suppressed"
    });
  });

  it("denies check output when repo policy requires approval", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
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

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", join(repoRoot, "..", "diff.patch"),
      "--scope", "changed-hunks",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy denied check output");
  });

  it("reports invalid git diff ranges with a clean check error", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff", "main...HEAD",
      "--scope", "changed-hunks",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unable to read git diff for range main...HEAD");
  });

  it("rejects diff-file paths that are directories", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-diff-dir-"));
    tempDirs.push(dir);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", dir,
      "--scope", "changed-hunks",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--diff-file must be a file");
  });

  it("creates, reports, and clears baselines from stored findings", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    const created = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);
    const status = await runCli([
      "--db", databasePath,
      "baseline", "status",
      "--repo", "repo_abc",
      "--json"
    ]);
    const cleared = await runCli([
      "--db", databasePath,
      "baseline", "clear",
      "--repo", "repo_abc",
      "--convention", "convention_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:32.000Z",
      "--json"
    ]);

    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({
      created_count: 1,
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      summary: {
        active_count: 1,
        resolved_count: 0,
        total_count: 1
      },
      review_items: [{
        convention_id: "convention_no_direct_db",
        status: "active",
        file_path: "apps/web/app/api/users/route.ts"
      }],
      next_commands: [
        "drift baseline status --repo repo_abc --json",
        "drift prepare \"task\" --repo repo_abc --json",
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json"
      ]
    });
    expect(JSON.parse(status.stdout)).toMatchObject({
      active_count: 1,
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        active_count: 1,
        resolved_count: 0,
        total_count: 1
      },
      review_items: [{
        convention_id: "convention_no_direct_db",
        status: "active"
      }],
      next_commands: [
        "drift findings list --repo repo_abc --json",
        "drift baseline clear --repo repo_abc --convention convention_no_direct_db --confirm --json"
      ]
    });
    expect(cleared.exitCode).toBe(0);
    expect(JSON.parse(cleared.stdout)).toMatchObject({
      resolved_count: 1,
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      summary: {
        active_count: 0,
        resolved_count: 1,
        total_count: 1
      },
      review_items: [{
        convention_id: "convention_no_direct_db",
        status: "resolved"
      }],
      next_commands: [
        "drift baseline status --repo repo_abc --json",
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json",
        "drift audit list --repo repo_abc --action baseline_cleared --json"
      ]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listBaselineViolations("repo_abc")[0]?.status).toBe("resolved");
    expect(storage.listAuditEvents("repo_abc").at(-1)?.action).toBe("baseline_cleared");
    storage.close();
  });

  it("requires explicit confirmation before creating or clearing baselines", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    const beforeBaselineCount = storage.listBaselineViolations("repo_abc").length;
    storage.close();

    const created = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--json"
    ]);
    const cleared = await runCli([
      "--db", databasePath,
      "baseline", "clear",
      "--repo", "repo_abc",
      "--convention", "convention_no_direct_db",
      "--json"
    ]);

    expect(created.exitCode).toBe(1);
    expect(created.stderr).toContain("Baseline creation requires --confirm");
    expect(cleared.exitCode).toBe(1);
    expect(cleared.stderr).toContain("Baseline clearing requires --confirm");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listBaselineViolations("repo_abc")).toHaveLength(beforeBaselineCount);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("does not count already-baselined findings as newly created", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    const first = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);
    const second = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:32.000Z",
      "--json"
    ]);
    const status = await runCli([
      "--db", databasePath,
      "baseline", "status",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(first.stdout).created_count).toBe(1);
    expect(JSON.parse(second.stdout).created_count).toBe(0);
    expect(JSON.parse(status.stdout).active_count).toBe(1);
  });

  it("does not audit empty baseline creates", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    const beforeScanCount = storage.listScanManifests("repo_abc").length;
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:32.000Z",
      "--json"
    ]);

    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).created_count).toBe(0);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    expect(checked.listScanManifests("repo_abc")).toHaveLength(beforeScanCount);
    checked.close();
  });

  it("requires non-empty baseline sources", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--from must not be empty");
  });

  it("does not audit no-op baseline clears", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const diffFile = join(repoRoot, "..", "diff.patch");
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);
    await runCli([
      "--db", databasePath,
      "baseline", "clear",
      "--repo", "repo_abc",
      "--convention", "convention_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:32.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const secondClear = await runCli([
      "--db", databasePath,
      "baseline", "clear",
      "--repo", "repo_abc",
      "--convention", "convention_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:33.000Z",
      "--json"
    ]);

    expect(secondClear.exitCode).toBe(0);
    expect(JSON.parse(secondClear.stdout).resolved_count).toBe(0);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("does not baseline governed or resolved findings", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const finding of [
      ["finding_new", "finding-new-fp", "new"],
      ["finding_suppressed", "finding-suppressed-fp", "suppressed"],
      ["finding_accepted", "finding-accepted-fp", "accepted_drift"],
      ["finding_false_positive", "finding-false-positive-fp", "false_positive"],
      ["finding_fixed", "finding-fixed-fp", "fixed"]
    ] as const) {
      storage.upsertFinding({
        id: finding[0],
        repo_id: "repo_abc",
        convention_id: "convention_no_direct_db",
        fingerprint: finding[1],
        title: "API route imports data access directly",
        message: "Route imports prisma directly.",
        severity: "error",
        enforcement_result: "block",
        status: finding[2],
        diff_status: "new_in_diff",
        evidence_refs: [],
        created_at: "2026-05-10T00:00:02.000Z"
      });
    }
    storage.close();

    const created = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
      "--confirm",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);

    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout).created_count).toBe(1);
    expect(JSON.parse(created.stdout).baseline.map((entry: { finding_fingerprint: string }) =>
      entry.finding_fingerprint
    )).toEqual(["finding-new-fp"]);
  });

  it("refuses baseline status and clear for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const status = await runCli([
      "--db", databasePath,
      "baseline", "status",
      "--repo", "repo_missing",
      "--json"
    ]);
    const cleared = await runCli([
      "--db", databasePath,
      "baseline", "clear",
      "--repo", "repo_missing",
      "--convention", "convention_no_direct_db",
      "--json"
    ]);

    expect(status.exitCode).toBe(1);
    expect(status.stderr).toContain("Unknown repo repo_missing");
    expect(cleared.exitCode).toBe(1);
    expect(cleared.stderr).toContain("Unknown repo repo_missing");
  });

  it("prints focused baseline help without requiring a database", async () => {
    const result = await runCli(["baseline", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Manage baselines");
    expect(result.stdout).toContain("baseline create");
  });

  it("prints focused init and scan help without requiring a database", async () => {
    const doctor = await runCli(["doctor", "--help"]);
    const init = await runCli(["init", "--help"]);
    const scan = await runCli(["scan", "--help"]);

    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("Check whether a repo is ready for Drift");
    expect(doctor.stdout).toContain("migration compatibility, contract compatibility, scan freshness, audit-chain integrity");
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toContain("Create local Drift state");
    expect(scan.exitCode).toBe(0);
    expect(scan.stdout).toContain("Scan a repo");
  });

  it("lists findings as JSON", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
        scan_id: "scan_baseline",
        file_hash: "a".repeat(64),
        redaction_state: "none"
      }],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_baseline",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 1,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertBaselineViolation({
      id: "baseline_existing",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      finding_fingerprint: "finding-fp",
      file_path: "apps/web/app/api/users/route.ts",
      first_seen_scan_id: "scan_baseline",
      first_seen_commit: "abc123",
      status: "active",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).policy).toMatchObject({
      allowed: true,
      surface: "cli-check"
    });
    const payload = JSON.parse(result.stdout);
    expect(payload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(payload.findings[0].id).toBe("finding_abc");
    expect(payload.review_items[0]).toMatchObject({
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
    expect(payload.review_items[0]).not.toHaveProperty("message");
    expect(payload.review_items[0]).not.toHaveProperty("evidence_refs");
  });

  it("filters findings list and returns review summary counts", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const finding of [
      {
        id: "finding_new_error",
        fingerprint: "finding-new-error-fp",
        status: "new" as const,
        severity: "error" as const,
        diff_status: "new_in_diff" as const
      },
      {
        id: "finding_new_error_touched",
        fingerprint: "finding-new-error-touched-fp",
        status: "new" as const,
        severity: "error" as const,
        diff_status: "touched_existing" as const
      },
      {
        id: "finding_new_warning",
        fingerprint: "finding-new-warning-fp",
        status: "new" as const,
        severity: "warning" as const,
        diff_status: "new_in_diff" as const
      },
      {
        id: "finding_suppressed",
        fingerprint: "finding-suppressed-fp",
        status: "suppressed" as const,
        severity: "error" as const,
        diff_status: "outside_diff" as const
      }
    ]) {
      storage.upsertFinding({
        id: finding.id,
        repo_id: "repo_abc",
        convention_id: "convention_no_direct_db",
        fingerprint: finding.fingerprint,
        title: "API route imports data access directly",
        message: "Route imports prisma directly.",
        severity: finding.severity,
        enforcement_result: finding.severity === "error" ? "block" : "warn",
        status: finding.status,
        diff_status: finding.diff_status,
        evidence_refs: [],
        created_at: "2026-05-10T00:00:02.000Z"
      });
    }
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--status", "new",
      "--severity", "error",
      "--diff-status", "new_in_diff",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.findings.map((finding: { id: string }) => finding.id)).toEqual(["finding_new_error"]);
    expect(payload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(payload.review_items.map((finding: { id: string }) => finding.id)).toEqual(["finding_new_error"]);
    expect(payload.summary).toMatchObject({
      total_count: 4,
      filtered_count: 1,
      by_status: {
        new: 3,
        suppressed: 1
      },
      by_severity: {
        error: 3,
        warning: 1
      },
      by_diff_status: {
        new_in_diff: 2,
        touched_existing: 1,
        outside_diff: 1
      }
    });
  });

  it("filters findings list by convention id", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    upsertReviewFinding(storage);
    storage.upsertFinding({
      id: "finding_docs",
      repo_id: "repo_abc",
      convention_id: "convention_docs",
      fingerprint: "finding-docs-fp",
      title: "Docs finding",
      message: "Docs finding should not match the API route convention.",
      severity: "warning",
      enforcement_result: "warn",
      status: "new",
      diff_status: "outside_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--convention", "convention_no_direct_db",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.filters).toMatchObject({
      convention_id: "convention_no_direct_db"
    });
    expect(payload.summary).toMatchObject({
      total_count: 2,
      filtered_count: 1
    });
    expect(payload.review_items.map((finding: { id: string }) => finding.id)).toEqual(["finding_abc"]);
  });

  it("paginates findings list with deterministic ordering", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const id of ["finding_004", "finding_001", "finding_003", "finding_002"]) {
      storage.upsertFinding({
        id,
        repo_id: "repo_abc",
        convention_id: "convention_no_direct_db",
        fingerprint: `${id}-fp`,
        title: `Finding ${id}`,
        message: "Pagination fixture.",
        severity: "error",
        enforcement_result: "block",
        status: "new",
        diff_status: "new_in_diff",
        evidence_refs: [],
        created_at: "2026-05-10T00:00:02.000Z"
      });
    }
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);
    const invalidLimit = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--limit", "0",
      "--json"
    ]);
    const invalidOffset = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--offset", "-1",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.summary).toMatchObject({
      total_count: 4,
      filtered_count: 4
    });
    expect(payload.pagination).toEqual({
      limit: 2,
      offset: 1,
      returned_count: 2,
      has_more: true,
      next_offset: 3
    });
    expect(payload.review_items.map((finding: { id: string }) => finding.id)).toEqual([
      "finding_002",
      "finding_003"
    ]);
    expect(payload.findings.map((finding: { id: string }) => finding.id)).toEqual([
      "finding_002",
      "finding_003"
    ]);
    expect(invalidLimit.exitCode).toBe(1);
    expect(invalidLimit.stderr).toContain("--limit must be a positive integer.");
    expect(invalidOffset.exitCode).toBe(1);
    expect(invalidOffset.stderr).toContain("--offset must be a non-negative integer.");
  });

  it("filters findings list by repo-relative evidence path", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_docs",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-docs-fp",
      title: "Docs-only finding",
      message: "Docs finding should not match the API route path.",
      severity: "warning",
      enforcement_result: "warn",
      status: "new",
      diff_status: "outside_diff",
      evidence_refs: [{
        id: "evidence_docs",
        kind: "violation",
        file_path: "docs/auth.md",
        start_line: 1,
        end_line: 1,
        fact_ids: [],
        scan_id: "scan_abc",
        file_hash: "b".repeat(64),
        redaction_state: "none"
      }],
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const unsafe = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--path", "../secret.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.filters).toMatchObject({
      path: "apps/web/app/api/users/route.ts"
    });
    expect(payload.summary).toMatchObject({
      total_count: 2,
      filtered_count: 1
    });
    expect(payload.review_items).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^finding_[a-f0-9]+$/),
        first_evidence: expect.objectContaining({
          file_path: "apps/web/app/api/users/route.ts"
        })
      })
    ]);
    expect(payload.review_items.map((finding: { id: string }) => finding.id)).not.toContain("finding_docs");
    expect(unsafe.exitCode).toBe(1);
    expect(unsafe.stderr).toContain("--path must be repo-relative.");
  });

  it("shows one finding with full evidence and safe next actions", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    upsertReviewFinding(storage);
    upsertReviewFindingGraphEvidence(storage);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "show",
      "finding_abc",
      "--repo", "repo_abc",
      "--json"
    ]);
    const missing = await runCli([
      "--db", databasePath,
      "findings", "show",
      "finding_missing",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo_id: "repo_abc",
      policy: {
        allowed: true,
        surface: "cli-check"
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_abc",
        convention_id: "convention_no_direct_db",
        first_evidence: {
          file_path: "apps/web/app/api/users/route.ts",
          start_line: 1,
          import_source: "@/lib/prisma",
          symbol: "prisma"
        }
      },
      finding: {
        id: "finding_abc",
        message: "Route imports prisma directly.",
        evidence_refs: [{
          file_path: "apps/web/app/api/users/route.ts",
          start_line: 1,
          import_source: "@/lib/prisma"
        }]
      },
      graph_evidence: {
        finding_id: "finding_abc",
        diagnostics: [],
        evidence: [{
          id: "graph_evidence_import",
          file_path: "apps/web/app/api/users/route.ts",
          start_line: 1,
          fact_ids: ["fact_import_abc"]
        }],
        related_nodes: [{
          id: "import_decl:apps/web/app/api/users/route.ts:prisma",
          kind: "import_decl"
        }]
      },
      freshness_requirement: {
        required: false,
        satisfied: false
      }
    });
	    expect(payload.next_commands).toEqual([
	      "drift findings mark-fixed finding_abc --repo repo_abc --evidence apps/web/app/api/users/route.ts:1 --confirm --json",
	      "drift findings mark-needs-review finding_abc --repo repo_abc --reason \"needs human review\" --confirm --json",
	      "drift prepare \"task\" --repo repo_abc --path apps/web/app/api/users/route.ts --json"
	    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Finding not found: finding_missing");
  });

  it("fails findings list when fresh scan context is required but stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--require-fresh",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Scan is stale for repo_abc.");
    expect(result.stderr).toContain("drift scan --repo-root");
    expect(result.stderr).toContain("omit --require-fresh");
  });

  it("fails findings show when fresh scan context is required but stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "findings", "show",
      "finding_abc",
      "--repo", "repo_abc",
      "--require-fresh",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Scan is stale for repo_abc.");
    expect(result.stderr).toContain("drift scan --repo-root");
    expect(result.stderr).toContain("omit --require-fresh");
  });

  it("denies findings list when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy denied findings output");
  });

  it("rejects invalid findings list filter values", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const invalidStatus = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--status", "open",
      "--json"
    ]);
    const expiredStatus = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--status", "expired",
      "--json"
    ]);
    const invalidSeverity = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--severity", "critical",
      "--json"
    ]);
    const invalidDiffStatus = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--diff-status", "unknown",
      "--json"
    ]);

    expect(invalidStatus.exitCode).toBe(1);
    expect(invalidStatus.stderr).toContain("--status must be");
    expect(expiredStatus.exitCode).toBe(0);
    expect(invalidSeverity.exitCode).toBe(1);
    expect(invalidSeverity.stderr).toContain("--severity must be");
    expect(invalidDiffStatus.exitCode).toBe(1);
    expect(invalidDiffStatus.stderr).toContain("--diff-status must be");
  });

  it("refuses findings list for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_missing",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown repo repo_missing");
  });

  it("marks a finding fixed with evidence and audits the resolution", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_baseline",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 1,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertBaselineViolation({
      id: "baseline_existing",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      finding_fingerprint: "finding-fp",
      file_path: "apps/web/app/api/users/route.ts",
      first_seen_scan_id: "scan_baseline",
      first_seen_commit: "abc123",
      status: "active",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed",
      "finding_abc",
	      "--repo", "repo_abc",
	      "--evidence", "apps/web/app/api/users/route.ts:12",
	      "--confirm",
	      "--actor", "geoff",
	      "--now", "2026-05-10T00:00:03.000Z",
	      "--json"
	    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finding: { status: "fixed" },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_abc",
        status: "fixed",
        enforcement_result: "block"
      },
      resolution: {
        kind: "fixed",
        evidence: "apps/web/app/api/users/route.ts:12",
        resolved_baseline_count: 1
      },
      next_commands: [
        "drift findings list --repo repo_abc --json",
        "drift baseline status --repo repo_abc --json",
        "drift audit list --repo repo_abc --action finding_resolved --json"
      ]
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]?.status).toBe("fixed");
    expect(checked.listBaselineViolations("repo_abc")[0]?.status).toBe("resolved");
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "finding_resolved",
      actor: "geoff",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" }
    });
	    checked.close();
	  });

	  it("requires explicit confirmation before marking findings fixed", async () => {
	    const databasePath = await seedDatabase();
	    const storage = openDriftStorage({ databasePath });
	    storage.migrate();
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
	      created_at: "2026-05-10T00:00:02.000Z"
	    });
	    storage.upsertScanManifest({
	      id: "scan_baseline",
	      repo_id: "repo_abc",
	      branch: "main",
	      commit: "abc123",
	      dirty: false,
	      scanner_version: "0.1.0",
	      adapter_versions: { typescript: "0.1.0" },
	      rule_engine_version: "0.1.0",
	      status: "completed",
	      file_count: 1,
	      fact_count: 1,
	      finding_count: 1,
	      started_at: "2026-05-10T00:00:01.000Z",
	      completed_at: "2026-05-10T00:00:02.000Z"
	    });
	    storage.upsertBaselineViolation({
	      id: "baseline_existing",
	      repo_id: "repo_abc",
	      convention_id: "convention_no_direct_db",
	      finding_fingerprint: "finding-fp",
	      file_path: "apps/web/app/api/users/route.ts",
	      first_seen_scan_id: "scan_baseline",
	      first_seen_commit: "abc123",
	      status: "active",
	      created_at: "2026-05-10T00:00:02.000Z"
	    });
	    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
	    storage.close();

	    const result = await runCli([
	      "--db", databasePath,
	      "findings", "mark-fixed",
	      "finding_abc",
	      "--repo", "repo_abc",
	      "--evidence", "apps/web/app/api/users/route.ts:12",
	      "--json"
	    ]);

	    expect(result.exitCode).toBe(1);
	    expect(result.stderr).toContain("Finding fixed resolution requires --confirm");

	    const checked = openDriftStorage({ databasePath });
	    checked.migrate();
	    expect(checked.listFindings("repo_abc")[0]?.status).toBe("new");
	    expect(checked.listBaselineViolations("repo_abc")[0]?.status).toBe("active");
	    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
	    checked.close();
	  });

  it("does not audit no-op mark-fixed requests", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_fixed",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-fixed-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "fixed",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed",
      "finding_fixed",
	      "--repo", "repo_abc",
	      "--evidence", "apps/web/app/api/users/route.ts:12",
	      "--confirm",
	      "--now", "2026-05-10T00:00:03.000Z",
	      "--json"
	    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changed).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_fixed",
        status: "fixed"
      },
      next_commands: [
        "drift findings list --repo repo_abc --json",
        "drift baseline status --repo repo_abc --json",
        "drift audit list --repo repo_abc --action finding_resolved --json"
      ]
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]?.status).toBe("fixed");
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires mark-fixed evidence to include a file and line", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed",
      "finding_abc",
      "--repo", "repo_abc",
      "--evidence", "fixed in latest diff",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--evidence must be formatted as <file>:<line>");
  });

  it("requires mark-fixed evidence paths to be repo-relative", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed",
      "finding_abc",
      "--repo", "repo_abc",
      "--evidence", "../secrets.env:12",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--evidence file must be repo-relative");
  });

  it("requires mark-fixed evidence lines to be positive", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "mark-fixed",
      "finding_abc",
      "--repo", "repo_abc",
      "--evidence", "apps/web/app/api/users/route.ts:0",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--evidence line must be positive");
  });

  it("marks findings as needs-review with a reason and audit event", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_review",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-review-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

	    const result = await runCli([
	      "--db", databasePath,
	      "findings", "mark-needs-review",
	      "finding_review",
	      "--repo", "repo_abc",
	      "--reason", "needs human confirmation before suppressing",
	      "--confirm",
	      "--actor", "geoff",
	      "--now", "2026-05-10T00:00:03.000Z",
	      "--json"
	    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finding: { status: "needs_review" },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_review",
        status: "needs_review"
      },
      resolution: {
        kind: "needs_review",
        reason: "needs human confirmation before suppressing"
      },
      next_commands: [
        "drift findings list --repo repo_abc --status needs_review --json",
        "drift prepare \"task\" --repo repo_abc --json",
        "drift audit list --repo repo_abc --action finding_flagged_for_review --json"
      ]
    });

	    const checked = openDriftStorage({ databasePath });
	    checked.migrate();
	    expect(checked.listFindings("repo_abc")[0]?.status).toBe("needs_review");
	    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
	      action: "finding_flagged_for_review",
	      actor: "geoff",
	      target_id: "finding_review",
      metadata: {
        reason: "needs human confirmation before suppressing",
        status: "needs_review"
      }
    });
	    checked.close();
	  });

	  it("requires explicit confirmation before marking findings as needs-review", async () => {
	    const databasePath = await seedDatabase();
	    const storage = openDriftStorage({ databasePath });
	    storage.migrate();
	    storage.upsertFinding({
	      id: "finding_review",
	      repo_id: "repo_abc",
	      convention_id: "convention_no_direct_db",
	      fingerprint: "finding-review-fp",
	      title: "API route imports data access directly",
	      message: "Route imports prisma directly.",
	      severity: "error",
	      enforcement_result: "block",
	      status: "new",
	      diff_status: "new_in_diff",
	      evidence_refs: [],
	      created_at: "2026-05-10T00:00:02.000Z"
	    });
	    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
	    storage.close();

	    const result = await runCli([
	      "--db", databasePath,
	      "findings", "mark-needs-review",
	      "finding_review",
	      "--repo", "repo_abc",
	      "--reason", "needs human confirmation before suppressing",
	      "--json"
	    ]);

	    expect(result.exitCode).toBe(1);
	    expect(result.stderr).toContain("Finding needs-review resolution requires --confirm");

	    const checked = openDriftStorage({ databasePath });
	    checked.migrate();
	    expect(checked.listFindings("repo_abc")[0]?.status).toBe("new");
	    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
	    checked.close();
	  });

  it("supports governance finding resolutions with reasons and audit events", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const id of ["finding_suppress", "finding_drift", "finding_fp"]) {
      storage.upsertFinding({
        id,
        repo_id: "repo_abc",
        convention_id: "convention_no_direct_db",
        fingerprint: `${id}-fp`,
        title: "API route imports data access directly",
        message: "Route imports prisma directly.",
        severity: "error",
        enforcement_result: "block",
        status: "new",
        diff_status: "new_in_diff",
        evidence_refs: [],
        created_at: "2026-05-10T00:00:02.000Z"
      });
    }
    storage.close();

    const suppressed = await runCli([
      "--db", databasePath,
      "findings", "suppress",
      "finding_suppress",
      "--repo", "repo_abc",
      "--reason", "generated client fixture",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:03.000Z",
      "--json"
    ]);
    const accepted = await runCli([
      "--db", databasePath,
      "findings", "accept-drift",
      "finding_drift",
      "--repo", "repo_abc",
      "--reason", "legacy endpoint approved for now",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const falsePositive = await runCli([
      "--db", databasePath,
      "findings", "mark-false-positive",
      "finding_fp",
      "--repo", "repo_abc",
      "--reason", "import name is test double",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:05.000Z",
      "--json"
    ]);

    expect(suppressed.exitCode).toBe(0);
    expect(JSON.parse(suppressed.stdout)).toMatchObject({
      finding: { status: "suppressed" },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_suppress",
        status: "suppressed"
      },
      resolution: {
        kind: "suppressed",
        reason: "generated client fixture"
      },
      next_commands: [
        "drift findings list --repo repo_abc --json",
        "drift prepare \"task\" --repo repo_abc --json",
        "drift audit list --repo repo_abc --action finding_suppressed --json"
      ]
    });
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      finding: { status: "accepted_drift" },
      resolution: {
        kind: "accepted_drift",
        reason: "legacy endpoint approved for now"
      },
      next_commands: [
        "drift findings list --repo repo_abc --json",
        "drift prepare \"task\" --repo repo_abc --json",
        "drift audit list --repo repo_abc --action finding_resolved --json"
      ]
    });
    expect(falsePositive.exitCode).toBe(0);
    expect(JSON.parse(falsePositive.stdout)).toMatchObject({
      finding: { status: "false_positive" },
      resolution: {
        kind: "false_positive",
        reason: "import name is test double"
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(Object.fromEntries(
      checked.listFindings("repo_abc").map((finding) => [finding.id, finding.status])
    )).toEqual({
      finding_suppress: "suppressed",
      finding_drift: "accepted_drift",
      finding_fp: "false_positive"
    });
    expect(checked.listAuditEvents("repo_abc").slice(-3).map((event) => ({
      action: event.action,
      target_id: event.target_id,
      metadata: event.metadata
    }))).toEqual([
      {
        action: "finding_suppressed",
        target_id: "finding_suppress",
        metadata: { reason: "generated client fixture", status: "suppressed" }
      },
      {
        action: "finding_resolved",
        target_id: "finding_drift",
        metadata: { reason: "legacy endpoint approved for now", status: "accepted_drift" }
      },
      {
        action: "finding_resolved",
        target_id: "finding_fp",
        metadata: { reason: "import name is test double", status: "false_positive" }
      }
    ]);
    checked.close();
  });

  it("requires explicit confirmation for suppressing or clearing findings as drift", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const id of ["finding_suppress", "finding_drift", "finding_fp"]) {
      storage.upsertFinding({
        id,
        repo_id: "repo_abc",
        convention_id: "convention_no_direct_db",
        fingerprint: `${id}-fp`,
        title: "API route imports data access directly",
        message: "Route imports prisma directly.",
        severity: "error",
        enforcement_result: "block",
        status: "new",
        diff_status: "new_in_diff",
        evidence_refs: [],
        created_at: "2026-05-10T00:00:02.000Z"
      });
    }
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const commands = [
      ["findings", "suppress", "finding_suppress", "--reason", "generated fixture"],
      ["findings", "accept-drift", "finding_drift", "--reason", "legacy exception"],
      ["findings", "mark-false-positive", "finding_fp", "--reason", "test double"]
    ];

    for (const command of commands) {
      const result = await runCli([
        "--db", databasePath,
        ...command,
        "--repo", "repo_abc",
        "--json"
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Finding governance changes require --confirm");
    }

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(Object.fromEntries(
      checked.listFindings("repo_abc").map((finding) => [finding.id, finding.status])
    )).toEqual({
      finding_suppress: "new",
      finding_drift: "new",
      finding_fp: "new"
    });
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("does not audit no-op finding resolutions", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_suppress",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-suppress-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const first = await runCli([
      "--db", databasePath,
      "findings", "suppress",
      "finding_suppress",
      "--repo", "repo_abc",
      "--reason", "generated client fixture",
      "--confirm",
      "--now", "2026-05-10T00:00:03.000Z",
      "--json"
    ]);
    const before = openDriftStorage({ databasePath });
    before.migrate();
    const beforeAuditCount = before.listAuditEvents("repo_abc").length;
    before.close();

    const second = await runCli([
      "--db", databasePath,
      "findings", "suppress",
      "finding_suppress",
      "--repo", "repo_abc",
      "--reason", "same decision",
      "--confirm",
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed).toBe(false);
    expect(JSON.parse(second.stdout)).toMatchObject({
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "finding_suppress",
        status: "suppressed"
      },
      resolution: {
        kind: "suppressed",
        reason: "same decision"
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]?.status).toBe("suppressed");
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("refuses to resolve already-fixed findings into another governance status", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertFinding({
      id: "finding_fixed",
      repo_id: "repo_abc",
      convention_id: "convention_no_direct_db",
      fingerprint: "finding-fixed-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "fixed",
      diff_status: "new_in_diff",
      evidence_refs: [],
      created_at: "2026-05-10T00:00:02.000Z"
    });
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "suppress",
      "finding_fixed",
      "--repo", "repo_abc",
      "--reason", "not actually fixed",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Finding is already fixed");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listFindings("repo_abc")[0]?.status).toBe("fixed");
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires non-empty reasons for governance finding resolutions", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
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
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "findings", "suppress",
      "finding_abc",
      "--repo", "repo_abc",
      "--reason", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--reason must not be empty");
  });

  it("refuses finding resolution commands for an unknown repo id", async () => {
    const databasePath = await seedDatabase();
	    const commands = [
	      ["findings", "mark-fixed", "finding_abc", "--evidence", "apps/web/app/api/users/route.ts:12", "--confirm"],
	      ["findings", "mark-needs-review", "finding_abc", "--reason", "needs triage", "--confirm"],
	      ["findings", "suppress", "finding_abc", "--reason", "generated fixture", "--confirm"],
	      ["findings", "accept-drift", "finding_abc", "--reason", "legacy exception", "--confirm"],
	      ["findings", "mark-false-positive", "finding_abc", "--reason", "test double", "--confirm"]
    ];

    for (const command of commands) {
      const result = await runCli([
        "--db", databasePath,
        ...command,
        "--repo", "repo_missing",
        "--json"
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown repo repo_missing");
    }
  });

  it("lists audit events as JSON", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_abc",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" },
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).policy).toMatchObject({
      allowed: true,
      surface: "log"
    });
    expect(JSON.parse(result.stdout).governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      total_count: 1,
      filtered_count: 1,
      listed_count: 1,
      audit_valid: true,
      verified_count: 1
    });
    expect(JSON.parse(result.stdout).summary.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(result.stdout).next_commands).toEqual([
      "drift audit verify --repo repo_abc --json",
      "drift backup create --repo repo_abc --confirm --json"
    ]);
    expect(JSON.parse(result.stdout).events[0]).toMatchObject({
      sequence: 1,
      action: "finding_resolved",
      actor: "geoff",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" }
    });
    expect(JSON.parse(result.stdout).events[0].event_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies the audit hash chain as JSON", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_policy",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "policy",
      target_id: "policy_abc",
      metadata: { mode: "local_only" },
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "audit", "verify",
      "--repo", "repo_abc",
      "--strict",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      repo_id: "repo_abc",
      policy: {
        allowed: true,
        surface: "log"
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      verification: {
        valid: true,
        strict: true,
        event_count: 1,
        verified_count: 1,
        head_sequence: 1,
        broken_at_event_id: null,
        reasons: []
      }
    });
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      valid: true,
      strict: true,
      event_count: 1,
      verified_count: 1,
      head_sequence: 1,
      broken_at_event_id: null,
      reason_count: 0
    });
    expect(JSON.parse(result.stdout).next_commands).toEqual([
      "drift audit list --repo repo_abc --json",
      "drift backup create --repo repo_abc --confirm --json"
    ]);
    expect(JSON.parse(result.stdout).verification.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("filters audit events by action", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_policy",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "policy",
      target_id: "contract_abc:context_egress",
      metadata: {},
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_finding",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:04.000Z"
    });
    storage.close();

    const filtered = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--action", "policy_changed",
      "--json"
    ]);
    const invalid = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--action", "not_real",
      "--json"
    ]);

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).action).toBe("policy_changed");
    expect(JSON.parse(filtered.stdout).events.map((event: { action: string }) => event.action)).toEqual([
      "policy_changed"
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("--action must be");
  });

  it("filters audit events by actor", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_geoff",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "policy",
      target_id: "contract_abc:context_egress",
      metadata: {},
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_agent",
      repo_id: "repo_abc",
      actor: "codex",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:04.000Z"
    });
    storage.close();

    const filtered = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--actor", "geoff",
      "--json"
    ]);

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).actor).toBe("geoff");
    expect(JSON.parse(filtered.stdout).events.map((event: { actor: string }) => event.actor)).toEqual([
      "geoff"
    ]);
  });

  it("paginates audit events in deterministic created order", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const event of [
      { id: "audit_event_policy_04", created_at: "2026-05-10T00:00:04.000Z" },
      { id: "audit_event_policy_01", created_at: "2026-05-10T00:00:01.000Z" },
      { id: "audit_event_policy_03", created_at: "2026-05-10T00:00:03.000Z" },
      { id: "audit_event_policy_02", created_at: "2026-05-10T00:00:02.000Z" }
    ]) {
      storage.appendAuditEvent({
        id: event.id,
        repo_id: "repo_abc",
        actor: "geoff",
        action: "policy_changed",
        target_type: "policy",
        target_id: "contract_abc:context_egress",
        metadata: {},
        created_at: event.created_at
      });
    }
    storage.close();

    const paged = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--action", "policy_changed",
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);
    const invalidOffset = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--offset", "-1",
      "--json"
    ]);

    expect(paged.exitCode).toBe(0);
    const payload = JSON.parse(paged.stdout);
    expect(payload).toMatchObject({
      total_count: 4,
      filtered_count: 4,
      count: 2,
      pagination: {
        limit: 2,
        offset: 1,
        returned_count: 2,
        has_more: true,
        next_offset: 3
      }
    });
    expect(payload.events.map((event: { id: string }) => event.id)).toEqual([
      "audit_event_policy_02",
      "audit_event_policy_03"
    ]);
    expect(invalidOffset.exitCode).toBe(1);
    expect(invalidOffset.stderr).toContain("--offset must be a non-negative integer.");
  });

  it("filters audit events by created-at time window", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_early",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "scan_started",
      target_type: "scan",
      target_id: "scan_early",
      metadata: {},
      created_at: "2026-05-10T00:00:01.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_middle",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "policy",
      target_id: "contract_abc:context_egress",
      metadata: {},
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_late",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:05.000Z"
    });
    storage.close();

    const filtered = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--since", "2026-05-10T00:00:02.000Z",
      "--until", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout)).toMatchObject({
      since: "2026-05-10T00:00:02.000Z",
      until: "2026-05-10T00:00:04.000Z",
      count: 1
    });
    expect(JSON.parse(filtered.stdout).events.map((event: { id: string }) => event.id)).toEqual([
      "audit_event_middle"
    ]);
  });

  it("rejects invalid audit time windows", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const invalidSince = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--since", "yesterday",
      "--json"
    ]);
    const reversedWindow = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--since", "2026-05-11T00:00:00.000Z",
      "--until", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);

    expect(invalidSince.exitCode).toBe(1);
    expect(invalidSince.stderr).toContain("--since must be an ISO timestamp");
    expect(reversedWindow.exitCode).toBe(1);
    expect(reversedWindow.stderr).toContain("--since must be before or equal to --until");
  });

  it("rejects blank audit actor filters", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--actor", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--actor must not be empty");
  });

  it("filters audit events by target type", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_policy",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "policy_changed",
      target_type: "policy",
      target_id: "contract_abc:context_egress",
      metadata: {},
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_finding",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:04.000Z"
    });
    storage.close();

    const filtered = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--target-type", "finding",
      "--json"
    ]);

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).target_type).toBe("finding");
    expect(JSON.parse(filtered.stdout).events.map((event: { target_type: string }) => event.target_type)).toEqual([
      "finding"
    ]);
  });

  it("filters audit events by target id", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.appendAuditEvent({
      id: "audit_event_finding_abc",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: {},
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_finding_other",
      repo_id: "repo_abc",
      actor: "geoff",
      action: "finding_resolved",
      target_type: "finding",
      target_id: "finding_other",
      metadata: {},
      created_at: "2026-05-10T00:00:04.000Z"
    });
    storage.close();

    const filtered = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--target-id", "finding_abc",
      "--json"
    ]);
    const blank = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--target-id", "   ",
      "--json"
    ]);

    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout).target_id).toBe("finding_abc");
    expect(JSON.parse(filtered.stdout).events.map((event: { target_id: string }) => event.target_id)).toEqual([
      "finding_abc"
    ]);
    expect(blank.exitCode).toBe(1);
    expect(blank.stderr).toContain("--target-id must not be empty");
  });

  it("rejects blank audit target-type filters", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--target-type", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--target-type must not be empty");
  });

  it("denies audit list when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy denied audit output");
  });

  it("refuses audit list for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_missing",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown repo repo_missing");
  });

  it("refuses local state databases with unsupported future migrations before command execution", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    markBackupWithFutureSchema(databasePath);

    const result = await runCli([
      "--db", databasePath,
      "audit", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unsupported Drift database migration");
  });

  it("does not apply missing local migrations before refusing unsupported database migrations", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    replaceBackupMigrationWithUnknown(databasePath);

    const result = await runCli([
      "--db", databasePath,
      "findings", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unsupported Drift database migration");
    expect(appliedMigrationIds(databasePath)).not.toContain("004_backup_manifests");
  });

  it("creates a single SQLite backup artifact and audits it", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.policy).toMatchObject({
      allowed: true,
      surface: "artifact"
    });
    expect(payload.governance).toMatchObject({
      read_only: false,
      agent_can_mutate: false
    });
    expect(payload.summary).toMatchObject({
      write_intent: true,
      artifact_exists: true,
      schema_version: 25
    });
    expect(payload.review_item).toMatchObject({
      id: payload.manifest.id,
      backup_path: payload.manifest.backup_path,
      checksum_sha256: payload.manifest.checksum_sha256,
      artifact_exists: true
    });
    expect(payload.manifest).toMatchObject({
      repo_id: "repo_abc",
      schema_version: 25,
      created_at: "2026-05-10T00:00:04.000Z"
    });
    expect(payload.manifest.backup_path).toContain(backupDir);
    expect(payload.manifest.checksum_sha256).toHaveLength(64);
    expect(payload.next_commands).toEqual([
      `drift backup verify ${payload.manifest.backup_path} --repo repo_abc --checksum ${payload.manifest.checksum_sha256} --json`,
      `drift --db <target.sqlite> restore ${payload.manifest.backup_path} --repo repo_abc --checksum ${payload.manifest.checksum_sha256} --dry-run --json`,
      "drift backup list --repo repo_abc --json"
    ]);
    await expect(stat(payload.manifest.backup_path)).resolves.toBeTruthy();

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "backup_created",
      actor: "geoff",
      target_type: "backup",
      metadata: { backup_path: payload.manifest.backup_path }
    });
    expect(storage.listBackupManifests("repo_abc")[0]).toMatchObject({
      id: payload.manifest.id,
      backup_path: payload.manifest.backup_path,
      checksum_sha256: payload.manifest.checksum_sha256
    });
    storage.close();
  });

  it("requires explicit confirmation before creating backup artifacts", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-confirm-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    const beforeBackupCount = storage.listBackupManifests("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Backup creation requires --confirm");
    await expect(readdir(dir)).resolves.toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listBackupManifests("repo_abc")).toHaveLength(beforeBackupCount);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects blank audit actors before creating backup artifacts", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-blank-actor-"));
    tempDirs.push(dir);

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--actor", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--actor must not be empty");
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses to overwrite an exact backup output without force", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-overwrite-"));
    tempDirs.push(dir);
    const backupPath = join(dir, "existing.drift-backup.sqlite");
    await writeFile(backupPath, "existing backup");

    const refused = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupPath,
      "--json"
    ]);
    const forced = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupPath,
      "--force",
      "--json"
    ]);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("Backup output already exists. Pass --force to overwrite it.");
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(forced.stdout).manifest.backup_path).toBe(backupPath);
  });

  it("refuses to back up over the source database path even with force", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", databasePath,
      "--force",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Backup output must be different from the source database path");
  });

  it("rejects backup output file paths without a sqlite extension", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-output-ext-"));
    tempDirs.push(dir);

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backup.json"),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Backup output file must end in .sqlite");
  });

  it("lists persisted backup manifests as JSON", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-list-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      repo_id: "repo_abc",
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      policy: {
        allowed: true,
        surface: "artifact"
      },
      count: 1,
      summary: {
        total_count: 1,
        filtered_count: 1,
        listed_count: 1,
        present_count: 1,
        missing_count: 0,
        checksum_mismatch_count: 0,
        latest_backup_id: manifest.id,
        latest_backup_path: manifest.backup_path,
        problem_count: 0
      },
      backups: [{
        id: manifest.id,
        backup_path: manifest.backup_path,
        artifact_exists: true,
        checksum_sha256: manifest.checksum_sha256
      }]
    });
    const payload = JSON.parse(listed.stdout);
    expect(payload.review_items[0]).toMatchObject({
      id: manifest.id,
      backup_path: manifest.backup_path,
      artifact_exists: true,
      checksum_matches: true
    });
    expect(payload.next_commands).toEqual([
      `drift backup verify ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --json`,
      `drift --db <target.sqlite> restore ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --dry-run --json`,
      "drift backup create --repo repo_abc --confirm --json"
    ]);
  });

  it("paginates backup list in deterministic created order", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    for (const backup of [
      ["backup_c", "2026-05-10T00:00:06.000Z"],
      ["backup_a", "2026-05-10T00:00:04.000Z"],
      ["backup_d", "2026-05-10T00:00:07.000Z"],
      ["backup_b", "2026-05-10T00:00:05.000Z"]
    ] as const) {
      storage.upsertBackupManifest({
        id: backup[0],
        repo_id: "repo_abc",
        repo_fingerprint: "repo-fp",
        schema_version: 25,
        source_database_path: databasePath,
        backup_path: `/tmp/${backup[0]}.sqlite`,
        checksum_sha256: "a".repeat(64),
        size_bytes: 10,
        created_at: backup[1]
      });
    }
    storage.close();

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    const payload = JSON.parse(listed.stdout);
    expect(payload).toMatchObject({
      total_count: 4,
      filtered_count: 4,
      count: 2,
      pagination: {
        limit: 2,
        offset: 1,
        returned_count: 2,
        has_more: true,
        next_offset: 3
      }
    });
    expect(payload.backups.map((backup: { id: string }) => backup.id)).toEqual(["backup_b", "backup_c"]);
  });

  it("filters backup list by artifact health", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-filter-"));
    tempDirs.push(dir);
    const validPath = join(dir, "valid.sqlite");
    const mismatchPath = join(dir, "mismatch.sqlite");
    await writeFile(validPath, "valid backup");
    await writeFile(mismatchPath, "tampered backup");
    const validChecksum = createHash("sha256").update("valid backup").digest("hex");
    const mismatchChecksum = createHash("sha256").update("original backup").digest("hex");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertBackupManifest({
      id: "backup_valid",
      repo_id: "repo_abc",
      repo_fingerprint: "repo-fp",
      schema_version: 25,
      source_database_path: databasePath,
      backup_path: validPath,
      checksum_sha256: validChecksum,
      size_bytes: 12,
      created_at: "2026-05-10T00:00:04.000Z"
    });
    storage.upsertBackupManifest({
      id: "backup_missing",
      repo_id: "repo_abc",
      repo_fingerprint: "repo-fp",
      schema_version: 25,
      source_database_path: databasePath,
      backup_path: join(dir, "missing.sqlite"),
      checksum_sha256: "b".repeat(64),
      size_bytes: 20,
      created_at: "2026-05-10T00:00:05.000Z"
    });
    storage.upsertBackupManifest({
      id: "backup_mismatch",
      repo_id: "repo_abc",
      repo_fingerprint: "repo-fp",
      schema_version: 25,
      source_database_path: databasePath,
      backup_path: mismatchPath,
      checksum_sha256: mismatchChecksum,
      size_bytes: 14,
      created_at: "2026-05-10T00:00:06.000Z"
    });
    storage.close();

    const missing = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--artifact-status", "missing",
      "--json"
    ]);
    const mismatch = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--artifact-status", "checksum_mismatch",
      "--json"
    ]);
    const invalid = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--artifact-status", "unknown",
      "--json"
    ]);

    expect(missing.exitCode).toBe(0);
    expect(JSON.parse(missing.stdout).backups.map((backup: { id: string }) => backup.id)).toEqual(["backup_missing"]);
    expect(mismatch.exitCode).toBe(0);
    expect(JSON.parse(mismatch.stdout).backups.map((backup: { id: string }) => backup.id)).toEqual(["backup_mismatch"]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("--artifact-status must be present, missing, or checksum_mismatch.");
  });

  it("prints backup artifact presence and size in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-list-text-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("Artifact: present");
    expect(listed.stdout).toContain(`Size: ${manifest.size_bytes} bytes`);
    expect(listed.stdout).toContain(
      `Verify: drift backup verify ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256}`
    );
  });

  it("prints backup create follow-up commands in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-create-text-"));
    tempDirs.push(dir);

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z"
    ]);

    expect(result.exitCode).toBe(0);
    const backupPath = result.stdout.match(/Path: (.+)/)?.[1];
    const checksum = result.stdout.match(/Checksum: ([a-f0-9]{64})/)?.[1];
    expect(backupPath).toBeTruthy();
    expect(checksum).toBeTruthy();
    expect(result.stdout).toContain(
      `Verify: drift backup verify ${backupPath} --repo repo_abc --checksum ${checksum}`
    );
    expect(result.stdout).toContain(
      `Restore dry-run: drift --db <target.sqlite> restore ${backupPath} --repo repo_abc --checksum ${checksum} --dry-run`
    );
  });

  it("reports missing backup artifacts in backup list", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-missing-artifact-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    await rm(manifest.backup_path);

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).backups[0]).toMatchObject({
      id: manifest.id,
      backup_path: manifest.backup_path,
      artifact_exists: false
    });
  });

  it("reports backup artifact checksum drift in backup list", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-checksum-drift-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    await writeFile(manifest.backup_path, "tampered backup");

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).backups[0]).toMatchObject({
      artifact_exists: true,
      checksum_matches: false,
      backup_path: manifest.backup_path
    });
  });

  it("denies backup artifact commands when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-policy-"));
    tempDirs.push(dir);

    const created = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(created.exitCode).toBe(1);
    expect(created.stderr).toContain("Policy denied backup output");
    expect(listed.exitCode).toBe(1);
    expect(listed.stderr).toContain("Policy denied backup output");
  });

  it("refuses backup list for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const listed = await runCli([
      "--db", databasePath,
      "backup", "list",
      "--repo", "repo_missing",
      "--json"
    ]);

    expect(listed.exitCode).toBe(1);
    expect(listed.stderr).toContain("Unknown repo repo_missing");
  });

  it("verifies a backup artifact before restore", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--checksum", manifest.checksum_sha256,
      "--json"
    ]);

    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      valid: true,
      repo_id: "repo_abc",
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      verification: {
        valid: true,
        schema_supported: true,
        checksum_matches: true,
        repo_found: true,
        audit_chain: {
          valid: true,
          broken_at_event_id: null,
          reasons: []
        }
      },
      audit_integrity: {
        valid: true,
        broken_at_event_id: null,
        reasons: []
      },
      repo_fingerprint: "repo-fp",
      policy: {
        allowed: true,
        surface: "artifact"
      },
      checksum_matches: true,
      schema_version: 25
    });
    expect(JSON.parse(verified.stdout).summary).toMatchObject({
      valid: true,
      repo_found: true,
      schema_supported: true,
      checksum_checked: true,
      checksum_matches: true,
      audit_chain_valid: true,
      size_bytes: manifest.size_bytes,
      problem_count: 0
    });
    expect(JSON.parse(verified.stdout).size_bytes).toBeGreaterThan(0);
    expect(JSON.parse(verified.stdout).restore_dry_run_command).toBe(
      `drift --db <target.sqlite> restore ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --dry-run`
    );
    expect(JSON.parse(verified.stdout).next_commands).toEqual([
      `drift --db <target.sqlite> restore ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --dry-run --json`
    ]);
  });

  it("prints backup verify artifact size in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-text-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--checksum", manifest.checksum_sha256
    ]);

    expect(verified.exitCode).toBe(0);
    expect(verified.stdout).toContain("Schema supported: true");
    expect(verified.stdout).toContain("Problems: 0");
    expect(verified.stdout).toContain(`Size: ${manifest.size_bytes} bytes`);
    expect(verified.stdout).toContain(
      `Restore dry-run: drift --db <target.sqlite> restore ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --dry-run`
    );
  });

  it("fails backup verify when the backup audit chain is tampered", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-audit-chain-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    tamperFirstAuditEvent(manifest.backup_path);

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--json"
    ]);
    const payload = JSON.parse(verified.stdout);

    expect(verified.exitCode).toBe(1);
    expect(payload.valid).toBe(false);
    expect(payload.verification.audit_chain).toMatchObject({
      valid: false,
      broken_at_event_id: expect.stringMatching(/^audit_event_/),
      reasons: ["event_hash_mismatch"]
    });
    expect(payload.audit_integrity.valid).toBe(false);
  });

  it("refuses backup verify and restore when the expected repo fingerprint mismatches", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-fingerprint-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--expect-repo-fingerprint", "wrong-fingerprint",
      "--json"
    ]);
    const restored = await runCli([
      "--db", join(dir, "restored.sqlite"),
      "restore", manifest.backup_path,
      "--repo", "repo_abc",
      "--expect-repo-fingerprint", "wrong-fingerprint",
      "--dry-run",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(verified.stderr).toContain("Backup repo fingerprint mismatch");
    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup repo fingerprint mismatch");
    await expect(stat(join(dir, "restored.sqlite"))).rejects.toThrow();
  });

  it("fails backup verify for unsupported future schemas", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-future-schema-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    markBackupWithFutureSchema(manifest.backup_path);

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      valid: false,
      repo_id: "repo_abc",
      schema_supported: false,
      schema_version: MIGRATIONS.length + 1
    });
  });

  it("fails backup verify for unknown migration ids even when the migration count is supported", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-unknown-schema-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    replaceBackupMigrationWithUnknown(manifest.backup_path);

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      valid: false,
      repo_id: "repo_abc",
      schema_supported: false,
      schema_version: 25,
      unsupported_migrations: ["004_unknown_future_schema"]
    });
  });

  it("fails backup verify when known migrations are not an exact prefix", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-migration-gap-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    deleteBackupMigration(manifest.backup_path, "003_repo_contracts_and_conventions");

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      valid: false,
      schema_supported: false,
      schema_version: MIGRATIONS.length - 1,
      missing_migrations: ["003_repo_contracts_and_conventions"]
    });
  });

  it("rejects invalid backup verify checksum formats", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--checksum", "not-a-checksum",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(verified.stderr).toContain("--checksum must be a 64-character hex SHA-256 checksum.");
  });

  it("requires a checksum for backup verify when requested", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-require-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--require-checksum",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(verified.stderr).toContain("Backup verify requires --checksum when --require-checksum is used");
  });

  it("rejects backup verify paths that are directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-dir-"));
    tempDirs.push(dir);

    const verified = await runCli([
      "backup", "verify",
      dir,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(verified.stderr).toContain("Backup path must be a file");
  });

  it("denies backup verify when backup policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-policy-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    const backupStorage = openDriftStorage({ databasePath: manifest.backup_path });
    backupStorage.migrate();
    const contract = backupStorage.getRepoContract("repo_abc")!;
    backupStorage.upsertRepoContract({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        default_mode: "approval_required"
      }
    });
    backupStorage.close();

    const verified = await runCli([
      "backup", "verify",
      manifest.backup_path,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(verified.exitCode).toBe(1);
    expect(verified.stderr).toContain("Policy denied backup verify output");
  });

  it("denies restore dry-runs and writes when backup policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-policy-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;
    const backupStorage = openDriftStorage({ databasePath: manifest.backup_path });
    backupStorage.migrate();
    const contract = backupStorage.getRepoContract("repo_abc")!;
    backupStorage.upsertRepoContract({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        default_mode: "approval_required"
      }
    });
    backupStorage.close();

    const dryRunTarget = join(dir, "dry-run.sqlite");
    const dryRun = await runCli([
      "--db", dryRunTarget,
      "restore", manifest.backup_path,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);
    const writeTarget = join(dir, "restored.sqlite");
    const write = await runCli([
      "--db", writeTarget,
      "restore", manifest.backup_path,
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(dryRun.exitCode).toBe(1);
    expect(dryRun.stderr).toContain("Policy denied restore output");
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toContain("Policy denied restore output");
    await expect(stat(dryRunTarget)).rejects.toThrow();
    await expect(stat(writeTarget)).rejects.toThrow();
  });

  it("restores a SQLite backup into a target database and audits the restore", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupManifest = JSON.parse(backup.stdout).manifest;
    const backupPath = backupManifest.backup_path;

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--checksum", backupManifest.checksum_sha256,
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:05.000Z",
      "--json"
    ]);

    expect(restored.exitCode).toBe(0);
    const payload = JSON.parse(restored.stdout);
    expect(payload.restore).toMatchObject({
      repo_id: "repo_abc",
      backup_path: backupPath,
      restored_database_path: targetDatabasePath,
      schema_version: 25
    });
    expect(payload.governance).toMatchObject({
      read_only: false,
      agent_can_mutate: false
    });
    expect(payload.restore_intent).toMatchObject({
      dry_run: false,
      write_intent: true,
      target_exists: false
    });
    expect(payload.summary).toMatchObject({
      restored: true,
      dry_run: false,
      write_intent: true,
      target_exists: false,
      would_require_force: false,
      checksum_checked: true,
      checksum_matches: true,
      graph_stale: true,
      requires_rescan: true,
      staleness_reason: "scan_missing"
    });
    expect(payload.next_commands).toEqual([
      `drift --db ${targetDatabasePath} scan status --repo repo_abc --json`,
      `drift --db ${targetDatabasePath} prepare "task" --repo repo_abc --json`
    ]);
    expect(payload.restore.checksum_sha256).toHaveLength(64);
    expect(payload.restore.checksum_matches).toBe(true);

    const restoredStorage = openDriftStorage({ databasePath: targetDatabasePath });
    restoredStorage.migrate();
    expect(restoredStorage.getRepo("repo_abc")?.fingerprint).toBe("repo-fp");
    expect(restoredStorage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "restore_completed",
      actor: "geoff",
      target_type: "restore",
      metadata: {
        backup_path: backupPath,
        checksum_sha256: payload.restore.checksum_sha256,
        checksum_matches: true,
        schema_version: 25,
        graph_stale: payload.restore.graph_stale,
        requires_rescan: payload.restore.requires_rescan,
        staleness_reason: payload.restore.staleness_reason
      }
    });
    restoredStorage.close();
  });

  it("requires explicit confirmation for non-dry-run restores", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-confirm-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    const restored = await runCli([
      "--db", join(dir, "restored.sqlite"),
      "restore", backupPath,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Restore requires --confirm unless --dry-run is used.");
    await expect(stat(join(dir, "restored.sqlite"))).rejects.toThrow();
  });

  it("rejects ambiguous restore dry-run and confirm flags before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-ambiguous-intent-"));
    tempDirs.push(dir);
    const targetPath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    const restored = await runCli([
      "--db", targetPath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--confirm",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Use either --dry-run or --confirm, not both.");
    await expect(stat(targetPath)).rejects.toThrow();
  });

  it("requires a checksum for restore when requested", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-require-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    const targetPath = join(dir, "restored.sqlite");

    const restored = await runCli([
      "--db", targetPath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--require-checksum",
      "--dry-run",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Restore requires --checksum when --require-checksum is used");
    await expect(stat(targetPath)).rejects.toThrow();
  });

  it("reports restored graph staleness against current source files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-stale-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    const routePath = join(repoRoot, "apps/web/app/api/users/route.ts");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      routePath,
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const scanned = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const scanPayload = JSON.parse(scanned.stdout);
    await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:10.500Z",
      "--json"
    ]);
    const backup = await runCli([
      "--db", scanPayload.database_path,
      "backup", "create",
      "--confirm",
      "--repo", scanPayload.repo.id,
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:11.000Z",
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    await writeFile(
      routePath,
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json({ changed: await prisma.user.count() });",
        "}",
        ""
      ].join("\n")
    );

    const restored = await runCli([
      "--db", join(dir, "restored.sqlite"),
      "restore", backupPath,
      "--repo", scanPayload.repo.id,
      "--confirm",
      "--now", "2026-05-10T00:00:12.000Z",
      "--json"
    ]);

    expect(restored.exitCode).toBe(0);
    expect(JSON.parse(restored.stdout).restore).toMatchObject({
      graph_stale: true,
      requires_rescan: true,
      next_command: `drift --db ${join(dir, "restored.sqlite")} scan --repo-root ${repoRoot} --json`,
      source_changes: {
        added: [],
        modified: ["apps/web/app/api/users/route.ts"],
        deleted: []
      }
    });
  }, 15000);

  it("validates restore dry-runs and refuses accidental overwrites", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-safe-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const dryRunTarget = join(dir, "dry-run.sqlite");
    const existingTarget = join(dir, "existing.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", backupDir,
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupManifest = JSON.parse(backup.stdout).manifest;
    const backupPath = backupManifest.backup_path;
    await writeFile(existingTarget, "already here");

    const dryRun = await runCli([
      "--db", dryRunTarget,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--now", "2026-05-10T00:00:05.000Z",
      "--json"
    ]);
    const existingTargetDryRun = await runCli([
      "--db", existingTarget,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--now", "2026-05-10T00:00:05.500Z",
      "--json"
    ]);
    const refused = await runCli([
      "--db", existingTarget,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--now", "2026-05-10T00:00:06.000Z",
      "--json"
    ]);
    const forced = await runCli([
      "--db", existingTarget,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--force",
      "--now", "2026-05-10T00:00:07.000Z",
      "--json"
    ]);

    expect(dryRun.exitCode).toBe(0);
    const dryRunPayload = JSON.parse(dryRun.stdout);
    expect(dryRunPayload).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      restore_intent: {
        dry_run: true,
        write_intent: false,
        target_exists: false,
        would_require_force: false
      },
      summary: {
        restored: false,
        dry_run: true,
        write_intent: false,
        target_exists: false,
        would_require_force: false,
        checksum_checked: false,
        checksum_matches: null,
        graph_stale: true,
        requires_rescan: true,
        staleness_reason: "scan_missing"
      },
      next_commands: [
        `drift --db ${dryRunTarget} restore ${backupPath} --repo repo_abc --checksum ${backupManifest.checksum_sha256} --confirm`
      ]
    });
    expect(dryRunPayload.restore).toMatchObject({
      repo_id: "repo_abc",
      dry_run: true,
      write_intent: false,
      confirm_command: `drift --db ${dryRunTarget} restore ${backupPath} --repo repo_abc --checksum ${backupManifest.checksum_sha256} --confirm`,
      restored_at: null,
      target_exists: false,
      would_require_force: false
    });
    const existingDryRunPayload = JSON.parse(existingTargetDryRun.stdout);
    expect(existingDryRunPayload).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      restore_intent: {
        dry_run: true,
        write_intent: false,
        target_exists: true,
        would_require_force: true
      },
      summary: {
        restored: false,
        dry_run: true,
        write_intent: false,
        target_exists: true,
        would_require_force: true,
        checksum_checked: false,
        checksum_matches: null
      },
      next_commands: [
        `drift --db ${existingTarget} restore ${backupPath} --repo repo_abc --checksum ${backupManifest.checksum_sha256} --confirm --force`
      ]
    });
    expect(existingDryRunPayload.restore).toMatchObject({
      repo_id: "repo_abc",
      dry_run: true,
      write_intent: false,
      confirm_command: `drift --db ${existingTarget} restore ${backupPath} --repo repo_abc --checksum ${backupManifest.checksum_sha256} --confirm --force`,
      restored_at: null,
      target_exists: true,
      would_require_force: true
    });
    await expect(stat(dryRunTarget)).rejects.toThrow();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("Target database already exists");
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(forced.stdout).restore.dry_run).toBe(false);
    expect(JSON.parse(forced.stdout).restore.write_intent).toBe(true);
  });

  it("prints restore dry-run confirmation guidance in human output", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-dry-run-text-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const manifest = JSON.parse(backup.stdout).manifest;

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", manifest.backup_path,
      "--repo", "repo_abc",
      "--checksum", manifest.checksum_sha256,
      "--dry-run",
      "--now", "2026-05-10T00:00:05.000Z"
    ]);

    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("Drift restore validated");
    expect(restored.stdout).toContain("Write intent: false");
    expect(restored.stdout).toContain("Restored: false");
    expect(restored.stdout).toContain("Checksum checked: true");
    expect(restored.stdout).toContain("Confirm restore:");
    expect(restored.stdout).toContain(
      `drift --db ${targetDatabasePath} restore ${manifest.backup_path} --repo repo_abc --checksum ${manifest.checksum_sha256} --confirm`
    );
  });

  it("refuses restore when an expected checksum does not match", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    const restored = await runCli([
      "--db", join(dir, "restored.sqlite"),
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--checksum", "0".repeat(64),
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup checksum mismatch");
    await expect(stat(join(dir, "restored.sqlite"))).rejects.toThrow();
  });

  it("refuses restore when the backup audit chain is tampered", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-audit-chain-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    tamperFirstAuditEvent(backupPath);
    const targetDatabasePath = join(dir, "restored.sqlite");

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup audit chain is invalid");
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("refuses restore from unsupported future schemas before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-future-schema-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    markBackupWithFutureSchema(backupPath);

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain(`Backup schema version ${MIGRATIONS.length + 1} is not supported`);
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("refuses restore from backups with unknown migration ids before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-unknown-schema-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    replaceBackupMigrationWithUnknown(backupPath);

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup schema migration is not supported");
    expect(restored.stderr).toContain("004_unknown_future_schema");
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("refuses restore from backups with non-prefix migration history before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-migration-gap-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    deleteBackupMigration(backupPath, "003_repo_contracts_and_conventions");

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup schema migration history is incomplete");
    expect(restored.stderr).toContain("003_repo_contracts_and_conventions");
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("rejects invalid restore checksum formats before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-checksum-format-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--checksum", "not-a-checksum",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("--checksum must be a 64-character hex SHA-256 checksum.");
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("rejects restore backup paths that are directories before writing the target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-backup-dir-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");

    const restored = await runCli([
      "--db", targetDatabasePath,
      "restore", dir,
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Backup path must be a file");
    await expect(stat(targetDatabasePath)).rejects.toThrow();
  });

  it("rejects restore targets that are directories even with force", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-target-dir-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output-dir", dir,
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    const targetDir = join(dir, "restored.sqlite");
    await mkdir(targetDir);

    const restored = await runCli([
      "--db", targetDir,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--confirm",
      "--force",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Restore target must be a file path");
  });

  it("rejects restore target file paths without a sqlite extension", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-target-ext-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
      "--confirm",
      "--repo", "repo_abc",
      "--output", join(dir, "backups"),
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
    const targetPath = join(dir, "restored.db");

    const restored = await runCli([
      "--db", targetPath,
      "restore", backupPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(restored.exitCode).toBe(1);
    expect(restored.stderr).toContain("Restore target must end in .sqlite");
  });

  it("prepares a compact read-only agent packet from the accepted contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-prepare-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "apps/web/services"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), "{\"name\":\"fixture\"}\n");
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "apps/web/services/users.ts"),
      "export async function listUsers() { return []; }\n"
    );

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z"
    ]);
    const databasePath = started.stdout
      .split("\n")
      .find((line) => line.trim().startsWith("export DRIFT_DB="))
      ?.split("=", 2)[1];
    const repoId = started.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
    const storage = openDriftStorage({ databasePath: databasePath! });
    storage.migrate();
    const contract = storage.getRepoContract(repoId!)!;
    storage.upsertRepoContract({
      ...contract,
      risky_areas: [{
        id: "risk_user_api",
        path_globs: ["apps/web/app/api/users/**"],
        risk_kind: "data_access",
        reason: "User API routes touch persisted user data."
      }]
    });
    storage.close();
    await mkdir(join(repoRoot, "apps/web/app/api/search"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/search/route.ts"),
      "export async function GET() { return Response.json([]); }\n"
    );

    const result = await runCli([
      "--db", databasePath!,
      "prepare",
      "add user search endpoint",
      "--repo", repoId!,
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.task).toBe("add user search endpoint");
    expect(payload.policy.surface).toBe("cli-preflight");
    expect(payload.policy.allowed).toBe(true);
    expect(payload.summary).toMatchObject({
      convention_count: 1,
      relevant_file_count: 3,
      risky_area_count: 1,
      finding_count: 1,
      blocking_finding_count: 0,
      required_check_count: 1,
      safe_command_count: 0,
      baseline_active_count: 1,
      scan_stale: true
    });
    expect(payload.governance).toMatchObject({
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
    });
    expect(payload.conventions[0]).toMatchObject({
      kind: "api_route_no_direct_data_access",
      enforcement_mode: "warn",
      enforcement_capability: "deterministic_check"
    });
    expect(payload.agent_contract_packet).toMatchObject({
      schema_version: "drift.agent.preflight.v3",
      repo_id: repoId,
      stale: true,
      selected_contracts: [],
      selected_conventions: [{ kind: "api_route_no_direct_data_access" }],
      required_checks: []
    });
    expect(payload.scan_status.stale).toBe(true);
    expect(payload.scan_status.scan_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.audit_integrity.valid).toBe(true);
    expect(payload.audit_integrity.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.scan_status.audit_integrity.head_event_hash).toBe(payload.audit_integrity.head_event_hash);
    expect(payload.scan_status.indexed_file_count).toBeGreaterThan(0);
    expect(payload.scan_status.source_change_count).toBeGreaterThan(0);
    expect(payload.scan_status.changes.added).toContain("apps/web/app/api/search/route.ts");
    expect(payload.task_model).toMatchObject({
      schema_version: "drift.agent_task.v1",
      task_intent: "feature",
      target_area: "user_management",
      likely_entrypoint_kinds: ["api_route"],
      human_approval_needed: false
    });
    expect(payload.task_preflight_packet).toMatchObject({
      schema_version: "drift.agent_preflight.v2",
      repo_id: repoId,
      task_model: {
        task_intent: "feature",
        target_area: "user_management"
      },
      context_policy: {
        egress_level: "symbol_only",
        can_modify_contract: false
      },
      legacy_packet: {
        schema_version: "drift.agent.preflight.v3"
      }
    });
    expect(payload.change_impact).toMatchObject({
      schema_version: "drift.change_impact.v1",
      repo_id: repoId
    });
    expect(payload.test_intelligence).toEqual([]);
    expect(payload.scan_status.next_command).toBe(`drift scan --repo-root ${repoRoot} --json`);
    expect(payload.baseline.active_count).toBe(1);
    expect(payload.relevant_files.map((file: { path: string }) => file.path)).toContain(
      "apps/web/app/api/users/route.ts"
    );
    expect(payload.risky_areas).toEqual([{
      id: "risk_user_api",
      path_globs: ["apps/web/app/api/users/**"],
      risk_kind: "data_access",
      reason: "User API routes touch persisted user data.",
      matched_files: ["apps/web/app/api/users/route.ts"]
    }]);
    expect(payload.next_commands).toContain(`drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`);
    expect(result.stdout).not.toContain("prisma.user.findMany");
  });

  it("scopes prepare required checks and risky areas to task-relevant files", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "docs/auth.md"), "Auth notes.\n");
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

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "change users api route",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);
    expect(payload.summary).toMatchObject({
      required_check_count: 1,
      risky_area_count: 1
    });
    expect(payload.required_checks).toEqual([
      expect.objectContaining({
        command: "drift check --diff main...HEAD",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
    expect(payload.required_checks.map((check: { command: string }) => check.command)).not.toContain("pnpm lint docs");
    expect(payload.risky_areas).toEqual([
      expect.objectContaining({
        id: "risk_user_api",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
  });

  it("prepares context for an explicitly targeted repo-relative path", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [{
        command: "drift check --diff main...HEAD",
        applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
        reason: "Validate accepted API route conventions."
      }],
      risky_areas: [{
        id: "risk_user_api",
        path_globs: ["apps/web/app/api/users/**"],
        risk_kind: "data_access",
        reason: "User API routes touch persisted user data."
      }]
    });
    storage.close();

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "change endpoint",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const unsafe = await runCli([
      "--db", databasePath,
      "prepare",
      "change endpoint",
      "--repo", "repo_abc",
      "--path", "../secret.ts",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);
    expect(payload.target_path).toBe("apps/web/app/api/users/route.ts");
    expect(payload.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        roles: ["api_route"],
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);
    expect(payload.required_checks).toEqual([
      expect.objectContaining({
        command: "drift check --diff main...HEAD",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
    expect(payload.risky_areas).toEqual([
      expect.objectContaining({
        id: "risk_user_api",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
    expect(unsafe.exitCode).toBe(1);
    expect(unsafe.stderr).toContain("--path must be repo-relative.");
  });

  it("fails prepare when fresh scan context is required but the graph is stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "change endpoint",
      "--repo", "repo_abc",
      "--require-fresh",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(1);
    expect(prepared.stderr).toContain("Scan is stale for repo_abc.");
    expect(prepared.stderr).toContain("drift scan --repo-root");
    expect(prepared.stderr).toContain("omit --require-fresh");
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      error: { type: "refusal", code: "stale_scan" },
      failure: {
        code: "stale_scan",
        surface: "cli",
        safe_to_retry: true,
        recovery_commands: expect.arrayContaining([expect.stringContaining("drift scan --repo-root")])
      },
      agent_envelope: {
        schema_version: "agent.envelope.v2",
        action: "blocked_by_stale_graph",
        read_only: true
      }
    });
  });

  it("uses canonical operational failure codes and recovery envelopes", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract",
      "show",
      "--repo", "repo_abc",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(payload.error).toMatchObject({
      type: "refusal",
      code: "missing_contract"
    });
    expect(payload.failure).toMatchObject({
      code: "missing_contract",
      surface: "cli",
      severity: "error",
      safe_to_retry: true,
      user_action: expect.stringContaining("Accept or import"),
      recovery_commands: expect.arrayContaining([
        "drift conventions list --status candidate --json"
      ])
    });
  });

  it("prints a manifest-only support bundle without leaking source or database contents", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "support",
      "bundle",
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      response_schema: "drift.support.bundle.v1",
      repo_id: "repo_abc",
      mode: "dry_run",
      contents: {
        includes_source_text: false,
        includes_sqlite_database: false,
        includes_backup_files: false,
        includes_environment: false,
        includes_contract_json: false,
        includes_finding_evidence: false
      },
      redaction_policy: {
        schema_version: "drift.support.redaction.v1",
        included_metadata: expect.arrayContaining(["runtime_versions", "audit_integrity"]),
        excluded_data_classes: expect.arrayContaining([
          "source_text",
          "sqlite_database",
          "contract_json",
          "finding_evidence_refs",
          "graph_evidence"
        ])
      },
      manifest: {
        runtime: expect.any(Object),
        engine: expect.any(Object),
        migrations: expect.any(Object),
        audit: expect.any(Object),
        elections: {
          candidate_count: 0,
          accepted_count: 0,
          rejected_count: 0,
          rejected_inference_count: 0
        }
      }
    });
    expect(JSON.stringify(payload)).not.toContain("Route imports prisma directly");
  });

  it("scopes prepare contract waivers to task-relevant files", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "docs/auth.md"), "Auth notes.\n");
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
          id: "waiver_docs",
          reason: "Docs waiver should not apply to API route work.",
          path_globs: ["docs/**"],
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

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "change users api route",
      "--repo", "repo_abc",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);
    expect(payload.summary.waiver_count).toBe(1);
    expect(payload.waivers).toEqual([
      expect.objectContaining({
        id: "waiver_user_api",
        status: "active",
        matched_files: ["apps/web/app/api/users/route.ts"]
      })
    ]);
  });

  it("answers repo questions with deterministic local contract context", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "ask",
      "what should I know before changing users api routes?",
      "--repo", "repo_abc",
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo_id: "repo_abc",
      topic: "what should I know before changing users api routes?",
      answer: {
        source: "deterministic_local_state",
        summary: "Matched 1 accepted convention, 1 open finding, and 1 relevant file."
      },
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
      policy: { allowed: true, surface: "cli-preflight" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        matched_convention_count: 1,
        open_finding_count: 1,
        relevant_file_count: 1,
        scan_stale: true
      },
      conventions: [{
        id: "convention_no_direct_db",
        kind: "api_route_no_direct_data_access"
      }],
      findings: [{
        id: expect.stringMatching(/^finding_[a-f0-9]+$/),
        status: "new"
      }],
      relevant_files: [{
        path: "apps/web/app/api/users/route.ts"
      }],
      redactions: {
        snippets_included: false
      },
      next_commands: [
        "drift prepare \"what should I know before changing users api routes?\" --repo repo_abc --json",
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json"
      ]
    });
    expect(result.stdout).not.toContain("prisma.user.findMany");
  });

  it("answers repo questions for an explicitly targeted path", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--scope", "full",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "ask",
      "what applies here?",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.target_path).toBe("apps/web/app/api/users/route.ts");
    expect(payload.summary).toMatchObject({
      matched_convention_count: 1,
      open_finding_count: 1,
      relevant_file_count: 1
    });
    expect(payload.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);
    expect(payload.next_commands[0]).toBe(
      "drift prepare \"what applies here?\" --repo repo_abc --path apps/web/app/api/users/route.ts --json"
    );
  });

  it("prepares a first-run packet before a contract exists without inventing conventions", async () => {
    const { databasePath, repoId } = await seedScannedNoContractState("drift-prepare-no-contract-");

    const result = await runCli([
      "--db", databasePath,
      "prepare",
      "add users api route",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.contract).toMatchObject({
      ready: false,
      id: null,
      source: "default_local_policy"
    });
    expect(payload.summary).toMatchObject({
      contract_ready: false,
      candidate_count: 2,
      convention_count: 0,
      relevant_file_count: 1
    });
    expect(payload.conventions).toEqual([]);
    expect(payload.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);
    expect(payload.next_commands).toEqual([
      `drift conventions list --repo ${repoId} --status candidate --json`,
      `drift repo map --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]);
  });

  it("includes graph-backed route flow and reachable data access in prepare", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-prepare-graph-context-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "src/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/services"), { recursive: true });
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"]
          }
        }
      })
    );
    await writeFile(
      join(repoRoot, "src/db.ts"),
      [
        "export const db = {",
        "  user: { findMany: async () => [] }",
        "};",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "src/services/users.ts"),
      [
        "import { db } from \"@/db\";",
        "export async function listUsers() {",
        "  return db.user.findMany();",
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "src/app/api/users/route.ts"),
      [
        "import { listUsers } from \"@/services/users\";",
        "export async function GET() {",
        "  return Response.json(await listUsers());",
        "}",
        ""
      ].join("\n")
    );

    const scanned = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:40.000Z",
      "--json"
    ]);
    expect(scanned.exitCode).toBe(0);
    const scanPayload = JSON.parse(scanned.stdout);

    const prepared = await runCli([
      "--db", scanPayload.database_path,
      "prepare",
      "change users api route",
      "--repo", scanPayload.repo.id,
      "--path", "src/app/api/users/route.ts",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);
    expect(payload.graph_context).toMatchObject({
      available: true,
      scan_id: scanPayload.scan.id,
      completeness: {
        complete: true,
        reasons: []
      },
      diagnostic_summary: {
        total_count: 0,
        groups: [],
        completeness_reasons: []
      },
      route_flows: [{
        path: "src/app/api/users/route.ts",
        route_module_id: "module:src/app/api/users/route.ts",
        service_module_ids: ["module:src/services/users.ts"],
        data_access_module_ids: ["module:src/db.ts"]
      }],
      reachable_data_access: [{
        path: "src/app/api/users/route.ts",
        data_access_module_ids: ["module:src/db.ts"],
        data_operations: [expect.objectContaining({
          file_path: "src/services/users.ts",
          operation_kind: "read",
          operation_name: "findMany",
          store_name: "user",
          receiver_name: "db.user"
        })]
      }]
    });
    expect(payload.redactions).toMatchObject({
      snippets_included: false,
      source_content_included: false,
      graph_context_included: true,
      context_truncated: false
    });
    expect(payload.graph_context.affected_files[0]).toMatchObject({
      path: "src/app/api/users/route.ts",
      files: ["src/app/api/users/route.ts"]
    });
  });

  it("derives required checks from graph-backed write route risk in prepare", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-prepare-graph-risk-check-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "src/app/api/users"), { recursive: true });
    await mkdir(join(repoRoot, "src/services"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({
      scripts: {
        test: "vitest run"
      }
    }));
    await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"]
          }
        }
      })
    );
    await writeFile(
      join(repoRoot, "src/db.ts"),
      [
        "export const db = {",
        "  user: { create: async (_input: unknown) => ({ id: 1 }) }",
        "};",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "src/services/users.ts"),
      [
        "import { db } from \"@/db\";",
        "export async function createUser() {",
        "  return db.user.create({ data: {} });",
        "}",
        ""
      ].join("\n")
    );
    await writeFile(
      join(repoRoot, "src/app/api/users/route.ts"),
      [
        "import { createUser } from \"@/services/users\";",
        "export async function POST() {",
        "  return Response.json(await createUser());",
        "}",
        ""
      ].join("\n")
    );

    const scanned = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:40.000Z",
      "--json"
    ]);
    expect(scanned.exitCode).toBe(0);
    const scanPayload = JSON.parse(scanned.stdout);

    const prepared = await runCli([
      "--db", scanPayload.database_path,
      "prepare",
      "change user creation route",
      "--repo", scanPayload.repo.id,
      "--path", "src/app/api/users/route.ts",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);
    expect(payload.required_checks).toEqual([
      expect.objectContaining({
        command: "pnpm test",
        source: "graph_risk",
        matched_files: ["src/app/api/users/route.ts"],
        risk_kinds: ["data_write"],
        evidence_node_ids: expect.arrayContaining([
          expect.stringContaining("data_operation:src/services/users.ts")
        ])
      })
    ]);
  });

  it("answers first-run questions before a contract exists without treating candidates as accepted", async () => {
    const { databasePath, repoId } = await seedScannedNoContractState("drift-ask-no-contract-");

    const result = await runCli([
      "--db", databasePath,
      "ask",
      "what applies to users api routes?",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.contract).toMatchObject({
      ready: false,
      id: null,
      source: "default_local_policy"
    });
    expect(payload.summary).toMatchObject({
      contract_ready: false,
      candidate_count: 2,
      matched_convention_count: 0,
      relevant_file_count: 1
    });
    expect(payload.conventions).toEqual([]);
    expect(payload.answer.summary).toContain("0 accepted conventions");
    expect(payload.next_commands[0]).toBe(
      `drift conventions list --repo ${repoId} --status candidate --json`
    );
  });

  it("fails ask when fresh scan context is required but the graph is stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const asked = await runCli([
      "--db", databasePath,
      "ask",
      "what applies here?",
      "--repo", "repo_abc",
      "--require-fresh",
      "--json"
    ]);

    expect(asked.exitCode).toBe(1);
    expect(asked.stderr).toContain("Scan is stale for repo_abc.");
    expect(asked.stderr).toContain("drift scan --repo-root");
    expect(asked.stderr).toContain("omit --require-fresh");
  });

  it("prints deterministic ask output in a readable local answer", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "ask",
      "users api",
      "--repo", "repo_abc"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Drift answer");
    expect(result.stdout).toContain("Source: deterministic_local_state");
    expect(result.stdout).toContain("Matched 1 accepted convention");
    expect(result.stdout).toContain("apps/web/app/api/users/route.ts");
  });

  it("maps the latest indexed repo facts without exposing source snippets", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-");

    const result = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      repo_id: repoId,
      policy: { allowed: true, surface: "cli-preflight" },
      readiness: {
        schema_version: "drift.readiness.v1",
        surface: "repo_map",
        repo_id: repoId
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        indexed_file_count: 1,
        listed_file_count: 1,
        role_counts: {
          api_route: 1
        },
        import_count: 1,
        export_count: 1,
        call_count: 2
      },
      files: [{
        path: "apps/web/app/api/users/route.ts",
        roles: ["api_route"],
        imports: ["@/lib/prisma"],
        exported_symbols: ["GET"],
        calls: expect.arrayContaining(["findMany", "json"]),
        convention_ids: [expect.stringMatching(/^convention_[a-f0-9]+$/)],
        risky_area_ids: ["risk_data_access_api_routes"],
        open_finding_ids: expect.arrayContaining([expect.stringMatching(/^finding_[a-f0-9]+$/)])
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
            entrypoints: expect.arrayContaining(["GET /api/users"]),
            modules: expect.arrayContaining(["apps/web/app/api/users/route.ts"])
          })
        ]),
        unknown_zones: []
      },
      freshness_requirement: {
        required: false,
        satisfied: true
      },
      redactions: {
        snippets_included: false
      }
    });
    expect(result.stdout).not.toContain("return Response.json");
  });

  it("paginates repo map output in deterministic path order", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-page-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .filter((scan) => storage
        .listFileSnapshots(repoId, scan.id)
        .some((snapshot) => snapshot.file_path === "apps/web/app/api/users/route.ts"))[0]!.id;
    storage.upsertFileSnapshot({
      repo_id: repoId,
      scan_id: scanId,
      file_path: "apps/web/app/api/admin/route.ts",
      content_hash: "c".repeat(64),
      byte_size: 42,
      indexed: true
    });
    storage.upsertFileSnapshot({
      repo_id: repoId,
      scan_id: scanId,
      file_path: "packages/core/src/service.ts",
      content_hash: "d".repeat(64),
      byte_size: 40,
      indexed: true
    });
    storage.upsertFacts([
      {
        id: "fact_role_admin_route",
        repo_id: repoId,
        scan_id: scanId,
        kind: "file_role_detected",
        file_path: "apps/web/app/api/admin/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1,
        ...factQuality(scanId)
      },
      {
        id: "fact_role_core_service",
        repo_id: repoId,
        scan_id: scanId,
        kind: "file_role_detected",
        file_path: "packages/core/src/service.ts",
        name: "service_module",
        start_line: 1,
        end_line: 1,
        ...factQuality(scanId)
      }
    ]);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
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
    expect(payload.files.map((file: { path: string }) => file.path)).toEqual([
      "apps/web/app/api/users/route.ts",
      "packages/core/src/service.ts"
    ]);
  });

  it("filters repo map output by role and repo-relative path", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-filter-");

    const mapped = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--role", "api_route",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const unsafe = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--path", "../secret.ts",
      "--json"
    ]);

    expect(mapped.exitCode).toBe(0);
    expect(JSON.parse(mapped.stdout)).toMatchObject({
      filters: {
        role: "api_route",
        path: "apps/web/app/api/users/route.ts"
      },
      summary: {
        listed_file_count: 1
      }
    });
    expect(unsafe.exitCode).toBe(1);
    expect(unsafe.stderr).toContain("--path must be repo-relative.");
  });

  it("fails repo map when fresh scan context is required but the graph is stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const mapped = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", "repo_abc",
      "--require-fresh",
      "--json"
    ]);

    expect(mapped.exitCode).toBe(1);
    expect(mapped.stderr).toContain("Scan is stale for repo_abc.");
    expect(mapped.stderr).toContain("drift scan --repo-root");
    expect(mapped.stderr).toContain("omit --require-fresh");
  });

  it("scan status reports middleware_coverage capability", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-scan-status-middleware-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: repoId,
      scan_id: scanId,
      engine_source: "rust",
      engine_version: "0.1.0",
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "middleware_coverage"],
      required_capabilities: ["file_discovery", "syntax_facts", "middleware_coverage"],
      missing_capabilities: [],
      completeness: [{
        scope: "route-flow",
        rule_id: "middleware_must_cover_routes",
        complete: true,
        can_block: true,
        reasons: []
      }],
      parser_gap_count: 0,
      parser_gap_kinds: {},
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-05-25T00:00:00.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.security_capabilities).toEqual([]);
    expect(payload.capability_report.certified_capabilities).toContain("middleware_coverage");
  });

  it("scan status reports request_validation capability", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-scan-status-validation-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: repoId,
      scan_id: scanId,
      engine_source: "rust",
      engine_version: "0.1.0",
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "request_validation_facts"],
      required_capabilities: ["file_discovery", "syntax_facts", "request_validation_facts"],
      missing_capabilities: [],
      completeness: [{
        scope: "route-flow",
        rule_id: "api_route_requires_request_validation",
        complete: true,
        can_block: true,
        reasons: []
      }],
      parser_gap_count: 0,
      parser_gap_kinds: {},
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-05-25T00:00:00.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.security_capabilities).toEqual([]);
    expect(payload.capability_report.certified_capabilities).toContain("request_validation_facts");
  });

  it("scan status reports tenant authorization and session trust capabilities", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-scan-status-phase4-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: repoId,
      scan_id: scanId,
      engine_source: "rust",
      engine_version: "0.1.0",
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "session_trust", "authorization", "tenant_scope"],
      required_capabilities: ["file_discovery", "syntax_facts", "session_trust", "authorization", "tenant_scope"],
      missing_capabilities: [],
      completeness: [{
        scope: "route-flow",
        rule_id: "session_object_must_come_from_trusted_helper",
        complete: true,
        can_block: true,
        reasons: []
      }, {
        scope: "route-flow",
        rule_id: "api_route_requires_authorization",
        complete: true,
        can_block: true,
        reasons: []
      }, {
        scope: "route-flow",
        rule_id: "api_route_requires_tenant_scope",
        complete: false,
        can_block: true,
        reasons: ["unsupported_tenant_dynamic_property"]
      }],
      parser_gap_count: 1,
      parser_gap_kinds: { unsupported_tenant_dynamic_property: 1 },
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-05-26T00:00:00.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.security_capabilities).toEqual([]);
    expect(payload.capability_report.certified_capabilities).toEqual(expect.arrayContaining([
      "session_trust",
      "authorization",
      "tenant_scope"
    ]));
  });

  it("scan status reports Phase 8 security capability array from proof runs", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-scan-status-phase8-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertCheckRun({
      id: "check_phase8",
      repo_id: repoId,
      repo_contract_id: "contract_phase8",
      contract_fingerprint: "contract-fp",
      scan_id: scanId,
      status: "pass",
      scope: "full",
      engine_source: "rust",
      fallback_used: false,
      stale_scan: false,
      capability_complete: true,
      findings_count: 0,
      blocking_count: 0,
      started_at: "2026-05-27T00:00:01.000Z",
      completed_at: "2026-05-27T00:00:02.000Z"
    });
    storage.upsertSecurityBoundaryProofRuns({
      repo_id: repoId,
      scan_id: "scan_check_phase8",
      check_id: "check_phase8",
      created_at: "2026-05-27T00:00:02.000Z",
      proofs: [phase8SecurityProof()]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "scan", "status",
      "--repo", repoId,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(Array.isArray(payload.security_capabilities)).toBe(true);
    expect(payload.security_capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "control_flow_guard_dominance",
        capability: "deterministic_check",
        status: "complete",
        can_block: true,
        parser_gap_count: 0,
        missing_proof_count: 0,
        affected_files: ["apps/web/app/api/users/route.ts"]
      })
    ]));

    const repoMap = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--json"
    ]);
    expect(repoMap.exitCode).toBe(0);
    const repoMapPayload = JSON.parse(repoMap.stdout);
    expect(repoMapPayload.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file_path: "apps/web/app/api/users/route.ts",
        security: expect.objectContaining({
          proof_status: "proven"
        })
      })
    ]));
  });

  it("reports proof-safe security architecture audit without leaking raw fact values", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertScanManifest({
      id: "scan_security_audit",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 8,
      finding_count: 0,
      started_at: "2026-05-27T00:00:00.000Z",
      completed_at: "2026-05-27T00:00:01.000Z"
    });
    storage.upsertFacts([
      {
        id: "fact_security_audit_role",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "file_role_detected",
        file_path: "apps/web/app/api/apps/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1,
        ...factQuality("scan_security_audit")
      },
      {
        id: "fact_security_audit_auth",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "symbol_called",
        file_path: "apps/web/app/api/apps/route.ts",
        name: "withWorkspace",
        start_line: 4,
        end_line: 4,
        ...factQuality("scan_security_audit")
      },
      {
        id: "fact_security_audit_parser",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "symbol_called",
        file_path: "apps/web/app/api/apps/route.ts",
        name: "parseRequestBody",
        start_line: 8,
        end_line: 8,
        ...factQuality("scan_security_audit")
      },
      {
        id: "fact_security_audit_validator",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "symbol_called",
        file_path: "apps/web/app/api/apps/route.ts",
        name: "parseAsync",
        value: "createOAuthAppSchema",
        start_line: 8,
        end_line: 8,
        ...factQuality("scan_security_audit")
      },
      {
        id: "fact_security_audit_rate_error",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "symbol_called",
        file_path: "apps/web/app/api/public/route.ts",
        name: "exceededLimitError",
        start_line: 9,
        end_line: 9,
        ...factQuality("scan_security_audit")
      },
      {
        id: "fact_security_audit_ssrf",
        repo_id: "repo_abc",
        scan_id: "scan_security_audit",
        kind: "outbound_request_called",
        file_path: "apps/web/app/api/import/route.ts",
        name: "fetch",
        value: JSON.stringify({
          url_source: "request_input",
          url_var: "url",
          raw_url: "https://token@example.com"
        }),
        start_line: 12,
        end_line: 12,
        ...factQuality("scan_security_audit")
      }
    ]);
    storage.upsertConventionCandidate({
      id: "candidate_security_audit_body_parser",
      repo_id: "repo_abc",
      scan_id: "scan_security_audit",
      kind: "api_route_requires_request_validation",
      statement: "Uses parseRequestBody.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_request_validation",
        required_calls: ["parseRequestBody"]
      },
      requires: { validators: [{ symbol: "parseRequestBody" }] },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "deterministic_check",
      confidence_label: "medium",
      scoring: {
        supporting_examples_count: 2,
        counterexamples_count: 0,
        scope_files_count: 3,
        coverage_ratio: 0.67,
        heuristic_id: "test-security-audit"
      },
      evidence_refs: [],
      counterexample_refs: [],
      matcher_fingerprint: "security-audit-body-parser",
      scope_fingerprint: "security-audit-scope",
      graph_fingerprint: "security-audit-graph",
      evidence_fingerprint: "security-audit-evidence",
      required_capabilities: ["syntax_facts", "request_validation"],
      reason_not_blocking: "candidate_not_accepted",
      status: "candidate",
      created_at: "2026-05-27T00:00:02.000Z"
    });
    storage.upsertAcceptedConvention("repo_abc", {
      id: "convention_security_audit_auth",
      contract_id: "contract_security_audit",
      kind: "api_route_requires_auth_helper",
      statement: "Use withWorkspace.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_auth_helper",
        required_calls: ["withWorkspace"]
      },
      requires: { auth_helpers: [{ symbol: "withWorkspace" }] },
      severity: "warning",
      enforcement_mode: "warn",
      enforcement_capability: "deterministic_check",
      exceptions: [],
      evidence_refs: [],
      counterexample_refs: [],
      accepted_by: "test",
      accepted_at: "2026-05-27T00:00:03.000Z",
      updated_at: "2026-05-27T00:00:03.000Z"
    });
    storage.close();

    const jsonResult = await runCli([
      "--db", databasePath,
      "security", "audit",
      "--repo", "repo_abc",
      "--json"
    ]);
    const textResult = await runCli([
      "--db", databasePath,
      "security", "audit",
      "--repo", "repo_abc"
    ]);

    expect(jsonResult.stderr).toBe("");
    expect(jsonResult.exitCode).toBe(0);
    const payload = JSON.parse(jsonResult.stdout);
    expect(payload.response_schema).toBe("drift.security.audit.v1");
    expect(payload.areas.auth_boundary.patterns[0]).toMatchObject({
      pattern: "withWorkspace",
      accepted: true,
      candidate_only: false
    });
    expect(payload.areas.request_validation.patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pattern: "parseRequestBody",
        semantic_role: "body_parser",
        proof_truth: "candidate_only"
      }),
      expect.objectContaining({
        pattern: "createOAuthAppSchema.parseAsync",
        semantic_role: "validator"
      })
    ]));
    expect(payload.areas.rate_limit.patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pattern: "exceededLimitError",
        semantic_role: "error_helper"
      })
    ]));
    expect(payload.areas.ssrf.patterns[0]).toMatchObject({
      pattern: "request_input"
    });
    expect(jsonResult.stdout).not.toContain("https://token@example.com");
    expect(jsonResult.stdout).not.toContain("raw_url");
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).toContain("Drift security audit");
    expect(textResult.stdout).toContain("Candidate-only patterns: 2");
    expect(textResult.stdout).toContain("Priority signals:");
    expect(textResult.stdout).toContain("Signal/noise ratio:");
    expect(textResult.stdout).not.toContain("parseRequestBody priority:");
    expect(textResult.stdout).not.toContain("exceededLimitError priority:");
    expect(textResult.stdout).not.toContain("https://token@example.com");
  });

  it("repo map reports route middleware coverage summary", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-middleware-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertFacts([{
      id: "fact_middleware_protects_users",
      repo_id: repoId,
      scan_id: scanId,
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
      ...factQuality(scanId)
    }]);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.files[0].route_security.middleware_coverage).toMatchObject({
      proven: true,
      protection_kinds: ["auth"],
      middleware_ids: ["middleware:middleware.ts"]
    });
    expect(result.stdout).not.toContain("requireUser()");
  });

  it("repo map reports route request validation summary", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-validation-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertFacts([{
      id: "fact_request_body",
      repo_id: repoId,
      scan_id: scanId,
      kind: "request_input_read",
      file_path: "apps/web/app/api/users/route.ts",
      name: "body",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:POST",
        source: "body",
        variable: "body",
        taint: "untrusted"
      }),
      imported_name: undefined,
      start_line: 1,
      end_line: 1,
      ...factQuality(scanId)
    }]);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.files[0].route_security.request_validation).toMatchObject({
      status: "not_evaluated",
      input_sources: ["body"]
    });
    expect(result.stdout).not.toContain("request.json()");
  });

  it("repo map reports route tenant authorization and session summaries", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-repo-map-phase4-");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const scanId = storage.listScanManifests(repoId)
      .find((scan) => scan.status === "completed" && !scan.id.startsWith("scan_baseline_"))!.id;
    storage.upsertFacts([{
      id: "fact_session",
      repo_id: repoId,
      scan_id: scanId,
      kind: "session_read",
      file_path: "apps/web/app/api/users/route.ts",
      name: "session",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        variable: "session",
        source: "auth_result",
        trust: "trusted"
      }),
      imported_name: undefined,
      start_line: 2,
      end_line: 2,
      ...factQuality(scanId)
    }, {
      id: "fact_authorization",
      repo_id: repoId,
      scan_id: scanId,
      kind: "authorization_guard_called",
      file_path: "apps/web/app/api/users/route.ts",
      name: "requireRole",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        policy_id: "authorization_require_role",
        roles: ["admin"],
        subject_var: "session.user"
      }),
      imported_name: undefined,
      start_line: 3,
      end_line: 3,
      ...factQuality(scanId)
    }, {
      id: "fact_tenant_source",
      repo_id: repoId,
      scan_id: scanId,
      kind: "tenant_source",
      file_path: "apps/web/app/api/users/route.ts",
      name: "tenantId",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        source: "session",
        key: "tenantId",
        variable: "session.user.tenantId",
        trusted: true
      }),
      imported_name: undefined,
      start_line: 4,
      end_line: 4,
      ...factQuality(scanId)
    }, {
      id: "fact_tenant_guard",
      repo_id: repoId,
      scan_id: scanId,
      kind: "tenant_guard_called",
      file_path: "apps/web/app/api/users/route.ts",
      name: "tenantId",
      value: JSON.stringify({
        route_id: "route:apps/web/app/api/users/route.ts:GET",
        tenant_key: "tenantId",
        predicate_kind: "where_equals",
        data_operation_fact_id: "fact_data"
      }),
      imported_name: undefined,
      start_line: 5,
      end_line: 5,
      ...factQuality(scanId)
    }]);
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "repo", "map",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.files[0].route_security.session_trust).toMatchObject({
      status: "advisory_only",
      advisory_session_variables: ["session"],
      advisory_trusted_source_count: 1,
      advisory_untrusted_source_count: 0
    });
    expect(payload.files[0].route_security.authorization).toMatchObject({
      status: "advisory_only",
      advisory_guard_ids: ["authorization_require_role"],
      advisory_role_count: 1
    });
    expect(payload.files[0].route_security.tenant_scope).toMatchObject({
      status: "advisory_only",
      advisory_tenant_keys: ["tenantId"],
      advisory_trusted_source_count: 1,
      advisory_predicate_count: 1
    });
    expect(result.stdout).not.toContain("session.user.tenantId");
  });

  it("prints prepare summary and governance in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "prepare",
      "add users route",
      "--repo", "repo_abc",
      "--now", "2026-05-10T00:01:00.000Z"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Summary: 1 convention,");
    expect(result.stdout).toContain("Governance: read-only; human approval required for mutations");
  });

  it("prepares a stale packet when the repo root is missing", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertScanManifest({
      id: "scan_missing_preflight_root",
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
      scan_id: "scan_missing_preflight_root",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "not-used-by-test",
      byte_size: 64,
      indexed: true
    });
    storage.close();
    await rm(repoRoot, { recursive: true, force: true });

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "add user endpoint",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      repo_id: "repo_abc",
      scan_status: {
        stale: true,
        invalidation_reasons: ["repo_root_missing"],
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

  it("omits expired conventions from prepare output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "add user endpoint",
      "--repo", "repo_abc",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout).conventions).toEqual([]);
  });

  it("omits accepted drift findings from prepare output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
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
      created_at: "2026-05-10T00:00:05.000Z"
    });
    storage.close();

    const prepared = await runCli([
      "--db", databasePath,
      "prepare",
      "add user endpoint",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout).findings).toEqual([]);
  });

  it("infers database path and repo id from repo-root for common commands", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-ergonomic-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "apps/web/app/api/users"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/web/app/api/users/route.ts"),
      [
        "import { prisma } from \"@/lib/prisma\";",
        "export async function GET() {",
        "  return Response.json(await prisma.user.findMany());",
        "}",
        ""
      ].join("\n")
    );

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:30.000Z"
    ]);
    const repoId = started.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
    const prepared = await runCli([
      "prepare",
      "add user endpoint",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const contract = await runCli([
      "contract", "show",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);

    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout).repo_id).toBe(repoId);
    expect(contract.exitCode).toBe(0);
    expect(JSON.parse(contract.stdout).contract.repo_id).toBe(repoId);
  });

  it("shows repo policy and checks whether context can be exported", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const shown = await runCli([
      "--db", databasePath,
      "policy", "show",
      "--repo", "repo_abc",
      "--json"
    ]);
    const allowed = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--snippet-chars", "5000",
      "--json"
    ]);
    const permissionMatrix = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--json"
    ]);
    const denied = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", ".env.local",
      "--surface", "cli-preflight",
      "--json"
    ]);
    const fullFileDenied = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--full-file",
      "--json"
    ]);

    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        default_mode: "local_only",
        denied_glob_count: 2,
        agent_permission_count: 0,
        guarded_surface_count: 7,
        allow_full_file_content: false,
        max_snippet_chars: 1200
      },
      policy: {
        context_egress: {
          default_mode: "local_only"
        }
      },
      next_commands: [
        "drift policy check-context --repo repo_abc --path <file> --surface cli-preflight --json",
        "drift policy set-egress --repo repo_abc --default-mode redacted --confirm --json",
        "drift audit list --repo repo_abc --action policy_changed --json"
      ]
    });
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout)).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      contract: {
        ready: true,
        id: "contract_abc",
        source: "accepted_contract"
      },
      redactions: {
        denied_globs: [".env*", "**/*.pem"],
        allow_full_file_content: false,
        max_snippet_chars: 1200
      },
      request: {
        path: "apps/web/app/api/users/route.ts",
        surface: "cli-preflight",
        requested_snippet_chars: 5000,
        request_full_file_content: false
      },
      summary: {
        allowed: true,
        mode: "redacted",
        surface: "cli-preflight",
        indexed: false,
        matched_convention_count: 1,
        risky_area_count: 0,
        open_finding_count: 0,
        freshness_required: false,
        freshness_satisfied: false,
        denied_glob_count: 2,
        approved_snippet_chars: 1200
      }
    });
    expect(JSON.parse(allowed.stdout).decision).toMatchObject({
      allowed: true,
      surface: "cli-preflight",
      mode: "redacted",
      max_snippet_chars: 1200,
      approved_snippet_chars: 1200
    });
    expect(JSON.parse(permissionMatrix.stdout).context_policy).toMatchObject({
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
    });
    expect(JSON.parse(allowed.stdout).next_commands).toEqual([
      "drift prepare \"task\" --repo repo_abc --path apps/web/app/api/users/route.ts --json",
      "drift repo map --repo repo_abc --path apps/web/app/api/users/route.ts --json",
      "drift policy show --repo repo_abc --json"
    ]);
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stdout).decision).toMatchObject({
      allowed: false,
      surface: "cli-preflight",
      mode: "denied"
    });
    expect(JSON.parse(denied.stdout).summary).toMatchObject({
      allowed: false,
      mode: "denied",
      surface: "cli-preflight",
      indexed: false,
      freshness_required: false,
      freshness_satisfied: false,
      denied_glob_count: 2,
      approved_snippet_chars: 0
    });
    expect(JSON.parse(denied.stdout).next_commands).toEqual([
      "drift policy show --repo repo_abc --json"
    ]);
    expect(fullFileDenied.exitCode).toBe(1);
    expect(JSON.parse(fullFileDenied.stdout).decision).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "full file content is denied by repo policy"
    });
  });

  it("adds scan freshness and repo impact metadata to policy context checks", async () => {
    const { databasePath, repoId } = await seedStartedDoctorState("drift-policy-context-impact-");

    const allowed = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", repoId,
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--require-fresh",
      "--json"
    ]);

    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout)).toMatchObject({
      repo_id: repoId,
      scan_status: {
        stale: false
      },
      freshness_requirement: {
        required: true,
        satisfied: true
      },
      file_context: {
        path: "apps/web/app/api/users/route.ts",
        indexed: true,
        roles: ["api_route"],
        convention_ids: [expect.stringMatching(/^convention_[a-f0-9]+$/)],
        risky_area_ids: ["risk_data_access_api_routes"],
        open_finding_ids: expect.arrayContaining([expect.stringMatching(/^finding_[a-f0-9]+$/)])
      }
    });
  });

  it("fails policy context checks when fresh scan context is required but stale", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--require-fresh",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Scan is stale for repo_abc.");
    expect(result.stderr).toContain("drift scan --repo-root");
    expect(result.stderr).toContain("omit --require-fresh");
  });

  it("rejects conflicting policy context size requests", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--full-file",
      "--snippet-chars", "100",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Use either --full-file or --snippet-chars, not both.");
  });

  it("rejects unsafe policy context paths before policy evaluation", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const parentPath = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "../secrets.env",
      "--surface", "cli-preflight",
      "--json"
    ]);
    const absolutePath = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "/tmp/secrets.env",
      "--surface", "cli-preflight",
      "--json"
    ]);

    expect(parentPath.exitCode).toBe(1);
    expect(parentPath.stderr).toContain("--path must be repo-relative");
    expect(absolutePath.exitCode).toBe(1);
    expect(absolutePath.stderr).toContain("--path must be repo-relative");
  });

  it("rejects blank policy context paths before policy evaluation", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", "repo_abc",
      "--path", "   ",
      "--surface", "cli-preflight",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--path must not be empty");
  });

  it("updates egress policy only with explicit confirmation and audits the change", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const unconfirmed = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--default-mode", "redacted",
      "--max-snippet-chars", "600",
      "--deny-glob", "secrets/**",
      "--json"
    ]);

    expect(unconfirmed.exitCode).toBe(1);
    expect(unconfirmed.stderr).toContain("Policy changes require --confirm");

    const updated = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--default-mode", "redacted",
      "--max-snippet-chars", "600",
      "--deny-glob", "secrets/**",
      "--allow-full-file-content",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);

    expect(updated.exitCode).toBe(0);
    expect(JSON.parse(updated.stdout).policy.context_egress).toMatchObject({
      default_mode: "redacted",
      max_snippet_chars: 600,
      allow_full_file_content: true,
      denied_globs: [".env*", "**/*.pem", "secrets/**"]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getRepoContract("repo_abc")?.context_egress.default_mode).toBe("redacted");
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "policy_changed",
      actor: "geoff",
      target_type: "policy",
      metadata: {
        changed_fields: ["default_mode", "max_snippet_chars", "allow_full_file_content", "denied_globs"]
      }
    });
    storage.close();
  });

  it("rejects ambiguous full-file policy flags", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--allow-full-file-content",
      "--deny-full-file-content",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Use either --allow-full-file-content or --deny-full-file-content, not both.");
  });

  it("does not audit no-op egress policy updates", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeUpdatedAt = storage.getRepoContract("repo_abc")?.updated_at;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--default-mode", "local_only",
      "--max-snippet-chars", "1200",
      "--deny-full-file-content",
      "--confirm",
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changed_fields).toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeUpdatedAt);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires at least one policy option for confirmed egress updates", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy changes require at least one egress option");
  });

  it("rejects unsafe policy deny globs", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const parentGlob = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--deny-glob", "../secrets/**",
      "--confirm",
      "--json"
    ]);
    const absoluteGlob = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--deny-glob", "/tmp/secrets/**",
      "--confirm",
      "--json"
    ]);

    expect(parentGlob.exitCode).toBe(1);
    expect(parentGlob.stderr).toContain("--deny-glob must be repo-relative");
    expect(absoluteGlob.exitCode).toBe(1);
    expect(absoluteGlob.stderr).toContain("--deny-glob must be repo-relative");
  });

  it("rejects blank policy deny globs", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--deny-glob", "   ",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--deny-glob must not be empty");
  });

  it("rejects oversized policy snippet caps", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "set-egress",
      "--repo", "repo_abc",
      "--max-snippet-chars", "50001",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--max-snippet-chars must be less than or equal to 50000");
  });

  it("grants agent permissions only with explicit confirmation and audits the change", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const unconfirmed = await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--json"
    ]);

    expect(unconfirmed.exitCode).toBe(1);
    expect(unconfirmed.stderr).toContain("Agent permission changes require --confirm");

    const granted = await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:02:00.000Z",
      "--json"
    ]);

    expect(granted.exitCode).toBe(0);
    expect(JSON.parse(granted.stdout).policy.agent_permissions).toEqual([{
      agent: "codex",
      permissions: ["request_preflight"]
    }]);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getRepoContract("repo_abc")?.agent_permissions).toEqual([{
      agent: "codex",
      permissions: ["request_preflight"]
    }]);
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "agent_permission_changed",
      actor: "geoff",
      target_type: "agent_permission",
      target_id: "codex",
      metadata: {
        permission: "request_preflight"
      }
    });
    storage.close();
  });

  it("does not audit no-op agent permission grants", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const first = await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--confirm",
      "--now", "2026-05-10T00:02:00.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeUpdatedAt = storage.getRepoContract("repo_abc")?.updated_at;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--confirm",
      "--now", "2026-05-10T00:03:00.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed_fields).toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeUpdatedAt);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects blank agent ids when granting permissions", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "   ",
      "--permission", "request_preflight",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--agent must not be empty");
  });

  it("revokes agent permissions only with explicit confirmation and audits the change", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    await runCli([
      "--db", databasePath,
      "policy", "agent", "grant",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--confirm",
      "--now", "2026-05-10T00:03:00.000Z",
      "--json"
    ]);

    const unconfirmed = await runCli([
      "--db", databasePath,
      "policy", "agent", "revoke",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--json"
    ]);
    const revoked = await runCli([
      "--db", databasePath,
      "policy", "agent", "revoke",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--permission", "request_preflight",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:04:00.000Z",
      "--json"
    ]);

    expect(unconfirmed.exitCode).toBe(1);
    expect(unconfirmed.stderr).toContain("Agent permission changes require --confirm");
    expect(revoked.exitCode).toBe(0);
    expect(JSON.parse(revoked.stdout).policy.agent_permissions).toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.agent_permissions).toEqual([]);
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "agent_permission_changed",
      actor: "geoff",
      target_type: "agent_permission",
      target_id: "codex",
      metadata: {
        permission: "request_preflight",
        revoked: true
      }
    });
    checked.close();
  });

  it("revokes all permissions for an agent with explicit confirmation", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    for (const permission of ["read_context", "request_preflight"] as const) {
      await runCli([
        "--db", databasePath,
        "policy", "agent", "grant",
        "--repo", "repo_abc",
        "--agent", "codex",
        "--permission", permission,
        "--confirm",
        "--now", `2026-05-10T00:04:0${permission === "read_context" ? "0" : "1"}.000Z`,
        "--json"
      ]);
    }

    const revoked = await runCli([
      "--db", databasePath,
      "policy", "agent", "revoke",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--all",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:05:00.000Z",
      "--json"
    ]);

    expect(revoked.exitCode).toBe(0);
    expect(JSON.parse(revoked.stdout).policy.agent_permissions).toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.agent_permissions).toEqual([]);
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "agent_permission_changed",
      actor: "geoff",
      metadata: {
        revoked_all: true,
        permissions: []
      }
    });
    checked.close();
  });

  it("rejects ambiguous revoke all with a specific permission", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "agent", "revoke",
      "--repo", "repo_abc",
      "--agent", "codex",
      "--all",
      "--permission", "request_preflight",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Use either --all or --permission, not both");
  });

  it("rejects blank agent ids when revoking permissions", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "policy", "agent", "revoke",
      "--repo", "repo_abc",
      "--agent", "   ",
      "--permission", "request_preflight",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--agent must not be empty");
  });

  it("lists required checks and safe commands from the repo contract", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [{
        command: "drift check --diff main...HEAD",
        applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
        reason: "Validate accepted API route conventions."
      }],
      safe_commands: [{
        command: "pnpm test",
        reason: "Run project tests after changing API routes.",
        requires_explicit_run: true
      }]
    });
    storage.close();

    const listed = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      repo_id: "repo_abc",
      policy: { allowed: true, surface: "cli-preflight" },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        required_count: 1,
        safe_count: 1,
        total_count: 2
      },
      required_checks: [{ command: "drift check --diff main...HEAD" }],
      safe_commands: [{ command: "pnpm test" }]
    });
  });

  it("lists required checks contributed by required_change_checks agent contracts", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [],
      safe_commands: [],
      agent_contracts: [{
        kind: "required_change_checks",
        id: "agent_contract_api_required_checks",
        version: 1,
        rules: [{
          applies_to: {
            path_globs: ["apps/web/app/api/**/route.ts"],
            file_roles: ["api_route"]
          },
          required_checks: [{
            command: "pnpm test -- api",
            reason: "Validate API route changes."
          }]
        }]
      }]
    });
    storage.close();

    const listed = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      summary: {
        required_count: 1,
        safe_count: 0,
        total_count: 1
      },
      required_checks: [{
        command: "pnpm test -- api",
        reason: "Validate API route changes.",
        matched_files: ["apps/web/app/api/users/route.ts"]
      }]
    });
  });

  it("runs approved required checks and records execution proof", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const command = "node -e \"process.stdout.write('ok')\"";
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [],
      safe_commands: [{
        command,
        reason: "Run deterministic smoke check.",
        requires_explicit_run: true
      }],
      agent_contracts: [{
        kind: "required_change_checks",
        id: "agent_contract_smoke_checks",
        version: 1,
        rules: [{
          applies_to: {
            path_globs: ["apps/web/app/api/**/route.ts"],
            file_roles: ["api_route"]
          },
          required_checks: [{
            command,
            reason: "Run deterministic smoke check."
          }]
        }]
      }]
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "checks", "run",
      "--repo", "repo_abc",
      "--command", command,
      "--timeout-ms", "30000",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      response_schema: "drift.required-check-execution.v1",
      repo_id: "repo_abc",
      summary: {
        command,
        status: "passed",
        passed: true,
        exit_code: 0
      },
      execution: {
        repo_contract_id: "contract_abc",
        agent_contract_id: "agent_contract_smoke_checks",
        contract_fingerprint: expect.any(String),
        diff_hash: "no_diff",
        command,
        argv: ["node", "-e", "process.stdout.write('ok')"],
        status: "passed",
        exit_code: 0,
        stdout_preview: "ok"
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.latestRequiredCheckExecution("repo_abc", command)).toMatchObject({
      command,
      status: "passed",
      stdout_preview: "ok",
      contract_fingerprint: expect.any(String),
      diff_hash: "no_diff"
    });
    expect(checked.listAuditEvents("repo_abc").some((event) =>
      event.action === "required_check_executed"
    )).toBe(true);
    checked.close();
  });

  it("blocks check when a release-required external check has no passing execution proof", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const command = "node -e \"process.stdout.write('ok')\"";
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      conventions: [],
      safe_commands: [{
        command,
        reason: "Run deterministic smoke check.",
        requires_explicit_run: true
      }],
      agent_contracts: [{
        kind: "required_change_checks",
        id: "agent_contract_smoke_checks",
        version: 1,
        rules: [{
          applies_to: {
            path_globs: ["apps/web/app/api/**/route.ts"],
            file_roles: ["api_route"]
          },
          required_checks: [{
            command,
            reason: "Run deterministic smoke check.",
            required_for_release: true
          }]
        }]
      }]
    });
    storage.close();

    const diffFile = join(repoRoot, "..", "required-check-proof.diff.patch");
    await writeFile(diffFile, [
      "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
      "--- a/apps/web/app/api/users/route.ts",
      "+++ b/apps/web/app/api/users/route.ts",
      "@@ -2,3 +2,4 @@",
      " export async function GET() {",
      "+  console.log(\"changed\");",
      "   return Response.json(await prisma.user.findMany());",
      " }",
      ""
    ].join("\n"));

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", diffFile,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.findings).toEqual([
      expect.objectContaining({
        convention_id: "agent_contract_smoke_checks",
        title: "Required check has not been proven",
        expected_layer: "required_check_execution",
        actual_layer: "required_check_not_run",
        enforcement_result: "block",
        suggested_fix: `Run drift checks run --repo repo_abc --command "${command}" --json.`
      })
    ]);
  });

  it("rejects stale required check proof after the diff hash changes", async () => {
    const { databasePath, repoRoot } = await seedAcceptedDatabase();
    const command = "node -e \"process.stdout.write('ok')\"";
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      conventions: [],
      safe_commands: [{
        command,
        reason: "Run deterministic smoke check.",
        requires_explicit_run: true
      }],
      agent_contracts: [{
        kind: "required_change_checks",
        id: "agent_contract_smoke_checks",
        version: 1,
        rules: [{
          applies_to: {
            path_globs: ["apps/web/app/api/**/route.ts"],
            file_roles: ["api_route"]
          },
          required_checks: [{
            command,
            reason: "Run deterministic smoke check.",
            required_for_release: true
          }]
        }]
      }]
    });
    storage.close();

    const firstDiff = join(repoRoot, "..", "required-check-proof-first.diff.patch");
    const secondDiff = join(repoRoot, "..", "required-check-proof-second.diff.patch");
    await writeFile(firstDiff, [
      "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
      "--- a/apps/web/app/api/users/route.ts",
      "+++ b/apps/web/app/api/users/route.ts",
      "@@ -2,3 +2,4 @@",
      " export async function GET() {",
      "+  console.log(\"first\");",
      "   return Response.json(await prisma.user.findMany());",
      " }",
      ""
    ].join("\n"));
    await writeFile(secondDiff, [
      "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
      "--- a/apps/web/app/api/users/route.ts",
      "+++ b/apps/web/app/api/users/route.ts",
      "@@ -2,3 +2,4 @@",
      " export async function GET() {",
      "+  console.log(\"second\");",
      "   return Response.json(await prisma.user.findMany());",
      " }",
      ""
    ].join("\n"));

    const proof = await runCli([
      "--db", databasePath,
      "checks", "run",
      "--repo", "repo_abc",
      "--command", command,
      "--diff-file", firstDiff,
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);
    expect(proof.exitCode).toBe(0);

    const result = await runCli([
      "--db", databasePath,
      "check",
      "--repo", "repo_abc",
      "--diff-file", secondDiff,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).findings).toEqual([
      expect.objectContaining({
        convention_id: "agent_contract_smoke_checks",
        title: "Required check proof is stale for this diff",
        actual_layer: "required_check_stale_proof",
        expected_layer: "required_check_execution"
      })
    ]);
  });

  it("filters contract checks by kind", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [{
        command: "drift check --diff main...HEAD",
        applies_to: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
        reason: "Validate accepted API route conventions."
      }],
      safe_commands: [{
        command: "pnpm test",
        reason: "Run project tests after changing API routes.",
        requires_explicit_run: true
      }]
    });
    storage.close();

    const requiredOnly = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--kind", "required",
      "--json"
    ]);
    const safeOnly = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--kind", "safe",
      "--json"
    ]);
    const invalid = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--kind", "unsafe",
      "--json"
    ]);

    expect(requiredOnly.exitCode).toBe(0);
    expect(JSON.parse(requiredOnly.stdout)).toMatchObject({
      kind: "required",
      summary: {
        required_count: 1,
        safe_count: 0,
        total_count: 1
      },
      required_checks: [{ command: "drift check --diff main...HEAD" }],
      safe_commands: []
    });
    expect(safeOnly.exitCode).toBe(0);
    expect(JSON.parse(safeOnly.stdout)).toMatchObject({
      kind: "safe",
      summary: {
        required_count: 0,
        safe_count: 1,
        total_count: 1
      },
      required_checks: [],
      safe_commands: [{ command: "pnpm test" }]
    });
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("--kind must be required, safe, or all");
  });

  it("filters contract checks by repo-relative path", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
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
      safe_commands: [{
        command: "pnpm test",
        reason: "Run project tests after changing API routes.",
        requires_explicit_run: true
      }]
    });
    storage.close();

    const apiChecks = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const docsChecks = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--path", "docs/auth.md",
      "--json"
    ]);
    const unsafePath = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--path", "../secret.ts",
      "--json"
    ]);

    expect(apiChecks.exitCode).toBe(0);
    expect(JSON.parse(apiChecks.stdout)).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      summary: {
        required_count: 1,
        safe_count: 1,
        total_count: 2
      },
      required_checks: [{
        command: "drift check --diff main...HEAD",
        matched_files: ["apps/web/app/api/users/route.ts"]
      }]
    });
    expect(JSON.parse(apiChecks.stdout).required_checks.map((check: { command: string }) => check.command)).not.toContain("pnpm lint docs");
    expect(JSON.parse(docsChecks.stdout).required_checks).toEqual([
      expect.objectContaining({
        command: "pnpm lint docs",
        matched_files: ["docs/auth.md"]
      })
    ]);
    expect(unsafePath.exitCode).toBe(1);
    expect(unsafePath.stderr).toContain("--path must be repo-relative");
  });

  it("paginates contract checks in deterministic command order", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      required_checks: [
        {
          command: "pnpm typecheck",
          applies_to: { path_globs: ["packages/**"] },
          reason: "Validate package types."
        },
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
      safe_commands: [
        {
          command: "pnpm test",
          reason: "Run project tests.",
          requires_explicit_run: true
        },
        {
          command: "pnpm test:e2e",
          reason: "Run e2e tests.",
          requires_explicit_run: true
        }
      ]
    });
    storage.close();

    const listed = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);
    const invalidLimit = await runCli([
      "--db", databasePath,
      "checks", "list",
      "--repo", "repo_abc",
      "--limit", "0",
      "--json"
    ]);

    expect(listed.exitCode).toBe(0);
    const payload = JSON.parse(listed.stdout);
    expect(payload).toMatchObject({
      summary: {
        filtered_count: 5,
        listed_count: 2,
        total_count: 2,
        required_count: 1,
        safe_count: 1
      },
      pagination: {
        limit: 2,
        offset: 1,
        returned_count: 2,
        has_more: true,
        next_offset: 3
      }
    });
    expect([
      ...payload.required_checks.map((check: { command: string }) => check.command),
      ...payload.safe_commands.map((command: { command: string }) => command.command)
    ].sort()).toEqual([
      "pnpm lint docs",
      "pnpm test"
    ]);
    expect(invalidLimit.exitCode).toBe(1);
    expect(invalidLimit.stderr).toContain("--limit must be a positive integer.");
  });

  it("refuses contract-backed read commands for an unknown repo id", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const commands = [
      ["policy", "show", "--repo", "repo_missing"],
      ["policy", "check-context", "--repo", "repo_missing", "--path", "apps/web/app/api/users/route.ts", "--surface", "cli-preflight"],
      ["checks", "list", "--repo", "repo_missing"],
      ["contract", "show", "--repo", "repo_missing"],
      ["contract", "validate", "--repo", "repo_missing"],
      ["contract", "export", "--repo", "repo_missing", "--format", "json"]
    ];

    for (const command of commands) {
      const result = await runCli([
        "--db", databasePath,
        ...command,
        "--json"
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown repo repo_missing");
    }
  });

  it("uses default local policy for prepare before a repo contract exists", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "prepare",
      "add billing route",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      contract: {
        ready: false,
        id: null,
        source: "default_local_policy"
      },
      readiness: {
        schema_version: "drift.readiness.v1",
        repo_id: "repo_abc",
        surface: "prepare"
      },
      summary: {
        contract_ready: false,
        candidate_count: 1,
        convention_count: 0
      }
    });
  });

  it("lists and shows convention candidates as JSON", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertConventionCandidate({
      id: "candidate_service_delegation",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate through service modules.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: ["@/services/users"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      scoring: {
        supporting_examples_count: 4,
        counterexamples_count: 1,
        scope_files_count: 5,
        coverage_ratio: 0.8,
        heuristic_id: "api-route-service-delegation-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "rejected",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.close();

    const list = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--status", "candidate",
      "--json"
    ]);
    const show = await runCli([
      "--db", databasePath,
      "conventions", "show",
      "candidate_no_direct_db",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({
      repo_id: "repo_abc",
      status: "candidate",
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      summary: {
        total_count: 2,
        filtered_count: 1,
        by_status: {
          candidate: 1,
          rejected: 1
        },
        by_capability: {
          deterministic_check: 1,
          heuristic_check: 1
        }
      },
      review_items: [{
        id: "candidate_no_direct_db",
        enforcement_capability: "deterministic_check",
        suggested_enforcement_mode: "block",
        supporting_examples_count: 12,
        counterexamples_count: 0
      }],
      next_commands: [
        "drift conventions show candidate_no_direct_db --repo repo_abc --json",
        "drift conventions accept candidate_no_direct_db --repo repo_abc --severity error --mode block --confirm",
        "drift conventions reject candidate_no_direct_db --repo repo_abc --reason \"false inference\" --confirm"
      ]
    });
    expect(JSON.parse(list.stdout).candidates[0].id).toBe("candidate_no_direct_db");
    expect(JSON.parse(list.stdout).review_items[0]).not.toHaveProperty("evidence_refs");
    expect(show.exitCode).toBe(0);
    expect(JSON.parse(show.stdout)).toMatchObject({
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      review_item: {
        id: "candidate_no_direct_db",
        kind: "api_route_no_direct_data_access",
        confidence_label: "high"
      },
      next_commands: [
        "drift conventions accept candidate_no_direct_db --repo repo_abc --severity error --mode block --confirm",
        "drift conventions reject candidate_no_direct_db --repo repo_abc --reason \"false inference\" --confirm",
        "drift conventions edit candidate_no_direct_db --repo repo_abc --statement \"...\" --confirm"
      ]
    });
    expect(JSON.parse(show.stdout).candidate.matcher.forbidden_imports).toEqual(["@/lib/prisma"]);
  });

  it("filters and paginates convention candidates in deterministic created order", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertConventionCandidate({
      id: "candidate_auth_helper",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route_requires_auth_helper",
      statement: "Workspace API routes should call the auth helper.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_auth_helper",
        required_calls: ["requireWorkspaceAccess"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      scoring: {
        supporting_examples_count: 2,
        counterexamples_count: 1,
        scope_files_count: 3,
        coverage_ratio: 0.67,
        heuristic_id: "api-route-auth-helper-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "candidate",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertConventionCandidate({
      id: "candidate_service_delegation",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate through service modules.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: ["@/services/users"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      scoring: {
        supporting_examples_count: 4,
        counterexamples_count: 1,
        scope_files_count: 5,
        coverage_ratio: 0.8,
        heuristic_id: "api-route-service-delegation-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "candidate",
      created_at: "2026-05-10T00:00:03.000Z"
    });
    storage.close();

    const paged = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--status", "candidate",
      "--limit", "2",
      "--offset", "1",
      "--json"
    ]);
    const filtered = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--kind", "api_route_requires_service_delegation",
      "--capability", "heuristic_check",
      "--json"
    ]);
    const invalidCapability = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--capability", "fuzzy",
      "--json"
    ]);

    expect(paged.exitCode).toBe(0);
    const pagedPayload = JSON.parse(paged.stdout);
    expect(pagedPayload).toMatchObject({
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
    expect(pagedPayload.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      "candidate_auth_helper",
      "candidate_service_delegation"
    ]);
    expect(filtered.exitCode).toBe(0);
    expect(JSON.parse(filtered.stdout)).toMatchObject({
      filters: {
        kind: "api_route_requires_service_delegation",
        capability: "heuristic_check"
      },
      summary: {
        total_count: 3,
        filtered_count: 1,
        listed_count: 1
      },
      candidates: [{ id: "candidate_service_delegation" }]
    });
    expect(invalidCapability.exitCode).toBe(1);
    expect(invalidCapability.stderr).toContain("--capability must be briefing_only, heuristic_check, or deterministic_check.");
  });

  it("refuses to show convention candidates for the wrong repo", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_other",
      root_path: "/repo-other",
      fingerprint: "repo-other-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "show",
      "candidate_no_direct_db",
      "--repo", "repo_other",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("belongs to repo repo_abc, not repo_other");
  });

  it("refuses to mutate convention candidates for the wrong repo", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_other",
      root_path: "/repo-other",
      fingerprint: "repo-other-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.close();

    for (const command of [
      ["conventions", "accept", "candidate_no_direct_db", "--repo", "repo_other"],
      ["conventions", "reject", "candidate_no_direct_db", "--repo", "repo_other", "--reason", "wrong repo"],
      ["conventions", "edit", "candidate_no_direct_db", "--repo", "repo_other", "--statement", "Wrong repo edit"]
    ]) {
      const result = await runCli([
        "--db", databasePath,
        ...command,
        "--json"
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("belongs to repo repo_abc, not repo_other");
    }
  });

  it("rejects invalid convention list statuses", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_abc",
      "--status", "open",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--status must be");
  });

  it("refuses conventions list for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "list",
      "--repo", "repo_missing",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown repo repo_missing");
  });

  it("accepts a candidate, materializes a repo contract, and audits the action", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--severity", "warning",
      "--mode", "warn",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      accepted: { id: "convention_no_direct_db" },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      contract_summary: {
        convention_count: 1,
        required_check_count: 1,
        risky_area_count: 1
      },
      next_commands: [
        "drift contract show --repo repo_abc --json",
        "drift baseline create --repo repo_abc --from main --confirm --json",
        "drift prepare \"task\" --repo repo_abc --json",
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json"
      ]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getConventionCandidate("candidate_no_direct_db")?.status).toBe("accepted");
    expect(storage.listAcceptedConventions("repo_abc")[0]).toMatchObject({
      severity: "warning",
      requires: { forbidden_imports: ["@/lib/prisma"] }
    });
    expect(storage.getRepoContract("repo_abc")?.conventions[0]).toMatchObject({
      enforcement_mode: "warn",
      requires: { forbidden_imports: ["@/lib/prisma"] }
    });
    expect(storage.listAuditEvents("repo_abc")[0]?.action).toBe("election_accepted");
    storage.close();
  });

  it("previews candidate acceptance without mutating contracts or audit history", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--severity", "warning",
      "--mode", "warn",
      "--dry-run",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dry_run: true,
      write_intent: false,
      would_accept: true,
      changed: true,
      accepted: {
        id: "convention_no_direct_db",
        severity: "warning",
        enforcement_mode: "warn"
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      next_commands: [
        "drift conventions accept candidate_no_direct_db --repo repo_abc --severity warning --mode warn --confirm --json"
      ]
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.status).toBe("candidate");
    expect(checked.getRepoContract("repo_abc")).toBeUndefined();
    expect(checked.listAcceptedConventions("repo_abc")).toHaveLength(0);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("previews convention exceptions without rematerializing contracts or auditing", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    const beforeUpdatedAt = storage.getRepoContract("repo_abc")?.updated_at;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "Health endpoints are intentionally unauthenticated.",
      "--dry-run",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dry_run: true,
      write_intent: false,
      would_add_exception: true,
      changed: true,
      convention: {
        id: "convention_no_direct_db",
        exceptions: [
          {
            path_globs: ["apps/web/app/api/health/**"],
            reason: "Health endpoints are intentionally unauthenticated."
          }
        ]
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listAcceptedConventions("repo_abc")[0]?.exceptions).toHaveLength(0);
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeUpdatedAt);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("does not audit no-op candidate acceptance", async () => {
    const databasePath = await seedDatabase();

    const first = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--severity", "error",
      "--mode", "block",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeContractUpdatedAt = storage.getRepoContract("repo_abc")?.updated_at;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--severity", "error",
      "--mode", "block",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed).toBe(false);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeContractUpdatedAt);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires explicit confirmation before accepting convention candidates", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--severity", "error",
      "--mode", "block",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Convention acceptance requires --confirm");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.status).toBe("candidate");
    expect(checked.getRepoContract("repo_abc")).toBeUndefined();
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires explicit confirmation before rejecting convention candidates", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
      "--reason", "false inference",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Convention rejection requires --confirm");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.status).toBe("candidate");
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects invalid convention accept severity and mode", async () => {
    const databasePath = await seedDatabase();

    const invalidSeverity = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--severity", "critical",
      "--json"
    ]);
    const invalidMode = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--mode", "enforce",
      "--json"
    ]);

    expect(invalidSeverity.exitCode).toBe(1);
    expect(invalidSeverity.stderr).toContain("--severity must be");
    expect(invalidMode.exitCode).toBe(1);
    expect(invalidMode.stderr).toContain("--mode must be");
  });

  it("refuses to accept non-deterministic conventions as blocking rules", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertConventionCandidate({
      id: "candidate_service_delegation",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "api_route_requires_service_delegation",
      statement: "API routes should delegate through service modules.",
      scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
      matcher: {
        kind: "api_route_requires_service_delegation",
        allowed_delegate_imports: ["@/services/users"],
        applies_to_file_roles: ["api_route"]
      },
      suggested_severity: "warning",
      suggested_enforcement_mode: "warn",
      enforcement_capability: "heuristic_check",
      confidence_label: "medium",
      scoring: {
        supporting_examples_count: 4,
        counterexamples_count: 1,
        scope_files_count: 5,
        coverage_ratio: 0.8,
        heuristic_id: "api-route-service-delegation-v1"
      },
      evidence_refs: [],
      counterexample_refs: [],
      status: "candidate",
      created_at: "2026-05-10T00:00:01.000Z"
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_service_delegation",
      "--confirm",
      "--mode", "block",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Only deterministic conventions can use --mode block");
  });

  it("rejects a candidate and audits the reason", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
      "--confirm",
      "--reason", "false inference",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      candidate: { status: "rejected" },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      review_item: {
        id: "candidate_no_direct_db",
        status: "rejected"
      },
      next_commands: [
        "drift conventions list --repo repo_abc --status candidate --json",
        "drift audit list --repo repo_abc --action election_rejected --json"
      ]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getConventionCandidate("candidate_no_direct_db")?.status).toBe("rejected");
    expect(storage.listAuditEvents("repo_abc")[0]?.metadata).toMatchObject({ reason: "false inference" });
    expect(storage.getRepoContract("repo_abc")?.rejected_inferences[0]).toMatchObject({
      candidate_id: "candidate_no_direct_db",
      evidence_fingerprint: "evidence_fp",
      reason: "false inference",
      rejected_by: "geoff"
    });
    storage.close();
  });

  it("requires non-empty reasons when rejecting convention candidates", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
      "--confirm",
      "--reason", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--reason must not be empty");
  });

  it("does not audit no-op candidate rejection", async () => {
    const databasePath = await seedDatabase();

    const first = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
      "--confirm",
      "--reason", "false inference",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
      "--confirm",
      "--reason", "same decision",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed).toBe(false);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.status).toBe("rejected");
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("shows the materialized contract as JSON", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "contract", "show",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).policy).toMatchObject({
      allowed: true,
      surface: "contract-export"
    });
    expect(JSON.parse(result.stdout).governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(JSON.parse(result.stdout).summary).toMatchObject({
      convention_count: 1,
      agent_contract_count: 0,
      risky_area_count: 1,
      required_check_count: 1,
      safe_command_count: 0
    });
    expect(JSON.parse(result.stdout).contract_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(result.stdout).contract.conventions[0].id).toBe("convention_no_direct_db");
  });

  it("materializes accepted architecture layers into the repo contract", async () => {
    const { databasePath } = await seedAcceptedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "contract", "show",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).contract.layer_architecture).toMatchObject({
      schema_version: "drift.layer_architecture.v1",
      layers: expect.arrayContaining([
        expect.objectContaining({ role: "route" }),
        expect.objectContaining({ role: "service" }),
        expect.objectContaining({ role: "data_access" })
      ]),
      forbidden_edges: expect.arrayContaining([
        expect.objectContaining({ from_layer: "route", to_layer: "data_access" })
      ])
    });
  });

  it("shows agent contract counts in contract show and validate output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      agent_contracts: [{
        kind: "canonical_helper_reuse",
        id: "agent_contract_auth_helper",
        version: 1,
        canonical_helpers: [{
          helper_id: "helper_require_user",
          symbol: "requireUser",
          module: "@/server/auth/require-user",
          applies_to_roles: ["api_route"],
          purpose_tags: ["auth"],
          suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
        }],
        enforcement: "advisory"
      }]
    });
    storage.close();

    const shown = await runCli([
      "--db", databasePath,
      "contract", "show",
      "--repo", "repo_abc",
      "--json"
    ]);
    const validated = await runCli([
      "--db", databasePath,
      "contract", "validate",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout).summary).toMatchObject({
      convention_count: 1,
      agent_contract_count: 1
    });
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({
      valid: true,
      convention_count: 1,
      agent_contract_count: 1
    });
  });

  it("denies contract show when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        default_mode: "approval_required"
      }
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "contract", "show",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy denied contract show");
  });

  it("validates, exports, and dry-run imports repo contracts", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const exportedPath = join(dir, "exported-contract.json");

    const validate = await runCli([
      "--db", databasePath,
      "contract", "validate",
      "--repo", "repo_abc",
      "--json"
    ]);
    const unconfirmedExport = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--json"
    ]);
    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", exportedPath,
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:11.000Z",
      "--json"
    ]);
    await writeFile(contractPath, await readFile(exportedPath, "utf8"));
    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      valid: true,
      repo_id: "repo_abc",
      schema_version: 1,
      supported_schema_version: 1,
      policy: {
        allowed: true,
        surface: "contract-export"
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      }
    });
    expect(unconfirmedExport.exitCode).toBe(1);
    expect(unconfirmedExport.stderr).toContain("Contract export requires --confirm");
    expect(exported.exitCode).toBe(0);
    expect(JSON.parse(exported.stdout).policy.surface).toBe("contract-export");
    expect(JSON.parse(exported.stdout).contract.conventions[0].id).toBe("convention_no_direct_db");
    expect(JSON.parse(exported.stdout).contract_fingerprint).toBe(JSON.parse(validate.stdout).contract_fingerprint);
    expect(JSON.parse(exported.stdout).export).toMatchObject({
      output_path: exportedPath,
      format: "json",
      write_intent: true,
      contract_fingerprint: JSON.parse(validate.stdout).contract_fingerprint
    });
    expect(JSON.parse(exported.stdout).export.checksum_sha256).toHaveLength(64);
    expect(JSON.parse(await readFile(exportedPath, "utf8")).conventions[0].id).toBe("convention_no_direct_db");
    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      valid: true,
      dry_run: true,
      write_intent: false,
      confirm_command: `drift --db ${databasePath} contract import ${contractPath} --repo repo_abc --confirm`,
      policy: {
        allowed: true,
        surface: "contract-export"
      },
      convention_count: 1,
      contract_fingerprint: JSON.parse(validate.stdout).contract_fingerprint,
      existing_contract_fingerprint: JSON.parse(validate.stdout).contract_fingerprint,
      compatibility: {
        compatible: true,
        repo_id_matches: true,
        repo_fingerprint_matches: true,
        schema_supported: true
      }
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "contract_exported",
      actor: "geoff",
      target_type: "contract",
      target_id: "contract_abc",
      metadata: {
        format: "json",
        output_path: exportedPath,
        checksum_sha256: JSON.parse(exported.stdout).export.checksum_sha256,
        surface: "contract-export",
        mode: "local_only"
      }
    });
    storage.close();
  });

  it("rejects contract validate when a blocking convention is not deterministic", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      conventions: contract.conventions.map((convention) => ({
        ...convention,
        enforcement_capability: "heuristic_check"
      }))
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "contract", "validate",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      compatibility: {
        compatible: false,
        reasons: ["blocking_non_deterministic_convention"]
      }
    });
  });

  it("rejects imported blocking security contracts backed by candidate sensitive fields", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-candidate-sensitive-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      conventions: contract.conventions.map((convention) => ({
        ...convention,
        kind: "api_route_forbids_sensitive_response_fields",
        matcher: {
          kind: "api_route_forbids_sensitive_response_fields",
          applies_to_file_roles: ["api_route"]
        },
        requires: {
          sensitive_response_fields: [{
            field_path: "user.email",
            classification: "pii",
            source: "candidate"
          }]
        }
      }))
    }, null, 2));
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        reasons: ["candidate_sensitive_fields_blocking"]
      }
    });
  });

  it("guards contract export artifact paths and overwrites", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-export-guards-"));
    tempDirs.push(dir);
    const existingPath = join(dir, "repo-contract.json");
    await writeFile(existingPath, "{\"existing\":true}\n");

    const directoryOutput = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", dir,
      "--confirm",
      "--json"
    ]);
    const nonJsonOutput = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", join(dir, "repo-contract.txt"),
      "--confirm",
      "--json"
    ]);
    const refusedOverwrite = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", existingPath,
      "--confirm",
      "--json"
    ]);
    const forcedOverwrite = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", existingPath,
      "--confirm",
      "--force",
      "--json"
    ]);

    expect(directoryOutput.exitCode).toBe(1);
    expect(directoryOutput.stderr).toContain("Contract export output must be a file path");
    expect(nonJsonOutput.exitCode).toBe(1);
    expect(nonJsonOutput.stderr).toContain("Contract export output must end with .json");
    expect(refusedOverwrite.exitCode).toBe(1);
    expect(refusedOverwrite.stderr).toContain("Contract export output already exists");
    expect(forcedOverwrite.exitCode).toBe(0);
    expect(JSON.parse(await readFile(existingPath, "utf8")).conventions[0].id).toBe("convention_no_direct_db");
  });

  it("rejects force on contract export unless an output path is provided", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--confirm",
      "--force",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--force requires --output for contract export.");
  });

  it("prints contract export artifact details in human output", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-export-text-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "repo-contract.json");

    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", contractPath,
      "--confirm"
    ]);

    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain("Drift contract export");
    expect(exported.stdout).toContain(`Output: ${contractPath}`);
    expect(exported.stdout).toContain("Write intent: true");
    expect(exported.stdout).toContain("Checksum:");
  });

  it("verifies contract import checksums before dry-run or write", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-checksum-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", contractPath,
      "--confirm",
      "--json"
    ]);
    const checksum = JSON.parse(exported.stdout).export.checksum_sha256;

    const wrongChecksum = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--checksum", "0".repeat(64),
      "--dry-run",
      "--json"
    ]);
    const correctChecksum = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--checksum", checksum,
      "--dry-run",
      "--json"
    ]);

    expect(wrongChecksum.exitCode).toBe(1);
    expect(wrongChecksum.stderr).toContain("Contract checksum mismatch");
    expect(correctChecksum.exitCode).toBe(0);
    expect(JSON.parse(correctChecksum.stdout).checksum_matches).toBe(true);
  });

  it("prints contract import dry-run confirmation guidance in human output", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-text-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", contractPath,
      "--confirm",
      "--json"
    ]);

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run"
    ]);

    expect(imported.exitCode).toBe(0);
    expect(imported.stdout).toContain("Dry run: true");
    expect(imported.stdout).toContain("Write intent: false");
    expect(imported.stdout).toContain(
      `Confirm import: drift --db ${databasePath} contract import ${contractPath} --repo repo_abc --confirm`
    );
  });

  it("requires a checksum for contract import when requested", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-require-checksum-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--output", contractPath,
      "--confirm",
      "--json"
    ]);

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--require-checksum",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract import requires --checksum when --require-checksum is used");
  });

  it("denies contract validate when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    storage.upsertRepoContract({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        default_mode: "approval_required"
      }
    });
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "contract", "validate",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Policy denied contract validate");
  });

  it("denies contract import dry-run when repo policy requires approval", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-policy-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify(contract, null, 2));
    storage.upsertRepoContract({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        default_mode: "approval_required"
      }
    });
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Policy denied contract import");
  });

  it("requires explicit confirmation for mutating contract imports", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-confirm-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    await writeFile(contractPath, JSON.stringify(storage.getRepoContract("repo_abc"), null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract import requires --confirm unless --dry-run is used.");
  });

  it("rejects ambiguous contract import dry-run and confirm flags", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-ambiguous-intent-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    await writeFile(contractPath, JSON.stringify(storage.getRepoContract("repo_abc"), null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--confirm",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Use either --dry-run or --confirm, not both.");
  });

  it("rejects contract imports with duplicate convention ids", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-conventions-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      conventions: [
        contract.conventions[0],
        {
          ...contract.conventions[0],
          statement: "Duplicate convention id should be rejected."
        }
      ]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract import contains duplicate convention id");
  });

  it("imports a compatible contract when explicitly confirmed", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const updatedContract = {
      ...contract,
      updated_at: "2026-05-10T00:00:40.000Z",
      conventions: contract.conventions.map((convention) => ({
        ...convention,
        statement: "Imported convention statement.",
        updated_at: "2026-05-10T00:00:40.000Z"
      }))
    };
    await writeFile(contractPath, JSON.stringify(updatedContract, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:41.000Z",
      "--json"
    ]);

    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      dry_run: false,
      imported: true,
      compatibility: {
        compatible: true
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.conventions[0]?.statement).toBe(
      "Imported convention statement."
    );
    expect(checked.listAcceptedConventions("repo_abc")[0]?.statement).toBe(
      "Imported convention statement."
    );
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "contract_imported",
      actor: "geoff",
      target_type: "contract",
      target_id: "contract_abc",
      metadata: {
        contract_path: contractPath,
        convention_count: 1,
        added_convention_count: 0,
        changed_convention_count: 1,
        removed_convention_count: 0,
        unchanged_convention_count: 0,
        surface: "contract-export"
      }
    });
    checked.close();
  });

  it("removes accepted conventions absent from a confirmed contract import", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-removal-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const extraConvention = {
      ...contract.conventions[0]!,
      id: "convention_extra",
      statement: "Extra convention should be removed by import.",
      accepted_at: "2026-05-10T00:00:39.000Z",
      updated_at: "2026-05-10T00:00:39.000Z"
    };
    storage.upsertAcceptedConvention("repo_abc", extraConvention);
    storage.upsertRepoContract({
      ...contract,
      conventions: [...contract.conventions, extraConvention],
      updated_at: "2026-05-10T00:00:39.000Z"
    });
    await writeFile(contractPath, JSON.stringify(contract, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--confirm",
      "--now", "2026-05-10T00:00:41.000Z",
      "--json"
    ]);

    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      imported: true,
      removed_convention_count: 1
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listAcceptedConventions("repo_abc").map((convention) => convention.id)).toEqual([
      "convention_no_direct_db"
    ]);
    checked.close();
  });

  it("returns a nonzero dry-run import result for incompatible contracts", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-incompatible-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--confirm",
      "--json"
    ]);
    const contract = JSON.parse(exported.stdout).contract;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      contract_schema_version: 999
    }, null, 2));

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      valid: true,
      dry_run: true,
      confirm_command: null,
      compatibility: {
        compatible: false,
        schema_supported: false,
        supported_schema_version: 1,
        reasons: ["contract_schema_unsupported"]
      }
    });
  });

  it("returns a nonzero dry-run import result when convention contract ids do not match the imported contract", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-convention-contract-id-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      conventions: contract.conventions.map((convention) => ({
        ...convention,
        contract_id: "contract_wrong"
      }))
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      dry_run: true,
      imported: false,
      confirm_command: null,
      compatibility: {
        compatible: false,
        convention_contract_ids_match: false,
        reasons: ["convention_contract_ids_mismatch"]
      }
    });
  });

  it("returns a nonzero dry-run import result for duplicate agent permission entries", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-agent-permissions-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      agent_permissions: [
        { agent: "codex", permissions: ["read_context", "read_context"] },
        { agent: "codex", permissions: ["request_preflight"] }
      ]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        agent_permissions_unique: false,
        reasons: ["duplicate_agent_permissions"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate agent contract ids", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-agent-contracts-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const agentContract = {
      kind: "module_placement",
      id: "agent_contract_route_placement",
      version: 1,
      statement: "API routes live under app/api route files.",
      target_role: "api_route",
      allowed_paths: ["apps/web/app/api/**/route.ts"],
      enforcement: "blocking"
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      agent_contracts: [agentContract, agentContract]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      agent_contract_count: 2,
      compatibility: {
        compatible: false,
        agent_contract_ids_unique: false,
        reasons: ["duplicate_agent_contract_ids"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate exception and waiver ids", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-exceptions-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const exception = {
      id: "exception_duplicate",
      reason: "health route",
      path_globs: ["apps/web/app/api/health/**"],
      created_by: "geoff",
      created_at: "2026-05-10T00:00:20.000Z"
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      conventions: contract.conventions.map((convention) => ({
        ...convention,
        exceptions: [exception, exception]
      })),
      waivers: [exception, exception]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        exception_ids_unique: false,
        waiver_ids_unique: false,
        reasons: ["duplicate_exception_ids", "duplicate_waiver_ids"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate active waiver selectors", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-waiver-selectors-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      waivers: [
        {
          id: "waiver_one",
          reason: "Legacy route.",
          path_globs: ["apps/web/app/api/users/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:20.000Z"
        },
        {
          id: "waiver_two",
          reason: "Duplicate selector.",
          path_globs: ["apps/web/app/api/users/**"],
          created_by: "geoff",
          created_at: "2026-05-10T00:00:21.000Z"
        }
      ]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        waiver_selectors_unique: false,
        reasons: ["duplicate_waiver_selectors"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate required check commands", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-required-checks-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const requiredCheck = {
      command: "drift check --diff main...HEAD",
      applies_to: { path_globs: ["apps/web/app/api/**/route.ts"] },
      reason: "Validate accepted API route conventions."
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      required_checks: [requiredCheck, requiredCheck]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        required_checks_unique: false,
        reasons: ["duplicate_required_checks"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate safe command entries", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-safe-commands-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const safeCommand = {
      command: "pnpm test",
      reason: "Run repo tests.",
      requires_explicit_run: true
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      safe_commands: [safeCommand, safeCommand]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        safe_commands_unique: false,
        reasons: ["duplicate_safe_commands"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate risky area ids", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-risk-areas-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const riskArea = {
      id: "risk_auth_routes",
      path_globs: ["apps/web/app/api/auth/**"],
      risk_kind: "auth",
      reason: "Auth routes are sensitive."
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      risky_areas: [riskArea, riskArea]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        risky_area_ids_unique: false,
        reasons: ["duplicate_risky_area_ids"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate denied globs", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-denied-globs-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      context_egress: {
        ...contract.context_egress,
        denied_globs: [".env*", ".env*"]
      }
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        denied_globs_unique: false,
        reasons: ["duplicate_denied_globs"]
      },
      confirm_command: null
    });
  });

  it("returns a nonzero dry-run import result for duplicate rejected inference entries", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-duplicate-rejections-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const rejection = {
      candidate_id: "candidate_false_inference",
      reason: "false inference",
      rejected_by: "geoff",
      rejected_at: "2026-05-10T00:00:20.000Z"
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      rejected_inferences: [rejection, rejection]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      compatibility: {
        compatible: false,
        rejected_inferences_unique: false,
        reasons: ["duplicate_rejected_inferences"]
      },
      confirm_command: null
    });
  });

  it("prints contract import compatibility reasons in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-incompatible-text-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      contract_schema_version: 999
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stdout).toContain("Compatibility: incompatible");
    expect(imported.stdout).toContain("Reasons: contract_schema_unsupported");
    expect(imported.stdout).not.toContain("Confirm import:");
  });

  it("reports contract import dry-run changes without mutating or auditing", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-dry-run-changes-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const originalStatement = contract.conventions[0]?.statement;
    const addedConvention = {
      ...contract.conventions[0]!,
      id: "convention_added_auth",
      kind: "api_route_requires_auth_helper" as const,
      statement: "API routes should use the approved auth helper.",
      matcher: {
        kind: "api_route_requires_auth_helper" as const,
        required_calls: ["requireUser"],
        applies_to_file_roles: ["api_route" as const]
      },
      enforcement_mode: "warn" as const,
      enforcement_capability: "heuristic_check" as const,
      accepted_at: "2026-05-10T00:00:40.000Z",
      updated_at: "2026-05-10T00:00:40.000Z"
    };
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      conventions: [
        ...contract.conventions.map((convention) => ({
          ...convention,
          statement: "Dry run should not persist."
        })),
        addedConvention
      ]
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      dry_run: true,
      imported: false,
      would_update: true,
      added_convention_count: 1,
      changed_convention_count: 1,
      removed_convention_count: 0,
      unchanged_convention_count: 0
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.conventions[0]?.statement).toBe(originalStatement);
    expect(checked.listAcceptedConventions("repo_abc")[0]?.statement).toBe(originalStatement);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(0);
    checked.close();
  });

  it("does not audit no-op confirmed contract imports", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-no-op-import-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const contract = storage.getRepoContract("repo_abc")!;
    const beforeUpdatedAt = contract.updated_at;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    await writeFile(contractPath, JSON.stringify(contract, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--confirm",
      "--now", "2026-05-10T00:01:00.000Z",
      "--json"
    ]);

    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      imported: false,
      would_update: false
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeUpdatedAt);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects confirmed incompatible contract imports without mutating state", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-confirm-incompatible-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const originalContract = storage.getRepoContract("repo_abc")!;
    const originalStatement = originalContract.conventions[0]?.statement;
    await writeFile(contractPath, JSON.stringify({
      ...originalContract,
      contract_schema_version: 999,
      conventions: originalContract.conventions.map((convention) => ({
        ...convention,
        statement: "Should not import."
      }))
    }, null, 2));
    storage.close();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--confirm",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      dry_run: false,
      imported: false,
      compatibility: {
        compatible: false,
        schema_supported: false
      }
    });

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.contract_schema_version).toBe(1);
    expect(checked.getRepoContract("repo_abc")?.conventions[0]?.statement).toBe(originalStatement);
    expect(checked.listAcceptedConventions("repo_abc")[0]?.statement).toBe(originalStatement);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(0);
    checked.close();
  });

  it("returns a nonzero dry-run import result for unknown target repos", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-unknown-repo-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    const exported = await runCli([
      "--db", databasePath,
      "contract", "export",
      "--repo", "repo_abc",
      "--format", "json",
      "--confirm",
      "--json"
    ]);
    const contract = JSON.parse(exported.stdout).contract;
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      repo_id: "repo_missing",
      repo_fingerprint: "missing-fingerprint"
    }, null, 2));

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_missing",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      valid: true,
      dry_run: true,
      compatibility: {
        compatible: false,
        target_repo_exists: false
      }
    });
  });

  it("refuses contract import when the contract file is missing", async () => {
    const databasePath = await seedDatabase();

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      "/tmp/drift-missing-contract.json",
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract file not found: /tmp/drift-missing-contract.json");
  });

  it("refuses contract import paths that are directories", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-dir-"));
    tempDirs.push(dir);

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      dir,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract path must be a file");
  });

  it("refuses malformed contract import JSON with a clean error", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-json-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    await writeFile(contractPath, "{not json");

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract file must contain valid JSON");
  });

  it("refuses invalid contract import schemas with a clean error", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-import-schema-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");
    await writeFile(contractPath, JSON.stringify({
      id: "contract_bad",
      repo_id: "repo_abc",
      contract_schema_version: "1"
    }));

    const imported = await runCli([
      "--db", databasePath,
      "contract", "import",
      contractPath,
      "--repo", "repo_abc",
      "--dry-run",
      "--json"
    ]);

    expect(imported.exitCode).toBe(1);
    expect(imported.stderr).toContain("Contract file does not match the Drift contract schema");
  });

  it("edits a candidate statement before acceptance", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--statement", "API routes must delegate data access through services.",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      candidate: {
        statement: "API routes must delegate data access through services."
      },
      review_item: {
        id: "candidate_no_direct_db",
        statement: "API routes must delegate data access through services."
      },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      next_commands: [
        "drift conventions show candidate_no_direct_db --repo repo_abc --json",
        "drift conventions accept candidate_no_direct_db --repo repo_abc --severity error --mode block --confirm",
        "drift conventions reject candidate_no_direct_db --repo repo_abc --reason \"false inference\" --confirm"
      ]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getConventionCandidate("candidate_no_direct_db")?.statement).toBe(
      "API routes must delegate data access through services."
    );
    expect(storage.listAuditEvents("repo_abc")[0]).toMatchObject({
      action: "election_edited",
      actor: "geoff",
      target_type: "candidate",
      target_id: "candidate_no_direct_db",
      metadata: {
        changed_fields: ["statement"]
      }
    });
    storage.close();
  });

  it("does not audit no-op candidate edits", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const statement = storage.getConventionCandidate("candidate_no_direct_db")!.statement;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--statement", statement,
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changed_fields).toEqual([]);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires an edit option for convention candidate edits", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Convention edits require --statement or --scope-file.");
  });

  it("requires explicit confirmation before editing convention candidates", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const originalStatement = storage.getConventionCandidate("candidate_no_direct_db")!.statement;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--statement", "API routes must delegate data access through services.",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Convention edits require --confirm");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.statement).toBe(originalStatement);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects blank convention candidate statements without mutating or auditing", async () => {
    const databasePath = await seedDatabase();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const originalStatement = storage.getConventionCandidate("candidate_no_direct_db")!.statement;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--statement", "   ",
      "--actor", "geoff",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--statement must not be empty");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getConventionCandidate("candidate_no_direct_db")?.statement).toBe(originalStatement);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("edits a candidate structured scope from a JSON file", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-scope-file-"));
    tempDirs.push(dir);
    const scopePath = join(dir, "scope.json");
    await writeFile(scopePath, JSON.stringify({
      path_globs: ["apps/api/**/route.ts"],
      file_roles: ["api_route"],
      exclude_path_globs: ["apps/api/health/**"]
    }));

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--scope-file", scopePath,
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).candidate.scope).toEqual({
      path_globs: ["apps/api/**/route.ts"],
      file_roles: ["api_route"],
      exclude_path_globs: ["apps/api/health/**"]
    });
  });

  it("rejects unsafe candidate scope files with a clear error", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-scope-file-unsafe-"));
    tempDirs.push(dir);
    const scopePath = join(dir, "scope.json");
    await writeFile(scopePath, JSON.stringify({
      path_globs: ["../api/**/route.ts"],
      file_roles: ["api_route"],
      exclude_path_globs: ["/tmp/generated/**"]
    }));

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--scope-file", scopePath,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--scope-file path_globs and exclude_path_globs must be repo-relative.");
  });

  it("rejects convention scope-file paths that are directories", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-scope-file-dir-"));
    tempDirs.push(dir);

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--scope-file", dir,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--scope-file must be a file");
  });

  it("rejects malformed convention scope files with a clean error", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-scope-file-json-"));
    tempDirs.push(dir);
    const scopePath = join(dir, "scope.json");
    await writeFile(scopePath, "{not json");

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--scope-file", scopePath,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--scope-file must contain valid JSON");
  });

  it("rejects invalid convention scope schemas with a clean error", async () => {
    const databasePath = await seedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-scope-file-schema-"));
    tempDirs.push(dir);
    const scopePath = join(dir, "scope.json");
    await writeFile(scopePath, JSON.stringify({
      path_globs: "apps/api/**/route.ts"
    }));

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--confirm",
      "--scope-file", scopePath,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--scope-file does not match the Drift scope schema");
  });

  it("adds an exception to an accepted convention and rematerializes the contract", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const seeded = openDriftStorage({ databasePath });
    seeded.migrate();
    seeded.upsertRepoContract({
      ...seeded.getRepoContract("repo_abc")!,
      agent_contracts: [{
        kind: "canonical_helper_reuse",
        id: "agent_contract_auth_helper",
        version: 1,
        canonical_helpers: [{
          helper_id: "helper_require_user",
          symbol: "requireUser",
          module: "@/server/auth/require-user",
          applies_to_roles: ["api_route"],
          purpose_tags: ["auth"],
          avoid_new_symbols_matching: ["getCurrentUser"],
          suggested_import: "import { requireUser } from \"@/server/auth/require-user\";"
        }],
        enforcement: "blocking"
      }]
    });
    seeded.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health endpoints are intentionally dependency-light",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      convention: {
        exceptions: [{
          path_globs: ["apps/web/app/api/health/**"]
        }]
      },
      governance: {
        read_only: false,
        agent_can_mutate: false
      },
      contract_summary: {
        convention_count: 1,
        waiver_count: 0
      },
      next_commands: [
        "drift contract show --repo repo_abc --json",
        "drift check --repo repo_abc --diff main...HEAD --scope changed-hunks --json",
        "drift audit list --repo repo_abc --action policy_changed --json"
      ]
    });

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.exceptions[0]?.reason).toBe(
      "health endpoints are intentionally dependency-light"
    );
    expect(storage.getRepoContract("repo_abc")?.agent_contracts?.map((contract) => contract.id)).toEqual([
      "agent_contract_auth_helper"
    ]);
    expect(storage.listAuditEvents("repo_abc").at(-1)?.action).toBe("policy_changed");
    storage.close();
  });

  it("does not audit duplicate convention exceptions", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const first = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health endpoints are intentionally dependency-light",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeUpdatedAt = storage.getRepoContract("repo_abc")?.updated_at;
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const second = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "duplicate request",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed).toBe(false);
    expect(JSON.parse(second.stdout).convention.exceptions).toHaveLength(1);

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.updated_at).toBe(beforeUpdatedAt);
    expect(checked.getRepoContract("repo_abc")?.conventions[0]?.exceptions).toHaveLength(1);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("requires explicit confirmation before adding convention exceptions", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--json"
    ]);
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const beforeAuditCount = storage.listAuditEvents("repo_abc").length;
    storage.close();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health route exception",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Convention exception changes require --confirm");

    const checked = openDriftStorage({ databasePath });
    checked.migrate();
    expect(checked.getRepoContract("repo_abc")?.conventions[0]?.exceptions).toEqual([]);
    expect(checked.listAuditEvents("repo_abc")).toHaveLength(beforeAuditCount);
    checked.close();
  });

  it("rejects unsafe convention exception paths with a clear error", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_abc",
      "--path", "../secrets/**",
      "--reason", "bad exception",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--path must be repo-relative.");
  });

  it("requires non-empty reasons for convention exceptions", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--confirm",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "   ",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--reason must not be empty");
  });

  it("refuses convention exceptions for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--confirm",
      "--repo", "repo_missing",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health route exception",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown repo repo_missing");
  });
});
