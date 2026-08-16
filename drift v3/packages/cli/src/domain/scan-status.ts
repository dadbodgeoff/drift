import { type AuditChainVerification,type ConventionCandidate,DRIFT_RESOLVER_VERSION,DRIFT_RULE_ENGINE_VERSION,DRIFT_SCANNER_VERSION,DRIFT_TYPESCRIPT_ADAPTER_VERSION,type FileSnapshot,type ParserGap,type ParserGapConfidenceImpact,type ParserGapKind,type RepoRecord,type ScanCapabilityReport,type ScanFileChange,type ScanManifest } from "@drift/core";
import { buildFactGraphArtifactFromParts,type FactGraphArtifact } from "@drift/factgraph";
import { buildReadiness,buildSecurityPhase8ReadModel,type DriftReadinessSurface } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,mkdtempSync,readdirSync,rmSync,statSync,writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectScanData,type ScanData } from "../engine/collect-scan-data.js";
import { inferConventionCandidatesFromEngine } from "../engine/engine-candidates.js";
import { buildFactGraphArtifact } from "../engine/fact-graph.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { fileContentHash } from "../io/file-hash.js";
import { gitOutput } from "../io/git.js";
import { filterRejectedConventionCandidates,inferConventionCandidates } from "./convention-candidates.js";
import { auditEvent,preflightGovernance } from "./governance.js";
import { hashStable,scanFingerprint } from "./identifiers.js";
import { repoRecordForRoot } from "./repo-paths.js";
import { currentMachineContractVersions } from "./versions.js";

export interface ScanStatusChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface ScanRepoInput {
  now: string;
  repoRoot: string;
  actor: string;
  databasePath: string;
}

export interface IncrementalScanPlan {
  previous_scan_id: string | null;
  execution_mode: "full_scan" | "incremental_reuse";
  reuse_applied: boolean;
  reusable_file_count: number;
  changed_file_count: number;
  blocked_reasons: string[];
}

