import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-installed-flow-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

async function packPackage(packageDir: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-installed-pack-"));
  tempDirs.push(dir);
  const packed = await execFileAsync("pnpm", [
    "--dir", packageDir,
    "pack",
    "--json",
    "--pack-destination", dir
  ]);
  return parsePnpmPackFilename(packed.stdout);
}

function parsePnpmPackFilename(stdout: string): string {
  const prettyJsonIndex = stdout.lastIndexOf("{\n  \"name\"");
  const compactJsonIndex = stdout.lastIndexOf("{\"name\"");
  const index = Math.max(prettyJsonIndex, compactJsonIndex);
  if (index < 0) {
    throw new Error(`Unable to parse pnpm pack JSON output:\n${stdout}`);
  }
  return (JSON.parse(stdout.slice(index)) as { filename: string }).filename;
}

async function installDriftPackages(): Promise<string> {
  const consumerDir = await mkdtemp(join(tmpdir(), "drift-installed-consumer-"));
  tempDirs.push(consumerDir);
  await writeFile(join(consumerDir, "package.json"), [
    "{",
    "  \"name\": \"drift-installed-flow\",",
    "  \"private\": true,",
    "  \"type\": \"module\"",
    "}",
    ""
  ].join("\n"));
  const tarballs = await Promise.all([
    packPackage("packages/core"),
    packPackage("packages/factgraph"),
    packPackage("packages/engine-contract"),
    packPackage("packages/storage"),
    packPackage("packages/query"),
    packPackage(currentEnginePackageDir()),
    packPackage("packages/cli"),
    packPackage("packages/mcp")
  ]);
  await execFileAsync("npm", [
    "--prefix", consumerDir,
    "install",
    ...tarballs
  ], { timeout: 120_000 });
  return consumerDir;
}

async function runInstalledDrift(consumerDir: string, args: string[]) {
  const { DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK, DRIFT_ENGINE_BIN, ...env } = process.env;
  return execFileAsync(join(consumerDir, "node_modules/.bin/drift"), args, {
    cwd: consumerDir,
    env,
    timeout: 120_000
  });
}

function currentEnginePackageDir(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "packages/engine-darwin-arm64";
  }
  throw new Error(`No current-platform engine package fixture for ${process.platform}-${process.arch}.`);
}

