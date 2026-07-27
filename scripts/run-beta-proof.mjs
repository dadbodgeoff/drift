#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const outputPath = valueFlag("--output");
const keepTemp = args.has("--keep-temp");
const root = process.cwd();

ensureBuiltRuntime();

const [{ runCli }, { createReadOnlyMcpHandlers }, { openDriftStorage }, { BUILTIN_SEMANTIC_CAPABILITIES, createContractParityLedger }] = await Promise.all([
  import(pathToFileURL(resolve("packages/cli/dist/index.js")).href),
  import(pathToFileURL(resolve("packages/mcp/dist/index.js")).href),
  import(pathToFileURL(resolve("packages/storage/dist/index.js")).href),
  import(pathToFileURL(resolve("packages/core/dist/index.js")).href)
]);

const tempRoot = await mkdtemp(join(tmpdir(), "drift-beta-proof-"));
const expectedCanonicalRouteFixtures = [
  {
    file_path: "apps/web/app/api/users/route.ts",
    route_pattern: "/api/users",
    method: "GET"
  },
  {
    file_path: "apps/web/app/(admin)/api/projects/route.ts",
    route_pattern: "/api/projects",
    method: "GET"
  },
  {
    file_path: "apps/web/src/app/api/users/[id]/route.ts",
    route_pattern: "/api/users/:id",
    method: "GET"
  },
  {
    file_path: "apps/web/src/pages/api/projects/[projectId].ts",
    route_pattern: "/api/projects/:projectId",
    method: "default"
  }
];