export async function runScanRepo(storage: SqliteDriftStorage, input: ScanRepoInput): Promise<{
  repo: RepoRecord;
  scan: ScanManifest;
  candidates: ConventionCandidate[];
  summary: {
    files_indexed: number;
    files_skipped: number;
    facts_count: number;
    diagnostics_count: number;
    candidates_count: number;
    engine_source: "rust" | "typescript";
    incremental_changes: ReturnType<typeof scanFileChangeSummary>;
    incremental_plan: IncrementalScanPlan;
  };
  database_path: string;
}> {
  const now = input.now;
  const repoRoot = input.repoRoot;
  if (existsSync(repoRoot) && !statSync(repoRoot).isDirectory()) {
    throw new Error(`--repo-root must be a directory: ${repoRoot}`);
  }
  const actor = input.actor;
  const repo = repoRecordForRoot(repoRoot, now);
  storage.upsertRepo(repo);
  const previousScan = storage.listScanManifests(repo.id).find((scan) => scan.status === "completed");

  const scanId = `scan_${hashStable(`${repo.id}:${now}`).slice(0, 16)}`;
  let reuseManifest: { path: string; dir: string; blocked_reasons: string[] } | null = null;
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_scan_started_${repo.id}_${scanId}`,
    repoId: repo.id,
    actor,
    action: "scan_started",
    targetType: "scan",
    targetId: scanId,
    metadata: {
      repo_root: repoRoot,
      previous_scan_id: previousScan?.id ?? null
    },
    createdAt: now
  }));
  try {
    const currentResolverInputFingerprint = resolverInputFingerprint(repoRoot);
    reuseManifest = createScanReuseManifest({
      storage,
      repoId: repo.id,
      previousScan,
      currentResolverInputFingerprint
    });
    const scanData = await collectScanData({
      repoId: repo.id,
      scanId,
      repoRoot,
      reuseManifestPath: reuseManifest?.path
    });
    const inferredCandidates = scanData.engineSource === "rust"
      ? await inferConventionCandidatesFromEngine({
          repoId: repo.id,
          scanId,
          scanData,
          now
        })
      : inferConventionCandidates({
          repoId: repo.id,
          scanId,
          repoRoot,
          facts: scanData.facts,
          now
        });
    const candidates = filterRejectedConventionCandidates(storage, repo.id, inferredCandidates);
    const scan: ScanManifest = {
      id: scanId,
      repo_id: repo.id,
      branch: gitOutput(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(repoRoot, ["status", "--porcelain"])),
      previous_scan_id: previousScan?.id,
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: {
        typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
        resolver: DRIFT_RESOLVER_VERSION,
        resolver_inputs: currentResolverInputFingerprint
      },
      rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
      status: "completed",
      file_count: scanData.files.length,
      fact_count: scanData.facts.length,
      finding_count: 0,
      started_at: now,
      completed_at: now
    };

    const graphRepo = {
      repo_id: repo.id,
      scan_id: scanId,
      root_hash: hashStable(JSON.stringify(scanData.snapshots.map((snapshot) => [
        snapshot.file_path,
        snapshot.content_hash
      ]).sort())),
      branch: scan.branch,
      commit: scan.commit,
      dirty: scan.dirty
    };
    const graphArtifact = scanData.graph_nodes.length > 0
      ? buildFactGraphArtifactFromParts({
        repo: graphRepo,
        snapshots: scanData.snapshots,
        nodes: scanData.graph_nodes,
        edges: scanData.graph_edges,
        evidence: scanData.graph_evidence,
        adapters: [{
          id: "typescript",
          version: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
          deterministic: true,
          capabilities: ["file_discovery", "syntax_facts", "graph_stream"]
        }],
        createdAt: now
      })
      : buildFactGraphArtifact({
        repoId: repo.id,
        scanId,
        snapshots: scanData.snapshots,
        facts: scanData.facts,
        createdAt: now,
        pathAliases: readTsconfigPathAliases(repoRoot),
        repo: {
          root_hash: graphRepo.root_hash,
          branch: graphRepo.branch,
          commit: graphRepo.commit,
          dirty: graphRepo.dirty
        }
      });
    const scanFileChanges = classifyScanFileChanges({
      repoId: repo.id,
      scanId,
      previousSnapshots: previousScan
        ? storage.listFileSnapshots(repo.id, previousScan.id)
        : [],
      currentSnapshots: scanData.snapshots,
      createdAt: now
    });
    const incrementalChanges = scanFileChangeSummary(scanFileChanges);
    const incrementalPlan = incrementalScanPlan({
      previousScan,
      currentScan: scan,
      changes: scanFileChanges,
      filesReused: scanData.stats?.files_reused ?? 0,
      reuseBlockedReasons: reuseManifest?.blocked_reasons ?? scanReuseBlockedReasons({
        previousScan,
        currentResolverInputFingerprint,
        previousCapabilityReport: previousScan
          ? storage.getScanCapabilityReport(repo.id, previousScan.id) ?? null
          : null
      })
    });
    const parserGaps = parserGapsFromDiagnostics({
      repoId: repo.id,
      scanId,
      diagnostics: scanData.graph_diagnostics.length > 0 ? scanData.graph_diagnostics : scanData.diagnostics,
      createdAt: now
    });
    const capabilityReport = scanCapabilityReportForScan({
      repoId: repo.id,
      scanId,
      scan,
      scanData,
      graphArtifact,
      parserGaps,
      createdAt: now
    });

    storage.transaction(() => {
      storage.upsertScanManifest(scan);
      for (const snapshot of scanData.snapshots) {
        storage.upsertFileSnapshot(snapshot);
      }
      storage.upsertScanFileChanges(scanFileChanges);
      storage.upsertFacts(scanData.facts);
      storage.upsertParserGaps(parserGaps);
      storage.upsertScanCapabilityReport(capabilityReport);
      storage.upsertFactGraphArtifact(graphArtifact);
      for (const candidate of candidates) {
        storage.upsertConventionCandidate(candidate);
      }
      storage.appendAuditEvent(auditEvent({
        id: `audit_event_scan_completed_${repo.id}_${scanId}`,
        repoId: repo.id,
        actor,
        action: "scan_completed",
        targetType: "scan",
        targetId: scanId,
        metadata: {
          files_indexed: scanData.files.length,
          files_skipped: scanData.stats?.files_skipped ?? 0,
          facts_count: scanData.facts.length,
          diagnostics_count: scanData.diagnostics.length,
          candidates_count: candidates.length,
          engine_source: scanData.engineSource,
          incremental_changes: incrementalChanges,
          incremental_plan: incrementalPlan
        },
        createdAt: now
      }));
    });

    return {
      repo,
      scan,
      candidates,
      summary: {
        files_indexed: scanData.files.length,
        files_skipped: scanData.stats?.files_skipped ?? 0,
        facts_count: scanData.facts.length,
        diagnostics_count: scanData.diagnostics.length,
        candidates_count: candidates.length,
        engine_source: scanData.engineSource,
        incremental_changes: incrementalChanges,
        incremental_plan: incrementalPlan
      },
      database_path: input.databasePath
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown scan failure.";
    const failedScan: ScanManifest = {
      id: scanId,
      repo_id: repo.id,
      branch: gitOutput(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(repoRoot, ["status", "--porcelain"])),
      previous_scan_id: previousScan?.id,
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: {
        typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
        resolver: DRIFT_RESOLVER_VERSION,
        resolver_inputs: resolverInputFingerprint(repoRoot)
      },
      rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
      status: "failed",
      file_count: 0,
      fact_count: 0,
      finding_count: 0,
      started_at: now,
      completed_at: now,
      error_message: errorMessage
    };
    storage.transaction(() => {
      storage.upsertScanManifest(failedScan);
      storage.appendAuditEvent(auditEvent({
        id: `audit_event_scan_failed_${repo.id}_${scanId}`,
        repoId: repo.id,
        actor,
        action: "scan_failed",
        targetType: "scan",
        targetId: scanId,
        metadata: { error_message: errorMessage },
        createdAt: now
      }));
    });
    throw error;
  } finally {
    cleanupScanReuseManifest(reuseManifest);
  }
}

function readTsconfigPathAliases(repoRoot: string): Record<string, string[]> {
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath) || !statSync(tsconfigPath).isFile()) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    return parsed.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

function createScanReuseManifest(input: {
  storage: SqliteDriftStorage;
  repoId: string;
  previousScan?: ScanManifest;
  currentResolverInputFingerprint: string;
}): { path: string; dir: string; blocked_reasons: string[] } | null {
  const blockedReasons = scanReuseBlockedReasons({
    previousScan: input.previousScan,
    currentResolverInputFingerprint: input.currentResolverInputFingerprint,
    previousCapabilityReport: input.previousScan
      ? input.storage.getScanCapabilityReport(input.repoId, input.previousScan.id) ?? null
      : null
  });
  if (!input.previousScan || blockedReasons.length > 0) {
    return null;
  }

  const snapshots = input.storage.listFileSnapshots(input.repoId, input.previousScan.id);
  const facts = input.storage.listFacts(input.previousScan.id);
  const dir = mkdtempSync(join(tmpdir(), "drift-reuse-"));
  const path = join(dir, "reuse-manifest.json");
  writeFileSync(path, JSON.stringify({
    schema_version: "engine.reuse_manifest.v1",
    previous_scan_id: input.previousScan.id,
    file_snapshots: snapshots.map((snapshot) => ({
      file_path: snapshot.file_path,
      content_hash: snapshot.content_hash,
      byte_size: snapshot.byte_size,
      indexed: snapshot.indexed
    })),
    facts: facts.map((fact) => ({
      kind: fact.kind,
      file_path: fact.file_path,
      name: fact.name,
      ...(fact.value ? { value: fact.value } : {}),
      ...(fact.imported_name ? { imported_name: fact.imported_name } : {}),
      start_line: fact.start_line,
      end_line: fact.end_line
    }))
  }), "utf8");
  return { path, dir, blocked_reasons: [] };
}

function cleanupScanReuseManifest(manifest: { dir: string } | null): void {
  if (!manifest) {
    return;
  }
  rmSync(manifest.dir, { recursive: true, force: true });
}

function scanReuseBlockedReasons(input: {
  previousScan?: ScanManifest;
  currentResolverInputFingerprint?: string;
  previousCapabilityReport?: ScanCapabilityReport | null;
}): string[] {
  if (!input.previousScan) {
    return ["previous_scan_missing"];
  }
  const reasons: string[] = [];
  if ("previousCapabilityReport" in input && !input.previousCapabilityReport) {
    reasons.push("previous_scan_capability_report_missing");
  } else if (input.previousCapabilityReport && (
    input.previousCapabilityReport.engine_source !== "rust" ||
    input.previousCapabilityReport.fallback_used ||
    input.previousCapabilityReport.enforcement_degraded
  )) {
    reasons.push("previous_scan_degraded");
  }
  if (input.previousScan.scanner_version !== DRIFT_SCANNER_VERSION) {
    reasons.push("scanner_version_changed");
  }
  if (input.previousScan.adapter_versions.typescript !== DRIFT_TYPESCRIPT_ADAPTER_VERSION) {
    reasons.push("adapter_version_changed:typescript");
  }
  if (
    input.previousScan.adapter_versions.resolver &&
    input.previousScan.adapter_versions.resolver !== DRIFT_RESOLVER_VERSION
  ) {
    reasons.push("resolver_version_changed");
  }
  if (
    input.previousScan.adapter_versions.resolver_inputs &&
    input.currentResolverInputFingerprint &&
    input.previousScan.adapter_versions.resolver_inputs !== input.currentResolverInputFingerprint
  ) {
    reasons.push("resolver_inputs_changed");
  }
  if (
    input.previousScan.adapter_versions.resolver &&
    input.previousScan.adapter_versions.resolver === DRIFT_RESOLVER_VERSION &&
    input.currentResolverInputFingerprint &&
    !input.previousScan.adapter_versions.resolver_inputs
  ) {
    reasons.push("resolver_inputs_missing");
  }
  return reasons.sort((left, right) => left.localeCompare(right));
}

export function classifyScanFileChanges(input: {
  repoId: string;
  scanId: string;
  previousSnapshots: FileSnapshot[];
  currentSnapshots: FileSnapshot[];
  createdAt: string;
}): ScanFileChange[] {
  const previous = new Map(input.previousSnapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const current = new Map(input.currentSnapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const changes: ScanFileChange[] = [];

  for (const snapshot of input.currentSnapshots) {
    const previousSnapshot = previous.get(snapshot.file_path);
    const changeKind = !previousSnapshot
      ? "added"
      : previousSnapshot.content_hash === snapshot.content_hash
        ? "unchanged"
        : "modified";
    changes.push({
      repo_id: input.repoId,
      scan_id: input.scanId,
      file_path: snapshot.file_path,
      change_kind: changeKind,
      previous_hash: previousSnapshot?.content_hash,
      current_hash: snapshot.content_hash,
      created_at: input.createdAt
    });
  }

  for (const snapshot of input.previousSnapshots) {
    if (current.has(snapshot.file_path)) {
      continue;
    }
    changes.push({
      repo_id: input.repoId,
      scan_id: input.scanId,
      file_path: snapshot.file_path,
      change_kind: "deleted",
      previous_hash: snapshot.content_hash,
      current_hash: undefined,
      created_at: input.createdAt
    });
  }

  return changes.sort((left, right) => left.file_path.localeCompare(right.file_path));
}

export function scanFileChangeSummary(changes: ScanFileChange[]): {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  total: number;
} {
  return {
    added: changes.filter((change) => change.change_kind === "added").length,
    modified: changes.filter((change) => change.change_kind === "modified").length,
    deleted: changes.filter((change) => change.change_kind === "deleted").length,
    unchanged: changes.filter((change) => change.change_kind === "unchanged").length,
    total: changes.length
  };
}

export function incrementalScanPlan(input: {
  previousScan?: ScanManifest;
  currentScan: ScanManifest;
  changes: ScanFileChange[];
  filesReused?: number;
  reuseBlockedReasons?: string[];
}): IncrementalScanPlan {
  const summary = scanFileChangeSummary(input.changes);
  const reuseBlockedReasons = input.reuseBlockedReasons ?? scanReuseBlockedReasons({
    previousScan: input.previousScan,
    currentResolverInputFingerprint: input.currentScan.adapter_versions.resolver_inputs,
    previousCapabilityReport: undefined
  });
  const changedFileCount = summary.added + summary.modified + summary.deleted;
  const filesReused = input.filesReused ?? 0;
  const reuseApplied = filesReused > 0 && reuseBlockedReasons.length === 0;
  const blockedReasons = reuseApplied
    ? []
    : [
        ...reuseBlockedReasons,
        ...(input.previousScan && reuseBlockedReasons.length === 0 ? ["no_reusable_files"] : [])
      ];

  return {
    previous_scan_id: input.previousScan?.id ?? null,
    execution_mode: reuseApplied ? "incremental_reuse" : "full_scan",
    reuse_applied: reuseApplied,
    reusable_file_count: reuseApplied ? filesReused : input.previousScan ? summary.unchanged : 0,
    changed_file_count: changedFileCount,
    blocked_reasons: [...new Set(blockedReasons)].sort((left, right) => left.localeCompare(right))
  };
}

export function scanStatusPayload(storage: SqliteDriftStorage, repoId: string) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}. Run drift scan --repo-root <path> first.`);
  }
  const auditIntegrity = auditIntegritySummary(storage, repoId);
  const scans = storage.listScanManifests(repoId);
  const indexedScanCount = scans.filter((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_restore_")
  ).length;

  const latestScan = latestIndexedScan(scans);
  if (!latestScan) {
    const nextCommands = scanStatusNextCommands(repoId, repo.root_path, true);
    return {
      response_schema: "drift.scan.status.v1",
      repo_id: repoId,
      repo_root: repo.root_path,
      latest_scan: null,
      scan_fingerprint: null,
      indexed_file_count: 0,
      source_change_count: 0,
      latest_scan_change_summary: {
        added: 0,
        modified: 0,
        deleted: 0,
        unchanged: 0,
        total: 0
      },
      governance: preflightGovernance(),
      summary: scanStatusSummary({
        latestScanId: null,
        scanCount: indexedScanCount,
        indexedFileCount: 0,
        sourceChangeCount: 0,
        stale: true,
        invalidationCount: 1,
        auditValid: auditIntegrity.valid
      }),
      audit_integrity: auditIntegrity,
      stale: true,
      invalidation_reasons: ["scan_missing"],
      changes: { added: [], modified: [], deleted: [] },
      parser_gaps: parserGapSummary([]),
      security_capabilities: [],
      readiness: buildReadiness({
        repo_id: repoId,
        scan_id: null,
        surface: "scan_status",
        graph_available: false,
        graph_complete: false,
        parser_gaps: [],
        completeness_reasons: ["scan_missing"],
        required_capabilities: ["scan_manifest", "fact_graph"],
        missing_capabilities: ["scan_manifest", "fact_graph"]
      }),
      capability_report: null,
      machine_contract_versions: currentMachineContractVersions(),
      next_command: nextCommands[0],
      next_commands: nextCommands
    };
  }

  const snapshots = storage.listFileSnapshots(repoId, latestScan.id);
  const scanFileChanges = storage.listScanFileChanges(repoId, latestScan.id);
  const repoRootMissing = !existsSync(repo.root_path);
  const changes = repoRootMissing
    ? {
        added: [],
        modified: [],
        deleted: snapshots.map((snapshot) => snapshot.file_path).sort()
      }
    : compareSnapshotsToCurrentFiles(repo.root_path, snapshots);
  const currentBranch = gitOutput(repo.root_path, ["branch", "--show-current"]) || "unknown";
  const currentResolverInputFingerprint = repoRootMissing
    ? undefined
    : resolverInputFingerprint(repo.root_path);
  const invalidationReasons = [
    ...(repoRootMissing ? ["repo_root_missing"] : []),
    ...scanInvalidationReasons(latestScan, { currentBranch, currentResolverInputFingerprint })
  ];
  const stale = changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0 ||
    invalidationReasons.length > 0;
  const sourceChangeCount = changes.added.length + changes.modified.length + changes.deleted.length;
  const nextCommands = scanStatusNextCommands(repoId, repo.root_path, stale);
  const parserGaps = storage.listParserGaps(repoId, latestScan.id);
  const readiness = readinessForStoredScan(storage, repoId, latestScan.id, "scan_status", parserGaps);
  const capabilityReport = storage.getScanCapabilityReport(repoId, latestScan.id) ?? null;
  const proofRuns = storage.listLatestSecurityBoundaryProofRunsForRepo({
    repo_id: repoId
  });
  const fallbackProofs = proofRuns.length === 0
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
    : [];
  const proofs = proofRuns.length > 0 ? proofRuns.map((run) => run.proof) : fallbackProofs;
  const proofSourceCheckId = proofRuns[0]?.check_id ?? null;
  const proofSourceScanId = proofRuns[0]?.scan_id ?? latestScan.id;
  const legacyScanProofRuns = storage.listSecurityBoundaryProofRuns({
    repo_id: repoId,
    scan_id: latestScan.id,
    latest_only: true
  });
  const securityReadModel = buildSecurityPhase8ReadModel({
    repo_id: repoId,
    scan_id: proofSourceScanId,
    check_id: proofSourceCheckId,
    proofs,
    findings: storage.listFindings(repoId).map((finding) => ({
      finding_id: finding.id,
      title: finding.title,
      lifecycle: finding.status
    })),
    accepted_conventions: storage.getRepoContract(repoId)?.conventions ?? []
  });
  const payload = {
    response_schema: "drift.scan.status.v1",
    repo_id: repoId,
    repo_root: repo.root_path,
    current_branch: currentBranch,
    latest_scan: latestScan,
    scan_fingerprint: scanFingerprint(latestScan, snapshots),
    indexed_file_count: latestScan.file_count,
    source_change_count: sourceChangeCount,
    scan_count: indexedScanCount,
    latest_scan_change_summary: scanFileChangeSummary(scanFileChanges),
    governance: preflightGovernance(),
    summary: scanStatusSummary({
      latestScanId: latestScan.id,
      scanCount: indexedScanCount,
      indexedFileCount: latestScan.file_count,
      sourceChangeCount,
      stale,
      invalidationCount: invalidationReasons.length,
      auditValid: auditIntegrity.valid
    }),
    audit_integrity: auditIntegrity,
    stale,
    invalidation_reasons: invalidationReasons,
    changes,
    parser_gaps: parserGapSummary(parserGaps),
    readiness,
    capability_report: capabilityReport,
    security_capabilities: proofs.length > 0 || legacyScanProofRuns.length > 0 ? securityReadModel.security_capabilities : [],
    machine_contract_versions: currentMachineContractVersions(latestScan.adapter_versions),
    next_command: nextCommands[0],
    next_commands: nextCommands
  };
  return payload;
}

