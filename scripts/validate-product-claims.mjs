#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Verbs that turn a sentence into a capability claim.
 *
 * Deliberately verb-driven rather than keyword-driven: "TypeScript" in a table cell is a fact about
 * scope, while "supports TypeScript" is a claim someone can hold Drift to.
 */
const CLAIM_VERBS =
  /\b(supports?|supported|enforces?|blocks?|proves?|guarantees?|detects?|learns?|prevents?|ensures?|stops?|catches?|analyses|analyzes|verifies|reports?|resolves?|refuses?)\b/i;

const repoRoot = process.cwd();

/**
 * The evaluation repos, from the same module the harnesses use.
 *
 * Imported rather than restated so the ledger's determinism accounting cannot fall out of step with
 * the suite - a repo added to the suite and forgotten in the ledger is how "measured on the eval
 * repos" quietly comes to mean "measured on the convenient ones".
 */
const { EVAL_REPOS } = await import(pathToFileURL(join(repoRoot, "scripts", "eval-repos.mjs")).href);
const evalRepoNames = EVAL_REPOS.map((repo) => repo.name);
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
  // EW-10: the fixture must exist.
  //
  // `fixture` was a free-text string, so a claim could cite a test that had been renamed, moved,
  // or never written and the validator would nod along. The evidencing test is the whole reason a
  // claim is allowed; a claim whose evidence cannot be located is an unevidenced claim with extra
  // steps. Paths are extracted from the prose rather than requiring a structured field, because
  // several entries legitimately cite more than one file.
  for (const fixturePath of fixturePaths(support.fixture)) {
    if (!existsSync(join(repoRoot, fixturePath))) {
      failures.push(
        `claim_support.${claim} cites a fixture that does not exist: ${fixturePath}`
      );
    }
  }
}

// EW-10: no allowed claim without an evidencing test.
//
// The ledger listed seven allowed claims and carried claim_support for three of them. The other
// four were asserted on nobody's authority - which is exactly how the last three weeks produced
// two overclaims that only an external audit caught.
for (const claim of claims.allowed_claims ?? []) {
  if (!claims.claim_support?.[claim]) {
    failures.push(`allowed claim ${claim} has no claim_support entry naming an evidencing test`);
  }
}

