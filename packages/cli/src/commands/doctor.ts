import { BETA_DOCTOR_RESPONSE_SCHEMA,DRIFT_CONTRACT_SCHEMA_VERSION,type AuditChainVerification } from "@drift/core";
import { openDriftStorage,type SqliteDriftStorage } from "@drift/storage";
import { existsSync,statSync } from "node:fs";
import { join } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { doctorNextCommands } from "../args/doctor-commands.js";
import { stringFlag } from "../args/flag-readers.js";
import { defaultDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { betaDoctorResponse } from "../domain/beta-surfaces.js";
import { checkDiskSpace,checkHeadroom } from "../domain/disk-space.js";
import { engineProvenance,type EngineProvenance } from "../domain/engine-provenance.js";
import { contractFingerprint,repoIdForRoot } from "../domain/identifiers.js";
import { inspectRepoIdentity,SHALLOW_CLONE_REMEDIATION,type RepoIdentityInspection } from "../domain/repo-identity.js";
import { detectPackageManager,detectWorkspace,isApiRoutePath } from "../domain/repo-paths.js";
import { importCoverageDetail,importCoverageReport,type ImportCoverageReport } from "../domain/import-coverage.js";
import { scanStatusPayload } from "../domain/scan-status.js";
import { SUPPORTED_SQLITE_SCHEMA_VERSION,currentMachineContractVersions,doctorRuntime,doctorV1Scope,sqliteSchemaCompatibility } from "../domain/versions.js";
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
  /**
   * EW-3: what the resolver could not place, as a number with a breakdown. `null` before any scan
   * exists - there is nothing measured to report, which is different from "everything resolved".
   */
  import_coverage: ImportCoverageReport | null;
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
  // X-1: doctor diagnoses identity rather than refusing - it is the surface a user consults
  // AFTER the shallow refusal, so it must be able to look at exactly the repo scan cannot.
  const identityInspection = repoIsDirectory ? inspectRepoIdentity(repoRoot) : null;
  const databasePath = defaultDatabasePath(repoRoot, parsed, { createDir: false });
  const stateExists = existsSync(databasePath);
  const packageManager = repoIsDirectory ? detectPackageManager(repoRoot) : "unknown";
  const workspace = repoIsDirectory ? detectWorkspace(repoRoot) : "unknown";
  const stateSummary = inspectDoctorState(databasePath, repoIdForRoot(repoRoot));
  const runtime = doctorRuntime();
  const machineContractVersions = currentMachineContractVersions();
  const v1Scope = doctorV1Scope();
  const repoRootStatus = repoIsDirectory ? "ok" : "fail";
  const repoRootDetail = repoIsDirectory
    ? repoRoot
    : repoExists
      ? `${repoRoot} is not a directory`
      : `${repoRoot} does not exist`;
  const diskSpace = checkDiskSpace(databasePath, files.length);
  const headroom = checkHeadroom(files.length);
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
      // The X-RED gap: doctor said nothing about identity, so a shallow CI checkout's
      // wrong fingerprint was invisible until `contract import` failed with mismatch codes.
      // fail = shallow (identity underivable, scans will refuse); warn = path-bound (works
      // locally, a committed contract will not travel); ok = portable, with the fingerprint
      // shown so two machines can be compared by eye.
      id: "repo_identity",
      label: "Repo identity",
      status: identityInspection
        ? identityInspection.shallow
          ? "fail"
          : identityInspection.identity?.source === "absolute_path"
            ? "warn"
            : "ok"
        : "warn",
      detail: identityInspection
        ? identityInspection.shallow
          ? `shallow clone - identity cannot be derived and scans will refuse. ${SHALLOW_CLONE_REMEDIATION}`
          : identityInspection.identity?.source === "absolute_path"
            ? `path-bound (${identityInspection.identity.detail}); a committed contract will not import into another checkout`
            : `source ${identityInspection.identity?.source}, fingerprint ${identityFingerprint(identityInspection)}, ${identityInspection.identity?.detail}`
        : "unknown"
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
      // Drift's per-repo state runs to roughly 1 GB for a 5,000-file monorepo, and exhausting
      // the disk mid-scan does not fail cleanly: SQLite reports a raw "database or disk is
      // full", the database is left partially written, and later operations report failures
      // unrelated to the repo. Surfacing the estimate here means a user finds out before a
      // long scan rather than during one.
      id: "disk_space",
      label: "Disk space",
      status: diskSpace.sufficient ? "ok" : "fail",
      detail: diskSpace.detail
    },
    {
      // The Node CLI peaks around 19x the Rust engine's memory doing storage and graph assembly.
      // Below the needed heap the process dies with a raw V8 FATAL ERROR and exit 134, which is
      // no use to anyone - so surface it here, before a long scan.
      id: "memory_headroom",
      label: "Memory headroom",
      status: headroom.sufficient ? "ok" : "fail",
      detail: headroom.detail
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
      },
      {
        // EW-3. The number a stranger needs before trusting a verdict.
        //
        // `warn`, never `fail`: partial resolution is a limit on what Drift can say, not a reason
        // to stop. The one exception is a report that does not reconcile with the stored gap
        // count, which means the numbers themselves are untrustworthy - and unreliable numbers are
        // worse than none, so that is a `fail`.
        id: "import_coverage",
        label: "Import coverage",
        status: !stateSummary.import_coverage
          ? "warn"
          : !stateSummary.import_coverage.reconciles
            ? "fail"
            : stateSummary.import_coverage.parser_gap_count > 0
              ? "warn"
              : "ok",
        detail: stateSummary.import_coverage
          ? importCoverageDetail(stateSummary.import_coverage)
          : "no scan yet"
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
    // EW-3: a known unsupported shape is named as a limitation with what to do about it, rather
    // than folded into a generic warning count. This is the difference between a stranger
    // concluding "Drift is broken on my repo" and "Drift does not support this one construct".
    ...limitationLines(stateSummary.import_coverage),
    status === "fail"
      ? "Fix the failed check before running the first scan."
      : nextCommands.length === 1
        ? "Next command:"
        : "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
  const jsonPayload = {
    response_schema: BETA_DOCTOR_RESPONSE_SCHEMA,
    status,
    repo_root: repoRoot,
    database_path: databasePath,
    // Machine-readable identity facts (X-1): shallow status, derivation source, and the
    // portable fingerprint `contract import` will compare against.
    repo_identity: {
      shallow: identityInspection?.shallow ?? false,
      source: identityInspection?.identity?.source ?? null,
      fingerprint: identityInspection?.identity ? identityFingerprint(identityInspection) : null,
      detail: identityInspection?.identity?.detail ?? identityInspection?.refusal ?? null
    },
    runtime,
    machine_contract_versions: machineContractVersions,
    engine: runtimeEngineProvenance(),
    v1_scope: v1Scope,
    state_summary: stateSummary,
    // EW-3: hoisted out of state_summary because it is a headline, not a state detail - the
    // resolution rate is the thing that decides whether a verdict from this repo means anything.
    import_coverage: stateSummary.import_coverage,
    checks,
    next_command: nextCommand,
    next_commands: nextCommands
  };

  return {
    payload: parsed.flags.has("json") ? betaDoctorResponse(jsonPayload) : text
  };
}