async function callInstalledMcp(consumerDir: string, databasePath: string, request: unknown) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(join(consumerDir, "node_modules/.bin/drift-mcp"), [
      "--db", databasePath
    ], {
      cwd: consumerDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for installed drift-mcp response."));
    }, 30_000);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`drift-mcp exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("installed Drift package flow", () => {
  it("runs doctor, scan, start, prepare, and MCP status from installed packages", async () => {
    const consumerDir = await installDriftPackages();
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-direct-db");

    const doctor = await runInstalledDrift(consumerDir, [
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const doctorPayload = JSON.parse(doctor.stdout);
    expect(doctor.stderr).toBe("");
    expect(doctorPayload.repo_root).toBe(repoRoot);
    expect(doctorPayload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
      supported_sqlite_schema_version: 9,
      storage_driver: "sqlite"
    });
    expect(doctorPayload.v1_scope).toMatchObject({
      product_mode: "local_first_cli",
      primary_wedge: "typescript_api_route_layering",
      source_mutation: false
    });
    expect(doctorPayload.checks).toContainEqual(expect.objectContaining({
      id: "typescript_files",
      status: "ok"
    }));

    const imports = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "import { DRIFT_CORE_VERSION } from '@drift/core';",
        "import { ENGINE_STREAM_EVENT_SCHEMA_VERSION } from '@drift/engine-contract';",
        "import { openDriftStorage } from '@drift/storage';",
        "import { runCli } from '@drift/cli';",
        "import { DRIFT_MCP_VERSION } from '@drift/mcp';",
        "console.log(JSON.stringify({",
        "  core: DRIFT_CORE_VERSION,",
        "  engineContract: ENGINE_STREAM_EVENT_SCHEMA_VERSION,",
        "  storage: typeof openDriftStorage,",
        "  cli: typeof runCli,",
        "  mcp: DRIFT_MCP_VERSION",
        "}));"
      ].join("\n")
    ], {
      cwd: consumerDir,
      timeout: 120_000
    });
    expect(JSON.parse(imports.stdout)).toEqual({
      core: "0.1.0",
      engineContract: "engine.stream.event.v1",
      storage: "function",
      cli: "function",
      mcp: "0.1.0"
    });

    const version = await runInstalledDrift(consumerDir, [
      "version",
      "--json"
    ]);
    const versionPayload = JSON.parse(version.stdout);
    expect(version.stderr).toBe("");
    expect(versionPayload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
      supported_sqlite_schema_version: 9,
      storage_driver: "sqlite"
    });

    const capabilities = await runInstalledDrift(consumerDir, [
      "capabilities",
      "--json"
    ]);
    const capabilitiesPayload = JSON.parse(capabilities.stdout);
    expect(capabilities.stderr).toBe("");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("prepare");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("ask");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("repo map");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("conventions list");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("conventions show");
    expect(capabilitiesPayload.capabilities.read_only_cli).toContain("findings show");
    expect(capabilitiesPayload.capabilities.human_confirmed_cli).toEqual(expect.arrayContaining([
      "conventions reject --confirm",
      "conventions edit --confirm",
      "policy set-egress --confirm",
      "policy agent grant --confirm",
      "policy agent revoke --confirm"
    ]));
    expect(capabilitiesPayload.capabilities.mcp_read_only_tools).toContain("get_capabilities");
    expect(capabilitiesPayload.capabilities.mcp_read_only_tools).toContain("get_audit_status");
    expect(capabilitiesPayload.capabilities.mcp_read_only_tools).toContain("get_repo_map");
    expect(capabilitiesPayload.capabilities.mcp_mutation_tools).toEqual([]);

    const scan = await runInstalledDrift(consumerDir, [
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const scanPayload = JSON.parse(scan.stdout);
    expect(scan.stderr).toBe("");
    expect(scanPayload.summary.files_indexed).toBe(1);
    expect(scanPayload.candidates.map((candidate: any) => candidate.kind)).toContain("api_route_no_direct_data_access");

    const conventionQueue = await runInstalledDrift(consumerDir, [
      "--db", scanPayload.database_path,
      "conventions", "list",
      "--repo", scanPayload.repo.id,
      "--status", "candidate",
      "--kind", "api_route_no_direct_data_access",
      "--capability", "deterministic_check",
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const conventionQueuePayload = JSON.parse(conventionQueue.stdout);
    expect(conventionQueue.stderr).toBe("");
    expect(conventionQueuePayload.summary).toMatchObject({
      filtered_count: 1,
      listed_count: 1
    });
    expect(conventionQueuePayload.pagination).toMatchObject({
      limit: 1,
      offset: 0,
      returned_count: 1
    });
    expect(conventionQueuePayload.review_items[0]).toMatchObject({
      kind: "api_route_no_direct_data_access",
      enforcement_capability: "deterministic_check"
    });

    const started = await runInstalledDrift(consumerDir, [
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:01.000Z"
    ]);
    expect(started.stderr).toBe("");
    const databasePath = started.stdout
      .split("\n")
      .find((line) => line.trim().startsWith("export DRIFT_DB="))
      ?.split("=", 2)[1];
    const repoId = started.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
    expect(databasePath).toBeTruthy();
    expect(repoId).toBeTruthy();
    expect(await readFile(databasePath!, "utf8").then(() => true)).toBe(true);

    const status = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "scan", "status",
      "--repo", repoId!,
      "--json"
    ]);
    const cliStatusPayload = JSON.parse(status.stdout);
    expect(status.stderr).toBe("");
    expect(cliStatusPayload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(cliStatusPayload.summary).toMatchObject({
      scan_count: 2,
      indexed_file_count: 1,
      source_change_count: 0,
      stale: false,
      invalidation_count: 0,
      audit_valid: true
    });
    expect(cliStatusPayload.scan_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(cliStatusPayload.next_commands).toEqual([
      `drift prepare "task" --repo ${repoId} --json`,
      `drift repo map --repo ${repoId} --json`,
      `drift audit verify --repo ${repoId} --json`
    ]);

    const prepared = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "prepare",
      "add user search endpoint",
      "--repo", repoId!,
      "--path", "apps/web/app/api/users/route.ts",
      "--now", "2026-05-10T00:00:02.000Z",
      "--json"
    ]);
    const preparePayload = JSON.parse(prepared.stdout);
    expect(prepared.stderr).toBe("");
    expect(preparePayload.target_path).toBe("apps/web/app/api/users/route.ts");
    expect(preparePayload.policy.allowed).toBe(true);
    expect(preparePayload.freshness_requirement).toMatchObject({
      required: false,
      satisfied: true
    });
    expect(preparePayload.conventions.map((convention: any) => convention.kind)).toContain("api_route_no_direct_data_access");
    expect(preparePayload.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);

    const asked = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "ask",
      "users api route",
      "--repo", repoId!,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    const askPayload = JSON.parse(asked.stdout);
    expect(asked.stderr).toBe("");
    expect(askPayload.target_path).toBe("apps/web/app/api/users/route.ts");
    expect(askPayload.answer.source).toBe("deterministic_local_state");
    expect(askPayload.freshness_requirement).toMatchObject({
      required: false,
      satisfied: true
    });
    expect(askPayload.summary.matched_convention_count).toBe(1);
    expect(askPayload.redactions.snippets_included).toBe(false);
    expect(askPayload.next_commands[0]).toBe(`drift prepare "users api route" --repo ${repoId} --path apps/web/app/api/users/route.ts --json`);

    const repoMap = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "repo", "map",
      "--repo", repoId!,
      "--role", "api_route",
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const repoMapPayload = JSON.parse(repoMap.stdout);
    expect(repoMap.stderr).toBe("");
    expect(repoMapPayload.pagination).toMatchObject({
      limit: 1,
      offset: 0,
      returned_count: 1
    });
    expect(repoMapPayload.summary.filtered_file_count).toBe(1);
    expect(repoMapPayload.summary.listed_file_count).toBe(1);
    expect(repoMapPayload.summary.role_counts.api_route).toBe(1);
    expect(repoMapPayload.impact_summary.convention_coverage_count).toBe(1);
    expect(repoMapPayload.freshness_requirement).toMatchObject({
      required: false,
      satisfied: true
    });
    expect(repoMapPayload.files[0]).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      convention_ids: expect.arrayContaining([expect.stringMatching(/^convention_[a-f0-9]+$/)])
    });
    expect(repoMapPayload.redactions.snippets_included).toBe(false);

    const checksList = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "checks", "list",
      "--repo", repoId!,
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const checksListPayload = JSON.parse(checksList.stdout);
    expect(checksList.stderr).toBe("");
    expect(checksListPayload.summary).toMatchObject({
      filtered_count: 1,
      listed_count: 1,
      total_count: 1
    });
    expect(checksListPayload.pagination).toEqual({
      limit: 1,
      offset: 0,
      returned_count: 1,
      has_more: false,
      next_offset: null
    });
    expect(checksListPayload.required_checks).toEqual([
      expect.objectContaining({
        command: `drift check --diff main...HEAD --repo ${repoId} --scope changed-hunks --json`
      })
    ]);

    const contextCheck = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "policy", "check-context",
      "--repo", repoId!,
      "--path", "apps/web/app/api/users/route.ts",
      "--surface", "cli-preflight",
      "--require-fresh",
      "--json"
    ]);
    const contextCheckPayload = JSON.parse(contextCheck.stdout);
    expect(contextCheck.stderr).toBe("");
    expect(contextCheckPayload.decision.allowed).toBe(true);
    expect(contextCheckPayload.freshness_requirement).toMatchObject({
      required: true,
      satisfied: true
    });
    expect(contextCheckPayload.summary).toMatchObject({
      allowed: true,
      mode: "local_only",
      surface: "cli-preflight",
      indexed: true,
      matched_convention_count: 1,
      freshness_required: true,
      freshness_satisfied: true,
      approved_snippet_chars: 1200
    });
    expect(contextCheckPayload.file_context).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      indexed: true,
      roles: ["api_route"],
      convention_ids: expect.arrayContaining([expect.stringMatching(/^convention_[a-f0-9]+$/)])
    });
    expect(contextCheckPayload.next_commands).toEqual([
      `drift prepare "task" --repo ${repoId} --path apps/web/app/api/users/route.ts --json`,
      `drift repo map --repo ${repoId} --path apps/web/app/api/users/route.ts --json`,
      `drift policy show --repo ${repoId} --json`
    ]);

    const contract = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "contract", "show",
      "--repo", repoId!,
      "--json"
    ]);
    const contractPayload = JSON.parse(contract.stdout);
    expect(contract.stderr).toBe("");
    expect(contractPayload.contract_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(contractPayload.summary.convention_count).toBe(1);

    const baseline = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "baseline", "status",
      "--repo", repoId!
    ]);
    expect(baseline.stderr).toBe("");
    expect(baseline.stdout).toContain("Drift baseline");
    expect(baseline.stdout).toContain("Active: 1");

    const check = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "check",
      "--repo", repoId!,
      "--scope", "full"
    ]);
    expect(check.stderr).toBe("");
    expect(check.stdout).toContain("Drift check");
    expect(check.stdout).toContain("Findings: 1");
    expect(check.stdout).toContain("Blocking: 0");

    const findings = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "list",
      "--repo", repoId!
    ]);
    expect(findings.stderr).toBe("");
    expect(findings.stdout).toContain("Drift findings");
    expect(findings.stdout).toContain("Total: 1");

    const pathFindings = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "list",
      "--repo", repoId!,
      "--path", "apps/web/app/api/users/route.ts",
      "--require-fresh",
      "--json"
    ]);
    const pathFindingsPayload = JSON.parse(pathFindings.stdout);
    expect(pathFindings.stderr).toBe("");
    expect(pathFindingsPayload.filters).toMatchObject({
      path: "apps/web/app/api/users/route.ts"
    });
    expect(pathFindingsPayload.freshness_requirement).toMatchObject({
      required: true,
      satisfied: true
    });
    expect(pathFindingsPayload.summary).toMatchObject({
      total_count: 1,
      filtered_count: 1
    });
    expect(pathFindingsPayload.review_items).toEqual([
      expect.objectContaining({
        first_evidence: expect.objectContaining({
          file_path: "apps/web/app/api/users/route.ts"
        })
      })
    ]);
    const findingId = pathFindingsPayload.review_items[0].id;
    const conventionId = pathFindingsPayload.review_items[0].convention_id;

    const conventionFindings = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "list",
      "--repo", repoId!,
      "--convention", conventionId,
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const conventionFindingsPayload = JSON.parse(conventionFindings.stdout);
    expect(conventionFindings.stderr).toBe("");
    expect(conventionFindingsPayload.filters).toMatchObject({
      convention_id: conventionId
    });
    expect(conventionFindingsPayload.summary).toMatchObject({
      total_count: 1,
      filtered_count: 1
    });
    expect(conventionFindingsPayload.pagination).toEqual({
      limit: 1,
      offset: 0,
      returned_count: 1,
      has_more: false,
      next_offset: null
    });

    const findingDetail = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "show",
      findingId,
      "--repo", repoId!,
      "--require-fresh",
      "--json"
    ]);
    const findingDetailPayload = JSON.parse(findingDetail.stdout);
    expect(findingDetail.stderr).toBe("");
    expect(findingDetailPayload.review_item).toMatchObject({
      id: findingId,
      convention_id: conventionId
    });
    expect(findingDetailPayload.freshness_requirement).toMatchObject({
      required: true,
      satisfied: true
    });
    expect(findingDetailPayload.finding).toMatchObject({
      id: findingId,
      convention_id: conventionId,
      evidence_refs: [{
        file_path: "apps/web/app/api/users/route.ts"
      }]
    });
    expect(findingDetailPayload.next_commands[0]).toContain(`drift findings mark-fixed ${findingId}`);
    expect(findingDetailPayload.next_commands[0]).toContain("--confirm");

    const needsReview = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "mark-needs-review",
      findingId,
      "--repo", repoId!,
      "--reason", "installed package governance smoke",
      "--confirm",
      "--json"
    ]);
    const needsReviewPayload = JSON.parse(needsReview.stdout);
    expect(needsReview.stderr).toBe("");
    expect(needsReviewPayload).toMatchObject({
      changed: true,
      finding: { status: "needs_review" },
      resolution: {
        kind: "needs_review",
        reason: "installed package governance smoke"
      }
    });

    const markFixed = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "findings", "mark-fixed",
      findingId,
      "--repo", repoId!,
      "--evidence", "apps/web/app/api/users/route.ts:1",
      "--confirm",
      "--json"
    ]);
    const markFixedPayload = JSON.parse(markFixed.stdout);
    expect(markFixed.stderr).toBe("");
    expect(markFixedPayload).toMatchObject({
      changed: true,
      finding: { status: "fixed" },
      resolution: {
        kind: "fixed",
        evidence: "apps/web/app/api/users/route.ts:1"
      }
    });

    const audit = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "audit", "list",
      "--repo", repoId!
    ]);
    expect(audit.stderr).toBe("");
    expect(audit.stdout).toContain("Drift audit log");
    expect(audit.stdout).toContain("scan_completed");

    const auditScanPage = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "audit", "list",
      "--repo", repoId!,
      "--action", "scan_completed",
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const auditScanPagePayload = JSON.parse(auditScanPage.stdout);
    const auditTargetId = auditScanPagePayload.events[0].target_id;

    const auditPage = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "audit", "list",
      "--repo", repoId!,
      "--target-id", auditTargetId,
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const auditPagePayload = JSON.parse(auditPage.stdout);
    expect(auditPage.stderr).toBe("");
    expect(auditPagePayload.target_id).toBe(auditTargetId);
    expect(auditPagePayload.total_count).toBeGreaterThanOrEqual(1);
    expect(auditPagePayload.filtered_count).toBeGreaterThanOrEqual(1);
    expect(auditPagePayload.count).toBe(1);
    expect(auditPagePayload.pagination).toMatchObject({
      limit: 1,
      offset: 0,
      returned_count: 1
    });
    expect(auditPagePayload.events).toEqual([
      expect.objectContaining({
        target_id: auditTargetId
      })
    ]);

    const auditVerify = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "audit", "verify",
      "--repo", repoId!,
      "--json"
    ]);
    const auditVerifyPayload = JSON.parse(auditVerify.stdout);
    expect(auditVerify.stderr).toBe("");
    expect(auditVerifyPayload.verification.valid).toBe(true);
    expect(auditVerifyPayload.summary).toMatchObject({
      valid: true,
      event_count: auditVerifyPayload.verification.event_count,
      verified_count: auditVerifyPayload.verification.verified_count,
      broken_at_event_id: null,
      reason_count: 0
    });
    expect(auditVerifyPayload.verification.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditVerifyPayload.next_commands).toEqual([
      `drift audit list --repo ${repoId} --json`,
      `drift backup create --repo ${repoId} --confirm --json`
    ]);

    const backupDir = join(stateRoot, "backups");
    const backup = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "backup", "create",
      "--confirm",
      "--repo", repoId!,
      "--output", backupDir,
      "--now", "2026-05-10T00:00:03.000Z"
    ]);
    expect(backup.stderr).toBe("");
    expect(backup.stdout).toContain("Drift backup created");
    expect(backup.stdout).toContain("Verify: drift backup verify");
    const backupPath = backup.stdout.match(/Path: (.+)/)?.[1];
    const checksum = backup.stdout.match(/Checksum: ([a-f0-9]{64})/)?.[1];
    expect(backupPath).toBeTruthy();
    expect(checksum).toBeTruthy();

    const backupJson = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "backup", "create",
      "--confirm",
      "--repo", repoId!,
      "--output", join(stateRoot, "json-backups"),
      "--now", "2026-05-10T00:00:03.500Z",
      "--json"
    ]);
    const backupJsonPayload = JSON.parse(backupJson.stdout);
    expect(backupJson.stderr).toBe("");
    expect(backupJsonPayload.governance.read_only).toBe(false);
    expect(backupJsonPayload.review_item.artifact_exists).toBe(true);
    expect(backupJsonPayload.next_commands).toContain(
      `drift backup verify ${backupJsonPayload.manifest.backup_path} --repo ${repoId} --checksum ${backupJsonPayload.manifest.checksum_sha256} --json`
    );

    const backupList = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "backup", "list",
      "--repo", repoId!
    ]);
    expect(backupList.stderr).toBe("");
    expect(backupList.stdout).toContain("Drift backups");
    expect(backupList.stdout).toContain(`Verify: drift backup verify ${backupPath}`);

    const backupListJson = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "backup", "list",
      "--repo", repoId!,
      "--json"
    ]);
    const backupListPayload = JSON.parse(backupListJson.stdout);
    expect(backupListJson.stderr).toBe("");
    expect(backupListPayload.governance.read_only).toBe(true);
    expect(backupListPayload.review_items.length).toBeGreaterThanOrEqual(2);
    expect(backupListPayload.next_commands[0]).toContain("drift backup verify");

    const backupListPaged = await runInstalledDrift(consumerDir, [
      "--db", databasePath!,
      "backup", "list",
      "--repo", repoId!,
      "--artifact-status", "present",
      "--limit", "1",
      "--offset", "0",
      "--json"
    ]);
    const backupListPagedPayload = JSON.parse(backupListPaged.stdout);
    expect(backupListPaged.stderr).toBe("");
    expect(backupListPagedPayload).toMatchObject({
      filtered_count: 2,
      count: 1,
      filters: {
        artifact_status: "present"
      },
      pagination: {
        limit: 1,
        offset: 0,
        returned_count: 1,
        has_more: true,
        next_offset: 1
      }
    });

    const backupVerify = await runInstalledDrift(consumerDir, [
      "backup", "verify",
      backupPath!,
      "--repo", repoId!,
      "--checksum", checksum!
    ]);
    expect(backupVerify.stderr).toBe("");
    expect(backupVerify.stdout).toContain("Valid: true");
    expect(backupVerify.stdout).toContain("Restore dry-run: drift --db <target.sqlite>");

    const backupVerifyJson = await runInstalledDrift(consumerDir, [
      "backup", "verify",
      backupPath!,
      "--repo", repoId!,
      "--checksum", checksum!,
      "--json"
    ]);
    const backupVerifyPayload = JSON.parse(backupVerifyJson.stdout);
    expect(backupVerifyJson.stderr).toBe("");
    expect(backupVerifyPayload.governance.read_only).toBe(true);
    expect(backupVerifyPayload.verification.valid).toBe(true);
    expect(backupVerifyPayload.next_commands).toEqual([
      `drift --db <target.sqlite> restore ${backupPath} --repo ${repoId} --checksum ${checksum} --dry-run --json`
    ]);

    const restoreTarget = join(stateRoot, "restored.sqlite");
    const restoreDryRun = await runInstalledDrift(consumerDir, [
      "--db", restoreTarget,
      "restore", backupPath!,
      "--repo", repoId!,
      "--checksum", checksum!,
      "--dry-run"
    ]);
    expect(restoreDryRun.stderr).toBe("");
    expect(restoreDryRun.stdout).toContain("Drift restore validated");
    expect(restoreDryRun.stdout).toContain("Confirm restore:");

    const restoreDryRunJson = await runInstalledDrift(consumerDir, [
      "--db", restoreTarget,
      "restore", backupPath!,
      "--repo", repoId!,
      "--checksum", checksum!,
      "--dry-run",
      "--json"
    ]);
    expect(restoreDryRunJson.stderr).toBe("");
    const restorePayload = JSON.parse(restoreDryRunJson.stdout);
    expect(restorePayload.governance.read_only).toBe(true);
    expect(restorePayload.restore_intent.write_intent).toBe(false);
    expect(restorePayload.restore.write_intent).toBe(false);
    expect(restorePayload.restore.confirm_command).toContain(" --confirm");

    const restored = await runInstalledDrift(consumerDir, [
      "--db", restoreTarget,
      "restore", backupPath!,
      "--repo", repoId!,
      "--checksum", checksum!,
      "--confirm",
      "--json"
    ]);
    const restoredPayload = JSON.parse(restored.stdout);
    expect(restored.stderr).toBe("");
    expect(restoredPayload.governance.read_only).toBe(false);
    expect(restoredPayload.restore_intent.write_intent).toBe(true);
    expect(restoredPayload.next_commands).toEqual([
      `drift --db ${restoreTarget} scan status --repo ${repoId} --json`,
      `drift --db ${restoreTarget} prepare "task" --repo ${repoId} --json`
    ]);

    const restoredAuditVerify = await runInstalledDrift(consumerDir, [
      "--db", restoreTarget,
      "audit", "verify",
      "--repo", repoId!,
      "--json"
    ]);
    const restoredAuditVerifyPayload = JSON.parse(restoredAuditVerify.stdout);
    expect(restoredAuditVerify.stderr).toBe("");
    expect(restoredAuditVerifyPayload.verification.valid).toBe(true);
    expect(restoredAuditVerifyPayload.verification.head_event_hash).toMatch(/^[a-f0-9]{64}$/);

    const mcpStatus = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_scan_status",
        arguments: {
          repo_id: repoId
        }
      }
    });
    const mcpResponse = JSON.parse(mcpStatus.stdout.trim());
    const statusPayload = JSON.parse(mcpResponse.result.content[0].text);
    expect(mcpStatus.stderr).toBe("");
    expect(statusPayload.repo_id).toBe(repoId);
    expect(statusPayload.scan_count).toBeGreaterThan(0);
    expect(statusPayload.summary).toMatchObject({
      scan_count: 2,
      indexed_file_count: 1,
      source_change_count: 0,
      stale: false,
      audit_valid: true
    });
    expect(statusPayload.scan_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(statusPayload.next_commands).toContain(`drift prepare "task" --repo ${repoId} --json`);
    expect(statusPayload.audit_integrity.valid).toBe(true);
    expect(statusPayload.audit_integrity.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(statusPayload.indexed_file_count).toBeGreaterThan(0);

    const mcpAudit = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_audit_status",
        arguments: {
          repo_id: repoId
        }
      }
    });
    const mcpAuditResponse = JSON.parse(mcpAudit.stdout.trim());
    const mcpAuditPayload = JSON.parse(mcpAuditResponse.result.content[0].text);
    expect(mcpAudit.stderr).toBe("");
    expect(mcpAuditPayload.audit_integrity.valid).toBe(true);
    expect(mcpAuditPayload.summary).toMatchObject({
      valid: true,
      event_count: mcpAuditPayload.audit_integrity.event_count,
      verified_count: mcpAuditPayload.audit_integrity.verified_count,
      broken_at_event_id: null,
      reason_count: 0
    });
    expect(mcpAuditPayload.audit_integrity.head_event_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mcpAuditPayload.next_commands).toEqual([
      `drift audit list --repo ${repoId} --json`,
      `drift backup create --repo ${repoId} --confirm --json`
    ]);

    const mcpContract = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_repo_contract",
        arguments: {
          repo_id: repoId
        }
      }
    });
    const mcpContractResponse = JSON.parse(mcpContract.stdout.trim());
    const mcpContractPayload = JSON.parse(mcpContractResponse.result.content[0].text);
    expect(mcpContract.stderr).toBe("");
    expect(mcpContractPayload.contract_fingerprint).toBe(contractPayload.contract_fingerprint);

    const mcpPreflight = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "get_task_preflight",
        arguments: {
          repo_id: repoId,
          task: "add user search endpoint",
          path: "apps/web/app/api/users/route.ts",
          require_fresh: true
        }
      }
    });
    const mcpPreflightResponse = JSON.parse(mcpPreflight.stdout.trim());
    const mcpPreflightPayload = JSON.parse(mcpPreflightResponse.result.content[0].text);
    expect(mcpPreflight.stderr).toBe("");
    expect(mcpPreflightPayload).toMatchObject({
      task: "add user search endpoint",
      target_path: "apps/web/app/api/users/route.ts",
      governance: {
        read_only: true,
        agent_can_mutate: false
      },
      freshness_requirement: {
        required: true,
        satisfied: true
      },
      contract: {
        id: contractPayload.contract.id
      }
    });
    expect(mcpPreflightPayload.scan_status.scan_fingerprint).toBe(statusPayload.scan_fingerprint);
    expect(mcpPreflightPayload.relevant_files).toEqual([
      expect.objectContaining({
        path: "apps/web/app/api/users/route.ts",
        reasons: expect.arrayContaining(["requested path"])
      })
    ]);
    expect(mcpPreflightPayload.redactions.snippets_included).toBe(false);

    const mcpConventions = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "get_conventions",
        arguments: {
          repo_id: repoId,
          kind: "api_route_no_direct_data_access",
          capability: "deterministic_check",
          limit: 1,
          offset: 0
        }
      }
    });
    const mcpConventionsResponse = JSON.parse(mcpConventions.stdout.trim());
    const mcpConventionsPayload = JSON.parse(mcpConventionsResponse.result.content[0].text);
    expect(mcpConventions.stderr).toBe("");
    expect(mcpConventionsPayload).toMatchObject({
      filters: {
        kind: "api_route_no_direct_data_access",
        capability: "deterministic_check"
      },
      summary: {
        filtered_count: 1,
        listed_count: 1
      },
      pagination: {
        limit: 1,
        offset: 0,
        returned_count: 1,
        has_more: false,
        next_offset: null
      }
    });
    expect(mcpConventionsPayload.conventions).toEqual([
      expect.objectContaining({
        id: conventionId,
        kind: "api_route_no_direct_data_access"
      })
    ]);

    const mcpMap = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_repo_map",
        arguments: {
          repo_id: repoId,
          role: "api_route"
        }
      }
    });
    const mcpMapResponse = JSON.parse(mcpMap.stdout.trim());
    const mcpMapPayload = JSON.parse(mcpMapResponse.result.content[0].text);
    expect(mcpMap.stderr).toBe("");
    expect(mcpMapPayload.summary.listed_file_count).toBe(1);
    expect(mcpMapPayload.impact_summary.convention_coverage_count).toBe(1);
    expect(mcpMapPayload.freshness_requirement).toMatchObject({
      required: false,
      satisfied: true
    });
    expect(mcpMapPayload.files[0]).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      convention_ids: expect.arrayContaining([expect.stringMatching(/^convention_[a-f0-9]+$/)])
    });
    expect(mcpMapPayload.redactions.snippets_included).toBe(false);

    const mcpFindings = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_findings",
        arguments: {
          repo_id: repoId,
          path: "apps/web/app/api/users/route.ts",
          convention_id: conventionId,
          limit: 1,
          offset: 0,
          require_fresh: true
        }
      }
    });
    const mcpFindingsResponse = JSON.parse(mcpFindings.stdout.trim());
    const mcpFindingsPayload = JSON.parse(mcpFindingsResponse.result.content[0].text);
    expect(mcpFindings.stderr).toBe("");
    expect(mcpFindingsPayload.filters).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      convention_id: conventionId
    });
    expect(mcpFindingsPayload.freshness_requirement).toMatchObject({
      required: true,
      satisfied: true
    });
    expect(mcpFindingsPayload.summary).toMatchObject({
      total_count: 1,
      filtered_count: 1
    });
    expect(mcpFindingsPayload.pagination).toEqual({
      limit: 1,
      offset: 0,
      returned_count: 1,
      has_more: false,
      next_offset: null
    });
    expect(mcpFindingsPayload.findings).toEqual([
      expect.objectContaining({
        first_evidence: expect.objectContaining({
          file_path: "apps/web/app/api/users/route.ts"
        })
      })
    ]);

    const mcpAllowedContext = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_allowed_context",
        arguments: {
          repo_id: repoId,
          path: "apps/web/app/api/users/route.ts",
          require_fresh: true
        }
      }
    });
    const mcpAllowedContextResponse = JSON.parse(mcpAllowedContext.stdout.trim());
    const mcpAllowedContextPayload = JSON.parse(mcpAllowedContextResponse.result.content[0].text);
    expect(mcpAllowedContext.stderr).toBe("");
    expect(mcpAllowedContextPayload.decision.allowed).toBe(true);
    expect(mcpAllowedContextPayload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });
    expect(mcpAllowedContextPayload.freshness_requirement).toMatchObject({
      required: true,
      satisfied: true
    });
    expect(mcpAllowedContextPayload.summary).toMatchObject({
      allowed: true,
      mode: "local_only",
      surface: "mcp",
      indexed: true,
      matched_convention_count: 1,
      freshness_required: true,
      freshness_satisfied: true,
      approved_snippet_chars: 1200
    });
    expect(mcpAllowedContextPayload.file_context).toMatchObject({
      path: "apps/web/app/api/users/route.ts",
      indexed: true,
      roles: ["api_route"],
      convention_ids: expect.arrayContaining([expect.stringMatching(/^convention_[a-f0-9]+$/)])
    });
    expect(mcpAllowedContextPayload.next_commands).toContain(
      `drift policy show --repo ${repoId} --json`
    );

    const mcpRuntime = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_runtime_info",
        arguments: {}
      }
    });
    const runtimeResponse = JSON.parse(mcpRuntime.stdout.trim());
    const runtimePayload = JSON.parse(runtimeResponse.result.content[0].text);
    expect(mcpRuntime.stderr).toBe("");
    expect(runtimePayload.runtime).toMatchObject({
      mcp_version: "0.1.0",
      core_version: "0.1.0",
      supported_sqlite_schema_version: 9,
      storage_driver: "sqlite"
    });
    expect(runtimePayload.governance).toMatchObject({
      read_only: true,
      agent_can_mutate: false
    });

    const mcpCapabilities = await callInstalledMcp(consumerDir, databasePath!, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_capabilities",
        arguments: {}
      }
    });
    const mcpCapabilitiesResponse = JSON.parse(mcpCapabilities.stdout.trim());
    const mcpCapabilitiesPayload = JSON.parse(mcpCapabilitiesResponse.result.content[0].text);
    expect(mcpCapabilities.stderr).toBe("");
    expect(mcpCapabilitiesPayload.capabilities.mcp_read_only_tools).toContain("get_runtime_info");
    expect(mcpCapabilitiesPayload.capabilities.mcp_read_only_tools).toContain("get_audit_status");
    expect(mcpCapabilitiesPayload.capabilities.mcp_mutation_tools).toEqual([]);
  }, 120_000);
});