function securityCapabilitySummary(capabilityReport: ReturnType<SqliteDriftStorage["getScanCapabilityReport"]> | null) {
  const certified = new Set(capabilityReport?.certified_capabilities ?? []);
  const required = new Set(capabilityReport?.required_capabilities ?? []);
  const missing = new Set(capabilityReport?.missing_capabilities ?? []);
  const completenessByRule = new Map((capabilityReport?.completeness ?? [])
    .map((entry) => [entry.rule_id, entry]));
  const middlewareCompleteness = completenessByRule.get("middleware_must_cover_routes");
  const requestValidationCompleteness = completenessByRule.get("api_route_requires_request_validation");
  const sessionTrustCompleteness = completenessByRule.get("session_object_must_come_from_trusted_helper");
  const authorizationCompleteness = completenessByRule.get("api_route_requires_authorization");
  const tenantScopeCompleteness = completenessByRule.get("api_route_requires_tenant_scope");
  return {
    middleware_coverage: {
      certified: certified.has("middleware_coverage"),
      required: required.has("middleware_coverage"),
      missing: missing.has("middleware_coverage"),
      can_block: Boolean(middlewareCompleteness?.can_block),
      complete: Boolean(middlewareCompleteness?.complete)
    },
    request_validation: {
      certified: certified.has("request_validation_facts"),
      required: required.has("request_validation_facts"),
      missing: missing.has("request_validation_facts"),
      can_block: Boolean(requestValidationCompleteness?.can_block),
      complete: Boolean(requestValidationCompleteness?.complete)
    },
    session_trust: {
      certified: certified.has("session_trust"),
      required: required.has("session_trust"),
      missing: missing.has("session_trust"),
      can_block: Boolean(sessionTrustCompleteness?.can_block),
      complete: Boolean(sessionTrustCompleteness?.complete)
    },
    authorization: {
      certified: certified.has("authorization"),
      required: required.has("authorization"),
      missing: missing.has("authorization"),
      can_block: Boolean(authorizationCompleteness?.can_block),
      complete: Boolean(authorizationCompleteness?.complete)
    },
    tenant_scope: {
      certified: certified.has("tenant_scope"),
      required: required.has("tenant_scope"),
      missing: missing.has("tenant_scope"),
      can_block: Boolean(tenantScopeCompleteness?.can_block),
      complete: Boolean(tenantScopeCompleteness?.complete)
    }
  };
}

