import { mkdtemp, rm } from "node:fs/promises";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildFactGraphArtifact } from "@drift/factgraph";
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
      "003_repo_contracts_and_conventions",
      "004_backup_manifests",
      "005_audit_integrity",
      "006_fact_graph_artifacts",
      "007_fact_graph_v2_projections"
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
      "007_fact_graph_v2_projections"
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
    expect(storage.listScanManifests("repo_abc")[0]?.id).toBe("scan_abc");
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
        end_line: 3
      }],
      createdAt: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFactGraphArtifact(graph);

    expect(storage.getFactGraphArtifact("repo_abc", "scan_abc")).toMatchObject({
      id: "graph_scan_abc",
      schema_version: "factgraph.v1",
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
      fact_ids: ["fact_route_role"]
    }));
    expect(storage.listGraphCompleteness("repo_abc", "scan_abc")).toEqual([expect.objectContaining({
      scope: "repo",
      complete: true,
      can_block: true
    })]);
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
    expect(storage.verifyAuditChain("repo_abc")).toMatchObject({
      valid: true,
      event_count: 2,
      verified_count: 2,
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
      event_count: 2,
      verified_count: 1,
      broken_at_event_id: "audit_event_b",
      reasons: ["event_hash_mismatch"]
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

    expect(storage.getConventionCandidate("candidate_no_direct_db")?.status).toBe("candidate");
    expect(storage.listConventionCandidates("repo_abc", { status: "candidate" })).toHaveLength(1);
    expect(storage.listAcceptedConventions("repo_abc")[0]?.id).toBe("convention_no_direct_db");
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.id).toBe("convention_no_direct_db");
    storage.close();
  });
});