try {
  const fixture = await createFixture(tempRoot);
  const started = await runJson([
    "start",
    "--repo-root", fixture.repoRoot,
    "--state-root", fixture.stateRoot,
    "--accept-defaults",
    "--now", "2026-05-10T00:00:00.000Z",
    "--json"
  ]);
  assertEqual(started.response_schema, "drift.start.result.v1", "start_response_schema");
  assertEqual(started.machine_contract_versions?.schema_version, "drift.machine_contract_versions.v1", "start_machine_contract_versions");
  const databasePath = started.state.database_path;
  const repoId = started.repo.id;
  const doctor = await runJson([
    "--db", databasePath,
    "doctor",
    "--repo-root", fixture.repoRoot,
    "--state-root", fixture.stateRoot,
    "--json"
  ]);
  assertEqual(doctor.response_schema, "drift.doctor.result.v1", "doctor_response_schema");
  assertEqual(doctor.machine_contract_versions?.schema_version, "drift.machine_contract_versions.v1", "doctor_machine_contract_versions");
  const chadlike = await runJson([
    "start",
    "--repo-root", resolve("test/fixtures/next-real-repo-chadlike"),
    "--state-root", join(tempRoot, "chadlike-state"),
    "--accept-defaults",
    "--now", "2026-05-10T00:00:10.000Z",
    "--json"
  ]);
  const chadlikeDirect = chadlike.candidates.find((candidate) => candidate.kind === "api_route_no_direct_data_access");
  assertJsonEqual(chadlikeDirect?.matcher?.forbidden_imports, ["~/lib/server/db"], "chadlike_forbidden_imports");
  assertEqual(chadlike.baselined_count, 4, "chadlike_baselined_count");
  assertEqual(chadlike.accepted?.evidence_refs?.every((ref) => ref.fact_ids.length > 0), true, "chadlike_fact_ids");
  promoteDirectDataAccessConventionToBlock({ databasePath, repoId });

  const requiredCheckCommand = "node -e \"process.stdout.write('ok')\"";
  addRequiredProofContract({
    databasePath,
    repoId,
    command: requiredCheckCommand
  });

  const contract = await runJson([
    "--db", databasePath,
    "contract", "show",
    "--repo", repoId,
    "--json"
  ]);

  const goodRoute = await writeGoodRoute(fixture.repoRoot);
  const goodDiff = join(tempRoot, "good-route.patch");
  await writeFile(goodDiff, newFileDiff(goodRoute.path, goodRoute.source));
  const badRoute = await writeBadRoute(fixture.repoRoot);
  const badDiff = join(tempRoot, "bad-route.patch");
  await writeFile(badDiff, newFileDiff(badRoute.path, badRoute.source));

  const freshScan = await runJson([
    "scan",
    "--repo-root", fixture.repoRoot,
    "--state-root", fixture.stateRoot,
    "--now", "2026-05-10T00:00:01.000Z",
    "--json"
  ]);
  const scanStatus = await runJson([
    "--db", databasePath,
    "scan", "status",
    "--repo", repoId,
    "--json"
  ]);

  await runJson([
    "--db", databasePath,
    "checks", "run",
    "--repo", repoId,
    "--command", requiredCheckCommand,
    "--diff-file", goodDiff,
    "--timeout-ms", "30000",
    "--now", "2026-05-10T00:00:01.500Z",
    "--json"
  ]);

  const goodCheck = await runJson([
    "--db", databasePath,
    "check",
    "--repo", repoId,
    "--diff-file", goodDiff,
    "--scope", "changed-hunks",
    "--now", "2026-05-10T00:00:02.000Z",
    "--json"
  ]);

  const requiredCheckExecution = await runJson([
    "--db", databasePath,
    "checks", "run",
    "--repo", repoId,
    "--command", requiredCheckCommand,
    "--diff-file", badDiff,
    "--timeout-ms", "30000",
    "--now", "2026-05-10T00:00:02.500Z",
    "--json"
  ]);

  const badCheck = await runJson([
    "--db", databasePath,
    "check",
    "--repo", repoId,
    "--diff-file", badDiff,
    "--scope", "changed-hunks",
    "--now", "2026-05-10T00:00:03.000Z",
    "--json"
    // A5: a blocked diff exits 2. Blocking is the expected outcome here - this is the proof
    // that an accepted contract stops a bad route - so 2 is success, not failure. Exit 1 would
    // now mean Drift itself broke, which must still fail the proof.
  ], { exitCodes: [2] });

  const parity = await mcpCliParity({ databasePath, repoId });
  const securityContext = createReadOnlyMcpHandlers({ databasePath })
    .get_security_context({ repo_id: repoId, check_id: badCheck.check?.id });
  const contractParity = createContractParityLedger();
  const contractParityVerified = contractParity.summary.missing_count === 0 &&
    contractParity.summary.partial_beta_required_count === 0;
  const audit = await runJson([
    "--db", databasePath,
    "audit", "verify",
    "--repo", repoId,
    "--strict",
    "--json"
  ]);
  const finding = badCheck.findings[0];
  const acceptedConventionId = contract.contract?.conventions?.[0]?.id ?? null;
  const graphPath = Array.isArray(finding?.graph_path) ? finding.graph_path : [];
  const evidenceRefs = Array.isArray(finding?.evidence_refs) ? finding.evidence_refs : [];
  const findingEvidenceComplete = Boolean(
    finding?.repo_contract_id === contract.contract?.id &&
      finding?.check_id === badCheck.check?.id &&
      finding?.convention_id === acceptedConventionId &&
      finding?.enforcement_result === "block" &&
      finding?.expected_layer === "service" &&
      finding?.actual_layer === "data_access" &&
      finding?.suggested_fix &&
      graphPath.length > 0 &&
      graphPath.some((node) => node.includes(badRoute.path) || node.includes("prisma")) &&
      evidenceRefs.some((evidence) =>
        evidence.file_path === badRoute.path &&
        evidence.import_source === "@/lib/prisma" &&
        Array.isArray(evidence.fact_ids) &&
        evidence.fact_ids.length > 0 &&
        evidence.fact_ids.every((factId) => typeof factId === "string" && factId.length > 0) &&
        Number.isInteger(evidence.start_line) &&
        Number.isInteger(evidence.end_line) &&
        evidence.start_line <= evidence.end_line &&
        typeof evidence.file_hash === "string" &&
        evidence.file_hash.length === 64
      )
  );
  const fallbackUsed = badCheck.check?.fallback_status?.fallback_used ?? badCheck.summary?.engine_source !== "rust";
  const latestScanId = scanStatus.latest_scan?.id ?? started.scan?.id ?? null;
  const canonicalRouteProof = canonicalRouteProofFor({
    databasePath,
    repoId,
    scanId: latestScanId,
    parity,
    securityContext
  });
  const graphProof = await graphProofForScan(databasePath, repoId, latestScanId);
  const capabilityReport = scanStatus.capability_report ?? null;
  const machineContractVersions = badCheck.machine_contract_versions ?? badCheck.check?.machine_contract_versions ?? null;
  const findingEvidenceConfidence = graphProof.evidence_confidence.find((evidence) =>
    evidence.file_path === badRoute.path &&
    typeof evidence.extractor === "string" &&
    evidence.extractor.length > 0
  ) ?? graphProof.evidence_confidence[0] ?? null;
  const capabilityReportVerified = Boolean(
    capabilityReport?.schema_version === "drift.scan_capability_report.v1" &&
      capabilityReport.scan_id === latestScanId &&
      capabilityReport.fallback_used === false &&
      capabilityReport.enforcement_degraded === false
  );
  const machineContractVersionsVerified = Boolean(
    machineContractVersions?.schema_version === "drift.machine_contract_versions.v1" &&
      machineContractVersions.storage_schema_version > 0 &&
      typeof machineContractVersions.engine_contract_versions?.scan_result === "string" &&
      machineContractVersions.factgraph_schema_version === "factgraph.v2"
  );
  const findingEvidenceConfidenceVerified = Boolean(
    findingEvidenceConfidence &&
      ["deterministic", "heuristic", "unresolved"].includes(findingEvidenceConfidence.confidence_kind) &&
      typeof findingEvidenceConfidence.extractor === "string" &&
      findingEvidenceConfidence.extractor.length > 0 &&
      (findingEvidenceConfidence.snippet_hash === null ||
        /^[a-f0-9]{64}$/.test(findingEvidenceConfidence.snippet_hash))
  );
  const mcpRequiredCheckExecutions = createReadOnlyMcpHandlers({ databasePath })
    .get_required_check_executions({ repo_id: repoId, command: requiredCheckCommand });
  const requiredCheckExecutionProofVerified = Boolean(
    requiredCheckExecution.response_schema === "drift.required-check-execution.v1" &&
      requiredCheckExecution.summary?.passed === true &&
      requiredCheckExecution.execution?.repo_contract_id === contract.contract?.id &&
      requiredCheckExecution.execution?.agent_contract_id === "agent_contract_beta_smoke_checks" &&
      requiredCheckExecution.execution?.command === requiredCheckCommand &&
      Array.isArray(requiredCheckExecution.execution?.argv) &&
      requiredCheckExecution.execution.argv.length > 0 &&
      mcpRequiredCheckExecutions.response_schema === "drift.required_check_executions.v1" &&
      mcpRequiredCheckExecutions.latest_by_command?.some((execution) =>
        execution.execution_id === requiredCheckExecution.execution.execution_id &&
        execution.command === requiredCheckCommand &&
        execution.status === "passed"
      )
  );
  const semanticCapabilities = Array.from(BUILTIN_SEMANTIC_CAPABILITIES ?? []);
  const betaRequiredSemanticCapabilities = semanticCapabilities.filter((capability) =>
    capability.required_for_beta_claims?.includes("narrow_route_layering")
  );
  const semanticBetaProof = {
    schema_version: "drift.semantic_beta_proof.v1",
    commit_sha: gitOutput(root, ["rev-parse", "HEAD"]) || "unknown",
    semantic_capability_contracts_verified: betaRequiredSemanticCapabilities.length > 0 &&
      betaRequiredSemanticCapabilities.every((capability) =>
        capability.schema_version === "drift.semantic_capability.v1" &&
        capability.certification === "certified_deterministic" &&
        capability.can_block === true &&
        capability.fixture_suites.length > 0
      ),
    architecture_contract_verified: contractParity.contracts?.some((row) =>
      row.name === "LayerArchitectureContract" &&
      row.confidence === "complete"
    ) === true,
    convention_election_contract_verified: contractParity.contracts?.some((row) =>
      row.name === "ConventionElectionContract" &&
      row.confidence === "complete"
    ) === true,
    repo_contract_materialization_verified: Boolean(contract.contract?.id),
    cli_mcp_semantic_parity_verified: parity.verified,
    unsupported_pattern_visibility_verified: semanticCapabilities.some((capability) =>
      capability.support === "deferred" &&
      capability.parser_gap_kinds.length > 0
    ),
    blocking_safety_verified: capabilityReportVerified && findingEvidenceComplete,
    claim_gate_verified: contractParityVerified,
    partial_beta_required_count: betaRequiredSemanticCapabilities.filter((capability) =>
      capability.support !== "supported" ||
      capability.certification !== "certified_deterministic" ||
      capability.can_block !== true
    ).length,
    unsupported_beta_required_count: betaRequiredSemanticCapabilities.filter((capability) =>
      capability.support === "unsupported" ||
      capability.certification === "unsupported"
    ).length,
    evidence: {
      beta_required_capabilities: betaRequiredSemanticCapabilities.map((capability) => capability.capability_id),
      deferred_capabilities: semanticCapabilities
        .filter((capability) => capability.support === "deferred" || capability.certification === "unsupported")
        .map((capability) => capability.capability_id)
    }
  };
  const realisticFixtureProof = await realisticFixtureProofFor(tempRoot);
  const parserGapQualityProof = await parserGapQualityProofFor(tempRoot);

  const betaProof = {
    verify_ci_status: process.env.DRIFT_VERIFY_CI_STATUS ?? null,
    fallback_used: fallbackUsed,
    fresh_scan_verified: freshScan.summary?.engine_source === "rust" &&
      scanStatus.summary?.stale === false &&
      typeof latestScanId === "string" &&
      latestScanId.length > 0 &&
      graphProof.graph_nodes_count > 0 &&
      graphProof.graph_edges_count > 0 &&
      graphProof.graph_evidence_count > 0,
    response_schemas_verified: parity.responseSchemasVerified &&
      started.response_schema === "drift.start.result.v1" &&
      doctor.response_schema === "drift.doctor.result.v1" &&
      goodCheck.response_schema === "drift.check.result.v1" &&
      badCheck.response_schema === "drift.check.result.v1",
    dogfood_or_fixture_repo_id: repoId,
    scan_id: latestScanId,
    repo_contract_id: contract.contract?.id ?? badCheck.check?.repo_contract_id ?? null,
    check_id: badCheck.check?.id ?? null,
    good_route_passed: goodCheck.exit_code === undefined &&
      goodCheck.check?.status === "pass" &&
      goodCheck.summary?.blocking_count === 0,
    bad_route_blocked: badCheck.check?.status === "fail" &&
      badCheck.summary?.blocking_count > 0 &&
      badCheck.findings?.some((item) => item.enforcement_result === "block"),
    finding_evidence_complete: findingEvidenceComplete,
    capability_report_verified: capabilityReportVerified,
    machine_contract_versions_verified: machineContractVersionsVerified,
    finding_evidence_confidence_verified: findingEvidenceConfidenceVerified,
    required_check_execution_proof_verified: requiredCheckExecutionProofVerified,
    realistic_fixture_matrix_verified: realisticFixtureProof.realistic_fixture_matrix_verified,
    no_false_prisma_fixture_verified: realisticFixtureProof.no_false_prisma_fixture_verified,
    non_next_fixture_graceful_verified: realisticFixtureProof.non_next_fixture_graceful_verified,
    parser_gap_quality_verified: parserGapQualityProof.parser_gap_quality_verified,
    semantic_beta_proof_verified: semanticBetaProof.semantic_capability_contracts_verified &&
      semanticBetaProof.architecture_contract_verified &&
      semanticBetaProof.convention_election_contract_verified &&
      semanticBetaProof.repo_contract_materialization_verified &&
      semanticBetaProof.cli_mcp_semantic_parity_verified &&
      semanticBetaProof.unsupported_pattern_visibility_verified &&
      semanticBetaProof.blocking_safety_verified &&
      semanticBetaProof.claim_gate_verified &&
      semanticBetaProof.partial_beta_required_count === 0 &&
      semanticBetaProof.unsupported_beta_required_count === 0,
    canonical_routes_verified: canonicalRouteProof.canonical_routes_verified,
    canonical_route_fallback_absent: canonicalRouteProof.canonical_route_fallback_absent,
    cli_mcp_route_parity_verified: canonicalRouteProof.cli_mcp_route_parity_verified,
    security_context_canonical_verified: canonicalRouteProof.security_context_canonical_verified,
    canonical_proof_freshness_verified: canonicalRouteProof.canonical_proof_freshness_verified,
    contract_parity_verified: contractParityVerified,
    mcp_cli_parity_hash: parity.hash,
    mcp_cli_parity_verified: parity.verified,
    audit_head_hash: audit.verification?.head_event_hash ?? null,
    audit_verified: audit.verification?.valid === true
  };
  const proof = {
    schema_version: "drift.beta.proof.v1",
    repo_fixture: "next-api-direct-db + generated good/bad routes",
    repo_root: keepTemp ? fixture.repoRoot : null,
    database_path: keepTemp ? databasePath : null,
    beta_proof: betaProof,
    evidence: {
      accepted_kind: contract.contract?.conventions?.[0]?.kind ?? null,
      accepted_convention_count: contract.summary?.convention_count ?? 0,
      scan_fingerprint: scanStatus.scan_fingerprint,
      fresh_scan: {
        scan_id: latestScanId,
        engine_source: freshScan.summary?.engine_source ?? null,
        stale: scanStatus.summary?.stale ?? null,
        graph_nodes_count: graphProof.graph_nodes_count,
        graph_edges_count: graphProof.graph_edges_count,
        graph_evidence_count: graphProof.graph_evidence_count
      },
      capability_report: capabilityReport,
      machine_contract_versions: machineContractVersions,
      finding_evidence_confidence: findingEvidenceConfidence,
      good_route: {
        path: goodRoute.path,
        check_id: goodCheck.check?.id ?? null,
        status: goodCheck.check?.status ?? null,
        blocking_count: goodCheck.summary?.blocking_count ?? null
      },
      bad_route: {
        path: badRoute.path,
        check_id: badCheck.check?.id ?? null,
        status: badCheck.check?.status ?? null,
        blocking_count: badCheck.summary?.blocking_count ?? null,
        first_finding_id: finding?.id ?? null
      },
      required_check_execution: {
        command: requiredCheckCommand,
        execution_id: requiredCheckExecution.execution?.execution_id ?? null,
        status: requiredCheckExecution.execution?.status ?? null,
        argv: requiredCheckExecution.execution?.argv ?? [],
        mcp_summary: mcpRequiredCheckExecutions.summary ?? null
      },
      realistic_fixture_matrix: realisticFixtureProof,
      parser_gap_quality: parserGapQualityProof,
      semantic_beta_proof: semanticBetaProof,
      canonical_route_proof: canonicalRouteProof,
      contract_parity: contractParity,
      mcp_cli_parity: parity.bundle,
      audit_verification: audit.verification
    },
    created_at: new Date().toISOString()
  };

  assertBetaProof(proof);

  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), `${JSON.stringify(proof, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
} finally {
  if (!keepTemp) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function ensureBuiltRuntime() {
  for (const path of ["packages/cli/dist/index.js", "packages/mcp/dist/index.js"]) {
    if (!existsSync(resolve(path))) {
      throw new Error(`Missing ${path}. Run pnpm build before beta proof.`);
    }
  }
}

async function createFixture(dir) {
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures/next-api-direct-db"), repoRoot, { recursive: true });
  await mkdir(join(repoRoot, "apps/web/lib"), { recursive: true });
  await writeFile(join(repoRoot, "apps/web/lib/prisma.ts"), [
    "export const prisma = {",
    "  user: { findMany: async () => [] },",
    "  project: { findMany: async () => [] }",
    "};",
    ""
  ].join("\n"));
  await writeCanonicalRouteFixtures(repoRoot);
  return { repoRoot, stateRoot };
}

async function realisticFixtureProofFor(tempRoot) {
  const [prisma, fetch, express] = await Promise.all([
    scanStaticFixture({
      fixtureId: "next-prisma-clean-service",
      stateRoot: join(tempRoot, "next-prisma-clean-service-state"),
      now: "2026-05-10T00:01:00.000Z"
    }),
    scanStaticFixture({
      fixtureId: "next-non-prisma-fetch-service",
      stateRoot: join(tempRoot, "next-non-prisma-fetch-service-state"),
      now: "2026-05-10T00:01:01.000Z"
    }),
    scanStaticFixture({
      fixtureId: "node-express-api",
      stateRoot: join(tempRoot, "node-express-api-state"),
      now: "2026-05-10T00:01:02.000Z"
    })
  ]);
  const prismaDiagnostics = graphDiagnosticsForScan(prisma);
  const prismaEdges = graphEdgesForScan(prisma);
  const prismaCandidateKinds = candidateKinds(prisma.scan);
  const fetchCandidateKinds = candidateKinds(fetch.scan);
  const expressCandidateKinds = candidateKinds(express.scan);
  const realisticFixtureMatrixVerified = prisma.scan.summary?.engine_source === "rust" &&
    prisma.scan.summary?.files_indexed >= 3 &&
    !prismaCandidateKinds.includes("api_route_no_direct_data_access") &&
    !prismaDiagnostics.some((diagnostic) => diagnostic.code === "unresolved_import") &&
    prismaEdges.some((edge) =>
      edge.kind === "IMPORT_RESOLVES_TO_MODULE" &&
      edge.to === "module:apps/web/services/users.ts"
    ) &&
    prismaEdges.some((edge) =>
      edge.kind === "IMPORT_RESOLVES_TO_MODULE" &&
      edge.to === "module:apps/web/lib/prisma.ts"
    );
  const noFalsePrismaFixtureVerified = fetch.scan.summary?.engine_source === "rust" &&
    fetch.scan.summary?.files_indexed >= 2 &&
    !fetchCandidateKinds.includes("api_route_no_direct_data_access") &&
    !JSON.stringify(fetch.scan.candidates ?? []).toLowerCase().includes("prisma");
  const nonNextFixtureGracefulVerified = express.scan.summary?.engine_source === "rust" &&
    express.scan.summary?.files_indexed >= 4 &&
    !expressCandidateKinds.includes("api_route_no_direct_data_access");

  return {
    realistic_fixture_matrix_verified: realisticFixtureMatrixVerified,
    no_false_prisma_fixture_verified: noFalsePrismaFixtureVerified,
    non_next_fixture_graceful_verified: nonNextFixtureGracefulVerified,
    fixtures: {
      next_prisma_clean_service: fixtureScanEvidence(prisma, {
        diagnostics_count: prismaDiagnostics.length,
        import_edges: prismaEdges
          .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE")
          .map((edge) => ({ from: edge.from, to: edge.to }))
      }),
      next_non_prisma_fetch_service: fixtureScanEvidence(fetch),
      node_express_api: fixtureScanEvidence(express)
    }
  };
}

async function parserGapQualityProofFor(tempRoot) {
  const clean = await scanStaticFixture({
    fixtureId: "next-api-service-delegated",
    stateRoot: join(tempRoot, "parser-gap-quality-clean-state"),
    now: "2026-05-10T00:02:00.000Z"
  });
  const cleanStatus = await runJson([
    "--db", clean.scan.database_path,
    "scan", "status",
    "--repo", clean.scan.repo.id,
    "--json"
  ]);
  const parserGapFixture = await scanStaticFixture({
    fixtureId: "next-api-service-delegated",
    stateRoot: join(tempRoot, "parser-gap-quality-gap-state"),
    now: "2026-05-10T00:02:01.000Z"
  });
  const storage = openDriftStorage({ databasePath: parserGapFixture.scan.database_path });
  try {
    storage.upsertParserGaps([{
      schema_version: "drift.parser_gap.v1",
      gap_id: "parser_gap_beta_unresolved_import",
      repo_id: parserGapFixture.scan.repo.id,
      scan_id: parserGapFixture.scan.scan.id,
      kind: "unresolved_import",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 1,
      end_line: 1,
      confidence_impact: "lowers_flow",
      message: "Could not resolve import @/missing/service.",
      evidence_refs: ["diagnostic_unresolved_import"],
      created_at: "2026-05-10T00:02:02.000Z"
    }]);
  } finally {
    storage.close();
  }
  const gapStatus = await runJson([
    "--db", parserGapFixture.scan.database_path,
    "scan", "status",
    "--repo", parserGapFixture.scan.repo.id,
    "--json"
  ]);
  const cleanQuality = cleanStatus.parser_gap_quality ?? {};
  const gapQuality = gapStatus.parser_gap_quality ?? {};
  const sample = Array.isArray(gapQuality.sample_gaps) ? gapQuality.sample_gaps[0] : null;
  const parserGapQualityVerified = cleanQuality.schema_version === "drift.parser_gap_quality.v1" &&
    cleanQuality.total_count === 0 &&
    cleanQuality.user_action === "No parser gap action required." &&
    gapQuality.schema_version === "drift.parser_gap_quality.v1" &&
    gapQuality.total_count >= 1 &&
    gapQuality.decision === gapStatus.readiness?.decision &&
    sample?.file_path === "apps/web/app/api/users/route.ts" &&
    sample?.suggested_action === "Resolve the import or add resolver configuration, then rerun drift scan.";

  return {
    parser_gap_quality_verified: parserGapQualityVerified,
    clean_quality: cleanQuality,
    parser_gap_quality: gapQuality,
    readiness_decision: gapStatus.readiness?.decision ?? null
  };
}

async function scanStaticFixture({ fixtureId, stateRoot, now }) {
  const scan = await runJson([
    "scan",
    "--repo-root", resolve("test/fixtures", fixtureId),
    "--state-root", stateRoot,
    "--now", now,
    "--json"
  ]);
  return { fixture_id: fixtureId, scan };
}

function graphDiagnosticsForScan(fixtureScan) {
  const storage = openDriftStorage({ databasePath: fixtureScan.scan.database_path });
  try {
    return storage.listGraphDiagnostics(fixtureScan.scan.repo.id, fixtureScan.scan.scan.id);
  } finally {
    storage.close();
  }
}

function graphEdgesForScan(fixtureScan) {
  const storage = openDriftStorage({ databasePath: fixtureScan.scan.database_path });
  try {
    return storage.listGraphEdges(fixtureScan.scan.repo.id, fixtureScan.scan.scan.id);
  } finally {
    storage.close();
  }
}

function fixtureScanEvidence(fixtureScan, extra = {}) {
  return {
    fixture_id: fixtureScan.fixture_id,
    repo_id: fixtureScan.scan.repo?.id ?? null,
    scan_id: fixtureScan.scan.scan?.id ?? null,
    engine_source: fixtureScan.scan.summary?.engine_source ?? null,
    files_indexed: fixtureScan.scan.summary?.files_indexed ?? null,
    candidates: candidateKinds(fixtureScan.scan),
    ...extra
  };
}

function candidateKinds(scan) {
  return (scan.candidates ?? []).map((candidate) => candidate.kind).sort();
}

async function writeCanonicalRouteFixtures(repoRoot) {
  const fixtures = [
    {
      path: "apps/web/app/(admin)/api/projects/route.ts",
      source: [
        "export async function GET() {",
        "  return Response.json({ projects: [] });",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "apps/web/src/app/api/users/[id]/route.ts",
      source: [
        "export async function GET(_request, { params }) {",
        "  return Response.json({ id: params.id });",
        "}",
        ""
      ].join("\n")
    },
    {
      path: "apps/web/src/pages/api/projects/[projectId].ts",
      source: [
        "export default function handler(req, res) {",
        "  res.status(200).json({ projectId: req.query.projectId });",
        "}",
        ""
      ].join("\n")
    }
  ];
  for (const fixture of fixtures) {
    await mkdir(dirname(join(repoRoot, fixture.path)), { recursive: true });
    await writeFile(join(repoRoot, fixture.path), fixture.source);
  }
}

function promoteDirectDataAccessConventionToBlock({ databasePath, repoId }) {
  const storage = openDriftStorage({ databasePath });
  try {
    const contract = storage.getRepoContract(repoId);
    if (!contract) {
      throw new Error(`No repo contract exists for ${repoId}.`);
    }
    const conventions = storage.listAcceptedConventions(repoId).map((convention) =>
      convention.kind === "api_route_no_direct_data_access"
        ? { ...convention, enforcement_mode: "block" }
        : convention
    );
    for (const convention of conventions) {
      storage.upsertAcceptedConvention(repoId, convention);
    }
    storage.upsertRepoContract({
      ...contract,
      conventions: conventions.map((convention) =>
        convention.kind === "api_route_no_direct_data_access"
          ? { ...convention, enforcement_mode: "block" }
          : convention
      )
    });
  } finally {
    storage.close();
  }
}

function addRequiredProofContract({ databasePath, repoId, command }) {
  const storage = openDriftStorage({ databasePath });
  try {
    const contract = storage.getRepoContract(repoId);
    if (!contract) {
      throw new Error(`No repo contract exists for ${repoId}.`);
    }
    storage.upsertRepoContract({
      ...contract,
      safe_commands: [
        ...contract.safe_commands.filter((entry) => entry.command !== command),
        {
          command,
          reason: "Run deterministic beta smoke check.",
          requires_explicit_run: true
        }
      ],
      agent_contracts: [
        ...(contract.agent_contracts ?? []).filter((entry) => entry.id !== "agent_contract_beta_smoke_checks"),
        {
          kind: "required_change_checks",
          id: "agent_contract_beta_smoke_checks",
          version: 1,
          rules: [{
            applies_to: {
              path_globs: ["apps/web/app/api/**/route.ts"],
              file_roles: ["api_route"]
            },
            required_checks: [{
              command,
              reason: "Run deterministic beta smoke check.",
              required_for_release: true
            }]
          }]
        }
      ]
    });
  } finally {
    storage.close();
  }
}

async function writeGoodRoute(repoRoot) {
  const servicePath = join(repoRoot, "apps/web/services/accounts.ts");
  await mkdir(dirname(servicePath), { recursive: true });
  await writeFile(servicePath, [
    "import { prisma } from \"../lib/prisma\";",
    "",
    "export async function listAccounts() {",
    "  return prisma.user.findMany();",
    "}",
    ""
  ].join("\n"));
  const path = "apps/web/app/api/accounts/route.ts";
  const source = [
    "import { listAccounts } from \"../../../services/accounts\";",
    "",
    "export async function GET() {",
    "  return Response.json(await listAccounts());",
    "}",
    ""
  ].join("\n");
  await mkdir(dirname(join(repoRoot, path)), { recursive: true });
  await writeFile(join(repoRoot, path), source);
  return { path, source };
}

async function writeBadRoute(repoRoot) {
  const path = "apps/web/app/api/projects/route.ts";
  const source = [
    "import { prisma } from \"@/lib/prisma\";",
    "",
    "export async function GET() {",
    "  return Response.json(await prisma.project.findMany());",
    "}",
    ""
  ].join("\n");
  await mkdir(dirname(join(repoRoot, path)), { recursive: true });
  await writeFile(join(repoRoot, path), source);
  return { path, source };
}

function newFileDiff(path, source) {
  const lines = source.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

async function runJson(args, options = {}) {
  const exitCodes = options.exitCodes ?? [0];
  const result = await runCli(args);
  if (!exitCodes.includes(result.exitCode)) {
    throw new Error([
      `Command failed with exit ${result.exitCode}: drift ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return JSON.parse(result.stdout);
}

