import { type AuditChainVerification,authorizeContextExport,type RepoRecord } from "@drift/core";
import { openDriftStorage,type SqliteDriftStorage } from "@drift/storage";
import { copyFileSync,existsSync,statSync } from "node:fs";
import { resolve } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,optionalBackupArtifactStatusFlag,optionalChecksumFlag,optionalNonEmptyFlag,optionalNonNegativeIntegerFlag,optionalPositiveIntegerFlag,requiredFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveBackupPath,resolveRepoId } from "../args/repo-flags.js";
import { backupCreatedNextCommands,backupListNextCommands,backupListSummary,backupManifestSummary,backupManifestWithArtifactStatus,backupMatchesArtifactStatus,backupVerifySummary,orderBackupsForReview,paginateBackups,reviewBackupManifest } from "../domain/backup-artifacts.js";
import { assertExpectedRepoFingerprint } from "../domain/contract-materialization.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "../domain/governance.js";
import { hashStable } from "../domain/identifiers.js";
import { paginationSummary } from "../domain/pagination.js";
import { repoContractOrDefault,requiredRepo } from "../domain/repo-paths.js";
import { restoreDryRunCommandForBackup } from "../domain/restore-review.js";
import { sqliteSchemaCompatibility } from "../domain/versions.js";
import { formatBackupCreatedText,formatBackupListText,formatBackupVerifyText } from "../formatters/backup.js";
import { fileContentHash } from "../io/file-hash.js";

export function createBackup(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const repo = requiredRepo(storage, repoId);
  const contract = repoContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, "artifact");
  if (!policy.allowed) {
    throw new Error(`Policy denied backup output: ${policy.reason}`);
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  if (!parsed.flags.has("confirm")) {
    throw new Error("Backup creation requires --confirm.");
  }
  const sourceDatabasePath = requiredDatabasePath(parsed);
  const backupPath = resolveBackupPath(parsed, repoId, now);
  const force = parsed.flags.has("force");
  if (resolve(sourceDatabasePath) === resolve(backupPath)) {
    throw new Error("Backup output must be different from the source database path.");
  }
  if (existsSync(backupPath) && !force) {
    throw new Error("Backup output already exists. Pass --force to overwrite it.");
  }
  const backupId = `backup_${hashStable(`${repoId}:${backupPath}:${now}`).slice(0, 16)}`;

  storage.appendAuditEvent(auditEvent({
    id: `audit_event_backup_create_${repoId}_${now}`,
    repoId,
    actor,
    action: "backup_created",
    targetType: "backup",
    targetId: backupId,
    metadata: { backup_path: backupPath },
    createdAt: now
  }));
  storage.checkpoint();
  copyFileSync(sourceDatabasePath, backupPath);

  const manifest = {
    id: backupId,
    repo_id: repoId,
    repo_fingerprint: repo.fingerprint,
    schema_version: storage.getAppliedMigrations().length,
    source_database_path: sourceDatabasePath,
    backup_path: backupPath,
    checksum_sha256: fileContentHash(backupPath),
    size_bytes: statSync(backupPath).size,
    created_at: now
  };
  storage.upsertBackupManifest(manifest);

  return {
    payload: parsed.flags.has("json")
      ? {
          manifest,
          policy,
          governance: mutationGovernance(),
          summary: backupManifestSummary(manifest, true),
          review_item: reviewBackupManifest(manifest),
          next_commands: backupCreatedNextCommands(manifest)
        }
      : formatBackupCreatedText(manifest)
  };
}

export function listBackups(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = repoContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, "artifact");
  if (!policy.allowed) {
    throw new Error(`Policy denied backup output: ${policy.reason}`);
  }
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const offset = optionalNonNegativeIntegerFlag(parsed, "offset") ?? 0;
  const artifactStatus = optionalBackupArtifactStatusFlag(parsed, "artifact-status");
  const allBackups = storage
    .listBackupManifests(repoId)
    .map((backup) => backupManifestWithArtifactStatus(backup));
  const filteredBackups = orderBackupsForReview(
    allBackups.filter((backup) => backupMatchesArtifactStatus(backup, artifactStatus))
  );
  const backups = paginateBackups(filteredBackups, limit, offset);
  const payload = {
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    total_count: allBackups.length,
    filtered_count: filteredBackups.length,
    count: backups.length,
    summary: backupListSummary(allBackups, filteredBackups, backups),
    filters: {
      artifact_status: artifactStatus ?? null
    },
    pagination: paginationSummary(filteredBackups.length, backups.length, limit, offset),
    backups,
    review_items: backups.map((backup) => reviewBackupManifest(backup)),
    next_commands: backupListNextCommands(repoId, backups)
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatBackupListText(payload)
  };
}

