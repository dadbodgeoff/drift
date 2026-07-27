import type { RepoRecord } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync } from "node:fs";
import { ScanStatusChangeSet,compareSnapshotsToCurrentFiles } from "./scan-status.js";

export interface RestoreStaleness {
  graph_stale: boolean;
  source_changes: ScanStatusChangeSet;
  staleness_reason: "none" | "repo_root_missing" | "scan_missing";
}

export interface RestoreRescanGuidance {
  requires_rescan: boolean;
  next_command: string | null;
}

export type RestoreReviewPayload = {
  repo_id: string;
  restored_database_path: string;
  dry_run: boolean;
  write_intent: boolean;
  target_exists: boolean;
  would_require_force: boolean;
  checksum_matches?: boolean | null;
  graph_stale: boolean;
  requires_rescan: boolean;
  staleness_reason: string;
  confirm_command: string | null;
};

export function restoreIntent(restore: RestoreReviewPayload): {
  dry_run: boolean;
  write_intent: boolean;
  target_exists: boolean;
  would_require_force: boolean;
  graph_stale: boolean;
  requires_rescan: boolean;
  staleness_reason: string;
} {
  return {
    dry_run: restore.dry_run,
    write_intent: restore.write_intent,
    target_exists: restore.target_exists,
    would_require_force: restore.would_require_force,
    graph_stale: restore.graph_stale,
    requires_rescan: restore.requires_rescan,
    staleness_reason: restore.staleness_reason
  };
}

export function restoreSummary(restore: RestoreReviewPayload): {
  restored: boolean;
  dry_run: boolean;
  write_intent: boolean;
  target_exists: boolean;
  would_require_force: boolean;
  checksum_checked: boolean;
  checksum_matches: boolean | null;
  graph_stale: boolean;
  requires_rescan: boolean;
  staleness_reason: string;
} {
  return {
    restored: !restore.dry_run,
    dry_run: restore.dry_run,
    write_intent: restore.write_intent,
    target_exists: restore.target_exists,
    would_require_force: restore.would_require_force,
    checksum_checked: restore.checksum_matches !== null && restore.checksum_matches !== undefined,
    checksum_matches: restore.checksum_matches ?? null,
    graph_stale: restore.graph_stale,
    requires_rescan: restore.requires_rescan,
    staleness_reason: restore.staleness_reason
  };
}

export function restoreDryRunNextCommands(restore: RestoreReviewPayload): string[] {
  return restore.confirm_command ? [restore.confirm_command] : [];
}

export function restoreCompletedNextCommands(restore: RestoreReviewPayload): string[] {
  return [
    `drift --db ${restore.restored_database_path} scan status --repo ${restore.repo_id} --json`,
    `drift --db ${restore.restored_database_path} prepare "task" --repo ${restore.repo_id} --json`
  ];
}

export function restoreConfirmCommand(options: {
  targetDatabasePath: string;
  backupPath: string;
  repoId: string;
  checksum: string;
  force: boolean;
}): string {
  return [
    "drift",
    "--db", options.targetDatabasePath,
    "restore", options.backupPath,
    "--repo", options.repoId,
    "--checksum", options.checksum,
    "--confirm",
    options.force ? "--force" : ""
  ].filter(Boolean).join(" ");
}

export function restoreDryRunCommandForBackup(options: {
  backupPath: string;
  repoId: string;
  checksum: string;
}): string {
  return [
    "drift",
    "--db", "<target.sqlite>",
    "restore", options.backupPath,
    "--repo", options.repoId,
    "--checksum", options.checksum,
    "--dry-run"
  ].join(" ");
}

export function restoreStalenessForRepo(
  storage: SqliteDriftStorage,
  repoId: string
): RestoreStaleness {
  const emptyChanges = { added: [], modified: [], deleted: [] };
  const repo = storage.getRepo(repoId);
  if (!repo || !existsSync(repo.root_path)) {
    return {
      graph_stale: true,
      source_changes: emptyChanges,
      staleness_reason: "repo_root_missing"
    };
  }

  const latestScan = storage.listScanManifests(repoId).find((scan) => scan.status === "completed");
  if (!latestScan) {
    return {
      graph_stale: true,
      source_changes: emptyChanges,
      staleness_reason: "scan_missing"
    };
  }

  const sourceChanges = compareSnapshotsToCurrentFiles(
    repo.root_path,
    storage.listFileSnapshots(repoId, latestScan.id)
  );
  return {
    graph_stale: sourceChanges.added.length > 0 ||
      sourceChanges.modified.length > 0 ||
      sourceChanges.deleted.length > 0,
    source_changes: sourceChanges,
    staleness_reason: "none"
  };
}

export function restoreRescanGuidance(
  repo: RepoRecord,
  targetDatabasePath: string,
  staleness: RestoreStaleness
): RestoreRescanGuidance {
  if (!staleness.graph_stale) {
    return {
      requires_rescan: false,
      next_command: null
    };
  }
  return {
    requires_rescan: true,
    next_command: `drift --db ${targetDatabasePath} scan --repo-root ${repo.root_path} --json`
  };
}