/** Paths where two payloads differ, as `path: cli=… mcp=…`, deepest useful level only. */
function differingPaths(cli, mcp, path = "") {
  const brief = (value) => {
    const text = JSON.stringify(value);
    if (text === undefined) return "undefined";
    return text.length > 70 ? `${text.slice(0, 70)}…` : text;
  };
  if (canonicalJson(cli) === canonicalJson(mcp)) {
    return [];
  }
  const bothObjects =
    cli && mcp && typeof cli === "object" && typeof mcp === "object" &&
    !Array.isArray(cli) && !Array.isArray(mcp);
  if (!bothObjects) {
    return [`${path || "(root)"}: cli=${brief(cli)} mcp=${brief(mcp)}`];
  }
  const out = [];
  for (const key of new Set([...Object.keys(cli), ...Object.keys(mcp)])) {
    out.push(...differingPaths(cli[key], mcp[key], path ? `${path}.${key}` : key));
  }
  return out;
}

async function mcpCliParity({ databasePath, repoId }) {
  const handlers = createReadOnlyMcpHandlers({ databasePath });
  const generatedAt = "2026-05-10T00:00:04.000Z";
  const [scanStatus, repoMap, preflight, contract, conventions, findings, audit, context] = await Promise.all([
    runJson(["--db", databasePath, "scan", "status", "--repo", repoId, "--json"]),
    runJson(["--db", databasePath, "repo", "map", "--repo", repoId, "--limit", "20", "--offset", "0", "--json"]),
    runJson([
      "--db", databasePath,
      "prepare", "add accounts api route",
      "--repo", repoId,
      "--now", generatedAt,
      "--json"
    ]),
    runJson(["--db", databasePath, "contract", "show", "--repo", repoId, "--json"]),
    runJson([
      "--db", databasePath,
      "conventions", "accepted",
      "--repo", repoId,
      "--limit", "20",
      "--offset", "0",
      "--json"
    ]),
    runJson(["--db", databasePath, "findings", "list", "--repo", repoId, "--limit", "20", "--offset", "0", "--json"]),
    runJson(["--db", databasePath, "audit", "verify", "--repo", repoId, "--json"]),
    runJson([
      "--db", databasePath,
      "policy", "check-context",
      "--repo", repoId,
      "--path", "apps/web/app/api/accounts/route.ts",
      "--surface", "cli-preflight",
      "--json"
    ])
  ]);
  const mcpScanStatus = handlers.get_scan_status({ repo_id: repoId });
  const mcpRepoMap = handlers.get_repo_map({ repo_id: repoId, limit: 20, offset: 0 });
  const mcpPreflight = handlers.get_task_preflight({
    repo_id: repoId,
    task: "add accounts api route",
    now: generatedAt
  });
  const mcpContract = handlers.get_repo_contract({ repo_id: repoId });
  const mcpConventions = handlers.get_conventions({ repo_id: repoId, limit: 20, offset: 0 });
  const mcpFindings = handlers.get_findings({ repo_id: repoId, limit: 20, offset: 0 });
  const mcpAudit = handlers.get_audit_status({ repo_id: repoId });
  const mcpContext = handlers.get_allowed_context({
    repo_id: repoId,
    path: "apps/web/app/api/accounts/route.ts",
    surface: "cli-preflight"
  });
  const bundle = {
    scan_status: {
      cli: stablePayloadForParity(scanStatus),
      mcp: stablePayloadForParity(mcpScanStatus)
    },
    repo_map: {
      cli: stablePayloadForParity(repoMap),
      mcp: stablePayloadForParity(mcpRepoMap)
    },
    preflight: {
      cli: stablePayloadForParity(preflight),
      mcp: stablePayloadForParity(mcpPreflight)
    },
    contract: {
      cli: stablePayloadForParity(contract),
      mcp: stablePayloadForParity(mcpContract)
    },
    conventions: {
      cli: stablePayloadForParity(conventions),
      mcp: stablePayloadForParity(mcpConventions)
    },
    findings: {
      cli: stablePayloadForParity(findings),
      mcp: stablePayloadForParity(mcpFindings)
    },
    audit: {
      cli: stablePayloadForParity(audit),
      mcp: stablePayloadForParity(mcpAudit)
    },
    allowed_context: {
      cli: stablePayloadForParity(context),
      mcp: stablePayloadForParity(mcpContext)
    }
  };
  const mismatches = [];
  for (const [name, value] of Object.entries(bundle)) {
    if (canonicalJson(value.cli) !== canonicalJson(value.mcp)) {
      mismatches.push(name);
    }
  }
  if (mismatches.length > 0) {
    const first = mismatches[0];
    // Name the differing paths rather than dumping two 20KB payloads. The old message printed
    // both sides in full, which is unreadable and forces whoever hits this to diff by hand.
    throw new Error([
      `CLI/MCP parity mismatch: ${mismatches.join(", ")}`,
      ...differingPaths(bundle[first].cli, bundle[first].mcp).slice(0, 12).map((entry) => `  ${entry}`)
    ].join("\n"));
  }
  return {
    verified: true,
    responseSchemasVerified: responseSchemasVerified(bundle),
    hash: sha256(canonicalJson(bundle)),
    bundle
  };
}

