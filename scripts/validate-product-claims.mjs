#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const claimsPath = join(repoRoot, "docs", "architecture", "beta-claims.json");
const claims = JSON.parse(readFileSync(claimsPath, "utf8"));
const {
  createDriftCapabilities,
  createProductionClaimsManifest
} = await import(pathToFileURL(join(repoRoot, "packages", "core", "dist", "index.js")).href).catch((error) => {
  console.error(`Product claims validation failed:\n- runtime capabilities could not be loaded from packages/core/dist/index.js; run pnpm --filter @drift/core build first\n- ${error.message}`);
  process.exit(1);
});
const runtimeCapabilities = createDriftCapabilities();
const runtimeClaims = createProductionClaimsManifest();

const requiredAllowed = [
  "local_first_cli",
  "typescript_api_route_layering",
  "sqlite_local_state",
  "human_confirmed_governance",
  "read_only_mcp",
  "accepted_contract_blocks_direct_data_access",
  "incremental_reuse"
];
const requiredBlocked = [
  "cloud_sync",
  "desktop_ui",
  "python_adapter",
  "duplicate_helper_detection",
  "mutation_capable_mcp",
  "general_ai_code_review",
  "broad_language_support"
];

const failures = [];
if (claims.schema_version !== "drift.production.claims.v1") {
  failures.push("schema_version must be drift.production.claims.v1");
}
if (claims.source_of_truth !== "createDriftCapabilities") {
  failures.push("source_of_truth must be createDriftCapabilities");
}
if (JSON.stringify(claims.allowed_claims ?? []) !== JSON.stringify(runtimeClaims.allowed_claims)) {
  failures.push("allowed_claims must match createProductionClaimsManifest()");
}
if (JSON.stringify(claims.blocked_claims ?? []) !== JSON.stringify(runtimeClaims.blocked_claims)) {
  failures.push("blocked_claims must match createProductionClaimsManifest()");
}
for (const claim of requiredAllowed) {
  if (!claims.allowed_claims?.includes(claim)) {
    failures.push(`allowed_claims missing ${claim}`);
  }
}
for (const claim of requiredBlocked) {
  if (!claims.blocked_claims?.includes(claim)) {
    failures.push(`blocked_claims missing ${claim}`);
  }
}
for (const claim of claims.blocked_claims ?? []) {
  if (claims.allowed_claims?.includes(claim)) {
    failures.push(`claim cannot be both allowed and blocked: ${claim}`);
  }
}
for (const deferred of runtimeCapabilities.deferred ?? []) {
  const blockedClaim = deferredCapabilityClaim(deferred);
  if (blockedClaim && !claims.blocked_claims?.includes(blockedClaim)) {
    failures.push(`deferred capability ${deferred} must remain blocked as ${blockedClaim}`);
  }
  if (blockedClaim && claims.allowed_claims?.includes(blockedClaim)) {
    failures.push(`deferred capability ${deferred} cannot be promoted while runtime still defers it`);
  }
}
if (runtimeCapabilities.mcp_mutation_tools.length > 0 && claims.allowed_claims?.includes("read_only_mcp")) {
  failures.push("read_only_mcp cannot be claimed while runtime exposes MCP mutation tools");
}
if (!claims.blocked_claims?.includes("mutation_capable_mcp") && runtimeCapabilities.mcp_mutation_tools.length === 0) {
  failures.push("mutation_capable_mcp must remain blocked while runtime MCP is read-only");
}
if (
  claims.allowed_claims?.includes("typescript_api_route_layering") &&
  (
    !runtimeCapabilities.supported_wedge.languages.includes("typescript") ||
    !runtimeCapabilities.supported_wedge.convention_kinds.includes("api_route_no_direct_data_access")
  )
) {
  failures.push("typescript_api_route_layering requires runtime TypeScript support and api_route_no_direct_data_access");
}
if (claims.allowed_claims?.includes("accepted_contract_blocks_direct_data_access")) {
  requireCompleteContract("RepoContract", "accepted_contract_blocks_direct_data_access");
  requireCompleteContract("RuleContract", "accepted_contract_blocks_direct_data_access");
  requireCompleteContract("FindingContract", "accepted_contract_blocks_direct_data_access");
  requireCompleteContract("CheckProofContract", "accepted_contract_blocks_direct_data_access");
  requireCompleteContract("ReleaseProofContract", "accepted_contract_blocks_direct_data_access");
}
if (claims.promotion_rules?.requires_contract_parity_complete) {
  const summary = runtimeCapabilities.contract_parity?.summary;
  if (!summary || summary.missing_count !== 0 || summary.partial_beta_required_count !== 0) {
    failures.push("promotion requires complete beta contract parity");
  }
}
for (const [claim, support] of Object.entries(claims.claim_support ?? {})) {
  if (!claims.allowed_claims?.includes(claim)) {
    failures.push(`claim_support includes non-allowed claim ${claim}`);
  }
  for (const contractName of support.required_contracts ?? []) {
    requireCompleteContract(contractName, claim);
  }
  if (!support.fixture) {
    failures.push(`claim_support.${claim} must name a fixture`);
  }
}

