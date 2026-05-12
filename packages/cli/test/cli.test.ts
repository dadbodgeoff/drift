import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";

const tempDirs: string[] = [];

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
  storage.close();
  return databasePath;
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("drift CLI convention review", () => {
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
    expect(JSON.parse(fresh.stdout).stale).toBe(false);

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
    expect(payload.stale).toBe(true);
    expect(payload.changes.modified).toEqual(["apps/web/app/api/users/route.ts"]);
    expect(payload.next_command).toBe(`drift scan --repo-root ${repoRoot} --json`);

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
    expect(JSON.parse(second.stdout).scan.previous_scan_id).toBe(firstPayload.scan.id);
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
      adapter_versions: { typescript: "0.0.1" },
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
      "rule_engine_version_changed"
    ]);
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
      `drift contract show --repo ${payload.repo.id}`,
      `drift baseline status --repo ${payload.repo.id}`,
      `drift prepare "task" --repo ${payload.repo.id} --json`,
      `drift check --diff main...HEAD --repo ${payload.repo.id} --scope changed-hunks`
    ]);
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
    expect(result.stdout).toContain("TS/JS files: 1 indexable file");
    expect(result.stdout).toContain("API routes: 1 API route file");
    expect(result.stdout).toContain(`drift start --repo-root ${repoRoot} --accept-defaults`);
    await expect(stat(stateRoot)).rejects.toThrow();
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
    expect(payload.next_command).toBe(`drift start --repo-root ${repoRoot} --accept-defaults`);
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
    expect(policy.stdout).toContain("policy set-egress");
    expect(policy.stdout).toContain("policy agent grant");
    expect(policy.stdout).toContain("--confirm");
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout).toContain("restore <backup.sqlite> --repo <repo_id> --confirm");
    expect(restore.stdout).toContain("restore <backup.sqlite> --repo <repo_id> --dry-run");
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
    expect(payload.summary.engine_source).toBe("rust");
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0].diff_status).toBe("new_in_diff");
    expect(payload.findings[0].status).toBe("new");
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
    expect(storage.listFindings("repo_abc")[0]?.title).toBe("API route imports data access directly");
    expect(storage.listFindings("repo_abc")[0]?.evidence_refs[0]?.file_path).toBe(
      "apps/web/app/api/users/route.ts"
    );
    storage.close();
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
    expect(JSON.parse(second.stdout).findings[0].status).toBe("pre_existing");
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
      blocking_count: 0
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
      "--now", "2026-05-10T00:00:32.000Z",
      "--json"
    ]);

    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout).created_count).toBe(1);
    expect(JSON.parse(status.stdout).active_count).toBe(1);
    expect(cleared.exitCode).toBe(0);
    expect(JSON.parse(cleared.stdout).resolved_count).toBe(1);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listBaselineViolations("repo_abc")[0]?.status).toBe("resolved");
    expect(storage.listAuditEvents("repo_abc").at(-1)?.action).toBe("baseline_cleared");
    storage.close();
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
      "--now", "2026-05-10T00:00:31.000Z",
      "--json"
    ]);
    const second = await runCli([
      "--db", databasePath,
      "baseline", "create",
      "--repo", "repo_abc",
      "--from", "main",
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
      "findings", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).policy).toMatchObject({
      allowed: true,
      surface: "cli-check"
    });
    expect(JSON.parse(result.stdout).findings[0].id).toBe("finding_abc");
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
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:03.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).finding.status).toBe("fixed");

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
      "--now", "2026-05-10T00:00:03.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changed).toBe(false);

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
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:05.000Z",
      "--json"
    ]);

    expect(suppressed.exitCode).toBe(0);
    expect(JSON.parse(suppressed.stdout).finding.status).toBe("suppressed");
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout).finding.status).toBe("accepted_drift");
    expect(falsePositive.exitCode).toBe(0);
    expect(JSON.parse(falsePositive.stdout).finding.status).toBe("false_positive");

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
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout).changed).toBe(false);

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

  it("refuses finding resolution commands for an unknown repo id", async () => {
    const databasePath = await seedDatabase();
    const commands = [
      ["findings", "mark-fixed", "finding_abc", "--evidence", "apps/web/app/api/users/route.ts:12"],
      ["findings", "suppress", "finding_abc", "--reason", "generated fixture"],
      ["findings", "accept-drift", "finding_abc", "--reason", "legacy exception"],
      ["findings", "mark-false-positive", "finding_abc", "--reason", "test double"]
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
    expect(JSON.parse(result.stdout).events[0]).toMatchObject({
      action: "finding_resolved",
      actor: "geoff",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" }
    });
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

  it("creates a single SQLite backup artifact and audits it", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");

    const result = await runCli([
      "--db", databasePath,
      "backup", "create",
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
    expect(payload.manifest).toMatchObject({
      repo_id: "repo_abc",
      schema_version: 4,
      created_at: "2026-05-10T00:00:04.000Z"
    });
    expect(payload.manifest.backup_path).toContain(backupDir);
    expect(payload.manifest.checksum_sha256).toHaveLength(64);
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

  it("refuses to overwrite an exact backup output without force", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-overwrite-"));
    tempDirs.push(dir);
    const backupPath = join(dir, "existing.drift-backup.sqlite");
    await writeFile(backupPath, "existing backup");

    const refused = await runCli([
      "--db", databasePath,
      "backup", "create",
      "--repo", "repo_abc",
      "--output", backupPath,
      "--json"
    ]);
    const forced = await runCli([
      "--db", databasePath,
      "backup", "create",
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

  it("lists persisted backup manifests as JSON", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-list-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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
      policy: {
        allowed: true,
        surface: "artifact"
      },
      count: 1,
      backups: [{
        id: manifest.id,
        backup_path: manifest.backup_path,
        artifact_exists: true,
        checksum_sha256: manifest.checksum_sha256
      }]
    });
  });

  it("prints backup artifact presence and size in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-list-text-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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
  });

  it("reports missing backup artifacts in backup list", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-missing-artifact-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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
      policy: {
        allowed: true,
        surface: "artifact"
      },
      checksum_matches: true,
      schema_version: 4
    });
    expect(JSON.parse(verified.stdout).size_bytes).toBeGreaterThan(0);
  });

  it("prints backup verify artifact size in human output", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-text-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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
    expect(verified.stdout).toContain(`Size: ${manifest.size_bytes} bytes`);
  });

  it("fails backup verify for unsupported future schemas", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-future-schema-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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
      schema_version: 5
    });
  });

  it("rejects invalid backup verify checksum formats", async () => {
    const { databasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-backup-verify-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", databasePath,
      "backup", "create",
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

  it("restores a SQLite backup into a target database and audits the restore", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-"));
    tempDirs.push(dir);
    const backupDir = join(dir, "backups");
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
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
      schema_version: 4
    });
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
        schema_version: 4,
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
  });

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
      "--repo", "repo_abc",
      "--output", backupDir,
      "--now", "2026-05-10T00:00:04.000Z",
      "--json"
    ]);
    const backupPath = JSON.parse(backup.stdout).manifest.backup_path;
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
    expect(JSON.parse(dryRun.stdout).restore).toMatchObject({
      repo_id: "repo_abc",
      dry_run: true,
      restored_at: null,
      target_exists: false,
      would_require_force: false
    });
    expect(JSON.parse(existingTargetDryRun.stdout).restore).toMatchObject({
      repo_id: "repo_abc",
      dry_run: true,
      restored_at: null,
      target_exists: true,
      would_require_force: true
    });
    await expect(stat(dryRunTarget)).rejects.toThrow();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("Target database already exists");
    expect(forced.exitCode).toBe(0);
    expect(JSON.parse(forced.stdout).restore.dry_run).toBe(false);
  });

  it("refuses restore when an expected checksum does not match", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-checksum-"));
    tempDirs.push(dir);
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
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

  it("refuses restore from unsupported future schemas before writing the target", async () => {
    const { databasePath: sourceDatabasePath } = await seedAcceptedDatabase();
    const dir = await mkdtemp(join(tmpdir(), "drift-restore-future-schema-"));
    tempDirs.push(dir);
    const targetDatabasePath = join(dir, "restored.sqlite");
    const backup = await runCli([
      "--db", sourceDatabasePath,
      "backup", "create",
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
    expect(restored.stderr).toContain("Backup schema version 5 is not supported");
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
    expect(payload.conventions[0]).toMatchObject({
      kind: "api_route_no_direct_data_access",
      enforcement_mode: "block",
      enforcement_capability: "deterministic_check"
    });
    expect(payload.scan_status.stale).toBe(true);
    expect(payload.scan_status.changes.added).toContain("apps/web/app/api/search/route.ts");
    expect(payload.scan_status.next_command).toBe(`drift scan --repo-root ${repoRoot} --json`);
    expect(payload.baseline.active_count).toBe(1);
    expect(payload.relevant_files.map((file: { path: string }) => file.path)).toContain(
      "apps/web/app/api/users/route.ts"
    );
    expect(payload.risky_areas).toEqual([{
      id: "risk_user_api",
      path_globs: ["apps/web/app/api/users/**"],
      risk_kind: "data_access",
      reason: "User API routes touch persisted user data."
    }]);
    expect(payload.next_commands).toContain(`drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`);
    expect(result.stdout).not.toContain("prisma.user.findMany");
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
    expect(JSON.parse(shown.stdout).policy.context_egress.default_mode).toBe("local_only");
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).decision).toMatchObject({
      allowed: true,
      surface: "cli-preflight",
      mode: "redacted",
      max_snippet_chars: 1200,
      approved_snippet_chars: 1200
    });
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stdout).decision).toMatchObject({
      allowed: false,
      surface: "cli-preflight",
      mode: "denied"
    });
    expect(fullFileDenied.exitCode).toBe(1);
    expect(JSON.parse(fullFileDenied.stdout).decision).toMatchObject({
      allowed: false,
      mode: "denied",
      reason: "full file content is denied by repo policy"
    });
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
      summary: {
        required_count: 1,
        safe_count: 1,
        total_count: 2
      },
      required_checks: [{ command: "drift check --diff main...HEAD" }],
      safe_commands: [{ command: "pnpm test" }]
    });
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

  it("refuses prepare until a repo contract exists", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "prepare",
      "add billing route",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No repo contract exists for repo_abc");
  });

  it("lists and shows convention candidates as JSON", async () => {
    const databasePath = await seedDatabase();

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
      "--json"
    ]);

    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).candidates[0].id).toBe("candidate_no_direct_db");
    expect(show.exitCode).toBe(0);
    expect(JSON.parse(show.stdout).candidate.matcher.forbidden_imports).toEqual(["@/lib/prisma"]);
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
      "--severity", "warning",
      "--mode", "warn",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).accepted.id).toBe("convention_no_direct_db");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getConventionCandidate("candidate_no_direct_db")?.status).toBe("accepted");
    expect(storage.listAcceptedConventions("repo_abc")[0]?.severity).toBe("warning");
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.enforcement_mode).toBe("warn");
    expect(storage.listAuditEvents("repo_abc")[0]?.action).toBe("election_accepted");
    storage.close();
  });

  it("does not audit no-op candidate acceptance", async () => {
    const databasePath = await seedDatabase();

    const first = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
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

  it("rejects invalid convention accept severity and mode", async () => {
    const databasePath = await seedDatabase();

    const invalidSeverity = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--severity", "critical",
      "--json"
    ]);
    const invalidMode = await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
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
      "--reason", "false inference",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).candidate.status).toBe("rejected");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getConventionCandidate("candidate_no_direct_db")?.status).toBe("rejected");
    expect(storage.listAuditEvents("repo_abc")[0]?.metadata).toEqual({ reason: "false inference" });
    storage.close();
  });

  it("does not audit no-op candidate rejection", async () => {
    const databasePath = await seedDatabase();

    const first = await runCli([
      "--db", databasePath,
      "conventions", "reject",
      "candidate_no_direct_db",
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
    expect(JSON.parse(result.stdout).contract.conventions[0].id).toBe("convention_no_direct_db");
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
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const dir = await mkdtemp(join(tmpdir(), "drift-contract-"));
    tempDirs.push(dir);
    const contractPath = join(dir, "contract.json");

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
      "--confirm",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:11.000Z",
      "--json"
    ]);
    await writeFile(contractPath, JSON.stringify(JSON.parse(exported.stdout).contract, null, 2));
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
      policy: {
        allowed: true,
        surface: "contract-export"
      }
    });
    expect(unconfirmedExport.exitCode).toBe(1);
    expect(unconfirmedExport.stderr).toContain("Contract export requires --confirm");
    expect(exported.exitCode).toBe(0);
    expect(JSON.parse(exported.stdout).policy.surface).toBe("contract-export");
    expect(JSON.parse(exported.stdout).contract.conventions[0].id).toBe("convention_no_direct_db");
    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout)).toMatchObject({
      valid: true,
      dry_run: true,
      policy: {
        allowed: true,
        surface: "contract-export"
      },
      convention_count: 1,
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
        surface: "contract-export",
        mode: "local_only"
      }
    });
    storage.close();
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
      compatibility: {
        compatible: false,
        schema_supported: false
      }
    });
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

  it("edits a candidate statement before acceptance", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--statement", "API routes must delegate data access through services.",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:30.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).candidate.statement).toBe(
      "API routes must delegate data access through services."
    );

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
      "--scope-file", scopePath,
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--scope-file must contain valid JSON");
  });

  it("adds an exception to an accepted convention and rematerializes the contract", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health endpoints are intentionally dependency-light",
      "--actor", "geoff",
      "--now", "2026-05-10T00:00:20.000Z",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).convention.exceptions[0].path_globs).toEqual([
      "apps/web/app/api/health/**"
    ]);

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.getRepoContract("repo_abc")?.conventions[0]?.exceptions[0]?.reason).toBe(
      "health endpoints are intentionally dependency-light"
    );
    expect(storage.listAuditEvents("repo_abc").at(-1)?.action).toBe("policy_changed");
    storage.close();
  });

  it("does not audit duplicate convention exceptions", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    const first = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
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

  it("rejects unsafe convention exception paths with a clear error", async () => {
    const databasePath = await seedDatabase();
    await runCli([
      "--db", databasePath,
      "conventions", "accept",
      "candidate_no_direct_db",
      "--json"
    ]);

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_abc",
      "--path", "../secrets/**",
      "--reason", "bad exception",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--path must be repo-relative.");
  });

  it("refuses convention exceptions for an unknown repo id", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "exception", "add",
      "convention_no_direct_db",
      "--repo", "repo_missing",
      "--path", "apps/web/app/api/health/**",
      "--reason", "health route exception",
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown repo repo_missing");
  });
});
