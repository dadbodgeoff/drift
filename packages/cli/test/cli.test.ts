import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("prints clean help without requiring a database", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift check --repo <repo_id>");
    expect(result.stdout).toContain("drift conventions list");
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
