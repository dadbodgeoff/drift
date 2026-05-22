import { type AuditChainVerification,type ConventionCandidate,DRIFT_RESOLVER_VERSION,DRIFT_RULE_ENGINE_VERSION,DRIFT_SCANNER_VERSION,DRIFT_TYPESCRIPT_ADAPTER_VERSION,type FileSnapshot,type RepoRecord,type ScanFileChange,type ScanManifest } from "@drift/core";
import { buildFactGraphArtifactFromParts } from "@drift/factgraph";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,readdirSync,statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectScanData } from "../engine/collect-scan-data.js";
import { inferConventionCandidatesFromEngine } from "../engine/engine-candidates.js";
import { buildFactGraphArtifact } from "../engine/fact-graph.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { fileContentHash } from "../io/file-hash.js";
import { gitOutput } from "../io/git.js";
import { inferConventionCandidates } from "./convention-candidates.js";
import { auditEvent,preflightGovernance } from "./governance.js";
import { hashStable,scanFingerprint } from "./identifiers.js";
import { repoRecordForRoot } from "./repo-paths.js";

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
    const scanData = await collectScanData({ repoId: repo.id, scanId, repoRoot });
    const candidates = scanData.engineSource === "rust"
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
        resolver_inputs: resolverInputFingerprint(repoRoot)
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

    storage.transaction(() => {
      storage.upsertScanManifest(scan);
      for (const snapshot of scanData.snapshots) {
        storage.upsertFileSnapshot(snapshot);
      }
      storage.upsertScanFileChanges(scanFileChanges);
      storage.upsertFacts(scanData.facts);
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
          incremental_changes: incrementalChanges
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
        incremental_changes: incrementalChanges
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
  const payload = {
    repo_id: repoId,
    repo_root: repo.root_path,
    current_branch: currentBranch,
    latest_scan: latestScan,
    scan_fingerprint: scanFingerprint(latestScan, snapshots),
    indexed_file_count: latestScan.file_count,
    source_change_count: sourceChangeCount,
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
    next_command: nextCommands[0],
    next_commands: nextCommands
  };
  return payload;
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
