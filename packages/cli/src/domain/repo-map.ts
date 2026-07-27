import { authorizeContextExport,type FileRole,type PolicyDecision,type RepoContract } from "@drift/core";
import {
  buildCanonicalRouteReadModel,
  buildFrameworkEntrypointReadModel,
  buildParserGapQuality,
  buildRepoMapReadModel,
  buildSecurityPhase8ReadModel,
  createGraphQueryService,
  fallbackFactRepoMapFiles,
  repoMapConventionIds,
  repoMapOpenFindingIds,
  repoMapRiskyAreaIds,
  type CanonicalFactRouteInput,
  type RepoMapFile
} from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { agentEnvelopeForScan } from "./agent-envelope.js";
import { preflightGovernance } from "./governance.js";
import { scanFingerprint } from "./identifiers.js";
import { repoContractOrDefault } from "./repo-paths.js";
import { assertFreshScanIfRequired,freshnessRequirement,latestIndexedScan,readinessForStoredScan,scanStatusPayload } from "./scan-status.js";

export function policyFileContext(
  storage: SqliteDriftStorage,
  repoId: string,
  filePath: string,
  contract: RepoContract
): {
  path: string;
  indexed: boolean;
  roles: string[];
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
} {
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const readModel = buildRepoMapReadModel({
    repoId,
    scanId: latestScan?.id ?? null,
    graphFiles: graphMap?.files ?? [],
    factFiles: fallbackFactRepoMapFiles(snapshots, facts),
    contract,
    findings
  });
  const file = readModel.all_files.find((entry) => entry.path === filePath);
  if (!file) {
    return {
      path: filePath,
      indexed: false,
      roles: [],
      convention_ids: repoMapConventionIds(contract, filePath),
      risky_area_ids: repoMapRiskyAreaIds(contract, filePath),
      open_finding_ids: repoMapOpenFindingIds(findings, filePath)
    };
  }
  return {
    path: file.path,
    indexed: true,
    roles: file.roles,
    convention_ids: file.convention_ids,
    risky_area_ids: file.risky_area_ids,
    open_finding_ids: file.open_finding_ids
  };
}

