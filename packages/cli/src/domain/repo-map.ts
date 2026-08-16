import { authorizeContextExport,type FileRole,type PolicyDecision,type RepoContract } from "@drift/core";
import {
  buildRepoMapPayload,
  buildRepoMapReadModel,
  createGraphQueryService,
  fallbackFactRepoMapFiles,
  repoMapConventionIds,
  repoMapOpenFindingIds,
  repoMapRiskyAreaIds,
  type RepoMapFile
} from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
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
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, Boolean(options.requireFresh));
  const allParserGaps = latestScan
    ? [...storage.listParserGaps(repoId, latestScan.id), ...storage.listParserGapV2(repoId, latestScan.id)]
    : [];
  // W6/D-A2: one derivation, shared with MCP. The CLI's copy of this assembly omitted
  // `route_source_summary`, `canonical_route_fallback` and `proof_freshness` - all three already
  // computed here, and all three dropped.
  return buildRepoMapPayload({
    storage,
    repoId,
    repo,
    contract,
    policy,
    governance: preflightGovernance(),
    scanStatus,
    freshnessRequirement: freshnessRequirement(Boolean(options.requireFresh), scanStatus),
    scanFingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    latestScan: latestScan ?? null,
    readiness: readinessForStoredScan(storage, repoId, latestScan?.id ?? null, "repo_map", allParserGaps),
    options
  });
}

export type { RepoMapFile };
