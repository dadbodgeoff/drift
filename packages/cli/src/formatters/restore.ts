import { restoreConfirmCommand,restoreSummary } from "../domain/restore-review.js";
import { ScanStatusChangeSet } from "../domain/scan-status.js";

export function formatRestoreText(restore: {
  id: string;
  repo_id: string;
  backup_path: string;
  restored_database_path: string;
  checksum_sha256: string;
  checksum_matches?: boolean | null;
  schema_version: number;
  graph_stale?: boolean;
  source_changes?: ScanStatusChangeSet;
  staleness_reason?: string;
  requires_rescan?: boolean;
  next_command?: string | null;
  dry_run?: boolean;
  write_intent?: boolean;
  target_exists?: boolean;
  would_require_force?: boolean;
  confirm_command?: string | null;
  restored_at: string | null;
}): string {
  const summary = restoreSummary({
    repo_id: restore.repo_id,
    restored_database_path: restore.restored_database_path,
    dry_run: restore.dry_run ?? false,
    write_intent: restore.write_intent ?? !restore.dry_run,
    target_exists: restore.target_exists ?? false,
    would_require_force: restore.would_require_force ?? false,
    checksum_matches: restore.checksum_matches ?? null,
    graph_stale: restore.graph_stale ?? false,
    requires_rescan: restore.requires_rescan ?? false,
    staleness_reason: restore.staleness_reason ?? "unknown",
    confirm_command: restore.confirm_command ?? null
  });
  return [
    restore.dry_run ? "Drift restore validated" : "Drift restore completed",
    "",
    `Restore: ${restore.id}`,
    `Repo: ${restore.repo_id}`,
    `Backup: ${restore.backup_path}`,
    `Database: ${restore.restored_database_path}`,
    `Schema version: ${restore.schema_version}`,
    `Checksum: ${restore.checksum_sha256}`,
    `Checksum matches: ${restore.checksum_matches ?? "not checked"}`,
    `Graph stale: ${restore.graph_stale ?? "unknown"}`,
    restore.source_changes
      ? `Source changes: +${restore.source_changes.added.length} ~${restore.source_changes.modified.length} -${restore.source_changes.deleted.length}`
      : "Source changes: unknown",
    restore.staleness_reason ? `Staleness reason: ${restore.staleness_reason}` : "",
    `Requires rescan: ${restore.requires_rescan ?? "unknown"}`,
    restore.next_command ? `Next command: ${restore.next_command}` : "",
    `Restored: ${summary.restored}`,
    `Checksum checked: ${summary.checksum_checked}`,
    `Write intent: ${restore.write_intent ?? !restore.dry_run}`,
    restore.dry_run
      ? [
          "Confirm restore:",
          `  ${restore.confirm_command ?? restoreConfirmCommand({
            targetDatabasePath: restore.restored_database_path,
            backupPath: restore.backup_path,
            repoId: restore.repo_id,
            checksum: restore.checksum_sha256,
            force: false
          })}`
        ].join("\n")
      : "",
    restore.dry_run ? "Dry run: true" : `Restored: ${restore.restored_at}`,
    ""
  ].filter((line) => line !== "").join("\n");
}
