import { type AuditChainVerification,type ConventionCandidate,DRIFT_RESOLVER_VERSION,DRIFT_RULE_ENGINE_VERSION,DRIFT_SCANNER_VERSION,DRIFT_TYPESCRIPT_ADAPTER_VERSION,type FileSnapshot,type ParserGap,type ParserGapConfidenceImpact,type ParserGapKind,type ParserGapV2,type RepoRecord,type ScanCapabilityReport,type ScanFileChange,type ScanManifest } from "@drift/core";
import { buildFactGraphArtifactFromParts,type FactGraphArtifact,type GraphDiagnostic } from "@drift/factgraph";
import { buildParserGapQuality,buildParserGapSummary,buildSecurityPhase8ReadModel,buildStoredScanReadiness,type DriftReadinessSurface,buildParserGapSection} from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,mkdtempSync,readdirSync,rmSync,statSync,writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectScanData,type ScanData } from "../engine/collect-scan-data.js";
import { ENGINE_PAYLOAD_MAX_BYTES,enginePayloadExceedsCeiling,enginePayloadMegabytes } from "../engine/engine-payload-limits.js";
import { DriftError } from "../app/drift-error.js";
import { checkDiskSpace } from "./disk-space.js";
import { inferConventionCandidatesFromEngine } from "../engine/engine-candidates.js";
import { buildFactGraphArtifact } from "../engine/fact-graph.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { fileContentHash } from "../io/file-hash.js";
import { gitOutput,workingTreeChangedFiles } from "../io/git.js";
import { writeJsonFileStreamed } from "../io/write-json-stream.js";
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
  const previousScan = latestIndexedScan(storage.listScanManifests(repo.id));

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
    assertEnginePayloadWithinCeiling(scanData.enginePayloadBytes, repoRoot);
    const inferredCandidates = scanData.engineSource === "rust"
      ? await inferConventionCandidatesFromEngine({
          repoId: repo.id,
          scanId,
          scanData,
          now,
          // E-6 (D-2): the scan sees the working tree, so a dirty tree's own new
          // violations would otherwise count toward the coverage direction and argue
          // the convention down. Direction must come from the baseline only.
          diffChangedFiles: workingTreeChangedFiles(repoRoot)
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
        resolver_inputs: currentResolverInputFingerprint,
        // Persisted so incremental reuse can tell whether stored facts came from this engine.
        ...(scanData.engineVersion ? { engine: scanData.engineVersion } : {})
      },
      rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
      status: "completed",
      // Files whose CONTENTS were read, not files recorded. Declaration files are snapshotted for
      // their path and hash without being parsed (`indexed: false`), and counting them here would
      // report "scanned 3 files" for a scan that examined 2 - the same overstatement BB-1's
      // "Checked N files" exists to prevent, one layer up.
      file_count: scanData.snapshots.filter((snapshot) => snapshot.indexed).length,
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
        // EW-3: the engine's diagnostics, persisted with the graph.
        //
        // They were never passed, so `graph_diagnostics` was empty for every scan and the only
        // stored record of a coverage gap was the lossy `parser_gaps` projection - which keeps a
        // mapped `kind` but drops the diagnostic code and the specifier. Doctor cannot report what
        // the resolver could not place from that, and `drift doctor` is the surface a stranger on
        // an unsupported stack consults first.
        diagnostics: scanData.graph_diagnostics.map(graphDiagnosticRecord),
        adapters: [{
          id: "typescript",
          version: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
          deterministic: true,
          capabilities: ["file_discovery", "syntax_facts", "graph_stream"]
        }],
        // Carry the engine's measurement rather than letting the factgraph substitute its
        // default, so a scan that skipped files reports incomplete to the user (A4/T11b).
        ...(scanData.completeness ? { completeness: scanData.completeness } : {}),
        createdAt: now
      })
      : buildFactGraphArtifact({
        repoId: repo.id,
        scanId,
        snapshots: scanData.snapshots,
        facts: scanData.facts,
        createdAt: now,
        pathAliases: readTsconfigPathAliases(repoRoot),
        ...(scanData.completeness ? { completeness: scanData.completeness } : {}),
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
      storage.upsertFrameworkScanData({
        repoId: repo.id,
        scanId,
        adapters: scanData.framework_adapters,
        entrypoints: scanData.normalized_entrypoints,
        parserGaps: scanData.framework_parser_gaps,
        capabilities: scanData.framework_capabilities
      });
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

    // T110: drop scans nothing needs, after the new one is safely committed.
    //
    // Outside the transaction deliberately. Pruning is housekeeping, and a failure to reclaim
    // space must never roll back a scan that succeeded - the worst case is a larger database,
    // which the next scan will tidy.
    // EW-8: hand `availableBytes` in, so a database created before incremental vacuum can take its
    // one-time upgrade when there is provably room for the full VACUUM that needs - and decline with
    // a reason when there is not, rather than silently never shrinking.
    const pruned = storage.pruneSupersededScans(repo.id, {
      availableBytes: pruneAvailableBytes(input.databasePath)
    });
    if (pruned.deleted.length > 0) {
      storage.appendAuditEvent(auditEvent({
        id: `audit_event_scans_pruned_${repo.id}_${scanId}`,
        repoId: repo.id,
        actor,
        action: "scans_pruned",
        targetType: "repo",
        targetId: repo.id,
        metadata: {
          pruned_scan_ids: pruned.deleted,
          retained_scan_count: pruned.kept,
          // EW-8: what the prune returned to the OS, and why nothing came back when nothing did.
          reclaimed_bytes: pruned.reclaimed_bytes,
          reclaim_performed: pruned.reclaim_performed,
          ...(pruned.reclaim_declined_reason
            ? { reclaim_declined_reason: pruned.reclaim_declined_reason }
            : {})
        },
        createdAt: now
      }));
    }

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

/**
 * T-01: refuse a repo whose engine payload cannot survive the trip back to the engine.
 *
 * Placed immediately before `inferConventionCandidatesFromEngine`, which is the throw site:
 * it re-serializes the entire graph and fact set into one `JSON.stringify`, at 6.8-7.8x the
 * engine payload, against a `MAX_STRING_LENGTH` of 536,870,888. Above the ceiling that string
 * cannot be built, and the only question is whether the user is told that or handed
 * `Invalid string length` and a partial database.
 *
 * Nothing has been written to the database at this point, and the refusal marks itself as
 * discarding state this invocation created, so a fresh onboarding leaves nothing behind.
 */
function assertEnginePayloadWithinCeiling(payloadBytes: number | undefined, repoRoot: string): void {
  if (payloadBytes === undefined || !enginePayloadExceedsCeiling(payloadBytes)) {
    return;
  }
  const measured = enginePayloadMegabytes(payloadBytes);
  const ceiling = enginePayloadMegabytes(ENGINE_PAYLOAD_MAX_BYTES);
  throw new DriftError(
    `Drift engine payload for ${repoRoot} is ${measured} MB, above the ${ceiling} MB this release supports. ` +
      "Onboarding re-serializes the whole graph to infer conventions, and above this size that " +
      "exceeds Node's maximum string length - so Drift refuses rather than failing partway through " +
      "and leaving unusable state. This repo is larger than the supported envelope; nothing is " +
      "claimed about it.",
    {
      code: "engine_payload_too_large",
      userAction:
        "Onboard a smaller subtree with --repo-root, or track the size limit's removal before retrying this repo.",
      recoveryCommands: [`drift start --repo-root ${repoRoot}/<subdirectory> --accept-defaults --json`],
      // The same invocation on the same tree produces the same measurement.
      safeToRetry: false,
      discardsCreatedState: true
    }
  );
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

/**
 * Free space on the volume holding the database, for the EW-8 one-time reclaim decision.
 *
 * `undefined` when it cannot be measured, which the storage layer reads as "do not attempt the
 * upgrade" - an unmeasurable disk is not an empty one, and guessing here is how a housekeeping step
 * becomes the disk-exhaustion failure it exists to prevent.
 */
function pruneAvailableBytes(databasePath: string): number | undefined {
  const report = checkDiskSpace(databasePath);
  return Number.isFinite(report.availableBytes) ? report.availableBytes : undefined;
}

export function createScanReuseManifest(input: {
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
  // T-02: streamed rather than stringified. This grows with the PREVIOUS scan's facts, so it was
  // 10,793,116 chars on a papermark rescan and scales the same way the graph does. It appears only
  // on the reuse path, which is why the T-02 plan's site list does not mention it.
  writeJsonFileStreamed(path, {
    schema_version: "engine.reuse_manifest.v1",
    previous_scan_id: input.previousScan.id,
    // The engine that produced these facts. The engine refuses to reuse facts written by a
    // different version, because reuse is otherwise keyed only on file content - which
    // assumes a file always yields the same facts. Every extraction change breaks that
    // assumption, so without this an upgrade would silently keep stale facts for every
    // unchanged file.
    engine_version: input.previousScan.adapter_versions?.engine ?? null,
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
      // EW-1: without this, a reused import fact arrives at the engine with no runtime-use
      // proof, so `unresolved_import_symbol` fires on files a fresh scan reports clean - and
      // one of those on a route refuses the whole check.
      ...(fact.runtime_use ? { runtime_use: fact.runtime_use } : {}),
      start_line: fact.start_line,
      end_line: fact.end_line,
      // EW-6 (DET-1): the columns, or a reused file re-collapses two occurrences on one line into
      // one. Measured on a repo with four identical calls across two lines: a fresh scan stored 46
      // facts, the same repo rescanned through reuse stored 40 - the reuse path was the second
      // counting path all along, and it was quietly reintroducing the very drop this fixes.
      start_column: fact.source_span?.start_column ?? 1,
      end_column: fact.source_span?.end_column ?? 1
    }))
  });
  return { path, dir, blocked_reasons: [] };
}

export function cleanupScanReuseManifest(manifest: { dir: string } | null): void {
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
    const readiness = buildStoredScanReadiness({
      repo_id: repoId,
      scan_id: null,
      surface: "scan_status",
      graph_available: false,
      parser_gaps: []
    });
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
      parser_gaps: buildParserGapSection([]),
      parser_gap_quality: buildParserGapQuality({
        repo_id: repoId,
        scan_id: null,
        surface: "scan_status",
        parser_gaps: [],
        readiness
      }),
      security_capabilities: [],
      readiness,
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
  const parserGapV2 = storage.listParserGapV2(repoId, latestScan.id);
  const allParserGaps = [...parserGaps, ...parserGapV2];
  const readiness = readinessForStoredScan(storage, repoId, latestScan.id, "scan_status", allParserGaps);
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
    /**
     * EW-6 (DET-1): the number of facts actually stored, beside the manifest's emission count.
     *
     * Determinism is the marketed claim, and it was not externally checkable: the manifest recorded
     * what the engine emitted while the facts table recorded what survived, and a fact dropped
     * between the two (identical occurrences on one line collapsing to one id) made them disagree
     * with nothing to compare. Exposing both makes the claim auditable from outside the process,
     * which is the only kind of auditable that matters for a claim like this.
     */
    stored_fact_count: storage.listFacts(latestScan.id).length,
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
    parser_gaps: buildParserGapSection(allParserGaps),
    parser_gap_quality: buildParserGapQuality({
      repo_id: repoId,
      scan_id: latestScan.id,
      surface: "scan_status",
      parser_gaps: allParserGaps,
      readiness
    }),
    readiness,
    capability_report: capabilityReport,
    security_capabilities: proofs.length > 0 ||
      legacyScanProofRuns.length > 0 ||
      securityReadModel.repo_security_contracts.length > 0
      ? securityReadModel.security_capabilities
      : [],
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
  parserGaps: Array<ParserGap | ParserGapV2> = scanId
    ? [...storage.listParserGaps(repoId, scanId), ...storage.listParserGapV2(repoId, scanId)]
    : []
) {
  const graphAvailable = Boolean(scanId && storage.getFactGraphArtifact(repoId, scanId));
  return buildStoredScanReadiness({
    repo_id: repoId,
    scan_id: scanId,
    surface,
    graph_available: graphAvailable,
    parser_gaps: parserGaps
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
    // BB-2: recorded per scan so a stored measurement can be told apart from one taken through a
    // debug `cargo run` engine. MCP's `capability_report` carries this surface verbatim, which is
    // what gives get_scan_status and get_task_preflight parity without a second assembly site.
    engine_resolution: input.scanData.fallbackStatus.engine_resolution,
    engine_build_profile: input.scanData.fallbackStatus.engine_build_profile,
    created_at: input.createdAt
  };
}

/**
 * Which parser-gap kind a diagnostic code becomes, or `null` when it becomes none.
 *
 * Exported for the EW-3 coverage report, which has to bucket diagnostics by code while
 * reconciling its totals against the `parser_gap` rows this function decides. Two copies of
 * this mapping would let the report and the stored gaps disagree, which is precisely the
 * failure the report's `reconciles` flag exists to catch.
 */
/**
 * An engine diagnostic as a storable graph diagnostic.
 *
 * The engine emits no id - it streams diagnostics, it does not address them - so one is derived
 * from the content plus the ordinal. Content alone would collide for two identical diagnostics on
 * one file (the same unresolved specifier imported twice), and the ordinal alone would not be
 * stable across runs; together they are deterministic for a given scan, which the determinism
 * digests require.
 */
function graphDiagnosticRecord(
  diagnostic: { severity: string; code: string; message: string; file_path?: string; import_source?: string },
  index: number
): GraphDiagnostic {
  return {
    id: `graph_diagnostic_${hashStable(`${diagnostic.code}:${diagnostic.file_path ?? ""}:${diagnostic.import_source ?? ""}:${index}`).slice(0, 16)}`,
    severity: diagnostic.severity as GraphDiagnostic["severity"],
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.file_path ? { file_path: diagnostic.file_path } : {}),
    ...(diagnostic.import_source ? { import_source: diagnostic.import_source } : {}),
    evidence_ids: []
  };
}

export function parserGapKindForDiagnostic(code: string): ParserGapKind | null {
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
    // D-PA1. `partial_parse` has been a declared gap kind of `ts.syntax_facts.v1` since that
    // registry was written, and nothing could ever produce one: no code path in the engine
    // inspected `tree.root_node().has_error()`. The engine emits it now - 129 files across the
    // seven corpus repos - so the declaration is true for the first time.
    case "partial_parse":
      return "partial_parse";
    // D-PA3. The five distinct outcomes of the engine's one file-skip arm. They shared the code
    // `file_unreadable` and were told apart only by free text, so none of them reached this
    // taxonomy at all. A file that was not parsed is a parser error whichever way it failed; what
    // differs is what the reader should do about it, and that lives in the limitations map in
    // import-coverage.ts, which is keyed on exactly these codes.
    case "file_unreadable":
    case "file_not_utf8":
    case "file_too_deep":
    case "file_parse_failed":
    case "parser_language_unavailable":
      return "parser_error";
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
  return safeVerifyAuditChain(storage, repoId);
}

/**
 * T-08: verify the audit chain without letting malformed rows escape as a crash.
 *
 * `verifyAuditChain` parses each row, so a row whose `action` is outside the enum throws a raw Zod
 * error. Measured: that exits 1 with an unparseable stack trace, while the tampers the hash chain
 * is actually designed to catch - an edited field, a deleted event - returned `valid: false` and
 * exited 0. Detection was silent and malformed data was loud, which is exactly backwards.
 *
 * A row that does not satisfy the schema did not get there by accident. It is reported as a
 * verification failure with reason `schema_invalid`, so every kind of tampering produces the same
 * shape of answer and the caller decides the exit code once.
 *
 * Shared by `audit verify`, `audit list` and `scan status`, all of which read this chain and all of
 * which would otherwise crash on the same row.
 */
export function safeVerifyAuditChain(
  storage: SqliteDriftStorage,
  repoId: string,
  options: { strict?: boolean } = {}
): AuditChainVerification {
  try {
    return storage.verifyAuditChain(repoId, options);
  } catch {
    return {
      repo_id: repoId,
      valid: false,
      strict: Boolean(options.strict),
      event_count: 0,
      verified_count: 0,
      head_sequence: 0,
      head_event_hash: null,
      broken_at_event_id: null,
      reasons: ["schema_invalid"]
    };
  }
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
  // A stale scan under --require-fresh is a fail-closed refusal, which the exit-code contract
  // (run-check.ts) codes 3. This threw a plain Error, so `prepare`, `ask`, `policy`, `findings` and
  // `repo map` all exited 1 - the code reserved for "drift itself broke" - for a refusal Drift made
  // deliberately and correctly. A caller distinguishing the two got the wrong answer.
  throw new DriftError(
    `Scan is stale for ${repoId}. Run ${scanStatus.next_command}; omit --require-fresh to inspect stale context.`,
    {
      code: "stale_scan",
      userAction: `Run ${scanStatus.next_command}, or omit --require-fresh to inspect stale context.`,
      recoveryCommands: scanStatus.next_command ? [scanStatus.next_command] : [],
      // docs/reference/errors.md already lists stale_scan as retryable after a rescan.
      safeToRetry: true
    }
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