export function readinessForStoredScan(
  storage: SqliteDriftStorage,
  repoId: string,
  scanId: string | null,
  surface: DriftReadinessSurface,
  parserGaps: ParserGap[] = scanId ? storage.listParserGaps(repoId, scanId) : []
) {
  const graphAvailable = Boolean(scanId && storage.getFactGraphArtifact(repoId, scanId));
  return buildReadiness({
    repo_id: repoId,
    scan_id: scanId,
    surface,
    graph_available: graphAvailable,
    graph_complete: graphAvailable,
    parser_gaps: parserGaps,
    completeness_reasons: graphAvailable ? [] : ["graph_missing"],
    required_capabilities: ["fact_graph"],
    missing_capabilities: graphAvailable ? [] : ["fact_graph"]
  });
}

export function parserGapsFromDiagnostics(input: {
  repoId: string;
  scanId: string;
  diagnostics: Array<{ code: string; message: string; file_path?: string; evidence_id?: string }>;
  createdAt: string;
}): ParserGap[] {
  return input.diagnostics
    .map((diagnostic, index) => {
      const kind = parserGapKindForDiagnostic(diagnostic.code);
      if (!kind || !diagnostic.file_path) {
        return null;
      }
      return {
        schema_version: "drift.parser_gap.v1" as const,
        gap_id: `parser_gap_${hashStable(`${input.scanId}:${diagnostic.code}:${diagnostic.file_path}:${index}`).slice(0, 16)}`,
        repo_id: input.repoId,
        scan_id: input.scanId,
        kind,
        file_path: diagnostic.file_path,
        start_line: 1,
        end_line: 1,
        confidence_impact: parserGapImpact(kind),
        message: diagnostic.message,
        evidence_refs: diagnostic.evidence_id ? [diagnostic.evidence_id] : [],
        created_at: input.createdAt
      };
    })
    .filter((gap): gap is ParserGap => Boolean(gap));
}

