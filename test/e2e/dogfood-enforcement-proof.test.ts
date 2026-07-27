import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { createReadOnlyMcpHandlers } from "../../packages/mcp/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-dogfood-proof-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Drift-on-Drift accepted-contract enforcement proof", () => {
  it("blocks a Drift MCP package boundary violation with CLI and MCP evidence parity", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("drift-package-boundary");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-25T00:00:00.000Z",
      "--json"
    ]);
    expect(scan.exitCode).toBe(0);
    const scanPayload = JSON.parse(scan.stdout);
    const databasePath = scanPayload.database_path;
    const repoId = scanPayload.repo.id;

    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    const repo = storage.getRepo(repoId)!;
    storage.upsertRepoContract({
      id: "contract_drift_package_boundary",
      repo_id: repoId,
      contract_schema_version: 1,
      repo_fingerprint: repo.fingerprint,
      created_at: "2026-05-25T00:00:01.000Z",
      updated_at: "2026-05-25T00:00:01.000Z",
      conventions: [],
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
      agent_permissions: [],
      agent_contracts: [{
        kind: "import_boundary",
        id: "agent_contract_mcp_no_cli_imports",
        version: 1,
        source_roles: ["mcp_module"],
        forbidden_imports: ["@drift/cli"],
        allowed_imports: ["@drift/core", "@drift/query", "@drift/storage"],
        allowed_delegate_imports: ["@drift/query"],
        enforcement: "blocking"
      }]
    });
    storage.close();

    const mcpSourcePath = "packages/mcp/src/index.ts";
    const sourceFile = join(repoRoot, mcpSourcePath);
    await writeFile(sourceFile, [
      "import { buildRepoMapReadModel } from \"@drift/query\";",
      "",
      "export function describeMcpReadiness() {",
      "  return buildRepoMapReadModel;",
      "}",
      ""
    ].join("\n"));
    const goodDiff = join(repoRoot, "..", "mcp-good.patch");
    await writeFile(goodDiff, [
      `diff --git a/${mcpSourcePath} b/${mcpSourcePath}`,
      `--- a/${mcpSourcePath}`,
      `+++ b/${mcpSourcePath}`,
      "@@ -1,5 +1,5 @@",
      "-import { buildReadiness } from \"@drift/query\";",
      "+import { buildRepoMapReadModel } from \"@drift/query\";",
      " ",
      " export function describeMcpReadiness() {",
      "-  return buildReadiness;",
      "+  return buildRepoMapReadModel;",
      " }",
      ""
    ].join("\n"));

    const goodCheck = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", goodDiff,
      "--scope", "changed-hunks",
      "--now", "2026-05-25T00:00:02.000Z",
      "--json"
    ]);
    if (goodCheck.exitCode !== 0) {
      throw new Error(`good Drift package-boundary check failed:\n${goodCheck.stderr}\n${goodCheck.stdout}`);
    }
    expect(JSON.parse(goodCheck.stdout).summary.blocking_count).toBe(0);

    await writeFile(sourceFile, [
      "import { runCli } from \"@drift/cli\";",
      "",
      "export function describeMcpReadiness() {",
      "  return runCli;",
      "}",
      ""
    ].join("\n"));
    const badDiff = join(repoRoot, "..", "mcp-bad.patch");
    await writeFile(badDiff, [
      `diff --git a/${mcpSourcePath} b/${mcpSourcePath}`,
      `--- a/${mcpSourcePath}`,
      `+++ b/${mcpSourcePath}`,
      "@@ -1,5 +1,5 @@",
      "-import { buildRepoMapReadModel } from \"@drift/query\";",
      "+import { runCli } from \"@drift/cli\";",
      " ",
      " export function describeMcpReadiness() {",
      "-  return buildRepoMapReadModel;",
      "+  return runCli;",
      " }",
      ""
    ].join("\n"));

    const badCheck = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--diff-file", badDiff,
      "--scope", "changed-hunks",
      "--now", "2026-05-25T00:00:03.000Z",
      "--json"
    ]);
    // A5: a blocked diff exits 2, distinct from 1 (Drift itself failed) and 3 (refusal). This
    // proof is Drift enforcing its own package boundary, so it must assert the blocked code.
    expect(badCheck.exitCode).toBe(2);
    const badPayload = JSON.parse(badCheck.stdout);
    const finding = badPayload.findings[0];

    expect(badPayload.check).toMatchObject({
      repo_contract_id: "contract_drift_package_boundary",
      status: "fail"
    });
    expect(finding).toMatchObject({
      check_id: badPayload.check.id,
      repo_contract_id: "contract_drift_package_boundary",
      convention_id: "agent_contract_mcp_no_cli_imports",
      title: "Import boundary contract violated",
      status: "new",
      diff_status: "new_in_diff",
      enforcement_result: "block",
      expected_layer: "allowed_import_boundary",
      actual_layer: "forbidden_import",
      suggested_fix: "Import through an accepted delegate instead of importing @drift/cli directly.",
      graph_path: [mcpSourcePath, "@drift/cli"]
    });
    expect(finding.evidence_refs[0]).toMatchObject({
      kind: "violation",
      file_path: mcpSourcePath,
      start_line: 1,
      end_line: 1,
      symbol: "runCli",
      import_source: "@drift/cli",
      scan_id: expect.stringMatching(/^scan_check_/),
      redaction_state: "none"
    });
    expect(finding.evidence_refs[0].file_hash).toHaveLength(64);

    const mcp = createReadOnlyMcpHandlers({ databasePath });
    const mcpContract = mcp.get_repo_contract({ repo_id: repoId });
    expect(mcpContract.contract.agent_contracts).toContainEqual(expect.objectContaining({
      id: "agent_contract_mcp_no_cli_imports",
      kind: "import_boundary"
    }));
    const mcpFindings = mcp.get_findings({ repo_id: repoId, convention_id: "agent_contract_mcp_no_cli_imports" });
    expect(mcpFindings.summary.filtered_count).toBe(badPayload.summary.blocking_count);
    expect(mcpFindings.summary.by_severity.error).toBe(badPayload.summary.blocking_count);
    expect(mcpFindings.findings[0]).toMatchObject({
      finding_id: finding.id,
      convention_id: "agent_contract_mcp_no_cli_imports",
      enforcement_result: "block",
      file_refs: [expect.objectContaining({
        file_path: mcpSourcePath,
        start_line: 1,
        end_line: 1,
        redaction_state: "line_only"
      })]
    });
    expect(JSON.stringify(mcpFindings.findings[0])).not.toContain("@drift/cli");
    expect(mcpFindings.findings[0]).not.toHaveProperty("evidence_refs");
  }, 15_000);
});
