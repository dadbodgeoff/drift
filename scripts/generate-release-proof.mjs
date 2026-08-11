#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const outputPath = valueFlag("--output");
const betaProofPath = valueFlag("--beta-proof-file");
const requireClean = args.has("--require-clean");
const requireBuiltCli = args.has("--require-built-cli");
const requireComplete = args.has("--require-complete");
const requireBetaProof = args.has("--require-beta-proof");

const root = process.cwd();
const rootManifest = readJson("package.json");
const cliManifest = readJson("packages/cli/package.json");
const engineTargets = engineReleaseTargets();
const sourceSchemaVersion = migrationIds().length;
const builtVersion = builtCliVersion();
const builtSchemaVersion = builtVersion?.runtime?.supported_sqlite_schema_version ?? null;
const dirtyEntries = gitStatusPorcelainEntries().filter((entry) => !isGeneratedReleaseArtifactEntry(entry));
const dirtyState = dirtyEntries.length > 0;
const sourceBuildSchemaMatch = builtSchemaVersion !== null && builtSchemaVersion === sourceSchemaVersion;
const packageVersions = packageVersionMap([
  "packages/core",
  "packages/engine-contract",
  "packages/factgraph",
  "packages/query",
  "packages/storage",
  "packages/cli",
  "packages/mcp",
  ...engineTargets.map((target) => `packages/${target.package_dir}`)
]);
const npmTarballs = listFiles(".release/npm", ".tgz").map((path) => ({
  path,
  sha256: sha256File(path),
  size_bytes: statSync(path).size
}));
const engineArtifactSha256 = listEngineChecksums();
const installedCliSmokeResults = {
  version_json: Boolean(builtVersion),
  schema_version: builtSchemaVersion,
  engine_status: builtVersion?.engine?.status ?? null,
  engine_source: builtVersion?.engine?.source ?? null
};
const installedMcpSmokeResults = {
  present: existsSync("packages/mcp/dist/index.js")
};
if (requireBetaProof && !betaProofPath) {
  console.error("Release proof failed: --require-beta-proof requires --beta-proof-file from scripts/run-beta-proof.mjs.");
  process.exit(1);
}
const betaProofInput = betaProofPath ? readBetaProofInput(betaProofPath, { strict: requireBetaProof }) : null;
const betaProof = betaProofFields({
  dirtyState,
  sourceBuildSchemaMatch,
  installedCliSmokeResults,
  betaProofInput
});
const betaMissing = missingBetaProofFields(betaProof);
const betaReady = betaMissing.length === 0;
const releaseReady = !dirtyState &&
  sourceBuildSchemaMatch &&
  npmTarballs.length > 0 &&
  engineArtifactSha256.length === engineTargets.length;

const proof = {
  schema_version: "drift.release.proof.v1",
  release_version: rootManifest.version,
  git_ref: process.env.GITHUB_REF ?? gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown",
  git_sha: process.env.GITHUB_SHA ?? gitOutput(["rev-parse", "HEAD"]) ?? "unknown",
  workflow_run_id: process.env.GITHUB_RUN_ID ?? null,
  dirty_state: dirtyState,
  dirty_entries: dirtyEntries,
  verify_ci_status: process.env.DRIFT_VERIFY_CI_STATUS ?? null,
  node_version: process.version,
  pnpm_version: packageManagerVersion(rootManifest.packageManager),
  cargo_version: gitOutput(["--version"], "cargo") ?? null,
  package_versions: packageVersions,
  source_schema_version: sourceSchemaVersion,
  built_schema_version: builtSchemaVersion,
  engine_targets: engineTargets,
  engine_artifact_sha256: engineArtifactSha256,
  npm_tarballs: npmTarballs,
  installed_cli_smoke_results: installedCliSmokeResults,
  installed_mcp_smoke_results: installedMcpSmokeResults,
  beta_proof: betaProof,
  created_at: new Date().toISOString(),
  verification: {
    source_build_schema_match: sourceBuildSchemaMatch,
    release_ready: releaseReady,
    beta_ready: betaReady,
    missing: missingProofFields({
      built_schema_version: builtSchemaVersion,
      npm_tarballs: npmTarballs,
      engine_artifact_sha256: engineArtifactSha256
    }),
    beta_missing: betaMissing
  }
};