export function parserGapSummary(gaps: ParserGap[]): {
  total_count: number;
  by_kind: Record<ParserGapKind, number>;
  confidence_impact: Record<ParserGapConfidenceImpact, number>;
} {
  return {
    total_count: gaps.length,
    by_kind: countBy(gaps.map((gap) => gap.kind)) as Record<ParserGapKind, number>,
    confidence_impact: countBy(gaps.map((gap) => gap.confidence_impact)) as Record<ParserGapConfidenceImpact, number>
  };
}

function scanCapabilityReportForScan(input: {
  repoId: string;
  scanId: string;
  scan: ScanManifest;
  scanData: ScanData;
  graphArtifact: FactGraphArtifact;
  parserGaps: ParserGap[];
  createdAt: string;
}): ScanCapabilityReport {
  const graphRequiredCapabilities = sortedUniqueStrings(input.graphArtifact.graph.completeness.flatMap((entry) =>
    entry.required_capabilities
  ));
  const graphMissingCapabilities = sortedUniqueStrings(input.graphArtifact.graph.completeness.flatMap((entry) =>
    entry.missing_capabilities
  ));
  const adapterCapabilities = sortedUniqueStrings(input.graphArtifact.graph.adapters.flatMap((adapter) =>
    adapter.capabilities
  ));
  const statsCapabilities = input.scanData.stats?.capabilities;

  return {
    schema_version: "drift.scan_capability_report.v1",
    repo_id: input.repoId,
    scan_id: input.scanId,
    engine_source: input.scanData.engineSource,
    engine_version: null,
    scanner_version: input.scan.scanner_version,
    adapter_versions: input.scan.adapter_versions,
    certified_capabilities: sortedUniqueStrings(statsCapabilities?.certified ?? adapterCapabilities),
    required_capabilities: sortedUniqueStrings(statsCapabilities?.required ?? graphRequiredCapabilities),
    missing_capabilities: sortedUniqueStrings([
      ...(statsCapabilities?.missing ?? graphMissingCapabilities),
      ...(input.scanData.fallbackStatus.fallback_used ? input.scanData.fallbackStatus.degraded_capabilities : [])
    ]),
    completeness: input.graphArtifact.graph.completeness.map((entry) => ({
      scope: entry.scope,
      ...(entry.rule_id ? { rule_id: entry.rule_id } : {}),
      complete: entry.complete,
      can_block: entry.can_block,
      reasons: sortedUniqueStrings([
        ...entry.reasons,
        ...(entry.truncated ? ["truncated"] : [])
      ])
    })),
    parser_gap_count: input.parserGaps.length,
    parser_gap_kinds: countBy(input.parserGaps.map((gap) => gap.kind)) as Record<string, number>,
    fallback_used: input.scanData.fallbackStatus.fallback_used,
    enforcement_degraded: input.scanData.fallbackStatus.enforcement_degraded,
    created_at: input.createdAt
  };
}