function responseSchemasVerified(bundle) {
  return Object.values(bundle).every((value) =>
    typeof value.cli?.response_schema === "string" &&
    value.cli.response_schema.length > 0 &&
    value.cli.response_schema === value.mcp?.response_schema
  );
}

function canonicalRouteProofFor({ databasePath, repoId, scanId, parity, securityContext }) {
  const storage = openDriftStorage({ databasePath });
  try {
    const entrypoints = scanId ? storage.listNormalizedEntrypoints(repoId, scanId) : [];
    const entrypointsByFile = new Map(entrypoints.map((entrypoint) => [entrypoint.file_path, entrypoint]));
    const expectedEntrypoints = expectedCanonicalRouteFixtures.map((fixture) => {
      const entrypoint = entrypointsByFile.get(fixture.file_path) ?? null;
      return {
        ...fixture,
        found: Boolean(entrypoint),
        entrypoint_id: entrypoint?.entrypoint_id ?? null,
        actual_route_pattern: entrypoint?.route_pattern ?? null,
        actual_method: entrypoint?.method ?? entrypoint?.handler_symbol ?? null,
        framework: entrypoint?.framework ?? null
      };
    });
    const cliRoutes = canonicalRouteProjection(parity.bundle.repo_map.cli.routes ?? []);
    const mcpRoutes = canonicalRouteProjection(parity.bundle.repo_map.mcp.routes ?? []);
    const securityContextRoutes = canonicalRouteProjection(securityContext.routes ?? []);
    const cliRouteHash = sha256(canonicalJson(cliRoutes));
    const mcpRouteHash = sha256(canonicalJson(mcpRoutes));
    const allProductRoutes = [...cliRoutes, ...mcpRoutes, ...securityContextRoutes];
    const expectedProductRoutes = expectedEntrypoints.map((entrypoint) => {
      const expected = {
        route_id: `route:${entrypoint.file_path}:${entrypoint.method}`,
        path: entrypoint.route_pattern,
        method: entrypoint.method,
        normalized_entrypoint_id: entrypoint.entrypoint_id
      };
      return {
        ...expected,
        cli_repo_map: productRouteMatches(expected, routeById(cliRoutes, expected.route_id)),
        mcp_repo_map: productRouteMatches(expected, routeById(mcpRoutes, expected.route_id)),
        mcp_security_context: productRouteMatches(expected, routeById(securityContextRoutes, expected.route_id))
      };
    });
    const productSurfaceScanIds = {
      cli_repo_map: productSurfaceScanId(parity.bundle.repo_map.cli),
      mcp_repo_map: productSurfaceScanId(parity.bundle.repo_map.mcp),
      mcp_security_context: securityContext.scan_id ?? null
    };
    const expectedProductRoutesPresent = expectedProductRoutes.every((route) =>
      route.cli_repo_map && route.mcp_repo_map && route.mcp_security_context
    );
    const productSurfaceScanIdsMatch = Object.values(productSurfaceScanIds).every((productScanId) =>
      productScanId === scanId
    );
    const routeFallbackAbsent = allProductRoutes.every((route) => route.source !== "legacy_fact_fallback") &&
      securityContext.canonical_route_fallback?.used === false &&
      (securityContext.route_source_summary?.legacy_fact_fallback ?? 0) === 0;

    return {
      expected_entrypoints: expectedEntrypoints,
      expected_product_routes: expectedProductRoutes,
      normalized_entrypoint_count: entrypoints.length,
      cli_route_hash: cliRouteHash,
      mcp_route_hash: mcpRouteHash,
      security_context_route_count: securityContextRoutes.length,
      product_surface_scan_ids: productSurfaceScanIds,
      repo_map_route_freshness: [...new Set([...cliRoutes, ...mcpRoutes].map((route) => route.freshness))].sort(),
      security_context_proof_freshness: securityContext.proof_freshness ?? null,
      canonical_routes_verified: expectedEntrypoints.every((entrypoint) =>
        entrypoint.found &&
        entrypoint.actual_route_pattern === entrypoint.route_pattern &&
        entrypoint.actual_method === entrypoint.method &&
        typeof entrypoint.entrypoint_id === "string" &&
        entrypoint.entrypoint_id.length > 0
      ) && expectedProductRoutesPresent,
      canonical_route_fallback_absent: routeFallbackAbsent,
      cli_mcp_route_parity_verified: cliRoutes.length > 0 &&
        cliRouteHash === mcpRouteHash &&
        cliRoutes.every((route) => typeof route.normalized_entrypoint_id === "string" && route.normalized_entrypoint_id.length > 0),
      security_context_canonical_verified: securityContext.response_schema === "drift.security.context.v2" &&
        securityContext.canonical_route_fallback?.used === false &&
        (securityContext.route_source_summary?.legacy_fact_fallback ?? 0) === 0 &&
        securityContextRoutes.length > 0 &&
        securityContextRoutes.every((route) =>
          route.source !== "legacy_fact_fallback" &&
          typeof route.normalized_entrypoint_id === "string" &&
          route.normalized_entrypoint_id.length > 0
        ),
      canonical_proof_freshness_verified: freshnessIsUsable(securityContext.proof_freshness) &&
        productSurfaceScanIdsMatch &&
        allProductRoutes.every((route) => route.freshness !== "stale")
    };
  } finally {
    storage.close();
  }
}

