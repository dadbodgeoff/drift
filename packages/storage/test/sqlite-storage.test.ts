import { mkdtemp, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildFactGraphArtifact, buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { openDriftStorage } from "../src/index.js";

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

async function tempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-storage-"));
  tempDirs.push(dir);
  return join(dir, "drift.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function validSecurityBoundaryProof(overrides: Record<string, unknown> = {}) {
  return {
    proof_id: "proof_route_users_get",
    proof_version: "security-boundary-proof/v1",
    route: {
      route_id: "route_users_get",
      file_path: "app/api/users/route.ts",
      file_role: "api_route"
    },
    contracts: [{
      contract_id: "security_api_auth",
      kind: "api_route_requires_auth_helper",
      enforcement_mode: "block",
      capability: "deterministic_check",
      matched: true
    }],
    capability_status: [{
      name: "control_flow_guard_dominance",
      status: "partial",
      can_block: true,
      parser_gap_ids: [],
      missing_proof_ids: ["missing_auth"]
    }],
    auth: {
      required: true,
      proven: false,
      proof_kind: "none",
      trusted_guard_calls: [],
      dominated_sinks: [],
      undominated_sinks: []
    },
    missing_proof: [],
    parser_gaps: [],
    result: {
      proof_status: "missing_proof",
      enforcement_result: "block",
      can_block: true,
      finding_ids: ["finding_auth"]
    },
    ...overrides
  };
}

describe("SQLite Drift storage", () => {
  it("applies schema migrations into SQLite", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });

    storage.migrate();

    expect(storage.getAppliedMigrations()).toEqual([
      "001_initial_local_state",
      "002_scan_facts",
      "003_repo_contracts_and_conventions",
      "004_backup_manifests",
      "005_audit_integrity",
      "006_fact_graph_artifacts",
      "007_fact_graph_v2_projections",
      "008_scan_file_changes",
      "009_symbol_occurrence_kind",
      "010_audit_sequence",
      "011_check_runs_and_finding_context",
      "012_repo_identity",
      "013_required_check_executions",
      "014_fact_quality",
      "015_parser_gaps",
      "016_symbol_identities",
      "017_required_check_state_binding",
      "018_audit_object_hashes",
      "019_scan_capability_reports",
      "020_machine_contract_versions",
      "021_graph_evidence_confidence",
      "022_fact_imported_name",
      "023_security_boundary_proofs",
      "024_phase7_candidate_election_metadata",
      "025_security_boundary_proof_runs",
      "026_framework_entrypoints",
      "027_parser_gap_v2_metadata",
      "028_check_runs_refused_status",
      "029_fact_runtime_use",
      "030_graph_diagnostic_import_source",
      "031_scan_capability_engine_provenance",
      "032_finding_conforming_examples",
      "033_convention_candidate_superseded_by",
      "034_declaration_fact_kinds",
      "035_secret_source_read_fact_kind",
      "036_sink_candidate_fact_kind"
    ]);
    storage.close();
  });

  it("applies later migrations to existing databases without losing rows", async () => {
    const databasePath = await tempDatabasePath();
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (id, applied_at)
      VALUES ('001_initial_local_state', '2026-05-10T00:00:00.000Z');
      CREATE TABLE repos (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        convention_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        enforcement_result TEXT NOT NULL,
        status TEXT NOT NULL,
        diff_status TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(repo_id, fingerprint),
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );
      INSERT INTO repos (id, root_path, fingerprint, created_at, updated_at)
      VALUES ('repo_abc', '/repo', 'repo-fp', '2026-05-10T00:00:00.000Z', '2026-05-10T00:00:00.000Z');
    `);
    db.close();

    const storage = openDriftStorage({ databasePath });
    storage.migrate();

    expect(storage.getAppliedMigrations()).toEqual([
      "001_initial_local_state",
      "002_scan_facts",
      "003_repo_contracts_and_conventions",
      "004_backup_manifests",
      "005_audit_integrity",
      "006_fact_graph_artifacts",
      "007_fact_graph_v2_projections",
      "008_scan_file_changes",
      "009_symbol_occurrence_kind",
      "010_audit_sequence",
      "011_check_runs_and_finding_context",
      "012_repo_identity",
      "013_required_check_executions",
      "014_fact_quality",
      "015_parser_gaps",
      "016_symbol_identities",
      "017_required_check_state_binding",
      "018_audit_object_hashes",
      "019_scan_capability_reports",
      "020_machine_contract_versions",
      "021_graph_evidence_confidence",
      "022_fact_imported_name",
      "023_security_boundary_proofs",
      "024_phase7_candidate_election_metadata",
      "025_security_boundary_proof_runs",
      "026_framework_entrypoints",
      "027_parser_gap_v2_metadata",
      "028_check_runs_refused_status",
      "029_fact_runtime_use",
      "030_graph_diagnostic_import_source",
      "031_scan_capability_engine_provenance",
      "032_finding_conforming_examples",
      "033_convention_candidate_superseded_by",
      "034_declaration_fact_kinds",
      "035_secret_source_read_fact_kind",
      "036_sink_candidate_fact_kind"
    ]);
    expect(storage.getRepo("repo_abc")?.fingerprint).toBe("repo-fp");
    storage.close();
  });

  it("records audit integrity migration when audit hash columns already exist", async () => {
    const databasePath = await tempDatabasePath();
    let storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.close();

    const db = new Database(databasePath);
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("005_audit_integrity");
    db.close();

    storage = openDriftStorage({ databasePath });
    expect(() => storage.migrate()).not.toThrow();
    expect(storage.getAppliedMigrations()).toContain("005_audit_integrity");
    storage.close();

    const verificationDb = new Database(databasePath);
    const columns = verificationDb
      .prepare("PRAGMA table_info(audit_events)")
      .all()
      .map((row) => (row as { name: string }).name);
    verificationDb.close();

    expect(columns).toContain("previous_event_hash");
    expect(columns).toContain("event_hash");
  });

  it("rolls back writes when a storage transaction fails", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    expect(() =>
      storage.transaction(() => {
        storage.upsertRepo({
          id: "repo_tx",
          root_path: "/repo",
          fingerprint: "repo-fp",
          created_at: "2026-05-10T00:00:00.000Z",
          updated_at: "2026-05-10T00:00:00.000Z"
        });
        throw new Error("rollback me");
      })
    ).toThrow("rollback me");

    expect(storage.getRepo("repo_tx")).toBeUndefined();
    storage.close();
  });

  it("persists backup manifests for local state traceability", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.upsertBackupManifest({
      id: "backup_abc",
      repo_id: "repo_abc",
      repo_fingerprint: "repo-fp",
      schema_version: 5,
      source_database_path: "/state/drift.sqlite",
      backup_path: "/backups/repo_abc.drift-backup.sqlite",
      checksum_sha256: "a".repeat(64),
      size_bytes: 2048,
      created_at: "2026-05-10T00:00:01.000Z"
    });

    expect(storage.listBackupManifests("repo_abc")).toEqual([{
      id: "backup_abc",
      repo_id: "repo_abc",
      repo_fingerprint: "repo-fp",
      schema_version: 5,
      source_database_path: "/state/drift.sqlite",
      backup_path: "/backups/repo_abc.drift-backup.sqlite",
      checksum_sha256: "a".repeat(64),
      size_bytes: 2048,
      created_at: "2026-05-10T00:00:01.000Z"
    }]);
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
    storage.upsertCheckRun({
      id: "check_abc",
      repo_id: "repo_abc",
      repo_contract_id: "contract_abc",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_abc",
      status: "fail",
      scope: "changed-hunks",
      engine_source: "rust",
      fallback_used: false,
      stale_scan: false,
      capability_complete: true,
      findings_count: 1,
      blocking_count: 1,
      started_at: "2026-05-10T00:00:01.500Z",
      completed_at: "2026-05-10T00:00:02.000Z",
      machine_contract_versions: {
        schema_version: "drift.machine_contract_versions.v1",
        cli_version: "0.1.0",
        core_version: "0.1.0",
        storage_schema_version: 23,
        contract_schema_version: 1,
        engine_contract_versions: {
          scan_request: "engine.scan.request.v1",
          scan_result: "engine.scan.result.v1",
          check_request: "engine.check.request.v1",
          check_result: "engine.check.result.v1",
          candidates_result: "engine.candidates.result.v1",
          stream_event: "engine.stream.event.v1"
        },
        factgraph_schema_version: "factgraph.v2",
        scanner_version: "0.1.0",
        rule_engine_version: "0.1.0",
        adapter_versions: { typescript: "0.1.0" }
      }
    });
    storage.upsertFinding({
      id: "finding_abc",
      repo_id: "repo_abc",
      convention_id: "convention_abc",
      check_id: "check_abc",
      repo_contract_id: "contract_abc",
      fingerprint: "finding-fp",
      title: "API route imports data access directly",
      message: "Route imports prisma directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [],
      expected_layer: "service",
      actual_layer: "data_access",
      graph_path: ["route:users", "import:prisma", "data:prisma"],
      suggested_fix: "Move data access behind a service.",
      related_node_ids: ["route:users", "data:prisma"],
      created_by_engine_version: "0.1.0",
      created_by_rule_engine_version: "0.1.0",
      contract_schema_version: 1,
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
        end_line: 1,
        ...factQuality()
      },
      {
        id: "fact_api_role",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "apps/web/app/api/users/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1,
        ...factQuality()
      }
    ]);

    expect(storage.getRepo("repo_abc")?.fingerprint).toBe("repo-fp");
    expect(storage.getScanManifest("scan_abc")?.adapter_versions).toEqual({ typescript: "0.1.0" });
    expect(storage.listScanManifests("repo_abc")[0]?.id).toBe("scan_abc");
    expect(storage.listCheckRuns("repo_abc")).toEqual([
      expect.objectContaining({
        id: "check_abc",
        repo_contract_id: "contract_abc",
        machine_contract_versions: expect.objectContaining({
          schema_version: "drift.machine_contract_versions.v1",
          storage_schema_version: 23,
          factgraph_schema_version: "factgraph.v2"
        }),
        status: "fail",
        capability_complete: true
      })
    ]);
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
        end_line: 1,
        ...factQuality()
      }
    ]);
    expect(storage.listFindings("repo_abc")).toEqual([
      expect.objectContaining({
        id: "finding_abc",
        check_id: "check_abc",
        repo_contract_id: "contract_abc",
        expected_layer: "service",
        actual_layer: "data_access",
        graph_path: ["route:users", "import:prisma", "data:prisma"],
        suggested_fix: "Move data access behind a service.",
        related_node_ids: ["route:users", "data:prisma"],
        created_by_engine_version: "0.1.0",
        created_by_rule_engine_version: "0.1.0",
        contract_schema_version: 1
      })
    ]);
    expect(storage.listBaselineViolations("repo_abc")).toHaveLength(1);
    storage.close();
  });

  it("persists normalized framework entrypoints for product read models", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_framework",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_framework",
      repo_id: "repo_framework",
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
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertFrameworkScanData({
      repoId: "repo_framework",
      scanId: "scan_framework",
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
        entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
        repo_id: "repo_framework",
        scan_id: "scan_framework",
        adapter_id: "framework_adapter_next_v1",
        framework: "next_app",
        kind: "api_route",
        file_path: "app/api/users/route.ts",
        route_pattern: "/api/users",
        method: "GET",
        middleware_refs: [],
        request_source_refs: [],
        response_sink_refs: [],
        data_operation_refs: [],
        confidence_label: "high",
        evidence_refs: ["fact:app/api/users/route.ts:route_declared:GET:1-1"],
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

    expect(storage.listNormalizedEntrypoints("repo_framework", "scan_framework")).toMatchObject([{
      entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
      repo_id: "repo_framework",
      scan_id: "scan_framework",
      framework: "next_app",
      route_pattern: "/api/users"
    }]);
    expect(storage.listFrameworkCapabilities("repo_framework", "scan_framework")).toMatchObject([{
      framework: "next_app",
      capability: "entrypoint_discovery",
      can_block: true
    }]);
    expect(storage.listFrameworkAdapters("repo_framework", "scan_framework")).toHaveLength(1);
    storage.close();
  });

  it("persists fact quality provenance fields", async () => {
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
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertFacts([{
      id: "fact_route_users_get",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "route_declared",
      file_path: "app/api/users/route.ts",
      name: "GET /api/users",
      value: "/api/users",
      start_line: 1,
      end_line: 3,
      source_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 },
      ast_node_kind: "ExportedFunction",
      extraction_method: "next_app_router_parser",
      extractor_version: "0.1.0",
      parser_version: "0.1.0",
      confidence: 0.98,
      confidence_label: "high",
      evidence_level: "ast",
      resolution_status: "resolved",
      staleness_status: "fresh",
      last_seen_scan_id: "scan_abc"
    }]);

    expect(storage.listFacts("scan_abc")[0]).toMatchObject({
      extraction_method: "next_app_router_parser",
      confidence_label: "high",
      resolution_status: "resolved",
      evidence_level: "ast",
      source_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 }
    });
    storage.close();
  });

  it("persists required check execution proof for later CLI and MCP reads", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });

    storage.recordRequiredCheckExecution({
      schema_version: "drift.required_check_execution.v1",
      execution_id: "required_check_exec_abc",
      repo_id: "repo_abc",
      repo_root: "/repo",
      repo_commit: "abc123",
      git_branch: "main",
      git_commit_sha: "abc123",
      worktree_dirty: false,
      untracked_files_present: false,
      scan_id: "scan_abc",
      repo_contract_id: "contract_abc",
      agent_contract_id: "agent_contract_checks",
      contract_fingerprint: "contract-fp",
      repo_contract_version: 1,
      command: "node scripts/smoke-check.mjs",
      argv: ["node", "scripts/smoke-check.mjs"],
      command_hash: "hash_command",
      diff_hash: "diff-fp",
      lockfile_hash: null,
      package_manager: null,
      cwd: "/repo",
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z",
      timeout_ms: 30000,
      exit_code: 0,
      status: "passed",
      stdout_hash: "hash_stdout",
      stderr_hash: "hash_stderr",
      stdout_preview: "ok",
      stderr_preview: "",
      audit_event_id: "audit_required_check"
    });

    expect(storage.latestRequiredCheckExecution("repo_abc", "node scripts/smoke-check.mjs")).toMatchObject({
      execution_id: "required_check_exec_abc",
      argv: ["node", "scripts/smoke-check.mjs"],
      status: "passed",
      diff_hash: "diff-fp",
      contract_fingerprint: "contract-fp"
    });
    expect(storage.listRequiredCheckExecutions("repo_abc", {
      command: "node scripts/smoke-check.mjs",
      scan_id: "scan_abc",
      repo_contract_id: "contract_abc"
    })).toHaveLength(1);
    storage.close();
  });

  it("persists security boundary proofs with normalized entrypoint ids", async () => {
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
      file_count: 1,
      fact_count: 1,
      finding_count: 1,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertSecurityBoundaryProofs({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      created_at: "2026-05-10T00:00:02.000Z",
      proofs: [{
        proof_id: "proof:route:app/api/users/route.ts:GET:phase5",
        proof_version: "security-boundary-proof/v1",
        route: {
          route_id: "route:app/api/users/route.ts:GET",
          normalized_entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET",
          file_path: "app/api/users/route.ts",
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
            field_fact_id: "fact:app/api/users/route.ts:3",
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
          fact_ids: ["fact:app/api/users/route.ts:3"],
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

    expect(storage.listSecurityBoundaryProofs("repo_abc", "scan_abc")[0]).toMatchObject({
      proof_id: "proof:route:app/api/users/route.ts:GET:phase5",
      route: {
        normalized_entrypoint_id: "entrypoint:next_app:app/api/users/route.ts:GET"
      },
      response_shape: {
        required: true,
        sensitive_leaks: [{
          field_path: "user.email",
          reason: "sensitive_field_without_serializer"
        }]
      }
    });
    storage.close();
  });

  it("persists security boundary proof runs by check run without snippets", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_security",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_security",
      repo_id: "repo_security",
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
      started_at: "2026-05-27T00:00:00.000Z",
      completed_at: "2026-05-27T00:00:01.000Z"
    });
    storage.upsertCheckRun({
      id: "check_security",
      repo_id: "repo_security",
      repo_contract_id: "contract_security",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_security",
      status: "fail",
      scope: "full",
      engine_source: "rust",
      fallback_used: false,
      stale_scan: false,
      capability_complete: true,
      findings_count: 1,
      blocking_count: 1,
      started_at: "2026-05-27T00:00:01.000Z",
      completed_at: "2026-05-27T00:00:02.000Z",
    });

    storage.upsertSecurityBoundaryProofRuns({
      repo_id: "repo_security",
      scan_id: "scan_security",
      check_id: "check_security",
      created_at: "2026-05-27T00:00:02.000Z",
      proofs: [validSecurityBoundaryProof({
        proof_id: "proof_route_users_get",
        route: {
          route_id: "route_users_get",
          file_path: "app/api/users/route.ts",
          file_role: "api_route",
          endpoint: { path: "/api/users", method: "GET", framework: "next" }
        },
        missing_proof: [{
          id: "missing_auth",
          capability: "control_flow_guard_dominance",
          code: "auth_guard_not_dominating_sink",
          blocks_enforcement: true,
          fact_ids: ["fact_sink"],
          graph_edge_ids: []
        }],
        parser_gaps: [],
        result: {
          proof_status: "missing_proof",
          enforcement_result: "block",
          can_block: true,
          finding_ids: ["finding_auth"]
        }
      })]
    });

    const rows = storage.listSecurityBoundaryProofRuns({
      repo_id: "repo_security",
      check_id: "check_security"
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.missing_proof_count).toBe(1);
    expect(rows[0]?.affected_files).toEqual(["app/api/users/route.ts"]);
    expect(JSON.stringify(rows[0])).not.toContain("select *");
    expect(JSON.stringify(rows[0])).not.toContain("secret=");
    storage.close();
  });

  it("lists latest security boundary proof runs by repo across check scan ids", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_security",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_indexed",
      repo_id: "repo_security",
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
      started_at: "2026-05-27T00:00:00.000Z",
      completed_at: "2026-05-27T00:00:01.000Z"
    });
    storage.upsertCheckRun({
      id: "check_security",
      repo_id: "repo_security",
      repo_contract_id: "contract_security",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_indexed",
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
      repo_id: "repo_security",
      scan_id: "scan_check_security",
      check_id: "check_security",
      created_at: "2026-05-27T00:00:02.000Z",
      proofs: [validSecurityBoundaryProof({
        route: {
          route_id: "route_users_get",
          file_path: "app/api/users/route.ts",
          file_role: "api_route",
          endpoint: { path: "/api/users", method: "GET", framework: "next" }
        }
      })]
    });

    const latestRows = storage.listLatestSecurityBoundaryProofRunsForRepo({
      repo_id: "repo_security",
      file_path: "app/api/users/route.ts"
    });

    expect(latestRows).toHaveLength(1);
    expect(latestRows[0]?.check_id).toBe("check_security");
    expect(latestRows[0]?.scan_id).toBe("scan_check_security");
    storage.close();
  });

  it("lists file snapshots for a scan", async () => {
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
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    storage.upsertFileSnapshot({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "apps/web/app/api/users/route.ts",
      content_hash: "hash-abc",
      byte_size: 100,
      indexed: true
    });

    expect(storage.listFileSnapshots("repo_abc", "scan_abc")).toEqual([
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "apps/web/app/api/users/route.ts",
        content_hash: "hash-abc",
        byte_size: 100,
        indexed: true
      }
    ]);
    storage.close();
  });

  it("persists scan file change records", async () => {
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
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertScanFileChanges([
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "apps/web/app/api/users/route.ts",
        change_kind: "modified",
        previous_hash: "old-hash",
        current_hash: "new-hash",
        created_at: "2026-05-10T00:00:01.000Z"
      }
    ]);

    expect(storage.listScanFileChanges("repo_abc", "scan_abc")).toEqual([
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "apps/web/app/api/users/route.ts",
        change_kind: "modified",
        previous_hash: "old-hash",
        current_hash: "new-hash",
        created_at: "2026-05-10T00:00:01.000Z"
      }
    ]);
    storage.close();
  });

  it("persists parser gaps for scan confidence summaries", async () => {
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
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_unresolved_users",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "unresolved_import",
      file_path: "app/api/users/route.ts",
      start_line: 2,
      end_line: 2,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:00:02.000Z"
    }]);

    expect(storage.listParserGaps("repo_abc", "scan_abc")).toEqual([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_unresolved_users",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "unresolved_import",
      file_path: "app/api/users/route.ts",
      start_line: 2,
      end_line: 2,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:00:02.000Z"
    }]);
    expect(storage.listParserGaps("repo_abc")).toHaveLength(1);
    storage.close();
  });

  it("persists scan capability reports for scan proof", async () => {
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
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    const report = {
      schema_version: "drift.scan_capability_report.v1" as const,
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      engine_source: "rust" as const,
      engine_version: "0.1.0",
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      certified_capabilities: ["file_discovery", "syntax_facts", "fact_graph"],
      required_capabilities: ["file_discovery", "fact_graph"],
      missing_capabilities: [],
      completeness: [{
        scope: "repo" as const,
        complete: true,
        can_block: true,
        reasons: []
      }],
      parser_gap_count: 1,
      parser_gap_kinds: { unresolved_import: 1 },
      fallback_used: false,
      enforcement_degraded: false,
      // BB-2: engine provenance round-trips, so a stored scan can be told apart from one taken
      // through a debug `cargo run` engine after the fact.
      engine_resolution: "env_override" as const,
      engine_build_profile: "release" as const,
      created_at: "2026-05-25T00:00:00.000Z"
    };
    const storageWithReports = storage as typeof storage & {
      upsertScanCapabilityReport(input: typeof report): void;
      getScanCapabilityReport(repoId: string, scanId: string): typeof report | undefined;
    };

    storageWithReports.upsertScanCapabilityReport(report);

    expect(storageWithReports.getScanCapabilityReport("repo_abc", "scan_abc")).toEqual(report);
    storage.close();
  });

  it("deduplicates parser gaps by semantic location and message within a scan", async () => {
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
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertParserGaps([
      {
        schema_version: "drift.parser_gap.v1",
        gap_id: "parser_gap_first",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "unresolved_import",
        file_path: "packages/core/test/domain.test.ts",
        start_line: 1,
        end_line: 1,
        confidence_impact: "lowers_flow",
        message: "Could not resolve import ../src/index.js.",
        evidence_refs: ["diagnostic_a"],
        created_at: "2026-05-10T00:00:02.000Z"
      },
      {
        schema_version: "drift.parser_gap.v1",
        gap_id: "parser_gap_second",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "unresolved_import",
        file_path: "packages/core/test/domain.test.ts",
        start_line: 1,
        end_line: 1,
        confidence_impact: "lowers_flow",
        message: "Could not resolve import ../src/index.js.",
        evidence_refs: ["diagnostic_b"],
        created_at: "2026-05-10T00:00:03.000Z"
      }
    ]);

    expect(storage.listParserGaps("repo_abc", "scan_abc")).toEqual([
      expect.objectContaining({
        gap_id: "parser_gap_first",
        evidence_refs: ["diagnostic_a", "diagnostic_b"]
      })
    ]);
    storage.close();
  });

  it("persists parser gap v2 semantic metadata", async () => {
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
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertParserGapV2([{
      schema_version: "drift.parser_gap.v2",
      parser_gap_id: "gap_dynamic_import_route_1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      file_path: "app/api/users/route.ts",
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

    expect(storage.listParserGapV2("repo_abc", "scan_abc")).toEqual([
      expect.objectContaining({
        parser_gap_id: "gap_dynamic_import_route_1",
        affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
        affected_contract_kinds: ["api_route_no_direct_data_access"],
        suggested_action: "rewrite_static"
      })
    ]);
    storage.close();
  });

  it("persists symbol identities for alias and re-export analysis", async () => {
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
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });

    storage.upsertSymbolIdentities([{
      schema_version: "drift.symbol_identity.v1",
      symbol_id: "symbol_get_user",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      symbol_name: "getUserById",
      kind: "function",
      declared_in: "server/services/users.ts",
      exported_from: ["server/services/users.ts", "server/services/index.ts"],
      imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }],
      re_export_chain: ["server/services/index.ts"],
      canonical_definition: "server/services/users.ts#getUserById",
      call_sites: [{ file_path: "app/api/users/route.ts", start_line: 4, end_line: 4 }],
      references: [{ file_path: "app/api/users/route.ts", start_line: 1, end_line: 1 }],
      visibility: "exported"
    }]);

    expect(storage.listSymbolIdentities("repo_abc", "scan_abc")[0]).toMatchObject({
      symbol_id: "symbol_get_user",
      canonical_definition: "server/services/users.ts#getUserById",
      imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }]
    });
    expect(storage.listSymbolIdentities("repo_abc")).toHaveLength(1);
    storage.upsertScanManifest({
      id: "scan_def",
      repo_id: "repo_abc",
      branch: "main",
      commit: "def456",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0", resolver: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      previous_scan_id: "scan_abc",
      started_at: "2026-05-10T00:00:02.000Z",
      completed_at: "2026-05-10T00:00:03.000Z"
    });
    storage.upsertSymbolIdentities([{
      schema_version: "drift.symbol_identity.v1",
      symbol_id: "symbol_get_user",
      repo_id: "repo_abc",
      scan_id: "scan_def",
      symbol_name: "getUserById",
      kind: "function",
      declared_in: "server/services/users.ts",
      exported_from: ["server/services/users.ts"],
      imported_as: [],
      re_export_chain: [],
      canonical_definition: "server/services/users.ts#getUserById",
      call_sites: [],
      references: [],
      visibility: "exported"
    }]);
    expect(storage.listSymbolIdentities("repo_abc", "scan_abc")).toHaveLength(1);
    expect(storage.listSymbolIdentities("repo_abc", "scan_def")).toHaveLength(1);
    expect(storage.listSymbolIdentities("repo_abc")).toHaveLength(2);
    storage.close();
  });

  it("persists versioned fact graph artifacts and query projections", async () => {
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
      file_count: 1,
      fact_count: 1,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    const graph = buildFactGraphArtifact({
      // Declared explicitly: the fallback now defaults to incomplete (T11b), so a caller
      // that means "full coverage" has to say so. See the default-fallback test below.
      completeness: [{
        scope: "repo",
        complete: true,
        required_capabilities: ["file_discovery", "syntax_facts"],
        missing_capabilities: [],
        truncated: false,
        can_block: true,
        reasons: []
      }],
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        root_hash: "root-fp",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [{
        id: "fact_route_role",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "app/api/users/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 3,
        ...factQuality()
      }],
      createdAt: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFactGraphArtifact(graph);

    expect(storage.getFactGraphArtifact("repo_abc", "scan_abc")).toMatchObject({
      id: "graph_scan_abc",
      schema_version: "factgraph.v2",
      node_count: graph.node_count,
      edge_count: graph.edge_count,
      evidence_count: graph.evidence_count
    });
    expect(storage.listGraphNodes("repo_abc", "scan_abc")).toContainEqual(expect.objectContaining({
      id: "file:app/api/users/route.ts",
      kind: "file",
      label: "app/api/users/route.ts",
      stable: true
    }));
    expect(storage.listGraphEvidence("repo_abc", "scan_abc")).toContainEqual(expect.objectContaining({
      id: "evidence:typescript:app/api/users/route.ts:aaaaaaaaaaaa:1-3",
      file_path: "app/api/users/route.ts",
      confidence_kind: "deterministic",
      extractor: "test_fixture",
      snippet_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      fact_ids: ["fact_route_role"]
    }));
    expect(storage.listGraphCompleteness("repo_abc", "scan_abc")).toEqual([expect.objectContaining({
      scope: "repo",
      complete: true,
      can_block: true
    })]);

    // T40: the graph must not be stored twice. nodes/edges/evidence live in their own tables;
    // graph_json keeps only the small metadata. On dub the duplicate blob was 206 MB of a
    // 599 MB database. The artifact callers receive is still complete, rehydrated on read.
    const roundTripped = storage.getFactGraphArtifact("repo_abc", "scan_abc");
    expect(roundTripped?.graph.nodes.length).toBeGreaterThan(0);
    expect(roundTripped?.graph.nodes.map((node) => node.id).sort()).toEqual(
      storage.listGraphNodes("repo_abc", "scan_abc").map((node) => node.id).sort()
    );
    storage.close();
  });

  it("deduplicates repeated stable graph projection records from streamed engine batches", async () => {
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
      id: "scan_dup",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    const snapshots = [{
      repo_id: "repo_abc",
      scan_id: "scan_dup",
      file_path: "app/api/users/route.ts",
      content_hash: "a".repeat(64),
      byte_size: 100,
      indexed: true
    }];
    const repeatedRoleNodeA = {
      id: "file_role:api_route",
      kind: "file_role",
      label: "api_route",
      stable: true,
      evidence_ids: ["evidence_a"],
      metadata: { role: "api_route" }
    };
    const repeatedRoleNodeB = {
      ...repeatedRoleNodeA,
      evidence_ids: ["evidence_b"],
      metadata: { role: "api_route", inferred_from: "route_path" }
    };
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_dup",
        root_hash: "root-fp",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        repeatedRoleNodeA,
        repeatedRoleNodeB,
        {
          id: "file:app/api/users/route.ts",
          kind: "file",
          label: "app/api/users/route.ts",
          stable: true,
          evidence_ids: [],
          metadata: { path: "app/api/users/route.ts" }
        }
      ],
      edges: [
        {
          id: "edge:file:app/api/users/route.ts:FILE_HAS_ROLE:file_role:api_route",
          kind: "FILE_HAS_ROLE",
          from: "file:app/api/users/route.ts",
          to: "file_role:api_route",
          evidence_ids: ["evidence_a"],
          metadata: { first_seen: true }
        },
        {
          id: "edge:file:app/api/users/route.ts:FILE_HAS_ROLE:file_role:api_route",
          kind: "FILE_HAS_ROLE",
          from: "file:app/api/users/route.ts",
          to: "file_role:api_route",
          evidence_ids: ["evidence_b"],
          metadata: { repeated_batch: true }
        }
      ],
      evidence: [
        {
          id: "evidence_a",
          repo_id: "repo_abc",
          scan_id: "scan_dup",
          artifact_id: "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
          file_path: "app/api/users/route.ts",
          file_hash: "a".repeat(64),
          start_line: 1,
          end_line: 1,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_a"],
          redaction_state: "none"
        },
        {
          id: "evidence_a",
          repo_id: "repo_abc",
          scan_id: "scan_dup",
          artifact_id: "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
          file_path: "app/api/users/route.ts",
          file_hash: "a".repeat(64),
          start_line: 1,
          end_line: 1,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_b"],
          redaction_state: "none"
        }
      ],
      createdAt: "2026-05-10T00:00:02.000Z"
    }));

    const roleNodes = storage.listGraphNodes("repo_abc", "scan_dup")
      .filter((node) => node.id === "file_role:api_route");
    expect(roleNodes).toHaveLength(1);
    expect(roleNodes[0]?.evidence_ids).toEqual(["evidence_a", "evidence_b"]);
    expect(roleNodes[0]?.metadata).toMatchObject({ role: "api_route", inferred_from: "route_path" });
    const roleEdges = storage.listGraphEdges("repo_abc", "scan_dup")
      .filter((edge) => edge.id === "edge:file:app/api/users/route.ts:FILE_HAS_ROLE:file_role:api_route");
    expect(roleEdges).toHaveLength(1);
    expect(roleEdges[0]?.evidence_ids).toEqual(["evidence_a", "evidence_b"]);
    expect(roleEdges[0]?.metadata).toMatchObject({ first_seen: true, repeated_batch: true });
    expect(storage.listGraphEvidence("repo_abc", "scan_dup")
      .filter((evidence) => evidence.id === "evidence_a")[0]?.fact_ids).toEqual(["fact_a", "fact_b"]);
    storage.close();
  });

  it("projects resolver dependencies and module dependents from graph edges", async () => {
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
      id: "scan_deps",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_deps",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_deps",
        file_path: "packages/db/src/index.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];

    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_deps",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        {
          id: "file:app/api/users/route.ts",
          kind: "file",
          label: "app/api/users/route.ts",
          stable: true,
          evidence_ids: [],
          metadata: { path: "app/api/users/route.ts" }
        },
        {
          id: "module:app/api/users/route.ts",
          kind: "module",
          label: "app/api/users/route.ts",
          stable: true,
          evidence_ids: [],
          metadata: { file_path: "app/api/users/route.ts" }
        },
        {
          id: "module:packages/db/src/index.ts",
          kind: "module",
          label: "packages/db/src/index.ts",
          stable: true,
          evidence_ids: [],
          metadata: { file_path: "packages/db/src/index.ts" }
        },
        {
          id: "import_decl:app/api/users/route.ts:db",
          kind: "import_decl",
          label: "db from @acme/db",
          stable: false,
          evidence_ids: ["evidence_import"],
          metadata: {
            file_path: "app/api/users/route.ts",
            source: "@acme/db",
            resolved_file_path: "packages/db/src/index.ts"
          }
        }
      ],
      edges: [
        {
          id: "edge:import_decl:app/api/users/route.ts:db:IMPORT_DECL_REFERENCES_MODULE:module:app/api/users/route.ts",
          kind: "IMPORT_DECL_REFERENCES_MODULE",
          from: "import_decl:app/api/users/route.ts:db",
          to: "module:app/api/users/route.ts",
          evidence_ids: ["evidence_import"],
          metadata: {}
        },
        {
          id: "edge:import_decl:app/api/users/route.ts:db:IMPORT_RESOLVES_TO_MODULE:module:packages/db/src/index.ts",
          kind: "IMPORT_RESOLVES_TO_MODULE",
          from: "import_decl:app/api/users/route.ts:db",
          to: "module:packages/db/src/index.ts",
          evidence_ids: ["evidence_import"],
          metadata: {
            resolved_file_path: "packages/db/src/index.ts",
            resolution_status: "resolved"
          }
        },
        {
          id: "edge:module:app/api/users/route.ts:MODULE_IMPORTS_MODULE:module:packages/db/src/index.ts",
          kind: "MODULE_IMPORTS_MODULE",
          from: "module:app/api/users/route.ts",
          to: "module:packages/db/src/index.ts",
          evidence_ids: ["evidence_import"],
          metadata: {}
        }
      ],
      evidence: [
        {
          id: "evidence_import",
          repo_id: "repo_abc",
          scan_id: "scan_deps",
          artifact_id: "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
          file_path: "app/api/users/route.ts",
          file_hash: "a".repeat(64),
          start_line: 1,
          end_line: 1,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_import"],
          redaction_state: "none"
        }
      ],
      createdAt: "2026-05-10T00:00:02.000Z"
    }));

    expect(storage.listResolverDependencies("repo_abc", "scan_deps")).toEqual([{
      repo_id: "repo_abc",
      scan_id: "scan_deps",
      id: "resolver_dependency:app/api/users/route.ts:packages/db/src/index.ts:resolved_module",
      source_path: "app/api/users/route.ts",
      dependency_path: "packages/db/src/index.ts",
      dependency_kind: "resolved_module"
    }]);
    expect(storage.listModuleDependents("repo_abc", "scan_deps")).toEqual([{
      repo_id: "repo_abc",
      scan_id: "scan_deps",
      module_id: "module:packages/db/src/index.ts",
      dependent_module_id: "module:app/api/users/route.ts",
      edge_id: "edge:module:app/api/users/route.ts:MODULE_IMPORTS_MODULE:module:packages/db/src/index.ts"
    }]);

    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_deps",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [],
      edges: [],
      evidence: [],
      createdAt: "2026-05-10T00:00:03.000Z"
    }));

    expect(storage.listResolverDependencies("repo_abc", "scan_deps")).toEqual([]);
    expect(storage.listModuleDependents("repo_abc", "scan_deps")).toEqual([]);
    storage.close();
  });

  it("projects symbol occurrences from graph declarations and symbol-resolution edges", async () => {
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
      id: "scan_symbols",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-10T00:00:00.000Z",
      completed_at: "2026-05-10T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "src/services/users.ts",
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "app/api/users/route.ts",
        content_hash: "b".repeat(64),
        byte_size: 100,
        indexed: true
      }
    ];
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        root_hash: "root-fp",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        {
          id: "symbol:src/services/users.ts:function:listUsers",
          kind: "symbol",
          label: "listUsers",
          stable: true,
          evidence_ids: ["evidence_decl"],
          metadata: { file_path: "src/services/users.ts", symbol_kind: "function", exported: true }
        },
        {
          id: "import_decl:app/api/users/route.ts:bbbbbbbbbbbb:@/services/users:listUsers:1-1",
          kind: "import_decl",
          label: "listUsers from @/services/users",
          stable: false,
          evidence_ids: ["evidence_ref"],
          metadata: { file_path: "app/api/users/route.ts", source: "@/services/users", local_name: "listUsers" }
        },
        {
          id: "callsite:app/api/users/route.ts:bbbbbbbbbbbb:listUsers:3-3",
          kind: "callsite",
          label: "listUsers",
          stable: false,
          evidence_ids: ["evidence_call"],
          metadata: { file_path: "app/api/users/route.ts", callee_name: "listUsers" }
        }
      ],
      edges: [
        {
          id: "edge:import:listUsers",
          kind: "IMPORT_RESOLVES_TO_SYMBOL",
          from: "import_decl:app/api/users/route.ts:bbbbbbbbbbbb:@/services/users:listUsers:1-1",
          to: "symbol:src/services/users.ts:function:listUsers",
          evidence_ids: ["evidence_ref"],
          metadata: {}
        },
        {
          id: "edge:call:listUsers",
          kind: "CALLSITE_REFERENCES_SYMBOL",
          from: "callsite:app/api/users/route.ts:bbbbbbbbbbbb:listUsers:3-3",
          to: "import_decl:app/api/users/route.ts:bbbbbbbbbbbb:@/services/users:listUsers:1-1",
          evidence_ids: ["evidence_call"],
          metadata: {}
        }
      ],
      evidence: [
        {
          id: "evidence_decl",
          repo_id: "repo_abc",
          scan_id: "scan_symbols",
          artifact_id: "file_version:src/services/users.ts:aaaaaaaaaaaa",
          file_path: "src/services/users.ts",
          file_hash: "a".repeat(64),
          start_line: 2,
          end_line: 2,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_decl"],
          redaction_state: "none"
        },
        {
          id: "evidence_ref",
          repo_id: "repo_abc",
          scan_id: "scan_symbols",
          artifact_id: "file_version:app/api/users/route.ts:bbbbbbbbbbbb",
          file_path: "app/api/users/route.ts",
          file_hash: "b".repeat(64),
          start_line: 1,
          end_line: 1,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_import"],
          redaction_state: "none"
        },
        {
          id: "evidence_call",
          repo_id: "repo_abc",
          scan_id: "scan_symbols",
          artifact_id: "file_version:app/api/users/route.ts:bbbbbbbbbbbb",
          file_path: "app/api/users/route.ts",
          file_hash: "b".repeat(64),
          start_line: 3,
          end_line: 3,
          adapter_id: "typescript",
          adapter_version: "0.1.0",
          fact_ids: ["fact_call"],
          redaction_state: "none"
        }
      ],
      createdAt: "2026-05-10T00:00:02.000Z"
    }));

    expect(storage.listSymbolOccurrences("repo_abc", "scan_symbols")).toEqual([
      expect.objectContaining({
        symbol_id: "symbol:src/services/users.ts:function:listUsers",
        occurrence_kind: "reference",
        file_path: "app/api/users/route.ts",
        start_line: 1
      }),
      expect.objectContaining({
        symbol_id: "symbol:src/services/users.ts:function:listUsers",
        occurrence_kind: "reference",
        file_path: "app/api/users/route.ts",
        start_line: 3
      }),
      expect.objectContaining({
        symbol_id: "symbol:src/services/users.ts:function:listUsers",
        occurrence_kind: "declaration",
        file_path: "src/services/users.ts",
        start_line: 2
      })
    ]);
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

  it("chains audit events and detects tampering", async () => {
    const databasePath = await tempDatabasePath();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();

    storage.appendAuditEvent({
      id: "audit_event_a",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "repo_added",
      target_type: "repo",
      target_id: "repo_abc",
      metadata: { root_path: "/repo" },
      created_at: "2026-05-10T00:00:00.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_b",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "policy_changed",
      target_type: "policy",
      target_id: "policy_abc",
      metadata: { mode: "local_only" },
      created_at: "2026-05-10T00:00:01.000Z"
    });

    const events = storage.listAuditEvents("repo_abc");
    expect(events[0]?.event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(events[1]?.previous_event_hash).toBe(events[0]?.event_hash);
    storage.appendAuditEvent({
      id: "audit_event_c",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "policy_changed",
      target_type: "repo_contract",
      target_id: "contract_abc",
      metadata: {},
      before_hash: "0".repeat(64),
      after_hash: "1".repeat(64),
      object_schema_version: "drift.repo_contract.v1",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    expect(storage.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      before_hash: "0".repeat(64),
      after_hash: "1".repeat(64),
      object_schema_version: "drift.repo_contract.v1"
    });
    expect(storage.verifyAuditChain("repo_abc")).toMatchObject({
      valid: true,
      event_count: 3,
      verified_count: 3,
      broken_at_event_id: null,
      reasons: []
    });
    storage.close();

    const db = new Database(databasePath);
    db.prepare("UPDATE audit_events SET metadata_json = ? WHERE id = ?")
      .run(JSON.stringify({ mode: "approval_required" }), "audit_event_b");
    db.close();

    const tampered = openDriftStorage({ databasePath });
    expect(tampered.verifyAuditChain("repo_abc")).toMatchObject({
      valid: false,
      event_count: 3,
      verified_count: 1,
      broken_at_event_id: "audit_event_b",
      reasons: ["event_hash_mismatch"]
    });
    tampered.close();
  });

  it("detects tampering with audited object hashes", async () => {
    const databasePath = await tempDatabasePath();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();

    storage.appendAuditEvent({
      id: "audit_event_object_hash",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "policy_changed",
      target_type: "repo_contract",
      target_id: "contract_abc",
      metadata: {},
      before_hash: "0".repeat(64),
      after_hash: "1".repeat(64),
      object_schema_version: "drift.repo_contract.v1",
      created_at: "2026-05-10T00:00:02.000Z"
    });
    expect(storage.verifyAuditChain("repo_abc")).toMatchObject({ valid: true });
    storage.close();

    const db = new Database(databasePath);
    db.prepare("UPDATE audit_events SET after_hash = ? WHERE id = ?")
      .run("2".repeat(64), "audit_event_object_hash");
    db.close();

    const tampered = openDriftStorage({ databasePath });
    expect(tampered.verifyAuditChain("repo_abc")).toMatchObject({
      valid: false,
      event_count: 1,
      verified_count: 0,
      broken_at_event_id: "audit_event_object_hash",
      reasons: ["event_hash_mismatch"]
    });
    tampered.close();
  });

  it("assigns monotonic audit sequences and strict verification detects gaps", async () => {
    const databasePath = await tempDatabasePath();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();

    storage.appendAuditEvent({
      id: "audit_event_seq_a",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "repo_added",
      target_type: "repo",
      target_id: "repo_abc",
      metadata: { root_path: "/repo" },
      created_at: "2026-05-10T00:00:00.000Z"
    });
    storage.appendAuditEvent({
      id: "audit_event_seq_b",
      repo_id: "repo_abc",
      actor: "local-user",
      action: "policy_changed",
      target_type: "policy",
      target_id: "policy_abc",
      metadata: { mode: "local_only" },
      created_at: "2026-05-10T00:00:01.000Z"
    });

    expect(storage.listAuditEvents("repo_abc").map((event) => event.sequence)).toEqual([1, 2]);
    expect(storage.verifyAuditChain("repo_abc", { strict: true })).toMatchObject({
      valid: true,
      strict: true,
      head_sequence: 2,
      reasons: []
    });
    storage.close();

    const db = new Database(databasePath);
    db.prepare("UPDATE audit_events SET sequence = ? WHERE id = ?").run(4, "audit_event_seq_b");
    db.close();

    const tampered = openDriftStorage({ databasePath });
    expect(tampered.verifyAuditChain("repo_abc", { strict: true })).toMatchObject({
      valid: false,
      strict: true,
      event_count: 2,
      verified_count: 1,
      broken_at_event_id: "audit_event_seq_b",
      head_sequence: 1,
      reasons: ["sequence_gap"]
    });
    tampered.close();
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
      required_capabilities: ["syntax_facts"],
      reason_not_blocking: "candidate_not_accepted",
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
      requires: { forbidden_imports: ["@/lib/prisma"] },
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

    expect(storage.getConventionCandidate("candidate_no_direct_db")).toMatchObject({
      status: "candidate",
      requires: { forbidden_imports: ["@/lib/prisma"] },
      evidence_fingerprint: "evidence_fp",
      reason_not_blocking: "candidate_not_accepted"
    });
    expect(storage.listConventionCandidates("repo_abc", { status: "candidate" })).toHaveLength(1);
    expect(storage.listAcceptedConventions("repo_abc")[0]).toMatchObject({
      id: "convention_no_direct_db",
      requires: { forbidden_imports: ["@/lib/prisma"] }
    });
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.id).toBe("convention_no_direct_db");
    storage.close();
  });
});

describe("check_runs refused status (E-1 / S1-02 / D-3)", () => {
  // `check_runs.status` is persisted with a SQL CHECK constraint (migration 011 allowed
  // only pass/fail/blocked), and CheckRunSchema validates rows on write AND read. A check
  // that refuses to enforce (exit 3) must be able to record what it actually did.
  it("round-trips a refused check run through insert and read-back", async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.upsertRepo({
      id: "repo_refused",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z"
    });
    storage.upsertCheckRun({
      id: "check_refused",
      repo_id: "repo_refused",
      repo_contract_id: "contract_abc",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_abc",
      status: "refused",
      scope: "changed-hunks",
      engine_source: "rust",
      fallback_used: false,
      stale_scan: false,
      capability_complete: false,
      findings_count: 1,
      blocking_count: 0,
      started_at: "2026-08-02T00:00:01.000Z",
      completed_at: "2026-08-02T00:00:02.000Z"
    });

    expect(storage.listCheckRuns("repo_refused")[0]).toMatchObject({
      id: "check_refused",
      status: "refused",
      capability_complete: false,
      blocking_count: 0
    });
    storage.close();
  });

  it("still reads legacy blocked rows", async () => {
    // Databases written before E-1 contain 'blocked' rows (the TypeScript-fallback
    // refusal path); the enum keeps the value so old rows stay readable.
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();

    storage.upsertRepo({
      id: "repo_legacy",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z"
    });
    storage.upsertCheckRun({
      id: "check_legacy",
      repo_id: "repo_legacy",
      repo_contract_id: "contract_abc",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_abc",
      status: "blocked",
      scope: "changed-hunks",
      engine_source: "typescript",
      fallback_used: true,
      stale_scan: false,
      capability_complete: false,
      findings_count: 0,
      blocking_count: 0,
      started_at: "2026-08-02T00:00:01.000Z",
      completed_at: "2026-08-02T00:00:02.000Z"
    });

    expect(storage.listCheckRuns("repo_legacy")[0]).toMatchObject({ status: "blocked" });
    storage.close();
  });
});