export function verifyBackup(parsed: ParsedArgs): CommandPayload {
  const backupPath = requiredValue(parsed.positional[2], "backup path");
  const repoId = requiredFlag(parsed, "repo");
  const expectedChecksum = optionalChecksumFlag(parsed, "checksum");
  const expectedRepoFingerprint = optionalNonEmptyFlag(parsed, "expect-repo-fingerprint");
  if (parsed.flags.has("require-checksum") && !expectedChecksum) {
    throw new Error("Backup verify requires --checksum when --require-checksum is used.");
  }
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  if (!statSync(backupPath).isFile()) {
    throw new Error(`Backup path must be a file: ${backupPath}`);
  }

  const checksum = fileContentHash(backupPath);
  const checksumMatches = expectedChecksum ? checksum === expectedChecksum : null;
  const sizeBytes = statSync(backupPath).size;
  const backupStorage = openDriftStorage({ databasePath: backupPath });
  let schemaVersion = 0;
  let appliedMigrations: string[] = [];
  let repo: RepoRecord | undefined;
  let policy: ReturnType<typeof authorizeContextExport> | null = null;
  let auditIntegrity: AuditChainVerification | null = null;
  try {
    appliedMigrations = backupStorage.getAppliedMigrations();
    schemaVersion = appliedMigrations.length;
    repo = backupStorage.getRepo(repoId);
    auditIntegrity = repo ? backupStorage.verifyAuditChain(repoId) : null;
    const contract = backupStorage.getRepoContract(repoId);
    policy = contract ? authorizeContextExport(contract, "artifact") : null;
  } finally {
    backupStorage.close();
  }
  if (policy && !policy.allowed) {
    throw new Error(`Policy denied backup verify output: ${policy.reason}`);
  }
  assertExpectedRepoFingerprint(repo?.fingerprint, expectedRepoFingerprint);
  const schemaCompatibility = sqliteSchemaCompatibility(appliedMigrations);
  const schemaSupported = schemaVersion > 0 && schemaCompatibility.supported;
  const auditChainValid = auditIntegrity?.valid ?? false;
  const restoreDryRunCommand = restoreDryRunCommandForBackup({
    backupPath,
    repoId,
    checksum
  });

  const payload = {
    valid: schemaSupported && Boolean(repo) && checksumMatches !== false && auditChainValid,
    repo_id: repoId,
    governance: preflightGovernance(),
    policy,
    repo_fingerprint: repo?.fingerprint ?? null,
    backup_path: backupPath,
    schema_version: schemaVersion,
    schema_supported: schemaSupported,
    applied_migrations: appliedMigrations,
    unsupported_migrations: schemaCompatibility.unsupported_migrations,
    missing_migrations: schemaCompatibility.missing_migrations,
    checksum_sha256: checksum,
    checksum_matches: checksumMatches,
    audit_integrity: auditIntegrity,
    restore_dry_run_command: restoreDryRunCommand,
    size_bytes: sizeBytes,
    repo_found: Boolean(repo),
    summary: backupVerifySummary({
      valid: schemaSupported && Boolean(repo) && checksumMatches !== false && auditChainValid,
      repoFound: Boolean(repo),
      schemaSupported,
      checksumMatches,
      auditChainValid,
      sizeBytes
    }),
    verification: {
      valid: schemaSupported && Boolean(repo) && checksumMatches !== false && auditChainValid,
      schema_supported: schemaSupported,
      checksum_matches: checksumMatches,
      repo_found: Boolean(repo),
      audit_chain: auditIntegrity
    },
    review_item: {
      id: `backup_verify_${hashStable(`${backupPath}:${checksum}`).slice(0, 16)}`,
      repo_id: repoId,
      backup_path: backupPath,
      checksum_sha256: checksum,
      checksum_matches: checksumMatches,
      audit_chain_valid: auditChainValid,
      schema_version: schemaVersion,
      schema_supported: schemaSupported,
      repo_found: Boolean(repo),
      size_bytes: sizeBytes
    },
    next_commands: [`${restoreDryRunCommand} --json`]
  };

  return {
    exitCode: payload.valid ? 0 : 1,
    payload: parsed.flags.has("json") ? payload : formatBackupVerifyText(payload)
  };
}