function routeById(routes, routeId) {
  return routes.find((route) => route.route_id === routeId) ?? null;
}

function productRouteMatches(expected, actual) {
  return actual?.path === expected.path &&
    actual?.method === expected.method &&
    actual?.normalized_entrypoint_id === expected.normalized_entrypoint_id;
}

function productSurfaceScanId(payload) {
  return payload.latest_scan?.id ?? payload.scan_status?.latest_scan?.id ?? null;
}

function canonicalRouteProjection(routes) {
  return routes
    .map((route) => ({
      route_id: route.route_id,
      path: route.path ?? null,
      method: route.method ?? null,
      normalized_entrypoint_id: route.normalized_entrypoint_id ?? null,
      source: route.source ?? null,
      freshness: route.freshness ?? null
    }))
    .sort((left, right) =>
      left.route_id.localeCompare(right.route_id) ||
      (left.path ?? "").localeCompare(right.path ?? "") ||
      (left.method ?? "").localeCompare(right.method ?? "")
    );
}

function stablePayloadForParity(payload) {
  return stripParityVolatileFields(normalizeParityPayload(payload));
}

function normalizeParityPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (payload.response_schema === "drift.repo.map.v1") {
    const {
      route_source_summary: _routeSourceSummary,
      canonical_route_fallback: _canonicalRouteFallback,
      proof_freshness: _proofFreshness,
      ...rest
    } = payload;
    return rest;
  }
  if (payload.response_schema !== "drift.findings.list.v1") {
    return payload;
  }
  return {
    ...payload,
    review_items: Array.isArray(payload.review_items)
      ? payload.review_items.map((item) => ({
          ...item,
          first_evidence: item.first_evidence
            ? {
                file_path: item.first_evidence.file_path,
                start_line: item.first_evidence.start_line ?? null
              }
            : null
        }))
      : payload.review_items,
    findings: Array.isArray(payload.findings)
      ? payload.findings.map((finding) => ({
          finding_id: finding.finding_id ?? finding.id,
          convention_id: finding.convention_id,
          title: finding.title,
          severity: finding.severity,
          lifecycle: finding.lifecycle ?? finding.status,
          diff_status: finding.diff_status,
          enforcement_result: finding.enforcement_result,
          file_refs: finding.file_refs ?? (Array.isArray(finding.evidence_refs)
            ? finding.evidence_refs.map((ref) => ({
                file_path: ref.file_path,
                ...(ref.start_line ? { start_line: ref.start_line } : {}),
                ...(ref.end_line ? { end_line: ref.end_line } : {}),
                redaction_state: ref.start_line || ref.end_line ? "line_only" : "metadata_only"
              }))
            : [])
        }))
      : payload.findings
  };
}

