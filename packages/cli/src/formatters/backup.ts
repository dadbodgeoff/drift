import { BackupArtifactStatusFilter } from "../domain/backup-artifacts.js";

export function formatBackupCreatedText(manifest: {
  id: string;
  repo_id: string;
  backup_path: string;
  checksum_sha256: string;
  size_bytes: number;
  created_at: string;
}): string {
  return [
    "Drift backup created",
    "",
    `Backup: ${manifest.id}`,
    `Repo: ${manifest.repo_id}`,
    `Path: ${manifest.backup_path}`,
    `Checksum: ${manifest.checksum_sha256}`,
    `Size: ${manifest.size_bytes} bytes`,
    `Created: ${manifest.created_at}`,
    "",
    "Next commands:",
    `  Verify: drift backup verify ${manifest.backup_path} --repo ${manifest.repo_id} --checksum ${manifest.checksum_sha256}`,
    `  Restore dry-run: drift --db <target.sqlite> restore ${manifest.backup_path} --repo ${manifest.repo_id} --checksum ${manifest.checksum_sha256} --dry-run`,
    ""
  ].join("\n");
}

export function formatBackupListText(payload: {
  repo_id: string;
  total_count: number;
  filtered_count: number;
  count: number;
  filters: {
    artifact_status: BackupArtifactStatusFilter | null;
  };
  pagination: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  backups: Array<{
    id: string;
    backup_path: string;
    checksum_sha256: string;
    size_bytes: number;
    artifact_exists?: boolean;
    checksum_matches?: boolean | null;
    created_at: string;
  }>;
}): string {
  return [
    "Drift backups",
    "",
    `Repo: ${payload.repo_id}`,
    `Backups: ${payload.count}`,
    `Total: ${payload.total_count}`,
    `Filtered: ${payload.filtered_count}`,
    `Artifact status: ${payload.filters.artifact_status ?? "any"}`,
    `Page: offset ${payload.pagination.offset}, returned ${payload.pagination.returned_count}, next offset ${payload.pagination.next_offset ?? "none"}`,
    "",
    ...payload.backups.flatMap((backup) => [
      `${backup.created_at} ${backup.id}`,
      `Path: ${backup.backup_path}`,
      `Checksum: ${backup.checksum_sha256}`,
      `Size: ${backup.size_bytes} bytes`,
      `Artifact: ${backup.artifact_exists === false ? "missing" : backup.checksum_matches === false ? "checksum_mismatch" : "present"}`,
      `Verify: drift backup verify ${backup.backup_path} --repo ${payload.repo_id} --checksum ${backup.checksum_sha256}`,
      ""
    ]),
    ""
  ].join("\n");
}

export function formatBackupVerifyText(payload: {
  valid: boolean;
  repo_id: string;
  repo_fingerprint: string | null;
  backup_path: string;
  schema_version: number;
  schema_supported: boolean;
  checksum_sha256: string;
  checksum_matches: boolean | null;
  restore_dry_run_command: string;
  size_bytes: number;
  repo_found: boolean;
  summary?: {
    problem_count: number;
  };
}): string {
  return [
    "Drift backup verify",
    "",
    `Valid: ${payload.valid}`,
    `Repo: ${payload.repo_id}`,
    `Repo found: ${payload.repo_found}`,
    `Repo fingerprint: ${payload.repo_fingerprint ?? "unknown"}`,
    `Backup: ${payload.backup_path}`,
    `Schema version: ${payload.schema_version}`,
    `Schema supported: ${payload.schema_supported}`,
    `Checksum: ${payload.checksum_sha256}`,
    `Checksum matches: ${payload.checksum_matches ?? "not checked"}`,
    `Size: ${payload.size_bytes} bytes`,
    `Problems: ${payload.summary?.problem_count ?? (payload.valid ? 0 : 1)}`,
    "",
    "Next commands:",
    `  Restore dry-run: ${payload.restore_dry_run_command}`,
    ""
  ].join("\n");
}
