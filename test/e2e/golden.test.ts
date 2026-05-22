import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { createReadOnlyMcpHandlers } from "../../packages/mcp/src/index.js";

const tempDirs: string[] = [];

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-e2e-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("golden fixture CLI lifecycle", () => {
  it("runs the local-first direct-db convention loop", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-direct-db");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const scanPayload = JSON.parse(scan.stdout);
    expect(goldenScan(scanPayload)).toMatchInlineSnapshot(`
      {
        "candidate_kinds": [
          "api_route_no_direct_data_access",
          "api_route_requires_service_delegation",
        ],
        "engine_source": "rust",
        "facts_count": 8,
        "files_indexed": 1,
      }
    `);

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:01.000Z"
    ]);
    const databasePath = started.stdout
      .split("\n")
      .find((line) => line.trim().startsWith("export DRIFT_DB="))
      ?.split("=", 2)[1];
    const repoId = started.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
    expect(Boolean(databasePath && repoId)).toBe(true);

    const prepare = await runCli([
      "--db", databasePath!,
      "prepare",
      "add user search endpoint",
      "--repo", repoId!,
      "--now", "2026-05-10T00:00:02.000Z",
      "--json"
    ]);
    expect(goldenPrepare(JSON.parse(prepare.stdout))).toMatchInlineSnapshot(`
      {
        "baseline_active_count": 1,
        "convention_kinds": [
          "api_route_no_direct_data_access",
        ],
        "policy_allowed": true,
        "relevant_files": [
          "apps/web/app/api/users/route.ts",
        ],
      }
    `);
    const mcpPreflight = createReadOnlyMcpHandlers({ databasePath: databasePath! })
      .get_task_preflight({ repo_id: repoId!, task: "add user search endpoint" });
    expect(goldenPrepare(mcpPreflight)).toEqual(goldenPrepare(JSON.parse(prepare.stdout)));

    const contract = await runCli([
      "--db", databasePath!,
      "contract", "show",
      "--repo", repoId!,
      "--json"
    ]);
    expect(goldenContract(JSON.parse(contract.stdout))).toMatchInlineSnapshot(`
      {
        "convention_count": 1,
        "fingerprint_length": 64,
        "schema_version": 1,
      }
    `);
    const mcpContract = createReadOnlyMcpHandlers({ databasePath: databasePath! })
      .get_repo_contract({ repo_id: repoId! });
    expect(goldenContract(mcpContract)).toEqual(goldenContract(JSON.parse(contract.stdout)));

    const diffPath = join(repoRoot, "..", "diff.patch");
    await writeFile(diffPath, [
      "diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts",
      "--- a/apps/web/app/api/users/route.ts",
      "+++ b/apps/web/app/api/users/route.ts",
      "@@ -0,0 +1,4 @@",
      "+import { prisma } from \"@/lib/prisma\";",
      "+export async function GET() {",
      "+  return Response.json(await prisma.user.findMany());",
      "+}",
      ""
    ].join("\n"));
    const check = await runCli([
      "--db", databasePath!,
      "check",
      "--repo", repoId!,
      "--diff-file", diffPath,
      "--scope", "changed-hunks",
      "--now", "2026-05-10T00:00:03.000Z",
      "--json"
    ]);
    expect(goldenCheck(JSON.parse(check.stdout))).toMatchInlineSnapshot(`
      {
        "blocking_count": 0,
        "engine_source": "rust",
        "finding_statuses": [
          "pre_existing",
        ],
        "findings_count": 1,
      }
    `);

    const backupDir = join(repoRoot, "..", "backups");
    const backup = await runCli([
      "--db", databasePath!,
      "backup", "create",
      "--confirm",
      "--repo", repoId!,
      "--output", backupDir,
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupPayload = JSON.parse(backup.stdout);
    expect(goldenBackup(backupPayload)).toMatchInlineSnapshot(`
      {
        "checksum_length": 64,
        "governance_read_only": false,
        "next_command_count": 3,
        "repo_matches": true,
        "schema_version": 9,
      }
    `);

    const restoredDb = join(repoRoot, "..", "restored.sqlite");
    const restore = await runCli([
      "--db", restoredDb,
      "restore", backupPayload.manifest.backup_path,
      "--repo", repoId!,
      "--confirm",
      "--now", "2026-05-10T00:00:05.000Z",
      "--json"
    ]);
    expect(goldenRestore(JSON.parse(restore.stdout))).toMatchInlineSnapshot(`
      {
        "checksum_length": 64,
        "governance_read_only": false,
        "next_command_count": 2,
        "repo_matches": true,
        "schema_version": 9,
        "write_intent": true,
      }
    `);

    const audit = await runCli([
      "--db", restoredDb,
      "audit", "list",
      "--repo", repoId!,
      "--json"
    ]);
    expect(goldenAudit(JSON.parse(audit.stdout))).toMatchInlineSnapshot(`
      {
        "actions": [
          "scan_completed",
          "scan_started",
          "election_accepted",
          "baseline_created",
          "scan_completed",
          "scan_started",
          "backup_created",
          "restore_completed",
        ],
        "count": 8,
      }
    `);
  });
});

function goldenScan(payload: any) {
  return {
    files_indexed: payload.summary.files_indexed,
    facts_count: payload.summary.facts_count,
    engine_source: payload.summary.engine_source,
    candidate_kinds: payload.candidates.map((candidate: any) => candidate.kind)
  };
}

function goldenPrepare(payload: any) {
  return {
    policy_allowed: payload.policy.allowed,
    baseline_active_count: payload.baseline.active_count,
    convention_kinds: payload.conventions.map((convention: any) => convention.kind),
    relevant_files: payload.relevant_files.map((file: any) => file.path)
  };
}

function goldenCheck(payload: any) {
  return {
    engine_source: payload.summary.engine_source,
    findings_count: payload.summary.findings_count,
    blocking_count: payload.summary.blocking_count,
    finding_statuses: payload.findings.map((finding: any) => finding.status)
  };
}

function goldenContract(payload: any) {
  return {
    schema_version: payload.contract.contract_schema_version,
    convention_count: payload.summary.convention_count,
    fingerprint_length: payload.contract_fingerprint.length
  };
}

function goldenBackup(payload: any) {
  return {
    repo_matches: payload.manifest.repo_id.startsWith("repo_"),
    schema_version: payload.manifest.schema_version,
    checksum_length: payload.manifest.checksum_sha256.length,
    governance_read_only: payload.governance.read_only,
    next_command_count: payload.next_commands.length
  };
}

function goldenRestore(payload: any) {
  return {
    repo_matches: payload.restore.repo_id.startsWith("repo_"),
    schema_version: payload.restore.schema_version,
    checksum_length: payload.restore.checksum_sha256.length,
    governance_read_only: payload.governance.read_only,
    write_intent: payload.restore_intent.write_intent,
    next_command_count: payload.next_commands.length
  };
}

function goldenAudit(payload: any) {
  return {
    count: payload.count,
    actions: payload.events.map((event: any) => event.action)
  };
}