/**
 * The named limitations in a coverage report, as text lines. Empty when there are none, so the
 * doctor output does not grow a section for repos that hit no limitation at all.
 */
function limitationLines(coverage: ImportCoverageReport | null): string[] {
  const limited = (coverage?.by_code ?? []).filter((bucket) => bucket.limitation);
  if (limited.length === 0) {
    return [];
  }
  return [
    "Known limitations on this repo:",
    ...limited.flatMap((bucket) => [
      `  ${bucket.code} (${bucket.count} occurrence${bucket.count === 1 ? "" : "s"}` +
        `${bucket.by_directory[0] ? `, mostly ${bucket.by_directory[0].directory}/` : ""}):`,
      `    ${bucket.limitation}`,
      ...(bucket.top_specifiers.length > 0
        ? [`    most affected: ${bucket.top_specifiers.map((entry) => `${entry.specifier} x${entry.count}`).join(", ")}`]
        : [])
    ]),
    ""
  ];
}

function runtimeEngineProvenance(): EngineProvenance {
  return engineProvenance();
}

/** The portable fingerprint as stored on RepoRecord (repo-paths.ts): the identity id sans prefix. */
function identityFingerprint(inspection: RepoIdentityInspection): string {
  return inspection.identity?.id.replace(/^repo_/, "") ?? "";
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
      import_coverage: null,
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
    const importCoverage = repoRegistered ? doctorImportCoverage(storage, repoId) : null;
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
      import_coverage: importCoverage,
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
        import_coverage: importCoverage,
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
      import_coverage: null,
      detail: "unreadable Drift database",
      error: error instanceof Error ? error.message : "unknown error"
    };
  } finally {
    storage?.close();
  }
}

/**
 * EW-3: the coverage report for the most recent real scan.
 *
 * Reads the persisted graph diagnostics rather than rescanning, because doctor must be cheap and
 * because the point is to report what the scan the user's contract rests on actually saw. Baseline
 * scans are excluded for the same reason `scan_count` excludes them: they are a snapshot of
 * pre-existing debt, not a measurement of the repo.
 *
 * `resolvedLocalImports` counts distinct import nodes carrying an `IMPORT_RESOLVES_TO_MODULE`
 * edge. That is the only honest denominator available: total import declarations would include
 * every `next/server` and `react`, which do not resolve to a repo file and never should, so a
 * rate computed against them would report a coverage failure for correct behaviour.
 */
function doctorImportCoverage(
  storage: SqliteDriftStorage,
  repoId: string
): ImportCoverageReport | null {
  const scans = storage
    .listScanManifests(repoId)
    .filter((scan) => !scan.id.startsWith("scan_baseline_"));
  const latest = scans[scans.length - 1];
  if (!latest) {
    return null;
  }
  const diagnostics = storage.listGraphDiagnostics(repoId, latest.id);
  const resolvedLocalImports = new Set(
    storage
      .listGraphEdges(repoId, latest.id)
      .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE")
      .map((edge) => edge.from)
  ).size;
  const storedGapCount = storage.getScanCapabilityReport(repoId, latest.id)?.parser_gap_count;
  return importCoverageReport({
    diagnostics,
    resolvedLocalImports,
    ...(storedGapCount === undefined ? {} : { storedParserGapCount: storedGapCount })
  });
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