function parserGapKindForDiagnostic(code: string): ParserGapKind | null {
  switch (code) {
    case "unresolved_import":
      return "unresolved_import";
    case "unresolved_import_symbol":
      return "unresolved_symbol";
    case "unsupported_namespace_import_symbol":
      return "unsupported_framework_pattern";
    case "typescript_fallback_used":
    case "broken_symlink":
    case "symlink_target_unreadable":
    case "file_too_large":
    case "unsupported_dynamic_middleware_matcher":
      return "partial_parse";
    default:
      return null;
  }
}

function parserGapImpact(kind: ParserGapKind): ParserGapConfidenceImpact {
  switch (kind) {
    case "unresolved_import":
    case "unresolved_symbol":
    case "dynamic_import_unresolved":
      return "lowers_flow";
    case "parser_error":
    case "partial_parse":
      return "blocks_enforcement";
    case "unknown_file_role":
    case "mixed_file_role":
      return "lowers_file";
    default:
      return "none";
  }
}

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) as Partial<Record<T, number>>;
}

function sortedUniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function scanStatusSummary(options: {
  latestScanId: string | null;
  scanCount: number;
  indexedFileCount: number;
  sourceChangeCount: number;
  stale: boolean;
  invalidationCount: number;
  auditValid: boolean;
}): {
  latest_scan_id: string | null;
  scan_count: number;
  indexed_file_count: number;
  source_change_count: number;
  stale: boolean;
  invalidation_count: number;
  audit_valid: boolean;
} {
  return {
    latest_scan_id: options.latestScanId,
    scan_count: options.scanCount,
    indexed_file_count: options.indexedFileCount,
    source_change_count: options.sourceChangeCount,
    stale: options.stale,
    invalidation_count: options.invalidationCount,
    audit_valid: options.auditValid
  };
}