// EW-10: the ledger must state the posture, not just the capability.
//
// "Drift enforces X" and "Drift reports X and leaves it to you" are different products, and a
// stranger deciding whether to adopt needs to know which one they are getting - alongside the rate
// at which Drift declines to answer at all, and how narrow the single supported convention is.
const posture = claims.enforcement_posture;
if (!posture) {
  failures.push("enforcement_posture is required: record what is enforced vs advisory");
} else {
  const enforced = posture.enforced ?? [];
  const advisory = posture.advisory ?? [];
  for (const claim of claims.allowed_claims ?? []) {
    const inEnforced = enforced.includes(claim);
    const inAdvisory = advisory.includes(claim);
    if (!inEnforced && !inAdvisory) {
      failures.push(`enforcement_posture must class ${claim} as enforced or advisory`);
    }
    if (inEnforced && inAdvisory) {
      failures.push(`enforcement_posture classes ${claim} as both enforced and advisory`);
    }
  }
  for (const claim of [...enforced, ...advisory]) {
    if (!claims.allowed_claims?.includes(claim)) {
      failures.push(`enforcement_posture references non-allowed claim ${claim}`);
    }
  }
  if (!posture.single_convention_scope) {
    failures.push("enforcement_posture.single_convention_scope must state how narrow the scope is");
  }
  // EW-7 (DET-2): determinism is a claim, so the ledger records where it was measured - and the
  // validator checks that record, or "we measured it" is itself an unevidenced claim.
  const determinism = posture.measured_determinism;
  if (!determinism) {
    failures.push("enforcement_posture.measured_determinism is required");
  } else {
    if (!determinism.source || !existsSync(join(repoRoot, determinism.source))) {
      failures.push(`measured_determinism.source does not exist: ${determinism.source}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(determinism.measured_at ?? "")) {
      failures.push("measured_determinism.measured_at must be an ISO date");
    }
    if (!determinism.commit || !/^[a-f0-9]{7,40}$/.test(determinism.commit)) {
      failures.push("measured_determinism.commit must name the sha it was measured at");
    }
    if (!Number.isInteger(determinism.runs_per_repo) || determinism.runs_per_repo < 2) {
      failures.push("measured_determinism.runs_per_repo must be at least 2 - one run cannot disagree");
    }
    for (const [repo, entry] of Object.entries(determinism.per_repo ?? {})) {
      if (entry?.distinct_results !== 1) {
        failures.push(
          `measured_determinism.per_repo.${repo} records ${entry?.distinct_results} distinct results; ` +
            "a flap is not a determinism measurement and must not be recorded as one"
        );
      }
    }
    // Every evaluation repo must be accounted for, in one column or the other. Silence about a repo
    // is how "measured on the eval repos" comes to mean "measured on the two that were convenient".
    const measured = new Set(Object.keys(determinism.per_repo ?? {}));
    const pending = new Set(determinism.not_yet_measured ?? []);
    for (const repo of evalRepoNames) {
      if (!measured.has(repo) && !pending.has(repo)) {
        failures.push(
          `measured_determinism accounts for neither measuring nor deferring ${repo}; every ` +
            "evaluation repo belongs in per_repo or not_yet_measured"
        );
      }
      if (measured.has(repo) && pending.has(repo)) {
        failures.push(`measured_determinism lists ${repo} as both measured and not yet measured`);
      }
    }
  }

  const refusal = posture.measured_refusal_rate;
  if (!refusal) {
    failures.push("enforcement_posture.measured_refusal_rate is required");
  } else {
    if (!refusal.source) {
      failures.push("measured_refusal_rate must name the harness that measured it");
    } else if (!existsSync(join(repoRoot, refusal.source.split(/\s+/)[0]))) {
      failures.push(`measured_refusal_rate.source does not exist: ${refusal.source}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(refusal.measured_at ?? "")) {
      failures.push("measured_refusal_rate.measured_at must be an ISO date");
    }
    if (!refusal.commit || !/^[a-f0-9]{7,40}$/.test(refusal.commit)) {
      failures.push("measured_refusal_rate.commit must name the sha it was measured at");
    }
    const perRepo = Object.entries(refusal.per_repo ?? {});
    if (perRepo.length === 0) {
      failures.push("measured_refusal_rate.per_repo must record a rate per evaluation repo");
    }
    for (const [repo, rate] of perRepo) {
      if (typeof rate?.refused !== "number" || typeof rate?.total !== "number") {
        failures.push(`measured_refusal_rate.per_repo.${repo} must record refused and total`);
      } else if (rate.refused > rate.total) {
        failures.push(`measured_refusal_rate.per_repo.${repo} refuses more edits than it makes`);
      }
    }
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

// EW-10: the README prose, against the ledger.
//
// The mechanism already existed and its coverage stopped at the runtime manifest, so the ledger
// could be immaculate while the README said something else. Strangers judge by the README, and for
// a product whose differentiator is not lying, an overclaimed launch is uniquely self-defeating.
//
// Scope is stated rather than assumed: only the claim-bearing region is scanned - everything before
// the first "how to use it" heading. That is the part a stranger reads to decide whether to adopt,
// and it is where both audited overclaims lived. The command reference below it documents flags,
// not capabilities, and scanning it would produce noise that trains people to add exemptions.
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const claimRegion = claimBearingRegion(readme, claims.prose_claim_region_ends_at ?? "## First Five Minutes");
if (claimRegion === null) {
  failures.push(
    `README.md has no ${claims.prose_claim_region_ends_at ?? "## First Five Minutes"} heading, so the ` +
      "claim-bearing region cannot be bounded; update prose_claim_region_ends_at in the ledger"
  );
} else {
  const registered = Object.entries(claims.prose_claims ?? {}).map(([pattern, claim]) => ({
    pattern: new RegExp(pattern, "i"),
    source: pattern,
    claim
  }));
  for (const entry of registered) {
    if (entry.claim !== null && !claims.allowed_claims?.includes(entry.claim)) {
      failures.push(`prose_claims maps "${entry.source}" to non-allowed claim ${entry.claim}`);
    }
  }
  for (const sentence of claimSentences(claimRegion)) {
    const match = registered.find((entry) => entry.pattern.test(sentence));
    if (!match) {
      failures.push(
        "README.md makes an unregistered capability claim; add it to prose_claims in " +
          `beta-claims.json with the claim it rests on, or remove it: "${sentence}"`
      );
    }
  }
  // An exemption nobody uses is an exemption nobody reviews. A stale pattern quietly widens what
  // the prose may say, so unused ones fail rather than accumulating.
  const sentences = claimSentences(claimRegion);
  for (const entry of registered) {
    if (!sentences.some((sentence) => entry.pattern.test(sentence))) {
      failures.push(
        `prose_claims pattern "${entry.source}" matches nothing in the README claim region; ` +
          "remove it rather than leaving a standing exemption"
      );
    }
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

/**
 * The part of the README that makes claims, as opposed to documenting commands.
 *
 * Returns `null` when the boundary heading is absent, which is a failure rather than a silent
 * whole-file scan: a renamed heading must not quietly turn this check off.
 */
function claimBearingRegion(text, boundaryHeading) {
  const index = text.indexOf(boundaryHeading);
  return index === -1 ? null : text.slice(0, index);
}

/**
 * Sentences that assert a capability.
 *
 * Code blocks, tables and headings are excluded - a table row is data the Scope section already
 * governs, and a fenced command is not a sentence.
 */
function claimSentences(region) {
  return region
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter((line) => !line.trimStart().startsWith("|"))
    .join("\n")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => CLAIM_VERBS.test(sentence));
}

/** Paths cited in a `fixture` string, which may name several files in prose. */
function fixturePaths(fixture) {
  return (fixture.match(/[\w./-]+\.(?:mjs|ts|rs|json)/g) ?? []).filter(unique);
}
