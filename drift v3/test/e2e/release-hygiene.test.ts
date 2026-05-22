import { readFile } from "node:fs/promises";
import { createDriftCapabilities } from "../../packages/core/src/capabilities";
import { describe, expect, it } from "vitest";

describe("release hygiene", () => {
  it("keeps the root package release gate explicit", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));

    expect(manifest.private).toBe(true);
    expect(manifest.packageManager).toBe("pnpm@10.28.0");
    expect(manifest.engines?.node).toBe(">=20.0.0");
    expect(manifest.scripts.verify).toBe("pnpm build && pnpm typecheck && pnpm test && pnpm test:e2e");
    expect(manifest.scripts["check:boundaries"]).toBe("node packages/cli/scripts/check-boundaries.mjs");
    expect(manifest.scripts["verify:ci"]).toBe("pnpm verify && pnpm check:boundaries && git diff --check");
  });

  it("runs the production verification gate in CI with least repository permissions", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm verify:ci");
  });

  it("defines a guarded engine binary release matrix", async () => {
    const workflow = await readFile(".github/workflows/engine-binary-release.yml", "utf8");

    for (const expected of [
      "name: Engine Binary Release",
      "workflow_dispatch:",
      "dry_run:",
      "permissions:",
      "contents: write",
      "id-token: write",
      "cancel-in-progress: false",
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "x86_64-unknown-linux-gnu",
      "aarch64-unknown-linux-gnu",
      "x86_64-pc-windows-msvc",
      "@drift/engine-darwin-arm64",
      "@drift/engine-darwin-x64",
      "@drift/engine-linux-x64-gnu",
      "@drift/engine-linux-arm64-gnu",
      "@drift/engine-win32-x64",
      "SHA256SUMS",
      "npm publish",
      "npm_config_provenance=true"
    ]) {
      expect(workflow).toContain(expected);
    }
    expect(workflow).toContain("if: ${{ inputs.dry_run == false || startsWith(github.ref, 'refs/tags/v') }}");
  });

  it("keeps engine binary package versions exact and workspace-free for publication", async () => {
    const cliManifest = JSON.parse(await readFile("packages/cli/package.json", "utf8"));
    const enginePackages = [
      "engine-darwin-arm64",
      "engine-darwin-x64",
      "engine-linux-x64-gnu",
      "engine-linux-arm64-gnu",
      "engine-win32-x64"
    ];

    for (const packageName of enginePackages) {
      const manifest = JSON.parse(await readFile(`packages/${packageName}/package.json`, "utf8"));
      expect(manifest.name).toBe(`@drift/${packageName}`);
      expect(manifest.version).toBe(cliManifest.version);
      expect(cliManifest.optionalDependencies?.[`@drift/${packageName}`]).toBe("workspace:*");
    }
  });

  it("documents every installed-package smoke surface that release tests execute", async () => {
    const readme = await readFile("README.md", "utf8");

    for (const expected of [
      "installed `drift doctor`",
      "installed `drift scan`",
      "installed `drift start --accept-defaults`",
      "installed `drift prepare`",
      "installed `drift baseline status`",
      "installed `drift contract show`",
      "installed `drift check`",
      "installed `drift findings list`",
      "installed `drift findings mark-needs-review --confirm`",
      "installed `drift findings mark-fixed --confirm`",
      "installed `drift audit list`",
      "installed `drift audit verify`",
      "installed `drift backup create --confirm`",
      "installed `drift backup list`",
      "installed `drift backup verify`",
      "installed `drift restore --dry-run`",
      "installed `drift restore --confirm`",
      "installed `drift version --json`",
      "installed `drift capabilities --json`",
      "installed MCP `get_runtime_info`",
      "installed MCP `get_capabilities`",
      "installed MCP `get_audit_status`",
      "installed `drift-mcp`"
    ]) {
      expect(readme).toContain(expected);
    }
    expect(readme).toContain("pnpm verify:ci");
  });

  it("documents every human-confirmed CLI capability in the governance section", async () => {
    const readme = await readFile("README.md", "utf8");
    const governanceSection = readme.slice(
      readme.indexOf("Governance changes require explicit human intent:"),
      readme.indexOf("## Architecture")
    );
    const capabilities = createDriftCapabilities();

    for (const command of capabilities.human_confirmed_cli) {
      const baseCommand = command.replace(" --confirm", "");
      const matchingLines = governanceSection
        .split("\n")
        .filter((line) => line.includes(`drift ${baseCommand}`));

      expect(matchingLines.length).toBeGreaterThan(0);
      expect(matchingLines.some((line) => line.includes("--confirm"))).toBe(true);
    }
  });

  it("documents every read-only MCP capability in package smoke", async () => {
    const readme = await readFile("README.md", "utf8");
    const capabilities = createDriftCapabilities();

    for (const tool of capabilities.mcp_read_only_tools) {
      expect(readme).toContain(`installed MCP \`${tool}\``);
    }
    expect(capabilities.mcp_mutation_tools).toEqual([]);
  });

  it("documents the V1 support matrix and deferred surfaces without overpromising", async () => {
    const readme = await readFile("README.md", "utf8");

    for (const expected of [
      "## V1 Support Matrix",
      "| Surface | V1 status |",
      "| TypeScript/JavaScript API route layering | Supported |",
      "| Python adapter | Deferred |",
      "| Desktop UI | Deferred |",
      "| Cloud sync | Deferred |",
      "| Duplicate helper detection | Deferred |",
      "Drift V1 does not mutate source code.",
      "drift capabilities --json",
      "contract_fingerprint",
      "scan_fingerprint",
      "audit verify",
      "get_audit_status"
    ]) {
      expect(readme).toContain(expected);
    }
  });

  it("ignores local Drift state and release artifacts that should never be committed", async () => {
    const gitignore = await readFile(".gitignore", "utf8");

    for (const expected of [
      ".drift/",
      "*.sqlite",
      "*.drift-backup.sqlite",
      "*.tgz",
      "coverage/"
    ]) {
      expect(gitignore).toContain(expected);
    }
  });
});
