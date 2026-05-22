import { DRIFT_CONTRACT_SCHEMA_VERSION,type AuditChainVerification } from "@drift/core";
import { openDriftStorage,type SqliteDriftStorage } from "@drift/storage";
import { existsSync,statSync } from "node:fs";
import { join } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { doctorNextCommands } from "../args/doctor-commands.js";
import { stringFlag } from "../args/flag-readers.js";
import { defaultDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { contractFingerprint,repoIdForRoot } from "../domain/identifiers.js";
import { detectPackageManager,detectWorkspace,isApiRoutePath } from "../domain/repo-paths.js";
import { scanStatusPayload } from "../domain/scan-status.js";
import { SUPPORTED_SQLITE_SCHEMA_VERSION,doctorRuntime,doctorV1Scope,sqliteSchemaCompatibility } from "../domain/versions.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { doctorSymbol } from "../formatters/doctor.js";
import { fileContentHash } from "../io/file-hash.js";
import { gitOutput } from "../io/git.js";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorBackupArtifactSummary {
  id: string;
  backup_path: string;
  artifact_exists: boolean;
  checksum_matches: boolean | null;
  size_bytes: number | null;
  problem: "missing_artifact" | "checksum_mismatch" | null;
}

export interface DoctorStateSummary {
  exists: boolean;
  compatible: boolean;
  schema_version: number;
  supported_schema_version: number;
  repo_id?: string;
  applied_migrations: string[];
  unsupported_migrations: string[];
  missing_migrations: string[];
  repo_registered: boolean;
  scan_count: number;
  contract_ready: boolean;
  contract_compatible: boolean;
  contract_schema_version: number | null;
  supported_contract_schema_version: number;
  contract_fingerprint: string | null;
  scan_stale: boolean;
  source_change_count: number;
  scan_invalidation_reasons: string[];
  audit_integrity: AuditChainVerification | null;
  backup_count: number;
  backup_problem_count: number;
  backup_artifacts: DoctorBackupArtifactSummary[];
  detail: string;
  error?: string;
}

export function doctorRepo(parsed: ParsedArgs): CommandPayload {
  const repoRoot = resolveRepoRoot(parsed);
  const repoExists = existsSync(repoRoot);
  const repoIsDirectory = repoExists && statSync(repoRoot).isDirectory();
  const files = repoIsDirectory ? walkIndexableFiles(repoRoot) : [];
  const apiRouteCount = files.filter(isApiRoutePath).length;
  const gitInside = repoIsDirectory && gitOutput(repoRoot, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const branch = gitInside ? gitOutput(repoRoot, ["branch", "--show-current"]) || "detached" : "unknown";
  const commit = gitInside ? gitOutput(repoRoot, ["rev-parse", "--short", "HEAD"]) || "unknown" : "unknown";
  const databasePath = defaultDatabasePath(repoRoot, parsed, { createDir: false });
  const stateExists = existsSync(databasePath);
  const packageManager = repoIsDirectory ? detectPackageManager(repoRoot) : "unknown";
  const workspace = repoIsDirectory ? detectWorkspace(repoRoot) : "unknown";
  const stateSummary = inspectDoctorState(databasePath, repoIdForRoot(repoRoot));
  const runtime = doctorRuntime();
  const v1Scope = doctorV1Scope();
  const repoRootStatus = repoIsDirectory ? "ok" : "fail";
  const repoRootDetail = repoIsDirectory
    ? repoRoot
    : repoExists
      ? `${repoRoot} is not a directory`
      : `${repoRoot} does not exist`;
  const checks: DoctorCheck[] = [
    {
      id: "repo_root",
      label: "Repo root",
      status: repoRootStatus,
      detail: repoRootDetail
    },
    {
      id: "git",
      label: "Git repo",
      status: gitInside ? "ok" : "warn",
      detail: gitInside ? `${branch} @ ${commit}` : "not inside a Git worktree"
    },
    {
      id: "package_manifest",
      label: "Package manifest",
      status: repoExists && existsSync(join(repoRoot, "package.json")) ? "ok" : "warn",
      detail: repoExists && existsSync(join(repoRoot, "package.json"))
        ? "package.json found"
        : "package.json not found at repo root"
    },
    {
      id: "package_manager",
      label: "Package manager",
      status: packageManager === "unknown" ? "warn" : "ok",
      detail: packageManager
    },
    {
      id: "workspace",
      label: "Workspace",
      status: workspace === "unknown" ? "warn" : "ok",
      detail: workspace
    },
    {
      id: "typescript_files",
      label: "TS/JS files",
      status: files.length > 0 ? "ok" : "warn",
      detail: `${files.length} indexable file${files.length === 1 ? "" : "s"}`
    },
    {
      id: "api_routes",
      label: "API routes",
      status: apiRouteCount > 0 ? "ok" : "warn",
      detail: `${apiRouteCount} API route file${apiRouteCount === 1 ? "" : "s"}`
    },
    {
      id: "local_state",
      label: "Local state",
      status: stateExists ? "ok" : "warn",
      detail: stateExists ? `existing database at ${databasePath}` : `will create ${databasePath}`
    },
    {
      id: "drift_state",
      label: "Drift state",
      status: stateSummary.exists
        ? stateSummary.compatible
          ? stateSummary.repo_registered
            ? "ok"
            : "warn"
          : "fail"
        : "warn",
      detail: stateSummary.detail
    }
  ];
  if (stateSummary.exists && stateSummary.compatible && stateSummary.repo_registered) {
    checks.push(
      {
        id: "contract",
        label: "Contract",
        status: stateSummary.contract_ready
          ? stateSummary.contract_compatible
            ? "ok"
            : "fail"
          : "warn",
        detail: stateSummary.contract_ready
          ? stateSummary.contract_compatible
            ? `schema ${stateSummary.contract_schema_version}, ${stateSummary.contract_fingerprint}`
            : `unsupported schema ${stateSummary.contract_schema_version}; supported ${stateSummary.supported_contract_schema_version}`
          : "contract missing"
      },
      {
        id: "scan_freshness",
        label: "Scan freshness",
        status: stateSummary.scan_stale ? "warn" : "ok",
        detail: stateSummary.scan_stale
          ? `${stateSummary.source_change_count} source change${stateSummary.source_change_count === 1 ? "" : "s"}; ${stateSummary.scan_invalidation_reasons.join(", ") || "source changed"}`
          : "fresh"
      },
      {
        id: "audit_integrity",
        label: "Audit integrity",
        status: stateSummary.audit_integrity?.valid ? "ok" : "fail",
        detail: stateSummary.audit_integrity?.valid
          ? `valid, ${stateSummary.audit_integrity.event_count} event${stateSummary.audit_integrity.event_count === 1 ? "" : "s"}`
          : `broken at ${stateSummary.audit_integrity?.broken_at_event_id ?? "unknown event"}`
      },
      {
        id: "backup_artifacts",
        label: "Backups",
        status: stateSummary.backup_problem_count > 0 ? "warn" : "ok",
        detail: `${stateSummary.backup_count} tracked, ${stateSummary.backup_problem_count} problem${stateSummary.backup_problem_count === 1 ? "" : "s"}`
      }
    );
  }
  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const status = failed > 0 ? "fail" : warnings > 0 ? "warn" : "ok";
  const nextCommands = status === "fail" ? [] : doctorNextCommands(repoRoot, parsed, stateSummary);
  const nextCommand = nextCommands[0] ?? null;
  const text = [
    "Drift doctor",
    "",
    `Repo: ${repoRoot}`,
    `State: ${databasePath}`,
    `Runtime: Drift CLI ${runtime.cli_version}, SQLite schema ${runtime.supported_sqlite_schema_version}`,
    "V1 scope: local-first CLI, TypeScript API route layering",
    "",
    ...checks.map((check) => `${doctorSymbol(check.status)} ${check.label}: ${check.detail}`),
    "",
    status === "fail"
      ? "Fix the failed check before running the first scan."
      : nextCommands.length === 1
        ? "Next command:"
        : "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");

  return {
    payload: parsed.flags.has("json")
      ? {
          status,
          repo_root: repoRoot,
          database_path: databasePath,
          runtime,
          v1_scope: v1Scope,
          state_summary: stateSummary,
          checks,
          next_command: nextCommand,
          next_commands: nextCommands
        }
      : text
  };
}

export function inspectDoctorState(databasePath: string, repoId: string): DoctorStateSummary {
  if (!existsSync(databasePath)) {
    return {
      exists: false,
      compatible: true,
      schema_version: 0,
      supported_schema_version: SUPPORTED_SQLITE_SCHEMA_VERSION,
      applied_migrations: [],
      unsupported_migrations: [],
      missing_migrations: [],
      repo_registered: false,
      scan_count: 0,
      contract_ready: false,
      contract_compatible: false,
      contract_schema_version: null,
      supported_contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
      contract_fingerprint: null,
      scan_stale: false,
      source_change_count: 0,
      scan_invalidation_reasons: [],
      audit_integrity: null,
      backup_count: 0,
      backup_problem_count: 0,
      backup_artifacts: [],
      detail: "not initialized"
    };
  }

  let storage: SqliteDriftStorage | undefined;
  try {
    storage = openDriftStorage({ databasePath });
    const appliedMigrations = storage.getAppliedMigrations();
    const schemaVersion = appliedMigrations.length;
    const schemaCompatibility = sqliteSchemaCompatibility(appliedMigrations);
    const compatible = schemaVersion > 0 && schemaCompatibility.supported;
    const repoRegistered = compatible ? Boolean(storage.getRepo(repoId)) : false;
    const scanCount = repoRegistered
      ? storage.listScanManifests(repoId).filter((scan) => !scan.id.startsWith("scan_baseline_")).length
      : 0;
    const contract = repoRegistered ? storage.getRepoContract(repoId) : undefined;
    const contractReady = Boolean(contract);
    const contractCompatible = contract ? contract.contract_schema_version <= DRIFT_CONTRACT_SCHEMA_VERSION : false;
    const scanStatus = repoRegistered ? scanStatusPayload(storage, repoId) : undefined;
    const auditIntegrity = repoRegistered ? storage.verifyAuditChain(repoId) : null;
    const backupArtifacts = repoRegistered ? doctorBackupArtifacts(storage, repoId) : [];
    const backupProblemCount = backupArtifacts.filter((backup) => backup.problem).length;
    return {
      exists: true,
      compatible,
      schema_version: schemaVersion,
      supported_schema_version: SUPPORTED_SQLITE_SCHEMA_VERSION,
      repo_id: repoRegistered ? repoId : undefined,
      applied_migrations: appliedMigrations,
      unsupported_migrations: schemaCompatibility.unsupported_migrations,
      missing_migrations: schemaCompatibility.missing_migrations,
      repo_registered: repoRegistered,
      scan_count: scanCount,
      contract_ready: contractReady,
      contract_compatible: contractCompatible,
      contract_schema_version: contract?.contract_schema_version ?? null,
      supported_contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
      contract_fingerprint: contract ? contractFingerprint(contract) : null,
      scan_stale: scanStatus?.stale ?? false,
      source_change_count: scanStatus?.source_change_count ?? 0,
      scan_invalidation_reasons: scanStatus?.invalidation_reasons ?? [],
      audit_integrity: auditIntegrity,
      backup_count: backupArtifacts.length,
      backup_problem_count: backupProblemCount,
      backup_artifacts: backupArtifacts,
      detail: doctorStateDetail({
        exists: true,
        compatible,
        schema_version: schemaVersion,
        supported_schema_version: SUPPORTED_SQLITE_SCHEMA_VERSION,
        repo_id: repoRegistered ? repoId : undefined,
        applied_migrations: appliedMigrations,
        unsupported_migrations: schemaCompatibility.unsupported_migrations,
        missing_migrations: schemaCompatibility.missing_migrations,
        repo_registered: repoRegistered,
        scan_count: scanCount,
        contract_ready: contractReady,
        contract_compatible: contractCompatible,
        contract_schema_version: contract?.contract_schema_version ?? null,
        supported_contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
        contract_fingerprint: contract ? contractFingerprint(contract) : null,
        scan_stale: scanStatus?.stale ?? false,
        source_change_count: scanStatus?.source_change_count ?? 0,
        scan_invalidation_reasons: scanStatus?.invalidation_reasons ?? [],
        audit_integrity: auditIntegrity,
        backup_count: backupArtifacts.length,
        backup_problem_count: backupProblemCount,
        backup_artifacts: backupArtifacts,
        detail: ""
      })
    };
  } catch (error) {
    return {
      exists: true,
      compatible: false,
      schema_version: 0,
      supported_schema_version: SUPPORTED_SQLITE_SCHEMA_VERSION,
      applied_migrations: [],
      unsupported_migrations: [],
      missing_migrations: [],
      repo_registered: false,
      scan_count: 0,
      contract_ready: false,
      contract_compatible: false,
      contract_schema_version: null,
      supported_contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
      contract_fingerprint: null,
      scan_stale: false,
      source_change_count: 0,
      scan_invalidation_reasons: [],
      audit_integrity: null,
      backup_count: 0,
      backup_problem_count: 0,
      backup_artifacts: [],
      detail: "unreadable Drift database",
      error: error instanceof Error ? error.message : "unknown error"
    };
  } finally {
    storage?.close();
  }
}

export function doctorBackupArtifacts(storage: SqliteDriftStorage, repoId: string): DoctorBackupArtifactSummary[] {
  return storage.listBackupManifests(repoId).map((backup) => {
    if (!existsSync(backup.backup_path) || !statSync(backup.backup_path).isFile()) {
      return {
        id: backup.id,
        backup_path: backup.backup_path,
        artifact_exists: false,
        checksum_matches: null,
        size_bytes: null,
        problem: "missing_artifact"
      };
    }

    const sizeBytes = statSync(backup.backup_path).size;
    const checksumMatches = fileContentHash(backup.backup_path) === backup.checksum_sha256;
    return {
      id: backup.id,
      backup_path: backup.backup_path,
      artifact_exists: true,
      checksum_matches: checksumMatches,
      size_bytes: sizeBytes,
      problem: checksumMatches ? null : "checksum_mismatch"
    };
  });
}

export function doctorStateDetail(summary: DoctorStateSummary): string {
  if (!summary.exists) {
    return "not initialized";
  }
  if (!summary.compatible) {
    if (summary.unsupported_migrations.length > 0) {
      return `unsupported migration ${summary.unsupported_migrations.join(", ")}`;
    }
    if (summary.missing_migrations.length > 0) {
      return `incomplete migration history, missing ${summary.missing_migrations.join(", ")}`;
    }
    return `unsupported schema version ${summary.schema_version}`;
  }
  if (!summary.repo_registered) {
    return `database exists, repo not registered`;
  }
  return [
    "registered repo",
    `${summary.scan_count} scan${summary.scan_count === 1 ? "" : "s"}`,
    summary.contract_ready ? "contract ready" : "contract missing"
  ].join(", ");
}
