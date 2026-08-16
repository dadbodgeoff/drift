/**
 * The `drift.repo.map.v1` document, assembled once for both surfaces.
 *
 * W6 / D-A2. `repoMapPayload` existed twice - packages/cli/src/domain/repo-map.ts and
 * packages/mcp/src/index.ts - as 120-line near-copies. Every overlapping key was
 * byte-identical, and `mcp keys - cli keys` was exactly three:
 *
 *   route_source_summary     how many routes came from proofs vs the fact fallback
 *   canonical_route_fallback whether the canonical route list fell back at all
 *   proof_freshness          whether the proofs backing those routes are from this scan
 *
 * All three are computed INSIDE the CLI's copy already - `buildSecurityPhase8ReadModel` returns
 * them on the same `phase8Security` object the CLI reads `routes` off - and then dropped on the
 * floor. So `drift repo map --json` answered "here are the routes" while withholding the three
 * fields that say how much to trust them, and the same schema version over MCP answered with
 * them. A consumer keying on `response_schema` got different documents from the same contract.
 *
 * The surface-specific parts are parameters rather than branches: each surface resolves its own
 * contract and policy (their refusal messages differ, and MCP's carries a `ready` flag the CLI
 * has no use for) and passes the result in. Everything downstream of that is one derivation.
 */

import {
  type FileRole,
  type PolicyDecision,
  type RepoContract
} from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { agentEnvelopeForScan } from "./agent-envelope.js";
import { buildCanonicalRouteReadModel, type CanonicalFactRouteInput } from "./canonical-routes.js";
import { buildFrameworkEntrypointReadModel } from "./framework-entrypoints.js";
import { buildParserGapQuality } from "./parser-gap-quality.js";
import { buildSecurityPhase8ReadModel } from "./security-boundary-proof.js";
import {
  buildRepoMapReadModel,
  createGraphQueryService,
  fallbackFactRepoMapFiles,
  repoMapFileForPayload,
  type RepoMapFile
} from "./index.js";

export interface RepoMapPayloadInput {
  storage: SqliteDriftStorage;
  repoId: string;
  /** The repo record, already required by the caller so its "unknown repo" wording is its own. */
  repo: { root_path: string };
  /** Resolved and authorized by the caller - see the module comment. */
  contract: RepoContract;
  policy: PolicyDecision;
  /** Governance block, which each surface words for its own audience. */
  governance: unknown;
  /** The scan-status document, and the freshness helpers that read it. */
  scanStatus: { stale: boolean; latest_scan?: { id: string } | null };
  freshnessRequirement: unknown;
  scanFingerprint: string | null;
  latestScan: { id: string } | null;
  readiness: unknown;
  options: {
    surface: PolicyDecision["surface"];
    role?: FileRole;
    path?: string;
    requireFresh?: boolean;
    limit?: number;
    offset?: number;
  };
}

export function buildRepoMapPayload(input: RepoMapPayloadInput) {
  const { storage, repoId, contract, options } = input;
  const latestScan = input.latestScan;
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan
    ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id })
    : null;
  const normalizedEntrypoints = latestScan
    ? storage.listNormalizedEntrypoints(repoId, latestScan.id)
    : [];
  const frameworkEntryPoints = latestScan
    ? buildFrameworkEntrypointReadModel({
        repo_id: repoId,
        scan_id: latestScan.id,
        entrypoints: normalizedEntrypoints,
        parser_gaps: storage.listFrameworkParserGaps(repoId, latestScan.id),
        capabilities: storage.listFrameworkCapabilities(repoId, latestScan.id)
      })
    : null;
  const readModel = buildRepoMapReadModel({
    repoId,
    scanId: latestScan?.id ?? null,
    graphFiles: graphMap?.files ?? [],
    factFiles: fallbackFactRepoMapFiles(snapshots, facts),
    contract,
    findings,
    filters: { role: options.role, path: options.path },
    limit: options.limit,
    offset: options.offset ?? 0
  });
  const allParserGaps = latestScan
    ? [...storage.listParserGaps(repoId, latestScan.id), ...storage.listParserGapV2(repoId, latestScan.id)]
    : [];
  const proofRuns = latestScan
    ? storage.listLatestSecurityBoundaryProofRunsForRepo({ repo_id: repoId, file_path: options.path })
    : [];
  const fallbackProofs =
    proofRuns.length === 0 && latestScan
      ? storage
          .listSecurityBoundaryProofs(repoId, latestScan.id)
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
      ...(proof.route.normalized_entrypoint_id
        ? { normalized_entrypoint_id: proof.route.normalized_entrypoint_id }
        : {}),
      file_path: proof.route.file_path,
      path: proof.route.endpoint?.path ?? null,
      method: proof.route.endpoint?.method ?? proof.route.handler_symbol ?? null
    })),
    fallback_fact_routes: fallbackFactRoutes(readModel.all_files)
  });
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
    known_routes: canonicalRoutes.routes.filter((route) => !options.path || route.file_path === options.path),
    route_source_summary: canonicalRoutes.route_source_summary,
    canonical_route_fallback: canonicalRoutes.fallback
  });
  return {
    response_schema: "drift.repo.map.v1",
    repo_id: repoId,
    repo_root: input.repo.root_path,
    generated_at: new Date().toISOString(),
    agent_envelope: agentEnvelopeForScan({
      surface: options.surface,
      policy: input.policy,
      scanStatus: input.scanStatus,
      requireFresh: Boolean(options.requireFresh),
      // Same value the payload's `redactions` reports. The envelope builds its own redactions and
      // defaulted this to false, so a paginated map claimed `safe_to_edit` in the envelope while
      // `redactions.context_truncated` said true one key away.
      contextTruncated: readModel.pagination.has_more
    }),
    policy: input.policy,
    readiness: input.readiness,
    parser_gap_quality: buildParserGapQuality({
      repo_id: repoId,
      scan_id: latestScan?.id ?? null,
      surface: "repo_map",
      parser_gaps: allParserGaps,
      readiness: input.readiness as never
    }),
    governance: input.governance,
    latest_scan: latestScan ?? null,
    scan_fingerprint: input.scanFingerprint,
    scan_status: input.scanStatus,
    filters: {
      role: options.role ?? null,
      path: options.path ?? null
    },
    summary: readModel.summary,
    impact_summary: readModel.impact_summary,
    topology: readModel.topology,
    pagination: readModel.pagination,
    routes: phase8Security.routes,
    // D-A2: the three fields the CLI computed and discarded. They are the trust half of the
    // routes above - where each route came from, whether the list fell back, and whether the
    // proofs behind it are from the current scan.
    route_source_summary: phase8Security.route_source_summary,
    canonical_route_fallback: phase8Security.canonical_route_fallback,
    proof_freshness: phase8Security.proof_freshness,
    framework_entrypoints: frameworkEntryPoints,
    freshness_requirement: input.freshnessRequirement,
    files: readModel.listed_files.map(repoMapFileForPayload),
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false,
      source_content_included: false,
      graph_context_included: Boolean(graphMap),
      // Derived, not asserted: a paginated map is a subset, and `has_more` already says so.
      // Claiming `false` here told the envelope to report `safe_to_edit` for a response that
      // omits files.
      context_truncated: readModel.pagination.has_more
    },
    next_commands: [
      `drift prepare "task" --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]
  };
}

/**
 * Routes recovered from facts when no proof names them.
 *
 * Module-private in BOTH copies, byte-identical, and therefore invisible to the architecture
 * census, which indexed only symbols carrying a top-level `export`.
 */
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
