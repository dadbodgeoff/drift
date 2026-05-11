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
      "001_initial_local_state"
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

    expect(storage.getRepo("repo_abc")?.fingerprint).toBe("repo-fp");
    expect(storage.getScanManifest("scan_abc")?.adapter_versions).toEqual({ typescript: "0.1.0" });
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
});