export function scanStatusNextCommands(repoId: string, repoRoot: string, stale: boolean): string[] {
  return stale
    ? [
        `drift scan --repo-root ${repoRoot} --json`,
        `drift doctor --repo-root ${repoRoot} --json`
      ]
    : [
        `drift prepare "task" --repo ${repoId} --json`,
        `drift repo map --repo ${repoId} --json`,
        `drift audit verify --repo ${repoId} --json`
      ];
}

export function auditIntegritySummary(storage: SqliteDriftStorage, repoId: string): AuditChainVerification {
  return storage.verifyAuditChain(repoId);
}

export function freshnessRequirement(
  required: boolean,
  scanStatus: ReturnType<typeof scanStatusPayload>
): {
  required: boolean;
  satisfied: boolean;
  next_command: string;
  invalidation_reasons: string[];
} {
  return {
    required,
    satisfied: !scanStatus.stale,
    next_command: scanStatus.next_command,
    invalidation_reasons: scanStatus.invalidation_reasons
  };
}

export function assertFreshScanIfRequired(
  repoId: string,
  scanStatus: ReturnType<typeof scanStatusPayload>,
  required: boolean
): void {
  if (!required || !scanStatus.stale) {
    return;
  }
  throw new Error(
    `Scan is stale for ${repoId}. Run ${scanStatus.next_command}; omit --require-fresh to inspect stale context.`
  );
}

