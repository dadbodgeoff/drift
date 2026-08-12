import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDriftCapabilities } from "../../packages/core/src/capabilities";
import { MIGRATIONS } from "../../packages/storage/src/migrations";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("release hygiene", () => {
  it("keeps the root package release gate explicit", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));

    expect(manifest.private).toBe(true);
    expect(manifest.packageManager).toBe("pnpm@10.28.0");
    expect(manifest.engines?.node).toBe(">=20.0.0");
    // The release engine is a fixture of the test suite, not an optional convenience: four CLI
    // test files point DRIFT_ENGINE_BIN at target/release/drift-engine and fail without it.
    // Nothing built it, because `pnpm test:engine` is `cargo test` and that produces a debug
    // binary. It went unnoticed for as long as it did because a developer machine always has one
    // lying around from an eval run; the first clean runner to execute the suite failed ten tests
    // on it. `pnpm verify` declares the dependency so a fresh clone can run the gate.
    expect(manifest.scripts.verify).toBe(
      "pnpm build:engine && pnpm build && pnpm typecheck && pnpm test && pnpm test:e2e"
    );
    expect(manifest.scripts["build:engine"]).toBe("cargo build --release -p drift-engine");
    expect(manifest.scripts["format:engine"]).toBe("cargo fmt --all");
    expect(manifest.scripts["format:engine:check"]).toBe("cargo fmt --all -- --check");
    expect(manifest.scripts["lint:engine"]).toBe("cargo clippy -p drift-engine --all-targets -- -D warnings");
    expect(manifest.scripts["check:boundaries"]).toBe("node packages/cli/scripts/check-boundaries.mjs");
    expect(manifest.scripts["validate:release-matrix"]).toBe("node scripts/validate-engine-release-matrix.mjs");
    expect(manifest.scripts["validate:claims"]).toBe("node scripts/validate-product-claims.mjs");
    expect(manifest.scripts["beta:proof"]).toBe("node scripts/run-beta-proof.mjs");
    expect(manifest.scripts["release:proof"]).toBe("node scripts/generate-release-proof.mjs");
    expect(manifest.scripts["verify:ci"]).toBe(
      // T04 added `pnpm test:harness`: the external evaluation harness is the oracle every other
      // gate trusts, so a release must prove the oracle itself still works. O-3 added the two
      // eval suites themselves: the gate runs the external eval AND the pinned evasion matrix,
      // so no release can go green while an enforcement shape regressed on a real repo.
      // F-5 (D-2): the matrix validator now fails closed by default; verify:ci runs on machines
      // that legitimately cannot build most engine targets, so it names the dev escape hatch
      // explicitly. The release workflow runs the fail-closed default.
      // EW-4 added `pnpm eval:bench`: the ordinary-edit refusal rate and the parser-gap ratchet.
      // Gaps rose 99 -> 1,104 on formbricks once before, unnoticed, because nothing watched the
      // number - so the gate now fails on a rise and names the delta.
      // EW-7 added `pnpm eval:determinism`: determinism is the marketed claim, and it was only ever
      // measured by hand on two of the seven repos.
      //
      // PR #102 took the four eval steps back out, and the reason matters. A hosted runner has none
      // of the seven pinned evaluation repos and no release engine binary, and the battery does not
      // fit in the job timeout - so from the moment CI existed, those four steps could not run
      // there. Listing them did not execute them; it produced a gate that named an oracle it never
      // consulted. They now live in `verify:evals`, which is a LOCAL gate, and `verify:full` is the
      // union that any "verified" claim has to cite.
      "pnpm verify && pnpm test:harness && pnpm format:engine:check && pnpm lint:engine && pnpm check:boundaries && node scripts/validate-engine-release-matrix.mjs --allow-unverified && pnpm validate:claims && pnpm beta:proof && git diff --check",
    );
    expect(manifest.scripts["verify:evals"]).toBe(
      "pnpm eval:external && pnpm eval:evasion && pnpm eval:bench && pnpm eval:determinism"
    );
    expect(manifest.scripts["verify:full"]).toBe("pnpm verify:ci && pnpm verify:evals");
    expect(manifest.scripts["eval:evasion"]).toBe("node scripts/evasion-matrix.mjs");
    expect(manifest.scripts["eval:bench"]).toBe("node scripts/beta-bench.mjs");
    expect(manifest.scripts["eval:determinism"]).toBe("node scripts/determinism.mjs");
  });

  it("keeps root ignores from hiding package source files", async () => {
    const rootIgnore = await readFile(".gitignore", "utf8");

    // T82: the workspace is now the repo root, so a bare `packages/` rule would ignore all
    // package source. Engine binaries are the one thing under packages/ that is ignored, and
    // only by their specific paths.
    expect(rootIgnore).not.toMatch(/^packages\/$/m);
    expect(rootIgnore).toContain("packages/engine-*/bin/");
  });

  it("runs the production verification gate in CI with least repository permissions", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: true");
    // T82: the package now lives at the repo root, so CI no longer sets a working-directory.
    // Asserting its absence keeps a stray reintroduction visible.
    expect(workflow).not.toContain("working-directory: drift v3");
    expect(workflow).toContain("cache-dependency-path: pnpm-lock.yaml");
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
      "npm_config_provenance=true",
      "packages/factgraph",
      "packages/query",
      "drift-factgraph-*.tgz",
      "drift-query-*.tgz",
      "node scripts/validate-engine-release-matrix.mjs"
    ]) {
      expect(workflow).toContain(expected);
    }
    // T82: the package now lives at the repo root, so CI no longer sets a working-directory.
    // Asserting its absence keeps a stray reintroduction visible.
    expect(workflow).not.toContain("working-directory: drift v3");
    expect(workflow).toContain("cache-dependency-path: pnpm-lock.yaml");
    expect(workflow).toContain("path: .release/npm/*.tgz");
    expect(workflow).toContain("path: .release/final-release-proof.json");
    expect(workflow).toContain("mkdir -p \"${RUNNER_TEMP}/drift-release-proof\"");
    expect(workflow).toContain("DRIFT_VERIFY_CI_STATUS=passed node scripts/run-beta-proof.mjs --output \"${RUNNER_TEMP}/drift-release-proof/beta-proof.json\"");
    expect(workflow).toContain("node scripts/generate-release-proof.mjs --require-clean --require-built-cli --require-beta-proof --beta-proof-file \"${RUNNER_TEMP}/drift-release-proof/beta-proof.json\" --output \"${RUNNER_TEMP}/drift-release-proof/release-proof.json\"");
    expect(workflow).toContain("${{ runner.temp }}/drift-release-proof/beta-proof.json");
    expect(workflow).toContain("${{ runner.temp }}/drift-release-proof/release-proof.json");
    expect(workflow.indexOf("name: Build JavaScript packages")).toBeLessThan(workflow.indexOf("name: Prepare exact publish manifests"));
    expect(workflow).toContain("npm pack \"./${package_dir}\" --ignore-scripts --json --pack-destination .release/npm");
    expect(workflow.indexOf("name: Installed package smoke")).toBeLessThan(workflow.indexOf("name: Final release proof"));
    expect(workflow.slice(workflow.indexOf("name: Installed package smoke"), workflow.indexOf("name: Final release proof"))).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("name: Final release proof");
    expect(workflow).toContain("drift-beta-preflight-proof");
    expect(workflow).toContain("drift-final-release-proof");
    expect(workflow).toContain("node scripts/generate-release-proof.mjs --require-clean --require-built-cli --require-complete --require-beta-proof --beta-proof-file .release/proof/beta-proof.json --output .release/final-release-proof.json");
    expect(workflow).toContain("beta-proof.json");
    expect(workflow).toContain("if: ${{ inputs.dry_run == false || startsWith(github.ref, 'refs/tags/v') }}");
  });

  it("generates a release proof artifact with source and built schema fields", () => {
    const output = execFileSync("node", ["scripts/generate-release-proof.mjs"], {
      encoding: "utf8"
    });
    const proof = JSON.parse(output);

    expect(proof.schema_version).toBe("drift.release.proof.v1");
    expect(proof.release_version).toBe("0.1.0");
    expect(proof.source_schema_version).toBe(MIGRATIONS.length);
    expect(proof.built_schema_version === null || proof.built_schema_version === MIGRATIONS.length).toBe(true);
    expect(proof.dirty_state).toEqual(expect.any(Boolean));
    expect(proof.engine_targets).toHaveLength(5);
    expect(proof.beta_proof).toMatchObject({
      clean_git: expect.any(Boolean),
      verify_ci_passed: expect.any(Boolean),
      rust_engine_required: true,
      fallback_absent: expect.any(Boolean),
      fresh_scan_verified: null,
      response_schemas_verified: null,
      good_route_passed: null,
      bad_route_blocked: null,
      finding_evidence_complete: null,
      capability_report_verified: null,
      machine_contract_versions_verified: null,
      finding_evidence_confidence_verified: null,
      required_check_execution_proof_verified: null,
      contract_parity_verified: null,
      mcp_cli_parity_verified: false,
      audit_verified: null
    });
    expect(proof.verification).toMatchObject({
      source_build_schema_match: expect.any(Boolean),
      release_ready: expect.any(Boolean),
      beta_ready: false,
      beta_missing: expect.arrayContaining([
        "verify_ci_passed",
        "rust_engine_no_fallback",
        "fresh_scan_verified",
        "response_schemas_verified",
        "good_route_passed",
        "bad_route_blocked",
        "finding_evidence_complete",
        "capability_report_verified",
        "machine_contract_versions_verified",
        "finding_evidence_confidence_verified",
        "required_check_execution_proof_verified",
        "realistic_fixture_matrix_verified",
        "no_false_prisma_fixture_verified",
        "non_next_fixture_graceful_verified",
        "parser_gap_quality_verified",
        "contract_parity_verified",
        "mcp_cli_parity_verified",
        "audit_verified"
      ])
    });
  });

  it("runs an executable beta proof and feeds release proof without manual beta env fields", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "drift-beta-proof-test-"));
    tempDirs.push(tempDir);
    const betaProofPath = join(tempDir, "beta-proof.json");

    const betaOutput = execFileSync("node", ["scripts/run-beta-proof.mjs", "--output", betaProofPath], {
      encoding: "utf8"
    });
    const betaProof = JSON.parse(betaOutput);

    expect(betaProof.schema_version).toBe("drift.beta.proof.v1");
    expect(betaProof.beta_proof).toMatchObject({
      fallback_used: false,
      fresh_scan_verified: true,
      response_schemas_verified: true,
      good_route_passed: true,
      bad_route_blocked: true,
      finding_evidence_complete: true,
      capability_report_verified: true,
      machine_contract_versions_verified: true,
      finding_evidence_confidence_verified: true,
      required_check_execution_proof_verified: true,
      semantic_beta_proof_verified: true,
      realistic_fixture_matrix_verified: true,
      no_false_prisma_fixture_verified: true,
      non_next_fixture_graceful_verified: true,
      parser_gap_quality_verified: true,
      contract_parity_verified: true,
      mcp_cli_parity_verified: true,
      audit_verified: true
    });
    expect(betaProof.evidence.contract_parity.summary).toMatchObject({
      missing_count: 0,
      partial_beta_required_count: 0
    });
    expect(betaProof.evidence.capability_report).toMatchObject({
      schema_version: "drift.scan_capability_report.v1",
      scan_id: betaProof.beta_proof.scan_id
    });
    expect(betaProof.evidence.machine_contract_versions).toMatchObject({
      schema_version: "drift.machine_contract_versions.v1"
    });
    expect(betaProof.evidence.semantic_beta_proof).toMatchObject({
      schema_version: "drift.semantic_beta_proof.v1",
      semantic_capability_contracts_verified: true,
      partial_beta_required_count: 0,
      unsupported_beta_required_count: 0
    });
    expect(betaProof.evidence.realistic_fixture_matrix).toMatchObject({
      realistic_fixture_matrix_verified: true,
      no_false_prisma_fixture_verified: true,
      non_next_fixture_graceful_verified: true
    });
    expect(betaProof.evidence.parser_gap_quality).toMatchObject({
      parser_gap_quality_verified: true,
      clean_quality: {
        schema_version: "drift.parser_gap_quality.v1",
        total_count: 0,
        user_action: "No parser gap action required."
      }
    });
    expect(betaProof.evidence.finding_evidence_confidence).toMatchObject({
      confidence_kind: "deterministic",
      extractor: expect.any(String),
      snippet_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(betaProof.beta_proof.dogfood_or_fixture_repo_id).toMatch(/^repo_[a-f0-9]+$/);
    expect(betaProof.beta_proof.scan_id).toMatch(/^scan_/);
    expect(betaProof.beta_proof.repo_contract_id).toMatch(/^contract_/);
    expect(betaProof.beta_proof.check_id).toMatch(/^check_/);
    expect(betaProof.beta_proof.mcp_cli_parity_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(betaProof.beta_proof.audit_head_hash).toMatch(/^[a-f0-9]{64}$/);

    const releaseOutput = execFileSync("node", [
      "scripts/generate-release-proof.mjs",
      "--beta-proof-file",
      betaProofPath
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        DRIFT_VERIFY_CI_STATUS: "passed"
      }
    });
    const releaseProof = JSON.parse(releaseOutput);
    const missingWithoutGitClean = releaseProof.verification.beta_missing
      .filter((field: string) => field !== "clean_git");

    expect(releaseProof.beta_proof).toMatchObject({
      verify_ci_passed: true,
      fallback_absent: true,
      fresh_scan_verified: true,
      response_schemas_verified: true,
      dogfood_or_fixture_repo_id: betaProof.beta_proof.dogfood_or_fixture_repo_id,
      scan_id: betaProof.beta_proof.scan_id,
      repo_contract_id: betaProof.beta_proof.repo_contract_id,
      check_id: betaProof.beta_proof.check_id,
      good_route_passed: true,
      bad_route_blocked: true,
      finding_evidence_complete: true,
      capability_report_verified: true,
      machine_contract_versions_verified: true,
      finding_evidence_confidence_verified: true,
      required_check_execution_proof_verified: true,
      contract_parity_verified: true,
      mcp_cli_parity_hash: betaProof.beta_proof.mcp_cli_parity_hash,
      mcp_cli_parity_verified: true,
      audit_head_hash: betaProof.beta_proof.audit_head_hash,
      audit_verified: true
    });
    expect(missingWithoutGitClean).toEqual([]);
  }, 30_000);

  it("does not allow require-beta-proof to be self-attested with env fields", () => {
    expect(() =>
      execFileSync("node", [
        "scripts/generate-release-proof.mjs",
        "--require-beta-proof"
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          DRIFT_VERIFY_CI_STATUS: "passed",
          DRIFT_RELEASE_FALLBACK_USED: "false",
          DRIFT_RELEASE_FRESH_SCAN_VERIFIED: "true",
          DRIFT_RELEASE_RESPONSE_SCHEMAS_VERIFIED: "true",
          DRIFT_RELEASE_REPO_ID: "repo_deadbeef",
          DRIFT_RELEASE_SCAN_ID: "scan_deadbeef",
          DRIFT_RELEASE_REPO_CONTRACT_ID: "contract_deadbeef",
          DRIFT_RELEASE_CHECK_ID: "check_deadbeef",
          DRIFT_RELEASE_GOOD_ROUTE_PASSED: "true",
          DRIFT_RELEASE_BAD_ROUTE_BLOCKED: "true",
          DRIFT_RELEASE_FINDING_EVIDENCE_COMPLETE: "true",
          DRIFT_RELEASE_REQUIRED_CHECK_EXECUTION_PROOF_VERIFIED: "true",
          DRIFT_RELEASE_CONTRACT_PARITY_VERIFIED: "true",
          DRIFT_RELEASE_MCP_CLI_PARITY_HASH: "0".repeat(64),
          DRIFT_RELEASE_AUDIT_HEAD_HASH: "1".repeat(64),
          DRIFT_RELEASE_AUDIT_VERIFIED: "true"
        }
      })
    ).toThrow(/--require-beta-proof requires --beta-proof-file/);
  });

  it("validates the engine release matrix against package manifests", () => {
    // Dev mode: engine binaries are gitignored local artifacts, so this tree legitimately has
    // gaps. F-5 (D-2): the summary must state how many targets are actually verified - the old
    // output claimed "Validated 5 engine release targets" with zero artifacts present.
    const output = execFileSync(
      "node",
      ["scripts/validate-engine-release-matrix.mjs", "--allow-unverified"],
      { encoding: "utf8" }
    );

    expect(output).toMatch(/engine release targets verified for Drift/);
    expect(output).not.toContain("Validated 5 engine release targets");
  });

  it("keeps engine binary package versions exact and workspace-free for publication", async () => {
    const cliManifest = JSON.parse(await readFile("packages/cli/package.json", "utf8"));
    const assertReleaseVersionsScript = await readFile("scripts/assert-release-versions.mjs", "utf8");
    const preparePublishManifestsScript = await readFile("scripts/prepare-npm-publish-manifests.mjs", "utf8");
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
    for (const runtimePackage of ["factgraph", "query"]) {
      expect(assertReleaseVersionsScript).toContain(`packages/${runtimePackage}/package.json`);
      expect(preparePublishManifestsScript).toContain(`packages/${runtimePackage}/package.json`);
    }
  });

  it("documents every installed-package smoke surface that release tests execute", async () => {
    const readme = await readFile("README.md", "utf8");

    for (const expected of [
      "installed `drift doctor`",
      "installed `drift scan`",
      "installed `drift conventions accepted --kind --capability --limit --offset`",
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
      "installed `drift-mcp`",
      "`pnpm beta:proof`"
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

  it("validates production claims against the machine-readable capabilities manifest", async () => {
    const output = execFileSync("node", ["scripts/validate-product-claims.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const claims = JSON.parse(await readFile(join("docs", "architecture", "beta-claims.json"), "utf8"));

    expect(output).toContain("Validated Drift production claims manifest");
    expect(output).toContain("runtime capabilities");
    expect(claims.schema_version).toBe("drift.production.claims.v1");
    expect(claims.allowed_claims).toContain("typescript_api_route_layering");
    expect(claims.allowed_claims).toContain("incremental_reuse");
    expect(claims.blocked_claims).not.toContain("incremental_reuse");
    expect(claims.blocked_claims).toContain("mutation_capable_mcp");
  });

  it("does not promote duplicate helper detection until contract parity and claims allow it", async () => {
    const capabilities = createDriftCapabilities();

    expect(capabilities.deferred).toContain("duplicate_helper_detection");
    expect(capabilities.supported_wedge.convention_kinds).not.toContain("duplicate_helper_detection");
    expect(capabilities.contract_parity.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ReleaseProofContract",
          confidence: "complete",
          release_proof: "covered"
        })
      ])
    );
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

  it("keeps adapter internals behind the public adapter registry package", async () => {
    const boundaryScript = await readFile("packages/cli/scripts/check-boundaries.mjs", "utf8");

    expect(boundaryScript).toContain("adapters: join(repoRoot, \"packages/adapters/src\")");
    expect(boundaryScript).toContain("@drift\\/adapters\\/");
    expect(boundaryScript).toContain("imports adapter internals directly");
  });

  it("keeps OSS trust and contribution rails in place", async () => {
    const license = await readFile("LICENSE", "utf8");
    const security = await readFile("SECURITY.md", "utf8");
    const contributing = await readFile("CONTRIBUTING.md", "utf8");
    const prTemplate = await readFile(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
    const bugTemplate = await readFile(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");
    const featureTemplate = await readFile(".github/ISSUE_TEMPLATE/feature_request.yml", "utf8");

    expect(license).toContain("MIT License");
    expect(security).toContain("local-first");
    expect(security).toContain("Do not include private source code");
    expect(contributing).toContain("pnpm verify:ci");
    expect(contributing).toContain("Rust owns deterministic parser and rule authority");
    expect(prTemplate).toContain("No source snippets or secrets are added to outputs");
    expect(bugTemplate).toContain("Drift version");
    expect(featureTemplate).toContain("V1 wedge");
  });

  it("keeps the beta intelligence gate honest about supported and deferred scope", async () => {
    const gate = await readFile("docs/architecture/beta-intelligence-gate.md", "utf8");

    for (const expected of [
      "Drift is a local-first TypeScript/JavaScript repo intelligence guardrail",
      "pnpm verify:ci",
      "docs/dogfood/drift-on-drift.md",
      "Rust owns parser and deterministic rule authority",
      "Blocking enforcement is allowed only when parser completeness permits it",
      "MCP must not accept, reject, edit, suppress, import, export",
      "full platform engine binary publishing",
      "Python and additional language adapters",
      "Desktop review UI",
      "Cloud or team sync",
      "Duplicate-helper detection",
      "Write-capable MCP tools"
    ]) {
      expect(gate).toContain(expected);
    }
  });
});
