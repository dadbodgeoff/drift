import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
    expect(payload.summary.facts_count).toBeGreaterThan(0);
    expect(payload.candidates[0].kind).toBe("api_route_no_direct_data_access");

    const storage = openDriftStorage({ databasePath: payload.database_path });
    storage.migrate();
    expect(storage.getRepo(payload.repo.id)?.root_path).toBe(repoRoot);
    expect(storage.getScanManifest(payload.scan.id)?.status).toBe("completed");
    expect(storage.listFacts(payload.scan.id, { kind: "import_used" })).toHaveLength(2);
    expect(storage.listConventionCandidates(payload.repo.id, { status: "candidate" })).toHaveLength(1);
    storage.close();
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
    storage.close();
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

    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain("Run deterministic checks");
    expect(check.stdout).toContain("--scope changed-hunks");
    expect(conventions.exitCode).toBe(0);
    expect(conventions.stdout).toContain("Review inferred conventions");
    expect(conventions.stdout).toContain("conventions exception add");
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
    expect(payload.summary.blocking_count).toBe(1);
    expect(payload.findings[0].diff_status).toBe("new_in_diff");
    expect(payload.findings[0].status).toBe("new");

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    expect(storage.listFindings("repo_abc")[0]?.title).toBe("API route imports data access directly");
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
      "findings", "list",
      "--repo", "repo_abc",
      "--json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).findings[0].id).toBe("finding_abc");
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
    expect(checked.listAuditEvents("repo_abc").at(-1)).toMatchObject({
      action: "finding_resolved",
      actor: "geoff",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" }
    });
    checked.close();
  });

  it("lists audit events as JSON", async () => {
    const databasePath = await seedDatabase();
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
    expect(JSON.parse(result.stdout).events[0]).toMatchObject({
      action: "finding_resolved",
      actor: "geoff",
      target_type: "finding",
      target_id: "finding_abc",
      metadata: { evidence: "apps/web/app/api/users/route.ts:12" }
    });
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
    expect(payload.baseline.active_count).toBe(1);
    expect(payload.relevant_files.map((file: { path: string }) => file.path)).toContain(
      "apps/web/app/api/users/route.ts"
    );
    expect(payload.next_commands).toContain(`drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`);
    expect(result.stdout).not.toContain("prisma.user.findMany");
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

    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(shown.stdout).policy.context_egress.default_mode).toBe("local_only");
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).decision).toMatchObject({
      allowed: true,
      surface: "cli-preflight",
      mode: "local_only"
    });
    expect(denied.exitCode).toBe(0);
    expect(JSON.parse(denied.stdout).decision).toMatchObject({
      allowed: false,
      surface: "cli-preflight",
      mode: "denied"
    });
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
    expect(JSON.parse(result.stdout).contract.conventions[0].id).toBe("convention_no_direct_db");
  });

  it("edits a candidate statement before acceptance", async () => {
    const databasePath = await seedDatabase();

    const result = await runCli([
      "--db", databasePath,
      "conventions", "edit",
      "candidate_no_direct_db",
      "--statement", "API routes must delegate data access through services.",
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
    storage.close();
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
});
