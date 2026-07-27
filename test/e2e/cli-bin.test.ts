import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-cli-bin-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

async function runBuiltDrift(args: string[]) {
  return execFileAsync(process.execPath, [
    "packages/cli/dist/main.js",
    ...args
  ]);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("built drift CLI binary", () => {
  it("prints root help from the compiled package entrypoint", async () => {
    const result = await runBuiltDrift(["--help"]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Drift local repo intelligence");
    expect(result.stdout).toContain("drift start --repo-root . --accept-defaults");
  });

  it("prints version from the compiled package entrypoint", async () => {
    const result = await runBuiltDrift(["--version"]);

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("prints version JSON from the compiled package entrypoint", async () => {
    const result = await runBuiltDrift(["version", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.stderr).toBe("");
    expect(payload.runtime).toMatchObject({
      cli_version: "0.1.0",
      core_version: "0.1.0",
supported_sqlite_schema_version: 27,
      storage_driver: "sqlite"
    });
    expect(payload.v1_scope).toMatchObject({
      product_mode: "local_first_cli",
      primary_wedge: "typescript_api_route_layering",
      source_mutation: false
    });
  });

  it("prints capabilities JSON from the compiled package entrypoint", async () => {
    const result = await runBuiltDrift(["capabilities", "--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.stderr).toBe("");
    expect(payload.capabilities.read_only_cli).toContain("scan status");
    expect(payload.capabilities.human_confirmed_cli).toContain("findings mark-fixed --confirm");
    expect(payload.capabilities.human_confirmed_cli).toContain("findings mark-needs-review --confirm");
    expect(payload.capabilities.human_confirmed_cli).toContain("contract import --confirm");
    expect(payload.capabilities.mcp_read_only_tools).toContain("get_capabilities");
    expect(payload.capabilities.mcp_read_only_tools).toContain("get_audit_status");
    expect(payload.capabilities.mcp_mutation_tools).toEqual([]);
    expect(payload.capabilities.supported_wedge.check_scopes).toEqual([
      "changed-hunks",
      "changed-files",
      "full"
    ]);
  });

  it("prints command help without requiring database setup", async () => {
    const result = await runBuiltDrift(["check", "--help"]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Run deterministic checks");
    expect(result.stdout).toContain("drift --db <path> check --repo <repo_id>");
  });

  it("prints focused governance and artifact help without requiring database setup", async () => {
    const cases = [
      { args: ["backup", "--help"], expected: ["Back up Drift state", "backup verify <backup.sqlite>"] },
      { args: ["restore", "--help"], expected: ["Restore Drift state", "non-dry-run restores require --confirm"] },
      { args: ["contract", "--help"], expected: ["Inspect and move repo contracts", "contract import <path> --dry-run"] },
      { args: ["policy", "--help"], expected: ["Inspect and govern context egress policy", "policy agent grant"] },
      { args: ["audit", "--help"], expected: ["Inspect audit log", "--target-type finding"] },
      { args: ["baseline", "--help"], expected: ["Manage baselines", "baseline clear"] },
      { args: ["findings", "--help"], expected: ["Review findings", "findings accept-drift"] },
      { args: ["checks", "--help"], expected: ["List repo checks and safe commands", "checks list"] },
      { args: ["conventions", "--help"], expected: ["Review inferred conventions", "conventions exception add"] }
    ];

    for (const entry of cases) {
      const result = await runBuiltDrift(entry.args);
      expect(result.stderr).toBe("");
      for (const expected of entry.expected) {
        expect(result.stdout).toContain(expected);
      }
    }
  }, 15_000);

  it("runs doctor JSON from the compiled package entrypoint", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-direct-db");
    const result = await runBuiltDrift([
      "doctor",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.stderr).toBe("");
    expect(payload.repo_root).toBe(repoRoot);
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "package_manifest",
      status: "ok"
    }));
    expect(payload.checks).toContainEqual(expect.objectContaining({
      id: "typescript_files",
      status: "ok"
    }));
  });

  it("runs scan JSON from the compiled package entrypoint", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-direct-db");
    const result = await runBuiltDrift([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(result.stdout);

    expect(result.stderr).toBe("");
    expect(payload.summary.engine_source).toBe("rust");
    expect(payload.summary.files_indexed).toBe(1);
    expect(payload.candidates.map((candidate: any) => candidate.kind)).toContain("api_route_no_direct_data_access");
  });
});
