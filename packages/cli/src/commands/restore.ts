import { authorizeContextExport,type AuditChainVerification,type RepoRecord } from "@drift/core";
import { openDriftStorage } from "@drift/storage";
import { copyFileSync,existsSync,mkdirSync,statSync } from "node:fs";
import { dirname,extname,resolve } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,optionalChecksumFlag,optionalNonEmptyFlag,rejectAmbiguousDryRunConfirm,requiredFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath } from "../args/repo-flags.js";
import { assertExpectedRepoFingerprint } from "../domain/contract-materialization.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "../domain/governance.js";
import { hashStable } from "../domain/identifiers.js";
import { RestoreStaleness,restoreCompletedNextCommands,restoreConfirmCommand,restoreDryRunNextCommands,restoreIntent,restoreRescanGuidance,restoreStalenessForRepo,restoreSummary } from "../domain/restore-review.js";
import { SUPPORTED_SQLITE_SCHEMA_VERSION,sqliteSchemaCompatibility } from "../domain/versions.js";
import { formatRestoreText } from "../formatters/restore.js";
import { fileContentHash } from "../io/file-hash.js";

export function restoreBackup(parsed: ParsedArgs): CommandPayload {
  const backupPath = requiredValue(parsed.positional[1], "backup path");
  const targetDatabasePath = requiredDatabasePath(parsed);
  const repoId = requiredFlag(parsed, "repo");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const dryRun = parsed.flags.has("dry-run");
  const force = parsed.flags.has("force");
  const confirmed = parsed.flags.has("confirm");
  const expectedRepoFingerprint = optionalNonEmptyFlag(parsed, "expect-repo-fingerprint");
  rejectAmbiguousDryRunConfirm(parsed);
  if (parsed.flags.has("require-checksum") && !parsed.flags.has("checksum")) {
    throw new Error("Restore requires --checksum when --require-checksum is used.");
  }
  const targetExists = existsSync(targetDatabasePath);
  const wouldRequireForce = targetExists && !force;
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  if (!statSync(backupPath).isFile()) {
    throw new Error(`Backup path must be a file: ${backupPath}`);
  }
  if (targetExists && statSync(targetDatabasePath).isDirectory()) {
    throw new Error(`Restore target must be a file path: ${targetDatabasePath}`);
  }
  if (extname(targetDatabasePath) !== ".sqlite") {
    throw new Error("Restore target must end in .sqlite.");
  }
  if (resolve(backupPath) === resolve(targetDatabasePath)) {
    throw new Error("Restore target must be different from the backup path.");
  }
  if (!dryRun && !confirmed) {
    throw new Error("Restore requires --confirm unless --dry-run is used.");
  }
  if (targetExists && !force && !dryRun) {
    throw new Error("Target database already exists. Pass --force to overwrite it.");
  }

  const checksum = fileContentHash(backupPath);
  const expectedChecksum = optionalChecksumFlag(parsed, "checksum");
  if (expectedChecksum && expectedChecksum !== checksum) {
    throw new Error(`Backup checksum mismatch: expected ${expectedChecksum}, got ${checksum}.`);
  }
  const checksumMatches = expectedChecksum ? expectedChecksum === checksum : null;
  const backupStorage = openDriftStorage({ databasePath: backupPath });
  let schemaVersion = 0;
  let appliedMigrations: string[] = [];
  let repo: RepoRecord | undefined;
  let restoreStaleness: RestoreStaleness;
  let policy: ReturnType<typeof authorizeContextExport> | null = null;
  let auditIntegrity: AuditChainVerification | null = null;
  try {
    appliedMigrations = backupStorage.getAppliedMigrations();
    schemaVersion = appliedMigrations.length;
    repo = backupStorage.getRepo(repoId);
    auditIntegrity = repo ? backupStorage.verifyAuditChain(repoId) : null;
    const contract = backupStorage.getRepoContract(repoId);
    policy = contract ? authorizeContextExport(contract, "artifact") : null;
    restoreStaleness = restoreStalenessForRepo(backupStorage, repoId);
  } finally {
    backupStorage.close();
  }
  if (policy && !policy.allowed) {
    throw new Error(`Policy denied restore output: ${policy.reason}`);
  }
  assertExpectedRepoFingerprint(repo?.fingerprint, expectedRepoFingerprint);
  if (schemaVersion === 0) {
    throw new Error(`Backup has no Drift schema migrations: ${backupPath}`);
  }
  if (schemaVersion > SUPPORTED_SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Backup schema version ${schemaVersion} is not supported by this Drift build. ` +
        `Maximum supported schema version is ${SUPPORTED_SQLITE_SCHEMA_VERSION}.`
    );
  }
  const schemaCompatibility = sqliteSchemaCompatibility(appliedMigrations);
  if (!schemaCompatibility.supported) {
    if (schemaCompatibility.unsupported_migrations.length > 0) {
      throw new Error(`Backup schema migration is not supported: ${schemaCompatibility.unsupported_migrations.join(", ")}.`);
    }
    throw new Error(`Backup schema migration history is incomplete: ${schemaCompatibility.missing_migrations.join(", ")}.`);
  }
  if (!repo) {
    throw new Error(`Backup does not contain repo ${repoId}.`);
  }
  if (!auditIntegrity?.valid) {
    throw new Error(
      `Backup audit chain is invalid at ${auditIntegrity?.broken_at_event_id ?? "unknown event"}: ` +
        `${auditIntegrity?.reasons.join(", ") || "unknown reason"}.`
    );
  }

  const restoreId = `restore_${hashStable(`${repoId}:${backupPath}:${targetDatabasePath}:${now}`).slice(0, 16)}`;
  const confirmCommand = restoreConfirmCommand({
    targetDatabasePath,
    backupPath,
    repoId,
    checksum,
    force: targetExists
  });
  const restore = {
    id: restoreId,
    repo_id: repoId,
    repo_fingerprint: repo.fingerprint,
    backup_path: backupPath,
    restored_database_path: targetDatabasePath,
    checksum_sha256: checksum,
    checksum_matches: checksumMatches,
    schema_version: schemaVersion,
    audit_integrity: auditIntegrity,
    ...restoreStaleness!,
    ...restoreRescanGuidance(repo, targetDatabasePath, restoreStaleness!),
    dry_run: dryRun,
    write_intent: !dryRun,
    confirm_command: dryRun ? confirmCommand : null,
    target_exists: targetExists,
    would_require_force: wouldRequireForce,
    restored_at: dryRun ? null : now
  };

  if (dryRun) {
    return {
      payload: parsed.flags.has("json")
        ? {
            restore,
            governance: preflightGovernance(),
            restore_intent: restoreIntent(restore),
            summary: restoreSummary(restore),
            next_commands: restoreDryRunNextCommands(restore)
          }
        : formatRestoreText(restore)
    };
  }

  mkdirSync(dirname(targetDatabasePath), { recursive: true });
  copyFileSync(backupPath, targetDatabasePath);

  const restoredStorage = openDriftStorage({ databasePath: targetDatabasePath });
  try {
    restoredStorage.migrate();
    restoredStorage.appendAuditEvent(auditEvent({
      id: `audit_event_restore_${repoId}_${now}`,
      repoId,
      actor,
      action: "restore_completed",
      targetType: "restore",
      targetId: restoreId,
      metadata: {
        backup_path: backupPath,
        checksum_sha256: checksum,
        checksum_matches: checksumMatches,
        schema_version: schemaVersion,
        graph_stale: restore.graph_stale,
        requires_rescan: restore.requires_rescan,
        staleness_reason: restore.staleness_reason
      },
      createdAt: now
    }));
    restoredStorage.checkpoint();

    const completedRestore = {
      id: restoreId,
      repo_id: repoId,
      repo_fingerprint: repo.fingerprint,
      backup_path: backupPath,
      restored_database_path: targetDatabasePath,
      checksum_sha256: checksum,
      checksum_matches: checksumMatches,
      schema_version: restoredStorage.getAppliedMigrations().length,
      audit_integrity: restoredStorage.verifyAuditChain(repoId),
      ...restoreStaleness!,
      ...restoreRescanGuidance(repo, targetDatabasePath, restoreStaleness!),
      dry_run: false,
      write_intent: true,
      confirm_command: null,
      target_exists: targetExists,
      would_require_force: false,
      restored_at: now
    };
    return {
      payload: parsed.flags.has("json")
        ? {
            restore: completedRestore,
            governance: mutationGovernance(),
            restore_intent: restoreIntent(completedRestore),
            summary: restoreSummary(completedRestore),
            next_commands: restoreCompletedNextCommands(completedRestore)
          }
        : formatRestoreText(completedRestore)
    };
  } finally {
    restoredStorage.close();
  }
}