const docsToCheck = [
  "README.md",
  ...docsUnder(join("docs", "architecture")),
  ...docsUnder(join("docs", "dogfood")),
  ...docsUnder("docs").filter((docPath) =>
    /(^|\/)(.*spec.*|.*release.*|.*inventory.*)\.md$/i.test(docPath)
  )
].filter(unique);
const forbiddenPhrases = new Map([
  ["incremental_reuse", /incremental scan performance is supported/i],
  ["cloud_sync", /cloud sync is supported|cloud-backed enforcement is supported/i],
  ["desktop_ui", /desktop UI is supported|desktop app is supported/i],
  ["python_adapter", /Python adapter is supported|Python support is implemented/i],
  ["mutation_capable_mcp", /MCP mutation tools are supported|mutation-capable MCP is supported/i],
  ["general_ai_code_review", /general AI code review is supported|broad AI code review is supported/i],
  ["broad_language_support", /all languages are supported|broad language support is supported/i],
  ["semantic_typescript", /full semantic TypeScript analysis is supported|complete semantic TypeScript analysis/i]
]);
for (const docPath of docsToCheck) {
  const text = readFileSync(join(repoRoot, docPath), "utf8");
  for (const [claim, pattern] of forbiddenPhrases) {
    if (pattern.test(text)) {
      failures.push(`${docPath} appears to overclaim blocked capability ${claim}`);
    }
  }
  if (
    docPath.startsWith(join("docs", "dogfood")) &&
    !/historical/i.test(text) &&
    (!/^Verified on:\s*\d{4}-\d{2}-\d{2}/m.test(text) || !/^Commit:\s*`?[a-f0-9]{12,40}`?/m.test(text))
  ) {
    failures.push(`${docPath} must include Verified on and Commit metadata or be marked historical`);
  }
}

if (failures.length > 0) {
  console.error(`Product claims validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`Validated Drift production claims manifest against runtime capabilities at ${claimsPath}.`);

function deferredCapabilityClaim(capability) {
  return new Map([
    ["desktop_ui", "desktop_ui"],
    ["cloud_sync", "cloud_sync"],
    ["python_adapter", "python_adapter"],
    ["duplicate_helper_detection", "duplicate_helper_detection"]
  ]).get(capability);
}

function docsUnder(relativeDir) {
  const absoluteDir = join(repoRoot, relativeDir);
  try {
    return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
      const relativePath = join(relativeDir, entry.name);
      const absolutePath = join(repoRoot, relativePath);
      if (entry.isDirectory()) {
        return docsUnder(relativePath);
      }
      return entry.isFile() && statSync(absolutePath).isFile() && entry.name.endsWith(".md")
        ? [relativePath]
        : [];
    });
  } catch {
    return [];
  }
}

function unique(value, index, values) {
  return values.indexOf(value) === index;
}

function requireCompleteContract(contractName, claim) {
  const contract = runtimeCapabilities.contract_parity?.contracts?.find((row) => row.name === contractName);
  if (!contract) {
    failures.push(`${claim} requires missing contract parity row ${contractName}`);
    return;
  }
  if (contract.confidence !== "complete") {
    failures.push(`${claim} requires complete ${contractName}`);
  }
  if (contract.schema === "missing" || contract.storage === "missing" || contract.cli === "missing" || contract.mcp === "missing" || contract.release_proof === "missing") {
    failures.push(`${claim} requires non-missing ${contractName} surfaces`);
  }
}