export function latestIndexedScan(scans: ScanManifest[]): ScanManifest | undefined {
  return scans.find((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_check_")
  ) ?? scans.find((scan) => scan.status === "completed") ?? scans[0];
}

export function compareSnapshotsToCurrentFiles(
  repoRoot: string,
  snapshots: FileSnapshot[]
): ScanStatusChangeSet {
  const previous = new Map(snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const currentFiles = walkIndexableFiles(repoRoot);
  const current = new Set(currentFiles);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const filePath of currentFiles) {
    const snapshot = previous.get(filePath);
    if (!snapshot) {
      added.push(filePath);
      continue;
    }

    const currentHash = fileContentHash(join(repoRoot, filePath));
    if (currentHash !== snapshot.content_hash) {
      modified.push(filePath);
    }
  }

  for (const filePath of previous.keys()) {
    if (!current.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort()
  };
}

export function scanInvalidationReasons(
  scan: ScanManifest,
  input: { currentBranch?: string; currentResolverInputFingerprint?: string } = {}
): string[] {
  const reasons: string[] = [];
  if (input.currentBranch && scan.branch !== input.currentBranch) {
    reasons.push("branch_changed");
  }
  if (scan.scanner_version !== DRIFT_SCANNER_VERSION) {
    reasons.push("scanner_version_changed");
  }
  if (scan.adapter_versions.typescript !== DRIFT_TYPESCRIPT_ADAPTER_VERSION) {
    reasons.push("adapter_version_changed:typescript");
  }
  if (scan.adapter_versions.resolver && scan.adapter_versions.resolver !== DRIFT_RESOLVER_VERSION) {
    reasons.push("resolver_version_changed");
  }
  if (
    scan.adapter_versions.resolver_inputs &&
    input.currentResolverInputFingerprint &&
    scan.adapter_versions.resolver_inputs !== input.currentResolverInputFingerprint
  ) {
    reasons.push("resolver_inputs_changed");
  }
  if (
    scan.adapter_versions.resolver &&
    scan.adapter_versions.resolver === DRIFT_RESOLVER_VERSION &&
    input.currentResolverInputFingerprint &&
    !scan.adapter_versions.resolver_inputs
  ) {
    reasons.push("resolver_inputs_missing");
  }
  if (scan.rule_engine_version !== DRIFT_RULE_ENGINE_VERSION) {
    reasons.push("rule_engine_version_changed");
  }
  return reasons;
}

export function resolverInputFingerprint(repoRoot: string): string {
  const inputs = resolverInputPaths(repoRoot)
    .map((path) => [path, fileContentHash(join(repoRoot, path))])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return hashStable(JSON.stringify(inputs));
}

function resolverInputPaths(repoRoot: string): string[] {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return [];
  }
  const paths: string[] = [];
  collectResolverInputPaths(repoRoot, "", paths, 0);
  return paths.sort();
}

function collectResolverInputPaths(
  repoRoot: string,
  relativeDir: string,
  paths: string[],
  depth: number
): void {
  if (depth > 4) {
    return;
  }
  const absoluteDir = join(repoRoot, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".npmrc") {
      continue;
    }
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", "coverage", ".next", "target", "vendor"].includes(entry.name)) {
        continue;
      }
      collectResolverInputPaths(repoRoot, relativePath, paths, depth + 1);
      continue;
    }
    if (!entry.isFile() || !isResolverInputPath(relativePath)) {
      continue;
    }
    paths.push(relativePath);
  }
}

function isResolverInputPath(filePath: string): boolean {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  return fileName === "package.json" ||
    fileName === "jsconfig.json" ||
    /^tsconfig(?:\.[^.]+)?\.json$/.test(fileName);
}