function freshnessIsUsable(value) {
  return value === "fresh" || value === "none";
}

function stripParityVolatileFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripParityVolatileFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generated_at" && key !== "created_at")
      .map(([key, entry]) => [key, stripParityVolatileFields(entry)])
  );
}

function assertBetaProof(proof) {
  const missing = [];
  for (const [field, value] of Object.entries(proof.beta_proof)) {
    if (field === "verify_ci_status") {
      continue;
    }
    if (value !== true && value !== false && (typeof value !== "string" || value.length === 0)) {
      missing.push(field);
    }
  }
  if (proof.beta_proof.fallback_used !== false) {
    missing.push("fallback_used_false");
  }
  for (const field of [
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
    "semantic_beta_proof_verified",
    "canonical_routes_verified",
    "canonical_route_fallback_absent",
    "cli_mcp_route_parity_verified",
    "security_context_canonical_verified",
    "canonical_proof_freshness_verified",
    "contract_parity_verified",
    "mcp_cli_parity_verified",
    "audit_verified"
  ]) {
    if (proof.beta_proof[field] !== true) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Incomplete beta proof: ${[...new Set(missing)].join(", ")}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function graphProofForScan(databasePath, repoId, scanId) {
  if (!scanId) {
    return {
      graph_nodes_count: 0,
      graph_edges_count: 0,
      graph_evidence_count: 0,
      evidence_confidence: []
    };
  }
  const { openDriftStorage } = await import(pathToFileURL(resolve("packages/storage/dist/index.js")).href);
  const storage = openDriftStorage({ databasePath });
  try {
    const graphEvidence = storage.listGraphEvidence(repoId, scanId);
    return {
      graph_nodes_count: storage.listGraphNodes(repoId, scanId).length,
      graph_edges_count: storage.listGraphEdges(repoId, scanId).length,
      graph_evidence_count: graphEvidence.length,
      evidence_confidence: graphEvidence
        .filter((evidence) => typeof evidence.confidence_kind === "string")
        .map((evidence) => ({
          id: evidence.id,
          file_path: evidence.file_path,
          confidence_kind: evidence.confidence_kind,
          extractor: evidence.extractor,
          snippet_hash: evidence.snippet_hash ?? null
        }))
    };
  } finally {
    storage.close();
  }
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

function gitOutput(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)])
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