if (outputPath) {
  writeFileSync(resolve(outputPath), `${JSON.stringify(proof, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);

if (requireClean && dirtyState) {
  console.error("Release proof failed: git worktree is dirty.");
  process.exit(1);
}
if (requireBuiltCli && !sourceBuildSchemaMatch) {
  console.error("Release proof failed: built CLI schema version is missing or does not match source migrations.");
  process.exit(1);
}
if (requireComplete && !releaseReady) {
  console.error(`Release proof failed: incomplete proof (${proof.verification.missing.join(", ") || "unknown"}).`);
  process.exit(1);
}
if (requireBetaProof && !betaReady) {
  console.error(`Release proof failed: incomplete beta proof (${proof.verification.beta_missing.join(", ") || "unknown"}).`);
  process.exit(1);
}

function valueFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function migrationIds() {
  const source = readFileSync(resolve("packages/storage/src/migrations.ts"), "utf8");
  return [...source.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function builtCliVersion() {
  const entrypoint = resolve("packages/cli/dist/main.js");
  if (!existsSync(entrypoint)) {
    return null;
  }
  try {
    return JSON.parse(execFileSync(process.execPath, [entrypoint, "version", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }));
  } catch {
    return null;
  }
}

function gitStatusPorcelainEntries() {
  return (gitOutput(["status", "--porcelain"]) ?? "")
    .split(/\r?\n/)
    .filter(Boolean);
}

function isGeneratedReleaseArtifactEntry(entry) {
  const path = entry.slice(3);
  return path === "SHA256SUMS" ||
    path === "beta-proof.json" ||
    path === "release-proof.json" ||
    path.startsWith(".release/");
}

function gitOutput(args, command = "git") {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function engineReleaseTargets() {
  return [
    target("aarch64-apple-darwin", "engine-darwin-arm64"),
    target("x86_64-apple-darwin", "engine-darwin-x64"),
    target("x86_64-unknown-linux-gnu", "engine-linux-x64-gnu"),
    target("aarch64-unknown-linux-gnu", "engine-linux-arm64-gnu"),
    target("x86_64-pc-windows-msvc", "engine-win32-x64")
  ];
}

function target(targetTriple, packageDir) {
  const manifest = readJson(`packages/${packageDir}/package.json`);
  return {
    target: targetTriple,
    package_dir: packageDir,
    package_name: manifest.name,
    package_version: manifest.version,
    os: manifest.os?.[0] ?? null,
    cpu: manifest.cpu?.[0] ?? null,
    libc: manifest.libc?.[0] ?? null
  };
}

function packageVersionMap(packageDirs) {
  return Object.fromEntries(packageDirs.map((packageDir) => {
    const manifest = readJson(`${packageDir}/package.json`);
    return [manifest.name, manifest.version];
  }));
}

function packageManagerVersion(value) {
  return typeof value === "string" && value.includes("@") ? value.split("@").at(-1) ?? null : null;
}

function listEngineChecksums() {
  const checksumPath = resolve("SHA256SUMS");
  if (!existsSync(checksumPath)) {
    return [];
  }
  return readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha256, path] = line.trim().split(/\s+/, 2);
      return { path, sha256 };
    });
}

function listFiles(dir, suffix) {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute)
    .filter((entry) => entry.endsWith(suffix))
    .sort()
    .map((entry) => join(dir, entry));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

function readBetaProofInput(path, options = {}) {
  const payload = readJson(path);
  if (options.strict && payload?.schema_version !== "drift.beta.proof.v1") {
    throw new Error("--beta-proof-file must be a drift.beta.proof.v1 artifact from scripts/run-beta-proof.mjs.");
  }
  if (payload && typeof payload === "object" && "beta_proof" in payload) {
    return payload.beta_proof;
  }
  if (options.strict) {
    throw new Error("--beta-proof-file must contain a beta_proof object.");
  }
  return payload;
}

function betaProofFields({ dirtyState, sourceBuildSchemaMatch, installedCliSmokeResults, betaProofInput }) {
  const strictBetaInput = requireBetaProof && betaProofInput;
  const fallbackUsed = booleanInput(
    betaProofInput,
    "fallback_used",
    strictBetaInput ? null : "DRIFT_RELEASE_FALLBACK_USED"
  );
  const goodRoutePassed = booleanInput(
    betaProofInput,
    "good_route_passed",
    strictBetaInput ? null : "DRIFT_RELEASE_GOOD_ROUTE_PASSED"
  );
  const badRouteBlocked = booleanInput(
    betaProofInput,
    "bad_route_blocked",
    strictBetaInput ? null : "DRIFT_RELEASE_BAD_ROUTE_BLOCKED"
  );
  const freshScanVerified = booleanInput(
    betaProofInput,
    "fresh_scan_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_FRESH_SCAN_VERIFIED"
  );
  const responseSchemasVerified = booleanInput(
    betaProofInput,
    "response_schemas_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_RESPONSE_SCHEMAS_VERIFIED"
  );
  const findingEvidenceComplete = booleanInput(
    betaProofInput,
    "finding_evidence_complete",
    strictBetaInput ? null : "DRIFT_RELEASE_FINDING_EVIDENCE_COMPLETE"
  );
  const capabilityReportVerified = booleanInput(
    betaProofInput,
    "capability_report_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_CAPABILITY_REPORT_VERIFIED"
  );
  const machineContractVersionsVerified = booleanInput(
    betaProofInput,
    "machine_contract_versions_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_MACHINE_CONTRACT_VERSIONS_VERIFIED"
  );
  const findingEvidenceConfidenceVerified = booleanInput(
    betaProofInput,
    "finding_evidence_confidence_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_FINDING_EVIDENCE_CONFIDENCE_VERIFIED"
  );
  const requiredCheckExecutionProofVerified = booleanInput(
    betaProofInput,
    "required_check_execution_proof_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_REQUIRED_CHECK_EXECUTION_PROOF_VERIFIED"
  );
  const realisticFixtureMatrixVerified = booleanInput(
    betaProofInput,
    "realistic_fixture_matrix_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_REALISTIC_FIXTURE_MATRIX_VERIFIED"
  );
  const noFalsePrismaFixtureVerified = booleanInput(
    betaProofInput,
    "no_false_prisma_fixture_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_NO_FALSE_PRISMA_FIXTURE_VERIFIED"
  );
  const nonNextFixtureGracefulVerified = booleanInput(
    betaProofInput,
    "non_next_fixture_graceful_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_NON_NEXT_FIXTURE_GRACEFUL_VERIFIED"
  );
  const parserGapQualityVerified = booleanInput(
    betaProofInput,
    "parser_gap_quality_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_PARSER_GAP_QUALITY_VERIFIED"
  );
  const contractParityVerified = booleanInput(
    betaProofInput,
    "contract_parity_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_CONTRACT_PARITY_VERIFIED"
  );
  const auditVerified = booleanInput(
    betaProofInput,
    "audit_verified",
    strictBetaInput ? null : "DRIFT_RELEASE_AUDIT_VERIFIED"
  );
  const verifyCiStatus = stringInput(betaProofInput, "verify_ci_status", "DRIFT_VERIFY_CI_STATUS");
  const mcpCliParityHash = stringInput(
    betaProofInput,
    "mcp_cli_parity_hash",
    strictBetaInput ? null : "DRIFT_RELEASE_MCP_CLI_PARITY_HASH"
  );
  return {
    clean_git: !dirtyState,
    verify_ci_status: verifyCiStatus,
    verify_ci_passed: verifyCiStatus === "passed",
    source_build_schema_match: sourceBuildSchemaMatch,
    rust_engine_required: true,
    installed_engine_source: installedCliSmokeResults.engine_source,
    fallback_used: fallbackUsed,
    fallback_absent: fallbackUsed === false,
    fresh_scan_verified: freshScanVerified,
    response_schemas_verified: responseSchemasVerified,
    dogfood_or_fixture_repo_id: stringInput(
      betaProofInput,
      "dogfood_or_fixture_repo_id",
      strictBetaInput ? null : "DRIFT_RELEASE_REPO_ID"
    ),
    scan_id: stringInput(betaProofInput, "scan_id", strictBetaInput ? null : "DRIFT_RELEASE_SCAN_ID"),
    repo_contract_id: stringInput(
      betaProofInput,
      "repo_contract_id",
      strictBetaInput ? null : "DRIFT_RELEASE_REPO_CONTRACT_ID"
    ),
    check_id: stringInput(betaProofInput, "check_id", strictBetaInput ? null : "DRIFT_RELEASE_CHECK_ID"),
    good_route_passed: goodRoutePassed,
    bad_route_blocked: badRouteBlocked,
    finding_evidence_complete: findingEvidenceComplete,
    capability_report_verified: capabilityReportVerified,
    machine_contract_versions_verified: machineContractVersionsVerified,
    finding_evidence_confidence_verified: findingEvidenceConfidenceVerified,
    required_check_execution_proof_verified: requiredCheckExecutionProofVerified,
    realistic_fixture_matrix_verified: realisticFixtureMatrixVerified,
    no_false_prisma_fixture_verified: noFalsePrismaFixtureVerified,
    non_next_fixture_graceful_verified: nonNextFixtureGracefulVerified,
    parser_gap_quality_verified: parserGapQualityVerified,
    contract_parity_verified: contractParityVerified,
    mcp_cli_parity_hash: mcpCliParityHash,
    mcp_cli_parity_verified: Boolean(mcpCliParityHash),
    audit_head_hash: stringInput(
      betaProofInput,
      "audit_head_hash",
      strictBetaInput ? null : "DRIFT_RELEASE_AUDIT_HEAD_HASH"
    ),
    audit_verified: auditVerified
  };
}

function stringInput(input, field, envName) {
  const value = input?.[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return envName ? process.env[envName] ?? null : null;
}

function booleanInput(input, field, envName) {
  if (typeof input?.[field] === "boolean") {
    return input[field];
  }
  return envName ? booleanEnv(envName) : null;
}

function booleanEnv(name) {
  const value = process.env[name];
  if (value === undefined) {
    return null;
  }
  if (value === "true" || value === "1" || value === "passed") {
    return true;
  }
  if (value === "false" || value === "0" || value === "failed") {
    return false;
  }
  return null;
}

function missingBetaProofFields(proof) {
  const missing = [];
  if (!proof.clean_git) {
    missing.push("clean_git");
  }
  if (!proof.verify_ci_passed) {
    missing.push("verify_ci_passed");
  }
  if (!proof.source_build_schema_match) {
    missing.push("source_build_schema_match");
  }
  if (proof.installed_engine_source === "typescript" || proof.fallback_absent !== true) {
    missing.push("rust_engine_no_fallback");
  }
  if (!/^repo_[a-f0-9]+$/.test(proof.dogfood_or_fixture_repo_id ?? "")) {
    missing.push("dogfood_or_fixture_repo_id_format");
  }
  if (!/^scan_/.test(proof.scan_id ?? "")) {
    missing.push("scan_id_format");
  }
  if (!/^contract_/.test(proof.repo_contract_id ?? "")) {
    missing.push("repo_contract_id_format");
  }
  if (!/^check_/.test(proof.check_id ?? "")) {
    missing.push("check_id_format");
  }
  if (!/^[a-f0-9]{64}$/.test(proof.mcp_cli_parity_hash ?? "")) {
    missing.push("mcp_cli_parity_hash_format");
  }
  if (!/^[a-f0-9]{64}$/.test(proof.audit_head_hash ?? "")) {
    missing.push("audit_head_hash_format");
  }
  for (const [field, value] of Object.entries({
    dogfood_or_fixture_repo_id: proof.dogfood_or_fixture_repo_id,
    scan_id: proof.scan_id,
    repo_contract_id: proof.repo_contract_id,
    check_id: proof.check_id,
    fresh_scan_verified: proof.fresh_scan_verified,
    response_schemas_verified: proof.response_schemas_verified,
    good_route_passed: proof.good_route_passed,
    bad_route_blocked: proof.bad_route_blocked,
    finding_evidence_complete: proof.finding_evidence_complete,
    capability_report_verified: proof.capability_report_verified,
    machine_contract_versions_verified: proof.machine_contract_versions_verified,
    finding_evidence_confidence_verified: proof.finding_evidence_confidence_verified,
    required_check_execution_proof_verified: proof.required_check_execution_proof_verified,
    realistic_fixture_matrix_verified: proof.realistic_fixture_matrix_verified,
    no_false_prisma_fixture_verified: proof.no_false_prisma_fixture_verified,
    non_next_fixture_graceful_verified: proof.non_next_fixture_graceful_verified,
    parser_gap_quality_verified: proof.parser_gap_quality_verified,
    contract_parity_verified: proof.contract_parity_verified,
    mcp_cli_parity_verified: proof.mcp_cli_parity_verified,
    audit_head_hash: proof.audit_head_hash,
    audit_verified: proof.audit_verified
  })) {
    if (value !== true && (typeof value !== "string" || value.length === 0)) {
      missing.push(field);
    }
  }
  return missing;
}

function missingProofFields(fields) {
  const missing = [];
  if (fields.built_schema_version === null) {
    missing.push("built_schema_version");
  }
  if (fields.npm_tarballs.length === 0) {
    missing.push("npm_tarballs");
  }
  if (fields.engine_artifact_sha256.length !== engineTargets.length) {
    missing.push("engine_artifact_sha256");
  }
  return missing;
}