export function repoMapPayload(
  storage: SqliteDriftStorage,
  repoId: string,
  options: {
    surface: PolicyDecision["surface"];
    role?: FileRole;
    path?: string;
    requireFresh?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}. Run drift scan --repo-root <path> first.`);
  }
  const contract = repoContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, options.surface);
  if (!policy.allowed) {
    throw new Error(`Policy denied repo map output: ${policy.reason}`);
  }
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const normalizedEntrypoints = latestScan
    ? storage.listNormalizedEntrypoints(repoId, latestScan.id)
    : [];
  const frameworkParserGaps = latestScan
    ? storage.listFrameworkParserGaps(repoId, latestScan.id)
    : [];
  const frameworkCapabilities = latestScan
    ? storage.listFrameworkCapabilities(repoId, latestScan.id)
    : [];
  const frameworkEntryPoints = latestScan
    ? buildFrameworkEntrypointReadModel({
        repo_id: repoId,
        scan_id: latestScan.id,
        entrypoints: normalizedEntrypoints,
        parser_gaps: frameworkParserGaps,
        capabilities: frameworkCapabilities
      })
    : null;
  const readModel = buildRepoMapReadModel({
    repoId,
    scanId: latestScan?.id ?? null,
    graphFiles: graphMap?.files ?? [],
    factFiles: fallbackFactRepoMapFiles(snapshots, facts),
    contract,
    findings,
    filters: {
      role: options.role,
      path: options.path
    },
    limit: options.limit,
    offset: options.offset ?? 0
  });
  const offset = options.offset ?? 0;
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, Boolean(options.requireFresh));
  const allParserGaps = latestScan
    ? [...storage.listParserGaps(repoId, latestScan.id), ...storage.listParserGapV2(repoId, latestScan.id)]
    : [];
  const readiness = readinessForStoredScan(storage, repoId, latestScan?.id ?? null, "repo_map", allParserGaps);
  const proofRuns = latestScan
    ? storage.listLatestSecurityBoundaryProofRunsForRepo({
        repo_id: repoId,
        file_path: options.path
      })
    : [];
  const fallbackProofs = proofRuns.length === 0 && latestScan
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
        .filter((proof) => !options.path || proof.route.file_path === options.path)
    : [];
  const proofs = proofRuns.length > 0 ? proofRuns.map((run) => run.proof) : fallbackProofs;
  const proofScanId = proofRuns[0]?.scan_id ?? (fallbackProofs.length > 0 ? latestScan?.id ?? null : null);
  const canonicalRoutes = buildCanonicalRouteReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    entrypoints: normalizedEntrypoints,
    proofs: proofs.map((proof) => ({
      proof_scan_id: proofScanId,
      route_id: proof.route.route_id,
      ...(proof.route.normalized_entrypoint_id ? { normalized_entrypoint_id: proof.route.normalized_entrypoint_id } : {}),
      file_path: proof.route.file_path,
      path: proof.route.endpoint?.path ?? null,
      method: proof.route.endpoint?.method ?? proof.route.handler_symbol ?? null
    })),
    fallback_fact_routes: fallbackFactRoutes(readModel.all_files)
  });
  const canonicalKnownRoutes = canonicalRoutes.routes
    .filter((route) => !options.path || route.file_path === options.path);
  const phase8Security = buildSecurityPhase8ReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    check_id: proofRuns[0]?.check_id ?? null,
    proof_scan_id: proofScanId,
    proofs,
    findings: findings.map((finding) => ({
      finding_id: finding.id,
      title: finding.title,
      lifecycle: finding.status
    })),
    accepted_conventions: contract.conventions,
    changed_files: options.path ? [options.path] : undefined,
    known_routes: canonicalKnownRoutes,
    route_source_summary: canonicalRoutes.route_source_summary,
    canonical_route_fallback: canonicalRoutes.fallback
  });
  return {
    response_schema: "drift.repo.map.v1",
    repo_id: repoId,
    repo_root: repo.root_path,
    generated_at: new Date().toISOString(),
    agent_envelope: agentEnvelopeForScan({
      surface: options.surface,
      policy,
      scanStatus,
      requireFresh: Boolean(options.requireFresh)
    }),
    policy,
    readiness,
    parser_gap_quality: buildParserGapQuality({
      repo_id: repoId,
      scan_id: latestScan?.id ?? null,
      surface: "repo_map",
      parser_gaps: allParserGaps,
      readiness
    }),
    governance: preflightGovernance(),
    latest_scan: latestScan ?? null,
    scan_fingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    scan_status: scanStatus,
    filters: {
      role: options.role ?? null,
      path: options.path ?? null
    },
    summary: readModel.summary,
    impact_summary: readModel.impact_summary,
    topology: readModel.topology,
    pagination: readModel.pagination,
    routes: phase8Security.routes,
    framework_entrypoints: frameworkEntryPoints,
    freshness_requirement: freshnessRequirement(Boolean(options.requireFresh), scanStatus),
    files: readModel.listed_files,
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false,
      source_content_included: false,
      graph_context_included: Boolean(graphMap),
      context_truncated: false
    },
    next_commands: [
      `drift prepare "task" --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]
  };
}

export type { RepoMapFile };

function fallbackFactRoutes(files: RepoMapFile[]): CanonicalFactRouteInput[] {
  return files
    .filter((file) => file.roles.includes("api_route"))
    .flatMap((file) => {
      const methods = file.exported_symbols.filter((symbol) =>
        ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(symbol)
      );
      return (methods.length > 0 ? methods : ["unknown"]).map((method) => ({
        route_id: `route:${file.path}:${method}`,
        file_path: file.path,
        method,
        file_role: "api_route"
      }));
    });
}
