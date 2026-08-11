import type { BackupManifest } from "@drift/core";
import { existsSync,statSync } from "node:fs";
import { fileContentHash } from "../io/file-hash.js";
import { restoreDryRunCommandForBackup } from "./restore-review.js";

export type BackupManifestWithStatus = BackupManifest & {
  artifact_exists?: boolean;
  checksum_matches?: boolean | null;
};

export type BackupArtifactStatusFilter = "present" | "missing" | "checksum_mismatch";

export function backupManifestWithArtifactStatus(backup: BackupManifest): BackupManifestWithStatus {
  const artifactExists = existsSync(backup.backup_path) && statSync(backup.backup_path).isFile();
  return {
    ...backup,
    artifact_exists: artifactExists,
    checksum_matches: artifactExists
      ? fileContentHash(backup.backup_path) === backup.checksum_sha256
      : null
  };
}

export function orderBackupsForReview(backups: BackupManifestWithStatus[]): BackupManifestWithStatus[] {
  return [...backups].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

export function paginateBackups(
  backups: BackupManifestWithStatus[],
  limit: number | undefined,
  offset: number
): BackupManifestWithStatus[] {
  return limit === undefined
    ? backups.slice(offset)
    : backups.slice(offset, offset + limit);
}

export function backupMatchesArtifactStatus(
  backup: BackupManifestWithStatus,
  status: BackupArtifactStatusFilter | undefined
): boolean {
  if (!status) {
    return true;
  }
  if (status === "present") {
    return backup.artifact_exists === true;
  }
  if (status === "missing") {
    return backup.artifact_exists === false;
  }
  return backup.checksum_matches === false;
}

export function backupManifestSummary(manifest: BackupManifestWithStatus, writeIntent: boolean): {
  write_intent: boolean;
  artifact_exists: boolean;
  schema_version: number;
  size_bytes: number;
  checksum_sha256: string;
} {
  return {
    write_intent: writeIntent,
    artifact_exists: manifest.artifact_exists ?? existsSync(manifest.backup_path),
    schema_version: manifest.schema_version,
    size_bytes: manifest.size_bytes,
    checksum_sha256: manifest.checksum_sha256
  };
}

export function backupListSummary(
  allBackups: BackupManifestWithStatus[],
  filteredBackups: BackupManifestWithStatus[],
  listedBackups: BackupManifestWithStatus[]
): {
  total_count: number;
  filtered_count: number;
  listed_count: number;
  present_count: number;
  missing_count: number;
  checksum_mismatch_count: number;
  latest_backup_id: string | null;
  latest_backup_path: string | null;
  problem_count: number;
} {
  const missingCount = allBackups.filter((backup) => backup.artifact_exists === false).length;
  const checksumMismatchCount = allBackups.filter((backup) => backup.checksum_matches === false).length;
  const latestBackup = [...allBackups].sort((left, right) =>
    right.created_at.localeCompare(left.created_at) ||
    right.id.localeCompare(left.id)
  )[0];
  return {
    total_count: allBackups.length,
    filtered_count: filteredBackups.length,
    listed_count: listedBackups.length,
    present_count: allBackups.filter((backup) => backup.artifact_exists === true).length,
    missing_count: missingCount,
    checksum_mismatch_count: checksumMismatchCount,
    latest_backup_id: latestBackup?.id ?? null,
    latest_backup_path: latestBackup?.backup_path ?? null,
    problem_count: missingCount + checksumMismatchCount
  };
}

export function backupVerifySummary(input: {
  valid: boolean;
  repoFound: boolean;
  schemaSupported: boolean;
  checksumMatches: boolean | null;
  auditChainValid: boolean;
  sizeBytes: number;
}): {
  valid: boolean;
  repo_found: boolean;
  schema_supported: boolean;
  checksum_checked: boolean;
  checksum_matches: boolean | null;
  audit_chain_valid: boolean;
  size_bytes: number;
  problem_count: number;
} {
  const problemCount = [
    input.repoFound,
    input.schemaSupported,
    input.auditChainValid,
    input.checksumMatches !== false
  ].filter((ok) => !ok).length;
  return {
    valid: input.valid,
    repo_found: input.repoFound,
    schema_supported: input.schemaSupported,
    checksum_checked: input.checksumMatches !== null,
    checksum_matches: input.checksumMatches,
    audit_chain_valid: input.auditChainValid,
    size_bytes: input.sizeBytes,
    problem_count: problemCount
  };
}

export function reviewBackupManifest(manifest: BackupManifestWithStatus): {
  id: string;
  repo_id: string;
  backup_path: string;
  checksum_sha256: string;
  checksum_matches?: boolean | null;
  schema_version: number;
  artifact_exists: boolean;
  size_bytes: number;
  created_at: string;
} {
  return {
    id: manifest.id,
    repo_id: manifest.repo_id,
    backup_path: manifest.backup_path,
    checksum_sha256: manifest.checksum_sha256,
    checksum_matches: manifest.checksum_matches,
    schema_version: manifest.schema_version,
    artifact_exists: manifest.artifact_exists ?? existsSync(manifest.backup_path),
    size_bytes: manifest.size_bytes,
    created_at: manifest.created_at
  };
}

export function backupCreatedNextCommands(manifest: BackupManifest): string[] {
  return [
    `drift backup verify ${manifest.backup_path} --repo ${manifest.repo_id} --checksum ${manifest.checksum_sha256} --json`,
    `${restoreDryRunCommandForBackup({
      backupPath: manifest.backup_path,
      repoId: manifest.repo_id,
      checksum: manifest.checksum_sha256
    })} --json`,
    `drift backup list --repo ${manifest.repo_id} --json`
  ];
}

export function backupListNextCommands(repoId: string, backups: BackupManifestWithStatus[]): string[] {
  const latestBackup = backups[0];
  if (!latestBackup) {
    return [`drift backup create --repo ${repoId} --confirm --json`];
  }
  return [
    `drift backup verify ${latestBackup.backup_path} --repo ${repoId} --checksum ${latestBackup.checksum_sha256} --json`,
    `${restoreDryRunCommandForBackup({
      backupPath: latestBackup.backup_path,
      repoId,
      checksum: latestBackup.checksum_sha256
    })} --json`,
    `drift backup create --repo ${repoId} --confirm --json`
  ];
}
